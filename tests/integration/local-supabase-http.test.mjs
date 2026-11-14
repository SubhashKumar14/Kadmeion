/**
 * Real JWT/Storage API isolation smoke test.
 *
 * Runs ONLY against an ephemeral Supabase CLI stack. It refuses non-local hosts,
 * requires an explicit CI opt-in, and uses service_role only to provision test
 * users (never for the actual owner/cross-owner access checks).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID,createHash } from 'node:crypto';
import {Client,Pool} from 'pg';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {PrivateServerDeliveryDenialGate} from '../../packages/storage-adapters/src/private-delivery-denial-gate.ts';


function localSupabaseCredentials() {
  assert.equal(process.env.KADMEION_LOCAL_INTEGRATION, '1',
    'Do not run privileged fixture setup without explicit local-test opt-in.');
  const raw=execFileSync('supabase',['status','-o','env'],{encoding:'utf8',timeout:20_000});
  const variables=new Map();
  for (const line of raw.split(/\r?\n/)) {
    const match=line.trim().match(/^(?:export )?([A-Z_]+)=(.*)$/);
    if (match) variables.set(match[1],match[2].trim().replace(/^["']|["']$/g,''));
  }
  const origin=variables.get('API_URL')||'http://127.0.0.1:54321';
  const url=new URL(origin);
  assert.equal(url.protocol,'http:');
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
  assert.equal(url.port,'54321');
  assert.equal(url.pathname,'/');
  const anon=variables.get('ANON_KEY'),service=variables.get('SERVICE_ROLE_KEY');
  assert.ok(anon?.length>50,'Local Supabase anon JWT unavailable.');
  assert.ok(service?.length>50,'Local Supabase service JWT unavailable.');
  return {origin:url.origin,anon,service};
}
const cfg=localSupabaseCredentials();

async function send(path,{method='GET',key=cfg.anon,bearer=key,body,headers={}}={}) {
  const response=await fetch(cfg.origin+path,{
    method,
    headers:{apikey:key,Authorization:'Bearer '+bearer,...headers},
    body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body),
    redirect:'manual',
    signal:AbortSignal.timeout(15_000)
  });
  const contentType=response.headers.get('content-type')??'';
  const bytes=new Uint8Array(await response.arrayBuffer());
  let data=null;
  if(contentType.includes('json')) {
    try {data=JSON.parse(new TextDecoder().decode(bytes));}
    catch {data=null;}
  }
  return {status:response.status,ok:response.ok,bytes,data,headers:response.headers};
}
function successful(result,label) {
  // Never include response bodies, session tokens, emails or API keys in CI logs.
  assert.ok(result.ok,label+' failed (HTTP '+result.status+')');
  return result.data;
}
async function adminUser(label) {
  const email='ci-'+label+'-'+randomUUID()+'@testing.invalid';
  const password='LocalTest!'+randomUUID()+'x';
  const created=await send('/auth/v1/admin/users',{
    method:'POST',key:cfg.service,bearer:cfg.service,
    headers:{'Content-Type':'application/json'},
    body:{email,password,email_confirm:true,user_metadata:{display_name:'CI '+label}}
  });
  const user=successful(created,'Local GoTrue fixture '+label);
  assert.match(user.id,/^[0-9a-f-]{36}$/i);
  const auth=await send('/auth/v1/token?grant_type=password',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:{email,password}
  });
  const session=successful(auth,'Real JWT sign-in '+label);
  assert.ok(typeof session.access_token==='string'&&session.access_token.length>50);
  assert.equal(session.user.id,user.id);
  return {id:user.id,token:session.access_token,email,password};
}
function bearer(user){return {bearer:user.token};}
function json(user){return {...bearer(user),headers:{'Content-Type':'application/json'}};}
const png=Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64'
));
const bucket='kadmeion-private-assets';

test('B1/B2: real local Auth JWTs enforce API and Storage tenancy (no hosted writes)',{timeout:120_000},async t=>{
  const owner=await adminUser('owner');
  const stranger=await adminUser('stranger');
  await t.test('real confirmed Auth accounts get private identity rows and no cross-owner profiles',async()=>{
    const readA=await send('/rest/v1/profiles?select=user_id,display_name',{...bearer(owner)});
    const readB=await send('/rest/v1/profiles?select=user_id,display_name',{...bearer(stranger)});
    assert.equal(successful(readA,'Owner profile read').length,1);
    assert.equal(readA.data[0].user_id,owner.id);
    assert.equal(successful(readB,'Stranger profile read').length,1);
    assert.equal(readB.data[0].user_id,stranger.id);
    assert.ok(!readB.data.some(x=>x.user_id===owner.id));
    const anonymous=await send('/rest/v1/profiles?select=user_id');
    assert.ok(!anonymous.ok || (Array.isArray(anonymous.data)&&anonymous.data.length===0),
      'Anonymous profile listing disclosed an identity');
  });
  let projectId;
  await t.test('owner can create a private project, stranger cannot list it or write as owner',async()=>{
    const created=await send('/rest/v1/projects?select=id,owner_user_id,slug',{
      ...json(owner),method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},
      body:{owner_user_id:owner.id,slug:'private-image-'+randomUUID().slice(0,8),title:'CI private project'}
    });
    const rows=successful(created,'Owner project creation');
    assert.equal(rows.length,1);projectId=rows[0].id;
    assert.equal(rows[0].owner_user_id,owner.id);
    const list=await send('/rest/v1/projects?select=id,owner_user_id',{...bearer(stranger)});
    assert.deepEqual(successful(list,'Cross-user project listing'),[]);
    const forged=await send('/rest/v1/projects',{
      ...json(stranger),method:'POST',
      body:{owner_user_id:owner.id,slug:'forged-'+randomUUID().slice(0,8),title:'Forgery'}
    });
    assert.ok(!forged.ok,'Cross-owner project creation was accepted');
  });
  const ownerPath=owner.id+'/ci-'+randomUUID().slice(0,8)+'/cover.png';
  const object='/storage/v1/object/'+bucket+'/'+ownerPath;
  await t.test('private bucket rejects cross-user upload while allowing owner upload',async()=>{
    const denied=await send(object,{
      method:'POST',...bearer(stranger),
      headers:{'Content-Type':'image/png'},body:png
    });
    assert.ok(!denied.ok,'Cross-user uploaded into someone else private prefix');
    const upload=await send(object,{
      method:'POST',...bearer(owner),
      headers:{'Content-Type':'image/png'},body:png
    });
    successful(upload,'Owner private PNG upload');
  });
  await t.test('authenticated direct bytes work only for owner; anonymous public link fails',async()=>{
    const own=await send('/storage/v1/object/authenticated/'+bucket+'/'+ownerPath,bearer(owner));
    assert.equal(own.ok,true,'Owner cannot download their own private image');
    assert.deepEqual(own.bytes,png);
    const other=await send('/storage/v1/object/authenticated/'+bucket+'/'+ownerPath,bearer(stranger));
    assert.ok(!other.ok,'Cross-user downloaded private image bytes');
    const anon=await send('/storage/v1/object/public/'+bucket+'/'+ownerPath);
    assert.ok(!anon.ok,'Private image publicly available');
    const fakeOwner=await send('/storage/v1/object/authenticated/'+bucket+'/'+ownerPath);
    assert.ok(!fakeOwner.ok,'Anonymous JWT unexpectedly downloaded private image');
  });
  await t.test('RPC verifies uploaded object metadata; forged, unuploaded and cross-user records fail',async()=>{
    const direct=await send('/rest/v1/project_assets',{
      ...json(owner),method:'POST',
      body:{project_id:projectId,owner_user_id:owner.id,object_path:ownerPath,
        mime_type:'image/png',byte_size:png.length,alt_text:'CI test'}
    });
    assert.ok(!direct.ok,'Client directly inserted unverified asset metadata');
    const rpc='/rest/v1/rpc/register_private_project_image';
    const input={p_project_id:projectId,p_object_path:ownerPath,p_mime_type:'image/png',
      p_byte_size:png.length,p_alt_text:'Transparent test pixel'};
    const missing=await send(rpc,{...json(owner),method:'POST',
      body:{...input,p_object_path:owner.id+'/other/missing.png'}});
    assert.ok(!missing.ok,'Missing object was associated with project');
    const wrongMime=await send(rpc,{...json(owner),method:'POST',
      body:{...input,p_mime_type:'image/jpeg'}});
    assert.ok(!wrongMime.ok,'Spoofed MIME metadata was accepted');
    const outsider=await send(rpc,{...json(stranger),method:'POST',body:input});
    assert.ok(!outsider.ok,'Cross-user registered another private image');
    const verified=await send(rpc,{...json(owner),method:'POST',body:input});
    const receipt=successful(verified,'Verified project image registration');
    assert.equal(receipt.storage_metadata_matched,true);
    assert.equal(receipt.object_path,ownerPath);
    const repeat=await send(rpc,{...json(owner),method:'POST',body:input});
    assert.equal(successful(repeat,'Idempotent asset registration').id,receipt.id);
    const unseen=await send('/rest/v1/project_assets?select=id',{...bearer(stranger)});
    assert.deepEqual(successful(unseen,'Cross-user asset metadata list'),[]);
  });
});


test('B3/B4/B5: real local JWT owner editor, frozen release, reviewer grants and Trash',{timeout:120_000},async t=>{
  const owner=await adminUser('portfolio-owner');
  const stranger=await adminUser('portfolio-outsider');
  const create=await send('/rest/v1/portfolios?select=id,owner_user_id,head_revision',{
    ...json(owner),method:'POST',
    headers:{'Content-Type':'application/json',Prefer:'return=representation'},
    body:{owner_user_id:owner.id,slug:'private-cloud-'+randomUUID().slice(0,8),
      title:'Private CI workspace',template_id:'starter'}
  });
  const portfolios=successful(create,'Owner private portfolio creation');
  assert.equal(portfolios.length,1);
  const id=portfolios[0].id;
  assert.equal(portfolios[0].owner_user_id,owner.id);
  assert.equal(portfolios[0].head_revision,0);
  const snapshot={formatVersion:1,files:{
    'kadmeion.json':JSON.stringify({formatVersion:1,seo:{title:'CI portfolio',description:'Real API test'}})
  },slots:{
    hero:{state:'S0',componentId:'title-stacked@1',content:{title:'CI author'}}
  },stashes:{}};
  const operation=randomUUID(), commitRpc='/rest/v1/rpc/commit_portfolio_revision';
  const commitBody={p_portfolio_id:id,p_operation_id:operation,p_base_revision:0,p_snapshot:snapshot};
  let revision,request,grant;
  await t.test('only owner can commit a snapshot to an immutable cloud head',async()=>{
    const foreignRead=await send('/rest/v1/portfolios?select=id',{...bearer(stranger)});
    assert.deepEqual(successful(foreignRead,'Cross-user portfolio listing'),[]);
    const foreign=await send(commitRpc,{...json(stranger),method:'POST',body:commitBody});
    assert.ok(!foreign.ok,'Cross-user wrote to private editor journal');
    const first=successful(await send(commitRpc,{...json(owner),method:'POST',body:commitBody}),
      'Owner cloud revision commit');
    revision=first.revision;
    assert.equal(revision,1);
    assert.equal(first.alreadyCommitted,false);
    assert.match(first.snapshotSha256,/^[0-9a-f]{64}$/);
    const duplicate=successful(await send(commitRpc,{...json(owner),method:'POST',body:commitBody}),
      'Replay editor operation');
    assert.equal(duplicate.revision,revision);
    assert.equal(duplicate.alreadyCommitted,true);
    assert.equal(duplicate.snapshotSha256,first.snapshotSha256);
    const stale=await send(commitRpc,{...json(owner),method:'POST',body:{
      ...commitBody,p_operation_id:randomUUID()}});
    assert.ok(!stale.ok,'Stale base revision unexpectedly overwrote cloud head');
    const head=successful(await send('/rest/v1/portfolios?select=head_revision&id=eq.'+id,bearer(owner)),
      'Read current portfolio head');
    assert.equal(head[0].head_revision,1);
    const immutable=successful(await send('/rest/v1/portfolio_revisions?select=revision,snapshot_sha256&portfolio_id=eq.'+id,
      bearer(owner)),'Read immutable journal');
    assert.equal(immutable.length,1);
    assert.equal(immutable[0].snapshot_sha256,first.snapshotSha256);
    const hidden=successful(await send('/rest/v1/portfolio_revisions?select=revision&portfolio_id=eq.'+id,
      bearer(stranger)),'Cross-user revision listing');
    assert.deepEqual(hidden,[]);
  });
  await t.test('freeze pins exactly the stored immutable revision; no public URL is created',async()=>{
    const params={p_portfolio_id:id,p_operation_id:randomUUID(),
      p_revision:revision,p_visibility_intent:'UNLISTED'};
    const stolen=await send('/rest/v1/rpc/freeze_private_release_request',{
      ...json(stranger),method:'POST',body:params});
    assert.ok(!stolen.ok,'Other user froze an owner revision');
    const first=successful(await send('/rest/v1/rpc/freeze_private_release_request',{
      ...json(owner),method:'POST',body:params}),'Owner freeze');
    request=first.requestId;
    assert.equal(first.status,'FROZEN');
    assert.equal(first.visibilityIntent,'UNLISTED');
    assert.equal(first.publicUrl,null);
    assert.equal(first.alreadyFrozen,false);
    assert.match(first.snapshotSha256,/^[0-9a-f]{64}$/);
    const duplicate=successful(await send('/rest/v1/rpc/freeze_private_release_request',{
      ...json(owner),method:'POST',body:params}),'Idempotent frozen request');
    assert.equal(duplicate.alreadyFrozen,true);
    assert.equal(duplicate.requestId,request);
    const foreign=successful(await send('/rest/v1/private_release_requests?select=id',bearer(stranger)),
      'Cross-account release listing');
    assert.deepEqual(foreign,[]);
  });
  await t.test('one owner-JWT RPC atomically reads pinned snapshot; no cross-owner access',async()=>{
    const rpc='/rest/v1/rpc/load_private_frozen_revision',body={p_request_id:request};
    const strangerRead=await send(rpc,{...json(stranger),method:'POST',body});
    assert.ok(!strangerRead.ok,'Foreign owner loaded private frozen snapshot');
    const anonymousRead=await send(rpc,{method:'POST',
      headers:{'Content-Type':'application/json'},body});
    assert.ok(!anonymousRead.ok,'Anonymous caller loaded private frozen snapshot');
    const loaded=successful(await send(rpc,{...json(owner),method:'POST',body}),
      'Atomic owner frozen snapshot load');
    assert.equal(loaded.requestId,request);
    assert.equal(loaded.portfolioId,id);
    assert.equal(loaded.revision,revision);
    assert.equal(loaded.status,'FROZEN');
    assert.equal(loaded.visibilityIntent,'UNLISTED');
    assert.equal(loaded.publicUrl,null);
    assert.deepEqual(loaded.snapshot,snapshot);
    assert.match(loaded.snapshotSha256,/^[0-9a-f]{64}$/);
    assert.equal(typeof loaded.snapshotCanonicalJson,'string');
    assert.deepEqual(JSON.parse(loaded.snapshotCanonicalJson),loaded.snapshot);
    assert.equal(createHash('sha256').update(loaded.snapshotCanonicalJson).digest('hex'),
      loaded.snapshotSha256);
  });
  await t.test('reviewer grants are hashed, private, one-time token receipts; no serving URL',async()=>{
    const params={p_request_id:request,p_operation_id:randomUUID(),p_valid_minutes:60};
    const issue='/rest/v1/rpc/issue_private_reviewer_grant';
    const strangerAttempt=await send(issue,{...json(stranger),method:'POST',body:params});
    assert.ok(!strangerAttempt.ok,'Cross-owner issued a reviewer grant');
    const first=successful(await send(issue,{...json(owner),method:'POST',body:params}),
      'Issue private reviewer grant');
    grant=first.grantId;
    assert.match(first.rawToken,/^[0-9a-f]{64}$/);
    assert.equal(first.status,'REGISTERED_UNSERVABLE');
    assert.equal(first.alreadyRegistered,false);
    const receiptAgain=successful(await send(issue,{...json(owner),method:'POST',body:params}),
      'Idempotent reviewer token request');
    assert.equal(receiptAgain.grantId,grant);
    assert.equal(receiptAgain.rawToken,null);
    const ownerRows=successful(await send('/rest/v1/private_reviewer_grants?select=id,request_id,expires_at',
      bearer(owner)),'Owner grant metadata');
    assert.equal(ownerRows.length,1);
    assert.equal(ownerRows[0].id,grant);
    const outsiderRows=successful(await send('/rest/v1/private_reviewer_grants?select=id',
      bearer(stranger)),'Cross-user grant metadata');
    assert.deepEqual(outsiderRows,[]);
    const hashes=await send('/rest/v1/private_reviewer_grants?select=token_sha256',bearer(owner));
    assert.ok(!hashes.ok,'Token digest leaked through browser-facing REST');
    const outsiderRevoke=await send('/rest/v1/rpc/revoke_private_reviewer_grant',{
      ...json(stranger),method:'POST',body:{p_grant_id:grant}});
    assert.ok(!outsiderRevoke.ok,'Foreign user revoked token');
    const revoke=successful(await send('/rest/v1/rpc/revoke_private_reviewer_grant',{
      ...json(owner),method:'POST',body:{p_grant_id:grant}}),'Owner reviewer grant revoke');
    assert.equal(revoke.status,'REVOKED');
    assert.equal(revoke.publicRevocationVerified,false);
  });
  await t.test('private release pointer CAS and direct REST remain tenant-private',async()=>{
    const read='/rest/v1/rpc/owner_read_private_release_pointer';
    const prepare='/rest/v1/rpc/owner_prepare_private_release_pointer';
    const block='/rest/v1/rpc/owner_block_private_release_pointer';
    const readBody={p_portfolio_id:id};
    const initial=successful(await send(read,{...json(owner),method:'POST',body:readBody}),
      'Read absent private pointer');
    assert.equal(initial.status,'BLOCKED');
    assert.equal(initial.generation,0);
    assert.equal(initial.publicServingEnabled,false);
    assert.equal(initial.publicUrl,null);
    assert.ok(!(await send(read,{...json(stranger),method:'POST',body:readBody})).ok,
      'Foreign owner read private pointer');
    assert.ok(!(await send(read,{method:'POST',
      headers:{'Content-Type':'application/json'},body:readBody})).ok,
      'Anonymous read private pointer');
    const candidate={p_portfolio_id:id,p_request_id:request,
      p_manifest_sha256:'a'.repeat(64),p_expected_generation:0,
      p_operation_id:randomUUID()};
    assert.ok(!(await send(prepare,{...json(stranger),method:'POST',body:candidate})).ok,
      'Other tenant prepared a release pointer');
    const first=successful(await send(prepare,{...json(owner),method:'POST',body:candidate}),
      'Prepare owner-only private pointer');
    assert.equal(first.status,'PREPARED_PRIVATE');
    assert.equal(first.generation,1);
    assert.equal(first.publicServingEnabled,false);
    assert.equal(first.hostRevocationVerified,false);
    assert.equal(first.publicUrl,null);
    const duplicate=successful(await send(prepare,{...json(owner),method:'POST',body:candidate}),
      'Replay private pointer prepare');
    assert.equal(duplicate.alreadyRecorded,true);
    const stale=await send(prepare,{...json(owner),method:'POST',
      body:{...candidate,p_operation_id:randomUUID()}});
    assert.ok(!stale.ok,'Stale generation replaced private candidate');
    const otherRows=successful(await send(
      '/rest/v1/private_release_visibility_pointers?select=portfolio_id',
      bearer(stranger)),'Other owner pointer listing');
    assert.deepEqual(otherRows,[]);
    const forged=await send('/rest/v1/private_release_visibility_pointers?portfolio_id=eq.'+id,{
      ...json(owner),method:'PATCH',body:{status:'LIVE_VERIFIED'}});
    assert.ok(!forged.ok,'Owner directly activated a public pointer');
    const blockBody={p_portfolio_id:id,p_operation_id:randomUUID()};
    const denied=await send(block,{...json(stranger),method:'POST',body:blockBody});
    assert.ok(!denied.ok,'Other tenant blocked owner pointer');
    const stopped=successful(await send(block,{...json(owner),method:'POST',body:blockBody}),
      'Owner block candidate');
    assert.equal(stopped.status,'BLOCKED');
    assert.equal(stopped.generation,2);
    assert.equal(stopped.stillBlocked,true);
    assert.equal(stopped.hostRevocationVerified,false);

    const oldPrepare=await send(prepare,{...json(owner),method:'POST',body:candidate});
    assert.ok(!oldPrepare.ok,'Old prepare receipt claimed active candidate after block');

    const again=successful(await send(prepare,{...json(owner),method:'POST',
      body:{...candidate,p_expected_generation:2,p_operation_id:randomUUID()}}),
      'Prepare after block requires latest generation');
    assert.equal(again.generation,3);
    const old=successful(await send(block,{...json(owner),method:'POST',body:blockBody}),
      'Replay old block against newer private candidate');
    assert.equal(old.stillBlocked,false);
    assert.equal(old.status,'PREPARED_PRIVATE');
  });
  await t.test('private Trash refuses foreign operations and blocks frozen revision reuse',async()=>{
    const move='/rest/v1/rpc/trash_private_item',restore='/rest/v1/rpc/restore_private_item';
    const p={p_item_type:'portfolio',p_item_id:id};
    const foreign=await send(move,{...json(stranger),method:'POST',body:p});
    assert.ok(!foreign.ok,'Stranger trashed owner portfolio');
    const trashed=successful(await send(move,{...json(owner),method:'POST',body:p}),
      'Owner Trash');
    assert.equal(trashed.status,'trashed');
    const pointerAfterTrash=successful(await send(
      '/rest/v1/rpc/owner_read_private_release_pointer',{
        ...json(owner),method:'POST',body:{p_portfolio_id:id}
      }),'Read pointer after Trash');
    assert.equal(pointerAfterTrash.status,'BLOCKED');
    assert.equal(pointerAfterTrash.generation,4);
    assert.equal(pointerAfterTrash.revocationGeneration,4);
    assert.equal(pointerAfterTrash.candidateRequestId,null);

    const blockedRead=await send('/rest/v1/rpc/load_private_frozen_revision',{
      ...json(owner),method:'POST',body:{p_request_id:request}});
    assert.ok(!blockedRead.ok,'Trashed portfolio still returned an old frozen snapshot');
    const duplicate=successful(await send(move,{...json(owner),method:'POST',body:p}),
      'Idempotent Trash');
    assert.equal(duplicate.status,'already_trashed');
    const blocked=await send('/rest/v1/rpc/freeze_private_release_request',{
      ...json(owner),method:'POST',
      body:{p_portfolio_id:id,p_operation_id:randomUUID(),p_revision:revision,
        p_visibility_intent:'PUBLIC'}});
    assert.ok(!blocked.ok,'Trashed portfolio was frozen');
    const blockedGrant=await send('/rest/v1/rpc/issue_private_reviewer_grant',{
      ...json(owner),method:'POST',
      body:{p_request_id:request,p_operation_id:randomUUID(),p_valid_minutes:60}});
    assert.ok(!blockedGrant.ok,'Trashed portfolio received a new private reviewer grant');
    const foreignRestore=await send(restore,{...json(stranger),method:'POST',body:p});
    assert.ok(!foreignRestore.ok,'Stranger restored owner portfolio');
    const back=successful(await send(restore,{...json(owner),method:'POST',body:p}),
      'Owner restore before 15-day expiry');
    assert.equal(back.status,'restored');
    assert.equal(back.public_visibility,'private');
    const pointerAfterRestore=successful(await send(
      '/rest/v1/rpc/owner_read_private_release_pointer',{
        ...json(owner),method:'POST',body:{p_portfolio_id:id}
      }),'Read pointer after restore');
    assert.equal(pointerAfterRestore.status,'BLOCKED');

    const restoredRead=successful(await send('/rest/v1/rpc/load_private_frozen_revision',{
      ...json(owner),method:'POST',body:{p_request_id:request}}),
      'Restored owner-private frozen snapshot');
    assert.equal(restoredRead.status,'FROZEN');
    assert.equal(restoredRead.publicUrl,null);
  });
});

test('B5: real JWT account-erasure requests stay owner-private and never erase',{timeout:120_000},async t=>{
  const owner=await adminUser('exit-owner');
  const stranger=await adminUser('exit-outsider');
  const rpc='/rest/v1/rpc/request_private_account_erasure';
  const withdraw='/rest/v1/rpc/withdraw_private_account_erasure';
  const operation=randomUUID();
  const body={p_operation_id:operation,p_confirmation:'DELETE MY ACCOUNT'};
  let requestId;
  await t.test('typed confirmation and owner JWT required; request remains blocked',async()=>{
    const anonymous=await send(rpc,{method:'POST',headers:{'Content-Type':'application/json'},body});
    assert.ok(!anonymous.ok,'Anonymous account-erasure request accepted');
    const bad=await send(rpc,{...json(owner),method:'POST',
      body:{...body,p_confirmation:'delete my account'}});
    assert.ok(!bad.ok,'Invalid typed confirmation accepted');
    const first=successful(await send(rpc,{...json(owner),method:'POST',body}),
      'Owner account-erasure request');
    requestId=first.requestId;
    assert.match(requestId,/^[0-9a-f-]{36}$/i);
    assert.equal(first.status,'REQUESTED_BLOCKED');
    assert.equal(first.alreadyRequested,false);
    for(const field of ['publicRevocationVerified','reauthVerified','accessTerminated',
      'erasureExecuted','retentionVerified'])assert.equal(first[field],false);
    const replay=successful(await send(rpc,{...json(owner),method:'POST',body}),
      'Idempotent account exit request');
    assert.equal(replay.requestId,requestId);
    assert.equal(replay.alreadyRequested,true);
    const duplicate=await send(rpc,{...json(owner),method:'POST',
      body:{...body,p_operation_id:randomUUID()}});
    assert.ok(!duplicate.ok,'Second active account erasure request accepted');
  });
  await t.test('RLS hides history; direct client writes cannot forge erasure',async()=>{
    const listPath='/rest/v1/private_account_erasure_requests?select=id,status,public_revocation_verified,reauth_verified,access_terminated,erasure_executed,retention_verified';
    const ownerList=successful(await send(listPath,bearer(owner)),'Owner erasure history');
    assert.equal(ownerList.length,1);
    assert.equal(ownerList[0].id,requestId);
    assert.equal(ownerList[0].erasure_executed,false);
    const outsiderList=successful(await send(listPath,bearer(stranger)),
      'Foreign erasure history');
    assert.deepEqual(outsiderList,[]);
    const spoof=await send('/rest/v1/private_account_erasure_requests?id=eq.'+requestId,{
      ...json(owner),method:'PATCH',body:{erasure_executed:true,public_revocation_verified:true}
    });
    assert.ok(!spoof.ok,'Owner forged erasure or host revocation flags');
    const hidden=await send('/rest/v1/private_account_erasure_requests?select=owner_user_id',
      bearer(owner));
    assert.ok(!hidden.ok,'Internal owner key exposed in public REST projection');
  });
  await t.test('foreign withdrawal denied; owner withdrawal is idempotent',async()=>{
    const params={p_request_id:requestId,p_operation_id:randomUUID()};
    const foreign=await send(withdraw,{...json(stranger),method:'POST',body:params});
    assert.ok(!foreign.ok,'Other tenant withdrew owner account exit request');
    const first=successful(await send(withdraw,{...json(owner),method:'POST',body:params}),
      'Owner account exit withdrawal');
    assert.equal(first.status,'WITHDRAWN');
    assert.equal(first.alreadyWithdrawn,false);
    assert.equal(first.erasureExecuted,false);
    const replay=successful(await send(withdraw,{...json(owner),method:'POST',body:params}),
      'Idempotent account exit withdrawal');
    assert.equal(replay.alreadyWithdrawn,true);
    const newRequest=successful(await send(rpc,{...json(owner),method:'POST',
      body:{...body,p_operation_id:randomUUID()}}),'Request after withdrawal');
    assert.equal(newRequest.status,'REQUESTED_BLOCKED');
    assert.notEqual(newRequest.requestId,requestId);
    const profile=successful(await send('/rest/v1/profiles?select=user_id',
      bearer(owner)),'Owner profile after request');
    assert.equal(profile[0].user_id,owner.id);
  });
});

test('B5: owner account-exit preflight checks active server session and tenant footprint',
  {timeout:120_000},async t=>{
  const owner=await adminUser('preflight-owner');
  const outsider=await adminUser('preflight-outsider');
  const route='/rest/v1/rpc/private_account_exit_preflight';
  const post=async user=>send(route,{...json(user),method:'POST',body:{}});
  await t.test('anonymous and missing session are denied',async()=>{
    const anon=await send(route,{method:'POST',headers:{'Content-Type':'application/json'},body:{}});
    assert.ok(!anon.ok,'Anonymous account-exit inventory accessible');
  });
  await t.test('owner sees real private counts but not other owner data',async()=>{
    const before=successful(await post(owner),'Owner exit preflight');
    assert.equal(before.status,'INVENTORY_ONLY');
    assert.equal(before.liveSessionChecked,true);
    assert.equal(before.recentReauthVerified,false);
    assert.equal(before.deletionAllowed,false);
    assert.equal(before.publicRoutes,'UNVERIFIED');
    assert.equal(before.exports,'NOT_TRACKED');
    assert.equal(before.counts.projects,0);
    const created=await send('/rest/v1/projects?select=id',{
      ...json(owner),method:'POST',headers:{'Content-Type':'application/json',
        Prefer:'return=representation'},body:{
          owner_user_id:owner.id,slug:'exit-'+randomUUID().slice(0,8),title:'Exit count project'
        }});
    successful(created,'Owner preflight project fixture');
    const own=successful(await post(owner),'Owner populated preflight');
    assert.equal(own.counts.projects,1);
    assert.equal(own.countsCapped,false);
    assert.equal(own.freshSignInCandidate,true);
    const other=successful(await post(outsider),'Isolated outsider preflight');
    assert.equal(other.counts.projects,0);
    assert.equal(other.counts.accountExitRequests,0);
    assert.equal(other.deletionAllowed,false);
  });
  await t.test('a signed-out but still-present JWT cannot read private preflight',async()=>{
    const logout=await send('/auth/v1/logout',{...bearer(owner),method:'POST'});
    successful(logout,'Local owner signout');
    const stale=await post(owner);
    assert.ok(!stale.ok,'Signed-out JWT retained private preflight access');
  });
});

test('B5: deliberate account-exit reauthentication requires a NEW live owner sign-in',
  {timeout:120_000},async t=>{
  const owner=await adminUser('challenge-owner');
  const outsider=await adminUser('challenge-outsider');
  const begin='/rest/v1/rpc/begin_private_account_exit_reauth';
  const complete='/rest/v1/rpc/complete_private_account_exit_reauth';
  const operation=randomUUID();
  const issue=async (who,id=operation)=>send(begin,{...json(who),method:'POST',
    body:{p_operation_id:id}});
  const finish=async(who,id)=>send(complete,{...json(who),method:'POST',
    body:{p_challenge_id:id}});
  let challengeId;
  await t.test('anonymous denied and owner operation idempotent',async()=>{
    const anon=await send(begin,{method:'POST',headers:{'Content-Type':'application/json'},
      body:{p_operation_id:operation}});
    assert.ok(!anon.ok,'Anonymous created an exit reauth challenge');
    const started=successful(await issue(owner),'Owner reauth begin');
    challengeId=started.challengeId;
    assert.match(challengeId,/^[0-9a-f-]{36}$/i);
    assert.equal(started.status,'AWAITING_NEW_SIGN_IN');
    assert.equal(started.deletionAllowed,false);
    const repeat=successful(await issue(owner),'Idempotent reauth begin');
    assert.equal(repeat.challengeId,challengeId);
    assert.equal(repeat.alreadyIssued,true);
  });
  await t.test('another owner and the original session cannot finish proof',async()=>{
    assert.ok(!(await finish(outsider,challengeId)).ok,
      'Different owner completed reauth proof');
    assert.ok(!(await finish(owner,challengeId)).ok,
      'Original session was accepted without reauthentication');
    const hidden=await send('/rest/v1/private_account_exit_reauth_challenges?select=id',
      bearer(owner));
    assert.ok(!hidden.ok,'Owner directly read protected proof data');
  });
  await t.test('fresh password sign-in creates distinct provider session proof',async()=>{
    const login=successful(await send('/auth/v1/token?grant_type=password',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:{email:owner.email,password:owner.password}
    }),'New explicit GoTrue login');
    assert.equal(login.user.id,owner.id);
    assert.notEqual(login.access_token,owner.token);
    const newOwner={...owner,token:login.access_token};
    const proof=successful(await finish(newOwner,challengeId),
      'Complete fresh account-exit sign-in proof');
    assert.equal(proof.status,'NEW_SIGN_IN_VERIFIED');
    assert.equal(proof.alreadyVerified,false);
    assert.equal(proof.deletionAllowed,false);
    const repeated=successful(await finish(newOwner,challengeId),'Replay same proof');
    assert.equal(repeated.alreadyVerified,true);
    assert.ok(!(await finish(owner,challengeId)).ok,
      'Original old session reused a verified challenge');
  });
});

test('B4: future private host denial RPC is not exposed on the Data API',
  {timeout:30_000},async()=>{
  const body={p_portfolio_id:randomUUID(),p_resource:'CANONICAL_HTML'};
  const route='/rest/v1/rpc/private_delivery_denial_gate';
  for(const [key,label] of [
    [cfg.anon,'anonymous'],
    [cfg.service,'service role']
  ]){
    for(const headers of [
      {'Content-Type':'application/json'},
      {'Content-Type':'application/json','Content-Profile':'kadmeion_private'}
    ]){
      const response=await send(route,{method:'POST',key,bearer:key,
        headers,body});
      assert.ok(!response.ok,label+' unexpectedly reached private gate over REST');
    }
  }
});

test('B4: artifact binding RPC and private binding registry cannot be read over PostgREST',
  {timeout:30_000},async()=>{
  const body={p_request_id:randomUUID(),p_expected_generation:1,
    p_manifest_json:'{}',p_html:'not a real artifact'};
  const routes=[
    ['/rest/v1/rpc/bind_private_artifact_candidate',body],
    ['/rest/v1/private_artifact_bindings?select=portfolio_id',undefined]
  ];
  for(const [key,label] of [[cfg.anon,'anonymous'],[cfg.service,'service role']]){
    for(const [route,payload] of routes){
      for(const profile of [undefined,'kadmeion_private']){
        const headers={'Content-Type':'application/json'};
        if(profile)headers['Content-Profile']=profile;
        if(profile)headers['Accept-Profile']=profile;
        const response=await send(route,{method:payload?'POST':'GET',key,bearer:key,
          headers,body:payload});
        assert.ok(!response.ok,label+' accessed internal binding through Data API');
      }
    }
  }
});

test('B5: case-bound operator BLOCK cannot be forged over local REST',
  {timeout:45_000},async()=>{
  const ordinary=await adminUser('moderation-denial');
  const path='/rest/v1/rpc/operator_block_private_portfolio';
  const body={p_case_id:randomUUID(),p_portfolio_id:randomUUID(),
    p_operation_id:randomUUID()};
  const anonymous=await send(path,{method:'POST',
    headers:{'Content-Type':'application/json'},body});
  assert.ok(!anonymous.ok,'Anonymous caller created an operator block');
  const regular=await send(path,{...json(ordinary),method:'POST',body});
  assert.ok(!regular.ok,'Nonoperator created an operator block');
  const forged=await send('/rest/v1/private_release_visibility_events',{
    ...json(ordinary),method:'POST',
    body:{portfolio_id:body.p_portfolio_id,owner_user_id:ordinary.id,
      operation_id:body.p_operation_id,event_type:'OPERATOR_BLOCK',
      resulting_generation:1}});
  assert.ok(!forged.ok,'Regular user forged operator audit event');
  for(const key of [cfg.anon,cfg.service]){
    for(const profile of [undefined,'kadmeion_private']){
      const headers={};
      if(profile)headers['Accept-Profile']=profile;
      const response=await send('/rest/v1/moderation_portfolio_holds?select=portfolio_id',
        {key,bearer:key,headers});
      assert.ok(!response.ok,'Private moderation hold leaked through Data API');
    }
  }
});

test('B6: local HTTP canonical HTML and direct immutable assets deny across operator block, Trash, tenant and provider failure',
  {timeout:180_000},async()=>{
  // Deliberately nondeployable fixture: no public allow path or artifact bytes.
  const raw=execFileSync('supabase',['status','-o','env'],{encoding:'utf8',timeout:20000});
  const match=raw.match(/^(?:export )?DB_URL=(.*)$/m);
  assert.ok(match,'Local Supabase DB URL required');
  const db=new URL(match[1].trim().replace(/^["']|["']$/g,''));
  assert.equal(db.protocol,'postgresql:');
  assert.ok(['127.0.0.1','localhost'].includes(db.hostname));
  assert.equal(db.port,'54322');
  assert.equal(db.username,'postgres');
  const admin=new Client({host:db.hostname,port:Number(db.port),database:'postgres',
    user:'postgres',password:decodeURIComponent(db.password),ssl:false});
  const role='kd_http_'+randomBytes(6).toString('hex');
  const secret=randomBytes(24).toString('hex');
  const release='a'.repeat(64),digest='b'.repeat(64);
  let pool,server,roleCreated=false;
  const request=(id,resource)=>resource==='CANONICAL_HTML'?
    {portfolioId:id,resource}:
    {portfolioId:id,resource,releaseSha256:release,
      path:'assets/'+digest+'.png',sha256:digest};
  try{
    await admin.connect();
    // The role and password are generated hex-only; no user-controlled SQL.
    await admin.query('CREATE ROLE '+role+" LOGIN PASSWORD '"+secret+
      "' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT");
    roleCreated=true;
    await admin.query('GRANT USAGE ON SCHEMA kadmeion_private TO '+role);
    await admin.query('GRANT EXECUTE ON FUNCTION kadmeion_private.private_delivery_denial_gate(uuid,text,text,text,text) TO '+role);
    pool=new Pool({host:db.hostname,port:Number(db.port),database:'postgres',
      user:role,password:secret,ssl:false,max:2,connectionTimeoutMillis:3000});
    await assert.rejects(pool.query('SELECT count(*) FROM public.portfolios'),
      'HTTP reader must not directly select private portfolio data');
    let outage=false,malformed=false,reads=0;
    const gate=new PrivateServerDeliveryDenialGate({readDenial:async r=>{
      reads++;
      if(outage)throw Error('Provider unavailable');
      const result=await pool.query(
        'SELECT kadmeion_private.private_delivery_denial_gate($1::uuid,$2::text,$3::text,$4::text,$5::text) AS receipt',[
          r.portfolioId,r.resource,r.resource==='DIRECT_ASSET'?r.releaseSha256:null,
          r.resource==='DIRECT_ASSET'?r.path:null,r.resource==='DIRECT_ASSET'?r.sha256:null]);
      return malformed?{...result.rows[0].receipt,servingAllowed:true}:result.rows[0].receipt;
    }});
    server=createServer(async(req,res)=>{
      res.setHeader('Cache-Control','private, no-store, max-age=0');
      res.setHeader('Content-Type','text/plain; charset=utf-8');
      res.setHeader('X-Content-Type-Options','nosniff');
      const path=new URL(req.url??'/','http://localhost').pathname;
      const html=/^\/p\/([0-9a-f-]{36})\/$/.exec(path);
      const asset=/^\/p\/([0-9a-f-]{36})\/releases\/([0-9a-f]{64})\/assets\/([0-9a-f]{64})\.(png|css|jpg|jpeg|webp|woff2)$/.exec(path);
      if((req.method==='GET'||req.method==='HEAD')&&(html||asset)){
        const input=html?request(html[1],'CANONICAL_HTML'):
          {portfolioId:asset[1],resource:'DIRECT_ASSET',releaseSha256:asset[2],
            path:'assets/'+asset[3]+'.'+asset[4],sha256:asset[3]};
        try{await gate.check(input);}catch{/* Fail closed on unexpected errors. */}
      }
      res.statusCode=404;
      res.end(req.method==='HEAD'?'':'Not found');
    });
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    const denied=async(id,headers={})=>{
      const beforeReads=reads;
      for(const path of ['/p/'+id+'/',
        '/p/'+id+'/releases/'+release+'/assets/'+digest+'.png']){
        const response=await fetch(origin+path,{headers,redirect:'manual',cache:'no-store'});
        assert.equal(response.status,404,'Private resource unexpectedly served');
        assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');
        assert.equal(response.headers.get('etag'),null);
        assert.equal(response.headers.get('location'),null);
        assert.equal(await response.text(),'Not found');
      }
      assert.equal(reads,beforeReads+2,'Each HTTP route must recheck the private SQL gate');
    };
    const owner=await adminUser('http-deny-owner');
    const outsider=await adminUser('http-deny-outsider');
    const moderator=await adminUser('http-deny-moderator');
    await admin.query('INSERT INTO kadmeion_private.operator_roles(user_id,role) VALUES ($1::uuid,$2)',
      [moderator.id,'moderator']);
    const prepared=async()=>{
      const rows=successful(await send('/rest/v1/portfolios?select=id',{
        ...json(owner),method:'POST',
        headers:{'Content-Type':'application/json',Prefer:'return=representation'},
        body:{owner_user_id:owner.id,slug:'http-deny-'+randomUUID().slice(0,8),
          title:'Private delivery fixture',template_id:'starter'}}),'Create private portfolio');
      const id=rows[0].id;
      const snapshot={formatVersion:1,files:{'kadmeion.json':JSON.stringify({
        formatVersion:1,seo:{title:'Private',description:'Local-only test'}})},
        slots:{hero:{state:'S0',componentId:'title-stacked@1',
          content:{title:'Private'}}},stashes:{}};
      const revision=successful(await send('/rest/v1/rpc/commit_portfolio_revision',{
        ...json(owner),method:'POST',body:{p_portfolio_id:id,
          p_operation_id:randomUUID(),p_base_revision:0,p_snapshot:snapshot}}),'Commit revision');
      const frozen=successful(await send('/rest/v1/rpc/freeze_private_release_request',{
        ...json(owner),method:'POST',body:{p_portfolio_id:id,
          p_operation_id:randomUUID(),p_revision:revision.revision,
          p_visibility_intent:'UNLISTED'}}),'Freeze revision');
      const pointer=successful(await send('/rest/v1/rpc/owner_prepare_private_release_pointer',{
        ...json(owner),method:'POST',body:{p_portfolio_id:id,p_request_id:frozen.requestId,
          p_manifest_sha256:release,p_expected_generation:0,
          p_operation_id:randomUUID()}}),'Prepare private pointer');
      assert.equal(pointer.status,'PREPARED_PRIVATE');
      return id;
    };
    const id=await prepared();
    for(const resource of ['CANONICAL_HTML','DIRECT_ASSET'])
      assert.equal((await gate.check(request(id,resource))).reason,'NO_VERIFIED_PUBLIC_RELEASE');
    await denied(id);
    await denied(id,{Authorization:'Bearer '+owner.token});
    await denied(id,{Authorization:'Bearer '+outsider.token});
    assert.ok(!(await send('/rest/v1/rpc/owner_read_private_release_pointer',{
      ...json(outsider),method:'POST',body:{p_portfolio_id:id}})).ok,
      'Cross-tenant pointer read succeeded');
    const caseReceipt=successful(await send('/rest/v1/rpc/operator_open_moderation_case',{
      ...json(moderator),method:'POST',body:{p_target_user_id:owner.id,
        p_operation_id:randomUUID(),p_reason_code:'SECURITY',
        p_summary:'Local HTTP denial fixture'}}),'Open operator case');
    const blockBody={p_case_id:caseReceipt.caseId,p_portfolio_id:id,
      p_operation_id:randomUUID()};
    assert.ok(!(await send('/rest/v1/rpc/operator_block_private_portfolio',{
      ...json(outsider),method:'POST',body:blockBody})).ok);
    const blocked=successful(await send('/rest/v1/rpc/operator_block_private_portfolio',{
      ...json(moderator),method:'POST',body:blockBody}),'Operator block');
    assert.equal(blocked.status,'BLOCKED');
    for(const resource of ['CANONICAL_HTML','DIRECT_ASSET']){
      const verdict=await gate.check(request(id,resource));
      assert.equal(verdict.reason,'PRIVATE_POINTER_BLOCKED');
      assert.equal(verdict.generation,2);
      assert.equal(verdict.revocationGeneration,2);
    }
    await denied(id);
    const trashId=await prepared();
    assert.ok(!(await send('/rest/v1/rpc/trash_private_item',{
      ...json(outsider),method:'POST',
      body:{p_item_type:'portfolio',p_item_id:trashId}})).ok);
    successful(await send('/rest/v1/rpc/trash_private_item',{
      ...json(owner),method:'POST',
      body:{p_item_type:'portfolio',p_item_id:trashId}}),'Owner Trash');
    for(const resource of ['CANONICAL_HTML','DIRECT_ASSET'])
      assert.equal((await gate.check(request(trashId,resource))).reason,'PRIVATE_POINTER_BLOCKED');
    await denied(trashId);
    successful(await send('/rest/v1/rpc/restore_private_item',{
      ...json(owner),method:'POST',
      body:{p_item_type:'portfolio',p_item_id:trashId}}),'Owner restore');
    await denied(trashId);
    const restored=successful(await send('/rest/v1/rpc/owner_read_private_release_pointer',{
      ...json(owner),method:'POST',body:{p_portfolio_id:trashId}}),'Read restored pointer');
    assert.equal(restored.status,'BLOCKED','Restore cannot reactivate public delivery');
    outage=true;
    for(const resource of ['CANONICAL_HTML','DIRECT_ASSET'])
      assert.equal((await gate.check(request(id,resource))).reason,'PROVIDER_UNAVAILABLE');
    await denied(id);
    outage=false;malformed=true;
    for(const resource of ['CANONICAL_HTML','DIRECT_ASSET'])
      assert.equal((await gate.check(request(id,resource))).reason,'STATE_UNVERIFIED');
    await denied(id);
    malformed=false;
    const before=reads;
    const invalid=await fetch(origin+'/p/'+id+'/releases/'+release+'/assets/not-a-hash.png');
    assert.equal(invalid.status,404);
    assert.equal(reads,before,'Invalid asset path reached private DB');
    const head=await fetch(origin+'/p/'+id+'/',{method:'HEAD'});
    assert.equal(head.status,404);
    assert.equal(await head.text(),'');
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    if(pool)await pool.end();
    if(roleCreated){
      await admin.query('REVOKE EXECUTE ON FUNCTION kadmeion_private.private_delivery_denial_gate(uuid,text,text,text,text) FROM '+role);
      await admin.query('REVOKE USAGE ON SCHEMA kadmeion_private FROM '+role);
      await admin.query('DROP ROLE '+role);
    }
    await admin.end().catch(()=>{});
  }
});


test('B5: real owner inventory snapshots are immutable, bounded and tenant-private',
  {timeout:120_000},async t=>{
  const owner=await adminUser('inventory-owner');
  const outsider=await adminUser('inventory-outsider');
  const create='/rest/v1/rpc/create_private_account_exit_inventory';
  const read='/rest/v1/rpc/get_private_account_exit_inventory';
  const operation=randomUUID();
  const post=(who,path,body)=>send(path,{...json(who),method:'POST',body});
  const initial=successful(await post(owner,create,{
    p_operation_id:operation,p_request_id:null}),'Owner inventory snapshot');
  assert.equal(initial.schemaVersion,1);
  assert.equal(initial.alreadyCaptured,false);
  assert.equal(initial.deletionAllowed,false);
  assert.equal(initial.inventory.status,'METADATA_SNAPSHOT_ONLY');
  assert.equal(initial.inventory.consistency,'SINGLE_STATEMENT_MVCC');
  assert.equal(initial.inventory.publicRoutes,'UNVERIFIED');
  assert.equal(initial.inventory.exports,'NOT_READY');
  assert.equal(initial.inventory.backupRetention,'UNVERIFIED');
  assert.equal(initial.inventory.recentReauthVerified,false);
  assert.equal(initial.inventory.publicRevocationVerified,false);
  assert.equal(initial.inventory.deletionAllowed,false);
  assert.equal(initial.inventory.counts.projects,0);
  await t.test('anonymous, outsider and direct table access cannot read snapshots',async()=>{
    assert.ok(!(await send(create,{method:'POST',headers:{
      'Content-Type':'application/json'},body:{p_operation_id:randomUUID()}})).ok);
    assert.ok(!(await post(outsider,read,{p_snapshot_id:initial.snapshotId})).ok);
    assert.ok(!(await send('/rest/v1/private_account_exit_inventory_snapshots?select=id',
      bearer(owner))).ok);
    assert.ok(!(await send('/rest/v1/private_account_exit_inventory_snapshots',{
      ...json(owner),method:'POST',body:{id:randomUUID(),inventory:{deletionAllowed:true}}
    })).ok);
  });
  await t.test('owner idempotency returns same frozen snapshot after data changes',async()=>{
    successful(await send('/rest/v1/projects?select=id',{
      ...json(owner),method:'POST',
      headers:{'Content-Type':'application/json',Prefer:'return=representation'},
      body:{owner_user_id:owner.id,slug:'inventory-'+randomUUID().slice(0,8),
        title:'Inventory-only test project'}
    }),'Create owner inventory fixture');
    const replay=successful(await post(owner,create,{
      p_operation_id:operation,p_request_id:null}),'Idempotent inventory replay');
    assert.equal(replay.snapshotId,initial.snapshotId);
    assert.equal(replay.alreadyCaptured,true);
    assert.deepEqual(replay.inventory,initial.inventory);
    const fetched=successful(await post(owner,read,{
      p_snapshot_id:initial.snapshotId}),'Read immutable inventory');
    assert.deepEqual(fetched.inventory,initial.inventory);
    const newer=successful(await post(owner,create,{
      p_operation_id:randomUUID(),p_request_id:null}),'New owner inventory');
    assert.equal(newer.inventory.counts.projects,1);
    assert.equal(newer.inventory.deletionAllowed,false);
    const other=successful(await post(outsider,create,{
      p_operation_id:randomUUID(),p_request_id:null}),'Other owner inventory');
    assert.equal(other.inventory.counts.projects,0);
    assert.notEqual(other.snapshotId,initial.snapshotId);
  });
  await t.test('foreign or withdrawn erasure request cannot be attached',async()=>{
    const request=successful(await post(owner,
      '/rest/v1/rpc/request_private_account_erasure',{
        p_operation_id:randomUUID(),p_confirmation:'DELETE MY ACCOUNT'
      }),'Owner request for inventory association');
    assert.ok(!(await post(outsider,create,{
      p_operation_id:randomUUID(),p_request_id:request.requestId})).ok);
    assert.ok(!(await post(owner,create,{
      p_operation_id:operation,p_request_id:request.requestId})).ok,
      'Reused operation was rebound to a different erasure request');
    successful(await post(owner,'/rest/v1/rpc/withdraw_private_account_erasure',{
      p_request_id:request.requestId,p_operation_id:randomUUID()
    }),'Withdraw request before snapshot association');
    assert.ok(!(await post(owner,create,{
      p_operation_id:randomUUID(),p_request_id:request.requestId})).ok,
      'Withdrawn erasure request was attached to inventory');
  });
  await t.test('signed-out JWT cannot create or retrieve inventory',async()=>{
    successful(await send('/auth/v1/logout',{...bearer(owner),method:'POST'}),
      'Inventory owner signout');
    assert.ok(!(await post(owner,create,{
      p_operation_id:randomUUID(),p_request_id:null})).ok);
    assert.ok(!(await post(owner,read,{p_snapshot_id:initial.snapshotId})).ok);
  });
});
