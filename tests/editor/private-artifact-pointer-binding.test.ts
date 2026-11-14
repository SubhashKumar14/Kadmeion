import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SupabasePrivateFrozenRevisionLoader}
  from '../../packages/storage-adapters/src/private-frozen-revision-loader.ts';
import {createPrivateImmutableArtifact}
  from '../../packages/storage-adapters/src/private-immutable-artifact.ts';
import {bindPrivateArtifactToPointer}
  from '../../packages/storage-adapters/src/private-artifact-pointer-binding.ts';
import type {SafePreviewInput} from '../../packages/editor-core/src/publish-preflight.ts';
import type {PrivateBindingContext} from
  '../../packages/storage-adapters/src/private-artifact-pointer-binding.ts';

const portfolioId='10000000-0000-4000-8000-000000000001';
const requestId='20000000-0000-4000-8000-000000000002';
const source:SafePreviewInput={
  snapshot:{formatVersion:1,files:{
    'kadmeion.json':JSON.stringify({formatVersion:1,
      seo:{title:'Verified work',description:'Actual private portfolio'}})
  },slots:{hero:{state:'S0',componentId:'title-stacked@1',
    content:{title:'Owner content',subtitle:'Verified private text'}}},stashes:{}},
  frozen:{portfolioId,revision:7,snapshotSha256:'a'.repeat(64),
    visibilityIntent:'UNLISTED',status:'FROZEN',publicUrl:null},
  loadedPortfolioId:portfolioId,loadedRevision:7,loadedSnapshotSha256:'a'.repeat(64),
  plan:[{slotKey:'hero',componentId:'title-stacked@1',kind:'heading',required:true}]
};
async function fixture(){
  const snapshotCanonicalJson=JSON.stringify(source.snapshot);
  const snapshotSha256=createHash('sha256').update(snapshotCanonicalJson).digest('hex');
  const loader=new SupabasePrivateFrozenRevisionLoader('https://unit.supabase.co',
    'publishable',async()=> 'owner-jwt',async()=>Response.json({
      requestId,portfolioId,revision:7,snapshotSha256,
      visibilityIntent:'UNLISTED',status:'FROZEN',publicUrl:null,
      snapshot:source.snapshot,snapshotCanonicalJson
    }));
  const loaded=await loader.load(requestId);
  const artifact=await createPrivateImmutableArtifact({...loaded,plan:source.plan});
  const pointer={
    portfolioId,status:'PREPARED_PRIVATE' as const,generation:4,revocationGeneration:2,
    candidateRequestId:requestId,candidateManifestSha256:artifact.manifestSha256,
    publicServingEnabled:false as const,publicUrl:null,hostRevocationVerified:false as const
  };
  const receipt={
    portfolioId,requestId,generation:4,manifestSha256:artifact.manifestSha256,
    htmlSha256:artifact.manifest.files[0].sha256,
    status:'BOUND_PRIVATE',alreadyBound:false,integrityChecked:true,
    publicServingEnabled:false,publicUrl:null,hostRevocationVerified:false
  };
  let called=0;
  const ctx:PrivateBindingContext={
    portfolioId,requestId,plan:source.plan,loader:{load:async()=>loaded},
    pointer:{read:async()=>pointer},
    writer:{bindPrivateArtifact:async input=>{
      called++;
      assert.equal(input.requestId,requestId);
      assert.equal(input.expectedGeneration,4);
      assert.equal(createHash('sha256').update(input.manifestJson).digest('hex'),
        artifact.manifestSha256);
      assert.equal(createHash('sha256').update(input.html).digest('hex'),
        artifact.manifest.files[0].sha256);
      assert.equal(input.manifestJson,JSON.stringify(artifact.manifest));
      assert.equal(input.html,new TextDecoder().decode(artifact.files[0].bytes));
      return receipt;
    }}
  };
  return {ctx,artifact,pointer,receipt,calls:()=>called};
}

test('server binding rebuilds attested bytes and confirms a private CAS receipt',async()=>{
  const f=await fixture();
  assert.deepEqual(await bindPrivateArtifactToPointer(f.ctx),f.receipt);
  assert.equal(f.calls(),1);
  assert.equal(f.receipt.publicUrl,null);
});

test('forged owner checksum, stale generation and blocked pointer never call writer',async()=>{
  for(const patch of [
    {candidateManifestSha256:'f'.repeat(64)},
    {candidateRequestId:'30000000-0000-4000-8000-000000000003'},
    {status:'BLOCKED' as const},
    {generation:0},
    {revocationGeneration:9},
    {publicServingEnabled:true},
    {hostRevocationVerified:true}
  ]){
    const f=await fixture();
    f.ctx.pointer.read=async()=>({...f.pointer,...patch});
    await assert.rejects(bindPrivateArtifactToPointer(f.ctx),{code:'POINTER_CONFLICT'});
    assert.equal(f.calls(),0);
  }
});

test('wrong portfolio and cloned unattested snapshot are rejected before pointer read',async()=>{
  const f=await fixture();
  let reads=0;
  f.ctx.portfolioId='30000000-0000-4000-8000-000000000003';
  f.ctx.pointer.read=async()=>{reads++;return f.pointer;};
  await assert.rejects(bindPrivateArtifactToPointer(f.ctx),{code:'VALIDATION'});
  assert.equal(reads,0);
  const f2=await fixture();
  f2.ctx.loader.load=async()=>({...await f2.ctx.loader.load(requestId),
    snapshot:structuredClone(source.snapshot)});
  // No WeakMap proof is transferable to an owner-submitted clone.
  await assert.rejects(bindPrivateArtifactToPointer(f2.ctx),{code:'VALIDATION'});
});

test('malformed or forged trusted binding receipts are not accepted',async()=>{
  for(const bad of [
    {publicServingEnabled:true}, {publicUrl:'https://fake.test'},
    {integrityChecked:false}, {hostRevocationVerified:true},
    {status:'PUBLISHED'}, {generation:5}, {htmlSha256:'0'.repeat(64)},
    {manifestSha256:'0'.repeat(64)},{requestId:'30000000-0000-4000-8000-000000000003'},
    {unexpected:'private data'}, {alreadyBound:'yes'}
  ]){
    const f=await fixture();
    f.ctx.writer.bindPrivateArtifact=async()=>({...f.receipt,...bad});
    await assert.rejects(bindPrivateArtifactToPointer(f.ctx),{code:'INVALID_ACK'});
  }
});

test('DB disconnect is an unconfirmed private binding, not a successful publish',async()=>{
  const f=await fixture();
  f.ctx.writer.bindPrivateArtifact=async()=>{throw new Error('secret provider error');};
  await assert.rejects(bindPrivateArtifactToPointer(f.ctx),{
    code:'BINDING_UNCONFIRMED',message:
      'Private artifact binding was not confirmed; inspect current pointer state.'
  });
});

test('bad inputs fail before loader, renderer, pointer or binding writer',async()=>{
  const f=await fixture();let loads=0;
  f.ctx.requestId='invalid';
  f.ctx.loader.load=async()=>{loads++;throw new Error('no');};
  await assert.rejects(bindPrivateArtifactToPointer(f.ctx),{code:'VALIDATION'});
  assert.equal(loads,0);
});
