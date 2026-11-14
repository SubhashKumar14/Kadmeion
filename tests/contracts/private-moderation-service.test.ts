import assert from 'node:assert/strict';
import test from 'node:test';
import { SupabasePrivateModerationService } from '../../packages/contracts/src/private-moderation-service.ts';

const origin='https://example.supabase.co';
const caseId='10000000-0000-4000-8000-000000000001';
const ownerId='20000000-0000-4000-8000-000000000002';
const operationId='30000000-0000-4000-8000-000000000003';
const time='2026-11-14T00:00:00Z';
const summary='Evidence-backed suspicious public portfolio report';
const client=(http:typeof fetch,jwt:string|null='signed-in-jwt')=>
  new SupabasePrivateModerationService(origin,'sb_publishable_test_only',async()=>jwt,http);
const ok=(value:unknown)=>Response.json(value);

test('operator open uses JWT and bounded reason; never claims enforcement',async()=>{
  let calls=0;
  const service=client(async(url,init)=>{
    calls++;
    assert.equal(String(url),origin+'/rest/v1/rpc/operator_open_moderation_case');
    assert.equal(init?.method,'POST');
    assert.equal(init?.credentials,'omit');
    assert.equal(init?.cache,'no-store');
    assert.equal(init?.redirect,'error');
    assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer signed-in-jwt');
    assert.equal((init?.headers as Record<string,string>).apikey,'sb_publishable_test_only');
    assert.deepEqual(JSON.parse(init?.body as string),{
      p_target_user_id:ownerId,p_operation_id:operationId,p_reason_code:'ABUSE',p_summary:summary});
    return ok({caseId,status:'OPEN',alreadyRecorded:false,restrictionEnforced:false,
      publicRevocationVerified:false,secret:'not projected'});
  });
  assert.deepEqual(await service.openCase(ownerId,operationId,'ABUSE',summary),{
    caseId,status:'OPEN',alreadyRecorded:false,restrictionEnforced:false,
    publicRevocationVerified:false});
  assert.equal(calls,1);
});
test('operator replay stays idempotent and does not invent public restriction',async()=>{
  const service=client(async()=>ok({caseId,status:'OPEN',alreadyRecorded:true,
    restrictionEnforced:false,publicRevocationVerified:false}));
  assert.equal((await service.openCase(ownerId,operationId,'SPAM',summary)).alreadyRecorded,true);
});
test('appeal uses owner RPC; closure requires false enforcement flags',async()=>{
  const service=client(async(url,init)=>{
    if(String(url).endsWith('owner_appeal_moderation_case')){
      assert.equal(JSON.parse(init?.body as string).p_case_id,caseId);
      return ok({caseId,status:'APPEAL_RECORDED',alreadyRecorded:false,
        publicRevocationVerified:false});
    }
    assert.ok(String(url).endsWith('operator_close_moderation_case'));
    return ok({caseId,status:'CLOSED',alreadyRecorded:false,
      restrictionEnforced:false,publicRevocationVerified:false});
  });
  assert.equal((await service.appeal(caseId,operationId,summary)).status,'APPEAL_RECORDED');
  assert.equal((await service.closeCase(caseId,operationId,summary)).status,'CLOSED');
});
test('invalid IDs, reason, short rationale, and limit fail before network',async()=>{
  let calls=0;
  const service=client(async()=>{calls++;throw Error('should not call');});
  await assert.rejects(service.openCase('../secret',operationId,'ABUSE',summary),{code:'VALIDATION'});
  await assert.rejects(service.openCase(ownerId,operationId,'WRONG' as 'ABUSE',summary),{code:'VALIDATION'});
  await assert.rejects(service.appeal(caseId,operationId,'short'),{code:'VALIDATION'});
  await assert.rejects(service.closeCase(caseId,operationId,'x'.repeat(2001)),{code:'VALIDATION'});
  await assert.rejects(service.listOperatorCases(51),{code:'VALIDATION'});
  assert.equal(calls,0);
});
test('missing session fails before provider access',async()=>{
  let calls=0;
  const service=client(async()=>{calls++;throw Error('should not call');},null);
  await assert.rejects(service.listOwnerCases(),{code:'AUTH_EXPIRED'});
  assert.equal(calls,0);
});
test('malformed or false success receipts fail closed',async()=>{
  for(const raw of [null,[],{caseId,status:'OPEN',alreadyRecorded:false,
    restrictionEnforced:true,publicRevocationVerified:false},
    {caseId,status:'OPEN',alreadyRecorded:false,restrictionEnforced:false,
    publicRevocationVerified:true}]){
    await assert.rejects(client(async()=>ok(raw)).openCase(ownerId,operationId,'ABUSE',summary),
      {code:'INVALID_ACK'});
  }
  await assert.rejects(client(async()=>ok({caseId:ownerId,status:'CLOSED',alreadyRecorded:false,
    restrictionEnforced:false,publicRevocationVerified:false})).closeCase(caseId,operationId,summary),
    {code:'INVALID_ACK'});
});
test('operator list validates bounded minimal records and strips extra fields',async()=>{
  const service=client(async(url,init)=>{
    assert.match(String(url),/rpc\/operator_list_moderation_cases$/);
    assert.equal(JSON.parse(init?.body as string).p_max,25);
    return ok([{caseId,targetUserId:ownerId,reasonCode:'SECURITY',status:'APPEAL_PENDING',
      createdAt:time,privateEmail:'must-not-return'}]);
  });
  assert.deepEqual(await service.listOperatorCases(),[{caseId,targetUserId:ownerId,
    reasonCode:'SECURITY',status:'APPEAL_PENDING',createdAt:time}]);
  await assert.rejects(client(async()=>ok([{caseId,targetUserId:'bad',reasonCode:'ABUSE',
    status:'OPEN',createdAt:time}])).listOperatorCases(),{code:'INVALID_ACK'});
});
test('owner case and event listing use RLS-backed column projections',async()=>{
  const service=client(async(url,init)=>{
    assert.equal(init?.method,'GET');
    assert.equal(init?.cache,'no-store');
    if(String(url).includes('private_moderation_cases?')){
      assert.match(String(url),/select=id,reason_code,summary,status,created_at,updated_at/);
      return ok([{id:caseId,reason_code:'ABUSE',summary,status:'OPEN',created_at:time,
        updated_at:time,owner_user_id:ownerId}]);
    }
    assert.match(String(url),/private_moderation_events\?select=id,case_id,actor_user_id,event_type,detail,created_at/);
    return ok([{id:operationId,case_id:caseId,actor_user_id:null,event_type:'OPENED',
      detail:summary,created_at:time,secret:'not projected'}]);
  });
  assert.deepEqual(await service.listOwnerCases(),[{id:caseId,reason_code:'ABUSE',
    summary,status:'OPEN',created_at:time,updated_at:time}]);
  assert.deepEqual(await service.listOwnerEvents(),[{id:operationId,case_id:caseId,
    actor_user_id:null,event_type:'OPENED',detail:summary,created_at:time}]);
});
test('RLS denial, conflict, quota and network failure map without leaking provider data',async()=>{
  for(const [status,body,code] of [
    [401,{},'AUTH_EXPIRED'],[403,{},'FORBIDDEN'],[409,{},'CONFLICT'],
    [400,{message:'MODERATION_CASE_QUOTA_REACHED'},'QUOTA_EXCEEDED'],
    [400,{message:'INVALID_MODERATION_CASE'},'VALIDATION']
  ] as const){
    await assert.rejects(client(async()=>Response.json(body,{status})).openCase(
      ownerId,operationId,'ABUSE',summary),{code});
  }
  await assert.rejects(client(async()=>{throw Error('private network error');}).listOwnerEvents(),
    {code:'PROVIDER_UNAVAILABLE'});
});
test('non-origin URLs, credentials and insecure remote endpoints reject',()=>{
  for(const bad of ['http://evil.example','https://user:password@example.com',
    'https://example.com/path','https://example.com/?x=1']){
    assert.throws(()=>new SupabasePrivateModerationService(bad,'key',async()=>null),
      {code:'VALIDATION'});
  }
});

test('operator private block uses scoped case and refuses public authority',async()=>{
  const portfolioId='40000000-0000-4000-8000-000000000004';
  const service=client(async(url,init)=>{
    assert.equal(String(url),origin+'/rest/v1/rpc/operator_block_private_portfolio');
    assert.equal(init?.method,'POST');
    assert.equal(init?.credentials,'omit');
    assert.equal(init?.cache,'no-store');
    assert.deepEqual(JSON.parse(init?.body as string),{
      p_case_id:caseId,p_portfolio_id:portfolioId,p_operation_id:operationId});
    return ok({caseId,portfolioId,generation:2,status:'BLOCKED',
      stillBlocked:true,alreadyRecorded:false,publicServingEnabled:false,
      publicUrl:null,hostRevocationVerified:false,privateNote:'not projected'});
  });
  assert.deepEqual(await service.blockPrivatePortfolio(caseId,portfolioId,operationId),{
    caseId,portfolioId,generation:2,status:'BLOCKED',
    stillBlocked:true,alreadyRecorded:false,publicServingEnabled:false,
    publicUrl:null,hostRevocationVerified:false});
});
test('operator block rejects forged, stale, wrong-scope and public receipts',async()=>{
  const portfolioId='40000000-0000-4000-8000-000000000004';
  const valid={caseId,portfolioId,generation:2,status:'BLOCKED',
    stillBlocked:true,alreadyRecorded:false,publicServingEnabled:false,
    publicUrl:null,hostRevocationVerified:false};
  for(const patch of [{caseId:ownerId},{portfolioId:ownerId},
    {generation:0},{generation:1.5},{status:'PREPARED_PRIVATE'},
    {stillBlocked:false},{alreadyRecorded:'false'},
    {publicServingEnabled:true},{publicUrl:'https://example.com'},
    {hostRevocationVerified:true}]){
    await assert.rejects(client(async()=>ok({...valid,...patch})).blockPrivatePortfolio(
      caseId,portfolioId,operationId),{code:'INVALID_ACK'});
  }
  let calls=0;
  const invalid=client(async()=>{calls++;throw Error('must not call');});
  await assert.rejects(invalid.blockPrivatePortfolio('bad',portfolioId,operationId),
    {code:'VALIDATION'});
  await assert.rejects(invalid.blockPrivatePortfolio(caseId,portfolioId,'bad'),
    {code:'VALIDATION'});
  assert.equal(calls,0);
});
test('operator block denies signed-out calls and maps case conflicts',async()=>{
  const portfolioId='40000000-0000-4000-8000-000000000004';
  await assert.rejects(client(async()=>{throw Error('no request');},null)
    .blockPrivatePortfolio(caseId,portfolioId,operationId),{code:'AUTH_EXPIRED'});
  await assert.rejects(client(async()=>Response.json(
    {message:'MODERATION_HOLD_ALREADY_ACTIVE'},{status:400}))
    .blockPrivatePortfolio(caseId,portfolioId,operationId),{code:'CONFLICT'});
});


test('administrator-only private hold lift validates rationale and never republishes',async()=>{
  const portfolioId='40000000-0000-4000-8000-000000000004';
  const service=client(async(url,init)=>{
    assert.equal(String(url),origin+'/rest/v1/rpc/operator_lift_private_moderation_hold');
    assert.equal(init?.method,'POST');
    assert.equal(init?.credentials,'omit');
    assert.equal(init?.cache,'no-store');
    assert.deepEqual(JSON.parse(init?.body as string),{
      p_case_id:caseId,p_portfolio_id:portfolioId,p_operation_id:operationId,
      p_rationale:summary
    });
    return ok({caseId,portfolioId,generation:3,status:'RELEASED_PRIVATE',
      alreadyRecorded:false,publicServingEnabled:false,publicUrl:null,
      hostRevocationVerified:false,privateTrace:'not projected'});
  });
  assert.deepEqual(await service.liftPrivateHold(caseId,portfolioId,operationId,summary),{
    caseId,portfolioId,generation:3,status:'RELEASED_PRIVATE',
    alreadyRecorded:false,publicServingEnabled:false,publicUrl:null,
    hostRevocationVerified:false
  });
});
test('hold lift rejects forged state or ID, including claims of public serving',async()=>{
  const portfolioId='40000000-0000-4000-8000-000000000004';
  const valid={caseId,portfolioId,generation:3,status:'RELEASED_PRIVATE',
    alreadyRecorded:true,publicServingEnabled:false,publicUrl:null,
    hostRevocationVerified:false};
  for(const patch of [
    {caseId:ownerId},{portfolioId:ownerId},{generation:0},
    {status:'PUBLISHED'},{alreadyRecorded:'yes'},
    {publicServingEnabled:true},{publicUrl:'https://fake.invalid'},
    {hostRevocationVerified:true}
  ]) {
    await assert.rejects(client(async()=>ok({...valid,...patch}))
      .liftPrivateHold(caseId,portfolioId,operationId,summary),{code:'INVALID_ACK'});
  }
  let count=0;
  const service=client(async()=>{count++;throw Error('not reached');});
  await assert.rejects(service.liftPrivateHold('bad',portfolioId,operationId,summary),
    {code:'VALIDATION'});
  await assert.rejects(service.liftPrivateHold(caseId,portfolioId,operationId,'short'),
    {code:'VALIDATION'});
  assert.equal(count,0);
});
test('admin-only hold lift requires signed-in operator and resolved case',async()=>{
  const portfolioId='40000000-0000-4000-8000-000000000004';
  await assert.rejects(client(async()=>{throw Error('no request');},null)
    .liftPrivateHold(caseId,portfolioId,operationId,summary),{code:'AUTH_EXPIRED'});
  await assert.rejects(client(async()=>Response.json(
    {message:'MODERATION_CASE_NOT_RESOLVED'},{status:400}))
    .liftPrivateHold(caseId,portfolioId,operationId,summary),{code:'CONFLICT'});
  await assert.rejects(client(async()=>Response.json(
    {message:'ADMINISTRATOR_REQUIRED'},{status:403}))
    .liftPrivateHold(caseId,portfolioId,operationId,summary),{code:'FORBIDDEN'});
});
test('owner moderation events accept reasoned hold release but no arbitrary events',async()=>{
  const data={id:operationId,case_id:caseId,actor_user_id:null,
    event_type:'OPERATOR_HOLD_LIFT',detail:summary,created_at:time};
  assert.deepEqual(await client(async()=>ok([data])).listOwnerEvents(),[data]);
  await assert.rejects(client(async()=>ok([{...data,event_type:'PUBLISH'}]))
    .listOwnerEvents(),{code:'INVALID_ACK'});
});
