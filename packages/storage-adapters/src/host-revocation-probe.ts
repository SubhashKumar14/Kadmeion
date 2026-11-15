import {createHash} from 'node:crypto';
import {HANDLE_PATTERN,RESERVED_HANDLES} from '../../contracts/src/project.ts';

/**
 * Host-neutral B4 external HTTP revocation probe. Server/test harness only.
 * Never authorizes, revokes or publishes data. Observes actual configured
 * canonical and direct paths; cannot prove cache/archive erasure worldwide.
 */
export interface HostRevocationProbeInput {
  origin:string;
  canonicalPath:string;
  candidateDirectPaths:readonly string[];
  /** Only isolated local integration hosts may use HTTP loopback. */
  allowLocal?:boolean;
}
export interface ReleaseWithdrawalInput extends HostRevocationProbeInput {
  /** Exact public PNGs in the trusted release manifest, including every serving alias. */
  liveAssets?: readonly {path:string;sha256:string}[];
}
export interface HostRevocationObservation {
  status:'OBSERVED_REVOKED_ON_SCOPED_PATHS';
  canonicalPath:string;
  observedHttpRequests:number;
  directPathsChecked:number;
  universalCacheErasureVerified:false;
  thirdPartyArchiveErasureVerified:false;
}
export class HostRevocationProbeError extends Error {
  readonly code:'INVALID_INPUT'|'HOST_UNAVAILABLE'|'STILL_VISIBLE'|'UNSAFE_HEADERS'|'UNSAFE_BODY'|'RELEASE_NOT_OBSERVED';
  constructor(code:HostRevocationProbeError['code']){
    super('External release revocation could not be verified: '+code);
    this.name='HostRevocationProbeError';this.code=code;
  }
}
const SHA256=/^[a-f0-9]{64}$/;
const PNG_PATH=/\/([a-f0-9]{64})\.png$/;
const CACHE_HEADERS=['cache-control','cdn-cache-control','vercel-cdn-cache-control','surrogate-control'];
function isUncacheable(headers:Headers):boolean {
  return CACHE_HEADERS.every((name)=>{
    const value=headers.get(name);
    if(value===null)return name!=='cache-control';
    const directives=value.toLowerCase().split(',').map(directive=>directive.trim());
    return directives.includes('no-store')&&!directives.includes('public')&&
      directives.every(directive=>!/^(?:s?max-age|stale-while-revalidate|stale-if-error)\s*=/.test(directive)||
        /^(?:s?max-age|stale-while-revalidate|stale-if-error)\s*=\s*(?:0|"0")$/.test(directive));
  });
}

const DIRECT=/^\/[a-zA-Z0-9._/-]{1,512}$/;
const PORTFOLIO_SLUG=/^(?=.{3,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UNLISTED=/^\/api\/unlisted\?portfolioId=[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function trustedOrigin(origin:string,local:boolean):URL {
  let u:URL;
  try{u=new URL(origin);}catch{throw new HostRevocationProbeError('INVALID_INPUT');}
  const loopback=['127.0.0.1','localhost'].includes(u.hostname);
  if(u.username||u.password||u.pathname!=='/'||u.search||u.hash||
     !((u.protocol==='https:'&&u.hostname.includes('.')&&!loopback&&
        !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(u.hostname)&&
        !/(?:\.local|\.internal|\.test|\.invalid)$/.test(u.hostname))||
       (local&&u.protocol==='http:'&&loopback)))
    throw new HostRevocationProbeError('INVALID_INPUT');
  return u;
}
function scopedMediaSha(path:string,canonicalPath:string):string|undefined {
  const publicRoute=canonicalPath.split('/');
  const unlisted=UNLISTED.test(canonicalPath);
  const scope=unlisted?canonicalPath:'/api/public-portfolio?'+
    new URLSearchParams({handle:publicRoute[1],slug:publicRoute[2]});
  if(!path.startsWith(scope+'&manifest='))return undefined;
  return /^&manifest=[a-f0-9]{64}&asset=([a-f0-9]{64})$/.exec(path.slice(scope.length))?.[1];
}
function pathValid(path:string,canonicalPath:string):boolean {
  if(typeof path!=='string'||path.includes('//')||path.includes('..')||
     path.includes('%')||path.includes('\\')||path.includes('#')||
     path.includes('@')||path.split('/').includes('.'))return false;
  return DIRECT.test(path)||scopedMediaSha(path,canonicalPath)!==undefined;
}
function validatedOrigin(input:HostRevocationProbeInput):URL {
  if(!input||!Array.isArray(input.candidateDirectPaths)||
     input.candidateDirectPaths.length<1||input.candidateDirectPaths.length>12||
     !canonicalPathValid(input.canonicalPath)||
     input.candidateDirectPaths.some(path=>!pathValid(path,input.canonicalPath)||path===input.canonicalPath)||
     new Set(input.candidateDirectPaths).size!==input.candidateDirectPaths.length)
    throw new HostRevocationProbeError('INVALID_INPUT');
  return trustedOrigin(input.origin,input.allowLocal===true);
}

async function fetchPath(url:URL,method:'GET'|'HEAD',http:typeof fetch):Promise<Response>{
  try{
    return await http(url,{method,credentials:'omit',cache:'no-store',redirect:'error',
      signal:AbortSignal.timeout(5000)});
  }catch{throw new HostRevocationProbeError('HOST_UNAVAILABLE');}
}
function canonicalPathValid(path:unknown):boolean {
  if(typeof path!=='string')return false;
  if(UNLISTED.test(path))return true;
  const [root,handle,slug,...rest]=path.split('/');
  return root===''&&rest.length===0&&HANDLE_PATTERN.test(handle??'')&&
    !RESERVED_HANDLES.has(handle)&&PORTFOLIO_SLUG.test(slug??'');
}
async function verifyDenied(response:Response,method:'GET'|'HEAD'):Promise<void> {
  if(response.status!==404&&response.status!==410){
    await response.body?.cancel();
    throw new HostRevocationProbeError('STILL_VISIBLE');
  }
  const h=response.headers;
  if(response.redirected||!isUncacheable(h)||
     !/(?:^|,)\s*noindex\s*(?:,|$)/i.test(h.get('x-robots-tag')??'')||
     h.has('location')||h.has('etag')||
     !/^text\/plain(?:;|$)/i.test(h.get('content-type')??'')){
    await response.body?.cancel();
    throw new HostRevocationProbeError('UNSAFE_HEADERS');
  }
  if(method==='HEAD'){
    if(response.body){
      const reader=response.body.getReader();
      try{
        const first=await reader.read();
        if(!first.done&&first.value?.byteLength)
          throw new HostRevocationProbeError('UNSAFE_BODY');
      }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    }
    return;
  }
  const reader=response.body?.getReader();
  if(!reader)throw new HostRevocationProbeError('UNSAFE_BODY');
  let size=0;
  const chunks:Uint8Array[]=[];
  try{
    for(;;){
      const next=await reader.read();
      if(next.done)break;
      if(!(next.value instanceof Uint8Array))throw new HostRevocationProbeError('UNSAFE_BODY');
      size+=next.value.byteLength;
      if(size>4096)throw new HostRevocationProbeError('UNSAFE_BODY');
      chunks.push(next.value);
    }
    // Require an expected generic denial, even when the body is delivered in chunks.
    const content=new Uint8Array(size);
    let offset=0;
    for(const chunk of chunks){content.set(chunk,offset);offset+=chunk.byteLength;}
    const text=new TextDecoder('utf-8',{fatal:true}).decode(content).trim();
    if(text!==''&&text!==(response.status===404?'Not found':'Gone'))
      throw new HostRevocationProbeError('UNSAFE_BODY');
  }catch{
    throw new HostRevocationProbeError('UNSAFE_BODY');
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function probeHostRevocation(
  input:HostRevocationProbeInput,http:typeof fetch=fetch
):Promise<HostRevocationObservation>{
  const origin=validatedOrigin(input);
  let count=0;
  for(const path of [input.canonicalPath,...input.candidateDirectPaths]){
    for(const method of ['GET','HEAD'] as const){
      const response=await fetchPath(new URL(path,origin),method,http);
      await verifyDenied(response,method);
      count++;
    }
  }
  return Object.freeze({
    status:'OBSERVED_REVOKED_ON_SCOPED_PATHS' as const,
    canonicalPath:input.canonicalPath,
    observedHttpRequests:count,
    directPathsChecked:input.candidateDirectPaths.length,
    universalCacheErasureVerified:false as const,
    thirdPartyArchiveErasureVerified:false as const
  });
}

async function verifyLiveBytes(
  response:Response, mime:RegExp, maxBytes:number, expectedDigest:string
):Promise<void> {
  const reader=response.body?.getReader();
  if(!reader)throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
  try {
    if(response.status!==200||response.redirected||response.headers.has('location')||
       !mime.test(response.headers.get('content-type')??'')||!isUncacheable(response.headers))
      throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
    const digest=createHash('sha256');
    let size=0;
    for(;;){
      const chunk=await reader.read();
      if(chunk.done)break;
      size+=chunk.value.byteLength;
      if(size>maxBytes)throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
      digest.update(chunk.value);
    }
    if(size===0||digest.digest('hex')!==expectedDigest)
      throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
  } catch {
    throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
  } finally {
    await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}

/** Verify the canonical HTML and manifest media before withdrawing, then check all listed paths for denial. */
export async function verifyReleaseWithdrawal(
  input:ReleaseWithdrawalInput,expectedServedSha256:string,
  withdraw:()=>Promise<void>,http:typeof fetch=fetch
):Promise<HostRevocationObservation & {liveAssetPathsVerified:number}>{
  const origin=validatedOrigin(input);
  if(typeof expectedServedSha256!=='string'||!SHA256.test(expectedServedSha256)||
     typeof withdraw!=='function')throw new HostRevocationProbeError('INVALID_INPUT');
  const assets=input.liveAssets===undefined?[]:input.liveAssets;
  if(!Array.isArray(assets)||assets.length>12)
    throw new HostRevocationProbeError('INVALID_INPUT');
  const paths={...input,origin:origin.origin,candidateDirectPaths:[...input.candidateDirectPaths]};
  const liveAssets=new Map<string,string>();
  for(const asset of assets){
    if(!asset||typeof asset.path!=='string'||typeof asset.sha256!=='string'||
       !pathValid(asset.path,paths.canonicalPath)||
       (PNG_PATH.exec(asset.path)?.[1]??scopedMediaSha(asset.path,paths.canonicalPath))!==asset.sha256||
       liveAssets.has(asset.path)||!paths.candidateDirectPaths.includes(asset.path))
      throw new HostRevocationProbeError('INVALID_INPUT');
    liveAssets.set(asset.path,asset.sha256);
  }

  const html=await fetchPath(new URL(paths.canonicalPath,origin),'GET',http);
  await verifyLiveBytes(html,/^text\/html(?:;|$)/i,750_000,expectedServedSha256);
  for(const [path,sha256] of liveAssets){
    const image=await fetchPath(new URL(path,origin),'GET',http);
    await verifyLiveBytes(image,/^image\/png$/i,5*1024*1024,sha256);
  }
  await withdraw();
  const after=await probeHostRevocation(paths,http);
  return Object.freeze({...after,liveAssetPathsVerified:liveAssets.size,
    observedHttpRequests:after.observedHttpRequests+1+liveAssets.size});
}

const PORTFOLIO_ASSET_QUERY=/^\/api\/public-portfolio\?handle=([a-z][a-z0-9_]{2,29})&slug=([a-z0-9-]{3,64})(?:&manifest=[a-f0-9]{64}&asset=[a-f0-9]{64})?$/;
const IDENTITY_QUERY=/^\/api\/published-identity\?handle=([a-z][a-z0-9_]{2,29})(?:&slug=([a-z0-9-]{3,64}))?$/;
const IDENTITY_PATH=/^\/u\/([a-z][a-z0-9_]{2,29})(?:\/projects\/([a-z0-9-]{3,64}))?$/;
const UNLISTED_ASSET_SUFFIX=/&manifest=[a-f0-9]{64}&asset=[a-f0-9]{64}$/;
const REQUEST_UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function accountExitPath(path:unknown):path is string {
  if(typeof path!=='string'||path.length>512)return false;
  if(canonicalPathValid(path)||UNLISTED.test(path.replace(UNLISTED_ASSET_SUFFIX,'')))return true;
  const match=PORTFOLIO_ASSET_QUERY.exec(path)??IDENTITY_QUERY.exec(path)??IDENTITY_PATH.exec(path);
  return !!match&&HANDLE_PATTERN.test(match[1])&&
    (match[2]===undefined||PORTFOLIO_SLUG.test(match[2]));
}

/** Trusted operator only. Check the server's complete path plan before recording
 * fresh, scoped denial. The database recomputes the plan before accepting it. */
export async function attestAccountExitHostDenial(input:{
  requestId:string;origin:string;allowLocal?:boolean;
  rpc:(operation:'service_account_exit_withdrawal_plan'|'service_record_account_exit_host_denial',
    body:Record<string,string|number>)=>Promise<unknown>;
  http?:typeof fetch;
}):Promise<{status:'APPLICATION_HOST_DENIAL_RECORDED';observedHttpRequests:number}>{
  if(!REQUEST_UUID.test(input.requestId))
    throw new HostRevocationProbeError('INVALID_INPUT');
  const origin=trustedOrigin(input.origin,input.allowLocal===true);
  const raw=await input.rpc('service_account_exit_withdrawal_plan',{p_request_id:input.requestId});
  if(raw===null||typeof raw!=='object'||Array.isArray(raw))
    throw new HostRevocationProbeError('INVALID_INPUT');
  const {paths,planSha256}=raw as Record<string,unknown>;
  if(typeof planSha256!=='string'||!SHA256.test(planSha256)||
     !Array.isArray(paths)||paths.length>256||paths.some(path=>!accountExitPath(path))||
     new Set(paths).size!==paths.length)
    throw new HostRevocationProbeError('INVALID_INPUT');
  const http=input.http??fetch;
  for(let offset=0;offset<paths.length;offset+=6){
    await Promise.all(paths.slice(offset,offset+6).map(async(path:string)=>{
      for(const method of ['GET','HEAD'] as const)
        await verifyDenied(await fetchPath(new URL(path,origin),method,http),method);
    }));
  }
  const count=paths.length*2;
  const recorded=await input.rpc('service_record_account_exit_host_denial',{
    p_request_id:input.requestId,p_plan_sha256:planSha256,p_checks:count
  });
  if(recorded!==true) throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
  return {status:'APPLICATION_HOST_DENIAL_RECORDED',observedHttpRequests:count};
}
