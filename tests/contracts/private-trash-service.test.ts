import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import { SupabasePrivateTrashService, PrivateTrashError } from '../../packages/contracts/src/private-trash-service.ts';

const id = '11111111-1111-4111-8111-111111111111';
const base = 'https://example.supabase.co';
const makeClient = (fn: typeof fetch, token: string | null = 'owner-jwt') =>
  new SupabasePrivateTrashService(base, 'publishable-key', async () => token, fn);

test('Trash POST uses owner JWT and explicit target, never a service secret', async () => {
  let calls = 0;
  const client = makeClient(async (url, init) => {
    calls++;
    assert.equal(url,base + '/rest/v1/rpc/trash_private_item');
    assert.equal(init?.method,'POST');
    assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer owner-jwt');
    assert.equal((init?.headers as Record<string,string>).apikey,'publishable-key');
    assert.deepEqual(JSON.parse(init?.body as string),{p_item_type:'project',p_item_id:id});
    return Response.json({item_type:'project',item_id:id,status:'trashed',restore_until:'2026-11-28T10:00:00Z'});
  });
  assert.equal((await client.move('project',id)).status,'trashed');
  assert.equal(calls,1);
});

test('repeat Trash is idempotent and does not claim deletion', async () => {
  const client = makeClient(async () => Response.json({
    item_type:'portfolio',item_id:id,status:'already_trashed',restore_until:'2026-11-28T10:00:00Z'
  }));
  assert.equal((await client.move('portfolio',id)).status,'already_trashed');
});

test('restore is acknowledged only when visibility remains private', async () => {
  const client = makeClient(async (url) => {
    assert.equal(url,base+'/rest/v1/rpc/restore_private_item');
    return Response.json({item_type:'portfolio',item_id:id,status:'restored',public_visibility:'private'});
  });
  assert.equal((await client.restore('portfolio',id)).public_visibility,'private');
  const unverified=makeClient(async () => Response.json({item_type:'portfolio',item_id:id,status:'restored'}));
  await assert.rejects(unverified.restore('portfolio',id),{code:'INVALID_STATE'});
});

test('missing auth prevents any remote access', async () => {
  const client = makeClient(async () => { throw Error('must not fetch'); },null);
  await assert.rejects(client.move('project',id),{code:'AUTH_EXPIRED'});
});

test('malformed UUIDs and kind never reach the provider', async () => {
  const client = makeClient(async () => { throw Error('must not fetch'); });
  await assert.rejects(client.move('project','../other'),{code:'VALIDATION'});
  await assert.rejects(client.move('team' as 'project',id),{code:'VALIDATION'});
});

test('expired window surfaces a specific non-destructive recovery error', async () => {
  const client = makeClient(async () => Response.json({message:'PRIVATE_TRASH_EXPIRED'},{status:409}));
  await assert.rejects(client.restore('project',id),{code:'TRASH_EXPIRED'});
});

test('owner-only RLS-backed list and broken response rejection', async () => {
  const client = makeClient(async (url,init) => {
    assert.match(String(url),/private_trash_items\?select=/);
    assert.equal(init?.method,'GET');
    return Response.json([{id:'22222222-2222-4222-8222-222222222222',item_type:'project',item_id:id,trashed_at:'2026-11-13T10:00:00Z',
      restore_until:'2026-11-28T10:00:00Z'}]);
  });
  assert.equal((await client.list()).length,1);
  const invalid=makeClient(async () => Response.json({error:'unexpected'}));
  await assert.rejects(invalid.list(),{code:'INVALID_STATE'});
});

// Internal Edge scheduler regression coverage; no external calls or real deletion.
import {handlePurgeExpiredTrash} from '../../supabase/functions/purge-expired-trash/index.ts';
const sweepSecret='x'.repeat(40),serviceJwt='eyJ'+'.'.repeat(70);
const sweepEnv={SUPABASE_URL:'https://scyooqjitjzjdxgtanso.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:serviceJwt,KADMEION_TRASH_SWEEP_SECRET:sweepSecret,
  KADMEION_TRASH_SWEEP_ENABLED:'true'};
const scheduled=(auth='Bearer '+sweepSecret)=>new Request('https://internal.example/sweep',{
  method:'POST',headers:{authorization:auth}});
test('sweep is closed without explicit enablement, credentials or secret',async()=>{
  let calls=0;const http=(async()=>{calls++;throw Error('Unexpected request');}) as typeof fetch;
  assert.equal((await handlePurgeExpiredTrash(scheduled(),{env:{...sweepEnv,KADMEION_TRASH_SWEEP_ENABLED:'false'},http})).status,404);
  assert.equal((await handlePurgeExpiredTrash(scheduled('Bearer not-the-secret'),{env:sweepEnv,http})).status,401);
  assert.equal((await handlePurgeExpiredTrash(scheduled(),{env:{...sweepEnv,SUPABASE_URL:'https://evil.invalid'},http})).status,404);
  assert.equal(calls,0);
});
test('scheduler deletes Storage first and purges only after database confirmation',async()=>{
  const row={trash_id:id,item_type:'project',object_paths:[id+'/cover/image.png']};
  const paths:string[]=[];
  const http=(async(input:RequestInfo|URL,init?:RequestInit)=>{
    paths.push(String(input).replace(sweepEnv.SUPABASE_URL,''));
    assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer '+serviceJwt);
    if(paths.length===1)return Response.json([row]);
    if(paths.length===2){assert.equal(init?.method,'DELETE');assert.deepEqual(JSON.parse(String(init.body)),{prefixes:row.object_paths});return Response.json([]);}
    return Response.json('PURGED');
  }) as typeof fetch;
  const r=await handlePurgeExpiredTrash(scheduled(),{env:sweepEnv,http});
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{purged:1,pending:0});
  assert.deepEqual(paths,['/rest/v1/rpc/service_list_expired_trash',
    '/storage/v1/object/kadmeion-private-assets','/rest/v1/rpc/service_purge_expired_trash']);
});
test('malformed owner scope and oversized provider response fail closed',async()=>{
  const bad=(async()=>Response.json([{trash_id:id,item_type:'project',object_paths:['../../danger']}])) as typeof fetch;
  const r=await handlePurgeExpiredTrash(scheduled(),{env:sweepEnv,http:bad});
  assert.equal(r.status,503);
  const huge=(async()=>new Response(JSON.stringify([]),{headers:{'Content-Type':'application/json','Content-Length':'999999'}})) as typeof fetch;
  assert.equal((await handlePurgeExpiredTrash(scheduled(),{env:sweepEnv,http:huge})).status,503);
});
test('a Trash inventory entry cannot mix uploads from different owners',async()=>{
  const other='20000000-0000-4000-8000-000000000002';
  let calls=0;
  const http:typeof fetch=async()=>{
    calls++;
    return Response.json([{trash_id:id,item_type:'project',
      object_paths:[id+'/cover/image.png',other+'/cover/image.png']}]);
  };
  assert.equal((await handlePurgeExpiredTrash(scheduled(),{env:sweepEnv,http})).status,503);
  assert.equal(calls,1);
});
test('scheduled sweeps tolerate decoded RPC responses and reject identity length mismatch',async()=>{
  for(const encoding of ['gzip','identity']){
    const http:typeof fetch=async()=>new Response('[]',{headers:{
      'Content-Type':'application/json','Content-Encoding':encoding,'Content-Length':'25'
    }});
    const result=await handlePurgeExpiredTrash(scheduled(),{env:sweepEnv,http});
    assert.equal(result.status,encoding==='gzip'?200:503);
  }
});
test('expired trash worker reports individual failure and continues without false purge',async()=>{
  let calls=0;
  const http=(async()=>{
    calls++;
    if(calls===1)return Response.json([{trash_id:id,item_type:'portfolio',object_paths:[]}]);
    return Response.json('STATE_CHANGED');
  }) as typeof fetch;
  const r=await handlePurgeExpiredTrash(scheduled(),{env:sweepEnv,http});
  assert.equal(r.status,207);assert.deepEqual(await r.json(),{purged:0,pending:1});
});

test('local Edge container resolves the internal Kong origin only when explicitly opted in',async()=>{
  const local={...sweepEnv,SUPABASE_URL:'http://kong:8000',KADMEION_LOCAL_INTEGRATION:'1'};
  const http=(async(url:RequestInfo|URL)=>{
    assert.equal(String(url),'http://kong:8000/rest/v1/rpc/service_list_expired_trash');
    return Response.json([]);
  }) as typeof fetch;
  const response=await handlePurgeExpiredTrash(scheduled(),{env:local,http});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{purged:0,pending:0});
  const blocked=await handlePurgeExpiredTrash(scheduled(),{
    env:{...local,KADMEION_LOCAL_INTEGRATION:'0'},http});
  assert.equal(blocked.status,404);
});

test('Trash client rejects secret keys and non-root or credential-bearing API URLs',()=>{
 for(const endpoint of [
   'https://user:pass@example.supabase.co',
   'https://example.supabase.co/foreign',
   'https://example.supabase.co?redirect=unsafe',
   'https://example.supabase.co/#internal'
 ]) assert.throws(()=>new SupabasePrivateTrashService(
   endpoint,'publishable-key',async()=>null
 ),{code:'VALIDATION'});
 const jwt=['eyJhbGciOiJIUzI1NiJ9',
   Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url'),
   'c2lnbmF0dXJl'].join('.');
 for(const key of ['sb_secret_private',jwt])
   assert.throws(()=>new SupabasePrivateTrashService(
     base,key,async()=>null
   ),{code:'VALIDATION'});
});

test('B09 daily Trash schedule stays opt-in, secret-gated and bounded',()=>{
  const workflow=readFileSync(new URL('../../.github/workflows/trash-expiry.yml',import.meta.url),'utf8');
  assert.match(workflow,/schedule:\s*\n\s*- cron: '[0-9* /,]+?'/);
  assert.match(workflow,/github\.repository == 'SubhashKumar14\/Kadmeion'/);
  assert.match(workflow,/vars\.KADMEION_TRASH_SWEEP_SCHEDULE_ENABLED == 'true'/);
  assert.match(workflow,/secrets\.KADMEION_TRASH_SWEEP_SECRET/);
  assert.match(workflow,/for batch in 1 2 3 4 5; do/);
  assert.match(workflow,/if \[ "\$status" != 200 \]; then/);
  assert.match(workflow,/payload\.pending!==0/);
  assert.doesNotMatch(workflow,/\b(curl|wget)\b.*--insecure/);
  assert.doesNotMatch(workflow,/echo.*(SWEEP_SECRET|Authorization)/);
});

const journal='22222222-2222-4222-8222-222222222222';
test('atomic restore sends only exact journal RPC and requires matching private receipt', async()=>{
  let calls=0;
  const client=makeClient(async(url,init)=>{
    calls++;
    assert.equal(url,base+'/rest/v1/rpc/owner_restore_private_item_generation');
    assert.deepEqual(JSON.parse(String(init?.body)),{p_item_type:'project',p_item_id:id,p_expected_trash_id:journal});
    return Response.json({item_type:'project',item_id:id,status:'restored',public_visibility:'private',trash_id:journal});
  });
  assert.equal((await client.restoreGeneration('project',id,journal)).trash_id,journal);
  assert.equal(calls,1);
  for(const invalid of [undefined,id]){
    const bad=makeClient(async()=>Response.json({item_type:'project',item_id:id,status:'restored',public_visibility:'private',trash_id:invalid}));
    await assert.rejects(bad.restoreGeneration('project',id,journal),{code:'INVALID_STATE'});
  }
});
test('atomic restore conflicts and expiry never dispatch item-only fallback',async()=>{
  for(const [body,status,code] of [[{message:'PRIVATE_TRASH_GENERATION_CONFLICT',code:'40001'},409,'INVALID_STATE'],[{message:'PRIVATE_TRASH_EXPIRED'},409,'TRASH_EXPIRED'],[{message:'missing'},404,'PROVIDER_UNAVAILABLE']] as const){
    let calls=0;
    const client=makeClient(async(url)=>{
      calls++;
      assert.equal(url,base+'/rest/v1/rpc/owner_restore_private_item_generation');
      return Response.json(body,{status});
    });
    await assert.rejects(client.restoreGeneration('project',id,journal),{code});
    assert.equal(calls,1);
  }
});
test('generation list rejects missing and duplicate identities; empty remains usable',async()=>{
  const row={id:journal,item_type:'project',item_id:id,trashed_at:'2026-11-13T10:00:00Z',restore_until:'2026-11-28T10:00:00Z'};
  const client=makeClient(async(url)=>{
    assert.match(String(url),/select=id,item_type,item_id/);
    return Response.json([row]);
  });
  assert.equal((await client.list())[0]?.id,journal);
  for(const rows of [[{...row,id:undefined}],[row,row],[row,{...row,id:'33333333-3333-4333-8333-333333333333'}]]){
    await assert.rejects(makeClient(async()=>Response.json(rows)).list(),{code:'INVALID_STATE'});
  }
  assert.deepEqual(await makeClient(async()=>Response.json([])).list(),[]);
});
test('owner change during atomic restore discards late acknowledgement',async()=>{
  let current=true,calls=0;
  const client=new SupabasePrivateTrashService(base,'publishable-key',async()=> 'owner-jwt',async()=>{
    calls++;current=false;
    return Response.json({item_type:'project',item_id:id,status:'restored',public_visibility:'private',trash_id:journal});
  },()=>current);
  await assert.rejects(client.restoreGeneration('project',id,journal),{code:'AUTH_EXPIRED'});
  await assert.rejects(client.restoreGeneration('project',id,journal),{code:'AUTH_EXPIRED'});
  assert.equal(calls,1);
});
