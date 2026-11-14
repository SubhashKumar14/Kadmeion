/**
 * Real ephemeral Supabase gateway + Deno function smoke.
 * Runs only on local CLI ports with freshly generated test credentials.
 * No hosted keys, emails, databases, or publication hosts are used.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

assert.equal(process.env.KADMEION_LOCAL_INTEGRATION,'1',
  'Only run publish gateway smoke against isolated local Supabase');
const raw=execFileSync('supabase',['status','-o','env'],{
  encoding:'utf8',timeout:20_000});
const cfg=new Map();
for(const line of raw.split(/\r?\n/)){
  const match=line.trim().match(/^(?:export )?([A-Z_]+)=(.*)$/);
  if(match)cfg.set(match[1],match[2].trim().replace(/^["']|["']$/g,''));
}
const api=new URL(cfg.get('API_URL')||'http://127.0.0.1:54321');
assert.equal(api.protocol,'http:');
assert.ok(['localhost','127.0.0.1'].includes(api.hostname));
assert.equal(api.port,'54321');
const anon=cfg.get('ANON_KEY'),service=cfg.get('SERVICE_ROLE_KEY');
assert.ok(anon?.startsWith('eyJ')&&anon.length>70);
assert.ok(service?.startsWith('eyJ')&&service.length>70);
const functionUrl=api.origin+'/functions/v1/publish';
const jsonHeaders=(token)=>({apikey:anon,Authorization:'Bearer '+token,
  'Content-Type':'application/json'});
const request=(token,body,extra={})=>fetch(functionUrl,{
  method:'POST',headers:{...jsonHeaders(token),...extra},
  body:JSON.stringify(body),credentials:'omit',cache:'no-store',
  redirect:'error',signal:AbortSignal.timeout(5000)
});

test('B4: actual local publication Edge gateway enforces JWT and owner intent access',
  {timeout:120000},async()=>{
  const folder=await mkdtemp(join(tmpdir(),'kadmeion-publish-'));
  const settings=join(folder,'function.env');
  await writeFile(settings,[
    'KADMEION_LOCAL_INTEGRATION=1',
    'KADMEION_RELEASE_WORKER_ENABLED=true',
    'KADMEION_RELEASE_HOST_APPROVED=true',
    'KADMEION_RELEASE_HOST_REVOCATION_VERIFIED=true',
    'KADMEION_RELEASE_HOST_ORIGIN=http://127.0.0.1:3000',
    'KADMEION_RELEASE_HOSTNAME=127.0.0.1',
    'KADMEION_ALLOWED_PUBLISH_ORIGINS=http://localhost:3000'
  ].join('\n')+'\n');
  const child=spawn('supabase',['functions','serve','publish','--env-file',settings],{
    stdio:['ignore','pipe','pipe'],env:{...process.env,KADMEION_LOCAL_INTEGRATION:'1'}
  });
  const diagnostics=[];
  const capture=data=>{
    for(const line of String(data).slice(0,10000).split(/\r?\n/))
      if(/error|failed|denied|unable|resolution/i.test(line)&&diagnostics.length<6)
        diagnostics.push(line.replace(/(?:eyJ|sb_secret_)[A-Za-z0-9_.-]+/g,'[redacted]').slice(0,150));
  };
  child.stderr?.on('data',capture);
  child.stdout?.on('data',capture);
  try{
    let ready=false;
    const statuses=new Set();
    for(let n=0;n<50;n++){
      if(child.exitCode!==null)break;
      try{
        const r=await request(anon,{intentId:'not-a-uuid'});
        statuses.add(r.status);
        if(r.status===400){ready=true;await r.body?.cancel();break;}
        await r.body?.cancel();
      }catch{/* local gateway still starting */}
      await delay(300);
    }
    assert.ok(ready,'Local publish Edge bundle did not start: statuses='+
      [...statuses].join(',')+'; exit='+child.exitCode+
      '; startup='+diagnostics.join(' | '));

    // Keep a bounded retry for CLI runtime restarts, not for wrong HTTP codes.
    const stable=async(call)=>{
      let last;
      for(let attempt=0;attempt<4;attempt++){
        if(child.exitCode!==null)
          throw Error('Publish isolate exited: '+child.exitCode+'; '+diagnostics.join(' | '));
        try{return await call();}
        catch(error){last=error;await delay(250);}
      }
      throw Error('Local publish transport unavailable: '+
        (last instanceof Error?last.message:'unknown')+'; '+diagnostics.join(' | '));
    };
    const foreign=await stable(()=>request(anon,{intentId:'not-a-uuid'},
      {Origin:'https://foreign.invalid'}));
    assert.equal(foreign.status,403);
    await foreign.body?.cancel();
    const allowed=await stable(()=>request(anon,{intentId:'not-a-uuid'},
      {Origin:'http://localhost:3000'}));
    assert.equal(allowed.status,400);
    await allowed.body?.cancel();
    const anonymous=await stable(()=>fetch(functionUrl,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({intentId:randomUUID()}),
      redirect:'error',signal:AbortSignal.timeout(5000)}));
    assert.ok([401,403].includes(anonymous.status),
      'Anonymous browser bypassed the Supabase Edge JWT gateway');
    await anonymous.body?.cancel();

    const email='ci-publish-'+randomUUID()+'@testing.invalid';
    const password='LocalPublish!'+randomUUID();
    const created=await fetch(api.origin+'/auth/v1/admin/users',{
      method:'POST',headers:{...jsonHeaders(service),apikey:service},
      body:JSON.stringify({email,password,email_confirm:true}),
      signal:AbortSignal.timeout(10000)});
    assert.equal(created.status,200,'Local Auth fixture creation failed');
    await created.body?.cancel();
    const signed=await fetch(api.origin+'/auth/v1/token?grant_type=password',{
      method:'POST',headers:jsonHeaders(anon),
      body:JSON.stringify({email,password}),signal:AbortSignal.timeout(10000)});
    assert.equal(signed.status,200,'Local owner sign-in failed');
    const token=(await signed.json()).access_token;
    assert.ok(typeof token==='string'&&token.length>70);
    const nonOwner=await stable(()=>request(token,{intentId:randomUUID()}));
    assert.equal(nonOwner.status,404,
      'Owner must not be able to operate without their own release consent');
    const body=await nonOwner.text();
    assert.ok(!body.includes(service),'Privileged credential leaked into response');
  }finally{
    child.kill('SIGTERM');
    await rm(folder,{recursive:true,force:true});
  }
});
