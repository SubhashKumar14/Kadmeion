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

test('portable snapshot round-trip preserves private source without sessions',()=>{
  const serialized=exportPortableSnapshot(snapshot);
  assert.deepEqual(importPortableSnapshot(serialized),snapshot);
  assert.ok(!serialized.includes('user-token'));
  assert.throws(()=>importPortableSnapshot('{"formatVersion":99,"kind":"kadmeion-private-project"}'));
});
