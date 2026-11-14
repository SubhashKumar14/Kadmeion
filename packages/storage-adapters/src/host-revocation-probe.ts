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
  readonly code:'INVALID_INPUT'|'HOST_UNAVAILABLE'|'STILL_VISIBLE'|'UNSAFE_HEADERS'|'UNSAFE_BODY';
  constructor(code:HostRevocationProbeError['code']){
    super('External release revocation could not be verified: '+code);
    this.name='HostRevocationProbeError';this.code=code;
  }
}
const DIRECT=/^\/[a-zA-Z0-9._/-]{1,512}$/;
const PUBLIC=/^\/[a-z][a-z0-9_]{2,29}\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED=new Set(['u','app','auth','signin','signup','templates',
  'r','status','explore','api']);
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
     path.includes('@'))return false;
  return DIRECT.test(path);
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
    // Decode the entire bounded body so tags split across network chunks
    // cannot evade the deny-page markup validation.
    const content=new Uint8Array(size);
    let offset=0;
    for(const chunk of chunks){content.set(chunk,offset);offset+=chunk.byteLength;}
    const text=new TextDecoder('utf-8',{fatal:true}).decode(content);
    if(/<!doctype html>|<html\b|<script\b|<meta\s+name="robots"\s+content="index/i.test(text))
      throw new HostRevocationProbeError('UNSAFE_BODY');
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function probeHostRevocation(
  input:HostRevocationProbeInput,http:typeof fetch=fetch
):Promise<HostRevocationObservation>{
  if(!input||!Array.isArray(input.candidateDirectPaths)||
     input.candidateDirectPaths.length<1||input.candidateDirectPaths.length>12||
     !((typeof input.canonicalPath==='string'&&PUBLIC.test(input.canonicalPath)&&
         !RESERVED.has(input.canonicalPath.slice(1).split('/')[0]))||
       (typeof input.canonicalPath==='string'&&UNLISTED.test(input.canonicalPath)))||
     input.candidateDirectPaths.some(path=>!pathValid(path)||path===input.canonicalPath)||
     new Set(input.candidateDirectPaths).size!==input.candidateDirectPaths.length)
    throw new HostRevocationProbeError('INVALID_INPUT');
  const origin=trustedOrigin(input.origin,input.allowLocal===true);
  let count=0;
  for(const path of [input.canonicalPath,...input.candidateDirectPaths]){
    for(const method of ['GET','HEAD'] as const){
      let response:Response;
      try{
        response=await http(new URL(path,origin),{
          method,credentials:'omit',cache:'no-store',redirect:'error',
          signal:AbortSignal.timeout(5000)
        });
      }catch{
        throw new HostRevocationProbeError('HOST_UNAVAILABLE');
      }
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
