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
import {SupabasePortfolioRevisionStore} from '../../packages/storage-adapters/src/supabase-portfolio-revisions.ts';
import {SupabaseMyComponentsService} from '../../packages/contracts/src/private-my-components-service.ts';
import {SupabasePrivateGoalsService} from '../../packages/contracts/src/private-goals-service.ts';
import {SupabasePrivateNotificationsService} from '../../packages/contracts/src/private-notifications-service.ts';
import {SupabasePrivateIdentityService} from '../../packages/contracts/src/private-identity-service.ts';


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

// C08 migration and all client consumers must be composed atomically; no legacy writer fallback.
const preferenceRpc=(actor,name,body={})=>send('/rest/v1/rpc/'+name,{...json(actor),method:'POST',body});
async function setPreferenceFixture(actor,domain,desired){
  const readName=domain==='notification'?'read_owner_notification_preferences_state':'read_owner_profile_sharing_state';
  const changeName=domain==='notification'?'change_owner_notification_preferences':'change_owner_profile_sharing';
  const current=successful(await preferenceRpc(actor,readName),'Read authoritative C08 preference fixture');
  assert.equal(current.ownerUserId,actor.id);
  assert.ok(Number.isSafeInteger(current.version));
  return preferenceRpc(actor,changeName,{p_expected_version:current.version,p_expected:current.preferences,
    p_desired:desired,p_operation_id:randomUUID()});
}
const visibleSharing={shareDisplayName:true,shareHeadline:false,shareBio:false,publicationRequested:true};

test('B3: a private preset initializes a real first revision once under owner RLS',{timeout:60_000},async()=>{
  const owner=await adminUser('preset-owner');
  const outsider=await adminUser('preset-outsider');
  const ownStore=new SupabasePortfolioRevisionStore(cfg.origin,cfg.anon,async()=>owner.token);
  const otherStore=new SupabasePortfolioRevisionStore(cfg.origin,cfg.anon,async()=>outsider.token);
  const id=await ownStore.createPrivatePortfolio(owner.id,{
    slug:'preset-'+randomUUID().slice(0,8),title:'Preset fixture',templateId:'collage'
  });
  const operationId=randomUUID();
  await assert.rejects(otherStore.initializePreset(id,operationId,'collage'),{code:'VALIDATION'});
  await assert.rejects(ownStore.initializePreset(id,operationId,'arc'),{code:'VALIDATION'});
  const first=await ownStore.initializePreset(id,operationId,'collage');
  assert.equal(first.revision,1);
  assert.equal((await ownStore.initializePreset(id,operationId,'collage')).alreadyCommitted,true);
  const {revision,snapshot}=await ownStore.loadHead(id);
  assert.equal(revision,1);
  assert.equal(JSON.parse(snapshot.files['pages/home.page.json']).header.layout,'header-cta@1');
  assert.equal(snapshot.slots['collage-hero-imagea'].state,'EMPTY');
});

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
    const publishPath = '/rest/v1/rpc/owner_publish_profile_projection';
    const readPath = '/rest/v1/rpc/service_read_published_profile_projection';
    const lookup = (credentials = {key: cfg.service, bearer: cfg.service}) => send(readPath, {
      ...credentials, method: 'POST', headers: {'Content-Type': 'application/json'},
      body: {p_handle: handle}
    });
    successful(await send(profilePath, {
      ...json(owner), method: 'PATCH', body: {handle, display_name: 'Visible name', bio: 'Private bio'}
    }), 'Set private profile');
    successful(await setPreferenceFixture(owner,'sharing',visibleSharing),'Set profile sharing preferences');
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
    for (const requested of [false, true]) {
      successful(await setPreferenceFixture(owner,'sharing',{...visibleSharing,publicationRequested:requested}),'Change privacy preference');
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
    successful(await setPreferenceFixture(actor,'sharing',visibleSharing),'Set profile intent');
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
  successful(await setPreferenceFixture(fresh,'sharing',visibleSharing),'Set exposure consent fixture');
  assert.equal((await execute(fresh)).data?.message,'ERASURE_PUBLIC_REVOCATION_UNVERIFIED');
  await assert.rejects(service.removeUploadBatch(),{code:'CONFLICT'});
  await send(objectPath,{...bearer(fresh),method:'DELETE'});
  const privateObject='/storage/v1/object/authenticated/'+bucket+'/'+owner.id+'/exit/test.png';
  assert.equal((await send(privateObject,bearer(fresh))).ok,true,
    'Direct Storage delete bypassed the account exit revocation prerequisite');
  const operationId=randomUUID();
  const withdrawal={
    p_request_id:request.requestId,p_challenge_id:challenge.challengeId,p_operation_id:operationId,
    p_confirmation:'WITHDRAW PUBLIC CONTENT'
  };
  assert.equal((await post(outsider,'owner_withdraw_account_exit_content',withdrawal)).ok,false);
  assert.equal((await post(owner,'owner_withdraw_account_exit_content',withdrawal)).ok,false);
  const withdrawn=await service.withdrawPublicContent(request.requestId,challenge.challengeId,operationId,
    'WITHDRAW PUBLIC CONTENT');
  assert.equal(withdrawn.status,'APPLICATION_CONTENT_WITHDRAWN');
  assert.equal(withdrawn.hostRevocationVerified,false);
  assert.equal(withdrawn.erasureExecuted,false);
  assert.equal((await send(privateObject,bearer(fresh))).ok,true,'Withdrawal removed private uploads');
  assert.deepEqual(await service.withdrawPublicContent(request.requestId,challenge.challengeId,operationId,
    'WITHDRAW PUBLIC CONTENT'),withdrawn);
  assert.equal(await service.removeUploadBatch(), 1);
  assert.equal(await service.removeUploadBatch(), 0);
  const receipt = await service.execute(request.requestId, challenge.challengeId, 'DELETE MY ACCOUNT');
  assert.equal(receipt.status, 'ACTIVE_ACCOUNT_ERASED');
  assert.equal(receipt.accessTerminated, false, 'Deletion removes Auth rows but cannot revoke existing JWT signatures immediately');
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
    const notifications='/rest/v1/private_notifications?select=id,event_type,category,priority,target_id,read_at,dismissed_at';
    const listNotifications=async(actor)=>successful(await send(notifications,bearer(actor)),'List owner notifications');
    const notifyRpc=(actor,name,body)=>send('/rest/v1/rpc/'+name,{...json(actor),method:'POST',body});
    const preference=(sync)=>setPreferenceFixture(owner,'notification',{
      reviewerEnabled:false,publishEnabled:false,syncEnabled:sync
    });
    assert.deepEqual(await listNotifications(owner),[]);
    assert.ok(!(await send(notifications)).ok,'Anonymous notification read succeeded');
    assert.ok(!(await send('/rest/v1/private_notifications',{
      ...json(owner),method:'POST',body:{owner_user_id:owner.id}
    })).ok,'Owner created a synthetic notification');
    successful(await preference(false),'Disable optional notifications');
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
    assert.deepEqual(await listNotifications(owner),[],'Disabled sync must be quiet');
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
    const notices=await listNotifications(owner);
    assert.equal(notices.length,2);
    assert.ok(notices.some(n=>n.event_type==='PORTFOLIO_MODERATION_BLOCKED'&&n.target_id===id));
    const opened=notices.find(n=>n.event_type==='MODERATION_OPENED');
    assert.equal(opened.target_id,caseReceipt.caseId);
    assert.equal(opened.priority,'HIGH');
    assert.deepEqual(await listNotifications(outsider),[]);
    assert.deepEqual(await listNotifications(moderator),[]);
    const ackBody={p_id:opened.id,p_dismiss:false};
    assert.ok(!(await notifyRpc(outsider,'owner_acknowledge_notification',ackBody)).ok);
    const read=successful(await notifyRpc(owner,'owner_acknowledge_notification',ackBody),'Mark notice read');
    assert.ok(read.read_at);
    assert.equal(read.dismissed_at,null);
    const dismissed=successful(await notifyRpc(owner,'owner_acknowledge_notification',{
      ...ackBody,p_dismiss:true
    }),'Dismiss notice');
    assert.equal(dismissed.read_at,read.read_at);
    assert.ok(dismissed.dismissed_at);
    assert.deepEqual(successful(await notifyRpc(owner,'owner_acknowledge_notification',ackBody),
      'Replay acknowledgement'),dismissed);
    assert.ok(!(await listNotifications(owner)).some(n=>n.id===opened.id&&n.dismissed_at===null));
    for(const resource of ['CANONICAL_HTML','DIRECT_ASSET']){
      const verdict=await gate.check(request(id,resource));
      assert.equal(verdict.reason,'PRIVATE_POINTER_BLOCKED');
      assert.equal(verdict.generation,2);
      assert.equal(verdict.revocationGeneration,2);
    }
    await denied(id);
    successful(await preference(true),'Opt in to cloud revision notification');
    const trashId=await prepared();
    assert.ok((await listNotifications(owner)).some(n=>n.event_type==='CLOUD_REVISION_SAVED'&&n.target_id===trashId));
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
    const metadataRpc='/rest/v1/rpc/owner_export_account_metadata';
    assert.ok(!(await post(outsider,metadataRpc,{p_snapshot_id:newer.snapshotId})).ok);
    assert.ok(!(await send(metadataRpc,{method:'POST',
      headers:{'Content-Type':'application/json'},body:{p_snapshot_id:newer.snapshotId}})).ok);
    const metadataExporter=new SupabasePrivateAccountDataExporter(cfg.origin,cfg.anon,async()=>owner.token);
    const metadata=await metadataExporter.exportApplicationMetadata(newer.snapshotId);
    const contents=JSON.parse(new TextDecoder().decode(metadata.bytes));
    assert.equal(contents.records.projects.length,1);
    assert.equal(contents.records.projects[0].owner_user_id,owner.id);
    assert.equal(contents.records.projects[0].title,'Inventory-only test project');
    assert.equal(contents.ownerUserId,owner.id);
    assert.equal(contents.storageBytesIncluded,false);
    assert.equal(contents.providerDataIncluded,false);
    assert.equal(contents.deletionAllowed,false);
    assert.deepEqual(contents.verifiedReleaseHistory,[]);
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
  const createPrivateRecord=async(table,values)=>successful(await send('/rest/v1/'+table+'?select=id',{
    ...json(owner),method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},
    body:values
  }),'Create export fixture '+table)[0].id;
  const linkId=await createPrivateRecord('private_platform_links',{provider:'GITHUB',handle:'export-fixture'});
  const goalId=await createPrivateRecord('private_goals',{operation_id:randomUUID(),title:'Practice export'});
  const progressId=await createPrivateRecord('private_goal_progress_events',{
    goal_id:goalId,operation_id:randomUUID(),value:1
  });
  const milestoneId=await createPrivateRecord('private_goal_milestones',{
    goal_id:goalId,operation_id:randomUUID(),title:'First exercise'
  });
  const exporter=new SupabasePrivateAccountDataExporter(cfg.origin,cfg.anon,
    async()=>owner.token);
  const artifact=await exporter.export(snapshot.snapshotId);
  assert.equal(artifact.status,'BOUNDED_PARTIAL_EXPORT');
  assert.equal(artifact.deletionAllowed,false);
  const body=JSON.parse(new TextDecoder().decode(artifact.bytes));
  assert.equal(body.owner.id,owner.id);
  assert.ok(body.records.projects.some(p=>p.id===project.id));
  assert.ok(body.records.private_platform_links.some(link=>link.id===linkId&&link.ownership_verified===false));
  assert.ok(body.records.private_goals.some(goal=>goal.id===goalId));
  assert.ok(body.records.private_goal_progress_events.some(event=>event.id===progressId&&event.source==='MANUAL'));
  assert.ok(body.records.private_goal_milestones.some(milestone=>milestone.id===milestoneId));
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

    const reporterEvidence='Reporter supplied evidence that must stay private.';
    const reportOp=randomUUID();
    const report=(operationId=reportOp,evidence=reporterEvidence)=>fetch(address,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({operationId,reason:'ABUSE',evidence}),
      redirect:'error',signal:AbortSignal.timeout(5000)
    });
    const submitted=await report();
    assert.equal(submitted.status,202);
    assert.deepEqual(await submitted.json(),{status:'RECEIVED_FOR_REVIEW'});
    assert.equal((await report()).status,202);
    assert.equal((await report(randomUUID())).status,202);
    assert.equal((await report(reportOp,'Different evidence using the original operation.')).status,409);
    for(let i=0;i<11;i++)assert.equal((await report(randomUUID(),reporterEvidence+' '+i)).status,202);
    assert.equal((await report(randomUUID(),'Another report above the per-release intake limit.')).status,429);
    const operator=await adminUser('abuse-intake-operator');
    await pg.query("insert into kadmeion_private.operator_roles(user_id,role) values ($1,'moderator')",[operator.id]);
    const rpc=(actor,name,body)=>send('/rest/v1/rpc/'+name,{...json(actor),method:'POST',body});
    assert.ok(!(await rpc(owner,'operator_list_portfolio_abuse_reports',{})).ok);
    assert.ok(!(await send('/rest/v1/rpc/service_submit_portfolio_abuse_report',{
      ...json(owner),method:'POST',body:{p_handle:handle,p_slug:slug,p_operation_id:randomUUID(),
        p_reason_code:'ABUSE',p_evidence:reporterEvidence}
    })).ok,'Client bypassed report gateway');
    const cases='/rest/v1/private_moderation_cases?select=id,summary';
    assert.deepEqual(successful(await send(cases,bearer(owner)),'Owner cases before review'),[]);
    const queue=successful(await rpc(operator,'operator_list_portfolio_abuse_reports',{p_limit:50}),'List abuse queue');
    const entry=queue.find(item=>item.evidence===reporterEvidence&&item.target_path==='/'+handle+'/'+slug);
    assert.ok(entry);
    assert.ok(!Object.hasOwn(entry,'owner_user_id'));
    const review={p_report_id:entry.id,p_decision:'CASE_OPENED',p_rationale:'Reviewed evidence merits an owner-visible investigation.'};
    const opened=successful(await rpc(operator,'operator_review_portfolio_abuse_report',review),'Convert report to case');
    assert.equal(opened.status,'CASE_OPENED');
    assert.deepEqual(successful(await rpc(operator,'operator_review_portfolio_abuse_report',review),'Review replay'),opened);
    assert.ok(!(await rpc(operator,'operator_review_portfolio_abuse_report',{
      ...review,p_decision:'DISMISSED'
    })).ok);
    assert.deepEqual(successful(await send(cases,bearer(owner)),'Owner case after review'),[
      {id:opened.caseId,summary:review.p_rationale}
    ]);
    assert.equal((await read()).status,200,'A report or review automatically unpublished the release');

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
    assert.equal(after.headers.get('x-robots-tag'),'noindex, nofollow, noarchive');
    assert.equal((await report(randomUUID())).status,404,'Reports accepted for a withdrawn portfolio');
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

test('B08/WF-025: real GoTrue identity, private versions and replay-safe component reuse',
  {timeout:120_000},async()=>{
  const owner=await adminUser('mycomponent-owner');
  const outsider=await adminUser('mycomponent-other');
  const mine=new SupabaseMyComponentsService(cfg.origin,cfg.anon,async()=>owner.token);
  const theirs=new SupabaseMyComponentsService(cfg.origin,cfg.anon,async()=>outsider.token);
  const original='export const title = "original trusted library reference";';
  const custom='export const title = "private author source";';
  const componentKey='saved-title-'+randomUUID().slice(0,6);
  const input={
    operationId:randomUUID(),componentKey,displayName:'Personal headline',
    baseComponentPin:'title-stacked@1',pristineSource:original,sourceCode:custom,
    compatibleSlotKinds:['title','text']
  };
  assert.ok(!(await send('/rest/v1/private_my_component_versions?select=*',
    bearer(owner))).ok,'Owner direct-table SELECT must be disabled');
  assert.ok(!(await send('/rest/v1/private_my_component_versions?select=*',
    bearer(outsider))).ok,'Foreign account cannot query source table');
  assert.ok(!(await send('/rest/v1/rpc/owner_list_my_component_versions',{
    method:'POST',headers:{'Content-Type':'application/json'},body:{}
  })).ok,'Anonymous caller must never enumerate reusable source');
  const first=await mine.saveVersion(input);
  assert.equal(first.id,input.operationId);
  assert.equal(first.owner_user_id,owner.id);
  assert.equal(first.version,1);
  assert.equal(first.source_code,custom);
  assert.equal(first.source_sha256,createHash('sha256').update(custom).digest('hex'));
  assert.deepEqual(first.compatible_slot_kinds,['text','title']);
  assert.deepEqual(await mine.saveVersion(input),first,'same operation ID is idempotent');
  await assert.rejects(mine.saveVersion({...input,sourceCode:'different bytes'}),
    {code:'CONFLICT'});
  const second=await mine.saveVersion({...input,operationId:randomUUID(),
    sourceCode:'export const title = "new version";'});
  assert.equal(second.version,2,'version allocation must be monotonic');
  const all=await mine.listVersions();
  assert.equal(all.length,2);
  assert.equal(all[0].version,2);
  assert.equal(all[1].version,1);
  assert.deepEqual(await mine.getVersion(first.id),first);
  assert.equal(await theirs.getVersion(first.id),null);
  assert.deepEqual(await theirs.listVersions(),[]);
  // There is no public trust flag or direct client ability to insert/update.
  assert.ok(!(await send('/rest/v1/private_my_component_versions',{
    ...json(owner),method:'POST',body:{
      id:randomUUID(),owner_user_id:owner.id,component_key:'publicly-trusted',
      version:1,source_code:'const x=1;',public_executable:true
    }
  })).ok,'A client cannot forge server-owned trust or append private code directly');
  assert.ok(!(await send('/rest/v1/private_my_component_versions?id=eq.'+first.id,{
    ...json(owner),method:'PATCH',body:{source_code:'replace without version'}
  })).ok,'An owner cannot mutate historical source bytes');
  const foreignSave=await send('/rest/v1/rpc/owner_save_my_component',{
    ...json(outsider),method:'POST',body:{
      p_operation_id:first.id,p_component_key:componentKey,
      p_display_name:'Personal headline',p_base_component_pin:'title-stacked@1',
      p_pristine_source:original,p_source_code:custom,p_slot_kinds:['title']
    }
  });
  assert.ok(!foreignSave.ok,'A cross-account replay cannot claim an existing version ID');
});

test('C01/WF-013: real local owner thumbnail CAS and immutable private PNG bytes (migration mandatory)',
  {timeout:120_000},async()=>{
  // Two distinct, independently decoded, CRC-valid PNGs. Do not use the older synthetic byte fixture.
  const thumbnailPng=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQSbn0HwAEJAJK6G06bAAAAABJRU5ErkJggg==','base64'));
  const replacementPng=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP44Kb8HwAF3AJZlf4qbQAAAABJRU5ErkJggg==','base64'));
  const owner=await adminUser('thumb-owner'), stranger=await adminUser('thumb-stranger');
  const createProject=async(actor)=>{
    const rows=successful(await send('/rest/v1/projects?select=id,revision,owner_user_id',{
      ...json(actor),method:'POST',
      headers:{'Content-Type':'application/json',Prefer:'return=representation'},
      body:{owner_user_id:actor.id,slug:'thumb-'+randomUUID().slice(0,8),title:'Private thumbnail fixture'}
    }),'Create thumbnail fixture project');
    assert.equal(rows.length,1);assert.equal(rows[0].owner_user_id,actor.id);
    return rows[0];
  };
  const project=await createProject(owner), sibling=await createProject(owner),
    foreign=await createProject(stranger);
  const rpc=(name,body,actor=owner)=>send('/rest/v1/rpc/'+name,{
    ...json(actor),method:'POST',body
  });
  const anonymousRpc=(name,body)=>send('/rest/v1/rpc/'+name,{
    method:'POST',headers:{'Content-Type':'application/json'},body
  });
  const read=(actor=owner)=>rpc('read_private_project_thumbnail',{p_project_id:project.id},actor);
  const before=successful(await read(),'Mandatory thumbnail migration/RPC present');
  assert.equal(before.ownerUserId,owner.id);
  assert.equal(before.projectId,project.id);
  assert.equal(before.revision,project.revision);
  assert.equal(before.asset,null);assert.equal(before.publicDeliveryAllowed,false);
  const register=async(actor,p,bytes=thumbnailPng)=>{
    const objectPath=actor.id+'/'+p.id+'/'+randomUUID()+'.png';
    const uploadPath='/storage/v1/object/'+bucket+'/'+objectPath;
    successful(await send(uploadPath,{...bearer(actor),method:'POST',
      headers:{'Content-Type':'image/png','x-upsert':'false'},body:bytes}),
      'Upload immutable private PNG');
    const input={p_project_id:p.id,p_object_path:objectPath,p_mime_type:'image/png',
      p_byte_size:bytes.length,p_alt_text:'Synthetic thumbnail'};
    for(const invalid of [{p_byte_size:bytes.length+1},{p_mime_type:'image/jpeg'},
      {p_object_path:actor.id+'/'+p.id+'/'+randomUUID()+'.png'}]){
      assert.ok(!(await rpc('register_private_project_image',{...input,...invalid},actor)).ok,
        'Mismatched or missing Storage metadata must not register');
    }
    const asset=successful(await rpc('register_private_project_image',input,actor),
      'Register uploaded PNG metadata');
    assert.equal(asset.storage_metadata_matched,true);
    assert.equal(asset.object_path,objectPath);
    assert.equal(successful(await rpc('register_private_project_image',input,actor),
      'Replay private asset registration').id,asset.id);
    return {id:asset.id,path:objectPath,uploadPath,bytes};
  };
  const first=await register(owner,project), other=await register(owner,sibling),
    outsider=await register(stranger,foreign);
  // C04: execute the real owner RPC before and after independent trusted attestation.
  const pinInput={p_scope:'PROJECT',p_asset_id:first.id,p_project_id:project.id};
  const unpinned=successful(await rpc('read_owner_private_asset_pin',pinInput),'C04 unpinned owner read');
  assert.deepEqual(Object.keys(unpinned).sort(),['scope','assetId','ownerUserId','projectId','objectId','version','mimeType','byteSize','status','expectedSha256','publicDeliveryAllowed'].sort());
  assert.equal(unpinned.status,'UNPINNED');assert.equal(unpinned.expectedSha256,null);
  assert.equal(unpinned.publicDeliveryAllowed,false);assert.equal(unpinned.ownerUserId,owner.id);
  for(const [args,actor] of [[pinInput,stranger],[{...pinInput,p_project_id:sibling.id},owner],
    [{...pinInput,p_asset_id:randomUUID()},owner],[{...pinInput,p_scope:'PROFILE',p_project_id:null},owner]]){
    const r=await rpc('read_owner_private_asset_pin',args,actor);
    assert.ok(!r.ok);assert.equal(r.data?.code,'42501');assert.equal(r.data?.message,'PRIVATE_ASSET_NOT_FOUND');
  }
  assert.ok(!(await anonymousRpc('read_owner_private_asset_pin',pinInput)).ok);
  const attestor=new PrivateServerAssetByteAttestor(cfg.origin,cfg.anon,cfg.service);
  assert.deepEqual(await attestor.attest(first.id,owner.token),{assetId:first.id,status:'WRITE_ONCE_ATTESTED'});
  const pinned=successful(await rpc('read_owner_private_asset_pin',pinInput),'C04 trusted owner pin');
  assert.deepEqual(pinned,{...unpinned,status:'SERVER_HASH_PINNED',expectedSha256:createHash('sha256').update(first.bytes).digest('hex')});
  // Real JWT claims, local disposable DB only; inject inconsistency within savepoints.
  // Never alter production data or leave a corrupted object/session after this test.
  const rawEnv=execFileSync('supabase',['status','-o','env'],{encoding:'utf8',timeout:20_000});
  const dbMatch=rawEnv.match(/^(?:export )?DB_URL=(.+)$/m);
  assert.ok(dbMatch,'Local database fixture URL required');
  const db=new URL(dbMatch[1].trim().replace(/^["']|["']$/g,''));
  assert.equal(db.protocol,'postgresql:');
  assert.ok(['127.0.0.1','localhost'].includes(db.hostname));
  assert.equal(db.port,'54322');assert.equal(db.username,'postgres');
  const sql=new Client({host:db.hostname,port:Number(db.port),database:'postgres',
    user:'postgres',password:decodeURIComponent(db.password),ssl:false});
  const claims=JSON.parse(Buffer.from(owner.token.split('.')[1],'base64url').toString('utf8'));
  assert.equal(claims.sub,owner.id);assert.equal(claims.role,'authenticated');
  assert.match(claims.session_id,/^[0-9a-f-]{36}$/i);
  try{
    await sql.connect();await sql.query('BEGIN');
    await sql.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claim.role','authenticated',true)",[JSON.stringify(claims),owner.id]);
    const readPinSql=()=>sql.query("select public.read_owner_private_asset_pin('PROJECT',$1::uuid,$2::uuid) as receipt",[first.id,project.id]);
    await sql.query('SET LOCAL ROLE authenticated');
    assert.deepEqual((await readPinSql()).rows[0].receipt,pinned);
    await sql.query('RESET ROLE');
    for(const [statement,params,code,message] of [
      ["update storage.objects set metadata=jsonb_set(metadata,'{size}',to_jsonb($2::integer)) where id=$1::uuid",[pinned.objectId,first.bytes.length+1],'22023','PRIVATE_ASSET_PIN_INTEGRITY'],
      ["update storage.objects set metadata=jsonb_set(metadata,'{mimetype}',to_jsonb($2::text)) where id=$1::uuid",[pinned.objectId,'image/jpeg'],'22023','PRIVATE_ASSET_PIN_INTEGRITY'],
      ['update storage.objects set version=$2 where id=$1::uuid',[pinned.objectId,randomUUID()],'22023','PRIVATE_ASSET_PIN_INTEGRITY'],
      ["update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id=$1::uuid and user_id=$2::uuid",[claims.session_id,owner.id],'42501','PRIVATE_ASSET_NOT_FOUND']
    ]){
      await sql.query('SAVEPOINT c04_negative');
      try{
        assert.equal((await sql.query(statement,params)).rowCount,1);
        await sql.query('SET LOCAL ROLE authenticated');
        await assert.rejects(readPinSql(),{code,message});
      }finally{
        await sql.query('ROLLBACK TO SAVEPOINT c04_negative');
        await sql.query('RELEASE SAVEPOINT c04_negative');
      }
      await sql.query('SET LOCAL ROLE authenticated');
      assert.deepEqual((await readPinSql()).rows[0].receipt,pinned,'Rollback must restore exact owner pin');
      await sql.query('RESET ROLE');
    }
  }finally{
    try{await sql.query('ROLLBACK');}finally{await sql.end();}
  }
  assert.deepEqual(successful(await rpc('read_owner_private_asset_pin',pinInput),'C04 HTTP pin after local negative savepoints'),pinned);
  const input={p_project_id:project.id,p_base_revision:before.revision,
    p_asset_id:first.id,p_operation_id:randomUUID()};
  const set=(body,actor=owner)=>rpc('set_private_project_thumbnail',body,actor);
  const denied=(r,code,label)=>{
    assert.ok(!r.ok,label+' unexpectedly succeeded');
    if(code)assert.equal(r.data?.code,code,label+' SQLSTATE');
  };
  denied(await anonymousRpc('read_private_project_thumbnail',{p_project_id:project.id}),null,'Anonymous read');
  denied(await anonymousRpc('set_private_project_thumbnail',input),null,'Anonymous write');
  denied(await read(stranger),'42501','Foreign read');
  denied(await set(input,stranger),'42501','Foreign write');
  denied(await set({...input,p_asset_id:other.id}),'42501','Same-owner other-project asset');
  denied(await set({...input,p_asset_id:outsider.id}),'42501','Foreign asset');
  const attached=successful(await set(input),'Attach valid owner thumbnail');
  assert.equal(attached.revision,before.revision+1);
  assert.equal(attached.asset.id,first.id);assert.equal(attached.asset.objectPath,first.path);
  assert.equal(attached.asset.mime,'image/png');assert.equal(attached.asset.size,thumbnailPng.length);
  assert.equal(attached.asset.altText,'Synthetic thumbnail');
  assert.equal(attached.publicDeliveryAllowed,false);
  assert.deepEqual(successful(await set(input),'Replay exact thumbnail operation'),attached);
  assert.deepEqual(successful(await read(),'Reload private attachment'),attached);
  denied(await set({...input,p_asset_id:null}),'40001','Same operation changed payload');
  denied(await set({...input,p_operation_id:randomUUID(),p_asset_id:null}),'40001','Stale base CAS');
  const download='/storage/v1/object/authenticated/'+bucket+'/'+first.path;
  const owned=await send(download,bearer(owner));
  assert.ok(owned.ok,'Owner private-byte read failed');
  assert.match(owned.headers.get('content-type')??'',/^image\/png(?:;|$)/i);
  assert.equal(owned.bytes.length,thumbnailPng.length);
  assert.equal(createHash('sha256').update(owned.bytes).digest('hex'),createHash('sha256').update(thumbnailPng).digest('hex'));
  assert.deepEqual(owned.bytes,thumbnailPng);
  assert.ok(!(await send(download,bearer(stranger))).ok,'Foreign private-byte read');
  assert.ok(!(await send(download)).ok,'Anonymous authenticated-path private-byte read');
  assert.ok(!(await send('/storage/v1/object/public/'+bucket+'/'+first.path)).ok,'Public-path private-byte read');
  assert.ok(!(await send(first.uploadPath,{...bearer(owner),method:'POST',
    headers:{'Content-Type':'image/png','x-upsert':'true'},body:replacementPng})).ok,
    'Owner overwrite must not mutate immutable uploaded bytes');
  const afterOverwrite=await send(download,bearer(owner));
  assert.ok(afterOverwrite.ok);assert.deepEqual(afterOverwrite.bytes,thumbnailPng);
  for(const [column,value] of [['thumbnail_asset_id',null],['thumbnail_operation_id',randomUUID()],
    ['thumbnail_operation_base_revision',0]]){
    denied(await send('/rest/v1/projects?id=eq.'+project.id,{
      ...json(owner),method:'PATCH',body:{[column]:value}
    }),'42501','Direct managed-column write');
  }
  denied(await send('/rest/v1/projects',{...json(owner),method:'POST',body:{
    owner_user_id:owner.id,slug:'thumb-forged-'+randomUUID().slice(0,8),title:'Forgery',
    thumbnail_asset_id:first.id,thumbnail_operation_id:randomUUID(),thumbnail_operation_base_revision:0
  }}),'42501','Direct managed-column insert');
  assert.deepEqual(successful(await read(),'Prior cover retained after denials'),attached);
  const replacement=await register(owner,project,replacementPng);
  const replaced=successful(await set({...input,p_asset_id:replacement.id,
    p_base_revision:attached.revision,p_operation_id:randomUUID()}),'Replace thumbnail');
  assert.equal(replaced.revision,attached.revision+1);assert.equal(replaced.asset.id,replacement.id);
  const replacementRead=await send('/storage/v1/object/authenticated/'+bucket+'/'+replacement.path,bearer(owner));
  assert.ok(replacementRead.ok);assert.deepEqual(replacementRead.bytes,replacementPng);
  assert.notEqual(createHash('sha256').update(replacementRead.bytes).digest('hex'),
    createHash('sha256').update(thumbnailPng).digest('hex'),'Replacement must contain different bytes');
  denied(await set(input),'40001','Superseded replay cannot restore old cover');
  const detach={...input,p_asset_id:null,p_base_revision:replaced.revision,p_operation_id:randomUUID()};
  const detached=successful(await set(detach),'Detach thumbnail');
  assert.equal(detached.revision,replaced.revision+1);assert.equal(detached.asset,null);
  assert.deepEqual(successful(await set(detach),'Replay exact detach'),detached);
  assert.deepEqual(successful(await read(),'Reload detached thumbnail'),detached);
  const retained=await send(download,bearer(owner));assert.ok(retained.ok);
  assert.deepEqual(retained.bytes,thumbnailPng,'Detach is not destructive byte deletion');
  // Browser-computed byte equality is NOT a trusted server attestation;
  // independently existing server-attestation tests remain mandatory.
});

test('C06/WF-009: real owner authored links CAS, replay, privacy and direct mutation denial (migration mandatory)',
  {timeout:120_000},async()=>{
  const owner=await adminUser('authored-link-owner'), outsider=await adminUser('authored-link-outsider');
  const read=(actor)=>send('/rest/v1/profiles?select=user_id,private_links&user_id=eq.'+owner.id,bearer(actor));
  const save=(expected,desired,actor=owner)=>send('/rest/v1/rpc/owner_save_private_profile_links',{
    ...json(actor),method:'POST',body:{p_expected:expected,p_links:desired}
  });
  const first=[{label:'Portfolio',url:'https://example.com/work'}];
  const next=[{label:'Notes',url:'https://example.com/notes'}];
  const start=successful(await read(owner),'Mandatory private link column present');
  assert.equal(start.length,1);assert.equal(start[0].user_id,owner.id);assert.deepEqual(start[0].private_links,[]);
  const anonymous=await send('/rest/v1/rpc/owner_save_private_profile_links',{
    method:'POST',headers:{'Content-Type':'application/json'},body:{p_expected:[],p_links:first}
  });
  assert.ok(!anonymous.ok,'Anonymous authored link write denied');
  const applied=successful(await save([],first),'Owner authored link CAS');
  assert.deepEqual(applied,{user_id:owner.id,private_links:first});
  assert.deepEqual(successful(await save([],first),'Exact desired-state replay'),applied);
  assert.deepEqual(successful(await read(outsider),'Foreign RLS profile read'),[]);
  const foreign=await save([],next,outsider);
  assert.ok(foreign.ok,'Foreign owner may change only their own row');
  assert.equal(foreign.data?.user_id,outsider.id);
  assert.deepEqual(successful(await read(owner),'Owner unaffected by foreign save')[0].private_links,first);
  const stale=await save([],next);
  assert.ok(!stale.ok);assert.equal(stale.data?.code,'40001');
  const invalid=[
    [{label:'No',url:'http://example.com/'}],
    [{label:'No',url:'https://name@example.com/'}],
    [{label:'No',url:'https://example.com:444/'}],
    [{label:' No ',url:'https://example.com/'}],
    [{label:'No',url:'https://example.com/',verified:true}],
    [first[0],first[0]],
    Array.from({length:13},(_,i)=>({label:'Too many',url:'https://example.com/'+i}))
  ];
  for(const desired of invalid){
    const failure=await save(first,desired);
    assert.ok(!failure.ok);assert.equal(failure.data?.code,'22023');
  }
  const direct=await send('/rest/v1/profiles?user_id=eq.'+owner.id,{
    ...json(owner),method:'PATCH',body:{private_links:next}
  });
  assert.ok(!direct.ok);assert.equal(direct.data?.code,'42501');
  assert.deepEqual(successful(await read(owner),'Invalid writes preserve prior private links')[0].private_links,first);
  assert.deepEqual(successful(await save(first,next),'Owner replace private links').private_links,next);
  assert.deepEqual(successful(await save(next,[]),'Owner clear links').private_links,[]);
  assert.deepEqual(successful(await read(owner),'Reload cleared private links')[0].private_links,[]);
});

test('C07/WF-041: real owner conditional goal writes and 105-event raw chronology',
  {timeout:120_000},async()=>{
  const owner=await adminUser('chronological-goal-owner'), outsider=await adminUser('chronological-goal-foreign');
  const mine=new SupabasePrivateGoalsService(cfg.origin,cfg.anon,async()=>owner.token,fetch,owner.id);
  const foreign=new SupabasePrivateGoalsService(cfg.origin,cfg.anon,async()=>outsider.token,fetch,outsider.id);
  const original=await mine.createGoal(randomUUID(),'Original goal','',105,'sessions');
  const read=await mine.readGoal(original.id);
  assert.equal(read?.updated_at,original.updated_at);
  assert.equal(await foreign.readGoal(original.id),null);
  const attempts=await Promise.allSettled([
    mine.updateGoalIfUnchanged(original.id,original.updated_at,{title:'Concurrent A'}),
    mine.updateGoalIfUnchanged(original.id,original.updated_at,{title:'Concurrent B'})
  ]);
  const successes=attempts.filter(x=>x.status==='fulfilled');
  const failures=attempts.filter(x=>x.status==='rejected');
  assert.equal(successes.length,1,'Exactly one concurrent CAS may win');
  assert.equal(failures.length,1);assert.equal(failures[0].reason?.code,'CONFLICT');
  const current=await mine.readGoal(original.id);
  assert.ok(current);assert.notEqual(current.updated_at,original.updated_at);
  assert.deepEqual(current,successes[0].value);
  await assert.rejects(foreign.updateGoalIfUnchanged(original.id,current.updated_at,{title:'Foreign'}),{code:'CONFLICT'});
  await assert.rejects(mine.deleteGoalIfUnchanged(original.id,original.updated_at),{code:'CONFLICT'});
  const bulk=Array.from({length:105},(_,i)=>({goal_id:original.id,operation_id:randomUUID(),
    value:i,note:'Synthetic manual chronological evidence'}));
  const inserted=successful(await send('/rest/v1/private_goal_progress_events?select=*',{
    ...json(owner),method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:bulk
  }),'Insert 105 manual history fixtures');
  assert.equal(inserted.length,105);
  const seen=new Set();
  let cursor=null;
  let events=[];
  for(let page=0;page<3;page++){
    const part=await mine.listProgressChronologicalPage(original.id,100,cursor);
    assert.ok(part.items.length<=100);
    for(const item of part.items){
      assert.equal(item.owner_user_id,owner.id);assert.equal(item.goal_id,original.id);
      assert.equal(item.source,'MANUAL');assert.ok(!seen.has(item.id));seen.add(item.id);events.push(item);
    }
    if(!part.nextCursor){cursor=null;break;}
    assert.equal(part.nextCursor.createdAt,part.items.at(-1).created_at);
    assert.equal(part.nextCursor.id,part.items.at(-1).id);cursor=part.nextCursor;
  }
  assert.equal(cursor,null);assert.equal(seen.size,105);
  const ordered=successful(await send('/rest/v1/private_goal_progress_events?'+new URLSearchParams({
    select:'*',goal_id:'eq.'+original.id,order:'created_at.desc,id.desc',limit:'106'
  }),bearer(owner)),'Authoritative chronological order');
  assert.deepEqual(events,ordered);
  const privateEvents=await foreign.listProgressChronologicalPage(original.id,100);
  assert.deepEqual(privateEvents.items,[]);assert.equal(privateEvents.nextCursor,null);
  await assert.rejects(foreign.deleteGoalIfUnchanged(original.id,current.updated_at),{code:'CONFLICT'});
  assert.equal(await mine.deleteGoalIfUnchanged(original.id,current.updated_at),original.id);
  assert.equal(await mine.readGoal(original.id),null);
});

test('C08 actual owner preference CAS: two real sessions, absent/default, ACL, replay and ABA',
  {timeout:120_000},async()=>{
    const owner=await adminUser('c08-owner'),other=await adminUser('c08-other');
    const login=successful(await send('/auth/v1/token?grant_type=password',{
      method:'POST',headers:{'Content-Type':'application/json'},body:{email:owner.email,password:owner.password}
    }),'Second real owner session');
    const second={...owner,token:login.access_token};
    const sessionId=actor=>JSON.parse(Buffer.from(actor.token.split('.')[1],'base64url').toString('utf8')).session_id;
    assert.notEqual(sessionId(owner),sessionId(second));
    const absent={ownerUserId:owner.id,version:0,preferences:null};
    const domains=[
      {read:'read_owner_notification_preferences_state',change:'change_owner_notification_preferences',
       table:'private_notification_preferences',ownerKey:'owner_user_id',
       first:{reviewerEnabled:false,publishEnabled:true,syncEnabled:false},
       second:{reviewerEnabled:true,publishEnabled:false,syncEnabled:false},
       off:{reviewerEnabled:false,publishEnabled:false,syncEnabled:false}},
      {read:'read_owner_profile_sharing_state',change:'change_owner_profile_sharing',
       table:'profile_sharing_preferences',ownerKey:'user_id',
       first:{shareDisplayName:true,shareHeadline:true,shareBio:false,publicationRequested:true},
       second:{shareDisplayName:true,shareHeadline:false,shareBio:true,publicationRequested:true},
       off:{shareDisplayName:false,shareHeadline:false,shareBio:false,publicationRequested:false}}
    ];
    const exactRead=async(actor,d)=>successful(await preferenceRpc(actor,d.read),'Read actual CAS state');
    const deniedConflict=r=>{assert.ok(!r.ok);assert.equal(r.data?.code,'40001');};
    for(const d of domains){
      assert.deepEqual(await exactRead(owner,d),absent);
      assert.deepEqual(await exactRead(second,d),absent);
      const make=(s,desired,operationId=randomUUID())=>({p_expected_version:s.version,
        p_expected:s.preferences,p_desired:desired,p_operation_id:operationId});
      const inputA=make(absent,d.first),inputB=make(absent,d.second);
      const anonymous=await send('/rest/v1/rpc/'+d.read,{method:'POST',headers:{'Content-Type':'application/json'},body:{}});
      assert.ok(!anonymous.ok);
      const serviceRead=await send('/rest/v1/rpc/'+d.read,{method:'POST',key:cfg.service,bearer:cfg.service,
        headers:{'Content-Type':'application/json'},body:{}});
      assert.ok(!serviceRead.ok);
      const results=await Promise.all([preferenceRpc(owner,d.change,inputA),preferenceRpc(second,d.change,inputB)]);
      assert.equal(results.filter(r=>r.ok).length,1,'Exactly one real concurrent first writer must win');
      const i=results.findIndex(r=>r.ok),win=i===0?inputA:inputB;
      deniedConflict(results[1-i]);
      const applied=successful(results[i],'Concurrent CAS winner');
      assert.deepEqual(applied,{status:'APPLIED',ownerUserId:owner.id,version:1,preferences:win.p_desired});
      assert.deepEqual(await exactRead(second,d),{ownerUserId:owner.id,version:1,preferences:win.p_desired});
      assert.deepEqual(successful(await preferenceRpc(second,d.change,win),'Exact ambiguous-ack replay'),
        {...applied,status:'REPLAYED'});
      deniedConflict(await preferenceRpc(owner,d.change,{...win,p_desired:d.off}));
      assert.deepEqual(await exactRead(other,d),{ownerUserId:other.id,version:0,preferences:null});
      const captured=await exactRead(owner,d);
      assert.deepEqual(successful(await preferenceRpc(owner,d.change,make(captured,captured.preferences)),'No-change receipt'),
        {status:'NO_CHANGE',...captured});
      const changed=successful(await preferenceRpc(owner,d.change,make(captured,d.off)),'CAS to alternate tuple');
      assert.equal(changed.version,2);
      const restored=successful(await preferenceRpc(second,d.change,make(changed,captured.preferences)),'Restore identical values via new CAS');
      assert.equal(restored.version,3);
      assert.deepEqual(restored.preferences,captured.preferences);
      deniedConflict(await preferenceRpc(owner,d.change,make(captured,d.off)));
      deniedConflict(await preferenceRpc(owner,d.change,win));
      // A real PostgREST 40001 must map to typed CONFLICT at the consumer,
      // regardless of whether the gateway selects 409 or 500 for SQLSTATE.
      // No retry or stale state mutation is permissible.
      const stale={expected:captured,desired:d.off,operationId:randomUUID()};
      const client=d.table==='private_notification_preferences'
        ?new SupabasePrivateNotificationsService(cfg.origin,cfg.anon,owner.id,async()=>owner.token,fetch,()=>true)
        :new SupabasePrivateIdentityService(cfg.origin,cfg.anon,async()=>owner.token,fetch,owner.id,()=>true);
      await assert.rejects(d.table==='private_notification_preferences'
        ?client.changePreferences(stale):client.requestPublicIdentity(stale),{code:'CONFLICT'});
      assert.equal((await exactRead(owner,d)).version,3);

      for(const method of ['POST','PATCH','DELETE']){
        const body=method==='DELETE'?undefined:{[d.ownerKey]:owner.id};
        const result=await send('/rest/v1/'+d.table+(method==='POST'?'':'?'+d.ownerKey+'=eq.'+owner.id),
          {...json(owner),method,body});
        assert.ok(!result.ok,'Direct legacy preference write bypassed CAS');
      }
      assert.equal((await exactRead(owner,d)).version,3);
      const malformed=await preferenceRpc(owner,d.change,make(restored,{...d.off,unexpected:true}));
      assert.ok(!malformed.ok);assert.equal(malformed.data?.code,'22023');
    }
    assert.ok(!(await preferenceRpc(owner,'owner_set_notification_preferences',{
      p_reviewer_enabled:true,p_publish_enabled:true,p_sync_enabled:true})).ok,'Legacy unconditional setter still callable');
  });

test('C08 physical terminal ledger, privacy reduction, tombstone and expired-session denial',
  {timeout:120_000},async()=>{
    const actor=await adminUser('c08-terminal'),other=await adminUser('c08-terminal-other');
    const raw=execFileSync('supabase',['status','-o','env'],{encoding:'utf8',timeout:20000});
    const match=raw.match(/^(?:export )?DB_URL=(.+)$/m);
    assert.ok(match,'Disposable local DB URL required');
    const db=new URL(match[1].trim().replace(/^["']|["']$/g,''));
    assert.equal(db.protocol,'postgresql:');assert.ok(['127.0.0.1','localhost'].includes(db.hostname));
    assert.equal(db.port,'54322');assert.equal(db.username,'postgres');
    const pg=new Client({host:db.hostname,port:Number(db.port),database:'postgres',
      user:'postgres',password:decodeURIComponent(db.password),ssl:false});
    const max=Number.MAX_SAFE_INTEGER;
    const on={shareDisplayName:true,shareHeadline:true,shareBio:false,publicationRequested:true};
    const withdrawn={...on,publicationRequested:false};
    const reduced={...withdrawn,shareHeadline:false};
    const allOff={reviewerEnabled:false,publishEnabled:false,syncEnabled:false};
    const noteOn={...allOff,publishEnabled:true};
    const read=(who,name)=>preferenceRpc(who,name);
    const mutate=(who,name,expected,desired,operationId=randomUUID())=>preferenceRpc(who,name,{
      p_expected_version:expected.version,p_expected:expected.preferences,p_desired:desired,p_operation_id:operationId
    });
    const assertConflict=r=>{assert.ok(!r.ok);assert.equal(r.data?.code,'40001');};
    const sread='read_owner_profile_sharing_state',schange='change_owner_profile_sharing';
    const nread='read_owner_notification_preferences_state',nchange='change_owner_notification_preferences';
    const first=successful(await setPreferenceFixture(actor,'sharing',on),'Initialize sharing');
    const firstNote=successful(await setPreferenceFixture(actor,'notification',noteOn),'Initialize notifications');
    assert.equal(first.version,1);assert.equal(firstNote.version,1);
    try{
      await pg.connect();
      // Privileged fixtures are restricted to generated disposable users. Jump the
      // ledger counter without billions of writes; clear the previous replay binding.
      const jumped=await pg.query('UPDATE kadmeion_private.owner_preference_cas_state SET version=$2::bigint,last_operation_id=NULL,last_expected_version=NULL,last_expected=NULL,last_desired=NULL WHERE owner_user_id=$1::uuid',[actor.id,String(max-1)]);
      assert.equal(jumped.rowCount,2);
      const s=successful(await read(actor,sread),'Read sharing near exhaustion');
      const n=successful(await read(actor,nread),'Read notifications near exhaustion');
      assert.deepEqual(s,{ownerUserId:actor.id,version:max-1,preferences:on});
      assert.deepEqual(n,{ownerUserId:actor.id,version:max-1,preferences:noteOn});
      assertConflict(await mutate(actor,schange,s,{...on,shareBio:true}));
      assertConflict(await mutate(actor,nchange,n,{...noteOn,syncEnabled:true}));
      const operation=randomUUID();
      const held=successful(await mutate(actor,schange,s,withdrawn,operation),'Privacy withdrawal reaches terminal');
      assert.deepEqual(held,{status:'APPLIED',ownerUserId:actor.id,version:max,preferences:withdrawn});
      assertConflict(await mutate(actor,schange,s,withdrawn,operation));
      const redact=successful(await mutate(actor,schange,held,reduced),'Further privacy reduction at M');
      assert.deepEqual(redact,{status:'APPLIED',ownerUserId:actor.id,version:max,preferences:reduced});
      assertConflict(await mutate(actor,schange,redact,withdrawn));
      assert.deepEqual(successful(await mutate(actor,schange,redact,reduced),'Terminal no change'),
        {...redact,status:'NO_CHANGE'});
      const disabled=successful(await mutate(actor,nchange,n,allOff),'Disable notifications at M');
      assert.deepEqual(disabled,{status:'APPLIED',ownerUserId:actor.id,version:max,preferences:allOff});
      assertConflict(await mutate(actor,nchange,disabled,noteOn));
      assert.equal((await pg.query('SELECT count(*)::int n FROM kadmeion_private.owner_preference_cas_state WHERE owner_user_id=$1 AND (last_operation_id IS NOT NULL OR last_expected_version IS NOT NULL OR last_expected IS NOT NULL OR last_desired IS NOT NULL)',[actor.id])).rows[0].n,0);
      // Internal deletion is not a public setter; retain its terminal tombstone.
      assert.equal((await pg.query('DELETE FROM public.profile_sharing_preferences WHERE user_id=$1',[actor.id])).rowCount,1);
      assert.equal((await pg.query('DELETE FROM public.private_notification_preferences WHERE owner_user_id=$1',[actor.id])).rowCount,1);
      const tombstone={ownerUserId:actor.id,version:max,preferences:null};
      assert.deepEqual(successful(await read(actor,sread),'Terminal sharing tombstone'),tombstone);
      assert.deepEqual(successful(await read(actor,nread),'Terminal notification tombstone'),tombstone);
      assertConflict(await mutate(actor,schange,tombstone,reduced));
      assertConflict(await mutate(actor,nchange,tombstone,allOff));
      assert.equal(successful(await read(other,sread),'Other user unaffected').ownerUserId,other.id);
      const claims=JSON.parse(Buffer.from(actor.token.split('.')[1],'base64url').toString('utf8'));
      assert.equal(claims.sub,actor.id);assert.match(claims.session_id,/^[0-9a-f-]{36}$/i);
      assert.equal((await pg.query("UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 minute' WHERE id=$1 AND user_id=$2",[claims.session_id,actor.id])).rowCount,1);
      for(const name of [sread,nread]){
        const denied=await read(actor,name);assert.ok(!denied.ok,'Expired real owner session reached CAS state');
      }
      // Cascade must not recreate a private ledger or block real account cleanup.
      assert.equal((await pg.query('DELETE FROM auth.users WHERE id=$1',[actor.id])).rowCount,1);
      assert.equal((await pg.query('SELECT count(*)::int n FROM kadmeion_private.owner_preference_cas_state WHERE owner_user_id=$1',[actor.id])).rows[0].n,0);
    }finally{await pg.end();}
  });

test('C12 real local provider consent, SQL claim/finish, revoked late receipt and physical owner deletion',
  {timeout:120_000},async()=>{
  // Live GoTrue/JWT, local-only Supabase SQL; provider bytes are injected,
  // never fetched from GitHub or another external endpoint.
  const owner=await adminUser('c12-facts-owner');
  const other=await adminUser('c12-facts-foreign');
  const createLink=async(who,handle)=>successful(await send(
    '/rest/v1/private_platform_links?select=id',{
      ...json(who),method:'POST',
      headers:{'Content-Type':'application/json',Prefer:'return=representation'},
      body:{provider:'GITHUB',handle}
    }),'Create private GitHub link')[0].id;
  const link=await createLink(owner,'fixtureuser');
  const foreign=await createLink(other,'foreignuser');
  const rpc=(who,name,body)=>send('/rest/v1/rpc/'+name,{...json(who),method:'POST',body});
  const trusted=(name,body)=>send('/rest/v1/rpc/'+name,{
    method:'POST',key:cfg.service,bearer:cfg.service,
    headers:{'Content-Type':'application/json'},body
  });
  const change=(action,version)=>rpc(owner,'change_owner_github_provider_consent',{
    p_link_id:link,p_action:action,p_expected_version:version,
    p_operation_id:randomUUID(),p_policy_version:1
  });
  const claims=JSON.parse(Buffer.from(owner.token.split('.')[1],'base64url').toString('utf8'));
  assert.equal(claims.sub,owner.id);assert.match(claims.session_id,/^[0-9a-f-]{36}$/i);
  assert.equal(successful(await rpc(owner,'read_owner_github_provider_state',{p_link_id:link}),
    'Read private provider initial state').status,'OFF');
  assert.ok(!(await rpc(other,'read_owner_github_provider_state',{p_link_id:link})).ok,
    'Another owner must not access a provider link');
  const enabled=successful(await change('ENABLE',0),'Enable owner provider consent');
  assert.equal(enabled.status,'APPLIED');assert.equal(enabled.state.status,'READY');
  assert.equal(enabled.state.version,1);
  const attemptOp=randomUUID();
  const claim=successful(await trusted('service_claim_github_provider_sync',{
    p_owner_id:owner.id,p_session_id:claims.session_id,p_link_id:link,
    p_action:'LOOKUP',p_expected_version:enabled.state.version,
    p_operation_id:attemptOp,p_policy_version:1
  }),'Claim bounded local provider attempt');
  assert.equal(claim.status,'CLAIMED');
  assert.equal(claim.handle,'fixtureuser');
  assert.match(claim.attemptId,/^[0-9a-f-]{36}$/i);
  const completion={
    p_owner_id:owner.id,p_session_id:claims.session_id,p_link_id:link,
    p_claim_version:claim.state.version,p_attempt_id:claim.attemptId,
    p_outcome:'SUCCESS',p_login:'fixtureuser',p_provider_id:12345,
    p_html_url:'https://github.com/fixtureuser',p_public_repos:7,p_public_gists:2
  };
  const finished=successful(await trusted('service_finish_github_provider_sync',completion),
    'Finish injected provider fact receipt');
  assert.equal(finished.status,'APPLIED');
  assert.equal(finished.state.status,'AWAITING_CONFIRMATION');
  assert.equal(finished.state.candidate.id,12345);
  assert.equal(finished.state.facts,null);
  const revoked=successful(await change('DISABLE',finished.state.version),
    'Disable owner consent and erase candidate');
  assert.equal(revoked.state.status,'OFF');assert.equal(revoked.state.consent,false);
  assert.equal(revoked.state.candidate,null);assert.equal(revoked.state.facts,null);
  const delayed=successful(await trusted('service_finish_github_provider_sync',completion),
    'Replay stale completion after consent withdrawal');
  assert.equal(delayed.status,'IGNORED','Late provider bytes must not resurrect facts');
  const read=successful(await rpc(owner,'read_owner_github_provider_state',{p_link_id:link}),
    'Read persisted consent-off state');
  assert.equal(read.status,'OFF');assert.equal(read.facts,null);assert.equal(read.candidate,null);
  const raw=execFileSync('supabase',['status','-o','env'],{encoding:'utf8',timeout:20000});
  const match=raw.match(/^(?:export )?DB_URL=(.+)$/m);
  assert.ok(match,'Local database address missing');
  const db=new URL(match[1].trim().replace(/^["']|["']$/g,''));
  assert.equal(db.protocol,'postgresql:');
  assert.ok(['127.0.0.1','localhost'].includes(db.hostname));
  assert.equal(db.port,'54322');assert.equal(db.username,'postgres');
  assert.equal(db.pathname,'/postgres');
  const pg=new Client({host:db.hostname,port:Number(db.port),database:'postgres',
    user:'postgres',password:decodeURIComponent(db.password),ssl:false,
    connectionTimeoutMillis:3000,query_timeout:10000});
  try{
    await pg.connect();
    await pg.query('DELETE FROM public.private_platform_links WHERE id=$1',[link]);
    const afterLink=(await pg.query(
      'SELECT count(*)::int n FROM kadmeion_private.github_provider_state WHERE link_id=$1',[link])).rows[0].n;
    assert.equal(afterLink,0,'Deleting a link physically cascades its provider facts');
    assert.equal((await pg.query('DELETE FROM auth.users WHERE id=$1 RETURNING id',[owner.id])).rowCount,1);
    const counts=(await pg.query('SELECT '+
      '(SELECT count(*)::int FROM public.private_platform_links WHERE owner_user_id=$1) owner_links,'+
      '(SELECT count(*)::int FROM kadmeion_private.github_owner_quota WHERE owner_id=$1) owner_quotas,'+
      '(SELECT count(*)::int FROM public.private_platform_links WHERE id=$2) foreign_links,'+
      '(SELECT count(*)::int FROM auth.users WHERE id=$3) foreign_users',
      [owner.id,foreign,other.id])).rows[0];
    assert.deepEqual(counts,{owner_links:0,owner_quotas:0,foreign_links:1,foreign_users:1});
  }finally{await pg.end().catch(()=>{});}
});

// Verification-only S10/S13 companion: real disposable GoTrue and SQL, local
// Edge handler injection. The synthetic source is NOT a hosted provider or
// production fixture. No direct mutation except scoped clock/cleanup fixtures.
test('C12 local owner wire and Edge persist confirmed facts, enforce cooldown, and discard late disconnected results',
  {timeout:120_000},async()=>{
  const [{SupabasePrivateProviderFactsService,availableProviderActions},{createLocalProviderHandler}]=await Promise.all([
    import('../../packages/contracts/src/private-provider-facts-service.ts'),
    import('../../supabase/functions/sync-provider-facts/index.ts')
  ]);
  const actor=await adminUser('c12-edge-owner'),outsider=await adminUser('c12-edge-other');
  const raw=execFileSync('supabase',['status','-o','env'],{encoding:'utf8',timeout:20000});
  const match=raw.match(/^(?:export )?DB_URL=(.+)$/m);assert.ok(match,'Disposable local DB required');
  const db=new URL(match[1].trim().replace(/^["']|["']$/g,''));
  assert.equal(db.protocol,'postgresql:');assert.ok(['127.0.0.1','localhost'].includes(db.hostname));
  assert.equal(db.port,'54322');assert.equal(db.username,'postgres');assert.equal(db.pathname,'/postgres');
  const pg=new Client({host:db.hostname,port:Number(db.port),database:'postgres',user:'postgres',
    password:decodeURIComponent(db.password),ssl:false,connectionTimeoutMillis:3000,query_timeout:10000});
  const created=successful(await send('/rest/v1/private_platform_links?select=id',{
    ...json(actor),method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},
    body:{provider:'GITHUB',handle:'fixtureedgeowner'}
  }),'Create actual private provider link');
  assert.equal(created.length,1);const linkId=created[0].id;
  let sourceCalls=0,hold=null;
  const handler=createLocalProviderHandler({origin:cfg.origin,publishable:cfg.anon,serviceRole:cfg.service,
    http:(url,init)=>fetch(url,init),now:()=>Date.now(),allowedOrigins:[],provider:async(handle,signal)=>{
      assert.equal(handle,'fixtureedgeowner');assert.equal(signal.aborted,false);sourceCalls++;
      if(hold){const current=hold;current.enter();await current.wait;}
      return Response.json({login:handle,id:89123,html_url:'https://github.com/'+handle,
        public_repos:sourceCalls===1?3:8,public_gists:2,ignored:'not persisted'});
    }});
  const ownerService=who=>new SupabasePrivateProviderFactsService(cfg.origin,cfg.anon,who.id,
    async()=>who.token,()=>true,(url,init)=>String(url)===cfg.origin+'/functions/v1/sync-provider-facts'?
      handler(new Request(url,init)):fetch(url,init));
  const op=(version,operationId=randomUUID())=>({linkId,expectedVersion:version,operationId,policyVersion:1});
  const service=ownerService(actor);
  async function waitGlobal(){
    const end=Date.now()+25000;
    for(;;){const result=await pg.query('SELECT next_allowed_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<=clock_timestamp()) AND (blocked_until IS NULL OR blocked_until<=clock_timestamp()) AS ready FROM kadmeion_private.github_global_quota WHERE singleton');
      if(result.rows[0]?.ready===true)return;
      if(Date.now()>=end)throw Error('Disposable global provider cooldown did not become available');
      await new Promise(resolve=>setTimeout(resolve,100));}
  }
  async function expireOwnerCooldown(){
    assert.equal((await pg.query("UPDATE kadmeion_private.github_owner_quota SET next_allowed_at=clock_timestamp()-interval '1 second' WHERE owner_id=$1",[actor.id])).rowCount,1);
    await waitGlobal();
  }
  try{
    await pg.connect();await waitGlobal();
    const off=await service.readState(linkId);assert.equal(off.status,'OFF');assert.equal(sourceCalls,0);
    await assert.rejects(ownerService(outsider).readState(linkId));assert.equal(sourceCalls,0);
    const enabled=await service.changeConsent({...op(off.version),action:'ENABLE'});assert.equal(enabled.state.status,'READY');
    const lookup={...op(enabled.state.version),action:'LOOKUP'};
    const found=await service.sync(lookup);assert.equal(found.state.status,'AWAITING_CONFIRMATION');
    assert.equal(found.state.candidate.publicRepos,3);assert.equal(found.state.facts,null);assert.equal(sourceCalls,1);
    assert.equal((await service.sync(lookup)).status,'REPLAYED');assert.equal(sourceCalls,1);
    await assert.rejects(service.sync({...op(found.state.version),action:'LOOKUP'}),{code:'CONFLICT'});
    assert.equal(sourceCalls,1,'Unexpired candidate cannot be overwritten by another lookup');
    const confirmed=await service.confirmCandidate(op(found.state.version));assert.equal(confirmed.state.status,'SYNCED');
    assert.equal(confirmed.state.facts.publicRepos,3);assert.equal(confirmed.state.candidate,null);
    assert.ok(Date.parse(confirmed.state.cooldownUntil)>Date.now());
    assert.ok(!availableProviderActions(confirmed.state,Date.now()).includes('SYNC'));
    await assert.rejects(service.sync({...op(confirmed.state.version),action:'SYNC'}),{code:'RATE_LIMITED'});
    assert.equal(sourceCalls,1,'Server cooldown must deny before provider callback');
    await expireOwnerCooldown();
    const refreshed=await service.sync({...op(confirmed.state.version),action:'SYNC'});
    assert.equal(refreshed.state.facts.publicRepos,8);assert.equal(sourceCalls,2);
    const reloaded=await ownerService(actor).readState(linkId);
    assert.equal(reloaded.version,refreshed.state.version);assert.equal(reloaded.facts.publicRepos,8);
    assert.equal(reloaded.ownershipVerified,false);assert.equal(reloaded.facts.observedAt,null);
    const disabled=await service.changeConsent({...op(reloaded.version),action:'DISABLE'});
    assert.equal(disabled.state.status,'OFF');assert.equal(disabled.state.facts,null);
    assert.equal((await pg.query('SELECT count(*)::int n FROM kadmeion_private.github_provider_state WHERE link_id=$1 AND ((facts).provider_id IS NOT NULL OR (candidate).provider_id IS NOT NULL)',[linkId])).rows[0].n,0);
    const reenabled=await service.changeConsent({...op(disabled.state.version),action:'ENABLE'});
    await assert.rejects(service.sync({...op(reenabled.state.version),action:'LOOKUP'}),{code:'RATE_LIMITED'});
    assert.equal(sourceCalls,2,'Revocation and re-enable must not reset the server cooldown');
    await expireOwnerCooldown();
    const foundAgain=await service.sync({...op(reenabled.state.version),action:'LOOKUP'});
    const confirmedAgain=await service.confirmCandidate(op(foundAgain.state.version));
    assert.equal(confirmedAgain.state.facts.publicRepos,8);assert.equal(sourceCalls,3);
    await expireOwnerCooldown();
    let enter,release;const entered=new Promise(resolve=>{enter=resolve;});const wait=new Promise(resolve=>{release=resolve;});
    hold={enter,wait};
    const started=service.sync({...op(confirmedAgain.state.version),action:'SYNC'});
    // Attach immediately, so any pre-source rejection cannot become unhandled.
    const outcome=started.then(value=>({value}),error=>({error}));
    try{
      await Promise.race([entered,outcome.then(()=>{throw Error('Provider sync ended before delayed source began');})]);
      const deleted=successful(await send('/rest/v1/private_platform_links?id=eq.'+linkId+'&select=id',{
        ...json(actor),method:'DELETE',headers:{Prefer:'return=representation'}
      }),'Actual owner disconnect during provider request');
      assert.deepEqual(deleted,[{id:linkId}]);
    }finally{release();}
    const late=await outcome;assert.equal(late.error?.code,'CONFLICT');assert.equal(sourceCalls,4);
    assert.equal((await pg.query('SELECT count(*)::int n FROM kadmeion_private.github_provider_state WHERE link_id=$1',[linkId])).rows[0].n,0);
    await assert.rejects(ownerService(actor).readState(linkId));
    assert.ok((await send('/rest/v1/private_platform_links?select=id',{...bearer(outsider)})).ok);
    assert.equal((await pg.query('SELECT count(*)::int n FROM auth.users WHERE id=$1',[outsider.id])).rows[0].n,1);
  }finally{
    await pg.query('DELETE FROM auth.users WHERE id=ANY($1::uuid[])',[[actor.id,outsider.id]]).catch(()=>{});
    await pg.end().catch(()=>{});
  }
});
