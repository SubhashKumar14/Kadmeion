/**
 * Owner-authenticated and default-disabled B5 registration completion.
 *
 * The handler uses the owner's JWT for all Auth, project, and Storage reads.
 * Service-role privileges are used ONLY inside the pre-existing trusted
 * attestor to submit a server-computed, write-once content SHA-256 to its RPC.
 * A browser never receives the service credential, bytes, or hash.
 *
 * Supabase config.toml MUST keep verify_jwt=true for this function.
 */
import {PrivateServerAssetByteAttestor} from '../../../packages/storage-adapters/src/private-server-asset-byte-attestor.ts';
import {completePrivateAssetRegistration} from '../../../packages/storage-adapters/src/private-asset-registration-completion.ts';

type Env = Readonly<Record<string,string|undefined>>;
type Attest = (assetId:string, jwt:string) => Promise<unknown>;
type Dependencies = {env?:Env;http?:typeof fetch;attest?:Attest};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER_JWT=/^Bearer (eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const MAX_REQUEST_BYTES=160;
const MAX_ORIGINS=8;
const json=(status:number,message:string,origin?:string,allowed=false):Response=>
  Response.json({error:message},{status,headers:headers(origin,allowed)});
function headers(origin?:string,allowed=false):Headers {
  const h=new Headers({
    'Cache-Control':'private, no-store, max-age=0',
    'CDN-Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer',
    'Vary':'Origin'
  });
  if(allowed&&origin){
    h.set('Access-Control-Allow-Origin',origin);
    h.set('Access-Control-Allow-Methods','POST, OPTIONS');
    h.set('Access-Control-Allow-Headers','authorization, apikey, content-type, x-client-info');
    h.set('Access-Control-Max-Age','60');
  }
  return h;
}
function serverEnv():Env {
  // Read only on request. Tests do not need a Deno runtime.
  const environment=(globalThis as unknown as {
    Deno?:{env?:{get:(name:string)=>string|undefined}}
  }).Deno?.env;
  if(!environment)return {};
  const names=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY','KADMEION_LOCAL_INTEGRATION',
    'KADMEION_ASSET_ATTESTATION_ENABLED','KADMEION_ALLOWED_ATTEST_ORIGINS'];
  return Object.fromEntries(names.map(name=>[name,environment.get(name)]));
}
function configured(env:Env):{endpoint:string;publishable:string;service:string}|null {
  try{
    const url=new URL(env.SUPABASE_URL??'');
    const local=url.origin==='http://127.0.0.1:54321'&&env.KADMEION_LOCAL_INTEGRATION==='1';
    if(url.origin!=='https://scyooqjitjzjdxgtanso.supabase.co'&&!local)return null;
    if(url.username||url.password||url.pathname!=='/'||url.search||url.hash)return null;
    const publishable=env.SUPABASE_PUBLISHABLE_KEY??env.SUPABASE_ANON_KEY;
    const service=env.SUPABASE_SERVICE_ROLE_KEY;
    // Existing server-side legacy service-role JWT RPC. New sb_secret keys need
    // a separately verified implementation; do not send them as a bearer JWT.
    if(typeof publishable!=='string'||publishable.length<20||
       typeof service!=='string'||!service.startsWith('eyJ')||
       service.length<70||service===publishable)return null;
    return {endpoint:url.origin,publishable,service};
  }catch{return null;}
}
function origins(raw:string|undefined):Set<string>|null {
  if(typeof raw!=='string'||raw.length<1||raw.length>1024)return null;
  const parts=raw.split(',');
  if(parts.length>MAX_ORIGINS)return null;
  const allowed=new Set<string>();
  for(const part of parts) {
    try{
      if(!part||part!==part.trim()||part==='*')return null;
      const u=new URL(part);
      if(u.username||u.password||u.pathname!=='/'||u.search||u.hash||
         !((u.protocol==='https:'&&u.hostname.includes('.'))||
           (u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))))
        return null;
      if(u.origin!==part && u.origin+'/'!==part)return null;
      allowed.add(u.origin);
    }catch{return null;}
  }
  return allowed.size===parts.length?allowed:null;
}
async function boundedRequest(request:Request):Promise<unknown> {
  if(!request.body)throw Error('Missing body');
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^\d{1,3}$/.test(length)||Number(length)>MAX_REQUEST_BYTES))
    throw Error('Body limit');
  const reader=request.body.getReader();
  const parts:Uint8Array[]=[];let size=0;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      if(!(value instanceof Uint8Array))throw Error('Invalid body');
      size+=value.byteLength;
      if(size>MAX_REQUEST_BYTES){await reader.cancel();throw Error('Body limit');}
      parts.push(value);
    }
  }finally{reader.releaseLock();}
  if(length!==null&&Number(length)!==size)throw Error('Body length');
  const buf=new Uint8Array(size);let offset=0;
  for(const part of parts){buf.set(part,offset);offset+=part.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buf));
}
export async function handleCompletePrivateAsset(request:Request,deps:Dependencies={}):Promise<Response> {
  const env=deps.env??serverEnv();
  if(env.KADMEION_ASSET_ATTESTATION_ENABLED!=='true')
    return json(404,'Not found');
  const config=configured(env), allowlist=origins(env.KADMEION_ALLOWED_ATTEST_ORIGINS);
  if(!config||!allowlist)return json(503,'Attestation unavailable');
  const origin=request.headers.get('origin')??undefined;
  const allowed=origin!==undefined&&allowlist.has(origin);
  if(origin!==undefined&&!allowed)return json(403,'Forbidden');
  if(request.method==='OPTIONS'){
    if(!allowed)return json(403,'Forbidden');
    return new Response(null,{status:204,headers:headers(origin,true)});
  }
  if(request.method!=='POST'){
    const response=json(405,'Method not allowed',origin,allowed);
    response.headers.set('Allow','POST, OPTIONS');return response;
  }
  const authorization=request.headers.get('authorization')??'';
  const token=USER_JWT.exec(authorization)?.[1];
  if(!token||token.length>4096)return json(401,'Unauthorized',origin,allowed);
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
    request.headers.get('content-type')??''))
    return json(415,'JSON required',origin,allowed);
  let data:unknown;
  try{data=await boundedRequest(request);}
  catch{return json(400,'Invalid request',origin,allowed);}
  if(!data||typeof data!=='object'||Array.isArray(data)||
     Object.keys(data).length!==1||!Object.hasOwn(data,'assetId')||
     typeof (data as {assetId:unknown}).assetId!=='string'||
     !UUID.test((data as {assetId:string}).assetId))
    return json(400,'Invalid asset',origin,allowed);
  const assetId=(data as {assetId:string}).assetId;
  try{
    const attest:Attest=deps.attest??(async(id,jwt)=>{
      const worker=new PrivateServerAssetByteAttestor(
        config.endpoint,config.publishable,config.service,deps.http??fetch);
      return worker.attest(id,jwt);
    });
    // This routine checks the committed owner registration, Storage version,
    // byte stream, live Auth token and trusted immutable SHA-256 receipt.
    const result=await completePrivateAssetRegistration({attest:attest as
      (assetId:string,ownerJwt:string)=>Promise<{assetId:string;status:'WRITE_ONCE_ATTESTED'}>},
      {assetId,ownerJwt:token});
    return Response.json(result,{status:200,headers:headers(origin,allowed)});
  }catch(error){
    // Never echo provider messages, object paths, user details or secrets.
    const kind=(error as {code?:unknown})?.code;
    const status=kind==='VALIDATION'?400:kind==='AUTH'?403:
      kind==='LIMIT'?413:kind==='INTEGRITY'?409:503;
    return json(status,status===503?'Attestation unavailable':'Attestation denied',origin,allowed);
  }
}
export default {fetch:handleCompletePrivateAsset};
