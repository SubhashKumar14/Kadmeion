import test from 'node:test';
import assert from 'node:assert/strict';
import {SupabasePortfolioRevisionStore,RevisionStorageError,exportPortableSnapshot,importPortableSnapshot} from '../../packages/storage-adapters/src/index.ts';
import {createEditorHead} from '../../packages/editor-core/src/index.ts';

const snapshot=createEditorHead({
  formatVersion:1,files:{'kadmeion.json':'{"formatVersion":1}'},slots:{},stashes:{}
}).snapshot;
const portfolioId='10000000-0000-4000-8000-000000000001';
const operationId='20000000-0000-4000-8000-000000000002';
const sha='a'.repeat(64);

test('cloud store pins user JWT and validates commit acknowledgment',async()=>{
  const seen:Array<{url:string;headers:Record<string,string>}>= [];
  const mock=async(input:RequestInfo|URL,init?:RequestInit)=>{
    const headers=init?.headers as Record<string,string>;
    seen.push({url:String(input),headers});
    return new Response(JSON.stringify({
      portfolioId,revision:1,snapshotSha256:sha,alreadyCommitted:false
    }),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const store=new SupabasePortfolioRevisionStore('https://project.supabase.co','public-only',async()=> 'owner-token',mock as typeof fetch);
  const result=await store.commit(portfolioId,operationId,0,snapshot);
  assert.deepEqual(result,{portfolioId,revision:1,snapshotSha256:sha,alreadyCommitted:false});
  assert.equal(seen[0].headers.Authorization,'Bearer owner-token');
  assert.equal(seen[0].headers.apikey,'public-only');
  assert.ok(seen[0].url.endsWith('/rest/v1/rpc/commit_portfolio_revision'));
});

test('stale cloud head never automatically retries or overwrites local work',async()=>{
  const mock=async()=>new Response(JSON.stringify({code:'40001',message:'REVISION_CONFLICT'}),{status:409});
  const store=new SupabasePortfolioRevisionStore('https://project.supabase.co','public-only',async()=> 'owner-token',mock as typeof fetch);
  await assert.rejects(store.commit(portfolioId,operationId,0,snapshot),{code:'REVISION_CONFLICT'});
  const unavailable=new SupabasePortfolioRevisionStore('https://project.supabase.co','public-only',async()=>null,mock as typeof fetch);
  await assert.rejects(unavailable.commit(portfolioId,operationId,0,snapshot),RevisionStorageError);
});

test('preset initialization writes the documented draft through the existing first-revision transaction',async()=>{
  const calls:string[]=[];
  const store=new SupabasePortfolioRevisionStore('https://project.supabase.co','public-only',async()=> 'owner-token',
    async(url,options)=>{
      calls.push(options?.method??'GET');
      assert.equal(options?.redirect,'error');
      if(calls.length===1){
        assert.equal(new URL(String(url)).searchParams.get('id'),'eq.'+portfolioId);
        return Response.json([{id:portfolioId,template_id:'arc'}]);
      }
      const payload=JSON.parse(options?.body as string);
      assert.equal(payload.p_base_revision,0);
      assert.equal(payload.p_operation_id,operationId);
      assert.equal(payload.p_snapshot.slots['arc-hero-title'].state,'S0');
       assert.equal(payload.p_snapshot.slots['arc-hero-title'].componentId,'title-stacked@1');
       assert.deepEqual(payload.p_snapshot.slots['arc-hero-title'].content,{});
       assert.equal(payload.p_snapshot.slots['project-showcase-image'].state,'EMPTY');
      return Response.json({portfolioId,revision:1,snapshotSha256:sha,alreadyCommitted:false});
    });
  assert.equal((await store.initializePreset(portfolioId,operationId,'arc')).revision,1);
  assert.deepEqual(calls,['GET','POST']);
  const wrong=new SupabasePortfolioRevisionStore('https://project.supabase.co','public-only',async()=> 'owner-token',
    async()=>Response.json([{id:portfolioId,template_id:'studio'}]));
  await assert.rejects(wrong.initializePreset(portfolioId,operationId,'arc'),{code:'VALIDATION'});
});

test('portable snapshot round-trip preserves private source without sessions',()=>{
  const serialized=exportPortableSnapshot(snapshot);
  assert.deepEqual(importPortableSnapshot(serialized),snapshot);
  assert.ok(!serialized.includes('user-token'));
  assert.throws(()=>importPortableSnapshot('{"formatVersion":99,"kind":"kadmeion-private-project"}'));
});

test('cloud revisions reject privileged Supabase API keys before a network request',()=>{
 const jwt=['eyJhbGciOiJIUzI1NiJ9',
   Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url'),
   'c2lnbmF0dXJl'].join('.');
 for(const key of ['sb_secret_private',jwt])
   assert.throws(()=>new SupabasePortfolioRevisionStore(
     'https://project.supabase.co',key,async()=> 'owner-token'
   ),{code:'VALIDATION'});
});
