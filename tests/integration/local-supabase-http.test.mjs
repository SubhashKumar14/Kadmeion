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
import {SupabasePrivateAccountErasureService} from '../../packages/contracts/src/private-account-erasure-service.ts';
import {handlePublishedIdentity} from '../../api/published-identity.mjs';
import {handlePublicPortfolio} from '../../api/public-portfolio.mjs';
import {randomBytes} from 'node:crypto';
import {PrivateServerDeliveryDenialGate} from '../../packages/storage-adapters/src/private-delivery-denial-gate.ts';
import {SupabasePrivateAccountDataExporter} from '../../packages/storage-adapters/src/private-account-data-export.ts';
import {PrivateServerAssetByteAttestor} from '../../packages/storage-adapters/src/private-server-asset-byte-attestor.ts';


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
  await t.test('public profile projection requires explicit consent and withdraws on privacy changes', async () => {
    const handle = 'ci_' + randomUUID().slice(0, 8);
    const profilePath = '/rest/v1/profiles?user_id=eq.' + owner.id;
    const sharingPath = '/rest/v1/profile_sharing_preferences';
    const publishPath = '/rest/v1/rpc/owner_publish_profile_projection';
    const readPath = '/rest/v1/rpc/service_read_published_profile_projection';
    const lookup = (credentials = {key: cfg.service, bearer: cfg.service}) => send(readPath, {
      ...credentials, method: 'POST', headers: {'Content-Type': 'application/json'},
      body: {p_handle: handle}
    });
    successful(await send(profilePath, {
      ...json(owner), method: 'PATCH', body: {handle, display_name: 'Visible name', bio: 'Private bio'}
    }), 'Set private profile');
    successful(await send(sharingPath, {
      ...json(owner), method: 'POST',
      body: {user_id: owner.id, publication_requested: true, share_display_name: true}
    }), 'Set profile sharing preferences');
    assert.equal(successful(await lookup(), 'Read prior to explicit publication'), null);
    const publish = (actor, confirmation) => send(publishPath, {
      ...json(actor), method: 'POST', body: {p_confirmation: confirmation}
    });
    assert.equal((await publish(owner, 'PUBLISH')).ok, false);
    assert.equal((await publish(stranger, 'PUBLISH PROFILE')).ok, false);
    assert.deepEqual(successful(await publish(owner, 'PUBLISH PROFILE'), 'Publish selected fields'),
      {status: 'PROJECTION_READY', handle});
    assert.deepEqual(successful(await lookup(), 'Read selected public fields'), {
      handle, displayName: 'Visible name'
    });
    assert.equal((await lookup({bearer: stranger.token})).ok, false);
    assert.equal((await lookup({})).ok, false);
    const ownerPreferences = sharingPath + '?user_id=eq.' + owner.id;
    for (const requested of [false, true]) {
      successful(await send(ownerPreferences, {
        ...json(owner), method: 'PATCH', body: {publication_requested: requested}
      }), 'Change privacy preference');
      assert.equal(successful(await lookup(), 'Read withdrawn profile'), null);
    }
    successful(await publish(owner, 'PUBLISH PROFILE'), 'Republish selected data');
    successful(await send(profilePath, {
      ...json(owner), method: 'PATCH', body: {handle: null}
    }), 'Remove public handle');
    assert.equal(successful(await lookup(), 'Read withdrawn handle'), null);
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
  await t.test('public identity and case-study HTTP routes enforce projection and withdrawal', async t => {
    const actor = await adminUser('publisher');
    const handle = 'public_' + randomUUID().slice(0, 8);
    const slug = 'published-case';
    const server = createServer((req, res) => void handlePublishedIdentity(req, res, {env: {
      KADMEION_PUBLIC_IDENTITY_ENABLED: 'true', KADMEION_LOCAL_INTEGRATION: '1',
      KADMEION_SUPABASE_URL: cfg.origin, KADMEION_SUPABASE_SERVICE_ROLE_KEY: cfg.service
    }}));
    server.listen(0, '127.0.0.1');
    t.after(() => new Promise((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())));
    await once(server, 'listening');
    const origin = 'http://127.0.0.1:' + server.address().port;
    const profileRoute = origin + '/u/' + handle;
    const caseRoute = profileRoute + '/projects/' + slug;
    const call = (name, body, user = actor) => send('/rest/v1/rpc/' + name, {
      ...json(user), method: 'POST', body
    });
    assert.equal((await fetch(profileRoute)).status, 404);
    successful(await send('/rest/v1/profiles?user_id=eq.' + actor.id, {
      ...json(actor), method: 'PATCH', body: {handle, display_name: '<script>name</script>'}
    }), 'Set public identity fixture');
    successful(await send('/rest/v1/profile_sharing_preferences', {
      ...json(actor), method: 'POST',
      body: {user_id: actor.id, publication_requested: true, share_display_name: true}
    }), 'Set profile intent');
    successful(await call('owner_publish_profile_projection', {p_confirmation: 'PUBLISH PROFILE'}), 'Publish profile');
    const identity = await fetch(profileRoute);
    assert.equal(identity.status, 200);
    assert.match(identity.headers.get('cache-control'), /no-store/);
    assert.match(await identity.text(), /&lt;script&gt;name&lt;\/script&gt;/);
    const [project] = successful(await send('/rest/v1/projects?select=id,revision', {
      ...json(actor), method: 'POST', headers: {'Content-Type': 'application/json', Prefer: 'return=representation'},
      body: {owner_user_id: actor.id, slug, title: 'Published case'}
    }), 'Create draft case');
    const revised = successful(await call('update_private_project_case_study', {
      p_project_id: project.id, p_base_revision: project.revision, p_case_study: {sections: [
        {id: 'a', kind: 'challenge', title: 'Visible section', body: 'Visible content', visible: true},
        {id: 'b', kind: 'results', title: 'Hidden section', body: 'Secret notes', visible: false}
      ]}
    }), 'Save private case sections');
    successful(await send('/rest/v1/project_exposure_intents', {
      ...json(actor), method: 'POST',
      body: {project_id: project.id, owner_user_id: actor.id, show_case_study: true}
    }), 'Set case intent');
    assert.equal((await fetch(caseRoute)).status, 404);
    const publication = {p_project_id: project.id, p_expected_revision: revised.revision,
      p_confirmation: 'PUBLISH CASE STUDY'};
    assert.equal((await call('owner_publish_case_study_projection', publication, stranger)).ok, false);
    successful(await call('owner_publish_case_study_projection', publication), 'Publish case');
    const published = await fetch(caseRoute);
    assert.equal(published.status, 200);
    const html = await published.text();
    assert.match(html, /Visible content/);
    assert.doesNotMatch(html, /Secret notes|Hidden section/);
    for (const show_case_study of [false, true]) {
      successful(await send('/rest/v1/project_exposure_intents?project_id=eq.' + project.id, {
        ...json(actor), method: 'PATCH', body: {show_case_study}
      }), 'Change case visibility');
      assert.equal((await fetch(caseRoute)).status, 404);
    }
    successful(await call('owner_publish_case_study_projection', publication), 'Republish case');
    successful(await call('trash_private_item', {p_item_type: 'project', p_item_id: project.id}), 'Trash case');
    assert.equal((await fetch(caseRoute)).status, 404);
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

test('account erasure removes active account data only after fresh owner confirmation', {timeout: 60_000}, async () => {
  const owner = await adminUser('erasure-execute');
  const outsider = await adminUser('erasure-outsider');
  const post = (actor, rpc, body) => send('/rest/v1/rpc/' + rpc, {
    ...json(actor), method: 'POST', body
  });
  const request = successful(await post(owner, 'request_private_account_erasure', {
    p_operation_id: randomUUID(), p_confirmation: 'DELETE MY ACCOUNT'
  }), 'Request account erasure');
  const challenge = successful(await post(owner, 'begin_private_account_exit_reauth', {
    p_operation_id: randomUUID()
  }), 'Begin account erasure proof');
  const inputs = {p_request_id: request.requestId, p_challenge_id: challenge.challengeId,
    p_confirmation: 'DELETE MY ACCOUNT'};
  const objectPath = '/storage/v1/object/' + bucket + '/' + owner.id + '/exit/test.png';
  successful(await send(objectPath, {
    ...bearer(owner), method: 'POST', body: png, headers: {'Content-Type': 'image/png'}
  }), 'Upload account-exit fixture');
  const execute = (actor, args = inputs) => post(actor, 'owner_execute_account_erasure', args);
  assert.equal((await execute(outsider)).ok, false);
  assert.equal((await execute(owner)).data?.message, 'ERASURE_REAUTH_REQUIRED');
  const login = successful(await send('/auth/v1/token?grant_type=password', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: {email: owner.email, password: owner.password}
  }), 'New erasure session');
  const fresh = {...owner, token: login.access_token};
  successful(await post(fresh, 'complete_private_account_exit_reauth', {
    p_challenge_id: challenge.challengeId
  }), 'Verify account erasure sign-in');
  assert.equal((await execute(fresh, {...inputs, p_confirmation: 'DELETE'})).ok, false);
  assert.equal((await execute(fresh)).data?.message, 'ERASURE_STORAGE_CLEANUP_REQUIRED');
  await send(objectPath, {...bearer(outsider), method: 'DELETE'});
  assert.equal((await execute(fresh)).data?.message, 'ERASURE_STORAGE_CLEANUP_REQUIRED');
  await send(objectPath, {...bearer(owner), method: 'DELETE'});
  assert.equal((await execute(fresh)).data?.message, 'ERASURE_STORAGE_CLEANUP_REQUIRED');
  const service = new SupabasePrivateAccountErasureService(cfg.origin, cfg.anon, async () => fresh.token);
  assert.equal(await service.removeUploadBatch(), 1);
  assert.equal(await service.removeUploadBatch(), 0);
  const receipt = await service.execute(request.requestId, challenge.challengeId, 'DELETE MY ACCOUNT');
  assert.equal(receipt.status, 'ACTIVE_ACCOUNT_ERASED');
  assert.equal(receipt.accessTerminated, true);
  assert.equal(receipt.backupErasureVerified, false);
  assert.equal(receipt.externalCopiesErased, false);
  assert.match(receipt.receiptId, /^[0-9a-f-]{36}$/i);
  assert.equal((await execute(fresh)).ok, false);
  assert.equal((await send('/auth/v1/user', bearer(fresh))).ok, false);
  assert.equal((await send('/auth/v1/user', bearer(outsider))).ok, true);
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
  const auditRpc='/rest/v1/rpc/read_private_account_audit_export';
  const audit=successful(await post(owner,auditRpc,{p_snapshot_id:initial.snapshotId}),
    'Owner restricted audit export');
  assert.equal(audit.status,'BOUNDED_OWNER_AUDIT');
  assert.equal(audit.ownerUserId,owner.id);
  assert.equal(audit.snapshotId,initial.snapshotId);
  assert.equal(audit.maxRowsPerCategory,100);
  assert.equal(audit.tokenDigestsIncluded,false);
  assert.equal(audit.sessionsIncluded,false);
  assert.equal(audit.completeAccountExport,false);
  assert.equal(audit.deletionAllowed,false);
  assert.equal(Object.keys(audit.categories).length,8);
  assert.ok(!(await post(outsider,auditRpc,{p_snapshot_id:initial.snapshotId})).ok);
  assert.ok(!(await send(auditRpc,{method:'POST',
    body:{p_snapshot_id:initial.snapshotId},
    headers:{'Content-Type':'application/json'}})).ok);
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


test('B5: Storage reconciliation is owner-only and never proves export or erasure',
  {timeout:120_000},async t=>{
  const owner=await adminUser('storage-reconcile-owner');
  const outsider=await adminUser('storage-reconcile-outsider');
  const rpc='/rest/v1/rpc/reconcile_private_account_exit_storage';
  const post=(who,path,body)=>send(path,{...json(who),method:'POST',body});
  const snapshot=successful(await post(owner,
    '/rest/v1/rpc/create_private_account_exit_inventory',{
      p_operation_id:randomUUID(),p_request_id:null
    }),'Owner inventory for Storage reconciliation');
  const input={p_snapshot_id:snapshot.snapshotId};
  const initial=successful(await post(owner,rpc,input),'Empty Storage reconciliation');
  assert.equal(initial.snapshotId,snapshot.snapshotId);
  assert.equal(initial.status,'METADATA_MATCH_ONLY');
  assert.equal(initial.registeredAssets,0);
  assert.equal(initial.storageObjects,0);
  assert.equal(initial.inventoryDrift,false);
  for(const key of ['storageBytesVerified','downloadableExportReady',
    'publicRevocationVerified','deletionAllowed'])assert.equal(initial[key],false);
  assert.equal(initial.externalProviders,'UNVERIFIED');
  assert.equal(initial.backupRetention,'UNVERIFIED');

  await t.test('anonymous, foreign snapshot and invalid ID are denied',async()=>{
    assert.ok(!(await send(rpc,{method:'POST',headers:{
      'Content-Type':'application/json'},body:input})).ok);
    assert.ok(!(await post(outsider,rpc,input)).ok);
    assert.ok(!(await post(owner,rpc,{p_snapshot_id:randomUUID()})).ok);
    assert.ok(!(await post(owner,rpc,{p_snapshot_id:null})).ok);
  });

  const path=owner.id+'/reconcile-'+randomUUID().slice(0,8)+'/cover.png';
  successful(await send('/storage/v1/object/'+bucket+'/'+path,{
    ...bearer(owner),method:'POST',headers:{'Content-Type':'image/png'},body:png
  }),'Owner orphan private Storage upload');
  const orphan=successful(await post(owner,rpc,input),'Orphan Storage detection');
  assert.equal(orphan.status,'DISCREPANCY');
  assert.equal(orphan.registeredAssets,0);
  assert.equal(orphan.storageObjects,1);
  assert.equal(orphan.orphanObjects,1);
  assert.equal(orphan.downloadableExportReady,false);

  const project=successful(await send('/rest/v1/projects?select=id',{
    ...json(owner),method:'POST',
    headers:{'Content-Type':'application/json',Prefer:'return=representation'},
    body:{owner_user_id:owner.id,slug:'reconcile-'+randomUUID().slice(0,8),
      title:'Private Storage reconciliation fixture'}
  }),'Owner project for asset reconciliation')[0];
  successful(await post(owner,'/rest/v1/rpc/register_private_project_image',{
    p_project_id:project.id,p_object_path:path,p_mime_type:'image/png',
    p_byte_size:png.length,p_alt_text:'Private test pixel'
  }),'Register real private Storage object');
  const tamper=await send('/rest/v1/project_assets?object_path=eq.'+
    encodeURIComponent(path),{
    ...json(owner),method:'PATCH',body:{byte_size:png.length+1}
  });
  assert.ok(!tamper.ok,'Owner altered verified asset byte size without Storage proof');
  const matched=successful(await post(owner,rpc,input),'Registered Storage metadata match');
  assert.equal(matched.status,'METADATA_MATCH_ONLY');
  assert.equal(matched.registeredAssets,1);
  assert.equal(matched.storageObjects,1);
  assert.equal(matched.missingObjects,0);
  assert.equal(matched.orphanObjects,0);
  assert.equal(matched.metadataMismatches,0);
  assert.equal(matched.inventoryDrift,true,
    'A prior inventory snapshot must not be represented as atomic with new assets');
  assert.equal(matched.storageBytesVerified,false);
  assert.equal(matched.downloadableExportReady,false);
  assert.equal(matched.deletionAllowed,false);
  const otherSnapshot=successful(await post(outsider,
    '/rest/v1/rpc/create_private_account_exit_inventory',{
      p_operation_id:randomUUID(),p_request_id:null
    }),'Other owner snapshot');
  const other=successful(await post(outsider,rpc,{
    p_snapshot_id:otherSnapshot.snapshotId
  }),'Other owner reconciliation');
  assert.equal(other.registeredAssets,0);
  assert.equal(other.storageObjects,0);
  assert.equal(other.status,'METADATA_MATCH_ONLY');
  await t.test('signed-out JWT cannot reconcile even a previously owned snapshot',async()=>{
    successful(await send('/auth/v1/logout',{...bearer(owner),method:'POST'}),
      'Reconciliation owner logout');
    assert.ok(!(await post(owner,rpc,input)).ok);
  });
});


test('B5: real local owner export reads RLS records and verifies private Storage bytes',
  {timeout:120_000},async()=>{
  const owner=await adminUser('byte-export-owner');
  const outsider=await adminUser('byte-export-outsider');
  const project=successful(await send('/rest/v1/projects?select=id',{
    ...json(owner),method:'POST',
    headers:{'Content-Type':'application/json',Prefer:'return=representation'},
    body:{owner_user_id:owner.id,slug:'export-'+randomUUID().slice(0,8),
      title:'Private byte export fixture'}
  }),'Owner export project')[0];
  const path=owner.id+'/export-'+randomUUID().slice(0,8)+'/cover.png';
  successful(await send('/storage/v1/object/'+bucket+'/'+path,{
    ...bearer(owner),method:'POST',headers:{'Content-Type':'image/png'},body:png
  }),'Owner export image upload');
  successful(await send('/rest/v1/rpc/register_private_project_image',{
    ...json(owner),method:'POST',body:{
      p_project_id:project.id,p_object_path:path,p_mime_type:'image/png',
      p_byte_size:png.length,p_alt_text:'Export test pixel'
    }
  }),'Owner export image registration');
  const registered=successful(await send('/rest/v1/project_assets?select=id&object_path=eq.'+
    encodeURIComponent(path),bearer(owner)),'Registered asset lookup');
  assert.equal(registered.length,1);
  const attestor=new PrivateServerAssetByteAttestor(cfg.origin,cfg.anon,cfg.service);
  assert.deepEqual(await attestor.attest(registered[0].id,owner.token),
    {assetId:registered[0].id,status:'WRITE_ONCE_ATTESTED'});
  const directForged=await send('/rest/v1/rpc/record_private_asset_content_attestation',{
    ...json(owner),method:'POST',body:{p_asset_id:registered[0].id,
      p_storage_object_id:randomUUID(),p_storage_version:'fake',
      p_expected_sha256:'0'.repeat(64)}
  });
  assert.ok(!directForged.ok,'Owner invoked service-only digest writer');
  const snapshot=successful(await send(
    '/rest/v1/rpc/create_private_account_exit_inventory',{
      ...json(owner),method:'POST',
      body:{p_operation_id:randomUUID(),p_request_id:null}
    }),'Inventory after asset registration');
  const attestation=successful(await send(
    '/rest/v1/rpc/read_private_asset_content_attestations',{
      ...json(owner),method:'POST',body:{p_snapshot_id:snapshot.snapshotId}
    }),'Owner live-session digest read');
  assert.equal(attestation.status,'SERVER_HASH_PINNED');
  assert.equal(attestation.registeredAssets,1);
  assert.equal(attestation.attestations.length,1);
  assert.equal(attestation.attestations[0].expectedSha256,
    createHash('sha256').update(png).digest('hex'));
  assert.deepEqual(await attestor.attest(registered[0].id,owner.token),
    {assetId:registered[0].id,status:'WRITE_ONCE_ATTESTED'},
    'Identical trusted attestation must be idempotent');
  const conflicting=await send('/rest/v1/rpc/record_private_asset_content_attestation',{
    method:'POST',key:cfg.service,bearer:cfg.service,
    headers:{'Content-Type':'application/json'},
    body:{p_asset_id:registered[0].id,
      p_storage_object_id:attestation.attestations[0].objectId,
      p_storage_version:attestation.attestations[0].version,
      p_expected_sha256:'0'.repeat(64)}
  });
  assert.ok(!conflicting.ok,'A second privileged digest overwrote the immutable pin');
  const foreignPin=await send('/rest/v1/rpc/read_private_asset_content_attestations',{
    ...json(outsider),method:'POST',body:{p_snapshot_id:snapshot.snapshotId}
  });
  assert.ok(!foreignPin.ok,'Other tenant read trusted asset digest');
  const info=successful(await send(
    '/storage/v1/object/info/authenticated/'+bucket+'/'+path,bearer(owner)),
    'Owner private Storage info');
  const infoChecks={
    id:typeof info.id==='string'&&/^[0-9a-f-]{36}$/i.test(info.id),
    name:info.name===path,bucket:info.bucket_id===bucket,
    owner:info.owner_id===undefined||info.owner_id===owner.id,
    version:typeof info.version==='string'&&info.version.length>0,
    updatedAt:typeof (info.last_modified??info.updated_at)==='string',
    metadata:Number(info.size??info.metadata?.size)===png.length&&
      String(info.content_type??info.metadata?.mimetype).toLowerCase()==='image/png'
  };
  assert.ok(Object.values(infoChecks).every(Boolean),
    'Storage info contract mismatch fields: '+
      Object.entries(infoChecks).filter(([,valid])=>!valid).map(([key])=>key).join(',')+
      '; keys: '+Object.keys(info).sort().join(','));
  const exporter=new SupabasePrivateAccountDataExporter(cfg.origin,cfg.anon,
    async()=>owner.token);
  const artifact=await exporter.export(snapshot.snapshotId);
  assert.equal(artifact.status,'BOUNDED_PARTIAL_EXPORT');
  assert.equal(artifact.deletionAllowed,false);
  const body=JSON.parse(new TextDecoder().decode(artifact.bytes));
  assert.equal(body.owner.id,owner.id);
  assert.ok(body.records.projects.some(p=>p.id===project.id));
  assert.equal(body.assets.length,1);
  assert.equal(body.assets[0].path,path);
  assert.equal(body.assets[0].byteSize,png.length);
  assert.equal(body.assets[0].downloadedSha256,createHash('sha256').update(png).digest('hex'));
  assert.deepEqual(Buffer.from(body.assets[0].base64,'base64'),Buffer.from(png));
  assert.equal(body.evidence.providerExpectedHashesVerified,false);
  assert.equal(body.evidence.providerObjectVersionPinned,false);
  assert.equal(body.evidence.storageObjectVersionCheckedBeforeAndAfter,true);
  assert.ok(typeof body.assets[0].storageVersionAtRead==='string'&&
    body.assets[0].storageVersionAtRead.length>0);
  assert.equal(body.limitations.completeAccountExport,false);
  const ownerOverwrite=await send('/storage/v1/object/'+bucket+'/'+path,{
    ...bearer(owner),method:'PUT',
    headers:{'Content-Type':'image/png'},body:png
  });
  assert.ok(!ownerOverwrite.ok,'Owner overwrote a registered private object path');
  const foreignExporter=new SupabasePrivateAccountDataExporter(cfg.origin,cfg.anon,
    async()=>outsider.token);
  await assert.rejects(foreignExporter.export(snapshot.snapshotId),{code:'AUTH_EXPIRED'});
  successful(await send('/auth/v1/logout',{...bearer(owner),method:'POST'}),
    'Export owner logout');
  await assert.rejects(exporter.export(snapshot.snapshotId),{code:'AUTH_EXPIRED'});
});

test('B5: real local same-size provider overwrite during export fails version recheck',
  {timeout:120_000},async()=>{
  const owner=await adminUser('export-race-owner');
  const project=successful(await send('/rest/v1/projects?select=id',{
    ...json(owner),method:'POST',
    headers:{'Content-Type':'application/json',Prefer:'return=representation'},
    body:{owner_user_id:owner.id,slug:'race-'+randomUUID().slice(0,8),
      title:'Storage overwrite race fixture'}
  }),'Create owner race project')[0];
  const path=owner.id+'/race-'+randomUUID().slice(0,8)+'/cover.png';
  successful(await send('/storage/v1/object/'+bucket+'/'+path,{
    ...bearer(owner),method:'POST',headers:{'Content-Type':'image/png'},body:png
  }),'Upload initial owner image');
  successful(await send('/rest/v1/rpc/register_private_project_image',{
    ...json(owner),method:'POST',body:{
      p_project_id:project.id,p_object_path:path,p_mime_type:'image/png',
      p_byte_size:png.length,p_alt_text:'Race fixture'
    }
  }),'Register race image');
  const raceAssets=successful(await send('/rest/v1/project_assets?select=id&object_path=eq.'+
    encodeURIComponent(path),bearer(owner)),'Race asset lookup');
  assert.equal(raceAssets.length,1);
  await new PrivateServerAssetByteAttestor(cfg.origin,cfg.anon,cfg.service)
    .attest(raceAssets[0].id,owner.token);
  const snapshot=successful(await send(
    '/rest/v1/rpc/create_private_account_exit_inventory',{
      ...json(owner),method:'POST',
      body:{p_operation_id:randomUUID(),p_request_id:null}
    }),'Capture race inventory');
  let replaced=false;
  const intercept=async(input,init)=>{
    if(!replaced&&String(input).includes('/storage/v1/object/authenticated/')){
      replaced=true;
      const changed=new Uint8Array(png);
      changed[changed.length-1]^=1; // Same MIME/length, different bytes.
      successful(await send('/storage/v1/object/'+bucket+'/'+path,{
        method:'PUT',key:cfg.service,bearer:cfg.service,
        headers:{'Content-Type':'image/png'},body:changed
      }),'Local service-role fixture overwrite');
    }
    return fetch(input,init);
  };
  const exporter=new SupabasePrivateAccountDataExporter(cfg.origin,cfg.anon,
    async()=>owner.token,intercept);
  await assert.rejects(exporter.export(snapshot.snapshotId),{code:'INTEGRITY'});
  assert.equal(replaced,true,'Fixture did not exercise provider overwrite');
});


test('B4/B6: local real HTTP public release is revoked after owner project privacy withdrawal',
  {timeout:120_000},async()=>{
  const owner=await adminUser('privacy-transport');
  const handle='ci_'+randomUUID().slice(0,8);
  const slug='release-'+randomUUID().slice(0,8);
  successful(await send('/rest/v1/profiles?user_id=eq.'+owner.id,{
    ...json(owner),method:'PATCH',body:{handle}
  }),'Set release owner handle');
  const project=successful(await send('/rest/v1/projects?select=id',{
    ...json(owner),method:'POST',
    headers:{'Content-Type':'application/json',Prefer:'return=representation'},
    body:{owner_user_id:owner.id,slug:'privacy-'+randomUUID().slice(0,8),
      title:'Privacy-dependent public release'}
  }),'Create project')[0];
  const portfolio=successful(await send('/rest/v1/portfolios?select=id',{
    ...json(owner),method:'POST',
    headers:{'Content-Type':'application/json',Prefer:'return=representation'},
    body:{owner_user_id:owner.id,slug,title:'Private release dependency',template_id:'starter'}
  }),'Create portfolio')[0];
  successful(await send('/rest/v1/project_exposure_intents?select=project_id',{
    ...json(owner),method:'POST',
    headers:{'Content-Type':'application/json',Prefer:'return=representation'},
    body:{project_id:project.id,owner_user_id:owner.id,
      show_on_profile:true,show_case_study:true}
  }),'Create explicit project exposure');

  const env=execFileSync('supabase',['status','-o','env'],{
    encoding:'utf8',timeout:20_000});
  const match=env.match(/^(?:export )?DB_URL=(.+)$/m);
  assert.ok(match,'Local SQL fixture URL is missing');
  const db=new URL(match[1].trim().replace(/^["']|["']$/g,''));
  assert.equal(db.protocol,'postgresql:');
  assert.ok(['127.0.0.1','localhost'].includes(db.hostname));
  assert.equal(db.port,'54322');
  assert.equal(db.username,'postgres');
  const pg=new Client({host:db.hostname,port:Number(db.port),database:'postgres',
    user:'postgres',password:decodeURIComponent(db.password),ssl:false});

  const operation=randomUUID(),requestId=randomUUID(),intentId=randomUUID();
  const html='<!doctype html><html><head>'+
    '<meta name="robots" content="noindex,nofollow,noarchive"></head>'+
    '<body><h1>Privacy dependent HTML</h1></body></html>';
  const digest=createHash('sha256').update(html).digest('hex');
  const manifest='a'.repeat(64),params=[portfolio.id,owner.id,requestId];
  let server;
  try{
    await pg.connect();
    await pg.query('BEGIN');
    await pg.query('UPDATE public.portfolios SET head_revision=1 WHERE id=$1::uuid',[portfolio.id]);
    await pg.query(
      'INSERT INTO public.portfolio_revisions(portfolio_id,owner_user_id,revision,base_revision,operation_id,snapshot,snapshot_sha256) '+
      'VALUES($1::uuid,$2::uuid,1,0,$3::uuid,$4::jsonb,encode(sha256(convert_to(($4::jsonb)::text,\'UTF8\')),\'hex\'))',
      [portfolio.id,owner.id,randomUUID(),
        JSON.stringify({formatVersion:1,files:{},slots:{},stashes:{}})]);
    await pg.query(
      'INSERT INTO public.private_release_requests(id,portfolio_id,owner_user_id,operation_id,revision,snapshot_sha256,visibility_intent) '+
      'SELECT $3::uuid,portfolio_id,owner_user_id,$4::uuid,1,snapshot_sha256,\'PUBLIC\' '+
      'FROM public.portfolio_revisions WHERE portfolio_id=$1::uuid AND owner_user_id=$2::uuid',
      [...params,operation]);
    await pg.query(
      'INSERT INTO public.private_release_visibility_pointers(portfolio_id,owner_user_id,status,candidate_request_id,candidate_manifest_sha256,generation,revocation_generation) '+
      'VALUES($1::uuid,$2::uuid,\'PREPARED_PRIVATE\',$3::uuid,$4,1,0)',
      [...params,manifest]);
    await pg.query(
      'INSERT INTO kadmeion_private.private_artifact_bindings(portfolio_id,owner_user_id,request_id,pointer_generation,manifest_sha256,html_sha256,html_byte_length) '+
      'VALUES($1::uuid,$2::uuid,$3::uuid,1,$4,$5,$6)',
      [...params,manifest,digest,Buffer.byteLength(html)]);
    await pg.query(
      'INSERT INTO kadmeion_private.private_reviewer_stage_artifacts(portfolio_id,owner_user_id,request_id,pointer_generation,html,html_sha256) '+
      'VALUES($1::uuid,$2::uuid,$3::uuid,1,$4,$5)',
      [...params,html,digest]);
    await pg.query(
      'INSERT INTO public.private_unlisted_publication_intents(id,portfolio_id,owner_user_id,request_id,operation_id,expected_pointer_generation,public_handle,public_slug,status) '+
      'VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,1,$6,$7,\'USED\')',
      [intentId,...params,randomUUID(),handle,slug]);
    await pg.query(
      'INSERT INTO kadmeion_private.unlisted_release_routes(portfolio_id,owner_user_id,request_id,intent_id,stage_generation,release_generation,status,verified_at,html_sha256) '+
      'VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,1,1,\'LIVE\',transaction_timestamp(),$5)',
      [...params,intentId,digest]);
    await pg.query('COMMIT');

    const runtime={KADMEION_LOCAL_INTEGRATION:'1',
      KADMEION_PUBLIC_PORTFOLIO_ENABLED:'true',
      KADMEION_SUPABASE_URL:cfg.origin,
      KADMEION_SUPABASE_SERVICE_ROLE_KEY:cfg.service};
    server=createServer((req,res)=>void handlePublicPortfolio(req,res,{env:runtime}));
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    const address='http://127.0.0.1:'+server.address().port+
      '/api/public-portfolio?handle='+handle+'&slug='+slug;
    const read=()=>fetch(address,{redirect:'error',cache:'no-store',
      signal:AbortSignal.timeout(5000)});
    const before=await read();
    assert.equal(before.status,200);
    assert.match(await before.text(),/Privacy dependent HTML/);
    assert.equal(before.headers.get('cache-control'),'private, no-store');

    const withdrawal=successful(await send(
      '/rest/v1/project_exposure_intents?project_id=eq.'+project.id+
      '&select=show_case_study',{
        ...json(owner),method:'PATCH',
        headers:{'Content-Type':'application/json',Prefer:'return=representation'},
        body:{show_case_study:false}
      }),'Owner project visibility withdrawal');
    assert.equal(withdrawal.length,1);
    assert.equal(withdrawal[0].show_case_study,false);
    const after=await read();
    assert.equal(after.status,404,'Withdrawal failed to revoke old immutable HTML');
    assert.equal(await after.text(),'Not found');
    assert.equal(after.headers.get('x-robots-tag'),'noindex');
    const current=successful(await send('/rest/v1/rpc/service_read_public_portfolio',{
      method:'POST',key:cfg.service,bearer:cfg.service,
      headers:{'Content-Type':'application/json'},
      body:{p_handle:handle,p_slug:slug}
    }),'Trusted current public projection read');
    assert.equal(current,null);
    const status=await pg.query(
      'SELECT p.status,p.revocation_generation,r.status AS route_status '+
      'FROM public.private_release_visibility_pointers p '+
      'JOIN kadmeion_private.unlisted_release_routes r ON r.portfolio_id=p.portfolio_id '+
      'WHERE p.portfolio_id=$1::uuid',[portfolio.id]);
    assert.equal(status.rows.length,1);
    assert.equal(status.rows[0].status,'BLOCKED');
    assert.equal(status.rows[0].route_status,'REVOKED');
    assert.equal(Number(status.rows[0].revocation_generation),2);
    const events=await pg.query(
      'SELECT event_type FROM public.private_release_visibility_events '+
      'WHERE portfolio_id=$1::uuid AND event_type=\'PROJECT_PRIVACY_BLOCK\'',[portfolio.id]);
    assert.equal(events.rows.length,1);
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    await pg.end().catch(()=>{});
  }
});


test('P2: real owner-JWT goals, manual correction history and milestones remain tenant-private',
  {timeout:120_000},async()=>{
  const owner=await adminUser('private-goal-owner');
  const outsider=await adminUser('private-goal-outsider');
  const operation=randomUUID();
  const goalBody={operation_id:operation,title:'Practice database design',
    description:'Manual progress only',target_value:30,unit:'sessions',
    due_on:'2027-03-01'};
  const create=successful(await send('/rest/v1/private_goals?select=*',{
    ...json(owner),method:'POST',
    headers:{'Content-Type':'application/json',Prefer:'return=representation'},
    body:goalBody
  }),'Owner goal creation');
  assert.equal(create.length,1);
  const goal=create[0];
  assert.equal(goal.owner_user_id,owner.id);
  assert.equal(goal.status,'ACTIVE');
  assert.equal(goal.operation_id,operation);
  const duplicate=await send('/rest/v1/private_goals',{
    ...json(owner),method:'POST',body:goalBody
  });
  assert.equal(duplicate.status,409,'Repeated operation must not silently insert another goal');
  assert.deepEqual(successful(await send(
    '/rest/v1/private_goals?select=id',bearer(outsider)),
    'Foreign goal list'),[]);
  const anonymous=await send('/rest/v1/private_goals?select=id');
  assert.ok(!anonymous.ok,'Anonymous visitor enumerated private goals');
  const forge=await send('/rest/v1/private_goals',{
    ...json(outsider),method:'POST',body:{...goalBody,
      operation_id:randomUUID(),owner_user_id:owner.id}
  });
  assert.ok(!forge.ok,'Foreign user supplied a forged goal owner ID');

  for(const [value,note] of [[5,'Five sessions'],[4,'Corrected manual count']]){
    const row=successful(await send('/rest/v1/private_goal_progress_events?select=*',{
      ...json(owner),method:'POST',
      headers:{'Content-Type':'application/json',Prefer:'return=representation'},
      body:{goal_id:goal.id,operation_id:randomUUID(),value,note}
    }),'Append owner manual progress');
    assert.equal(row.length,1);
    assert.equal(row[0].source,'MANUAL');
    assert.equal(row[0].value,value);
  }
  const spoof=await send('/rest/v1/private_goal_progress_events',{
    ...json(owner),method:'POST',
    body:{goal_id:goal.id,operation_id:randomUUID(),value:999,
      source:'VERIFIED_EXTERNAL'}
  });
  assert.ok(!spoof.ok,'Owner forged verified-provider provenance');
  const foreignEvent=await send('/rest/v1/private_goal_progress_events',{
    ...json(outsider),method:'POST',
    body:{goal_id:goal.id,operation_id:randomUUID(),value:1}
  });
  assert.ok(!foreignEvent.ok,'Foreign user appended progress to another goal');
  const progress=successful(await send(
    '/rest/v1/private_goal_progress_events?select=source,value&goal_id=eq.'+goal.id,
    bearer(owner)),'Read correction history');
  assert.equal(progress.length,2);
  assert.ok(progress.every(row=>row.source==='MANUAL'));
  assert.deepEqual(successful(await send(
    '/rest/v1/private_goal_progress_events?select=id',bearer(outsider)),
    'Foreign progress list'),[]);

  const milestones=successful(await send('/rest/v1/private_goal_milestones?select=*',{
    ...json(owner),method:'POST',
    headers:{'Content-Type':'application/json',Prefer:'return=representation'},
    body:{goal_id:goal.id,operation_id:randomUUID(),title:'Finish join exercises'}
  }),'Add private goal milestone');
  assert.equal(milestones.length,1);
  const milestone=milestones[0];
  assert.equal(milestone.owner_user_id,owner.id);
  const updated=successful(await send(
    '/rest/v1/private_goal_milestones?id=eq.'+milestone.id+'&select=id,completed_at',{
      ...json(owner),method:'PATCH',
      headers:{'Content-Type':'application/json',Prefer:'return=representation'},
      body:{completed_at:new Date().toISOString()}
    }),'Mark milestone done manually');
  assert.equal(updated.length,1);
  assert.ok(typeof updated[0].completed_at==='string');
  const foreignUpdate=await send('/rest/v1/private_goal_milestones?id=eq.'+milestone.id+
      '&select=id',{
    ...json(outsider),method:'PATCH',
    headers:{'Content-Type':'application/json',Prefer:'return=representation'},
    body:{title:'Hijacked'}
  });
  assert.deepEqual(successful(foreignUpdate,'Foreign milestone update'),[]);
  const deleted=successful(await send('/rest/v1/private_goals?id=eq.'+goal.id+
      '&select=id',{
    ...json(owner),method:'DELETE',
    headers:{Prefer:'return=representation'}
  }),'Owner remove goal');
  assert.equal(deleted.length,1);
  assert.equal(deleted[0].id,goal.id);
  assert.deepEqual(successful(await send('/rest/v1/private_goal_progress_events?select=id',
    bearer(owner)),'Deleted progress cascade'),[]);
  assert.deepEqual(successful(await send('/rest/v1/private_goal_milestones?select=id',
    bearer(owner)),'Deleted milestone cascade'),[]);
});


test('P2: real JWT link-only public profile handles never become foreign-visible or provider-verified',
  {timeout:120_000},async()=>{
  const owner=await adminUser('platform-owner'),stranger=await adminUser('platform-stranger');
  const providers=[
    ['GITHUB','Owner-Name','https://github.com/Owner-Name'],
    ['LEETCODE','owner_name','https://leetcode.com/u/owner_name'],
    ['CODEFORCES','CF.Handle','https://codeforces.com/profile/CF.Handle'],
    ['HACKERRANK','owner_name','https://www.hackerrank.com/profile/owner_name'],
    ['KAGGLE','owner_name','https://www.kaggle.com/owner_name'],
    ['HUGGING_FACE','Owner-Name','https://huggingface.co/Owner-Name']
  ];
  for(const [provider,handle,url] of providers){
    const rows=successful(await send('/rest/v1/private_platform_links?select=*',{
      ...json(owner),method:'POST',
      headers:{'Content-Type':'application/json',Prefer:'return=representation'},
      body:{provider,handle}
    }),'Create private link-only '+provider);
    assert.equal(rows.length,1);
    const [row]=rows;
    assert.equal(row.owner_user_id,owner.id);
    assert.equal(row.provider,provider);
    assert.equal(row.handle,handle);
    assert.equal(row.profile_url,url);
    assert.equal(row.provenance,'USER_SUPPLIED');
    assert.equal(row.connection_mode,'LINK_ONLY');
    assert.equal(row.sync_status,'NOT_SYNCED');
    assert.equal(row.ownership_verified,false);
  }
  const all=successful(await send('/rest/v1/private_platform_links?select=*',
    bearer(owner)),'Read all six private links');
  assert.equal(all.length,6);
  assert.deepEqual(successful(await send(
    '/rest/v1/private_platform_links?select=id',bearer(stranger)),
    'Foreign platform link read'),[]);
  const anonymous=await send('/rest/v1/private_platform_links?select=id');
  assert.ok(!anonymous.ok,'Anonymous visitor enumerated private platform links');
  const forgedOwner=await send('/rest/v1/private_platform_links',{
    ...json(stranger),method:'POST',body:{
      provider:'GITHUB',handle:'wrong-owner',owner_user_id:owner.id}
  });
  assert.ok(!forgedOwner.ok,'Foreign account forged a platform link under owner ID');
  const spoof=await send('/rest/v1/private_platform_links',{
    ...json(owner),method:'POST',
    body:{provider:'GITHUB',handle:'Owner-Name',ownership_verified:true,
      sync_status:'SYNCED',profile_url:'https://attacker.invalid'}
  });
  assert.ok(!spoof.ok,'User supplied immutable provider-evidence columns');
  const patchForeign=await send(
    '/rest/v1/private_platform_links?provider=eq.GITHUB&select=id',{
      ...json(stranger),method:'PATCH',
      headers:{'Content-Type':'application/json',Prefer:'return=representation'},
      body:{handle:'hijacked'}
    });
  assert.deepEqual(successful(patchForeign,'Foreign platform edit'),[]);
  const patch=successful(await send(
    '/rest/v1/private_platform_links?provider=eq.GITHUB&select=*',{
      ...json(owner),method:'PATCH',
      headers:{'Content-Type':'application/json',Prefer:'return=representation'},
      body:{handle:'Updated-Name'}
    }),'Owner updates private link');
  assert.equal(patch.length,1);
  assert.equal(patch[0].profile_url,'https://github.com/Updated-Name');
  const deleted=successful(await send(
    '/rest/v1/private_platform_links?provider=eq.GITHUB&select=id',{
      ...json(owner),method:'DELETE',headers:{Prefer:'return=representation'}
    }),'Owner disconnects one profile');
  assert.equal(deleted.length,1);
  assert.equal(successful(await send('/rest/v1/private_platform_links?select=id',
    bearer(owner)),'Five remaining links').length,5);
});
