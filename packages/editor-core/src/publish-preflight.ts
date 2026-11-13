import { normalizeExternalHttpsUrl } from '../../contracts/src/project.ts';
import { validateSnapshot, type PortfolioSnapshot } from './portfolio-revision-transactions.ts';

/** Trusted, TEXT-ONLY private preview; not a release renderer or public access proof. */
export type SafeSlotKind = 'heading'|'paragraph'|'external-link';
export interface SafeSlotPlan {
  slotKey:string; componentId:string; kind:SafeSlotKind; required:boolean;
}
export interface FrozenPreviewEvidence {
  portfolioId:string; revision:number; snapshotSha256:string;
  status:'FROZEN'; publicUrl:null; visibilityIntent:'PUBLIC'|'UNLISTED';
}
export interface SafePreviewInput {
  snapshot:PortfolioSnapshot;
  frozen:FrozenPreviewEvidence;
  loadedPortfolioId:string; loadedRevision:number; loadedSnapshotSha256:string;
  /** The call site must derive this plan from trusted, pinned application code. */
  plan:readonly SafeSlotPlan[];
}
export interface PreflightDiagnostic {code:string;target:string;message:string}
export interface SafePreviewResult {
  status:'BLOCKED'|'PREVIEW_ONLY';
  blockers:readonly PreflightDiagnostic[];
  warnings:readonly PreflightDiagnostic[];
  passed:readonly PreflightDiagnostic[];
  previewHtml:string|null;
  publicationReady:false;
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const SLOT=/^[a-z0-9_-]{1,64}$/;
const PIN=/^[a-z][a-z0-9-]*@[0-9]+(?:\.[0-9]+){0,2}$/;
const encoder=new TextEncoder();
const escapeHtml=(s:string):string=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function stringField(x:unknown,max:number):string|null {
  if(typeof x!=='string'||!x.trim()||x.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x))
    return null;
  return x.trim();
}
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const diag=(code:string,target:string,message:string):PreflightDiagnostic=>({code,target,message});

/**
 * B4 preflight is deliberately fail-closed: the host/resolver/revocation proof
 * is not available, so publicationReady is always false, including for
 * renderable content. Output bytes have no scripts, media or source files.
 */
export function prepareSafeStaticPreview(input:SafePreviewInput):SafePreviewResult {
  const blockers:PreflightDiagnostic[]=[],warnings:PreflightDiagnostic[]=[],passed:PreflightDiagnostic[]=[];
  const block=(code:string,target:string,message:string)=>blockers.push(diag(code,target,message));
  const warn=(code:string,target:string,message:string)=>warnings.push(diag(code,target,message));
  const pass=(code:string,target:string,message:string)=>passed.push(diag(code,target,message));
  const f=input?.frozen;
  if(!f||!UUID.test(f.portfolioId)||f.portfolioId!==input.loadedPortfolioId||
     !Number.isSafeInteger(f.revision)||f.revision<1||f.revision!==input.loadedRevision||
     !SHA.test(f.snapshotSha256)||f.snapshotSha256!==input.loadedSnapshotSha256||
     f.status!=='FROZEN'||f.publicUrl!==null||
     (f.visibilityIntent!=='PUBLIC'&&f.visibilityIntent!=='UNLISTED'))
    block('FROZEN_REVISION_MISMATCH','revision','Private frozen request does not match the stored revision and digest.');
  else pass('REVISION_PIN_MATCHED','revision','Pinned revision and digest agree.');
  let valid=true;
  try { validateSnapshot(input.snapshot); }
  catch {valid=false;block('INVALID_SNAPSHOT','snapshot','Invalid versioned editor file set.');}
  if(!Array.isArray(input.plan)||input.plan.length===0||input.plan.length>32)
    block('INVALID_RENDER_PLAN','plan','A bounded, trusted render plan is required.');
  const seen=new Set<string>(),body:string[]=[];
  let headings=0;
  if(valid&&Array.isArray(input.plan)&&input.plan.length>0&&input.plan.length<=32){
    for(const spec of input.plan){
      if(!record(spec)||typeof spec.slotKey!=='string'||!SLOT.test(spec.slotKey)||
         typeof spec.componentId!=='string'||!PIN.test(spec.componentId)||
         !['heading','paragraph','external-link'].includes(String(spec.kind))||
         typeof spec.required!=='boolean'||seen.has(spec.slotKey)){
        block('INVALID_RENDER_PLAN','plan','Invalid or duplicate slot mapping.');continue;
      }
      seen.add(spec.slotKey);
      const slot=Object.hasOwn(input.snapshot.slots,spec.slotKey)
        ?input.snapshot.slots[spec.slotKey]:undefined;
      if(!slot||slot.state==='EMPTY'){
        if(spec.required) block('REQUIRED_SLOT_EMPTY',spec.slotKey,'A required slot is empty.');
        else warn('OPTIONAL_SLOT_EMPTY',spec.slotKey,'An optional slot was omitted.');
        continue;
      }
      if(slot.state!=='S0'){
        block('CUSTOM_SOURCE_UNTRUSTED',spec.slotKey,'Owned source cannot be published without isolation proof.');continue;
      }
      if(slot.componentId!==spec.componentId){
        block('COMPONENT_PIN_MISMATCH',spec.slotKey,'Pinned component does not match trusted render plan.');continue;
      }
      const c=slot.content;
      if(spec.kind==='heading'){
        if(Object.keys(c).some(k=>!['title','subtitle'].includes(k))){
          block('UNKNOWN_PUBLIC_FIELD',spec.slotKey,'Unexpected fields are not released.');continue;
        }
        const title=stringField(c.title,160);
        if(!title||(c.subtitle!==undefined&&!stringField(c.subtitle,500))){
          block('INVALID_HEADING',spec.slotKey,'Heading or subtitle is missing/invalid.');continue;
        }
        const tag=headings++===0?'h1':'h2';
        body.push('<section><'+tag+'>'+escapeHtml(title)+'</'+tag+'>'+
          (c.subtitle?'<p>'+escapeHtml(c.subtitle.trim())+'</p>':'')+'</section>');
      }else if(spec.kind==='paragraph'){
        const p=stringField(c.text,12000);
        if(Object.keys(c).some(k=>k!=='text')||!p){
          block('INVALID_PARAGRAPH',spec.slotKey,'Only plain-text paragraph content is supported.');continue;
        }
        body.push('<section><p>'+escapeHtml(p)+'</p></section>');
      }else{
        const label=stringField(c.label,160);
        if(Object.keys(c).some(k=>!['label','url'].includes(k))||!label){
          block('INVALID_LINK',spec.slotKey,'Link label or fields are invalid.');continue;
        }
        let url:string;
        try {url=normalizeExternalHttpsUrl(c.url);}
        catch {block('UNSAFE_LINK',spec.slotKey,'Only validated external HTTPS URLs are supported.');continue;}
        body.push('<nav aria-label="External link"><a rel="nofollow noopener noreferrer" href="'+
          escapeHtml(url)+'">'+escapeHtml(label)+'</a></nav>');
      }
      pass('DATA_ONLY_SLOT',spec.slotKey,'Projected only explicitly selected text.');
    }
    for(const [key,slot] of Object.entries(input.snapshot.slots)){
      if(slot.state!=='EMPTY'&&!seen.has(key))
        block('UNMAPPED_ACTIVE_SLOT',key,'An active slot has no approved text projection.');
    }
  }
  if(headings===0)block('MISSING_PRIMARY_HEADING','content','At least one validated heading is required.');
  if(valid&&Object.keys(input.snapshot.files).some(p=>p.startsWith('slots/')))
    warn('OWNED_SOURCE_OMITTED','source','Historical user code is excluded from static preview.');

  let seoTitle:string|null=null,seoDescription:string|null=null;
  if(valid){
    try{
      const data:unknown=JSON.parse(input.snapshot.files['kadmeion.json']??'null');
      const seo=record(data)?data.seo:null;
      seoTitle=record(seo)?stringField(seo.title,120):null;
      seoDescription=record(seo)?stringField(seo.description,300):null;
    }catch{ /* Block below rather than inventing SEO text. */ }
  }
  if(!seoTitle||!seoDescription)
    block('SEO_METADATA_REQUIRED','kadmeion.json','Source manifest requires seo.title and seo.description.');
  else pass('SEO_FROM_SOURCE','kadmeion.json','SEO metadata is derived from the pinned file set.');

  // This cannot be overridden by any caller-provided feature flag.
  block('PUBLIC_DELIVERY_UNVERIFIED','hosting','No verified public host, cache or revocation adapter exists.');
  if(blockers.some(x=>x.code!=='PUBLIC_DELIVERY_UNVERIFIED')||!seoTitle||!seoDescription)
    return {status:'BLOCKED',blockers,warnings,passed,previewHtml:null,publicationReady:false};

  const csp="default-src 'none'; script-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'";
  const html='<!doctype html><html lang="en"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta name="robots" content="noindex,nofollow,noarchive">'+
    '<meta http-equiv="Content-Security-Policy" content="'+escapeHtml(csp)+'">'+
    '<title>'+escapeHtml(seoTitle)+'</title><meta name="description" content="'+escapeHtml(seoDescription)+'">'+
    '<style>html{font-family:system-ui,sans-serif;line-height:1.55;color:#222;background:#fff}body{max-width:70ch;margin:2rem auto;padding:0 1rem}section{margin:2rem 0}p{white-space:pre-line}a:focus-visible{outline:3px solid currentColor}</style>'+
    '</head><body><main id="content">'+body.join('')+'</main></body></html>';
  if(encoder.encode(html).byteLength>750000){
    block('PREVIEW_SIZE_EXCEEDED','preview','Static preview is oversized.');
    return {status:'BLOCKED',blockers,warnings,passed,previewHtml:null,publicationReady:false};
  }
  pass('SCRIPTLESS_PREVIEW','preview','Only escaped text and fixed markup are emitted.');
  return {status:'PREVIEW_ONLY',blockers,warnings,passed,previewHtml:html,publicationReady:false};
}
