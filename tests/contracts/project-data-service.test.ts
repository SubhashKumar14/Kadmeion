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
