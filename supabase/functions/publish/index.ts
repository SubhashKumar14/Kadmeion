/**
 * B4 owner-authorized publication entry point. Disabled until an owner-approved
 * host passes independent revocation and cost proofs. No public writes on import.
 * Privileged RPCs are invoked only AFTER a live owner JWT and owner-RLS consent.
 */
import {publishConsentedUnlistedRelease,checkCurrentPublicDelivery,type FrozenPublicationConsent,type PublicAuthorityRpc} from '../../../packages/storage-adapters/src/unlisted-release-verification.ts';
import {parseOwnerPublicDelivery,type OwnerPublicDeliveryAcknowledgement} from '../../../packages/contracts/src/private-release-visibility-service.ts';

type Env=Readonly<Record<string,string|undefined>>;
type Dependencies={
  env?:Env;
  http?:typeof fetch;
  publish?:(intentId:string,origin:string,rpc:(name:string,body:Record<string,unknown>)=>Promise<unknown>)=>Promise<unknown>;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER_JWT=/^Bearer (eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const MAX_REQUEST=128;
const MAX_RPC_BYTES=2*1024*1024;
const record=(v:unknown):v is Record<string,unknown>=>
  !!v&&typeof v==='object'&&!Array.isArray(v);
function serverEnv():Env {
  const deno=(globalThis as unknown as {Deno?:{env?:{get:(key:string)=>string|undefined}}}).Deno?.env;
  const fields=['KADMEION_RELEASE_WORKER_ENABLED','KADMEION_RELEASE_HOST_APPROVED',
    'KADMEION_RELEASE_HOST_REVOCATION_VERIFIED','KADMEION_RELEASE_HOST_ORIGIN',
    'KADMEION_RELEASE_HOSTNAME','KADMEION_ALLOWED_PUBLISH_ORIGINS',
    'SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY','KADMEION_LOCAL_INTEGRATION'];
  return Object.fromEntries(fields.map(k=>[k,deno?.get(k)]));
}
function originList(raw:string|undefined):Set<string>|null {
  if(!raw||raw.length>1024)return null;
  const parts=raw.split(',');
  if(parts.length>8)return null;
  const set=new Set<string>();
  for(const value of parts) {
    try{
      const url=new URL(value);
      if(!value||value!==value.trim()||value==='*'||
         url.origin!==value&&url.origin+'/'!==value||
         url.username||url.password||url.pathname!=='/'||url.search||url.hash||
         !((url.protocol==='https:'&&url.hostname.includes('.'))||
           (url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname))))
        return null;
      set.add(url.origin);
    }catch{return null;}
  }
  return set.size===parts.length?set:null;
}
function configuration(env:Env) {
  try{
    const supabase=new URL(env.SUPABASE_URL??'');
    const local=env.KADMEION_LOCAL_INTEGRATION==='1' &&
      ['http://127.0.0.1:54321','http://localhost:54321',
        'http://kong:8000'].includes(supabase.origin);
    if((supabase.origin!=='https://scyooqjitjzjdxgtanso.supabase.co'&&!local)||
       supabase.pathname!=='/'||supabase.username||supabase.password||
       supabase.search||supabase.hash)return null;
    const host=new URL(env.KADMEION_RELEASE_HOST_ORIGIN??'');
    const hostname=host.hostname.toLowerCase();
    if(host.username||host.password||host.pathname!=='/'||host.search||host.hash||
       host.hostname!==env.KADMEION_RELEASE_HOSTNAME||
       !((host.protocol==='https:'&&hostname.includes('.')&&
         !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)&&
         !/(?:\.local|\.internal|\.localhost|\.test|\.invalid)$/.test(hostname))||
         (local&&host.protocol==='http:'&&['127.0.0.1','localhost'].includes(hostname))))
      return null;
    const pub=env.SUPABASE_PUBLISHABLE_KEY??env.SUPABASE_ANON_KEY;
    const secret=env.SUPABASE_SERVICE_ROLE_KEY;
    if(typeof pub!=='string'||pub.length<20||typeof secret!=='string'||
       !secret.startsWith('eyJ')||secret.length<70||secret===pub)return null;
    return {supabase:supabase.origin,host:host.origin,pub,secret};
  }catch{return null;}
}
function headers(origin?:string,allowed=false):Headers {
  const h=new Headers({
    'Cache-Control':'private, no-store, max-age=0',
    'CDN-Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY',
    'Referrer-Policy':'no-referrer',
    'Vary':'Origin'
  });
  if(origin&&allowed){
    h.set('Access-Control-Allow-Origin',origin);
    h.set('Access-Control-Allow-Methods','POST, OPTIONS');
    h.set('Access-Control-Allow-Headers','authorization, apikey, content-type, x-client-info');
    h.set('Access-Control-Max-Age','60');
  }
  return h;
}
function error(code:number,message:string,origin?:string,allowed=false):Response {
  return Response.json({error:message},{status:code,headers:headers(origin,allowed)});
}
const PUBLISH_RPC_TIMEOUT_MS=10_000;
function cancelPublishBody(body:{cancel:()=>Promise<void>}|null|undefined):void{
  try{void body?.cancel().catch(()=>{});}catch{}
}
async function withPublishDeadline<T>(run:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{reject(Error('Publication request timed out'));controller.abort();},PUBLISH_RPC_TIMEOUT_MS);
  });
  try{return await Promise.race([run(controller.signal),deadline]);}
  finally{clearTimeout(timer);controller.abort();}
}
async function bounded(request:Request|Response,limit:number,signal:AbortSignal):Promise<unknown> {
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  const stop=()=>cancelPublishBody(reader??request.body);
  signal.addEventListener('abort',stop,{once:true});
  try{
    if(signal.aborted)throw Error('Publication request expired');
    const length=request.headers.get('content-length');
    if(length!==null&&(!/^\d+$/.test(length)||Number(length)>limit))throw Error('Body too large');
    reader=request.body?.getReader();
    if(!reader)throw Error('Missing body');
    const chunks:Uint8Array[]=[];
    let size=0,count=0;
    for(;;){
      const next=await reader.read();
      if(signal.aborted)throw Error('Publication request expired');
      if(next.done)break;
      if(!(next.value instanceof Uint8Array)||++count>65_536)throw Error('Invalid stream');
      size+=next.value.byteLength;
      if(size>limit)throw Error('Body too large');
      if(next.value.byteLength!==0)chunks.push(next.value);
    }
    const encoding=request.headers.get('content-encoding');
    if(length!==null&&(!('status' in request)||!encoding||encoding.toLowerCase()==='identity')&&
        Number(length)!==size)throw Error('Invalid body length');
    const bytes=new Uint8Array(size);let offset=0;
    for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }finally{
    signal.removeEventListener('abort',stop);
    stop();
    try{reader?.releaseLock();}catch{}
  }
}
async function getJson(url:string,headers:Record<string,string>,http:typeof fetch,
                       body?:Record<string,unknown>):Promise<unknown> {
  return withPublishDeadline(async signal=>{
    const response=await http(url,{
      method:body?'POST':'GET',headers:{
        ...headers,Accept:'application/json',
        ...(body?{'Content-Type':'application/json'}:{})
      },
      body:body?JSON.stringify(body):undefined,
      credentials:'omit',cache:'no-store',redirect:'error',signal
    });
    if(signal.aborted||response.redirected||(response.url!==''&&response.url!==url)||!response.ok||
       !/^application\/(?:json|[a-z0-9.+-]+\+json)(?:;|$)/i.test(response.headers.get('content-type')??'')){
      cancelPublishBody(response.body);
      throw Error('Private provider response not verified');
    }
    return bounded(response,MAX_RPC_BYTES,signal);
  });
}
// C11 cutover: owner-visible frozen request is the source of visibility intent.
 // This prevents a missing/renamed PUBLIC address from downgrading to UNLISTED.
export function boundFrozenPublicationConsent(ownerId:string,intent:Record<string,unknown>,rows:unknown):FrozenPublicationConsent {
  if(typeof intent.request_id!=='string'||!UUID.test(intent.request_id)||
     typeof intent.portfolio_id!=='string'||!UUID.test(intent.portfolio_id)||
     !Array.isArray(rows)||rows.length!==1)
    throw Error('Frozen publication consent unavailable');
  const frozen=rows[0];
  if(!record(frozen)||frozen.id!==intent.request_id||frozen.portfolio_id!==intent.portfolio_id||
     frozen.owner_user_id!==ownerId||frozen.status!=='FROZEN'||
     (frozen.visibility_intent!=='PUBLIC'&&frozen.visibility_intent!=='UNLISTED'))
    throw Error('Frozen publication consent unavailable');
  return Object.freeze({portfolioId:intent.portfolio_id,requestId:intent.request_id,visibility:frozen.visibility_intent});
}
/** Minimized owner receipt; service authority and HTTP observations must agree. */
export function ownerPublicAcknowledgement(result:Record<string,unknown>,consent:FrozenPublicationConsent,
    intentId:string,host:string):OwnerPublicDeliveryAcknowledgement{
  const a=result.authoritativePublicReceipt,o=result.observedPublicDelivery;
  if(!record(a)||!record(o)||typeof a.operationId!=='string'||
     a.portfolioId!==consent.portfolioId||a.requestId!==consent.requestId||a.intentId!==intentId||
     a.visibility!=='PUBLIC'||a.storedHtmlSha256!==result.htmlSha256||
     o.portfolioId!==consent.portfolioId||o.intentId!==intentId||
     o.preparedReleaseGeneration!==a.releaseGeneration||typeof a.handle!=='string'||typeof a.slug!=='string'||
     o.canonicalPath!=='/'+a.handle+'/'+a.slug||
     o.apiPath!=='/api/public-portfolio?'+new URLSearchParams({handle:a.handle,slug:a.slug}).toString()||
     o.observedMediaManifest!==a.mediaManifest||!Array.isArray(a.assetHashes)||
     !Array.isArray(o.observedAssetHashes)||o.observedAssetHashes.length!==a.assetHashes.length||
     new Set(o.observedAssetHashes).size!==o.observedAssetHashes.length||
     ![...o.observedAssetHashes].every(sha=>(a.assetHashes as unknown[]).includes(sha)))
    throw Error('Public delivery receipt not verified.');
  const destination=new URL(host);
  const url=new URL(o.canonicalPath,destination);
  if(url.origin!==destination.origin)throw Error('Public route not verified.');
  return parseOwnerPublicDelivery({
    visibility:a.visibility,portfolioId:a.portfolioId,requestId:a.requestId,intentId:a.intentId,operationId:a.operationId,
    releaseGeneration:a.releaseGeneration,stageGeneration:a.stageGeneration,pointerGeneration:a.pointerGeneration,
    revocationGeneration:a.revocationGeneration,deliveryEpoch:a.deliveryEpoch,
    canonicalPath:o.canonicalPath,publicUrl:url.href,storedHtmlSha256:a.storedHtmlSha256,
    servedHtmlSha256:o.servedHtmlSha256,mediaManifest:a.mediaManifest,assetHashes:a.assetHashes,
    observedHttpRequests:o.observedHttpRequests,verifiedAt:a.verifiedAt
  },{portfolioId:consent.portfolioId,requestId:consent.requestId,intentId,operationId:a.operationId},
  destination.protocol==='http:'&&['localhost','127.0.0.1'].includes(destination.hostname));
}

export async function handleOwnerPublishRelease(request:Request,deps:Dependencies={}):Promise<Response> {
  const env=deps.env??serverEnv();
  if(env.KADMEION_RELEASE_WORKER_ENABLED!=='true')return error(404,'Not found');
  // Flags are deployment controls, not themselves proof of a verified host.
  if(env.KADMEION_RELEASE_HOST_APPROVED!=='true'||
     env.KADMEION_RELEASE_HOST_REVOCATION_VERIFIED!=='true')
    return error(503,'Release host not approved');
  const config=configuration(env),allowedOrigins=originList(env.KADMEION_ALLOWED_PUBLISH_ORIGINS);
  if(!config||!allowedOrigins)return error(503,'Release service unavailable');
  const origin=request.headers.get('origin')??undefined;
  const permitted=origin!==undefined&&allowedOrigins.has(origin);
  if(origin!==undefined&&!permitted)return error(403,'Forbidden');
  if(request.method==='OPTIONS')
    return permitted?new Response(null,{status:204,headers:headers(origin,true)}):
      error(403,'Forbidden');
  if(request.method!=='POST')return error(405,'Method not allowed',origin,permitted);
  const token=USER_JWT.exec(request.headers.get('authorization')??'')?.[1];
  if(!token||token.length>4096)return error(401,'Owner session required',origin,permitted);
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
    request.headers.get('content-type')??''))
    return error(415,'JSON required',origin,permitted);
  const encoding=request.headers.get('content-encoding');
  if(encoding&&encoding.toLowerCase()!=='identity')
    return error(415,'Uncompressed JSON required',origin,permitted);
  let data:unknown;
  try{data=await withPublishDeadline(signal=>bounded(request,MAX_REQUEST,signal));}
  catch{return error(400,'Invalid request',origin,permitted);}
  if(!record(data)||!Object.hasOwn(data,'intentId')||
     typeof data.intentId!=='string'||!UUID.test(data.intentId)||
     (Object.hasOwn(data,'action')
       ? Object.keys(data).length!==2||data.action!=='CHECK_PUBLIC'
       : Object.keys(data).length!==1))
    return error(400,'Invalid release intent',origin,permitted);
  const checkOnly=data.action==='CHECK_PUBLIC';
  const http=deps.http??fetch;
  const ownerHeaders={apikey:config.pub,Authorization:'Bearer '+token};
  const base=config.supabase;
  try{
    // Check the actual live Auth session before any service-role call.
    const who=await getJson(base+'/auth/v1/user',ownerHeaders,http);
    if(!record(who)||typeof who.id!=='string'||!UUID.test(who.id))
      return error(401,'Owner session required',origin,permitted);
    // RLS projects only this owner's consent, never another user's request.
    const path='/rest/v1/private_unlisted_publication_intents?select=id,portfolio_id,request_id,status,expires_at&id=eq.'+
      encodeURIComponent(data.intentId)+'&limit=2';
    const intents=await getJson(base+path,ownerHeaders,http);
    if(!Array.isArray(intents)||intents.length>1)
      return error(503,'Release consent cannot be verified',origin,permitted);
    if(intents.length===0)return error(404,'Release intent not found',origin,permitted);
    const intent=intents[0];
    if(!record(intent)||intent.id!==data.intentId||
       typeof intent.portfolio_id!=='string'||!UUID.test(intent.portfolio_id)||
       typeof intent.request_id!=='string'||!UUID.test(intent.request_id)||
       !['AWAITING_HOST','USED'].includes(String(intent.status))||
       typeof intent.expires_at!=='string'||!Number.isFinite(Date.parse(intent.expires_at)))
      return error(503,'Release consent cannot be verified',origin,permitted);
    if(intent.status==='AWAITING_HOST'&&Date.parse(intent.expires_at)<=Date.now())
      return error(409,'Release intent expired',origin,permitted);

    const frozenPath='/rest/v1/private_release_requests?select=id,portfolio_id,owner_user_id,visibility_intent,status&id=eq.'+
      encodeURIComponent(intent.request_id)+'&limit=2';
    const expectedConsent=boundFrozenPublicationConsent(who.id,intent,
      await getJson(base+frozenPath,ownerHeaders,http));
    if(checkOnly&&(intent.status!=='USED'||expectedConsent.visibility!=='PUBLIC'))
      return error(409,'Current public delivery unavailable',origin,permitted);

    const rpc=async(name:string,input:Record<string,unknown>):Promise<unknown>=>{
      if(!['service_prepare_unlisted_release','service_probe_unlisted_release',
           'service_activate_unlisted_release','service_acknowledge_unlisted_release',
           'service_recover_failed_unlisted_release'].includes(name))
        throw Error('Unknown release operation');
      return getJson(base+'/rest/v1/rpc/'+name,{
        apikey:config.secret,Authorization:'Bearer '+config.secret
      },http,input);
    };
    // This source is the paired C11 cutover candidate. Do not deploy it before
    // the service-only SQL receipt/epoch/ACK/recovery and legacy PUBLIC closure.
    // No browser-specified operation, no fallback on authority RPC failure.
    const publicAuthority:PublicAuthorityRpc=async(name,input)=>{
      if(!['service_read_current_public_delivery_receipt','service_acknowledge_public_delivery',
           'service_recover_failed_public_delivery'].includes(name))
        throw Error('Unknown public delivery operation');
      return getJson(base+'/rest/v1/rpc/'+name,{
        apikey:config.secret,Authorization:'Bearer '+config.secret
      },http,input);
    };
    const result=checkOnly
      ?await checkCurrentPublicDelivery(data.intentId,{origin:config.host,http,expectedConsent,publicAuthority})
      :deps.publish?await deps.publish(data.intentId,config.host,rpc)
      :await publishConsentedUnlistedRelease(data.intentId,{origin:config.host,
        rpc:rpc as Parameters<typeof publishConsentedUnlistedRelease>[1]['rpc'],http,
        requirePublicAliasProof:true,expectedConsent,publicAuthority});
    if(!record(result)||result.status!=='DELIVERY_ACKNOWLEDGED'||
       typeof result.htmlSha256!=='string'||!/^[0-9a-f]{64}$/.test(result.htmlSha256))
      return error(409,'Publication was not verified',origin,permitted);
    // PUBLIC cannot advertise success on a legacy acknowledgement alone.
    let ownerPublicDelivery:OwnerPublicDeliveryAcknowledgement|undefined;
    if(expectedConsent.visibility==='PUBLIC'){
      try{ownerPublicDelivery=ownerPublicAcknowledgement(result,expectedConsent,data.intentId,config.host);}
      catch{return error(409,'Publication was not verified',origin,permitted);}
    }
    return Response.json({status:'DELIVERY_ACKNOWLEDGED',
      htmlSha256:result.htmlSha256,
      ...(ownerPublicDelivery?{ownerPublicDelivery}:{}),
      hostRevocationVerified:false,providerRetentionVerified:false,
      accountDeletionAllowed:false},{status:200,headers:headers(origin,permitted)});
  }catch{
    // An activated-but-unverified release needs idempotent retry/recovery,
    // never a fabricated success or optimistic public URL.
    return error(503,'Release could not be verified',origin,permitted);
  }
}
export default {fetch:handleOwnerPublishRelease};

// The deployed Supabase/Deno runtime requires a registered HTTP handler.
// Node contract tests import this module without a Deno global.
const denoRuntime=(globalThis as unknown as {
  Deno?:{serve?:(handler:(request:Request)=>Promise<Response>)=>unknown}
}).Deno;
if(denoRuntime?.serve)denoRuntime.serve(handleOwnerPublishRelease);
