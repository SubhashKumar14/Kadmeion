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
  const age=headers.get('age');
  if(age!==null&&!/^0+$/.test(age.trim()))return false;
  return CACHE_HEADERS.every((name)=>{
    const value=headers.get(name);
    if(value===null)return name!=='cache-control';
    const directives=value.toLowerCase().split(',').map(directive=>directive.trim());
    return directives.includes('no-store')&&!directives.includes('public')&&
      !directives.includes('immutable')&&
      directives.every(directive=>!/^(?:max-age|s-maxage|s-max-age|stale-while-revalidate|stale-if-error)\b/.test(directive)||
        /^(?:max-age|s-maxage|s-max-age|stale-while-revalidate|stale-if-error)\s*=\s*(?:0+|"0+")$/.test(directive));
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
function publicApiAlias(canonicalPath:string):string|undefined {
  if(UNLISTED.test(canonicalPath))return undefined;
  const [,handle,slug]=canonicalPath.split('/');
  return '/api/public-portfolio?'+new URLSearchParams({handle,slug});
}
function scopedMediaSha(path:string,canonicalPath:string):string|undefined {
  const scope=UNLISTED.test(canonicalPath)?canonicalPath:publicApiAlias(canonicalPath);
  if(!scope||!path.startsWith(scope+'&manifest='))return undefined;
  return /^&manifest=[a-f0-9]{64}&asset=([a-f0-9]{64})$/.exec(path.slice(scope.length))?.[1];
}
function pathValid(path:string,canonicalPath:string):boolean {
  if(typeof path!=='string'||path.includes('//')||path.includes('..')||
     path.includes('%')||path.includes('\\')||path.includes('#')||
     path.includes('@')||path.split('/').includes('.'))return false;
  return DIRECT.test(path)||path===publicApiAlias(canonicalPath)||
    scopedMediaSha(path,canonicalPath)!==undefined;
}
function validatedOrigin(input:HostRevocationProbeInput):URL {
  if(!input||!Array.isArray(input.candidateDirectPaths)||
     input.candidateDirectPaths.length<1||input.candidateDirectPaths.length>12||
     !canonicalPathValid(input.canonicalPath)||
     [...input.candidateDirectPaths].some(path=>!pathValid(path,input.canonicalPath)||path===input.canonicalPath)||
     new Set(input.candidateDirectPaths).size!==input.candidateDirectPaths.length)
    throw new HostRevocationProbeError('INVALID_INPUT');
  return trustedOrigin(input.origin,input.allowLocal===true);
}

const PROBE_TIMEOUT_MS=5000;
const MAX_PROBE_CHUNKS=65536;
type ProbeErrorCode=HostRevocationProbeError['code'];
function cancelProbeBody(body:ReadableStream<Uint8Array>|ReadableStreamDefaultReader<Uint8Array>|null|undefined):void {
  // Cancellation of one tee branch can wait forever for its unread sibling.
  try{void body?.cancel().catch(()=>{});}catch{}
}
async function fetchPath(url:URL,method:'GET'|'HEAD',http:typeof fetch):Promise<Response>{
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  let expired=false;
  try{
    const pending=Promise.resolve().then(()=>http(url,{method,credentials:'omit',cache:'no-store',
      redirect:'error',signal:controller.signal})).then(response=>{
        if(expired||response.redirected||(response.url!==''&&response.url!==url.href)){
          cancelProbeBody(response.body);throw new HostRevocationProbeError('HOST_UNAVAILABLE');
        }
        return response;
      });
    const deadline=new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>{
        expired=true;controller.abort();reject(new HostRevocationProbeError('HOST_UNAVAILABLE'));
      },PROBE_TIMEOUT_MS);
    });
    return await Promise.race([pending,deadline]);
  }catch{throw new HostRevocationProbeError('HOST_UNAVAILABLE');}
  finally{clearTimeout(timer);}
}
/** Read to EOF even for HEAD. An initial zero-length chunk is not bodylessness.
 * Bound elapsed time, chunks and bytes independently; never await cleanup. */
async function consumeProbeBody(response:Response,maxBytes:number,code:ProbeErrorCode,
  onChunk:(bytes:Uint8Array)=>void,allowAbsent=false):Promise<number>{
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let finished=false,expired=false,size=0,chunks=0;
  try{
    if(!response.body){
      if(allowAbsent)return 0;
      throw new HostRevocationProbeError(code);
    }
    const active=response.body.getReader();reader=active;
    const drain=async()=>{
      for(;;){
        const part=await active.read();
        if(expired)throw new HostRevocationProbeError(code);
        if(part.done)break;
        if(!(part.value instanceof Uint8Array)||++chunks>MAX_PROBE_CHUNKS||
           (size+=part.value.byteLength)>maxBytes)throw new HostRevocationProbeError(code);
        onChunk(part.value);
      }
    };
    const deadline=new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>{expired=true;reject(new HostRevocationProbeError(code));},PROBE_TIMEOUT_MS);
    });
    await Promise.race([drain(),deadline]);
    finished=true;
    return size;
  }catch{throw new HostRevocationProbeError(code);}
  finally{
    clearTimeout(timer);
    if(!finished)cancelProbeBody(reader??response.body);
    try{reader?.releaseLock();}catch{}
  }
}
function canonicalPathValid(path:unknown):boolean {
  if(typeof path!=='string')return false;
  if(UNLISTED.test(path))return true;
  const [root,handle,slug,...rest]=path.split('/');
  return root===''&&rest.length===0&&HANDLE_PATTERN.test(handle??'')&&
    !RESERVED_HANDLES.has(handle)&&PORTFOLIO_SLUG.test(slug??'');
}
function hasStaleDeliveryMetadata(h:Headers):boolean {
  return h.has('link')||h.has('x-kadmeion-served-sha256')||h.has('last-modified');
}
async function verifyDenied(response:Response,method:'GET'|'HEAD'):Promise<void> {
  if(response.status!==404&&response.status!==410){
    cancelProbeBody(response.body);
    throw new HostRevocationProbeError('STILL_VISIBLE');
  }
  const h=response.headers;
  const robots=(h.get('x-robots-tag')??'').toLowerCase().split(',').map(x=>x.trim());
  if(response.redirected||!isUncacheable(h)||!robots.includes('noindex')||
     robots.includes('index')||h.has('location')||h.has('etag')||
     hasStaleDeliveryMetadata(h)||
     !/^text\/plain(?:;|$)/i.test(h.get('content-type')??'')){
    cancelProbeBody(response.body);
    throw new HostRevocationProbeError('UNSAFE_HEADERS');
  }
  if(method==='HEAD'){
    await consumeProbeBody(response,0,'UNSAFE_BODY',()=>{},true);
    return;
  }
  const chunks:Uint8Array[]=[];
  const size=await consumeProbeBody(response,4096,'UNSAFE_BODY',part=>chunks.push(part));
  try{
    const content=new Uint8Array(size);
    let offset=0;
    for(const chunk of chunks){content.set(chunk,offset);offset+=chunk.byteLength;}
    const text=new TextDecoder('utf-8',{fatal:true}).decode(content).trim();
    if(text!==''&&text!==(response.status===404?'Not found':'Gone'))
      throw new HostRevocationProbeError('UNSAFE_BODY');
  }catch{throw new HostRevocationProbeError('UNSAFE_BODY');}
}
export async function probeHostRevocation(
  input:HostRevocationProbeInput,http:typeof fetch=fetch
):Promise<HostRevocationObservation>{
  const origin=validatedOrigin(input);
  const canonicalPath=input.canonicalPath;
  const directPaths=[...input.candidateDirectPaths];
  let count=0;
  for(const path of [canonicalPath,...directPaths]){
    for(const method of ['GET','HEAD'] as const){
      const response=await fetchPath(new URL(path,origin),method,http);
      await verifyDenied(response,method);
      count++;
    }
  }
  return Object.freeze({
    status:'OBSERVED_REVOKED_ON_SCOPED_PATHS' as const,
    canonicalPath,
    observedHttpRequests:count,
    directPathsChecked:directPaths.length,
    universalCacheErasureVerified:false as const,
    thirdPartyArchiveErasureVerified:false as const
  });
}

function assertFrozenPng(bytes:Uint8Array):void {
  const signature=[137,80,78,71,13,10,26,10];
  if(bytes.byteLength<signature.length||!signature.every((value,index)=>bytes[index]===value))
    throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
}

async function verifyLiveBytes(
  response:Response, mime:RegExp, maxBytes:number, expectedDigest:string,
  inspect?:(bytes:Uint8Array)=>void
):Promise<void> {
  if(response.status!==200||response.redirected||response.headers.has('location')||
     !mime.test(response.headers.get('content-type')??'')||!isUncacheable(response.headers)){
    cancelProbeBody(response.body);
    throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
  }
  const digest=createHash('sha256'),pieces:Uint8Array[]=[];
  const size=await consumeProbeBody(response,maxBytes,'RELEASE_NOT_OBSERVED',part=>{
    digest.update(part);
    if(inspect)pieces.push(part);
  });
  if(size===0||digest.digest('hex')!==expectedDigest)
    throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
  if(inspect){
    const bytes=new Uint8Array(size);let offset=0;
    for(const part of pieces){bytes.set(part,offset);offset+=part.byteLength;}
    inspect(bytes);
  }
}

/** Live HEAD must meet the same noncacheable delivery contract as GET and
 * contain no bytes over the entire independently observed stream. */
async function verifyLiveHead(response:Response,mime:RegExp):Promise<void>{
  if(response.status!==200||response.redirected||response.headers.has('location')||
     !mime.test(response.headers.get('content-type')??'')||!isUncacheable(response.headers)){
    cancelProbeBody(response.body);
    throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
  }
  await consumeProbeBody(response,0,'RELEASE_NOT_OBSERVED',()=>{},true);
}

/** Verify exact GET bytes and HEAD metadata for canonical HTML and every
 * pinned manifest media path before withdrawing; then prove denial. */
export async function verifyReleaseWithdrawal(
  input:ReleaseWithdrawalInput,expectedServedSha256:string,
  withdraw:()=>Promise<void>,http:typeof fetch=fetch
):Promise<HostRevocationObservation & {liveAssetPathsVerified:number}>{
  return observeReleaseWithdrawal(input,expectedServedSha256,withdraw,http);
}
async function observeReleaseWithdrawal(
  input:ReleaseWithdrawalInput,expectedServedSha256:string,
  withdraw:()=>Promise<void>,http:typeof fetch,
  inspectHtml?:(bytes:Uint8Array)=>void
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

  // A supplied exact public API alias is itself an observable live HTML
  // representation, not just a path to check after withdrawal.
  const alias=publicApiAlias(paths.canonicalPath);
  const htmlPaths=[paths.canonicalPath,...(alias&&paths.candidateDirectPaths.includes(alias)?[alias]:[])];
  for(const path of htmlPaths){
    const html=await fetchPath(new URL(path,origin),'GET',http);
    await verifyLiveBytes(html,/^text\/html(?:;|$)/i,750_000,expectedServedSha256,inspectHtml);
    await verifyLiveHead(await fetchPath(new URL(path,origin),'HEAD',http),/^text\/html(?:;|$)/i);
  }
  for(const [path,sha256] of liveAssets){
    const image=await fetchPath(new URL(path,origin),'GET',http);
    await verifyLiveBytes(image,/^image\/png$/i,5*1024*1024,sha256,assertFrozenPng);
    await verifyLiveHead(await fetchPath(new URL(path,origin),'HEAD',http),/^image\/png$/i);
  }
  await withdraw();
  const after=await probeHostRevocation(paths,http);
  return Object.freeze({...after,liveAssetPathsVerified:liveAssets.size,
    observedHttpRequests:after.observedHttpRequests+2*htmlPaths.length+2*liveAssets.size});
}

export function validWithdrawalManifest(manifest:unknown,hashes:unknown):boolean {
  return Array.isArray(hashes)&&hashes.length<=8&&
    [...hashes].every(sha=>typeof sha==='string'&&SHA256.test(sha))&&
    new Set(hashes).size===hashes.length&&
    (hashes.length===0?manifest===null:typeof manifest==='string'&&SHA256.test(manifest));
}

const PUBLIC_RELEASE_IMG=/<img loading="lazy" decoding="async" src="([^"<>]+)" alt="[^"<>]*" width="[1-9][0-9]{0,3}" height="[1-9][0-9]{0,3}">/g;
function matchPublicMediaSet(bytes:Uint8Array,paths:readonly string[]):void{
  try{
    const html=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
    const tags=[...html.matchAll(PUBLIC_RELEASE_IMG)];
    const expected=new Set(paths.map(path=>path.replaceAll('&','&amp;')));
    const seen=new Set(tags.map(tag=>tag[1]));
    if((html.match(/<img\b/gi)??[]).length!==tags.length||
       seen.size!==expected.size||[...seen].some(src=>!expected.has(src)))
      throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
  }catch{throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');}
}

/**
 * Post-takedown proof for an already-authorized moderation hold or withdrawal.
 * A takedown MUST NOT wait for the abusive content to be successfully fetched.
 * The manifest must come from a trusted pre-hold release record, not a visitor.
 * This observes scoped denial only; it neither lifts nor creates a hold and
 * never claims the database case, CDN retention or worldwide removal is proved.
 */
export async function probeCanonicalPublicTakedown(
  input:{origin:string;canonicalPath:string;manifestSha256:string|null;
    assetHashes:readonly string[];allowLocal?:boolean},
  http:typeof fetch=fetch
):Promise<HostRevocationObservation>{
  if(!input||!canonicalPathValid(input.canonicalPath)||UNLISTED.test(input.canonicalPath)||
     !validWithdrawalManifest(input.manifestSha256,input.assetHashes))
    throw new HostRevocationProbeError('INVALID_INPUT');
  const alias=publicApiAlias(input.canonicalPath)!;
  const direct=[alias,...input.assetHashes.map(sha=>alias+'&manifest='+input.manifestSha256+'&asset='+sha)];
  return probeHostRevocation({
    origin:input.origin,allowLocal:input.allowLocal,canonicalPath:input.canonicalPath,
    candidateDirectPaths:direct
  },http);
}

/**
 * Post-hold/rename denial for a complete trusted history supplied by the
 * authority transaction. Multiple old manifests may share one canonical path.
 * This proof does not discover historical addresses, create a hold, certify
 * plan completeness, erase caches, or write a case receipt.
 */
export type PublicTakedownScope=Readonly<{
  canonicalPath:string;manifestSha256:string|null;assetHashes:readonly string[];
}>;
export type PublicTakedownPlanObservation=Readonly<{
  status:'OBSERVED_TAKEDOWN_ON_SCOPED_PATHS';canonicalPaths:readonly string[];
  observedHttpRequests:number;observedPathsSha256:string;
  directPathsChecked:number;universalCacheErasureVerified:false;
  thirdPartyArchiveErasureVerified:false;
}>;
export async function probePublicTakedownPlan(
  input:{origin:string;scopes:readonly PublicTakedownScope[];allowLocal?:boolean},
  http:typeof fetch=fetch
):Promise<PublicTakedownPlanObservation>{
  if(!input||!Array.isArray(input.scopes)||input.scopes.length<1||input.scopes.length>32)
    throw new HostRevocationProbeError('INVALID_INPUT');
  const origin=trustedOrigin(input.origin,input.allowLocal===true);
  const canonical=new Set<string>(),paths=new Set<string>(),releases=new Set<string>();
  // Validate and snapshot every path before making even the first request.
  for(const scope of input.scopes){
    if(!scope||typeof scope!=='object'||Object.keys(scope).length!==3||
       !Object.hasOwn(scope,'canonicalPath')||!Object.hasOwn(scope,'manifestSha256')||
       !Object.hasOwn(scope,'assetHashes')||!canonicalPathValid(scope.canonicalPath)||
       UNLISTED.test(scope.canonicalPath)||!validWithdrawalManifest(scope.manifestSha256,scope.assetHashes))
      throw new HostRevocationProbeError('INVALID_INPUT');
    const releaseKey=scope.canonicalPath+'|'+scope.manifestSha256;
    if(releases.has(releaseKey))throw new HostRevocationProbeError('INVALID_INPUT');
    releases.add(releaseKey);
    const alias=publicApiAlias(scope.canonicalPath)!;
    canonical.add(scope.canonicalPath);
    paths.add(scope.canonicalPath);
    paths.add(alias);
    paths.add(alias+'&report=1');
    for(const sha of scope.assetHashes)paths.add(alias+'&manifest='+scope.manifestSha256+'&asset='+sha);
  }
  // Never silently truncate an over-limit authority plan.
  if(paths.size>256)throw new HostRevocationProbeError('INVALID_INPUT');
  const checked=[...paths].sort(),canonicalPaths=Object.freeze([...canonical].sort());
  const observedPathsSha256=createHash('sha256').update(JSON.stringify(checked)).digest('hex');
  for(let offset=0;offset<checked.length;offset+=4){
    await Promise.all(checked.slice(offset,offset+4).map(async path=>{
      for(const method of ['GET','HEAD'] as const)
        await verifyDenied(await fetchPath(new URL(path,origin),method,http),method);
    }));
  }
  return Object.freeze({status:'OBSERVED_TAKEDOWN_ON_SCOPED_PATHS',
    canonicalPaths,observedHttpRequests:checked.length*2,observedPathsSha256,
    directPathsChecked:checked.length-canonicalPaths.length,
    universalCacheErasureVerified:false,thirdPartyArchiveErasureVerified:false});
}

/**
 * Verify retirement after republish, rollback or explicit publication at a
 * renamed address. Current canonical/API/report URLs and exact current media
 * may legitimately remain live. Only the set difference is a denial target.
 * Both current and historical scopes MUST come from trusted authority reads;
 * this observes the supplied scope, not its completeness or database state.
 */
export type PublicReplacementObservation=Readonly<{
  status:'OBSERVED_REPLACED_SCOPE_DENIED'|'NO_RETIRED_PATHS_IN_SCOPE';
  currentCanonicalPath:string;
  retiredCanonicalPaths:readonly string[];
  observedPathsSha256:string;
  observedHttpRequests:number;
  directPathsChecked:number;
  universalCacheErasureVerified:false;
  thirdPartyArchiveErasureVerified:false;
}>;
export async function probePublicReplacementDenial(input:{
  origin:string;current:PublicTakedownScope;history:readonly PublicTakedownScope[];
  allowLocal?:boolean;
},http:typeof fetch=fetch):Promise<PublicReplacementObservation>{
  if(!input||!Array.isArray(input.history)||input.history.length>32)
    throw new HostRevocationProbeError('INVALID_INPUT');
  const origin=trustedOrigin(input.origin,input.allowLocal===true);
  const manifests=new Map<string,string>();
  const scope=(value:PublicTakedownScope)=>{
    if(!value||typeof value!=='object'||Object.keys(value).length!==3||
       !Object.hasOwn(value,'canonicalPath')||!Object.hasOwn(value,'manifestSha256')||
       !Object.hasOwn(value,'assetHashes')||!canonicalPathValid(value.canonicalPath)||
       UNLISTED.test(value.canonicalPath)||!validWithdrawalManifest(value.manifestSha256,value.assetHashes))
      throw new HostRevocationProbeError('INVALID_INPUT');
    const canonical=value.canonicalPath,manifest=value.manifestSha256;
    const assets=[...value.assetHashes].sort();
    if(manifest!==null){
      const key=JSON.stringify(assets),prior=manifests.get(manifest);
      if(prior!==undefined&&prior!==key)throw new HostRevocationProbeError('INVALID_INPUT');
      manifests.set(manifest,key);
    }
    const alias=publicApiAlias(canonical)!;
    return {canonical,paths:[canonical,alias,alias+'&report=1',
      ...assets.map(sha=>alias+'&manifest='+manifest+'&asset='+sha)]};
  };
  const current=scope(input.current);
  const allowed=new Set(current.paths),historic=new Set<string>(),canonical=new Set<string>();
  for(const entry of input.history){
    const old=scope(entry);
    if(old.canonical!==current.canonical)canonical.add(old.canonical);
    for(const path of old.paths)if(!allowed.has(path))historic.add(path);
  }
  if(historic.size>256)throw new HostRevocationProbeError('INVALID_INPUT');
  const denied=[...historic].sort();
  const retiredCanonicalPaths=Object.freeze([...canonical].sort());
  const observedPathsSha256=createHash('sha256').update(JSON.stringify(denied)).digest('hex');
  for(let offset=0;offset<denied.length;offset+=4){
    await Promise.all(denied.slice(offset,offset+4).map(async path=>{
      for(const method of ['GET','HEAD'] as const)
        await verifyDenied(await fetchPath(new URL(path,origin),method,http),method);
    }));
  }
  return Object.freeze({
    status:denied.length?'OBSERVED_REPLACED_SCOPE_DENIED':'NO_RETIRED_PATHS_IN_SCOPE',
    currentCanonicalPath:current.canonical,retiredCanonicalPaths,observedPathsSha256,
    observedHttpRequests:denied.length*2,directPathsChecked:denied.length-retiredCanonicalPaths.length,
    universalCacheErasureVerified:false,thirdPartyArchiveErasureVerified:false
  });
}

/**
 * Strict public withdrawal entry point for a trusted server-provided exact
 * pre-withdrawal manifest. Derives the canonical API and all scoped media
 * paths internally; caller cannot substitute another handle or omit aliases.
 * The older generic probe remains explicitly scoped to paths supplied.
 */
export async function verifyCanonicalPublicWithdrawal(
  input:{origin:string;canonicalPath:string;expectedServedSha256:string;
    manifestSha256:string|null;assetHashes:readonly string[];allowLocal?:boolean},
  withdraw:()=>Promise<void>,http:typeof fetch=fetch
):Promise<HostRevocationObservation & {liveAssetPathsVerified:number}>{
  if(!input||!canonicalPathValid(input.canonicalPath)||UNLISTED.test(input.canonicalPath)||
     !validWithdrawalManifest(input.manifestSha256,input.assetHashes))
    throw new HostRevocationProbeError('INVALID_INPUT');
  const alias=publicApiAlias(input.canonicalPath)!;
  const assets=input.assetHashes.map(sha256=>({
    path:alias+'&manifest='+input.manifestSha256+'&asset='+sha256,sha256
  }));
  const assetPaths=assets.map(asset=>asset.path);
  return observeReleaseWithdrawal({
    origin:input.origin,canonicalPath:input.canonicalPath,allowLocal:input.allowLocal,
    candidateDirectPaths:[alias,...assetPaths],liveAssets:assets
  },input.expectedServedSha256,withdraw,http,bytes=>matchPublicMediaSet(bytes,assetPaths));
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
  if(!input||typeof input.requestId!=='string'||!REQUEST_UUID.test(input.requestId)||
     typeof input.rpc!=='function')throw new HostRevocationProbeError('INVALID_INPUT');
  // Capture the target and callbacks once: a concurrently changed input may
  // never redirect a successful denial receipt to a different request.
  const requestId=input.requestId,rpc=input.rpc,http=input.http??fetch;
  const origin=trustedOrigin(input.origin,input.allowLocal===true);
  const raw=await rpc('service_account_exit_withdrawal_plan',{p_request_id:requestId});
  if(raw===null||typeof raw!=='object'||Array.isArray(raw))
    throw new HostRevocationProbeError('INVALID_INPUT');
  const {paths,planSha256}=raw as Record<string,unknown>;
  if(typeof planSha256!=='string'||!SHA256.test(planSha256)||
     !Array.isArray(paths)||paths.length>256||
     // Array#some/map/forEach skip holes: an authority plan must be dense.
     ![...paths].every(accountExitPath)||new Set(paths).size!==paths.length)
    throw new HostRevocationProbeError('INVALID_INPUT');
  // Retain an immutable, bounded snapshot across all awaited network reads.
  const checked=Object.freeze([...paths] as string[]);
  for(let offset=0;offset<checked.length;offset+=6){
    await Promise.all(checked.slice(offset,offset+6).map(async path=>{
      for(const method of ['GET','HEAD'] as const)
        await verifyDenied(await fetchPath(new URL(path,origin),method,http),method);
    }));
  }
  const count=checked.length*2;
  const recorded=await rpc('service_record_account_exit_host_denial',{
    p_request_id:requestId,p_plan_sha256:planSha256,p_checks:count
  });
  if(recorded!==true) throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
  return {status:'APPLICATION_HOST_DENIAL_RECORDED',observedHttpRequests:count};
}


/**
 * F4 reviewer staging proof. Operator/test harness ONLY: this procedure
 * deliberately requires an already activated, expiring reviewer grant and
 * withdraws it through a trusted callback. It never issues a grant, changes
 * host flags, or publishes a portfolio.
 *
 * An application/CDN can prove only the exact routes checked here. Raw token
 * is used in the outgoing requests by necessity but is NEVER included in
 * observations, diagnostic messages or logs from this module.
 */
export interface ReviewerHostWithdrawalInput {
  origin:string;
  grantId:string;
  rawToken:string;
  expectedServedHtmlSha256:string;
  /** Enumerate every PNG presented in the rendered reviewer HTML. */
  assets?:readonly {manifestSha256:string;sha256:string}[];
  allowLocal?:boolean;
}
export interface ReviewerHostWithdrawalObservation {
  status:'REVIEWER_REVOKED_ON_SCOPED_PATHS';
  observedHttpRequests:number;
  directPathsChecked:number;
  liveMediaVerified:number;
  universalCacheErasureVerified:false;
  thirdPartyArchiveErasureVerified:false;
}
const REVIEWER_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REVIEWER_IMG=/<img loading="lazy" decoding="async" src="([^"<>]+)" alt="[^"<>]*" width="[1-9][0-9]{0,3}" height="[1-9][0-9]{0,3}">/g;

function reviewerHttpHeaders(response:Response,media:boolean):boolean {
  const h=response.headers;
  const robots=(h.get('x-robots-tag')??'').toLowerCase().split(',').map(x=>x.trim());
  const csp=h.get('content-security-policy')??'';
  const directives=csp.split(';').map(x=>x.trim().split(/\s+/)).filter(x=>x[0]);
  const requireNone=(name:string)=> {
    const set=directives.filter(x=>x[0]===name);
    return set.length===1&&set[0].length===2&&set[0][1]==="'none'";
  };
  const overrides=directives.filter(x=>
    ['script-src-elem','script-src-attr','worker-src','child-src'].includes(x[0]));
  return response.status===200&&!response.redirected&&!h.has('location')&&
    !h.has('etag')&&isUncacheable(h)&&
    robots.includes('noindex')&&!robots.includes('index')&&
    h.get('referrer-policy')==='no-referrer'&&
    h.get('x-content-type-options')==='nosniff'&&
    requireNone('default-src')&&requireNone('script-src')&&
    overrides.every(d=>d.length===2&&d[1]==="'none'")&&
    (media? /^image\/png(?:;|$)/i.test(h.get('content-type')??''):
      /^text\/html(?:;|$)/i.test(h.get('content-type')??''));
}
async function reviewerLiveHtml(response:Response,expectedSha:string):Promise<string> {
  if(!reviewerHttpHeaders(response,false)){
    cancelProbeBody(response.body);
    throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
  }
  const hash=createHash('sha256'),pieces:Uint8Array[]=[];
  const length=await consumeProbeBody(response,750_000,'RELEASE_NOT_OBSERVED',part=>{
    hash.update(part);pieces.push(part);
  });
  try{
    if(length===0||hash.digest('hex')!==expectedSha)
      throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
    const bytes=new Uint8Array(length);
    let offset=0;
    for(const part of pieces){bytes.set(part,offset);offset+=part.byteLength;}
    const html=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    const head=/^<!doctype html>\s*<html(?:\s[^>]*)?>\s*<head(?:\s[^>]*)?>([\s\S]*?)<\/head>/i.exec(html);
    const robots=head?.[1].match(/<meta\b[^>]*\bname=["']?(?:robots|googlebot|bingbot)\b/gi)??[];
    const robotsTag=head?.[1].match(/<meta\s+name="robots"\s+content="(noindex(?:,nofollow(?:,noarchive)?)?)"\s*\/?>/gi)??[];
    if(!head||robots.length!==1||robotsTag.length!==1)
      throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
    return html;
  }catch{throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');}
}
async function reviewerLiveHead(response:Response,media:boolean):Promise<void>{
  if(!reviewerHttpHeaders(response,media)){
    cancelProbeBody(response.body);
    throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
  }
  await consumeProbeBody(response,0,'RELEASE_NOT_OBSERVED',()=>{},true);
}
function reviewerHostPaths(input:ReviewerHostWithdrawalInput):{
  origin:URL;htmlPaths:string[];mediaPaths:{path:string;sha256:string}[];
}{
  if(!input||typeof input.grantId!=='string'||!REVIEWER_UUID.test(input.grantId)||
     typeof input.rawToken!=='string'||!SHA256.test(input.rawToken)||
     typeof input.expectedServedHtmlSha256!=='string'||!SHA256.test(input.expectedServedHtmlSha256)||
     (input.assets!==undefined&&!Array.isArray(input.assets)))
    throw new HostRevocationProbeError('INVALID_INPUT');
  const assets=input.assets??[];
  if(assets.length>8||assets.some(asset=>!asset||!SHA256.test(asset.manifestSha256)||
    !SHA256.test(asset.sha256))||
    new Set(assets.map(asset=>asset.sha256)).size!==assets.length||
    new Set(assets.map(asset=>asset.manifestSha256)).size>1)
    throw new HostRevocationProbeError('INVALID_INPUT');
  const origin=trustedOrigin(input.origin,input.allowLocal===true);
  const credential=input.grantId+'.'+input.rawToken;
  const query='review='+credential;
  return {
    origin,
    htmlPaths:['/r/'+credential,'/api/reviewer?'+query],
    mediaPaths:assets.map(asset=>({
      path:'/api/reviewer?'+query+'&manifest='+asset.manifestSha256+'&asset='+asset.sha256,
      sha256:asset.sha256
    }))
  };
}
/** Actual HTTP GET/HEAD lifecycle check, including every referenced immutable PNG.
 * This observation remains narrower than a guarantee of global cache erasure.
 */
export function matchesReviewerMediaSet(html:string,paths:readonly string[]):boolean {
  const imgs=[...html.matchAll(REVIEWER_IMG)];
  const seen=new Set(imgs.map(img=>img[1]));
  const expected=new Set(paths.map(path=>path.replaceAll('&','&amp;')));
  return (html.match(/<img\b/gi)??[]).length===imgs.length&&
    seen.size===expected.size&&[...seen].every(src=>expected.has(src));
}

export async function verifyReviewerHostWithdrawal(
  input:ReviewerHostWithdrawalInput,revoke:()=>Promise<void>,http:typeof fetch=fetch
):Promise<ReviewerHostWithdrawalObservation>{
  const {origin,htmlPaths,mediaPaths}=reviewerHostPaths(input);
  if(typeof revoke!=='function')throw new HostRevocationProbeError('INVALID_INPUT');
  let checks=0;
  for(const path of htmlPaths){
    const html=await reviewerLiveHtml(await fetchPath(new URL(path,origin),'GET',http),
      input.expectedServedHtmlSha256);
    checks++;
    // The actual rendered IMG list must match the manifest's ENTIRE declared
    // media set. Partial coverage cannot produce an accepted revocation proof.
    if(!matchesReviewerMediaSet(html,mediaPaths.map(asset=>asset.path)))
      throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
    await reviewerLiveHead(await fetchPath(new URL(path,origin),'HEAD',http),false);
    checks++;
  }
  for(const asset of mediaPaths){
    const media=await fetchPath(new URL(asset.path,origin),'GET',http);
    if(!reviewerHttpHeaders(media,true)){
      cancelProbeBody(media.body);
      throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
    }
    await verifyLiveBytes(media,/^image\/png(?:;|$)/i,4_000_000,asset.sha256,assertFrozenPng);
    checks++;
    await reviewerLiveHead(await fetchPath(new URL(asset.path,origin),'HEAD',http),true);
    checks++;
  }
  await revoke();
  for(const path of [...htmlPaths,...mediaPaths.map(x=>x.path)]){
    for(const method of ['GET','HEAD'] as const){
      await verifyDenied(await fetchPath(new URL(path,origin),method,http),method);
      checks++;
    }
  }
  return Object.freeze({
    status:'REVIEWER_REVOKED_ON_SCOPED_PATHS' as const,
    observedHttpRequests:checks,
    directPathsChecked:1+mediaPaths.length,
    liveMediaVerified:mediaPaths.length,
    universalCacheErasureVerified:false as const,
    thirdPartyArchiveErasureVerified:false as const
  });
}
