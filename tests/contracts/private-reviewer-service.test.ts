import test from 'node:test';
import assert from 'node:assert/strict';
import {SupabasePrivateReviewerService} from '../../packages/contracts/src/private-reviewer-service.ts';

const requestId='10000000-0000-4000-8000-000000000001';
const opId='20000000-0000-4000-8000-000000000002';
const grantId='30000000-0000-4000-8000-000000000003';
const receipt={requestId,grantId,rawToken:'a'.repeat(64),expiresAt:'2026-11-20T00:00:00Z',
  status:'REGISTERED_UNSERVABLE',alreadyRegistered:false} as const;
const client=(f:typeof fetch,token:string|null='user-jwt')=>
  new SupabasePrivateReviewerService('https://service.supabase.co','publishable',async()=>token,f);

test('review token is supplied by server, never generated from user input',async()=>{
  let calls=0;
  const service=client(async(url,init)=>{
    calls++;
    assert.match(String(url),/\/rpc\/issue_private_reviewer_grant$/);
    assert.equal(init?.method,'POST');
    assert.equal(init?.credentials,'omit');
    assert.equal(init?.cache,'no-store');
    assert.equal(init?.redirect,'error');
    assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer user-jwt');
    assert.deepEqual(JSON.parse(init?.body as string),{
      p_request_id:requestId,p_operation_id:opId,p_valid_minutes:60
    });
    return Response.json(receipt);
  });
  assert.deepEqual(await service.issue(requestId,opId,60),receipt);
  assert.equal(calls,1);
});
test('idempotent retry cannot reveal the original secret again',async()=>{
  const service=client(async()=>Response.json({...receipt,rawToken:null,alreadyRegistered:true}));
  const answer=await service.issue(requestId,opId,60);
  assert.equal(answer.rawToken,null);
});
test('fabricated public URL or token on retry cannot create a verified grant',async()=>{
  const service=client(async()=>Response.json({...receipt,rawToken:'a'.repeat(64),alreadyRegistered:true}));
  await assert.rejects(service.issue(requestId,opId,60),{code:'INVALID_ACK'});
  const malformed=client(async()=>Response.json({...receipt,rawToken:'short'}));
  await assert.rejects(malformed.issue(requestId,opId,60),{code:'INVALID_ACK'});
});
test('unauthenticated and invalid requests do not reach the server',async()=>{
  const blocked=client(async()=>{throw Error('network not expected');});
  await assert.rejects(blocked.issue(requestId,opId,0),{code:'VALIDATION'});
  const unauth=client(async()=>{throw Error('network not expected');},null);
  await assert.rejects(unauth.issue(requestId,opId,60),{code:'AUTH_EXPIRED'});
});
test('owner can revoke, but database acknowledgement is not host revocation proof',async()=>{
  const service=client(async(url,init)=>{
    assert.match(String(url),/\/rpc\/revoke_private_reviewer_grant$/);
    assert.deepEqual(JSON.parse(init?.body as string),{p_grant_id:grantId});
    return Response.json({grantId,status:'REVOKED',publicRevocationVerified:false});
  });
  assert.equal((await service.revoke(grantId)).publicRevocationVerified,false);
});
test('provider errors do not produce fake reviewer grants',async()=>{
  const quota=client(async()=>Response.json({message:'REVIEWER_GRANT_QUOTA_REACHED'},{status:400}));
  await assert.rejects(quota.issue(requestId,opId,60),{code:'QUOTA_EXCEEDED'});
  const down=client(async()=>{throw Error('network down');});
  await assert.rejects(down.issue(requestId,opId,60),{code:'PROVIDER_UNAVAILABLE'});
});

test('reviewer client rejects malformed or credentialed Supabase API origins',()=>{
  for(const origin of [
    'bad-origin','http://evil.example','https://user:password@service.supabase.co',
    'https://service.supabase.co/rest/v1','https://service.supabase.co/?x=1',
    'https://service.supabase.co/#fragment'
  ]){
    assert.throws(()=>new SupabasePrivateReviewerService(origin,'publishable',
      async()=>null),{code:'VALIDATION'});
  }
  assert.throws(()=>new SupabasePrivateReviewerService('https://service.supabase.co',
    ' ',async()=>null),{code:'VALIDATION'});
});

test('reviewer client canonicalizes localhost endpoint without path duplication',async()=>{
  let target='';
  const service=new SupabasePrivateReviewerService('http://127.0.0.1:54321/',
    'publishable',async()=> 'user-jwt',async(url)=>{
      target=String(url);return Response.json(receipt);
    });
  await service.issue(requestId,opId,60);
  assert.equal(target,'http://127.0.0.1:54321/rest/v1/rpc/issue_private_reviewer_grant');
});

test('reviewer grant expiry must be a date-time string, not a parseable number',async()=>{
  for(const expiresAt of [0,2026,null,'not-a-date']){
    await assert.rejects(client(async()=>Response.json({...receipt,expiresAt})).issue(
      requestId,opId,60),{code:'INVALID_ACK'});
  }
});
