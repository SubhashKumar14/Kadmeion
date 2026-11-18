/**
 * B4: real, LOCAL-ONLY direct PostgreSQL wire integration.
 *
 * No hosted DB writes, secrets, or service-role key in a static bundle.
 * psql is used as a real PostgreSQL protocol client here to avoid introducing
 * a runtime dependency before the approved worker/host is selected. A
 * per-test LOGIN role gets only USAGE on the private schema and EXECUTE on
 * the binding RPC. The production adapter uses the same positional SQL
 * statement and structural pg query port; no public PostgREST call is used.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {verifyReleaseWithdrawal,probePublicReplacementDenial,probePublicTakedownPlan} from '../../packages/storage-adapters/src/host-revocation-probe.ts';
import {once} from 'node:events';
import {SupabasePrivateFrozenRevisionLoader}
  from '../../packages/storage-adapters/src/private-frozen-revision-loader.ts';
import {SupabasePrivateReleasePointerService}
  from '../../packages/contracts/src/private-release-visibility-service.ts';
import {createPrivateImmutableArtifact,createPrivateImmutableMediaCandidateFromFrozenSlots}
  from '../../packages/storage-adapters/src/private-immutable-artifact.ts';
import {bindPrivateArtifactToPointer}
  from '../../packages/storage-adapters/src/private-artifact-pointer-binding.ts';
import {DirectSqlPrivateArtifactBindingWriter,storeAttestedFrozenMediaCandidate}
  from '../../packages/storage-adapters/src/private-artifact-direct-sql-writer.ts';
import {openPrivateArtifactPgWorker}
  from '../../packages/storage-adapters/src/private-artifact-pg-worker.ts';
import {publishConsentedUnlistedRelease, verifyActivatedUnlistedRelease}
  from '../../packages/storage-adapters/src/unlisted-release-verification.ts';
import {handleReviewerRequest} from '../../api/reviewer.mjs';
import {handlePublicPortfolio} from '../../api/public-portfolio.mjs';
import {handleUnlistedRequest} from '../../api/unlisted.mjs';
import {SupabasePrivateModerationService} from '../../packages/contracts/src/private-moderation-service.ts';

function localSettings(){
  assert.equal(process.env.KADMEION_LOCAL_INTEGRATION,'1',
    'A privileged database integration test requires explicit local opt-in');
  const raw=execFileSync('supabase',['status','-o','env'],
    {encoding:'utf8',timeout:20000});
  const vars=new Map();
  for(const line of raw.split(/\r?\n/)){
    const match=line.trim().match(/^(?:export )?([A-Z_]+)=(.*)$/);
    if(match)vars.set(match[1],match[2].trim().replace(/^["']|["']$/g,''));
  }
  const api=new URL(vars.get('API_URL')??'');
  const db=new URL(vars.get('DB_URL')??'');
  assert.equal(api.protocol,'http:');
  assert.ok(['127.0.0.1','localhost'].includes(api.hostname));
  assert.equal(api.port,'54321');
  assert.equal(db.protocol,'postgresql:');
  assert.ok(['127.0.0.1','localhost'].includes(db.hostname));
  assert.equal(db.port,'54322');
  assert.equal(db.username,'postgres');
  assert.equal(db.pathname,'/postgres');
  const anon=vars.get('ANON_KEY'),service=vars.get('SERVICE_ROLE_KEY');
  assert.ok(anon?.length>50&&service?.length>50,'Local test auth unavailable');
  return {origin:api.origin,db,anon,service};
}
const cfg=localSettings();

function dbQuery(script,{user='postgres',password=decodeURIComponent(cfg.db.password),
  vars={},extraEnv={}}={}){
  // -X ignores user psqlrc, -qAt returns only the final JSON/boolean value.
  // SQL text is fixed; variable data is escaped with psql's :'name' syntax.
  const args=['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'];
  for(const [name,value] of Object.entries(vars)){
    assert.match(name,/^[a-z][a-z_]*$/);
    args.push('-v',name+'='+String(value));
  }
  return execFileSync('psql',args,{
    input:script,encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024,
    env:{...process.env,PGHOST:cfg.db.hostname,PGPORT:cfg.db.port,
      PGDATABASE:'postgres',PGUSER:user,PGPASSWORD:password,
      PGSSLMODE:'disable',PGOPTIONS:'-c statement_timeout=10000',...extraEnv}
  }).trim();
}
async function api(path,{method='GET',jwt=cfg.anon,key=cfg.anon,body,headers={}}={}){
  const response=await fetch(cfg.origin+path,{
    method,headers:{apikey:key,Authorization:'Bearer '+jwt,
      'Content-Type':'application/json',...headers},
    body:body===undefined?undefined:JSON.stringify(body),
    cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)
  });
  return {ok:response.ok,status:response.status,
    data:await response.json().catch(()=>null)};
}
function ok(result,label){
  assert.ok(result.ok,label+' failed (HTTP '+result.status+')');
  return result.data;
}
async function ownerAccount(){
  const email='local-bind-'+randomUUID()+'@testing.invalid';
  const password='Local!'+randomUUID()+'x';
  const result=ok(await api('/auth/v1/admin/users',{method:'POST',jwt:cfg.service,
    key:cfg.service,body:{email,password,email_confirm:true}}),
    'Local owner fixture');
  const login=ok(await api('/auth/v1/token?grant_type=password',{
    method:'POST',body:{email,password}}),'Local owner login');
  assert.equal(login.user.id,result.id);
  return {id:result.id,jwt:login.access_token};
}
function rolePort(role,password){
  const queryScript=String.raw`PREPARE kd_private_bind (uuid,bigint,text,text) AS
select kadmeion_private.bind_private_artifact_candidate(
  $1::uuid, $2::bigint, $3::text, $4::text
) as receipt;
EXECUTE kd_private_bind(:'request',:'generation',:'manifest',:'html');`;
  return {
    async query(statement,params){
      // Fail closed rather than treating psql as a generic SQL execution API.
      assert.match(statement,/^select kadmeion_private\.bind_private_artifact_candidate\(/);
      assert.match(statement,/\$1::uuid, \$2::bigint, \$3::text, \$4::text/);
      assert.equal(params.length,4);
      const output=dbQuery(queryScript,{user:role,password,vars:{
        request:params[0],generation:params[1],
        manifest:params[2],html:params[3]
      }});
      return {rows:[{receipt:JSON.parse(output)}]};
    }
  };
}
test('B4: real local direct PostgreSQL binds verified owner artifact with scoped role',
  {timeout:180000},async t=>{
  const role='kd_ci_bind_'+randomBytes(6).toString('hex');
  const password=randomBytes(26).toString('hex');
  let created=false;
  let worker;
  try{
    dbQuery(String.raw`\getenv kd_bind_password KADMEION_LOCAL_BIND_PASSWORD
CREATE ROLE :"worker" LOGIN PASSWORD :'kd_bind_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT USAGE ON SCHEMA kadmeion_private TO :"worker";
GRANT EXECUTE ON FUNCTION kadmeion_private.bind_private_artifact_candidate(
  uuid,bigint,text,text) TO :"worker";
GRANT EXECUTE ON FUNCTION kadmeion_private.store_frozen_media_candidate(
  uuid,bigint,text,bytea[]) TO :"worker";`,
      {vars:{worker:role},extraEnv:{KADMEION_LOCAL_BIND_PASSWORD:password}});
    created=true;
    // Real node-postgres connection: restricted role, bounded pool and probe.
    const workerOptions={host:cfg.db.hostname,port:Number(cfg.db.port),
      database:'postgres',user:role,password,localOnly:true};
    await assert.rejects(openPrivateArtifactPgWorker({
      ...workerOptions,password:'invalid-credential-xxxxxxxxxxxx'
    }),{code:'CONNECTION_UNAVAILABLE'});
    worker=await openPrivateArtifactPgWorker(workerOptions);
    // Prove that a compromised SQL writer cannot browse underlying data.
    const flags=dbQuery(String.raw`select has_function_privilege(
  current_user,'kadmeion_private.bind_private_artifact_candidate(uuid,bigint,text,text)','EXECUTE')
  ||':'||has_table_privilege(
  current_user,'kadmeion_private.private_artifact_bindings','SELECT')
  ||':'||has_table_privilege(
  current_user,'public.private_release_visibility_pointers','UPDATE');`,
      {user:role,password});
    assert.equal(flags,'true:false:false');
    assert.throws(()=>dbQuery(
      'select count(*) from kadmeion_private.private_artifact_bindings;',
      {user:role,password}));

    const owner=await ownerAccount();
    const outsider=await ownerAccount();
    const createdPortfolio=ok(await api('/rest/v1/portfolios?select=id',{
      method:'POST',jwt:owner.jwt,body:{owner_user_id:owner.id,
        slug:'bind-ci-'+randomUUID().slice(0,8),title:'Private binding CI',
        template_id:'starter'},
      headers:{Prefer:'return=representation'}}),'Create owner portfolio');
    assert.equal(createdPortfolio.length,1);
    const portfolioId=createdPortfolio[0].id;
    const snapshot={formatVersion:1,
      files:{'kadmeion.json':JSON.stringify({formatVersion:1,seo:{
        title:'Local private release',description:'A verified integration test'}})},
      slots:{hero:{state:'S0',componentId:'title-stacked@1',
        content:{title:"Owner's checked artifact",subtitle:'Private, not hosted'}}},
      stashes:{}};
    const committed=ok(await api('/rest/v1/rpc/commit_portfolio_revision',{
      method:'POST',jwt:owner.jwt,body:{
        p_portfolio_id:portfolioId,p_operation_id:randomUUID(),
        p_base_revision:0,p_snapshot:snapshot}}),'Commit private revision');
    const frozen=ok(await api('/rest/v1/rpc/freeze_private_release_request',{
      method:'POST',jwt:owner.jwt,body:{
        p_portfolio_id:portfolioId,p_operation_id:randomUUID(),
        p_revision:committed.revision,p_visibility_intent:'UNLISTED'}}),
    'Freeze immutable private revision');

    const loader=new SupabasePrivateFrozenRevisionLoader(cfg.origin,cfg.anon,
      async()=>owner.jwt);
    const renderPlan=[{slotKey:'hero',componentId:'title-stacked@1',
      kind:'heading',required:true}];
    const evidence=await loader.load(frozen.requestId);
    const artifact=await createPrivateImmutableArtifact({...evidence,plan:renderPlan});
    const pointer=new SupabasePrivateReleasePointerService(cfg.origin,cfg.anon,
      async()=>owner.jwt);
    const prepared=await pointer.prepare(
      portfolioId,frozen.requestId,artifact.manifestSha256,0,randomUUID());
    assert.equal(prepared.status,'PREPARED_PRIVATE');

    // Outsider never gets the attested snapshot or owner private pointer.
    const outsiderLoader=new SupabasePrivateFrozenRevisionLoader(cfg.origin,
      cfg.anon,async()=>outsider.jwt);
    await assert.rejects(outsiderLoader.load(frozen.requestId));
    const outsiderPointer=new SupabasePrivateReleasePointerService(cfg.origin,
      cfg.anon,async()=>outsider.jwt);
    await assert.rejects(outsiderPointer.read(portfolioId));

    const writer=worker.writer;
    const legacyPsqlWriter=new DirectSqlPrivateArtifactBindingWriter(rolePort(role,password));
    const ctx={portfolioId,requestId:frozen.requestId,plan:renderPlan,
      loader,pointer,writer};
    const bound=await bindPrivateArtifactToPointer(ctx);
    assert.equal(bound.status,'BOUND_PRIVATE');
    assert.equal(bound.generation,1);
    assert.equal(bound.integrityChecked,true);
    assert.equal(bound.publicServingEnabled,false);
    assert.equal(bound.publicUrl,null);
    assert.equal((await bindPrivateArtifactToPointer(ctx)).alreadyBound,true);
    assert.equal((await bindPrivateArtifactToPointer({...ctx,writer:legacyPsqlWriter})).alreadyBound,true);


    // B4 real local HTTP: staging is invisible until a checked private bind.
    const trustedStage=ok(await api('/rest/v1/rpc/store_private_reviewer_stage_artifact',{
      method:'POST',jwt:cfg.service,key:cfg.service,
      body:{p_request_id:frozen.requestId,p_expected_generation:1,
        p_html:new TextDecoder().decode(artifact.files[0].bytes)}
    }),'Store private staged bytes with trusted service role');
    assert.equal(trustedStage.status,'STAGED_PRIVATE');
    assert.equal(trustedStage.htmlSha256,bound.htmlSha256);
    const reviewer=ok(await api('/rest/v1/rpc/issue_private_reviewer_grant',{
      method:'POST',jwt:owner.jwt,
      body:{p_request_id:frozen.requestId,p_operation_id:randomUUID(),
        p_valid_minutes:60}
    }),'Issue owner-scoped reviewer token');
    const getStaged=()=>api('/rest/v1/rpc/read_private_reviewer_stage_artifact',{
      method:'POST',jwt:cfg.service,key:cfg.service,
      body:{p_grant_id:reviewer.grantId,p_raw_token:reviewer.rawToken}});
    const reviewerPath='/r/'+reviewer.grantId+'.'+reviewer.rawToken;
    async function serveReviewer(url,headers,method='GET'){
      const request={method,url,headers};
      const response={
        statusCode:0,body:null,headers:new Map(),
        setHeader(name,value){this.headers.set(name.toLowerCase(),value);},
        end(body){this.body=body;}
      };
      await handleReviewerRequest(request,response,{env:{
        KADMEION_STAGING_DELIVERY_ENABLED:'true',
        KADMEION_LOCAL_INTEGRATION:'1',
        KADMEION_SUPABASE_URL:cfg.origin,
        KADMEION_SUPABASE_SERVICE_ROLE_KEY:cfg.service
      },http:fetch});
      return response;
    }
    const serveByHeader=()=>serveReviewer('/api/reviewer?g='+reviewer.grantId,
      {authorization:'Bearer '+reviewer.rawToken});
    const served=await serveReviewer(reviewerPath,{});
    assert.equal(served.statusCode,200);
    assert.equal(served.body,new TextDecoder().decode(artifact.files[0].bytes));
    assert.match(served.headers.get('cache-control'),/no-store/);
    assert.equal((await serveByHeader()).statusCode,200);
    const bytes=ok(await getStaged(),'Read real reviewer staging bytes');
    assert.equal(bytes.html,new TextDecoder().decode(artifact.files[0].bytes));
    assert.equal(bytes.publicServingEnabled,false);
    ok(await api('/rest/v1/rpc/revoke_private_reviewer_grant',{
      method:'POST',jwt:owner.jwt,body:{p_grant_id:reviewer.grantId}
    }),'Revoke real reviewer token');
    assert.equal(ok(await getStaged(),'Read revoked reviewer grant'),null);
    assert.equal((await serveByHeader()).statusCode,404);
    assert.equal((await serveReviewer(reviewerPath,{})).statusCode,404);

    // B4 UNLISTED activation requires distinct typed owner consent and
    // privileged probe/activation; no public request is served before that.
    const intent = await pointer.requestUnlistedPublication(
      frozen.requestId, prepared.generation, randomUUID(), 'PUBLISH UNLISTED');
    assert.equal(intent.status,'AWAITING_HOST');
    assert.equal(intent.publicServingEnabled,false);
    const publicRead=()=>api('/rest/v1/rpc/service_read_unlisted_release',{
      method:'POST',key:cfg.service,jwt:cfg.service,
      body:{p_portfolio_id:portfolioId}});
    assert.equal(ok(await publicRead(),'Unlisted absent before host probe'),null);
    const hostStage=ok(await api('/rest/v1/rpc/service_prepare_unlisted_release',{
      method:'POST',key:cfg.service,jwt:cfg.service,
      body:{p_intent_id:intent.intentId}
    }),'Trusted service prepared hidden unlisted candidate');
    assert.equal(hostStage.status,'PROBE_PENDING');
    assert.equal(hostStage.publicServingEnabled,false);
    assert.equal(ok(await publicRead(),'Unlisted unavailable during host probe'),null);
    const candidate=ok(await api('/rest/v1/rpc/service_probe_unlisted_release',{
      method:'POST',key:cfg.service,jwt:cfg.service,
      body:{p_portfolio_id:portfolioId}}),'Server-only probe');
    assert.equal(candidate.status,'PROBE_PENDING');
    assert.equal(candidate.htmlSha256,bound.htmlSha256);
    assert.equal(candidate.html,new TextDecoder().decode(artifact.files[0].bytes));
    const activated=ok(await api('/rest/v1/rpc/service_activate_unlisted_release',{
      method:'POST',key:cfg.service,jwt:cfg.service,
      body:{p_portfolio_id:portfolioId,
        p_expected_generation:hostStage.releaseGeneration,p_intent_id:candidate.intentId,
        p_html_sha256:bound.htmlSha256}
    }),'Internal unlisted activation without external host proof');
    assert.equal(activated.status,'ACTIVATED_NEEDS_EXTERNAL_HTTP_VERIFICATION');
    assert.equal(activated.publicUrl,null);
    assert.equal(ok(await publicRead(),'Read guarded live-unlisted SQL output').htmlSha256,
      bound.htmlSha256);

    const deliveryEnv = {
      KADMEION_UNLISTED_DELIVERY_ENABLED: 'true',
      KADMEION_PUBLIC_PORTFOLIO_ENABLED: 'true',
      KADMEION_LOCAL_INTEGRATION: '1',
      KADMEION_SUPABASE_URL: cfg.origin,
      KADMEION_SUPABASE_SERVICE_ROLE_KEY: cfg.service
    };
    let deliveryFailure = 'unavailable';
    const server = createServer((request, response) => {
      if (deliveryFailure === 'unavailable') {
        response.writeHead(503).end();
        return;
      }
      if (deliveryFailure === 'wrong-bytes') {
        response.writeHead(200, {
          'Content-Type': 'text/html', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'
        }).end('<!doctype html><title>Unexpected HTML</title>');
        return;
      }
      const handler = request.url.startsWith('/api/unlisted') ? handleUnlistedRequest : handlePublicPortfolio;
      void handler(request, response, {env: deliveryEnv});
    });
    server.listen(0, '127.0.0.1');
    t.after(() => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    }));
    await once(server, 'listening');
    const deliveryOrigin = 'http://127.0.0.1:' + server.address().port;
    deliveryEnv.KADMEION_RELEASE_HOST_ORIGIN=deliveryOrigin;
    deliveryEnv.KADMEION_RELEASE_HOSTNAME='127.0.0.1';
    const verificationPorts = {
      origin: deliveryOrigin,
      rpc: async (operation, body) => ok(await api('/rest/v1/rpc/' + operation, {
        method: 'POST', key: cfg.service, jwt: cfg.service, body
      }), operation)
    };
    const verifyDelivery = (probe) => verifyActivatedUnlistedRelease({
      portfolioId, intentId: probe.intentId, htmlSha256: probe.htmlSha256
    }, verificationPorts);

    assert.deepEqual(await publishConsentedUnlistedRelease(intent.intentId, verificationPorts),
      {status: 'DELIVERY_REVOKED'});
    assert.equal(ok(await publicRead(), 'No release after failed first activation'), null);
    deliveryFailure = null;

    async function publicHostRead() {
      const response = await fetch(deliveryOrigin + '/api/unlisted?portfolioId=' + portfolioId);
      return {statusCode: response.status, headers: response.headers, body: await response.text()};
    }
    const initialConsent = await consentAndProbe(prepared.generation);
    ok(await api('/rest/v1/rpc/service_activate_unlisted_release', {
      method: 'POST', key: cfg.service, jwt: cfg.service,
      body: {p_portfolio_id: portfolioId, p_expected_generation: initialConsent.releaseGeneration,
        p_intent_id: initialConsent.intentId, p_html_sha256: initialConsent.htmlSha256}
    }), 'Activate initial release again with fresh consent');
    const site = await publicHostRead();
    assert.equal(site.statusCode, 200);
    assert.equal(site.body, new TextDecoder().decode(artifact.files[0].bytes));
    assert.match(site.headers.get('cache-control'), /no-store/);
    assert.match(site.headers.get('content-security-policy'), /script-src 'none'/);

    const acknowledgeRelease = (probe) => api('/rest/v1/rpc/service_acknowledge_unlisted_release', {
      method: 'POST', key: cfg.service, jwt: cfg.service,
      body: {p_portfolio_id: portfolioId, p_intent_id: probe.intentId,
        p_html_sha256: probe.htmlSha256}
    });

    async function prepareReplacement(previousGeneration) {
      const next = await pointer.prepare(portfolioId, frozen.requestId,
        artifact.manifestSha256, previousGeneration, randomUUID());
      await bindPrivateArtifactToPointer(ctx);
      ok(await api('/rest/v1/rpc/store_private_reviewer_stage_artifact', {
        method: 'POST', jwt: cfg.service, key: cfg.service,
        body: {p_request_id: frozen.requestId, p_expected_generation: next.generation,
          p_html: site.body}
      }), 'Store replacement bytes');
      return consentAndProbe(next.generation);
    }
    async function consentAndProbe(generation) {
      const consent = await pointer.requestUnlistedPublication(
        frozen.requestId, generation, randomUUID(), 'PUBLISH UNLISTED');
      ok(await api('/rest/v1/rpc/service_prepare_unlisted_release', {
        method: 'POST', key: cfg.service, jwt: cfg.service,
        body: {p_intent_id: consent.intentId}
      }), 'Prepare replacement');
      return ok(await api('/rest/v1/rpc/service_probe_unlisted_release', {
        method: 'POST', key: cfg.service, jwt: cfg.service,
        body: {p_portfolio_id: portfolioId}
      }), 'Probe replacement');
    }
    const superseded = await prepareReplacement(prepared.generation);
    const distinctGeneration = await prepareReplacement(superseded.releaseGeneration);
    const replacement = await consentAndProbe(distinctGeneration.releaseGeneration);
    assert.equal(replacement.htmlSha256, superseded.htmlSha256);
    assert.equal((await publicHostRead()).body, site.body,
      'The current live release stays available while replacements are pending');
    const activateReplacement = (probe) => api('/rest/v1/rpc/service_activate_unlisted_release', {
      method: 'POST', key: cfg.service, jwt: cfg.service,
      body: {p_portfolio_id: portfolioId, p_expected_generation: probe.releaseGeneration,
        p_intent_id: probe.intentId, p_html_sha256: probe.htmlSha256}
    });
    for (const probe of [superseded, distinctGeneration]) {
      const staleProbe = await activateReplacement(probe);
      assert.equal(staleProbe.data?.code, '40001',
        'A superseded consent cannot activate a replacement with identical bytes');
    }
    const beforeAck = await activateReplacement(replacement);
    assert.equal(beforeAck.data?.message, 'UNLISTED_VERIFICATION_PENDING');
    assert.deepEqual(await verifyDelivery(initialConsent), {
      status: 'DELIVERY_ACKNOWLEDGED', htmlSha256: initialConsent.htmlSha256
    });
    const promoted = ok(await activateReplacement(replacement), 'Promote the current replacement');
    assert.equal(promoted.releaseGeneration, replacement.releaseGeneration);
    assert.equal((await publicHostRead()).body, site.body);

    const recoverRelease = (probe) => api('/rest/v1/rpc/service_recover_failed_unlisted_release', {
      method: 'POST', key: cfg.service, jwt: cfg.service,
      body: {p_portfolio_id: portfolioId, p_failed_intent_id: probe.intentId}
    });
    assert.equal((await recoverRelease(distinctGeneration)).data?.code, '40001',
      'A delayed failure must not roll back a newer activation');
    deliveryFailure = 'wrong-bytes';
    assert.deepEqual(await verifyDelivery(replacement), {
      status: 'PRIOR_RELEASE_RESTORED', releaseGeneration: initialConsent.releaseGeneration
    });
    deliveryFailure = null;
    assert.equal((await publicHostRead()).body, site.body);
    assert.equal((await recoverRelease(replacement)).data?.code, '40001');
    assert.equal((await acknowledgeRelease(replacement)).data?.code, '40001');
    const activeAgain = await pointer.requestUnlistedPublication(
      frozen.requestId, replacement.releaseGeneration, randomUUID(), 'PUBLISH UNLISTED');
    const expectedDelivery = {status: 'DELIVERY_ACKNOWLEDGED', htmlSha256: bound.htmlSha256};
    assert.deepEqual(await publishConsentedUnlistedRelease(activeAgain.intentId, verificationPorts), expectedDelivery);
    assert.deepEqual(await publishConsentedUnlistedRelease(activeAgain.intentId, verificationPorts), expectedDelivery);
    assert.equal((await publicHostRead()).statusCode, 200);
    assert.equal((await recoverRelease(activeAgain)).data?.code, '40001',
      'A failure report cannot undo an acknowledged release');

    const timeline = ok(await api('/rest/v1/verified_unlisted_releases?select=intent_id,request_id,verified_at', {
      jwt: owner.jwt
    }), 'List verified release history');
    assert.deepEqual(new Set(timeline.map(release => release.intent_id)),
      new Set([initialConsent.intentId, activeAgain.intentId]));
    assert.deepEqual(ok(await api('/rest/v1/verified_unlisted_releases?select=intent_id', {
      jwt: outsider.jwt
    }), 'Outsider cannot list verified release history'), []);
    const rollbackOperation = randomUUID();
    await assert.rejects(outsiderPointer.requestUnlistedRollback(
      initialConsent.intentId, activeAgain.intentId, replacement.releaseGeneration,
      rollbackOperation, 'ROLL BACK UNLISTED'), {code: 'FORBIDDEN'});
    await assert.rejects(pointer.requestUnlistedRollback(
      initialConsent.intentId, activeAgain.intentId, replacement.releaseGeneration - 1,
      rollbackOperation, 'ROLL BACK UNLISTED'), {code: 'CONFLICT'});
    const rollback = await pointer.requestUnlistedRollback(
      initialConsent.intentId, activeAgain.intentId, replacement.releaseGeneration,
      rollbackOperation, 'ROLL BACK UNLISTED');
    assert.equal((await pointer.requestUnlistedRollback(
      initialConsent.intentId, activeAgain.intentId, replacement.releaseGeneration,
      rollbackOperation, 'ROLL BACK UNLISTED')).intentId, rollback.intentId);
    assert.deepEqual(await publishConsentedUnlistedRelease(rollback.intentId, verificationPorts),
      expectedDelivery);
    assert.deepEqual(ok(await api('/rest/v1/verified_unlisted_releases?select=intent_id&intent_id=eq.' +
      rollback.intentId, {jwt: owner.jwt}), 'Read acknowledged rollback'), [{intent_id: rollback.intentId}]);
    assert.equal((await pointer.read(portfolioId)).generation, replacement.releaseGeneration);

    const direct={requestId:frozen.requestId,expectedGeneration:replacement.releaseGeneration,
      manifestJson:JSON.stringify(artifact.manifest),
      html:new TextDecoder().decode(artifact.files[0].bytes)};
    // Each attempt is rejected by the actual DB, not by a mock query port.
    for(const patch of [
      {html:direct.html.replace('Owner&#39;s','Forged')},
      {manifestJson:direct.manifestJson+' '},
      {manifestJson:'{"kind":"forged"}'},
      {expectedGeneration:replacement.releaseGeneration-1},
      {requestId:randomUUID()}
    ]){
      await assert.rejects(writer.bindPrivateArtifact({...direct,...patch}),
        {code:'SQL_UNCONFIRMED'});
    }

    // Revoke AFTER the orchestrator reads a prepared pointer but BEFORE its
    // direct SQL bind. The DB must reject the stale generation atomically.
    const raced={...ctx,writer:{bindPrivateArtifact:async request=>{
      await pointer.block(portfolioId,randomUUID());
      return writer.bindPrivateArtifact(request);
    }}};
    await assert.rejects(bindPrivateArtifactToPointer(raced),{
      code:'BINDING_UNCONFIRMED'});
    await assert.rejects(bindPrivateArtifactToPointer(ctx),{code:'POINTER_CONFLICT'});
    await assert.rejects(writer.bindPrivateArtifact(direct),{code:'SQL_UNCONFIRMED'});
    assert.equal(ok(await publicRead(),'Blocked unlisted route'),null);
    assert.equal((await publicHostRead()).statusCode,404,
      'Owner unpublish must deny the previously live unlisted HTTP URL');
    assert.equal((await recoverRelease(rollback)).data?.code, '40001',
      'A host failure report must not revive an unpublished release');
    const after=await pointer.read(portfolioId);
    assert.equal(after.status,'BLOCKED');
    assert.equal(after.publicServingEnabled,false);

    const handle = 'portfolio_' + randomUUID().slice(0, 8);
    ok(await api('/rest/v1/profiles?user_id=eq.' + owner.id, {
      method: 'PATCH', jwt: owner.jwt, body: {handle}
    }), 'Claim canonical public handle');
    const [{slug}] = ok(await api('/rest/v1/portfolios?select=slug&id=eq.' + portfolioId,
      {jwt: owner.jwt}), 'Read portfolio slug');
    const publicFrozen = ok(await api('/rest/v1/rpc/freeze_private_release_request', {
      method: 'POST', jwt: owner.jwt, body: {p_portfolio_id: portfolioId,
        p_operation_id: randomUUID(), p_revision: committed.revision, p_visibility_intent: 'PUBLIC'}
    }), 'Freeze explicit public visibility');
    const publicArtifact = await createPrivateImmutableArtifact({
      ...await loader.load(publicFrozen.requestId), plan: renderPlan
    });
    const publicPointer = await pointer.prepare(portfolioId, publicFrozen.requestId,
      publicArtifact.manifestSha256, after.generation, randomUUID());
    await bindPrivateArtifactToPointer({...ctx, requestId: publicFrozen.requestId});
    const publicHtml = new TextDecoder().decode(publicArtifact.files[0].bytes);
    ok(await api('/rest/v1/rpc/store_private_reviewer_stage_artifact', {
      method: 'POST', key: cfg.service, jwt: cfg.service, body: {p_request_id: publicFrozen.requestId,
        p_expected_generation: publicPointer.generation, p_html: publicHtml}
    }), 'Stage public artifact without indexing');
    const canonical = deliveryOrigin + '/' + handle + '/' + slug;
    assert.equal((await fetch(canonical)).status, 404);
    await assert.rejects(pointer.requestUnlistedPublication(publicFrozen.requestId,
      publicPointer.generation, randomUUID(), 'PUBLISH UNLISTED'), {code: 'FORBIDDEN'});
    // C11 PUBLIC requires a separately bound authoritative service receipt.
    // This branch is a disposable integration diagnostic, not an owner branch edit.
    const authorityRpc=(operation,body,credentials={key:cfg.service,jwt:cfg.service})=>
      api('/rest/v1/rpc/'+operation,{method:'POST',...credentials,body});
    const publishPublic=async(consent,requestId,operationId,targetPortfolioId=portfolioId)=>{
      const expectedConsent={portfolioId:targetPortfolioId,requestId,operationId,visibility:'PUBLIC'};
      let acknowledgements=0;
      const result=await publishConsentedUnlistedRelease(consent.intentId,{
        ...verificationPorts,expectedConsent,
        rpc:async(operation,body)=>{
          assert.ok(['service_prepare_unlisted_release','service_probe_unlisted_release',
            'service_activate_unlisted_release'].includes(operation),
          'PUBLIC must never use legacy UNLISTED mutation '+operation);
          return verificationPorts.rpc(operation,body);
        },
        publicAuthority:async(operation,body)=>{
          if(operation==='service_acknowledge_public_delivery'){
            const before=body.p_expected_receipt;
            assert.equal(before.intentId,consent.intentId);
            assert.equal(before.requestId,requestId);
            assert.equal(before.operationId,operationId);
            assert.equal(before.verifiedAt,null);
            // The exact unacknowledged PUBLIC canary must reject the old ACK,
            // even using the trusted service role; no insecure compatibility path.
            const old=await authorityRpc('service_acknowledge_unlisted_release',{
              p_portfolio_id:targetPortfolioId,p_intent_id:consent.intentId,p_html_sha256:before.storedHtmlSha256
            });
            assert.equal(old.ok,false,'Legacy PUBLIC ACK is prohibited');
            assert.equal(old.data?.code,'40001');
            for(const credentials of [{key:cfg.anon,jwt:owner.jwt},{key:cfg.anon,jwt:cfg.anon}]){
              const read=await authorityRpc('service_read_current_public_delivery_receipt',{
                p_portfolio_id:targetPortfolioId,p_intent_id:consent.intentId
              },credentials);
              assert.equal(read.ok,false,'Authority receipt is service-only');
              const denied=await authorityRpc(operation,body,credentials);
              assert.equal(denied.ok,false,'Authority ACK is service-only');
            }
            assert.deepEqual(ok(await authorityRpc('service_read_current_public_delivery_receipt',{
              p_portfolio_id:targetPortfolioId,p_intent_id:consent.intentId
            }),'Read unchanged C11 canary'),before);
            const after=ok(await authorityRpc(operation,body),'C11 atomic acknowledge');
            assert.equal(after.deliveryEpoch,before.deliveryEpoch+1);
            assert.ok(after.verifiedAt);
            acknowledgements++;
            return after;
          }
          return ok(await authorityRpc(operation,body),operation);
        }
      });
      assert.equal(result.status,'DELIVERY_ACKNOWLEDGED');
      assert.equal(acknowledgements,1);
      const receipt=result.authoritativePublicReceipt;
      assert.equal(receipt.portfolioId,targetPortfolioId);
      assert.equal(receipt.requestId,requestId);
      assert.equal(receipt.operationId,operationId);
      assert.equal(receipt.visibility,'PUBLIC');
      assert.equal(receipt.intentId,consent.intentId);
      assert.equal(result.observedPublicDelivery.observedHttpRequests,4+2*receipt.assetHashes.length);
      assert.deepEqual(ok(await authorityRpc('service_read_current_public_delivery_receipt',{
        p_portfolio_id:targetPortfolioId,p_intent_id:consent.intentId
      }),'Read acknowledged authority'),receipt);
      return receipt;
    };
    const publicOperation=randomUUID();
    const publicConsent=await pointer.requestPublicPublication(publicFrozen.requestId,
      publicPointer.generation,publicOperation,'PUBLISH PUBLIC');
    const firstPublicReceipt=await publishPublic(publicConsent,publicFrozen.requestId,publicOperation);
    assert.equal(firstPublicReceipt.mediaManifest,null);
    const canonicalResponse = await fetch(canonical);
    assert.equal(canonicalResponse.status, 200);
    assert.equal(canonicalResponse.headers.get('x-robots-tag'), 'index, follow');
    assert.match(await canonicalResponse.text(), /content="index,follow"/);
    assert.equal((await publicHostRead()).statusCode, 404);
    assert.equal((await fetch(canonical + '/assets/secret.png')).status, 404);
    const updateSnapshot=structuredClone(snapshot);
    updateSnapshot.slots.hero.content.title='Replacement verified content';
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPgEpH7DwABpAE8k4sOtwAAAABJRU5ErkJggg==','base64');
    const assetId=randomUUID();
    const sourceSha256=createHash('sha256').update(png).digest('hex');
    updateSnapshot.slots.image={state:'S0',componentId:'image@1',
      content:{asset_id:assetId,source_sha256:sourceSha256,alt_text:'Fixture image'}};

    const replacementRevision=ok(await api('/rest/v1/rpc/commit_portfolio_revision',{
      method:'POST',jwt:owner.jwt,body:{p_portfolio_id:portfolioId,p_operation_id:randomUUID(),
        p_base_revision:committed.revision,p_snapshot:updateSnapshot}
    }),'Commit replacement public content');
    const replacementFrozen=ok(await api('/rest/v1/rpc/freeze_private_release_request',{
      method:'POST',jwt:owner.jwt,body:{p_portfolio_id:portfolioId,p_operation_id:randomUUID(),
        p_revision:replacementRevision.revision,p_visibility_intent:'PUBLIC'}
    }),'Freeze replacement public content');
    const frozenMedia={...await loader.load(replacementFrozen.requestId),plan:[...renderPlan,
      {slotKey:'image',componentId:'image@1',kind:'image',required:true}]};
    const reader={readFrozenPinnedImage:async pins=>({
      ...pins,sourceSha256,mimeType:'image/png',storageVersion:'integration_fixture',bytes:png
    })};
    const secondPublicArtifact=await createPrivateImmutableMediaCandidateFromFrozenSlots(frozenMedia,reader);
    const replacementPointer=await pointer.prepare(portfolioId,replacementFrozen.requestId,
      secondPublicArtifact.manifestSha256,publicPointer.generation,randomUUID());
    const mediaPort={async query(sql,[request,generation,manifest,files]){
      assert.match(sql,/kadmeion_private\.store_frozen_media_candidate/);
      assert.equal(files.length,2);
      const value=dbQuery(String.raw`select kadmeion_private.store_frozen_media_candidate(
        :'request'::uuid,:'generation'::bigint,:'manifest',
        array[decode(:'html','hex'),decode(:'png','hex')]);`,
      {user:role,password,vars:{request,generation,manifest,html:files[0].toString('hex'),png:files[1].toString('hex')}});
      return {rows:[{receipt:JSON.parse(value)}]};
    }};
    const stagedMedia=await storeAttestedFrozenMediaCandidate(mediaPort,{
      requestId:replacementFrozen.requestId,expectedGeneration:replacementPointer.generation,input:frozenMedia
    },reader);
    assert.equal(stagedMedia.status,'STORED_PRIVATE');
    const imageHash=createHash('sha256').update(secondPublicArtifact.files[1].bytes).digest('hex');
    const newGrant=ok(await api('/rest/v1/rpc/issue_private_reviewer_grant',{
      method:'POST',jwt:owner.jwt,body:{p_request_id:replacementFrozen.requestId,
        p_operation_id:randomUUID(),p_valid_minutes:60}
    }),'Issue separate scoped media reviewer');
    const mediaQuery='&manifest='+stagedMedia.manifestSha256+'&asset='+imageHash;
    const reviewerImage='/api/reviewer?review='+newGrant.grantId+'.'+newGrant.rawToken+mediaQuery;
    assert.equal((await serveReviewer('/r/'+newGrant.grantId+'.'+newGrant.rawToken,{})).statusCode,200);
    for(const method of ['GET','HEAD']){
      const trustedImage=await serveReviewer(reviewerImage,{},method);
      assert.equal(trustedImage.statusCode,200);
      assert.match(trustedImage.headers.get('cache-control'),/no-store/);
      assert.deepEqual(trustedImage.body,method==='HEAD'?'':Buffer.from(secondPublicArtifact.files[1].bytes));
    }
    ok(await api('/rest/v1/rpc/revoke_private_reviewer_grant',{
      method:'POST',jwt:owner.jwt,body:{p_grant_id:newGrant.grantId}
    }),'Revoke scoped media reviewer');
    for(const method of ['GET','HEAD'])
      assert.equal((await serveReviewer(reviewerImage,{},method)).statusCode,404,'Revoked reviewer media');

    const expiringGrant=ok(await api('/rest/v1/rpc/issue_private_reviewer_grant',{
      method:'POST',jwt:owner.jwt,body:{p_request_id:replacementFrozen.requestId,
        p_operation_id:randomUUID(),p_valid_minutes:15}
    }),'Issue media reviewer for expiry test');
    const expiringImage='/api/reviewer?review='+expiringGrant.grantId+'.'+expiringGrant.rawToken+mediaQuery;
    assert.equal((await serveReviewer(expiringImage,{})).statusCode,200);
    const expired=dbQuery(String.raw`update public.private_reviewer_grants
      set created_at=now()-interval '16 minutes', expires_at=now()-interval '1 minute'
      where id=:'grant_id'::uuid and revoked_at is null returning id;`,
      {vars:{grant_id:expiringGrant.grantId}});
    assert.equal(expired,expiringGrant.grantId);
    for(const method of ['GET','HEAD']){
      const denied=await serveReviewer(expiringImage,{},method);
      assert.equal(denied.statusCode,404,'Expired reviewer media');
      assert.match(denied.headers.get('cache-control'),/no-store/);
    }
    const replacementOperation=randomUUID();
    const replacementConsent=await pointer.requestPublicPublication(replacementFrozen.requestId,
      replacementPointer.generation,replacementOperation,'PUBLISH PUBLIC');
    const secondPublicReceipt=await publishPublic(replacementConsent,replacementFrozen.requestId,replacementOperation);
    assert.equal(secondPublicReceipt.mediaManifest,stagedMedia.manifestSha256);
    assert.deepEqual(secondPublicReceipt.assetHashes,[imageHash]);
    assert.ok(secondPublicReceipt.deliveryEpoch>firstPublicReceipt.deliveryEpoch);
    assert.equal(ok(await authorityRpc('service_read_current_public_delivery_receipt',{
      p_portfolio_id:portfolioId,p_intent_id:publicConsent.intentId
    }),'Read retired A authority'),null);
    assert.match(await (await fetch(canonical)).text(),/Replacement verified content/);
    const directImage=deliveryOrigin+'/api/public-portfolio?handle='+handle+'&slug='+slug+mediaQuery;
    const staleManifest=new URL(directImage);
    staleManifest.searchParams.set('manifest',publicArtifact.manifestSha256);
    for(const method of ['GET','HEAD']){
      const publicImage=await fetch(directImage,{method});
      assert.equal(publicImage.status,200);
      assert.match(publicImage.headers.get('cache-control'),/no-store/);
      const bytes=Buffer.from(await publicImage.arrayBuffer());
      assert.deepEqual(bytes,method==='HEAD'?Buffer.alloc(0):Buffer.from(secondPublicArtifact.files[1].bytes));
      assert.equal((await fetch(staleManifest,{method})).status,404,'Stale manifest cannot read replacement media');
    }

    // R10 C14 report intake uses the actual local PUBLIC handler and durable RPCs,
    // not an injected report queue or service-role review of a fabricated row.
    const operator=await ownerAccount();
    dbQuery("insert into kadmeion_private.operator_roles(user_id,role) values (:'actor'::uuid,'administrator');",
      {vars:{actor:operator.id}});
    const moderation=new SupabasePrivateModerationService(cfg.origin,cfg.anon,async()=>operator.jwt);
    const ownerModeration=new SupabasePrivateModerationService(cfg.origin,cfg.anon,async()=>owner.jwt);
    const outsiderModeration=new SupabasePrivateModerationService(cfg.origin,cfg.anon,async()=>outsider.jwt);
    const evidenceText='Disposable local report about the currently verified portfolio publication.';
    const reportInput={operationId:randomUUID(),reason:'ABUSE',evidence:evidenceText};
    const submitReport=body=>fetch(canonical,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
    const received=await submitReport(reportInput);
    assert.equal(received.status,202);
    assert.deepEqual(await received.json(),{status:'RECEIVED_FOR_REVIEW'});
    assert.equal((await submitReport(reportInput)).status,202,'Exact replay accepted only as received');
    assert.equal((await submitReport({...reportInput,operationId:randomUUID()})).status,202,'Same-content duplicate deduplicates');
    assert.equal((await submitReport({...reportInput,evidence:evidenceText+' Changed.'})).status,409);
    assert.equal(dbQuery("select count(*) from kadmeion_private.portfolio_abuse_reports where portfolio_id=:'portfolio'::uuid;",
      {vars:{portfolio:portfolioId}}),'1');
    for(let i=1;i<12;i++)assert.equal((await submitReport({operationId:randomUUID(),reason:'SPAM',
      evidence:'Distinct disposable local quota-review report number '+i})).status,202);
    assert.equal((await submitReport({operationId:randomUUID(),reason:'SPAM',
      evidence:'Distinct disposable local quota-review overflow report'})).status,429);
    await assert.rejects(outsiderModeration.listAbuseReports(null,50),{code:'FORBIDDEN'});
    const receivedReport=(await moderation.listAbuseReports(null,50)).find(item=>item.evidence===evidenceText);
    assert.ok(receivedReport,'Report must be visible through the real authorized queue');
    const reviewReason='Administrator reviewed the documented report; no restriction is implicit.';
    const reportDecision=await moderation.reviewAbuseReport(receivedReport.id,'CASE_OPENED',reviewReason);
    assert.ok(reportDecision.caseId);
    assert.deepEqual(await moderation.reviewAbuseReport(receivedReport.id,'CASE_OPENED',reviewReason),reportDecision);
    await assert.rejects(moderation.reviewAbuseReport(receivedReport.id,'DISMISSED',reviewReason),{code:'CONFLICT'});
    assert.equal((await moderation.readAccountSharingRestriction(reportDecision.caseId,owner.id)).status,'CLEAR');
    assert.equal((await fetch(canonical)).status,200,'Report review alone cannot revoke public sharing');
    const ownerReportCase=await ownerModeration.readOwnerCase(reportDecision.caseId);
    assert.equal(ownerReportCase.summary,reviewReason);
    assert.equal(await outsiderModeration.readOwnerCase(reportDecision.caseId),null);
    assert.ok(!JSON.stringify(ownerReportCase).includes(evidenceText),'Raw visitor report remains operator-only');
    await assert.rejects(outsiderPointer.requestPublicRollback(publicConsent.intentId,replacementConsent.intentId,
      replacementPointer.generation,randomUUID(),'ROLL BACK PUBLIC'),{code:'FORBIDDEN'});
    const publicRollbackOperation=randomUUID();
    const publicRollback=await pointer.requestPublicRollback(publicConsent.intentId,replacementConsent.intentId,
      replacementPointer.generation,publicRollbackOperation,'ROLL BACK PUBLIC');
    const rollbackReceipt=await publishPublic(publicRollback,publicFrozen.requestId,publicRollbackOperation);
    assert.ok(rollbackReceipt.deliveryEpoch>secondPublicReceipt.deliveryEpoch);
    assert.equal(rollbackReceipt.storedHtmlSha256,firstPublicReceipt.storedHtmlSha256);
    const canonicalPath='/'+handle+'/'+slug;
    const scopeA={canonicalPath,manifestSha256:null,assetHashes:[]};
    const scopeB={canonicalPath,manifestSha256:secondPublicReceipt.mediaManifest,
      assetHashes:secondPublicReceipt.assetHashes};
    const retired=await probePublicReplacementDenial({
      origin:deliveryOrigin,current:scopeA,history:[scopeB],allowLocal:true
    });
    assert.equal(retired.status,'OBSERVED_REPLACED_SCOPE_DENIED');
    assert.equal(retired.observedHttpRequests,2);
    assert.equal(ok(await authorityRpc('service_read_current_public_delivery_receipt',{
      p_portfolio_id:portfolioId,p_intent_id:replacementConsent.intentId
    }),'Read retired B authority'),null);
    assert.match(await (await fetch(canonical)).text(),/Owner&#39;s checked artifact/);
    for(const method of ['GET','HEAD'])
      assert.equal((await fetch(directImage,{method})).status,404,'Rollback withdraws replaced media');
    assert.equal((await publicHostRead()).statusCode,404,'Public rollback must keep the unlisted alias unavailable');
    const changeHandle=async(nextHandle)=>{
      ok(await api('/rest/v1/profiles?user_id=eq.' + owner.id, {
        method: 'PATCH', jwt: owner.jwt, body: {handle: nextHandle}
      }), 'Change canonical address');
    };
    const servedPublicSha=createHash('sha256').update(publicHtml.replace(
      '<meta name="robots" content="noindex,nofollow,noarchive">',
      '<meta name="robots" content="index,follow">'
    )).digest('hex');
    const revoked=await verifyReleaseWithdrawal({origin:deliveryOrigin,
      canonicalPath:'/'+handle+'/'+slug,candidateDirectPaths:['/'+handle+'/'+slug+'/assets/secret.png'],
      allowLocal:true},servedPublicSha,()=>changeHandle('changed_'+handle));
    assert.equal(revoked.observedHttpRequests,6);
    // Canonical live GET+HEAD plus canonical/direct denial GET+HEAD.
    for (const nextHandle of ['changed_'+handle,handle]) {
      if(nextHandle===handle)await changeHandle(handle);
      assert.equal((await fetch(canonical)).status, 404);
      assert.equal((await fetch(deliveryOrigin + '/' + nextHandle + '/' + slug)).status, 404);
    }

    // Renaming and returning to the old address cannot resurrect either
    // manifest. Observe actual canonical, direct API, report and PNG GET/HEAD.
    const renamed='/changed_'+handle+'/'+slug;
    const deniedPlan=await probePublicTakedownPlan({origin:deliveryOrigin,allowLocal:true,
      scopes:[scopeA,scopeB,{...scopeA,canonicalPath:renamed},{...scopeB,canonicalPath:renamed}]});
    assert.equal(deniedPlan.status,'OBSERVED_TAKEDOWN_ON_SCOPED_PATHS');
    assert.equal(deniedPlan.observedHttpRequests,16);
    assert.equal(ok(await authorityRpc('service_read_current_public_delivery_receipt',{
      p_portfolio_id:portfolioId,p_intent_id:publicRollback.intentId
    }),'Read retired rollback authority'),null);

    // The original B4 portfolio has exhausted the actual five-generation
    // stage cap. Keep every original artifact and denial assertion intact.
    // A separate disposable portfolio belonging to the SAME owner proves
    // that the C14 account restriction crosses portfolios, without weakening
    // the production cap or deleting historical media to manufacture denial.
    const stageCount=()=>Number(dbQuery(
      "select count(*) from kadmeion_private.private_reviewer_stage_artifacts where portfolio_id=:'portfolio'::uuid;",
      {vars:{portfolio:portfolioId}}));
    assert.equal(stageCount(),5,'Original portfolio reaches its real stage cap');
    const [{id:freshPortfolioId,slug:freshSlug}]=ok(await api('/rest/v1/portfolios?select=id,slug',{
      method:'POST',jwt:owner.jwt,body:{owner_user_id:owner.id,
        slug:'c14-live-'+randomUUID().slice(0,8),title:'C14 live media CI',template_id:'starter'},
      headers:{Prefer:'return=representation'}
    }),'Create independent same-owner C14 media portfolio');
    assert.notEqual(freshPortfolioId,portfolioId);
    const freshRevision=ok(await api('/rest/v1/rpc/commit_portfolio_revision',{
      method:'POST',jwt:owner.jwt,body:{p_portfolio_id:freshPortfolioId,
        p_operation_id:randomUUID(),p_base_revision:0,p_snapshot:updateSnapshot}
    }),'Commit independent C14 media revision');
    const freshFrozen=ok(await api('/rest/v1/rpc/freeze_private_release_request',{
      method:'POST',jwt:owner.jwt,body:{p_portfolio_id:freshPortfolioId,
        p_operation_id:randomUUID(),p_revision:freshRevision.revision,p_visibility_intent:'PUBLIC'}
    }),'Freeze independent C14 media revision');
    const freshFrozenMedia={...await loader.load(freshFrozen.requestId),plan:frozenMedia.plan};
    const freshArtifact=await createPrivateImmutableMediaCandidateFromFrozenSlots(freshFrozenMedia,reader);
    const freshPointer=await pointer.prepare(freshPortfolioId,freshFrozen.requestId,
      freshArtifact.manifestSha256,0,randomUUID());
    const freshStaged=await storeAttestedFrozenMediaCandidate(mediaPort,{
      requestId:freshFrozen.requestId,expectedGeneration:freshPointer.generation,input:freshFrozenMedia
    },reader);
    assert.equal(freshStaged.status,'STORED_PRIVATE');
    const freshOperation=randomUUID();
    const freshConsent=await pointer.requestPublicPublication(freshFrozen.requestId,
      freshPointer.generation,freshOperation,'PUBLISH PUBLIC');
    const freshReceipt=await publishPublic(freshConsent,freshFrozen.requestId,freshOperation,freshPortfolioId);
    const freshImageHash=createHash('sha256').update(freshArtifact.files[1].bytes).digest('hex');
    assert.equal(freshReceipt.mediaManifest,freshStaged.manifestSha256);
    assert.deepEqual(freshReceipt.assetHashes,[freshImageHash]);
    assert.equal(stageCount(),5,'No original stage was removed to make C14 proof pass');
    const freshCanonicalPath='/'+handle+'/'+freshSlug;
    const freshCanonical=deliveryOrigin+freshCanonicalPath;
    const freshScope={canonicalPath:freshCanonicalPath,manifestSha256:freshReceipt.mediaManifest,assetHashes:freshReceipt.assetHashes};
    const freshMediaQuery='&manifest='+freshReceipt.mediaManifest+'&asset='+freshImageHash;
    const freshDirect=deliveryOrigin+'/api/public-portfolio?handle='+handle+'&slug='+freshSlug+freshMediaQuery;
    const liveReviewer=ok(await api('/rest/v1/rpc/issue_private_reviewer_grant',{
      method:'POST',jwt:owner.jwt,body:{p_request_id:freshFrozen.requestId,
        p_operation_id:randomUUID(),p_valid_minutes:60}
    }),'Issue current reviewer before account restriction');
    const liveReviewerImage='/api/reviewer?review='+liveReviewer.grantId+'.'+liveReviewer.rawToken+freshMediaQuery;
    for(const method of ['GET','HEAD']){
      assert.equal((await fetch(canonical,{method})).status,404,'Original renamed/withdrawn route stays denied');
      assert.equal((await fetch(freshCanonical,{method})).status,200);
      assert.equal((await fetch(freshDirect,{method})).status,200);
      assert.equal((await serveReviewer(liveReviewerImage,{},method)).statusCode,200);
    }
    const scopeState=await moderation.readAccountSharingRestriction(reportDecision.caseId,owner.id);
    assert.equal(scopeState.status,'CLEAR');
    const restrictIntent={caseId:reportDecision.caseId,ownerUserId:owner.id,action:'RESTRICT',
      expectedVersion:scopeState.version,operationId:randomUUID(),
      rationale:'Verified administrator restriction of the documented public-sharing case.',
      confirmation:'RESTRICT PUBLIC SHARING'};
    const restriction=await moderation.changeAccountSharingRestriction(restrictIntent);
    assert.equal(restriction.status,'ACTIVE');
    assert.equal(restriction.hostRevocationVerified,false);
    assert.equal((await moderation.changeAccountSharingRestriction(restrictIntent)).alreadyRecorded,true);
    const takedownScopes=[scopeA,scopeB,{...scopeA,canonicalPath:renamed},{...scopeB,canonicalPath:renamed},freshScope];
    const localTakedown=await probePublicTakedownPlan({origin:deliveryOrigin,allowLocal:true,
      scopes:takedownScopes});
    assert.equal(localTakedown.status,'OBSERVED_TAKEDOWN_ON_SCOPED_PATHS');
    for(const method of ['GET','HEAD']){
      assert.equal((await fetch(canonical,{method})).status,404);
      assert.equal((await fetch(freshCanonical,{method})).status,404);
      assert.equal((await fetch(freshDirect,{method})).status,404);
      assert.equal((await serveReviewer(liveReviewerImage,{},method)).statusCode,404);
      assert.equal((await fetch(deliveryOrigin+'/api/unlisted?portfolioId='+portfolioId,{method})).status,404);
      assert.equal((await fetch(deliveryOrigin+'/api/unlisted?portfolioId='+freshPortfolioId,{method})).status,404);
    }
    assert.equal((await submitReport({operationId:randomUUID(),reason:'ABUSE',
      evidence:'A fresh report cannot target the withdrawn canonical route.'})).status,404);
    assert.equal((await fetch(freshCanonical,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({operationId:randomUUID(),reason:'ABUSE',evidence:'Report on the restricted same-owner portfolio.'})})).status,404);
    assert.equal((await pointer.read(portfolioId)).status,'BLOCKED');
    assert.equal((await pointer.read(freshPortfolioId)).status,'BLOCKED');
    assert.ok(await loader.load(replacementFrozen.requestId),'Private author retains frozen source access');
    assert.ok(await loader.load(freshFrozen.requestId),'Same-owner private frozen source remains available');
    ok(await api('/rest/v1/profiles?user_id=eq.'+owner.id,{method:'PATCH',jwt:owner.jwt,
      body:{headline:'Private authoring during outward restriction'}}),'Private profile edit during restriction');
    await ownerModeration.appeal(reportDecision.caseId,randomUUID(),
      'Disposable owner appeal requests review of the outward-only restriction.');
    const restoreState=await moderation.readAccountSharingRestriction(reportDecision.caseId,owner.id);
    assert.ok(restoreState.allowedActions.includes('RESTORE'));
    const restored=await moderation.changeAccountSharingRestriction({
      caseId:reportDecision.caseId,ownerUserId:owner.id,action:'RESTORE',expectedVersion:restoreState.version,
      operationId:randomUUID(),rationale:'Administrator reviewed the appeal; no former publication is revived.',
      confirmation:'RESTORE PUBLIC SHARING'});
    assert.equal(restored.status,'CLEAR');
    assert.equal(restored.publicRepublished,false);
    assert.equal(stageCount(),5,'Historical immutable stages were retained');
    assert.equal((await ownerModeration.readOwnerCase(reportDecision.caseId)).status,'CLOSED');
    for(const method of ['GET','HEAD']){
      assert.equal((await fetch(canonical,{method})).status,404);
      assert.equal((await fetch(freshCanonical,{method})).status,404);
      assert.equal((await fetch(freshDirect,{method})).status,404);
      assert.equal((await serveReviewer(liveReviewerImage,{},method)).statusCode,404);
    }

    // New generation is never silently revived after Trash.
    const preparedAgain=await pointer.prepare(portfolioId,frozen.requestId,
      artifact.manifestSha256,(await pointer.read(portfolioId)).generation,randomUUID());
    assert.equal(preparedAgain.status,'PREPARED_PRIVATE');
    const moved=ok(await api('/rest/v1/rpc/trash_private_item',{
      method:'POST',jwt:owner.jwt,body:{p_item_type:'portfolio',p_item_id:portfolioId}}),
    'Trash private portfolio');
    assert.ok(moved.status==='trashed'||moved.status==='already_trashed');
    await assert.rejects(writer.bindPrivateArtifact({
      ...direct,expectedGeneration:preparedAgain.generation}),{
        code:'SQL_UNCONFIRMED'});
    const pointerAfterTrash=await pointer.read(portfolioId);
    assert.equal(pointerAfterTrash.status,'BLOCKED');
    assert.equal(pointerAfterTrash.publicServingEnabled,false);
  }finally{
    if(worker)await worker.close();
    if(created)dbQuery(String.raw`REVOKE EXECUTE ON FUNCTION kadmeion_private.bind_private_artifact_candidate(
  uuid,bigint,text,text) FROM :"worker";
REVOKE EXECUTE ON FUNCTION kadmeion_private.store_frozen_media_candidate(
  uuid,bigint,text,bytea[]) FROM :"worker";
REVOKE USAGE ON SCHEMA kadmeion_private FROM :"worker";
DROP ROLE :"worker";`,{vars:{worker:role}});
  }
});
