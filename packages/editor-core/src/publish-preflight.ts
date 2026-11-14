import { normalizeExternalHttpsUrl } from '../../contracts/src/project.ts';
import { validateSnapshot, type PortfolioSnapshot } from './portfolio-revision-transactions.ts';

/** Trusted, TEXT-ONLY private preview; not a release renderer or public access proof. */
export type SafeSlotKind = 'heading'|'paragraph'|'external-link'|'badge'|'metric'|'list'|'project-card';
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
  /** Strict grouping of the same pinned slots, never arbitrary HTML or scripts. */
  renderSections?:readonly {id:string;layout:string;slotKeys:readonly string[]}[];
  /** Independent portfolio theme, not Kadmeion application chrome. */
  portfolioTheme?:{mode:'light'|'dark';surface:string;text:string;accent:string};
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
  const rendered=new Map<string,string>();
  let headings=0;
  if(valid&&Array.isArray(input.plan)&&input.plan.length>0&&input.plan.length<=32){
    for(const spec of input.plan){
      if(!record(spec)||typeof spec.slotKey!=='string'||!SLOT.test(spec.slotKey)||
         typeof spec.componentId!=='string'||!PIN.test(spec.componentId)||
         !['heading','paragraph','external-link','badge','metric','list','project-card'].includes(String(spec.kind))||
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
      const emit=(html:string):void=>{body.push(html);rendered.set(spec.slotKey,html);};
      if(spec.kind==='heading'){
        if(Object.keys(c).some(k=>!['title','subtitle'].includes(k))){
          block('UNKNOWN_PUBLIC_FIELD',spec.slotKey,'Unexpected fields are not released.');continue;
        }
        const title=stringField(c.title,160);
        if(!title||(c.subtitle!==undefined&&!stringField(c.subtitle,500))){
          block('INVALID_HEADING',spec.slotKey,'Heading or subtitle is missing/invalid.');continue;
        }
        const tag=headings++===0?'h1':'h2';
        emit('<section><'+tag+'>'+escapeHtml(title)+'</'+tag+'>'+
          (c.subtitle?'<p>'+escapeHtml(c.subtitle.trim())+'</p>':'')+'</section>');
      }else if(spec.kind==='paragraph'){
        const p=stringField(c.text,12000);
        if(Object.keys(c).some(k=>k!=='text')||!p){
          block('INVALID_PARAGRAPH',spec.slotKey,'Only plain-text paragraph content is supported.');continue;
        }
        emit('<section><p>'+escapeHtml(p)+'</p></section>');
      }else if(spec.kind==='badge'){
        const text=stringField(c.text,80);
        if(Object.keys(c).some(k=>k!=='text')||!text){
          block('INVALID_BADGE',spec.slotKey,'Badge requires a short text label.');continue;
        }
        emit('<span class="k-badge">'+escapeHtml(text)+'</span>');
      }else if(spec.kind==='metric'){
        const label=stringField(c.label,120),value=stringField(c.value,80);
        if(Object.keys(c).some(k=>!['label','value'].includes(k))||!label||!value){
          block('INVALID_METRIC',spec.slotKey,'Metric needs an author-provided label and value.');continue;
        }
        // A metric is author-supplied content. Do not add a verified badge,
        // recalculate it or infer an external provider endorsement.
        emit('<dl data-provenance="author"><div><dt>'+escapeHtml(label)+
          '</dt><dd>'+escapeHtml(value)+'</dd></div></dl>');
      }else if(spec.kind==='list'){
        if(Object.keys(c).some(k=>k!=='items')||typeof c.items!=='string'){
          block('INVALID_LIST',spec.slotKey,'List must provide an array of plain-text items.');continue;
        }
        let values:unknown;
        try{values=JSON.parse(c.items);}catch{values=null;}
        if(!Array.isArray(values)||values.length<1||values.length>24||
           values.some(v=>stringField(v,200)===null)){
          block('INVALID_LIST',spec.slotKey,'Only 1–24 bounded plain-text list items are supported.');continue;
        }
        emit('<ul>'+values.map(v=>'<li>'+escapeHtml((v as string).trim())+'</li>').join('')+'</ul>');
      }else if(spec.kind==='project-card'){
        const title=stringField(c.title,160),summary=stringField(c.summary,1000);
        if(Object.keys(c).some(k=>!['title','summary','url'].includes(k))||
           !title||!summary){
          block('INVALID_PROJECT_CARD',spec.slotKey,'Project card requires a title and summary.');continue;
        }
        let link='';
        if(c.url!==undefined){
          let url:string;
          try{url=normalizeExternalHttpsUrl(c.url);}
          catch{block('UNSAFE_LINK',spec.slotKey,'Project URL must use validated HTTPS.');continue;}
          link='<a rel="nofollow noopener noreferrer" href="'+escapeHtml(url)+'">View project</a>';
        }
        emit('<article class="k-project-card"><h2>'+escapeHtml(title)+
          '</h2><p>'+escapeHtml(summary)+'</p>'+link+'</article>');
      }else{
        const label=stringField(c.label,160);
        if(Object.keys(c).some(k=>!['label','url'].includes(k))||!label){
          block('INVALID_LINK',spec.slotKey,'Link label or fields are invalid.');continue;
        }
        let url:string;
        try {url=normalizeExternalHttpsUrl(c.url);}
        catch {block('UNSAFE_LINK',spec.slotKey,'Only validated external HTTPS URLs are supported.');continue;}
        emit('<nav aria-label="External link"><a rel="nofollow noopener noreferrer" href="'+
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

  let renderedContent=body.join('');
  if(input.renderSections!==undefined){
    const sections=input.renderSections;
    const keys=Array.isArray(sections)?
      sections.flatMap(section=>Array.isArray(section?.slotKeys)?section.slotKeys:[]):[];
    const planKeys=Array.isArray(input.plan)?input.plan.map(slot=>slot.slotKey):[];
    const sectionIds=new Set<string>();
    if(!Array.isArray(sections)||sections.length<1||sections.length>16||
       sections.some(section=>!record(section)||
         typeof section.id!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(section.id)||
         typeof section.layout!=='string'||!/^L[1-8]$/.test(section.layout)||
         sectionIds.has(section.id)||!Array.isArray(section.slotKeys)||
         section.slotKeys.length<1||section.slotKeys.length>12)||
       keys.length!==planKeys.length||keys.some((key,i)=>key!==planKeys[i])){
      block('INVALID_TEMPLATE_GROUPING','pages/home.page.json',
        'Layout groups must exactly match the trusted pinned slot order.');
    }else{
      renderedContent=sections.map(section=>{
        sectionIds.add(section.id);
        return '<section class="k-layout k-'+section.layout.toLowerCase()+
          '" data-layout="'+section.layout+'" data-section="'+section.id+'">'+
          section.slotKeys.map(key=>rendered.get(key)??'').join('')+'</section>';
      }).join('');
    }
  }
  const theme=input.portfolioTheme;
  if(theme!==undefined&&(!record(theme)||!['light','dark'].includes(String(theme.mode))||
     !['surface','text','accent'].every(k=>typeof theme[k]==='string'&&
       /^#[0-9a-fA-F]{6}$/.test(theme[k]))))
    block('INVALID_PORTFOLIO_THEME','theme/tokens.json','Unsafe portfolio color tokens.');

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
    '<style>html{font-family:system-ui,sans-serif;line-height:1.55;color:'+
    (theme?.text??'#222222')+';background:'+(theme?.surface??'#ffffff')+
    ';color-scheme:'+(theme?.mode??'light')+'}body{max-width:'+
    (input.renderSections?'80rem':'70ch')+';margin:2rem auto;padding:0 1rem}section{margin:2rem 0}p{white-space:pre-line}a:focus-visible{outline:3px solid currentColor}.k-badge{display:inline-block;border:1px solid currentColor;border-radius:.3rem;padding:.15rem .55rem}.k-project-card{border:1px solid currentColor;border-radius:.65rem;padding:1rem}dt{font-size:.85rem}dd{margin:0;font-size:1.5rem;font-weight:650}'+
    (input.renderSections?'main{display:grid;gap:clamp(1rem,3vw,2.5rem)}.k-layout{min-width:0;padding:clamp(1rem,3vw,2rem);border-block-start:2px solid '+(theme?.accent??'#737373')+'}.k-l1,.k-l5{min-height:20rem;display:grid;align-content:center}.k-l2,.k-l4{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.k-l2>section:first-child,.k-l4>section:first-child{grid-column:1/-1}.k-l3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}.k-l3>section:first-child{grid-column:1/-1}.k-l8{border-block-end:2px solid currentColor}@media(max-width:48rem){.k-l2,.k-l3,.k-l4{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}':'')+
    '</style>'+
    '</head><body><main id="content">'+renderedContent+'</main></body></html>';
  if(encoder.encode(html).byteLength>750000){
    block('PREVIEW_SIZE_EXCEEDED','preview','Static preview is oversized.');
    return {status:'BLOCKED',blockers,warnings,passed,previewHtml:null,publicationReady:false};
  }
  pass('SCRIPTLESS_PREVIEW','preview','Only escaped text and fixed markup are emitted.');
  return {status:'PREVIEW_ONLY',blockers,warnings,passed,previewHtml:html,publicationReady:false};
}
