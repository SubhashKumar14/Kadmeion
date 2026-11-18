/** Local-only C12 orchestration. No environment or request can activate live egress.
 * Explicit server-owned dependencies are required, and real RPC/claim/finish/auth
 * adapters must be verified separately before enabling a deployed handler. */
import {parseProviderState,type ProviderState,type ProviderSyncInput} from '../../../packages/contracts/src/private-provider-facts-service.ts';

type Scope={ownerId:string;sessionId:string};
type Claim={status:'CLAIMED'|'REPLAYED'|'PENDING'|'LIMITED';state:ProviderState;attemptId:string|null;handle:string|null};
type Outcome='SUCCESS'|'NOT_FOUND'|'RATE_LIMITED'|'PROVIDER_UNAVAILABLE'|'INVALID_SOURCE'|'IDENTITY_CHANGED';
type Facts={login:string;providerId:number;htmlUrl:string;publicRepos:number;publicGists:number};
type Completion={scope:Scope;linkId:string;claimVersion:number;attemptId:string;outcome:Outcome;facts:Facts|null;retryAfter:string|null};
export type LocalProviderDependencies={mode:'ISOLATED_LOCAL';verifyOwner:(jwt:string,signal:AbortSignal)=>Promise<Scope|null>;claim:(scope:Scope,input:ProviderSyncInput,signal:AbortSignal)=>Promise<unknown>;finish:(completion:Completion,signal:AbortSignal)=>Promise<unknown>;provider:(handle:string,signal:AbortSignal)=>Promise<Response>;now:()=>number;allowedOrigins:readonly string[]};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HANDLE=/^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/;
const JWT=/^Bearer (eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v);
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const handle=(v:unknown):v is string=>typeof v==='string'&&v.length>=2&&v.length<=39&&HANDLE.test(v);
const headers=(origin?:string)=>({'Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin',...(origin?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type'}:{})});
const reply=(status:number,data:unknown,origin?:string)=>Response.json(data,{status,headers:headers(origin)});
class ProviderRpcRejection extends Error {
  readonly status:403|409;
  constructor(status:403|409){super('Provider operation rejected');this.status=status;}
}
const err=(status:number,origin?:string)=>reply(status,{error:status===401?'AUTH_EXPIRED':status===403?'FORBIDDEN':status===409?'CONFLICT':status===429?'RATE_LIMITED':status===400?'INVALID':status===404?'NOT_FOUND':'UNAVAILABLE'},origin);
function until<T>(promise:Promise<T>,ms:number,controller:AbortController):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  return Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('deadline'))},ms)})]).finally(()=>clearTimeout(timer));
}
async function bodyJson(response:Request|Response,cap:number,deadline:number,signal:AbortSignal):Promise<unknown>{
  const type=response.headers.get('content-type')??'',len=response.headers.get('content-length'),encoding=response.headers.get('content-encoding');
  if(!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(type)||!response.body||len!==null&&(!/^(?:0|[1-9]\d*)$/.test(len)||Number(len)>cap))throw Error('body');
  if(response instanceof Request&&encoding&&encoding.trim().toLowerCase()!=='identity')throw Error('encoding');
  const reader=response.body.getReader(),buffer=new Uint8Array(cap);let size=0;
  const cancel=()=>{try{void reader.cancel().catch(()=>{})}catch{}};
  signal.addEventListener('abort',cancel,{once:true});
  try{for(;;){if(signal.aborted||performance.now()>=deadline)throw Error('deadline');const part=await reader.read();if(signal.aborted||performance.now()>=deadline)throw Error('deadline');if(part.done)break;if(!(part.value instanceof Uint8Array)||part.value.length===0||part.value.length>cap-size)throw Error('body');buffer.set(part.value,size);size+=part.value.length}
    if(len!==null&&(!encoding||encoding.trim().toLowerCase()==='identity')&&size!==Number(len))throw Error('length');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size));
    // Strict lexical scanner: reject duplicate decoded keys; enforce exact
    // integer tokens for known request/source fields, not ignored provider keys.
    let i=0;const ws=()=>{while(i<text.length&&/\s/.test(text.charAt(i)))i++};
    const str=():string=>{const start=i++;while(i<text.length){const c=text[i++];if(c==='\\'){i++;continue}if(c==='"')return JSON.parse(text.slice(start,i))}throw Error('string')};
    const val=(depth:number,key?:string)=>{if(depth>32)throw Error('depth');ws();const c=text[i];if(c==='"'){str();return}if(c==='{'||c==='['){i++;ws();const end=c==='{'?'}':']',seen=new Set<string>();if(text[i]===end){i++;return}for(;;){ws();let name:string|undefined;if(c==='{'){if(text[i]!=='"')throw Error('key');name=str();if(seen.has(name))throw Error('duplicate');seen.add(name);ws();if(text[i++]!==':')throw Error('colon')}val(depth+1,name);ws();const sep=text[i++];if(sep===end)return;if(sep!==',')throw Error('separator')}}const start=i;while(i<text.length&&!/[\s,}\]]/.test(text.charAt(i)))i++;if(start===i)throw Error('value');const token=text.slice(start,i);if(key&&['expectedVersion','policyVersion','id','public_repos','public_gists','version','schemaVersion','publicRepos','publicGists'].includes(key)&&(!/^(?:0|[1-9]\d*)$/.test(token)||!Number.isSafeInteger(Number(token))))throw Error('number')};
    val(0);ws();if(i!==text.length)throw Error('trailing');return JSON.parse(text);
  }finally{signal.removeEventListener('abort',cancel);cancel();try{reader.releaseLock()}catch{}}
}
function input(v:unknown):ProviderSyncInput{
  if(!exact(v,['linkId','expectedVersion','operationId','action','policyVersion'])||!id(v.linkId)||!id(v.operationId)||!integer(v.expectedVersion)||v.expectedVersion>Number.MAX_SAFE_INTEGER-3||v.policyVersion!==1||(v.action!=='LOOKUP'&&v.action!=='SYNC'))throw Error('input');return v as ProviderSyncInput;
}
function claimReceipt(raw:unknown,scope:Scope,op:ProviderSyncInput):Claim{
  if(!exact(raw,['status','state','attemptId','handle'])||typeof raw.status!=='string'||!['CLAIMED','REPLAYED','PENDING','LIMITED'].includes(raw.status))throw Error('claim');
  const state=parseProviderState(raw.state,scope.ownerId,op.linkId),status=raw.status as Claim['status'];
  if(status==='CLAIMED'){if(!id(raw.attemptId)||!handle(raw.handle)||state.handle!==raw.handle||state.version!==op.expectedVersion+1||state.status!=='PENDING'||!state.consent||state.candidate!==null||(op.action==='SYNC'?!state.facts:state.facts!==null))throw Error('claim')}
  else if(raw.attemptId!==null||raw.handle!==null)throw Error('claim');
  if(status==='PENDING'&&(!state.consent||state.status!=='PENDING'||state.version!==op.expectedVersion+1))throw Error('claim');
  if(status==='REPLAYED'&&(!state.consent||state.version!==(state.status==='PENDING'?op.expectedVersion+1:op.expectedVersion+2)))throw Error('claim');
  return {status,state,attemptId:raw.attemptId as string|null,handle:raw.handle as string|null};
}
function publicFacts(raw:unknown,saved:string):Facts{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('source');const r=raw as Record<string,unknown>;
  if(!handle(r.login)||r.login.toLowerCase()!==saved.toLowerCase()||!integer(r.id)||r.id===0||!integer(r.public_repos)||!integer(r.public_gists)||r.html_url!=='https://github.com/'+r.login)throw Error('source');
  return {login:r.login,providerId:r.id,htmlUrl:r.html_url,publicRepos:r.public_repos,publicGists:r.public_gists};
}
function retryAfter(response:Response,now:number):string {
  // A missing/invalid rate header means at least one hour. Huge instructions
  // remain blocked for the maximum supported date instead of shortening.
  let end=now+3600000;const retry=response.headers.get('retry-after'),reset=response.headers.get('x-ratelimit-reset');
  if(retry&&/^\d{1,15}$/.test(retry))end=Math.max(end,now+Number(retry)*1000);
  else if(retry){const t=Date.parse(retry);if(Number.isFinite(t))end=Math.max(end,t)}
  if(reset&&/^\d{1,15}$/.test(reset))end=Math.max(end,Number(reset)*1000);
  return new Date(Math.min(end,253402300799000)).toISOString();
}
export async function handleSyncProviderFacts(request:Request,deps?:LocalProviderDependencies):Promise<Response>{
  if(!deps||deps.mode!=='ISOLATED_LOCAL'||deps.allowedOrigins.length>8)return err(404);
  const origin=request.headers.get('origin')??undefined;if(origin&&!deps.allowedOrigins.includes(origin))return err(403);
  if(request.method==='OPTIONS')return origin?new Response(null,{status:204,headers:headers(origin)}):err(403);
  if(request.method!=='POST')return err(400,origin);
  const jwt=JWT.exec(request.headers.get('authorization')??'')?.[1];if(!jwt||jwt.length>4096)return err(401,origin);
  const total=new AbortController(),deadline=performance.now()+15000;
  const check=()=>{if(total.signal.aborted||performance.now()>=deadline)throw Error('deadline')};
  const work=async()=>{
    let op:ProviderSyncInput|null=null,capability=false;
    try{const raw=await bodyJson(request,1024,deadline,total.signal);
      capability=exact(raw,['action','schemaVersion'])&&raw.action==='CAPABILITY'&&raw.schemaVersion===1;
      if(!capability)op=input(raw);
    }catch{return err(400,origin)}
    check();const scope=await deps.verifyOwner(jwt,total.signal);check();if(!scope||!id(scope.ownerId)||!id(scope.sessionId))return err(403,origin);
    // This proof means only an explicitly configured local handler is present.
    // It never grants consent, invokes claim/finish, or fetches a provider.
    if(capability)return reply(200,{schemaVersion:1,mode:'ISOLATED_LOCAL',ownerId:scope.ownerId},origin);
    if(op===null)return err(400,origin);
    const c=claimReceipt(await deps.claim(scope,op,total.signal),scope,op);check();
    if(c.status==='LIMITED')return err(429,origin);
    if(c.status!=='CLAIMED')return reply(200,{status:c.status,state:c.state},origin);
    const attempt=c.attemptId!,saved=c.handle!,fetchController=new AbortController(),sourceDeadline=Math.min(deadline,performance.now()+5000);
    type Result={outcome:Outcome;facts:Facts|null;retry:string|null};
    const bad=(outcome:Outcome,retry:string|null=null):Result=>({outcome,facts:null,retry});
    const abortSource=()=>fetchController.abort();total.signal.addEventListener('abort',abortSource,{once:true});
    let sourceResult:Result;
    try{sourceResult=await until((async():Promise<Result>=>{
      const response=await deps.provider(saved,fetchController.signal);
      if(!(response instanceof Response))return bad('INVALID_SOURCE');
      if(fetchController.signal.aborted){void response.body?.cancel().catch(()=>{});return bad('PROVIDER_UNAVAILABLE')}
      if(response.redirected||(response.url!=='https://api.github.com/users/'+encodeURIComponent(saved)&&!(response.url===''&&response.type==='default'))){void response.body?.cancel().catch(()=>{});return bad('INVALID_SOURCE')}
      if(!response.ok){void response.body?.cancel().catch(()=>{});if(response.status===404)return bad('NOT_FOUND');if(response.status===403||response.status===429)return bad('RATE_LIMITED',retryAfter(response,deps.now()));return bad('PROVIDER_UNAVAILABLE')}
      try{const source=publicFacts(await bodyJson(response,65536,sourceDeadline,fetchController.signal),saved);if(op.action==='SYNC'&&source.providerId!==c.state.facts?.id)return bad('IDENTITY_CHANGED');return {outcome:'SUCCESS',facts:source,retry:null}}catch{return bad(fetchController.signal.aborted?'PROVIDER_UNAVAILABLE':'INVALID_SOURCE')}
    })(),Math.max(1,sourceDeadline-performance.now()),fetchController)}catch{sourceResult=bad('PROVIDER_UNAVAILABLE')}
    finally{fetchController.abort();total.signal.removeEventListener('abort',abortSource)}
    const {outcome,facts,retry}=sourceResult;
    check();const result=await deps.finish({scope,linkId:op.linkId,claimVersion:c.state.version,attemptId:attempt,outcome,facts,retryAfter:retry},total.signal);check();
    if(!exact(result,['status','state'])||result.status!=='APPLIED')return err(409,origin);
    const s=parseProviderState(result.state,scope.ownerId,op.linkId);
    if(s.version!==c.state.version+1||!s.consent||s.handle!==saved||s.status==='PENDING')return err(409,origin);
    const matches=(snapshot:ProviderState['facts'],value:Facts|null)=>!!snapshot&&!!value&&snapshot.login===value.login&&snapshot.id===value.providerId&&snapshot.htmlUrl===value.htmlUrl&&snapshot.publicRepos===value.publicRepos&&snapshot.publicGists===value.publicGists;
    if(outcome==='SUCCESS'&&(op.action==='LOOKUP'?(s.status!=='AWAITING_CONFIRMATION'||!matches(s.candidate,facts)||s.facts!==null):(s.status!=='SYNCED'||!matches(s.facts,facts)||s.candidate!==null)))return err(409,origin);
    if(outcome!=='SUCCESS'&&(s.status!=='UNAVAILABLE'||s.lastError!==outcome||s.candidate!==null||JSON.stringify(s.facts)!==JSON.stringify(c.state.facts)))return err(409,origin);
    return reply(200,{status:'APPLIED',state:s},origin);
  };
  try{return await until(work(),15000,total)}catch(error){return err(error instanceof ProviderRpcRejection?error.status:503,origin)}finally{total.abort()}
}
/** Fixed public GitHub source transport. Explicit server-owned injection only;
 * this factory never activates the default Edge entrypoint or transfers owner credentials.
 * A committed claim must precede invocation by handleSyncProviderFacts. */
export function createGitHubPublicSource(http:typeof fetch):LocalProviderDependencies['provider'] {
  if(typeof http!=='function'||http===globalThis.fetch)throw Error('Explicit source transport required');
  return async(saved,signal)=>{
    if(!handle(saved)||signal.aborted)throw Error('Source unavailable');
    return http('https://api.github.com/users/'+encodeURIComponent(saved),{
      method:'GET',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'Kadmeion'},
      signal,credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer'
    });
  };
}
/** Explicit local stack bridge. Auth validates the exact JWT via /user before
 * its session_id is used. The service key is confined to fixed RPC paths;
 * it is never provided to the separate source callback. No ambient fetch. */
export function createLocalProviderDependencies(config:{origin:string;publishable:string;serviceRole:string;http:typeof fetch;provider:LocalProviderDependencies['provider'];now:()=>number;allowedOrigins:readonly string[]}):LocalProviderDependencies {
  const endpoint=new URL(config.origin);
  if(!['http://127.0.0.1:54321','http://localhost:54321','http://kong:8000'].includes(endpoint.origin)||endpoint.pathname!=='/'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!config.http||config.http===globalThis.fetch||config.publishable===config.serviceRole||config.allowedOrigins.length>8)throw Error('Invalid local configuration');
  const {serviceRole,publishable,http,provider,now}=config;
  const allowedOrigins=Object.freeze([...config.allowedOrigins]);
  for(const origin of allowedOrigins){const u=new URL(origin);if(u.origin!==origin||!['http:','https:'].includes(u.protocol)||!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw Error('Invalid local browser origin');}
  const claims=(token:string):Record<string,unknown>=>{if(token.length>8192||!JWT.test('Bearer '+token))throw Error('token');const encoded=token.split('.')[1];if(!encoded)throw Error('token');const payload=JSON.parse(atob(encoded.replace(/-/g,'+').replace(/_/g,'/')));if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('token');return payload};
  if(claims(serviceRole).role!=='service_role'||!(/^sb_publishable_[A-Za-z0-9_-]{8,200}$/.test(publishable)||claims(publishable).role==='anon'))throw Error('Invalid local configuration');
  const rpc=async(name:'service_claim_github_provider_sync'|'service_finish_github_provider_sync',args:Record<string,unknown>,signal:AbortSignal)=>{
    const url=endpoint.origin+'/rest/v1/rpc/'+name;
    const response=await http(url,{method:'POST',headers:{apikey:serviceRole,Authorization:'Bearer '+serviceRole,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(args),credentials:'omit',redirect:'error',cache:'no-store',signal});
    if(response.redirected||(response.url!==url&&!(response.url===''&&response.type==='default'))){void response.body?.cancel().catch(()=>{});throw Error('rpc unavailable')}
    if(!response.ok){
      // Only an exact own-RPC rejection is actionable; all other failures
      // remain uncertain, with no forwarded database details or retry.
      if(response.status===409||response.status===403||response.status===500){
        const failure=await bodyJson(response,16384,performance.now()+15000,signal);
        if(exact(failure,['code','message','details','hint'])&&failure.details===null&&failure.hint===null){
          if((response.status===409&&failure.code==='PT409'||response.status===500&&failure.code==='40001')&&failure.message==='CONFLICT')throw new ProviderRpcRejection(409);
          if(response.status===403&&failure.code==='42501'&&failure.message==='OWNER_DENIED')throw new ProviderRpcRejection(403);
        }
      }else void response.body?.cancel().catch(()=>{});
      throw Error('rpc unavailable');
    }
    return bodyJson(response,16384,performance.now()+15000,signal);
  };
  return {mode:'ISOLATED_LOCAL',allowedOrigins,now:now,provider:provider,
    verifyOwner:async(jwt,signal)=>{
      const url=endpoint.origin+'/auth/v1/user';
      const response=await http(url,{method:'GET',headers:{apikey:publishable,Authorization:'Bearer '+jwt,Accept:'application/json'},cache:'no-store',credentials:'omit',redirect:'error',signal});
      if(response.redirected||(response.url!==url&&!(response.url===''&&response.type==='default'))||!response.ok){void response.body?.cancel().catch(()=>{});return null}
      const raw=await bodyJson(response,65536,performance.now()+15000,signal),c=claims(jwt);
      if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;const user=raw as Record<string,unknown>;
      if(c.role!=='authenticated'||c.is_anonymous===true||user.is_anonymous===true||!id(c.sub)||!id(c.session_id)||user.id!==c.sub)return null;
      return {ownerId:c.sub,sessionId:c.session_id};
    },
    claim:(scope,input,signal)=>rpc('service_claim_github_provider_sync',{p_owner_id:scope.ownerId,p_session_id:scope.sessionId,p_link_id:input.linkId,p_action:input.action,p_expected_version:input.expectedVersion,p_operation_id:input.operationId,p_policy_version:1},signal),
    finish:(c,signal)=>rpc('service_finish_github_provider_sync',{p_owner_id:c.scope.ownerId,p_session_id:c.scope.sessionId,p_link_id:c.linkId,p_claim_version:c.claimVersion,p_attempt_id:c.attemptId,p_outcome:c.outcome,p_login:c.facts?.login??null,p_provider_id:c.facts?.providerId??null,p_html_url:c.facts?.htmlUrl??null,p_public_repos:c.facts?.publicRepos??null,p_public_gists:c.facts?.publicGists??null,p_retry_after:c.retryAfter},signal)
  };
}

/** Bind a real local Edge handler to explicitly configured, server-owned Auth/RPC
 * and source dependencies. The browser cannot configure this factory. */
export function createLocalProviderHandler(config:Parameters<typeof createLocalProviderDependencies>[0]):(request:Request)=>Promise<Response>{
  const dependencies=createLocalProviderDependencies(config);
  return request=>handleSyncProviderFacts(request,dependencies);
}

// No ambient fetch or env-flag path exists. The deployment entrypoint stays OFF.
const disabledEntry=(request:Request)=>handleSyncProviderFacts(request);
export default {fetch:disabledEntry};

// Register the runtime entrypoint without granting egress. A disposable-stack
// harness imports createLocalProviderHandler with real Auth/RPC transport and
// explicit synthetic source input; a hosted activation needs separate approval.
const denoRuntime=(globalThis as unknown as {
  Deno?:{serve?:(handler:(request:Request)=>Promise<Response>)=>unknown}
}).Deno;
if(denoRuntime?.serve)denoRuntime.serve(disabledEntry);
