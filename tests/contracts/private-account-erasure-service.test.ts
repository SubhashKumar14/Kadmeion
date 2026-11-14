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

const validPreflight={
  status:'INVENTORY_ONLY',maxCountPerCategory:1000,countsCapped:false,
  counts:{projects:2,portfolios:1,portfolioRevisions:3,projectExposureIntents:1,
    projectAssetMetadata:4,frozenReleaseRequests:1,reviewerGrants:1,
    trashRecords:0,accountExitRequests:1},
  liveSessionChecked:true,freshSignInCandidate:true,recentReauthVerified:false,
  publicRoutes:'UNVERIFIED',objectStorage:'METADATA_ONLY',
  exports:'NOT_TRACKED',integrations:'NOT_TRACKED',deletionAllowed:false
} as const;

test('preflight calls owner-only RPC without an owner id and projects only bounded evidence',async()=>{
  let calls=0;
  const service=client(async(url,init)=>{
    calls++;
    assert.equal(url,origin+'/rest/v1/rpc/private_account_exit_preflight');
    assert.equal(init?.method,'POST');
    assert.deepEqual(JSON.parse(init?.body as string),{});
    assert.equal(init?.credentials,'omit');
    assert.equal(init?.cache,'no-store');
    assert.equal(init?.redirect,'error');
    assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer owner-jwt');
    return ok({...validPreflight,secret:'server value excluded'});
  });
  assert.deepEqual(await service.preflight(),validPreflight);
  assert.equal(calls,1);
});
test('preflight does not treat fresh sign-in as completed reauthentication',async()=>{
  const oldSession={...validPreflight,freshSignInCandidate:false};
  assert.deepEqual(await client(async()=>ok(oldSession)).preflight(),oldSession);
  for(const invalid of [
    {...validPreflight,recentReauthVerified:true},
    {...validPreflight,deletionAllowed:true},
    {...validPreflight,publicRoutes:'VERIFIED'},
    {...validPreflight,exports:'READY'},
    {...validPreflight,liveSessionChecked:false},
    {...validPreflight,maxCountPerCategory:100000},
    {...validPreflight,counts:{...validPreflight.counts,projects:-1}},
    {...validPreflight,counts:{...validPreflight.counts,projects:1001}},
    {...validPreflight,counts:{...validPreflight.counts,projects:'2'}},
    {...validPreflight,countsCapped:'false'}
  ]){
    await assert.rejects(client(async()=>ok(invalid)).preflight(),{code:'INVALID_ACK'});
  }
});
test('preflight requires auth and rejects stale, anonymous or denied provider responses',async()=>{
  let count=0;
  await assert.rejects(client(async()=>{count++;throw Error('network');},null).preflight(),
    {code:'AUTH_EXPIRED'});
  assert.equal(count,0);
  for(const status of [401,403]){
    const error=client(async()=>Response.json({message:'LIVE_SESSION_REQUIRED'},{status}));
    await assert.rejects(error.preflight(),{code:'AUTH_EXPIRED'});
  }
  await assert.rejects(client(async()=>Response.json({message:'LIVE_SESSION_REQUIRED'},
    {status:400})).preflight(),{code:'AUTH_EXPIRED'});
});

const challengeId='40000000-0000-4000-8000-000000000004';
const challengeReceipt={
  challengeId,status:'AWAITING_NEW_SIGN_IN',expiresAt:'2026-11-14T01:50:00Z',
  alreadyIssued:false,deletionAllowed:false
} as const;
const verifiedReceipt={
  challengeId,status:'NEW_SIGN_IN_VERIFIED',expiresAt:'2026-11-14T01:50:00Z',
  alreadyVerified:false,deletionAllowed:false
} as const;

test('begin reauth requires owner JWT, exact operation and no embedded credentials',async()=>{
  const service=client(async(url,init)=>{
    assert.equal(url,origin+'/rest/v1/rpc/begin_private_account_exit_reauth');
    assert.equal(init?.method,'POST');
    assert.equal(init?.redirect,'error');
    assert.equal(init?.cache,'no-store');
    assert.deepEqual(JSON.parse(init?.body as string),{p_operation_id:operationId});
    return ok({...challengeReceipt,internalOwner:'not forwarded'});
  });
  assert.deepEqual(await service.beginReauth(operationId),challengeReceipt);
  await assert.rejects(service.beginReauth('bad'),{code:'VALIDATION'});
});
test('complete reauth verifies exact challenge, but never grants deletion',async()=>{
  const service=client(async(url,init)=>{
    assert.equal(url,origin+'/rest/v1/rpc/complete_private_account_exit_reauth');
    assert.deepEqual(JSON.parse(init?.body as string),{p_challenge_id:challengeId});
    return ok({...verifiedReceipt,internalSession:'not forwarded'});
  });
  assert.deepEqual(await service.completeReauth(challengeId),verifiedReceipt);
  await assert.rejects(service.completeReauth('wrong'),{code:'VALIDATION'});
  for(const invalid of [
    {...verifiedReceipt,challengeId:requestId},
    {...verifiedReceipt,deletionAllowed:true},
    {...verifiedReceipt,status:'DELETED'},
    {...verifiedReceipt,alreadyVerified:'true'},
    {...verifiedReceipt,expiresAt:0}
  ]){
    await assert.rejects(client(async()=>ok(invalid)).completeReauth(challengeId),
      {code:'INVALID_ACK'});
  }
});
test('reauth network failure, expired session and malformed proof fail closed',async()=>{
  for(const status of [401,403]){
    await assert.rejects(client(async()=>Response.json({message:'LIVE_SESSION_REQUIRED'},
      {status})).beginReauth(operationId),{code:'AUTH_EXPIRED'});
  }
  await assert.rejects(client(async()=>{throw Error('offline');}).completeReauth(challengeId),
    {code:'PROVIDER_UNAVAILABLE'});
  await assert.rejects(client(async()=>ok({...challengeReceipt,deletionAllowed:true}))
    .beginReauth(operationId),{code:'INVALID_ACK'});
});

test('reauth errors distinguish stale sessions, missing second login and expired challenge',async()=>{
  for(const [message,code] of [
    ['LIVE_SESSION_REQUIRED','AUTH_EXPIRED'],
    ['NEW_SIGN_IN_REQUIRED','REAUTH_REQUIRED'],
    ['REAUTH_CHALLENGE_EXPIRED','CHALLENGE_EXPIRED']
  ] as const){
    const service=client(async()=>Response.json({message},{status:403}));
    await assert.rejects(service.completeReauth(challengeId),{code});
  }
});
