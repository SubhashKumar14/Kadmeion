import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesImageSignature, SupabasePrivateProjectService, ProjectServiceError } from '../../packages/contracts/src/index.ts';

test('image signatures prevent MIME-only spoofing', () => {
  assert.equal(matchesImageSignature('image/png',new Uint8Array([137,80,78,71,13,10,26,10])),true);
  assert.equal(matchesImageSignature('image/jpeg',new Uint8Array([255,216,255,1])),true);
  assert.equal(matchesImageSignature('image/png',new Uint8Array([255,216,255])),false);
  assert.equal(matchesImageSignature('image/svg+xml',new Uint8Array([60,115,118,103])),false);
});

test('private project requests require user JWT and never attach service keys', async () => {
  const used: {url:string; options: RequestInit}[]=[];
  const fetcher = async (url: RequestInfo | URL, options?: RequestInit) => {
    used.push({url:String(url),options:options??{}});
    return new Response(JSON.stringify([{id:'project-id',owner_user_id:'owner',revision:0,slug:'sample',title:'Sample'}]),{
      status:201,headers:{'Content-Type':'application/json'}
    });
  };
  const service = new SupabasePrivateProjectService('https://project.supabase.co','public-test-key',async()=> 'user-jwt',fetcher as typeof fetch);
  await service.addPrivateProject('owner',{slug:'sample',title:'Sample'});
  assert.equal(used.length,1);
  const headers=used[0].options.headers as Record<string,string>;
  assert.equal(headers.apikey,'public-test-key');
  assert.equal(headers.Authorization,'Bearer user-jwt');
  assert.equal(used[0].options.method,'POST');
  await assert.rejects(new SupabasePrivateProjectService('https://project.supabase.co','public-test-key',async()=>null,fetcher as typeof fetch).listPrivateProjects(), ProjectServiceError);
});

test('unsafe asset content is rejected before any Storage request', async () => {
  const service = new SupabasePrivateProjectService('https://project.supabase.co','pub',async()=>'jwt',
    (async()=>{throw Error('Should not call the network');}) as typeof fetch);
  await assert.rejects(service.uploadPrivateImage('00000000-0000-4000-8000-0000000000a1','asset','bad.png','image/png',new Uint8Array([60,115,118,103])),ProjectServiceError);
});

test('asset registration uses only the owner-verified Storage-RPC, never direct metadata inserts',async()=>{
  const calls: Array<{url:string;body:Record<string,unknown>;headers:Record<string,string>}>=[];
  const service=new SupabasePrivateProjectService('https://project.supabase.co','sb_publishable_mock',async()=> 'owner-jwt',
    (async(url:RequestInfo|URL,opts?:RequestInit)=>{
      const body=JSON.parse(String(opts?.body)) as Record<string,unknown>;
      calls.push({url:String(url),body,headers:opts?.headers as Record<string,string>});
      return new Response(JSON.stringify({id:'00000000-0000-4000-8000-00000000a001',
        object_path:body.p_object_path,storage_metadata_matched:true}),{status:200});
    }) as typeof fetch);
  const owner='00000000-0000-4000-8000-0000000000a1';
  const path=owner+'/image01/cover.png';
  const id=await service.linkPrivateImageMetadata('10000000-0000-4000-8000-0000000000a1',owner,path,'image/png',1024,'Portfolio cover');
  assert.equal(id,'00000000-0000-4000-8000-00000000a001');
  assert.equal(calls.length,1);
  assert.match(calls[0].url,/\/rest\/v1\/rpc\/register_private_project_image$/);
  assert.equal(calls[0].headers.Authorization,'Bearer owner-jwt');
  assert.equal(calls[0].body.p_object_path,path);
  assert.equal(calls[0].body.p_byte_size,1024);
  assert.equal('owner_user_id' in calls[0].body,false);
});
test('an unverified Storage RPC response cannot be represented as saved image metadata',async()=>{
  const owner='00000000-0000-4000-8000-0000000000a1';
  const service=new SupabasePrivateProjectService('https://project.supabase.co','sb_publishable_mock',async()=> 'owner-jwt',
    (async()=>new Response(JSON.stringify({id:'asset',verified:false}),{status:200})) as typeof fetch);
  await assert.rejects(service.linkPrivateImageMetadata('10000000-0000-4000-8000-0000000000a1',owner,
    owner+'/img/cover.png','image/png',200,'Title'),ProjectServiceError);
});
