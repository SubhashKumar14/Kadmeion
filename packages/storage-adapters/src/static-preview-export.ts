import { ContractError } from '../../contracts/src/project.ts';
import { prepareSafeStaticPreview, type SafePreviewInput } from '../../editor-core/src/publish-preflight.ts';
import { portfolioLayout } from '../../editor-core/src/managed-project-files.ts';
import { readStrictStoredZip, writeStoredZip } from './portable-source-archive.ts';

const encoder=new TextEncoder();
const limits={maxEntries:3,maxBytes:1024*1024,maxEntryBytes:750000};
async function sha256(bytes:Uint8Array):Promise<string>{
  const digest=await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
/**
 * The shared renderer currently checks the slot set and section order, but
 * can preserve a caller's reversed order within a canonical slotKeys section.
 * Reject that disagreement at the archive boundary rather than reorder bytes
 * or claim parity. Legacy layoutless/slot-map snapshots keep their old rules.
 * Remove this defense only after the shared renderer independently enforces it.
 */
function assertCanonicalSlotOrder(input:SafePreviewInput):void{
  const raw=input.snapshot.files['pages/home.page.json'];
  if(raw===undefined)return;
  const page=JSON.parse(raw) as {sections?:Array<{id:string;layout:string;slotKeys?:unknown}>};
  if(!Array.isArray(page.sections))return; // Shared preflight owns schema validation.
  for(const section of page.sections){
    if(!Array.isArray(section.slotKeys))continue;
    const layout=portfolioLayout(section.layout);
    if(!layout)throw new ContractError('VALIDATION','Static archive layout is not a pinned layout.');
    const expected=layout.slots.map(name=>section.id+'-'+name.toLowerCase());
    const expectedSet=new Set(expected);
    const observed=input.plan.filter(spec=>expectedSet.has(spec.slotKey)).map(spec=>spec.slotKey);
    if(observed.length!==expected.length||expected.some((key,i)=>observed[i]!==key))
      throw new ContractError('VALIDATION','Static archive plan disagrees with the canonical layout slot order.');
  }
}
export interface StaticPreviewArchive {
  zip:Uint8Array;
  htmlSha256:string;
  archiveSha256:string;
  previewOnly:true;
  publicUrl:null;
}
/**
 * B4 portable static PREVIEW only. The host/public privacy proof is missing.
 * No editor files, private asset URLs, scripts, user-owned TSX or credentials
 * are copied into this archive. It is not input to the public host publisher.
 */
export async function exportStandaloneStaticPreview(input:SafePreviewInput):Promise<StaticPreviewArchive> {
  const result=prepareSafeStaticPreview(input);
  if(result.status!=='PREVIEW_ONLY'||result.publicationReady!==false||!result.previewHtml||
    result.blockers.length!==1||result.blockers[0]?.code!=='PUBLIC_DELIVERY_UNVERIFIED')
    throw new ContractError('VALIDATION','Private static preview preflight is not valid.');
  assertCanonicalSlotOrder(input);
  const html=encoder.encode(result.previewHtml);
  const htmlSha256=await sha256(html);
  // Export deliberately omits owner ID, raw snapshot SHA, access tokens and project paths.
  const manifest=encoder.encode(JSON.stringify({
    kind:'kadmeion-static-preview',formatVersion:1,previewOnly:true,
    publicUrl:null,sourceRevision:input.loadedRevision,
    files:[{path:'index.html',bytes:html.length,sha256:htmlSha256}],
    limitations:['Supports scriptless text layouts. Custom JavaScript and media assets are excluded.',
      'No publish, staging URL, verified hosting or content revocation',
      'Noindex by default; manual static HTTP serving only']
  }));
  const readme=encoder.encode('KADMEION: STATIC PREVIEW ONLY\n\n'+
    'Extract the ZIP and serve index.html from a local static HTTP server.\n'+
    'This is a safe, scriptless text projection, not an approved complete template.\n'+
    'The JSON manifest records index.html SHA-256; no public URL exists.\n');
  const parts=[
    {name:'index.html',bytes:html},
    {name:'kadmeion-static-preview.json',bytes:manifest},
    {name:'README.txt',bytes:readme}
  ];
  const zip=writeStoredZip(parts,limits);
  // Validate the returned archive, not just the data passed to the writer.
  // Check exact entries, strict ZIP structure/CRC and the rendered byte hash.
  const stored=readStrictStoredZip(zip,limits);
  if(stored.size!==parts.length||parts.some(({name,bytes})=>{
    const entry=stored.get(name);
    return !entry||entry.byteLength!==bytes.byteLength||entry.some((byte,i)=>byte!==bytes[i]);
  })||await sha256(stored.get('index.html')!)!==htmlSha256)
    throw new ContractError('VALIDATION','Static preview archive integrity check failed.');
  const archiveSha256=await sha256(zip);
  return {zip,htmlSha256,archiveSha256,previewOnly:true,publicUrl:null};
}
