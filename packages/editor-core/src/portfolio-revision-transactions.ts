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

export type EditorIntent =
  | { kind:'WRITE_MANAGED_FILE'; path:string; source:string }
  | { kind:'ADD_SECTION'; layout:string }
  | { kind:'MOVE_SECTION'; sectionId:string; direction:'up'|'down' }
  | { kind:'CLEAR_SLOT'; slotKey:string }
  | { kind:'ASSIGN_COMPONENT'; slotKey:string; componentId:string; confirmOwnedReplacement?:boolean }
  | { kind:'UPDATE_CONTENT'; slotKey:string; content:Record<string,string> }
  /** Draft metadata placement only. Never grants media-byte attestation. */
  | { kind:'PLACE_PRIVATE_IMAGE'; slotKey:string; assetId:string; altText:string }
  | { kind:'CUSTOMIZE_COMPONENT'; slotKey:string; copiedSource:string }
  | { kind:'REUSE_SAVED_COMPONENT'; slotKey:string; componentVersionId:string; confirmOwnedReplacement?:boolean }
  | { kind:'EDIT_OWNED_SOURCE'; slotKey:string; source:string }
  | { kind:'RESTORE_STASH'; slotKey:string }
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

/** A real declared media slot, not merely a key ending in "-image". */
export function canPlacePrivateImage(snapshot:PortfolioSnapshot,key:string):boolean {
  const slot=Object.hasOwn(snapshot.slots,key)?snapshot.slots[key]:undefined;
  if(!slot||(slot.state!=='EMPTY'&&(slot.state!=='S0'||slot.componentId!=='image@1')))return false;
  try{
    const page=JSON.parse(snapshot.files['pages/home.page.json']??'null') as {sections?:unknown[]}|null;
    return !!page&&Array.isArray(page.sections)&&page.sections.some(raw=>{
      if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
      const section=raw as {id?:unknown;layout?:unknown};
      if(typeof section.id!=='string'||typeof section.layout!=='string')return false;
      return portfolioLayout(section.layout)?.slots.some(name=>
        ['avatar','image','imagea','imageb','media','thumbs'].includes(name.toLowerCase())&&
        section.id+'-'+name.toLowerCase()===key)===true;
    });
  }catch{return false;}
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


/**
 * Runtime-facing commands must match their discriminated contracts exactly.
 * Unknown actions previously produced a successful no-op revision, while
 * JSON property order could make an identical retry look like an ID conflict.
 */
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
    ADD_SECTION:['kind','layout'],
    MOVE_SECTION:['kind','sectionId','direction'],
    CLEAR_SLOT:['kind','slotKey'],
    ASSIGN_COMPONENT:['kind','slotKey','componentId','confirmOwnedReplacement'],
    UPDATE_CONTENT:['kind','slotKey','content'],
    PLACE_PRIVATE_IMAGE:['kind','slotKey','assetId','altText'],
    CUSTOMIZE_COMPONENT:['kind','slotKey','copiedSource'],
    REUSE_SAVED_COMPONENT:['kind','slotKey','componentVersionId','confirmOwnedReplacement'],
    EDIT_OWNED_SOURCE:['kind','slotKey','source'],
    RESTORE_STASH:['kind','slotKey'],
    UNDO:['kind'],
    REDO:['kind']
  };
  const permitted=Object.hasOwn(fields,intent.kind)?fields[intent.kind]:undefined;
  if(!permitted||
     Object.keys(intent).some(k=>!permitted.includes(k))||
     ('confirmOwnedReplacement' in intent &&
       typeof intent.confirmOwnedReplacement!=='boolean'))
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
  const next = structuredClone(head.snapshot);
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
    next.files[intent.path]=intent.source; // exact user bytes; no implicit formatting
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
        if (isOwned(slot) && !intent.confirmOwnedReplacement)
          throw new ContractError('VALIDATION', 'Owned source needs explicit replace-and-stash confirmation.');
        if (slot.state!=='EMPTY') stash.push(structuredClone(slot));
        next.stashes[intent.slotKey]=stash;
        next.slots[intent.slotKey]={state:'S0',componentId:intent.componentId,content:{}};
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
        const kind=intent.slotKey.slice(intent.slotKey.lastIndexOf('-')+1);
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
          content:{},sourcePath:path,originalSource:original
        };
        break;
      }
      case 'EDIT_OWNED_SOURCE':
        if (!isOwned(slot) || !slot.sourcePath)
          throw new ContractError('VALIDATION', 'Library source is protected from editing.');
        if (typeof intent.source!=='string' || new TextEncoder().encode(intent.source).byteLength>MAX_FILE_BYTES)
          throw new ContractError('VALIDATION', 'Owned source too large.');
        next.files[slot.sourcePath]=intent.source;
        next.slots[intent.slotKey]={...slot,state:intent.source===slot.originalSource?'S1':'S2'};
        break;
      case 'RESTORE_STASH':
        const saved=stash.at(-1);
        if (slot.state!=='EMPTY' || !saved)
          throw new ContractError('VALIDATION', 'Restore requires an empty slot and an available stash.');
        next.slots[intent.slotKey]=saved;
        next.stashes[intent.slotKey]=stash.slice(0,-1);
        break;
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

