import { ContractError } from './project.ts';

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
export class PrivatePointerError extends Error {
  readonly code:'VALIDATION'|'AUTH_EXPIRED'|'FORBIDDEN'|'CONFLICT'|
    'PROVIDER_UNAVAILABLE'|'INVALID_ACK'|'REVISION_UNAVAILABLE';
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
    this.origin=url.origin;this.key=publishableKey;this.token=accessToken;this.http=http;
  }
  private async call(rpc:string,payload:Record<string,unknown>):Promise<unknown>{
    const jwt=await this.token();
    if(!jwt)throw new PrivatePointerError('AUTH_EXPIRED','Sign in to manage a private release.');
    let response:Response;
    try{
      response=await this.http(this.origin+'/rest/v1/rpc/'+rpc,{
        method:'POST',headers:{apikey:this.key,Authorization:'Bearer '+jwt,
          'Content-Type':'application/json',Accept:'application/json'},
        body:JSON.stringify(payload),credentials:'omit',cache:'no-store',redirect:'error'
      });
    }catch{
      throw new PrivatePointerError('PROVIDER_UNAVAILABLE',
        'Private pointer update was not acknowledged; check state before retrying.');
    }
    if(!response.ok){
      const problem:unknown=await response.json().catch(()=>null);
      const message=record(problem)?problem.message:null;
      if(response.status===401)
        throw new PrivatePointerError('AUTH_EXPIRED','Session expired.');
      if(response.status===403||message==='PRIVATE_PORTFOLIO_NOT_FOUND')
        throw new PrivatePointerError('FORBIDDEN','Private portfolio is unavailable.');
      if(message==='PRIVATE_FROZEN_REQUEST_UNAVAILABLE')
        throw new PrivatePointerError('REVISION_UNAVAILABLE','Frozen revision is unavailable.');
      if(response.status===409||message==='PRIVATE_POINTER_CONFLICT'||
        message==='PRIVATE_POINTER_OPERATION_REUSED')
        throw new PrivatePointerError('CONFLICT','Private pointer changed; read current state.');
      if(message==='INVALID_PRIVATE_POINTER_PREPARE'||message==='INVALID_PRIVATE_POINTER_BLOCK'||
        message==='INVALID_PRIVATE_POINTER_READ')
        throw new PrivatePointerError('VALIDATION','Invalid private pointer operation.');
      throw new PrivatePointerError('PROVIDER_UNAVAILABLE','Private pointer operation was not confirmed.');
    }
    return response.json().catch(()=>null);
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
  async block(portfolioId:string,operationId:string):Promise<PrivatePointerReceipt>{
    if(!uuid(portfolioId)||!uuid(operationId))
      throw new PrivatePointerError('VALIDATION','Invalid private release block.');
    return receipt(await this.call('owner_block_private_release_pointer',{
      p_portfolio_id:portfolioId,p_operation_id:operationId
    }),portfolioId,'BLOCK');
  }
}
