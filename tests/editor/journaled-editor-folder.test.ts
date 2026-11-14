import test from 'node:test';
import assert from 'node:assert/strict';
import {JournaledEditorFolderStore,type FolderDirectory,type FolderFile,
  type FolderLockPort} from '../../packages/storage-adapters/src/journaled-editor-folder.ts';
import {createEditorHead,applyEditorTransaction} from '../../packages/editor-core/src/index.ts';

const owner='00000000-0000-4000-8000-000000000001';
const portfolio='10000000-0000-4000-8000-000000000001';
const operation='20000000-0000-4000-8000-000000000001';
const bytes=new TextEncoder();
const lock:FolderLockPort={run:async<T>(_key:string,run:()=>Promise<T>)=>run()};
class Disk implements FolderDirectory {
  readonly files=new Map<string,string>();
  readonly dirs=new Set<string>(['']);
  failOnWrite:string|null=null;
  private readonly base:string;
  constructor(base=''){this.base=base;}
  private path(name:string){return this.base?this.base+'/'+name:name;}
  async getDirectoryHandle(name:string,opts?:{create?:boolean}):Promise<FolderDirectory>{
    const path=this.path(name);
    if(!this.dirs.has(path)){if(!opts?.create)throw Object.assign(Error('missing'),{name:'NotFoundError'});
      this.dirs.add(path);}
    return new Dir(this,path);
  }
  async getFileHandle(name:string,opts?:{create?:boolean}):Promise<FolderFile>{
    return new Dir(this,this.base).getFileHandle(name,opts);
  }
  async removeEntry(name:string){
    const path=this.path(name);
    if(!this.files.delete(path))throw Object.assign(Error('missing'),{name:'NotFoundError'});
  }
}
class Dir implements FolderDirectory {
  readonly disk:Disk;
  readonly base:string;
  constructor(disk:Disk,base:string){this.disk=disk;this.base=base;}
  private path(name:string){return this.base?this.base+'/'+name:name;}
  async getDirectoryHandle(name:string,options?:{create?:boolean}):Promise<FolderDirectory>{
    const path=this.path(name);
    if(!this.disk.dirs.has(path)){
      if(!options?.create)throw Object.assign(Error('missing'),{name:'NotFoundError'});
      this.disk.dirs.add(path);
    }
    return new Dir(this.disk,path);
  }
  async getFileHandle(name:string,options?:{create?:boolean}):Promise<FolderFile>{
    const path=this.path(name);
    if(!this.disk.files.has(path)&&!options?.create)
      throw Object.assign(Error('missing'),{name:'NotFoundError'});
    return {getFile:async()=>{
      const data=this.disk.files.get(path);
      if(data===undefined)throw Object.assign(Error('missing'),{name:'NotFoundError'});
      return {arrayBuffer:async()=>bytes.encode(data).buffer};
    },createWritable:async()=>{
      let value='';
      return {write:async(content:string)=>{value=content;},
        close:async()=>{
          if(this.disk.failOnWrite===path){
            this.disk.failOnWrite=null;throw Error('power failure');
          }
          this.disk.files.set(path,value);
        }
      };
    }};
  }
  async removeEntry(name:string){
    if(!this.disk.files.delete(this.path(name)))
      throw Object.assign(Error('missing'),{name:'NotFoundError'});
  }
}
const snapshot=()=>({
  formatVersion:1 as const,
  files:{'kadmeion.json':'{"formatVersion":1}',
    'pages/home.page.json':'{"sections":[]}'},
  slots:{hero:{state:'S0' as const,componentId:'heading@1',content:{title:'Draft'}}},
  stashes:{}
});
const first=()=>createEditorHead(snapshot());
const next=(head:ReturnType<typeof first>)=>applyEditorTransaction(head,
  {operationId:operation,baseRevision:0,intent:{
    kind:'UPDATE_CONTENT',slotKey:'hero',content:{title:'New draft'}
  }});
const store=(disk:Disk)=>new JournaledEditorFolderStore(disk,owner,portfolio,lock);

test('first folder save exposes exact source bytes and durable head',async()=>{
  const disk=new Disk(),s=store(disk),head=first();
  assert.equal((await s.save(head,null)).status,'FOLDER_SAVED');
  assert.equal(disk.files.get('kadmeion.json'),head.snapshot.files['kadmeion.json']);
  assert.equal(disk.files.get('pages/home.page.json'),head.snapshot.files['pages/home.page.json']);
  assert.deepEqual(await s.load(),head);
  assert.equal(disk.files.has('.kadmeion/transaction-journal.json'),false);
});
test('next revision saves with CAS, exact source, and stable undo history',async()=>{
  const disk=new Disk(),s=store(disk),h=first();
  await s.save(h,null);
  const h2=next(h);
  await s.save(h2,0);
  assert.equal((await s.load())?.revision,1);
  assert.deepEqual((await s.load())?.undo,h2.undo);
  await assert.rejects(s.save(h2,0),{code:'CONFLICT'});
});
test('external user edits are never overwritten or auto-merged',async()=>{
  const disk=new Disk(),s=store(disk),h=first();
  await s.save(h,null);
  disk.files.set('kadmeion.json','{"changedExternally":true}');
  await assert.rejects(s.save(next(h),0),{code:'CONFLICT'});
  await assert.rejects(s.load(),{code:'CONFLICT'});
  assert.equal(disk.files.get('kadmeion.json'),'{"changedExternally":true}');
});
test('existing unrelated files are preserved, occupied source paths block initialization',async()=>{
  const disk=new Disk(),s=store(disk);
  disk.files.set('README.txt','Unrelated');
  await s.save(first(),null);
  assert.equal(disk.files.get('README.txt'),'Unrelated');
  const occupied=new Disk();
  occupied.files.set('kadmeion.json','private owner file');
  await assert.rejects(store(occupied).save(first(),null),{code:'CONFLICT'});
  assert.equal(occupied.files.get('kadmeion.json'),'private owner file');
});
test('crash during source write journals partial changes and rolls back on recovery',async()=>{
  const disk=new Disk(),s=store(disk),h=first();
  await s.save(h,null);
  const altered=next(h);
  altered.snapshot.files['kadmeion.json']='{"formatVersion":1,"revision":1}';
  altered.snapshot.files['pages/home.page.json']='{"sections":["changed"]}';
  disk.failOnWrite='pages/home.page.json';
  await assert.rejects(s.save(altered,0),{code:'IO_FAILURE'});
  assert.equal(disk.files.has('.kadmeion/transaction-journal.json'),true);
  assert.equal(await s.recover(),'ROLLED_BACK');
  assert.deepEqual(await s.load(),h);
  assert.equal(disk.files.get('pages/home.page.json'),'{"sections":[]}');
});
test('journal with committed HEAD is recognized after interrupted cleanup',async()=>{
  const disk=new Disk(),s=store(disk),h=first();
  await s.save(h,null);
  disk.failOnWrite='nonexistent-noop';
  const h2=next(h);
  await s.save(h2,0);
  assert.equal(await s.recover(),'NONE');
});
test('untrusted external modifications during recovery preserve evidence',async()=>{
  const disk=new Disk(),s=store(disk),h=first();
  await s.save(h,null);
  const altered=next(h);
  altered.snapshot.files['kadmeion.json']='{"formatVersion":1,"rev":1}';
  altered.snapshot.files['pages/home.page.json']='{"sections":["A"]}';
  disk.failOnWrite='pages/home.page.json';
  await assert.rejects(s.save(altered,0),{code:'IO_FAILURE'});
  disk.files.set('kadmeion.json','{"ownerOutside":"unsaved"}');
  await assert.rejects(s.recover(),{code:'CONFLICT'});
  assert.equal(disk.files.get('kadmeion.json'),'{"ownerOutside":"unsaved"}');
});
test('owned source files survive zero-content edits byte-for-byte',async()=>{
  const disk=new Disk(),s=store(disk);
  const h=first();
  h.snapshot.files['slots/hero/index.tsx']="export const Viewer = () => 'Hi';";
  h.snapshot.slots.hero={state:'S2',componentId:'heading@1',
    content:{title:'Draft'},sourcePath:'slots/hero/index.tsx',
    originalSource:"export const Viewer = () => 'Original';"};
  await s.save(h,null);
  const h2=next(h);
  await s.save(h2,0);
  assert.equal(disk.files.get('slots/hero/index.tsx'),
    "export const Viewer = () => 'Hi';");
  assert.equal((await s.load())?.snapshot.slots.hero.state,'S2');
});
