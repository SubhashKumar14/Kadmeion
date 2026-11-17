import {ContractError} from '../../contracts/src/project.ts';
import {validateSnapshot,type EditorHead} from '../../editor-core/src/portfolio-revision-transactions.ts';

/**
 * Capability-qualified desktop folder persistence. Source files are visible
 * by their approved managed/owned paths; a private .kadmeion journal protects
 * against interrupted writes. This is not filesystem-level multi-file atomic
 * commit, not a cloud sync protocol and NOT safe against external process
 * races. The browser Web Locks API serializes only same-origin tabs.
 */
export interface FolderFile {
  getFile():Promise<{size?:number;arrayBuffer():Promise<ArrayBuffer>}>;
  createWritable():Promise<{write(data:string):Promise<void>;close():Promise<void>;
    abort?():Promise<void>}>;
}
export interface FolderDirectory {
  getDirectoryHandle(name:string,options?:{create?:boolean}):Promise<FolderDirectory>;
  getFileHandle(name:string,options?:{create?:boolean}):Promise<FolderFile>;
  removeEntry(name:string):Promise<void>;
}
export interface FolderLockPort {
  run<T>(key:string,callback:()=>Promise<T>):Promise<T>;
}
export class FolderCommitError extends Error {
  readonly code:'INVALID'|'UNSUPPORTED'|'CONFLICT'|'IO_FAILURE'|'RECOVERY_REQUIRED';
  constructor(code:FolderCommitError['code']){
    super('Kadmeion folder operation cannot be safely completed: '+code);
    this.name='FolderCommitError';this.code=code;
  }
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const META='.kadmeion';
const HEAD='editor-head.json';
const JOURNAL='transaction-journal.json';
const MAX_METADATA_BYTES=8*1024*1024;
// An owned source may intentionally start with U+FEFF. Preserve it exactly.
const te=new TextEncoder(),td=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
type ScopeGuard=()=>void;
type Json=Record<string,unknown>;
const record=(x:unknown):x is Json=>!!x&&typeof x==='object'&&!Array.isArray(x);
function requireSafe(x:unknown,code:FolderCommitError['code']):asserts x {
  if(!x)throw new FolderCommitError(code);
}
function verifyEditor(head:unknown):asserts head is EditorHead {
  requireSafe(record(head)&&Number.isSafeInteger(head.revision)&&
    (head.revision as number)>=0&&Array.isArray(head.undo)&&head.undo.length<=30&&
    Array.isArray(head.redo)&&head.redo.length<=30&&
    record(head.operations)&&Object.keys(head.operations).length<=10000,'INVALID');
  try{
    validateSnapshot(head.snapshot as EditorHead['snapshot']);
    for(const old of head.undo)validateSnapshot(old);
    for(const old of head.redo)validateSnapshot(old);
  }catch{throw new FolderCommitError('INVALID');}
}
async function digest(s:string):Promise<string>{
  const bytes=await crypto.subtle.digest('SHA-256',te.encode(s));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
async function signedJson(input:Json):Promise<string> {
  const body=JSON.stringify(input);
  requireSafe(te.encode(body).byteLength<=MAX_METADATA_BYTES,'INVALID');
  const signed=JSON.stringify({...input,sha256:await digest(body)});
  requireSafe(te.encode(signed).byteLength<=MAX_METADATA_BYTES,'INVALID');
  return signed;
}
async function verifySigned(input:string):Promise<Json> {
  let value:unknown;
  try{value=JSON.parse(input);}
  catch{throw new FolderCommitError('RECOVERY_REQUIRED');}
  requireSafe(record(value)&&typeof value.sha256==='string'&&
    /^[0-9a-f]{64}$/.test(value.sha256),'RECOVERY_REQUIRED');
  const {sha256,...fields}=value;
  requireSafe(await digest(JSON.stringify(fields))===sha256,'RECOVERY_REQUIRED');
  return fields;
}
const missing=(error:unknown)=>record(error)&&error.name==='NotFoundError';
async function folder(root:FolderDirectory,parts:string[],create:boolean,guard:ScopeGuard):
  Promise<FolderDirectory|null> {
  let current=root;
  for(const name of parts){
    requireSafe(/^[a-zA-Z0-9_.-]{1,128}$/.test(name)&&name!=='.'&&name!=='..','INVALID');
    try{guard();current=await current.getDirectoryHandle(name,{create});guard();}
    catch(error){if(!create&&missing(error))return null;throw error;}
  }
  return current;
}
async function read(root:FolderDirectory,path:string,guard:ScopeGuard):Promise<string|null> {
  guard();
  const parts=path.split('/'),name=parts.pop()!;
  const dir=await folder(root,parts,false,guard);
  if(!dir)return null;
  try{
    guard();const handle=await dir.getFileHandle(name,{create:false});
    guard();const file=await handle.getFile();
    guard();requireSafe(file.size===undefined||file.size<=MAX_METADATA_BYTES,'INVALID');
    const bytes=new Uint8Array(await file.arrayBuffer());
    guard();requireSafe(bytes.byteLength<=MAX_METADATA_BYTES,'INVALID');
    return td.decode(bytes);
  }catch(error){if(missing(error))return null;throw error;}
}
async function write(root:FolderDirectory,path:string,content:string,guard:ScopeGuard):Promise<void> {
  guard();
  const parts=path.split('/'),name=parts.pop()!;
  requireSafe(te.encode(content).byteLength<=MAX_METADATA_BYTES,'INVALID');
  const dir=await folder(root,parts,true,guard);
  requireSafe(dir,'IO_FAILURE');
  guard();const handle=await dir.getFileHandle(name,{create:true});
  guard();const stream=await handle.createWritable();
  try{guard();await stream.write(content);guard();await stream.close();guard();}
  catch(error){await stream.abort?.().catch(()=>{});throw error;}
}
async function erase(root:FolderDirectory,path:string,guard:ScopeGuard):Promise<void> {
  guard();
  const parts=path.split('/'),name=parts.pop()!;
  const dir=await folder(root,parts,false,guard);
  if(!dir)return;
  try{guard();await dir.removeEntry(name);guard();}
  catch(error){if(!missing(error))throw error;}
}
type StoredHead={formatVersion:1;ownerId:string;portfolioId:string;head:EditorHead};
type Change={path:string;before:string|null;after:string|null};
type Journal={formatVersion:1;ownerId:string;portfolioId:string;
  prior:string|null;next:string;changes:Change[]};
function validPaths(changes:unknown):changes is Change[] {
  if(!Array.isArray(changes)||changes.length>100)return false;
  const seen=new Set<string>();
  return changes.every((row:unknown)=>{
    if(!record(row)||typeof row.path!=='string'||seen.has(row.path)||
       typeof row.before!=='string'&&row.before!==null||
       typeof row.after!=='string'&&row.after!==null)return false;
    // Snapshot validation separately enforces the canonical path grammar.
    seen.add(row.path);return true;
  });
}
function defaultLock():FolderLockPort {
  if(typeof navigator==='undefined'||!navigator.locks?.request)
    throw new FolderCommitError('UNSUPPORTED');
  return {
    run:async<T>(key:string,callback:()=>Promise<T>)=>
      navigator.locks.request(key,{mode:'exclusive'},callback)
  };
}
export class JournaledEditorFolderStore {
  private readonly root:FolderDirectory;
  private readonly owner:string;
  private readonly portfolio:string;
  private readonly lock:FolderLockPort;
  private readonly lockName:string;
  private readonly guard:ScopeGuard;
  constructor(root:FolderDirectory,ownerId:string,portfolioId:string,
    lock:FolderLockPort=defaultLock(),isCurrent:()=>boolean=()=>true){
    requireSafe(!!root&&UUID.test(ownerId)&&UUID.test(portfolioId)&&
      !!lock&&typeof lock.run==='function','INVALID');
    this.root=root;this.owner=ownerId;this.portfolio=portfolioId;
    // Different owners/portfolios might choose the same physical folder.
    // Serialize all same-origin folder operations, not just the same ID.
    this.lock=lock;this.lockName='kadmeion-editor-folder:v1';
    this.guard=()=>requireSafe(isCurrent(),'CONFLICT');
  }
  private read(path:string){return read(this.root,path,this.guard);}
  private write(path:string,content:string){return write(this.root,path,content,this.guard);}
  private erase(path:string){return erase(this.root,path,this.guard);}
  private async stored(raw:string|null):Promise<StoredHead|null> {
    this.guard();
    if(raw===null)return null;
    const value=await verifySigned(raw);
    requireSafe(value.formatVersion===1&&value.ownerId===this.owner&&
      value.portfolioId===this.portfolio,'CONFLICT');
    verifyEditor(value.head);
    return value as StoredHead;
  }
  private async actualMatches(files:Record<string,string>):Promise<void> {
    for(const [path,content] of Object.entries(files)){
      requireSafe(await this.read(path)===content,'CONFLICT');
    }
  }
  private async recoverUnlocked():Promise<'NONE'|'ROLLED_BACK'|'COMMITTED'> {
    const raw=await this.read(META+'/'+JOURNAL);
    if(raw===null)return 'NONE';
    const value=await verifySigned(raw);
    requireSafe(value.formatVersion===1&&value.ownerId===this.owner&&
      value.portfolioId===this.portfolio&&
      (typeof value.prior==='string'||value.prior===null)&&
      typeof value.next==='string'&&validPaths(value.changes),'RECOVERY_REQUIRED');
    const journal=value as Journal;
    const oldHead=await this.stored(journal.prior);
    const newHead=await this.stored(journal.next);
    requireSafe(newHead!==null,'RECOVERY_REQUIRED');
    const oldFiles=oldHead?.head.snapshot.files??{},newFiles=newHead.head.snapshot.files;
    const expected=Object.keys({...oldFiles,...newFiles}).filter(p=>oldFiles[p]!==newFiles[p]).sort();
    requireSafe(expected.length===journal.changes.length &&
      expected.every((p,i)=>journal.changes[i].path===p&&
        journal.changes[i].before===(oldFiles[p]??null)&&
        journal.changes[i].after===(newFiles[p]??null)),'RECOVERY_REQUIRED');
    const headOnDisk=await this.read(META+'/'+HEAD);
    if(headOnDisk===journal.next){
      await this.actualMatches(newFiles);
      for(const change of journal.changes)if(change.after===null)
        requireSafe(await this.read(change.path)===null,'CONFLICT');
      requireSafe(await this.read(META+'/'+JOURNAL)===raw,'CONFLICT');
      await this.erase(META+'/'+JOURNAL);
      return 'COMMITTED';
    }
    requireSafe(headOnDisk===journal.prior,'RECOVERY_REQUIRED');
    // Any external edit with bytes neither before nor after is preserved.
    for(const change of journal.changes){
      const now=await this.read(change.path);
      requireSafe(now===change.before||now===change.after,'CONFLICT');
    }
    for(const change of journal.changes){
      const now=await this.read(change.path);
      requireSafe(now===change.before||now===change.after,'CONFLICT');
      if(now===change.before)continue;
      if(change.before===null)await this.erase(change.path);
      else await this.write(change.path,change.before);
    }
    await this.actualMatches(oldFiles);
    for(const change of journal.changes)if(change.before===null)
      requireSafe(await this.read(change.path)===null,'CONFLICT');
    requireSafe(await this.read(META+'/'+JOURNAL)===raw,'CONFLICT');
    await this.erase(META+'/'+JOURNAL);
    return 'ROLLED_BACK';
  }
  async recover():Promise<'NONE'|'ROLLED_BACK'|'COMMITTED'> {
    return this.lock.run(this.lockName,()=>this.recoverUnlocked());
  }
  async load():Promise<EditorHead|null> {
    return this.lock.run(this.lockName,async()=>{
      await this.recoverUnlocked();
      const raw=await this.read(META+'/'+HEAD);
      const value=await this.stored(raw);
      if(value)await this.actualMatches(value.head.snapshot.files);
      this.guard();return value?structuredClone(value.head):null;
    });
  }
  /**
   * Browser-level write guard and per-file crash journal. An external process
   * can still modify the folder outside Web Locks; detect, never overwrite,
   * and require user-driven Compare/Keep Both instead of silent auto-merge.
   */
  async save(head:EditorHead,expectedRevision:number|null):
    Promise<{status:'FOLDER_SAVED'|'FOLDER_SAVED_JOURNAL_PENDING';revision:number;
      externalProcessAtomic:false}> {
    verifyEditor(head);
    // Capture immutable bytes before waiting on the shared lock.
    head=structuredClone(head);
    return this.lock.run(this.lockName,async()=>{
      await this.recoverUnlocked();
      const raw=await this.read(META+'/'+HEAD);
      const old=await this.stored(raw);
      const current=old?.head.revision??null;
      requireSafe(current===expectedRevision,'CONFLICT');
      requireSafe(head.revision===(current===null?0:current+1),'CONFLICT');
      const before=old?.head.snapshot.files??{},after=head.snapshot.files;
      // Compare actual file bytes before touching ANY source. Never destroy
      // unknown contents in a user-chosen folder.
      const paths=Object.keys({...before,...after}).sort();
      for(const path of paths)requireSafe(
        await this.read(path)===(before[path]??null),'CONFLICT');
      const newSerialized=await signedJson({
        formatVersion:1,ownerId:this.owner,portfolioId:this.portfolio,head
      });
      const changes:Change[]=paths.filter(path=>before[path]!==after[path])
        .map(path=>({path,before:before[path]??null,after:after[path]??null}));
      requireSafe(validPaths(changes),'INVALID');
      const journal=await signedJson({formatVersion:1,ownerId:this.owner,
        portfolioId:this.portfolio,prior:raw,next:newSerialized,changes});
      // Journal closes BEFORE any source is modified; head closes last.
      requireSafe(await this.read(META+'/'+HEAD)===raw&&
        await this.read(META+'/'+JOURNAL)===null,'CONFLICT');
      await this.write(META+'/'+JOURNAL,journal);
      requireSafe(await this.read(META+'/'+JOURNAL)===journal,'IO_FAILURE');
      for(const change of changes){
        requireSafe(await this.read(change.path)===change.before,'CONFLICT');
        if(change.after===null)await this.erase(change.path);
        else await this.write(change.path,change.after);
      }
      await this.actualMatches(after);
      for(const change of changes)if(change.after===null)
        requireSafe(await this.read(change.path)===null,'CONFLICT');
      requireSafe(await this.read(META+'/'+HEAD)===raw&&
        await this.read(META+'/'+JOURNAL)===journal,'CONFLICT');
      await this.write(META+'/'+HEAD,newSerialized);
      requireSafe(await this.read(META+'/'+HEAD)===newSerialized,'IO_FAILURE');
      try{
        requireSafe(await this.read(META+'/'+JOURNAL)===journal,'CONFLICT');
        await this.erase(META+'/'+JOURNAL);
        return {status:'FOLDER_SAVED' as const,revision:head.revision,
          externalProcessAtomic:false as const};
      }catch{
        this.guard();
        return {status:'FOLDER_SAVED_JOURNAL_PENDING' as const,revision:head.revision,
          externalProcessAtomic:false as const};
      }
    }).catch((error:unknown)=>{
      if(error instanceof FolderCommitError)throw error;
      throw new FolderCommitError('IO_FAILURE');
    });
  }
}
