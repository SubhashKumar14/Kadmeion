import test from 'node:test';
import assert from 'node:assert/strict';
import {PrivateServerDeliveryDenialGate,type PrivateGateRequest} from
  '../../packages/storage-adapters/src/private-delivery-denial-gate.ts';
const id='10000000-0000-4000-8000-000000000001';
const hash='a'.repeat(64),assetHash='b'.repeat(64);
const canonical={portfolioId:id,resource:'CANONICAL_HTML'} as const;
const asset={portfolioId:id,resource:'DIRECT_ASSET',
  releaseSha256:hash,path:'assets/'+assetHash+'.png',sha256:assetHash} as const;
const response=(req:PrivateGateRequest,reason='NO_VERIFIED_PUBLIC_RELEASE',
  generation=1,revocationGeneration=0)=>({
    portfolioId:req.portfolioId,resource:req.resource,status:'DENY',reason,
    generation,revocationGeneration,servingAllowed:false,
    publicUrl:null,hostRevocationVerified:false
});
test('canonical and immutable direct asset independently re-read trusted DB',async()=>{
  let reads=0;
  const g=new PrivateServerDeliveryDenialGate({readDenial:async(req)=>{
    reads++;return response(req);
  }});
  for(const request of [canonical,asset]){
    const result=await g.check(request);
    assert.equal(result.status,'DENY');
    assert.equal(result.reason,'NO_VERIFIED_PUBLIC_RELEASE');
    assert.equal(result.servingAllowed,false);
  }
  assert.equal(reads,2);
});
test('revocation changes generation but cannot expose old assets',async()=>{
  let blocked=false;
  const g=new PrivateServerDeliveryDenialGate({readDenial:async(req)=>
    response(req,blocked?'PRIVATE_POINTER_BLOCKED':'NO_VERIFIED_PUBLIC_RELEASE',
      blocked?2:1,blocked?2:0)});
  assert.equal((await g.check(asset)).reason,'NO_VERIFIED_PUBLIC_RELEASE');
  blocked=true;
  assert.equal((await g.check(canonical)).reason,'PRIVATE_POINTER_BLOCKED');
  assert.equal((await g.check(asset)).revocationGeneration,2);
});
test('invalid requests never query trusted service role',async()=>{
  let reads=0;
  const g=new PrivateServerDeliveryDenialGate({readDenial:async(req)=>{
    reads++;return response(req);
  }});
  for(const input of [null,{}, {...canonical,extra:true},
    {...canonical,portfolioId:'invalid'},{...asset,sha256:hash},
    {...asset,path:'assets/../index.html'},
    {...asset,path:'assets/'+assetHash+'.svg'},
    {...asset,path:'assets/'+assetHash+'.png?dl=1'},
    {...asset,releaseSha256:'bad'}, {...asset,extra:1}]){
    assert.equal((await g.check(input)).reason,'INVALID_REQUEST');
  }
  assert.equal(reads,0);
});
test('forged ALLOW, public URL, wrong pointer or impossible revocation fail closed',async()=>{
  for(const data of [
    {...response(canonical),status:'ALLOW'},
    {...response(canonical),servingAllowed:true},
    {...response(canonical),publicUrl:'https://example.test'},
    {...response(canonical),hostRevocationVerified:true},
    {...response(canonical),portfolioId:'20000000-0000-4000-8000-000000000002'},
    {...response(canonical),resource:'DIRECT_ASSET'},
    {...response(canonical),generation:0.5},
    {...response(canonical),generation:-1},
    {...response(canonical),revocationGeneration:4},
    {...response(canonical),reason:'LIVE_VERIFIED'},
    {...response(canonical),privateOwner:'leak'},
    null,[]
  ]){
    const g=new PrivateServerDeliveryDenialGate({readDenial:async()=>data});
    assert.equal((await g.check(canonical)).reason,'STATE_UNVERIFIED');
  }
});
test('provider downtime denies both canonical and direct asset requests',async()=>{
  const g=new PrivateServerDeliveryDenialGate({readDenial:async()=>{
    throw new Error('no provider');
  }});
  for(const r of [canonical,asset]){
    assert.deepEqual(await g.check(r),{
      status:'DENY',reason:'PROVIDER_UNAVAILABLE',generation:0,
      revocationGeneration:0,servingAllowed:false,publicUrl:null,
      hostRevocationVerified:false
    });
  }
});
