import { ContractError, isSafeSupabaseClientKey } from '../../contracts/src/project.ts';
import {createPortfolioPresetDraft,type PortfolioPresetId} from '../../editor-core/src/managed-project-files.ts';
import {validateSnapshot,type PortfolioSnapshot} from '../../editor-core/src/portfolio-revision-transactions.ts';

type TokenSupplier = () => Promise<string|null>;
type ServiceErrorCode = 'AUTH_EXPIRED'|'REVISION_CONFLICT'|'PROVIDER_UNAVAILABLE'|'VALIDATION';

export class RevisionStorageError extends Error {
  readonly code: ServiceErrorCode;
  constructor(code:ServiceErrorCode,message:string) {
    super(message);this.name='RevisionStorageError';this.code=code;
  }
}

export interface CloudCommitReceipt {
  portfolioId:string;
  revision:number;
  snapshotSha256:string;
  alreadyCommitted:boolean;
}

export class SupabasePortfolioRevisionStore {
  private readonly origin:string;
  private readonly key:string;
  private readonly token:TokenSupplier;
  private readonly http:typeof fetch;

  constructor(origin:string,key:string,token:TokenSupplier,http:typeof fetch=fetch) {
    const u=new URL(origin);
    if((u.protocol!=='https:' && !(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))||
        u.username||u.password||u.pathname!=='/'||u.search||u.hash)
      throw new RevisionStorageError('VALIDATION','Invalid Supabase origin.');
    if(!key)throw new RevisionStorageError('VALIDATION','A publishable API key is required.');
    if(!isSafeSupabaseClientKey(key))
      throw new RevisionStorageError('VALIDATION','A public Supabase API key is required.');
    this.origin=u.origin;
    this.key=key;this.token=token;this.http=http;
  }

  private async request(path:string,method:string,payload?:unknown):Promise<unknown> {
    const jwt=await this.token();
    if(!jwt)throw new RevisionStorageError('AUTH_EXPIRED','Sign in before cloud editing.');
    const headers:Record<string,string>={apikey:this.key,Authorization:'Bearer '+jwt};
    if(payload!==undefined){
      headers['Content-Type']='application/json';
      headers.Prefer='return=representation';
    }
    let response:Response;
    try{
      response=await this.http(this.origin+path,{
        method,headers,body:payload===undefined?undefined:JSON.stringify(payload),
        credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15_000)
      });
    }catch{
      throw new RevisionStorageError('PROVIDER_UNAVAILABLE','Cloud is unreachable; preserve the local draft.');
    }
    if(!response.ok){
      const details=await response.json().catch(()=>null) as {code?:string;message?:string}|null;
      if(details?.code==='40001'||details?.message==='REVISION_CONFLICT')
        throw new RevisionStorageError('REVISION_CONFLICT','Cloud head changed; compare before retrying.');
      if(response.status===401||response.status===403)
        throw new RevisionStorageError('AUTH_EXPIRED','Cloud authorization failed.');
      throw new RevisionStorageError('PROVIDER_UNAVAILABLE','Cloud write not accepted; local draft remains.');
    }
    return response.status===204?null:response.json();
  }

  async createPrivatePortfolio(ownerUserId:string,input:{slug:string;title:string;templateId:string}):Promise<string> {
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)||input.slug.length<3||input.slug.length>64||
       !input.title.trim()||input.title.trim().length>120||
       !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.templateId))
      throw new RevisionStorageError('VALIDATION','Invalid portfolio metadata.');
    const rows=await this.request('/rest/v1/portfolios?select=id','POST',{
      owner_user_id:ownerUserId,slug:input.slug,title:input.title.trim(),template_id:input.templateId
    }) as Array<{id:string}>;
    if(!Array.isArray(rows)||rows.length!==1||!rows[0]?.id)
      throw new RevisionStorageError('PROVIDER_UNAVAILABLE','Portfolio creation not acknowledged.');
    return rows[0].id;
  }

  /** Retry a preset's first write with the original operation ID to preserve the draft. */
  async initializePreset(portfolioId:string,operationId:string,preset:PortfolioPresetId):Promise<CloudCommitReceipt> {
    const snapshot=createPortfolioPresetDraft(preset);
    const rows=await this.request('/rest/v1/portfolios?id=eq.'+encodeURIComponent(portfolioId)+
      '&trashed_at=is.null&select=id,template_id&limit=1','GET') as {id:string;template_id:string}[];
    if(!Array.isArray(rows)||rows.length!==1||rows[0]?.id!==portfolioId||rows[0]?.template_id!==preset)
      throw new RevisionStorageError('VALIDATION','The accessible draft must have the selected preset.');
    return this.commit(portfolioId,operationId,0,snapshot);
  }

  async commit(portfolioId:string,operationId:string,baseRevision:number,snapshot:PortfolioSnapshot):Promise<CloudCommitReceipt> {
    if(!Number.isSafeInteger(baseRevision)||baseRevision<0)
      throw new RevisionStorageError('VALIDATION','Invalid base revision.');
    validateSnapshot(snapshot);
    const receipt=await this.request('/rest/v1/rpc/commit_portfolio_revision','POST',{
      p_portfolio_id:portfolioId,p_operation_id:operationId,
      p_base_revision:baseRevision,p_snapshot:snapshot
    }) as CloudCommitReceipt|null;
    if(!receipt||receipt.portfolioId!==portfolioId||
       !Number.isSafeInteger(receipt.revision)||receipt.revision<=baseRevision||
       !/^[0-9a-f]{64}$/.test(receipt.snapshotSha256))
      throw new RevisionStorageError('PROVIDER_UNAVAILABLE','Cloud commit receipt is invalid.');
    return receipt;
  }

  async loadHead(portfolioId:string):Promise<{revision:number;snapshot:PortfolioSnapshot|null}> {
    const query='?id=eq.'+encodeURIComponent(portfolioId)+'&trashed_at=is.null&select=id,head_revision&limit=1';
    const rows=await this.request('/rest/v1/portfolios'+query,'GET') as Array<{head_revision:number}>;
    const row=Array.isArray(rows)&&rows.length===1?rows[0]:undefined;
    if(!row||!Number.isSafeInteger(row.head_revision))
      throw new RevisionStorageError('PROVIDER_UNAVAILABLE','Portfolio not found or inaccessible.');
    const revision=row.head_revision;
    if(revision===0)return {revision,snapshot:null};
    const revs=await this.request('/rest/v1/portfolio_revisions?portfolio_id=eq.'+
      encodeURIComponent(portfolioId)+'&revision=eq.'+revision+'&select=snapshot&limit=1','GET') as Array<{snapshot:PortfolioSnapshot}>;
    const selected=Array.isArray(revs)&&revs.length===1?revs[0]:undefined;
    if(!selected)
      throw new RevisionStorageError('PROVIDER_UNAVAILABLE','Head points to unavailable revision.');
    validateSnapshot(selected.snapshot);
    return {revision,snapshot:selected.snapshot};
  }
}

