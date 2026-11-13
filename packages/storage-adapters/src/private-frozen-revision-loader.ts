import { validateSnapshot, type PortfolioSnapshot } from '../../editor-core/src/portfolio-revision-transactions.ts';
import { ContractError } from '../../contracts/src/project.ts';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;

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
type JsonRecord=Record<string,unknown>;
function row(value:unknown):JsonRecord|null {
  return !!value&&typeof value==='object'&&!Array.isArray(value)?value as JsonRecord:null;
}
function exactlyOne(value:unknown):JsonRecord|null {
  return Array.isArray(value)&&value.length===1?row(value[0]):null;
}

/**
 * Owner-JWT only, read-only bridge from immutable DB revision to B4 preflight.
 * It verifies DB foreign keys/digests but does not independently recompute
 * PostgreSQL jsonb::text SHA-256; that digest is trusted from the same DB.
 * Do not use this as public-serving authority or reviewer-token validation.
 */
export class SupabasePrivateFrozenRevisionLoader {
  private readonly origin:string;
  private readonly key:string;
  private readonly token:()=>Promise<string|null>;
  private readonly http:typeof fetch;
  constructor(origin:string,publishableKey:string,token:()=>Promise<string|null>,http:typeof fetch=fetch) {
    const u=new URL(origin);
    if((u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))||
       u.username||u.password||u.pathname!=='/'||u.search||u.hash)
      throw new ContractError('VALIDATION','Only a trusted Supabase origin is permitted.');
    if(!publishableKey)throw new ContractError('VALIDATION','Publishable key is required.');
    this.origin=u.origin;this.key=publishableKey;this.token=token;this.http=http;
  }
  private async read(path:string,jwt:string):Promise<JsonRecord|null> {
    let response:Response;
    try{
      response=await this.http(this.origin+'/rest/v1/'+path,{
        method:'GET',headers:{apikey:this.key,Authorization:'Bearer '+jwt,
          Accept:'application/json','Cache-Control':'no-store'},
        cache:'no-store',credentials:'omit',redirect:'error'
      });
    }catch{
      throw new FrozenLoadError('PROVIDER_UNAVAILABLE','Private database is unreachable.');
    }
    if(response.status===401||response.status===403)
      throw new FrozenLoadError('AUTH_EXPIRED','Session was rejected.');
    if(!response.ok)
      throw new FrozenLoadError('PROVIDER_UNAVAILABLE','Private read failed.');
    const raw:unknown=await response.json().catch(()=>null);
    if(!Array.isArray(raw))
      throw new FrozenLoadError('INTEGRITY_FAILED','Private REST response was not a row list.');
    return exactlyOne(raw);
  }

  async load(requestId:string):Promise<LoadedPrivateFrozenRevision> {
    if(!UUID.test(requestId))
      throw new ContractError('VALIDATION','Invalid frozen request identifier.');
    const jwt=await this.token();
    if(!jwt)throw new FrozenLoadError('AUTH_EXPIRED','Sign in before loading private preview.');
    const request=await this.read(
      'private_release_requests?select=id,portfolio_id,revision,snapshot_sha256,visibility_intent,status'+
      '&id=eq.'+encodeURIComponent(requestId)+'&limit=2',jwt);
    if(!request)throw new FrozenLoadError('NOT_FOUND','Private frozen request was not found.');
    const portfolioId=request.portfolio_id;
    const revision=request.revision;
    const sha=request.snapshot_sha256;
    if(request.id!==requestId||typeof portfolioId!=='string'||!UUID.test(portfolioId)||
       typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<1||
       typeof sha!=='string'||!SHA.test(sha)||
       request.status!=='FROZEN'||!['PUBLIC','UNLISTED'].includes(String(request.visibility_intent)))
      throw new FrozenLoadError('INTEGRITY_FAILED','Frozen request contains invalid pins.');
    const portfolio=await this.read(
      'portfolios?select=id,trashed_at&id=eq.'+encodeURIComponent(portfolioId)+'&limit=2',jwt);
    if(!portfolio||portfolio.id!==portfolioId||portfolio.trashed_at!==null)
      throw new FrozenLoadError('NOT_FOUND','Frozen portfolio is missing or trashed.');
    const revisionRow=await this.read(
      'portfolio_revisions?select=portfolio_id,revision,snapshot_sha256,snapshot'+
      '&portfolio_id=eq.'+encodeURIComponent(portfolioId)+
      '&revision=eq.'+revision+'&limit=2',jwt);
    if(!revisionRow||revisionRow.portfolio_id!==portfolioId||
       revisionRow.revision!==revision||revisionRow.snapshot_sha256!==sha)
      throw new FrozenLoadError('INTEGRITY_FAILED','Frozen pin differs from the stored immutable revision.');
    try{validateSnapshot(revisionRow.snapshot as PortfolioSnapshot);}
    catch{throw new FrozenLoadError('INTEGRITY_FAILED','Stored revision snapshot is not supported.');}
    return {
      snapshot:revisionRow.snapshot as PortfolioSnapshot,
      frozen:{portfolioId,revision,snapshotSha256:sha,
        visibilityIntent:request.visibility_intent as 'PUBLIC'|'UNLISTED',
        status:'FROZEN',publicUrl:null},
      loadedPortfolioId:portfolioId,loadedRevision:revision,loadedSnapshotSha256:sha
    };
  }
}
