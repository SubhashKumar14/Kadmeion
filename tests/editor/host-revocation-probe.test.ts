import test from 'node:test';
import assert from 'node:assert/strict';
import {probeHostRevocation} from
  '../../packages/storage-adapters/src/host-revocation-probe.ts';

const input={origin:'https://kadmeion.vercel.app',
  canonicalPath:'/release_owner/release-fixture',
  candidateDirectPaths:[
    '/release_owner/release-fixture/releases/abc/assets/cover.png',
    '/releases/abc/assets/cover.png'
  ]};
function response(status=404,extra:Record<string,string>={},body='Not found') {
  return new Response(body,{status,headers:{
    'Content-Type':'text/plain; charset=utf-8',
    'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow',
    ...extra
  }});
}
test('host revocation observes GET and HEAD on route and every direct asset URL',async()=>{
  const calls:string[]=[];
  const http:typeof fetch=async(url,options)=>{
    calls.push((options?.method??'GET')+' '+new URL(String(url)).pathname);
    assert.equal(options?.credentials,'omit');
    assert.equal(options?.redirect,'error');
    assert.equal(options?.cache,'no-store');
    return response(404,{},options?.method==='HEAD'?'':'Not found');
  };
  const value=await probeHostRevocation(input,http);
  assert.deepEqual(value,{
    status:'OBSERVED_REVOKED_ON_SCOPED_PATHS',
    canonicalPath:input.canonicalPath,
    observedHttpRequests:6,directPathsChecked:2,
    universalCacheErasureVerified:false,
    thirdPartyArchiveErasureVerified:false
  });
  assert.equal(calls.length,6);
});
test('wrong or partial direct asset coverage is rejected before any HTTP fetch',async()=>{
  const invalid=[
    {...input,candidateDirectPaths:[]},
    {...input,candidateDirectPaths:['//evil.example/a']},
    {...input,candidateDirectPaths:['/../secret']},
    {...input,candidateDirectPaths:['/one','/one']},
    {...input,candidateDirectPaths:['https://foreign.example/a']},
    {...input,canonicalPath:'/app/admin'},
    {...input,origin:'http://127.0.0.1:8765'},
    {...input,origin:'https://127.0.0.1/'},
    {...input,origin:'https://user:secret@kadmeion.vercel.app/'}
  ];
  for(const candidate of invalid)await assert.rejects(
    probeHostRevocation(candidate,async()=>{throw Error('Should not fetch');}),
    {code:'INVALID_INPUT'});
});
test('an allowed isolated local HTTP host never implies hosted proof',async()=>{
  const local={...input,origin:'http://127.0.0.1:8765',allowLocal:true};
  const result=await probeHostRevocation(local,async(_url,options)=>
    response(404,{},options?.method==='HEAD'?'':'Not found'));
  assert.equal(result.universalCacheErasureVerified,false);
});
test('still reachable HTML or assets cause fail-closed observation',async()=>{
  for(const status of [200,301,302,403,500]){
    await assert.rejects(probeHostRevocation(input,async()=>response(status)),
      {code:'STILL_VISIBLE'});
  }
});
test('cacheable, indexable, redirected or ETagged denial cannot pass',async()=>{
  for(const headers of [
    {'Cache-Control':'public, max-age=600'},
    {'X-Robots-Tag':'index, follow'},
    {'Location':'https://new.example/'},
    {'ETag':'"secret"'},
    {'Content-Type':'text/html'}
  ])await assert.rejects(probeHostRevocation(input,async()=>response(404,headers)),
    {code:'UNSAFE_HEADERS'});
});
test('denial pages cannot contain unbounded output or private HTML',async()=>{
  for(const body of ['<!doctype html><html><body>private</body></html>',
    '<script>alert(1)</script>','x'.repeat(4097)]){
    await assert.rejects(probeHostRevocation(input,async()=>response(404,{},body)),
      {code:'UNSAFE_BODY'});
  }
});
test('transport outage never counts as successful revocation',async()=>{
  await assert.rejects(probeHostRevocation(input,async()=>{throw Error('Timeout');}),
    {code:'HOST_UNAVAILABLE'});
});
