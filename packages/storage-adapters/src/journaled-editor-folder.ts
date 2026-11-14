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
  getFile():Promise<{arrayBuffer():Promise<ArrayBuffer>}>;
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
const te=new TextEncoder(),td=new TextDecoder('utf-8',{fatal:true});
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
  return JSON.stringify({...input,sha256:await digest(body)});
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
async function folder(root:FolderDirectory,parts:string[],create:boolean):
  Promise<FolderDirectory|null> {
  let current=root;
  for(const name of parts){
    requireSafe(/^[a-zA-Z0-9_.-]{1,128}$/.test(name)&&name!=='.'&&name!=='..','INVALID');
    try{current=await current.getDirectoryHandle(name,{create});}
    catch(error){if(!create&&missing(error))return null;throw error;}
  }
  return current;
}
async function read(root:FolderDirectory,path:string):Promise<string|null> {
  const parts=path.split('/'),name=parts.pop()!;
  const dir=await folder(root,parts,false);
  if(!dir)return null;
  try{
    const file=await (await dir.getFileHandle(name,{create:false})).getFile();
    const bytes=new Uint8Array(await file.arrayBuffer());
    requireSafe(bytes.byteLength<=MAX_METADATA_BYTES,'INVALID');
    return td.decode(bytes);
  }catch(error){if(missing(error))return null;throw error;}
}
async function write(root:FolderDirectory,path:string,content:string):Promise<void> {
  const parts=path.split('/'),name=parts.pop()!;
  requireSafe(te.encode(content).byteLength<=MAX_METADATA_BYTES,'INVALID');
  const dir=await folder(root,parts,true);
  requireSafe(dir,'IO_FAILURE');
  const stream=await (await dir.getFileHandle(name,{create:true})).createWritable();
  try{await stream.write(content);await stream.close();}
  catch(error){await stream.abort?.().catch(()=>{});throw error;}
}
async function erase(root:FolderDirectory,path:string):Promise<void> {
  const parts=path.split('/'),name=parts.pop()!;
  const dir=await folder(root,parts,false);
  if(!dir)return;
  try{await dir.removeEntry(name);}
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
  constructor(root:FolderDirectory,ownerId:string,portfolioId:string,
    lock:FolderLockPort=defaultLock()){
    requireSafe(!!root&&UUID.test(ownerId)&&UUID.test(portfolioId)&&
      !!lock&&typeof lock.run==='function','INVALID');
    this.root=root;this.owner=ownerId;this.portfolio=portfolioId;
    this.lock=lock;this.lockName='kadmeion-editor-folder:'+ownerId+':'+portfolioId;
  }
  private async stored(raw:string|null):Promise<StoredHead|null> {
    if(raw===null)return null;
    const value=await verifySigned(raw);
    requireSafe(value.formatVersion===1&&value.ownerId===this.owner&&
      value.portfolioId===this.portfolio,'CONFLICT');
    verifyEditor(value.head);
    return value as StoredHead;
  }
  private async actualMatches(files:Record<string,string>):Promise<void> {
    for(const [path,content] of Object.entries(files)){
      requireSafe(await read(this.root,path)===content,'CONFLICT');
    }
  }
  private async recoverUnlocked():Promise<'NONE'|'ROLLED_BACK'|'COMMITTED'> {
    const raw=await read(this.root,META+'/'+JOURNAL);
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
    const headOnDisk=await read(this.root,META+'/'+HEAD);
    if(headOnDisk===journal.next){
      await this.actualMatches(newFiles);
      await erase(this.root,META+'/'+JOURNAL);
      return 'COMMITTED';
    }
    requireSafe(headOnDisk===journal.prior,'RECOVERY_REQUIRED');
    // Any external edit with bytes neither before nor after is preserved.
    for(const change of journal.changes){
      const now=await read(this.root,change.path);
      requireSafe(now===change.before||now===change.after,'CONFLICT');
    }
    for(const change of journal.changes){
      if(change.before===null)await erase(this.root,change.path);
      else await write(this.root,change.path,change.before);
    }
    await this.actualMatches(oldFiles);
    await erase(this.root,META+'/'+JOURNAL);
    return 'ROLLED_BACK';
  }
  async recover():Promise<'NONE'|'ROLLED_BACK'|'COMMITTED'> {
    return this.lock.run(this.lockName,()=>this.recoverUnlocked());
  }
  async load():Promise<EditorHead|null> {
    return this.lock.run(this.lockName,async()=>{
      await this.recoverUnlocked();
      const raw=await read(this.root,META+'/'+HEAD);
      const value=await this.stored(raw);
      if(value)await this.actualMatches(value.head.snapshot.files);
      return value?structuredClone(value.head):null;
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
    return this.lock.run(this.lockName,async()=>{
      await this.recoverUnlocked();
      const raw=await read(this.root,META+'/'+HEAD);
      const old=await this.stored(raw);
      const current=old?.head.revision??null;
      requireSafe(current===expectedRevision,'CONFLICT');
      requireSafe(head.revision===(current===null?0:current+1),'CONFLICT');
      const before=old?.head.snapshot.files??{},after=head.snapshot.files;
      // Compare actual file bytes before touching ANY source. Never destroy
      // unknown contents in a user-chosen folder.
      const paths=Object.keys({...before,...after}).sort();
      for(const path of paths)requireSafe(
        await read(this.root,path)===(before[path]??null),'CONFLICT');
      const newSerialized=await signedJson({
        formatVersion:1,ownerId:this.owner,portfolioId:this.portfolio,head
      });
      const changes:Change[]=paths.filter(path=>before[path]!==after[path])
        .map(path=>({path,before:before[path]??null,after:after[path]??null}));
      const journal=await signedJson({formatVersion:1,ownerId:this.owner,
        portfolioId:this.portfolio,prior:raw,next:newSerialized,changes});
      // Journal closes BEFORE any source is modified; head closes last.
      await write(this.root,META+'/'+JOURNAL,journal);
      for(const change of changes){
        if(change.after===null)await erase(this.root,change.path);
        else await write(this.root,change.path,change.after);
      }
      await this.actualMatches(after);
      await write(this.root,META+'/'+HEAD,newSerialized);
      requireSafe(await read(this.root,META+'/'+HEAD)===newSerialized,'IO_FAILURE');
      try{
        await erase(this.root,META+'/'+JOURNAL);
        return {status:'FOLDER_SAVED',revision:head.revision,
          externalProcessAtomic:false};
      }catch{
        return {status:'FOLDER_SAVED_JOURNAL_PENDING',revision:head.revision,
          externalProcessAtomic:false};
      }
    }).catch((error:unknown)=>{
      if(error instanceof FolderCommitError)throw error;
      throw new FolderCommitError('IO_FAILURE');
    });
  }
}
