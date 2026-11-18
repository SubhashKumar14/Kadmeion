import { ContractError } from '../../contracts/src/project.ts';
import { assertBaseRevision } from '../../contracts/src/operations.ts';
import type {MyComponentVersion,MyComponentInput} from '../../contracts/src/private-my-components-service.ts';
import { assertManagedPath, assertOwnedSourcePath, validateManagedJson, portfolioLayout, MAX_FILE_BYTES } from './managed-project-files.ts';

export type SlotState = 'EMPTY' | 'S0' | 'S1' | 'S2';

export interface SlotAssignment {
  state: SlotState;
  componentId?: string;
  content: Record<string,string>;
  sourcePath?: string;
  originalSource?: string;
}

export interface PortfolioSnapshot {
  formatVersion: 1;
  files: Record<string,string>;
  slots: Record<string,SlotAssignment>;
  stashes: Record<string,SlotAssignment[]>;
}

export interface EditorHead {
  revision: number;
  snapshot: PortfolioSnapshot;
  undo: PortfolioSnapshot[];
  redo: PortfolioSnapshot[];
  operations: Record<string,string>;
}

export type LayoutMappingRequest = {
  sectionId:string;expectedLayout:string;targetLayout:string;
  mappings:Array<{fromSlotKey:string;toSlotKey:string|null}>;
};
export type ChangeSectionLayoutIntent=LayoutMappingRequest & {
  kind:'CHANGE_SECTION_LAYOUT';expectedRevision:number;
  confirmStash:boolean;confirmOwnedRelocation:boolean;
};
export type RestoreLayoutStashIntent={
  kind:'RESTORE_LAYOUT_STASH';fromSlotKey:string;stashIndex:number;toSlotKey:string;
  expectedRevision:number;confirmOwnedRelocation:boolean;
};

export type EditorIntent =
  | EditScopedThemeIntent
  | { kind:'WRITE_MANAGED_FILE'; path:string; source:string }
  | { kind:'ADD_SECTION'; layout:string }
  | { kind:'MOVE_SECTION'; sectionId:string; direction:'up'|'down' }
  | { kind:'MOVE_SECTION_BEFORE'; sectionId:string; beforeSectionId:string|null; expectedRevision:number }
  | ChangeSectionLayoutIntent
  | RestoreLayoutStashIntent
  | { kind:'CLEAR_SLOT'; slotKey:string }
  | { kind:'ASSIGN_COMPONENT'; slotKey:string; componentId:string; confirmOwnedReplacement?:boolean; preserveMatchingContent?:boolean }
  | { kind:'UPDATE_CONTENT'; slotKey:string; content:Record<string,string> }
  /** Draft metadata placement only. Never grants media-byte attestation. */
  | { kind:'PLACE_PRIVATE_IMAGE'; slotKey:string; assetId:string; altText:string }
  | { kind:'CUSTOMIZE_COMPONENT'; slotKey:string; copiedSource:string }
  | { kind:'REUSE_SAVED_COMPONENT'; slotKey:string; componentVersionId:string; confirmOwnedReplacement?:boolean; preserveMatchingContent?:boolean }
  | { kind:'EDIT_OWNED_SOURCE'; slotKey:string; source:string }
  | { kind:'RESTORE_STASH'; slotKey:string; stashIndex?:number }
  | { kind:'UNDO' }
  | { kind:'REDO' };

export interface EditorCommand {
  operationId: string;
  baseRevision: number;
  intent: EditorIntent;
}

const COMPONENT_PIN = /^[a-z][a-z0-9-]*@[0-9]+(?:\.[0-9]+){0,2}$/;
const SLOT_KEY = /^[a-z0-9_-]{1,64}$/;
const RESERVED_KEYS = new Set(['__proto__','constructor','prototype']);
const OP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertSlotKey(key: string) {
  if (typeof key!=='string' || !SLOT_KEY.test(key) || RESERVED_KEYS.has(key))
    throw new ContractError('VALIDATION', 'Invalid or reserved slot key.');
}

/** undefined = older layoutless snapshot; null = declared layout but no
 * unique valid target. Never infer compatibility from an arbitrary suffix. */
export function declaredLayoutSlotKind(snapshot:PortfolioSnapshot,key:string):string|null|undefined{
  try{
    const page=JSON.parse(snapshot.files['pages/home.page.json']??'null') as {sections?:unknown}|null;
    if(!page||!Object.hasOwn(page,'sections'))return undefined;
    if(!Array.isArray(page.sections)||!Object.hasOwn(snapshot.slots,key))return null;
    const matches:string[]=[];
    for(const raw of page.sections){
      if(!raw||typeof raw!=='object'||Array.isArray(raw))continue;
      const section=raw as {id?:unknown;layout?:unknown};
      if(typeof section.id!=='string'||typeof section.layout!=='string')continue;
      for(const name of portfolioLayout(section.layout)?.slots??[]){
        const kind=name.toLowerCase();
        if(section.id+'-'+kind===key)matches.push(kind);
      }
    }
    return matches.length===1?matches[0]!:null;
  }catch{return null;}
}
const libraryKinds:Readonly<Record<string,readonly string[]>>={
  'title-stacked@1':['title'],'body-copy@1':['text','text1','text2','note'],
  'external-link@1':['cta','cta1','cta2','btn1','btn2','links'],
  'project-card@1':['project','card'],'skills-list@1':['items','entries'],
  'experience-list@1':['entries'],'technology-tag@1':['badge'],'author-metric@1':['meta']
};
export function canAssignCompatibleComponent(snapshot:PortfolioSnapshot,key:string,pin:string):boolean{
  const kind=declaredLayoutSlotKind(snapshot,key);
  return typeof kind==='string'&&Object.hasOwn(libraryKinds,pin)&&libraryKinds[pin]!.includes(kind);
}
/** A real declared media slot, not merely a key ending in "-image". */
export function canPlacePrivateImage(snapshot:PortfolioSnapshot,key:string):boolean {
  const slot=Object.hasOwn(snapshot.slots,key)?snapshot.slots[key]:undefined;
  if(!slot||(slot.state!=='EMPTY'&&(slot.state!=='S0'||slot.componentId!=='image@1')))return false;
  const kind=declaredLayoutSlotKind(snapshot,key);
  return typeof kind==='string'&&['avatar','image','imagea','imageb','media','thumbs'].includes(kind);
}

/** Same pinned, documented text fields only; unknown fields stay in full stash. */
export function matchingReplacementContent(slot:SlotAssignment,pin:string):Record<string,string>{
  const known:Readonly<Record<string,readonly string[]>>={
    'title-stacked@1':['title','subtitle'],'body-copy@1':['text'],
    'external-link@1':['label','url'],'project-card@1':['title','summary','url'],
    'skills-list@1':['items'],'experience-list@1':['items'],
    'technology-tag@1':['text'],'author-metric@1':['label','value']
  };
  if(slot.componentId!==pin||!Object.hasOwn(known,pin))return {};
  return Object.fromEntries((known[pin]??[]).filter(field=>Object.hasOwn(slot.content,field))
    .map(field=>[field,slot.content[field]!]));
}

function isOwned(slot: SlotAssignment): boolean {
  return slot.state === 'S1' || slot.state === 'S2';
}

function validateContent(content: Record<string,string>) {
  if (!content || typeof content !== 'object' || Array.isArray(content) || Object.keys(content).length>100)
    throw new ContractError('VALIDATION', 'Invalid component content.');
  for (const [field,value] of Object.entries(content)) {
    if (!SLOT_KEY.test(field) || RESERVED_KEYS.has(field) ||
        typeof value!=='string' || value.length>12000)
      throw new ContractError('VALIDATION', 'Invalid component field.');
  }
}

/** Validate active AND stashed assignments so restore and ZIP import cannot hide invalid source. */
function validateSlotAssignment(key:string,slot:SlotAssignment,snapshot:PortfolioSnapshot):void {
  assertSlotKey(key);
  if (!slot || typeof slot!=='object' || Array.isArray(slot) ||
      !['EMPTY','S0','S1','S2'].includes(slot.state))
    throw new ContractError('VALIDATION','Invalid slot or stashed assignment.');
  if (Object.keys(slot).some(field=>!['state','componentId','content','sourcePath','originalSource'].includes(field)))
    throw new ContractError('VALIDATION','Unexpected assignment property.');
  validateContent(slot.content);
  if (slot.originalSource!==undefined &&
      (typeof slot.originalSource!=='string' ||
       new TextEncoder().encode(slot.originalSource).byteLength>MAX_FILE_BYTES))
    throw new ContractError('VALIDATION','Invalid owned source provenance.');
  if (slot.state==='EMPTY') {
    if (slot.componentId!==undefined||slot.sourcePath!==undefined||
        slot.originalSource!==undefined||Object.keys(slot.content).length!==0)
      throw new ContractError('VALIDATION','An EMPTY assignment cannot contain source or content.');
    return;
  }
  if (typeof slot.componentId!=='string'||!COMPONENT_PIN.test(slot.componentId))
    throw new ContractError('VALIDATION','An assignment must use a pinned component.');
  if (slot.state==='S0') {
    if (slot.sourcePath!==undefined||slot.originalSource!==undefined)
      throw new ContractError('VALIDATION','Library source is read-only.');
    return;
  }
  if (typeof slot.sourcePath!=='string'||typeof slot.originalSource!=='string')
    throw new ContractError('VALIDATION','Owned assignments need source and pristine provenance.');
  assertOwnedSourcePath(slot.sourcePath);
  if (!slot.sourcePath.startsWith('slots/'+key+'/') ||
      !Object.hasOwn(snapshot.files,slot.sourcePath))
    throw new ContractError('VALIDATION','Stashed or active owned source file is missing.');
  const current=snapshot.files[slot.sourcePath];
  if ((slot.state==='S1'&&current!==slot.originalSource) ||
      (slot.state==='S2'&&current===slot.originalSource))
    throw new ContractError('VALIDATION','Owned source state disagrees with its file bytes.');
}

/** Bounded, data-only source diagnostics. Neither syntax compilation nor
 * execution nor publication approval is implied. Positions are 1-based
 * UTF-16 editor coordinates; CRLF counts as one new line. Existing opaque
 * imported bytes are never normalized or discarded by this diagnostic. */
export type OwnedSourceDiagnostic=Readonly<{code:'INVALID_SOURCE'|'SIZE_LIMIT'|'UNPAIRED_SURROGATE'|'EMPTY_SOURCE';severity:'error'|'warning';message:string;line?:number;column?:number}>;
export function diagnoseOwnedSource(value:unknown):OwnedSourceDiagnostic[]{
  if(typeof value!=='string')return [{code:'INVALID_SOURCE',severity:'error',message:'Owned source must be text.'}];
  if(value.length>MAX_FILE_BYTES||new TextEncoder().encode(value).byteLength>MAX_FILE_BYTES)
    return [{code:'SIZE_LIMIT',severity:'error',message:'Owned source exceeds the private source byte limit.'}];
  let line=1,column=1;
  for(let i=0;i<value.length;i++){
    const code=value.charCodeAt(i);
    if(code>=0xd800&&code<=0xdbff){
      const next=value.charCodeAt(i+1);
      if(next>=0xdc00&&next<=0xdfff){i++;column+=2;continue;}
      return [{code:'UNPAIRED_SURROGATE',severity:'error',line,column,message:'Unpaired Unicode surrogate cannot be preserved in UTF-8 source.'}];
    }
    if(code>=0xdc00&&code<=0xdfff)
      return [{code:'UNPAIRED_SURROGATE',severity:'error',line,column,message:'Unpaired Unicode surrogate cannot be preserved in UTF-8 source.'}];
    if(code===13||code===10){
      if(code===13&&value.charCodeAt(i+1)===10)i++;
      line++;column=1;
    }else column++;
  }
  return value.trim()?[]:[{code:'EMPTY_SOURCE',severity:'warning',message:'Source is empty. It remains private; no valid component compilation is implied.'}];
}

export function createEditorHead(snapshot: PortfolioSnapshot): EditorHead {
  validateSnapshot(snapshot);
  return {revision:0,snapshot:structuredClone(snapshot),undo:[],redo:[],operations:{}};
}

export function validateSnapshot(snapshot: PortfolioSnapshot): void {
  if (!snapshot || snapshot.formatVersion!==1 || !snapshot.files || !snapshot.slots || !snapshot.stashes ||
      typeof snapshot.files!=='object' || Array.isArray(snapshot.files) ||
      typeof snapshot.slots!=='object' || Array.isArray(snapshot.slots) ||
      typeof snapshot.stashes!=='object' || Array.isArray(snapshot.stashes)) {
    throw new ContractError('VALIDATION', 'Invalid portfolio snapshot format.');
  }
  if (Object.keys(snapshot).some(key=>!['formatVersion','files','slots','stashes'].includes(key)))
    throw new ContractError('VALIDATION','Unexpected snapshot metadata is not a supported project field.');
  if (Object.keys(snapshot.files).length>100) throw new ContractError('VALIDATION', 'Project file quota exceeded.');
  for (const [path,source] of Object.entries(snapshot.files)) {
    if (typeof source!=='string' || new TextEncoder().encode(source).byteLength>MAX_FILE_BYTES)
      throw new ContractError('VALIDATION', 'Invalid project source.');
    if (path.startsWith('slots/')) assertOwnedSourcePath(path);
    else { assertManagedPath(path); validateManagedJson(path,source); }
  }
  for (const [key,slot] of Object.entries(snapshot.slots)) {
    validateSlotAssignment(key,slot,snapshot);
  }
  if (Object.keys(snapshot.slots).length>100 || Object.keys(snapshot.stashes).length>100)
    throw new ContractError('VALIDATION','Snapshot has too many slot or stash keys.');
  let totalStashedAssignments=0;
  for (const [key,items] of Object.entries(snapshot.stashes)) {
    assertSlotKey(key);
    totalStashedAssignments+=Array.isArray(items)?items.length:0;
    if(totalStashedAssignments>1024)
      throw new ContractError('VALIDATION','Snapshot stash history exceeds safe resource bounds.');
    if (!Array.isArray(items) || items.length>100)
      throw new ContractError('VALIDATION', 'Invalid stash history.');
    for (const item of items) validateSlotAssignment(key,item,snapshot);
  }
}


type LayoutSection={id:string;layout:string;raw:Record<string,unknown>;keys:string[];names:string[]};
export type LayoutChangePlan={
  expectedRevision:number;sectionId:string;expectedLayout:string;targetLayout:string;
  rows:Array<{fromSlotKey:string;toSlotKey:string|null;componentId:string;state:SlotState;
    fields:string[];sourcePath?:string;sourceBytes?:number;disposition:'retain'|'move'|'stash'|'relocate'}>;
  targetKeys:string[];emptyTargetKeys:string[];stashedKeys:string[];
  addedFiles:number;addedStashAssignments:number;requiresStashConfirmation:boolean;
  requiresOwnedRelocationConfirmation:boolean;
};
const PAGE_PATH='pages/home.page.json';
const mediaKinds=['avatar','image','imagea','imageb','media','thumbs'];
const invalidLayout=(message:string):never=>{throw new ContractError('VALIDATION',message);};
function dataRecord(value:unknown):value is Record<string,unknown>{
  return !!value&&typeof value==='object'&&!Array.isArray(value);
}
function exactFields(value:unknown,fields:readonly string[]):boolean{
  return dataRecord(value)&&Object.keys(value).length===fields.length&&fields.every(k=>Object.hasOwn(value,k));
}
/** Resolve real declared own slots; reject malformed/ambiguous manifests rather
 * than infer section ownership from a string prefix. Legacy declarations
 * with opaque data cannot be discarded by canonicalization. */
function layoutManifest(snapshot:PortfolioSnapshot):{page:Record<string,unknown>;sections:LayoutSection[]}{
  validateSnapshot(snapshot);
  const source=snapshot.files[PAGE_PATH];
  if(typeof source!=='string')return invalidLayout('Managed page is unavailable.');
  const raw:unknown=JSON.parse(source);
  if(!dataRecord(raw)||!Array.isArray(raw.sections)||raw.sections.length>32)
    return invalidLayout('Invalid managed section list.');
  const ids=new Set<string>(),keys=new Set<string>(),sections:LayoutSection[]=[];
  for(const item of raw.sections){
    if(!dataRecord(item)||typeof item.id!=='string'||typeof item.layout!=='string')
      return invalidLayout('Invalid section declaration.');
    const id=item.id;assertSlotKey(id);
    const pinned=portfolioLayout(item.layout);
    if(!pinned||ids.has(id))return invalidLayout('Unknown or duplicate section layout.');
    ids.add(id);
    const full=pinned.slots.map(name=>id+'-'+name.toLowerCase());
    if(Object.hasOwn(item,'slots')===Object.hasOwn(item,'slotKeys'))
      return invalidLayout('Section must declare exactly one slot representation.');
    if(Object.hasOwn(item,'slotKeys')){
      const names=item.slotKeys;
      if(!Array.isArray(names)||names.length!==pinned.slots.length||
        new Set(names).size!==names.length||pinned.slots.some(name=>!names.includes(name)))
        return invalidLayout('Section slot manifest does not match its pinned layout.');
    }else{
      const legacy=item.slots;
      if(!dataRecord(legacy)||Object.keys(legacy).length!==pinned.slots.length||
        pinned.slots.some(name=>!Object.hasOwn(legacy,name)))
        return invalidLayout('Legacy slots do not match the pinned layout.');
      for(const name of pinned.slots){
        const saved=snapshot.slots[id+'-'+name.toLowerCase()],value=legacy[name];
        if(value===null){
          if(saved?.state!=='EMPTY')return invalidLayout('Legacy slot disagrees with saved assignment.');
        }else if(!exactFields(value,['use'])||!dataRecord(value)||typeof value.use!=='string'||
          saved?.state!=='S0'||saved.componentId!==value.use)
          return invalidLayout('Legacy slot contains unsupported or nonmatching data; preserve it before changing layout.');
      }
    }
    for(const key of full){
      assertSlotKey(key);
      if(keys.has(key)||!Object.hasOwn(snapshot.slots,key))
        return invalidLayout('Missing or ambiguous declared slot.');
      keys.add(key);
    }
    sections.push({id,layout:item.layout,raw:item,keys:full,names:pinned.slots});
  }
  return {page:raw,sections};
}
function assignmentFits(assignment:SlotAssignment,kind:string):boolean{
  const pin=assignment.componentId;
  return typeof pin==='string'&&(pin==='image@1'?
    assignment.state==='S0'&&mediaKinds.includes(kind):
    Object.hasOwn(libraryKinds,pin)&&libraryKinds[pin]!.includes(kind));
}
function stashComplete(next:PortfolioSnapshot,key:string,assignment:SlotAssignment):void{
  const history=Object.hasOwn(next.stashes,key)?next.stashes[key]!: [];
  next.stashes[key]=[...history,structuredClone(assignment)];
}
function relocationPath(key:string,operationId:string):string{
  return 'slots/'+key+'/owned/'+operationId+'/component-source.tsx';
}
/** A new path is necessary because provenance is bound to the original slot.
 * Never rename/delete original files or normalize opaque source. */
function relocateOwned(next:PortfolioSnapshot,assignment:SlotAssignment,to:string,operationId:string):SlotAssignment{
  const old=assignment.sourcePath;
  if(!old||!old.endsWith('.tsx')||!Object.hasOwn(next.files,old))
    return invalidLayout('Only compatible owned TSX may relocate. Stash unsupported source instead.');
  const path=relocationPath(to,operationId);
  assertOwnedSourcePath(path);
  if(Object.hasOwn(next.files,path))return invalidLayout('Owned relocation path already exists.');
  next.files[path]=next.files[old]!;
  return {...structuredClone(assignment),sourcePath:path};
}
function constructLayoutChange(head:EditorHead,request:LayoutMappingRequest,operationId:string):{
  plan:LayoutChangePlan;snapshot:PortfolioSnapshot
}{
  if(!exactFields(request,['sectionId','expectedLayout','targetLayout','mappings'])||
    typeof request.sectionId!=='string'||typeof request.expectedLayout!=='string'||
    typeof request.targetLayout!=='string'||!Array.isArray(request.mappings)||request.mappings.length>8)
    return invalidLayout('Invalid bounded layout mapping.');
  const {page,sections}=layoutManifest(head.snapshot);
  const section=sections.find(item=>item.id===request.sectionId);
  const target=portfolioLayout(request.targetLayout);
  if(!section||section.layout!==request.expectedLayout||!target||section.layout===request.targetLayout)
    return invalidLayout('Select a different pinned layout for the current section.');
  const next=structuredClone(head.snapshot);
  const targetKeys=target.slots.map(name=>section.id+'-'+name.toLowerCase());
  const oldKeys=new Set(section.keys),otherKeys=new Set(sections.filter(s=>s!==section).flatMap(s=>s.keys));
  for(const key of targetKeys){
    assertSlotKey(key);
    if(otherKeys.has(key)||(!oldKeys.has(key)&&Object.hasOwn(next.slots,key)))
      return invalidLayout('A target slot collides with another assignment.');
  }
  const filled=section.keys.filter(key=>head.snapshot.slots[key]!.state!=='EMPTY');
  if(request.mappings.length!==filled.length)return invalidLayout('Choose a destination or stash for every assigned slot.');
  const taken=new Set<string>(),rows:LayoutChangePlan['rows']=[],stashedKeys:string[]=[];
  const beforeFileCount=Object.keys(next.files).length;
  let relocation=false;
  for(const key of section.keys)delete next.slots[key];
  for(const key of targetKeys)next.slots[key]={state:'EMPTY',content:{}};
  for(let index=0;index<filled.length;index++){
    const from=filled[index]!,row=request.mappings[index];
    if(!row||!exactFields(row,['fromSlotKey','toSlotKey'])||row.fromSlotKey!==from||
      (row.toSlotKey!==null&&typeof row.toSlotKey!=='string'))
      return invalidLayout('Mapping must list each assigned source exactly once in manifest order.');
    const assignment=head.snapshot.slots[from]!,to=row.toSlotKey;
    let disposition:LayoutChangePlan['rows'][number]['disposition'];
    if(to===null){
      stashComplete(next,from,assignment);stashedKeys.push(from);disposition='stash';
    }else{
      const position=targetKeys.indexOf(to);
      if(position<0||taken.has(to))return invalidLayout('Choose a unique declared destination in this section.');
      if(!assignmentFits(assignment,target.slots[position]!.toLowerCase()))
        return invalidLayout('Incompatible pinned assignment; choose a compatible slot or stash it.');
      taken.add(to);
      if(from!==to&&isOwned(assignment)){
        next.slots[to]=relocateOwned(next,assignment,to,operationId);
        stashComplete(next,from,assignment);stashedKeys.push(from);relocation=true;disposition='relocate';
      }else{
        next.slots[to]=structuredClone(assignment);disposition=from===to?'retain':'move';
      }
    }
    rows.push({fromSlotKey:from,toSlotKey:to,componentId:assignment.componentId!,
      state:assignment.state,fields:Object.keys(assignment.content).sort(),disposition,
      ...(assignment.sourcePath?{sourcePath:assignment.sourcePath,
        sourceBytes:new TextEncoder().encode(head.snapshot.files[assignment.sourcePath]!).byteLength}:{})});
  }
  // Only this managed section's representation changes. Unknown sibling and
  // top-level fields survive; Undo retains the exact original page string.
  const {slots:_legacy,slotKeys:_oldNames,...other}=section.raw;
  next.files[PAGE_PATH]=JSON.stringify({...page,sections:sections.map(item=>item===section?
    {...other,layout:request.targetLayout,slotKeys:target.slots}:item.raw)});
  validateSnapshot(next);
  return {snapshot:next,plan:{expectedRevision:head.revision,sectionId:section.id,
    expectedLayout:section.layout,targetLayout:request.targetLayout,rows,targetKeys,
    emptyTargetKeys:targetKeys.filter(key=>!taken.has(key)),stashedKeys,
    addedFiles:Object.keys(next.files).length-beforeFileCount,
    addedStashAssignments:stashedKeys.length,requiresStashConfirmation:stashedKeys.length>0,
    requiresOwnedRelocationConfirmation:relocation}};
}
/** Preview uses an unused synthetic UUID only inside a disposable clone.
 * No source bytes, real operation ID or mutable snapshot are returned. The
 * real transaction repeats collision and quota checks for its own UUID. */
export function planSectionLayoutChange(head:EditorHead,request:LayoutMappingRequest):LayoutChangePlan{
  let id='';
  for(let n=0;n<=100;n++){
    const candidate='00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
    if(!Object.keys(head.snapshot.files).some(path=>path.includes('/owned/'+candidate+'/'))){
      id=candidate;break;
    }
  }
  if(!id)return invalidLayout('No safe relocation preview path.');
  return constructLayoutChange(head,request,id).plan;
}
function restoreLayoutAssignment(head:EditorHead,next:PortfolioSnapshot,intent:RestoreLayoutStashIntent,operationId:string):void{
  assertSlotKey(intent.fromSlotKey);assertSlotKey(intent.toSlotKey);
  const {sections}=layoutManifest(head.snapshot);
  const target=sections.flatMap(section=>section.keys.map((key,i)=>({key,kind:section.names[i]!.toLowerCase()})))
    .filter(item=>item.key===intent.toSlotKey);
  const stash=Object.hasOwn(next.stashes,intent.fromSlotKey)?next.stashes[intent.fromSlotKey]:undefined;
  if(target.length!==1||next.slots[intent.toSlotKey]?.state!=='EMPTY'||!stash||
    !Number.isSafeInteger(intent.stashIndex)||intent.stashIndex<0||intent.stashIndex>=stash.length)
    return invalidLayout('Restore requires one available stash entry and a declared empty target.');
  const saved=stash[intent.stashIndex]!;
  if(saved.state==='EMPTY'||!assignmentFits(saved,target[0]!.kind))
    return invalidLayout('Stashed assignment is incompatible with this target.');
  if(intent.fromSlotKey!==intent.toSlotKey&&isOwned(saved)){
    if(!intent.confirmOwnedRelocation)return invalidLayout('Explicit owned-source relocation confirmation is required.');
    next.slots[intent.toSlotKey]=relocateOwned(next,saved,intent.toSlotKey,operationId);
  }else next.slots[intent.toSlotKey]=structuredClone(saved);
  const remaining=stash.filter((_item,i)=>i!==intent.stashIndex);
  if(remaining.length)next.stashes[intent.fromSlotKey]=remaining;else delete next.stashes[intent.fromSlotKey];
}

/**
 * Runtime-facing commands must match their discriminated contracts exactly.
 * Unknown actions previously produced a successful no-op revision, while
 * JSON property order could make an identical retry look like an ID conflict.
 */

export type ScopedThemeMode='light'|'dark';
export type ScopedThemeBreakpoint='phone'|'tablet'|'desktop';
export type ScopedThemeLayer='base'|ScopedThemeBreakpoint;
export type ScopedThemeScope={kind:'global'}|{kind:'template'|'section'|'component';id:string};
export type ScopedThemeTokens={surface?:string;text?:string;accent?:string;fontSizePx?:number;lineHeight?:number;fontWeight?:400|500|600|700;spacingPx?:number;radiusPx?:number};
export type ScopedThemeKey=keyof ScopedThemeTokens;
export type ScopedThemeEdit={ [K in ScopedThemeKey]-?:{kind:'set';key:K;value:NonNullable<ScopedThemeTokens[K]>} }[ScopedThemeKey]|{kind:'reset';key:ScopedThemeKey};
export type EditScopedThemeIntent={kind:'EDIT_SCOPED_THEME';expectedRevision:number;mode:ScopedThemeMode;scope:ScopedThemeScope;layer:ScopedThemeLayer;edit:ScopedThemeEdit};
type ScopedThemeEntry={mode:ScopedThemeMode;scope:ScopedThemeScope;base?:ScopedThemeTokens;breakpoints?:Partial<Record<ScopedThemeBreakpoint,ScopedThemeTokens>>;active:boolean};
type ScopedThemeIssue={code:string;scope?:ScopedThemeScope;mode?:ScopedThemeMode;layer?:ScopedThemeLayer;key?:string};
export type ScopedThemeParse={status:'legacy'|'valid'|'blocked';mode:ScopedThemeMode|null;issues:ReadonlyArray<ScopedThemeIssue>;entries:ReadonlyArray<ScopedThemeEntry>};
export type ScopedThemeTarget={mode:ScopedThemeMode;sectionId?:string;slotKey?:string;widthPx:number};
export type ScopedThemeResolution={status:'resolved'|'blocked';breakpoint:ScopedThemeBreakpoint|null;tokens:ScopedThemeTokens;origins:Partial<Record<ScopedThemeKey,{scope:ScopedThemeScope|{kind:'palette'};layer:ScopedThemeLayer}>>;issues:ReadonlyArray<ScopedThemeIssue>};
const THEME_FILE='theme/tokens.json';
const scopedModes=['light','dark'] as const;
const scopedBuckets=['phone','tablet','desktop'] as const;
const scopedNames=['surface','text','accent','fontSizePx','lineHeight','fontWeight','spacingPx','radiusPx'] as const;
const scopedCss:Record<ScopedThemeKey,string>={surface:'--k-theme-surface',text:'--k-theme-text',accent:'--k-theme-accent',fontSizePx:'--k-theme-font-size',lineHeight:'--k-theme-line-height',fontWeight:'--k-theme-font-weight',spacingPx:'--k-theme-spacing',radiusPx:'--k-theme-radius'};
const themePresets=new Set(['arc','collage','editorial','stairs','studio','blank']);
const themeError=():never=>{throw new ContractError('VALIDATION','Invalid or unsupported scoped theme.');};
const isThemeMode=(x:unknown):x is ScopedThemeMode=>x==='light'||x==='dark';
const isThemeBucket=(x:unknown):x is ScopedThemeBreakpoint=>x==='phone'||x==='tablet'||x==='desktop';
const isThemeKey=(x:unknown):x is ScopedThemeKey=>typeof x==='string'&&(scopedNames as readonly string[]).includes(x);
function themeValue(k:ScopedThemeKey,v:unknown):boolean{
  if(k==='surface'||k==='text'||k==='accent')return typeof v==='string'&&/^#[a-fA-F0-9]{6}$/.test(v);
  if(typeof v!=='number'||!Number.isFinite(v))return false;
  if(k==='lineHeight')return v>=1&&v<=2;
  if(!Number.isInteger(v))return false;
  if(k==='fontWeight')return [400,500,600,700].includes(v);
  if(k==='fontSizePx')return v>=12&&v<=72;
  return v>=0&&v<=(k==='radiusPx'?32:64);
}
function themeRecord(x:unknown):x is Record<string,unknown>{return dataRecord(x);}
function themeScope(x:unknown):ScopedThemeScope|null{
  if(!themeRecord(x))return null;
  if(x.kind==='global'&&exactFields(x,['kind']))return {kind:'global'};
  if((x.kind==='template'||x.kind==='section'||x.kind==='component')&&exactFields(x,['kind','id'])&&
    typeof x.id==='string'&&SLOT_KEY.test(x.id)&&!RESERVED_KEYS.has(x.id))return {kind:x.kind,id:x.id};
  return null;
}
/** Place one existing section before another, or at the end. No IDs,
 * assignments, source files, stashes, or scope keys are rewritten. */
function reorderSectionBefore(sections:readonly LayoutSection[],sectionId:string,beforeSectionId:string|null):LayoutSection[]{
  assertSlotKey(sectionId);
  if(beforeSectionId!==null)assertSlotKey(beforeSectionId);
  if(sectionId===beforeSectionId)return invalidLayout('Choose a different destination.');
  const from=sections.findIndex(section=>section.id===sectionId);
  if(from<0)return invalidLayout('Selected section does not exist.');
  const next=sections.filter(section=>section.id!==sectionId);
  const to=beforeSectionId===null?next.length:next.findIndex(section=>section.id===beforeSectionId);
  if(to<0)return invalidLayout('Destination section does not exist.');
  next.splice(to,0,sections[from]!);
  if(next.every((section,index)=>section.id===sections[index]?.id))
    return invalidLayout('Section is already in this position.');
  return next;
}
function themeScopeKey(scope:ScopedThemeScope):string{return scope.kind==='global'?'global':scope.kind+':'+scope.id;}
function themeGraph(snapshot:PortfolioSnapshot):{preset:string|null;sections:LayoutSection[]}{
  validateSnapshot(snapshot);
  const manifest:unknown=JSON.parse(snapshot.files['kadmeion.json']??'null');
  const preset=themeRecord(manifest)&&typeof manifest.preset==='string'&&themePresets.has(manifest.preset)?manifest.preset:null;
  const page:unknown=JSON.parse(snapshot.files[PAGE_PATH]??'null');
  const sections=themeRecord(page)&&Object.hasOwn(page,'sections')?layoutManifest(snapshot).sections:[];
  return {preset,sections};
}
function themeActive(scope:ScopedThemeScope,graph:ReturnType<typeof themeGraph>):boolean{
  if(scope.kind==='global')return true;
  if(scope.kind==='template')return graph.preset===scope.id;
  if(scope.kind==='section')return graph.sections.some(s=>s.id===scope.id);
  return graph.sections.some(s=>s.keys.includes(scope.id));
}
function themePalette(raw:unknown):ScopedThemeTokens|null{
  if(!themeRecord(raw))return null;
  const {surface,text,accent}=raw;
  if(typeof surface!=='string'||typeof text!=='string'||typeof accent!=='string'||
    !themeValue('surface',surface)||!themeValue('text',text)||!themeValue('accent',accent))return null;
  return {surface,text,accent};
}
function themePatch(raw:unknown):ScopedThemeTokens|null{
  if(!themeRecord(raw))return null;
  const patch:Record<string,unknown>={};
  for(const [k,v] of Object.entries(raw)){
    if(!isThemeKey(k)||!themeValue(k,v))return null;
    patch[k]=v;
  }
  return patch as ScopedThemeTokens;
}
function themeBounded(raw:unknown):boolean{
  if(new TextEncoder().encode(JSON.stringify(raw)).byteLength>65536)return false;
  const stack=[{value:raw,depth:0}];
  while(stack.length){
    const {value,depth}=stack.pop()!;
    if(depth>8)return false;
    if(value&&typeof value==='object')
      for(const [key,child] of Object.entries(value)){
        if(RESERVED_KEYS.has(key))return false;
        stack.push({value:child,depth:depth+1});
      }
  }
  return true;
}
export function scopedThemeBreakpoint(widthPx:number):ScopedThemeBreakpoint|null{
  return Number.isFinite(widthPx)&&widthPx>0?(widthPx<=600?'phone':widthPx<=950?'tablet':'desktop'):null;
}
/** Validation is separate from private storage; never normalize an imported document. */
export function parseScopedTheme(snapshot:PortfolioSnapshot):ScopedThemeParse{
  const issues:ScopedThemeIssue[]=[],entries:ScopedThemeEntry[]=[];
  let mode:ScopedThemeMode|null=null;
  const result=(status:ScopedThemeParse['status']):ScopedThemeParse=>({status,mode,issues,entries});
  try{
    const source=snapshot.files[THEME_FILE];
    if(source===undefined)return result('legacy');
    validateManagedJson(THEME_FILE,source);
    const raw:unknown=JSON.parse(source);
    if(!themeRecord(raw))return result('blocked');
    mode=isThemeMode(raw.mode)?raw.mode:null;
    if(!Object.hasOwn(raw,'scopedTokens'))return result('legacy');
    if(!mode||!themePalette(raw)){issues.push({code:'INVALID_PALETTE'});return result('blocked');}
    const doc=raw.scopedTokens;
    if(!themeRecord(doc)||doc.version!==1||Object.keys(doc).some(k=>!['version','light','dark'].includes(k))||!themeBounded(doc)){
      issues.push({code:'UNSUPPORTED_SCOPED_DOCUMENT'});return result('blocked');
    }
    const graph=themeGraph(snapshot);
    let count=0,blocked=false;
    for(const m of scopedModes){
      if(!Object.hasOwn(doc,m))continue;
      const list=doc[m];
      if(!Array.isArray(list)||(count+=list.length)>128){issues.push({code:'SCOPED_ENTRY_LIMIT',mode:m});return result('blocked');}
      const seen=new Set<string>();
      for(const row of list){
        const scope=themeRecord(row)?themeScope(row.scope):null;
        if(!scope||!themeRecord(row)){issues.push({code:'INVALID_SCOPE',mode:m});blocked=true;continue;}
        const key=themeScopeKey(scope),active=themeActive(scope,graph);
        if(seen.has(key)){issues.push({code:'DUPLICATE_SCOPE',mode:m,scope});blocked=true;continue;}
        seen.add(key);
        const entry:ScopedThemeEntry={mode:m,scope,active};
        let invalid=Object.keys(row).some(k=>!['scope','base','breakpoints'].includes(k));
        if(Object.hasOwn(row,'base')){
          const patch=themePatch(row.base);
          if(patch)entry.base=patch;else invalid=true;
        }
        if(Object.hasOwn(row,'breakpoints')){
          if(!themeRecord(row.breakpoints)||Object.keys(row.breakpoints).some(k=>!isThemeBucket(k)))invalid=true;
          else{
            entry.breakpoints={};
            for(const bucket of scopedBuckets){
              if(!Object.hasOwn(row.breakpoints,bucket))continue;
              const patch=themePatch(row.breakpoints[bucket]);
              if(patch)entry.breakpoints[bucket]=patch;else invalid=true;
            }
          }
        }
        if(!active){issues.push({code:invalid?'UNSUPPORTED_ORPHAN':'ORPHAN_SCOPE',mode:m,scope});if(!invalid)entries.push(entry);continue;}
        if(invalid){issues.push({code:'UNSUPPORTED_ACTIVE_SCOPE',mode:m,scope});blocked=true;continue;}
        entries.push(entry);
      }
    }
    return result(blocked?'blocked':'valid');
  }catch{issues.push({code:'INVALID_SCOPED_GRAPH'});return result('blocked');}
}
export function resolveScopedTheme(snapshot:PortfolioSnapshot,target:ScopedThemeTarget):ScopedThemeResolution{
  return resolveTheme(snapshot,target,false);
}
/** Base-only fallback for CSS engines with no container query support.
 * Does not use a representative responsive bucket or invent default tokens. */
export function resolveScopedThemeBase(snapshot:PortfolioSnapshot,target:ScopedThemeTarget):ScopedThemeResolution{
  return resolveTheme(snapshot,target,true);
}
function resolveTheme(snapshot:PortfolioSnapshot,target:ScopedThemeTarget,baseOnly:boolean):ScopedThemeResolution{
  const parsed=parseScopedTheme(snapshot);
  const breakpoint=scopedThemeBreakpoint(target.widthPx);
  const tokens:ScopedThemeTokens={},origins:ScopedThemeResolution['origins']={};
  const issues=[...parsed.issues];
  const result=(status:ScopedThemeResolution['status']):ScopedThemeResolution=>({status,breakpoint,tokens,origins,issues});
  if(parsed.status==='blocked'||!breakpoint||!isThemeMode(target.mode))return result('blocked');
  try{
    const graph=themeGraph(snapshot);
    const raw:unknown=JSON.parse(snapshot.files[THEME_FILE]??'null');
    if(!themeRecord(raw))return result('blocked');
    const palette=themePalette(target.mode===raw.mode?raw:themeRecord(raw.authorModePalettes)?raw.authorModePalettes[target.mode]:null);
    if(!palette)return result('blocked');
    let section=target.sectionId===undefined?undefined:graph.sections.find(s=>s.id===target.sectionId);
    if(target.sectionId!==undefined&&!section)return result('blocked');
    if(target.slotKey!==undefined){
      const parent=graph.sections.find(s=>s.keys.includes(target.slotKey!));
      if(!parent||(section&&parent!==section))return result('blocked');
      section=parent;
    }
    const merge=(patch:ScopedThemeTokens|undefined,scope:ScopedThemeScope|{kind:'palette'},layer:ScopedThemeLayer)=>{
      if(!patch)return;
      Object.assign(tokens,patch);
      for(const key of scopedNames)if(Object.hasOwn(patch,key))origins[key]={scope,layer};
    };
    merge(palette,{kind:'palette'},'base');
    const scopes:ScopedThemeScope[]=[{kind:'global'}];
    if(graph.preset)scopes.push({kind:'template',id:graph.preset});
    if(section)scopes.push({kind:'section',id:section.id});
    if(target.slotKey!==undefined)scopes.push({kind:'component',id:target.slotKey});
    for(const scope of scopes){
      const row=parsed.entries.find(e=>e.active&&e.mode===target.mode&&themeScopeKey(e.scope)===themeScopeKey(scope));
      merge(row?.base,scope,'base');if(!baseOnly)merge(row?.breakpoints?.[breakpoint],scope,breakpoint);
    }
    return result('resolved');
  }catch{return result('blocked');}
}
export function scopedThemeCssVariables(tokens:ScopedThemeTokens):Readonly<Record<string,string>>{
  const validated=themePatch(tokens);
  if(!validated)return themeError();
  const output:Record<string,string>={};
  for(const key of scopedNames){
    const value=validated[key];
    if(value!==undefined)output[scopedCss[key]]=String(value)+(['fontSizePx','spacingPx','radiusPx'].includes(key)?'px':'');
  }
  return output;
}
function themeCanonical(value:unknown):string{
  const normalize=(v:unknown):unknown=>Array.isArray(v)?v.map(normalize):themeRecord(v)?
    Object.fromEntries(Object.keys(v).sort().map(k=>[k,normalize(v[k])])):v;
  return JSON.stringify(normalize(value))??'';
}
function assertUnchangedScopedTheme(before:string|undefined,after:string){
  const old=before===undefined?{}:JSON.parse(before);
  const next=JSON.parse(after);
  if(themeCanonical(old.scopedTokens)!==themeCanonical(next.scopedTokens))themeError();
}
function editScopedTheme(head:EditorHead,next:PortfolioSnapshot,intent:EditScopedThemeIntent):void{
  assertBaseRevision(intent.expectedRevision,head.revision);
  const scope=themeScope(intent.scope),edit=intent.edit;
  if(!scope||!isThemeMode(intent.mode)||!(intent.layer==='base'||isThemeBucket(intent.layer))||
    !themeRecord(edit)||!isThemeKey(edit.key)||
    !(edit.kind==='set'&&exactFields(edit,['kind','key','value'])&&themeValue(edit.key,edit.value)||
    edit.kind==='reset'&&exactFields(edit,['kind','key'])))return themeError();
  if(parseScopedTheme(head.snapshot).status==='blocked'||!themeActive(scope,themeGraph(head.snapshot)))return themeError();
  const source=next.files[THEME_FILE];
  if(source===undefined)return themeError();
  const raw=JSON.parse(source) as Record<string,unknown>;
  if(!isThemeMode(raw.mode)||!themePalette(raw))return themeError();
  if(resolveScopedTheme(head.snapshot,{mode:intent.mode,widthPx:768}).status!=='resolved')return themeError();
  const doc=(raw.scopedTokens??{version:1}) as Record<string,unknown>;
  const list=(doc[intent.mode]??[]) as Record<string,unknown>[];
  let row=list.find(r=>{const s=themeScope(r.scope);return s&&themeScopeKey(s)===themeScopeKey(scope);});
  if(!row){
    if(edit.kind==='reset')return themeError();
    row={scope};list.push(row);
  }
  const layers=(row.breakpoints??{}) as Record<string,unknown>;
  const patch=(intent.layer==='base'?row.base:layers[intent.layer]) as Record<string,unknown>|undefined;
  const updated=patch??{};
  if(edit.kind==='reset'){
    if(!Object.hasOwn(updated,edit.key))return themeError();
    delete updated[edit.key];
  }else{
    if(Object.hasOwn(updated,edit.key)&&updated[edit.key]===edit.value)return themeError();
    updated[edit.key]=edit.value;
  }
  if(intent.layer==='base')row.base=updated;
  else{layers[intent.layer]=updated;row.breakpoints=layers;}
  doc[intent.mode]=list;raw.scopedTokens=doc;
  next.files[THEME_FILE]=JSON.stringify(raw,null,2);
  if(parseScopedTheme(next).status!=='valid')return themeError();
}

function commandDigest(command:EditorCommand):{id:string;hash:string} {
  if(!command||typeof command!=='object'||Array.isArray(command)||
     Object.keys(command).some(k=>!['operationId','baseRevision','intent'].includes(k))||
     typeof command.operationId!=='string'||!OP_ID.test(command.operationId)||
     !Number.isSafeInteger(command.baseRevision)||command.baseRevision<0)
    throw new ContractError('VALIDATION','Invalid editor transaction envelope.');
  const intent=command.intent;
  if(!intent||typeof intent!=='object'||Array.isArray(intent)||
     typeof intent.kind!=='string')
    throw new ContractError('VALIDATION','Invalid editor transaction intent.');
  const fields:Record<string,readonly string[]>={
    WRITE_MANAGED_FILE:['kind','path','source'],
    EDIT_SCOPED_THEME:['kind','expectedRevision','mode','scope','layer','edit'],
    ADD_SECTION:['kind','layout'],
    MOVE_SECTION:['kind','sectionId','direction'],
    MOVE_SECTION_BEFORE:['kind','sectionId','beforeSectionId','expectedRevision'],
    CHANGE_SECTION_LAYOUT:['kind','sectionId','expectedLayout','targetLayout','mappings','expectedRevision','confirmStash','confirmOwnedRelocation'],
    RESTORE_LAYOUT_STASH:['kind','fromSlotKey','stashIndex','toSlotKey','expectedRevision','confirmOwnedRelocation'],
    CLEAR_SLOT:['kind','slotKey'],
    ASSIGN_COMPONENT:['kind','slotKey','componentId','confirmOwnedReplacement','preserveMatchingContent'],
    UPDATE_CONTENT:['kind','slotKey','content'],
    PLACE_PRIVATE_IMAGE:['kind','slotKey','assetId','altText'],
    CUSTOMIZE_COMPONENT:['kind','slotKey','copiedSource'],
    REUSE_SAVED_COMPONENT:['kind','slotKey','componentVersionId','confirmOwnedReplacement','preserveMatchingContent'],
    EDIT_OWNED_SOURCE:['kind','slotKey','source'],
    RESTORE_STASH:['kind','slotKey','stashIndex'],
    UNDO:['kind'],
    REDO:['kind']
  };
  const permitted=Object.hasOwn(fields,intent.kind)?fields[intent.kind]:undefined;
  if(!permitted||
     Object.keys(intent).some(k=>!permitted.includes(k))||
     ('confirmOwnedReplacement' in intent &&
       typeof intent.confirmOwnedReplacement!=='boolean')||
     ('preserveMatchingContent' in intent&&typeof intent.preserveMatchingContent!=='boolean'))
    throw new ContractError('VALIDATION','Unknown editor command kind or properties.');
  // Canonicalize only JSON commands, never source strings or managed file
  // bytes. Normalized UUID case is part of the idempotency key.
  const sort=(value:unknown):unknown=>{
    if(Array.isArray(value))return value.map(sort);
    if(value!==null&&typeof value==='object'){
      const obj=Object.create(null) as Record<string,unknown>;
      for(const key of Object.keys(value).sort()){
        if(['__proto__','constructor','prototype'].includes(key))
          throw new ContractError('VALIDATION','Unsafe command property.');
        obj[key]=sort((value as Record<string,unknown>)[key]);
      }
      return obj;
    }
    return value;
  };
  let hash:string;
  try{hash=JSON.stringify(sort({...command,operationId:command.operationId.toLowerCase()}));}
  catch{throw new ContractError('VALIDATION','Invalid or cyclic editor operation.');}
  if(hash.length>300000)
    throw new ContractError('VALIDATION','Editor operation exceeds safe limits.');
  return {id:command.operationId.toLowerCase(),hash};
}

export function applyEditorTransaction(head: EditorHead, command: EditorCommand, trustedLibrarySources: Readonly<Record<string,string>> = {},
  ownerSavedComponents: Readonly<Record<string,MyComponentVersion>> = {}): EditorHead {
  const {id:operationId,hash:intentHash}=commandDigest(command);
  const seen = Object.hasOwn(head.operations,operationId) ?
    head.operations[operationId] : head.operations[command.operationId];
  if (seen !== undefined) {
    // Older browser drafts persisted JSON.stringify(command) with insertion
    // order. Accept an EXACT semantic replay without rewriting the old head;
    // never accept a genuinely different intent with the same operation ID.
    let equivalent=seen===intentHash;
    if(!equivalent&&typeof seen==='string'&&seen.length<=300000){
      try{equivalent=commandDigest(JSON.parse(seen) as EditorCommand).hash===intentHash;}
      catch{equivalent=false;}
    }
    if(!equivalent)
      throw new ContractError('VALIDATION', 'Operation ID reused with different content.');
    return head; // idempotent duplicate; no new version
  }
  assertBaseRevision(command.baseRevision,head.revision);
  let next = structuredClone(head.snapshot);
  const intent = command.intent;
  if (intent.kind==='UNDO' || intent.kind==='REDO') {
    const source = intent.kind==='UNDO'?head.undo:head.redo;
    const previous = source.at(-1);
    if (!previous) throw new ContractError('VALIDATION', 'No revision available to restore.');
    const selected = structuredClone(previous);
    validateSnapshot(selected);
    return {
      revision:head.revision+1, snapshot:selected,
      undo:intent.kind==='UNDO'?source.slice(0,-1):[...head.undo,structuredClone(head.snapshot)],
      redo:intent.kind==='REDO'?source.slice(0,-1):[...head.redo,structuredClone(head.snapshot)],
      operations:{...head.operations,[operationId]:intentHash}
    };
  }

  if (intent.kind==='WRITE_MANAGED_FILE') {
    validateManagedJson(intent.path,intent.source);
    if(intent.path===THEME_FILE)assertUnchangedScopedTheme(head.snapshot.files[THEME_FILE],intent.source);
    next.files[intent.path]=intent.source; // exact user bytes; no implicit formatting
  } else if(intent.kind==='EDIT_SCOPED_THEME'){
    editScopedTheme(head,next,intent);
  } else if(intent.kind==='CHANGE_SECTION_LAYOUT'){
    assertBaseRevision(intent.expectedRevision,head.revision);
    if(typeof intent.confirmStash!=='boolean'||typeof intent.confirmOwnedRelocation!=='boolean')
      return invalidLayout('Explicit layout confirmation flags are required.');
    const {sectionId,expectedLayout,targetLayout,mappings}=intent;
    const result=constructLayoutChange(head,{sectionId,expectedLayout,targetLayout,mappings},operationId);
    if(result.plan.requiresStashConfirmation&&!intent.confirmStash)
      return invalidLayout('Confirm preservation of unplaced or relocated assignments in the stash.');
    if(result.plan.requiresOwnedRelocationConfirmation&&!intent.confirmOwnedRelocation)
      return invalidLayout('Confirm byte-identical owned source relocation; relative imports may no longer resolve.');
    next=result.snapshot;
  } else if(intent.kind==='RESTORE_LAYOUT_STASH'){
    assertBaseRevision(intent.expectedRevision,head.revision);
    if(typeof intent.confirmOwnedRelocation!=='boolean')return invalidLayout('Explicit relocation flag is required.');
    restoreLayoutAssignment(head,next,intent,operationId);
  } else if (intent.kind==='ADD_SECTION') {
    const layout=portfolioLayout(intent.layout);
    const path='pages/home.page.json';
    const original=next.files[path];
    if(!layout || typeof original!=='string')
      throw new ContractError('VALIDATION','Choose an available section layout.');
    validateManagedJson(path, original);
    const page=JSON.parse(original) as Record<string,unknown>;
    if(!Array.isArray(page.sections)||page.sections.length>=32)
      throw new ContractError('VALIDATION','This page cannot accept another section.');
    const id='section-'+operationId;
    if(page.sections.some(row=>row && typeof row==='object' && row.id===id))
      throw new ContractError('VALIDATION','Section already exists.');
    for(const name of layout.slots){
      const key=id+'-'+name.toLowerCase();
      if(Object.hasOwn(next.slots,key))throw new ContractError('VALIDATION','Section slot already exists.');
      next.slots[key]={state:'EMPTY',content:{}};
    }
    next.files[path]=JSON.stringify({...page,sections:[...page.sections,{id,layout:intent.layout,slotKeys:layout.slots}]});
  } else if(intent.kind==='MOVE_SECTION_BEFORE'){
    assertBaseRevision(intent.expectedRevision,head.revision);
    const {page,sections}=layoutManifest(head.snapshot);
    const moved=reorderSectionBefore(sections,intent.sectionId,intent.beforeSectionId);
    next.files[PAGE_PATH]=JSON.stringify({...page,sections:moved.map(section=>section.raw)});
  } else if (intent.kind==='MOVE_SECTION') {
    const path='pages/home.page.json';
    const original=next.files[path];
    if(typeof original!=='string'||typeof intent.sectionId!=='string'||
       !/^[a-z0-9_-]{1,64}$/.test(intent.sectionId)||
       !['up','down'].includes(intent.direction))
      throw new ContractError('VALIDATION','Invalid section reorder request.');
    validateManagedJson(path,original);
    const page=JSON.parse(original) as {sections?:Array<{id:string;layout:string}>;[key:string]:unknown};
    if(!Array.isArray(page.sections))
      throw new ContractError('VALIDATION','No authored sections can be reordered.');
    const position=page.sections.findIndex(section=>section.id===intent.sectionId);
    const target=position+(intent.direction==='up'?-1:1);
    if(position<0||target<0||target>=page.sections.length)
      throw new ContractError('VALIDATION','Selected section cannot move in this direction.');
    const moved=page.sections.slice();
    [moved[position],moved[target]]=[moved[target]!,moved[position]!];
    next.files[path]=JSON.stringify({...page,sections:moved});
  } else {
    assertSlotKey(intent.slotKey);
    const slot = Object.hasOwn(next.slots,intent.slotKey) ? next.slots[intent.slotKey] : undefined;
    if (!slot) throw new ContractError('VALIDATION', 'Unknown slot.');
    const stash = next.stashes[intent.slotKey] ?? [];
    switch(intent.kind) {
      case 'CLEAR_SLOT':
        if (slot.state==='EMPTY') throw new ContractError('VALIDATION', 'Slot is already empty.');
        stash.push(structuredClone(slot));
        next.stashes[intent.slotKey]=stash;
        next.slots[intent.slotKey]={state:'EMPTY',content:{}};
        break;
      case 'ASSIGN_COMPONENT':
        if (!COMPONENT_PIN.test(intent.componentId)) throw new ContractError('VALIDATION', 'Unpinned component.');
        if(declaredLayoutSlotKind(next,intent.slotKey)!==undefined&&!canAssignCompatibleComponent(next,intent.slotKey,intent.componentId))
          throw new ContractError('VALIDATION','Component is incompatible with the declared layout slot. Use private image placement for media.');
        if (isOwned(slot) && !intent.confirmOwnedReplacement)
          throw new ContractError('VALIDATION', 'Owned source needs explicit replace-and-stash confirmation.');
        if (slot.state!=='EMPTY') stash.push(structuredClone(slot));
        next.stashes[intent.slotKey]=stash;
        next.slots[intent.slotKey]={state:'S0',componentId:intent.componentId,
          content:intent.preserveMatchingContent?matchingReplacementContent(slot,intent.componentId):{}};
        break;
      case 'UPDATE_CONTENT':
        if (slot.state==='EMPTY') throw new ContractError('VALIDATION', 'Assign a component first.');
        validateContent(intent.content);
        next.slots[intent.slotKey]={...slot,content:{...slot.content,...intent.content}};
        break;
      case 'PLACE_PRIVATE_IMAGE': {
        if(!canPlacePrivateImage(next,intent.slotKey))
          throw new ContractError('VALIDATION','Choose an empty or pristine image-compatible layout slot. Owned source needs protected replacement.');
        if(typeof intent.assetId!=='string'||!OP_ID.test(intent.assetId)||
           typeof intent.altText!=='string'||!intent.altText.trim()||intent.altText.length>300||
           /[\x00-\x1f\x7f]/.test(intent.altText))
          throw new ContractError('VALIDATION','Choose an owner-verified asset and descriptive alt text (1–300 characters).');
        const assetId=intent.assetId.toLowerCase(),altText=intent.altText.trim();
        const content:Record<string,string>={asset_id:assetId,alt_text:altText};
        // Preserve an existing pin only for the exact same asset; new metadata
        // must not fabricate or inherit a digest belonging to different bytes.
        if(slot.state==='S0'&&slot.content.asset_id===assetId&&
           /^[0-9a-f]{64}$/.test(slot.content.source_sha256??''))
          content.source_sha256=slot.content.source_sha256!;
        if(slot.state!=='EMPTY'){
          stash.push(structuredClone(slot));next.stashes[intent.slotKey]=stash;
        }
        next.slots[intent.slotKey]={state:'S0',componentId:'image@1',content};
        break;
      }
      case 'CUSTOMIZE_COMPONENT': {
        if (slot.state!=='S0' || !slot.componentId)
          throw new ContractError('VALIDATION', 'Only a trusted library component can be customized.');
        if (!Object.hasOwn(trustedLibrarySources, slot.componentId) ||
            trustedLibrarySources[slot.componentId] !== intent.copiedSource) {
          throw new ContractError('VALIDATION', 'Cannot claim pristine S1 without verified pinned library bytes.');
        }
        const path='slots/'+intent.slotKey+'/owned/'+command.operationId.toLowerCase()+'/component-source.tsx';
        assertOwnedSourcePath(path);
        if (new TextEncoder().encode(intent.copiedSource).byteLength>MAX_FILE_BYTES)
          throw new ContractError('VALIDATION', 'Owned source too large.');
        if (Object.hasOwn(next.files,path))
          throw new ContractError('VALIDATION', 'Existing owned file cannot be overwritten.');
        next.files[path]=intent.copiedSource;
        next.slots[intent.slotKey]={...slot,state:'S1',sourcePath:path,originalSource:intent.copiedSource};
        break;
      }
      case 'REUSE_SAVED_COMPONENT': {
        // The command contains an ID only. Never accept client-authored code
        // in an operation/event log: the caller provides a separately fetched,
        // owner-JWT-validated private version from the component service.
        const ref=intent.componentVersionId;
        if (typeof ref!=='string'||!OP_ID.test(ref))
          throw new ContractError('VALIDATION','Invalid saved component version ID.');
        const id=ref.toLowerCase();
        if (!Object.hasOwn(ownerSavedComponents,id))
          throw new ContractError('VALIDATION','Saved component must be fetched and validated.');
        const saved=ownerSavedComponents[id];
        const declaredKind=declaredLayoutSlotKind(next,intent.slotKey);
        if(declaredKind===null)throw new ContractError('VALIDATION','Saved component needs a unique declared target.');
        const kind=declaredKind===undefined?intent.slotKey.slice(intent.slotKey.lastIndexOf('-')+1):declaredKind;
        if (!saved||saved.id!==id||typeof saved.base_component_pin!=='string'||
            !COMPONENT_PIN.test(saved.base_component_pin)||
            !Array.isArray(saved.compatible_slot_kinds)||
            !saved.compatible_slot_kinds.includes(kind)||
            typeof saved.source_code!=='string'||saved.source_code.length===0||
            new TextEncoder().encode(saved.source_code).byteLength>32768||
            typeof saved.pristine_source!=='string'||saved.pristine_source.length===0||
            new TextEncoder().encode(saved.pristine_source).byteLength>32768)
          throw new ContractError('VALIDATION','Saved component is incompatible or malformed.');
        if(isOwned(slot)&&!intent.confirmOwnedReplacement)
          throw new ContractError('VALIDATION','Owned source needs explicit replace-and-stash confirmation.');
        const path='slots/'+intent.slotKey+'/owned/'+operationId+'/component-source.tsx';
        assertOwnedSourcePath(path);
        if(Object.hasOwn(next.files,path))
          throw new ContractError('VALIDATION','Existing owned file cannot be overwritten.');
        if(slot.state!=='EMPTY')stash.push(structuredClone(slot));
        next.stashes[intent.slotKey]=stash;
        next.files[path]=saved.source_code;
        // A user-saved original is not automatically a trusted library
        // signature. Reuse is S1 ONLY if the pinned source bytes are
        // independently attested by the app's immutable trusted catalogue.
        const trusted=Object.hasOwn(trustedLibrarySources,saved.base_component_pin)&&
          trustedLibrarySources[saved.base_component_pin]===saved.pristine_source;
        const pristine=trusted&&saved.source_code===saved.pristine_source;
        // If the stored source was not modified but provenance is untrusted,
        // force S2 using a non-executable comparison sentinel. The current
        // bytes remain EXACT, and no public preflight can launder them as S1.
        const marker='/* UNTRUSTED_KADMEION_SAVED_COMPONENT */';
        const fallback=saved.source_code===marker
          ?'/* UNTRUSTED_KADMEION_SAVED_COMPONENT_V2 */':marker;
        const original=pristine?saved.pristine_source:
          saved.source_code!==saved.pristine_source?saved.pristine_source:fallback;
        next.slots[intent.slotKey]={
          state:pristine?'S1':'S2',componentId:saved.base_component_pin,
          content:intent.preserveMatchingContent?matchingReplacementContent(slot,saved.base_component_pin):{},sourcePath:path,originalSource:original
        };
        break;
      }
      case 'EDIT_OWNED_SOURCE':
        if (!isOwned(slot) || !slot.sourcePath)
          throw new ContractError('VALIDATION', 'Library source is protected from editing.');
        {
          const issue=diagnoseOwnedSource(intent.source).find(item=>item.severity==='error');
          if(issue)throw new ContractError('VALIDATION',issue.message+
            (issue.line!==undefined?' Line '+issue.line+', column '+issue.column+'.':''));
        }
        next.files[slot.sourcePath]=intent.source;
        next.slots[intent.slotKey]={...slot,state:intent.source===slot.originalSource?'S1':'S2'};
        break;
      case 'RESTORE_STASH': {
        const index=intent.stashIndex===undefined?stash.length-1:intent.stashIndex;
        if(!Number.isSafeInteger(index)||index<0||index>=stash.length||slot.state!=='EMPTY')
          throw new ContractError('VALIDATION','Restore requires an empty slot and an available stash.');
        const saved=stash[index];
        if(!saved||saved.state==='EMPTY')throw new ContractError('VALIDATION','Stashed assignment unavailable.');
        // Older layoutless projects retain their original restore behavior;
        // declared layouts cannot bypass compatibility via the legacy command.
        const kind=declaredLayoutSlotKind(next,intent.slotKey);
        if(kind!==undefined&&(kind===null||!assignmentFits(saved,kind)))
          return invalidLayout('Archived assignment does not fit the current declared slot.');
        next.slots[intent.slotKey]=structuredClone(saved);
        next.stashes[intent.slotKey]=stash.filter((_item,i)=>i!==index);
        break;
      }
      default:
        throw new ContractError('VALIDATION','Unsupported editor command.');
    }
  }
  validateSnapshot(next); // all-or-nothing; head is never mutated on failure
  return {
    revision:head.revision+1,snapshot:next,
    undo:[...head.undo.slice(-29),structuredClone(head.snapshot)],redo:[],
    operations:{...head.operations,[operationId]:intentHash}
  };
}


/** Build an immutable private library input from a verified owned editor slot.
 * Never accept an invented author-code field from a click handler. The exact
 * pristine/current bytes come from the validated committed snapshot; anything
 * still in the invalid/uncommitted buffer must stay in the draft recovery UI.
 */
export function savedComponentInputFromOwnedSlot(
  snapshot:PortfolioSnapshot,slotKey:string,
  input:Pick<MyComponentInput,'operationId'|'componentKey'|'displayName'|'compatibleSlotKinds'>
):MyComponentInput {
  validateSnapshot(snapshot);
  assertSlotKey(slotKey);
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).sort().join(',')!==
      'compatibleSlotKinds,componentKey,displayName,operationId'||
    typeof input.operationId!=='string'||!OP_ID.test(input.operationId)||
    typeof input.componentKey!=='string'||
      !/^[a-z][a-z0-9-]{2,63}$/.test(input.componentKey)||
    typeof input.displayName!=='string'||
      input.displayName.trim().length<1||input.displayName.length>80||
    !Array.isArray(input.compatibleSlotKinds)||
      input.compatibleSlotKinds.length<1||input.compatibleSlotKinds.length>20||
      input.compatibleSlotKinds.some(k=>typeof k!=='string')||
      new Set(input.compatibleSlotKinds).size!==input.compatibleSlotKinds.length)
    throw new ContractError('VALIDATION','Invalid private component manifest.');
  const slot=Object.hasOwn(snapshot.slots,slotKey)?snapshot.slots[slotKey]:null;
  if(!slot||!isOwned(slot)||!slot.sourcePath||!slot.componentId||
     !slot.originalSource)
    throw new ContractError('VALIDATION','Only committed, owned component source may be saved.');
  const allowed=new Set(['title','text','cta1','cta2','note','avatar','btn1','btn2',
    'imagea','imageb','project','thumbs','media','image','badge','meta','cta',
    'text1','card','text2','items','entries']);
  const kind=slotKey.slice(slotKey.lastIndexOf('-')+1);
  if(!input.compatibleSlotKinds.includes(kind)||
     input.compatibleSlotKinds.some(k=>!allowed.has(k)))
    throw new ContractError('VALIDATION','My Component must declare compatible layout slots.');
  const source=snapshot.files[slot.sourcePath];
  if(typeof source!=='string'||source.length<1||
     new TextEncoder().encode(source).byteLength>32768||
     new TextEncoder().encode(slot.originalSource).byteLength>32768)
    throw new ContractError('VALIDATION','Owned source exceeds the private library quota.');
  return {
    operationId:input.operationId.toLowerCase(),
    componentKey:input.componentKey,displayName:input.displayName,
    baseComponentPin:slot.componentId,pristineSource:slot.originalSource,
    sourceCode:source,compatibleSlotKinds:[...input.compatibleSlotKinds].sort()
  };
}

/** Undo/redo are new committed heads; old snapshot revisions remain immutable. */
export function restoreHistoricalSnapshot(head: EditorHead, source: PortfolioSnapshot, operationId: string): EditorHead {
  validateSnapshot(source);
  if (typeof operationId!=='string'||!OP_ID.test(operationId) ||
      Object.hasOwn(head.operations,operationId.toLowerCase()) || Object.hasOwn(head.operations,operationId))
    throw new ContractError('VALIDATION','Invalid restore operation ID.');
  return {
    revision:head.revision+1,snapshot:structuredClone(source),
    undo:[...head.undo.slice(-29),structuredClone(head.snapshot)],redo:[],
    operations:{...head.operations,[operationId.toLowerCase()]:'historical-restore'}
  };
}

