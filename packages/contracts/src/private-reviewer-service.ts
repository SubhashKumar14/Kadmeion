import { ContractError, isSafeSupabaseClientKey } from './project.ts';
import { fetchBoundedPrivateReleaseRpc } from './private-release-service.ts';

export interface PrivateReviewerGrant {
  grantId:string; requestId:string; rawToken:string|null;
  expiresAt:string; status:'REGISTERED_UNSERVABLE'; alreadyRegistered:boolean;
}
export interface PrivateReviewerRevocation {
  grantId:string;status:'REVOKED';publicRevocationVerified:false;
}
export class ReviewerGrantError extends Error {
  readonly code:'AUTH_EXPIRED'|'FORBIDDEN'|'PROVIDER_UNAVAILABLE'|'INVALID_ACK'|'QUOTA_EXCEEDED';
  constructor(code:ReviewerGrantError['code'],message:string){
    super(message);this.name='ReviewerGrantError';this.code=code;
  }
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN=/^[0-9a-f]{64}$/;
const record=(value:unknown):value is Record<string,unknown>=>
  value!==null&&typeof value==='object'&&!Array.isArray(value);
const uuid=(value:unknown):value is string=>typeof value==='string'&&UUID.test(value);

/** Relative reviewer route for the one-time token from an unexpired new grant. */
export function reviewerSharePath(grant:PrivateReviewerGrant,now=Date.now()):string {
  if(!grant||grant.status!=='REGISTERED_UNSERVABLE'||grant.alreadyRegistered!==false||
     !UUID.test(grant.grantId)||typeof grant.rawToken!=='string'||!TOKEN.test(grant.rawToken)||
     !Number.isFinite(now)||!(Date.parse(grant.expiresAt)>now))
    throw new ContractError('VALIDATION','A new, unexpired reviewer credential is required.');
  return '/r/'+grant.grantId+'.'+grant.rawToken;
}

/** Owner-only registration. This does NOT issue a usable public staging URL. */
export class SupabasePrivateReviewerService {
  private readonly origin:string;
  private readonly key:string;
  private readonly token:()=>Promise<string|null>;
  private readonly fetcher:typeof fetch;
  constructor(origin:string,key:string,token:()=>Promise<string|null>,fetcher:typeof fetch=fetch){
    let url:URL;
    try{url=new URL(origin);}
    catch{throw new ContractError('VALIDATION','Use a trusted Supabase API origin.');}
    if((url.protocol!=='https:'&&!(url.protocol==='http:'&&
      ['localhost','127.0.0.1'].includes(url.hostname)))||
      url.username||url.password||url.pathname!=='/'||url.search||url.hash)
      throw new ContractError('VALIDATION','Use a trusted Supabase API origin.');
    if(typeof key!=='string'||!key.trim())
      throw new ContractError('VALIDATION','Publishable key is required.');
    if(!isSafeSupabaseClientKey(key))
      throw new ContractError('VALIDATION','A public Supabase API key is required.');
    this.origin=url.origin;this.key=key;this.token=token;this.fetcher=fetcher;
  }
  private async rpc(name:string,payload:Record<string,unknown>):Promise<unknown>{
    const jwt=await this.token();
    if(!jwt)throw new ReviewerGrantError('AUTH_EXPIRED','Sign in to manage private review grants.');
    let response:Awaited<ReturnType<typeof fetchBoundedPrivateReleaseRpc>>;
    try{
      response=await fetchBoundedPrivateReleaseRpc(this.fetcher,this.origin+'/rest/v1/rpc/'+name,
        {apikey:this.key,Authorization:'Bearer '+jwt,'Content-Type':'application/json',Accept:'application/json'},
        payload);
    }catch{
      throw new ReviewerGrantError('PROVIDER_UNAVAILABLE','Review grant request was not acknowledged.');
    }
    if(await this.token()!==jwt)
      throw new ReviewerGrantError('AUTH_EXPIRED','Session changed while managing reviewer access.');
    if(!response.ok){
      const reason=record(response.body)?response.body:null;
      if(reason?.message==='REVIEWER_GRANT_QUOTA_REACHED')
        throw new ReviewerGrantError('QUOTA_EXCEEDED','Too many active private reviewer grants.');
      if(response.status===401)throw new ReviewerGrantError('AUTH_EXPIRED','Session expired.');
      if(response.status===403)throw new ReviewerGrantError('FORBIDDEN','Not permitted to manage that grant.');
      throw new ReviewerGrantError('PROVIDER_UNAVAILABLE','Reviewer grant operation failed.');
    }
    return response.body;
  }
  async issue(requestId:string,operationId:string,validMinutes:number):Promise<PrivateReviewerGrant>{
    if(!UUID.test(requestId)||!UUID.test(operationId)||
      !Number.isSafeInteger(validMinutes)||validMinutes<15||validMinutes>10080)
      throw new ContractError('VALIDATION','Invalid review target, operation, or duration.');
    const ack=await this.rpc('issue_private_reviewer_grant',{
      p_request_id:requestId,p_operation_id:operationId,p_valid_minutes:validMinutes
    });
    if(!record(ack)||!uuid(ack.grantId)||ack.requestId!==requestId||
       ack.status!=='REGISTERED_UNSERVABLE'||typeof ack.alreadyRegistered!=='boolean'||
       typeof ack.expiresAt!=='string'||!Number.isFinite(Date.parse(ack.expiresAt))||
       (ack.alreadyRegistered ? ack.rawToken!==null : typeof ack.rawToken!=='string'||!TOKEN.test(ack.rawToken)))
      throw new ReviewerGrantError('INVALID_ACK','Reviewer grant was not verified.');
    // Raw token appears once; return only the documented typed fields.
    return {grantId:ack.grantId,requestId,rawToken:ack.rawToken as string|null,
      expiresAt:ack.expiresAt,status:'REGISTERED_UNSERVABLE',alreadyRegistered:ack.alreadyRegistered};
  }
  async revoke(grantId:string):Promise<PrivateReviewerRevocation>{
    if(!UUID.test(grantId))throw new ContractError('VALIDATION','Invalid reviewer grant ID.');
    const ack=await this.rpc('revoke_private_reviewer_grant',{p_grant_id:grantId});
    if(!record(ack)||ack.grantId!==grantId||ack.status!=='REVOKED'||ack.publicRevocationVerified!==false)
      throw new ReviewerGrantError('INVALID_ACK','Revocation was not acknowledged.');
    return {grantId,status:'REVOKED',publicRevocationVerified:false};
  }
}
