import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PrivateServerAssetByteAttestor} from
  '../../packages/storage-adapters/src/private-server-asset-byte-attestor.ts';

const owner='10000000-0000-4000-8000-000000000001';
const assetId='20000000-0000-4000-8000-000000000002';
const objectId='30000000-0000-4000-8000-000000000003';
const path=owner+'/cover/image.png';
const png=new Uint8Array([137,80,78,71,13,10,26,10]);
const digest=createHash('sha256').update(png).digest('hex');
const info={id:objectId,name:path,bucket_id:'kadmeion-private-assets',
  owner_id:owner,version:'v1',last_modified:'2026-11-14T12:00:00.000Z',
  content_type:'image/png',size:png.length};
type Overrides={asset?:Record<string,unknown>;infoAfter?:Record<string,unknown>;
  infoBefore?:Record<string,unknown>;bytes?:Uint8Array;receipt?:Record<string,unknown>;
  user?:Record<string,unknown>;fail?:string};
function setup(overrides:Overrides={}){
  const calls:{path:string;key:string;auth:string;body?:unknown}[]=[];
  let infoCalls=0;
  const fetcher:typeof fetch=async(input,init)=>{
    const url=new URL(String(input));
    const headers=init?.headers as Record<string,string>;
    const body=init?.body===undefined?undefined:JSON.parse(init.body as string);
    calls.push({path:url.pathname+url.search,key:headers.apikey,
      auth:headers.Authorization,body});
    assert.equal(url.origin,'https://example.supabase.co');
    assert.equal(init?.credentials,'omit');
    assert.equal(init?.redirect,'error');
    assert.equal(init?.cache,'no-store');
    if(overrides.fail&&url.pathname.includes(overrides.fail))
      return Response.json({error:'denied'},{status:503});
    if(url.pathname==='/auth/v1/user')
      return Response.json(overrides.user??{id:owner});
    if(url.pathname==='/rest/v1/portfolios')
      return Response.json([{id:'40000000-0000-4000-8000-000000000004',owner_user_id:owner}]);
    if(url.pathname==='/rest/v1/project_assets')
      return Response.json([{id:assetId,owner_user_id:owner,object_path:path,
        mime_type:'image/png',byte_size:png.length,...overrides.asset}]);
    if(url.pathname.startsWith('/storage/v1/object/info/authenticated/')){
      infoCalls++;
      return Response.json({...info,...(infoCalls===1?overrides.infoBefore:overrides.infoAfter)});
    }
    if(url.pathname.startsWith('/storage/v1/object/authenticated/'))
      return new Response(overrides.bytes??png,{headers:{'content-type':'image/png'}});
    if(url.pathname==='/rest/v1/rpc/record_private_asset_content_attestation'){
      assert.equal(headers.apikey,'trusted-service-key');
      assert.equal(headers.Authorization,'Bearer trusted-service-key');
      assert.deepEqual(body,{p_asset_id:assetId,p_storage_object_id:objectId,
        p_storage_version:'v1',p_expected_sha256:digest});
      return Response.json(overrides.receipt??{assetId,status:'WRITE_ONCE_ATTESTED',
        providerSigned:false,deletionAllowed:false});
    }
    throw new Error('Unexpected path '+url.pathname);
  };
  return {worker:new PrivateServerAssetByteAttestor('https://example.supabase.co',
    'publishable','trusted-service-key',fetcher),calls};
}
test('trusted worker hashes owner bytes, checks both versions, pins only via service role',async()=>{
  const {worker,calls}=setup();
  assert.deepEqual(await worker.attest(assetId,'owner-jwt'),
    {assetId,status:'WRITE_ONCE_ATTESTED'});
  assert.equal(calls.length,6);
  assert.deepEqual(calls.map(c=>c.key),[
    'publishable','publishable','publishable','publishable','publishable','trusted-service-key']);
  assert.ok(calls.slice(0,5).every(c=>c.auth==='Bearer owner-jwt'));
  assert.equal(calls.filter(c=>c.path.includes('/object/info/')).length,2);
});
test('wrong owner or altered asset metadata never reaches privileged RPC',async()=>{
  for(const asset of [
    {owner_user_id:'40000000-0000-4000-8000-000000000004'},
    {object_path:owner+'/../escape.png'},
    {mime_type:'text/html'},{byte_size:0},{byte_size:6*1024*1024}
  ]){
    const {worker,calls}=setup({asset});
    await assert.rejects(worker.attest(assetId,'owner-jwt'));
    assert.ok(calls.every(c=>c.key!=='trusted-service-key'));
  }
});
test('same-size changed object version and changed bytes fail before privileged write',async()=>{
  for(const options of [
    {infoAfter:{version:'v2'}},
    {infoAfter:{id:'40000000-0000-4000-8000-000000000004'}},
    {infoBefore:{content_type:'image/jpeg'}},
    {bytes:png.slice(0,3)}
  ]){
    const {worker,calls}=setup(options);
    await assert.rejects(worker.attest(assetId,'owner-jwt'),{code:'INTEGRITY'});
    assert.ok(calls.every(c=>c.key!=='trusted-service-key'));
  }
});
test('server-side attestor rejects forged raster MIME before service credential is used',async()=>{
  for(const bytes of [
    new TextEncoder().encode('<script>'),new Uint8Array(8),
    new TextEncoder().encode('<svg></s')
  ]){
    const {worker,calls}=setup({bytes});
    await assert.rejects(worker.attest(assetId,'owner-jwt'),{code:'INTEGRITY'});
    assert.ok(calls.every(call=>call.key!=='trusted-service-key'));
  }
});
test('provider outage and forged receipt fail closed',async()=>{
  const outage=setup({fail:'/object/info/'});
  await assert.rejects(outage.worker.attest(assetId,'owner-jwt'),{code:'PROVIDER'});
  assert.ok(outage.calls.every(c=>c.key!=='trusted-service-key'));
  const receipt=setup({receipt:{assetId,status:'WRITE_ONCE_ATTESTED',
    providerSigned:true,deletionAllowed:false}});
  await assert.rejects(receipt.worker.attest(assetId,'owner-jwt'),{code:'INTEGRITY'});
});
test('bad credentials and non-local insecure origins are rejected',()=>{
  for(const url of ['http://remote.example/','https://example.supabase.co/path',
    'https://x:y@example.supabase.co/']){
    assert.throws(()=>new PrivateServerAssetByteAttestor(url,'public','service'),{code:'VALIDATION'});
  }
  assert.throws(()=>new PrivateServerAssetByteAttestor('https://example.supabase.co',
    'same','same'),{code:'VALIDATION'});
});

test('attestation worker cannot use a privileged key for owner-scoped reads',()=>{
 const jwt=['eyJhbGciOiJIUzI1NiJ9',
   Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url'),
   'c2lnbmF0dXJl'].join('.');
 for(const key of ['sb_secret_private',jwt])
   assert.throws(()=>new PrivateServerAssetByteAttestor(
     'https://example.supabase.co',key,'separate-service-key'
   ),{code:'VALIDATION'});
});

test('trusted frozen-media reader verifies owner portfolio, immutable asset pin and bytes',async()=>{
 const {worker,calls}=setup();
 const portfolioId='40000000-0000-4000-8000-000000000004';
 const receipt=await worker.forTrustedFrozenMedia('owner-jwt').readFrozenPinnedImage({
   assetId,portfolioId,revision:9
 });
 assert.equal(receipt.assetId,assetId);
 assert.equal(receipt.portfolioId,portfolioId);
 assert.equal(receipt.revision,9);
 assert.equal(receipt.sourceSha256,digest);
 assert.equal(receipt.mimeType,'image/png');
 assert.equal(receipt.storageVersion,'v1');
 assert.deepEqual(receipt.bytes,png);
 assert.ok(calls.find(c=>c.path.startsWith('/rest/v1/portfolios?')));
 assert.equal(calls.filter(c=>c.key==='trusted-service-key').length,1);
 assert.ok(calls.slice(0,-1).every(c=>c.key==='publishable'));
});
test('private media reader refuses wrong portfolio before using service credentials',async()=>{
 const {worker,calls}=setup();
 const reader=worker.forTrustedFrozenMedia('owner-jwt');
 await assert.rejects(reader.readFrozenPinnedImage({
   assetId,portfolioId:'60000000-0000-4000-8000-000000000006',revision:9
 }),{code:'AUTH'});
 assert.ok(calls.every(c=>c.key==='publishable'));
 await assert.rejects(reader.readFrozenPinnedImage({
   assetId,portfolioId:'invalid',revision:9
 }),{code:'VALIDATION'});
});
