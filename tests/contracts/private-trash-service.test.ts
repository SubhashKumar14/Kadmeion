import assert from 'node:assert/strict';
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
    return Response.json([{item_type:'project',item_id:id,trashed_at:'2026-11-13T10:00:00Z',
      restore_until:'2026-11-28T10:00:00Z'}]);
  });
  assert.equal((await client.list()).length,1);
  const invalid=makeClient(async () => Response.json({error:'unexpected'}));
  await assert.rejects(invalid.list(),{code:'INVALID_STATE'});
});
