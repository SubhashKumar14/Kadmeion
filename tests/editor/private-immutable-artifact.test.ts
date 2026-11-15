import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  createPrivateImmutableArtifact,verifyPrivateImmutableArtifact
} from '../../packages/storage-adapters/src/private-immutable-artifact.ts';
import type {SafePreviewInput} from '../../packages/editor-core/src/publish-preflight.ts';
import {SupabasePrivateFrozenRevisionLoader} from '../../packages/storage-adapters/src/private-frozen-revision-loader.ts';
import {createPrivateImmutableMediaCandidate,verifyPrivateImmutableMediaCandidate} from '../../packages/storage-adapters/src/private-immutable-artifact.ts';

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


test('B08 joins verified frozen HTML to sanitized, relative content-addressed PNG media',async()=>{
  const {deflateSync}=await import('node:zlib');
  const source=await attested();
  const assetId='40000000-0000-4000-8000-000000000004';
  const crc=(bytes:Uint8Array):number=>{
    let c=0xffffffff;
    for(const byte of bytes){
      c^=byte;
      for(let i=0;i<8;i++)c=(c&1)?(0xedb88320^(c>>>1)):c>>>1;
    }
    return(c^0xffffffff)>>>0;
  };
  const chunk=(type:string,content:Uint8Array)=>{
    const b=Buffer.alloc(12+content.length);
    b.writeUInt32BE(content.length,0);b.write(type,4,'ascii');b.set(content,8);
    b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);
    return b;
  };
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
  const png=Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',ihdr),
    chunk('tEXt',Buffer.from('Comment\0private note')),
    chunk('IDAT',deflateSync(Buffer.from([0,200,40,20,255]))),
    chunk('IEND',new Uint8Array())
  ]);
  const sourceSha=createHash('sha256').update(png).digest('hex');
  const plan=[{assetId,expectedSourceSha256:sourceSha,altText:'Image <safe> & "real"'}];
  let readCount=0;
  const reader={
    readFrozenPinnedImage:async(request:{
      assetId:string;portfolioId:string;revision:number
    })=>{
      assert.deepEqual(request,{assetId,portfolioId:id,revision:7});
      readCount++;
      return {assetId,portfolioId:id,revision:7,sourceSha256:sourceSha,
        mimeType:'image/png' as const,storageVersion:'storage-v1',bytes:png};
    }
  };
  const candidate=await createPrivateImmutableMediaCandidate(source,plan,reader);
  assert.equal(candidate.deployable,false);
  assert.equal(candidate.publicUrl,null);
  assert.deepEqual(candidate.files.map(f=>f.path),[
    'index.html','assets/'+candidate.manifest.files[1].sha256+'.png'
  ]);
  const html=new TextDecoder().decode(candidate.files[0].bytes);
  assert.match(html,/img-src &#39;self&#39;/);
  assert.match(html,/src="\.\x2fassets\x2f[0-9a-f]{64}\.png"/);
  assert.match(html,/alt="Image &lt;safe&gt; &amp; &quot;real&quot;"/);
  assert.match(html,/noindex,nofollow,noarchive/);
  assert.ok(!html.includes('SECRET_OWNED_SOURCE_DO_NOT_EXPORT'));
  assert.ok(!html.includes(assetId));
  assert.ok(!new TextDecoder().decode(candidate.files[1].bytes).includes('private note'));
  assert.equal(candidate.manifest.files[1].sha256,
    createHash('sha256').update(candidate.files[1].bytes).digest('hex'));
  assert.deepEqual(await verifyPrivateImmutableMediaCandidate(candidate,source,plan,reader),{
    verified:true,manifestSha256:candidate.manifestSha256,deployable:false,publicUrl:null
  });
  assert.ok(readCount>=2);
  const changed={...candidate,files:[candidate.files[0],
    {path:candidate.files[1].path,bytes:Uint8Array.from(candidate.files[1].bytes)}]};
  changed.files[1].bytes[50]^=1;
  await assert.rejects(verifyPrivateImmutableMediaCandidate(changed,source,plan,reader),{
    code:'VALIDATION'
  });
  await assert.rejects(verifyPrivateImmutableMediaCandidate({
    ...candidate,deployable:true
  },source,plan,reader),{code:'VALIDATION'});
  const altered=make();
  altered.snapshot.slots.hero.content.title='Different verified work';
  const wrong=await attested(altered);
  await assert.rejects(verifyPrivateImmutableMediaCandidate(candidate,wrong,plan,reader),{
    code:'VALIDATION'
  });
});

test('B08 media rejects unpinned bytes, stale portfolio, invalid plans and unsupported rasters',async()=>{
  const input=await attested();
  const assetId='50000000-0000-4000-8000-000000000005';
  const sha='0'.repeat(64);
  const p={assetId,expectedSourceSha256:sha,altText:'Valid alt'};
  const read=(override:Record<string,unknown>={})=>({
    readFrozenPinnedImage:async()=>({assetId,portfolioId:id,revision:7,
      sourceSha256:sha,mimeType:'image/png',storageVersion:'storage-v1',
      bytes:Uint8Array.from([137,80,78,71,13,10,26,10]),...override})
  });
  const fail=(plan:typeof p[],reader:ReturnType<typeof read>)=>
    assert.rejects(createPrivateImmutableMediaCandidate(input,plan,reader),{
      code:'VALIDATION'
    });
  await fail([p],read()); // forged source digest
  await fail([p],read({portfolioId:'60000000-0000-4000-8000-000000000006'}));
  await fail([p],read({revision:8}));
  await fail([p],read({mimeType:'image/svg+xml'}));
  await fail([p,p],read());
  await fail([{...p,altText:'unsafe\nlabel'}],read());
  await fail([],read());
  await fail(Array.from({length:9},(_,i)=>({
    ...p,assetId:'50000000-0000-4000-8000-'+String(i).padStart(12,'0')
  })),read());
  await assert.rejects(createPrivateImmutableMediaCandidate(make(),[p],read()),{
    code:'VALIDATION'
  });
});
