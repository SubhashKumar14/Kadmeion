import test from 'node:test';
import assert from 'node:assert/strict';
import {handleOwnerPublishRelease} from '../../supabase/functions/publish/index.ts';

const id='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000002';
const bearer='eyJ'+'a'.repeat(24)+'.'+'b'.repeat(24)+'.'+'c'.repeat(24);
const sha='f'.repeat(64);
const env={
  KADMEION_RELEASE_WORKER_ENABLED:'true',
  KADMEION_RELEASE_HOST_APPROVED:'true',
  KADMEION_RELEASE_HOST_REVOCATION_VERIFIED:'true',
  KADMEION_RELEASE_HOST_ORIGIN:'https://kadmeion.vercel.app',
  KADMEION_RELEASE_HOSTNAME:'kadmeion.vercel.app',
  KADMEION_ALLOWED_PUBLISH_ORIGINS:'https://kadmeion.vercel.app',
  SUPABASE_URL:'https://scyooqjitjzjdxgtanso.supabase.co',
  SUPABASE_ANON_KEY:'eyJ'+'p'.repeat(100),
  SUPABASE_SERVICE_ROLE_KEY:'eyJ'+'s'.repeat(100)
};
const consent={id,portfolio_id:'30000000-0000-4000-8000-000000000003',
  status:'AWAITING_HOST',expires_at:'2099-01-01T00:00:00Z'};
function request(body:unknown={intentId:id},method='POST',origin='https://kadmeion.vercel.app',
                 jwt=bearer) {
  return new Request('https://edge.invalid/functions/v1/publish',{
    method,headers:{
      ...(origin?{Origin:origin}:{}),
      ...(jwt?{Authorization:'Bearer '+jwt}:{}),
      'Content-Type':'application/json'
    },body:method==='GET'||method==='OPTIONS'?undefined:JSON.stringify(body)
  });
}
function fixture(options:{
  intent?:unknown;user?:unknown;providerFail?:boolean;forgedType?:boolean;
  publish?:()=>Promise<unknown>;settings?:Record<string,string>;
}={}) {
  const calls:{url:string;method:string;headers:Record<string,string>}[]=[];
  const http:typeof fetch=async(input,init)=>{
    const url=String(input);
    const headers=init?.headers as Record<string,string>;
    calls.push({url,method:init?.method??'GET',headers});
    if(options.providerFail)return Response.json({message:'failed'},{status:503});
    if(options.forgedType)return new Response('{}',{headers:{'Content-Type':'text/html'}});
    if(url.includes('/auth/v1/user'))return Response.json(options.user??{id:owner});
    if(url.includes('/private_unlisted_publication_intents?')){
      return Response.json(options.intent===undefined?[consent]:options.intent);
    }
    if(url.includes('/rpc/service_prepare_unlisted_release')){
      return Response.json({status:'ACKNOWLEDGED'});
    }
    throw Error('Unexpected trusted origin or RPC');
  };
  let published=0;
  const deps={
    env:{...env,...options.settings},http,
    publish:async(intentId:string,host:string,rpc:(name:string,body:Record<string,unknown>)=>Promise<unknown>)=>{
      published++;
      assert.equal(intentId,id);
      assert.equal(host,'https://kadmeion.vercel.app');
      if(options.publish)return options.publish();
      await rpc('service_prepare_unlisted_release',{p_intent_id:id});
      return {status:'DELIVERY_ACKNOWLEDGED',htmlSha256:sha};
    }
  };
  return {calls,deps,getPublished:()=>published};
}
test('publish worker remains disabled by default without any privileged reads',async()=>{
  const f=fixture({settings:{KADMEION_RELEASE_WORKER_ENABLED:'false'}});
  const response=await handleOwnerPublishRelease(request(),f.deps);
  assert.equal(response.status,404);
  assert.equal(f.calls.length,0);
  assert.equal(f.getPublished(),0);
});
test('release host approval and verified revocation switches must both be explicit',async()=>{
  for(const settings of [
    {KADMEION_RELEASE_HOST_APPROVED:'false'},
    {KADMEION_RELEASE_HOST_REVOCATION_VERIFIED:'false'}
  ]) {
    const f=fixture({settings});
    assert.equal((await handleOwnerPublishRelease(request(),f.deps)).status,503);
    assert.equal(f.calls.length,0);
  }
});
test('invalid private or mistyped release destinations are rejected before Auth',async()=>{
  for(const settings of [
    {KADMEION_RELEASE_HOST_ORIGIN:'https://127.0.0.1'},
    {KADMEION_RELEASE_HOSTNAME:'other.example'},
    {KADMEION_RELEASE_HOST_ORIGIN:'https://kadmeion.vercel.app/unsafe'},
    {SUPABASE_URL:'https://foreign.supabase.co'},
    {SUPABASE_SERVICE_ROLE_KEY:'weak'}
  ]) {
    const f=fixture({settings});
    assert.equal((await handleOwnerPublishRelease(request(),f.deps)).status,503);
    assert.equal(f.calls.length,0);
  }
});
test('CORS preflight, foreign origins and unsupported methods do no work',async()=>{
  const f=fixture();
  assert.equal((await handleOwnerPublishRelease(request({},'OPTIONS'),f.deps)).status,204);
  assert.equal((await handleOwnerPublishRelease(
    request({},'OPTIONS','https://attacker.invalid'),f.deps)).status,403);
  assert.equal((await handleOwnerPublishRelease(
    request({},'POST','https://attacker.invalid'),f.deps)).status,403);
  assert.equal((await handleOwnerPublishRelease(request({},'GET'),f.deps)).status,405);
  assert.equal(f.calls.length,0);
});
test('anonymous, invalid intent and excess request fields are denied before network',async()=>{
  const f=fixture();
  for(const req of [
    request({intentId:id},'POST','https://kadmeion.vercel.app',''),
    request({intentId:'bad'}),
    request({intentId:id,ownerUserId:owner}),
    request({intentId:id,privateFlag:true}),
    request({intentId:'__proto__'})
  ]) assert.ok((await handleOwnerPublishRelease(req,f.deps)).status>=400);
  assert.equal(f.calls.length,0);
});
test('owner JWT and RLS consent are checked before service-role RPCs',async()=>{
  const f=fixture({intent:[]});
  const response=await handleOwnerPublishRelease(request(),f.deps);
  assert.equal(response.status,404);
  assert.equal(f.calls.length,2);
  assert.equal(f.getPublished(),0);
  assert.ok(f.calls.every(c=>c.headers.apikey===env.SUPABASE_ANON_KEY));
  assert.ok(f.calls.every(c=>c.headers.Authorization==='Bearer '+bearer));
  assert.equal(f.calls[1].method,'GET');
});
test('expired unexecuted intent cannot publish through owner endpoint',async()=>{
  const f=fixture({intent:[{...consent,expires_at:'2020-01-01T00:00:00Z'}]});
  assert.equal((await handleOwnerPublishRelease(request(),f.deps)).status,409);
  assert.equal(f.getPublished(),0);
});
test('live invalid Auth user and malformed provider data fail closed',async()=>{
  for(const options of [
    {user:{id:'not-a-user'}},
    {intent:[{...consent,portfolio_id:'other'}]},
    {intent:[consent,consent]},
    {providerFail:true},
    {forgedType:true}
  ]){
    const f=fixture(options);
    const result=await handleOwnerPublishRelease(request(),f.deps);
    assert.ok(result.status>=400);
    assert.equal(f.getPublished(),0);
  }
});
test('verified release receipt follows Auth/RLS and privileged RPC in that order',async()=>{
  const f=fixture();
  const response=await handleOwnerPublishRelease(request(),f.deps);
  assert.equal(response.status,200);
  const value=await response.json();
  assert.equal(value.status,'DELIVERY_ACKNOWLEDGED');
  assert.equal(value.htmlSha256,sha);
  assert.equal(value.hostRevocationVerified,false);
  assert.equal(value.accountDeletionAllowed,false);
  assert.equal(value.publicUrl,undefined);
  assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');
  assert.equal(f.calls.length,3);
  assert.ok(f.calls[0].url.endsWith('/auth/v1/user'));
  assert.ok(f.calls[1].url.includes('/private_unlisted_publication_intents?'));
  assert.ok(f.calls[2].url.endsWith('/rpc/service_prepare_unlisted_release'));
  assert.equal(f.calls[0].headers.apikey,env.SUPABASE_ANON_KEY);
  assert.equal(f.calls[2].headers.apikey,env.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(f.getPublished(),1);
});
test('unverified worker acknowledgment and transport failure never become success',async()=>{
  for(const publish of [
    async()=>({status:'PRIOR_RELEASE_RESTORED',releaseGeneration:1}),
    async()=>({status:'DELIVERY_ACKNOWLEDGED',htmlSha256:'invalid'}),
    async()=>{throw Error('Provider timeout or unverified release');}
  ]){
    const f=fixture({publish});
    const response=await handleOwnerPublishRelease(request(),f.deps);
    assert.ok(response.status===409||response.status===503);
    const text=await response.text();
    assert.ok(!text.includes('Provider timeout'));
    assert.ok(!text.includes(env.SUPABASE_SERVICE_ROLE_KEY));
  }
});
