import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SupabasePrivateAccountDataExporter
} from '../../packages/storage-adapters/src/private-account-data-export.ts';

const owner='10000000-0000-4000-8000-000000000001';
const stranger='20000000-0000-4000-8000-000000000002';
const snapshot='30000000-0000-4000-8000-000000000003';
const origin='https://example.supabase.co';
const png=new Uint8Array([137,80,78,71,13,10,26,10]);
const assetPath=owner+'/cover-one/image.png';
const baseRows:Record<string,Record<string,unknown>[]> = {
  profiles:[{user_id:owner,handle:'owner'}],
  projects:[{id:'p1',owner_user_id:owner,title:'Private project'}],
  portfolios:[{id:'f1',owner_user_id:owner,title:'Draft portfolio'}],
  portfolio_revisions:[{portfolio_id:'f1',owner_user_id:owner,revision:1,snapshot:{files:{}}}],
  project_assets:[{id:'a1',owner_user_id:owner,object_path:assetPath,
    mime_type:'image/png',byte_size:png.length}]
};
const reconciliation={
  snapshotId:snapshot,status:'METADATA_MATCH_ONLY',limitExceeded:false,
  inventoryDrift:false,missingObjects:0,orphanObjects:0,metadataMismatches:0,
  registeredAssets:1,storageObjects:1,storageBytesVerified:false,
  downloadableExportReady:false,deletionAllowed:false
};
const json=(v:unknown,status=200)=>Response.json(v,{status});
type Options={
  rows?:Record<string,Record<string,unknown>[]>;
  reconcile?:Record<string,unknown>;
  assetBytes?:Uint8Array;
  assetMime?:string;
  identity?:string;
  after?:Record<string,unknown>;
  failPath?:string;
};
function fixture(options:Options={},token:()=>Promise<string|null>=async()=> 'owner-jwt'){
  const paths:string[]=[];
  let reconcileCount=0,identityCount=0;
  const fetcher:typeof fetch=async(input,init)=>{
    const url=new URL(String(input));paths.push(url.pathname+url.search);
    assert.equal(url.origin,origin);
    assert.equal(init?.method,'GET');
    assert.equal(init?.cache,'no-store');
    assert.equal(init?.redirect,'error');
    assert.equal(init?.credentials,'omit');
    assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer owner-jwt');
    if(options.failPath&&url.pathname.includes(options.failPath))
      return json({error:'provider failed'},503);
    if(url.pathname==='/auth/v1/user'){
      identityCount++;
      return json({id:identityCount===2&&options.identity?options.identity:owner,
        email:'owner@example.test',app_metadata:{secret:'not exported'}});
    }
    if(url.pathname==='/rest/v1/rpc/reconcile_private_account_exit_storage'){
      assert.equal(url.searchParams.get('p_snapshot_id'),snapshot);
      reconcileCount++;
      return json(reconcileCount===2&&options.after?options.after:
        (options.reconcile??reconciliation));
    }
    if(url.pathname.startsWith('/rest/v1/')){
      const table=url.pathname.split('/').at(-1)!;
      assert.equal(url.searchParams.get('limit'),'101');
      assert.equal(url.searchParams.get(table==='profiles'?'user_id':'owner_user_id'),
        'eq.'+owner);
      return json((options.rows??baseRows)[table]??[]);
    }
    if(url.pathname.startsWith('/storage/v1/object/authenticated/')){
      assert.equal(url.pathname,'/storage/v1/object/authenticated/kadmeion-private-assets/'+assetPath);
      return new Response(options.assetBytes??png,{
        headers:{'Content-Type':options.assetMime??'image/png'}
      });
    }
    throw Error('Unexpected URL: '+url);
  };
  return {service:new SupabasePrivateAccountDataExporter(origin,'publishable',token,fetcher),paths};
}
test('owner-only bounded export contains private records, real bytes and digest without secrets',async()=>{
  const {service,paths}=fixture();
  const result=await service.export(snapshot);
  assert.equal(result.status,'BOUNDED_PARTIAL_EXPORT');
  assert.equal(result.deletionAllowed,false);
  assert.equal(result.completeAccountExport,false);
  assert.equal(result.mime,'application/json');
  const body=JSON.parse(new TextDecoder().decode(result.bytes));
  assert.equal(body.owner.id,owner);
  assert.equal(body.owner.email,'owner@example.test');
  assert.equal(body.owner.app_metadata,undefined);
  assert.equal(body.records.projects[0].title,'Private project');
  assert.equal(body.records.portfolio_revisions[0].snapshot.files instanceof Object,true);
  assert.equal(body.assets.length,1);
  assert.deepEqual(Uint8Array.from(atob(body.assets[0].base64),c=>c.charCodeAt(0)),png);
  assert.match(body.assets[0].downloadedSha256,/^[a-f0-9]{64}$/);
  assert.equal(body.evidence.providerExpectedHashesVerified,false);
  assert.equal(body.evidence.crossTableAtomicSnapshot,false);
  assert.equal(body.limitations.completeAccountExport,false);
  assert.equal(body.limitations.deletionAllowed,false);
  assert.equal(paths.filter(p=>p.includes('reconcile_private_account_exit_storage')).length,2);
  assert.equal(paths.filter(p=>p==='/auth/v1/user').length,2);
});
test('no JWT or invalid inventory ID performs no private fetch',async()=>{
  const missing=fixture({},async()=>null);
  await assert.rejects(missing.service.export(snapshot),{code:'AUTH_EXPIRED'});
  assert.equal(missing.paths.length,0);
  const valid=fixture();
  await assert.rejects(valid.service.export('bad'),{code:'VALIDATION'});
  assert.equal(valid.paths.length,0);
});
test('cross-tenant table injection fails closed and never fetches Storage',async()=>{
  const rows={...baseRows,projects:[{id:'foreign',owner_user_id:stranger}]};
  const {service,paths}=fixture({rows});
  await assert.rejects(service.export(snapshot),{code:'INTEGRITY'});
  assert.equal(paths.some(p=>p.includes('/storage/v1/object/')),false);
});
test('reconciliation mismatches, forged readiness and provider outage are denied',async()=>{
  for(const altered of [
    {...reconciliation,status:'DISCREPANCY',missingObjects:1},
    {...reconciliation,inventoryDrift:true},
    {...reconciliation,downloadableExportReady:true},
    {...reconciliation,deletionAllowed:true},
    {...reconciliation,snapshotId:stranger}
  ]){
    await assert.rejects(fixture({reconcile:altered}).service.export(snapshot),
      {code:'UNVERIFIED'});
  }
  await assert.rejects(fixture({failPath:'reconcile_private_account_exit_storage'})
    .service.export(snapshot),{code:'PROVIDER_UNAVAILABLE'});
});
test('Storage byte-length, MIME and post-download drift are rejected',async()=>{
  await assert.rejects(fixture({assetBytes:png.slice(0,3)}).service.export(snapshot),
    {code:'INTEGRITY'});
  await assert.rejects(fixture({assetMime:'text/html'}).service.export(snapshot),
    {code:'INTEGRITY'});
  await assert.rejects(fixture({after:{...reconciliation,inventoryDrift:true}})
    .service.export(snapshot),{code:'UNVERIFIED'});
});
test('owner session changing during download invalidates the export',async()=>{
  await assert.rejects(fixture({identity:stranger}).service.export(snapshot),
    {code:'AUTH_EXPIRED'});
});
test('bounded limits reject 101 rows, 9 assets and forged paths',async()=>{
  const over={...baseRows,projects:Array.from({length:101},(_,i)=>({
    owner_user_id:owner,id:String(i)
  }))};
  await assert.rejects(fixture({rows:over}).service.export(snapshot),
    {code:'LIMIT_EXCEEDED'});
  const many={...baseRows,project_assets:Array.from({length:9},(_,i)=>({
    owner_user_id:owner,object_path:owner+'/a'+i+'/file.png',
    mime_type:'image/png',byte_size:1
  }))};
  await assert.rejects(fixture({rows:many,reconcile:{...reconciliation,
    registeredAssets:9,storageObjects:9}}).service.export(snapshot),
    {code:'LIMIT_EXCEEDED'});
  const unsafe={...baseRows,project_assets:[{owner_user_id:owner,
    object_path:owner+'/../secret',mime_type:'image/png',byte_size:8}]};
  await assert.rejects(fixture({rows:unsafe}).service.export(snapshot),
    {code:'INTEGRITY'});
});
test('untrusted endpoint is rejected before any fetch',()=>{
  for(const url of ['http://evil.example/','https://evil.example/route',
    'https://u:p@evil.example/','https://evil.example/?token=abc']){
    assert.throws(()=>new SupabasePrivateAccountDataExporter(url,'publishable',async()=>null),
      {code:'VALIDATION'});
  }
});
