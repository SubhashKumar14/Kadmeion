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

test('temporary network failure does not silently discard the locally saved session', async () => {
  let offline = true;
  const saved = storage();
  const { port } = mock((async (url: string | URL | Request) => {
    if (String(url).includes('grant_type=password')) return json(tokens);
    if (offline) throw new Error('offline');
    return json(user);
  }) as typeof fetch, saved);
  assert.equal((await port.signInWithPassword({ email: user.email, password: 'pass' })).error, null);
  assert.ok((await port.getUser()).error);
  assert.equal(saved.data.size, 1, 'transient network failure should not force logout');
  offline = false;
  assert.equal((await port.getUser()).data.user?.id, user.id);
});

test('rejected server session immediately clears the browser token', async () => {
  const saved = storage();
  const { port } = mock((async (url: string | URL | Request) => {
    if (String(url).includes('grant_type=password')) return json(tokens);
    return json({ message: 'expired' }, 401);
  }) as typeof fetch, saved);
  assert.equal((await port.signInWithPassword({ email: user.email, password: 'pass' })).error, null);
  assert.ok((await port.getUser()).error);
  assert.equal(saved.data.size, 0);
});


test('Google OAuth generates a secure S256 challenge and exact allowlisted callback',async()=>{
  const oauth=storage();
  const {port,saved}=mock((async()=>{throw new Error('sign-in URL should not fetch')}) as typeof fetch);
  const securePort=new SupabaseBrowserAuthPort({
    supabaseUrl:'https://project.supabase.co',publishableKey:'sb_publishable_test',
    appOrigin:'http://localhost:3000',storage:saved,oauthStorage:oauth,
    fetcher: (async()=>{throw new Error('no network expected')}) as typeof fetch
  });
  const response=await securePort.signInWithOAuth({provider:'google',
    options:{redirectTo:'http://localhost:3000/auth/callback'}});
  assert.equal(response.error,null);
  const url=new URL(response.data.url!);
  assert.equal(url.origin,'https://project.supabase.co');
  assert.equal(url.pathname,'/auth/v1/authorize');
  assert.equal(url.searchParams.get('flow_type'),'pkce');
  assert.equal(url.searchParams.get('code_challenge_method'),'s256');
  assert.equal(url.searchParams.get('provider'),'google');
  assert.equal(url.searchParams.get('redirect_to'),'http://localhost:3000/auth/callback');
  const tx=JSON.parse(oauth.data.get('kadmeion.oauth.google.pkce.v1')!);
  assert.equal(tx.verifier.length,64);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(tx.verifier)));
  assert.equal(url.searchParams.get('code_challenge'),
    Buffer.from(digest).toString('base64url'));
  assert.ok(!JSON.stringify([...saved.data]).includes(tx.verifier),'verifier must stay out of persistent auth storage');
  assert.ok(!response.data.url?.includes(tx.verifier),'authorization URL must never leak the verifier');
});

test('OAuth exchange uses one-time same-tab PKCE verifier and verifies session independently',async()=>{
  const persistent=storage(),oauth=storage();
  const requests:Array<{url:string;options:RequestInit}>=[];
  const port=new SupabaseBrowserAuthPort({
    supabaseUrl:'https://project.supabase.co',publishableKey:'sb_publishable_test',
    appOrigin:'http://localhost:3000',storage:persistent,oauthStorage:oauth,
    fetcher:(async(url:string|URL|Request,options?:RequestInit)=>{
      requests.push({url:String(url),options:options!});
      if(String(url).includes('grant_type=pkce'))return json(tokens);
      if(String(url).endsWith('/user'))return json(user);
      return json({},404);
    }) as typeof fetch
  });
  const initiate=await port.signInWithOAuth({provider:'google',
    options:{redirectTo:'http://localhost:3000/auth/callback'}});
  assert.equal(initiate.error,null);
  const expected=JSON.parse(oauth.data.get('kadmeion.oauth.google.pkce.v1')!).verifier;
  const exchanged=await port.exchangeCodeForSession('a-valid-auth-code');
  assert.equal(exchanged.error,null);
  assert.equal(oauth.data.size,0,'verifier must be consumed before token exchange');
  assert.equal(requests.length,1);
  assert.equal(requests[0].options.method,'POST');
  assert.deepEqual(JSON.parse(requests[0].options.body as string),{
    auth_code:'a-valid-auth-code',code_verifier:expected});
  assert.equal((await port.getUser()).data.user?.id,user.id);
  assert.ok([...persistent.data.values()].join('').includes(tokens.access_token));
  const replay=await port.exchangeCodeForSession('a-valid-auth-code');
  assert.ok(replay.error,'replaying auth code may not re-send a verifier');
  assert.equal(requests.filter(x=>x.url.includes('grant_type=pkce')).length,1);
});

test('OAuth denies open redirect, no session store, expired/malformed verifier and invalid callback',async()=>{
  const oauth=storage(),saved=storage();
  const port=new SupabaseBrowserAuthPort({
    supabaseUrl:'https://project.supabase.co',publishableKey:'sb_publishable_test',
    appOrigin:'http://localhost:3000',storage:saved,oauthStorage:oauth,
    fetcher:(async()=>{throw new Error('unexpected exchange')}) as typeof fetch
  });
  const forbidden=await port.signInWithOAuth({provider:'google',
    options:{redirectTo:'https://attacker.invalid/auth/callback'}});
  assert.ok(forbidden.error);
  assert.equal(oauth.data.size,0);
  assert.ok((await port.exchangeCodeForSession('short')).error);
  oauth.setItem('kadmeion.oauth.google.pkce.v1',JSON.stringify({
    verifier:'a'.repeat(64),expiresAt:Date.now()-5000,
    redirectTo:'http://localhost:3000/auth/callback'}));
  assert.ok((await port.exchangeCodeForSession('valid-123456789')).error);
  assert.equal(oauth.data.size,0);
  const unavailable=mock((async()=>json(tokens)) as typeof fetch);
  assert.ok((await unavailable.port.signInWithOAuth({provider:'google',
    options:{redirectTo:'http://localhost:3000/auth/callback'}})).error);
});
