import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabasePrivateOnboardingService, OnboardingServiceError } from '../../packages/contracts/src/private-onboarding-service.ts';

const createService = (fetcher: typeof fetch, token: () => Promise<string|null> = async()=> 'test-user-jwt') =>
  new SupabasePrivateOnboardingService({
    supabaseUrl:'https://tenant.supabase.co',publishableKey:'sb_publishable_mock_key',
    token,fetcher
  });
test('private onboarding sends only authenticated owner JWT and trusted narrow RPC parameters',async()=>{
  const calls: Array<{url:string;headers:Record<string,string>;body:string}> = [];
  const svc=createService((async(url:RequestInfo|URL,opts?:RequestInit)=>{
    calls.push({url:String(url),headers:opts?.headers as Record<string,string>,body:String(opts?.body)});
    return new Response(JSON.stringify({step:'profile',status:'completed',revision:0,updated_at:'2026-11-13T00:00:00Z'}),{status:200});
  }) as typeof fetch);
  const result=await svc.setStep('profile','completed');
  assert.deepEqual(result,{step:'profile',status:'completed',revision:0,updatedAt:'2026-11-13T00:00:00Z'});
  assert.equal(calls.length,1);
  assert.ok(calls[0].url.endsWith('/rest/v1/rpc/set_private_onboarding_step'));
  assert.equal(calls[0].headers.apikey,'sb_publishable_mock_key');
  assert.equal(calls[0].headers.Authorization,'Bearer test-user-jwt');
  assert.deepEqual(JSON.parse(calls[0].body),{p_step:'profile',p_status:'completed'});
});

test('malformed step cannot reach provider and missing session denies read',async()=>{
  let called=false;
  const svc=createService((async()=>{called=true;throw Error('should not reach');}) as typeof fetch);
  await assert.rejects(svc.setStep('admin' as never,'completed'),OnboardingServiceError);
  assert.equal(called,false);
  const expired=createService((async()=>{called=true;return new Response();}) as typeof fetch,async()=>null);
  await assert.rejects(expired.list(),OnboardingServiceError);
  assert.equal(called,false);
});
test('listed states must be nonduplicated, valid and safely parsed',async()=>{
  const svc=createService((async()=>new Response(JSON.stringify([
    {step:'portfolio',status:'skipped',revision:2,updated_at:'2026-11-13T00:00:00Z'},
    {step:'profile',status:'completed',revision:1,updated_at:null}
  ]),{status:200})) as typeof fetch);
  assert.equal((await svc.list()).length,2);
  const invalid=createService((async()=>new Response(JSON.stringify([
    {step:'profile',status:'completed',revision:0,updated_at:null},
    {step:'profile',status:'skipped',revision:1,updated_at:null}
  ]),{status:200})) as typeof fetch);
  await assert.rejects(invalid.list(),OnboardingServiceError);
});
test('network errors and unauthorized responses are distinct and never reported as saved',async()=>{
  const offline=createService((async()=>{throw Error('network');}) as typeof fetch);
  await assert.rejects(offline.setStep('connections','skipped'),(error:unknown)=>{
    return error instanceof OnboardingServiceError && error.code==='PROVIDER_UNAVAILABLE';
  });
  const denied=createService((async()=>new Response('{}',{status:403})) as typeof fetch);
  await assert.rejects(denied.setStep('profile','completed'),(error:unknown)=>{
    return error instanceof OnboardingServiceError && error.code==='AUTH_REQUIRED';
  });
});
