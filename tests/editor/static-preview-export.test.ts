import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {exportStandaloneStaticPreview} from '../../packages/storage-adapters/src/static-preview-export.ts';
import {exportPortfolioSourceZip,importPortfolioSourceZip,writeStoredZip} from '../../packages/storage-adapters/src/portable-source-archive.ts';
import type {SafePreviewInput} from '../../packages/editor-core/src/publish-preflight.ts';

const encode=new TextEncoder(),decode=new TextDecoder();
const make=():SafePreviewInput=>({
  snapshot:{formatVersion:1,files:{
    'kadmeion.json':JSON.stringify({formatVersion:1,seo:{title:'Research & work',description:'Public <projects>'}}),
    'slots/hero/index.tsx':'PRIVATE_OWNED_SOURCE_12345'
  },slots:{
    hero:{state:'S0',componentId:'title-stacked@1',content:{title:'Hello <world>',subtitle:'Real research'}}
  },stashes:{}},
  frozen:{portfolioId:'10000000-0000-4000-8000-000000000001',revision:3,
    snapshotSha256:'a'.repeat(64),status:'FROZEN',publicUrl:null,visibilityIntent:'UNLISTED'},
  loadedPortfolioId:'10000000-0000-4000-8000-000000000001',
  loadedRevision:3,loadedSnapshotSha256:'a'.repeat(64),
  plan:[{slotKey:'hero',componentId:'title-stacked@1',kind:'heading',required:true}]
});
function localZipContents(bytes:Uint8Array):Map<string,Uint8Array> {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let p=0;const files=new Map<string,Uint8Array>();
  while(view.getUint32(p,true)===0x04034b50){
    const size=view.getUint32(p+18,true),nameSize=view.getUint16(p+26,true),
      extra=view.getUint16(p+28,true);
    const name=decode.decode(bytes.subarray(p+30,p+30+nameSize));
    const start=p+30+nameSize+extra;
    assert.ok(start+size<=bytes.length);
    files.set(name,bytes.slice(start,start+size));
    p=start+size;
  }
  assert.equal(view.getUint32(p,true),0x02014b50);
  assert.equal(view.getUint32(bytes.length-22,true),0x06054b50);
  assert.equal(view.getUint16(bytes.length-12,true),files.size);
  return files;
}
test('safe standalone ZIP is deterministic and carries verifiable SHA-256 metadata',async()=>{
  const result=await exportStandaloneStaticPreview(make());
  assert.deepEqual(result.zip,(await exportStandaloneStaticPreview(make())).zip);
  assert.equal(result.previewOnly,true);assert.equal(result.publicUrl,null);
  const files=localZipContents(result.zip);
  assert.deepEqual([...files.keys()],['index.html','kadmeion-static-preview.json','README.txt']);
  const manifest=JSON.parse(decode.decode(files.get('kadmeion-static-preview.json')!));
  const html=decode.decode(files.get('index.html')!);
  const sha=createHash('sha256').update(files.get('index.html')!).digest('hex');
  assert.equal(sha,result.htmlSha256);
  assert.equal(sha,manifest.files[0].sha256);
  assert.equal(manifest.previewOnly,true);
  assert.equal(manifest.publicUrl,null);
  assert.match(html,/noindex,nofollow,noarchive/);
  assert.match(html,/&lt;world&gt;/);
  assert.match(html,/script-src &#39;none&#39;/);
  assert.ok(!decode.decode(result.zip).includes('PRIVATE_OWNED_SOURCE_12345'));
});
test('invalid frozen head, empty required slot, or active custom code cannot be zipped',async()=>{
  const stale=make();stale.loadedRevision=4;
  await assert.rejects(exportStandaloneStaticPreview(stale),{code:'VALIDATION'});
  const empty=make();empty.snapshot.slots.hero={state:'EMPTY',content:{}};
  await assert.rejects(exportStandaloneStaticPreview(empty),{code:'VALIDATION'});
  const code=make();code.snapshot.slots.hero={
    state:'S2',componentId:'title-stacked@1',content:{title:'Hello'},
    sourcePath:'slots/hero/index.tsx',originalSource:'legacy'
  };
  await assert.rejects(exportStandaloneStaticPreview(code),{code:'VALIDATION'});
});
test('portable editable source archive still preserves original owned bytes',()=>{
  const snapshot=make().snapshot;
  const zip=exportPortfolioSourceZip(snapshot);
  assert.deepEqual(importPortfolioSourceZip(zip),snapshot);
  assert.deepEqual(exportPortfolioSourceZip(snapshot),zip);
});
test('shared ZIP-STORE writer refuses unsafe names, duplicates and oversize files',()=>{
  const limits={maxEntries:3,maxBytes:1024,maxEntryBytes:50};
  const file={name:'index.html',bytes:encode.encode('test')};
  for(const name of ['../owner.json','dir//oops','/root','a\\b','a/../b']){
    assert.throws(()=>writeStoredZip([{name,bytes:file.bytes}],limits),{code:'VALIDATION'});
  }
  assert.throws(()=>writeStoredZip([file,file],limits),{code:'VALIDATION'});
  assert.throws(()=>writeStoredZip([{name:'big',bytes:new Uint8Array(51)}],limits),{code:'VALIDATION'});
});
