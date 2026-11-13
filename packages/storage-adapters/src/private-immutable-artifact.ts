import { ContractError } from '../../contracts/src/project.ts';
import { prepareSafeStaticPreview, type SafePreviewInput } from '../../editor-core/src/publish-preflight.ts';

const encoder = new TextEncoder();
const SHA256 = /^[0-9a-f]{64}$/;

export interface PrivateImmutableArtifactManifest {
  kind: 'kadmeion-private-immutable-artifact-candidate';
  formatVersion: 1;
  source: {
    portfolioId: string;
    revision: number;
    snapshotSha256: string;
    visibilityIntent: 'PUBLIC' | 'UNLISTED';
  };
  files: readonly [{path:'index.html'; byteLength:number; sha256:string}];
  deployable: false;
  publicUrl: null;
}
export interface PrivateImmutableArtifactCandidate {
  manifest: PrivateImmutableArtifactManifest;
  manifestSha256: string;
  files: readonly [{path:'index.html'; bytes:Uint8Array}];
  deployable: false;
  publicUrl: null;
}
export interface VerifiedPrivateArtifact {
  verified: true;
  manifestSha256: string;
  deployable: false;
  publicUrl: null;
}

async function sha256(bytes:Uint8Array):Promise<string> {
  const digest=await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
function fail():never {
  throw new ContractError('VALIDATION','Private immutable artifact integrity verification failed.');
}
const record=(value:unknown):value is Record<string,unknown>=>
  value!==null&&typeof value==='object'&&!Array.isArray(value);

/**
 * Host-neutral, PRIVATE B4 candidate, not a public release or deployment adapter.
 * The input MUST come from the authenticated atomic frozen-revision loader, with
 * a trusted, pinned render plan. SHA-256 binds bytes to that verified input; it
 * does not independently establish owner authorization or revocation.
 *
 * Only the preflight's scriptless HTML projection is included. No owner source,
 * private assets, credentials, release URL or host capability is copied.
 */
export async function createPrivateImmutableArtifact(
  input:SafePreviewInput
):Promise<PrivateImmutableArtifactCandidate> {
  const preview=prepareSafeStaticPreview(input);
  if(preview.status!=='PREVIEW_ONLY'||preview.publicationReady!==false||
     typeof preview.previewHtml!=='string'||
     preview.blockers.length!==1||preview.blockers[0].code!=='PUBLIC_DELIVERY_UNVERIFIED')
    throw new ContractError('VALIDATION','Private frozen revision did not pass safe preview preflight.');
  // Capture the frozen pin before any asynchronous hashing.
  const source={
    portfolioId:input.frozen.portfolioId,
    revision:input.frozen.revision,
    snapshotSha256:input.frozen.snapshotSha256,
    visibilityIntent:input.frozen.visibilityIntent
  };
  const bytes=encoder.encode(preview.previewHtml);
  if(bytes.byteLength===0||bytes.byteLength>750000)
    throw new ContractError('VALIDATION','Private static HTML exceeds the release candidate limit.');
  const fileSha=await sha256(bytes);
  const manifest:PrivateImmutableArtifactManifest={
    kind:'kadmeion-private-immutable-artifact-candidate',
    formatVersion:1,
    source,
    files:[{path:'index.html',byteLength:bytes.byteLength,sha256:fileSha}],
    deployable:false,
    publicUrl:null
  };
  const manifestSha256=await sha256(encoder.encode(JSON.stringify(manifest)));
  return {manifest,manifestSha256,files:[{path:'index.html',bytes}],
    deployable:false,publicUrl:null};
}

/**
 * Re-render against the expected private frozen revision, rather than merely
 * trusting a caller-supplied checksum. Rejects modified bytes, manifest pins,
 * extra files and fabricated deployment authority. Never flips a live pointer.
 */
export async function verifyPrivateImmutableArtifact(
  candidate:unknown,input:SafePreviewInput
):Promise<VerifiedPrivateArtifact> {
  const expected=await createPrivateImmutableArtifact(input);
  if(!record(candidate)||Object.keys(candidate).length!==5||
     candidate.deployable!==false||candidate.publicUrl!==null||
     typeof candidate.manifestSha256!=='string'||!SHA256.test(candidate.manifestSha256)||
     candidate.manifestSha256!==expected.manifestSha256||
     !record(candidate.manifest)||!Array.isArray(candidate.files)||
     candidate.files.length!==1)
    fail();
  // Exact manifest equality also rejects unexpected public URLs, fields and paths.
  if(JSON.stringify(candidate.manifest)!==JSON.stringify(expected.manifest))fail();
  const file:unknown=candidate.files[0];
  if(!record(file)||Object.keys(file).length!==2||
     file.path!=='index.html'||!(file.bytes instanceof Uint8Array))fail();
  const bytes=file.bytes as Uint8Array;
  const original=expected.files[0].bytes;
  if(bytes.byteLength!==original.byteLength)fail();
  for(let i=0;i<bytes.byteLength;i++)if(bytes[i]!==original[i])fail();
  // Verify both independent digest computations, not only string equality.
  if(await sha256(bytes)!==expected.manifest.files[0].sha256||
     await sha256(encoder.encode(JSON.stringify(candidate.manifest)))!==expected.manifestSha256)
    fail();
  return {verified:true,manifestSha256:expected.manifestSha256,
    deployable:false,publicUrl:null};
}
