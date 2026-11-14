/**
 * B4 owner-authorized publication entry point. Disabled until an owner-approved
 * host passes independent revocation and cost proofs. No public writes on import.
 * Privileged RPCs are invoked only AFTER a live owner JWT and owner-RLS consent.
 */
import {publishConsentedUnlistedRelease} from '../../../packages/storage-adapters/src/unlisted-release-verification.ts';

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
async function bounded(request:Request|Response,limit:number):Promise<unknown> {
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>limit))
    throw Error('Response too large');
  const reader=request.body?.getReader();
  if(!reader)throw Error('Missing body');
  const chunks:Uint8Array[]=[];
  let size=0;
  try{
    for(;;){
      const next=await reader.read();
      if(next.done)break;
      if(!(next.value instanceof Uint8Array))throw Error('Invalid stream');
      size+=next.value.byteLength;
      if(size>limit){await reader.cancel();throw Error('Response too large');}
      chunks.push(next.value);
    }
  }finally{reader.releaseLock();}
  if(length!==null&&Number(length)!==size)throw Error('Invalid response length');
  const bytes=new Uint8Array(size);let offset=0;
  for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
async function getJson(url:string,headers:Record<string,string>,http:typeof fetch,
                       body?:Record<string,unknown>):Promise<unknown> {
  const response=await http(url,{
    method:body?'POST':'GET',headers:{
      ...headers,Accept:'application/json',
      ...(body?{'Content-Type':'application/json'}:{})
    },
    body:body?JSON.stringify(body):undefined,
    credentials:'omit',cache:'no-store',redirect:'error',
    signal:AbortSignal.timeout(10_000)
  });
  if(!response.ok){
    await response.body?.cancel();
    throw Error('Private provider rejected request');
  }
  if(!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:;|$)/i.test(
    response.headers.get('content-type')??'')){
    await response.body?.cancel();
    throw Error('Invalid provider media type');
  }
  return bounded(response,MAX_RPC_BYTES);
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
  let data:unknown;
  try{data=await bounded(request,MAX_REQUEST);}
  catch{return error(400,'Invalid request',origin,permitted);}
  if(!record(data)||Object.keys(data).length!==1||!Object.hasOwn(data,'intentId')||
     typeof data.intentId!=='string'||!UUID.test(data.intentId))
    return error(400,'Invalid release intent',origin,permitted);
  const http=deps.http??fetch;
  const ownerHeaders={apikey:config.pub,Authorization:'Bearer '+token};
  const base=config.supabase;
  try{
    // Check the actual live Auth session before any service-role call.
    const who=await getJson(base+'/auth/v1/user',ownerHeaders,http);
    if(!record(who)||typeof who.id!=='string'||!UUID.test(who.id))
      return error(401,'Owner session required',origin,permitted);
    // RLS projects only this owner's consent, never another user's request.
    const path='/rest/v1/private_unlisted_publication_intents?select=id,portfolio_id,status,expires_at&id=eq.'+
      encodeURIComponent(data.intentId)+'&limit=2';
    const intents=await getJson(base+path,ownerHeaders,http);
    if(!Array.isArray(intents)||intents.length>1)
      return error(503,'Release consent cannot be verified',origin,permitted);
    if(intents.length===0)return error(404,'Release intent not found',origin,permitted);
    const intent=intents[0];
    if(!record(intent)||intent.id!==data.intentId||
       typeof intent.portfolio_id!=='string'||!UUID.test(intent.portfolio_id)||
       !['AWAITING_HOST','USED'].includes(String(intent.status))||
       typeof intent.expires_at!=='string'||!Number.isFinite(Date.parse(intent.expires_at)))
      return error(503,'Release consent cannot be verified',origin,permitted);
    if(intent.status==='AWAITING_HOST'&&Date.parse(intent.expires_at)<=Date.now())
      return error(409,'Release intent expired',origin,permitted);

    const rpc=async(name:string,input:Record<string,unknown>):Promise<unknown>=>{
      if(!['service_prepare_unlisted_release','service_probe_unlisted_release',
           'service_activate_unlisted_release','service_acknowledge_unlisted_release',
           'service_recover_failed_unlisted_release'].includes(name))
        throw Error('Unknown release operation');
      return getJson(base+'/rest/v1/rpc/'+name,{
        apikey:config.secret,Authorization:'Bearer '+config.secret
      },http,input);
    };
    const result=deps.publish
      ?await deps.publish(data.intentId,config.host,rpc)
      :await publishConsentedUnlistedRelease(data.intentId,{origin:config.host,
        rpc:rpc as Parameters<typeof publishConsentedUnlistedRelease>[1]['rpc'],http});
    if(!record(result)||result.status!=='DELIVERY_ACKNOWLEDGED'||
       typeof result.htmlSha256!=='string'||!/^[0-9a-f]{64}$/.test(result.htmlSha256))
      return error(409,'Publication was not verified',origin,permitted);
    return Response.json({status:'DELIVERY_ACKNOWLEDGED',
      htmlSha256:result.htmlSha256,
      hostRevocationVerified:false,providerRetentionVerified:false,
      accountDeletionAllowed:false},{status:200,headers:headers(origin,permitted)});
  }catch{
    // An activated-but-unverified release needs idempotent retry/recovery,
    // never a fabricated success or optimistic public URL.
    return error(503,'Release could not be verified',origin,permitted);
  }
}
export default {fetch:handleOwnerPublishRelease};
