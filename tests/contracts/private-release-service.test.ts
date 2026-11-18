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

test('C11 historical owner acknowledgement cursor preserves microseconds, tie order and private scope',async()=>{
  const ids=['40000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000005','60000000-0000-4000-8000-000000000006'];
  const rows=ids.map((intent_id,i)=>({intent_id,portfolio_id:portfolioId,request_id:requestId,
    verified_at:i===2?'2026-11-18T12:00:00.000001Z':'2026-11-18T12:00:00.000002Z'}));
  let calls=0;
  const service=client(async(input,init)=>{
    const url=new URL(String(input));calls++;
    assert.equal(url.pathname,'/rest/v1/verified_unlisted_releases');
    assert.equal(url.searchParams.get('select'),'intent_id,portfolio_id,request_id,verified_at');
    assert.equal(url.searchParams.get('portfolio_id'),'eq.'+portfolioId);
    assert.equal(url.searchParams.get('order'),'verified_at.desc,intent_id.asc');
    assert.equal(url.searchParams.get('limit'),'3');
    assert.equal(init?.method,'GET');assert.equal(init?.cache,'no-store');assert.equal(init?.redirect,'error');
    if(calls===1){assert.equal(url.searchParams.get('or'),null);return Response.json(rows)}
    assert.match(url.searchParams.get('or')??'',/000002Z/);
    assert.ok(url.searchParams.get('or')?.includes(ids[1]));
    return Response.json(rows.slice(2));
  });
  const first=await service.listAcknowledgements(portfolioId,2);
  assert.deepEqual(first.items,rows.slice(0,2).map(x=>({intentId:x.intent_id,portfolioId,requestId,verifiedAt:x.verified_at})));
  assert.deepEqual(first.nextCursor,{version:1,portfolioId,verifiedAt:rows[1].verified_at,intentId:ids[1]});
  assert.deepEqual(await service.listAcknowledgements(portfolioId,2,first.nextCursor),
    {items:[{intentId:ids[2],portfolioId,requestId,verifiedAt:rows[2].verified_at}],nextCursor:null});
  assert.equal(calls,2);
});
test('C11 history denies foreign rows, cursor replay, duplicate IDs, unverified flags and changed token',async()=>{
  const row={intent_id:operationId,portfolio_id:portfolioId,request_id:requestId,verified_at:'2026-11-18T12:00:00.000002Z'};
  const cursor={version:1 as const,portfolioId,verifiedAt:row.verified_at,intentId:operationId};
  for(const rows of [[{...row,portfolio_id:requestId}],[row,row],
    [{...row,publicServingEnabled:true}],[{...row,verified_at:'2026-02-30T00:00:00Z'}]]){
    await assert.rejects(client(async()=>Response.json(rows)).listAcknowledgements(portfolioId),{code:'INVALID_ACK'});
  }
  await assert.rejects(client(async()=>Response.json([row])).listAcknowledgements(portfolioId,1,cursor),{code:'INVALID_ACK'});
  let token='owner-token';const service=new SupabasePrivateReleaseService(base,'publishable-key',async()=>token,
    async()=>{token='different-owner-token';return Response.json([row])});
  await assert.rejects(service.listAcknowledgements(portfolioId),{code:'AUTH_EXPIRED'});
  let calls=0;const invalid=client(async()=>{calls++;return Response.json([])});
  await assert.rejects(invalid.listAcknowledgements(portfolioId,51),{code:'VALIDATION'});
  await assert.rejects(invalid.listAcknowledgements(portfolioId,1,{...cursor,portfolioId:requestId}),{code:'VALIDATION'});
  assert.equal(calls,0);
});
test('C11 bounded freeze transport never admits misdirected or malformed success acknowledgements',async()=>{
  const target=base+'/rest/v1/rpc/freeze_private_release_request';
  for(const patch of [{redirected:true,url:target},{url:'https://foreign.invalid/freeze'}]){
    const response=Response.json(receipt);
    for(const [name,value] of Object.entries(patch))Object.defineProperty(response,name,{value});
    let calls=0;
    await assert.rejects(client(async()=>{calls++;return response}).freeze(portfolioId,operationId,1,'PUBLIC'),{code:'PROVIDER_UNAVAILABLE'});
    assert.equal(calls,1);
  }
  let token='owner-token';
  const changed=new SupabasePrivateReleaseService(base,'publishable-key',async()=>token,
    async()=>{token='other-token';return Response.json(receipt)});
  await assert.rejects(changed.freeze(portfolioId,operationId,1,'PUBLIC'),{code:'AUTH_EXPIRED'});
});
