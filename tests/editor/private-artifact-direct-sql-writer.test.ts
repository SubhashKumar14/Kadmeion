import test from 'node:test';
import assert from 'node:assert/strict';
import {DirectSqlPrivateArtifactBindingWriter,PrivateArtifactSqlBindingError}
  from '../../packages/storage-adapters/src/private-artifact-direct-sql-writer.ts';
import type {TrustedPrivateBindingRequest}
  from '../../packages/storage-adapters/src/private-artifact-pointer-binding.ts';

const request:TrustedPrivateBindingRequest={
  requestId:'20000000-0000-4000-8000-000000000002',
  expectedGeneration:4,manifestJson:'{"source":"private"}',html:'<!doctype html>'
};
const receipt={status:'BOUND_PRIVATE',publicServingEnabled:false,publicUrl:null};

test('direct SQL binding uses fixed parameterized private RPC and returns only receipt',async()=>{
  let calls=0;
  const writer=new DirectSqlPrivateArtifactBindingWriter({
    query:async(sql,params)=>{
      calls++;
      assert.match(sql,/kadmeion_private\.bind_private_artifact_candidate\(/);
      assert.match(sql,/\$1::uuid, \$2::bigint, \$3::text, \$4::text/);
      assert.doesNotMatch(sql,/20000000|<!doctype/);
      assert.deepEqual(params,[request.requestId,4,request.manifestJson,request.html]);
      return {rows:[{receipt}]};
    }
  });
  assert.equal(await writer.bindPrivateArtifact(request),receipt);
  assert.equal(calls,1);
});

test('bad IDs, unsafe generations, NUL and oversize UTF-8 fail before SQL',async()=>{
  let calls=0;
  const writer=new DirectSqlPrivateArtifactBindingWriter({query:async()=>{
    calls++;return {rows:[{receipt}]};
  }});
  const bad:Partial<TrustedPrivateBindingRequest>[]=[
    {requestId:'not-a-uuid'},{expectedGeneration:0},
    {expectedGeneration:Number.MAX_SAFE_INTEGER+1},
    {manifestJson:'{}\0'},{html:'abc\0'},
    {manifestJson:'x'.repeat(8193)},{html:'💠'.repeat(187501)},
    {html:''},{manifestJson:'x'}
  ];
  for(const patch of bad)
    await assert.rejects(writer.bindPrivateArtifact({...request,...patch}),
      {code:'INVALID_INPUT'});
  assert.equal(calls,0);
});

test('database errors are sanitized; missing/ambiguous receipts fail closed',async()=>{
  const secret='postgres://secret:password@host';
  const writer=new DirectSqlPrivateArtifactBindingWriter({query:async()=>{
    throw new Error(secret);
  }});
  await assert.rejects(writer.bindPrivateArtifact(request),error=>{
    assert.ok(error instanceof PrivateArtifactSqlBindingError);
    assert.equal(error.code,'SQL_UNCONFIRMED');
    assert.ok(!error.message.includes(secret));
    return true;
  });
  for(const rows of [[],[{},{}],[{}],[null]]){
    const broken=new DirectSqlPrivateArtifactBindingWriter({query:async()=>({rows})});
    await assert.rejects(broken.bindPrivateArtifact(request),
      {code:'INVALID_SQL_RECEIPT'});
  }
});
