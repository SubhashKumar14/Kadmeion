import { ContractError, assertBaseRevision } from '../../contracts/src/index.ts';
import { assertManagedPath, assertOwnedSourcePath, validateManagedJson, MAX_FILE_BYTES } from './managed-project-files.ts';

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
  | { kind:'CLEAR_SLOT'; slotKey:string }
  | { kind:'ASSIGN_COMPONENT'; slotKey:string; componentId:string; confirmOwnedReplacement?:boolean }
  | { kind:'UPDATE_CONTENT'; slotKey:string; content:Record<string,string> }
  | { kind:'CUSTOMIZE_COMPONENT'; slotKey:string; copiedSource:string }
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
  if (!SLOT_KEY.test(key) || RESERVED_KEYS.has(key))
    throw new ContractError('VALIDATION', 'Invalid or reserved slot key.');
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

export function applyEditorTransaction(head: EditorHead, command: EditorCommand, trustedLibrarySources: Readonly<Record<string,string>> = {}): EditorHead {
  if (!OP_ID.test(command.operationId)) throw new ContractError('VALIDATION', 'Operation ID must be a UUID.');
  const intentHash = JSON.stringify(command);
  const seen = head.operations[command.operationId];
  if (seen !== undefined) {
    if (seen !== intentHash) throw new ContractError('VALIDATION', 'Operation ID reused with different content.');
    return head; // idempotent duplicate; no new version
  }
  assertBaseRevision(command.baseRevision,head.revision);
  const next = structuredClone(head.snapshot);
  const intent = command.intent;
  if (intent.kind==='UNDO' || intent.kind==='REDO') {
    const source = intent.kind==='UNDO'?head.undo:head.redo;
    if (!source.length) throw new ContractError('VALIDATION', 'No revision available to restore.');
    const selected = structuredClone(source[source.length-1]);
    validateSnapshot(selected);
    return {
      revision:head.revision+1, snapshot:selected,
      undo:intent.kind==='UNDO'?source.slice(0,-1):[...head.undo,structuredClone(head.snapshot)],
      redo:intent.kind==='REDO'?source.slice(0,-1):[...head.redo,structuredClone(head.snapshot)],
      operations:{...head.operations,[command.operationId]:intentHash}
    };
  }

  if (intent.kind==='WRITE_MANAGED_FILE') {
    validateManagedJson(intent.path,intent.source);
    next.files[intent.path]=intent.source; // exact user bytes; no implicit formatting
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
      case 'EDIT_OWNED_SOURCE':
        if (!isOwned(slot) || !slot.sourcePath)
          throw new ContractError('VALIDATION', 'Library source is protected from editing.');
        if (typeof intent.source!=='string' || new TextEncoder().encode(intent.source).byteLength>MAX_FILE_BYTES)
          throw new ContractError('VALIDATION', 'Owned source too large.');
        next.files[slot.sourcePath]=intent.source;
        next.slots[intent.slotKey]={...slot,state:intent.source===slot.originalSource?'S1':'S2'};
        break;
      case 'RESTORE_STASH':
        if (slot.state!=='EMPTY' || !stash.length)
          throw new ContractError('VALIDATION', 'Restore requires an empty slot and an available stash.');
        next.slots[intent.slotKey]=stash[stash.length-1];
        next.stashes[intent.slotKey]=stash.slice(0,-1);
        break;
    }
  }
  validateSnapshot(next); // all-or-nothing; head is never mutated on failure
  return {
    revision:head.revision+1,snapshot:next,
    undo:[...head.undo.slice(-29),structuredClone(head.snapshot)],redo:[],
    operations:{...head.operations,[command.operationId]:intentHash}
  };
}

/** Undo/redo are new committed heads; old snapshot revisions remain immutable. */
export function restoreHistoricalSnapshot(head: EditorHead, source: PortfolioSnapshot, operationId: string): EditorHead {
  validateSnapshot(source);
  if (!OP_ID.test(operationId) || Object.hasOwn(head.operations,operationId))
    throw new ContractError('VALIDATION','Invalid restore operation ID.');
  return {
    revision:head.revision+1,snapshot:structuredClone(source),
    undo:[...head.undo.slice(-29),structuredClone(head.snapshot)],redo:[],
    operations:{...head.operations,[operationId]:'historical-restore'}
  };
}
