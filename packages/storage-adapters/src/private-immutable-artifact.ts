import type { SanitizedPublicationPng } from './safe-png-publication.ts';
import {writeStoredZip} from './portable-source-archive.ts';
import { ContractError } from '../../contracts/src/project.ts';
import { prepareSafeStaticPreview, readSafeImageSlotContent, SAFE_IMAGE_COMPONENT,
  type SafePreviewInput, type SafeStaticImage } from '../../editor-core/src/publish-preflight.ts';
import { assertAttestedPrivateFrozenRevision } from './private-frozen-revision-loader.ts';

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
 * a trusted, pinned render plan. Process-local attestation rejects cloned or
 * mutable snapshots after load. SHA-256 binds bytes to that verified input; it
 * does not independently establish future owner authorization or revocation.
 *
 * Only the preflight's scriptless HTML projection is included. No owner source,
 * private assets, credentials, release URL or host capability is copied.
 */
export async function createPrivateImmutableArtifact(
  input:SafePreviewInput
):Promise<PrivateImmutableArtifactCandidate> {
  // Caller-supplied matching hashes are not evidence. Only the owner-RPC loader
  // registers the canonical, recursively frozen snapshot object.
  assertAttestedPrivateFrozenRevision(input);
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


/**
 * B08 server-only composition of the attested frozen text artifact with
 * bounded, recompressed raster images. The media plan MUST be selected by
 * trusted server code from authorized frozen project references; a reader
 * MUST independently enforce the owner session, current Storage version,
 * and the write-once DB SHA pin. These callback interfaces are NOT proofs
 * against a compromised provider or an untrusted caller.
 *
 * This is a private portable release CANDIDATE, not a public authorization.
 * No public route, cache state, SQL pointer or direct asset URL is changed.
 */
export interface ServerPinnedPrivateMediaPlanItem {
  assetId:string;
  expectedSourceSha256:string;
  altText:string;
}
export interface ServerPinnedPrivateMediaReceipt {
  assetId:string;
  portfolioId:string;
  revision:number;
  sourceSha256:string;
  mimeType:'image/png';
  storageVersion:string;
  bytes:Uint8Array;
}
export interface TrustedPrivateMediaReader {
  readFrozenPinnedImage(query:{assetId:string;portfolioId:string;revision:number}):
    Promise<ServerPinnedPrivateMediaReceipt>;
}
export interface PrivateImmutableMediaCandidate {
  manifest:{
    kind:'kadmeion-private-media-artifact-candidate';
    formatVersion:1;
    source:PrivateImmutableArtifactManifest['source'];
    files:ReadonlyArray<{path:string;byteLength:number;sha256:string}>;
    media:ReadonlyArray<{
      assetId:string;originalSha256:string;path:string;
      width:number;height:number;altText:string;
    }>;
    deployable:false;
    publicUrl:null;
  };
  manifestSha256:string;
  files:ReadonlyArray<{path:string;bytes:Uint8Array}>;
  deployable:false;
  publicUrl:null;
}
const MEDIA_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEDIA_SHA=/^[0-9a-f]{64}$/;
const MEDIA_ALT_BAD=/[\u0000-\u001f\u007f]/;
const escapeMediaAlt=(text:string):string=>text.replace(/&/g,'&amp;')
  .replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  .replace(/'/g,'&#39;');

export async function createPrivateImmutableMediaCandidate(
  input:SafePreviewInput,
  plan:readonly ServerPinnedPrivateMediaPlanItem[],
  reader:TrustedPrivateMediaReader
):Promise<PrivateImmutableMediaCandidate>{
  const original=await createPrivateImmutableArtifact(input);
  return buildPrivateMediaCandidate(input,plan,reader,{html:new TextDecoder('utf-8',{fatal:true})
    .decode(original.files[0].bytes)});
}

/** Resolve only image assignments in the exact attested snapshot and trusted layout plan. */
export async function createPrivateImmutableMediaCandidateFromFrozenSlots(
  input:SafePreviewInput,
  reader:TrustedPrivateMediaReader
):Promise<PrivateImmutableMediaCandidate>{
  assertAttestedPrivateFrozenRevision(input);
  // Pin the server-supplied plan before asynchronous Storage reads.
  input={...input,frozen:{...input.frozen},plan:input.plan.map(slot=>({...slot})),
    renderSections:input.renderSections?.map(section=>({...section,slotKeys:[...section.slotKeys]})),
    portfolioTheme:input.portfolioTheme&&{...input.portfolioTheme}};
  // The normal preflight already checks section membership, pinned layout,
  // component IDs and every active slot. Accept only missing verified bytes.
  const preview=prepareSafeStaticPreview(input);
  if(preview.blockers.some(({code})=>code!=='IMAGE_BYTES_UNVERIFIED'&&code!=='PUBLIC_DELIVERY_UNVERIFIED'))
    throw new ContractError('VALIDATION','Frozen image slot preflight failed.');
  const plan:ServerPinnedPrivateMediaPlanItem[]=[];
  const slotKeys:string[]=[];
  for(const spec of input.plan){
    if(spec.kind!=='image'||spec.componentId!==SAFE_IMAGE_COMPONENT)continue;
    const slot=input.snapshot.slots[spec.slotKey];
    if(slot?.state!=='S0')continue;
    const media=readSafeImageSlotContent(slot.content);
    if(!media)throw new ContractError('VALIDATION','Frozen image slot reference is invalid.');
    plan.push(media);
    slotKeys.push(spec.slotKey);
  }
  return buildPrivateMediaCandidate(input,plan,reader,{slotKeys});
}

async function buildPrivateMediaCandidate(
  input:SafePreviewInput,plan:readonly ServerPinnedPrivateMediaPlanItem[],
  reader:TrustedPrivateMediaReader,placement:{html:string}|{slotKeys:readonly string[]}
):Promise<PrivateImmutableMediaCandidate>{
  const {portfolioId,revision,snapshotSha256,visibilityIntent}=input.frozen;
  // Delay loading Node-only raster codec until this server-only method executes.
  const {sanitizePngForPrivatePublicationCandidate}=await import('./safe-png-publication.ts');
  if(!Array.isArray(plan)||plan.length===0||plan.length>8||
     !reader||typeof reader.readFrozenPinnedImage!=='function')
    throw new ContractError('VALIDATION','Trusted private media plan is required.');
  const fetched=new Map<string,{sourceSha:string;sanitized:SanitizedPublicationPng}>();
  const resolvedSlots=new Map<string,SafeStaticImage>();
  const paths=new Set<string>(),files:{
    path:string;bytes:Uint8Array
  }[]=[];
  const media:PrivateImmutableMediaCandidate['manifest']['media'][number][]=[];
  const fragments:string[]=[];
  let total=0;
  for(const [index,item] of plan.entries()){
    if(!item||typeof item!=='object'||Array.isArray(item)||
       Object.keys(item).sort().join(',')!=='altText,assetId,expectedSourceSha256')
      throw new ContractError('VALIDATION','Private media plan: invalid field layout.');
    if(typeof item.assetId!=='string')
      throw new ContractError('VALIDATION','Private media plan: asset reference must be text.');
    if(!MEDIA_UUID.test(item.assetId))
      throw new ContractError('VALIDATION','Private media plan: asset reference syntax is invalid.');
    if(typeof item.expectedSourceSha256!=='string'||
       !MEDIA_SHA.test(item.expectedSourceSha256))
      throw new ContractError('VALIDATION','Private media plan: invalid source digest.');
    if(typeof item.altText!=='string'||item.altText.length>300||
       MEDIA_ALT_BAD.test(item.altText))
      throw new ContractError('VALIDATION','Private media plan: invalid text alternative.');
    const {assetId,expectedSourceSha256,altText}=item;
    let result=fetched.get(assetId);
    if(result&&('html' in placement||result.sourceSha!==expectedSourceSha256))
      throw new ContractError('VALIDATION','Private media plan: duplicate or conflicting asset reference.');
    if(!result){
      let evidence:unknown;
      try{
        evidence=await reader.readFrozenPinnedImage({assetId,portfolioId,revision});
      }catch{
        throw new ContractError('VALIDATION','Private media authorization or Storage read failed.');
      }
      if(!record(evidence)||Object.keys(evidence).sort().join(',')!==
         'assetId,bytes,mimeType,portfolioId,revision,sourceSha256,storageVersion'||
         evidence.assetId!==assetId||evidence.portfolioId!==portfolioId||evidence.revision!==revision||
         evidence.mimeType!=='image/png'||evidence.sourceSha256!==expectedSourceSha256||
         typeof evidence.storageVersion!=='string'||
         !/^[A-Za-z0-9_-]{1,128}$/.test(evidence.storageVersion)||
         !(evidence.bytes instanceof Uint8Array)||
         evidence.bytes.byteLength===0||evidence.bytes.byteLength>5*1024*1024)
        throw new ContractError('VALIDATION','Pinned media evidence does not match this frozen release.');
      const sourceBytes=Uint8Array.from(evidence.bytes);
      const sourceSha=await sha256(sourceBytes);
      if(sourceSha!==expectedSourceSha256)
        throw new ContractError('VALIDATION','Private media bytes disagree with the immutable source pin.');
      try{result={sourceSha,sanitized:sanitizePngForPrivatePublicationCandidate(sourceBytes)};}
      catch{throw new ContractError('VALIDATION','Private media failed strict raster validation.');}
      fetched.set(assetId,result);
    }
    const {sourceSha,sanitized}=result;
    const path='assets/'+sanitized.sha256+'.png';
    if(!paths.has(path)){
      total+=sanitized.bytes.byteLength;
      if(total>8*1024*1024)
        throw new ContractError('VALIDATION','Private media candidate exceeds its byte budget.');
      paths.add(path);
      files.push({path,bytes:sanitized.bytes});
    }
    media.push({assetId,originalSha256:sourceSha,path,
      width:sanitized.width,height:sanitized.height,altText});
    if('slotKeys' in placement)
      resolvedSlots.set(placement.slotKeys[index],{path,width:sanitized.width,height:sanitized.height});
    else fragments.push('<figure><img loading="lazy" decoding="async" src="./'+path+
      '" alt="'+escapeMediaAlt(altText)+'" width="'+sanitized.width+
      '" height="'+sanitized.height+'"></figure>');
  }
  let html:string;
  if('slotKeys' in placement){
    assertAttestedPrivateFrozenRevision(input);
    const preview=prepareSafeStaticPreview(input,resolvedSlots);
    if(preview.status!=='PREVIEW_ONLY'||preview.blockers.length!==1||!preview.previewHtml)
      throw new ContractError('VALIDATION','Frozen image slot could not be rendered.');
    html=preview.previewHtml;
  }else{
    html=addPrivatePreviewGallery(placement.html,fragments);
  }
  const htmlBytes=encoder.encode(html);
  if(htmlBytes.length>750000)
    throw new ContractError('VALIDATION','Private media HTML exceeds release preview limits.');
  const orderedFiles=[{path:'index.html',bytes:htmlBytes},...files];
  const manifest:PrivateImmutableMediaCandidate['manifest']={
    kind:'kadmeion-private-media-artifact-candidate',formatVersion:1,
    source:{portfolioId,revision,snapshotSha256,visibilityIntent},
    files:await Promise.all(orderedFiles.map(async file=>({
      path:file.path,byteLength:file.bytes.byteLength,sha256:await sha256(file.bytes)
    }))),
    media,deployable:false,publicUrl:null
  };
  const manifestSha256=await sha256(encoder.encode(JSON.stringify(manifest)));
  return {manifest,manifestSha256,files:orderedFiles,deployable:false,publicUrl:null};
}

function addPrivatePreviewGallery(originalHtml:string,fragments:readonly string[]):string {
  const blockedCsp="img-src &#39;none&#39;";
  const endMain='</main>';
  if(originalHtml.split(blockedCsp).length!==2||
     originalHtml.split(endMain).length!==2||
     originalHtml.split('</style>').length!==2)
    throw new ContractError('VALIDATION','Private static preview markup cannot be extended safely.');
  const gallery='<section class="k-media-gallery" aria-label="Project images">'+
    fragments.join('')+'</section>';
  return originalHtml.replace(blockedCsp,"img-src &#39;self&#39;")
    .replace('</style>',
      '.k-media-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr));gap:1rem}.k-media-gallery figure{margin:0}.k-media-gallery img{display:block;max-width:100%;height:auto}'+
      '</style>')
    .replace(endMain,gallery+endMain);

}

/** Re-read and rebuild the entire private candidate before accepting its bytes. */
export async function verifyPrivateImmutableMediaCandidate(
  candidate:unknown,input:SafePreviewInput,
  plan:readonly ServerPinnedPrivateMediaPlanItem[],
  reader:TrustedPrivateMediaReader
):Promise<VerifiedPrivateArtifact>{
  const expected=await createPrivateImmutableMediaCandidate(input,plan,reader);
  if(!record(candidate)||Object.keys(candidate).sort().join(',')!==
     'deployable,files,manifest,manifestSha256,publicUrl'||
     candidate.deployable!==false||candidate.publicUrl!==null||
     candidate.manifestSha256!==expected.manifestSha256||
     !record(candidate.manifest)||
     JSON.stringify(candidate.manifest)!==JSON.stringify(expected.manifest)||
     !Array.isArray(candidate.files)||
     candidate.files.length!==expected.files.length)
    fail();
  for(let i=0;i<expected.files.length;i++){
    const actual:unknown=candidate.files[i],target=expected.files[i];
    if(!record(actual)||Object.keys(actual).sort().join(',')!=='bytes,path'||
       actual.path!==target.path||!(actual.bytes instanceof Uint8Array)||
       actual.bytes.length!==target.bytes.length)fail();
    const raw=actual.bytes as Uint8Array;
    for(let j=0;j<raw.length;j++)if(raw[j]!==target.bytes[j])fail();
  }
  return {verified:true,manifestSha256:expected.manifestSha256,
    deployable:false,publicUrl:null};
}


/**
 * Offline static media preview. The archive intentionally omits owner IDs,
 * frozen source digest, access tokens and raw Storage paths. It is not a
 * public release claim and contains no executable author-supplied JavaScript.
 * The original source ZIP continues to use its separate stricter 2 MiB cap.
 */
export async function exportPrivateStandaloneMediaPreview(
  input:SafePreviewInput,
  mediaPlan:readonly ServerPinnedPrivateMediaPlanItem[]|undefined,
  reader:TrustedPrivateMediaReader
):Promise<{zip:Uint8Array;htmlSha256:string;previewOnly:true;publicUrl:null}>{
  const candidate=mediaPlan===undefined
    ?await createPrivateImmutableMediaCandidateFromFrozenSlots(input,reader)
    :await createPrivateImmutableMediaCandidate(input,mediaPlan,reader);
  const exposedManifest={
    kind:'kadmeion-standalone-media-preview',
    formatVersion:1,
    previewOnly:true,
    publicUrl:null,
    files:candidate.manifest.files,
    limitations:[
      'No publication or third-party cache revocation proof',
      'Scriptless text and sanitized PNG only; custom JavaScript excluded',
      'Serve as private local static preview; noindex by default'
    ]
  };
  const manifest=encoder.encode(JSON.stringify(exposedManifest));
  const readme=encoder.encode('KADMEION PRIVATE STATIC MEDIA PREVIEW\n'+
    'Extract this archive and serve index.html using a local HTTP static server.\n'+
    'This archive is NOT a verified public release, and has no live URL.\n'+
    'The preview is noindex, scriptless and uses relative sanitized PNG assets.\n');
  const zip=writeStoredZip([
    ...candidate.files.map(file=>({name:file.path,bytes:file.bytes})),
    {name:'kadmeion-static-media-preview.json',bytes:manifest},
    {name:'README.txt',bytes:readme}
  ],{maxEntries:11,maxBytes:10*1024*1024,maxEntryBytes:5*1024*1024});
  return {zip,htmlSha256:candidate.manifest.files[0].sha256,
    previewOnly:true,publicUrl:null};
}
