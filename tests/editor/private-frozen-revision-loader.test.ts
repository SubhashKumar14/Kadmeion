import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SupabasePrivateFrozenRevisionLoader} from '../../packages/storage-adapters/src/private-frozen-revision-loader.ts';
import {prepareSafeStaticPreview} from '../../packages/editor-core/src/publish-preflight.ts';

const reqId='10000000-0000-4000-8000-000000000001';
const portfolioId='20000000-0000-4000-8000-000000000002';
const snapshot={formatVersion:1,files:{
  'kadmeion.json':JSON.stringify({formatVersion:1,seo:{title:'Owner',description:'Projects'}})
},slots:{hero:{state:'S0',componentId:'title-stacked@1',content:{title:'Hello'}}},stashes:{}};
const snapshotCanonicalJson=JSON.stringify(snapshot);
const sha=createHash('sha256').update(snapshotCanonicalJson).digest('hex');
const receipt={requestId:reqId,portfolioId,revision:1,snapshotSha256:sha,
  snapshotCanonicalJson,
  visibilityIntent:'PUBLIC',status:'FROZEN',publicUrl:null,snapshot};
const origin='https://unit.supabase.co';
const client=(http:typeof fetch,jwt:string|null='real.jwt.auth')=>
  new SupabasePrivateFrozenRevisionLoader(origin,'sb_publishable_test_only',async()=>jwt,http);

test('atomic owner RPC returns pinned private snapshot with no public authority',async()=>{
  let calls=0;
  const loader=client(async(url,init)=>{
    calls++;
    assert.equal(String(url),origin+'/rest/v1/rpc/load_private_frozen_revision');
    assert.equal(init?.method,'POST');
    assert.equal(init?.credentials,'omit');
    assert.equal(init?.cache,'no-store');
    assert.equal(init?.redirect,'error');
    assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer real.jwt.auth');
    assert.equal((init?.headers as Record<string,string>).apikey,'sb_publishable_test_only');
    assert.deepEqual(JSON.parse(init?.body as string),{p_request_id:reqId});
    return Response.json({...receipt,unrelatedPrivateData:'not projected'});
  });
  const loaded=await loader.load(reqId);
  assert.equal(calls,1);
  assert.deepEqual(loaded.snapshot,snapshot);
  assert.ok(Object.isFrozen(loaded.snapshot));
  assert.ok(Object.isFrozen(loaded.snapshot.slots.hero.content));
  assert.equal(loaded.loadedPortfolioId,portfolioId);
  assert.equal(loaded.loadedRevision,1);
  assert.equal(loaded.loadedSnapshotSha256,sha);
  assert.equal(loaded.frozen.publicUrl,null);
  assert.equal('unrelatedPrivateData' in loaded,false);
  const preview=prepareSafeStaticPreview({...loaded,plan:[
    {slotKey:'hero',componentId:'title-stacked@1',kind:'heading',required:true}
  ]});
  assert.equal(preview.status,'PREVIEW_ONLY');
  assert.equal(preview.publicationReady,false);
});
test('unauthenticated requests and invalid IDs fail before network',async()=>{
  let calls=0;
  const fail=async()=>{calls++;throw Error('network must not be called');};
  await assert.rejects(client(fail).load('../secret'),{code:'VALIDATION'});
  await assert.rejects(client(fail,null).load(reqId),{code:'AUTH_EXPIRED'});
  assert.equal(calls,0);
});
test('cross-owner, missing, trashed and damaged database receipts fail closed',async()=>{
  for(const [status,message,code] of [
    [400,'PRIVATE_FROZEN_REVISION_NOT_FOUND','NOT_FOUND'],
    [403,'PRIVATE_FROZEN_REVISION_NOT_FOUND','NOT_FOUND'],
    [400,'PRIVATE_FROZEN_REVISION_INTEGRITY','INTEGRITY_FAILED'],
    [401,'AUTH_REQUIRED','AUTH_EXPIRED'],
    [500,'UNKNOWN','PROVIDER_UNAVAILABLE']
  ] as const){
    await assert.rejects(client(async()=>Response.json({message},{status})).load(reqId),{code});
  }
});
test('mismatched pins, missing fields and public claims are rejected',async()=>{
  for(const invalid of [
    {...receipt,requestId:portfolioId},{...receipt,portfolioId:'not-a-uuid'},
    {...receipt,revision:0},{...receipt,snapshotSha256:'bad'},
    {...receipt,visibilityIntent:'PRIVATE'},{...receipt,status:'LIVE'},
    {...receipt,publicUrl:'https://example.invalid'},
    {...receipt,snapshot:{formatVersion:1}},
    {...receipt,snapshot:null},
    {...receipt,snapshotCanonicalJson:'{}'},
    {...receipt,snapshotCanonicalJson:'not-json'},
    {...receipt,snapshotSha256:'f'.repeat(64)},
    {...receipt,snapshot:{...snapshot,slots:{}}},
    null,[],{}
  ]){
    await assert.rejects(client(async()=>Response.json(invalid)).load(reqId),
      {code:'INTEGRITY_FAILED'});
  }
});
test('provider outages, invalid JSON and auth denial do not return private bytes',async()=>{
  await assert.rejects(client(async()=>{throw Error('offline');}).load(reqId),
    {code:'PROVIDER_UNAVAILABLE'});
  await assert.rejects(client(async()=>new Response('not json')).load(reqId),
    {code:'INTEGRITY_FAILED'});
  await assert.rejects(client(async()=>Response.json({}, {status:403})).load(reqId),
    {code:'AUTH_EXPIRED'});
});
test('only a clean trusted Supabase API origin is accepted',()=>{
  for(const bad of [
    'not a url','http://remote.example','https://user:password@unit.supabase.co',
    origin+'/rest/v1',origin+'/?x=1',origin+'/#fragment'
  ]){
    assert.throws(()=>new SupabasePrivateFrozenRevisionLoader(bad,'key',async()=>null),
      {code:'VALIDATION'});
  }
  assert.throws(()=>new SupabasePrivateFrozenRevisionLoader(origin,' ',async()=>null),
    {code:'VALIDATION'});
});

test('post-load mutations cannot alter the attested render input',async()=>{
  const loaded=await client(async()=>Response.json(receipt)).load(reqId);
  assert.throws(()=>{loaded.snapshot.slots.hero.content.title='Injected';},TypeError);
  assert.equal(loaded.snapshot.slots.hero.content.title,'Hello');
  const cloned=structuredClone(loaded.snapshot);
  assert.notStrictEqual(cloned,loaded.snapshot);
});
test('a forged canonical string cannot borrow the database SHA',async()=>{
  const altered=JSON.stringify({...snapshot,slots:{...snapshot.slots,
    hero:{...snapshot.slots.hero,content:{title:'Forged'}}}});
  await assert.rejects(client(async()=>Response.json({
    ...receipt,snapshotCanonicalJson:altered,snapshot:JSON.parse(altered)
  })).load(reqId),{code:'INTEGRITY_FAILED'});
});
