import test from 'node:test';
import assert from 'node:assert/strict';
import {openPrivateArtifactPgWorker,PrivatePgWorkerError}
  from '../../packages/storage-adapters/src/private-artifact-pg-worker.ts';

const valid={host:'127.0.0.1',port:54322,database:'postgres',
  user:'kd_test_worker',password:'a'.repeat(32),localOnly:true} as const;
const good={role:'kd_test_worker',superuser:false,schema_usage:true,
  can_bind:true,can_read:false,can_mutate:false};
const request={requestId:'20000000-0000-4000-8000-000000000002',
  expectedGeneration:1,manifestJson:'{}',html:'<!doctype html>'};

function fakePool(probe:unknown=good){
  let ended=0,binds=0,errors=0;
  const pool={
    on(event:string,handler:()=>void){
      assert.equal(event,'error');assert.equal(typeof handler,'function');
      errors++;return pool;
    },
    async query(sql:string,params:unknown[]){
      if(sql.includes('current_user::text')){
        assert.deepEqual(params,[]);
        return {rows:[{...probe as object}]};
      }
      binds++;
      assert.match(sql,/^select kadmeion_private\.bind_private_artifact_candidate\(/);
      assert.deepEqual(params,[request.requestId,1,'{}','<!doctype html>']);
      return {rows:[{receipt:{status:'BOUND_PRIVATE'}}]};
    },
    async end(){ended++;}
  };
  return {pool,counts:()=>({ended,binds,errors})};
}
test('local worker requires explicit opt-in and refuses remote plaintext/TLS bypass',async()=>{
  const before=process.env.KADMEION_LOCAL_INTEGRATION;
  delete process.env.KADMEION_LOCAL_INTEGRATION;
  try{
    await assert.rejects(openPrivateArtifactPgWorker(valid),{code:'INVALID_CONFIGURATION'});
  }finally{
    if(before===undefined)delete process.env.KADMEION_LOCAL_INTEGRATION;
    else process.env.KADMEION_LOCAL_INTEGRATION=before;
  }
  for(const options of [
    {...valid,user:'postgres'},{...valid,password:'short'},
    {...valid,port:0},{...valid,host:'db.example.org'},
    {...valid,host:'db.example.org',localOnly:false},
    {...valid,host:'db.example.org',localOnly:false,ssl:{rejectUnauthorized:false}},
    {...valid,host:'db.example.org',localOnly:false,
      ssl:{rejectUnauthorized:true,ca:''}}
  ]){
    await assert.rejects(openPrivateArtifactPgWorker(options as never),
      {code:'INVALID_CONFIGURATION'});
  }
});
test('privilege probe denies superuser, wrong role and table access; always closes',async()=>{
  process.env.KADMEION_LOCAL_INTEGRATION='1';
  for(const bad of [{...good,superuser:true},{...good,role:'kd_other'},
    {...good,can_bind:false},{...good,can_read:true},
    {...good,can_mutate:true},{...good,schema_usage:false}]){
    const f=fakePool(bad);
    await assert.rejects(openPrivateArtifactPgWorker(valid,()=>f.pool),
      {code:'ROLE_UNSAFE'});
    assert.equal(f.counts().ended,1);
    assert.equal(f.counts().binds,0);
  }
});
test('successful pool uses bounded configuration, one query and idempotent close',async()=>{
  process.env.KADMEION_LOCAL_INTEGRATION='1';
  const f=fakePool();
  let config:Record<string,unknown>={};
  const worker=await openPrivateArtifactPgWorker(valid,c=>{
    config=c as Record<string,unknown>;return f.pool;
  });
  assert.equal(config.ssl,false);
  assert.equal(config.max,1);
  assert.equal(config.connectionTimeoutMillis,3000);
  assert.equal(config.statement_timeout,10000);
  assert.equal(config.user,valid.user);
  assert.equal(f.counts().errors,1);
  assert.deepEqual(await worker.writer.bindPrivateArtifact(request),
    {status:'BOUND_PRIVATE'});
  assert.equal(f.counts().binds,1);
  await worker.close();await worker.close();
  assert.equal(f.counts().ended,1);
  await assert.rejects(worker.writer.bindPrivateArtifact(request),
    {code:'SQL_UNCONFIRMED'});
});
test('connection failure sanitizes secrets and releases the pool',async()=>{
  process.env.KADMEION_LOCAL_INTEGRATION='1';
  let ended=0;
  const pool={on(){},async query(){throw new Error('postgres://user:SECRET@db');},
    async end(){ended++;}};
  await assert.rejects(openPrivateArtifactPgWorker(valid,()=>pool as never),e=>{
    assert.ok(e instanceof PrivatePgWorkerError);
    assert.equal(e.code,'CONNECTION_UNAVAILABLE');
    assert.ok(!e.message.includes('SECRET'));
    assert.ok(!e.message.includes(valid.password));
    return true;
  });
  assert.equal(ended,1);
});
