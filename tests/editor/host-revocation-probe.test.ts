import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {attestAccountExitHostDenial,probeHostRevocation,verifyReleaseWithdrawal} from
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
    {...input,candidateDirectPaths:['/releases/./asset.png']},
    {...input,candidateDirectPaths:['/one','/one']},
    {...input,candidateDirectPaths:['https://foreign.example/a']},
    {...input,canonicalPath:'/app/admin'},
    {...input,canonicalPath:'/api/private'},
    {...input,canonicalPath:'/auth/signin'},
    {...input,canonicalPath:'/workspace/portfolio'},
    {...input,canonicalPath:'/release_owner/ab'},
    {...input,canonicalPath:'/release_owner/'+'a'.repeat(65)},
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
    {'CDN-Cache-Control':'public, max-age=600'},
    {'Vercel-CDN-Cache-Control':'no-store, stale-if-error=300'},
    {'Cache-Control':'no-store, max-age=60'},
    {'Content-Type':'text/html','Cache-Control':'no-store'}
  ])await assert.rejects(probeHostRevocation(input,async()=>response(404,headers)),
    {code:'UNSAFE_HEADERS'});
});
test('denial pages cannot contain unbounded output or private HTML',async()=>{
  for(const body of ['<!doctype html><html><body>private</body></html>',
    '<script>alert(1)</script>','Private portfolio content in a plain-text 404','x'.repeat(4097)]){
    await assert.rejects(probeHostRevocation(input,async()=>response(404,{},body)),
      {code:'UNSAFE_BODY'});
  }
});
test('transport outage never counts as successful revocation',async()=>{
  await assert.rejects(probeHostRevocation(input,async()=>{throw Error('Timeout');}),
    {code:'HOST_UNAVAILABLE'});
});

test('release withdrawal proves live bytes first and blocks all paths after the operation',async()=>{
  const html='<!doctype html><title>Published release</title>';
  const sha=createHash('sha256').update(html).digest('hex');
  let withdrawn=false;
  const http:typeof fetch=async(url,options)=>{
    if(!withdrawn){
      assert.equal(new URL(String(url)).pathname,input.canonicalPath);
      assert.equal(options?.method,'GET');
      return new Response(html,{headers:{'Content-Type':'text/html','Cache-Control':'no-store'}});
    }
    return response(404,{},options?.method==='HEAD'?'':'Not found');
  };
  const observation=await verifyReleaseWithdrawal(input,sha,async()=>{withdrawn=true;},http);
  assert.equal(withdrawn,true);
  assert.equal(observation.observedHttpRequests,7);
  assert.equal(observation.directPathsChecked,2);
});

test('an always-denied or unrelated canonical response cannot stand in for a live baseline',async()=>{
  let withdrawals=0;
  for(const before of [response(),new Response('<!doctype html><title>Other release</title>',{
    headers:{'Content-Type':'text/html','Cache-Control':'no-store'}
  })]){
    await assert.rejects(verifyReleaseWithdrawal(input,'a'.repeat(64),
      async()=>{withdrawals++;},async()=>before),{code:'RELEASE_NOT_OBSERVED'});
  }
  assert.equal(withdrawals,0);
});


test('withdrawal also fetches the exact previously reachable PNG bytes on each manifest path',async()=>{
  const html='<!doctype html><title>Release with media</title>';
  const png=Uint8Array.of(137,80,78,71,13,10,26,10);
  const sha=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
  const path='/releases/assets/'+sha(png)+'.png';
  const withMedia={...input,candidateDirectPaths:[path,...input.candidateDirectPaths],
    liveAssets:[{path,sha256:sha(png)}]};
  let withdrawn=false;
  const calls:string[]=[];
  const http:typeof fetch=async(url,options)=>{
    const current=new URL(String(url)).pathname;
    calls.push((options?.method??'GET')+' '+current);
    if(withdrawn)return response(404,{},options?.method==='HEAD'?'':'Not found');
    return new Response(current===path?png:html,{headers:{
      'Content-Type':current===path?'image/png':'text/html','Cache-Control':'no-store'
    }});
  };
  const result=await verifyReleaseWithdrawal(withMedia,sha(html),async()=>{withdrawn=true;},http);
  assert.equal(result.liveAssetPathsVerified,1);
  assert.equal(result.observedHttpRequests,10);
  assert.deepEqual(calls.slice(0,2),['GET '+input.canonicalPath,'GET '+path]);
  assert.ok(calls.includes('HEAD '+path));
});

test('missing, mismatched, cacheable or untracked live media cannot establish a withdrawal baseline',async()=>{
  const html='<!doctype html><title>Release</title>';
  const sha=createHash('sha256').update(html).digest('hex');
  const path='/assets/'+sha+'.png';
  const withMedia={...input,candidateDirectPaths:[path],liveAssets:[{path,sha256:sha}]};
  let withdrawals=0;
  for(const image of [
    response(),
    new Response('wrong',{headers:{'Content-Type':'image/png','Cache-Control':'no-store'}}),
    new Response(html,{headers:{'Content-Type':'image/png','Cache-Control':'no-store',
      'Surrogate-Control':'max-age=300'}})
  ]){
    await assert.rejects(verifyReleaseWithdrawal(withMedia,sha,async()=>{withdrawals++;},
      async(url)=>new URL(String(url)).pathname===path?image:new Response(html,{
        headers:{'Content-Type':'text/html','Cache-Control':'no-store'}
      })),{code:'RELEASE_NOT_OBSERVED'});
  }
  await assert.rejects(verifyReleaseWithdrawal({...input,liveAssets:withMedia.liveAssets},
    sha,async()=>{withdrawals++;},async()=>{assert.fail('must validate paths before fetch');}),
  {code:'INVALID_INPUT'});
  assert.equal(withdrawals,0);
});


test('account exit records a DB-scoped receipt only after exact canonical and direct GET/HEAD denial',async()=>{
  const planSha256='a'.repeat(64);
  const path='/api/public-portfolio?handle=release_owner&slug=release-fixture&manifest='+
    'b'.repeat(64)+'&asset='+'c'.repeat(64);
  const paths=[input.canonicalPath,path,'/u/release_owner','/u/release_owner/projects/sample-project'];
  for(const visible of [false,true]){
    const calls:string[]=[];
    let recorded=false;
    const attempt=attestAccountExitHostDenial({requestId:'e262a5d6-b099-4886-9bde-3e01d02b5ef7',
      origin:input.origin,
      rpc:async(operation,body)=>{
        if(operation==='service_account_exit_withdrawal_plan')return {paths,planSha256};
        assert.equal(body.p_plan_sha256,planSha256);
        assert.equal(body.p_checks,paths.length*2);
        recorded=true;
        return true;
      },
      http:async(url,options)=>{
        const address=new URL(String(url));
        const suffix=address.pathname+address.search;
        calls.push(options?.method+' '+suffix);
        return response(visible&&suffix===path?200:404,{},options?.method==='HEAD'?'':'Not found');
      }
    });
    if(visible)await assert.rejects(attempt,{code:'STILL_VISIBLE'});
    else{
      assert.deepEqual(await attempt,{status:'APPLICATION_HOST_DENIAL_RECORDED',observedHttpRequests:8});
      assert.ok(calls.includes('HEAD '+path));
    }
    assert.equal(recorded,!visible);
  }
});
