import test from 'node:test';
import assert from 'node:assert/strict';
import {handleCompletePrivateAsset} from '../../supabase/functions/complete-private-asset/index.ts';

const assetId='123e4567-e89b-42d3-a456-426614174000';
const ownerJwt='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvd25lciJ9.signature';
const endpoint='https://scyooqjitjzjdxgtanso.supabase.co';
const env:Record<string,string>={
  KADMEION_ASSET_ATTESTATION_ENABLED:'true',SUPABASE_URL:endpoint,
  SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fake-test-key-1234567890',
  SUPABASE_SERVICE_ROLE_KEY:'eyJ'+'s'.repeat(100),
  KADMEION_ALLOWED_ATTEST_ORIGINS:'https://kadmeion.vercel.app,http://localhost:3000'
};
let calls=0;
const accepted=async(id:string,jwt:string)=>{
  calls++;
  assert.equal(id,assetId);
  assert.equal(jwt,ownerJwt);
  return {assetId,status:'WRITE_ONCE_ATTESTED'};
};
const req=(options:{
  origin?:string;method?:string;token?:string;body?:string;contentType?:string;
}={}):Request=>new Request('https://'+ 'functions.invalid/complete-private-asset',{
  method:options.method??'POST',
  headers:{
    ...(options.origin?{Origin:options.origin}:{}),
    Authorization:'Bearer '+(options.token??ownerJwt),
    'Content-Type':options.contentType??'application/json'
  },
  ...(options.method==='OPTIONS'||options.method==='GET'?{}:
    {body:options.body??JSON.stringify({assetId})})
});
const run=(r:Request, config=env,attest=accepted)=>handleCompletePrivateAsset(r,{env:config,attest});
test('default OFF has no owner, provider or privileged work',async()=>{
  calls=0;
  const res=await run(req(),{...env,KADMEION_ASSET_ATTESTATION_ENABLED:'false'});
  assert.equal(res.status,404);assert.equal(calls,0);
});
test('valid owner JWT and registered asset are acknowledged, not publicly released',async()=>{
  calls=0;
  const res=await run(req({origin:'https://kadmeion.vercel.app'}));
  assert.equal(res.status,200);
  assert.equal(res.headers.get('access-control-allow-origin'),'https://kadmeion.vercel.app');
  assert.equal(res.headers.get('cache-control')?.includes('no-store'),true);
  assert.deepEqual(await res.json(),{
    assetId,status:'WRITE_ONCE_ATTESTED',publicPublishingAllowed:false,accountDeletionAllowed:false
  });
  assert.equal(calls,1);
});
test('preflight is explicit and no request work occurs',async()=>{
  calls=0;
  const res=await run(req({method:'OPTIONS',origin:'http://localhost:3000'}));
  assert.equal(res.status,204);
  assert.match(res.headers.get('access-control-allow-headers')??'',/authorization/);
  assert.equal(calls,0);
});
test('hostile browser origins are rejected even with apparently valid JWTs',async()=>{
  calls=0;
  for(const origin of ['https://attacker.test','null','http://localhost:4000']){
    const r=await run(req({origin}));
    assert.equal(r.status,403);
  }
  assert.equal(calls,0);
});
test('non-POST methods and preflight without origin are blocked',async()=>{
  calls=0;
  assert.equal((await run(req({method:'GET'}))).status,405);
  assert.equal((await run(req({method:'OPTIONS'}))).status,403);
  assert.equal(calls,0);
});
test('missing, non-JWT, and secret-style bearer tokens are all refused',async()=>{
  calls=0;
  const inputs=['','sb_publishable_some-key','sb_secret_private-key','header.payload','not-a-jwt'];
  for(const token of inputs){
    const r=req();
    r.headers.set('Authorization',token?'Bearer '+token:'');
    assert.equal((await run(r)).status,401);
  }
  assert.equal(calls,0);
});
test('wrong content type, foreign property and array body fail closed',async()=>{
  calls=0;
  assert.equal((await run(req({contentType:'text/plain'}))).status,415);
  for(const body of [
    JSON.stringify({assetId,ownerId:'foreign'}),
    JSON.stringify([assetId]),
    JSON.stringify({assetId:'not-a-uuid'}),
    JSON.stringify({assetId:null}),
    JSON.stringify({})
  ])assert.equal((await run(req({body}))).status,400);
  assert.equal(calls,0);
});
test('bounded request does not invoke provider on oversized or malformed JSON',async()=>{
  calls=0;
  for(const body of ['x'.repeat(500),'{not-json']){
    assert.equal((await run(req({body}))).status,400);
  }
  assert.equal(calls,0);
});
test('unverified deployment configuration denies all privileged requests',async()=>{
  calls=0;
  for(const conf of [
    {...env,SUPABASE_SERVICE_ROLE_KEY:'sb_secret_unsupported'},
    {...env,SUPABASE_URL:'https://attacker.test'},
    {...env,SUPABASE_PUBLISHABLE_KEY:env.SUPABASE_SERVICE_ROLE_KEY},
    {...env,KADMEION_ALLOWED_ATTEST_ORIGINS:'*'},
    {...env,KADMEION_ALLOWED_ATTEST_ORIGINS:'https://kadmeion.vercel.app/,https://kadmeion.vercel.app/'}
  ])assert.equal((await run(req(),conf)).status,503);
  assert.equal(calls,0);
});
test('attestation errors are sanitized, with no user JWT or provider leakage',async()=>{
  calls=0;
  const r=await run(req(),env,async()=>{
    throw Error('provider private path /owner-and-service-key');
  });
  assert.equal(r.status,503);
  const data=await r.text();
  assert.ok(!data.includes('service-key'));
  assert.ok(!data.includes(ownerJwt));
  assert.equal(calls,0);
});
test('forged success receipt cannot unlock public release',async()=>{
  calls=0;
  const r=await run(req(),env,async()=>({assetId:'123e4567-e89b-42d3-a456-426614174001',
    status:'WRITE_ONCE_ATTESTED'}));
  assert.equal(r.status,409);
  assert.equal(calls,0);
});
