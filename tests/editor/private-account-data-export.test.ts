import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  SupabasePrivateAccountDataExporter,verifyBoundedPrivateAccountExport,
  recoverPortfolioSourceZipFromPartialAccountExport,
  createBoundedPrivateAccountRecoveryBundle,
  restoreBoundedPrivateAccountJsonFromRecoveryBundle
} from '../../packages/storage-adapters/src/private-account-data-export.ts';
import {importPortfolioSourceZip} from '../../packages/storage-adapters/src/portable-source-archive.ts';

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
  metadata?:Record<string,unknown>;
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
    if(url.pathname==='/rest/v1/rpc/owner_list_my_component_versions'){
      return json({status:'OWNER_PRIVATE_COMPONENTS',ownerUserId:owner,
        items:(options.rows??baseRows).private_my_component_versions??[],
        publicExecutionTrusted:false});
    }
    if(url.pathname==='/rest/v1/rpc/owner_export_account_metadata'){
      assert.deepEqual(JSON.parse(String(init?.body)),{p_snapshot_id:snapshot});
      return json(options.metadata??atomicMetadata());
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

test('an access token change aborts export before the next private request',async()=>{
  let token='owner-jwt';
  const visits:string[]=[];
  const service=new SupabasePrivateAccountDataExporter(origin,'publishable',async()=>token,
    async(input,init)=>{
      visits.push(new URL(String(input)).pathname);
      assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer owner-jwt');
      token='other-owner-jwt';
      return json({id:owner,email:'owner@example.test'});
    });
  await assert.rejects(service.export(snapshot),{code:'AUTH_EXPIRED'});
  assert.deepEqual(visits,['/auth/v1/user']);
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
    ['private_trash_items','owner_user_id'],
    ['private_platform_links','owner_user_id'],
    ['private_goals','owner_user_id'],
    ['private_goal_progress_events','owner_user_id'],
    ['private_goal_milestones','owner_user_id']
  ] as const){
    const {service,paths}=fixture({rows:{...baseRows,
      [table]:[{[column]:stranger,id:'foreign'}]}});
    await assert.rejects(service.export(snapshot),{code:'INTEGRITY'});
    assert.equal(paths.some(p=>p.includes('/storage/v1/object/')),false);
  }
});

test('private export includes platform links, goals, manual progress and milestones',async()=>{
  const records={
    private_platform_links:[{owner_user_id:owner,provider:'GITHUB',ownership_verified:false}],
    private_goals:[{owner_user_id:owner,title:'Practice'}],
    private_goal_progress_events:[{owner_user_id:owner,value:3,source:'MANUAL'}],
    private_goal_milestones:[{owner_user_id:owner,title:'First exercise'}]
  };
  const {service}=fixture({rows:{...baseRows,...records}});
  const body=JSON.parse(new TextDecoder().decode((await service.export(snapshot)).bytes));
  for(const [table,rows] of Object.entries(records))assert.deepEqual(body.records[table],rows);
  assert.equal(body.limitations.completeAccountExport,false);
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

test('export accepts Fetch-decoded compressed JSON and rejects truncated identity bodies',async()=>{
  const user=JSON.stringify({id:owner,email:'owner@example.test'});
  for(const encoding of ['gzip','identity']){
    const paths:string[]=[];
    const exporter=new SupabasePrivateAccountDataExporter(origin,'publishable',async()=> 'owner-jwt',
      async(input,init)=>{
        assert.ok(init?.signal instanceof AbortSignal);
        paths.push(new URL(String(input)).pathname);
        if(paths.length===1)return new Response(user,{headers:{
          'Content-Type':'application/json','Content-Encoding':encoding,'Content-Length':String(user.length-1)
        }});
        return json(reconciliation,503);
      });
    await assert.rejects(exporter.export(snapshot),{
      code:encoding==='gzip'?'PROVIDER_UNAVAILABLE':'INTEGRITY'
    });
    assert.equal(paths.length,encoding==='gzip'?2:1);
  }
});

test('export cancels a response stream when it crosses the byte cap',async()=>{
  let cancelled=false;
  const oversized=new ReadableStream<Uint8Array>({
    start(controller){ controller.enqueue(new Uint8Array(65_537)); },
    cancel(){ cancelled=true; }
  });
  const exporter=new SupabasePrivateAccountDataExporter(origin,'publishable',async()=> 'owner-jwt',
    async()=>new Response(oversized));
  await assert.rejects(exporter.export(snapshot),{code:'LIMIT_EXCEEDED'});
  assert.equal(cancelled,true);
});


test('bounded private export can be checked offline without claiming completeness or authenticity',async()=>{
  const artifact=await fixture().service.export(snapshot);
  const check=await verifyBoundedPrivateAccountExport(artifact.bytes);
  assert.equal(check.status,'LOCALLY_CONSISTENT_PARTIAL_EXPORT');
  assert.equal(check.ownerId,owner);assert.equal(check.inventorySnapshotId,snapshot);
  assert.equal(check.assetsChecked,1);assert.equal(check.assetBytesChecked,png.length);
  assert.ok(check.tablesChecked>=16);
  assert.equal(check.sha256,createHash('sha256').update(artifact.bytes).digest('hex'));
  assert.equal(check.completeAccountExport,false);
  assert.equal(check.documentAuthenticityVerified,false);
  assert.equal(check.deletionAllowed,false);
});

test('offline account export verification refuses modified bytes and false retention claims',async()=>{
  const artifact=await fixture().service.export(snapshot);
  const original=JSON.parse(new TextDecoder().decode(artifact.bytes));
  const mutate=(edit:(x:any)=>void)=>{
    const changed=structuredClone(original);edit(changed);
    return new TextEncoder().encode(JSON.stringify(changed));
  };
  for(const bad of [
    mutate(x=>{x.assets[0].base64=btoa('other bytes');}),
    mutate(x=>{x.assets[0].expectedSha256='0'.repeat(64);x.assets[0].downloadedSha256='0'.repeat(64);}),
    mutate(x=>{x.records.profiles[0].user_id=stranger;}),
    mutate(x=>{x.records.projects=[];delete x.records.profiles;}),
    mutate(x=>{x.limitations.completeAccountExport=true;}),
    mutate(x=>{x.limitations.providerRetentionVerified=true;}),
    mutate(x=>{x.evidence.downloadedByteCount+=1;}),
    mutate(x=>{x.restrictedAudit.reviewerGrants=[{rawToken:'private'}];}),
    mutate(x=>{x.assets[0].path='../outside';}),
    mutate(x=>{x.deletionAllowed=true;})
  ])await assert.rejects(verifyBoundedPrivateAccountExport(bad),{
    code:'INTEGRITY'
  });
  await assert.rejects(verifyBoundedPrivateAccountExport(
    new Uint8Array(16*1024*1024+1)),{code:'VALIDATION'});
});


test('B09 owner can recover one exact validated authored portfolio revision as portable source ZIP',async()=>{
  const portfolioId='60000000-0000-4000-8000-000000000006';
  const ownedSnapshot={
    formatVersion:1,
    files:{
      'kadmeion.json':'{"formatVersion":1}',
      'pages/home.page.json':'{"sections":[]}',
      'slots/hero/index.tsx':'export const title = "actual owner code";'
    },
    slots:{
      hero:{state:'S2',componentId:'heading@1',content:{title:'My work'},
        sourcePath:'slots/hero/index.tsx',originalSource:'pristine library source'}
    },stashes:{}
  };
  const rows={...baseRows,
    portfolios:[{id:portfolioId,owner_user_id:owner,title:'Real portfolio'}],
    portfolio_revisions:[{portfolio_id:portfolioId,owner_user_id:owner,
      revision:7,snapshot:ownedSnapshot}]
  };
  const artifact=await fixture({rows}).service.export(snapshot);
  const result=await recoverPortfolioSourceZipFromPartialAccountExport(
    artifact.bytes,portfolioId,7);
  assert.deepEqual(importPortfolioSourceZip(result.zip),ownedSnapshot);
  assert.equal(result.sha256,createHash('sha256').update(result.zip).digest('hex'));
  assert.match(result.filename,/kadmeion-portfolio-60000000/);
  assert.equal(result.privateMediaIncluded,false);
  assert.equal(result.completeAccountExport,false);
  assert.equal(result.sourceAuthenticityVerified,false);
  assert.equal(result.deletionAllowed,false);
  assert.deepEqual(result.zip,(await recoverPortfolioSourceZipFromPartialAccountExport(
    artifact.bytes,portfolioId,7)).zip);
});
test('B09 source archive extraction fails closed for wrong owner, duplicate revision, and unsafe source paths',async()=>{
  const portfolioId='60000000-0000-4000-8000-000000000006';
  const valid={formatVersion:1,files:{'kadmeion.json':'{"formatVersion":1}'},
    slots:{},stashes:{}};
  const row={portfolio_id:portfolioId,owner_user_id:owner,
    revision:3,snapshot:valid};
  const rows={...baseRows,
    portfolios:[{id:portfolioId,owner_user_id:owner}],
    portfolio_revisions:[row]};
  const {bytes}=await fixture({rows}).service.export(snapshot);
  for(const [id,rev] of [
    [portfolioId,4],['70000000-0000-4000-8000-000000000007',3]
  ] as const){
    await assert.rejects(
      recoverPortfolioSourceZipFromPartialAccountExport(bytes,id,rev),
      {code:'INTEGRITY'}
    );
  }
  await assert.rejects(
    recoverPortfolioSourceZipFromPartialAccountExport(bytes,portfolioId,-1),
    {code:'VALIDATION'});
  const mutate=(change:(v:any)=>void)=>{
    const v=JSON.parse(new TextDecoder().decode(bytes));change(v);
    return new TextEncoder().encode(JSON.stringify(v));
  };
  await assert.rejects(recoverPortfolioSourceZipFromPartialAccountExport(
    mutate(v=>v.records.portfolio_revisions.push(row)),portfolioId,3),
    {code:'INTEGRITY'});
  await assert.rejects(recoverPortfolioSourceZipFromPartialAccountExport(
    mutate(v=>v.records.portfolio_revisions[0].snapshot.files['../leak.tsx']='secret'),
    portfolioId,3),{code:'INTEGRITY'});
  await assert.rejects(recoverPortfolioSourceZipFromPartialAccountExport(
    mutate(v=>v.records.portfolio_revisions[0].owner_user_id=stranger),
    portfolioId,3),{code:'INTEGRITY'});
});


function inspectBundleLocalParts(zip:Uint8Array):Map<string,Uint8Array>{
  const view=new DataView(zip.buffer,zip.byteOffset,zip.byteLength);
  const entries=new Map<string,Uint8Array>();
  let cursor=0;
  while(cursor+30<=zip.length&&view.getUint32(cursor,true)===0x04034b50){
    assert.equal(view.getUint16(cursor+8,true),0);
    const size=view.getUint32(cursor+18,true);
    const nameLength=view.getUint16(cursor+26,true);
    const extra=view.getUint16(cursor+28,true);
    const begin=cursor+30,name=new TextDecoder('utf-8',{fatal:true})
      .decode(zip.subarray(begin,begin+nameLength));
    const dataAt=begin+nameLength+extra;
    assert.ok(dataAt+size<=zip.length);
    assert.equal(entries.has(name),false);
    entries.set(name,zip.slice(dataAt,dataAt+size));
    cursor=dataAt+size;
  }
  assert.equal(view.getUint32(cursor,true),0x02014b50);
  return entries;
}
test('B09 private recovery ZIP preserves all bounded records and separates hashed media files',async()=>{
  const original=(await fixture().service.export(snapshot)).bytes;
  const result=await createBoundedPrivateAccountRecoveryBundle(original);
  assert.equal(result.status,'BOUNDED_PARTIAL_ACCOUNT_BUNDLE');
  assert.equal(result.privateData,true);
  assert.equal(result.completeAccountExport,false);
  assert.equal(result.providerAuthenticityVerified,false);
  assert.equal(result.deletionAllowed,false);
  assert.equal(result.assetsReferenced,1);assert.equal(result.assetFiles,1);
  assert.equal(result.sha256,createHash('sha256').update(result.zip).digest('hex'));
  assert.equal(result.originalExportSha256,
    createHash('sha256').update(original).digest('hex'));
  const entries=inspectBundleLocalParts(result.zip);
  const mediaName='assets/'+digest+'.png';
  assert.deepEqual([...entries.keys()],[
    'account/records.json',mediaName,'kadmeion-partial-bundle.json','README.txt'
  ]);
  assert.deepEqual(entries.get(mediaName),png);
  const records=JSON.parse(new TextDecoder().decode(entries.get('account/records.json')!));
  const originalRecords=JSON.parse(new TextDecoder().decode(original));
  assert.deepEqual(records.records,originalRecords.records);
  assert.deepEqual(records.restrictedAudit,originalRecords.restrictedAudit);
  assert.equal(records.owner.id,owner);
  assert.equal(records.assets[0].base64,undefined);
  assert.equal(records.assets[0].archivePath,mediaName);
  assert.equal(records.assets[0].storageVersionAtRead,'storage-v1');
  assert.equal(records.limitations.completeAccountExport,false);
  const manifest=JSON.parse(new TextDecoder().decode(
    entries.get('kadmeion-partial-bundle.json')!));
  assert.equal(manifest.recordsSha256,
    createHash('sha256').update(entries.get('account/records.json')!).digest('hex'));
  assert.deepEqual(manifest.files,[{path:mediaName,sha256:digest,byteLength:png.length}]);
  assert.equal(manifest.sourceExportSha256,result.originalExportSha256);
  assert.equal(manifest.assetReferences[0].originalPath,assetPath);
  assert.ok(new TextDecoder().decode(entries.get('README.txt')!).includes('PRIVATE'));
  const repeat=await createBoundedPrivateAccountRecoveryBundle(original);
  assert.deepEqual(result.zip,repeat.zip);
});
test('B09 recovery ZIP fails closed on tampered assets and foreign record ownership',async()=>{
  const original=(await fixture().service.export(snapshot)).bytes;
  const parsed=JSON.parse(new TextDecoder().decode(original));
  for(const mutate of [
    (doc:any)=>{doc.assets[0].base64=btoa('tampered');},
    (doc:any)=>{doc.assets[0].expectedSha256='0'.repeat(64);},
    (doc:any)=>{doc.records.projects[0].owner_user_id=stranger;},
    (doc:any)=>{doc.limitations.completeAccountExport=true;},
    (doc:any)=>{doc.evidence.trustedServerWorkerHashesVerified=false;}
  ]){
    const copy=structuredClone(parsed);mutate(copy);
    await assert.rejects(createBoundedPrivateAccountRecoveryBundle(
      new TextEncoder().encode(JSON.stringify(copy))),{code:'INTEGRITY'});
  }
  await assert.rejects(createBoundedPrivateAccountRecoveryBundle(
    new Uint8Array(16*1024*1024+1)),{code:'VALIDATION'});
});


test('B09 private ZIP offline restore round-trips to the exact original bounded export bytes',async()=>{
  const original=(await fixture().service.export(snapshot)).bytes;
  const zipped=await createBoundedPrivateAccountRecoveryBundle(original);
  const restored=await restoreBoundedPrivateAccountJsonFromRecoveryBundle(zipped.zip);
  assert.deepEqual(restored.bytes,original);
  assert.equal(restored.sha256,zipped.originalExportSha256);
  assert.equal(restored.providerAuthenticityVerified,false);
  assert.equal(restored.completeAccountExport,false);
  assert.equal(restored.deletionAllowed,false);
});

test('B09 recovery ZIP rejects central-directory and checksum tampering',async()=>{
  const original=(await fixture().service.export(snapshot)).bytes;
  const {zip}=await createBoundedPrivateAccountRecoveryBundle(original);
  const changed=Uint8Array.from(zip);
  const needle=new TextEncoder().encode('kadmeion-private-account-recovery-bundle');
  let at=-1;
  for(let i=0;i+needle.length<changed.length;i++){
    if(needle.every((b,k)=>changed[i+k]===b)){at=i;break;}
  }
  assert.ok(at>0);
  changed[at+1]^=1;
  await assert.rejects(restoreBoundedPrivateAccountJsonFromRecoveryBundle(changed),{
    code:'INTEGRITY'
  });
  await assert.rejects(restoreBoundedPrivateAccountJsonFromRecoveryBundle(
    zip.slice(0,-10)),{code:'INTEGRITY'});
  await assert.rejects(restoreBoundedPrivateAccountJsonFromRecoveryBundle(
    new Uint8Array(10*1024*1024+1)),{code:'INTEGRITY'});
});

const ATOMIC_TABLE_NAMES=[
  'profiles','profile_sharing_preferences','private_onboarding_steps','projects',
  'project_exposure_intents','portfolios','portfolio_revisions','project_assets',
  'private_release_requests','private_trash_items','private_platform_links','private_goals',
  'private_goal_progress_events','private_goal_milestones','private_notifications',
  'private_notification_preferences','private_my_component_versions'
];
function atomicMetadata():Record<string,unknown>{
  return {
    status:'APPLICATION_METADATA_SNAPSHOT',schemaVersion:1,snapshotId:snapshot,
    ownerUserId:owner,capturedAt:'2026-11-15T10:20:00.000Z',
    storageBytesIncluded:false,providerDataIncluded:false,deletionAllowed:false,
    records:Object.fromEntries(ATOMIC_TABLE_NAMES.map(name=>[name,baseRows[name]??[]])),
    restrictedAudit:{
      reviewerGrants:[{grant_id:'author-owned',activity:{event:'created'}}],
      moderationCases:[],moderationEvents:[],accountExitRequests:[],
      reauthChallenges:[],inventorySnapshots:[],releasePointers:[],releaseEvents:[]
    },
    verifiedReleaseHistory:[{
      intent_id:'10000000-0000-4000-8000-000000000010',
      portfolio_id:'10000000-0000-4000-8000-000000000011',
      request_id:'10000000-0000-4000-8000-000000000012',
      html_sha256:'a'.repeat(64)
    }]
  };
}

test('B09 atomic metadata export preserves all registered categories and pinned owner',async()=>{
  const {service,paths}=fixture();
  const result=await service.exportApplicationMetadata(snapshot);
  assert.equal(result.filename,'kadmeion-account-metadata.json');
  assert.equal(result.status,'APPLICATION_METADATA_SNAPSHOT');
  assert.equal(result.storageBytesIncluded,false);
  assert.equal(result.providerDataIncluded,false);
  const parsed=JSON.parse(new TextDecoder().decode(result.bytes));
  assert.deepEqual(Object.keys(parsed.records).sort(),[...ATOMIC_TABLE_NAMES].sort());
  assert.equal(parsed.records.projects[0].owner_user_id,owner);
  assert.equal(parsed.verifiedReleaseHistory.length,1);
  assert.equal(parsed.restrictedAudit.reviewerGrants[0].activity.event,'created');
  assert.equal(parsed.deletionAllowed,false);
  assert.equal(paths.filter(p=>p.includes('/rpc/owner_export_account_metadata')).length,1);
  assert.equal(paths.filter(p=>p==='/auth/v1/user').length,1);
  assert.equal(paths.some(p=>p.startsWith('/storage/')),false,
    'Atomic application metadata does not falsely claim Storage export');
});

test('B09 atomic metadata export rejects foreign owners, missing records and hidden nested credentials',async()=>{
  const base=atomicMetadata();
  const variants=[
    (v:any)=>{v.ownerUserId=stranger;},
    (v:any)=>{v.snapshotId=stranger;},
    (v:any)=>{v.capturedAt='not-a-date';},
    (v:any)=>{v.storageBytesIncluded=true;},
    (v:any)=>{v.providerDataIncluded=true;},
    (v:any)=>{v.deletionAllowed=true;},
    (v:any)=>{delete v.records.projects;},
    (v:any)=>{v.records.projects[0].owner_user_id=stranger;},
    (v:any)=>{v.verifiedReleaseHistory[0].html_sha256='invalid';},
    (v:any)=>{delete v.restrictedAudit.moderationEvents;},
    (v:any)=>{v.restrictedAudit.unapprovedCategory=[];},
    (v:any)=>{v.verifiedReleaseHistory[0].payload={credentials:{client_secret:'unsafe'}};},
    (v:any)=>{v.restrictedAudit.reviewerGrants[0].activity.credentials={
      refresh_token:'should-never-leave-server'};},
    (v:any)=>{v.restrictedAudit.reviewerGrants[0].activity.list=[
      {tokens:{access_token:'nested-secret'}}];}
  ];
  for(const modify of variants){
    const payload=structuredClone(base);modify(payload);
    await assert.rejects(fixture({metadata:payload}).service.exportApplicationMetadata(snapshot),
      {code:'INTEGRITY'});
  }
  await assert.rejects(fixture({failPath:'owner_export_account_metadata'})
    .service.exportApplicationMetadata(snapshot),{code:'PROVIDER_UNAVAILABLE'});
  const noToken=fixture({},async()=>null);
  await assert.rejects(noToken.service.exportApplicationMetadata(snapshot),{code:'AUTH_EXPIRED'});
  assert.equal(noToken.paths.length,0);
});

test('B09 bounded audit export and offline recovery reject recursively nested secrets',async()=>{
  const original=await fixture().service.export(snapshot);
  const parsed=JSON.parse(new TextDecoder().decode(original.bytes));
  const nested=[{actor:{user:{credentials:{access_token:'secret'}}}}];
  parsed.restrictedAudit.reviewerGrants=nested;
  await assert.rejects(verifyBoundedPrivateAccountExport(
    new TextEncoder().encode(JSON.stringify(parsed))),{code:'INTEGRITY'});
  const categories={...parsed.restrictedAudit,reviewerGrants:nested};
  const audit={snapshotId:snapshot,ownerUserId:owner,
    status:'BOUNDED_OWNER_AUDIT',maxRowsPerCategory:100,categories,
    tokenDigestsIncluded:false,sessionsIncluded:false,
    completeAccountExport:false,deletionAllowed:false};
  await assert.rejects(fixture({audit}).service.export(snapshot),{code:'INTEGRITY'});
});

test('WF-025 owner My Component versions survive bounded and atomic metadata exports',async()=>{
  const owned={
    id:'58000000-0000-4000-8000-000000000005',owner_user_id:owner,
    component_key:'custom-title',version:1,display_name:'My Title',
    base_component_pin:'title-stacked@1',
    pristine_source:'export const Heading=1;',
    source_code:'export const Heading=2;',
    compatible_slot_kinds:['title'],
    source_sha256:createHash('sha256').update('export const Heading=2;').digest('hex'),
    created_at:'2026-11-15T11:00:00.000Z'
  };
  const rows={...baseRows,private_my_component_versions:[owned]};
  const {service,paths}=fixture({rows});
  const partial=await service.export(snapshot);
  const saved=JSON.parse(new TextDecoder().decode(partial.bytes));
  assert.deepEqual(saved.records.private_my_component_versions,[owned]);
  assert.equal((await verifyBoundedPrivateAccountExport(partial.bytes)).completeAccountExport,false);
  assert.ok(paths.some(p=>p.includes('/rpc/owner_list_my_component_versions')));
  assert.ok(!paths.some(p=>p.startsWith('/rest/v1/private_my_component_versions?')),
    'Direct browser SELECT would bypass the required live Auth session guard');
  const meta=atomicMetadata();
  const records=meta.records as Record<string,unknown>;
  records.private_my_component_versions=[owned];
  const atomic=await fixture({metadata:meta}).service.exportApplicationMetadata(snapshot);
  const decoded=JSON.parse(new TextDecoder().decode(atomic.bytes));
  assert.deepEqual(decoded.records.private_my_component_versions,[owned]);
});

test('WF-025 private export rejects tampered, foreign and duplicated My Component source',async()=>{
  const valid={
    id:'59000000-0000-4000-8000-000000000005',owner_user_id:owner,
    component_key:'custom-title',version:1,display_name:'My Title',
    base_component_pin:'title-stacked@1',pristine_source:'const x=1;',
    source_code:'const x=2;',compatible_slot_kinds:['title'],
    source_sha256:createHash('sha256').update('const x=2;').digest('hex'),
    created_at:'2026-11-15T11:00:00.000Z'
  };
  for(const records of [
    [{...valid,owner_user_id:stranger}],
    [{...valid,source_code:'const x=3;'}],
    [valid,valid],
    [{...valid,source_sha256:'0'.repeat(64)}]
  ]){
    const rows={...baseRows,private_my_component_versions:records};
    await assert.rejects(fixture({rows}).service.export(snapshot),{code:'INTEGRITY'});
    const metadata=atomicMetadata();
    (metadata.records as Record<string,unknown>).private_my_component_versions=records;
    await assert.rejects(fixture({metadata}).service.exportApplicationMetadata(snapshot),
      {code:'INTEGRITY'});
  }
});

test('C08 typed metadata export failures retain exact snapshot and never recapture inventory',async()=>{
  for(const [status,payload,code] of [
    [429,{message:'private provider diagnostic'},'RATE_LIMITED'],
    [413,{message:'private provider diagnostic'},'LIMIT_EXCEEDED'],
    [500,{code:'54000',message:'ACCOUNT_METADATA_EXPORT_LIMIT_EXCEEDED'},'LIMIT_EXCEEDED'],
    [500,{code:'54000',message:'other database limit'},'PROVIDER_UNAVAILABLE'],
    [500,{code:'XX000',message:'private provider diagnostic'},'PROVIDER_UNAVAILABLE']
  ] as const){
    const paths:string[]=[];
    const service=new SupabasePrivateAccountDataExporter(origin,'publishable',async()=> 'owner-jwt',async(url,init)=>{
      const path=new URL(String(url)).pathname;paths.push(path);
      if(path==='/auth/v1/user')return json({id:owner,email:null});
      assert.equal(path,'/rest/v1/rpc/owner_export_account_metadata');
      assert.deepEqual(JSON.parse(String(init?.body)),{p_snapshot_id:snapshot});
      return json(payload,status);
    });
    await assert.rejects(service.exportApplicationMetadata(snapshot),(error:unknown)=>{
      assert.equal((error as {code?:string}).code,code);
      assert.doesNotMatch(String(error),/private provider diagnostic|other database limit|ACCOUNT_METADATA_EXPORT_LIMIT_EXCEEDED/);
      return true;
    });
    assert.deepEqual(paths,['/auth/v1/user','/rest/v1/rpc/owner_export_account_metadata']);
  }
});
test('C08 audit quota and reconciled inventory limit stop byte export on the same snapshot',async()=>{
  const paths:string[]=[];
  const service=new SupabasePrivateAccountDataExporter(origin,'publishable',async()=> 'owner-jwt',async(url,init)=>{
    const path=new URL(String(url)).pathname;paths.push(path);
    if(path==='/auth/v1/user')return json({id:owner,email:null});
    assert.deepEqual(JSON.parse(String(init?.body)),{p_snapshot_id:snapshot});
    if(path.endsWith('/reconcile_private_account_exit_storage'))return json(reconciliation);
    assert.ok(path.endsWith('/read_private_account_audit_export'));
    return json({code:'54000',message:'ACCOUNT_AUDIT_EXPORT_LIMIT_EXCEEDED'},500);
  });
  await assert.rejects(service.export(snapshot),{code:'LIMIT_EXCEEDED'});
  assert.deepEqual(paths,['/auth/v1/user','/rest/v1/rpc/reconcile_private_account_exit_storage',
    '/rest/v1/rpc/read_private_account_audit_export']);
  const blocked=fixture({reconcile:{...reconciliation,status:'LIMIT_EXCEEDED',limitExceeded:true}});
  await assert.rejects(blocked.service.export(snapshot),{code:'LIMIT_EXCEEDED'});
  assert.ok(!blocked.paths.some(p=>p.includes('/storage/v1/')||p.includes('create_private_account_exit_inventory')));
});

test('export rejects successful non-JSON owner receipts before any other private read',async()=>{
  for(const type of ['text/plain','text/html','application/octet-stream']){
    let reads=0;
    const user=JSON.stringify({id:owner,email:'owner@example.test'});
    const exporter=new SupabasePrivateAccountDataExporter(origin,'publishable',async()=> 'owner-jwt',
      async()=>{reads++;return new Response(user,{headers:{'Content-Type':type}});});
    await assert.rejects(exporter.export(snapshot),{code:'INTEGRITY'});
    assert.equal(reads,1);
  }
});
