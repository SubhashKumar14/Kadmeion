import test from 'node:test';
import assert from 'node:assert/strict';
import {SupabasePrivateAccountErasureService} from '../../packages/contracts/src/private-account-erasure-service.ts';

const origin='https://kadmeion.supabase.co';
const operationId='10000000-0000-4000-8000-000000000001';
const requestId='20000000-0000-4000-8000-000000000002';
const withdrawId='30000000-0000-4000-8000-000000000003';
const blocked={requestId,status:'REQUESTED_BLOCKED',alreadyRequested:false,
  publicRevocationVerified:false,reauthVerified:false,accessTerminated:false,
  erasureExecuted:false,retentionVerified:false} as const;
const client=(http:typeof fetch,jwt:string|null='owner-jwt')=>
  new SupabasePrivateAccountErasureService(origin,'publishable',async()=>jwt,http);
const ok=(x:unknown)=>Response.json(x);

test('owner request requires typed confirmation, JWT, no-cache and no redirects',async()=>{
  let calls=0;
  const service=client(async(url,init)=>{
    calls++;
    assert.equal(url,origin+'/rest/v1/rpc/request_private_account_erasure');
    assert.equal(init?.method,'POST');
    assert.equal(init?.credentials,'omit');
    assert.equal(init?.cache,'no-store');
    assert.equal(init?.redirect,'error');
    assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer owner-jwt');
    assert.deepEqual(JSON.parse(init?.body as string),{
      p_operation_id:operationId,p_confirmation:'DELETE MY ACCOUNT'
    });
    return ok({...blocked,ownerEmail:'never projected'});
  });
  assert.deepEqual(await service.request(operationId,'DELETE MY ACCOUNT'),blocked);
  assert.equal(calls,1);
});

test('replayed request reports blocked or withdrawn state without deletion claims',async()=>{
  const service=client(async()=>ok({...blocked,alreadyRequested:true}));
  assert.equal((await service.request(operationId,'DELETE MY ACCOUNT')).alreadyRequested,true);
  const withdrawn=client(async()=>ok({...blocked,status:'WITHDRAWN',alreadyRequested:true}));
  assert.equal((await withdrawn.request(operationId,'DELETE MY ACCOUNT')).status,'WITHDRAWN');
});

test('withdrawal uses exact request ID and cannot claim access termination',async()=>{
  const service=client(async(url,init)=>{
    assert.equal(url,origin+'/rest/v1/rpc/withdraw_private_account_erasure');
    assert.deepEqual(JSON.parse(init?.body as string),{
      p_request_id:requestId,p_operation_id:withdrawId
    });
    return ok({requestId,status:'WITHDRAWN',alreadyWithdrawn:false,
      publicRevocationVerified:false,reauthVerified:false,accessTerminated:false,
      erasureExecuted:false,retentionVerified:false});
  });
  assert.equal((await service.withdraw(requestId,withdrawId)).status,'WITHDRAWN');
});

test('owner history is RLS-projected and never accepts fabricated retention proof',async()=>{
  const created='2026-11-14T00:00:00Z';
  const row={id:requestId,status:'REQUESTED_BLOCKED',created_at:created,withdrawn_at:null,
    public_revocation_verified:false,reauth_verified:false,access_terminated:false,
    erasure_executed:false,retention_verified:false};
  const service=client(async(url,init)=>{
    assert.equal(init?.method,'GET');
    assert.equal(init?.cache,'no-store');
    assert.match(String(url),/select=id,status,created_at,withdrawn_at,public_revocation_verified/);
    return ok([{...row,owner_user_id:'hidden'}]);
  });
  assert.deepEqual(await service.list(),[row]);
  for(const bad of [{...row,retention_verified:true},{...row,withdrawn_at:created},
    {...row,status:'ERASED'},{...row,id:'not-uuid'}]){
    await assert.rejects(client(async()=>ok([bad])).list(),{code:'INVALID_ACK'});
  }
});

test('unverified or false-success receipts are rejected',async()=>{
  for(const bad of [null,[],{...blocked,publicRevocationVerified:true},
    {...blocked,reauthVerified:true},{...blocked,accessTerminated:true},
    {...blocked,erasureExecuted:true},{...blocked,retentionVerified:true},
    {...blocked,alreadyRequested:'yes'},{...blocked,status:'ERASED'}]){
    await assert.rejects(client(async()=>ok(bad)).request(operationId,'DELETE MY ACCOUNT'),
      {code:'INVALID_ACK'});
  }
  await assert.rejects(client(async()=>ok({...blocked,requestId:operationId,status:'WITHDRAWN',
    alreadyWithdrawn:true})).withdraw(requestId,withdrawId),{code:'INVALID_ACK'});
});

test('invalid confirmation and identifiers never make network requests',async()=>{
  let calls=0;
  const service=client(async()=>{calls++;throw Error('unexpected');});
  await assert.rejects(service.request('bad','DELETE MY ACCOUNT'),{code:'VALIDATION'});
  await assert.rejects(service.request(operationId,'delete my account' as 'DELETE MY ACCOUNT'),
    {code:'VALIDATION'});
  await assert.rejects(service.withdraw('bad',withdrawId),{code:'VALIDATION'});
  assert.equal(calls,0);
  await assert.rejects(client(async()=>{throw Error('unexpected');},null).list(),
    {code:'AUTH_EXPIRED'});
});

test('provider denial, conflict, quota and outage fail closed',async()=>{
  for(const [httpStatus,body,code] of [
    [401,{},'AUTH_EXPIRED'],[403,{},'FORBIDDEN'],
    [409,{},'CONFLICT'],
    [400,{message:'ACCOUNT_ERASURE_ALREADY_REQUESTED'},'CONFLICT'],
    [400,{message:'ACCOUNT_ERASURE_REQUEST_QUOTA_REACHED'},'QUOTA_EXCEEDED'],
    [400,{message:'INVALID_ERASURE_REQUEST'},'VALIDATION']
  ] as const){
    await assert.rejects(client(async()=>Response.json(body,{status:httpStatus})).request(
      operationId,'DELETE MY ACCOUNT'),{code});
  }
  await assert.rejects(client(async()=>{throw Error('offline');}).list(),
    {code:'PROVIDER_UNAVAILABLE'});
});

test('untrusted API origins are rejected before fetching',()=>{
  for(const endpoint of ['invalid','http://evil.example','https://u:p@kadmeion.supabase.co',
    origin+'/rest/v1',origin+'/?redirect=evil',origin+'/#fragment']){
    assert.throws(()=>new SupabasePrivateAccountErasureService(endpoint,'key',async()=>null),
      {code:'VALIDATION'});
  }
  assert.throws(()=>new SupabasePrivateAccountErasureService(origin,' ',async()=>null),
    {code:'VALIDATION'});
});
