import test from 'node:test';
import assert from 'node:assert/strict';
import {SupabasePrivateReleasePointerService} from
  '../../packages/contracts/src/private-release-visibility-service.ts';

const base='https://kadmeion.supabase.co';
const portfolio='10000000-0000-4000-8000-000000000001';
const request='20000000-0000-4000-8000-000000000002';
const operation='30000000-0000-4000-8000-000000000003';
const digest='a'.repeat(64);
const flags={publicServingEnabled:false,publicUrl:null,hostRevocationVerified:false} as const;
const prepared={portfolioId:portfolio,status:'PREPARED_PRIVATE',generation:1,
  alreadyRecorded:false,...flags} as const;
const blocked={portfolioId:portfolio,status:'BLOCKED',generation:2,
  stillBlocked:true,alreadyRecorded:false,...flags} as const;
const state={portfolioId:portfolio,status:'BLOCKED',generation:2,
  revocationGeneration:2,candidateRequestId:null,candidateManifestSha256:null,
  ...flags} as const;
const client=(http:typeof fetch,jwt:string|null='owner-token')=>
  new SupabasePrivateReleasePointerService(base,'publishable',async()=>jwt,http);

test('prepare pins private candidate using owner JWT and expected generation',async()=>{
  let calls=0;
  const service=client(async(url,init)=>{
    calls++;
    assert.equal(url,base+'/rest/v1/rpc/owner_prepare_private_release_pointer');
    assert.equal(init?.method,'POST');
    assert.equal(init?.credentials,'omit');
    assert.equal(init?.cache,'no-store');
    assert.equal(init?.redirect,'error');
    assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer owner-token');
    assert.deepEqual(JSON.parse(init?.body as string),{
      p_portfolio_id:portfolio,p_request_id:request,p_manifest_sha256:digest,
      p_expected_generation:0,p_operation_id:operation
    });
    return Response.json({...prepared,untrustedExtra:'not projected'});
  });
  assert.deepEqual(await service.prepare(portfolio,request,digest,0,operation),prepared);
  assert.equal(calls,1);
});

test('owner block is not a host revocation claim',async()=>{
  const service=client(async(url,init)=>{
    assert.equal(url,base+'/rest/v1/rpc/owner_block_private_release_pointer');
    assert.deepEqual(JSON.parse(init?.body as string),{
      p_portfolio_id:portfolio,p_operation_id:operation
    });
    return Response.json(blocked);
  });
  assert.deepEqual(await service.block(portfolio,operation),blocked);
});

test('read returns only private state and no public serving authority',async()=>{
  const service=client(async(url,init)=>{
    assert.equal(url,base+'/rest/v1/rpc/owner_read_private_release_pointer');
    assert.equal(init?.cache,'no-store');
    assert.deepEqual(JSON.parse(init?.body as string),{p_portfolio_id:portfolio});
    return Response.json({...state,owner_user_id:'not projected'});
  });
  assert.deepEqual(await service.read(portfolio),state);
});

test('stale replay of block never falsely claims a new candidate is blocked',async()=>{
  const replay={...blocked,status:'PREPARED_PRIVATE',stillBlocked:false,alreadyRecorded:true};
  assert.deepEqual(await client(async()=>Response.json(replay)).block(portfolio,operation),replay);
  for(const forged of [
    {...replay,stillBlocked:true},{...blocked,stillBlocked:false},
    {...replay,alreadyRecorded:false}
  ]){
    await assert.rejects(client(async()=>Response.json(forged)).block(portfolio,operation),
      {code:'INVALID_ACK'});
  }
});

test('fabricated live states, public URLs and proof flags are rejected',async()=>{
  for(const bad of [
    {...prepared,status:'LIVE_VERIFIED'},
    {...prepared,publicServingEnabled:true},
    {...prepared,publicUrl:'https://example.test'},
    {...prepared,hostRevocationVerified:true},
    {...prepared,generation:7},
    {...prepared,alreadyRecorded:'yes'}
  ]){
    await assert.rejects(client(async()=>Response.json(bad)).prepare(
      portfolio,request,digest,0,operation),{code:'INVALID_ACK'});
  }
  for(const bad of [
    {...state,status:'LIVE_VERIFIED'},
    {...state,candidateManifestSha256:digest},
    {...state,revocationGeneration:3},
    {...state,publicUrl:'https://example.test'},
    {...state,hostRevocationVerified:true}
  ]){
    await assert.rejects(client(async()=>Response.json(bad)).read(portfolio),
      {code:'INVALID_ACK'});
  }
});

test('prepared state requires a real candidate and a valid manifest digest',async()=>{
  const good={...state,status:'PREPARED_PRIVATE',candidateRequestId:request,
    candidateManifestSha256:digest};
  assert.equal((await client(async()=>Response.json(good)).read(portfolio)).status,
    'PREPARED_PRIVATE');
  for(const bad of [{...good,candidateRequestId:null},
    {...good,candidateManifestSha256:'invalid'}]){
    await assert.rejects(client(async()=>Response.json(bad)).read(portfolio),
      {code:'INVALID_ACK'});
  }
});

test('bad inputs and expired sessions fail before HTTP',async()=>{
  let calls=0;
  const service=client(async()=>{calls++;throw Error('must not fetch');});
  await assert.rejects(service.prepare(portfolio,request,'wrong',0,operation),{code:'VALIDATION'});
  await assert.rejects(service.prepare(portfolio,request,digest,-1,operation),{code:'VALIDATION'});
  await assert.rejects(service.block('../other',operation),{code:'VALIDATION'});
  await assert.rejects(service.read('bad'),{code:'VALIDATION'});
  assert.equal(calls,0);
  await assert.rejects(client(async()=>{throw Error('must not fetch');},null).read(portfolio),
    {code:'AUTH_EXPIRED'});
});

test('conflicts, authorization errors and provider outages fail closed',async()=>{
  for(const [status,body,code] of [
    [401,{},'AUTH_EXPIRED'],[403,{},'FORBIDDEN'],
    [409,{},'CONFLICT'],[400,{message:'PRIVATE_POINTER_CONFLICT'},'CONFLICT'],
    [400,{message:'PRIVATE_FROZEN_REQUEST_UNAVAILABLE'},'REVISION_UNAVAILABLE'],
    [400,{message:'PRIVATE_POINTER_OPERATION_REUSED'},'CONFLICT']
  ] as const){
    await assert.rejects(client(async()=>Response.json(body,{status})).block(
      portfolio,operation),{code});
  }
  await assert.rejects(client(async()=>{throw Error('offline');}).read(portfolio),
    {code:'PROVIDER_UNAVAILABLE'});
  await assert.rejects(client(async()=>Response.json(null)).read(portfolio),
    {code:'INVALID_ACK'});
});

test('untrusted origins and missing publishable keys are rejected',()=>{
  for(const endpoint of ['not-url','http://evil.example',
    'https://u:p@kadmeion.supabase.co',base+'/rest/v1',base+'/?x=1',base+'/#fragment']){
    assert.throws(()=>new SupabasePrivateReleasePointerService(endpoint,'key',async()=>null),
      {code:'VALIDATION'});
  }
  assert.throws(()=>new SupabasePrivateReleasePointerService(base,' ',async()=>null),
    {code:'VALIDATION'});
});
