/**
 * Restricted server orchestration: attested owner-RPC snapshot -> trusted text
 * render -> verified private bytes -> current private pointer -> DB-only bind.
 *
 * This module is deliberately NOT re-exported from the browser-facing index.
 * Supply a trusted, pinned render plan and a server-only SQL binding writer.
 * The writer MUST use the non-exposed service-role DB function, not PostgREST.
 * Even on success, nothing here is a publish, artifact upload or serving grant.
 */
import type { SafeSlotPlan,SafePreviewInput } from '../../editor-core/src/publish-preflight.ts';
import type { LoadedPrivateFrozenRevision } from './private-frozen-revision-loader.ts';
import { createPrivateImmutableArtifact,verifyPrivateImmutableArtifact }
  from './private-immutable-artifact.ts';
import type { PrivatePointerSnapshot } from '../../contracts/src/private-release-visibility-service.ts';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const record=(v:unknown):v is Record<string,unknown>=>
  v!==null&&typeof v==='object'&&!Array.isArray(v);
export class PrivateArtifactBindingError extends Error {
  readonly code:'VALIDATION'|'POINTER_CONFLICT'|'BINDING_UNCONFIRMED'|'INVALID_ACK';
  constructor(code:PrivateArtifactBindingError['code'],message:string){
    super(message);this.name='PrivateArtifactBindingError';this.code=code;
  }
}
export interface TrustedPrivateBindingRequest {
  requestId:string;
  expectedGeneration:number;
  manifestJson:string;
  html:string;
}
export interface TrustedPrivateBindingWriter {
  /** Direct SQL connection, service role, private schema. Never public REST. */
  bindPrivateArtifact(request:TrustedPrivateBindingRequest):Promise<unknown>;
}
export interface PrivateBindingContext {
  portfolioId:string;
  requestId:string;
  /** Only a server-pinned template plan, never a user-defined input. */
  plan:readonly SafeSlotPlan[];
  loader:{load(requestId:string):Promise<LoadedPrivateFrozenRevision>};
  pointer:{read(portfolioId:string):Promise<PrivatePointerSnapshot>};
  writer:TrustedPrivateBindingWriter;
}
export interface PrivateBoundArtifactReceipt {
  portfolioId:string;requestId:string;generation:number;
  manifestSha256:string;htmlSha256:string;
  status:'BOUND_PRIVATE';alreadyBound:boolean;integrityChecked:true;
  publicServingEnabled:false;publicUrl:null;hostRevocationVerified:false;
}

/**
 * Checks integrity locally, then binds against current DB pointer state. A
 * concurrent block/Trash after pointer.read MUST be rejected by the SQL CAS.
 */
export async function bindPrivateArtifactToPointer(
  ctx:PrivateBindingContext
):Promise<PrivateBoundArtifactReceipt>{
  if(!ctx||!UUID.test(ctx.requestId)||!UUID.test(ctx.portfolioId)||
     !Array.isArray(ctx.plan)||ctx.plan.length===0||
     typeof ctx.loader?.load!=='function'||typeof ctx.pointer?.read!=='function'||
     typeof ctx.writer?.bindPrivateArtifact!=='function')
    throw new PrivateArtifactBindingError('VALIDATION','Invalid private artifact binding dependencies.');
  const loaded=await ctx.loader.load(ctx.requestId);
  if(loaded.frozen.portfolioId!==ctx.portfolioId)
    throw new PrivateArtifactBindingError('VALIDATION','Frozen revision belongs to another portfolio.');
  const input:SafePreviewInput={...loaded,plan:ctx.plan};
  // This requires the process-local WeakMap proof generated ONLY by the
  // authenticated atomic loader and rerenders a deterministic scriptless HTML.
  const artifact=await createPrivateImmutableArtifact(input);
  const evidence=await verifyPrivateImmutableArtifact(artifact,input);
  if(!evidence.verified||evidence.manifestSha256!==artifact.manifestSha256||
     artifact.manifest.source.portfolioId!==ctx.portfolioId||
     artifact.files.length!==1||artifact.files[0].path!=='index.html')
    throw new PrivateArtifactBindingError('VALIDATION','Private artifact integrity mismatch.');
  const pointer=await ctx.pointer.read(ctx.portfolioId);
  if(pointer.portfolioId!==ctx.portfolioId||
     pointer.status!=='PREPARED_PRIVATE'||
     pointer.candidateRequestId!==ctx.requestId||
     pointer.candidateManifestSha256!==artifact.manifestSha256||
     !Number.isSafeInteger(pointer.generation)||pointer.generation<1||
     !Number.isSafeInteger(pointer.revocationGeneration)||
     pointer.revocationGeneration<0||
     pointer.revocationGeneration>pointer.generation||
     pointer.publicServingEnabled!==false||pointer.publicUrl!==null||
     pointer.hostRevocationVerified!==false)
    throw new PrivateArtifactBindingError('POINTER_CONFLICT',
      'Private release candidate changed or is not integrity-matched.');
  // Decode only trusted TextEncoder output, not arbitrary user-controlled files.
  const html=new TextDecoder('utf-8',{fatal:true}).decode(artifact.files[0].bytes);
  const manifestJson=JSON.stringify(artifact.manifest);
  let raw:unknown;
  try{
    raw=await ctx.writer.bindPrivateArtifact({
      requestId:ctx.requestId,expectedGeneration:pointer.generation,manifestJson,html
    });
  }catch{
    throw new PrivateArtifactBindingError('BINDING_UNCONFIRMED',
      'Private artifact binding was not confirmed; inspect current pointer state.');
  }
  const expectedFile=artifact.manifest.files[0];
  if(!record(raw)||Object.keys(raw).length!==11||
     raw.portfolioId!==ctx.portfolioId||raw.requestId!==ctx.requestId||
     raw.generation!==pointer.generation||
     raw.manifestSha256!==artifact.manifestSha256||
     raw.htmlSha256!==expectedFile.sha256||
     raw.status!=='BOUND_PRIVATE'||typeof raw.alreadyBound!=='boolean'||
     raw.integrityChecked!==true||raw.publicServingEnabled!==false||
     raw.publicUrl!==null||raw.hostRevocationVerified!==false||
     !SHA.test(raw.manifestSha256 as string)||!SHA.test(raw.htmlSha256 as string))
    throw new PrivateArtifactBindingError('INVALID_ACK',
      'Trusted database did not confirm the private artifact binding.');
  return {
    portfolioId:ctx.portfolioId,requestId:ctx.requestId,
    generation:pointer.generation,manifestSha256:artifact.manifestSha256,
    htmlSha256:expectedFile.sha256,status:'BOUND_PRIVATE',
    alreadyBound:raw.alreadyBound as boolean,integrityChecked:true,
    publicServingEnabled:false,publicUrl:null,hostRevocationVerified:false
  };
}
