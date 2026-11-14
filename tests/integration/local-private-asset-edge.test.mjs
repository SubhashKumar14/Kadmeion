/**
 * Ephemeral Supabase Edge Runtime smoke: actual Deno bundle + gateway HTTP.
 * Must NEVER run against hosted Supabase or use remote service keys.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

assert.equal(process.env.KADMEION_LOCAL_INTEGRATION,'1','Local integration opt-in required');
const raw=execFileSync('supabase',['status','-o','env'],{encoding:'utf8',timeout:20_000});
const env=new Map();
for(const line of raw.split(/\r?\n/)){
  const match=line.trim().match(/^(?:export )?([A-Z_]+)=(.*)$/);
  if(match)env.set(match[1],match[2].trim().replace(/^["']|["']$/g,''));
}
const api=new URL(env.get('API_URL')||'http://127.0.0.1:54321');
assert.equal(api.protocol,'http:');
assert.ok(['127.0.0.1','localhost'].includes(api.hostname));
assert.equal(api.port,'54321');
assert.equal(api.pathname,'/');
const anon=env.get('ANON_KEY');
assert.ok(typeof anon==='string'&&anon.startsWith('eyJ')&&anon.length>70,
  'Local Supabase legacy anon JWT unavailable');
const url=api.origin+'/functions/v1/complete-private-asset';
const header={'Authorization':'Bearer '+anon,'apikey':anon,'Content-Type':'application/json'};
const request=async(body,options={})=>fetch(url,{method:'POST',
  headers:{...header,...options},body:JSON.stringify(body),
  credentials:'omit',redirect:'error',cache:'no-store',
  signal:AbortSignal.timeout(5000)});

test('B5 locally bundled Edge handler checks real gateway, origin and input',
  {timeout:90000},async()=>{
  const folder=await mkdtemp(join(tmpdir(),'kadmeion-edge-'));
  const config=join(folder,'function.env');
  await writeFile(config,
    'KADMEION_ASSET_ATTESTATION_ENABLED=true\n'+
    'KADMEION_LOCAL_INTEGRATION=1\n'+
    'KADMEION_ALLOWED_ATTEST_ORIGINS=http://localhost:3000\n');
  const worker=spawn('supabase',
    ['functions','serve','complete-private-asset','--env-file',config],{
    stdio:['ignore','pipe','pipe'],env:{...process.env,KADMEION_LOCAL_INTEGRATION:'1'}
  });
  // Drain without logging potential local keys or user content.
  worker.stdout?.on('data',()=>{});
  worker.stderr?.on('data',()=>{});
  try {
    let ready=false;
    for(let i=0;i<50;i++){
      if(worker.exitCode!==null)break;
      try{
        const response=await request({assetId:'invalid'});
        if(response.status===400){await response.body?.cancel();ready=true;break;}
        await response.body?.cancel();
      }catch{/* gateway or Deno isolate not running yet */}
      await delay(300);
    }
    assert.equal(ready,true,'Edge bundle must run and reject invalid UUID at handler level');
    const denied=await request({assetId:'invalid'},{Origin:'https://foreign.invalid'});
    assert.equal(denied.status,403,'Origin policy must reject foreign browsers');
    await denied.body?.cancel();
    const browser=await request({assetId:'invalid'},{Origin:'http://localhost:3000'});
    assert.equal(browser.status,400);
    assert.equal(browser.headers.get('access-control-allow-origin'),'http://localhost:3000');
    await browser.body?.cancel();
    const anonymous=await fetch(url,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({assetId:'invalid'}),redirect:'error',
      signal:AbortSignal.timeout(5000)});
    assert.ok(anonymous.status===401||anonymous.status===403,
      'Gateway must reject requests without a verified user JWT');
    await anonymous.body?.cancel();
  }finally{
    worker.kill('SIGTERM');
    await rm(folder,{recursive:true,force:true});
  }
});
