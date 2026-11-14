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
