/**
 * Trusted server-only B4 composition: attested owner snapshot -> deterministic
 * scriptless private artifact -> restricted SQL pointer bind -> bounded staged
 * HTML write. Never import this module from a browser or public static bundle.
 *
 * Stage != Publish: the store response never grants a public URL. A separate
 * reviewer HTTP host must verify the token and block all direct asset paths.
 */
import {ContractError} from '../../contracts/src/project.ts';
import {createPrivateImmutableArtifact} from './private-immutable-artifact.ts';
import {bindPrivateArtifactToPointer, type PrivateBindingContext}
  from './private-artifact-pointer-binding.ts';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const rec=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export class PrivateReviewerStagingError extends Error {
  readonly code:'INVALID_INPUT'|'INTEGRITY'|'UNCONFIRMED'|'INVALID_ACK';
  constructor(code:PrivateReviewerStagingError['code']){
    super('Private reviewer staging could not be verified.');
    this.name='PrivateReviewerStagingError';this.code=code;
  }
}
export interface StageArtifactRequest {
  requestId:string;
  generation:number;
  html:string;
}
export interface TrustedReviewerStageWriter {
  store(request:StageArtifactRequest):Promise<unknown>;
}
export interface StagedPrivateReviewerReceipt {
  status:'STAGED_PRIVATE';
  requestId:string;
  generation:number;
  htmlSha256:string;
  alreadyStored:boolean;
  publicServingEnabled:false;
  publicUrl:null;
}
/** Server-only service-role RPC connector. Never export from browser index. */
export class SupabaseTrustedReviewerStageWriter implements TrustedReviewerStageWriter {
  private readonly origin:string;
  private readonly secret:string;
  private readonly http:typeof fetch;
  constructor(origin:string,secret:string,http:typeof fetch=fetch){
    let u:URL;
    try{u=new URL(origin);}
    catch{throw new PrivateReviewerStagingError('INVALID_INPUT');}
    if((u.protocol!=='https:'&&!(u.protocol==='http:'&&
         ['localhost','127.0.0.1'].includes(u.hostname)))||
       u.pathname!=='/'||u.username||u.password||u.search||u.hash||
       typeof secret!=='string'||secret.length<70||
       !secret.startsWith('eyJ')){
      throw new PrivateReviewerStagingError('INVALID_INPUT');
    }
    this.origin=u.origin;this.secret=secret;this.http=http;
  }
  async store(request:StageArtifactRequest):Promise<unknown>{
    if(!request||!UUID.test(request.requestId)||
       !Number.isSafeInteger(request.generation)||request.generation<1||
       typeof request.html!=='string'||
       request.html.length<70||new TextEncoder().encode(request.html).byteLength>750000)
      throw new PrivateReviewerStagingError('INVALID_INPUT');
    let response:Response;
    try{
      response=await this.http(this.origin+'/rest/v1/rpc/store_private_reviewer_stage_artifact',{
        method:'POST',headers:{
          apikey:this.secret,Authorization:'Bearer '+this.secret,
          'Content-Type':'application/json',Accept:'application/json',
          'Cache-Control':'no-store'
        },
        body:JSON.stringify({
          p_request_id:request.requestId,
          p_expected_generation:request.generation,
          p_html:request.html
        }),
        cache:'no-store',credentials:'omit',redirect:'error',
        signal:AbortSignal.timeout(10000)
      });
    }catch{throw new PrivateReviewerStagingError('UNCONFIRMED');}
    if(!response.ok)throw new PrivateReviewerStagingError('UNCONFIRMED');
    try{return await response.json();}
    catch{throw new PrivateReviewerStagingError('INVALID_ACK');}
  }
}
/**
 * A separate DB statement re-checks pointer generation/Trash/moderation and
 * bound HTML SHA just before storing bytes; a race never silently stages a
 * different generation. The generation can later be blocked or revoked.
 */
export async function stagePrivateReviewerArtifact(
  ctx:PrivateBindingContext,
  writer:TrustedReviewerStageWriter
):Promise<StagedPrivateReviewerReceipt>{
  if(!writer||typeof writer.store!=='function')
    throw new PrivateReviewerStagingError('INVALID_INPUT');
  const bound=await bindPrivateArtifactToPointer(ctx);
  const loaded=await ctx.loader.load(ctx.requestId);
  const artifact=await createPrivateImmutableArtifact({...loaded,plan:ctx.plan});
  const file=artifact.files[0];
  if(artifact.manifestSha256!==bound.manifestSha256||
     artifact.manifest.files[0].sha256!==bound.htmlSha256||
     artifact.manifest.source.portfolioId!==ctx.portfolioId)
    throw new PrivateReviewerStagingError('INTEGRITY');
  let raw:unknown;
  try{
    raw=await writer.store({requestId:ctx.requestId,generation:bound.generation,
      html:new TextDecoder('utf-8',{fatal:true}).decode(file.bytes)});
  }catch{throw new PrivateReviewerStagingError('UNCONFIRMED');}
  if(!rec(raw)||Object.keys(raw).length!==7||
     raw.status!=='STAGED_PRIVATE'||raw.requestId!==ctx.requestId||
     raw.generation!==bound.generation||typeof raw.htmlSha256!=='string'||
     !SHA.test(raw.htmlSha256)||raw.htmlSha256!==bound.htmlSha256||
     typeof raw.alreadyStored!=='boolean'||raw.publicServingEnabled!==false||
     raw.publicUrl!==null)
    throw new PrivateReviewerStagingError('INVALID_ACK');
  return {
    status:'STAGED_PRIVATE',requestId:ctx.requestId,generation:bound.generation,
    htmlSha256:bound.htmlSha256,alreadyStored:raw.alreadyStored,
    publicServingEnabled:false,publicUrl:null
  };
}
