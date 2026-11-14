import test from 'node:test';
import assert from 'node:assert/strict';
import {PrivatePublicDeliveryPolicy,type PrivateHostReleasePointer}
  from '../../packages/storage-adapters/src/public-delivery-policy.ts';

const portfolioId='10000000-0000-4000-8000-000000000001';
const release='a'.repeat(64);
const digest='b'.repeat(64);
const path='assets/'+digest+'.css';
const now=1794620000000;
const state=():PrivateHostReleasePointer=>({
  portfolioId,generation:7,appliedRevocationGeneration:7,status:'LIVE_VERIFIED',
  releaseSha256:release,readAtMs:now,
  files:[{path:'index.html',sha256:'c'.repeat(64)},{path,sha256:digest}]
});
const canonical={portfolioId,resource:'CANONICAL_HTML'} as const;
const asset={portfolioId,resource:'DIRECT_ASSET',releaseSha256:release,path,sha256:digest} as const;
const gate=(readLatest:()=>Promise<unknown>)=>
  new PrivatePublicDeliveryPolicy({readLatest},()=>now);

test('canonical and direct immutable assets use a fresh read per request; no URL or deployable result',async()=>{
  let reads=0;
  const policy=gate(async()=>{reads++;return state();});
  assert.deepEqual(await policy.check(canonical),{
    status:'HOST_PROOF_REQUIRED',releaseSha256:release,path:'index.html',
    sha256:'c'.repeat(64),deployable:false,publicUrl:null
  });
  assert.deepEqual(await policy.check(asset),{
    status:'HOST_PROOF_REQUIRED',releaseSha256:release,path,
    sha256:digest,deployable:false,publicUrl:null
  });
  assert.equal(reads,2);
});

test('unpublish, private and operator restriction block both canonical and direct asset access',async()=>{
  for(const status of ['UNPUBLISHED','PRIVATE','RESTRICTED'] as const){
    const policy=gate(async()=>({...state(),status}));
    for(const req of [canonical,asset]){
      assert.deepEqual(await policy.check(req),{
        status:'DENY',reason:'NOT_LIVE',deployable:false,publicUrl:null
      });
    }
  }
});

test('pointer switch and rollback reject old direct release digests',async()=>{
  const policy=gate(async()=>({...state(),releaseSha256:'d'.repeat(64)}));
  assert.equal((await policy.check(asset)).status,'DENY');
  assert.deepEqual(await policy.check({...asset,releaseSha256:'d'.repeat(64)}),{
    status:'HOST_PROOF_REQUIRED',releaseSha256:'d'.repeat(64),path,
    sha256:digest,deployable:false,publicUrl:null
  });
});

test('missing revocation propagation, stale data and future reads fail closed',async()=>{
  for(const s of [
    {...state(),appliedRevocationGeneration:6},
    {...state(),readAtMs:now-2001},
    {...state(),readAtMs:now+1}
  ]){
    const result=await gate(async()=>s).check(asset);
    assert.equal(result.status,'DENY');
  }
});

test('provider outages, missing state, invalid manifest and wrong portfolio fail closed',async()=>{
  assert.deepEqual(await gate(async()=>{throw Error('outage');}).check(canonical),{
    status:'DENY',reason:'PROVIDER_UNAVAILABLE',deployable:false,publicUrl:null
  });
  for(const s of [null,{}, {...state(),portfolioId:'20000000-0000-4000-8000-000000000002'},
    {...state(),files:[{path:'../index.html',sha256:digest}]},
    {...state(),files:[...state().files,state().files[0]]},
    {...state(),files:[]},{...state(),generation:0},
    {...state(),releaseSha256:'not-sha'}]){
    assert.equal((await gate(async()=>s).check(canonical)).status,'DENY');
  }
});

test('unlisted direct assets require exact content hash, allowlist, and canonical path',async()=>{
  const policy=gate(async()=>state());
  for(const req of [
    {...asset,sha256:'c'.repeat(64)},
    {...asset,path:'assets/'+'c'.repeat(64)+'.css',sha256:'c'.repeat(64)},
    {...asset,path:'assets/../index.html'},
    {...asset,path:'assets/'+digest+'.css?download=1'},
    {...asset,path:'assets/'+digest+'.CSS'},
    {...asset,path:'assets/'+digest+'.css/../index.html'},
    {...asset,path:'index.html'},
    {...asset,releaseSha256:'not-a-sha'},
    {...asset,unexpected:true}
  ])assert.equal((await policy.check(req)).status,'DENY');
});

test('invalid public request cannot trigger a backend lookup',async()=>{
  let reads=0;
  const policy=gate(async()=>{reads++;return state();});
  for(const req of [null,{},
    {...canonical,portfolioId:'invalid'},
    {...canonical,unknown:'surprise'},
    {...canonical,resource:'DIRECT_ASSET'},
    {...asset,portfolioId:'invalid'}]){
    assert.deepEqual(await policy.check(req),{
      status:'DENY',reason:'INVALID_REQUEST',deployable:false,publicUrl:null
    });
  }
  assert.equal(reads,0);
});

test('an unavailable release or an unlisted file never yields a candidate',async()=>{
  for(const s of [{...state(),releaseSha256:null},
    {...state(),files:[{path:'index.html',sha256:'c'.repeat(64)}]}]){
    const r=await gate(async()=>s).check(asset);
    assert.equal(r.status,'DENY');
  }
});
