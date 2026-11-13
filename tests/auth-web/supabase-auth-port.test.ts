import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseBrowserAuthPort } from '../../apps/auth-web/src/supabase-auth-port.ts';

const user = { id: '6d9e2f11-4f2e-4792-8401-7c4f1d61e233', email: 'dev@example.com' };
function storage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); }, data };
}
const tokens = { access_token: 'a'.repeat(64), refresh_token: 'r'.repeat(64), expires_in: 3600, user };
function mock(fetcher: typeof fetch, saved = storage()) {
  return { port: new SupabaseBrowserAuthPort({ supabaseUrl: 'https://project.supabase.co', publishableKey: 'sb_publishable_test', appOrigin: 'http://localhost:3000', fetcher, storage: saved }), saved };
}
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

test('password sign-in keeps session private in browser storage and verifies user through server', async () => {
  const paths: string[] = [];
  const { port, saved } = mock((async (url: string | URL | Request, options?: RequestInit) => {
    paths.push(String(url));
    if (String(url).includes('/token?')) return json(tokens);
    if (String(url).endsWith('/user')) {
      assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer ' + tokens.access_token);
      return json(user);
    }
    return json({}, 404);
  }) as typeof fetch);
  const login = await port.signInWithPassword({ email: user.email, password: 'strong-password' });
  assert.equal(login.error, null);
  assert.equal(login.data.session?.user.id, user.id);
  const verified = await port.getUser();
  assert.equal(verified.data.user?.email, user.email);
  assert.equal(paths.length, 2);
  assert.equal([...saved.data.values()].join('').includes('strong-password'), false);
});

test('implicit invitation consumes tokens and permits a subsequent password update', async () => {
  const requests: string[] = [];
  const { port } = mock((async (url: string | URL | Request, options?: RequestInit) => {
    requests.push((options?.method ?? '') + ' ' + String(url));
    if (String(url).endsWith('/user') && options?.method === 'GET') return json(user);
    if (String(url).endsWith('/user') && options?.method === 'PUT') return json(user);
    return json({}, 400);
  }) as typeof fetch);
  const result = await port.acceptTokens(new URLSearchParams({ ...tokens, type: 'invite', expires_in: '3600' } as unknown as Record<string, string>));
  assert.equal(result, 'invite');
  const change = await port.updateUser({ password: 'a-long-new-password' });
  assert.equal(change.error, null);
  assert.equal(change.data.user?.id, user.id);
  assert.ok(requests.some(path => path.startsWith('PUT ')));
});

test('rejected sender authentication or bad credentials produces an error, not a user session', async () => {
  const { port } = mock((async () => json({ error_code: 'invalid_credentials', message: 'secret' }, 400)) as typeof fetch);
  const outcome = await port.signInWithPassword({ email: user.email, password: 'wrong-password' });
  assert.ok(outcome.error);
  assert.equal(outcome.data, null);
  assert.equal(outcome.error?.message.includes('secret'), false);
});

test('expired stored sessions refresh before getUser and rotate refresh token', async () => {
  const saved = storage();
  let refreshCount = 0;
  const { port } = mock((async (url: string | URL | Request) => {
    if (String(url).includes('grant_type=refresh_token')) {
      refreshCount++;
      return json({ ...tokens, access_token: 'b'.repeat(64), refresh_token: 's'.repeat(64) });
    }
    if (String(url).endsWith('/user')) return json(user);
    return json({}, 404);
  }) as typeof fetch, saved);
  await port.acceptTokens(new URLSearchParams({
    access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_in: '1', type: 'recovery'
  }));
  await new Promise(resolve => setTimeout(resolve, 15));
  const verified = await port.getUser();
  assert.equal(verified.error, null);
  assert.equal(refreshCount, 1);
  assert.ok([...saved.data.values()].join('').includes('s'.repeat(64)));
});

test('token hash only accepts known verification types and rejects malformed tokens', async () => {
  const { port } = mock((async () => json(tokens)) as typeof fetch);
  await assert.rejects(port.verifyTokenHash('bad', 'invite'));
  await assert.rejects(port.verifyTokenHash('a'.repeat(32), 'admin'));
});

test('password recovery validates its exact local redirect destination', async () => {
  const { port } = mock((async () => json({})) as typeof fetch);
  assert.equal((await port.resetPasswordForEmail('dev@example.com', { redirectTo: 'https://evil.test/reset-password' })).error !== null, true);
  assert.equal((await port.resetPasswordForEmail('dev@example.com', { redirectTo: 'http://localhost:3000/reset-password' })).error, null);
});
