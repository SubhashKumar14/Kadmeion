import assert from 'node:assert/strict';
import test from 'node:test';
import {SupabasePrivateReleaseService,PrivateReleaseError} from '../../packages/contracts/src/private-release-service.ts';

const portfolioId='10000000-0000-4000-8000-000000000001';
const operationId='20000000-0000-4000-8000-000000000002';
const requestId='30000000-0000-4000-8000-000000000003';
const base='https://kadmeion.supabase.co';
const receipt={
  requestId,portfolioId,revision:1,snapshotSha256:'a'.repeat(64),
  visibilityIntent:'PUBLIC',status:'FROZEN',publicUrl:null,alreadyFrozen:false
} as const;
const client=(fetcher:typeof fetch,token:string|null='signed-in-jwt')=>
  new SupabasePrivateReleaseService(base,'publishable-key',async()=>token,fetcher);

test('freezing pins a revision with owner bearer token but never a public URL',async()=>{
  let count=0;
  const service=client(async(url,init)=>{
    count++;
    assert.equal(url,base+'/rest/v1/rpc/freeze_private_release_request');
    assert.equal(init?.method,'POST');
    assert.equal(init?.credentials,'omit');
    assert.equal(init?.cache,'no-store');
    assert.equal(init?.redirect,'error');
    assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer signed-in-jwt');
    assert.equal((init?.headers as Record<string,string>).apikey,'publishable-key');
    assert.deepEqual(JSON.parse(init?.body as string),{
      p_portfolio_id:portfolioId,p_operation_id:operationId,p_revision:1,p_visibility_intent:'PUBLIC'
    });
    return Response.json(receipt);
  });
  assert.deepEqual(await service.freeze(portfolioId,operationId,1,'PUBLIC'),receipt);
  assert.equal(count,1);
});

test('duplicate response can be acknowledged idempotently',async()=>{
  const service=client(async()=>Response.json({...receipt,alreadyFrozen:true}));
  assert.equal((await service.freeze(portfolioId,operationId,1,'PUBLIC')).alreadyFrozen,true);
});

test('unverified or fabricated public release acknowledgement is rejected',async()=>{
  const service=client(async()=>Response.json({...receipt,status:'LIVE',publicUrl:'https://example.test'}));
  await assert.rejects(service.freeze(portfolioId,operationId,1,'PUBLIC'),{code:'INVALID_ACK'});
});

test('missing auth and invalid IDs make no network requests',async()=>{
  const bad=client(async()=>{throw Error('Must not call');});
  await assert.rejects(bad.freeze('../private',operationId,1,'PUBLIC'),{code:'VALIDATION'});
  const noToken=client(async()=>{throw Error('Must not call');},null);
  await assert.rejects(noToken.freeze(portfolioId,operationId,1,'PUBLIC'),{code:'AUTH_EXPIRED'});
});

test('provider and revision failures do not claim a frozen release',async()=>{
  const noRev=client(async()=>Response.json({message:'PRIVATE_REVISION_UNAVAILABLE'},{status:400}));
  await assert.rejects(noRev.freeze(portfolioId,operationId,1,'PUBLIC'),{code:'REVISION_UNAVAILABLE'});
  const offline=client(async()=>{throw Error('offline');});
  await assert.rejects(offline.freeze(portfolioId,operationId,1,'PUBLIC'),PrivateReleaseError);
});

test('private release client requires a clean trusted API origin before fetching',()=>{
  for(const endpoint of [
    'not-a-url','http://evil.example','https://user:pass@kadmeion.supabase.co',
    base+'/rest/v1',base+'/?next=evil',base+'/#fragment'
  ]){
    assert.throws(()=>new SupabasePrivateReleaseService(endpoint,'publishable-key',
      async()=>null),{code:'VALIDATION'});
  }
  assert.throws(()=>new SupabasePrivateReleaseService(base,' ',async()=>null),
    {code:'VALIDATION'});
});

test('private release URLs are built from a canonical origin, including local development',async()=>{
  let target='';
  const service=new SupabasePrivateReleaseService('http://localhost:54321/',
    'publishable-key',async()=> 'signed-in-jwt',async(url)=>{
      target=String(url);
      return Response.json(receipt);
    });
  await service.freeze(portfolioId,operationId,1,'PUBLIC');
  assert.equal(target,'http://localhost:54321/rest/v1/rpc/freeze_private_release_request');
});

test('release receipts with mismatched frozen content are rejected',async()=>{
  for(const ack of [
    {...receipt,portfolioId:operationId},{...receipt,revision:2},
    {...receipt,visibilityIntent:'UNLISTED'}, {...receipt,snapshotSha256:'short'},
    {...receipt,alreadyFrozen:'yes'}
  ]){
    await assert.rejects(client(async()=>Response.json(ack)).freeze(
      portfolioId,operationId,1,'PUBLIC'),{code:'INVALID_ACK'});
  }
});
