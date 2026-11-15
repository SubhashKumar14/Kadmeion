import test from 'node:test';
import assert from 'node:assert/strict';
import {PrivatePublicDeliveryPolicy,PrivateVerifiedReleaseByteGate,type PrivateHostReleasePointer}
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
    {...asset,path:'assets/'+digest+'.svg'},
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

test('a later unpublish is observed by the next lookup, including for direct assets',async()=>{
  let current:'LIVE_VERIFIED'|'UNPUBLISHED'='LIVE_VERIFIED';
  let reads=0;
  const policy=gate(async()=>{reads++;return {...state(),status:current};});
  assert.equal((await policy.check(canonical)).status,'HOST_PROOF_REQUIRED');
  current='UNPUBLISHED';
  assert.deepEqual(await policy.check(asset),{
    status:'DENY',reason:'NOT_LIVE',deployable:false,publicUrl:null
  });
  assert.equal(reads,2);
});


test('B08 private byte gate verifies frozen HTML and content-addressed PNG with two authoritative reads',async()=>{
  const {createHash}=await import('node:crypto');
  const html=new TextEncoder().encode(
    '<!doctype html><meta name="robots" content="noindex,nofollow,noarchive">'+
    'script-src &#39;none&#39;<main>Owner-approved content</main>');
  const png=Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4]);
  const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
  const mediaHash=hash(png),htmlHash=hash(html);
  const approved=()=>({...state(),files:[
    {path:'index.html',sha256:htmlHash},
    {path:'assets/'+mediaHash+'.png',sha256:mediaHash}
  ]});
  let reads=0,fetches=0;
  const policy=gate(async()=>{reads++;return approved();});
  const read={
    readImmutable:async({path,releaseSha256,portfolioId:ownerId,expectedSha256}:{
      path:string;releaseSha256:string;portfolioId:string;expectedSha256:string
    })=>{
      assert.equal(releaseSha256,release);assert.equal(ownerId,portfolioId);
      fetches++;
      const content=path==='index.html'?html:png;
      assert.equal(expectedSha256,hash(content));
      return content;
    }
  };
  const verifier=new PrivateVerifiedReleaseByteGate(policy,read);
  const first=await verifier.inspect(canonical);
  assert.equal(first.status,'PRIVATE_BYTES_VERIFIED');
  if(first.status!=='PRIVATE_BYTES_VERIFIED')throw Error('unexpected denial');
  assert.equal(first.mimeType,'text/html; charset=utf-8');
  assert.equal(first.servingAllowed,false);
  assert.equal(first.hostRevocationVerified,false);
  assert.equal(first.publicUrl,null);
  assert.deepEqual(first.bytes,html);
  const second=await verifier.inspect({
    portfolioId,resource:'DIRECT_ASSET',releaseSha256:release,
    path:'assets/'+mediaHash+'.png',sha256:mediaHash
  });
  assert.equal(second.status,'PRIVATE_BYTES_VERIFIED');
  if(second.status!=='PRIVATE_BYTES_VERIFIED')throw Error('unexpected denial');
  assert.equal(second.mimeType,'image/png');
  assert.deepEqual(second.bytes,png);
  assert.equal(reads,4);assert.equal(fetches,2);
});

test('B08 private byte gate blocks withdrawal and rollback during asynchronous byte reads',async()=>{
  const {createHash}=await import('node:crypto');
  const html=new TextEncoder().encode(
    '<!doctype html>noindex,nofollow,noarchive script-src &#39;none&#39;');
  const sha=createHash('sha256').update(html).digest('hex');
  const current=()=>({...state(),files:[{path:'index.html',sha256:sha}]});
  for(const next of [
    {...current(),status:'PRIVATE' as const},
    {...current(),status:'RESTRICTED' as const},
    {...current(),releaseSha256:'d'.repeat(64)},
    {...current(),generation:8,appliedRevocationGeneration:8},
    {...current(),appliedRevocationGeneration:6}
  ]){
    let reads=0;
    const policy=gate(async()=>{reads++;return reads===1?current():next;});
    const verifier=new PrivateVerifiedReleaseByteGate(policy,{
      readImmutable:async()=>html
    });
    assert.deepEqual(await verifier.inspect(canonical),{
      status:'DENY',reason:'POINTER_CHANGED',servingAllowed:false,
      publicUrl:null,hostRevocationVerified:false
    });
    assert.equal(reads,2);
  }
});

test('B08 private byte gate refuses unsafe types and bad bytes without granting HTTP delivery',async()=>{
  const {createHash}=await import('node:crypto');
  const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
  const valid=new TextEncoder().encode('<!doctype html>noindex,nofollow,noarchive script-src &#39;none&#39;');
  const expected=hash(valid),png=Uint8Array.of(137,80,78,71,13,10,26,10);
  const pngHash=hash(png);
  const authorized=()=>({...state(),files:[
    {path:'index.html',sha256:expected},
    {path:'assets/'+pngHash+'.png',sha256:pngHash},
    {path:'assets/'+digest+'.css',sha256:digest}
  ]});
  let fetched=0,checked=0;
  const policy=gate(async()=>{checked++;return authorized();});
  const verifier=new PrivateVerifiedReleaseByteGate(policy,{
    readImmutable:async()=>{fetched++;return valid;}
  });
  const denied=await verifier.inspect({...asset});
  assert.equal(denied.status,'DENY');assert.equal(fetched,0);
  assert.equal(checked,1);
  const cases=[
    {raw:new Uint8Array(),reason:'INVALID_FILE_BYTES'},
    {raw:new Uint8Array(750001),reason:'BYTES_TOO_LARGE'},
    {raw:new TextEncoder().encode('<script>alert(1)</script>'),reason:'INVALID_FILE_BYTES'},
    {raw:new TextEncoder().encode('<!doctype html>noindex,nofollow,noarchive script-src &#39;none&#39;altered'),reason:'BYTE_HASH_MISMATCH'}
  ];
  for(const {raw,reason} of cases){
    const result=await new PrivateVerifiedReleaseByteGate(
      gate(async()=>authorized()),{readImmutable:async()=>raw}).inspect(canonical);
    assert.equal(result.status,'DENY');
    if(result.status==='DENY')assert.equal(result.reason,reason);
  }
  const wrongPng=await new PrivateVerifiedReleaseByteGate(
    gate(async()=>authorized()),{readImmutable:async()=>new Uint8Array(8)}
  ).inspect({
    portfolioId,resource:'DIRECT_ASSET',releaseSha256:release,
    path:'assets/'+pngHash+'.png',sha256:pngHash
  });
  assert.equal(wrongPng.status,'DENY');
  if(wrongPng.status==='DENY')assert.equal(wrongPng.reason,'INVALID_FILE_BYTES');
  const offline=await new PrivateVerifiedReleaseByteGate(
    gate(async()=>authorized()),{readImmutable:async()=>{throw new Error('Storage down');}}
  ).inspect(canonical);
  assert.equal(offline.status,'DENY');
  if(offline.status==='DENY')assert.equal(offline.reason,'READER_UNAVAILABLE');
});

test('B08 verifier never fetches private blobs for invalid requests or revoked first pointers',async()=>{
  let blobReads=0,authorityReads=0;
  const policy=gate(async()=>{authorityReads++;return {...state(),status:'UNPUBLISHED'};});
  const verifier=new PrivateVerifiedReleaseByteGate(policy,{
    readImmutable:async()=>{blobReads++;return new Uint8Array([1]);}
  });
  for(const request of [null,{},canonical,asset]){
    const result=await verifier.inspect(request);
    assert.equal(result.status,'DENY');
  }
  assert.equal(blobReads,0);
  assert.equal(authorityReads,2);
});


test('B08 generation token changes cannot be laundered by identical release hashes',async()=>{
 const make=()=>({...state(),generation:10,appliedRevocationGeneration:10,
   files:[{path:'index.html',sha256:'c'.repeat(64)}]});
 const unchanged=await gate(async()=>make()).checkWithGeneration(canonical);
 assert.equal(unchanged.generation,10);
 assert.equal(unchanged.decision.status,'HOST_PROOF_REQUIRED');
 const denied=await gate(async()=>({...make(),generation:11,
   appliedRevocationGeneration:10})).checkWithGeneration(canonical);
 assert.equal(denied.generation,null);
 assert.equal(denied.decision.status,'DENY');
});
