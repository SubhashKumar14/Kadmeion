import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  SupabasePrivateAccountDataExporter
} from '../../packages/storage-adapters/src/private-account-data-export.ts';

const owner='10000000-0000-4000-8000-000000000001';
const stranger='20000000-0000-4000-8000-000000000002';
const snapshot='30000000-0000-4000-8000-000000000003';
const origin='https://example.supabase.co';
const png=new Uint8Array([137,80,78,71,13,10,26,10]);
const assetPath=owner+'/cover-one/image.png';
const assetId='50000000-0000-4000-8000-000000000005';
const objectId='40000000-0000-4000-8000-000000000004';
const digest=createHash('sha256').update(png).digest('hex');
const baseRows:Record<string,Record<string,unknown>[]> = {
  profiles:[{user_id:owner,handle:'owner'}],
  projects:[{id:'p1',owner_user_id:owner,title:'Private project'}],
  portfolios:[{id:'f1',owner_user_id:owner,title:'Draft portfolio'}],
  portfolio_revisions:[{portfolio_id:'f1',owner_user_id:owner,revision:1,snapshot:{files:{}}}],
  project_assets:[{id:assetId,owner_user_id:owner,object_path:assetPath,
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
  infoBefore?:Record<string,unknown>;
  infoAfter?:Record<string,unknown>;
  attestation?:Record<string,unknown>;
  audit?:Record<string,unknown>;
  auditAfter?:Record<string,unknown>;
};
function fixture(options:Options={},token:()=>Promise<string|null>=async()=> 'owner-jwt'){
  const paths:string[]=[];
  let reconcileCount=0,identityCount=0,infoCount=0,auditCount=0;
  const fetcher:typeof fetch=async(input,init)=>{
    const url=new URL(String(input));paths.push(url.pathname+url.search);
    assert.equal(url.origin,origin);
    assert.equal(init?.method,url.pathname.includes('/rpc/')?'POST':'GET');
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
      assert.deepEqual(JSON.parse(init?.body as string),{p_snapshot_id:snapshot});
      reconcileCount++;
      return json(reconcileCount===2&&options.after?options.after:
        (options.reconcile??reconciliation));
    }
    if(url.pathname==='/rest/v1/rpc/read_private_account_audit_export'){
      auditCount++;
      const categories={
        reviewerGrants:[],moderationCases:[],moderationEvents:[],
        accountExitRequests:[],reauthChallenges:[],inventorySnapshots:[],
        releasePointers:[],releaseEvents:[]
      };
      const fallback={snapshotId:snapshot,ownerUserId:owner,
        status:'BOUNDED_OWNER_AUDIT',maxRowsPerCategory:100,categories,
        tokenDigestsIncluded:false,sessionsIncluded:false,
        completeAccountExport:false,deletionAllowed:false};
      return json(auditCount===2&&options.auditAfter
        ?options.auditAfter:(options.audit??fallback));
    }
    if(url.pathname==='/rest/v1/rpc/read_private_asset_content_attestations'){
      assert.deepEqual(JSON.parse(init?.body as string),{p_snapshot_id:snapshot});
      return json(options.attestation??{
        snapshotId:snapshot,status:'SERVER_HASH_PINNED',providerSigned:false,
        deletionAllowed:false,registeredAssets:1,attestedAssets:1,
        attestations:[{assetId,path:assetPath,objectId,version:'storage-v1',
          expectedSha256:digest}]
      });
    }
    if(url.pathname.startsWith('/rest/v1/')){
      const table=url.pathname.split('/').at(-1)!;
      assert.equal(url.searchParams.get('limit'),'101');
      assert.equal(url.searchParams.get(
        ['profiles','profile_sharing_preferences','private_onboarding_steps'].includes(table)
          ?'user_id':'owner_user_id'),'eq.'+owner);
      return json((options.rows??baseRows)[table]??[]);
    }
    if(url.pathname.startsWith('/storage/v1/object/info/authenticated/')){
      infoCount++;
      assert.equal(url.pathname,
        '/storage/v1/object/info/authenticated/kadmeion-private-assets/'+assetPath);
      return json({
        id:'40000000-0000-4000-8000-000000000004',
        name:assetPath,bucket_id:'kadmeion-private-assets',owner_id:owner,
        version:'storage-v1',updated_at:'2026-11-14T00:00:00.000Z',
        metadata:{size:png.length,mimetype:'image/png'},
        ...(infoCount===1?options.infoBefore:options.infoAfter)
      });
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
  assert.equal(body.evidence.trustedServerWorkerHashesVerified,true);
  assert.equal(body.assets[0].expectedSha256,digest);
  assert.equal(body.evidence.providerObjectVersionPinned,false);
  assert.equal(body.evidence.storageObjectVersionCheckedBeforeAndAfter,true);
  assert.equal(body.assets[0].storageVersionAtRead,'storage-v1');
  assert.equal(paths.filter(p=>p.includes('/object/info/authenticated/')).length,2);
  assert.equal(body.evidence.crossTableAtomicSnapshot,false);
  assert.equal(body.limitations.completeAccountExport,false);
  assert.equal(body.restrictedAudit.reviewerGrants.length,0);
  assert.equal(Object.keys(body.restrictedAudit).length,8);
  assert.equal(paths.filter(p=>p.includes('read_private_account_audit_export')).length,2);
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

test('bounded export includes owner-readable sharing, onboarding, exposure, release and Trash records',async()=>{
  const rows={...baseRows,
    profile_sharing_preferences:[{user_id:owner,share_display_name:false}],
    private_onboarding_steps:[{user_id:owner,step:'profile',status:'done'}],
    project_exposure_intents:[{owner_user_id:owner,project_id:'p1',expose_on_hub:false}],
    private_release_requests:[{owner_user_id:owner,id:'r1',visibility_intent:'PRIVATE'}],
    private_trash_items:[{owner_user_id:owner,item_id:'p2',item_type:'project'}]
  };
  const {service,paths}=fixture({rows});
  const result=JSON.parse(new TextDecoder().decode((await service.export(snapshot)).bytes));
  assert.equal(result.records.profile_sharing_preferences[0].share_display_name,false);
  assert.equal(result.records.private_onboarding_steps[0].step,'profile');
  assert.equal(result.records.project_exposure_intents[0].expose_on_hub,false);
  assert.equal(result.records.private_release_requests[0].visibility_intent,'PRIVATE');
  assert.equal(result.records.private_trash_items[0].item_type,'project');
  for(const table of ['profile_sharing_preferences','private_onboarding_steps',
    'project_exposure_intents','private_release_requests','private_trash_items'])
    assert.equal(paths.some(p=>p.startsWith('/rest/v1/'+table+'?')),true);
  assert.equal(result.limitations.completeAccountExport,false);
  assert.equal(result.evidence.providerObjectVersionPinned,false);
});
test('new private categories reject cross-tenant injection before any Storage download',async()=>{
  for(const [table,column] of [
    ['profile_sharing_preferences','user_id'],
    ['private_onboarding_steps','user_id'],
    ['project_exposure_intents','owner_user_id'],
    ['private_release_requests','owner_user_id'],
    ['private_trash_items','owner_user_id']
  ] as const){
    const {service,paths}=fixture({rows:{...baseRows,
      [table]:[{[column]:stranger,id:'foreign'}]}});
    await assert.rejects(service.export(snapshot),{code:'INTEGRITY'});
    assert.equal(paths.some(p=>p.includes('/storage/v1/object/')),false);
  }
});

test('same-size Storage overwrite with changed provider version fails closed',async()=>{
  const {service,paths}=fixture({infoAfter:{version:'storage-v2'}});
  await assert.rejects(service.export(snapshot),{code:'INTEGRITY'});
  assert.equal(paths.filter(p=>p.includes('/object/info/authenticated/')).length,2);
  assert.equal(paths.some(p=>p.includes('/object/authenticated/')),true);
});
test('missing or forged provider Storage identity fails before byte download',async()=>{
  for(const infoBefore of [
    {version:null},{version:''},{owner_id:stranger},
    {bucket_id:'public'},{name:stranger+'/cover-one/image.png'},
    {metadata:{size:png.length,mimetype:'image/jpeg'}},
    {metadata:{size:png.length+1,mimetype:'image/png'}}
  ]){
    const {service,paths}=fixture({infoBefore});
    await assert.rejects(service.export(snapshot),{code:'INTEGRITY'});
    assert.equal(paths.some(p=>p.includes('/object/authenticated/')),false);
  }
});
test('post-download Storage object id and updated_at changes fail closed',async()=>{
  for(const infoAfter of [
    {id:'50000000-0000-4000-8000-000000000005'},
    {updated_at:'2026-11-14T00:01:00.000Z'}
  ])await assert.rejects(fixture({infoAfter}).service.export(snapshot),
    {code:'INTEGRITY'});
});

test('missing, forged and foreign server hash attestations fail closed before bytes',async()=>{
  for(const attestation of [
    {snapshotId:snapshot,status:'UNVERIFIED',providerSigned:false,
      deletionAllowed:false,registeredAssets:1,attestedAssets:0,attestations:[]},
    {snapshotId:snapshot,status:'SERVER_HASH_PINNED',providerSigned:true,
      deletionAllowed:false,registeredAssets:1,attestedAssets:1,attestations:[]},
    {snapshotId:snapshot,status:'SERVER_HASH_PINNED',providerSigned:false,
      deletionAllowed:false,registeredAssets:1,attestedAssets:1,
      attestations:[{assetId,path:assetPath,objectId,version:'storage-v1',
        expectedSha256:'0'.repeat(64)}]},
    {snapshotId:snapshot,status:'SERVER_HASH_PINNED',providerSigned:false,
      deletionAllowed:false,registeredAssets:1,attestedAssets:1,
      attestations:[{assetId,path:stranger+'/foreign.png',objectId,version:'storage-v1',
        expectedSha256:digest}]}
  ]){
    const {service,paths}=fixture({attestation});
    if(attestation.attestations.length===1&&
      attestation.attestations[0].expectedSha256==='0'.repeat(64)){
      await assert.rejects(service.export(snapshot),{code:'INTEGRITY'});
    }else{
      await assert.rejects(service.export(snapshot));
      assert.equal(paths.some(p=>p.includes('/object/authenticated/')),false);
    }
  }
});
test('same-size bytes with unchanged provider identity but different digest fail',async()=>{
  const modified=new Uint8Array(png);modified[modified.length-1]^=1;
  const {service}=fixture({assetBytes:modified});
  await assert.rejects(service.export(snapshot),{code:'INTEGRITY'});
});


test('bounded export includes owner audit events without secret digests',async()=>{
  const categories=Object.fromEntries([
    'reviewerGrants','moderationCases','moderationEvents','accountExitRequests',
    'reauthChallenges','inventorySnapshots','releasePointers','releaseEvents'
  ].map(k=>[k,[]]));
  categories.reviewerGrants=[{id:assetId,request_id:snapshot,
    portfolio_id:objectId,expires_at:'2026-11-14T00:00:00Z'}];
  categories.moderationEvents=[{event_type:'OWNER_APPEAL',detail:'Case reviewed'}];
  const {service}=fixture({audit:{snapshotId:snapshot,ownerUserId:owner,
    status:'BOUNDED_OWNER_AUDIT',maxRowsPerCategory:100,categories,
    tokenDigestsIncluded:false,sessionsIncluded:false,
    completeAccountExport:false,deletionAllowed:false}});
  const bytes=(await service.export(snapshot)).bytes;
  const output=JSON.parse(new TextDecoder().decode(bytes));
  assert.equal(output.restrictedAudit.reviewerGrants.length,1);
  assert.equal(output.restrictedAudit.moderationEvents[0].event_type,'OWNER_APPEAL');
  assert.ok(!JSON.stringify(output.restrictedAudit).includes('token_sha256'));
});

test('audit export refuses foreign, oversized, password-bearing and changing records',async()=>{
  const empty=Object.fromEntries([
    'reviewerGrants','moderationCases','moderationEvents','accountExitRequests',
    'reauthChallenges','inventorySnapshots','releasePointers','releaseEvents'
  ].map(k=>[k,[]]));
  const base={snapshotId:snapshot,ownerUserId:owner,status:'BOUNDED_OWNER_AUDIT',
    maxRowsPerCategory:100,categories:empty,
    tokenDigestsIncluded:false,sessionsIncluded:false,
    completeAccountExport:false,deletionAllowed:false};
  for(const audit of [
    {...base,ownerUserId:stranger},
    {...base,tokenDigestsIncluded:true},
    {...base,deletionAllowed:true},
    {...base,categories:{...empty,reviewerGrants:[{token_sha256:'secret'}]}},
    {...base,categories:{...empty,reviewerGrants:Array.from({length:101},()=>({}))}},
    {...base,categories:{...empty,unexpected:[]}}
  ]){
    const {service,paths}=fixture({audit});
    await assert.rejects(service.export(snapshot));
    assert.ok(!paths.some(p=>p.includes('/storage/v1/object/authenticated/')),
      'Unauthorized audit metadata triggered private asset download');
  }
  await assert.rejects(fixture({auditAfter:{...base,categories:{
    ...empty,moderationEvents:[{event_type:'PUBLISH'}]
  }}}).service.export(snapshot),{code:'UNVERIFIED'});
});
