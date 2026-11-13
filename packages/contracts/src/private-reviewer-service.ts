import { ContractError } from './project.ts';

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

/** Owner-only registration. This does NOT issue a usable public staging URL. */
export class SupabasePrivateReviewerService {
  private readonly origin:string;
  private readonly key:string;
  private readonly token:()=>Promise<string|null>;
  private readonly fetcher:typeof fetch;
  constructor(origin:string,key:string,token:()=>Promise<string|null>,fetcher:typeof fetch=fetch){
    const url=new URL(origin);
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))
      throw new ContractError('VALIDATION','Use a trusted Supabase HTTPS endpoint.');
    if(!key)throw new ContractError('VALIDATION','Publishable key is required.');
    this.origin=origin.replace(/\/$/,'');this.key=key;this.token=token;this.fetcher=fetcher;
  }
  private async rpc(name:string,payload:Record<string,unknown>):Promise<unknown>{
    const jwt=await this.token();
    if(!jwt)throw new ReviewerGrantError('AUTH_EXPIRED','Sign in to manage private review grants.');
    let response:Response;
    try{
      response=await this.fetcher(this.origin+'/rest/v1/rpc/'+name,{
        method:'POST',
        headers:{apikey:this.key,Authorization:'Bearer '+jwt,'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });
    }catch{
      throw new ReviewerGrantError('PROVIDER_UNAVAILABLE','Review grant request was not acknowledged.');
    }
    if(!response.ok){
      const reason=await response.json().catch(()=>null) as {message?:string}|null;
      if(reason?.message==='REVIEWER_GRANT_QUOTA_REACHED')
        throw new ReviewerGrantError('QUOTA_EXCEEDED','Too many active private reviewer grants.');
      if(response.status===401)throw new ReviewerGrantError('AUTH_EXPIRED','Session expired.');
      if(response.status===403)throw new ReviewerGrantError('FORBIDDEN','Not permitted to manage that grant.');
      throw new ReviewerGrantError('PROVIDER_UNAVAILABLE','Reviewer grant operation failed.');
    }
    return response.json().catch(()=>{throw new ReviewerGrantError('INVALID_ACK','Invalid review response.');});
  }
  async issue(requestId:string,operationId:string,validMinutes:number):Promise<PrivateReviewerGrant>{
    if(!UUID.test(requestId)||!UUID.test(operationId)||
      !Number.isSafeInteger(validMinutes)||validMinutes<15||validMinutes>10080)
      throw new ContractError('VALIDATION','Invalid review target, operation, or duration.');
    const ack=await this.rpc('issue_private_reviewer_grant',{
      p_request_id:requestId,p_operation_id:operationId,p_valid_minutes:validMinutes
    }) as PrivateReviewerGrant|null;
    if(!ack||!UUID.test(ack.grantId)||ack.requestId!==requestId||
       ack.status!=='REGISTERED_UNSERVABLE'||typeof ack.alreadyRegistered!=='boolean'||
       !Number.isFinite(Date.parse(ack.expiresAt))||
       (ack.alreadyRegistered ? ack.rawToken!==null : typeof ack.rawToken!=='string'||!TOKEN.test(ack.rawToken)))
      throw new ReviewerGrantError('INVALID_ACK','Reviewer grant was not verified.');
    return ack; // Raw token appears once. Do not persist it or log it.
  }
  async revoke(grantId:string):Promise<PrivateReviewerRevocation>{
    if(!UUID.test(grantId))throw new ContractError('VALIDATION','Invalid reviewer grant ID.');
    const ack=await this.rpc('revoke_private_reviewer_grant',{p_grant_id:grantId}) as PrivateReviewerRevocation|null;
    if(!ack||ack.grantId!==grantId||ack.status!=='REVOKED'||ack.publicRevocationVerified!==false)
      throw new ReviewerGrantError('INVALID_ACK','Revocation was not acknowledged.');
    return ack;
  }
}
