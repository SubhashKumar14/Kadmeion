import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  createPrivateImmutableArtifact,verifyPrivateImmutableArtifact
} from '../../packages/storage-adapters/src/private-immutable-artifact.ts';
import type {SafePreviewInput} from '../../packages/editor-core/src/publish-preflight.ts';
import {SupabasePrivateFrozenRevisionLoader} from '../../packages/storage-adapters/src/private-frozen-revision-loader.ts';

const id='10000000-0000-4000-8000-000000000001';
const requestId='20000000-0000-4000-8000-000000000002';
const pin='a'.repeat(64);
const make=():SafePreviewInput=>({
  snapshot:{formatVersion:1,files:{
    'kadmeion.json':JSON.stringify({formatVersion:1,
      seo:{title:'Actual <work>',description:'Real & verified portfolio'}}),
    'slots/hero/index.tsx':'SECRET_OWNED_SOURCE_DO_NOT_EXPORT'
  },slots:{
    hero:{state:'S0',componentId:'title-stacked@1',
      content:{title:'Hello <world>',subtitle:'Projects & research'}}
  },stashes:{}},
  frozen:{portfolioId:id,revision:7,snapshotSha256:pin,
    visibilityIntent:'UNLISTED',status:'FROZEN',publicUrl:null},
  loadedPortfolioId:id,loadedRevision:7,loadedSnapshotSha256:pin,
  plan:[{slotKey:'hero',componentId:'title-stacked@1',kind:'heading',required:true}]
});

async function attested(input:SafePreviewInput=make()):Promise<SafePreviewInput>{
  const snapshotCanonicalJson=JSON.stringify(input.snapshot);
  const snapshotSha256=createHash('sha256').update(snapshotCanonicalJson).digest('hex');
  const loader=new SupabasePrivateFrozenRevisionLoader('https://unit.supabase.co',
    'publishable',async()=> 'owner-jwt',async()=>Response.json({
      requestId,portfolioId:id,revision:7,snapshotSha256,
      visibilityIntent:'UNLISTED',status:'FROZEN',publicUrl:null,
      snapshot:input.snapshot,snapshotCanonicalJson
    }));
  const loaded=await loader.load(requestId);
  return {...loaded,plan:input.plan};
}

test('candidate is deterministic, pinned, checksummed, and explicitly private',async()=>{
  const input=await attested();
  const a=await createPrivateImmutableArtifact(input);
  const b=await createPrivateImmutableArtifact(await attested());
  assert.deepEqual(a,b);
  assert.equal(a.manifest.kind,'kadmeion-private-immutable-artifact-candidate');
  assert.equal(a.manifest.source.snapshotSha256,input.frozen.snapshotSha256);
  assert.equal(a.manifest.source.revision,7);
  assert.equal(a.manifest.source.visibilityIntent,'UNLISTED');
  assert.equal(a.manifest.deployable,false);
  assert.equal(a.deployable,false);
  assert.equal(a.publicUrl,null);
  assert.deepEqual(a.files.map(f=>f.path),['index.html']);
  assert.equal(a.manifest.files[0].byteLength,a.files[0].bytes.byteLength);
  assert.equal(a.manifest.files[0].sha256,
    createHash('sha256').update(a.files[0].bytes).digest('hex'));
  assert.equal(a.manifestSha256,
    createHash('sha256').update(JSON.stringify(a.manifest)).digest('hex'));
  const html=new TextDecoder().decode(a.files[0].bytes);
  assert.match(html,/noindex,nofollow,noarchive/);
  assert.match(html,/&lt;world&gt;/);
  assert.match(html,/script-src &#39;none&#39;/);
  assert.ok(!html.includes('SECRET_OWNED_SOURCE_DO_NOT_EXPORT'));
  assert.ok(!html.includes(input.frozen.snapshotSha256));
  assert.deepEqual(await verifyPrivateImmutableArtifact(a,input),{
    verified:true,manifestSha256:a.manifestSha256,deployable:false,publicUrl:null
  });
});

test('tampered HTML, extra files, or forged public authority fail closed',async()=>{
  const input=await attested();
  const a=await createPrivateImmutableArtifact(input);
  const bytes=a.files[0].bytes.slice();bytes[bytes.length-10]^=1;
  for(const candidate of [
    {...a,files:[{path:'index.html',bytes}]},
    {...a,files:[...a.files,{path:'secret.txt',bytes:new Uint8Array([1])}]},
    {...a,files:[{path:'../index.html',bytes:a.files[0].bytes}]},
    {...a,publicUrl:'https://example.com'},
    {...a,deployable:true},
    {...a,unexpected:'extra'}
  ]){
    await assert.rejects(verifyPrivateImmutableArtifact(candidate,input),{code:'VALIDATION'});
  }
});

test('manifest tampering and repinning cannot be laundered through new hashes',async()=>{
  const input=await attested();
  const a=await createPrivateImmutableArtifact(input);
  const changed={...a.manifest,source:{...a.manifest.source,revision:8}};
  const changedHash=createHash('sha256').update(JSON.stringify(changed)).digest('hex');
  for(const candidate of [
    {...a,manifest:changed,manifestSha256:changedHash},
    {...a,manifest:{...a.manifest,publicUrl:'https://fake.example'}},
    {...a,manifest:{...a.manifest,files:[{path:'index.html',byteLength:1,sha256:'0'.repeat(64)}]}},
    {...a,manifestSha256:'0'.repeat(64)}
  ]){
    await assert.rejects(verifyPrivateImmutableArtifact(candidate,input),{code:'VALIDATION'});
  }
});

test('replay against a different frozen revision or modified content fails',async()=>{
  const input=await attested(),artifact=await createPrivateImmutableArtifact(input);
  const changed=await attested();changed.frozen.revision=8;changed.loadedRevision=8;
  await assert.rejects(verifyPrivateImmutableArtifact(artifact,changed),{code:'VALIDATION'});
  const changedSource=make();changedSource.snapshot.slots.hero.content.title='Different work';
  const different=await attested(changedSource);
  await assert.rejects(verifyPrivateImmutableArtifact(artifact,different),{code:'VALIDATION'});
  const differentPin=await attested();differentPin.frozen.snapshotSha256='b'.repeat(64);
  differentPin.loadedSnapshotSha256='b'.repeat(64);
  await assert.rejects(verifyPrivateImmutableArtifact(artifact,differentPin),{code:'VALIDATION'});
});

test('invalid private preflight cannot produce an immutable candidate',async()=>{
  const stale=await attested();stale.loadedRevision=99;
  await assert.rejects(createPrivateImmutableArtifact(stale),{code:'VALIDATION'});
  const emptySource=make();emptySource.snapshot.slots.hero={state:'EMPTY',content:{}};
  const missing=await attested(emptySource);
  await assert.rejects(createPrivateImmutableArtifact(missing),{code:'VALIDATION'});
  const customSource=make();customSource.snapshot.slots.hero={
    state:'S2',componentId:'title-stacked@1',content:{title:'Owner code'},
    sourcePath:'slots/hero/index.tsx',originalSource:'different'
  };
  const custom=await attested(customSource);
  await assert.rejects(createPrivateImmutableArtifact(custom),{code:'VALIDATION'});
  const invalidLinkSource=make();
  invalidLinkSource.snapshot.slots.link={state:'S0',componentId:'link@1',
    content:{label:'Click',url:'javascript:alert(1)'}};
  invalidLinkSource.plan=[...invalidLinkSource.plan,
    {slotKey:'link',componentId:'link@1',kind:'external-link',required:true}];
  const invalidLink=await attested(invalidLinkSource);
  await assert.rejects(createPrivateImmutableArtifact(invalidLink),{code:'VALIDATION'});
});

test('a post-load clone or forged input cannot cross the artifact trust boundary',async()=>{
  const input=await attested();
  const artifact=await createPrivateImmutableArtifact(input);
  assert.throws(()=>{input.snapshot.slots.hero.content.title='Changed after load';},TypeError);
  assert.equal(input.snapshot.slots.hero.content.title,'Hello <world>');
  for(const changed of [
    {...input,snapshot:structuredClone(input.snapshot)},
    {...input,frozen:{...input.frozen,snapshotSha256:'f'.repeat(64)}},
    {...input,loadedRevision:8},
    {...input,loadedPortfolioId:requestId}
  ]){
    await assert.rejects(createPrivateImmutableArtifact(changed),{code:'VALIDATION'});
    await assert.rejects(verifyPrivateImmutableArtifact(artifact,changed),{code:'VALIDATION'});
  }
  assert.deepEqual(await verifyPrivateImmutableArtifact(artifact,input),{
    verified:true,manifestSha256:artifact.manifestSha256,deployable:false,publicUrl:null
  });
});

test('matching forged SHA fields without a loader attestation cannot create an artifact',async()=>{
  const fake=make();
  fake.frozen.snapshotSha256='b'.repeat(64);
  fake.loadedSnapshotSha256='b'.repeat(64);
  await assert.rejects(createPrivateImmutableArtifact(fake),{code:'VALIDATION'});
});
