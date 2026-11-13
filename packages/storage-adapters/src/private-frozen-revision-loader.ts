import { validateSnapshot, type PortfolioSnapshot } from '../../editor-core/src/portfolio-revision-transactions.ts';
import { ContractError } from '../../contracts/src/project.ts';
import type { SafePreviewInput } from '../../editor-core/src/publish-preflight.ts';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const encoder=new TextEncoder();
const MAX_CANONICAL_BYTES=12*1024*1024;

interface PrivateAttestation {
  portfolioId:string;revision:number;snapshotSha256:string;
  visibilityIntent:'PUBLIC'|'UNLISTED';
}
const verifiedSnapshots=new WeakMap<PortfolioSnapshot,PrivateAttestation>();
function freezeJson(value:unknown):void {
  if(value!==null&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value))freezeJson(child);
    Object.freeze(value);
  }
}
/** A private, process-local proof that the renderer is using the exact owner-RPC bytes. */
export function assertAttestedPrivateFrozenRevision(input:SafePreviewInput):void {
  const proof=input?.snapshot&&verifiedSnapshots.get(input.snapshot);
  const frozen=input?.frozen;
  if(!proof||!frozen||frozen.portfolioId!==proof.portfolioId||
     frozen.revision!==proof.revision||frozen.snapshotSha256!==proof.snapshotSha256||
     frozen.visibilityIntent!==proof.visibilityIntent||frozen.status!=='FROZEN'||
     frozen.publicUrl!==null||input.loadedPortfolioId!==proof.portfolioId||
     input.loadedRevision!==proof.revision||input.loadedSnapshotSha256!==proof.snapshotSha256)
    throw new ContractError('VALIDATION','Private artifact requires an intact attested frozen revision.');
}

export class FrozenLoadError extends Error {
  readonly code:'AUTH_EXPIRED'|'NOT_FOUND'|'INTEGRITY_FAILED'|'PROVIDER_UNAVAILABLE';
  constructor(code:FrozenLoadError['code'],message:string){
    super(message);this.name='FrozenLoadError';this.code=code;
  }
}
export interface LoadedPrivateFrozenRevision {
  snapshot:PortfolioSnapshot;
  frozen:{
    portfolioId:string;
    revision:number;
    snapshotSha256:string;
    visibilityIntent:'PUBLIC'|'UNLISTED';
    status:'FROZEN';
    publicUrl:null;
  };
  loadedPortfolioId:string;
  loadedRevision:number;
  loadedSnapshotSha256:string;
}
const record=(x:unknown):x is Record<string,unknown>=>
  !!x&&typeof x==='object'&&!Array.isArray(x);

/**
 * Authenticated owner-only B4 preflight input. One SQL RPC locks the portfolio,
 * checks Trash and recomputes the canonical snapshot SHA within one transaction.
 * This is NOT an authorization token for public delivery, staging or publishing:
 * revocation after the read remains a separate host-level problem.
 */
export class SupabasePrivateFrozenRevisionLoader {
  private readonly origin:string;
  private readonly key:string;
  private readonly token:()=>Promise<string|null>;
  private readonly http:typeof fetch;
  constructor(origin:string,publishableKey:string,token:()=>Promise<string|null>,http:typeof fetch=fetch) {
    let u:URL;
    try{u=new URL(origin);}
    catch{throw new ContractError('VALIDATION','Only a trusted Supabase API origin is permitted.');}
    if((u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))||
       u.username||u.password||u.pathname!=='/'||u.search||u.hash)
      throw new ContractError('VALIDATION','Only a trusted Supabase API origin is permitted.');
    if(typeof publishableKey!=='string'||!publishableKey.trim())
      throw new ContractError('VALIDATION','Publishable key is required.');
    this.origin=u.origin;this.key=publishableKey;this.token=token;this.http=http;
  }
  async load(requestId:string):Promise<LoadedPrivateFrozenRevision> {
    if(typeof requestId!=='string'||!UUID.test(requestId))
      throw new ContractError('VALIDATION','Invalid frozen request identifier.');
    const jwt=await this.token();
    if(!jwt)throw new FrozenLoadError('AUTH_EXPIRED','Sign in before loading private preview.');
    let response:Response;
    try{
      response=await this.http(this.origin+'/rest/v1/rpc/load_private_frozen_revision',{
        method:'POST',
        headers:{apikey:this.key,Authorization:'Bearer '+jwt,
          Accept:'application/json','Content-Type':'application/json',
          'Cache-Control':'no-store'},
        body:JSON.stringify({p_request_id:requestId}),
        cache:'no-store',credentials:'omit',redirect:'error'
      });
    }catch{
      throw new FrozenLoadError('PROVIDER_UNAVAILABLE','Private database is unreachable.');
    }
    if(!response.ok){
      const problem:unknown=await response.json().catch(()=>null);
      const message=record(problem)?problem.message:null;
      if(message==='PRIVATE_FROZEN_REVISION_NOT_FOUND')
        throw new FrozenLoadError('NOT_FOUND','Private frozen request was not found.');
      if(message==='PRIVATE_FROZEN_REVISION_INTEGRITY')
        throw new FrozenLoadError('INTEGRITY_FAILED','Frozen revision integrity check failed.');
      if(response.status===401||response.status===403)
        throw new FrozenLoadError('AUTH_EXPIRED','Session was rejected or access denied.');
      throw new FrozenLoadError('PROVIDER_UNAVAILABLE','Private frozen revision read failed.');
    }
    const raw:unknown=await response.json().catch(()=>null);
    if(!record(raw)||raw.requestId!==requestId||
       typeof raw.portfolioId!=='string'||!UUID.test(raw.portfolioId)||
       typeof raw.revision!=='number'||!Number.isSafeInteger(raw.revision)||raw.revision<1||
       typeof raw.snapshotSha256!=='string'||!SHA.test(raw.snapshotSha256)||
       (raw.visibilityIntent!=='PUBLIC'&&raw.visibilityIntent!=='UNLISTED')||
       raw.status!=='FROZEN'||raw.publicUrl!==null)
      throw new FrozenLoadError('INTEGRITY_FAILED','Invalid atomic frozen revision receipt.');
    // The server hashes PostgreSQL jsonb::text, not JavaScript JSON.stringify.
    // Hash those exact server-provided bytes before trusting a renderable object.
    if(typeof raw.snapshotCanonicalJson!=='string'||
       encoder.encode(raw.snapshotCanonicalJson).byteLength>MAX_CANONICAL_BYTES)
      throw new FrozenLoadError('INTEGRITY_FAILED','Canonical snapshot evidence is missing or oversized.');
    const canonicalBytes=encoder.encode(raw.snapshotCanonicalJson);
    const digest=await crypto.subtle.digest('SHA-256',canonicalBytes);
    const canonicalSha=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    if(canonicalSha!==raw.snapshotSha256)
      throw new FrozenLoadError('INTEGRITY_FAILED','Canonical frozen snapshot digest does not match.');
    let snapshot:PortfolioSnapshot;
    try{
      snapshot=JSON.parse(raw.snapshotCanonicalJson) as PortfolioSnapshot;
      validateSnapshot(snapshot);
      if(JSON.stringify(snapshot)!==JSON.stringify(raw.snapshot))
        throw new Error('Response snapshot disagrees with canonical evidence.');
    }catch{
      throw new FrozenLoadError('INTEGRITY_FAILED','Stored revision snapshot is not supported or disagrees with its digest.');
    }
    // Only this newly parsed and recursively frozen object gets an attestation.
    // A clone or caller-reconstructed object cannot inherit the WeakMap proof.
    freezeJson(snapshot);
    verifiedSnapshots.set(snapshot,{
      portfolioId:raw.portfolioId,revision:raw.revision,
      snapshotSha256:raw.snapshotSha256,visibilityIntent:raw.visibilityIntent
    });
    return {
      snapshot,
      frozen:{portfolioId:raw.portfolioId,revision:raw.revision,
        snapshotSha256:raw.snapshotSha256,
        visibilityIntent:raw.visibilityIntent as 'PUBLIC'|'UNLISTED',
        status:'FROZEN',publicUrl:null},
      loadedPortfolioId:raw.portfolioId,
      loadedRevision:raw.revision,
      loadedSnapshotSha256:raw.snapshotSha256
    };
  }
}
