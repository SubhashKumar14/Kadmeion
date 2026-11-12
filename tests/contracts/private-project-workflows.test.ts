import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectServiceError,SupabasePrivateProjectService} from '../../packages/contracts/src/index.ts';

const owner='00000000-0000-4000-8000-000000000001';
const project='00000000-0000-4000-8000-000000000002';

test('exposure preferences are private intent, not public release acknowledgement', async()=>{
  const calls:Array<{url:string,init:RequestInit}>=[];
  const mock=async (url:RequestInfo|URL,init?:RequestInit)=>{
    calls.push({url:String(url),init:init??{}});
    return new Response(JSON.stringify([{project_id:project,owner_user_id:owner}]),{status:201});
  };
  const service=new SupabasePrivateProjectService('https://demo.supabase.co','publishable',async()=> 'user-jwt',mock as typeof fetch);
  assert.equal(await service.requestProjectExposureIntent(project,owner,{showOnProfile:true,showCaseStudy:false}),
    'saved_private_intent');
  assert.ok(calls[0].url.endsWith('/rest/v1/project_exposure_intents?on_conflict=project_id'));
  assert.match(String((calls[0].init.headers as Record<string,string>).Prefer),/resolution=merge-duplicates/);
});

test('SQL 40001 revision conflict is preserved even when HTTP status is 400',async()=>{
  const mock=async()=>new Response(JSON.stringify({code:'40001',message:'REVISION_CONFLICT'}),{status:400});
  const service=new SupabasePrivateProjectService('https://demo.supabase.co','publishable',async()=> 'jwt',mock as typeof fetch);
  await assert.rejects(service.updateWithRevision(project,0,{slug:'first-project',title:'First project'}),{
    code:'REVISION_CONFLICT'
  });
});

test('network errors are classified without claiming a durable project write',async()=>{
  const mock=async()=>{throw Error('fetch failed');};
  const service=new SupabasePrivateProjectService('https://demo.supabase.co','publishable',async()=> 'jwt',mock as typeof fetch);
  await assert.rejects(service.listPrivateProjects(),{code:'PROVIDER_UNAVAILABLE'});
});

test('private image reads attach JWT and refuse untrusted bytes',async()=>{
  let count=0;
  const valid=new Uint8Array([137,80,78,71,13,10,26,10,0,1]);
  const mock=async(_url:RequestInfo|URL,init?:RequestInit)=>{
    count++;
    assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer user-token');
    return new Response(valid,{status:200,headers:{'content-type':'image/png'}});
  };
  const service=new SupabasePrivateProjectService('https://demo.supabase.co','publishable',async()=> 'user-token',mock as typeof fetch);
  assert.deepEqual(await service.readPrivateImage(owner,'asset_one','cover.png'),{mime:'image/png',bytes:valid});
  await assert.rejects(service.readPrivateImage(owner,'asset_one','..'),ProjectServiceError);
  assert.equal(count,1);
});
