import test from 'node:test';
import assert from 'node:assert/strict';
import { exportPortfolioSourceZip, importPortfolioSourceZip } from '../../packages/storage-adapters/src/index.ts';
import {createEditorHead} from '../../packages/editor-core/src/index.ts';

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
