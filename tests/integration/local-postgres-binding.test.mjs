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
import {randomBytes,randomUUID} from 'node:crypto';
import {SupabasePrivateFrozenRevisionLoader}
  from '../../packages/storage-adapters/src/private-frozen-revision-loader.ts';
import {SupabasePrivateReleasePointerService}
  from '../../packages/contracts/src/private-release-visibility-service.ts';
import {createPrivateImmutableArtifact}
  from '../../packages/storage-adapters/src/private-immutable-artifact.ts';
import {bindPrivateArtifactToPointer}
  from '../../packages/storage-adapters/src/private-artifact-pointer-binding.ts';
import {DirectSqlPrivateArtifactBindingWriter}
  from '../../packages/storage-adapters/src/private-artifact-direct-sql-writer.ts';
import {openPrivateArtifactPgWorker}
  from '../../packages/storage-adapters/src/private-artifact-pg-worker.ts';
import {handleReviewerRequest} from '../../api/reviewer.mjs';
import {handleUnlistedRequest} from '../../api/unlisted.mjs';

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
  {timeout:180000},async()=>{
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
  uuid,bigint,text,text) TO :"worker";`,
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
    async function serveByHeader(){
      const request={method:'GET',url:'/api/reviewer?g='+reviewer.grantId,
        headers:{authorization:'Bearer '+reviewer.rawToken}};
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
    const served=await serveByHeader();
    assert.equal(served.statusCode,200);
    assert.equal(served.body,new TextDecoder().decode(artifact.files[0].bytes));
    assert.match(served.headers.get('cache-control'),/no-store/);
    const bytes=ok(await getStaged(),'Read real reviewer staging bytes');
    assert.equal(bytes.html,new TextDecoder().decode(artifact.files[0].bytes));
    assert.equal(bytes.publicServingEnabled,false);
    ok(await api('/rest/v1/rpc/revoke_private_reviewer_grant',{
      method:'POST',jwt:owner.jwt,body:{p_grant_id:reviewer.grantId}
    }),'Revoke real reviewer token');
    assert.equal(ok(await getStaged(),'Read revoked reviewer grant'),null);
    assert.equal((await serveByHeader()).statusCode,404);

    // B4 UNLISTED activation requires distinct typed owner consent and
    // privileged probe/activation; no public request is served before that.
    const intent=ok(await api('/rest/v1/rpc/owner_request_unlisted_publication',{
      method:'POST',jwt:owner.jwt,body:{
        p_request_id:frozen.requestId,p_expected_generation:1,
        p_operation_id:randomUUID(),p_confirmation:'PUBLISH UNLISTED'}
    }),'Owner explicitly authorized a private unlisted release');
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
        p_expected_generation:hostStage.releaseGeneration,
        p_html_sha256:bound.htmlSha256}
    }),'Internal unlisted activation without external host proof');
    assert.equal(activated.status,'ACTIVATED_NEEDS_EXTERNAL_HTTP_VERIFICATION');
    assert.equal(activated.publicUrl,null);
    assert.equal(ok(await publicRead(),'Read guarded live-unlisted SQL output').htmlSha256,
      bound.htmlSha256);

    async function publicHostRead(){
      const response={statusCode:0,body:null,headers:new Map(),
        setHeader(k,v){this.headers.set(k.toLowerCase(),v);},
        end(body){this.body=body;}};
      await handleUnlistedRequest({method:'GET',
        url:'/api/unlisted?portfolioId='+portfolioId},response,{
        env:{KADMEION_UNLISTED_DELIVERY_ENABLED:'true',
          KADMEION_LOCAL_INTEGRATION:'1',
          KADMEION_SUPABASE_URL:cfg.origin,
          KADMEION_SUPABASE_SERVICE_ROLE_KEY:cfg.service},
        http:fetch});
      return response;
    }
    const site=await publicHostRead();
    assert.equal(site.statusCode,200,'Server-only unlisted HTTP gate did not serve');
    assert.equal(site.body,new TextDecoder().decode(artifact.files[0].bytes));
    assert.match(site.headers.get('cache-control'),/no-store/);
    assert.match(site.headers.get('content-security-policy'),/script-src 'none'/);


    async function prepareReplacement(previousGeneration) {
      const next = await pointer.prepare(portfolioId, frozen.requestId,
        artifact.manifestSha256, previousGeneration, randomUUID());
      await bindPrivateArtifactToPointer(ctx);
      ok(await api('/rest/v1/rpc/store_private_reviewer_stage_artifact', {
        method: 'POST', jwt: cfg.service, key: cfg.service,
        body: {p_request_id: frozen.requestId, p_expected_generation: next.generation,
          p_html: site.body}
      }), 'Store replacement bytes');
      const consent = ok(await api('/rest/v1/rpc/owner_request_unlisted_publication', {
        method: 'POST', jwt: owner.jwt,
        body: {p_request_id: frozen.requestId, p_expected_generation: next.generation,
          p_operation_id: randomUUID(), p_confirmation: 'PUBLISH UNLISTED'}
      }), 'Authorize replacement');
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
    const replacement = await prepareReplacement(superseded.releaseGeneration);
    assert.equal(replacement.htmlSha256, superseded.htmlSha256);
    assert.equal((await publicHostRead()).body, site.body,
      'The current live release stays available while replacements are pending');
    const activateReplacement = (probe) => api('/rest/v1/rpc/service_activate_unlisted_release', {
      method: 'POST', key: cfg.service, jwt: cfg.service,
      body: {p_portfolio_id: portfolioId, p_expected_generation: probe.releaseGeneration,
        p_html_sha256: probe.htmlSha256}
    });
    const staleProbe = await activateReplacement(superseded);
    assert.equal(staleProbe.data?.code, '40001',
      'A superseded probe cannot activate a replacement with identical bytes');
    const promoted = ok(await activateReplacement(replacement), 'Promote the current replacement');
    assert.equal(promoted.releaseGeneration, replacement.releaseGeneration);
    assert.equal((await publicHostRead()).body, site.body);

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
    const after=await pointer.read(portfolioId);
    assert.equal(after.status,'BLOCKED');
    assert.equal(after.publicServingEnabled,false);

    // New generation is never silently revived after Trash.
    const preparedAgain=await pointer.prepare(portfolioId,frozen.requestId,
      artifact.manifestSha256,after.generation,randomUUID());
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
REVOKE USAGE ON SCHEMA kadmeion_private FROM :"worker";
DROP ROLE :"worker";`,{vars:{worker:role}});
  }
});
