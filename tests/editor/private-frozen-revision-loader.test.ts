import test from 'node:test';
import assert from 'node:assert/strict';
import {SupabasePrivateFrozenRevisionLoader} from '../../packages/storage-adapters/src/private-frozen-revision-loader.ts';
import {prepareSafeStaticPreview} from '../../packages/editor-core/src/publish-preflight.ts';

const reqId='10000000-0000-4000-8000-000000000001';
const portfolioId='20000000-0000-4000-8000-000000000002';
const sha='a'.repeat(64);
const snapshot={formatVersion:1,files:{
  'kadmeion.json':JSON.stringify({formatVersion:1,seo:{title:'Owner',description:'Projects'}})
},slots:{hero:{state:'S0',componentId:'title-stacked@1',content:{title:'Hello'}}},stashes:{}};
const request={id:reqId,portfolio_id:portfolioId,revision:1,snapshot_sha256:sha,
  visibility_intent:'PUBLIC',status:'FROZEN'};
const revision={portfolio_id:portfolioId,revision:1,snapshot_sha256:sha,snapshot};
function make(input:{frozen?:unknown;portfolio?:unknown;revision?:unknown;status?:number;disconnect?:boolean}={}) {
  const calls: Array<{url:string;options:RequestInit}>=[];
  const fetcher=(async(url:string|URL|Request,options?:RequestInit)=>{
    calls.push({url:String(url),options:options??{}});
    if(input.disconnect)throw new Error('Offline');
    const parsed=new URL(String(url));
    const rows=parsed.pathname.endsWith('private_release_requests')?
      input.frozen??[request]:parsed.pathname.endsWith('/portfolios')?
      input.portfolio??[{id:portfolioId,trashed_at:null}]:
      input.revision??[revision];
    return new Response(JSON.stringify(rows),{status:input.status??200,
      headers:{'Content-Type':'application/json'}});
  }) as typeof fetch;
  return {loader:new SupabasePrivateFrozenRevisionLoader(
    'https://unit.supabase.co','sb_publishable_test_only',async()=> 'real.jwt.auth',fetcher),calls};
}
test('authenticated frozen revision reload uses three owner-only uncached REST reads',async()=>{
  const {loader,calls}=make();
  const loaded=await loader.load(reqId);
  assert.equal(loaded.loadedRevision,1);
  assert.equal(loaded.loadedSnapshotSha256,sha);
  assert.equal(loaded.frozen.publicUrl,null);
  assert.deepEqual(loaded.snapshot,snapshot);
  assert.equal(calls.length,3);
  for(const call of calls){
    assert.equal(call.options.method,'GET');
    assert.equal((call.options.headers as Record<string,string>).Authorization,'Bearer real.jwt.auth');
    assert.equal(call.options.credentials,'omit');
    assert.equal(call.options.cache,'no-store');
    assert.equal(call.options.redirect,'error');
    assert.doesNotMatch(call.url,/service_role|secret/);
  }
  const preview=prepareSafeStaticPreview({...loaded,plan:[
    {slotKey:'hero',componentId:'title-stacked@1',kind:'heading',required:true}
  ]});
  assert.equal(preview.status,'PREVIEW_ONLY');
  assert.equal(preview.publicationReady,false);
});
test('private frozen owner query not found and lack of session both reject',async()=>{
  await assert.rejects(make({frozen:[]}).loader.load(reqId),{code:'NOT_FOUND'});
  const {calls}=make();
  const missing=new SupabasePrivateFrozenRevisionLoader('https://unit.supabase.co','key',
    async()=>null,async()=>{throw new Error('Must not be called')} );
  await assert.rejects(missing.load(reqId),{code:'AUTH_EXPIRED'});
  assert.equal(calls.length,0);
});
test('stale digest, wrong revision, cross-owner and deleted portfolio fail closed',async()=>{
  for(const data of [
    {revision:[{...revision,snapshot_sha256:'b'.repeat(64)}]},
    {revision:[{...revision,revision:2}]},
    {revision:[]},
    {portfolio:[]},
    {portfolio:[{id:portfolioId,trashed_at:'2026-01-01T00:00:00Z'}]},
    {frozen:[{...request,id:'30000000-0000-4000-8000-000000000003'}]},
    {frozen:[{...request,status:'LIVE'}]}
  ])await assert.rejects(make(data).loader.load(reqId));
});
test('malformed snapshot, duplicate rows and invalid digest are not previewable',async()=>{
  await assert.rejects(make({revision:[{...revision,snapshot:{formatVersion:1}}]}).loader.load(reqId),
    {code:'INTEGRITY_FAILED'});
  await assert.rejects(make({frozen:[request,request]}).loader.load(reqId),{code:'NOT_FOUND'});
  await assert.rejects(make({frozen:[{...request,snapshot_sha256:'bad'}]}).loader.load(reqId),
    {code:'INTEGRITY_FAILED'});
});
test('network failure or REST denial does not return unverified bytes',async()=>{
  await assert.rejects(make({disconnect:true}).loader.load(reqId),{code:'PROVIDER_UNAVAILABLE'});
  await assert.rejects(make({status:401}).loader.load(reqId),{code:'AUTH_EXPIRED'});
  await assert.rejects(make({status:403}).loader.load(reqId),{code:'AUTH_EXPIRED'});
  await assert.rejects(make({status:500}).loader.load(reqId),{code:'PROVIDER_UNAVAILABLE'});
  await assert.rejects(make({frozen:{id:reqId}}).loader.load(reqId),{code:'INTEGRITY_FAILED'});
});
test('invalid HTTP origin or request identifiers reject before network access',async()=>{
  assert.throws(()=>new SupabasePrivateFrozenRevisionLoader('http://example.com','key',async()=>null),
    {code:'VALIDATION'});
  await assert.rejects(make().loader.load('../secret'),{code:'VALIDATION'});
});
