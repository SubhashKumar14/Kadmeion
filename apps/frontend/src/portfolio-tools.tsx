import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, KeyboardEvent, Dispatch, SetStateAction } from 'react';
import {unappliedSourceBufferCount} from './behavior.ts';
import {portfolioLayout, MAX_FILE_BYTES} from '../../../packages/editor-core/src/managed-project-files.ts';
import type { OwnerPrivateAssetRead, SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
import type { MyComponentVersion } from '../../../packages/contracts/src/private-my-components-service.ts';
import { normalizeExternalHttpsUrl } from '../../../packages/contracts/src/project.ts';
import { canAssignCompatibleComponent, canPlacePrivateImage, matchingReplacementContent, savedComponentInputFromOwnedSlot, parseScopedTheme, resolveScopedTheme, resolveScopedThemeBase, scopedThemeBreakpoint, scopedThemeCssVariables, type ScopedThemeScope, type ScopedThemeLayer, type ScopedThemeKey, type ScopedThemeEdit, type ScopedThemeTokens, type EditorHead, type EditorIntent, type PortfolioSnapshot } from
  '../../../packages/editor-core/src/portfolio-revision-transactions.ts';

type Apply = (intent: EditorIntent, versions?: Readonly<Record<string, MyComponentVersion>>) => boolean;
const THEME_PATH = 'theme/tokens.json';
const colors = ['surface', 'text', 'accent'] as const;
type PortfolioTheme = {mode: 'light' | 'dark'; surface: string; text: string; accent: string};
type ThemePalette=Pick<PortfolioTheme,typeof colors[number]>;
function paletteOf(theme:PortfolioTheme):ThemePalette{
  return {surface:theme.surface,text:theme.text,accent:theme.accent};
}
function objectRecord(value:unknown):Record<string,unknown>|undefined{
  return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
}
function validPalette(value:unknown):value is ThemePalette{
  const candidate=objectRecord(value);
  return !!candidate&&colors.every(key=>typeof candidate[key]==='string'&&/^#[0-9a-f]{6}$/i.test(candidate[key] as string));
}
const defaultTheme: PortfolioTheme = {mode: 'light', surface: '#f9fafb', text: '#152738', accent: '#b9734d'};
const defaultDarkTheme:PortfolioTheme={mode:'dark',surface:'#162433',text:'#f7f5ef',accent:'#eab087'};
function themeContrast(foreground:string,background:string):number {
  const luminance=(hex:string)=>{
    const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
      .map(v=>v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4));
    return 0.2126*rgb[0]!+0.7152*rgb[1]!+0.0722*rgb[2]!;
  };
  const a=luminance(foreground),b=luminance(background);
  return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
}

function readTheme(snapshot: PortfolioSnapshot | null | undefined): PortfolioTheme {
  try {
    const source = snapshot?.files[THEME_PATH];
    if (!source) return defaultTheme;
    const value = JSON.parse(source) as Partial<PortfolioTheme>;
    return (value.mode === 'light' || value.mode === 'dark') && colors.every(key => /^#[0-9a-f]{6}$/i.test(value[key] ?? ''))
      ? {mode:value.mode,surface:value.surface!,text:value.text!,accent:value.accent!} : defaultTheme;
  } catch { return defaultTheme; }
}


type CanvasSection={id:string;layout:string;renderId:string;slots:string[]};
const TEXT_FIELDS=['title','text','label','description','value','items','note'] as const;
const CANVAS_PRESETS=['arc','collage','editorial','stairs','studio','blank'] as const;
function canvasPreset(snapshot:PortfolioSnapshot|null|undefined):string|null{
  try{
    const preset=objectRecord(JSON.parse(snapshot?.files['kadmeion.json']??'null'))?.preset;
    return typeof preset==='string'&&CANVAS_PRESETS.some(id=>id===preset)?preset:null;
  }catch{return null;}
}
/** Layout illustration only, not a saved author value and never emitted by fullscreen
 * preview or any delivery adapter. Actual user content always takes precedence. */
function layoutExample(renderId:string,name:string):string|null {
  if(renderId==='L1'&&name==='title')return 'Build things that make a difference.';
  if(renderId==='L1'&&name==='text')return 'Selected work, practical skills and project stories.';
  if(renderId==='L1'&&name==='cta1')return 'Explore projects';
  if(renderId==='L3'&&name==='title')return 'Selected projects';
  return null;
}
const SLOT_TITLES:Readonly<Record<string,string>>={
  title:'headline',text:'introduction',cta:'call to action',cta1:'primary action',
  cta2:'secondary action',btn1:'primary action',btn2:'secondary action',
  image:'image',imagea:'image A',imageb:'image B',avatar:'portrait',
  media:'media',thumbs:'thumbnails',project:'project',card:'project',
  entries:'experience',items:'skills',links:'links',text1:'first paragraph',
  text2:'second paragraph',badge:'category',meta:'detail',note:'note'
};
function canvasSections(snapshot:PortfolioSnapshot|null|undefined):CanvasSection[] {
  const source=snapshot?.files['pages/home.page.json'];
  if(typeof source!=='string')return [];
  try {
    const page:unknown=JSON.parse(source);
    if(!page||typeof page!=='object'||Array.isArray(page)||
      !('sections' in page)||!Array.isArray(page.sections))return [];
    const sections:CanvasSection[]=[];
    for(const item of page.sections.slice(0,32)){
      if(!item||typeof item!=='object'||Array.isArray(item)||
        !('id' in item)||typeof item.id!=='string'||
        !('layout' in item)||typeof item.layout!=='string')continue;
      const layout=portfolioLayout(item.layout);
      if(!layout)continue;
      sections.push({id:item.id,layout:item.layout,renderId:layout.renderId,slots:layout.slots});
    }
    return sections;
  }catch{return [];}
}
/** Project trusted component fields, not arbitrary source. React escapes every
 * authored string. Partial values remain private draft content, not preflight proof. */
function canvasText(value:unknown,max:number):string{
  return typeof value==='string'&&value.trim()&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)?value.trim():'';
}
function canvasLink(value:unknown):string|null{
  if(typeof value!=='string'||!value.trim())return null;
  try{return normalizeExternalHttpsUrl(value);}catch{return null;}
}
function slotProjection(slot:PortfolioSnapshot['slots'][string]|undefined):{parts:string[];href:string|null}{
  const empty={parts:[],href:null};
  if(!slot||slot.state==='EMPTY')return empty;
  const c=slot.content;
  const output=(parts:string[],href:string|null=null)=>({parts:parts.filter(Boolean),href});
  if(slot.state!=='S0'){
    for(const key of TEXT_FIELDS){
      const text=canvasText(c[key],12000);
      if(text)return output([text]);
    }
    return empty;
  }
  switch(slot.componentId){
    case 'title-stacked@1':return output([canvasText(c.title,160),canvasText(c.subtitle,500)]);
    case 'body-copy@1':return output([canvasText(c.text,12000)]);
    case 'external-link@1':return output([canvasText(c.label,160)],canvasLink(c.url));
    case 'project-card@1':return output([canvasText(c.title,160),canvasText(c.summary,1000)],canvasLink(c.url));
    case 'technology-tag@1':return output([canvasText(c.text,80)]);
    case 'author-metric@1':return output([canvasText(c.label,120),canvasText(c.value,80)]);
    case 'skills-list@1':case 'experience-list@1':{
      try{
        const items:unknown=JSON.parse(c.items??'null');
        if(!Array.isArray(items)||items.length>24||items.some(item=>!canvasText(item,200)))return empty;
        return output(items.map(item=>canvasText(item,200)));
      }catch{return empty;}
    }
    default:return empty;
  }
}

/** Parent supplies guards over its actual internal drag refs and working head.
 * The canvas never interprets DataTransfer or turns external strings into commands. */
export type PrivateCanvasDropTargets=Readonly<{
  canDropComponent:(key:string)=>boolean;dropComponent:(key:string)=>boolean;
  canDropSection:(beforeSectionId:string|null)=>boolean;dropSection:(beforeSectionId:string|null)=>boolean;
}>;
const DROP_OUTLINE:CSSProperties={outline:'2px dashed currentColor',outlineOffset:'2px'};
function useDropOutline(){
  const [highlighted,setHighlighted]=useState<string|null>(null);
  useEffect(()=>{
    if(highlighted===null)return;
    const clear=()=>setHighlighted(null);
    window.addEventListener('dragend',clear);window.addEventListener('drop',clear);
    return()=>{window.removeEventListener('dragend',clear);window.removeEventListener('drop',clear);};
  },[highlighted]);
  return {highlighted,setHighlighted};
}
const PortfolioSlot=({section,name,kind='copy',snapshot,editing,selectedSlot,onSelectSlot,showMissing,themeNode,privateImages,dropTargets}:{
    themeNode?:(section:CanvasSection,name:string)=>string|undefined;
    privateImages?:CanvasImageViews;dropTargets?:PrivateCanvasDropTargets;
    section:CanvasSection;name:string;kind?:'title'|'copy'|'action'|'media'|'tag';snapshot:PortfolioSnapshot|null|undefined;editing:boolean;selectedSlot?:string;onSelectSlot?:(key:string)=>void;showMissing:boolean;
  })=>{
    const key=section.id+'-'+name.toLowerCase();
    const {highlighted,setHighlighted}=useDropOutline();
    const assignment=snapshot?.slots[key];
    const projection=slotProjection(assignment);
    const text=projection.parts[0]??'';
    const renderedText=projection.parts.length>1?<>{projection.parts.map((part,index)=><span key={index} className="pv-slot-part" style={{display:'block'}}>{part}</span>)}</>:text;
    const imageReference=assignment?.state==='S0'&&assignment.componentId==='image@1'&&!!assignment.content.asset_id;
    const imageLabel=imageReference?'Private image reference — '+(assignment.content.alt_text||'Alt text missing'):'';
    const candidateImage=imageReference?privateImages?.get(key):undefined;
    const localImage=candidateImage?.status==='ready'?candidateImage:undefined;
    const imageAlt=assignment?.content.decorative==='true'?'':assignment?.content.alt_text??'';
    const label=SLOT_TITLES[name.toLowerCase()]??name;
    const example=editing&&!text&&(!assignment||assignment.state==='EMPTY'||Object.keys(assignment.content).length===0)?layoutExample(section.renderId,name):null;
    const visibleLabel=imageLabel||text|| (kind==='media' ? '' : example??('Add '+label));
    const node=(!assignment||assignment.state==='EMPTY'||assignment.state==='S0')?themeNode?.(section,name):undefined;
    const className='pv-slot pv-slot-'+kind+(text||localImage?' pv-filled':' pv-unfilled')+
      (selectedSlot===key?' pv-selected':'');
    if(editing)return <button className={className} data-k-theme-node={node} type="button"
      data-drop-fit={highlighted===key?'compatible':undefined} style={highlighted===key?DROP_OUTLINE:undefined}
      onDragOver={event=>{
        if(assignment?.state==='EMPTY'&&dropTargets?.canDropComponent(key)){
          event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';setHighlighted(key);
        }else setHighlighted(null);
      }}
      onDragLeave={()=>setHighlighted(null)}
      onDrop={event=>{
        setHighlighted(null);
        if(assignment?.state!=='EMPTY'||!dropTargets?.canDropComponent(key))return;
        event.preventDefault();event.stopPropagation();dropTargets.dropComponent(key);
      }}
      aria-label={'Edit '+section.renderId+' '+name+' slot in preview'+(visibleLabel?' — '+visibleLabel:'')}
      aria-pressed={selectedSlot===key} onClick={()=>onSelectSlot?.(key)}>
      {localImage?<img src={localImage.url} alt={imageAlt} width={localImage.dimensions.width} height={localImage.dimensions.height} decoding="async" onError={localImage.onError} style={{maxWidth:'100%',height:'auto',objectFit:'contain'}}/>:
      imageReference?<span>{imageLabel}<small> · Media bytes not verified in this canvas</small></span>:renderedText||(
        kind==='media'?<span className="pv-placeholder pv-media-blank" aria-hidden="true"/>:
        example?<span className="pv-placeholder pv-layout-example">{example}</span>:
        <span className="pv-placeholder">Add {label}</span>
      )}
    </button>;
    // Reference labels are author-only, never fabricated visitor imagery.
    if(imageReference)return localImage?<span className={className} data-k-theme-node={node}>
      <img src={localImage.url} alt={imageAlt} width={localImage.dimensions.width} height={localImage.dimensions.height} decoding="async" onError={localImage.onError} style={{maxWidth:'100%',height:'auto',objectFit:'contain'}}/>
    </span>:showMissing?<span className={className} data-k-theme-node={node}>{imageLabel} · Preview bytes unavailable</span>:null;
    // Nonediting previews can follow only explicitly authored, validated HTTPS links.
    // Never place a nested interactive link inside an editing slot button.
    if(text&&assignment?.state==='S0'&&assignment.componentId==='external-link@1'&&projection.href)
      return <a className={className} data-k-theme-node={node} href={projection.href} target="_blank" rel="nofollow noopener noreferrer">{renderedText}</a>;
    return text?<span className={className} data-k-theme-node={node}>{renderedText}
      {assignment?.state==='S0'&&assignment.componentId==='project-card@1'&&projection.href&&
        <a href={projection.href} target="_blank" rel="nofollow noopener noreferrer">View project</a>}</span>:
      !showMissing?null:<span className={className} data-k-theme-node={node} aria-hidden="true">Not added: {label}</span>;
  };

/** Partition manifest-declared slots once; do not project historical stashes
 * or let a special-case hero silently omit a declared assignment. */
function canvasSlotGroups(section:CanvasSection){
  const hero=['L1','L2','L5'].includes(section.renderId);
  const headline=section.slots.includes('title');
  const textSlot=section.slots.includes('text')?'text':section.slots.includes('text1')?'text1':undefined;
  const buttons=section.slots.filter(name=>['cta','cta1','cta2','btn1','btn2'].includes(name));
  const media=hero?section.slots.filter(name=>/^(avatar|image|imageA|imageB|media|thumbs)$/i.test(name)):[];
  const note=hero&&section.slots.includes('note');
  const reserved=new Set(['title',...(textSlot?[textSlot]:[]),...buttons,...media,...(note?['note']:[])]);
  const others=section.slots.filter(name=>!reserved.has(name));
  return {hero,headline,textSlot,buttons,media,note,others};
}


/** Only engine-validated tokens and generated ordinals enter the stylesheet. */
const SCOPED_WIDTHS=[390,768,1440] as const;
function scopedCanvasRules(snapshot:PortfolioSnapshot,sections:CanvasSection[],mode:PortfolioTheme['mode'],instance:string):string|null{
  const targets:{node:string;sectionId?:string;slotKey?:string}[]=[{node:'root'}];
  sections.forEach((section,index)=>{
    targets.push({node:'s'+index,sectionId:section.id});
    section.slots.forEach((name,ordinal)=>targets.push({node:'s'+index+'c'+ordinal,sectionId:section.id,slotKey:section.id+'-'+name.toLowerCase()}));
  });
  const prefix='[data-k-theme-instance="'+instance+'"] ';
  const query=['width <= 600px','600px < width <= 950px','width > 950px'];
  const propertyMap:Readonly<Record<string,string>>={
    '--k-theme-surface':'background-color','--k-theme-text':'color',
    '--k-theme-font-size':'font-size','--k-theme-line-height':'line-height',
    '--k-theme-font-weight':'font-weight','--k-theme-spacing':'padding','--k-theme-radius':'border-radius'
  };
  const rules=(widthPx:number,baseOnly=false):string|null=>{
    const declarations:string[]=[];
    for(const {node,sectionId,slotKey} of targets){
      const resolved=(baseOnly?resolveScopedThemeBase:resolveScopedTheme)(snapshot,{mode,sectionId,slotKey,widthPx});
      if(resolved.status!=='resolved')return null;
      const values=scopedThemeCssVariables(resolved.tokens);
      const properties=Object.keys(values).flatMap(key=>{
        const property=propertyMap[key];
        return property?[property+':var('+key+')']:[];
      });
      const selector=prefix+'[data-k-theme-node="'+node+'"]';
      const vars=Object.entries(values).map(([key,value])=>key+':'+value);
      declarations.push(selector+'{'+vars.concat(properties,'--portfolio-surface:var(--k-theme-surface)').join(';')+'}');
      if(node==='root'||!slotKey)declarations.push(selector+'{border-color:var(--k-theme-accent)}');
      if(slotKey){
        declarations.push(selector+'.pv-slot-action{color:var(--k-theme-accent);border-color:var(--k-theme-accent)}',selector+' a{color:var(--k-theme-accent)}');
        const typography=['--k-theme-font-size','--k-theme-line-height','--k-theme-font-weight']
          .filter(key=>Object.hasOwn(values,key)).map(key=>propertyMap[key]+':var('+key+')');
        if(typography.length)declarations.push(selector+' :is(span,strong,small,a){'+typography.join(';')+'}');
      }
    }
    return declarations.join('');
  };
  const base=rules(768,true);
  if(base===null)return null;
  const responsive:string[]=[];
  for(const [index,widthPx] of SCOPED_WIDTHS.entries()){
    const css=rules(widthPx);
    if(css===null)return null;
    responsive.push('@container k-portfolio-width ('+query[index]+'){'+css+'}');
  }
  return base+responsive.join('');
}

/** This context must come from the verified editor gate, never visitor simulation.
 * The shell owner key is a lifetime identity, not the adapter's internal epoch. */
export type PrivateCanvasMediaContext=Readonly<{port:SupabaseBrowserAuthPort;ownerKey:string}>;
type CanvasImageRef={slotKey:string;assetId:string;expectedDigest?:string};
type RasterDimensions=Readonly<{width:number;height:number}>;
type CanvasImageView={status:'pending'|'failed'|'deferred'}|{status:'ready';url:string;pinned:boolean;dimensions:RasterDimensions;digest:string;frozenDigestMatched:boolean;onError:()=>void};
type CanvasImageViews=ReadonlyMap<string,CanvasImageView>;
/** Only unique, active manifest slots may request bytes; stashes and
 * unsupported assignments never participate. The signature is order-stable. */
function canvasImageReferences(snapshot:PortfolioSnapshot|null|undefined,sections:CanvasSection[]):CanvasImageRef[]{
  if(!snapshot)return [];
  const all=sections.flatMap(section=>section.slots.map(name=>section.id+'-'+name.toLowerCase()));
  const counts=new Map<string,number>();
  for(const key of all)counts.set(key,(counts.get(key)??0)+1);
  const refs:CanvasImageRef[]=[];
  for(const key of all){
    const assignment=Object.hasOwn(snapshot.slots,key)?snapshot.slots[key]:undefined;
    if(counts.get(key)!==1||assignment?.state!=='S0'||assignment.componentId!=='image@1'||!canPlacePrivateImage(snapshot,key))continue;
    const assetId=assignment.content.asset_id,expectedDigest=assignment.content.source_sha256;
    if(typeof assetId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(assetId))continue;
    if(expectedDigest!==undefined&&(typeof expectedDigest!=='string'||!/^[a-f0-9]{64}$/.test(expectedDigest)))continue;
    refs.push({slotKey:key,assetId:assetId.toLowerCase(),expectedDigest});
  }
  return refs.sort((a,b)=>a.slotKey<b.slotKey?-1:a.slotKey>b.slotKey?1:0);
}
const CANVAS_MEDIA_BUDGET=50*1024*1024;
// Match the owner transport's per-raster limit, and bound total retained
// decoded pixels independently of compressed bytes (roughly 192 MB RGBA).
const CANVAS_PIXEL_BUDGET=48_000_000;
const PRIVATE_IMAGE_DECODE_TIMEOUT=10_000;
async function decodePrivateRaster(url:string):Promise<RasterDimensions>{
  const probe=new Image();
  let deadline:number|undefined;
  try{
    probe.src=url;
    await Promise.race([probe.decode(),new Promise<never>((_,reject)=>{
      deadline=window.setTimeout(()=>reject(new Error('Private image decode timed out.')),PRIVATE_IMAGE_DECODE_TIMEOUT);
    })]);
    const width=probe.naturalWidth,height=probe.naturalHeight;
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||
       width>8192||height>8192||width*height>24_000_000)throw new Error('Private image dimensions exceed verified bounds.');
    return {width,height};
  }finally{
    if(deadline!==undefined)window.clearTimeout(deadline);
    probe.removeAttribute('src');
  }
}

/** Only bounded raster Blob receipts can reach an ephemeral image URL.
 * The owner adapter still performs byte/hash, Storage identity and pin verification. */
function validOwnerPreview(asset:AssetPreviewRecord,data:OwnerPrivateAssetRead|null|undefined,expectedDigest?:string):data is OwnerPrivateAssetRead{
  return !!data&&['image/png','image/jpeg','image/webp'].includes(asset.mime)&&
    Number.isSafeInteger(asset.size)&&asset.size>0&&asset.size<=5*1024*1024&&
    data.bytes instanceof Blob&&data.asset.id===asset.id&&data.asset.projectId===asset.projectId&&
    data.asset.mime===asset.mime&&data.asset.size===asset.size&&data.bytes.size===asset.size&&
    data.bytes.type===asset.mime&&
    data.integrity.status==='OWNER_BYTES_VERIFIED'&&/^[a-f0-9]{64}$/.test(data.integrity.computedSha256)&&
    (expectedDigest===undefined||(/^[a-f0-9]{64}$/.test(expectedDigest)&&data.integrity.computedSha256===expectedDigest))&&
    data.publicDeliveryAllowed===false&&['NOT_VERIFIED','SERVER_HASH_PINNED'].includes(data.serverAttestation);
}
/** Recheck the returned immutable raster bytes before exposing a Blob URL.
 * This is a local integrity check, not an independent server attestation. */
async function matchesPreviewBytes(bytes:Blob,mime:string,digest:string):Promise<boolean>{
  try{
    if(!crypto.subtle||bytes.size<1||bytes.size>5*1024*1024||bytes.type!==mime||!/^[a-f0-9]{64}$/.test(digest))return false;
    const buffer=await bytes.arrayBuffer();
    if(buffer.byteLength!==bytes.size)return false;
    const a=new Uint8Array(buffer);
    const png=a.length>=8&&[137,80,78,71,13,10,26,10].every((value,index)=>a[index]===value);
    const jpeg=a.length>=3&&a[0]===255&&a[1]===216&&a[2]===255;
    const webp=a.length>=12&&[82,73,70,70].every((value,index)=>a[index]===value)&&
      [87,69,66,80].every((value,index)=>a[index+8]===value);
    if(!(mime==='image/png'?png:mime==='image/jpeg'?jpeg:mime==='image/webp'?webp:false))return false;
    const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),value=>value.toString(16).padStart(2,'0')).join('');
    return actual===digest;
  }catch{return false;}
}
/** Verify each distinct referenced asset in a bounded sequential queue.
 * Owner/project/epoch and reference signature changes revoke all old URLs.
 * Repeated slots may share verified bytes, but each frozen digest must match.
 * This is private preview only, never an authority or a snapshot mutation. */
function useCanvasMedia(context:PrivateCanvasMediaContext|undefined,snapshot:PortfolioSnapshot|null|undefined,
  sections:CanvasSection[],selectedSlot:string|undefined,ownerCanvas:boolean){
  const refs=useMemo(()=>ownerCanvas&&context?canvasImageReferences(snapshot,sections):[],[ownerCanvas,!!context,snapshot,sections]);
  const port=context?.port;
  const key=ownerCanvas&&port&&context?.ownerKey&&refs.length?JSON.stringify([context.ownerKey,refs]):null;
  const [enabled,setEnabled]=useState(true);
  const [attempt,setAttempt]=useState(0);
  const [view,setView]=useState<{key:string|null;images:CanvasImageViews}>({key:null,images:new Map()});
  const generation=useRef(0);
  useLayoutEffect(()=>{
    const started=++generation.current;
    const images=new Map<string,CanvasImageView>();
    const urls=new Set<string>();
    let epoch:number|null=null;
    const release=()=>{for(const url of urls)URL.revokeObjectURL(url);urls.clear();};
    const live=()=>generation.current===started&&epoch!==null&&port?.reconcileOwnerSessionEpoch()===epoch;
    const publish=()=>{if(live())setView({key,images:new Map(images)});};
    setView({key,images:new Map()});
    if(!port||!key||!enabled)return;
    epoch=port.reconcileOwnerSessionEpoch();
    for(const ref of refs)images.set(ref.slotKey,{status:'pending'});
    publish();
    const unsubscribe=port.subscribeOwnerSessionEpoch(()=>{
      ++generation.current;epoch=null;release();
      setView({key,images:new Map(refs.map(ref=>[ref.slotKey,{status:'failed'} as const]))});
    });
    // Keep the explicit retry useful even when a very large document exceeds
    // the local preview budget: prioritize the current selection, not API order.
    const ordered=[...refs].sort((a,b)=>Number(b.slotKey===selectedSlot)-Number(a.slotKey===selectedSlot));
    const groups=new Map<string,CanvasImageRef[]>();
    for(const ref of ordered){const group=groups.get(ref.assetId)??[];group.push(ref);groups.set(ref.assetId,group);}
    const setGroup=(group:CanvasImageRef[],status:'failed'|'deferred')=>{
      for(const ref of group)images.set(ref.slotKey,{status});publish();
    };
    async function load(){
      if(!port||epoch===null||!live())return;
      const bound=epoch;
      let used=0,decodedPixels=0;
      try{
        const list=await port.listOwnerAssets();
        if(!live())return;
        if(list.error||!list.data){setGroup(refs,'failed');return;}
        for(const [assetId,group] of groups){
          if(!live())return;
          const candidates=list.data.filter(row=>row.id.toLowerCase()===assetId);
          const asset=candidates.length===1?candidates[0]:undefined;
          if(!asset||!Number.isSafeInteger(asset.size)||asset.size<=0||asset.size>5*1024*1024||
             !['image/png','image/jpeg','image/webp'].includes(asset.mime)){setGroup(group,'failed');continue;}
          if(used+asset.size>CANVAS_MEDIA_BUDGET){setGroup(group,'deferred');continue;}
          let url:string|undefined;
          try{
            const response=await port.readOwnerPrivateAsset(asset.projectId,asset.id,bound);
            if(!live())return;
            if(response.error||!validOwnerPreview(asset,response.data)){setGroup(group,'failed');continue;}
            const digest=response.data.integrity.computedSha256;
            const verified=await matchesPreviewBytes(response.data.bytes,asset.mime,digest);
            if(!live())return;
            if(!verified){setGroup(group,'failed');continue;}
            const matches=group.filter(ref=>ref.expectedDigest===undefined||ref.expectedDigest===digest);
            for(const ref of group)if(!matches.includes(ref))images.set(ref.slotKey,{status:'failed'});
            if(!matches.length){publish();continue;}
            url=URL.createObjectURL(response.data.bytes);urls.add(url);
            const dimensions=await decodePrivateRaster(url);
            if(!live())return;
            const pixels=dimensions.width*dimensions.height;
            if(decodedPixels+pixels>CANVAS_PIXEL_BUDGET){
              if(urls.delete(url))URL.revokeObjectURL(url);
              for(const ref of matches)images.set(ref.slotKey,{status:'deferred'});
              publish();continue;
            }
            // The image URL belongs to this run alone; a late error from an old
            // image can neither revoke a new URL nor publish an old receipt.
            const imageUrl=url;
            const fail=()=>{
              if(!live()||!urls.delete(imageUrl))return;
              URL.revokeObjectURL(imageUrl);
              for(const ref of matches){
                const image=images.get(ref.slotKey);
                if(image?.status==='ready'&&image.url===imageUrl)images.set(ref.slotKey,{status:'failed'});
              }
              publish();
            };
            used+=asset.size;decodedPixels+=pixels;
            for(const ref of matches)images.set(ref.slotKey,{status:'ready',url:imageUrl,dimensions,digest,
              frozenDigestMatched:ref.expectedDigest===digest,
              pinned:response.data.serverAttestation==='SERVER_HASH_PINNED',onError:fail});
            publish();
          }catch{
            if(url&&urls.delete(url))URL.revokeObjectURL(url);
            if(!live())return;
            setGroup(group,'failed');
          }
        }
      }catch{if(live()){for(const ref of refs)if(images.get(ref.slotKey)?.status==='pending')images.set(ref.slotKey,{status:'failed'});publish();}}
    }
    void load();
    return()=>{unsubscribe();if(generation.current===started)++generation.current;epoch=null;release();};
    // key captures the exact owner and image-reference signature. Unrelated
    // text edits, selection and reorder do not re-download private images.
  },[port,key,enabled,attempt]);
  const images=enabled&&view.key===key?view.images:new Map<string,CanvasImageView>();
  const count=(status:CanvasImageView['status'])=>refs.filter(ref=>images.get(ref.slotKey)?.status===status).length;
  return {available:!!key,enabled,images,total:refs.length,ready:count('ready'),failed:count('failed'),deferred:count('deferred'),
    pinned:refs.filter(ref=>{const image=images.get(ref.slotKey);return image?.status==='ready'&&image.pinned;}).length,
    frozenMatched:refs.filter(ref=>{const image=images.get(ref.slotKey);return image?.status==='ready'&&image.pinned&&image.frozenDigestMatched;}).length,
    show:()=>{setEnabled(true);setAttempt(value=>value+1);},hide:()=>setEnabled(false)};
}

export function PortfolioCanvas({snapshot, title, standalone, simulation, width, selectedSlot, onSelectSlot, keyboardScroll,onContentWidth,privateMedia,onAddFirstSection,dropTargets}: {
  snapshot: PortfolioSnapshot | null | undefined; title: string; standalone?: boolean;
  simulation?:boolean; width?: number; keyboardScroll?:boolean;onContentWidth?:(width:number|null)=>void;
  selectedSlot?:string; onSelectSlot?:(key:string)=>void;
  privateMedia?:PrivateCanvasMediaContext;onAddFirstSection?:()=>void;dropTargets?:PrivateCanvasDropTargets;
}) {
  const theme=readTheme(snapshot);
  const style:CSSProperties & {'--portfolio-surface': string}={
    '--portfolio-surface':theme.surface,
    background:theme.surface,color:theme.text,colorScheme:theme.mode,
    borderTopColor:theme.accent,maxWidth:width
  };
  const sections=useMemo(()=>canvasSections(snapshot),[snapshot]);
  const blank=canvasPreset(snapshot)==='blank'&&sections.length===0;
  const instance=useId().replace(/[^a-zA-Z0-9_-]/g,'');
  const measured=useRef<HTMLDivElement>(null);
  const parsed=useMemo(()=>snapshot?parseScopedTheme(snapshot):null,[snapshot]);
  const scopedCss=useMemo(()=>parsed?.status==='valid'&&snapshot?scopedCanvasRules(snapshot,sections,theme.mode,instance):null,[parsed,snapshot,sections,theme.mode,instance]);
  const scoped=!!scopedCss;
  useLayoutEffect(()=>{
    const element=measured.current;
    if(!onContentWidth)return;
    if(!element||typeof ResizeObserver==='undefined'){onContentWidth(null);return;}
    const observer=new ResizeObserver(entries=>{
      const w=entries[0]?.contentRect.width;
      onContentWidth(typeof w==='number'&&scopedThemeBreakpoint(w)?w:null);
    });
    observer.observe(element);
    return()=>{observer.disconnect();onContentWidth(null);};
  },[scoped,onContentWidth]);
  const themeNode=(section:CanvasSection,name:string)=>scoped?'s'+sections.indexOf(section)+'c'+section.slots.indexOf(name):undefined;
  const editing=typeof onSelectSlot==='function'&&!standalone&&!simulation;
  // Fullscreen is still private only when the route supplies its verified
  // owner context. Standalone share scenes without it remain byte-free.
  const media=useCanvasMedia(privateMedia,snapshot,sections,selectedSlot,!simulation&&!!privateMedia);
  const liveDrops=editing&&privateMedia?dropTargets:undefined;
  const {highlighted:sectionHighlight,setHighlighted:setSectionHighlight}=useDropOutline();
  function sectionDragOver(event:DragEvent<HTMLElement>,before:string|null){
    if(!liveDrops?.canDropSection(before)){setSectionHighlight(null);return;}
    event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';
    setSectionHighlight(before??'__end__');
  }
  function sectionDrop(event:DragEvent<HTMLElement>,before:string|null){
    setSectionHighlight(null);
    if(!liveDrops?.canDropSection(before))return;
    event.preventDefault();event.stopPropagation();liveDrops.dropSection(before);
  }
  const slotProps={snapshot,editing,selectedSlot,onSelectSlot,showMissing:!standalone&&!simulation,themeNode,privateImages:media.images,dropTargets:liveDrops};
  const Tag=standalone?'main':'div';
  const content=<>
      {!blank&&<header className="pv-site-head"><strong>{title}</strong>
        <span>Owner-authored portfolio</span></header>}
            {sections.length===0?<section className="pv-empty-page">
        <h2>No authored sections yet.</h2>
        <p>{standalone||simulation?'This saved portfolio has no authored sections.':blank?'Add your first section using Structure & layers. No starter sections or sample content have been inserted.':'Add a section using Structure & layers to begin building your page.'}</p>
        {blank&&editing&&onAddFirstSection&&<button type="button" className="ws-secondary" onClick={onAddFirstSection}>Add your first section</button>}
      </section>:sections.map((section,index)=>{
        const {hero,headline,textSlot,buttons,media,note,others}=canvasSlotGroups(section);
        return <section key={section.id} className={'pv-section pv-layout-'+section.renderId+(hero?' pv-hero':' pv-content-section')}
          data-k-theme-node={scoped?'s'+index:undefined} aria-label={'Portfolio section '+(index+1)}
          data-drop-fit={sectionHighlight===section.id?'compatible':undefined}
          style={sectionHighlight===section.id?DROP_OUTLINE:undefined}
          onDragOver={event=>sectionDragOver(event,section.id)}
          onDragLeave={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))setSectionHighlight(null);}}
          onDrop={event=>sectionDrop(event,section.id)}>
          {hero?<div className="pv-hero-grid">
            <div className="pv-hero-copy">
              <span className="pv-eyebrow">{section.renderId==='L5'?'YOUR STORY':'PORTFOLIO / INTRODUCTION'}</span>
              {headline&&<h2><PortfolioSlot {...slotProps} section={section} name="title" kind="title"/></h2>}
              {textSlot&&<div className="pv-summary"><PortfolioSlot {...slotProps} section={section} name={textSlot}/></div>}
              <div className="pv-actions">{buttons.map(name=>
                <PortfolioSlot {...slotProps} section={section} key={name} name={name} kind="action"/>)}</div>
              {note&&<div className="pv-hero-note"><PortfolioSlot {...slotProps} section={section} name="note" kind="tag"/></div>}
              {others.map(name=><div className="pv-slot-cell" key={name}>
                <PortfolioSlot {...slotProps} section={section} name={name}/>
              </div>)}
            </div>
            {media.length>0?
              <div className="pv-hero-art">{media.map(name=>
                <PortfolioSlot {...slotProps} section={section} key={name} name={name} kind="media"/>)}</div>:
              <div className="pv-hero-art" aria-hidden="true"><div className="pv-art-arc"/><div className="pv-art-fold"/></div>}
          </div>:<>
            <div className="pv-section-heading">
              {headline&&<h2><PortfolioSlot {...slotProps} section={section} name="title" kind="title"/></h2>}
              <span className="pv-section-index">{String(index+1).padStart(2,'0')}</span>
            </div>
            {textSlot&&<div className="pv-summary"><PortfolioSlot {...slotProps} section={section} name={textSlot}/></div>}
            <div className={'pv-section-slots pv-section-slots-'+section.renderId}>
              {others.map(name=>{
                const media=/^(image|imageA|imageB|media|avatar|thumbs)$/i.test(name);
                return <div className={'pv-slot-cell'+(media?' pv-media-cell':'')} key={name}>
                  <PortfolioSlot {...slotProps} section={section} name={name} kind={media?'media':'copy'}/>
                </div>;
              })}
            </div>
            {buttons.length>0&&<div className="pv-actions pv-section-actions">{buttons.map(name=>
              <PortfolioSlot {...slotProps} section={section} key={name} name={name} kind="action"/>)}</div>}
          </>}
        </section>;
      })}
      {liveDrops?.canDropSection(null)&&<div role="group" aria-label="Move section to canvas end"
        data-drop-fit={sectionHighlight==='__end__'?'compatible':undefined}
        style={sectionHighlight==='__end__'?DROP_OUTLINE:undefined}
        onDragOver={event=>sectionDragOver(event,null)} onDragLeave={()=>setSectionHighlight(null)}
        onDrop={event=>sectionDrop(event,null)}>Drop here to move the section to the end</div>}
      {!blank&&<footer className="pv-site-footer"><span>{title}</span><span>Author preview · Saved content only</span></footer>}
    </>;
  return <Tag className={standalone?'portfolio-only-preview pv-document':'ws-studio-canvas pv-document'}
    style={style} role={standalone?undefined:'region'} tabIndex={keyboardScroll?0:undefined}
    aria-label={standalone?'Saved private portfolio author preview':
      simulation?'Simulated visitor portfolio appearance':'Private authoring canvas'}>
    {!standalone&&<div className="pv-editor-caption">
      <span>AUTHOR CANVAS / {theme.mode.toUpperCase()}</span>
      <span>Illustrative empty-slot copy · Never saved or published</span>
    </div>}
    {(parsed?.status==='blocked'||(parsed?.status==='valid'&&!scoped))&&!standalone&&<p role="alert">Scoped theme could not be resolved. Showing the legacy palette only; publication is blocked for unsupported active overrides.</p>}
    {media.available&&<div className="pv-editor-caption" role="group" aria-label="Private canvas image previews">
      {media.enabled?<><span role="status">{media.ready} of {media.total} owner-private image slots verified · {media.pinned} server pin matches · Not public</span>
        {media.ready+media.failed+media.deferred<media.total&&<span>Verifying private image bytes…</span>}
        {media.failed>0&&<p role="alert">{media.failed} image slots could not be verified or decoded.</p>}
        {media.frozenMatched>0&&<span>{media.frozenMatched} snapshot digest and server pin matches · Not a publication receipt</span>}
        {media.deferred>0&&<p>{media.deferred} slots exceed this view’s 50 MiB compressed or 48 megapixel decoded image budget. Select a slot and retry to prioritize it.</p>}
        {(media.failed>0||media.deferred>0)&&<button type="button" className="ws-secondary" onClick={media.show}>Retry private canvas images</button>}
        <button type="button" className="ws-secondary" onClick={media.hide}>Hide private canvas images</button></>:
        <button type="button" className="ws-secondary" onClick={media.show}>Show private canvas images</button>}
    </div>}
    <div className="pv-site" ref={scoped?undefined:measured}>
      {scoped?<div ref={measured} data-k-theme-instance={instance} className="k-theme-container" style={{containerName:'k-portfolio-width',containerType:'inline-size',width:'100%',minWidth:0,writingMode:'horizontal-tb',padding:0,border:0}}>
        <style>{scopedCss}</style><div className="k-theme-root" data-k-theme-node="root">{content}</div>
      </div>:content}
    </div>
  </Tag>;
}


const scopedKeys:readonly ScopedThemeKey[]=['surface','text','accent','fontSizePx','lineHeight','fontWeight','spacingPx','radiusPx'];
const scopedKeyLabel:Record<ScopedThemeKey,string>={surface:'Surface color',text:'Text color',accent:'Accent color',fontSizePx:'Font size (px)',lineHeight:'Line height',fontWeight:'Font weight',spacingPx:'Spacing (px)',radiusPx:'Corner radius (px)'};
const scopedScopeId=(scope:ScopedThemeScope)=>scope.kind==='global'?'global':scope.kind+':'+scope.id;
function scopedSetEdit(key:ScopedThemeKey,input:string):ScopedThemeEdit|null{
  if(key==='surface'||key==='text'||key==='accent')return /^#[a-fA-F0-9]{6}$/.test(input)?{kind:'set',key,value:input}:null;
  if(!input.trim())return null;
  const value=Number(input);
  if(!Number.isFinite(value))return null;
  switch(key){
    case 'fontSizePx':return Number.isInteger(value)&&value>=12&&value<=72?{kind:'set',key,value}:null;
    case 'lineHeight':return value>=1&&value<=2?{kind:'set',key,value}:null;
    case 'fontWeight':return value===400||value===500||value===600||value===700?{kind:'set',key,value}:null;
    case 'spacingPx':return Number.isInteger(value)&&value>=0&&value<=64?{kind:'set',key,value}:null;
    case 'radiusPx':return Number.isInteger(value)&&value>=0&&value<=32?{kind:'set',key,value}:null;
  }
}
function ScopedTokenControl({tokenKey,explicit,effective,disabled,revision,onEdit}:{
  tokenKey:ScopedThemeKey;explicit:ScopedThemeTokens[ScopedThemeKey];effective:ScopedThemeTokens[ScopedThemeKey];disabled:boolean;revision:number;onEdit:(edit:ScopedThemeEdit)=>boolean;
}){
  const [input,setInput]=useState(String(explicit??effective??''));
  const field=useRef<HTMLDivElement>(null);
  const previousRevision=useRef(revision);
  const edited=useRef(false);
  useLayoutEffect(()=>{
    // A resize can change an inherited value without a revision. Reflect it
    // only when the author has not typed; never overwrite a local input on
    // an unrelated measurement update. Undo/Redo changes the revision.
    const revisionChanged=previousRevision.current!==revision;
    if(revisionChanged||!edited.current){
      previousRevision.current=revision;edited.current=false;setInput(String(explicit??effective??''));
    }
  },[revision,explicit,effective]);
  function changeInput(value:string){edited.current=true;setInput(value);}
  function discardInput(){edited.current=false;setInput(String(explicit??effective??''));}
  function submit(change:ScopedThemeEdit){
    if(disabled)return;
    if(onEdit(change)){edited.current=false;field.current?.querySelector<HTMLElement>('input,select')?.focus();}
  }
  const edit=scopedSetEdit(tokenKey,input);
  const color=tokenKey==='surface'||tokenKey==='text'||tokenKey==='accent';
  const numeric=!color&&tokenKey!=='fontWeight';
  return <div ref={field} onKeyDown={event=>{
    if(event.key==='Enter'&&!disabled&&edit&&!(edit.kind==='set'&&edit.value===explicit)&&event.target instanceof HTMLInputElement&&event.target.type!=='color'){
      event.preventDefault();event.stopPropagation();submit(edit);
    }else if(event.key==='Escape'&&edited.current){
      event.preventDefault();event.stopPropagation();discardInput();
    }
  }}>
    {tokenKey==='fontWeight'?<label>Override value<select aria-label="Override value" value={input} onChange={event=>changeInput(event.target.value)} disabled={disabled}>
      <option value="">Choose a weight</option>{[400,500,600,700].map(value=><option key={value} value={value}>{value}</option>)}
    </select></label>:<label>Override value<input aria-label="Override value" type={numeric?'number':'text'} value={input} onChange={event=>changeInput(event.target.value)}
      min={tokenKey==='fontSizePx'?12:tokenKey==='lineHeight'?1:0} max={tokenKey==='fontSizePx'?72:tokenKey==='lineHeight'?2:tokenKey==='radiusPx'?32:64}
      step={tokenKey==='lineHeight'?'any':1} maxLength={color?7:undefined} placeholder={color?'#RRGGBB':'Enter a value'} disabled={disabled}
      aria-invalid={input!==''&&!edit}/></label>}
    {color&&<label>Override color picker<input aria-label="Override color picker" type="color"
      value={/^#[0-9a-f]{6}$/i.test(input)?input:typeof effective==='string'&&/^#[0-9a-f]{6}$/i.test(effective)?effective:'#000000'}
      disabled={disabled} onChange={event=>changeInput(event.target.value)}/></label>}
    {input!==''&&!edit&&<p role="alert">Enter a value within the supported token bounds.</p>}
    {input!==String(explicit??effective??'')&&<button type="button" className="ws-secondary" disabled={disabled} onClick={discardInput}>Discard unsaved token input</button>}
    <button type="button" className="ws-primary" disabled={disabled||!edit||(edit.kind==='set'&&edit.value===explicit)} onClick={()=>edit&&submit(edit)}>Apply override</button>
    <button type="button" className="ws-secondary" disabled={disabled||explicit===undefined} onClick={()=>submit({kind:'reset',key:tokenKey})}>Reset selected override</button>
  </div>;
}
function ScopedThemeControls({head,apply,mode,contentWidth,disabled}:{
  head:EditorHead;apply:Apply;mode:PortfolioTheme['mode'];contentWidth?:number|null;disabled:boolean;
}){
  const [scopeId,setScopeId]=useState('global');
  const [layer,setLayer]=useState<ScopedThemeLayer>('base');
  const [tokenKey,setTokenKey]=useState<ScopedThemeKey>('surface');
  const [notice,setNotice]=useState('');
  const parsed=parseScopedTheme(head.snapshot);
  const sections=canvasSections(head.snapshot);
  const preset=canvasPreset(head.snapshot);
  const options:{scope:ScopedThemeScope;label:string;sectionId?:string;slotKey?:string}[]=[{scope:{kind:'global'},label:'Global'}];
  if(preset!==null)
    options.push({scope:{kind:'template',id:preset},label:'Template · '+preset});
  for(const section of sections){
    options.push({scope:{kind:'section',id:section.id},label:'Section · '+section.id,sectionId:section.id});
    for(const name of section.slots){
      const slotKey=section.id+'-'+name.toLowerCase();
      options.push({scope:{kind:'component',id:slotKey},label:'Component · '+section.id+' / '+name,sectionId:section.id,slotKey});
    }
  }
  const matched=options.find(item=>scopedScopeId(item.scope)===scopeId);
  const selected=matched??options[0]!;
  const actual=typeof contentWidth==='number'&&scopedThemeBreakpoint(contentWidth)?contentWidth:null;
  const widthPx=layer==='phone'?390:layer==='tablet'?768:layer==='desktop'?1440:actual??768;
  const resolved=resolveScopedTheme(head.snapshot,{mode,sectionId:selected.sectionId,slotKey:selected.slotKey,widthPx});
  const inheritedBase=layer==='base'?resolveScopedThemeBase(head.snapshot,{mode,sectionId:selected.sectionId,slotKey:selected.slotKey,widthPx}):null;
  const entry=parsed.entries.find(item=>item.active&&item.mode===mode&&scopedScopeId(item.scope)===scopedScopeId(selected.scope));
  const explicit=(layer==='base'?entry?.base:entry?.breakpoints?.[layer])?.[tokenKey];
  const effective=resolved.tokens[tokenKey],origin=resolved.origins[tokenKey];
  // A Base edit must not copy a responsive override into the Base layer.
  // The measured-width effective readout below remains independent.
  const inputEffective=layer==='base'?inheritedBase?.status==='resolved'?inheritedBase.tokens[tokenKey]:undefined:effective;
  const blocked=disabled||!matched||parsed.status==='blocked'||resolved.status!=='resolved'||(layer==='base'&&inheritedBase?.status!=='resolved');
  function edit(change:ScopedThemeEdit){
    setNotice('');
    if(blocked)return false;
    const ok=apply({kind:'EDIT_SCOPED_THEME',expectedRevision:head.revision,mode,scope:selected.scope,layer,edit:change});
    setNotice(ok?'Override applied to the working draft. Save to persist, or use Undo.':'Override was not applied. Review the current draft and retry.');
    return ok;
  }
  const contrast=resolved.tokens.text&&resolved.tokens.surface?themeContrast(resolved.tokens.text,resolved.tokens.surface):null;
  return <section role="region" aria-label="Scoped theme overrides">
    <h3>Scoped theme overrides</h3>
    <p>{actual!==null?'Measured content: '+actual+' px · '+scopedThemeBreakpoint(actual):'Measured canvas width unavailable.'} Editing a layer does not change the selected preview width.</p>
    {parsed.status==='blocked'&&<p role="alert">Unsupported theme data is preserved privately. Scoped editing and publication are blocked until it is resolved.</p>}
    {parsed.issues.some(issue=>issue.code==='ORPHAN_SCOPE'||issue.code==='UNSUPPORTED_ORPHAN')&&<p>Unplaced theme overrides are retained privately and not rendered. Reusing the same canonical scope may reactivate a retained override.</p>}
    {!matched&&<p role="alert">The previously selected scope no longer exists. Choose a current scope before applying an override.</p>}
    <label>Scope<select aria-label="Scope" value={matched?scopeId:''} onChange={event=>{setScopeId(event.target.value);setNotice('');}}>
      {!matched&&<option value="" disabled>Choose a current scope</option>}
      {options.map(item=><option key={scopedScopeId(item.scope)} value={scopedScopeId(item.scope)}>{item.label}</option>)}
    </select></label>
    <label>Override layer<select aria-label="Override layer" value={layer} onChange={event=>{const value=event.target.value;if(value==='base'||value==='phone'||value==='tablet'||value==='desktop')setLayer(value);setNotice('');}}>
      <option value="base">Base · all widths</option><option value="phone">Phone · up to 600 px</option><option value="tablet">Tablet · above 600 to 950 px</option><option value="desktop">Desktop · above 950 px</option>
    </select></label>
    <label>Theme token<select aria-label="Theme token" value={tokenKey} onChange={event=>{const key=scopedKeys.find(k=>k===event.target.value);if(key)setTokenKey(key);setNotice('');}}>
      {scopedKeys.map(key=><option value={key} key={key}>{scopedKeyLabel[key]}</option>)}
    </select></label>
    {matched&&<><dl><div><dt>Explicit value in selected layer</dt><dd>{explicit??'Inherited'}</dd></div>
      <div><dt>Effective value at {widthPx} px{actual===widthPx?' measured':' reference width'}</dt><dd>{effective??'Renderer default / unavailable'}</dd></div>
      <div><dt>Effective origin</dt><dd>{origin?(origin.scope.kind==='palette'?'Flat palette':scopedScopeId(origin.scope))+' · '+origin.layer:'Unavailable'}</dd></div>
      {inheritedBase?.status==='resolved'&&<div><dt>Base-only resolved value</dt><dd>{inheritedBase.tokens[tokenKey]??'Renderer default'}</dd></div>}</dl>
    {selected.scope.kind==='global'&&<p>The root effective value includes the active template; a narrower override may win.</p>}
    {contrast!==null&&<p role={contrast<4.5?'alert':undefined}>Effective text / surface contrast: {contrast.toFixed(2)}:1. This checks only these colors.</p>}
    {resolved.status!=='resolved'&&parsed.status!=='blocked'&&<p>Initialize or correct the global palette before editing scoped tokens.</p>}
    <ScopedTokenControl key={mode+'|'+scopeId+'|'+layer+'|'+tokenKey} revision={head.revision} tokenKey={tokenKey} explicit={explicit} effective={inputEffective} disabled={blocked} onEdit={edit}/></>}
    {notice&&<p role="status">{notice}</p>}
    <p>Only supported trusted preview content is styled. Custom source is not executed. A reset removes this key from this layer only.</p>
  </section>;
}

export function ThemeInspector({head, apply, width, resize,contentWidth,disabled=false}: {
  head: EditorHead; apply: Apply; width: number; resize: (width: number) => void;contentWidth?:number|null;disabled?:boolean;
}) {
  const theme = readTheme(head.snapshot);
  const ratio=themeContrast(theme.text,theme.surface);
  const previous=head.snapshot.files[THEME_PATH];
  let parsedTokens:Record<string,unknown>|undefined;
  try{parsedTokens=previous?objectRecord(JSON.parse(previous)):{};}catch{parsedTokens=undefined;}
  const tokens=parsedTokens??{};
  // Retain the renderer's established flat active fields. This editor-only
  // history is optional; unknown token fields are not rewritten.
  const history=objectRecord(tokens.authorModePalettes);
  const historySupported=tokens.authorModePalettes===undefined||!!history&&
    ['light','dark'].every(mode=>history[mode]===undefined||validPalette(history[mode]));
  function setTheme(next: PortfolioTheme) {
    if(disabled||!parsedTokens)return;
    if(!historySupported){
      if(next.mode!==theme.mode)return;
      apply({kind:'WRITE_MANAGED_FILE',path:THEME_PATH,source:JSON.stringify({...tokens,...next},null,2)});
      return;
    }
    const nextHistory={...history,
      [theme.mode]:{...objectRecord(history?.[theme.mode]),...paletteOf(theme)},
      [next.mode]:{...objectRecord(history?.[next.mode]),...paletteOf(next)}};
    apply({kind:'WRITE_MANAGED_FILE',path:THEME_PATH,source:JSON.stringify({...tokens,...next,authorModePalettes:nextHistory},null,2)});
  }
  function switchMode(mode:PortfolioTheme['mode']){
    if(!historySupported||(mode===theme.mode&&previous!==undefined))return;
    const saved=history?.[mode];
    const palette=validPalette(saved)?paletteOf({...saved,mode}):paletteOf(mode==='dark'?defaultDarkTheme:defaultTheme);
    setTheme({mode,...palette});
  }
  return <div className="ws-editor-tool">
    <h2>Theme &amp; responsive</h2>
    <label>Preview width<select aria-label="Preview width" value={width} onChange={event => resize(Number(event.target.value))}>
      <option value={0}>Fit canvas</option><option value={1440}>Desktop · up to 1440 px</option><option value={768}>Tablet · 768 px</option><option value={390}>Phone · 390 px</option>
    </select></label>
    <label>Portfolio theme<select aria-label="Portfolio theme" value={previous===undefined?'':theme.mode} disabled={disabled||!parsedTokens||!historySupported} onChange={event=>{
      if(event.target.value==='light'||event.target.value==='dark')switchMode(event.target.value);
    }}>{previous===undefined&&<option value="" disabled>Choose initial palette</option>}<option value="light">Light</option><option value="dark">Dark</option></select></label>
    {!historySupported&&<p role="alert">Existing palette-history data is unsupported. The current colors can be edited, but switching modes is blocked to avoid losing data.</p>}
    {colors.map(key => <label key={key}>{key}<input type="color" disabled={disabled||!parsedTokens} value={theme[key]} onChange={event =>
      setTheme({...theme, [key]: event.target.value})}/></label>)}
    <p>Global portfolio tokens · independent of the workspace theme. Preview widths do not authorize phone editing.</p>
    <p role={ratio<4.5?'alert':undefined}>Text on surface: {ratio.toFixed(2)}:1 contrast.
      {ratio<4.5?' Below 4.5:1 for ordinary text; adjust the colors before release.':' Meets the 4.5:1 reference for these two colors only.'}
      {' '}This is not a complete accessibility or publication check.</p>
    <button type="button" className="ws-secondary"
      disabled={disabled||!parsedTokens||colors.every(key=>theme[key]===(theme.mode==='dark'?defaultDarkTheme:defaultTheme)[key])}
      onClick={()=>setTheme({... (theme.mode==='dark'?defaultDarkTheme:defaultTheme)})}>Reset global palette</button>
    {!parsedTokens&&<p role="alert">The existing theme document cannot be edited safely; its original data is preserved.</p>}
    {!previous&&<button type="button" className="ws-secondary" disabled={disabled} onClick={()=>setTheme(theme)}>Initialize global palette</button>}
    <p>Each mode retains its own global palette; reset affects only the active palette. Changes use the private transaction and Undo.</p>
    <ScopedThemeControls head={head} apply={apply} mode={theme.mode} contentWidth={contentWidth} disabled={disabled||!parsedTokens}/>
  </div>;
}

export function SourceInspector({head,apply,back,buffers,setBuffers}:{
  head:EditorHead;slot:string;apply:Apply;back:()=>void;
  buffers:Record<string,string>;setBuffers:Dispatch<SetStateAction<Record<string,string>>>;
}) {
  const [selected,setSelected]=useState('');
  const [notice,setNotice]=useState('');
  const pendingSource=unappliedSourceBufferCount(buffers,head.snapshot.files);
  const files=Object.keys(head.snapshot.files).sort((left,right)=>{
    const a=left.startsWith('slots/'),b=right.startsWith('slots/');
    return a===b?left.localeCompare(right):a?-1:1;
  });
  const path=files.includes(selected)?selected:files[0]??'';
  const current=head.snapshot.files[path]??'';
  const buffer=buffers[path]??current;
  const ownerSource=Object.entries(head.snapshot.slots).find(([,entry])=>
    (entry.state==='S1'||entry.state==='S2')&&entry.sourcePath===path);
  const owned=!!ownerSource;
  const bytes=new TextEncoder().encode(buffer).byteLength;
  const changed=buffer!==current;
  const overLimit=bytes>MAX_FILE_BYTES;
  function applyBuffer(){
    if(!owned||!ownerSource||!path||!changed||overLimit)return;
    setNotice('');
    const ok=apply({kind:'EDIT_OWNED_SOURCE',slotKey:ownerSource[0],source:buffer});
    if(ok){
      setBuffers(values=>{const next={...values};delete next[path];return next;});
      setNotice('Owned source applied to the unsaved private editor revision. The preview does not execute this code.');
    } else setNotice('Source change was not applied. Your unsaved buffer remains in this editor.');
  }
  return <div className="ws-source-explorer" role="group" aria-label="Advanced source workspace">
    <aside className="ws-source-tree">
      <p className="ws-kicker">ADVANCED EDITOR</p>
      <h2>Source explorer</h2>
      <p>Generated composition files are read-only. Only personally owned source files can be edited after the trusted customization step.</p>
      <nav aria-label="Source files">
        <ul>{files.map(file=>{
          const owner=Object.values(head.snapshot.slots).some(entry=>
            (entry.state==='S1'||entry.state==='S2')&&entry.sourcePath===file);
          const managed=file.endsWith('.json');
          return <li key={file}><button type="button" aria-pressed={path===file} onClick={()=>{
            setSelected(file);setNotice('');
          }}>
            <span>{file.split('/').at(-1)}</span>
            <small>{owner?'Owned':managed?'Generated · protected':'Archived · protected'}</small>
          </button></li>;
        })}</ul>
      </nav>
      {files.length===0&&<p>No project source files in this private draft.</p>}
      <p className="ws-source-tree-note">Source files are real private snapshot records. No example source is generated or executed here.</p>
      <button type="button" className="ws-secondary" onClick={back}>Back to editor canvas</button>
    </aside>
    <section className="ws-source-editor" aria-label="Selected project source">
      <header className="ws-source-editor-header">
        <span>{path||'No source'} · {owned?'Owned editable text':'Protected generated composition'}</span>
        <span>{changed?'Unapplied source buffer':'Matches working snapshot'}</span>
      </header>
      {path?owned?<div className="ws-source-code-window">
        <label htmlFor="kd-source-editor">Owned source buffer</label>
        <textarea id="kd-source-editor" spellCheck={false} rows={22} value={buffer}
          onChange={event=>{
            const next=event.target.value;
            setBuffers(previous=>{
              const updated={...previous};
              if(next===current)delete updated[path];else updated[path]=next;
              return updated;
            });
            setNotice('');
          }}/>
      </div>:<div className="ws-source-code-window ws-source-preview" role="group" aria-label="Readonly generated file">
        <pre><code>{current}</code></pre>
      </div>:<p>No source file is available.</p>}
      <div className="ws-source-footer">
        <p>{owned?'Owned source can be changed in the private draft, but no code is executed in the author canvas.':
          'Generated JSON composition and library files are protected from direct editing. Use Content and Sections instead.'}</p>
        {owned&&<button type="button" className="ws-primary" disabled={!changed||overLimit}
          onClick={applyBuffer}>Apply owned source to draft</button>}
        {changed&&<button type="button" className="ws-secondary" onClick={()=>{
          setBuffers(values=>{const next={...values};delete next[path];return next;});
          setNotice('Unapplied source buffer discarded; the private snapshot was unchanged.');
        }}>Discard source buffer</button>}
      </div>
      {pendingSource>0&&<p className="ws-source-unapplied" role="status">{pendingSource} unapplied source {pendingSource===1?'buffer':'buffers'}.
        Apply or discard each before saving or leaving this editor.
        <button type="button" className="ws-secondary ws-source-clear-all" onClick={()=>{
          setBuffers({});
          setNotice('All unapplied source buffers were discarded. The saved private snapshot is unchanged.');
        }}>Discard all unapplied source buffers</button>
      </p>}
      {notice&&<p role="status" className="ws-inline-alert">{notice}</p>}
    </section>
    <aside className="ws-source-diagnostics">
      <p className="ws-kicker">SOURCE DIAGNOSTICS</p>
      <h2>Editor rules</h2>
      <p>Only a verified editor transaction can modify owner source. Source text is never evaluated on the privileged workspace origin.</p>
      <dl>
        <div><dt>Source protection</dt><dd>{owned?'Owner-controlled version':'Read-only generated or archived file'}</dd></div>
        <div><dt>File size</dt><dd>{bytes.toLocaleString()} / {MAX_FILE_BYTES.toLocaleString()} bytes</dd></div>
        <div><dt>Draft buffer</dt><dd>{pendingSource?pendingSource+' unapplied file'+(pendingSource===1?'':'s'):'Matches working revision'}</dd></div>
        <div><dt>Author preview</dt><dd>Code execution disabled</dd></div>
        <div><dt>Public custom JavaScript</dt><dd>Blocked pending proven isolation</dd></div>
      </dl>
      {overLimit&&<p role="alert">The owned source exceeds the {MAX_FILE_BYTES.toLocaleString()}-byte limit. Your buffer is preserved; it cannot be applied.</p>}
      <p className="ws-source-diagnostics-note">No compilation, static security analysis, or public preview validation has run on this source. A successful draft save is not a release approval.</p>
    </aside>
  </div>;
}

/** One editor mount retains the operation UUID even when the panel closes
 * before an acknowledgement. This is not an offline login or cross-reload queue. */
export type ComponentSaveRetryState={
  pending:{signature:string;id:string;epoch:number}|null;inFlight:boolean;
};
/** Match the engine's unique declared slot rule. Legacy layoutless snapshots
 * retain suffix compatibility, but malformed/ambiguous manifests do not. */
function savedReuseSlotKind(snapshot:PortfolioSnapshot,key:string):string|null{
  if(!key||!Object.hasOwn(snapshot.slots,key))return null;
  try{
    const page:unknown=JSON.parse(snapshot.files['pages/home.page.json']??'null');
    const record=objectRecord(page);
    if(!record||!Object.hasOwn(record,'sections'))return key.slice(key.lastIndexOf('-')+1);
    if(!Array.isArray(record.sections))return null;
    const kinds:string[]=[];
    for(const raw of record.sections){
      const section=objectRecord(raw);
      if(!section||typeof section.id!=='string'||typeof section.layout!=='string')continue;
      for(const name of portfolioLayout(section.layout)?.slots??[]){
        const kind=name.toLowerCase();
        if(section.id+'-'+kind===key)kinds.push(kind);
      }
    }
    return kinds.length===1?kinds[0]!:null;
  }catch{return null;}
}

export function ComponentLibrary({port, head, committed, slot, apply, blocked,saveRetry,onReuseTarget}: {
  port: SupabaseBrowserAuthPort; head: EditorHead; committed: PortfolioSnapshot | null; slot: string; apply: Apply;blocked:boolean;
  saveRetry:{current:ComponentSaveRetryState};onReuseTarget?:(slotKey:string)=>void;
}) {
  const [versions, setVersions] = useState<MyComponentVersion[] | null>(null);
  const [message, setMessage] = useState('');
  const [listError,setListError]=useState('');
  const [listPending,setListPending]=useState(true);
  const listFlight=useRef(true);
  const cataloguePort=useRef<SupabaseBrowserAuthPort|null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState('');
  const [compatibleOnly,setCompatibleOnly]=useState(false);
  const [review,setReview]=useState<{
    versionId:string;slotKey:string;head:EditorHead;epoch:number;generation:number
  }|null>(null);
  const [inspectVersion,setInspectVersion]=useState<string|null>(null);
  const reviewHeading=useRef<HTMLHeadingElement>(null);
  const reviewTrigger=useRef<HTMLButtonElement|null>(null);
  const searchInput=useRef<HTMLInputElement>(null);
  const componentNameInput=useRef<HTMLInputElement>(null);
  const reviewSubmitting=useRef(false);
  const [pickedVersion,setPickedVersion]=useState<string|null>(null);
  const savedDrag=useRef<{head:EditorHead;id:string;epoch:number;generation:number}|null>(null);
  const slotKind=savedReuseSlotKind(head.snapshot,slot)??'';
  const state=slotKind?head.snapshot.slots[slot]?.state:undefined;
  const owned=slotKind?head.snapshot.slots[slot]:undefined,savedSlot=committed&&slotKind?committed.slots[slot]:undefined;
  const canSave=!!slotKind&&!!owned?.sourcePath&&!!savedSlot?.sourcePath&&['S1','S2'].includes(savedSlot.state)&&
    owned.sourcePath===savedSlot.sourcePath&&owned.originalSource===savedSlot.originalSource&&
    owned.componentId===savedSlot.componentId&&head.snapshot.files[owned.sourcePath]===committed?.files[savedSlot.sourcePath];
  const [refresh,setRefresh]=useState(0);
   const componentListGeneration=useRef(0);
  const catalogueEpoch=useRef<number|null>(null);
  const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);

  useLayoutEffect(() => {
    let active = true;
    const epoch=port.reconcileOwnerSessionEpoch(),generation=++componentListGeneration.current;
    const sameBinding=cataloguePort.current===port&&catalogueEpoch.current===epoch;
    listFlight.current=true;setListPending(true);setListError('');
    if(!sameBinding){cataloguePort.current=null;catalogueEpoch.current=null;setVersions(null);setMessage('');setInspectVersion(null);setPickedVersion(null);setReview(null);savedDrag.current=null;}
    function fail(message:string){
      cataloguePort.current=null;catalogueEpoch.current=null;setVersions(null);setListError(message);
      setInspectVersion(null);setPickedVersion(null);setReview(null);savedDrag.current=null;
      listFlight.current=false;setListPending(false);
    }
    const unsubscribe=port.subscribeOwnerSessionEpoch(()=>{
      if(!active)return;
      active=false;++componentListGeneration.current;setMessage('');
      fail('Owner session changed. Reload the verified private component catalogue.');
    });
    if(active)void port.listOwnerComponents().then(result => {
      if(!active||generation!==componentListGeneration.current||port.reconcileOwnerSessionEpoch()!==epoch)return;
      if(result.data){
        cataloguePort.current=port;catalogueEpoch.current=epoch;setVersions(result.data);
        listFlight.current=false;setListPending(false);
      }else fail(result.error?.message??'My Components could not be loaded.');
    }).catch(()=>{if(active&&generation===componentListGeneration.current&&port.reconcileOwnerSessionEpoch()===epoch)fail('My Components could not be loaded.');});
    return ()=>{active=false;unsubscribe();};
  }, [port,refresh]);
  const catalogueReady=versions!==null&&!listPending&&!listError&&cataloguePort.current===port;
  const emptyReuseTargets=canvasSections(head.snapshot).flatMap(section=>section.slots.map(name=>({
    key:section.id+'-'+name.toLowerCase(),kind:name.toLowerCase(),label:section.renderId+' · '+name+' ('+section.id+')'
  }))).filter((item,index,all)=>all.filter(other=>other.key===item.key).length===1&&
    savedReuseSlotKind(head.snapshot,item.key)===item.kind&&head.snapshot.slots[item.key]?.state==='EMPTY');
  function canReuseEmpty(version:MyComponentVersion,key:string){
    const target=emptyReuseTargets.find(item=>item.key===key);
    return catalogueReady&&!listFlight.current&&!blocked&&!busy&&!review&&!!target&&
      !!versions?.some(item=>item===version)&&version.compatible_slot_kinds.includes(target.kind);
  }
  function reuseEmpty(version:MyComponentVersion,key:string){
    if(!canReuseEmpty(version,key)||catalogueEpoch.current!==port.reconcileOwnerSessionEpoch())return false;
    const ok=apply({kind:'REUSE_SAVED_COMPONENT',slotKey:key,componentVersionId:version.id,
      preserveMatchingContent:true},{[version.id]:version});
    if(ok){setMessage('Private component applied to '+key+'. Save to persist, or use Undo. Source execution remains disabled.');onReuseTarget?.(key);}
    else setMessage('No private component was placed. Review the current draft.');
    return ok;
  }
  function beginSavedDrag(event:DragEvent<HTMLElement>,version:MyComponentVersion){
    if(!emptyReuseTargets.some(item=>canReuseEmpty(version,item.key))){event.preventDefault();return;}
    const epoch=port.reconcileOwnerSessionEpoch();
    if(epoch!==catalogueEpoch.current){event.preventDefault();return;}
    savedDrag.current={head,id:version.id,epoch,generation:componentListGeneration.current};
    setPickedVersion(version.id);event.dataTransfer.effectAllowed='copy';
    event.dataTransfer.setData('text/plain','kadmeion-private-component-drag');
  }
  function currentSavedDrag(){
    const drag=savedDrag.current;
    return drag&&drag.head===head&&drag.epoch===catalogueEpoch.current&&drag.generation===componentListGeneration.current&&
      cataloguePort.current===port?versions?.find(item=>item.id===drag.id):undefined;
  }
  function dropSaved(event:DragEvent<HTMLElement>,key:string){
    const version=currentSavedDrag(),hadDrag=!!savedDrag.current;savedDrag.current=null;
    if(!hadDrag)return;
    event.preventDefault();event.stopPropagation();
    if(!version||!canReuseEmpty(version,key))return;
    reuseEmpty(version,key);
  }
  function reloadCatalogue(){
    ++componentListGeneration.current;listFlight.current=true;setListPending(true);setRefresh(n=>n+1);
  }

  async function save() {
    if(!catalogueReady||listFlight.current||!committed||!canSave||blocked||review||!name.trim()||busy)return;
    const retry=saveRetry.current;
    if(retry.inFlight){setMessage('A component save is still in progress. Retry after it completes.');return;}
    const epoch=port.reconcileOwnerSessionEpoch();
    if(catalogueEpoch.current!==epoch)return;
    retry.inFlight=true;setBusy(true);setMessage('');
    try {
      const key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55);
      if (!/^[a-z][a-z0-9-]{2,63}$/.test(key)) {setMessage('Choose a component name with at least three letters or digits, beginning with a letter.'); return;}
      const input=savedComponentInputFromOwnedSlot(committed,slot,{
        operationId:crypto.randomUUID(),componentKey:key,displayName:name,compatibleSlotKinds:[slotKind]
      });
      const signature=JSON.stringify({...input,operationId:''});
      if(retry.pending?.signature!==signature||retry.pending.epoch!==epoch)retry.pending={signature,id:input.operationId,epoch};
      input.operationId=retry.pending.id;
      const result=await port.saveOwnerComponent(input);
      if(!mounted.current||port.reconcileOwnerSessionEpoch()!==epoch)return;
      if (!result.data) {setMessage(result.error?.message ?? 'Component save could not be confirmed.'); return;}
      const saved = result.data;
      // Invalidate an older pending catalogue read, then reload the actual list.
      cataloguePort.current=port;catalogueEpoch.current=epoch;
      setVersions(current => [saved, ...(current ?? []).filter(version => version.id !== saved.id)]);
      reloadCatalogue();
      retry.pending=null;setName('');setMessage('Private component version saved.');
    }catch(error){if(mounted.current&&port.reconcileOwnerSessionEpoch()===epoch)
      setMessage(error instanceof Error?error.message:'Component save could not be confirmed.');}
    finally{retry.inFlight=false;if(mounted.current&&port.reconcileOwnerSessionEpoch()===epoch)setBusy(false);}
  }

  // Discovery is a projection of the verified private catalogue, not an
  // invented public listing, popularity score or persisted Favorites service.
  const categories=[...new Set(versions?.flatMap(version=>version.compatible_slot_kinds)??[])].sort();
  const normalizedQuery=query.trim().toLowerCase();
  const visibleVersions=versions?.filter(version=>
    (!compatibleOnly||!!state&&version.compatible_slot_kinds.includes(slotKind))&&
    (!category||version.compatible_slot_kinds.includes(category))&&
    (!normalizedQuery||[version.display_name,version.component_key,version.base_component_pin,
      'v'+version.version,...version.compatible_slot_kinds].some(value=>value.toLowerCase().includes(normalizedQuery))))??[];
  const reviewedVersion=review&&versions?.find(version=>version.id===review.versionId);
  const reviewCurrent=catalogueReady&&!!review&&!!reviewedVersion&&review.slotKey===slot&&review.head===head&&
    review.epoch===catalogueEpoch.current&&review.generation===componentListGeneration.current&&
    !!state&&state!=='EMPTY'&&!!owned&&reviewedVersion.compatible_slot_kinds.includes(slotKind);
  const retainedFields=reviewCurrent&&owned&&reviewedVersion?
    Object.keys(matchingReplacementContent(owned,reviewedVersion.base_component_pin)).sort():[];
  const stashedOnlyFields=reviewCurrent&&owned?
    Object.keys(owned.content).filter(key=>!retainedFields.includes(key)).sort():[];
  const sourceBytes=reviewCurrent&&owned?.sourcePath&&Object.hasOwn(head.snapshot.files,owned.sourcePath)?
    new TextEncoder().encode(head.snapshot.files[owned.sourcePath]!).byteLength:null;
  const protectedSource=state==='S1'||state==='S2';

  useLayoutEffect(()=>{if(review)reviewHeading.current?.focus();},[review]);
  function closeReview(restoreFocus=true){
    setReview(null);reviewSubmitting.current=false;
    if(restoreFocus){
      const trigger=reviewTrigger.current;
      if(trigger?.isConnected&&!trigger.disabled)trigger.focus();
      else searchInput.current?.focus();
    }
    reviewTrigger.current=null;
  }
  function openReuse(version:MyComponentVersion,trigger:HTMLButtonElement){
    if(!catalogueReady||listFlight.current||blocked||busy||review||!owned||!state||!versions?.some(item=>item===version)||
      !version.compatible_slot_kinds.includes(slotKind))return;
    const epoch=port.reconcileOwnerSessionEpoch();
    if(epoch!==catalogueEpoch.current)return;
    setMessage('');
    if(state==='EMPTY'){
      closeReview(false);
      const ok=apply({kind:'REUSE_SAVED_COMPONENT',slotKey:slot,componentVersionId:version.id,
        preserveMatchingContent:true},{[version.id]:version});
      if(ok){setMessage('Private component applied to the working draft. Save to persist; source execution remains disabled.');onReuseTarget?.(slot);}
      else setMessage('No private component was placed. Review the current draft.');
      return;
    }
    reviewTrigger.current=trigger;reviewSubmitting.current=false;
    setReview({versionId:version.id,slotKey:slot,head,epoch,
      generation:componentListGeneration.current});
  }
  function confirmReplacement(){
    if(listFlight.current||reviewSubmitting.current||!reviewCurrent||!review||!reviewedVersion||blocked||busy)return;
    if(port.reconcileOwnerSessionEpoch()!==review.epoch||
      review.generation!==componentListGeneration.current){
      closeReview();setMessage('The private component catalogue changed. Reload it and review the replacement again.');return;
    }
    reviewSubmitting.current=true;
    const ok=apply({kind:'REUSE_SAVED_COMPONENT',slotKey:review.slotKey,componentVersionId:review.versionId,
      confirmOwnedReplacement:protectedSource,preserveMatchingContent:true},{[reviewedVersion.id]:reviewedVersion});
    closeReview();
    if(ok)setMessage('Replacement applied to the working draft. Outgoing assignment is stashed; use Undo or Save.');
    else setMessage('Replacement was not applied. Review current draft and resolve outstanding edits before retrying.');
  }

  const inspected=catalogueReady&&inspectVersion?versions?.find(version=>version.id===inspectVersion):undefined;
  // A native drag destination must exist before the mouse is pressed. Keep
  // the same declared empty targets mounted regardless of a picked version.
  const reuseTargets=catalogueReady?emptyReuseTargets.filter(item=>visibleVersions.some(version=>version.compatible_slot_kinds.includes(item.kind))):[];
  const selectedVersion=catalogueReady?visibleVersions.find(version=>version.id===pickedVersion):undefined;
  const reuseListStyle:CSSProperties={height:'16rem',maxHeight:'16rem',margin:0,overflow:'auto',overflowWrap:'anywhere',alignContent:'start'};
  return <div className="ws-editor-tool"><h2>My Components</h2>
    {(message||listPending)&&<p role="status">{message}{message&&listPending?' ':''}{listPending?(versions===null?'Loading saved components…':'Rechecking saved components; reuse is temporarily unavailable.'):""}</p>}
    {listError&&!listPending&&<><p role="alert">{listError}</p><button type="button" className="ws-secondary" onClick={reloadCatalogue}>Retry private components</button></>}
    {listPending&&versions===null&&<div className="glyph-skeleton" aria-hidden="true"><span className="glyph-skeleton-line is-medium"/><span className="glyph-skeleton-line is-label"/><span className="glyph-skeleton-line is-short"/></div>}
    {catalogueReady&&versions?.length===0&&<p>You haven’t saved any component versions.</p>}
    {!!versions?.length&&<>
      <p>Selected target: {state?slotKind+' slot':'No slot selected'}. Private saved versions only.</p>
      <label>Search saved components<input ref={searchInput} type="search" value={query} maxLength={120}
        onChange={event=>setQuery(event.target.value)} placeholder="Name, version, pin or slot kind"/></label>
      <label>Compatible slot category<select value={category} onChange={event=>setCategory(event.target.value)}>
        <option value="">All categories</option>
        {categories.map(kind=><option key={kind} value={kind}>{kind}</option>)}
      </select></label>
      <label><input type="checkbox" checked={compatibleOnly} disabled={!state}
        onChange={event=>setCompatibleOnly(event.target.checked)}/> Only versions compatible with the selected slot</label>
      <p>{visibleVersions.length} of {versions.length} private versions shown.</p>
      {visibleVersions.length===0&&<><p>No saved versions match these filters.</p>
        <button type="button" className="ws-secondary" onClick={()=>{setQuery('');setCategory('');setCompatibleOnly(false);searchInput.current?.focus();}}>Clear filters</button></>}
    </>}
    {visibleVersions.length>0&&<div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:8,alignItems:'start'}} role="group" aria-label="Private component placement workspace">
      <div style={{minWidth:0}}><h3>Saved versions</h3>
    <ul className="ws-editor-slots" aria-label="Private component drag sources" style={reuseListStyle}>{visibleVersions.map(version=>{
      const compatible=!!state&&version.compatible_slot_kinds.includes(slotKind);
      const hasEmpty=emptyReuseTargets.some(item=>canReuseEmpty(version,item.key));
      return <li key={version.id}>
        <strong>{version.display_name} · v{version.version}</strong>
        {hasEmpty&&<button type="button" className="ws-secondary" draggable={hasEmpty}
          aria-pressed={pickedVersion===version.id} onClick={()=>setPickedVersion(version.id)}
          onDragStart={event=>beginSavedDrag(event,version)} onDragEnd={()=>{savedDrag.current=null;}}>
          Choose or drag {version.display_name} to an empty slot
        </button>}
        <span>Base: {version.base_component_pin} · Fits: {version.compatible_slot_kinds.join(', ')}</span>
        <button type="button" className="ws-secondary" aria-expanded={!!inspected&&inspected.id===version.id}
          disabled={!catalogueReady||busy} onClick={()=>{if(catalogueEpoch.current===port.reconcileOwnerSessionEpoch())setInspectVersion(current=>current===version.id?null:version.id);}}>
          {inspected?.id===version.id?'Close saved source':'Inspect saved source'} · {version.display_name}
        </button>
        <small>{compatible?'Fits selected slot':state?'Not compatible with selected slot':'Select a slot first'} · Private source, not trusted public code</small>
        <button type="button" aria-expanded={review?.versionId===version.id}
          disabled={!catalogueReady||!compatible||blocked||busy||!!review}
          onClick={event=>openReuse(version,event.currentTarget)}>
          {state==='EMPTY'?'Reuse in selected slot':'Review replacement'}
        </button>
      </li>;
    })}</ul>
      </div>
    <section aria-label="Compatible empty private component targets" style={{minWidth:0}}>
      <h3>Empty slots</h3>
      {!reuseTargets.length?<p>No compatible empty slot exists.</p>:<ul className="ws-editor-slots" style={reuseListStyle}>{reuseTargets.map(item=>{
        const fits=!!selectedVersion&&canReuseEmpty(selectedVersion,item.key);
        return <li key={item.key} data-drop-fit={fits?'compatible':undefined}
          style={fits?DROP_OUTLINE:undefined}
          onDragOver={event=>{const dragged=currentSavedDrag();if(dragged){
            event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=canReuseEmpty(dragged,item.key)?'copy':'none';
          }}}
          onDrop={event=>dropSaved(event,item.key)}>
          <button type="button" aria-disabled={!fits} onClick={()=>{if(selectedVersion&&canReuseEmpty(selectedVersion,item.key))reuseEmpty(selectedVersion,item.key);}}>
            Reuse saved version in {item.label}
          </button>
        </li>;
      })}</ul>}
    </section>
    </div>}
    {visibleVersions.length>0&&<p role="status">{selectedVersion?'Place saved version · '+selectedVersion.display_name:'Choose or drag a saved version to a declared empty slot.'}</p>}
    {inspected&&<section aria-label="Verified private saved component source">
      <h3>{inspected.display_name} · v{inspected.version}</h3>
      <p>Exact private source text from the verified owner catalogue. Displayed as text only, never compiled, executed, or treated as trusted public source.</p>
      <dl><div><dt>Base pin</dt><dd>{inspected.base_component_pin}</dd></div>
        <div><dt>Stored source bytes</dt><dd>{new TextEncoder().encode(inspected.source_code).byteLength}</dd></div>
        <div><dt>Source SHA-256 (catalogue receipt)</dt><dd><code>{inspected.source_sha256}</code></dd></div>
        <div><dt>Stored pristine text comparison</dt><dd>{inspected.source_code===inspected.pristine_source?'Matches stored original; app provenance still requires separate verification':'Modified from stored original'}</dd></div></dl>
      <pre tabIndex={0} aria-label="Saved component source text" style={{maxHeight:320,overflow:'auto',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}><code>{inspected.source_code}</code></pre>
      <button type="button" className="ws-secondary" onClick={()=>setInspectVersion(null)}>Close source inspection</button>
    </section>}
    {review&&<section aria-label="Replacement impact" onKeyDown={event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeReview();}
    }}>
      <h3 ref={reviewHeading} tabIndex={-1}>Review replacement impact</h3>
      {!reviewCurrent?<p role="alert">The selected slot, working draft or catalogue changed. Cancel and review the replacement again.</p>:<>
        <p>Replace {owned?.componentId??'current assignment'} with {reviewedVersion?.display_name} · v{reviewedVersion?.version} in {slotKind}.</p>
        <p>{protectedSource?(state==='S1'?'Owned pristine override (S1).':'Owned modified override (S2).'):'Pristine library assignment (S0).'} The entire outgoing assignment will be stashed.</p>
        {owned?.sourcePath&&<p>Protected source: <code>{owned.sourcePath}</code>{sourceBytes===null?'': ' · '+sourceBytes+' bytes'}. Existing source is retained; reuse creates a separate owned file.</p>}
        <dl>
          <div><dt>Matching declared fields retained</dt><dd>{retainedFields.join(', ')||'None'}</dd></div>
          <div><dt>Fields retained only in the outgoing stash</dt><dd>{stashedOnlyFields.join(', ')||'None'}</dd></div>
          <div><dt>Incoming source</dt><dd>Private saved version; no arbitrary source execution or public trust granted.</dd></div>
        </dl>
        {protectedSource&&<button type="button" className="ws-secondary" disabled={!catalogueReady||!canSave||blocked||busy}
          onClick={()=>{closeReview(false);componentNameInput.current?.focus();setMessage('Save the committed outgoing source as a private component before reviewing replacement again.');}}>Keep as My Component</button>}
        {protectedSource&&!canSave&&<p>To keep this exact outgoing version, cancel and save the portfolio after resolving unapplied buffers.</p>}
        {blocked&&<p role="status">Resolve pending source/content edits or saves before replacement.</p>}
        <button type="button" className="ws-primary" disabled={blocked||busy}
          onClick={confirmReplacement}>Replace and stash</button>
      </>}
      <button type="button" className="ws-secondary" onClick={()=>closeReview()}>Cancel replacement</button>
    </section>}
    {canSave && <><label>Component name<input ref={componentNameInput} disabled={busy} value={name} maxLength={80} onChange={event => setName(event.target.value)}/></label>
      <button type="button" className="ws-secondary" disabled={!catalogueReady||busy||blocked||!!review||!name.trim()} onClick={()=>void save()}>Save committed component</button></>}
    {!canSave&&(state==='S1'||state==='S2')&&<p>Save the portfolio and resolve unapplied source edits before keeping this exact owned version.</p>}
  </div>;
}


/** C10 UI boundary. S3 owns the authoritative planner, the parent write gate
 * and atomic transaction engine. No fallback applies unvalidated mutations.
 * These intent shapes match the agreed S03-004 contract; the parent supplies
 * the actual typed planner and apply once its engine is committed. */
export type LayoutMappingRequest={
  sectionId:string;expectedLayout:string;targetLayout:string;
  mappings:Array<{fromSlotKey:string;toSlotKey:string|null}>;
};
export type LayoutToolsIntent=
  | Extract<EditorIntent,{kind:'ASSIGN_COMPONENT'|'CLEAR_SLOT'|'MOVE_SECTION'|'MOVE_SECTION_BEFORE'}>
  | (LayoutMappingRequest & {kind:'CHANGE_SECTION_LAYOUT';expectedRevision:number;
      confirmStash:boolean;confirmOwnedRelocation:boolean})
  | {kind:'RESTORE_LAYOUT_STASH';fromSlotKey:string;stashIndex:number;toSlotKey:string;
      expectedRevision:number;confirmOwnedRelocation:boolean};
type LayoutPlanRow={fromSlotKey:string;toSlotKey:string|null;componentId:string;
  state:Assignment['state'];fields:string[];sourcePath?:string;sourceBytes?:number;
  disposition:'retain'|'move'|'stash'|'relocate'};
/** Additive details match the now-exported S3 LayoutChangePlan, without
 * breaking the agreed flags-only structural parent interface. */
type LayoutPlanFlags={requiresStashConfirmation:boolean;requiresOwnedRelocationConfirmation:boolean;
  expectedRevision?:number;sectionId?:string;expectedLayout?:string;targetLayout?:string;
  rows?:LayoutPlanRow[];targetKeys?:string[];emptyTargetKeys?:string[];stashedKeys?:string[];
  addedFiles?:number;addedStashAssignments?:number};
export type LayoutToolsProps={
  head:EditorHead;sectionId:string;blocked:boolean;
  planLayout:(head:EditorHead,request:LayoutMappingRequest)=>LayoutPlanFlags;
  applyLayout:(intent:LayoutToolsIntent)=>boolean;
};
type MappingDraft={head:EditorHead;sectionId:string;expectedLayout:string;targetLayout:string;
  choices:Record<string,string>};
type MappingReview={draft:MappingDraft;request:LayoutMappingRequest;flags:LayoutPlanFlags};
type RestoreDraft={head:EditorHead;fromSlotKey:string;stashIndex:number;toSlotKey:string};
type Assignment=PortfolioSnapshot['slots'][string];
const C10_LAYOUT_PINS=['arc-hero@1','collage-hero@1','project-showcase@1','editorial-bento@1',
  'stepped-hero@1','skills@1','experience@1','contact@1'] as const;
const C10_STASH='__stash__';
const layoutSlotKey=(sectionId:string,name:string)=>sectionId+'-'+name.toLowerCase();
const usableLayoutKey=(key:string)=>/^[a-z0-9_-]{1,64}$/.test(key)&&
  !['__proto__','prototype','constructor'].includes(key);
const layoutLabel=(pin:string)=>{const layout=portfolioLayout(pin);return layout?
  layout.renderId+' · '+pin.split('@')[0]!.replaceAll('-',' '):'Unavailable layout';};
const ownAssignment=(snapshot:PortfolioSnapshot,key:string):Assignment|undefined=>
  Object.hasOwn(snapshot.slots,key)?snapshot.slots[key]:undefined;
const ownedAssignment=(value:Assignment|undefined)=>value?.state==='S1'||value?.state==='S2';
function sameWorkingHead(captured:EditorHead,current:EditorHead):boolean{
  return captured.revision===current.revision&&captured.snapshot===current.snapshot;
}
/** Build the exact proposed mapping from explicit choices only. The engine
 * must still validate pin compatibility, quotas, provenance and collisions. */
function explicitLayoutMappings(keys:readonly string[],targetKeys:readonly string[],
  choices:Readonly<Record<string,string>>):LayoutMappingRequest['mappings']|null {
  const used=new Set<string>();
  const rows:LayoutMappingRequest['mappings']=[];
  for(const key of keys){
    if(!usableLayoutKey(key)||!Object.hasOwn(choices,key))return null;
    const choice=choices[key];
    if(choice===C10_STASH){rows.push({fromSlotKey:key,toSlotKey:null});continue;}
    if(!choice||!targetKeys.includes(choice)||!usableLayoutKey(choice)||used.has(choice))return null;
    used.add(choice);rows.push({fromSlotKey:key,toSlotKey:choice});
  }
  return rows;
}
function AssignmentImpact({assignment,snapshot}:{assignment:Assignment|undefined;snapshot:PortfolioSnapshot}){
  if(!assignment||assignment.state==='EMPTY')return <span>Empty slot</span>;
  const sourcePath=assignment.sourcePath;
  const byteCount=sourcePath&&Object.hasOwn(snapshot.files,sourcePath)?
    new TextEncoder().encode(snapshot.files[sourcePath]!).byteLength:null;
  return <div>
    <strong>{assignment.componentId??'Unknown pin'}</strong> · {assignment.state}
    <p>Content fields: {Object.keys(assignment.content).sort().join(', ')||'None'}</p>
    {sourcePath&&<p>Owned source: <code>{sourcePath}</code>{byteCount===null?' · bytes unavailable':' · '+byteCount+' bytes'}</p>}
    {assignment.content.asset_id&&<p>Private media reference retained; no publication or byte verification granted.</p>}
  </div>;
}

/** Private editor only. Structural comparison uses real pinned slot names;
 * this is not a simulated visitor render or a public preview. */

/** Only public, allowlisted catalogue pins are stored on this device.
 * No owner IDs, private versions, source, project IDs or auth data are persisted here. */
const PLACEMENT_PINS=[
  {pin:'title-stacked@1',label:'Heading',category:'Text'},
  {pin:'body-copy@1',label:'Paragraph',category:'Text'},
  {pin:'external-link@1',label:'External link',category:'Links'},
  {pin:'project-card@1',label:'Project summary',category:'Work'},
  {pin:'skills-list@1',label:'Skills list',category:'Work'},
  {pin:'experience-list@1',label:'Experience list',category:'Work'},
  {pin:'technology-tag@1',label:'Technology tag',category:'Text'},
  {pin:'author-metric@1',label:'Author metric',category:'Work'}
] as const;
/** The catalogue preview describes the actual pinned field shape. It never
 * invents author data, resolves private URLs, or executes component source. */
const PINNED_PREVIEW_CONTENT:Readonly<Record<string,Record<string,string>>>=Object.freeze({
  'title-stacked@1':{title:'Heading',subtitle:'Optional supporting text'},
  'body-copy@1':{text:'Your paragraph text'},
  'external-link@1':{label:'Link label'},
  'project-card@1':{title:'Project title',summary:'Project summary'},
  'skills-list@1':{items:'["Skill one","Skill two"]'},
  'experience-list@1':{items:'["Experience entry one","Experience entry two"]'},
  'technology-tag@1':{text:'Tag label'},
  'author-metric@1':{label:'Metric label',value:'Author-supplied value'}
});
function PinnedComponentPreview({pin}:{pin:string}){
  if(!PLACEMENT_PINS.some(item=>item.pin===pin)||!Object.hasOwn(PINNED_PREVIEW_CONTENT,pin))return null;
  const content=PINNED_PREVIEW_CONTENT[pin]!;
  const projection=slotProjection({state:'S0',componentId:pin,content});
  return <div role="group" aria-label="Illustrative pinned component preview">
    <p>Example field shape only · never inserted into your draft</p>
    {pin==='skills-list@1'||pin==='experience-list@1'?<ul>{projection.parts.map((part,index)=><li key={index}>{part}</li>)}</ul>:
      pin==='title-stacked@1'?<><h4>{projection.parts[0]}</h4><p>{projection.parts[1]}</p></>:
      pin==='project-card@1'?<article><strong>{projection.parts[0]}</strong><p>{projection.parts[1]}</p></article>:
      pin==='author-metric@1'?<dl><dt>{projection.parts[0]}</dt><dd>{projection.parts[1]}</dd></dl>:
      <p>{projection.parts[0]}</p>}
    <p>Fields shown: {Object.keys(content).join(', ')}{pin==='external-link@1'||pin==='project-card@1'?' · Validated HTTPS URL supported.':''}</p>
  </div>;
}
const PIN_FAVORITES_KEY='kadmeion.catalogue-favorites.v1';
function readPinnedFavorites(raw:string|null):string[]{
  if(!raw||raw.length>2048)return [];
  try{
    const parsed:unknown=JSON.parse(raw);
    if(!Array.isArray(parsed))return [];
    return PLACEMENT_PINS.map(item=>item.pin).filter(pin=>parsed.includes(pin));
  }catch{return [];}
}
// Shared in-memory fallback for this tab only. If storage reads work but
// writes fail (quota/policy), the next toggle must not resurrect stale disk IDs.
let transientPinnedFavorites:string[]|null=null;
function readDevicePinnedFavorites(storage:Pick<Storage,'getItem'>):{favorites:string[];available:boolean}{
  if(transientPinnedFavorites!==null)return {favorites:transientPinnedFavorites,available:false};
  try{return {favorites:readPinnedFavorites(storage.getItem(PIN_FAVORITES_KEY)),available:true};}
  catch{return {favorites:[],available:false};}
}
function writeDevicePinnedFavorites(storage:Pick<Storage,'setItem'>,next:string[]):boolean{
  try{
    storage.setItem(PIN_FAVORITES_KEY,JSON.stringify(next));
    transientPinnedFavorites=null;return true;
  }catch{transientPinnedFavorites=next;return false;}
}
/** Shared by the ordinary catalogue and fallback placement board. Only a
 * local device preference; no owner/session IDs, private versions or sync.
 * Same-tab event contains no user data; receive by re-reading allowlisted IDs. */
export function usePinnedCatalogueFavorites(){
  const [favorites,setFavorites]=useState<string[]>([]);
  const [storageAvailable,setStorageAvailable]=useState<boolean|null>(null);
  const eventName='kadmeion.catalogue-favorites-changed';
  // Accessing window.localStorage itself may throw, even before getItem.
  const storage={
    getItem:(key:string)=>window.localStorage.getItem(key),
    setItem:(key:string,value:string)=>window.localStorage.setItem(key,value)
  };
  function load(){
    const next=readDevicePinnedFavorites(storage);
    setFavorites(next.favorites);setStorageAvailable(next.available);
  }
  useEffect(()=>{
    function crossTab(event:StorageEvent){if(event.key===PIN_FAVORITES_KEY||event.key===null)load();}
    load();window.addEventListener('storage',crossTab);window.addEventListener(eventName,load);
    return()=>{window.removeEventListener('storage',crossTab);window.removeEventListener(eventName,load);};
  },[]);
  function toggle(id:string):boolean|null{
    if(!PLACEMENT_PINS.some(item=>item.pin===id))return null;
    const prior=readDevicePinnedFavorites(storage).favorites;
    const next=prior.includes(id)?prior.filter(value=>value!==id):[...prior,id];
    const saved=writeDevicePinnedFavorites(storage,next);
    setFavorites(next);setStorageAvailable(saved);
    window.dispatchEvent(new Event(eventName));
    return saved;
  }
  return {favorites,toggle,storageAvailable};
}
type PlacementAction=Extract<EditorIntent,{kind:'ASSIGN_COMPONENT'|'CLEAR_SLOT'|'MOVE_SECTION'|'MOVE_SECTION_BEFORE'}>;
type PlacementReview={head:EditorHead;key:string;pin?:string;kind:'replace'|'clear'};
type PlacementDrag={head:EditorHead;kind:'pin'|'section';id:string};
function placementRule(snapshot:PortfolioSnapshot,key:string,pin:string):'empty'|'replace'|'owned'|'same'|'incompatible'{
  if(!PLACEMENT_PINS.some(item=>item.pin===pin)||!Object.hasOwn(snapshot.slots,key)||
    !canAssignCompatibleComponent(snapshot,key,pin))return 'incompatible';
  const item=snapshot.slots[key]!;
  if(item.state==='EMPTY')return 'empty';
  if(item.state==='S1'||item.state==='S2')return 'owned';
  if(item.state!=='S0')return 'incompatible';
  return item.componentId===pin?'same':'replace';
}
/** Mirror the engine's no-op/unique-destination check; the transaction still
 * validates the whole current manifest and revision before changing anything. */
function canReorderBefore(ids:readonly string[],source:string,before:string|null):boolean{
  if(new Set(ids).size!==ids.length||!ids.includes(source)||source===before||
    (before!==null&&!ids.includes(before)))return false;
  const rest=ids.filter(id=>id!==source);
  const to=before===null?rest.length:rest.indexOf(before);
  rest.splice(to,0,source);
  return rest.some((id,index)=>id!==ids[index]);
}
/** This board is mounted by the existing LayoutTools owner-gated panel.
 * Every committed change delegates to the same typed editor transaction as
 * the canvas/keyboard controls, rather than writing project files itself. */
function PinnedPlacementBoard({head,blocked,apply}:{head:EditorHead;blocked:boolean;apply:(intent:PlacementAction)=>boolean}){
  const {favorites,toggle,storageAvailable}=usePinnedCatalogueFavorites();
  const [favoritesOnly,setFavoritesOnly]=useState(false);
  const [compatibleOnly,setCompatibleOnly]=useState(false);
  const [search,setSearch]=useState('');
  const [category,setCategory]=useState('All');
  const [pin,setPin]=useState('');
  const [target,setTarget]=useState('');
  const [orderSource,setOrderSource]=useState('');
  const [orderBefore,setOrderBefore]=useState('');
  const [review,setReview]=useState<PlacementReview|null>(null);
  const [dragging,setDragging]=useState<PlacementDrag|null>(null);
  const [message,setMessage]=useState('');
  const drag=useRef<PlacementDrag|null>(null);
  const running=useRef(false);
  const reviewHeading=useRef<HTMLHeadingElement>(null);
  const reviewTrigger=useRef<HTMLElement|null>(null);
  const hadReview=useRef(false);
  const boardSummary=useRef<HTMLElement>(null);
  const targetSelect=useRef<HTMLSelectElement>(null);
  useLayoutEffect(()=>{
    if(review)reviewHeading.current?.focus();
    else if(hadReview.current){
      const trigger=reviewTrigger.current;
      if(trigger?.isConnected&&!trigger.matches(':disabled'))trigger.focus();
      else if(targetSelect.current&&!targetSelect.current.disabled)targetSelect.current.focus();
      else boardSummary.current?.focus();
      reviewTrigger.current=null;
    }
    hadReview.current=!!review;
  },[review]);
  function cancelReview(){setReview(null);setMessage('Placement review cancelled; no transaction was submitted.');}
  const sections=canvasSections(head.snapshot);
  const ids=sections.map(section=>section.id);
  const targets=sections.flatMap(section=>section.slots.map(name=>({
    key:section.id+'-'+name.toLowerCase(),label:section.renderId+' · '+name+' ('+section.id+')'
  }))).filter((item,index,all)=>all.filter(row=>row.key===item.key).length===1&&Object.hasOwn(head.snapshot.slots,item.key));
  const chosen=targets.find(item=>item.key===target);
  const selectedRule=chosen&&pin?placementRule(head.snapshot,chosen.key,pin):'incompatible';
  const reviewed=review&&sameWorkingHead(review.head,head)?ownAssignment(head.snapshot,review.key):undefined;
  const visible=PLACEMENT_PINS.filter(item=>(!favoritesOnly||favorites.includes(item.pin))&&
    (!compatibleOnly||!!chosen&&placementRule(head.snapshot,chosen.key,item.pin)!=='incompatible')&&
    (category==='All'||category===item.category)&&
    (!search.trim()||[item.label,item.pin].some(value=>value.toLowerCase().includes(search.trim().toLowerCase()))));
  function toggleFavorite(id:string){
    const saved=toggle(id);
    if(saved!==null)setMessage(saved?'Device catalogue favorites updated.':'Favorites changed for this visit; device storage is unavailable.');
  }
  function submit(intent:PlacementAction,success:string){
    if(blocked||running.current)return false;
    running.current=true;
    try{
      const ok=apply(intent);
      setMessage(ok?success+' Save the draft to persist, or use Undo.':'No transaction was applied. Review the current draft and try again.');
      return ok;
    }catch{setMessage('The transaction could not be applied. No successful change is claimed.');return false;}
    finally{running.current=false;}
  }
  function place(selectedPin:string,key:string,trigger?:HTMLElement){
    if(blocked||review||!targets.some(item=>item.key===key))return;
    const rule=placementRule(head.snapshot,key,selectedPin);
    setTarget(key);setPin(selectedPin);setReview(null);
    if(rule==='empty')submit({kind:'ASSIGN_COMPONENT',slotKey:key,componentId:selectedPin},'Component added to the empty slot.');
    else if(rule==='replace'||rule==='owned'){
      reviewTrigger.current=trigger??targetSelect.current;
      setReview({head,key,pin:selectedPin,kind:'replace'});
    }
    else setMessage(rule==='same'?'This pristine component is already assigned.':'This component does not fit that slot. No change was made.');
  }
  function clear(trigger:HTMLElement){
    if(blocked||review||!chosen||!ownAssignment(head.snapshot,chosen.key)||ownAssignment(head.snapshot,chosen.key)?.state==='EMPTY')return;
    reviewTrigger.current=trigger;
    setReview({head,key:chosen.key,kind:'clear'});
  }
  function confirm(){
    if(blocked||!review||!reviewed||reviewed.state==='EMPTY')return;
    if(review.kind==='clear'){
      if(submit({kind:'CLEAR_SLOT',slotKey:review.key},'Assignment moved to Unplaced; the slot is empty.'))setReview(null);
      return;
    }
    if(!review.pin)return;
    const rule=placementRule(head.snapshot,review.key,review.pin);
    if(rule!=='replace'&&rule!=='owned')return;
    // Owned source replacement remains explicit, never a drop-only mutation.
    if(submit({kind:'ASSIGN_COMPONENT',slotKey:review.key,componentId:review.pin,
      preserveMatchingContent:true,confirmOwnedReplacement:rule==='owned'},'Replacement applied; outgoing assignment and source stashed.'))setReview(null);
  }
  function beginDrag(event:DragEvent<HTMLElement>,kind:PlacementDrag['kind'],id:string){
    if(blocked||review){event.preventDefault();return;}
    const item={head,kind,id};
    drag.current=item;setDragging(item);event.dataTransfer.effectAllowed='move';
    // The transfer is a marker only. Never deserialize a payload into an editor command.
    event.dataTransfer.setData('text/plain','kadmeion-editor-drag');
  }
  function finishDrag(){drag.current=null;setDragging(null);}
  function pinDrop(event:DragEvent<HTMLElement>,key:string){
    const item=drag.current;finishDrag();
    if(!item||item.kind!=='pin')return;
    event.preventDefault();event.stopPropagation();
    if(blocked||review||!sameWorkingHead(item.head,head))return;
    const rule=placementRule(head.snapshot,key,item.id);
    if(rule!=='empty'&&rule!=='replace'&&rule!=='owned'){
      setMessage('This live drag is not compatible with that target. No change was made.');return;
    }
    place(item.id,key);
  }
  function moveBefore(source:string,before:string|null){
    if(blocked||review||!canReorderBefore(ids,source,before))return false;
    const ok=submit({kind:'MOVE_SECTION_BEFORE',sectionId:source,beforeSectionId:before,expectedRevision:head.revision},
      'Section moved to the chosen position.');
    if(ok){setOrderSource('');setOrderBefore('');}
    return ok;
  }
  function sectionDrop(event:DragEvent<HTMLElement>,id:string|null){
    const item=drag.current;finishDrag();
    if(!item||item.kind!=='section'||!sameWorkingHead(item.head,head)||blocked||review)return;
    event.preventDefault();event.stopPropagation();
    if(!moveBefore(item.id,id))setMessage('Choose a different valid section position. No move was applied.');
  }
  function currentDrag():PlacementDrag|null{
    const item=drag.current;
    return item&&sameWorkingHead(item.head,head)&&!blocked&&!review?item:null;
  }
  const liveDrag=dragging&&sameWorkingHead(dragging.head,head)&&!blocked&&!review?dragging:null;
  // Keep the source and destination within the same visible row; moving
  // between independently scrollable lists must not scroll the source out
  // of the editor pane before the browser emits its first native dragstart.
  const pairedListStyle:CSSProperties={height:'12rem',maxHeight:'12rem',margin:0,overflow:'auto',overflowWrap:'anywhere',alignContent:'start'};
  return <details>
    <summary ref={boardSummary}>Component placement, Favorites and ordering</summary>
    <section aria-label="Pinned component placement" onKeyDown={event=>{
      if(event.key==='Escape'&&review){event.preventDefault();event.stopPropagation();cancelReview();}
    }}>
      <p>Drag a pinned block to a compatible slot below, or select a component and target using the keyboard. All changes use the private draft transaction.</p>
      <label>Search placement library<input type="search" maxLength={120} value={search} onChange={event=>setSearch(event.target.value)}/></label>
      <label>Placement category<select aria-label="Placement category" value={category} onChange={event=>setCategory(event.target.value)}>
        {['All','Text','Links','Work'].map(value=><option key={value}>{value}</option>)}
      </select></label>
      <label><input type="checkbox" checked={favoritesOnly} onChange={event=>setFavoritesOnly(event.target.checked)}/> Device favorites only</label>
      <label><input type="checkbox" checked={compatibleOnly} disabled={!chosen}
        onChange={event=>setCompatibleOnly(event.target.checked)}/> Compatible with selected placement target only</label>
      {compatibleOnly&&!chosen&&<p role="status">Choose a placement target or clear the filters.</p>}
      <p>Favorites contain only public pinned component IDs on this device; they are not account-synced.{storageAvailable===false?' Device storage is unavailable; changes may last only for this visit.':''}</p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:8,alignItems:'start'}} role="group" aria-label="Component placement drag workspace">
        <div style={{minWidth:0}}><h4>Components</h4>
      <ul className="ws-editor-slots" aria-label="Pinned component drag sources" style={pairedListStyle}>{visible.map(item=><li key={item.pin}>
        <button type="button" aria-pressed={pin===item.pin} draggable={!blocked&&!review}
          disabled={blocked||!!review} onClick={()=>{setPin(item.pin);}}
          onDragStart={event=>beginDrag(event,'pin',item.pin)} onDragEnd={finishDrag}>
          {item.label} · {item.pin}
        </button>
        <button type="button" aria-pressed={favorites.includes(item.pin)} onClick={()=>toggleFavorite(item.pin)}>
          {favorites.includes(item.pin)?'Remove favorite':'Favorite'} · {item.label}
        </button>
      </li>)}</ul>
        </div>
        <div style={{minWidth:0}}><h4>Declared slots</h4>
      <ul className="ws-editor-slots" aria-label="Declared component drop targets" style={pairedListStyle}>{targets.map(item=>{
        const rule=liveDrag?.kind==='pin'?placementRule(head.snapshot,item.key,liveDrag.id):null;
        const fit=rule==='empty'||rule==='replace'||rule==='owned';
        return <li key={item.key} data-drop-fit={fit?'compatible':undefined}
          style={fit?{outline:'2px dashed currentColor',outlineOffset:'2px'}:undefined}
          onDragOver={event=>{const current=currentDrag();if(current?.kind==='pin'){
            const rule=placementRule(head.snapshot,item.key,current.id);
            event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=rule==='empty'||rule==='replace'||rule==='owned'?'move':'none';
          }}}
          onDrop={event=>pinDrop(event,item.key)}>
          <button type="button" aria-pressed={target===item.key} disabled={blocked||!!review}
            onClick={()=>{setTarget(item.key);}}>{item.label} · {head.snapshot.slots[item.key]?.state==='EMPTY'?'EMPTY':head.snapshot.slots[item.key]?.state}</button>
        </li>;
      })}</ul>
        </div>
      </div>
      {!targets.length&&<p>No unambiguous declared placement targets. Add a section or review the current manifest.</p>}
      {!visible.length&&<p>No pinned blocks match these filters.</p>}
      {(search||category!=='All'||favoritesOnly||compatibleOnly)&&
        <button type="button" className="ws-secondary" onClick={()=>{setSearch('');setCategory('All');setFavoritesOnly(false);setCompatibleOnly(false);}}>Clear placement filters</button>}
      {pin&&<PinnedComponentPreview pin={pin}/>}
      <label>Placement target<select ref={targetSelect} aria-label="Placement target" value={chosen?.key??''} disabled={blocked||!!review}
        onChange={event=>{setTarget(event.target.value);}}>
        <option value="">Choose a slot</option>{targets.map(item=><option key={item.key} value={item.key}>{item.label} · {head.snapshot.slots[item.key]?.state}</option>)}
      </select></label>
      <button type="button" className="ws-primary" disabled={blocked||!!review||!chosen||!pin||selectedRule==='incompatible'||selectedRule==='same'}
        onClick={event=>chosen&&place(pin,chosen.key,event.currentTarget)}>Place selected pinned block</button>
      <button type="button" className="ws-secondary" disabled={blocked||!!review||!chosen||head.snapshot.slots[chosen.key]?.state==='EMPTY'}
        onClick={event=>clear(event.currentTarget)}>Move selected assignment to Unplaced</button>
      <p>{chosen&&pin?(selectedRule==='incompatible'?'Incompatible target.':selectedRule==='owned'?'Protected owned source needs explicit review.':selectedRule==='same'?'Already assigned.':'Compatible target.'):'Choose a component and slot.'}</p>
      {review&&<section aria-label="Pinned placement impact">
        <h4 ref={reviewHeading} tabIndex={-1}>Review placement impact</h4>
        {!reviewed?<p role="alert">The working revision changed. Cancel this review; no assignment was changed.</p>:<>
          <AssignmentImpact assignment={reviewed} snapshot={review.head.snapshot}/>
          <p>{review.kind==='clear'?'The complete assignment is stashed and the target becomes EMPTY.':'The entire outgoing assignment is stashed. Matching declared fields only may be retained.'}</p>
          {review.kind==='replace'&&review.pin&&<p>Matching fields: {Object.keys(matchingReplacementContent(reviewed,review.pin)).join(', ')||'None'}</p>}
          {ownedAssignment(reviewed)&&<p>Protected owned source is retained, not executed or rewritten. To save it for reuse first, cancel, select this slot in the layers tree, and open My Components.</p>}
          <button type="button" className="ws-primary" disabled={blocked} onClick={confirm}>
            {review.kind==='clear'?'Confirm move to Unplaced':'Confirm replace and stash'}
          </button>
        </>}
        <button type="button" className="ws-secondary" onClick={cancelReview}>Cancel placement review</button>
      </section>}
    </section>
    <section aria-label="Section ordering controls">
      <h3>Section order</h3>
      <p>Drop a section before another section or at the end. Keyboard controls offer the same destinations. Each move is one transaction.</p>
      <label>Section to move<select value={orderSource} disabled={blocked||!!review}
        onChange={event=>{setOrderSource(event.target.value);setOrderBefore('');}}>
        <option value="">Choose a section</option>{sections.map(section=><option key={section.id} value={section.id}>{section.renderId} · {section.id}</option>)}
      </select></label>
      <label>Move before<select value={orderBefore} disabled={blocked||!!review||!ids.includes(orderSource)}
        onChange={event=>setOrderBefore(event.target.value)}>
        <option value="">Choose destination</option>{sections.filter(section=>canReorderBefore(ids,orderSource,section.id)).map(section=>
          <option key={section.id} value={section.id}>{section.renderId} · {section.id}</option>)}
        {canReorderBefore(ids,orderSource,null)&&<option value=":end">End of page</option>}
      </select></label>
      <button type="button" className="ws-primary"
        disabled={blocked||!!review||!orderBefore||!canReorderBefore(ids,orderSource,orderBefore===':end'?null:orderBefore)}
        onClick={()=>moveBefore(orderSource,orderBefore===':end'?null:orderBefore)}>Move section to chosen position</button>
      <ol>{sections.map((section,index)=><li key={section.id}
        data-drop-fit={liveDrag?.kind==='section'&&canReorderBefore(ids,liveDrag.id,section.id)?'compatible':undefined}
        style={liveDrag?.kind==='section'&&canReorderBefore(ids,liveDrag.id,section.id)?DROP_OUTLINE:undefined}
        onDragOver={event=>{const current=currentDrag();if(current?.kind==='section'){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=canReorderBefore(ids,current.id,section.id)?'move':'none';}}}
        onDrop={event=>sectionDrop(event,section.id)}>
        <span draggable={!blocked&&!review} onDragStart={event=>beginDrag(event,'section',section.id)}
          onDragEnd={finishDrag}>{section.renderId} · {section.id}</span>{' '}
        <button type="button" disabled={blocked||index===0||!!review}
          aria-label={'Move '+section.id+' one position up'} onClick={()=>submit({kind:'MOVE_SECTION',sectionId:section.id,direction:'up'},'Section reordered by one position.')}>Up</button>
        <button type="button" disabled={blocked||index===sections.length-1||!!review}
          aria-label={'Move '+section.id+' one position down'} onClick={()=>submit({kind:'MOVE_SECTION',sectionId:section.id,direction:'down'},'Section reordered by one position.')}>Down</button>
      </li>)}{ids.length>1&&new Set(ids).size===ids.length&&
        <li data-drop-fit={liveDrag?.kind==='section'&&canReorderBefore(ids,liveDrag.id,null)?'compatible':undefined}
          style={liveDrag?.kind==='section'&&canReorderBefore(ids,liveDrag.id,null)?DROP_OUTLINE:{minHeight:36}}
          onDragOver={event=>{const current=currentDrag();if(current?.kind==='section'){
            event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=canReorderBefore(ids,current.id,null)?'move':'none';
          }}}
          onDrop={event=>sectionDrop(event,null)}>Drop at end of page</li>}</ol>
    </section>
    {message&&<p role="status">{message}</p>}
  </details>;
}

/** Only a compatibility projection for an uncommitted, proposed manifest.
 * No draft files are written. The authoritative planner still checks the
 * complete mapping, quota, collisions, and provenance on confirmation. */
function proposedLayoutTargets(snapshot:PortfolioSnapshot,sectionId:string,layout:string):PortfolioSnapshot|null{
  const manifest=portfolioLayout(layout);
  if(!manifest)return null;
  const slots:PortfolioSnapshot['slots']={};
  for(const name of manifest.slots){
    const key=layoutSlotKey(sectionId,name);
    if(!usableLayoutKey(key)||Object.hasOwn(slots,key))return null;
    slots[key]={state:'EMPTY',content:{}};
  }
  return {...snapshot,slots,files:{...snapshot.files,'pages/home.page.json':JSON.stringify({sections:[{id:sectionId,layout}]})}};
}
function transferFits(snapshot:PortfolioSnapshot,from:string,to:string,assignment:Assignment|undefined):boolean{
  if(!assignment||assignment.state==='EMPTY'||typeof assignment.componentId!=='string')return false;
  if(from!==to&&ownedAssignment(assignment)&&(!assignment.sourcePath?.endsWith('.tsx')||!Object.hasOwn(snapshot.files,assignment.sourcePath)))return false;
  return assignment.componentId==='image@1'?
    assignment.state==='S0'&&canPlacePrivateImage(snapshot,to):
    canAssignCompatibleComponent(snapshot,to,assignment.componentId);
}
export function LayoutTools({head,sectionId,blocked,planLayout,applyLayout}:LayoutToolsProps){
  const [draft,setDraft]=useState<MappingDraft|null>(null);
  const [review,setReview]=useState<MappingReview|null>(null);
  const [confirmStash,setConfirmStash]=useState(false);
  const [confirmRelocation,setConfirmRelocation]=useState(false);
  const [restore,setRestore]=useState<RestoreDraft|null>(null);
  const [restoreReviewed,setRestoreReviewed]=useState(false);
  const [restoreRelocation,setRestoreRelocation]=useState(false);
  const [message,setMessage]=useState('');
  const targetSelect=useRef<HTMLSelectElement>(null);
  const stashSelect=useRef<HTMLSelectElement>(null);
  const layoutTitle=useRef<HTMLHeadingElement>(null);
  const unplacedTitle=useRef<HTMLHeadingElement>(null);
  const planButton=useRef<HTMLButtonElement>(null);
  const restoreButton=useRef<HTMLButtonElement>(null);
  const reviewTitle=useRef<HTMLHeadingElement>(null);
  const restoreTitle=useRef<HTMLHeadingElement>(null);
  const submitting=useRef(false);
  const mappingDrag=useRef<{draft:MappingDraft;key:string}|null>(null);
  const [mappingFrom,setMappingFrom]=useState<string|null>(null);
  const sections=canvasSections(head.snapshot);
  const matchingSections=sections.filter(section=>section.id===sectionId);
  const section=matchingSections.length===1?matchingSections[0]:undefined;
  const draftCurrent=!!draft&&!!section&&draft.sectionId===sectionId&&
    draft.expectedLayout===section.layout&&sameWorkingHead(draft.head,head);
  const sourceSection=draft?canvasSections(draft.head.snapshot).find(item=>item.id===draft.sectionId):undefined;
  const sourceSlots=sourceSection?sourceSection.slots.map(name=>({name,key:layoutSlotKey(sourceSection.id,name)})):[];
  const targetManifest=draft?portfolioLayout(draft.targetLayout):undefined;
  const proposedTargets=draft?proposedLayoutTargets(draft.head.snapshot,draft.sectionId,draft.targetLayout):null;
  const targetSlots=draft?(targetManifest?.slots??[]).
    map(name=>({name,key:layoutSlotKey(draft.sectionId,name),required:targetManifest?.required.includes(name)===true})):[];
  const assignedKeys=sourceSlots.filter(item=>{
    const assignment=draft&&ownAssignment(draft.head.snapshot,item.key);
    return !!assignment&&assignment.state!=='EMPTY';
  }).map(item=>item.key);
  const mappings=draft?explicitLayoutMappings(assignedKeys,targetSlots.map(item=>item.key),draft.choices):null;
  const requiredUnfilled=targetSlots.filter(item=>item.required&&
    !assignedKeys.some(key=>draft?.choices[key]===item.key));
  const reviewCurrent=!!review&&draftCurrent&&review.draft===draft;
  const emptyTargets=sections.flatMap(item=>item.slots.map(name=>({
    key:layoutSlotKey(item.id,name),label:item.renderId+' · '+name+' ('+item.id+')'
  }))).filter((item,index,all)=>usableLayoutKey(item.key)&&
    all.filter(other=>other.key===item.key).length===1&&
    ownAssignment(head.snapshot,item.key)?.state==='EMPTY');
  // Include historical keys that no longer exist in the active layout.
  const entries=Object.entries(head.snapshot.stashes).filter(([key])=>usableLayoutKey(key)).
    flatMap(([key,items])=>items.flatMap((assignment,index)=>assignment.state==='EMPTY'?[]:
      [{key,index,assignment,token:key+':'+index}]));
  const restoreCurrent=!!restore&&sameWorkingHead(restore.head,head);
  const restoration=restoreCurrent&&restore?entries.find(item=>item.key===restore.fromSlotKey&&
    item.index===restore.stashIndex):undefined;
  const compatibleRestoreTargets=restore&&restoration?emptyTargets.filter(item=>transferFits(head.snapshot,restore.fromSlotKey,item.key,restoration.assignment)):[];
  const restoreTarget=restoreCurrent&&restore?compatibleRestoreTargets.find(item=>item.key===restore.toSlotKey):undefined;
  const restoreMovesOwned=!!restoration&&!!restore&&restore.fromSlotKey!==restore.toSlotKey&&
    ownedAssignment(restoration.assignment);
  const restoreLegacy=restoreMovesOwned&&!restoration?.assignment.sourcePath?.endsWith('.tsx');
  const restoreSelectionRef=useRef<RestoreDraft|null>(null);

  useLayoutEffect(()=>{if(review)reviewTitle.current?.focus();},[review]);
  useLayoutEffect(()=>{if(restoreReviewed)restoreTitle.current?.focus();},[restoreReviewed]);
  useLayoutEffect(()=>{
    if(restoreSelectionRef.current&&!restore&&!stashSelect.current)unplacedTitle.current?.focus();
    restoreSelectionRef.current=restore;
  },[restore]);

  function mappingDestinationAllowed(from:string,to:string){
    return !!draft&&draftCurrent&&!blocked&&!review&&assignedKeys.includes(from)&&
      (to===C10_STASH||(!!proposedTargets&&targetSlots.some(item=>item.key===to)&&
        transferFits(proposedTargets,from,to,ownAssignment(draft.head.snapshot,from))&&
        !assignedKeys.some(other=>other!==from&&draft.choices[other]===to)));
  }
  function startMappingDrag(event:DragEvent<HTMLElement>,key:string){
    if(!draft||!draftCurrent||blocked||review||!assignedKeys.includes(key)){event.preventDefault();return;}
    mappingDrag.current={draft,key};setMappingFrom(key);
    event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain','kadmeion-layout-map');
  }
  function endMappingDrag(){mappingDrag.current=null;setMappingFrom(null);}
  function mappingDragOver(event:DragEvent<HTMLElement>,to:string){
    const item=mappingDrag.current;
    if(!item||item.draft!==draft||!mappingDestinationAllowed(item.key,to))return;
    event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';
  }
  function mappingDrop(event:DragEvent<HTMLElement>,to:string){
    const item=mappingDrag.current;endMappingDrag();
    if(!item||item.draft!==draft||!mappingDestinationAllowed(item.key,to))return;
    event.preventDefault();event.stopPropagation();chooseDestination(item.key,to);
  }
  function resetReview(focus=false){
    setReview(null);setConfirmStash(false);setConfirmRelocation(false);
    if(focus)planButton.current?.focus();
  }
  function cancelMapping(){
    endMappingDrag();resetReview();setDraft(null);setMessage('Layout change cancelled; no transaction was submitted.');
    if(targetSelect.current)targetSelect.current.focus();else layoutTitle.current?.focus();
  }
  function beginMapping(targetLayout:string){
    if(blocked||!section||!portfolioLayout(targetLayout)||section.layout===targetLayout)return;
    endMappingDrag();resetReview();setMessage('');
    setDraft({head,sectionId:section.id,expectedLayout:section.layout,targetLayout,choices:{}});
  }
  function chooseDestination(from:string,to:string){
    if(blocked||review||!draftCurrent||!draft||!assignedKeys.includes(from)||(to!==''&&!mappingDestinationAllowed(from,to)))return;
    resetReview();setMessage('');
    setDraft({...draft,choices:{...draft.choices,[from]:to}});
  }
  function reviewMapping(){
    if(blocked||!draftCurrent||!draft||!mappings||submitting.current)return;
    endMappingDrag();resetReview();setMessage('');
    const request={sectionId:draft.sectionId,expectedLayout:draft.expectedLayout,
      targetLayout:draft.targetLayout,mappings};
    try{
      const flags=planLayout(draft.head,request);
      if(typeof flags.requiresStashConfirmation!=='boolean'||typeof flags.requiresOwnedRelocationConfirmation!=='boolean'){
        setMessage('The authoritative layout plan is unavailable. No change was applied.');return;
      }
      if((flags.expectedRevision!==undefined&&flags.expectedRevision!==draft.head.revision)||
        (flags.sectionId!==undefined&&flags.sectionId!==request.sectionId)||
        (flags.expectedLayout!==undefined&&flags.expectedLayout!==request.expectedLayout)||
        (flags.targetLayout!==undefined&&flags.targetLayout!==request.targetLayout)||
        (flags.rows!==undefined&&(flags.rows.length!==request.mappings.length||
          flags.rows.some((row,index)=>row.fromSlotKey!==request.mappings[index]?.fromSlotKey||
            row.toSlotKey!==request.mappings[index]?.toSlotKey)))){
        setMessage('The authoritative layout plan no longer matches the requested mapping. No change was applied.');return;
      }
      setReview({draft,request,flags});
    }catch{
      setMessage('This mapping was rejected by the layout planner. Check compatible targets, owned source relocation, and stash limits. No change was applied.');
    }
  }
  function commitMapping(){
    if(blocked||!reviewCurrent||!review||submitting.current||
      (review.flags.requiresStashConfirmation&&!confirmStash)||
      (review.flags.requiresOwnedRelocationConfirmation&&!confirmRelocation))return;
    submitting.current=true;
    try{
      const ok=applyLayout({kind:'CHANGE_SECTION_LAYOUT',...review.request,
        expectedRevision:review.draft.head.revision,confirmStash,confirmOwnedRelocation:confirmRelocation});
      if(ok){setDraft(null);resetReview();setMessage('Layout transaction applied to the working draft. Save to persist, or use Undo.');targetSelect.current?.focus();}
      else{resetReview();setMessage('Layout transaction was not applied. Review the current draft again.');planButton.current?.focus();}
    }catch{resetReview();setMessage('Layout transaction could not be confirmed. Review the current draft before retrying.');}
    finally{submitting.current=false;}
  }
  function cancelRestore(){
    setRestore(null);setRestoreReviewed(false);setRestoreRelocation(false);
    setMessage('Restore cancelled; no transaction was submitted.');
    if(stashSelect.current)stashSelect.current.focus();else unplacedTitle.current?.focus();
  }
  function selectStash(token:string){
    if(blocked)return;
    const item=entries.find(entry=>entry.token===token);
    setRestoreReviewed(false);setRestoreRelocation(false);setMessage('');
    setRestore(item?{head,fromSlotKey:item.key,stashIndex:item.index,toSlotKey:''}:null);
  }
  function reviewRestore(){
    if(blocked||!restoreCurrent||!restoration||!restoreTarget||restoreLegacy)return;
    setRestoreRelocation(false);setRestoreReviewed(true);setMessage('');
  }
  function commitRestore(){
    if(blocked||submitting.current||!restoreCurrent||!restoreReviewed||!restore||
      !restoration||!restoreTarget||restoreLegacy||(restoreMovesOwned&&!restoreRelocation))return;
    submitting.current=true;
    try{
      const ok=applyLayout({kind:'RESTORE_LAYOUT_STASH',fromSlotKey:restore.fromSlotKey,
        stashIndex:restore.stashIndex,toSlotKey:restore.toSlotKey,expectedRevision:restore.head.revision,
        confirmOwnedRelocation:restoreRelocation});
      if(ok){setRestore(null);setMessage('Stashed assignment restored to the working draft. Save to persist, or use Undo.');stashSelect.current?.focus();}
      else setMessage('Restore was rejected. Check target compatibility or source restrictions; no successful restore is claimed.');
    }catch{setMessage('Restore could not be confirmed. Review the current draft before retrying.');}
    finally{setRestoreReviewed(false);setRestoreRelocation(false);submitting.current=false;}
  }

  return <div className="ws-editor-tool">
    <h2>Layout mapping and Unplaced</h2>
    <PinnedPlacementBoard head={head} blocked={blocked||!!draft||!!restore} apply={applyLayout}/>
    {blocked&&<p role="status">Resolve pending edits, saves or recovery before changing the layout or restoring a stash.</p>}
    {message&&<p role="status">{message}</p>}
    <section aria-label="Change section layout">
      <h3 ref={layoutTitle} tabIndex={-1}>Change section layout</h3>
      {!section?<p>Choose an actual section in the layers tree to change its layout.</p>:<>
        <p>Current: {layoutLabel(section.layout)}. Choose a different pinned layout, then map each filled slot.</p>
        <label>Target layout<select ref={targetSelect} disabled={blocked}
          value={draftCurrent&&draft?draft.targetLayout:''} onChange={event=>{
            if(event.target.value)beginMapping(event.target.value);else cancelMapping();
          }}>
          <option value="">Choose a layout</option>
          {C10_LAYOUT_PINS.filter(pin=>pin!==section.layout&&!!portfolioLayout(pin)).map(pin=>
            <option key={pin} value={pin}>{layoutLabel(pin)}</option>)}
        </select></label>
      </>}
      {draft&&!draftCurrent&&<><p role="alert">The section or working revision changed. This mapping is stale; cancel and start a new review.</p>
        <button type="button" className="ws-secondary" onClick={cancelMapping}>Cancel layout mapping</button></>}
      {draft&&draftCurrent&&<div onKeyDown={event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(review)resetReview(true);else cancelMapping();}
      }}>
        <div className="ws-layout-comparison" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%, 220px),1fr))',gap:'1rem'}}>
          <section aria-label="Current layout"><h4>Current · {layoutLabel(draft.expectedLayout)}</h4>
            <ol>{sourceSlots.map(item=><li key={item.key}>
              <strong>{item.name}</strong>
              {assignedKeys.includes(item.key)&&<button type="button" className="ws-secondary"
                draggable={!blocked&&!review} disabled={blocked} onDragStart={event=>startMappingDrag(event,item.key)}
                onDragEnd={endMappingDrag} onClick={()=>{
                  const select=document.getElementById('kd-map-'+item.key);if(select instanceof HTMLSelectElement)select.focus();
                }}>Drag or choose destination for {item.name}</button>}
              <AssignmentImpact assignment={ownAssignment(draft.head.snapshot,item.key)} snapshot={draft.head.snapshot}/>
            </li>)}</ol>
          </section>
          <section aria-label="Proposed layout"><h4>Proposed · {layoutLabel(draft.targetLayout)}</h4>
            <ol>{targetSlots.map(item=>{
              const candidates=assignedKeys.filter(key=>draft.choices[key]===item.key);
              return <li key={item.key}
                data-drop-fit={mappingFrom&&mappingDestinationAllowed(mappingFrom,item.key)?'compatible':undefined}
                style={mappingFrom&&mappingDestinationAllowed(mappingFrom,item.key)?DROP_OUTLINE:undefined}
                onDragOver={event=>mappingDragOver(event,item.key)} onDrop={event=>mappingDrop(event,item.key)}>
                <strong>{item.name}{item.required?' · Required for release':''}</strong>
                {candidates.length===1?<AssignmentImpact assignment={ownAssignment(draft.head.snapshot,candidates[0]!)} snapshot={draft.head.snapshot}/>:
                  <p>{candidates.length?'Mapping conflict':'No assignment mapped; will be empty'}</p>}
              </li>;
            })}</ol>
          </section>
        </div>
        <div role="group" aria-label="Map outgoing assignment to Unplaced"
          data-drop-fit={mappingFrom&&mappingDestinationAllowed(mappingFrom,C10_STASH)?'compatible':undefined}
          style={mappingFrom&&mappingDestinationAllowed(mappingFrom,C10_STASH)?DROP_OUTLINE:undefined}
          onDragOver={event=>mappingDragOver(event,C10_STASH)} onDrop={event=>mappingDrop(event,C10_STASH)}>
          Drop assignment here to preserve it in Unplaced
        </div>
        <p>Drag and keyboard destination controls revise this proposed mapping only. The authoritative planner validates compatibility before any transaction.</p>
        {requiredUnfilled.length>0&&<p role="status">Required target slots not yet mapped: {requiredUnfilled.map(item=>item.name).join(', ')}. A draft may retain empty slots, but release needs separate preflight.</p>}
        <p>Slot structure comparison only. Responsive appearance and static export must be checked after the layout transaction; no source is executed here.</p>
        <fieldset disabled={blocked||!!review}>
          <legend>Map outgoing assignments</legend>
          {assignedKeys.length===0&&<p>No filled slots to map. The new layout starts empty.</p>}
          {assignedKeys.map(key=>{
            const assignment=ownAssignment(draft.head.snapshot,key);
            const choice=draft.choices[key]??'';
            return <div key={key}>
              <label>Destination for {key}<select id={'kd-map-'+key} aria-label={'Destination for '+key} value={choice} onChange={event=>chooseDestination(key,event.target.value)}>
                <option value="">Choose a destination</option>
                <option value={C10_STASH}>Unplaced — stash complete assignment</option>
                {targetSlots.map(item=><option key={item.key} value={item.key}
                  disabled={!proposedTargets||!transferFits(proposedTargets,key,item.key,assignment)||assignedKeys.some(other=>other!==key&&draft.choices[other]===item.key)}>{item.name} ({item.key})</option>)}
              </select></label>
              {choice&&choice!==C10_STASH&&choice!==key&&ownedAssignment(assignment)&&
                <p>Cross-slot owned source: requires explicit relocation. Legacy CSS and unsupported source cannot be moved.</p>}
            </div>;
          })}
        </fieldset>
        <button ref={planButton} type="button" className="ws-secondary" disabled={blocked||!mappings}
          onClick={reviewMapping}>Review layout impact</button>
        <button type="button" className="ws-secondary" onClick={cancelMapping}>Cancel layout mapping</button>
        {review&&reviewCurrent&&<section aria-label="Layout change confirmation">
          <h4 ref={reviewTitle} tabIndex={-1}>Confirm layout transformation</h4>
          <p>Validated working revision {review.draft.head.revision}. {review.request.mappings.filter(row=>row.toSlotKey===null).length} assignments marked Unplaced.</p>
          <ul>{review.request.mappings.map((row,index)=>{
            const detail=review.flags.rows?.[index];
            return <li key={row.fromSlotKey}>
              {row.fromSlotKey} → {row.toSlotKey??'Unplaced (full assignment)'}
              {detail&&<span> · {detail.disposition} · {detail.componentId} ({detail.state})</span>}
              {detail&&<p>Retained fields: {detail.fields.join(', ')||'None'}</p>}
              {detail?.sourcePath&&<p>Original source: <code>{detail.sourcePath}</code>{detail.sourceBytes===undefined?'':' · '+detail.sourceBytes+' bytes'}</p>}
              {row.toSlotKey&&row.toSlotKey!==row.fromSlotKey&&ownedAssignment(ownAssignment(review.draft.head.snapshot,row.fromSlotKey))?
                <span> · Original owned file and outgoing assignment retained; new operation-specific file required</span>:null}
            </li>;
          })}</ul>
          {review.flags.addedFiles!==undefined&&review.flags.addedStashAssignments!==undefined&&
            <p>Planner impact: {review.flags.addedFiles} additional owned files; {review.flags.addedStashAssignments} additional stash assignments.</p>}
          {review.flags.emptyTargetKeys!==undefined&&
            <p>Empty targets after change: {review.flags.emptyTargetKeys.join(', ')||'None'}.</p>}
          {review.flags.requiresStashConfirmation&&<label><input type="checkbox" checked={confirmStash}
            disabled={blocked} onChange={event=>setConfirmStash(event.target.checked)}/> Confirm preservation of outgoing assignments in Unplaced</label>}
          {review.flags.requiresOwnedRelocationConfirmation&&<>
            <p>The engine copies compatible owned TSX to a new operation-specific slot path and retains the original source and provenance. Relative imports may no longer resolve; no imports are rewritten.</p>
            <label><input type="checkbox" checked={confirmRelocation} disabled={blocked}
              onChange={event=>setConfirmRelocation(event.target.checked)}/> Confirm explicit owned-source relocation</label>
          </>}
          <button type="button" className="ws-primary" disabled={blocked||
            (review.flags.requiresStashConfirmation&&!confirmStash)||
            (review.flags.requiresOwnedRelocationConfirmation&&!confirmRelocation)} onClick={commitMapping}>Confirm layout change</button>
          <button type="button" className="ws-secondary" onClick={()=>resetReview(true)}>Back to mapping</button>
        </section>}
      </div>}
    </section>
    <section aria-label="Global Unplaced assignments" onKeyDown={event=>{
      if(event.key==='Escape'&&restore){event.preventDefault();event.stopPropagation();cancelRestore();}
    }}>
      <h3 ref={unplacedTitle} tabIndex={-1}>Unplaced assignments</h3>
      <p role="status">{entries.length} stashed assignments across current and previous layouts.</p>
      {!entries.length?<p>No stashed assignments.</p>:<>
        <label>Stashed assignment<select ref={stashSelect} disabled={blocked} value={restoreCurrent&&restore?
          restore.fromSlotKey+':'+restore.stashIndex:''} onChange={event=>selectStash(event.target.value)}>
          <option value="">Choose a stashed assignment</option>
          {entries.map(item=><option key={item.token} value={item.token}>
            {item.key} · #{item.index+1} · {item.assignment.componentId??'Unknown pin'} · {item.assignment.state}
          </option>)}
        </select></label>
      </>}
      {restore&&!restoreCurrent&&<><p role="alert">The stash changed with the working revision. Cancel and select the saved assignment again.</p>
        <button type="button" className="ws-secondary" onClick={cancelRestore}>Cancel restore</button></>}
      {restore&&restoration&&restoreCurrent&&<>
        <AssignmentImpact assignment={restoration.assignment} snapshot={head.snapshot}/>
        <label>Restore to empty slot<select disabled={blocked} value={restore.toSlotKey} onChange={event=>{
          setRestore({...restore,toSlotKey:event.target.value});setRestoreReviewed(false);setRestoreRelocation(false);setMessage('');
        }}>
          <option value="">Choose an empty slot</option>
          {compatibleRestoreTargets.map(item=><option key={item.key} value={item.key}>{item.label}</option>)}
        </select></label>
        {!compatibleRestoreTargets.length&&<p>No compatible empty declared slot. Clear or add a compatible slot first; this stashed assignment is preserved.</p>}
        <p>Only compatible declared empty slots are offered. The transaction engine repeats compatibility and source restrictions before restoring.</p>
        {restoreLegacy&&<p role="alert">Cross-slot relocation of this legacy or unsupported source is not available. Restore to its original compatible slot instead.</p>}
        <button ref={restoreButton} type="button" className="ws-secondary" disabled={blocked||!restoreTarget||restoreLegacy} onClick={reviewRestore}>Review restore impact</button>
        <button type="button" className="ws-secondary" onClick={cancelRestore}>Cancel restore</button>
        {restoreReviewed&&restoreTarget&&<section aria-label="Stash restore confirmation">
          <h4 ref={restoreTitle} tabIndex={-1}>Confirm stash restore</h4>
          <p>Restore {restore.fromSlotKey} assignment #{restore.stashIndex+1} to {restoreTarget.label}. Other stash entries remain intact; no source runs.</p>
          {restoreMovesOwned&&<><p>Owned TSX relocation retains original bytes and provenance; relative imports may stop resolving.</p>
            <label><input type="checkbox" disabled={blocked} checked={restoreRelocation}
              onChange={event=>setRestoreRelocation(event.target.checked)}/> Confirm explicit owned-source relocation</label></>}
          <button type="button" className="ws-primary" disabled={blocked||(restoreMovesOwned&&!restoreRelocation)}
            onClick={commitRestore}>Confirm restore</button>
          <button type="button" className="ws-secondary" onClick={()=>{setRestoreReviewed(false);setRestoreRelocation(false);restoreButton.current?.focus();}}>Back to restore selection</button>
        </section>}
      </>}
    </section>
  </div>;
}


/** Explicit owner-only preview. The port checks actual server registration,
 * Storage identity, pin and bytes. This UI never promotes a local digest to a publication pin. */
type AssetPreviewRecord={id:string;projectId:string;mime:string;size:number;altText:string};
function OwnerAssetBytesPreview({port,asset,epoch}:{port:SupabaseBrowserAuthPort;asset:AssetPreviewRecord;epoch:number}){
  const [state,setState]=useState<{status:'idle'|'pending'|'failed'}|{status:'ready';url:string;pinned:boolean}>({status:'idle'});
  const mounted=useRef(false);
  const activeUrl=useRef<string|null>(null);
  const flight=useRef(false);
  const generation=useRef(0);
  function release(){
    if(activeUrl.current){URL.revokeObjectURL(activeUrl.current);activeUrl.current=null;}
  }
  useLayoutEffect(()=>{
    mounted.current=true;++generation.current;flight.current=false;release();setState({status:'idle'});
    const unsubscribe=port.subscribeOwnerSessionEpoch(()=>{
      mounted.current=false;++generation.current;flight.current=false;release();setState({status:'failed'});
    });
    return()=>{mounted.current=false;++generation.current;flight.current=false;unsubscribe();release();};
  },[port,epoch]);
  async function load(){
    if(flight.current||!mounted.current||port.reconcileOwnerSessionEpoch()!==epoch)return;
    const started=++generation.current;
    const live=()=>mounted.current&&generation.current===started&&port.reconcileOwnerSessionEpoch()===epoch;
    flight.current=true;release();setState({status:'pending'});
    try{
      const reply=await port.readOwnerPrivateAsset(asset.projectId,asset.id,epoch);
      if(!live())return;
      const data=reply.data;
      if(reply.error||!validOwnerPreview(asset,data)){
        setState({status:'failed'});return;
      }
      const verified=await matchesPreviewBytes(data.bytes,asset.mime,data.integrity.computedSha256);
      if(!live())return;
      if(!verified){setState({status:'failed'});return;}
      const url=URL.createObjectURL(data.bytes);
      activeUrl.current=url;setState({status:'ready',url,pinned:data.serverAttestation==='SERVER_HASH_PINNED'});
    }catch{
      if(live())setState({status:'failed'});
    }finally{if(generation.current===started)flight.current=false;}
  }
  return <section aria-label="Owner-private image byte preview">
    {state.status==='ready'?<>
      <img src={state.url} alt={asset.altText} decoding="async" style={{maxWidth:'100%',height:'auto',objectFit:'contain'}}
        onError={()=>{release();setState({status:'failed'});}}/>
      <p>Owner-private bytes verified. {state.pinned?'Independent server hash pin matched.':'No independent server hash pin verified.'} Public delivery is not authorized.</p>
      <button type="button" className="ws-secondary" onClick={()=>{release();setState({status:'idle'});}}>Close private preview</button>
    </>:state.status==='pending'?<>
      <p role="status">Verifying private image bytes…</p>
      <div className="glyph-skeleton" aria-hidden="true"><span className="glyph-skeleton-line is-medium"/><span className="glyph-skeleton-line is-short"/></div>
    </>:<>
      {state.status==='failed'&&<p role="alert">Private image bytes could not be verified or displayed.</p>}
      <button type="button" className="ws-secondary" onClick={()=>void load()}>{state.status==='failed'?'Retry private image preview':'Preview verified private image'}</button>
    </>}
  </section>;
}

export function AssetList({port,back,snapshot,targets,selectedSlot,placementDisabled,onPlace,active=true}:{
  port:SupabaseBrowserAuthPort;back:()=>void;snapshot:PortfolioSnapshot;
  targets:readonly {key:string;label:string;state:string}[];selectedSlot:string;placementDisabled:boolean;
  onPlace:(assetId:string,slot:string,altText:string)=>Promise<boolean>;active?:boolean;
}) {
  const [assets,setAssets]=useState<NonNullable<Awaited<ReturnType<SupabaseBrowserAuthPort['listOwnerAssets']>>['data']>|null>(null);
  const [projects,setProjects]=useState<NonNullable<Awaited<ReturnType<SupabaseBrowserAuthPort['listOwnerProjects']>>['data']>|null>(null);
  const [error,setError]=useState('');
  const [recordsError,setRecordsError]=useState('');
  const [recordsPending,setRecordsPending]=useState(true);
  const recordsFlight=useRef(true);
  const recordsBinding=useRef<{port:SupabaseBrowserAuthPort;epoch:number}|null>(null);
  const [notice,setNotice]=useState('');
  const [projectId,setProjectId]=useState('');
  const [collection,setCollection]=useState('');
  const [selectedAssetId,setSelectedAssetId]=useState('');
  const [targetKey,setTargetKey]=useState<string|null>(null);
  const [dragAsset,setDragAsset]=useState<string|null>(null);
  const assetDrag=useRef<{snapshot:PortfolioSnapshot;asset:AssetPreviewRecord;port:SupabaseBrowserAuthPort;epoch:number;generation:number}|null>(null);
  const recordGeneration=useRef(0);
  const actionGeneration=useRef(0);
  const lastScope=useRef<{port:SupabaseBrowserAuthPort;epoch:number}|null>(null);
  const placementField=useRef<HTMLTextAreaElement>(null);
  const [placementAlt,setPlacementAlt]=useState('');
  const [placing,setPlacing]=useState(false);
  const placementFlight=useRef(false);
  const uploadFlight=useRef(false);
  const assetMounted=useRef(false);
  useEffect(()=>{assetMounted.current=true;return()=>{assetMounted.current=false;};},[]);
  const [uploadOpen,setUploadOpen]=useState(false);
  const uploadProjectLabel=useId(),uploadAltLabel=useId(),placementTargetLabel=useId(),placementAltLabel=useId();
  const uploadFileId=useId();
  const fileInput=useRef<HTMLInputElement>(null);
  const [file,setFile]=useState<File|null>(null);
  const [alt,setAlt]=useState('');
  const [busy,setBusy]=useState(false);
  const [refresh,setRefresh]=useState(0);
  // File objects, alt text, selected IDs and async action locks belong to
  // the previous owner scope. Never carry them into a newly verified owner.
  function resetPrivateInputs(){
    ++actionGeneration.current;placementFlight.current=false;uploadFlight.current=false;
    setSelectedAssetId('');setTargetKey(null);setCollection('');setProjectId('');
    setPlacementAlt('');setAlt('');setFile(null);setUploadOpen(false);setBusy(false);setPlacing(false);
    setNotice('');setError('');if(fileInput.current)fileInput.current.value='';
  }
  useLayoutEffect(()=>{
    let subscribed=true;
    const epoch=port.reconcileOwnerSessionEpoch();
    if(lastScope.current&&(lastScope.current.port!==port||lastScope.current.epoch!==epoch))resetPrivateInputs();
    lastScope.current={port,epoch};
    ++recordGeneration.current;assetDrag.current=null;setDragAsset(null);
    const sameBinding=recordsBinding.current?.port===port&&recordsBinding.current?.epoch===epoch;
    recordsFlight.current=true;setRecordsPending(true);setRecordsError('');
    if(!sameBinding){setAssets(null);setProjects(null);recordsBinding.current=null;}
    const finish=(failure:string)=>{
      recordsBinding.current=null;setAssets(null);setProjects(null);
      setRecordsError(failure);
      recordsFlight.current=false;setRecordsPending(false);
    };
    const unsubscribe=port.subscribeOwnerSessionEpoch(()=>{
      if(!subscribed)return;
      subscribed=false;++recordGeneration.current;assetDrag.current=null;setDragAsset(null);resetPrivateInputs();
      finish('Owner session changed. Reload verified private asset records.');
    });
    if(subscribed)void Promise.all([port.listOwnerAssets(),port.listOwnerProjects()]).then(([assetReply,projectReply])=>{
      if(!subscribed||port.reconcileOwnerSessionEpoch()!==epoch)return;
      if(!assetReply.data||!projectReply.data){
        finish(assetReply.error?.message??projectReply.error?.message??'Private asset records could not be verified.');return;
      }
      recordsBinding.current={port,epoch};
      setAssets(assetReply.data);setProjects(projectReply.data);
      recordsFlight.current=false;setRecordsPending(false);
    }).catch(()=>{if(subscribed&&port.reconcileOwnerSessionEpoch()===epoch)finish('Private asset records could not be loaded.');});
    return ()=>{subscribed=false;unsubscribe();};
  },[port,refresh]);
  function reloadRecords(){
    ++recordGeneration.current;assetDrag.current=null;setDragAsset(null);
    recordsFlight.current=true;setRecordsPending(true);setRefresh(n=>n+1);
  }
  const recordsReady=!recordsPending&&!recordsError&&assets!==null&&projects!==null&&recordsBinding.current?.port===port;
  const selectedProject=projects?.find(project=>project.id===projectId);
  const visible=assets?.filter(item=>!collection||item.projectId===collection)??[];
  const selected=visible.find(item=>item.id===selectedAssetId);
  // Explicitly selected target disappearing must not redirect a placement.
  const target=targets.find(item=>item.key===(targetKey===null?selectedSlot:targetKey));
  const candidateTargets=targets.filter((item,index,all)=>all.filter(other=>other.key===item.key).length===1&&
    Object.hasOwn(snapshot.slots,item.key)&&snapshot.slots[item.key]?.state===item.state&&
    (item.state==='EMPTY'||(item.state==='S0'&&snapshot.slots[item.key]?.componentId==='image@1')));
  const allowPlacement=active&&recordsReady&&!recordsPending&&!placementDisabled&&!busy&&!placing;
  function finishAssetDrag(){assetDrag.current=null;setDragAsset(null);}
  useLayoutEffect(()=>{finishAssetDrag();},[snapshot,active,port,collection]);
  function currentAssetDrag(){
    const drag=assetDrag.current;
    return drag&&allowPlacement&&!recordsFlight.current&&drag.snapshot===snapshot&&drag.port===port&&
      drag.generation===recordGeneration.current&&drag.epoch===recordsBinding.current?.epoch&&
      visible.some(item=>item===drag.asset)?drag:null;
  }
  function beginAssetDrag(event:DragEvent<HTMLElement>,asset:AssetPreviewRecord){
    if(!allowPlacement||recordsFlight.current||!candidateTargets.length||!visible.some(item=>item===asset)){
      event.preventDefault();return;
    }
    const epoch=port.reconcileOwnerSessionEpoch();
    if(epoch!==recordsBinding.current?.epoch){event.preventDefault();return;}
    assetDrag.current={snapshot,asset,port,epoch,generation:recordGeneration.current};
    setDragAsset(asset.id);event.dataTransfer.effectAllowed='copy';
    // Marker only: private metadata/URLs/IDs never enter DataTransfer.
    event.dataTransfer.setData('text/plain','kadmeion-private-image-selection');
  }
  function selectPlacement(asset:AssetPreviewRecord,key:string){
    setSelectedAssetId(asset.id);setPlacementAlt(asset.altText);setTargetKey(key);setUploadOpen(false);setError('');
    setNotice('Image and target selected. Review the alt text, then confirm the placement. No assignment has changed.');
  }
  function dropAsset(event:DragEvent<HTMLElement>,key:string){
    const drag=currentAssetDrag();finishAssetDrag();
    if(!drag||!candidateTargets.some(item=>item.key===key)||port.reconcileOwnerSessionEpoch()!==drag.epoch)return;
    event.preventDefault();event.stopPropagation();
    selectPlacement(drag.asset,key);
  }
  const uses=selected?Object.entries(snapshot.slots).filter(([,assignment])=>
    assignment.state!=='EMPTY'&&assignment.content.asset_id===selected.id):[];
  async function place(){
    if(!allowPlacement||recordsFlight.current||!selected||!target||!candidateTargets.some(item=>item.key===target.key)||placementFlight.current||uploadFlight.current||!placementAlt.trim()||placementAlt.length>300)return;
    const epoch=port.reconcileOwnerSessionEpoch();
    if(recordsBinding.current?.epoch!==epoch)return;
    const started=actionGeneration.current;
    const current=()=>assetMounted.current&&actionGeneration.current===started&&port.reconcileOwnerSessionEpoch()===epoch;
    placementFlight.current=true;setPlacing(true);setNotice('');
    try{
      const placed=await onPlace(selected.id,target.key,placementAlt.trim());
      if(!current())return;
      setNotice(placed?'Private image reference applied. Save draft to persist the assignment; media bytes have not been attested.':
        'Image placement was not completed. Existing assignment and selected image were retained.');
    }catch{
      if(current())setError('Image placement was not confirmed. Review the current draft before retrying.');
    }finally{if(current()){placementFlight.current=false;setPlacing(false);}}
  }
  async function upload(event:import('react').FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!active||!recordsReady||recordsFlight.current||busy||uploadFlight.current||placementFlight.current||!file||!selectedProject||!alt.trim())return;
    const epoch=port.reconcileOwnerSessionEpoch();
    if(recordsBinding.current?.epoch!==epoch)return;
    const started=actionGeneration.current;
    const current=()=>assetMounted.current&&actionGeneration.current===started&&port.reconcileOwnerSessionEpoch()===epoch;
    uploadFlight.current=true;setBusy(true);setError('');setNotice('');
    try{
      const receipt=await port.uploadOwnerProjectImage(projectId,file,alt.trim());
      if(!current())return;
      if(!receipt.data||receipt.data.publicDeliveryAllowed!==false||
        receipt.data.verifiedMetadata!==true)
        throw new Error(receipt.error?.message??'The private registration receipt was not verified.');
      setNotice('Image uploaded and privately registered. Public delivery remains blocked; a trusted byte attestation is still required.');
      setSelectedAssetId(receipt.data.id);setPlacementAlt(receipt.data.altText);setCollection('');
      setAlt('');setFile(null);setUploadOpen(false);reloadRecords();
      if(fileInput.current)fileInput.current.value='';
    }catch(cause){if(current())
      setError(cause instanceof Error?cause.message:'Image registration was not confirmed.');}
    finally{if(current()){uploadFlight.current=false;setBusy(false);}}
  }
  return <div className="ws-asset-library ws-asset-manager" role="group" aria-label="Private asset manager">
    <aside className="ws-asset-collections">
      <p className="ws-kicker">ASSET LIBRARY</p>
      <h2>Collections</h2>
      <p>Owner-private project media. Collections are grouped by real source projects, not invented media tags.</p>
      <nav aria-label="Asset collections">
        <button type="button" aria-pressed={!collection} onClick={()=>setCollection('')}>
          <span>All assets</span><small>{assets===null?'—':assets.length}</small>
        </button>
        {projects?.map(project=><button key={project.id} type="button"
          aria-pressed={collection===project.id} onClick={()=>setCollection(project.id)}>
          <span>{project.title}</span><small>{assets?.filter(asset=>asset.projectId===project.id).length??0}</small>
        </button>)}
      </nav>
      <p className="ws-asset-protection">Private uploads require an owner project, server-verified metadata and a unique write-once Storage object path.</p>
      <a className="ws-secondary" href="/app/projects">Manage private projects</a>
      <button type="button" className="ws-secondary" onClick={back}>Back to editor canvas</button>
    </aside>
    <section className="ws-asset-center" aria-label="Owner-private media records">
      <div className="ws-asset-toolbar">
        <span>PRIVATE ASSET CANVAS · {collection?'PROJECT COLLECTION':'ALL PROJECTS'}</span>
        <span>{assets===null?'Count unavailable':`${visible.length} shown${recordsPending?' · rechecking':''}`} · Not public</span>
      </div>
      {recordsError&&!recordsPending&&<div role="alert" className="ws-inline-alert">{recordsError}
        <button className="ws-secondary" type="button" onClick={reloadRecords}>Retry private records</button></div>}
      {error&&<p role="alert" className="ws-inline-alert">{error}</p>}
      {(notice||recordsPending)&&<p role="status" className="ws-inline-alert">{notice}{notice&&recordsPending?' ':''}{recordsPending?(assets===null?'Checking private assets and projects…':'Rechecking private records; actions are temporarily unavailable.'):""}</p>}
      {recordsPending&&assets===null&&<div className="glyph-skeleton" aria-hidden="true"><span className="glyph-skeleton-line is-title"/><span className="glyph-skeleton-line is-medium"/><span className="glyph-skeleton-line is-short"/></div>}
      {recordsReady&&assets?.length===0&&<div className="ws-asset-empty">
        <div className="ws-asset-empty-glyph" aria-hidden="true"><span/></div>
        <h2>Your asset library is empty.</h2>
        <p>Upload an owner-private image with descriptive alt text. It stays unpublishable until trusted media validation and host gates pass.</p>
        <button type="button" className="ws-primary" onClick={()=>setUploadOpen(true)}>Open private uploader</button>
      </div>}
      {recordsReady&&assets!==null&&assets.length>0&&visible.length===0&&<div className="ws-asset-empty">
        <h2>No images in this project.</h2><p>Choose a different owner collection or add a private image.</p>
        <button type="button" className="ws-secondary" onClick={()=>setUploadOpen(true)}>Open private uploader</button>
      </div>}
      {visible.length>0&&<ul className="ws-asset-gallery">{visible.map(asset=><li key={asset.id}>
        <button type="button" aria-pressed={selectedAssetId===asset.id} draggable={allowPlacement&&candidateTargets.length>0}
          onDragStart={event=>beginAssetDrag(event,asset)} onDragEnd={finishAssetDrag}
          disabled={!active||!recordsReady||placing||busy}
          onClick={()=>{setSelectedAssetId(asset.id);setPlacementAlt(asset.altText);setUploadOpen(false);}}>
          <span className="ws-asset-gallery-icon" aria-hidden="true">▧</span>
          <strong>{asset.altText}</strong><small>{asset.mime} · {Math.ceil(asset.size/1024)} KB</small>
          <small>Private metadata · No public image URL</small>
        </button></li>)}</ul>}
      {allowPlacement&&candidateTargets.length>0&&visible.length>0&&<section aria-label="Compatible private image drop targets">
        <h3>Choose an image destination</h3>
        <p>Drag a private image here, or select it and use the destination buttons. Placement still requires explicit confirmation and valid alt text.</p>
        <ul className="ws-editor-slots">{candidateTargets.map(item=><li key={item.key}
          data-drop-fit={dragAsset?'compatible':undefined} style={dragAsset?DROP_OUTLINE:undefined}
          onDragOver={event=>{if(currentAssetDrag()){event.preventDefault();event.dataTransfer.dropEffect='copy';}}}
          onDrop={event=>dropAsset(event,item.key)}>
          <button type="button" disabled={!selected||!allowPlacement} onClick={()=>{if(selected){selectPlacement(selected,item.key);placementField.current?.focus();}}}>
            Choose {item.label} · {item.state==='EMPTY'?'EMPTY':'Review image replacement'}
          </button>
        </li>)}</ul>
      </section>}
      {assets?.length===100&&<p className="ws-asset-limits">At most 100 recent private records returned; older records may exist.</p>}
      {recordsReady&&assets?.length!==0&&<div className="ws-asset-add">
        <button type="button" className="ws-secondary" onClick={()=>setUploadOpen(true)}>Open private uploader</button>
      </div>}
      <footer className="ws-asset-center-foot">Actual private records only · No public asset serving or verified media bytes</footer>
    </section>
    <aside className="ws-asset-details">
      <p className="ws-kicker">ASSET DETAILS</p>
      {uploadOpen?<><h2>Private upload</h2>
        <p>This is an irreversible write-once private Storage upload. No owner-side delete or public publish follows.</p>
        {projects?.length===0?<p>First <a href="/app/projects">create a private project</a>.</p>:
          <form className="ws-asset-upload" onSubmit={event=>void upload(event)}>
            <label><span id={uploadProjectLabel}>Owner project</span><select aria-labelledby={uploadProjectLabel} required disabled={busy||!recordsReady} value={projectId} onChange={event=>setProjectId(event.target.value)}>
              <option value="">Select a private project</option>
              {projects?.map(project=><option key={project.id} value={project.id}>{project.title}</option>)}
            </select></label>
            <label htmlFor={uploadFileId}>Private image file</label>
            <input ref={fileInput} id={uploadFileId} type="file" required disabled={busy||!recordsReady}
              accept="image/png,image/jpeg,image/webp"
              onChange={event=>setFile(event.currentTarget.files?.[0]??null)}/>
            <label><span id={uploadAltLabel}>Image alt text</span><textarea aria-labelledby={uploadAltLabel} rows={3} required disabled={busy||!recordsReady} maxLength={500} value={alt}
              onChange={event=>setAlt(event.target.value)}
              placeholder="Describe the image for assistive technology"/></label>
            <p className="ws-asset-limits">PNG, JPEG or WebP · 5 MB max. Your filename is never used as a public path.
              Failed registration may leave private bytes needing administrator cleanup.
              A registered asset is not SHA-attested or publishable.</p>
            <button className="ws-primary" type="submit"
              disabled={!active||busy||!recordsReady||!file||!selectedProject||!alt.trim()}>
              {busy?'Registering private image…':'Upload private image'}</button>
            <button type="button" className="ws-secondary" disabled={busy}
              onClick={()=>setUploadOpen(false)}>Cancel uploader</button>
          </form>}
      </>:selected?<><h2>Selected image</h2>
        <p>Registered private metadata. Preview requests verify the owner-only image bytes; they do not authorize public delivery.</p>
        {active&&recordsReady&&recordsBinding.current&&<OwnerAssetBytesPreview key={selected.id+'|'+selected.projectId+'|'+selected.size+'|'+selected.mime+'|'+recordsBinding.current.epoch}
          port={port} asset={selected} epoch={recordsBinding.current.epoch}/>} 
        <dl className="ws-asset-metadata">
          <div><dt>Alt text</dt><dd>{selected.altText}</dd></div>
          <div><dt>Project</dt><dd>{projects?.find(item=>item.id===selected.projectId)?.title??selected.projectId}</dd></div>
          <div><dt>MIME type</dt><dd>{selected.mime}</dd></div>
          <div><dt>Size</dt><dd>{Math.ceil(selected.size/1024)} KB</dd></div>
          <div><dt>Current working draft uses</dt><dd>{uses.length?uses.map(([key])=>key).join(', '):'None in current draft'}</dd></div>
          <div><dt>Focal point</dt><dd>Not stored</dd></div>
        </dl>
        <p className="ws-asset-protection">Place only a verified owner-private registration into an actual compatible slot. Replacing a pristine image stashes its previous assignment; historical asset bytes are not deleted. No public URL or digest is fabricated.</p>
        {candidateTargets.length===0?<p>No compatible empty/pristine image slot is available in this verified editor. Add a suitable section or select a different slot.</p>:<>
          <label><span id={placementTargetLabel}>Compatible image slot</span><select aria-labelledby={placementTargetLabel} value={candidateTargets.some(item=>item.key===target?.key)?target?.key??'':''} disabled={!allowPlacement}
            onChange={event=>setTargetKey(event.target.value)}>
            <option value="">Choose an image-compatible slot</option>
            {candidateTargets.map(item=><option key={item.key} value={item.key}>{item.label} · {item.state==='EMPTY'?'Empty':'Replace image'}</option>)}
          </select></label>
          <label><span id={placementAltLabel}>Placement alt text</span><textarea aria-labelledby={placementAltLabel} ref={placementField} rows={3} value={placementAlt} disabled={!allowPlacement}
            aria-invalid={!placementAlt.trim()||placementAlt.length>300}
            onChange={event=>setPlacementAlt(event.target.value)}/></label>
          <p>Use 1–300 characters. No automatic truncation of existing alt text.</p>
          <button type="button" className="ws-primary" disabled={!allowPlacement||!target||!candidateTargets.some(item=>item.key===target.key)||!placementAlt.trim()||placementAlt.length>300}
            onClick={()=>void place()}>{placing?'Verifying placement…':target?.state==='S0'?'Replace image and stash previous':'Assign image to selected slot'}</button>
        </>}
        <button type="button" className="ws-secondary" onClick={()=>setUploadOpen(true)}>Register another image</button>
      </>:<><h2>No asset selected.</h2>
        <p>Select a private image to inspect its verified metadata, or use the uploader.</p>
        <div className="ws-asset-detail-placeholder" aria-hidden="true"><span>▧</span></div>
        <dl className="ws-asset-metadata">
          {['Alt text','File name','Usage references','Focal point'].map(name=>
            <div key={name}><dt>{name}</dt><dd>Not available without a selected image</dd></div>)}
        </dl>
        <p className="ws-asset-protection">Replacing an image requires a new private object and a review of affected uses.</p>
      </>}
    </aside>
  </div>;
}

export function RevisionHistory({port,id,revision,onRestore,working,buffered,active}: {
  port:SupabaseBrowserAuthPort;id:string;revision:number;
  onRestore:(snapshot:PortfolioSnapshot)=>boolean;working:PortfolioSnapshot;buffered:boolean;active:boolean;
}) {
  const [items,setItems]=useState<{revision:number;createdAt:string}[]|null>(null);
  const [selected,setSelected]=useState<number|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [comparison,setComparison]=useState<{
    revision:number;changedFiles:number;changedSlots:number;
  }|null>(null);
  useEffect(()=>{
    let active=true;
    setItems(null);setSelected(null);setComparison(null);setError('');
    void port.listOwnerRevisions(id).then(result=>{
      if(!active)return;
      if(result.data)setItems(result.data);
      else setError(result.error?.message??'Revision history could not be loaded.');
    }).catch(()=>{
      if(active)setError('Revision history could not be loaded. Please retry.');
    });
    return ()=>{active=false;};
  },[port,id,revision]);
  // A read can resolve after the owner edits, saves, changes account/route,
  // or closes History. Never use the old captured editor callback to restore.
  const latest=useRef<{port:SupabaseBrowserAuthPort;id:string;revision:number;
    working:PortfolioSnapshot;buffered:boolean;active:boolean;epoch:number;onRestore:(snapshot:PortfolioSnapshot)=>boolean}|null>(null);
  useLayoutEffect(()=>{
    latest.current={port,id,revision,working,buffered,active,epoch:port.getOwnerSessionEpoch(),onRestore};
    return ()=>{latest.current=null;};
  },[port,id,revision,working,buffered,active,onRestore]);
  // A comparison describes one exact working snapshot, not later edits/restores.
  useEffect(()=>{setComparison(null);},[working]);
  async function compare(){
    if(!selected||busy||!active)return;
    const epoch=port.reconcileOwnerSessionEpoch();
    setBusy(true);setError('');setComparison(null);
    try{
      const historical=await readSelectedUnsafe(selected);
      if(!historical)return;
      const current=latest.current;
      if(!current||!current.active||current.port!==port||current.id!==id||current.revision!==revision||
        current.epoch!==epoch||port.reconcileOwnerSessionEpoch()!==epoch)return;
      if(current.working!==working){
        setError('The working draft changed during comparison. Compare again.');
        return;
      }
      const paths=new Set([...Object.keys(working.files),...Object.keys(historical.files)]);
      const keys=new Set([...Object.keys(working.slots),...Object.keys(historical.slots)]);
      const changedFiles=[...paths].filter(path=>working.files[path]!==historical.files[path]).length;
      const stable=(v:unknown):string=>JSON.stringify(v,(_key,value)=>{
        if(value&&typeof value==='object'&&!Array.isArray(value)){
          return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)));
        }
        return value;
      });
      const changedSlots=[...keys].filter(key=>stable(working.slots[key])!==stable(historical.slots[key])).length;
      setComparison({revision:selected,changedFiles,changedSlots});
    }finally{setBusy(false);}
  }
  async function readSelectedUnsafe(version:number):Promise<PortfolioSnapshot|null>{
    try {
      const result=await port.readOwnerRevision(id,version);
      if(!result.data){setError(result.error?.message??'Historical revision cannot be verified.');return null;}
      return result.data;
    } catch {
      setError('Historical revision could not be verified. Please retry.');
      return null;
    }
  }
  async function restore(){
    if(!selected||busy||buffered||!active)return;
    const epoch=port.reconcileOwnerSessionEpoch();
    setBusy(true);setError('');
    try{
      const snapshot=await readSelectedUnsafe(selected);
      const current=latest.current;
      if(!snapshot||!current||!current.active||current.port!==port||current.id!==id||current.revision!==revision||
        current.epoch!==epoch||port.reconcileOwnerSessionEpoch()!==epoch)return;
      if(current.working!==working||current.buffered){
        setError('The working draft or its unapplied edits changed during restore. Review them and retry.');
        return;
      }
      if(current.onRestore(snapshot)){setSelected(null);setComparison(null);}
    }finally{setBusy(false);}
  }
  return <div className="ws-editor-tool ws-revision-list">
    <h2>Saved checkpoints</h2>
    {error&&<p role="alert">{error}</p>}
    {!items&&!error&&<><p role="status">Loading owner-private revisions…</p>
      <div className="glyph-skeleton" aria-hidden="true"><span className="glyph-skeleton-line is-medium"/><span className="glyph-skeleton-line is-short"/></div></>}
    {items?.length===0&&<p>No saved checkpoints have been returned.</p>}
    <ul className="ws-editor-slots">{items?.map(item=><li key={item.revision}>
      <button type="button" disabled={busy} aria-pressed={item.revision===selected}
        onClick={()=>{setSelected(item.revision);setComparison(null);}}>
        Revision {item.revision}<span>{new Date(item.createdAt).toLocaleString()}</span>
      </button></li>)}</ul>
    <section id="history-comparison" className="ws-revision-compare" aria-label="Version comparison">
      <h3>Compare &amp; restore</h3>
      {!selected&&<p>Select a saved checkpoint above to compare it with the current working draft.</p>}
      {selected&&<>
        <p>Revision {selected} is an owner-private saved checkpoint. Comparison only reads its historical snapshot.</p>
        <div className="ws-revision-buttons">
          <button type="button" className="ws-secondary" disabled={busy} onClick={()=>void compare()}>
            Compare to working copy</button>
          <button type="button" className="ws-secondary" disabled={busy||buffered||!active} onClick={()=>void restore()}>
            Restore selected checkpoint to draft</button>
        </div>
      </>}
      {comparison&&<div role="status" aria-label="Actual snapshot comparison"><dl className="ws-revision-difference">
        <div><dt>Compared revision</dt><dd>{comparison.revision}</dd></div>
        <div><dt>Different project files</dt><dd>{comparison.changedFiles}</dd></div>
        <div><dt>Different component slots</dt><dd>{comparison.changedSlots}</dd></div>
      </dl></div>}
      {buffered&&<p role="status">Apply or discard unapplied inspector and source text before restoring a checkpoint. Your existing buffers remain untouched.</p>}
      <p>Restore is a reversible editor transaction, not a public rollback; save the private draft to persist it.</p>
    </section>
  </div>;
}

/** EDIT-08: the approved history layout is a three-pane private workbench,
 * not a small history list inside the Content inspector. */
export function RevisionWorkspace({port,id,revision,working,title,dirty,buffered,active,onRestore,back}:{
  port:SupabaseBrowserAuthPort;id:string;revision:number;
  working:PortfolioSnapshot;title:string;dirty:boolean;buffered:boolean;active:boolean;
  onRestore:(snapshot:PortfolioSnapshot)=>boolean;back:()=>void;
}){
  const [tab,setTab]=useState<'History'|'Problems'|'Conflicts'>('History');
  const views=['History','Problems','Conflicts'] as const;
  function moveTab(event:KeyboardEvent<HTMLButtonElement>,index:number){
    const last=views.length-1;
    const next=event.key==='ArrowRight'?(index+1)%views.length:
      event.key==='ArrowLeft'?(index+last)%views.length:
      event.key==='Home'?0:event.key==='End'?last:null;
    if(next===null)return;
    const nextView=views[next];
    if(!nextView)return;
    event.preventDefault();
    setTab(nextView);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]').item(next)?.focus();
  }
  return <div className="ws-revision-workspace">
    <aside className="ws-revision-nav">
      <p className="ws-kicker">DOCUMENT HISTORY</p>
      <h2>Revisions</h2>
      <p>Compare actual saved checkpoints. Restore into a working copy without replacing published content.</p>
      <nav aria-label="Revision history navigation">
        <a href="#history-current">Current working draft</a>
        <a href="#history-checkpoints">Saved checkpoints</a>
        <a href="#history-comparison">Compare &amp; restore</a>
      </nav>
      <p className="ws-source-tree-note">Your private draft is versioned. Undo/Redo and a checkpoint restore never bypass release verification.</p>
      <button type="button" className="ws-secondary" onClick={back}>Back to editor canvas</button>
    </aside>
    <section className="ws-revision-center">
      <div className="ws-revision-breadcrumb">HISTORY / PRIVATE AUTHOR PREVIEW
        <span>Saved revision {revision} · {dirty?'Uncommitted edits':'No uncommitted edits'}</span></div>
      <div id="history-current" className="ws-revision-canvas" role="region" aria-label="Current revision preview" tabIndex={0}>
        <PortfolioCanvas snapshot={working} title={title}/>
      </div>
      <section id="history-checkpoints" className="ws-revision-bottom">
        <div className="ws-revision-tab-row"><h2>History &amp; problems</h2>
          <span>Private revisions · diagnostics are explicitly scoped</span></div>
        <div className="ws-revision-tabs" role="tablist" aria-label="Revision views">
          {views.map((view,index)=>
            <button role="tab" type="button" key={view} id={'kd-revision-tab-'+view.toLowerCase()}
              aria-controls="kd-revision-panel" aria-selected={tab===view}
              tabIndex={tab===view?0:-1} onKeyDown={event=>moveTab(event,index)}
              onClick={()=>setTab(view)}>{view}</button>)}
        </div>
        <div id="kd-revision-panel" role="tabpanel" tabIndex={0}
          aria-labelledby={'kd-revision-tab-'+tab.toLowerCase()}>
          {tab==='History'?<RevisionHistory port={port} id={id} revision={revision}
            working={working} onRestore={onRestore} buffered={buffered} active={active}/>:
          tab==='Problems'?<div className="ws-revision-honest-state">
            <h3>Validation has not been run here.</h3>
            <p>Saved revision integrity is checked on read. This history page does not run source lint, custom-code analysis, media attestation or public host checks.</p>
            <a href={'/app/portfolios/'+id+'/publish'}>Open private release preflight</a>
          </div>:
          <div className="ws-revision-honest-state">
            <h3>Concurrent-save checks happen on save.</h3>
            <p>This screen cannot infer other active editing sessions. A stale private revision is rejected by the compare-and-swap save writer without replacing the newer version.</p>
          </div>}
        </div>
      </section>
    </section>
    <aside className="ws-revision-diagnostics">
      <p className="ws-kicker">PROBLEMS</p><h2>Diagnostics</h2>
      <p>A private draft check is not a public deployment or a compilation audit.</p>
      <dl>
        <div><dt>Current working state</dt><dd>{dirty?'Uncommitted private changes':'Same revision as last save'}</dd></div>
        <div><dt>Saved revision</dt><dd>{revision}</dd></div>
        <div><dt>Source diagnostics</dt><dd>Not executed or compiled here</dd></div>
        <div><dt>Concurrent save conflicts</dt><dd>Checked only on the next compare-and-swap save</dd></div>
        <div><dt>Public release</dt><dd>Not authorized by revision history</dd></div>
      </dl>
      <p className="ws-source-diagnostics-note">History can restore versioned private bytes. It cannot assert host/CDN withdrawal, public image delivery or current visitor reachability.</p>
    </aside>
  </div>;
}
