import test from 'node:test';
import assert from 'node:assert/strict';
import { exportPortfolioSourceZip, importPortfolioSourceZip } from '../../packages/storage-adapters/src/index.ts';
import {createEditorHead,restoreHistoricalSnapshot,applyEditorTransaction} from '../../packages/editor-core/src/index.ts';
import {exportPortableSnapshot,importPortableSnapshot} from '../../packages/storage-adapters/src/portable-editor-snapshot.ts';

const snapshot=createEditorHead({
 formatVersion:1,
 files:{
  'kadmeion.json':'{\n  "formatVersion":1\n}',
  'pages/home.page.json':'{"sections":[]}',
  'slots/hero/index.tsx':'export const title = "✨ private source";'
 },
 slots:{hero:{state:'S2',componentId:'heading@1',content:{title:'Hello'},sourcePath:'slots/hero/index.tsx',originalSource:'source from pinned library'}},
 stashes:{hero:[{state:'S0',componentId:'heading@1',content:{title:'Previous'}}]}
}).snapshot;

test('deterministic portable ZIP preserves user source, Unicode and stashed content',()=>{
 const first=exportPortfolioSourceZip(snapshot);
 const second=exportPortfolioSourceZip(snapshot);
 assert.deepEqual(first,second);
 assert.deepEqual(importPortfolioSourceZip(first),snapshot);
 assert.equal(first[0],80);assert.equal(first[1],75);
});

test('ZIP importer refuses truncated, altered and unsupported bytes',()=>{
 const archive=exportPortfolioSourceZip(snapshot);
 assert.throws(()=>importPortfolioSourceZip(archive.slice(0,-5)));
 const mutated=new Uint8Array(archive);
 const needle=new TextEncoder().encode('private source');
 const offset=mutated.findIndex((value,i)=>value===needle[0]&&needle.every((b,k)=>mutated[i+k]===b));
 assert.ok(offset>0);
 mutated[offset+1]^=0xff;
 assert.throws(()=>importPortfolioSourceZip(mutated));
 assert.throws(()=>importPortfolioSourceZip(new Uint8Array(1024*1024*3)));
});

test('ZIP importer rejects a duplicated central entry that hides a different local file',()=>{
 const original=exportPortfolioSourceZip(snapshot);
 const tampered=new Uint8Array(original);
 const view=new DataView(tampered.buffer);
 const end=tampered.byteLength-22;
 const offset=view.getUint32(end+16,true);
 const decoder=new TextDecoder();
 const entries:Array<{name:string;at:number;length:number}>=[];
 for(let cursor=offset;cursor<end;){
   assert.equal(view.getUint32(cursor,true),0x02014b50);
   const length=view.getUint16(cursor+28,true);
   const name=decoder.decode(tampered.subarray(cursor+46,cursor+46+length));
   entries.push({name,at:cursor,length});
   cursor+=46+length+view.getUint16(cursor+30,true)+view.getUint16(cursor+32,true);
 }
 const manifest=entries.find(e=>e.name==='kadmeion.export.json');
 const hidden=entries.find(e=>e.name==='pages/home.page.json');
 assert.ok(manifest&&hidden);
 assert.equal(manifest.length,hidden.length);
 // Both central entries now point to the same manifest local entry while the
 // local ZIP still contains the real pages/home.page.json. Each repeated
 // central record is individually valid; a directory-level bijection is not.
 tampered.set(tampered.slice(manifest.at,manifest.at+46+manifest.length),hidden.at);
 assert.throws(()=>importPortfolioSourceZip(tampered),{code:'VALIDATION'});
});

test('ZIP importer refuses dot-segment aliases before interpreting the central directory',()=>{
 const archive=exportPortfolioSourceZip(snapshot);
 const bytes=new Uint8Array(archive);
 const view=new DataView(bytes.buffer);
 const decode=new TextDecoder(),encode=new TextEncoder();
 let cursor=0,changed=false;
 for(;cursor+30<bytes.length;){
   if(view.getUint32(cursor,true)!==0x04034b50)break;
   const nameLen=view.getUint16(cursor+26,true);
   const extraLen=view.getUint16(cursor+28,true);
   const dataLen=view.getUint32(cursor+18,true);
   const start=cursor+30;
   const name=decode.decode(bytes.subarray(start,start+nameLen));
   if(name==='pages/home.page.json'){
     const alias=encode.encode('pages/./me.page.json');
     assert.equal(alias.length,nameLen);
     bytes.set(alias,start);
     changed=true;break;
   }
   cursor=start+nameLen+extraLen+dataLen;
 }
 assert.equal(changed,true);
 assert.throws(()=>importPortfolioSourceZip(bytes),(error:unknown)=>
   error instanceof Error&&error.message==='Duplicate or unsafe ZIP filename.');
});

test('B16 portable ZIP and JSON round-trip exact BOM, CRLF, Unicode and orphan stashes',()=>{
  const owned=structuredClone(snapshot);
  const source='\uFEFFexport const title = "नमस्ते";\r\n// opaque relative imports\r\n';
  owned.files['slots/hero/index.tsx']=source;
  owned.stashes['old-slot']=[{state:'S0',componentId:'heading@1',content:{title:'Unplaced text'}}];
  const zip=exportPortfolioSourceZip(owned);
  const fromZip=importPortfolioSourceZip(zip);
  const fromJson=importPortableSnapshot(exportPortableSnapshot(owned));
  for(const result of [fromZip,fromJson]){
    assert.deepEqual(result,owned);
    assert.deepEqual(new TextEncoder().encode(result.files['slots/hero/index.tsx']),new TextEncoder().encode(source));
    assert.deepEqual(result.stashes['old-slot'],owned.stashes['old-slot']);
  }
  assert.deepEqual(exportPortfolioSourceZip(fromZip),zip);
});
test('B16 ZIP rejects lone UTF-16 surrogate instead of silently replacing source bytes',()=>{
  const invalid=structuredClone(snapshot);
  invalid.files['slots/hero/index.tsx']='export const invalid="'+String.fromCharCode(0xd800)+'";';
  assert.throws(()=>exportPortfolioSourceZip(invalid),{code:'VALIDATION'});
});
test('B16 private JSON refuses hidden envelope fields, hostile source paths and oversized input',()=>{
  const text=exportPortableSnapshot(snapshot);
  const envelope=JSON.parse(text);
  for(const value of [
    {...envelope,secret:'not part of portable format'},
    {...envelope,formatVersion:2},
    {...envelope,kind:'published-site'},
    {...envelope,snapshot:{...snapshot,files:{...snapshot.files,'../credentials.json':'{}'}}},
    {...envelope,snapshot:{...snapshot,stashes:{...snapshot.stashes,orphan:[{
      state:'S2',componentId:'heading@1',content:{},sourcePath:'slots/orphan/index.tsx',originalSource:'old'
    }]}}}
  ])assert.throws(()=>importPortableSnapshot(JSON.stringify(value)),{code:'VALIDATION'});
  assert.throws(()=>importPortableSnapshot(' '.repeat(1024*1024+1)),{code:'VALIDATION'});
  assert.throws(()=>importPortableSnapshot('{"bad"'),{code:'VALIDATION'});
  assert.deepEqual(importPortableSnapshot(text),snapshot);
});
test('B16 imported snapshot restore creates a separate undoable working revision and leaves original unchanged',()=>{
  const original=createEditorHead(snapshot);
  const imported=structuredClone(snapshot);
  imported.files['slots/hero/index.tsx']='\uFEFFexport const title="Imported";\r\n';
  imported.slots.hero.content={title:'Imported text'};
  const parsed=importPortableSnapshot(exportPortableSnapshot(imported));
  const restored=restoreHistoricalSnapshot(original,parsed,'71000000-0000-4000-8000-000000000001');
  assert.deepEqual(restored.snapshot,imported);
  assert.deepEqual(original.snapshot,snapshot);
  assert.equal(restored.revision,original.revision+1);
  assert.equal(restored.undo.length,original.undo.length+1);
  const undone=applyEditorTransaction(restored,{operationId:'71000000-0000-4000-8000-000000000002',
    baseRevision:restored.revision,intent:{kind:'UNDO'}});
  assert.deepEqual(undone.snapshot,snapshot);
  assert.deepEqual(parsed,imported);
});
