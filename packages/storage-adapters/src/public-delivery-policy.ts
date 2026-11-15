/**
 * B4 host-neutral policy for a FUTURE public route/asset resolver.
 *
 * This is not a server, deployment adapter, permission grant, signed attestation,
 * or proof of cache invalidation. SVG is excluded until active-content safety
 * is proven; CSS must be trusted/sanitized before any future hosting.
 * Only a trusted, strongly consistent host-side
 * lookup may supply state; callers and public requests must never supply it.
 * A positive decision is deliberately a NON-DEPLOYABLE candidate, not HTTP 200.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^[0-9a-f]{64}$/;
const ASSET_PATH=/^assets\/[0-9a-f]{64}\.(?:css|png|jpe?g|webp|woff2)$/;
const MAX_FILES=64;
const MAX_AGE_MS=2000;

export type PublicDeliveryRequest =
  | {portfolioId:string;resource:'CANONICAL_HTML'}
  | {portfolioId:string;resource:'DIRECT_ASSET';releaseSha256:string;path:string;sha256:string};

/** Trusted host-side state only. Not a browser API response or an owner claim. */
export interface PrivateHostReleasePointer {
  portfolioId:string;
  generation:number;
  appliedRevocationGeneration:number;
  status:'LIVE_VERIFIED'|'UNPUBLISHED'|'PRIVATE'|'RESTRICTED';
  releaseSha256:string|null;
  files:ReadonlyArray<{path:string;sha256:string}>;
  readAtMs:number;
}
export interface PrivateHostVisibilityReader {
  /** Must perform a fresh authoritative read for EVERY canonical/asset request. */
  readLatest(portfolioId:string):Promise<unknown>;
}
export type PublicDeliveryDenialReason =
  'INVALID_REQUEST'|'PROVIDER_UNAVAILABLE'|'STATE_UNVERIFIED'|'NOT_LIVE'|
  'STALE_STATE'|'REVOCATION_NOT_APPLIED'|'RELEASE_MISMATCH'|'ASSET_NOT_ALLOWED';
export type PublicDeliveryDecision =
  | {status:'DENY';reason:PublicDeliveryDenialReason;deployable:false;publicUrl:null}
  | {status:'HOST_PROOF_REQUIRED';releaseSha256:string;path:string;sha256:string;
     deployable:false;publicUrl:null};

const record=(x:unknown):x is Record<string,unknown>=>
  x!==null&&typeof x==='object'&&!Array.isArray(x);
const digest=(x:unknown):x is string=>typeof x==='string'&&SHA256.test(x);
const uuid=(x:unknown):x is string=>typeof x==='string'&&UUID.test(x);
const deny=(reason:PublicDeliveryDenialReason):PublicDeliveryDecision=>
  ({status:'DENY',reason,deployable:false,publicUrl:null});
const assetPath=(path:unknown):path is string=>
  typeof path==='string'&&ASSET_PATH.test(path)&&!path.includes('..');

function validRequest(input:unknown):input is PublicDeliveryRequest {
  if(!record(input)||!uuid(input.portfolioId))return false;
  if(input.resource==='CANONICAL_HTML')
    return Object.keys(input).length===2;
  if(input.resource!=='DIRECT_ASSET'||Object.keys(input).length!==5||
     !digest(input.releaseSha256)||!digest(input.sha256)||!assetPath(input.path))
    return false;
  // Content-addressed asset names prevent accidental aliasing and ambiguous paths.
  return input.path.slice('assets/'.length, 'assets/'.length+64)===input.sha256;
}
function validState(input:unknown,portfolioId:string):input is PrivateHostReleasePointer {
  if(!record(input)||input.portfolioId!==portfolioId||
     !Number.isSafeInteger(input.generation)||Number(input.generation)<1||
     !Number.isSafeInteger(input.appliedRevocationGeneration)||
     Number(input.appliedRevocationGeneration)<0||
     !Number.isSafeInteger(input.readAtMs)||
     !['LIVE_VERIFIED','UNPUBLISHED','PRIVATE','RESTRICTED'].includes(String(input.status))||
     !(input.releaseSha256===null||digest(input.releaseSha256))||
     !Array.isArray(input.files)||input.files.length<1||input.files.length>MAX_FILES)
    return false;
  const paths=new Set<string>();
  for(const f of input.files as unknown[]){
    if(!record(f)||typeof f.path!=='string'||!digest(f.sha256)||
       !(f.path==='index.html'||assetPath(f.path))||paths.has(f.path))return false;
    if(f.path!=='index.html'&&f.path.slice(7,71)!==f.sha256)return false;
    paths.add(f.path);
  }
  return paths.has('index.html');
}

/**
 * This policy never returns bytes or a public URL, even on a positive match.
 * A future approved host must separately prove interception of canonical AND
 * direct immutable-asset requests, cache bypass, revocation and rollback races.
 */
export class PrivatePublicDeliveryPolicy {
  private readonly reader:PrivateHostVisibilityReader;
  private readonly now:()=>number;
  constructor(reader:PrivateHostVisibilityReader,now:()=>number=()=>Date.now()){
    this.reader=reader;this.now=now;
  }

  async check(request:unknown):Promise<PublicDeliveryDecision>{
    if(!validRequest(request))return deny('INVALID_REQUEST');
    let raw:unknown;
    try{raw=await this.reader.readLatest(request.portfolioId);}
    catch{return deny('PROVIDER_UNAVAILABLE');}
    if(!validState(raw,request.portfolioId))return deny('STATE_UNVERIFIED');
    const now=this.now();
    if(!Number.isSafeInteger(now)||raw.readAtMs>now||
       now-raw.readAtMs>MAX_AGE_MS)return deny('STALE_STATE');
    if(raw.appliedRevocationGeneration!==raw.generation)
      return deny('REVOCATION_NOT_APPLIED');
    if(raw.status!=='LIVE_VERIFIED'||raw.releaseSha256===null)
      return deny('NOT_LIVE');
    if(request.resource==='DIRECT_ASSET'){
      if(request.releaseSha256!==raw.releaseSha256)return deny('RELEASE_MISMATCH');
      if(!raw.files.some(f=>f.path===request.path&&f.sha256===request.sha256))
        return deny('ASSET_NOT_ALLOWED');
    }
    const selected=raw.files.find(f=>f.path===
      (request.resource==='CANONICAL_HTML'?'index.html':request.path));
    if(!selected)return deny('ASSET_NOT_ALLOWED');
    return {status:'HOST_PROOF_REQUIRED',releaseSha256:raw.releaseSha256,
      path:selected.path,sha256:selected.sha256,deployable:false,publicUrl:null};
  }
}


/**
 * B08 host-neutral *private* byte verifier. It bridges a fresh visibility
 * decision to exact immutable object bytes, then rechecks visibility AFTER
 * the asynchronous read. It is deliberately not an HTTP server, a signed
 * grant, an approval to enable CDN caching or proof of race-free publication.
 *
 * The trusted reader must enforce object-store access and read exact
 * content-addressed objects; it must never accept a path or digest supplied
 * directly by an unvalidated public request. An approved public host must
 * additionally prove final-response revocation, atomic pointer changes,
 * no cache bypass and end-to-end access denial.
 */
export interface TrustedPrivateReleaseByteReader {
  readImmutable(input:{
    portfolioId:string;
    releaseSha256:string;
    path:string;
    expectedSha256:string;
  }):Promise<unknown>;
}
export type PrivateByteVerificationReason =
  'DENIED_BY_VISIBILITY'|'UNSAFE_FILE_TYPE'|'READER_UNAVAILABLE'|
  'INVALID_FILE_BYTES'|'BYTES_TOO_LARGE'|'BYTE_HASH_MISMATCH'|
  'POINTER_CHANGED';
export type PrivateDeliveryByteResult =
  | {status:'DENY';reason:PrivateByteVerificationReason;
     servingAllowed:false;publicUrl:null;hostRevocationVerified:false}
  | {status:'PRIVATE_BYTES_VERIFIED';releaseSha256:string;path:string;sha256:string;
     mimeType:'text/html; charset=utf-8'|'image/png';bytes:Uint8Array;
     servingAllowed:false;publicUrl:null;hostRevocationVerified:false};

const MAX_PRIVATE_HTML=750000;
const MAX_PRIVATE_PNG=5*1024*1024;
const PRIVATE_PNG=/^assets\/[0-9a-f]{64}\.png$/;
const PNG_SIGNATURE=Uint8Array.of(137,80,78,71,13,10,26,10);
const deniedBytes=(reason:PrivateByteVerificationReason):PrivateDeliveryByteResult=>
  ({status:'DENY',reason,servingAllowed:false,publicUrl:null,
    hostRevocationVerified:false});

export class PrivateVerifiedReleaseByteGate {
  private readonly policy:PrivatePublicDeliveryPolicy;
  private readonly reader:TrustedPrivateReleaseByteReader;

  constructor(policy:PrivatePublicDeliveryPolicy,reader:TrustedPrivateReleaseByteReader){
    this.policy=policy;this.reader=reader;
  }

  async inspect(request:unknown):Promise<PrivateDeliveryByteResult>{
    // First authoritative read: malformed requests and unpublished pointers
    // must not reach the private immutable object store at all.
    const first=await this.policy.check(request);
    if(first.status!=='HOST_PROOF_REQUIRED')
      return deniedBytes('DENIED_BY_VISIBILITY');

    // This initial B08 gate accepts ONLY scriptless HTML and sanitized PNG.
    // Existing policy paths for CSS, JPEG, WebP and fonts need independent
    // content-safety proof; never implicitly enable them in a read adapter.
    const isHtml=first.path==='index.html';
    const isPng=PRIVATE_PNG.test(first.path)&&
      first.path.slice(7,71)===first.sha256;
    if(!isHtml&&!isPng)return deniedBytes('UNSAFE_FILE_TYPE');

    let raw:unknown;
    try{
      raw=await this.reader.readImmutable({
        portfolioId:(request as PublicDeliveryRequest).portfolioId,
        releaseSha256:first.releaseSha256,path:first.path,
        expectedSha256:first.sha256
      });
    }catch{return deniedBytes('READER_UNAVAILABLE');}

    // Defensive copy: readers may return mutable Storage buffers which could
    // change while hashing or after this method returns.
    if(!(raw instanceof Uint8Array)||raw.byteLength===0)
      return deniedBytes('INVALID_FILE_BYTES');
    const maxBytes=isHtml?MAX_PRIVATE_HTML:MAX_PRIVATE_PNG;
    if(raw.byteLength>maxBytes)return deniedBytes('BYTES_TOO_LARGE');
    const bytes=Uint8Array.from(raw);
    if(isPng&&!PNG_SIGNATURE.every((value,i)=>bytes[i]===value))
      return deniedBytes('INVALID_FILE_BYTES');
    if(isHtml){
      try{
        const html=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
        if(!html.startsWith('<!doctype html>')||html.includes('\u0000')||
           !html.includes('noindex,nofollow,noarchive')||
           !html.includes('script-src &#39;none&#39;'))
          return deniedBytes('INVALID_FILE_BYTES');
      }catch{return deniedBytes('INVALID_FILE_BYTES');}
    }

    let digest:string;
    try{
      const bytesHash=await crypto.subtle.digest(
        'SHA-256',bytes as Uint8Array<ArrayBuffer>);
      digest=Array.from(new Uint8Array(bytesHash),
        b=>b.toString(16).padStart(2,'0')).join('');
    }catch{return deniedBytes('INVALID_FILE_BYTES');}
    if(digest!==first.sha256)return deniedBytes('BYTE_HASH_MISMATCH');

    // Second *independent* trusted pointer read. A withdrawal, moderation
    // restriction, rollback or provider failure during blob loading revokes
    // this candidate. Even two reads cannot prove a future HTTP send is safe.
    const after=await this.policy.check(request);
    if(after.status!=='HOST_PROOF_REQUIRED'||
       after.releaseSha256!==first.releaseSha256||
       after.path!==first.path||after.sha256!==first.sha256)
      return deniedBytes('POINTER_CHANGED');

    return {status:'PRIVATE_BYTES_VERIFIED',
      releaseSha256:first.releaseSha256,path:first.path,
      sha256:first.sha256,mimeType:isHtml?'text/html; charset=utf-8':'image/png',
      bytes,servingAllowed:false,publicUrl:null,hostRevocationVerified:false};
  }
}
