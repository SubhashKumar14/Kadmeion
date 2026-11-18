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
import {portfolioLayout} from '../../editor-core/src/managed-project-files.ts';
import type {SafeSlotPlan,SafeSlotKind} from '../../editor-core/src/publish-preflight.ts';
import type {PortfolioSnapshot} from '../../editor-core/src/portfolio-revision-transactions.ts';
import type {PrivatePointerReceipt,PrivatePointerSnapshot} from '../../contracts/src/private-release-visibility-service.ts';
import {bindPrivateArtifactToPointer, type PrivateBindingContext}
  from './private-artifact-pointer-binding.ts';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const rec=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const MAX_STAGE_RECEIPT_BYTES=8192;

/** A storage acknowledgement is small metadata, never a media/source payload.
 * Bound even a streaming HTTP 200 body before parsing or accepting it. */
async function readBoundedStageReceipt(response:Response):Promise<unknown>{
  if(!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(
      response.headers.get('content-type')??''))
    throw new PrivateReviewerStagingError('INVALID_ACK');
  const claimed=response.headers.get('content-length');
  if(claimed!==null&&(!/^\d+$/.test(claimed)||Number(claimed)>MAX_STAGE_RECEIPT_BYTES))
    throw new PrivateReviewerStagingError('INVALID_ACK');
  if(!response.body)throw new PrivateReviewerStagingError('INVALID_ACK');
  const reader=response.body.getReader();
  const chunks:Uint8Array[]=[];
  let size=0;
  try{
    for(;;){
      const part=await reader.read();
      if(part.done)break;
      if(!(part.value instanceof Uint8Array)||size+part.value.byteLength>MAX_STAGE_RECEIPT_BYTES)
        throw new PrivateReviewerStagingError('INVALID_ACK');
      size+=part.value.byteLength;
      chunks.push(part.value);
    }
  }catch(error){
    if(error instanceof PrivateReviewerStagingError)throw error;
    // An interrupted successful HTTP response is not a confirmed store.
    throw new PrivateReviewerStagingError('UNCONFIRMED');
  }finally{
    await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
  const encoding=response.headers.get('content-encoding');
  if(size===0||(claimed!==null&&(!encoding||encoding.toLowerCase()==='identity')&&
      Number(claimed)!==size))
    throw new PrivateReviewerStagingError('INVALID_ACK');
  const bytes=new Uint8Array(size);
  let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw new PrivateReviewerStagingError('INVALID_ACK');}
}
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
    if(!response.ok){
      await response.body?.cancel().catch(()=>{});
      throw new PrivateReviewerStagingError('UNCONFIRMED');
    }
    return readBoundedStageReceipt(response);
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
  const artifact=await createPrivateImmutableArtifact({...loaded,plan:ctx.plan,
    renderSections:ctx.renderSections,portfolioTheme:ctx.portfolioTheme});
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

/** Server-side only. The request supplies identifiers, NEVER HTML or a plan. */
export interface OwnerPublicStageRequest {
  portfolioId:string;requestId:string;operationId:string;expectedGeneration:number;
}
export interface TrustedOwnerPublicStageContext {
  /** Must verify the actual live owner JWT/session for this portfolio, not
   * a caller identity string or a client boolean. */
  isCurrentOwner():Promise<boolean>;
  loader:PrivateBindingContext['loader'];
  pointer:PrivateBindingContext['pointer'] & {
    prepare(portfolioId:string,requestId:string,manifestSha256:string,
      expectedGeneration:number,operationId:string):Promise<PrivatePointerReceipt>;
  };
  writer:PrivateBindingContext['writer'];
  stageWriter:TrustedReviewerStageWriter;
}
export interface OwnerPublicStageReceipt {
  status:'STAGED_PRIVATE';portfolioId:string;requestId:string;operationId:string;
  generation:number;manifestSha256:string;htmlSha256:string;
  alreadyStored:boolean;publicServingEnabled:false;publicUrl:null;
}
const safeKinds:Readonly<Record<string,SafeSlotKind>>={
  'title-stacked@1':'heading','body-copy@1':'paragraph','external-link@1':'external-link',
  'technology-tag@1':'badge','author-metric@1':'metric','skills-list@1':'list',
  'project-card@1':'project-card','image@1':'image'
};
/** Same pinned layout/component rules as the owner preflight. Unknown owned
 * source is not a renderable component; the preflight must reject it. */
function trustedPublicStagePlan(snapshot:PortfolioSnapshot):SafeSlotPlan[]{
  const file=snapshot.files['pages/home.page.json'];
  if(!file)return [];
  const page=JSON.parse(file) as {sections?:{id?:unknown;layout?:unknown}[]};
  if(!Array.isArray(page.sections))return [];
  return page.sections.flatMap(section=>{
    if(!section||typeof section.id!=='string'||typeof section.layout!=='string')return [];
    const layout=portfolioLayout(section.layout);
    if(!layout)return [];
    return layout.slots.map(slot=>{
      const slotKey=section.id+'-'+slot.toLowerCase(),assigned=snapshot.slots[slotKey]?.componentId;
      const kind=assigned&&Object.hasOwn(safeKinds,assigned)?safeKinds[assigned]:undefined;
      return {slotKey,componentId:kind&&assigned?assigned:'body-copy@1',kind:kind??'paragraph',
        required:layout.required.includes(slot)};
    });
  });
}
/**
 * Actual trusted text-only prepare -> bind -> stage, with owner-scoped read
 * and atomic pointer CAS. Call from an authenticated server entry with
 * least-privileged direct SQL writer. No HTML/manifest/plan from the caller.
 * A retry must preserve expectedGeneration and operationId. Failed staging
 * is not publication; an older verified live route is not withdrawn here.
 */
export async function prepareAndStageOwnerPublicCandidate(request:OwnerPublicStageRequest,
  ctx:TrustedOwnerPublicStageContext):Promise<OwnerPublicStageReceipt>{
  if(!request||!UUID.test(request.portfolioId)||!UUID.test(request.requestId)||!UUID.test(request.operationId)||
    !Number.isSafeInteger(request.expectedGeneration)||request.expectedGeneration<0||
    request.expectedGeneration>=Number.MAX_SAFE_INTEGER-1||typeof ctx?.isCurrentOwner!=='function')
    throw new PrivateReviewerStagingError('INVALID_INPUT');
  const target=Object.freeze({...request});
  const requiredGeneration=target.expectedGeneration+1;
  const check=async()=>{
    if(!await ctx.isCurrentOwner())throw new PrivateReviewerStagingError('UNCONFIRMED');
  };
  await check();
  const loaded=await ctx.loader.load(target.requestId);
  await check();
  if(loaded.frozen.portfolioId!==target.portfolioId||loaded.loadedPortfolioId!==target.portfolioId||
     loaded.frozen.visibilityIntent!=='PUBLIC'||loaded.frozen.status!=='FROZEN'||loaded.frozen.publicUrl!==null)
    throw new PrivateReviewerStagingError('INVALID_INPUT');
  const plan=trustedPublicStagePlan(loaded.snapshot);
  const artifact=await createPrivateImmutableArtifact({...loaded,plan});
  await check();
  const before=await ctx.pointer.read(target.portfolioId);
  await check();
  if(before.portfolioId!==target.portfolioId||
     !(before.generation===target.expectedGeneration||
       (before.generation===requiredGeneration&&before.status==='PREPARED_PRIVATE'&&
        before.candidateRequestId===target.requestId&&before.candidateManifestSha256===artifact.manifestSha256)))
    throw new PrivateReviewerStagingError('UNCONFIRMED');
  // Even a matching prepared pointer is not proof that this operation
  // produced it. SQL checks the exact operation replay and CAS.
  const prepared=await ctx.pointer.prepare(target.portfolioId,target.requestId,
    artifact.manifestSha256,target.expectedGeneration,target.operationId);
  await check();
  if(prepared.portfolioId!==target.portfolioId||prepared.status!=='PREPARED_PRIVATE'||
     prepared.generation!==requiredGeneration||typeof prepared.alreadyRecorded!=='boolean'||
     prepared.publicServingEnabled!==false||prepared.publicUrl!==null||prepared.hostRevocationVerified!==false)
    throw new PrivateReviewerStagingError('INVALID_ACK');
  const readExact=async(id:string):Promise<PrivatePointerSnapshot>=>{
    await check();
    if(id!==target.portfolioId)throw new PrivateReviewerStagingError('INVALID_INPUT');
    const row=await ctx.pointer.read(id);
    await check();
    if(row.portfolioId!==id||row.status!=='PREPARED_PRIVATE'||row.generation!==requiredGeneration||
       row.candidateRequestId!==target.requestId||row.candidateManifestSha256!==artifact.manifestSha256||
       row.revocationGeneration>=requiredGeneration||row.publicServingEnabled!==false||
       row.publicUrl!==null||row.hostRevocationVerified!==false)
      throw new PrivateReviewerStagingError('UNCONFIRMED');
    return row;
  };
  const staged=await stagePrivateReviewerArtifact({
    portfolioId:target.portfolioId,requestId:target.requestId,plan,
    loader:{load:async id=>{
      if(id!==target.requestId)throw new PrivateReviewerStagingError('INVALID_INPUT');
      await check();
      const pin=await ctx.loader.load(id);
      await check();
      if(pin.loadedPortfolioId!==target.portfolioId||pin.loadedRevision!==loaded.loadedRevision||
         pin.loadedSnapshotSha256!==loaded.loadedSnapshotSha256||pin.frozen.visibilityIntent!=='PUBLIC')
        throw new PrivateReviewerStagingError('INTEGRITY');
      return pin;
    }},
    pointer:{read:readExact},
    writer:{bindPrivateArtifact:async input=>{
      await check();
      if(input.requestId!==target.requestId||input.expectedGeneration!==requiredGeneration)
        throw new PrivateReviewerStagingError('INVALID_INPUT');
      const result=await ctx.writer.bindPrivateArtifact(input);await check();return result;
    }}
  },{store:async input=>{
    await check();
    if(input.requestId!==target.requestId||input.generation!==requiredGeneration)
      throw new PrivateReviewerStagingError('INVALID_INPUT');
    const result=await ctx.stageWriter.store(input);await check();return result;
  }});
  await readExact(target.portfolioId);
  if(staged.requestId!==target.requestId||staged.generation!==requiredGeneration||
     staged.htmlSha256!==artifact.manifest.files[0].sha256)
    throw new PrivateReviewerStagingError('INVALID_ACK');
  return {status:'STAGED_PRIVATE',portfolioId:target.portfolioId,requestId:target.requestId,
    operationId:target.operationId,generation:requiredGeneration,manifestSha256:artifact.manifestSha256,
    htmlSha256:staged.htmlSha256,alreadyStored:staged.alreadyStored,publicServingEnabled:false,publicUrl:null};
}
