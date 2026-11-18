import { ContractError, isSafeSupabaseClientKey, HANDLE_PATTERN, RESERVED_HANDLES } from './project.ts';

/**
 * B4 private candidate pointer client. It never activates a public URL.
 * Owner-provided manifest hashes are not trusted artifact attestations.
 */
export type PrivatePointerStatus='BLOCKED'|'PREPARED_PRIVATE';
export interface PrivatePointerSnapshot {
  portfolioId:string;
  status:PrivatePointerStatus;
  generation:number;
  revocationGeneration:number;
  candidateRequestId:string|null;
  candidateManifestSha256:string|null;
  publicServingEnabled:false;
  publicUrl:null;
  hostRevocationVerified:false;
}
export interface PrivatePointerReceipt {
  portfolioId:string;
  status:PrivatePointerStatus;
  generation:number;
  alreadyRecorded:boolean;
  stillBlocked?:boolean;
  publicServingEnabled:false;
  publicUrl:null;
  hostRevocationVerified:false;
}
export interface UnlistedPublicationConsent {
  intentId:string;
  status:'AWAITING_HOST'|'USED';
  alreadyRecorded:boolean;
  publicServingEnabled:false;
  publicUrl:null;
}
export class PrivatePointerError extends Error {
  readonly code:'VALIDATION'|'AUTH_EXPIRED'|'FORBIDDEN'|'CONFLICT'|
    'PROVIDER_UNAVAILABLE'|'INVALID_ACK'|'REVISION_UNAVAILABLE'|'QUOTA_EXCEEDED';
  constructor(code:PrivatePointerError['code'],message:string){
    super(message);this.name='PrivatePointerError';this.code=code;
  }
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const record=(x:unknown):x is Record<string,unknown>=>
  x!==null&&typeof x==='object'&&!Array.isArray(x);
const uuid=(x:unknown):x is string=>typeof x==='string'&&UUID.test(x);
const sha=(x:unknown):x is string=>typeof x==='string'&&SHA.test(x);
const generation=(x:unknown):x is number=>
  typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
const safeFlags=(x:Record<string,unknown>)=>
  x.publicServingEnabled===false&&x.publicUrl===null&&x.hostRevocationVerified===false;

function snapshot(raw:unknown,portfolioId:string):PrivatePointerSnapshot {
  if(!record(raw)||raw.portfolioId!==portfolioId||!safeFlags(raw)||
     (raw.status!=='BLOCKED'&&raw.status!=='PREPARED_PRIVATE')||
     !generation(raw.generation)||!generation(raw.revocationGeneration)||
     raw.revocationGeneration>raw.generation||
     (raw.status==='BLOCKED'
       ? raw.candidateRequestId!==null||raw.candidateManifestSha256!==null
       : !uuid(raw.candidateRequestId)||!sha(raw.candidateManifestSha256))||
     (raw.generation===0&&raw.status!=='BLOCKED'))
    throw new PrivatePointerError('INVALID_ACK','Private pointer state was not verified.');
  return {
    portfolioId,status:raw.status,generation:raw.generation,
    revocationGeneration:raw.revocationGeneration,
    candidateRequestId:raw.candidateRequestId as string|null,
    candidateManifestSha256:raw.candidateManifestSha256 as string|null,
    publicServingEnabled:false,publicUrl:null,hostRevocationVerified:false
  };
}
function receipt(raw:unknown,portfolioId:string,kind:'PREPARE'|'BLOCK',
    expectedGeneration?:number):PrivatePointerReceipt {
  if(!record(raw)||raw.portfolioId!==portfolioId||!safeFlags(raw)||
     !generation(raw.generation)||raw.generation<1||
     typeof raw.alreadyRecorded!=='boolean'||
     (kind==='PREPARE'&&raw.status!=='PREPARED_PRIVATE')||
     (kind==='BLOCK'&&(
       (raw.status!=='BLOCKED'&&raw.status!=='PREPARED_PRIVATE')||
       typeof raw.stillBlocked!=='boolean'||
       (raw.status==='BLOCKED')!==raw.stillBlocked||
       (!raw.alreadyRecorded&&!raw.stillBlocked)))||
     (kind==='PREPARE'&&!raw.alreadyRecorded&&
       raw.generation!==expectedGeneration!+1))
    throw new PrivatePointerError('INVALID_ACK','Private pointer receipt was not verified.');
  return {
    portfolioId,status:raw.status as PrivatePointerStatus,
    generation:raw.generation,alreadyRecorded:raw.alreadyRecorded,
    ...(kind==='BLOCK'?{stillBlocked:raw.stillBlocked as boolean}:{}),
    publicServingEnabled:false,publicUrl:null,hostRevocationVerified:false
  };
}
/**
 * Owner-visible point-in-time receipt from the C11 publish worker. This is
 * not authority for a future request: read/check again before using it as
 * current. The expected IDs are from explicit owner consent and frozen rows.
 */
export type OwnerPublicDeliveryExpectation=Readonly<{
  portfolioId:string;requestId:string;intentId:string;operationId:string;
}>;
export type OwnerPublicDeliveryAcknowledgement=Readonly<{
  visibility:'PUBLIC';portfolioId:string;requestId:string;intentId:string;operationId:string;
  releaseGeneration:number;stageGeneration:number;pointerGeneration:number;
  revocationGeneration:number;deliveryEpoch:number;canonicalPath:string;publicUrl:string;
  storedHtmlSha256:string;servedHtmlSha256:string;mediaManifest:string|null;
  assetHashes:readonly string[];observedHttpRequests:number;verifiedAt:string;
}>;
const publicAckKeys=['visibility','portfolioId','requestId','intentId','operationId',
  'releaseGeneration','stageGeneration','pointerGeneration','revocationGeneration','deliveryEpoch',
  'canonicalPath','publicUrl','storedHtmlSha256','servedHtmlSha256','mediaManifest',
  'assetHashes','observedHttpRequests','verifiedAt'] as const;
const publicAckError=()=>new PrivatePointerError('INVALID_ACK','Public delivery was not independently acknowledged.');
const safePublicExpectation=(x:OwnerPublicDeliveryExpectation):boolean=>
  !!x&&uuid(x.portfolioId)&&uuid(x.requestId)&&uuid(x.intentId)&&uuid(x.operationId);
export function parseOwnerPublicDelivery(raw:unknown,expected:OwnerPublicDeliveryExpectation,
    allowLocal=false):OwnerPublicDeliveryAcknowledgement{
  if(!safePublicExpectation(expected)||!record(raw)||
     Object.keys(raw).length!==publicAckKeys.length||!publicAckKeys.every(k=>Object.hasOwn(raw,k))||
     raw.visibility!=='PUBLIC'||raw.portfolioId!==expected.portfolioId||raw.requestId!==expected.requestId||
     raw.intentId!==expected.intentId||raw.operationId!==expected.operationId||
     !generation(raw.releaseGeneration)||raw.releaseGeneration<1||!generation(raw.stageGeneration)||raw.stageGeneration<1||
     !generation(raw.pointerGeneration)||!generation(raw.revocationGeneration)||
     !generation(raw.deliveryEpoch)||raw.deliveryEpoch<1||raw.deliveryEpoch>=Number.MAX_SAFE_INTEGER||
     raw.stageGeneration>raw.releaseGeneration||raw.releaseGeneration>raw.pointerGeneration||
     raw.stageGeneration<=raw.revocationGeneration||!sha(raw.storedHtmlSha256)||!sha(raw.servedHtmlSha256)||
     !Array.isArray(raw.assetHashes)||raw.assetHashes.length>8||![...raw.assetHashes].every(sha)||
     new Set(raw.assetHashes).size!==raw.assetHashes.length||
     (raw.assetHashes.length===0?raw.mediaManifest!==null:!sha(raw.mediaManifest))||
     raw.observedHttpRequests!==4+2*raw.assetHashes.length||
     typeof raw.verifiedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw.verifiedAt)||!Number.isFinite(Date.parse(raw.verifiedAt))||
     typeof raw.canonicalPath!=='string'||typeof raw.publicUrl!=='string')throw publicAckError();
  const [root,handle,slug,...rest]=raw.canonicalPath.split('/');
  if(root!==''||rest.length!==0||typeof handle!=='string'||typeof slug!=='string'||
     !HANDLE_PATTERN.test(handle)||RESERVED_HANDLES.has(handle)||
     !/^(?=.{3,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))throw publicAckError();
  try{
    const u=new URL(raw.publicUrl);
    const secure=u.protocol==='https:'&&u.hostname.includes('.')&&
      !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(u.hostname)&&
      !/(?:\.local|\.internal|\.localhost|\.test|\.invalid)$/.test(u.hostname);
    const local=allowLocal&&u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname);
    if(!(secure||local)||u.username||u.password||u.search||u.hash||
       u.pathname!==raw.canonicalPath||u.href!==raw.publicUrl)throw publicAckError();
  }catch{throw publicAckError();}
  return Object.freeze({...raw,assetHashes:Object.freeze([...raw.assetHashes])}) as OwnerPublicDeliveryAcknowledgement;
}
const PUBLIC_DELIVERY_TIMEOUT_MS=120_000;
const POINTER_RPC_TIMEOUT_MS=10_000;
const MAX_POINTER_RPC_BYTES=16_384;
function cancelPointerBody(body:{cancel:()=>Promise<void>}|null|undefined):void{
  try{void body?.cancel().catch(()=>{});}catch{}
}
async function readPointerJson(response:Response,signal:AbortSignal):Promise<unknown>{
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  const stop=()=>cancelPointerBody(reader??response.body);
  signal.addEventListener('abort',stop,{once:true});
  try{
    if(signal.aborted)return null;
    const mime=response.headers.get('content-type')??'';
    const length=response.headers.get('content-length');
    if(!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(mime)||
       (length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_POINTER_RPC_BYTES))||
       !response.body)return null;
    reader=response.body.getReader();
    const bytes=new Uint8Array(MAX_POINTER_RPC_BYTES);
    let size=0,count=0;
    for(;;){
      const part=await reader.read();
      if(signal.aborted)return null;
      if(part.done)break;
      if(!(part.value instanceof Uint8Array)||++count>1024||
         size+part.value.byteLength>bytes.length)return null;
      bytes.set(part.value,size);size+=part.value.byteLength;
    }
    const encoding=response.headers.get('content-encoding');
    if(length!==null&&(!encoding||encoding.toLowerCase()==='identity')&&Number(length)!==size)
      return null;
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size)));
  }catch{return null;}
  finally{
    signal.removeEventListener('abort',stop);
    stop();
    try{reader?.releaseLock();}catch{}
  }
}

export class SupabasePrivateReleasePointerService {
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
    if(!isSafeSupabaseClientKey(publishableKey))
      throw new ContractError('VALIDATION','A public Supabase API key is required.');
    this.origin=url.origin;this.key=publishableKey;this.token=accessToken;this.http=http;
  }
  private async call(rpc:string,payload:Record<string,unknown>):Promise<unknown>{
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined;
    const unavailable=()=>new PrivatePointerError('PROVIDER_UNAVAILABLE',
      'Private pointer update was not acknowledged; check state before retrying.');
    try{
      const attempt=(async()=>{
        const jwt=await this.token();
        if(controller.signal.aborted)throw unavailable();
        if(!jwt)throw new PrivatePointerError('AUTH_EXPIRED','Sign in to manage a private release.');
        const target=this.origin+'/rest/v1/rpc/'+rpc;
        const response=await this.http(target,{
          method:'POST',headers:{apikey:this.key,Authorization:'Bearer '+jwt,
            'Content-Type':'application/json',Accept:'application/json'},
          body:JSON.stringify(payload),credentials:'omit',cache:'no-store',redirect:'error',
          signal:controller.signal
        });
        if(controller.signal.aborted||response.redirected||(response.url!==''&&response.url!==target)){
          cancelPointerBody(response.body);throw unavailable();
        }
        const body=await readPointerJson(response,controller.signal);
        if(controller.signal.aborted)throw unavailable();
        return {ok:response.ok,status:response.status,body};
      })();
      const deadline=new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>{reject(unavailable());controller.abort();},POINTER_RPC_TIMEOUT_MS);
      });
      const response=await Promise.race([attempt,deadline]);
      if(!response.ok){
        const message=record(response.body)?response.body.message:null;
        if(response.status===401)
          throw new PrivatePointerError('AUTH_EXPIRED','Session expired.');
        if(response.status===403||message==='PRIVATE_PORTFOLIO_NOT_FOUND')
          throw new PrivatePointerError('FORBIDDEN','Private portfolio is unavailable.');
        if(message==='PRIVATE_FROZEN_REQUEST_UNAVAILABLE')
          throw new PrivatePointerError('REVISION_UNAVAILABLE','Frozen revision is unavailable.');
        if(message==='UNLISTED_INTENT_QUOTA_REACHED')
          throw new PrivatePointerError('QUOTA_EXCEEDED','The publishing request limit has been reached.');
        if(response.status===409||message==='PRIVATE_POINTER_CONFLICT'||
          message==='UNLISTED_POINTER_CONFLICT'||message==='UNLISTED_OPERATION_REUSED'||
          message==='PRIVATE_POINTER_OPERATION_REUSED')
          throw new PrivatePointerError('CONFLICT','Private pointer changed; read current state.');
        if(message==='INVALID_PRIVATE_POINTER_PREPARE'||message==='INVALID_PRIVATE_POINTER_BLOCK'||
          message==='INVALID_PRIVATE_POINTER_READ')
          throw new PrivatePointerError('VALIDATION','Invalid private pointer operation.');
        throw new PrivatePointerError('PROVIDER_UNAVAILABLE','Private pointer operation was not confirmed.');
      }
      return response.body;
    }catch(error){
      if(error instanceof PrivatePointerError)throw error;
      throw unavailable();
    }finally{
      clearTimeout(timer);controller.abort();
    }
  }
  async read(portfolioId:string):Promise<PrivatePointerSnapshot>{
    if(!uuid(portfolioId))throw new PrivatePointerError('VALIDATION','Invalid portfolio ID.');
    return snapshot(await this.call('owner_read_private_release_pointer',{
      p_portfolio_id:portfolioId
    }),portfolioId);
  }
  async prepare(portfolioId:string,requestId:string,manifestSha256:string,
    expectedGeneration:number,operationId:string):Promise<PrivatePointerReceipt>{
    if(!uuid(portfolioId)||!uuid(requestId)||!sha(manifestSha256)||
       !generation(expectedGeneration)||!uuid(operationId))
      throw new PrivatePointerError('VALIDATION','Invalid private release candidate.');
    return receipt(await this.call('owner_prepare_private_release_pointer',{
      p_portfolio_id:portfolioId,p_request_id:requestId,
      p_manifest_sha256:manifestSha256,p_expected_generation:expectedGeneration,
      p_operation_id:operationId
    }),portfolioId,'PREPARE',expectedGeneration);
  }
  async requestUnlistedPublication(requestId:string,expectedGeneration:number,
    operationId:string,confirmation:'PUBLISH UNLISTED'):Promise<UnlistedPublicationConsent>{
    if(!uuid(requestId)||!uuid(operationId)||!generation(expectedGeneration)||
       expectedGeneration<1||confirmation!=='PUBLISH UNLISTED')
      throw new PrivatePointerError('VALIDATION','Explicit unlisted publishing confirmation is required.');
    const raw=await this.call('owner_request_unlisted_publication',{
      p_request_id:requestId,p_expected_generation:expectedGeneration,
      p_operation_id:operationId,p_confirmation:confirmation
    });
    return this.consentReceipt(raw);
  }
  async requestPublicPublication(requestId:string,expectedGeneration:number,
    operationId:string,confirmation:'PUBLISH PUBLIC'):Promise<UnlistedPublicationConsent>{
    if(!uuid(requestId)||!uuid(operationId)||!generation(expectedGeneration)||
       expectedGeneration<1||confirmation!=='PUBLISH PUBLIC')
      throw new PrivatePointerError('VALIDATION','Explicit public publishing confirmation is required.');
    return this.consentReceipt(await this.call('owner_request_unlisted_publication',{
      p_request_id:requestId,p_expected_generation:expectedGeneration,
      p_operation_id:operationId,p_confirmation:confirmation
    }));
  }
  async requestUnlistedRollback(targetIntentId:string,currentIntentId:string,
    expectedGeneration:number,operationId:string,
    confirmation:'ROLL BACK UNLISTED'):Promise<UnlistedPublicationConsent>{
    return this.requestRollback(targetIntentId,currentIntentId,expectedGeneration,operationId,
      confirmation,'ROLL BACK UNLISTED');
  }
  async requestPublicRollback(targetIntentId:string,currentIntentId:string,
    expectedGeneration:number,operationId:string,
    confirmation:'ROLL BACK PUBLIC'):Promise<UnlistedPublicationConsent>{
    return this.requestRollback(targetIntentId,currentIntentId,expectedGeneration,operationId,
      confirmation,'ROLL BACK PUBLIC');
  }
  private async requestRollback(targetIntentId:string,currentIntentId:string,
    expectedGeneration:number,operationId:string,confirmation:string,
    expectedConfirmation:string):Promise<UnlistedPublicationConsent>{
    if(!uuid(targetIntentId)||!uuid(currentIntentId)||targetIntentId===currentIntentId||
       !generation(expectedGeneration)||expectedGeneration<1||!uuid(operationId)||
       confirmation!==expectedConfirmation)
      throw new PrivatePointerError('VALIDATION','Explicit rollback confirmation is required.');
    const raw=await this.call('owner_request_unlisted_rollback',{
      p_target_intent_id:targetIntentId,p_current_intent_id:currentIntentId,
      p_expected_generation:expectedGeneration,p_operation_id:operationId,p_confirmation:confirmation
    });
    return this.consentReceipt(raw);
  }
  private consentReceipt(raw:unknown):UnlistedPublicationConsent{
    if(!record(raw)||!uuid(raw.intentId)||typeof raw.alreadyRecorded!=='boolean'||
       (raw.status!=='AWAITING_HOST'&&!(raw.status==='USED'&&raw.alreadyRecorded))||
       raw.publicServingEnabled!==false||raw.publicUrl!==null)
      throw new PrivatePointerError('INVALID_ACK','Unlisted publishing consent was not confirmed.');
    return {
      intentId:raw.intentId,status:raw.status,alreadyRecorded:raw.alreadyRecorded,
      publicServingEnabled:false,publicUrl:null
    };
  }
  /**
   * C11-only action and readback. Caller must hold explicit approved consent.
   * Do not mount until paired SQL authority, live-host gate and owner wrapper
   * are verified. The read-only check NEVER prepares or activates a release.
   */
  async executePublicDelivery(expected:OwnerPublicDeliveryExpectation):Promise<OwnerPublicDeliveryAcknowledgement>{
    return this.publicDelivery(expected,false);
  }
  async checkPublicDelivery(expected:OwnerPublicDeliveryExpectation):Promise<OwnerPublicDeliveryAcknowledgement>{
    return this.publicDelivery(expected,true);
  }
  private async publicDelivery(expected:OwnerPublicDeliveryExpectation,checkOnly:boolean):Promise<OwnerPublicDeliveryAcknowledgement>{
    if(!safePublicExpectation(expected))throw new PrivatePointerError('VALIDATION','A frozen owner publication consent is required.');
    const identity=Object.freeze({...expected});
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined;
    const unavailable=()=>new PrivatePointerError('PROVIDER_UNAVAILABLE','Public delivery was not confirmed. Check the same intent before retrying; do not create a duplicate.');
    const attempt=(async()=>{
      const jwt=await this.token();
      if(controller.signal.aborted)throw unavailable();
      if(!jwt)throw new PrivatePointerError('AUTH_EXPIRED','Sign in to verify public delivery.');
      const target=this.origin+'/functions/v1/publish';
      const response=await this.http(target,{
        method:'POST',headers:{apikey:this.key,Authorization:'Bearer '+jwt,
          'Content-Type':'application/json',Accept:'application/json'},
        body:JSON.stringify({intentId:identity.intentId,
          expectedPortfolioId:identity.portfolioId,expectedRequestId:identity.requestId,
          expectedOperationId:identity.operationId,...(checkOnly?{action:'CHECK_PUBLIC'}:{})}),
        credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal
      });
      if(controller.signal.aborted||response.redirected||(response.url!==''&&response.url!==target)){
        cancelPointerBody(response.body);throw unavailable();
      }
      if(response.status!==200){
        cancelPointerBody(response.body);
        if(response.status===401)throw new PrivatePointerError('AUTH_EXPIRED','Session expired.');
        if(response.status===403||response.status===404)throw new PrivatePointerError('FORBIDDEN','Public delivery is not available.');
        if(response.status===409)throw new PrivatePointerError('CONFLICT','Publication was not confirmed. Check the same intent.');
        throw unavailable();
      }
      const raw=await readPointerJson(response,controller.signal);
      // Use the owner's captured epoch-aware callback again. The action may
      // have committed, but a late receipt from a departed owner must not render.
      if(controller.signal.aborted||await this.token()!==jwt||controller.signal.aborted)throw unavailable();
      if(!record(raw)||Object.keys(raw).sort().join(',')!=='accountDeletionAllowed,hostRevocationVerified,htmlSha256,ownerPublicDelivery,providerRetentionVerified,status'||
         raw.status!=='DELIVERY_ACKNOWLEDGED'||raw.hostRevocationVerified!==false||
         raw.providerRetentionVerified!==false||raw.accountDeletionAllowed!==false||!sha(raw.htmlSha256))
        throw publicAckError();
      const origin=new URL(this.origin);
      const acknowledgement=parseOwnerPublicDelivery(raw.ownerPublicDelivery,identity,
        origin.protocol==='http:'&&['localhost','127.0.0.1'].includes(origin.hostname));
      if(acknowledgement.storedHtmlSha256!==raw.htmlSha256)throw publicAckError();
      return acknowledgement;
    })();
    const deadline=new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>{reject(unavailable());controller.abort();},PUBLIC_DELIVERY_TIMEOUT_MS);
    });
    try{return await Promise.race([attempt,deadline]);}
    catch(error){if(error instanceof PrivatePointerError)throw error;throw unavailable();}
    finally{clearTimeout(timer);controller.abort();}
  }
  async block(portfolioId:string,operationId:string):Promise<PrivatePointerReceipt>{
    if(!uuid(portfolioId)||!uuid(operationId))
      throw new PrivatePointerError('VALIDATION','Invalid private release block.');
    return receipt(await this.call('owner_block_private_release_pointer',{
      p_portfolio_id:portfolioId,p_operation_id:operationId
    }),portfolioId,'BLOCK');
  }
}
