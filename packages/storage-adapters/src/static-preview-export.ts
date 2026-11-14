import { ContractError } from '../../contracts/src/project.ts';
import { prepareSafeStaticPreview, type SafePreviewInput } from '../../editor-core/src/publish-preflight.ts';
import { writeStoredZip } from './portable-source-archive.ts';

const encoder=new TextEncoder();
export interface StaticPreviewArchive {
  zip:Uint8Array;
  htmlSha256:string;
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
    result.blockers.length!==1||result.blockers[0].code!=='PUBLIC_DELIVERY_UNVERIFIED')
    throw new ContractError('VALIDATION','Private static preview preflight is not valid.');
  const html=encoder.encode(result.previewHtml);
  const digest=await crypto.subtle.digest('SHA-256',html);
  const htmlSha256=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  // Export deliberately omits owner ID, raw snapshot SHA, access tokens and project paths.
  const manifest=encoder.encode(JSON.stringify({
    kind:'kadmeion-static-preview',formatVersion:1,previewOnly:true,
    publicUrl:null,sourceRevision:input.loadedRevision,
    files:[{path:'index.html',bytes:html.length,sha256:htmlSha256}],
    limitations:['No approved template layout, custom JS or personal asset files',
      'No publish, staging URL, verified hosting or content revocation',
      'Noindex by default; manual static HTTP serving only']
  }));
  const readme=encoder.encode('KADMEION: STATIC PREVIEW ONLY\n\n'+
    'Extract the ZIP and serve index.html from a local static HTTP server.\n'+
    'This is a safe, scriptless text projection, not an approved complete template.\n'+
    'The JSON manifest records index.html SHA-256; no public URL exists.\n');
  const zip=writeStoredZip([
    {name:'index.html',bytes:html},
    {name:'kadmeion-static-preview.json',bytes:manifest},
    {name:'README.txt',bytes:readme}
  ],{maxEntries:3,maxBytes:1024*1024,maxEntryBytes:750000});
  return {zip,htmlSha256,previewOnly:true,publicUrl:null};
}
