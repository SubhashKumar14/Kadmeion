/**
 * B6: local-only, real pg.Pool moderation/binding race verification.
 * Two independent cases: moderator wins after the orchestrator's pointer read,
 * and an uncommitted moderator transaction holds the portfolio row while the
 * restricted pg worker attempts a bind. Neither case grants public serving.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {SupabasePrivateFrozenRevisionLoader}
  from '../../packages/storage-adapters/src/private-frozen-revision-loader.ts';
import {SupabasePrivateReleasePointerService}
  from '../../packages/contracts/src/private-release-visibility-service.ts';
import {createPrivateImmutableArtifact}
  from '../../packages/storage-adapters/src/private-immutable-artifact.ts';
import {bindPrivateArtifactToPointer}
  from '../../packages/storage-adapters/src/private-artifact-pointer-binding.ts';
import {openPrivateArtifactPgWorker}
  from '../../packages/storage-adapters/src/private-artifact-pg-worker.ts';

function localSettings(){
  assert.equal(process.env.KADMEION_LOCAL_INTEGRATION,'1',
    'Requires explicit local integration opt-in');
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
  assert.ok(anon?.length>50&&service?.length>50);
  return {origin:api.origin,db,anon,service};
}
const cfg=localSettings();

function dbQuery(script,{vars={},extraEnv={}}={}){
  const args=['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'];
  for(const [name,value] of Object.entries(vars)){
    assert.match(name,/^[a-z][a-z_]*$/);
    args.push('-v',name+'='+String(value));
  }
  return execFileSync('psql',args,{
    input:script,encoding:'utf8',timeout:15000,maxBuffer:1024*1024,
    env:{...process.env,PGHOST:cfg.db.hostname,PGPORT:cfg.db.port,
      PGDATABASE:'postgres',PGUSER:'postgres',
      PGPASSWORD:decodeURIComponent(cfg.db.password),
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
  assert.ok(result.ok,label+' failed (HTTP '+result.status+
    ', code '+String(result.data?.code)+')');
  return result.data;
}
async function account(){
  const email='local-moderation-'+randomUUID()+'@testing.invalid';
  const password='Local!'+randomUUID()+'x';
  const created=ok(await api('/auth/v1/admin/users',{
    method:'POST',jwt:cfg.service,key:cfg.service,
    body:{email,password,email_confirm:true}}),'Create local user');
  const login=ok(await api('/auth/v1/token?grant_type=password',{
    method:'POST',body:{email,password}}),'Sign in local user');
  assert.equal(login.user.id,created.id);
  return {id:created.id,jwt:login.access_token};
}
const plan=[{slotKey:'hero',componentId:'title-stacked@1',
  kind:'heading',required:true}];
async function preparedFixture(owner,label){
  const rows=ok(await api('/rest/v1/portfolios?select=id',{
    method:'POST',jwt:owner.jwt,body:{
      owner_user_id:owner.id,slug:'mod-race-'+randomUUID().slice(0,8),
      title:'Private '+label,template_id:'starter'
    },headers:{Prefer:'return=representation'}}),'Create portfolio');
  assert.equal(rows.length,1);
  const portfolioId=rows[0].id;
  const snapshot={formatVersion:1,
    files:{'kadmeion.json':JSON.stringify({formatVersion:1,seo:{
      title:'Local moderation fixture',description:'Never publicly hosted'}})},
    slots:{hero:{state:'S0',componentId:'title-stacked@1',
      content:{title:'Private candidate '+label,subtitle:'Not published'}}},
    stashes:{}};
  const revision=ok(await api('/rest/v1/rpc/commit_portfolio_revision',{
    method:'POST',jwt:owner.jwt,body:{p_portfolio_id:portfolioId,
      p_operation_id:randomUUID(),p_base_revision:0,p_snapshot:snapshot}
  }),'Commit revision');
  const frozen=ok(await api('/rest/v1/rpc/freeze_private_release_request',{
    method:'POST',jwt:owner.jwt,body:{p_portfolio_id:portfolioId,
      p_operation_id:randomUUID(),p_revision:revision.revision,
      p_visibility_intent:'UNLISTED'}
  }),'Freeze revision');
  const loader=new SupabasePrivateFrozenRevisionLoader(cfg.origin,cfg.anon,
    async()=>owner.jwt);
  const artifact=await createPrivateImmutableArtifact({
    ...await loader.load(frozen.requestId),plan});
  const pointer=new SupabasePrivateReleasePointerService(cfg.origin,cfg.anon,
    async()=>owner.jwt);
  const prepared=await pointer.prepare(portfolioId,frozen.requestId,
    artifact.manifestSha256,0,randomUUID());
  assert.equal(prepared.generation,1);
  return {portfolioId,requestId:frozen.requestId,loader,artifact,pointer,
    direct:{requestId:frozen.requestId,expectedGeneration:1,
      manifestJson:JSON.stringify(artifact.manifest),
      html:new TextDecoder().decode(artifact.files[0].bytes)}};
}
async function block(moderator,caseId,portfolioId,operationId){
  return api('/rest/v1/rpc/operator_block_private_portfolio',{
    method:'POST',jwt:moderator.jwt,body:{p_case_id:caseId,
      p_portfolio_id:portfolioId,p_operation_id:operationId}});
}
function assertBlocked(receipt){
  assert.equal(receipt.status,'BLOCKED');
  assert.equal(receipt.publicServingEnabled,false);
  assert.equal(receipt.publicUrl,null);
  assert.equal(receipt.hostRevocationVerified,false);
}
test('B6: operator hold wins both pg.Pool TOCTOU and live row-lock races',
  {timeout:180000},async()=>{
  const role='kd_ci_race_'+randomBytes(6).toString('hex');
  const password=randomBytes(26).toString('hex');
  let created=false,worker,tx;
  try{
    dbQuery([
      '\\getenv kd_worker_password KADMEION_LOCAL_RACE_PASSWORD',
      'CREATE ROLE :"worker" LOGIN PASSWORD :\'kd_worker_password\'',
      '  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;',
      'GRANT USAGE ON SCHEMA kadmeion_private TO :"worker";',
      'GRANT EXECUTE ON FUNCTION kadmeion_private.bind_private_artifact_candidate(',
      '  uuid,bigint,text,text) TO :"worker";'
    ].join('\n'),{vars:{worker:role},
      extraEnv:{KADMEION_LOCAL_RACE_PASSWORD:password}});
    created=true;
    worker=await openPrivateArtifactPgWorker({
      host:cfg.db.hostname,port:Number(cfg.db.port),database:'postgres',
      user:role,password,localOnly:true
    });
    const owner=await account(),moderator=await account(),outsider=await account();
    // Local test fixture only: an operator role is never user-assignable.
    dbQuery('insert into kadmeion_private.operator_roles(user_id,role) '+
      "values (:'moderator'::uuid,'moderator');",
      {vars:{moderator:moderator.id}});
    const openCase=async target=>ok(await api(
      '/rest/v1/rpc/operator_open_moderation_case',{
        method:'POST',jwt:moderator.jwt,body:{
          p_target_user_id:target.id,p_operation_id:randomUUID(),
          p_reason_code:'SECURITY',
          p_summary:'Local-only case for restricted artifact race testing'
        }}),'Open moderation case').caseId;
    const caseId=await openCase(owner);
    const wrongCaseId=await openCase(outsider);

    // Case 1: moderation commits between owner pointer read and actual pg bind.
    const first=await preparedFixture(owner,'TOCTOU');
    assert.equal((await block(outsider,caseId,first.portfolioId,randomUUID())).ok,
      false,'nonoperator must be denied');
    assert.equal((await block(moderator,wrongCaseId,first.portfolioId,
      randomUUID())).ok,false,'wrong-owner case must be denied');
    const operationId=randomUUID();
    const ctx={portfolioId:first.portfolioId,requestId:first.requestId,
      plan,loader:first.loader,pointer:first.pointer,writer:{
        bindPrivateArtifact:async request=>{
          assertBlocked(ok(await block(moderator,caseId,first.portfolioId,
            operationId),'Operator block before bind'));
          return worker.writer.bindPrivateArtifact(request);
        }
      }};
    await assert.rejects(bindPrivateArtifactToPointer(ctx),{
      code:'BINDING_UNCONFIRMED'});
    await assert.rejects(worker.writer.bindPrivateArtifact(first.direct),{
      code:'SQL_UNCONFIRMED'});
    const firstAfter=await first.pointer.read(first.portfolioId);
    assertBlocked(firstAfter);
    assert.equal(firstAfter.generation,2);
    assert.equal(firstAfter.revocationGeneration,2);
    assert.equal(firstAfter.candidateRequestId,null);
    assert.equal(ok(await block(moderator,caseId,first.portfolioId,operationId),
      'Idempotent moderator replay').alreadyRecorded,true);
    assert.equal((await block(moderator,caseId,first.portfolioId,
      randomUUID())).ok,false,'new operation cannot replace hold');
    await assert.rejects(first.pointer.prepare(first.portfolioId,
      first.requestId,first.artifact.manifestSha256,2,randomUUID()));
    const audit=dbQuery([
      'select count(*) from public.private_release_visibility_events',
      "where portfolio_id=:'portfolio'::uuid and event_type='OPERATOR_BLOCK';"
    ].join('\n'),{vars:{portfolio:first.portfolioId}});
    assert.equal(audit,'1');

    // Case 2: an uncommitted operator transaction holds the same portfolio
    // row that the restricted binding SQL must lock. The worker is queued
    // before COMMIT and must observe the committed revocation, not stale data.
    const second=await preparedFixture(owner,'row lock');
    tx=new Client({host:cfg.db.hostname,port:Number(cfg.db.port),
      database:'postgres',user:'postgres',
      password:decodeURIComponent(cfg.db.password),ssl:false,
      connectionTimeoutMillis:3000,query_timeout:10000});
    await tx.connect();
    await tx.query('BEGIN');
    await tx.query('SET LOCAL ROLE authenticated');
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)",
      [moderator.id]);
    const blockResult=await tx.query(
      'select public.operator_block_private_portfolio($1::uuid,$2::uuid,$3::uuid) as receipt',
      [caseId,second.portfolioId,randomUUID()]);
    assertBlocked(blockResult.rows[0].receipt);
    let settled=false;
    const pending=worker.writer.bindPrivateArtifact(second.direct)
      .finally(()=>{settled=true;});
    // A real separate pg connection is now contending with the uncommitted
    // moderation row lock. Do not let an assertion leak an open transaction.
    await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(settled,false,'binding must wait for portfolio lock');
    await tx.query('COMMIT');
    await assert.rejects(pending,{code:'SQL_UNCONFIRMED'});
    const secondAfter=await second.pointer.read(second.portfolioId);
    assertBlocked(secondAfter);
    assert.equal(secondAfter.generation,2);
    assert.equal(secondAfter.revocationGeneration,2);
    assert.equal((await block(moderator,caseId,second.portfolioId,
      randomUUID())).ok,false,'hold remains persistent');
    await assert.rejects(second.pointer.prepare(second.portfolioId,
      second.requestId,second.artifact.manifestSha256,2,randomUUID()));
    assert.equal(dbQuery([
      'select count(*) from public.private_release_visibility_events',
      "where portfolio_id=:'portfolio'::uuid and event_type='OPERATOR_BLOCK';"
    ].join('\n'),{vars:{portfolio:second.portfolioId}}),'1');
  }finally{
    if(tx){
      try{await tx.query('ROLLBACK');}catch{/* already committed or disconnected */}
      await tx.end().catch(()=>{});
    }
    if(worker)await worker.close();
    if(created)dbQuery([
      'REVOKE EXECUTE ON FUNCTION kadmeion_private.bind_private_artifact_candidate(',
      '  uuid,bigint,text,text) FROM :"worker";',
      'REVOKE USAGE ON SCHEMA kadmeion_private FROM :"worker";',
      'DROP ROLE :"worker";'
    ].join('\n'),{vars:{worker:role}});
  }
});
