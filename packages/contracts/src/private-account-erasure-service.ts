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
export interface AccountExitReauthChallenge {
  challengeId:string;
  status:'AWAITING_NEW_SIGN_IN';
  expiresAt:string;
  alreadyIssued:boolean;
  deletionAllowed:false;
}
export interface AccountExitReauthVerification {
  challengeId:string;
  status:'NEW_SIGN_IN_VERIFIED';
  expiresAt:string;
  alreadyVerified:boolean;
  deletionAllowed:false;
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
/** Immutable owner-only database metadata inventory, NOT a full export or purge list. */
export interface AccountExitInventoryReceipt {
  snapshotId:string;
  schemaVersion:1;
  capturedAt:string;
  alreadyCaptured:boolean;
  inventory:{
    status:'METADATA_SNAPSHOT_ONLY';
    maxCountPerCategory:1000;
    countsCapped:boolean;
    counts:AccountExitPreflight['counts'];
    consistency:'SINGLE_STATEMENT_MVCC';
    publicRoutes:'UNVERIFIED';
    objectStorage:'METADATA_ONLY';
    exports:'NOT_READY';
    integrations:'NOT_TRACKED';
    backupRetention:'UNVERIFIED';
    recentReauthVerified:false;
    publicRevocationVerified:false;
    deletionAllowed:false;
  };
  deletionAllowed:false;
}
/** Live, bounded Storage metadata comparison. This never proves object bytes or export readiness. */
export interface AccountExitStorageReconciliation {
  snapshotId:string;
  inventoryCapturedAt:string;
  status:'METADATA_MATCH_ONLY'|'DISCREPANCY'|'LIMIT_EXCEEDED';
  maxObjectsPerSide:100;
  limitExceeded:boolean;
  registeredAssets:number;
  storageObjects:number;
  missingObjects:number;
  orphanObjects:number;
  metadataMismatches:number;
  inventoryDrift:boolean;
  consistency:'LIVE_METADATA_NOT_ATOMIC_WITH_INVENTORY';
  storageBytesVerified:false;
  downloadableExportReady:false;
  externalProviders:'UNVERIFIED';
  backupRetention:'UNVERIFIED';
  publicRevocationVerified:false;
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
    'REAUTH_REQUIRED'|'CHALLENGE_EXPIRED'|'QUOTA_EXCEEDED'|'PROVIDER_UNAVAILABLE'|'INVALID_ACK';
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
function inventoryReceipt(raw:unknown,expectedId?:string):AccountExitInventoryReceipt {
  const names=[
    'projects','portfolios','portfolioRevisions','projectExposureIntents',
    'projectAssetMetadata','frozenReleaseRequests','reviewerGrants',
    'trashRecords','accountExitRequests'
  ] as const;
  const inv=record(raw)?raw.inventory:null;
  const counts=record(inv)&&record(inv.counts)?inv.counts:null;
  if(!record(raw)||!uuid(raw.snapshotId)||
    (expectedId!==undefined&&raw.snapshotId!==expectedId)||
    raw.schemaVersion!==1||!date(raw.capturedAt)||
    typeof raw.alreadyCaptured!=='boolean'||raw.deletionAllowed!==false||
    !record(inv)||counts===null||
    inv.status!=='METADATA_SNAPSHOT_ONLY'||inv.maxCountPerCategory!==1000||
    typeof inv.countsCapped!=='boolean'||
    !names.every(k=>typeof counts[k]==='number'&&Number.isSafeInteger(counts[k])&&
      (counts[k] as number)>=0&&(counts[k] as number)<=1000)||
    inv.consistency!=='SINGLE_STATEMENT_MVCC'||
    inv.publicRoutes!=='UNVERIFIED'||inv.objectStorage!=='METADATA_ONLY'||
    inv.exports!=='NOT_READY'||inv.integrations!=='NOT_TRACKED'||
    inv.backupRetention!=='UNVERIFIED'||inv.recentReauthVerified!==false||
    inv.publicRevocationVerified!==false||inv.deletionAllowed!==false)
    throw new PrivateAccountErasureError('INVALID_ACK','Unverified account-exit inventory snapshot.');
  return {
    snapshotId:raw.snapshotId,schemaVersion:1,capturedAt:raw.capturedAt as string,
    alreadyCaptured:raw.alreadyCaptured as boolean,deletionAllowed:false,
    inventory:{
      status:'METADATA_SNAPSHOT_ONLY',maxCountPerCategory:1000,
      countsCapped:inv.countsCapped as boolean,
      counts:Object.fromEntries(names.map(k=>[k,counts[k]])) as AccountExitPreflight['counts'],
      consistency:'SINGLE_STATEMENT_MVCC',publicRoutes:'UNVERIFIED',
      objectStorage:'METADATA_ONLY',exports:'NOT_READY',
      integrations:'NOT_TRACKED',backupRetention:'UNVERIFIED',
      recentReauthVerified:false,publicRevocationVerified:false,deletionAllowed:false
    }
  };
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
      const error:unknown=await response.json().catch(()=>null);
      const message=record(error)?error.message:null;
      if(message==='LIVE_SESSION_REQUIRED')
        throw new PrivateAccountErasureError('AUTH_EXPIRED','Sign in again to continue.');
      if(message==='NEW_SIGN_IN_REQUIRED'||message==='ERASURE_REAUTH_REQUIRED')
        throw new PrivateAccountErasureError('REAUTH_REQUIRED','Sign in again after starting the account-exit challenge.');
      if(message==='REAUTH_CHALLENGE_EXPIRED')
        throw new PrivateAccountErasureError('CHALLENGE_EXPIRED','This challenge expired; start a new one.');
      if(response.status===401)
        throw new PrivateAccountErasureError('AUTH_EXPIRED','Session expired.');
      if(response.status===403)
        throw new PrivateAccountErasureError('FORBIDDEN','Account exit access denied.');
      if(message==='ACCOUNT_ERASURE_REQUEST_QUOTA_REACHED'||
        message==='REAUTH_CHALLENGE_QUOTA_REACHED'||
        message==='INVENTORY_SNAPSHOT_QUOTA_REACHED')
        throw new PrivateAccountErasureError('QUOTA_EXCEEDED','Request limit reached.');
      if(message==='INVALID_ERASURE_REQUEST'||message==='INVALID_ERASURE_WITHDRAWAL'||message==='INVALID_ERASURE_EXECUTION')
        throw new PrivateAccountErasureError('VALIDATION','Invalid account exit request.');
      if(message==='ERASURE_STORAGE_CLEANUP_REQUIRED')
        throw new PrivateAccountErasureError('CONFLICT','Remove your private uploads before erasing the account.');
      if(response.status===409||message==='ACCOUNT_ERASURE_ALREADY_REQUESTED'||
        message==='ERASURE_WITHDRAWAL_OPERATION_REUSED'||
        message==='REAUTH_OPERATION_REUSED'||message==='REAUTH_PROOF_ALREADY_BOUND'||
        message==='INVENTORY_OPERATION_REUSED')
        throw new PrivateAccountErasureError('CONFLICT','Account exit request conflicts with existing state.');
      throw new PrivateAccountErasureError('PROVIDER_UNAVAILABLE','Account exit operation failed.');
    }
    return response.json().catch(()=>{
      throw new PrivateAccountErasureError('INVALID_ACK','Invalid account exit response.');
    });
  }
  /** An explicit owner challenge; a new login must establish a different session. */
  async beginReauth(operationId:string):Promise<AccountExitReauthChallenge>{
    if(!uuid(operationId))
      throw new ContractError('VALIDATION','Invalid reauthentication operation ID.');
    const raw=await this.send('rpc/begin_private_account_exit_reauth',{
      p_operation_id:operationId
    });
    if(!record(raw)||!uuid(raw.challengeId)||raw.status!=='AWAITING_NEW_SIGN_IN'||
      !date(raw.expiresAt)||typeof raw.alreadyIssued!=='boolean'||
      raw.deletionAllowed!==false)
      throw new PrivateAccountErasureError('INVALID_ACK','Invalid reauthentication challenge.');
    return {challengeId:raw.challengeId,status:'AWAITING_NEW_SIGN_IN',
      expiresAt:raw.expiresAt as string,alreadyIssued:raw.alreadyIssued,
      deletionAllowed:false};
  }
  /** Call only with a fresh Supabase JWT obtained by authenticating again. */
  async completeReauth(challengeId:string):Promise<AccountExitReauthVerification>{
    if(!uuid(challengeId))
      throw new ContractError('VALIDATION','Invalid reauthentication challenge ID.');
    const raw=await this.send('rpc/complete_private_account_exit_reauth',{
      p_challenge_id:challengeId
    });
    if(!record(raw)||raw.challengeId!==challengeId||raw.status!=='NEW_SIGN_IN_VERIFIED'||
      !date(raw.expiresAt)||typeof raw.alreadyVerified!=='boolean'||
      raw.deletionAllowed!==false)
      throw new PrivateAccountErasureError('INVALID_ACK','Unverified new-sign-in evidence.');
    return {challengeId,status:'NEW_SIGN_IN_VERIFIED',expiresAt:raw.expiresAt as string,
      alreadyVerified:raw.alreadyVerified,deletionAllowed:false};
  }
  /** Captures bounded owner metadata only; never exports content or authorizes deletion. */
  async captureInventory(operationId:string,requestId:string|null=null):
    Promise<AccountExitInventoryReceipt>{
    if(!uuid(operationId)||(requestId!==null&&!uuid(requestId)))
      throw new ContractError('VALIDATION','Invalid inventory operation or request ID.');
    const raw=await this.send('rpc/create_private_account_exit_inventory',{
      p_operation_id:operationId,p_request_id:requestId
    });
    return inventoryReceipt(raw);
  }
  /** Replays the original immutable snapshot; foreign snapshot IDs are denied by the RPC. */
  async getInventory(snapshotId:string):Promise<AccountExitInventoryReceipt>{
    if(!uuid(snapshotId))
      throw new ContractError('VALIDATION','Invalid inventory snapshot ID.');
    const raw=await this.send('rpc/get_private_account_exit_inventory',{
      p_snapshot_id:snapshotId
    });
    return inventoryReceipt(raw,snapshotId);
  }
  /** Read-only comparison of registered assets with live private Storage metadata. */
  async reconcileStorage(snapshotId:string):Promise<AccountExitStorageReconciliation>{
    if(!uuid(snapshotId))
      throw new ContractError('VALIDATION','Invalid inventory snapshot ID.');
    const raw=await this.send('rpc/reconcile_private_account_exit_storage',{
      p_snapshot_id:snapshotId
    });
    if(!record(raw)||raw.snapshotId!==snapshotId||!date(raw.inventoryCapturedAt)||
      !['METADATA_MATCH_ONLY','DISCREPANCY','LIMIT_EXCEEDED'].includes(String(raw.status))||
      raw.maxObjectsPerSide!==100||typeof raw.limitExceeded!=='boolean'||
      typeof raw.inventoryDrift!=='boolean'||
      !['registeredAssets','storageObjects','missingObjects','orphanObjects',
        'metadataMismatches'].every(k=>typeof raw[k]==='number'&&
          Number.isSafeInteger(raw[k])&&(raw[k] as number)>=0&&(raw[k] as number)<=100)||
      raw.consistency!=='LIVE_METADATA_NOT_ATOMIC_WITH_INVENTORY'||
      raw.storageBytesVerified!==false||raw.downloadableExportReady!==false||
      raw.externalProviders!=='UNVERIFIED'||raw.backupRetention!=='UNVERIFIED'||
      raw.publicRevocationVerified!==false||raw.deletionAllowed!==false||
      (raw.limitExceeded!== (raw.status==='LIMIT_EXCEEDED'))||
      (raw.status==='METADATA_MATCH_ONLY'&&
        (raw.missingObjects!==0||raw.orphanObjects!==0||raw.metadataMismatches!==0))||
      (raw.status==='DISCREPANCY'&&
        raw.missingObjects===0&&raw.orphanObjects===0&&raw.metadataMismatches===0))
      throw new PrivateAccountErasureError('INVALID_ACK',
        'Unverified private Storage reconciliation receipt.');
    return {
      snapshotId,inventoryCapturedAt:raw.inventoryCapturedAt as string,
      status:raw.status as AccountExitStorageReconciliation['status'],
      maxObjectsPerSide:100,limitExceeded:raw.limitExceeded as boolean,
      registeredAssets:raw.registeredAssets as number,
      storageObjects:raw.storageObjects as number,
      missingObjects:raw.missingObjects as number,
      orphanObjects:raw.orphanObjects as number,
      metadataMismatches:raw.metadataMismatches as number,
      inventoryDrift:raw.inventoryDrift as boolean,
      consistency:'LIVE_METADATA_NOT_ATOMIC_WITH_INVENTORY',
      storageBytesVerified:false,downloadableExportReady:false,
      externalProviders:'UNVERIFIED',backupRetention:'UNVERIFIED',
      publicRevocationVerified:false,deletionAllowed:false
    };
  }
  /** Advisory only: session presence/fresh login is NOT an erasure authorisation. */
  async preflight():Promise<AccountExitPreflight>{
    const raw=await this.send('rpc/private_account_exit_preflight',{});
    const names=[
      'projects','portfolios','portfolioRevisions','projectExposureIntents',
      'projectAssetMetadata','frozenReleaseRequests','reviewerGrants',
      'trashRecords','accountExitRequests'
    ] as const;
    const counts=record(raw)&&record(raw.counts)?raw.counts:null;
    if(!record(raw)||raw.status!=='INVENTORY_ONLY'||raw.maxCountPerCategory!==1000||
      typeof raw.countsCapped!=='boolean'||counts===null||
      !names.every(k=>{
        const value=counts[k];
        return typeof value==='number'&&Number.isSafeInteger(value)&&
          value>=0&&value<=1000;
      })||
      raw.liveSessionChecked!==true||typeof raw.freshSignInCandidate!=='boolean'||
      raw.recentReauthVerified!==false||raw.deletionAllowed!==false||
      raw.publicRoutes!=='UNVERIFIED'||raw.objectStorage!=='METADATA_ONLY'||
      raw.exports!=='NOT_TRACKED'||raw.integrations!=='NOT_TRACKED')
      throw new PrivateAccountErasureError('INVALID_ACK','Invalid account-exit preflight evidence.');
    return {
      status:'INVENTORY_ONLY',maxCountPerCategory:1000,
      countsCapped:raw.countsCapped as boolean,
      counts:Object.fromEntries(names.map(k=>[k,counts[k]])) as AccountExitPreflight['counts'],
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
  async removeUploadBatch():Promise<number>{
    const paths=await this.send('rpc/owner_list_account_exit_uploads',{});
    if(!Array.isArray(paths)||paths.length>100||paths.some(path=>
      typeof path!=='string'||!uuid(path.split('/')[0])||path.split('/').length<2||
      path.split('/').some((part:string)=>!part||part==='.'||part==='..'||part.includes('\\'))))
      throw new PrivateAccountErasureError('INVALID_ACK','Invalid account-exit upload inventory.');
    if(paths.length===0)return 0;
    const jwt=await this.token();
    if(!jwt)throw new PrivateAccountErasureError('AUTH_EXPIRED','Sign in again to continue.');
    let response:Response;
    try{
      response=await this.http(this.origin+'/storage/v1/object/kadmeion-private-assets',{
        method:'DELETE',headers:{apikey:this.key,Authorization:'Bearer '+jwt,'Content-Type':'application/json'},
        credentials:'omit',cache:'no-store',redirect:'error',body:JSON.stringify({prefixes:paths})
      });
    }catch{
      throw new PrivateAccountErasureError('PROVIDER_UNAVAILABLE','Private upload removal was not confirmed.');
    }
    if(!response.ok)
      throw new PrivateAccountErasureError('PROVIDER_UNAVAILABLE','Private upload removal was not confirmed.');
    const remaining=await this.send('rpc/owner_list_account_exit_uploads',{});
    if(!Array.isArray(remaining)||paths.some(path=>remaining.includes(path)))
      throw new PrivateAccountErasureError('PROVIDER_UNAVAILABLE','Private upload removal was not confirmed.');
    return paths.length;
  }
  async execute(requestId:string,challengeId:string,confirmation:'DELETE MY ACCOUNT'):Promise<{
    status:'ACTIVE_ACCOUNT_ERASED';
    receiptId:string;
    accessTerminated:true;
    backupErasureVerified:false;
    externalCopiesErased:false;
  }>{
    if(!uuid(requestId)||!uuid(challengeId)||confirmation!=='DELETE MY ACCOUNT')
      throw new ContractError('VALIDATION','Exact account exit confirmation is required.');
    const raw=await this.send('rpc/owner_execute_account_erasure',{
      p_request_id:requestId,p_challenge_id:challengeId,p_confirmation:confirmation
    });
    if(!record(raw)||raw.status!=='ACTIVE_ACCOUNT_ERASED'||!uuid(raw.receiptId)||
       raw.accessTerminated!==true||raw.backupErasureVerified!==false||raw.externalCopiesErased!==false)
      throw new PrivateAccountErasureError('INVALID_ACK','Account erasure was not confirmed.');
    return {
      status:'ACTIVE_ACCOUNT_ERASED',receiptId:raw.receiptId,accessTerminated:true,
      backupErasureVerified:false,externalCopiesErased:false
    };
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
