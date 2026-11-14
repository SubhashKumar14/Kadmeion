import { ContractError } from './project.ts';

export type AccountErasureRequestStatus = 'REQUESTED_BLOCKED' | 'WITHDRAWN';
export interface AccountErasureReceipt {
  requestId:string;
  status:AccountErasureRequestStatus;
  alreadyRequested?:boolean;
  alreadyWithdrawn?:boolean;
  publicRevocationVerified:false;
  reauthVerified:false;
  accessTerminated:false;
  erasureExecuted:false;
  retentionVerified:false;
}
export interface AccountExitPreflight {
  status:'INVENTORY_ONLY';
  maxCountPerCategory:1000;
  countsCapped:boolean;
  counts:{
    projects:number;portfolios:number;portfolioRevisions:number;
    projectExposureIntents:number;projectAssetMetadata:number;
    frozenReleaseRequests:number;reviewerGrants:number;trashRecords:number;
    accountExitRequests:number;
  };
  liveSessionChecked:true;
  freshSignInCandidate:boolean;
  recentReauthVerified:false;
  publicRoutes:'UNVERIFIED';
  objectStorage:'METADATA_ONLY';
  exports:'NOT_TRACKED';
  integrations:'NOT_TRACKED';
  deletionAllowed:false;
}
export interface PrivateAccountErasureEntry {
  id:string;
  status:AccountErasureRequestStatus;
  created_at:string;
  withdrawn_at:string|null;
  public_revocation_verified:false;
  reauth_verified:false;
  access_terminated:false;
  erasure_executed:false;
  retention_verified:false;
}
export class PrivateAccountErasureError extends Error {
  readonly code:'AUTH_EXPIRED'|'FORBIDDEN'|'VALIDATION'|'CONFLICT'|
    'QUOTA_EXCEEDED'|'PROVIDER_UNAVAILABLE'|'INVALID_ACK';
  constructor(code:PrivateAccountErasureError['code'],message:string){
    super(message);this.name='PrivateAccountErasureError';this.code=code;
  }
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record=(x:unknown):x is Record<string,unknown> =>
  x!==null&&typeof x==='object'&&!Array.isArray(x);
const uuid=(x:unknown):x is string=>typeof x==='string'&&UUID.test(x);
const date=(x:unknown):x is string=>
  typeof x==='string'&&x.length<=64&&Number.isFinite(Date.parse(x));
const status=(x:unknown):x is AccountErasureRequestStatus=>
  x==='REQUESTED_BLOCKED'||x==='WITHDRAWN';
function proofFlags(x:Record<string,unknown>,snake=false):boolean {
  const keys=snake
    ? ['public_revocation_verified','reauth_verified','access_terminated','erasure_executed','retention_verified']
    : ['publicRevocationVerified','reauthVerified','accessTerminated','erasureExecuted','retentionVerified'];
  return keys.every(k=>x[k]===false);
}
function receipt(raw:unknown,expectedId?:string,withdraw=false):AccountErasureReceipt {
  if(!record(raw)||!uuid(raw.requestId)||!status(raw.status)||
    !proofFlags(raw)||(expectedId!==undefined&&raw.requestId!==expectedId)||
    (withdraw?(raw.status!=='WITHDRAWN'||typeof raw.alreadyWithdrawn!=='boolean'):
      typeof raw.alreadyRequested!=='boolean'))
    throw new PrivateAccountErasureError('INVALID_ACK','Unverified account-erasure request status.');
  return {requestId:raw.requestId,status:raw.status,
    ...(withdraw?{alreadyWithdrawn:raw.alreadyWithdrawn as boolean}:
      {alreadyRequested:raw.alreadyRequested as boolean}),
    publicRevocationVerified:false,reauthVerified:false,accessTerminated:false,
    erasureExecuted:false,retentionVerified:false};
}
/** Request/status only. Does NOT delete accounts, revoke sessions, or prove retention. */
export class SupabasePrivateAccountErasureService {
  private readonly origin:string;
  private readonly key:string;
  private readonly token:()=>Promise<string|null>;
  private readonly http:typeof fetch;
  constructor(endpoint:string,publishableKey:string,accessToken:()=>Promise<string|null>,
    http:typeof fetch=fetch){
    let url:URL;
    try{url=new URL(endpoint);}
    catch{throw new ContractError('VALIDATION','Invalid Supabase API origin.');}
    if((url.protocol!=='https:'&&!(url.protocol==='http:'&&
      ['localhost','127.0.0.1'].includes(url.hostname)))||
      url.username||url.password||url.pathname!=='/'||url.search||url.hash)
      throw new ContractError('VALIDATION','A trusted Supabase API origin is required.');
    if(typeof publishableKey!=='string'||!publishableKey.trim())
      throw new ContractError('VALIDATION','Publishable key is required.');
    this.origin=url.origin;this.key=publishableKey;this.token=accessToken;this.http=http;
  }
  private async send(path:string,payload?:Record<string,unknown>):Promise<unknown>{
    const jwt=await this.token();
    if(!jwt)throw new PrivateAccountErasureError('AUTH_EXPIRED','Sign in to review account exit.');
    let response:Response;
    try{
      response=await this.http(this.origin+'/rest/v1/'+path,{
        method:payload===undefined?'GET':'POST',
        headers:{apikey:this.key,Authorization:'Bearer '+jwt,Accept:'application/json',
          ...(payload===undefined?{}:{'Content-Type':'application/json'})},
        body:payload===undefined?undefined:JSON.stringify(payload),
        credentials:'omit',cache:'no-store',redirect:'error'
      });
    }catch{
      throw new PrivateAccountErasureError('PROVIDER_UNAVAILABLE','Account exit request was not acknowledged.');
    }
    if(!response.ok){
      if(response.status===401)
        throw new PrivateAccountErasureError('AUTH_EXPIRED','Session expired.');
      if(response.status===403)
        throw new PrivateAccountErasureError('FORBIDDEN','Account exit access denied.');
      const error:unknown=await response.json().catch(()=>null);
      const message=record(error)?error.message:null;
      if(message==='ACCOUNT_ERASURE_REQUEST_QUOTA_REACHED')
        throw new PrivateAccountErasureError('QUOTA_EXCEEDED','Request limit reached.');
      if(message==='INVALID_ERASURE_REQUEST'||message==='INVALID_ERASURE_WITHDRAWAL')
        throw new PrivateAccountErasureError('VALIDATION','Invalid account exit request.');
      if(response.status===409||message==='ACCOUNT_ERASURE_ALREADY_REQUESTED'||
        message==='ERASURE_WITHDRAWAL_OPERATION_REUSED')
        throw new PrivateAccountErasureError('CONFLICT','Account exit request conflicts with existing state.');
      throw new PrivateAccountErasureError('PROVIDER_UNAVAILABLE','Account exit operation failed.');
    }
    return response.json().catch(()=>{
      throw new PrivateAccountErasureError('INVALID_ACK','Invalid account exit response.');
    });
  }
  /** Advisory only: session presence/fresh login is NOT an erasure authorisation. */
  async preflight():Promise<AccountExitPreflight>{
    const raw=await this.send('rpc/private_account_exit_preflight',{});
    const names=[
      'projects','portfolios','portfolioRevisions','projectExposureIntents',
      'projectAssetMetadata','frozenReleaseRequests','reviewerGrants',
      'trashRecords','accountExitRequests'
    ] as const;
    if(!record(raw)||raw.status!=='INVENTORY_ONLY'||raw.maxCountPerCategory!==1000||
      typeof raw.countsCapped!=='boolean'||!record(raw.counts)||
      !names.every(k=>Number.isSafeInteger(raw.counts[k]) &&
        (raw.counts[k] as number)>=0 && (raw.counts[k] as number)<=1000)||
      raw.liveSessionChecked!==true||typeof raw.freshSignInCandidate!=='boolean'||
      raw.recentReauthVerified!==false||raw.deletionAllowed!==false||
      raw.publicRoutes!=='UNVERIFIED'||raw.objectStorage!=='METADATA_ONLY'||
      raw.exports!=='NOT_TRACKED'||raw.integrations!=='NOT_TRACKED')
      throw new PrivateAccountErasureError('INVALID_ACK','Invalid account-exit preflight evidence.');
    return {
      status:'INVENTORY_ONLY',maxCountPerCategory:1000,
      countsCapped:raw.countsCapped as boolean,
      counts:Object.fromEntries(names.map(k=>[k,raw.counts[k]])) as AccountExitPreflight['counts'],
      liveSessionChecked:true,freshSignInCandidate:raw.freshSignInCandidate as boolean,
      recentReauthVerified:false,publicRoutes:'UNVERIFIED',objectStorage:'METADATA_ONLY',
      exports:'NOT_TRACKED',integrations:'NOT_TRACKED',deletionAllowed:false
    };
  }
  async request(operationId:string,confirmation:'DELETE MY ACCOUNT'):Promise<AccountErasureReceipt>{
    if(!uuid(operationId)||confirmation!=='DELETE MY ACCOUNT')
      throw new ContractError('VALIDATION','Exact account exit confirmation is required.');
    return receipt(await this.send('rpc/request_private_account_erasure',{
      p_operation_id:operationId,p_confirmation:confirmation
    }));
  }
  async withdraw(requestId:string,operationId:string):Promise<AccountErasureReceipt>{
    if(!uuid(requestId)||!uuid(operationId))
      throw new ContractError('VALIDATION','Invalid account exit identifiers.');
    return receipt(await this.send('rpc/withdraw_private_account_erasure',{
      p_request_id:requestId,p_operation_id:operationId
    }),requestId,true);
  }
  async list():Promise<PrivateAccountErasureEntry[]>{
    const raw=await this.send('private_account_erasure_requests?select=id,status,created_at,withdrawn_at,public_revocation_verified,reauth_verified,access_terminated,erasure_executed,retention_verified&order=created_at.desc&limit=10');
    if(!Array.isArray(raw)||raw.length>10)
      throw new PrivateAccountErasureError('INVALID_ACK','Invalid private account exit history.');
    return raw.map((x:unknown):PrivateAccountErasureEntry=>{
      if(!record(x)||!uuid(x.id)||!status(x.status)||!date(x.created_at)||
        !proofFlags(x,true)||(x.status==='WITHDRAWN'? !date(x.withdrawn_at):
          x.withdrawn_at!==null))
        throw new PrivateAccountErasureError('INVALID_ACK','Invalid private account exit entry.');
      return {id:x.id,status:x.status,created_at:x.created_at,
        withdrawn_at:x.withdrawn_at as string|null,
        public_revocation_verified:false,reauth_verified:false,access_terminated:false,
        erasure_executed:false,retention_verified:false};
    });
  }
}
