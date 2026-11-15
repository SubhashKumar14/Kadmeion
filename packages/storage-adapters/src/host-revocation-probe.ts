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
function pathValid(path:string):boolean {
  if(typeof path!=='string'||path.includes('//')||path.includes('..')||
     path.includes('%')||path.includes('\\')||path.includes('#')||
     path.includes('@')||path.split('/').includes('.'))return false;
  return DIRECT.test(path);
}
function validatedOrigin(input:HostRevocationProbeInput):URL {
  if(!input||!Array.isArray(input.candidateDirectPaths)||
     input.candidateDirectPaths.length<1||input.candidateDirectPaths.length>12||
     !canonicalPathValid(input.canonicalPath)||
     input.candidateDirectPaths.some(path=>!pathValid(path)||path===input.canonicalPath)||
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
  if(!/(?:^|,)\s*no-store\s*(?:,|$)/i.test(h.get('cache-control')??'')||
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

/** Verify one real pre-withdrawal release and then independently probe the same URL set after withdrawal. */
export async function verifyReleaseWithdrawal(
  input:HostRevocationProbeInput,expectedServedSha256:string,
  withdraw:()=>Promise<void>,http:typeof fetch=fetch
):Promise<HostRevocationObservation>{
  const origin=validatedOrigin(input);
  if(typeof expectedServedSha256!=='string'||!/^[0-9a-f]{64}$/.test(expectedServedSha256)||
     typeof withdraw!=='function')throw new HostRevocationProbeError('INVALID_INPUT');
  const paths={...input,origin:origin.origin,candidateDirectPaths:[...input.candidateDirectPaths]};
  const response=await fetchPath(new URL(paths.canonicalPath,origin),'GET',http);
  const reader=response.body?.getReader();
  if(!reader)throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
  try{
    if(response.status!==200||response.redirected||
       !/^text\/html(?:;|$)/i.test(response.headers.get('content-type')??''))
      throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
    const bytes=new Uint8Array(750_000);
    let size=0;
    for(;;){
      const chunk=await reader.read();
      if(chunk.done)break;
      if(chunk.value.byteLength>bytes.byteLength-size)
        throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
      bytes.set(chunk.value,size);
      size+=chunk.value.byteLength;
    }
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.subarray(0,size)));
    const hex=Array.from(digest,value=>value.toString(16).padStart(2,'0')).join('');
    if(size===0||hex!==expectedServedSha256)
      throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
  }catch{
    throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
  }finally{
    await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
  await withdraw();
  const after=await probeHostRevocation(paths,http);
  return Object.freeze({...after,observedHttpRequests:after.observedHttpRequests+1});
}
