/**
 * Ephemeral Supabase Edge Runtime smoke: actual Deno bundle + gateway HTTP.
 * Must NEVER run against hosted Supabase or use remote service keys.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {SupabasePrivateAccountDataExporter,verifyBoundedPrivateAccountExport,
  createBoundedPrivateAccountRecoveryBundle,restoreBoundedPrivateAccountJsonFromRecoveryBundle}
  from '../../packages/storage-adapters/src/private-account-data-export.ts';
import {readStrictStoredZip,writeStoredZip} from '../../packages/storage-adapters/src/portable-source-archive.ts';

assert.equal(process.env.KADMEION_LOCAL_INTEGRATION,'1','Local integration opt-in required');
const raw=execFileSync('supabase',['status','-o','env'],{encoding:'utf8',timeout:20_000});
const env=new Map();
for(const line of raw.split(/\r?\n/)){
  const match=line.trim().match(/^(?:export )?([A-Z_]+)=(.*)$/);
  if(match)env.set(match[1],match[2].trim().replace(/^["']|["']$/g,''));
}
const api=new URL(env.get('API_URL')||'http://127.0.0.1:54321');
assert.equal(api.protocol,'http:');
assert.ok(['127.0.0.1','localhost'].includes(api.hostname));
assert.equal(api.port,'54321');
assert.equal(api.pathname,'/');
const anon=env.get('ANON_KEY');
assert.ok(typeof anon==='string'&&anon.startsWith('eyJ')&&anon.length>70,
  'Local Supabase legacy anon JWT unavailable');
const url=api.origin+'/functions/v1/complete-private-asset';
const header={'Authorization':'Bearer '+anon,'apikey':anon,'Content-Type':'application/json'};
const request=async(body,options={})=>fetch(url,{method:'POST',
  headers:{...header,...options},body:JSON.stringify(body),
  credentials:'omit',redirect:'error',cache:'no-store',
  signal:AbortSignal.timeout(5000)});

test('B5 locally bundled Edge handler checks real gateway, origin and input',
  {timeout:90000},async()=>{
  const folder=await mkdtemp(join(tmpdir(),'kadmeion-edge-'));
  const config=join(folder,'function.env');
  await writeFile(config,
    'KADMEION_ASSET_ATTESTATION_ENABLED=true\n'+
    'KADMEION_LOCAL_INTEGRATION=1\n'+
    'KADMEION_ALLOWED_ATTEST_ORIGINS=http://localhost:3000\n');
  const worker=spawn('supabase',
    ['functions','serve','complete-private-asset','--env-file',config],{
    stdio:['ignore','pipe','pipe'],env:{...process.env,KADMEION_LOCAL_INTEGRATION:'1'}
  });
  // Record only a bounded, scrubbed startup diagnostic (never secrets or headers).
  const statuses=new Set();
  const diagnostics=[];
  const capture=chunk=>{
    const message=String(chunk).slice(0,10000);
    for(const line of message.split(/\r?\n/)) {
      const kind=/\b(FAIL|ERR|error|denied|resolution|unable|cannot|unexpected)\b/i.exec(line);
      if(kind && diagnostics.length<8)
        diagnostics.push(kind[1].toLowerCase()+':'+line.replace(/(?:eyJ|sb_secret_)[A-Za-z0-9_.-]+/g,'[redacted]').slice(0,180));
    }
  };
  worker.stdout?.on('data',capture);
  worker.stderr?.on('data',capture);
  try {
    let ready=false;
    for(let i=0;i<50;i++){
      if(worker.exitCode!==null)break;
      try{
        const response=await request({assetId:'invalid'});
        statuses.add(response.status);
        if(response.status===400){await response.body?.cancel();ready=true;break;}
        await response.body?.cancel();
      }catch{/* gateway or Deno isolate not running yet */}
      await delay(300);
    }
    assert.equal(ready,true,'Edge bundle must reject invalid UUID; observed HTTP: '+
      [...statuses].join(',')+'; exit='+worker.exitCode+'; startup='+diagnostics.join(' | '));
    // The local CLI may briefly restart its Deno isolate after the first hit.
    // Retry only transport exceptions; never retry an unexpected HTTP status.
    const stable=async(call)=>{
      let last;
      for(let attempt=0;attempt<4;attempt++){
        if(worker.exitCode!==null)
          throw Error('Edge process exited: '+worker.exitCode+'; '+diagnostics.join(' | '));
        try{return await call();}
        catch(error){last=error;await delay(250);}
      }
      throw Error('Local Edge HTTP transport unavailable: '+
        (last instanceof Error?last.message:'unknown')+'; '+diagnostics.join(' | '));
    };
    const denied=await stable(()=>request({assetId:'invalid'},{Origin:'https://foreign.invalid'}));
    assert.equal(denied.status,403,'Origin policy must reject foreign browsers');
    await denied.body?.cancel();
    const browser=await stable(()=>request({assetId:'invalid'},{Origin:'http://localhost:3000'}));
    assert.equal(browser.status,400);
    // Supabase's local gateway can override a function's Access-Control-Allow-Origin
    // with "*". CORS is NOT authorization: the preceding foreign-origin 403 is
    // the security invariant, along with the owner JWT and Storage RLS checks.
    assert.ok(['http://localhost:3000','*'].includes(
      browser.headers.get('access-control-allow-origin')));
    await browser.body?.cancel();
    const anonymous=await stable(()=>fetch(url,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({assetId:'invalid'}),redirect:'error',
      signal:AbortSignal.timeout(5000)}));
    assert.ok(anonymous.status===401||anonymous.status===403,
      'Gateway must reject requests without a verified user JWT');
    await anonymous.body?.cancel();
  }finally{
    worker.kill('SIGTERM');
    await rm(folder,{recursive:true,force:true});
  }
});

test('C05 real local standalone PROFILE storage, registration, avatar CAS and request-bound v2 inventory',
  {timeout:120000},async()=>{
    const service=env.get('SERVICE_ROLE_KEY');
    assert.ok(typeof service==='string'&&service.startsWith('eyJ')&&service.length>70);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64');
    const digest=createHash('sha256').update(png).digest('hex');
    const call=async(path,{method='POST',token=anon,key=anon,body,type='application/json',upsert}={})=>{
      const response=await fetch(api.origin+path,{method,headers:{apikey:key,Authorization:'Bearer '+token,
        'Content-Type':type,...(upsert===undefined?{}:{'x-upsert':upsert})},
        body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body),
        cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
      const bytes=new Uint8Array(await response.arrayBuffer());
      let data=null;if((response.headers.get('content-type')??'').includes('json')){
        try{data=JSON.parse(new TextDecoder().decode(bytes))}catch{}
      }
      return {ok:response.ok,status:response.status,data,bytes};
    };
    const success=(result,label)=>{assert.ok(result.ok,label+' HTTP '+result.status);return result.data};
    const createOwner=async()=>{
      const email='ci-profile-'+randomUUID()+'@testing.invalid',password='LocalOnly-'+randomUUID();
      const created=success(await call('/auth/v1/admin/users',{token:service,key:service,
        body:{email,password,email_confirm:true,user_metadata:{display_name:'Local profile fixture'}}}),'Provision disposable user');
      const signed=success(await call('/auth/v1/token?grant_type=password',{body:{email,password}}),'Sign in disposable user');
      assert.equal(signed.user.id,created.id);assert.ok(typeof signed.access_token==='string');
      return {id:created.id,token:signed.access_token};
    };
    const owner=await createOwner(),foreign=await createOwner();
    const rpc=(name,body={},actor=owner)=>call('/rest/v1/rpc/'+name,{body,token:actor.token});
    const wantDenied=(result,code)=>{assert.ok(!result.ok);if(code)assert.equal(result.data?.code,code)};
    const reserve={p_operation_id:randomUUID(),p_mime_type:'image/png',p_byte_size:png.length,p_alt_text:'Local avatar'};
    const initial=success(await rpc('read_private_profile_avatar'),'Initial avatar state');
    assert.deepEqual(initial,{ownerUserId:owner.id,revision:0,asset:null,publicDeliveryAllowed:false});
    const registry=success(await rpc('reserve_private_profile_asset',reserve),'Reserve standalone avatar');
    assert.equal(registry.scope,'PROFILE');assert.equal(registry.state,'PENDING_UPLOAD');
    assert.equal(registry.ownerUserId,owner.id);assert.equal(registry.objectPath,owner.id+'/profile/'+reserve.p_operation_id+'.img');
    assert.deepEqual(success(await rpc('reserve_private_profile_asset',reserve),'Lost reservation ACK replay'),registry);
    wantDenied(await rpc('reserve_private_profile_asset',{...reserve,p_alt_text:'Changed alt'}),'23505');
    const register={p_asset_id:registry.assetId},pin={p_scope:'PROFILE',p_asset_id:registry.assetId,p_project_id:null};
    wantDenied(await rpc('register_private_profile_asset',register),'22023');
    wantDenied(await rpc('read_owner_private_asset_pin',pin),'42501');
    const storage='/storage/v1/object/kadmeion-private-assets/';
    const upload=(path,actor=owner,body=png,type='image/png',upsert='false')=>call(storage+path,
      {method:'POST',token:actor.token,body,type,upsert});
    wantDenied(await upload(owner.id+'/profile/'+randomUUID()+'.img'));
    wantDenied(await upload(registry.objectPath,foreign));
    wantDenied(await upload(registry.objectPath,owner,png.slice(0,-1)));
    success(await upload(registry.objectPath),'Upload exact private PNG');
    const registered=success(await rpc('register_private_profile_asset',register),'Register exact immutable profile object');
    assert.equal(registered.state,'REGISTERED');assert.equal(registered.publicDeliveryAllowed,false);
    assert.deepEqual(success(await rpc('register_private_profile_asset',register),'Registration replay'),registered);
    wantDenied(await rpc('register_private_profile_asset',register,foreign),'42501');
    const unpinned=success(await rpc('read_owner_private_asset_pin',pin),'Read unpinned PROFILE');
    assert.equal(unpinned.status,'UNPINNED');assert.equal(unpinned.expectedSha256,null);
    assert.equal(unpinned.projectId,null);assert.equal(unpinned.publicDeliveryAllowed,false);
    wantDenied(await rpc('read_owner_private_asset_pin',pin,foreign),'42501');
    wantDenied(await rpc('read_owner_private_asset_pin',{...pin,p_scope:'PROJECT',p_project_id:randomUUID()}),'42501');
    const readPath=storage.replace('/object/','/object/authenticated/')+registry.objectPath;
    const stored=await call(readPath,{method:'GET',token:owner.token});
    assert.ok(stored.ok);assert.equal(createHash('sha256').update(stored.bytes).digest('hex'),digest);
    wantDenied(await call(readPath,{method:'GET',token:foreign.token}));
    wantDenied(await call(storage.replace('/object/','/object/public/')+registry.objectPath,{method:'GET'}));
    const attest={p_asset_id:registry.assetId,p_owner_user_id:owner.id,p_storage_object_id:unpinned.objectId,
      p_storage_version:unpinned.version,p_expected_sha256:digest};
    wantDenied(await rpc('record_private_profile_asset_content_attestation',attest));
    const trusted=body=>call('/rest/v1/rpc/record_private_profile_asset_content_attestation',
      {body,token:service,key:service});
    // Actual owner-facing PROFILE completion gateway must create the pin.
    // Never substitute a privileged fixture pin for this positive assertion.
    const folder=await mkdtemp(join(tmpdir(),'kadmeion-profile-attest-'));
    const config=join(folder,'function.env');
    await writeFile(config,'KADMEION_ASSET_ATTESTATION_ENABLED=true\nKADMEION_LOCAL_INTEGRATION=1\nKADMEION_ALLOWED_ATTEST_ORIGINS=http://localhost:3000\n');
    const worker=spawn('supabase',['functions','serve','complete-private-asset','--env-file',config],{
      stdio:['ignore','pipe','pipe'],env:{...process.env,KADMEION_LOCAL_INTEGRATION:'1'}
    });
    const diagnostics=[];
    const captureEdgeDiagnostics=chunk=>{for(const line of String(chunk).slice(0,10000).split(/\r?\n/))
      if(/error|failed|denied|resolution/i.test(line)&&diagnostics.length<8)
        diagnostics.push(line.replace(/(?:eyJ|sb_secret_)[A-Za-z0-9_.-]+/g,'[redacted]').slice(0,150));};
    worker.stdout?.on('data',captureEdgeDiagnostics);worker.stderr?.on('data',captureEdgeDiagnostics);
    try{
      let ready=false;
      for(let n=0;n<50&&worker.exitCode===null;n++){
        try{const response=await request({assetId:'invalid'});if(response.status===400){await response.body?.cancel();ready=true;break;}await response.body?.cancel();}catch{}
        await delay(300);
      }
      assert.ok(ready,'PROFILE Edge failed to start: '+diagnostics.join(' | '));
      const complete=(actor,body)=>call('/functions/v1/complete-private-asset',{token:actor.token,body});
      wantDenied(await complete(foreign,{assetId:registry.assetId,scope:'PROFILE'}));
      wantDenied(await complete(owner,{assetId:registry.assetId,scope:'PROFILE',expectedSha256:digest}));
      wantDenied(await complete(owner,{assetId:registry.assetId,scope:'PROJECT'}));
      assert.deepEqual(success(await rpc('read_owner_private_asset_pin',pin),'Denied calls leave pin unchanged'),unpinned);
      const expected={assetId:registry.assetId,status:'WRITE_ONCE_ATTESTED',publicPublishingAllowed:false,accountDeletionAllowed:false};
      assert.deepEqual(success(await complete(owner,{assetId:registry.assetId,scope:'PROFILE'}),'Actual authenticated PROFILE Edge pin'),expected);
      assert.deepEqual(success(await complete(owner,{assetId:registry.assetId,scope:'PROFILE'}),'Actual PROFILE completion replay'),expected);
    }finally{worker.kill('SIGTERM');await rm(folder,{recursive:true,force:true});}
    const attestation=success(await trusted(attest),'Exact service replay after real owner Edge pin');
    assert.deepEqual(attestation,{assetId:registry.assetId,scope:'PROFILE',status:'WRITE_ONCE_ATTESTED',providerSigned:false,deletionAllowed:false});
    assert.deepEqual(success(await trusted(attest),'Pin exact replay'),attestation);
    wantDenied(await trusted({...attest,p_expected_sha256:'0'.repeat(64)}),'23505');
    const pinned=success(await rpc('read_owner_private_asset_pin',pin),'Read trusted profile pin');
    assert.deepEqual(pinned,{...unpinned,status:'SERVER_HASH_PINNED',expectedSha256:digest});
    const change={p_base_revision:0,p_asset_id:registry.assetId,p_operation_id:randomUUID()};
    const avatar=success(await rpc('set_private_profile_avatar',change),'Attach verified owner avatar');
    assert.equal(avatar.revision,1);assert.equal(avatar.asset.id,registry.assetId);
    assert.equal(avatar.publicDeliveryAllowed,false);
    assert.deepEqual(success(await rpc('set_private_profile_avatar',change),'Avatar CAS replay'),avatar);
    wantDenied(await rpc('set_private_profile_avatar',{...change,p_asset_id:null}),'40001');
    wantDenied(await rpc('set_private_profile_avatar',change,foreign),'42501');
    wantDenied(await upload(registry.objectPath,owner,png,'image/png','true'));
    wantDenied(await rpc('create_private_account_exit_inventory',{p_operation_id:randomUUID(),p_request_id:null}),'55000');
    const capture={p_operation_id:randomUUID(),p_request_id:null};
    const snapshot=success(await rpc('create_private_account_exit_inventory_v2',capture),'Capture standalone v2');
    assert.equal(snapshot.schemaVersion,2);assert.equal(snapshot.requestId,null);
    assert.equal(snapshot.inventory.counts.profileAssetMetadata,1);assert.equal(snapshot.deletionAllowed,false);
    assert.deepEqual(success(await rpc('create_private_account_exit_inventory_v2',capture),'Inventory replay'),
      {...snapshot,alreadyCaptured:true});
    const scope={p_snapshot_id:snapshot.snapshotId,p_expected_request_id:null};
    for(const name of ['get_private_account_exit_inventory_v2','reconcile_private_account_exit_storage_v2','read_private_asset_content_attestations_v2','owner_export_account_metadata_v2']){
      wantDenied(await rpc(name,{...scope,p_expected_request_id:randomUUID()}),'42501');
      wantDenied(await rpc(name,scope,foreign),'42501');
      wantDenied(await rpc(name,{p_snapshot_id:snapshot.snapshotId}));
    }
    const reconciliation=success(await rpc('reconcile_private_account_exit_storage_v2',scope),'Exact reconciled profile object');
    assert.equal(reconciliation.status,'METADATA_MATCH_ONLY');assert.equal(reconciliation.profileRegistered,1);
    assert.equal(reconciliation.projectRegistered,0);assert.equal(reconciliation.deletionAllowed,false);
    const pins=success(await rpc('read_private_asset_content_attestations_v2',scope),'V2 profile pin union');
    assert.equal(pins.status,'SERVER_HASH_PINNED');assert.equal(pins.attestedAssets,1);
    assert.deepEqual(pins.attestations,[{scope:'PROFILE',assetId:registry.assetId,projectId:null,path:registry.objectPath,
      objectId:pinned.objectId,version:pinned.version,mimeType:'image/png',byteSize:png.length,expectedSha256:digest}]);
    assert.equal(pins.deletionAllowed,false);
    const metadata=success(await rpc('owner_export_account_metadata_v2',scope),'Actual profile metadata export');
    assert.equal(metadata.records.profile_assets.length,1);
    assert.equal(metadata.records.profile_assets[0].id,registry.assetId);
    // Exercise the actual S5 exporter against the real S1 v2 RPCs and Storage;
    // no fixture replaces any response. Bound transport strictly to local API.
    const requests=[];
    const transport=async(url,init)=>{
      const dest=new URL(String(url));assert.equal(dest.origin,api.origin);
      requests.push(dest.pathname);
      return fetch(url,init);
    };
    const exporter=new SupabasePrivateAccountDataExporter(api.origin,anon,async()=>owner.token,transport);
    const metadataArtifact=await exporter.exportApplicationMetadataV2(snapshot.snapshotId,null);
    assert.equal(metadataArtifact.status,'APPLICATION_METADATA_SNAPSHOT');
    assert.equal(metadataArtifact.storageBytesIncluded,false);
    assert.equal(metadataArtifact.providerDataIncluded,false);
    const partial=await exporter.exportV2(snapshot.snapshotId,null);
    assert.equal(partial.status,'BOUNDED_PARTIAL_EXPORT');
    assert.equal(partial.completeAccountExport,false);assert.equal(partial.deletionAllowed,false);
    const parsed=JSON.parse(new TextDecoder().decode(partial.bytes));
    assert.equal(parsed.schemaVersion,2);assert.equal(parsed.requestId,null);
    assert.equal(parsed.assets.length,1);assert.equal(parsed.assets[0].scope,'PROFILE');
    assert.equal(parsed.assets[0].assetId,registry.assetId);assert.equal(parsed.assets[0].projectId,null);
    assert.equal(parsed.assets[0].expectedSha256,digest);
    assert.deepEqual(Buffer.from(parsed.assets[0].base64,'base64'),png);
    const verified=await verifyBoundedPrivateAccountExport(partial.bytes);
    assert.equal(verified.schemaVersion,2);assert.equal(verified.requestId,null);
    assert.equal(verified.assetsChecked,1);assert.equal(verified.assetBytesChecked,png.length);
    assert.equal(verified.documentAuthenticityVerified,false);
    const bundle=await createBoundedPrivateAccountRecoveryBundle(partial.bytes);
    assert.equal(bundle.assetFiles,1);assert.equal(bundle.assetsReferenced,1);
    assert.equal(bundle.providerAuthenticityVerified,false);assert.equal(bundle.deletionAllowed,false);
    const restored=await restoreBoundedPrivateAccountJsonFromRecoveryBundle(bundle.zip);
    assert.deepEqual(restored.bytes,partial.bytes,'ZIP recovery must restore exact original JSON bytes');
    assert.equal(restored.sha256,verified.sha256);
    const limits={maxEntries:12,maxBytes:10*1024*1024,maxEntryBytes:5*1024*1024};
    const archive=readStrictStoredZip(bundle.zip,limits);
    const manifestName='kadmeion-partial-bundle.json';
    const manifest=JSON.parse(new TextDecoder().decode(archive.get(manifestName)));
    assert.equal(manifest.formatVersion,2);assert.equal(manifest.requestId,null);
    assert.equal(manifest.assetReferences[0].scope,'PROFILE');
    assert.equal(manifest.assetReferences[0].assetId,registry.assetId);
    // Rebuild a structurally valid ZIP with valid CRCs yet invalid semantic scope.
    const altered={...manifest,requestId:randomUUID()};
    archive.set(manifestName,new TextEncoder().encode(JSON.stringify(altered)));
    const tampered=writeStoredZip([...archive].map(([name,bytes])=>({name,bytes})),limits);
    await assert.rejects(restoreBoundedPrivateAccountJsonFromRecoveryBundle(tampered),{code:'INTEGRITY'});
    assert.ok(requests.includes('/rest/v1/rpc/read_private_asset_content_attestations_v2'));
    assert.ok(!requests.includes('/rest/v1/rpc/read_private_asset_content_attestations'));
    assert.equal(requests.filter(p=>p.includes('/storage/v1/object/info/authenticated/')).length,2);
    assert.equal(requests.filter(p=>p.includes('/storage/v1/object/authenticated/')).length,1);
    const prior=requests.length;
    await assert.rejects(exporter.exportV2(snapshot.snapshotId,randomUUID()));
    assert.ok(!requests.slice(prior).some(p=>p.includes('/storage/v1/object/')),
      'Invalid request binding must fail before reading asset bytes');
    const foreignExporter=new SupabasePrivateAccountDataExporter(api.origin,anon,async()=>foreign.token,transport);
    const crossStart=requests.length;
    await assert.rejects(foreignExporter.exportV2(snapshot.snapshotId,null));
    assert.ok(!requests.slice(crossStart).some(p=>p.includes('/storage/v1/object/')),
      'Foreign snapshot must not read Storage');

    const detached=success(await rpc('set_private_profile_avatar',{p_base_revision:1,p_asset_id:null,p_operation_id:randomUUID()}),'Detach only');
    assert.equal(detached.revision,2);assert.equal(detached.asset,null);
    wantDenied(await rpc('set_private_profile_avatar',change),'40001');
    assert.deepEqual(success(await rpc('read_owner_private_asset_pin',pin),'Detach preserves private bytes'),pinned);

    // Race a second real pending avatar upload against recovery. The first
    // object is still immutable; matching its digest alone cannot certify a
    // changing owner inventory. No provider response is mocked.
    let pending=null;
    let racingReads=0;
    const racingTransport=async(url,init)=>{
      const dest=new URL(String(url));assert.equal(dest.origin,api.origin);
      if(dest.pathname.includes('/storage/v1/object/authenticated/')){
        racingReads++;
        if(pending===null){
          pending=success(await rpc('reserve_private_profile_asset',{
            ...reserve,p_operation_id:randomUUID(),p_alt_text:'Concurrent pending avatar'
          }),'Reserve during recovery');
          assert.equal(pending.state,'PENDING_UPLOAD');
          success(await upload(pending.objectPath),'Upload pending bytes during recovery');
        }
      }
      return fetch(url,init);
    };
    const racingExporter=new SupabasePrivateAccountDataExporter(api.origin,anon,async()=>owner.token,racingTransport);
    await assert.rejects(racingExporter.exportV2(snapshot.snapshotId,null),{code:'UNVERIFIED'});
    assert.equal(racingReads,1,'Recovery must reject an actual inventory race after the first asset read');
    assert.ok(pending);
    const drift=success(await rpc('reconcile_private_account_exit_storage_v2',scope),'Read actual inventory drift');
    assert.equal(drift.status,'DISCREPANCY');assert.equal(drift.inventoryDrift,true);
    assert.equal(drift.profileRegistered,1);assert.equal(drift.profilePending,1);
    assert.equal(drift.profilePendingWithBytes,1);assert.equal(drift.storageObjects,2);
    assert.equal(drift.downloadableExportReady,false);assert.equal(drift.deletionAllowed,false);
    const withheld=success(await rpc('read_private_asset_content_attestations_v2',scope),'Withhold incomplete inventory pins');
    assert.equal(withheld.status,'UNVERIFIED');assert.equal(withheld.attestedAssets,0);
    assert.deepEqual(withheld.attestations,[]);assert.equal(withheld.deletionAllowed,false);
    const fresh=success(await rpc('create_private_account_exit_inventory_v2',{
      p_operation_id:randomUUID(),p_request_id:null
    }),'Recapture changing inventory');
    const freshScope={p_snapshot_id:fresh.snapshotId,p_expected_request_id:null};
    const stillPending=success(await rpc('reconcile_private_account_exit_storage_v2',freshScope),'Fresh inventory still contains pending bytes');
    assert.equal(stillPending.inventoryDrift,false);assert.equal(stillPending.status,'DISCREPANCY');
    assert.equal(stillPending.profilePendingWithBytes,1);
    const start=requests.length;
    await assert.rejects(exporter.exportV2(fresh.snapshotId,null),{code:'UNVERIFIED'});
    assert.ok(!requests.slice(start).some(p=>p.includes('/storage/v1/object/')),
      'Recapturing an inventory must not make an unfinished upload exportable');
    const pendingRead=storage.replace('/object/','/object/authenticated/')+pending.objectPath;
    wantDenied(await call(pendingRead,{method:'GET',token:foreign.token}));
    wantDenied(await call(storage.replace('/object/','/object/public/')+pending.objectPath,{method:'GET'}));
  });
