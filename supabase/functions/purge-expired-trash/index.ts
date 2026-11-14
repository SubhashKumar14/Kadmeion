import { timingSafeEqual } from 'node:crypto';

const respond = (status: number, body: unknown) =>
  Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});

Deno.serve(async request => {
  if (request.method !== 'POST') return respond(405, {error: 'Method not allowed'});
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const origin = Deno.env.get('SUPABASE_URL');
  const secret = Deno.env.get('KADMEION_TRASH_SWEEP_SECRET');
  const expected = new TextEncoder().encode('Bearer ' + secret);
  const supplied = new TextEncoder().encode(request.headers.get('authorization') ?? '');
  if (!key || !origin || !secret || secret.length < 32 ||
      expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return respond(401, {error: 'Unauthorized'});
  }

  async function call(path: string, method: 'POST' | 'DELETE', payload: unknown) {
    const response = await fetch(new URL(path, origin), {
      method, redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: {apikey: key!, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Storage or database request failed.');
    }
    return response.json();
  }

  const objectPath = /^[a-f0-9-]{36}\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/;
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
  let purged = 0;
  let pending = 0;
  try {
    const rows = await call('/rest/v1/rpc/service_list_expired_trash', 'POST', {p_limit: 10});
    if (!Array.isArray(rows) || rows.length > 10) throw new Error('Invalid Trash inventory.');
    for (const row of rows) {
      try {
        if (!uuid.test(row?.trash_id ?? '') || !Array.isArray(row.object_paths) ||
            row.object_paths.length > 100 || row.object_paths.some((path: unknown) =>
              typeof path !== 'string' || !objectPath.test(path) || path.includes('..'))) {
          throw new Error('Invalid Trash entry.');
        }
        if (row.object_paths.length) {
          await call('/storage/v1/object/kadmeion-private-assets', 'DELETE', {prefixes: row.object_paths});
        }
        const result = await call('/rest/v1/rpc/service_purge_expired_trash', 'POST', {p_trash_id: row.trash_id});
        if (result === 'PURGED') purged++;
        else pending++;
      } catch {
        pending++;
      }
    }
  } catch {
    return respond(503, {error: 'Trash sweep unavailable'});
  }
  return respond(pending ? 207 : 200, {purged, pending});
});
