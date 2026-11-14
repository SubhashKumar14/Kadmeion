import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec=promisify(execFile);
const cli='scripts/verify-host-revocation.mjs';
const canonical='/release_owner/release-fixture';
const asset='/release_owner/release-fixture/releases/0123456789abcdef/assets/0123456789abcdef.png';
function envFor(port:number,enabled=true){
  return {...process.env,KADMEION_LOCAL_INTEGRATION:'1',
    KADMEION_HOST_REVOCATION_PROBE_ENABLED:enabled?'true':'false',
    KADMEION_RELEASE_HOST_ORIGIN:'http://127.0.0.1:'+port,
    KADMEION_RELEASE_HOSTNAME:'127.0.0.1'};
}
const execute=async(port:number,enabled=true)=>
  exec(process.execPath,['--experimental-strip-types',cli,
    '--canonical',canonical,'--direct',asset],{
    cwd:process.cwd(),env:envFor(port,enabled),timeout:15000,maxBuffer:100000
  });
test('host gate checks real local HTTP GET/HEAD and fails closed on visible direct assets',async()=>{
  let visible=false;
  const visits:string[]=[];
  const server=createServer((req,res)=>{
    visits.push(req.method+' '+req.url);
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('X-Robots-Tag','noindex, nofollow');
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    if(req.url!==canonical&&req.url!==asset){
      res.statusCode=500;res.end('Unexpected host path');return;
    }
    res.statusCode=visible&&req.url===asset?200:404;
    res.end(req.method==='HEAD'?'':'Not found');
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const port=(server.address() as {port:number}).port;
  try{
    const passed=await execute(port);
    const result=JSON.parse(passed.stdout);
    assert.equal(result.status,'OBSERVED_REVOKED_ON_SCOPED_PATHS');
    assert.equal(result.observedHttpRequests,4);
    assert.equal(result.directPathsChecked,1);
    assert.equal(result.universalCacheErasureVerified,false);
    assert.equal(result.thirdPartyArchiveErasureVerified,false);
    assert.deepEqual(visits,[
      'GET '+canonical,'HEAD '+canonical,'GET '+asset,'HEAD '+asset
    ]);
    visible=true;
    await assert.rejects(execute(port),error=>{
      assert.match(String(error.stderr),/HOST_REVOCATION_PROBE_STILL_VISIBLE/);
      assert.equal(error.stdout,'');
      return true;
    });
  }finally{
    await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});
test('disabled host probe refuses work without network requests',async()=>{
  const result=await assert.rejects(execute(8765,false),error=>{
    assert.match(String(error.stderr),/HOST_REVOCATION_PROBE_PROBE_DISABLED/);
    return true;
  });
  assert.equal(result,undefined);
});
test('mismatched origin hostname refuses network operation',async()=>{
  const env={...envFor(8765),KADMEION_RELEASE_HOSTNAME:'other.invalid'};
  await assert.rejects(exec(process.execPath,[
    '--experimental-strip-types',cli,'--canonical',canonical,'--direct',asset
  ],{cwd:process.cwd(),env,timeout:10000}),error=>{
    assert.match(String(error.stderr),/HOST_REVOCATION_PROBE_INVALID_HOST_CONFIGURATION/);
    return true;
  });
});
