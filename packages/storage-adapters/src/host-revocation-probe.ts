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

/** A live HEAD has to match the same noncacheable delivery contract as GET.
 * It cannot quietly advertise cacheable metadata or return private bytes. */
async function verifyLiveHead(response:Response,mime:RegExp):Promise<void>{
  if(response.status!==200||response.redirected||response.headers.has('location')||
     !mime.test(response.headers.get('content-type')??'')||!isUncacheable(response.headers)){
    await response.body?.cancel().catch(()=>{});
    throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
  }
  if(response.body){
    const reader=response.body.getReader();
    try{
      const sample=await reader.read();
      if(!sample.done&&sample.value?.byteLength)
        throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
    }catch{
      throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
    }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
}

/** Verify exact GET bytes and HEAD metadata for canonical HTML and every
 * pinned manifest media path before withdrawing; then prove denial. */
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
  await verifyLiveHead(await fetchPath(new URL(paths.canonicalPath,origin),'HEAD',http),
    /^text\/html(?:;|$)/i);
  for(const [path,sha256] of liveAssets){
    const image=await fetchPath(new URL(path,origin),'GET',http);
    await verifyLiveBytes(image,/^image\/png$/i,5*1024*1024,sha256);
    await verifyLiveHead(await fetchPath(new URL(path,origin),'HEAD',http),/^image\/png$/i);
  }
  await withdraw();
  const after=await probeHostRevocation(paths,http);
  return Object.freeze({...after,liveAssetPathsVerified:liveAssets.size,
    observedHttpRequests:after.observedHttpRequests+2+2*liveAssets.size});
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
     !Array.isArray(paths)||paths.length<1||paths.length>256||
     paths.some(path=>!accountExitPath(path))||
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
    await response.body?.cancel();
    throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
  }
  const reader=response.body?.getReader();
  if(!reader)throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
  const hash=createHash('sha256'),pieces:Uint8Array[]=[];
  let length=0;
  try{
    for(;;){
      const part=await reader.read();
      if(part.done)break;
      if(!(part.value instanceof Uint8Array)||
         (length+=part.value.byteLength)>750_000)
        throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
      hash.update(part.value);
      pieces.push(part.value);
    }
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
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function reviewerLiveHead(response:Response,media:boolean):Promise<void>{
  if(!reviewerHttpHeaders(response,media)){
    await response.body?.cancel();
    throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
  }
  if(response.body){
    const reader=response.body.getReader();
    try{
      const first=await reader.read();
      if(!first.done&&first.value?.byteLength)
        throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
    }catch{throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
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
    const imgs=[...html.matchAll(REVIEWER_IMG)];
    if((html.match(/<img\b/gi)??[]).length!==imgs.length||
       imgs.length!==mediaPaths.length||
       new Set(imgs.map(x=>x[1])).size!==imgs.length||
       imgs.some((img)=>!mediaPaths.some(asset=>img[1]===asset.path.replaceAll('&','&amp;'))))
      throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
    await reviewerLiveHead(await fetchPath(new URL(path,origin),'HEAD',http),false);
    checks++;
  }
  for(const asset of mediaPaths){
    const media=await fetchPath(new URL(asset.path,origin),'GET',http);
    if(!reviewerHttpHeaders(media,true)){
      await media.body?.cancel();
      throw new HostRevocationProbeError('RELEASE_NOT_OBSERVED');
    }
    await verifyLiveBytes(media,/^image\/png(?:;|$)/i,4_000_000,asset.sha256);
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
