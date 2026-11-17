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

test('native browser fetch keeps its global receiver', async context => {
  const browserFetch = context.mock.method(globalThis, 'fetch', async function (this: unknown) {
    assert.equal(this, globalThis);
    return json(tokens);
  });
  const port = new SupabaseBrowserAuthPort({
    supabaseUrl: 'https://project.supabase.co', publishableKey: 'sb_publishable_test',
    appOrigin: 'http://localhost:3000', storage: storage()
  });
  const login = await port.signInWithPassword({email: user.email, password: 'test-password'});
  assert.equal(login.error, null);
  assert.equal(login.data.session?.user.id, user.id);
  assert.equal(browserFetch.mock.callCount(), 1);
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


test('signing out other sessions preserves the verified current browser session',async()=>{
  const saved=storage();
  const requests:string[]=[];
  const {port}=mock((async(url:string|URL|Request,options?:RequestInit)=>{
    const u=String(url);
    requests.push(u);
    if(u.includes('grant_type=password'))return json(tokens);
    if(u.includes('/logout?scope=others')){
      assert.equal(options?.method,'POST');
      assert.equal((options?.headers as Record<string,string>).Authorization,
        'Bearer '+tokens.access_token);
      return json({});
    }
    if(u.endsWith('/user'))return json(user);
    return json({},404);
  }) as typeof fetch,saved);
  assert.equal((await port.signInWithPassword({email:user.email!,password:'password'})).error,null);
  const kept=[...saved.data.values()][0];
  assert.equal((await port.signOut({scope:'others'})).error,null);
  assert.equal([...saved.data.values()][0],kept);
  assert.equal((await port.getUser()).data.user?.id,user.id);
  assert.ok(requests.some(u=>u.includes('/logout?scope=others')));
});

test('remote failure when revoking other sessions preserves current session and reports error',async()=>{
  const saved=storage();
  const {port}=mock((async(url:string|URL|Request)=>{
    if(String(url).includes('grant_type=password'))return json(tokens);
    throw new Error('unavailable');
  }) as typeof fetch,saved);
  assert.equal((await port.signInWithPassword({email:user.email!,password:'password'})).error,null);
  const value=[...saved.data.values()][0];
  const result=await port.signOut({scope:'others'});
  assert.ok(result.error);
  assert.equal([...saved.data.values()][0],value);
  assert.equal(result.data,null);
});

test('local sign-out clears the current browser session and denies later access',async()=>{
  const saved=storage();
  const {port}=mock((async(url:string|URL|Request)=>{
    if(String(url).includes('grant_type=password'))return json(tokens);
    if(String(url).includes('/logout?scope=local'))return json({});
    return json({},404);
  }) as typeof fetch,saved);
  assert.equal((await port.signInWithPassword({email:user.email!,password:'password'})).error,null);
  assert.equal((await port.signOut({scope:'local'})).error,null);
  assert.equal(saved.data.size,0);
  assert.ok((await port.getUser()).error);
});


test('an email callback cannot replace a signed-in account with a different user', async () => {
  const wrongUser = {...user, id: '2826297f-24b1-42ca-97b0-0cd09d82ea5a'};
  const {port, saved} = mock(async (url) => {
    if (String(url).includes('/token?')) return json(tokens);
    if (String(url).endsWith('/verify')) return json({...tokens, user: wrongUser});
    return json(wrongUser);
  });
  assert.equal((await port.signInWithPassword({email:user.email,password:'pass'})).error, null);
  const before=[...saved.data.entries()];
  await assert.rejects(port.verifyTokenHash('a'.repeat(32), 'recovery'), /Sign out/);
  await assert.rejects(port.acceptTokens(new URLSearchParams({
    access_token:'b'.repeat(64),refresh_token:'c'.repeat(64),type:'recovery'
  })), /Sign out/);
  assert.deepEqual([...saved.data.entries()],before);
});


test('the provider resend and recovery reject redirect query, credentials and fragments',async()=>{
  let calls=0;
  const {port}=mock(async(url,init)=>{
    calls++;
    assert.equal(String(url),'https://project.supabase.co/auth/v1/resend?redirect_to='+encodeURIComponent('http://localhost:3000/auth/callback'));
    assert.deepEqual(JSON.parse(String(init?.body)),{type:'signup',email:'dev@example.com'});
    return json({});
  });
  for(const target of [
    'http://localhost:3000/auth/callback?next=/other',
    'http://user@localhost:3000/auth/callback',
    'http://localhost:3000/auth/callback#fragment'
  ]) assert.ok((await port.resend({type:'signup',email:'dev@example.com',
    options:{emailRedirectTo:target}})).error);
  assert.ok((await port.resetPasswordForEmail('dev@example.com',
    {redirectTo:'http://localhost:3000/reset-password?next=/other'})).error);
  assert.equal(calls,0);
  assert.equal((await port.resend({type:'signup',email:'dev@example.com',
    options:{emailRedirectTo:'http://localhost:3000/auth/callback'}})).error,null);
  assert.equal(calls,1);
});

const secondUser = {id:'2826297f-24b1-42ca-97b0-0cd09d82ea5a',email:'other@example.com'};
const secondTokens = {...tokens,access_token:'b'.repeat(64),
  refresh_token:'s'.repeat(64),user:secondUser};

test('B10 getUser rejects a mismatched Auth identity and clears only the initiating session',async()=>{
  const saved=storage();
  const {port}=mock((async(url:string|URL|Request)=>{
    if(String(url).includes('grant_type=password'))return json(tokens);
    if(String(url).endsWith('/user'))return json(secondUser);
    return json({},404);
  }) as typeof fetch,saved);
  assert.equal((await port.signInWithPassword({email:user.email,password:'password'})).error,null);
  const result=await port.getUser();
  assert.ok(result.error);
  assert.equal(result.data,null);
  assert.equal(saved.data.size,0,'Mismatch must not retain the claimed identity');
});

test('B10 refresh rejects cross-owner credentials and does not authorize a substituted identity',async()=>{
  const saved=storage();
  let calls=0;
  const {port}=mock((async(url:string|URL|Request)=>{
    if(String(url).includes('grant_type=refresh_token')){
      calls++;return json(secondTokens);
    }
    if(String(url).endsWith('/user'))return json(user);
    throw Error('Unexpected Auth call');
  }) as typeof fetch,saved);
  await port.acceptTokens(new URLSearchParams({
    access_token:tokens.access_token,refresh_token:tokens.refresh_token,
    expires_in:'1',type:'recovery'
  }));
  const refused=await port.getUser();
  assert.ok(refused.error);
  assert.equal(refused.data,null);
  assert.equal(calls,1);
  assert.equal(saved.data.size,0);
});

test('B10 late refresh cannot overwrite a new sign-in or clear a new account',async()=>{
  const saved=storage();
  let resolveRefresh!:(result:Response)=>void;
  let started!:()=>void;
  const waiting=new Promise<Response>(resolve=>{resolveRefresh=resolve;});
  const began=new Promise<void>(resolve=>{started=resolve;});
  const {port}=mock((async(url:string|URL|Request,init?:RequestInit)=>{
    const u=String(url);
    if(u.includes('grant_type=refresh_token')){started();return waiting;}
    if(u.includes('grant_type=password'))return json(secondTokens);
    if(u.endsWith('/user')){
      const bearer=(init?.headers as Record<string,string>)?.Authorization;
      return json(bearer==='Bearer '+tokens.access_token?user:secondUser);
    }
    throw Error('Unexpected Auth call');
  }) as typeof fetch,saved);
  await port.acceptTokens(new URLSearchParams({
    access_token:tokens.access_token,refresh_token:tokens.refresh_token,
    expires_in:'1',type:'recovery'
  }));
  const staleCheck=port.getUser();
  await began;
  const newLogin=await port.signInWithPassword({email:secondUser.email,password:'another-password'});
  assert.equal(newLogin.error,null);
  resolveRefresh(json({...tokens,access_token:'c'.repeat(64),refresh_token:'t'.repeat(64)}));
  assert.ok((await staleCheck).error,'An obsolete refresh must fail closed');
  assert.equal((await port.getUser()).data.user?.id,secondUser.id);
  const stored=[...saved.data.values()].join('');
  assert.ok(stored.includes(secondTokens.refresh_token));
  assert.ok(!stored.includes('t'.repeat(64)));
});

test('B10 password updates reject a foreign account acknowledgement',async()=>{
  const saved=storage();
  const {port}=mock((async(url:string|URL|Request,init?:RequestInit)=>{
    if(String(url).includes('grant_type=password'))return json(tokens);
    if(String(url).endsWith('/user')&&init?.method==='PUT')return json(secondUser);
    return json(user);
  }) as typeof fetch,saved);
  assert.equal((await port.signInWithPassword({email:user.email,password:'password'})).error,null);
  const result=await port.updateUser({password:'new-strong-password'});
  assert.ok(result.error);
  assert.equal(result.data,null);
  assert.equal(saved.data.size,0);
});

test('B10 a delayed logout cannot clear a newer authenticated account',async()=>{
  const saved=storage();
  let finishLogout!:(result:Response)=>void, started!:()=>void;
  const waiting=new Promise<Response>(resolve=>{finishLogout=resolve;});
  const began=new Promise<void>(resolve=>{started=resolve;});
  const {port}=mock((async(url:string|URL|Request)=>{
    const u=String(url);
    if(u.includes('grant_type=password')){
      return json(u.includes('password')&&logins++>0?secondTokens:tokens);
    }
    if(u.includes('/logout?scope=global')){started();return waiting;}
    if(u.endsWith('/user'))return json(secondUser);
    return json({},404);
  }) as typeof fetch,saved);
  let logins=0;
  assert.equal((await port.signInWithPassword({email:user.email,password:'password'})).error,null);
  const logout=port.signOut({scope:'global'});
  await began;
  assert.equal((await port.signInWithPassword({email:secondUser.email,password:'password'})).error,null);
  finishLogout(json({}));
  assert.equal((await logout).error,null);
  assert.equal((await port.getUser()).data.user?.id,secondUser.id);
  assert.ok([...saved.data.values()].join('').includes(secondTokens.refresh_token));
});

test('B10 immediate sign-up rejects a forged or foreign authenticated session',async()=>{
  const saved=storage();
  const {port}=mock((async()=>json({...tokens,user:secondUser})) as typeof fetch,saved);
  const result=await port.signUp({email:user.email,password:'strong-password',
    options:{data:{display_name:'Dev'}}});
  assert.ok(result.error);
  assert.equal(result.data,null);
  assert.equal(saved.data.size,0);
});

test('B10 email token-hash redemption verifies the claimed owner before persisting credentials',async()=>{
  const saved=storage();
  let calls=0;
  const {port}=mock((async(url:string|URL|Request,init?:RequestInit)=>{
    calls++;
    if(String(url).endsWith('/verify')){
      assert.equal(init?.method,'POST');
      return json(tokens);
    }
    if(String(url).endsWith('/user')){
      assert.equal((init?.headers as Record<string,string>).Authorization,
        'Bearer '+tokens.access_token);
      return json(user);
    }
    throw Error('Unexpected email callback endpoint');
  }) as typeof fetch,saved);
  assert.equal(await port.verifyTokenHash('a'.repeat(32),'recovery'),'recovery');
  assert.equal(calls,2,'The token cannot create a session without a second live Auth lookup');
  assert.equal((await port.getUser()).data.user?.id,user.id);
  assert.ok([...saved.data.values()].join('').includes(tokens.refresh_token));
});

test('B10 email token-hash response rejects a foreign verified user without storing tokens',async()=>{
  for(const wrong of [secondUser,null]){
    const saved=storage();
    const {port}=mock((async(url:string|URL|Request)=>{
      if(String(url).endsWith('/verify'))return json(tokens);
      if(String(url).endsWith('/user'))return json(wrong);
      throw Error('Unexpected email callback endpoint');
    }) as typeof fetch,saved);
    await assert.rejects(port.verifyTokenHash('a'.repeat(32),'signup'),
      /Email link was not verified/);
    assert.equal(saved.data.size,0);
  }
});

test('B10 email token-hash rejects unverified Auth responses and preserves active sessions',async()=>{
  const saved=storage();
  let verifyCalls=0;
  const {port}=mock((async(url:string|URL|Request)=>{
    if(String(url).includes('grant_type=password'))return json(secondTokens);
    if(String(url).endsWith('/verify')){verifyCalls++;return json(tokens);}
    if(String(url).endsWith('/user'))return json(user);
    throw Error('Unexpected email callback endpoint');
  }) as typeof fetch,saved);
  assert.equal((await port.signInWithPassword({
    email:secondUser.email,password:'pass'
  })).error,null);
  const before=[...saved.data.entries()];
  await assert.rejects(port.verifyTokenHash('a'.repeat(32),'invite'),/Sign out/);
  assert.equal(verifyCalls,1);
  assert.deepEqual([...saved.data.entries()],before);
});

test('B10 other-session revocation refuses success if account switches while the call is pending',async()=>{
  const saved=storage();
  let finish!:(value:Response)=>void, began!:()=>void,logins=0;
  const pending=new Promise<Response>(resolve=>{finish=resolve;});
  const started=new Promise<void>(resolve=>{began=resolve;});
  const {port}=mock((async(url:string|URL|Request)=>{
    const u=String(url);
    if(u.includes('grant_type=password'))return json(logins++===0?tokens:secondTokens);
    if(u.includes('/logout?scope=others')){began();return pending;}
    if(u.endsWith('/user'))return json(secondUser);
    throw Error('Unexpected endpoint');
  }) as typeof fetch,saved);
  assert.equal((await port.signInWithPassword({email:user.email,password:'password'})).error,null);
  const revoke=port.signOut({scope:'others'});
  await started;
  assert.equal((await port.signInWithPassword({email:secondUser.email,password:'password'})).error,null);
  finish(json({}));
  const result=await revoke;
  assert.ok(result.error,'Old-account revocation cannot be attributed to the newly signed-in owner');
  assert.equal((await port.getUser()).data.user?.id,secondUser.id);
});

test('B10 overlapping password sign-ins never allow a stale response to replace the newest account',async()=>{
  const saved=storage();
  let releaseOld!:(value:Response)=>void,started!:()=>void;
  const pending=new Promise<Response>(resolve=>{releaseOld=resolve;});
  const begun=new Promise<void>(resolve=>{started=resolve;});
  let count=0;
  const {port}=mock((async(url:string|URL|Request)=>{
    if(String(url).includes('grant_type=password')){
      if(count++===0){started();return pending;}
      return json(secondTokens);
    }
    if(String(url).endsWith('/user'))return json(secondUser);
    throw Error('Unexpected endpoint');
  }) as typeof fetch,saved);
  const old=port.signInWithPassword({email:user.email,password:'old-password'});
  await begun;
  const latest=await port.signInWithPassword({email:secondUser.email,password:'new-password'});
  assert.equal(latest.error,null);
  releaseOld(json(tokens));
  assert.ok((await old).error);
  assert.equal((await port.getUser()).data.user?.id,secondUser.id);
  assert.ok([...saved.data.values()].join('').includes(secondTokens.refresh_token));
});

test('B10 explicit logout cancels a pending uncommitted password login',async()=>{
  const saved=storage();
  let finish!:(value:Response)=>void,started!:()=>void;
  const pending=new Promise<Response>(resolve=>{finish=resolve;});
  const began=new Promise<void>(resolve=>{started=resolve;});
  const {port}=mock((async(url:string|URL|Request)=>{
    if(String(url).includes('grant_type=password')){started();return pending;}
    throw Error('Unexpected endpoint');
  }) as typeof fetch,saved);
  const old=port.signInWithPassword({email:user.email,password:'password'});
  await began;
  assert.equal((await port.signOut({scope:'local'})).error,null);
  finish(json(tokens));
  assert.ok((await old).error);
  assert.equal(saved.data.size,0);
});

test('B10 password login refuses a successful response for a different email',async()=>{
  const saved=storage();
  const {port}=mock((async()=>json(secondTokens)) as typeof fetch,saved);
  const result=await port.signInWithPassword({email:user.email,password:'password'});
  assert.ok(result.error);
  assert.equal(saved.data.size,0);
});

test('owner workspace reads authenticated RLS-scoped records and persists only confirmed skips', async () => {
  const paths:string[]=[];
  const {port}=mock((async(url:string|URL|Request,init?:RequestInit)=>{
    const u=String(url);paths.push(u);
    if(u.includes('grant_type=password'))return json(tokens);
    if(u.endsWith('/auth/v1/user'))return json(user);
    if(u.includes('/rest/v1/')) {
      assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer '+tokens.access_token);
      assert.equal((init?.headers as Record<string,string>).apikey,'sb_publishable_test');
      assert.equal(init?.credentials,'omit');
      assert.equal(init?.cache,'no-store');
      if(u.endsWith('/rpc/set_private_onboarding_step')) {
        assert.deepEqual(JSON.parse(String(init?.body)),{p_step:'profile',p_status:'skipped'});
        return json({step:'profile',status:'skipped',revision:1});
      }
      assert.ok(u.includes('eq.'+user.id),'owner id must be an explicit query filter');
      if(u.includes('/profiles?'))return json([{user_id:user.id,display_name:'Developer',handle:null}]);
      if(u.includes('/projects?'))return json([{id:'11111111-1111-4111-8111-111111111111',owner_user_id:user.id,title:'Private project',slug:'private-project',updated_at:'2026-11-15T00:00:00Z'}]);
      if(u.includes('/portfolios?'))return json([{id:'22222222-2222-4222-8222-222222222222',owner_user_id:user.id,title:'Private folio',slug:'private-folio',head_revision:2,updated_at:'2026-11-15T00:00:00Z'}]);
      if(u.includes('/private_onboarding_steps?'))return json([{user_id:user.id,step:'profile',status:'pending'}]);
    }
    return json({},404);
  }) as typeof fetch);
  assert.equal((await port.signInWithPassword({email:user.email,password:'test-password'})).error,null);
  const view=await port.readOwnerWorkspace();
  assert.equal(view.error,null);
  assert.equal(view.data.profile?.displayName,'Developer');
  assert.equal(view.data.projects[0]?.title,'Private project');
  assert.equal(view.data.portfolios[0]?.revision,2);
  assert.deepEqual(view.data.onboarding,[{step:'profile',status:'pending'}]);
  const saved=await port.setPrivateOnboardingStep('profile','skipped');
  assert.equal(saved.error,null);
  assert.deepEqual(saved.data,{step:'profile',status:'skipped'});
  assert.equal(paths.filter(x=>x.includes('/rest/v1/')).length,5);
});

test('workspace data refuses foreign-owner rows and unverified onboarding RPC results', async () => {
  const {port}=mock((async(url:string|URL|Request)=>{
    const u=String(url);
    if(u.includes('grant_type=password'))return json(tokens);
    if(u.endsWith('/auth/v1/user'))return json(user);
    if(u.includes('/profiles?'))return json([{user_id:secondUser.id,display_name:'Not owner',handle:null}]);
    if(u.includes('/rest/v1/'))return json([]);
    return json({},404);
  }) as typeof fetch);
  assert.equal((await port.signInWithPassword({email:user.email,password:'password'})).error,null);
  const result=await port.readOwnerWorkspace();
  assert.ok(result.error);
  assert.equal(result.data,null);
  const {port:rejected}=mock((async(url:string|URL|Request)=>{
    if(String(url).includes('grant_type=password'))return json(tokens);
    if(String(url).endsWith('/auth/v1/user'))return json(user);
    return json({step:'profile',status:'pending'});
  }) as typeof fetch);
  assert.equal((await rejected.signInWithPassword({email:user.email,password:'password'})).error,null);
  const changed=await rejected.setPrivateOnboardingStep('profile','skipped');
  assert.ok(changed.error);
  assert.equal(changed.data,null);
});

test('WORK-04 private project list and quick-add insert require owner JWT, exact payload, and server receipt',async()=>{
  const project={id:'11111111-1111-4111-8111-111111111111',
    owner_user_id:user.id,title:'Private Demo',slug:'private-demo',summary:'Locally owned',
    description:'',repository_url:null,live_url:null,revision:0,updated_at:'2026-11-15T12:00:00Z'};
  const requests:string[]=[];
  const {port}=mock((async(url:string|URL|Request,init?:RequestInit)=>{
    const u=String(url);requests.push(u);
    if(u.includes('grant_type=password'))return json(tokens);
    if(u.endsWith('/auth/v1/user'))return json(user);
    if(u.includes('/rest/v1/projects?')) {
      const headers=init?.headers as Record<string,string>;
      assert.equal(headers.Authorization,'Bearer '+tokens.access_token);
      assert.equal(headers.apikey,'sb_publishable_test');
      assert.equal(init?.credentials,'omit');
      assert.equal(init?.cache,'no-store');
      if(init?.method==='POST') {
        assert.equal(headers.Prefer,'return=representation');
        assert.deepEqual(JSON.parse(String(init.body)),{
          owner_user_id:user.id,title:'Private Demo',slug:'private-demo',
          summary:'Locally owned',description:'',repository_url:null,live_url:null
        });
        return json([project],201);
      }
      assert.ok(u.includes('owner_user_id=eq.'+user.id));
      assert.ok(u.includes('trashed_at=is.null'));
      return json([project]);
    }
    return json({},404);
  }) as typeof fetch);
  assert.equal((await port.signInWithPassword({email:user.email,password:'correct'})).error,null);
  const listed=await port.listOwnerProjects();
  assert.equal(listed.error,null);assert.equal(listed.data[0]?.slug,'private-demo');
  const inserted=await port.createPrivateProject({
    title:' Private Demo ',slug:'private-demo',summary:'Locally owned',
    repositoryUrl:null,liveUrl:null
  });
  assert.equal(inserted.error,null);assert.equal(inserted.data.id,project.id);
  assert.equal(requests.filter(x=>x.includes('/rest/v1/projects?')).length,2);
});

test('WORK-04 rejects cross-owner private project rows, hostile URLs and forged inserts',async()=>{
  const base={id:'11111111-1111-4111-8111-111111111111',
    owner_user_id:secondUser.id,title:'Private Demo',slug:'private-demo',summary:'',
    description:'',repository_url:null,live_url:null,revision:0,updated_at:'2026-11-15T12:00:00Z'};
  let writes=0;
  const {port}=mock((async(url:string|URL|Request,init?:RequestInit)=>{
    const u=String(url);
    if(u.includes('grant_type=password'))return json(tokens);
    if(u.endsWith('/auth/v1/user'))return json(user);
    if(init?.method==='POST'){writes++;return json([base],201);}
    return json([base]);
  }) as typeof fetch);
  assert.equal((await port.signInWithPassword({email:user.email,password:'correct'})).error,null);
  assert.ok((await port.listOwnerProjects()).error);
  const input={title:'Private Demo',slug:'private-demo',summary:'',repositoryUrl:null,liveUrl:null};
  assert.ok((await port.createPrivateProject({...input,repositoryUrl:'http://untrusted.example'})).error);
  assert.ok((await port.createPrivateProject({...input,repositoryUrl:'https://user:secret@example.org/'})).error);
  assert.ok((await port.createPrivateProject({...input,slug:'../../escape'})).error);
  assert.equal(writes,0,'invalid writes must fail before network');
  const rejected=await port.createPrivateProject(input);
  assert.ok(rejected.error,'foreign record cannot confirm a private create');
  assert.equal(writes,1);
});

test('WORK-06 owner project detail and save enforce identity and the exact base revision', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const project = {
    id, owner_user_id: user.id, title: 'Private draft', slug: 'private-draft',
    summary: '', description: '', repository_url: null, live_url: null,
    revision: 2, updated_at: '2026-11-15T12:00:00Z'
  };
  let foreign = false;
  let saves = 0;
  const {port} = mock((async (url: string | URL | Request, init?: RequestInit) => {
    const request = String(url);
    if (request.includes('grant_type=password')) return json(tokens);
    if (request.endsWith('/auth/v1/user')) return json(user);
    const path = new URL(request);
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer ' + tokens.access_token);
    if (path.pathname.endsWith('/projects')) {
      assert.equal(path.searchParams.get('owner_user_id'), 'eq.' + user.id);
      assert.equal(path.searchParams.get('id'), 'eq.' + id);
      assert.equal(path.searchParams.get('trashed_at'), 'is.null');
      return json([{...project, owner_user_id: foreign ? secondUser.id : user.id}]);
    }
    assert.ok(path.pathname.endsWith('/rpc/update_private_project'));
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      p_project_id: id, p_base_revision: 2, p_title: 'Updated draft',
      p_summary: 'Scope', p_description: '', p_repository_url: null, p_live_url: null
    });
    saves++;
    if (saves === 2) return json({code: '40001', message: 'REVISION_CONFLICT'}, 500);
    return json({id, revision: 3, updated_at: '2026-11-15T12:01:00Z'});
  }) as typeof fetch);
  assert.equal((await port.signInWithPassword({email: user.email, password: 'correct'})).error, null);
  const opened = await port.readOwnerProject(id);
  assert.equal(opened.data?.revision, 2);
  foreign = true;
  assert.equal((await port.readOwnerProject(id)).data, null);
  assert.equal((await port.readOwnerProject(id + '&select=*')).data, null);
  const draft = {title: 'Updated draft', slug: 'private-draft', summary: 'Scope',
    description: '', repositoryUrl: null, liveUrl: null};
  assert.equal((await port.saveOwnerProject(id, 2, draft)).data?.revision, 3);
  const stale = await port.saveOwnerProject(id, 2, draft);
  assert.equal(stale.data, null);
  assert.match(stale.error?.message ?? '', /changed while you were editing/);
  assert.equal(saves, 2);
});


test('EDIT-06 private image validates bytes, write-once Storage and registered owner metadata',async()=>{
  const projectId='11111111-1111-4111-8111-111111111111';
  const assetId='22222222-2222-4222-8222-222222222222';
  const png=new File([Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4])],'unused-owner-filename.png',{type:'image/png'});
  let storagePath='',requests=0;
  const {port}=mock((async(url:string|URL|Request,init?:RequestInit)=>{
    const u=String(url);requests++;
    if(u.includes('grant_type=password'))return json(tokens);
    if(u.endsWith('/auth/v1/user'))return json(user);
    if(u.includes('/rest/v1/projects?')) {
      assert.equal(new URL(u).searchParams.get('owner_user_id'),'eq.'+user.id);
      return json([{id:projectId,owner_user_id:user.id}]);
    }
    if(u.includes('/storage/v1/object/')){
      const headers=init?.headers as Record<string,string>;
      assert.equal(init?.method,'POST');assert.equal(headers['x-upsert'],'false');
      assert.equal(headers.Authorization,'Bearer '+tokens.access_token);
      assert.equal(headers['Content-Type'],'image/png');
      assert.equal(init?.credentials,'omit');
      assert.ok(init?.body instanceof File);
      storagePath=u.split('/storage/v1/object/kadmeion-private-assets/')[1]??'';
      assert.match(storagePath,new RegExp('^'+user.id+'/'+projectId+'/[a-f0-9-]{36}\\.png$'));
      assert.equal(storagePath.includes('unused-owner-filename'),false);
      return new Response(null,{status:201});
    }
    if(u.endsWith('/rest/v1/rpc/register_private_project_image')){
      assert.equal(init?.method,'POST');
      const args=JSON.parse(String(init?.body));
      assert.deepEqual(args,{
        p_project_id:projectId,p_object_path:storagePath,p_mime_type:'image/png',
        p_byte_size:12,p_alt_text:'Diagram with a single square'
      });
      return json({id:assetId,object_path:storagePath,storage_metadata_matched:true});
    }
    return json({},404);
  }) as typeof fetch);
  assert.equal((await port.signInWithPassword({email:user.email,password:'correct'})).error,null);
  const receipt=await port.uploadOwnerProjectImage(projectId,png,'Diagram with a single square');
  assert.equal(receipt.error,null);assert.equal(receipt.data?.id,assetId);
  assert.equal(receipt.data?.publicDeliveryAllowed,false);
  assert.equal(receipt.data?.verifiedMetadata,true);
  assert.equal(requests,5);
});
test('EDIT-06 upload rejects disguised SVG, false MIME and any forged server registration',async()=>{
  const projectId='11111111-1111-4111-8111-111111111111';
  let attempts=0;
  const {port}=mock((async(url:string|URL|Request)=>{
    const u=String(url);
    if(u.includes('grant_type=password'))return json(tokens);
    if(u.endsWith('/auth/v1/user'))return json(user);
    attempts++;
    if(u.includes('/rest/v1/projects?'))return json([{id:projectId,owner_user_id:user.id}]);
    if(u.includes('/storage/v1/object/'))return new Response(null,{status:201});
    return json({id:'22222222-2222-4222-8222-222222222222',
      object_path:'forged-path.png',storage_metadata_matched:true});
  }) as typeof fetch);
  await port.signInWithPassword({email:user.email,password:'correct'});
  assert.ok((await port.uploadOwnerProjectImage(projectId,
    new File(['<svg onload="alert(1)"/>'],'svg.png',{type:'image/png'}),'X')).error);
  assert.ok((await port.uploadOwnerProjectImage(projectId,
    new File(['the wrong bytes'],'fake.webp',{type:'image/webp'}),'X')).error);
  assert.ok((await port.uploadOwnerProjectImage(projectId,
    new File([new Uint8Array(12)],'x.avif',{type:'image/avif'}),'X')).error);
  assert.equal(attempts,0,'invalid bytes must never reach private Storage');
  const png=new File([Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4])],
    'valid.png',{type:'image/png'});
  const result=await port.uploadOwnerProjectImage(projectId,png,'Private diagram');
  assert.equal(result.data,null);
  assert.match(result.error?.message??'',/registration was not confirmed/);
});

test('settings password change adopts the fresh token only after the owner update succeeds', async () => {
  const rotated = {...tokens, access_token: 'f'.repeat(64), refresh_token: 's'.repeat(64)};
  let logins = 0;
  const {port, saved} = mock(async (url, init) => {
    if (String(url).includes('grant_type=password')) return json(logins++ ? rotated : tokens);
    if (String(url).endsWith('/user') && init?.method === 'PUT') {
      assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer ' + rotated.access_token);
      assert.deepEqual(JSON.parse(String(init.body)), {password: 'new-strong-password'});
      assert.ok([...saved.data.values()].join('').includes(tokens.refresh_token));
    }
    return json(user);
  });
  assert.equal((await port.signInWithPassword({email: user.email, password: 'password'})).error, null);
  const changed = await port.changePasswordWithCurrentPassword({
    currentPassword: 'password', newPassword: 'new-strong-password'
  });
  assert.equal(changed.error, null);
  assert.ok([...saved.data.values()].join('').includes(rotated.refresh_token));
});

test('settings password change rejects a password grant for another user with the same email', async () => {
  let logins = 0;
  let writes = 0;
  const {port, saved} = mock(async (url, init) => {
    if (String(url).includes('grant_type=password'))
      return json(logins++ ? {...secondTokens, user: {...secondUser, email: user.email}} : tokens);
    if (init?.method === 'PUT') writes++;
    return json(user);
  });
  assert.equal((await port.signInWithPassword({email: user.email, password: 'password'})).error, null);
  const before = [...saved.data.values()];
  const changed = await port.changePasswordWithCurrentPassword({
    currentPassword: 'password', newPassword: 'new-strong-password'
  });
  assert.ok(changed.error);
  assert.equal(writes, 0);
  assert.deepEqual([...saved.data.values()], before);
});

test('a delayed rejection from user verification leaves a newer session intact', async () => {
  let finish!: (value: Response) => void;
  let start!: () => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  const started = new Promise<void>(resolve => { start = resolve; });
  let logins = 0;
  const {port, saved} = mock(async (url, init) => {
    if (String(url).includes('grant_type=password')) return json(logins++ ? secondTokens : tokens);
    if ((init?.headers as Record<string, string>).Authorization === 'Bearer ' + tokens.access_token) {
      start();
      return pending;
    }
    return json(secondUser);
  });
  assert.equal((await port.signInWithPassword({email: user.email, password: 'password'})).error, null);
  const old = port.getUser();
  await started;
  assert.equal((await port.signInWithPassword({email: secondUser.email, password: 'password'})).error, null);
  const before = [...saved.data.values()];
  finish(json({}, 401));
  assert.ok((await old).error);
  assert.deepEqual([...saved.data.values()], before);
  assert.equal((await port.getUser()).data.user?.id, secondUser.id);
});

test('replacement of the recovery session blocks a password update before the provider call', async () => {
  const saved = storage();
  const { port } = mock(async (_url, options) => {
    assert.equal(options?.method, 'GET', 'The stale session must not send a password update.');
    return json(user);
  }, saved);
  await port.acceptTokens(new URLSearchParams({
    access_token: tokens.access_token, refresh_token: tokens.refresh_token, type: 'recovery',
  }));
  const sessionKey = [...saved.data.keys()][0]!;
  saved.setItem(sessionKey, JSON.stringify({
    ...tokens, access_token: 'b'.repeat(64), expires_at: Math.floor(Date.now() / 1000) + 3600,
  }));
  const result = await port.updateUser({password: 'a-long-new-password'});
  assert.match(result.error?.message ?? '', /expired or changed/);
  assert.equal(JSON.parse(saved.getItem(sessionKey)!).access_token, 'b'.repeat(64));
});


test('S6 owner REST 429 and 409 retain distinct retry and conflict semantics', async () => {
  const projectId = '11111111-1111-4111-8111-111111111111';
  let createCalls = 0;
  let editCalls = 0;
  const {port} = mock((async (url: string | URL | Request, init?: RequestInit) => {
    const request = String(url);
    if (request.includes('grant_type=password')) return json(tokens);
    if (request.endsWith('/auth/v1/user')) return json(user);
    if (request.includes('/rest/v1/projects?') && init?.method !== 'POST')
      return json({code:'TOO_MANY_REQUESTS', message:'private details must not be returned'}, 429);
    if (request.includes('/rest/v1/projects?') && init?.method === 'POST') {
      createCalls++;
      return json({code:'23505',message:'duplicate key'}, 409);
    }
    if (request.endsWith('/rest/v1/rpc/update_private_project')) {
      editCalls++;
      return json({message:'concurrent request'}, 409);
    }
    return json({}, 404);
  }) as typeof fetch);
  assert.equal((await port.signInWithPassword({email:user.email,password:'fixture-password'})).error,null);

  const rateLimited = await port.listOwnerProjects();
  assert.equal(rateLimited.data,null);
  assert.equal(rateLimited.error?.message,'Too many private workspace requests. Try again later.');
  assert.equal(rateLimited.error?.message.includes('private details'),false);

  const created = await port.createPrivateProject({
    title:'Private conflict fixture',slug:'private-conflict-fixture',
    summary:'',repositoryUrl:null,liveUrl:null
  });
  assert.equal(created.data,null);
  assert.equal(created.error?.message,'Project conflicts with an existing owner record. Choose a different slug.');
  assert.equal(createCalls,1);

  const edited = await port.saveOwnerProject(projectId,1,{
    title:'Private draft',slug:'private-draft',summary:'still private',
    description:'',repositoryUrl:null,liveUrl:null
  });
  assert.equal(edited.data,null);
  assert.equal(edited.error?.message,'Private workspace conflict. Reload the latest data before trying again.');
  assert.equal(editCalls,1);
});

test('S6 SQL 40001 keeps revision-conflict precedence over HTTP 409', async () => {
  const projectId = '11111111-1111-4111-8111-111111111111';
  const {port} = mock((async (url: string | URL | Request) => {
    const request=String(url);
    if(request.includes('grant_type=password')) return json(tokens);
    if(request.endsWith('/auth/v1/user')) return json(user);
    if(request.endsWith('/rest/v1/rpc/update_private_project'))
      return json({code:'40001', message:'REVISION_CONFLICT'},409);
    return json({},404);
  }) as typeof fetch);
  assert.equal((await port.signInWithPassword({email:user.email,password:'fixture-password'})).error,null);
  const stale=await port.saveOwnerProject(projectId,2,{
    title:'Attempted stale edit',slug:'private-draft',summary:'',
    description:'',repositoryUrl:null,liveUrl:null
  });
  assert.equal(stale.data,null);
  assert.match(stale.error?.message??'',/changed while you were editing/);
  assert.doesNotMatch(stale.error?.message??'',/Choose a different slug|Too many requests/);
});


test('S6 same-port A to B rejects delayed A cursor results and authenticates B rows',async()=>{
  const tokensB={access_token:'b'.repeat(64),refresh_token:'s'.repeat(64),
    expires_in:3600,user:secondUser};
  const projectId='11111111-1111-4111-8111-111111111111';
  const row={
    id:projectId,owner_user_id:secondUser.id,slug:'owner-b-project',title:'Owner B only',
    summary:'',description:'',repository_url:null,live_url:null,revision:0,
    updated_at:'2026-11-16T00:00:00.123456+00:00'
  };
  let allowA!: (result:Response)=>void;
  let enteredA!: ()=>void;
  const delayedA=new Promise<Response>(resolve=>{allowA=resolve;});
  const aRequested=new Promise<void>(resolve=>{enteredA=resolve;});
  const calls:string[]=[];
  const {port}=mock((async(url:string|URL|Request,options?:RequestInit)=>{
    const u=String(url),headers=options?.headers as Record<string,string>|undefined;
    if(u.includes('grant_type=password')){
      const input=JSON.parse(String(options?.body)) as {email:string};
      return json(input.email===secondUser.email?tokensB:tokens);
    }
    if(u.endsWith('/auth/v1/user')){
      return json(headers?.Authorization==='Bearer '+tokensB.access_token?secondUser:user);
    }
    if(u.includes('/rest/v1/projects?')){
      calls.push(headers?.Authorization??'');
      if(headers?.Authorization==='Bearer '+tokens.access_token){
        enteredA();return delayedA;
      }
      if(headers?.Authorization==='Bearer '+tokensB.access_token)return json([row]);
    }
    return json({},404);
  }) as typeof fetch);
  assert.equal((await port.signInWithPassword({email:user.email,password:'owner-a-password'})).error,null);
  const oldPage=port.listOwnerProjectsPage(50,null);
  await aRequested;
  const switched=await port.signInWithPassword({email:secondUser.email,password:'owner-b-password'});
  assert.equal(switched.error,null);
  assert.equal(switched.data?.session?.user.id,secondUser.id);
  allowA(json([{...row,owner_user_id:user.id}]));
  const stale=await oldPage;
  assert.equal(stale.data,null,'the old owner response must never be rendered as a valid page');
  assert.ok(stale.error);
  const current=await port.listOwnerProjectsPage(50,null);
  assert.equal(current.error,null);
  assert.equal(current.data?.items[0]?.id,projectId);
  assert.equal(current.data?.items[0]?.title,'Owner B only');
  assert.deepEqual(calls,[
    'Bearer '+tokens.access_token,'Bearer '+tokensB.access_token
  ]);
  const denied=await port.listOwnerProjectsPage(50,{
    version:1,collection:'projects',ownerUserId:user.id,
    updatedAt:'2026-11-16T00:00:00.123456+00:00',id:projectId
  });
  assert.equal(denied.data,null);
  assert.match(denied.error?.message??'',/cursor.*current owner/i);
});

test('S6 same live port A to B to A rejects the original delayed private page', async () => {
  const b = {...tokens, access_token:'b'.repeat(64), refresh_token:'s'.repeat(64), user:secondUser};
  const aAgain = {...tokens, access_token:'c'.repeat(64), refresh_token:'t'.repeat(64)};
  const held = Promise.withResolvers<Response>();
  const entered = Promise.withResolvers<void>();
  let loginCount = 0;
  const id = '11111111-1111-4111-8111-111111111111';
  const row = {id, owner_user_id:user.id, slug:'owner-a-current', title:'Current A',
    summary:'', description:'', repository_url:null, live_url:null, revision:0,
    updated_at:'2026-11-16T00:00:00.123456+00:00'};
  const {port} = mock(async (url, options) => {
    const path = String(url);
    const authorization = (options?.headers as Record<string,string>)?.Authorization;
    if(path.includes('grant_type=password')) return json([tokens,b,aAgain][loginCount++]);
    if(path.endsWith('/auth/v1/user')) return json(authorization === 'Bearer '+b.access_token ? secondUser : user);
    if(path.includes('/rest/v1/projects?')){
      if(authorization === 'Bearer '+tokens.access_token){entered.resolve();return held.promise;}
      if(authorization === 'Bearer '+aAgain.access_token)return json([row]);
    }
    return json({},404);
  });
  assert.equal((await port.signInWithPassword({email:user.email,password:'fixture'})).error,null);
  const initialEpoch=port.getOwnerSessionEpoch();
  const delayed=port.listOwnerProjectsPage(50,null);
  try {
    await entered.promise;
    assert.equal((await port.signInWithPassword({email:secondUser.email,password:'fixture'})).error,null);
    assert.equal((await port.signInWithPassword({email:user.email,password:'fixture'})).error,null);
    assert.ok(port.getOwnerSessionEpoch()>initialEpoch);
  } finally {held.resolve(json([{...row,title:'Obsolete A'}]));}
  const stale=await delayed;
  assert.equal(stale.data,null);
  assert.ok(stale.error);
  const fresh=await port.listOwnerProjectsPage(50,null);
  assert.equal(fresh.error,null);
  assert.equal(fresh.data?.items[0]?.title,'Current A');
});

/* Explicitly candidate-gated: the base does not yet expose the approved API.
 * A skipped test is not acceptance. S0 must run this on combined S1/S5 source. */
test('S6 account-exit recovery single flight, transient retry and discard', async t => {
  type Candidate = SupabaseBrowserAuthPort & {
    reauthenticateCurrentOwner(password:string, context:{expectedEpoch:number;requestId:string;challengeId:string}):Promise<{error:unknown}>;
    recoverOwnerAccountExitReauth(epoch:number):Promise<{error:unknown;data:unknown}>;
    discardOwnerAccountExitReauth(epoch:number):void;
  };
  const requestId='11111111-1111-4111-8111-111111111111';
  const challengeId='22222222-2222-4222-8222-222222222222';
  const rotated={...tokens,access_token:'c'.repeat(64),refresh_token:'t'.repeat(64)};
  let logins=0, completions=0;
  const arrived=Promise.withResolvers<void>(), release=Promise.withResolvers<void>();
  const {port:base}=mock(async (url, options)=>{
    const path=String(url);
    if(path.includes('grant_type=password')) return json(logins++ ? rotated : tokens);
    if(path.endsWith('/auth/v1/user')) return json(user);
    if(path.includes('/rest/v1/private_account_erasure_requests?')) return json([{
      id:requestId,status:'REQUESTED_BLOCKED',created_at:new Date().toISOString(),withdrawn_at:null,
      public_revocation_verified:false,reauth_verified:false,access_terminated:false,
      erasure_executed:false,retention_verified:false
    }]);
    if(path.endsWith('/rpc/complete_private_account_exit_reauth')){
      const body=JSON.parse(String(options?.body));
      assert.equal(body.p_challenge_id,challengeId);
      completions++;
      if(completions===1)return json({},503);
      if(completions===2){arrived.resolve();await release.promise;}
      return json({challengeId,status:'NEW_SIGN_IN_VERIFIED',expiresAt:new Date(Date.now()+60000).toISOString(),
        alreadyVerified:false,deletionAllowed:false});
    }
    return json({},404);
  });
  const port=base as Candidate;
  if(typeof port.recoverOwnerAccountExitReauth!=='function'){
    assert.notEqual(process.env.KADMEION_REQUIRE_REAUTH_CANDIDATE,'1','Candidate API is required');
    t.skip('Requires combined S1 recovery candidate');return;
  }
  assert.equal((await port.signInWithPassword({email:user.email,password:'fixture'})).error,null);
  assert.equal((await port.reauthenticateCurrentOwner('fixture',{expectedEpoch:port.getOwnerSessionEpoch(),requestId,challengeId})).error,null);
  const epoch=port.getOwnerSessionEpoch();
  assert.ok((await port.recoverOwnerAccountExitReauth(epoch)).error);
  const one=port.recoverOwnerAccountExitReauth(epoch);
  const two=port.recoverOwnerAccountExitReauth(epoch);
  try {
    await Promise.race([arrived.promise,new Promise<never>((_,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Recovery request did not arrive')),3000);timer.unref();
    })]);
    assert.equal(completions,2,'both consumers share one retry');
    port.discardOwnerAccountExitReauth(epoch);
  } finally {release.resolve();}
  for(const result of await Promise.all([one,two])){
    assert.ok(result.error);
    assert.equal(result.data,null);
  }
  const cleared=await port.recoverOwnerAccountExitReauth(epoch);
  assert.equal(cleared.error,null);
  assert.equal(cleared.data,null);
  assert.equal(completions,2);
});

/** B16 C01/C04: requires composed S1 typed-media implementation. No feature-absent skip. */
const c01Project='11111111-1111-4111-8111-111111111111';
const c01Asset='22222222-2222-4222-8222-222222222222';
const c01Operation='33333333-3333-4333-8333-333333333333';
const c01Object='44444444-4444-4444-8444-444444444444';
const c01Png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQSbn0HwAEJAJK6G06bAAAAABJRU5ErkJggg==','base64'));
const c01Time='2026-11-17T00:00:00Z';
const c01Path=user.id+'/'+c01Project+'/'+c01Operation+'.img';
const c01Thumbnail={projectId:c01Project,ownerUserId:user.id,revision:8,publicDeliveryAllowed:false,
  asset:{id:c01Asset,projectId:c01Project,mime:'image/png',size:c01Png.length,
    altText:'Synthetic cover',createdAt:c01Time,objectPath:c01Path}};
async function c01Port(http:typeof fetch){
  const {port}=mock(async(url,init)=>{
    const u=String(url);
    if(u.includes('grant_type=password'))return json(tokens);
    if(u.endsWith('/auth/v1/user'))return json(user);
    return http(url,init);
  });
  assert.equal((await port.signInWithPassword({email:user.email,password:'fixture'})).error,null);
  return {port,epoch:port.getOwnerSessionEpoch()};
}
test('C01 typed thumbnail RPC distinguishes SQLSTATE from transport status and redacts provider messages',async()=>{
  for(const [status,payload,code] of [
    [500,{code:'40001',message:'REVISION_CONFLICT'},'CONFLICT'],
    [409,{code:'40001',message:'THUMBNAIL_OPERATION_CONFLICT'},'CONFLICT'],
    [500,{code:'XX000',message:'private provider diagnostic'},'PROVIDER_UNAVAILABLE'],
    [403,{code:'42501',message:'private provider diagnostic'},'DENIED'],
    [400,{code:'22023',message:'PRIVATE_THUMBNAIL_UNAVAILABLE'},'INTEGRITY'],
    [400,{code:'22023',message:'private provider diagnostic'},'VALIDATION'],
    [429,{message:'private provider diagnostic'},'RATE_LIMITED'],
    [413,{message:'private provider diagnostic'},'LIMIT_EXCEEDED']
  ] as const){
    let count=0;
    const {port,epoch}=await c01Port(async(url,init)=>{
      assert.ok(String(url).endsWith('/rpc/set_private_project_thumbnail'));
      assert.deepEqual(JSON.parse(String(init?.body)),{
        p_project_id:c01Project,p_base_revision:7,p_asset_id:c01Asset,p_operation_id:c01Operation
      });
      count++;return json(payload,status);
    });
    const r=await port.setOwnerProjectThumbnail(c01Project,7,c01Asset,c01Operation,epoch);
    assert.equal(r.data,null);assert.equal(r.error?.code,code);
    assert.equal(r.error?.status,status);assert.equal(count,1,'no implicit CAS retry or readback on denial');
    assert.doesNotMatch(r.error?.message??'',/private provider diagnostic|REVISION_CONFLICT|THUMBNAIL_OPERATION_CONFLICT/);
  }
});
test('C01 legacy and typed Storage denials and quotas cannot register, retry or silently fall back',async()=>{
  for(const [payload,expected] of [
    [{statusCode:'403',message:'private provider diagnostic'},'DENIED'],
    [{statusCode:404},'DENIED'],[{statusCode:'413'},'LIMIT_EXCEEDED'],
    [{statusCode:'429'},'RATE_LIMITED'],[{code:'AccessDenied'},'DENIED'],
    [{code:'NoSuchKey'},'DENIED'],[{code:'InvalidJWT'},'DENIED'],
    [{code:'EntityTooLarge'},'LIMIT_EXCEEDED']
  ] as const){
    let uploads=0,unexpected=0;
    const {port,epoch}=await c01Port(async(url,init)=>{
      const u=String(url);
      if(u.includes('/rest/v1/projects?'))return json([{id:c01Project,owner_user_id:user.id}]);
      if(u.endsWith('/kadmeion-private-assets/'+c01Path)&&init?.method==='POST'){
        uploads++;return json(payload,400);
      }
      unexpected++;return json({},503);
    });
    const r=await port.uploadOwnerProjectImage(c01Project,new File([c01Png],'cover.png',{type:'image/png'}),
      'Synthetic cover',{operationId:c01Operation,expectedEpoch:epoch});
    assert.equal(r.data,null);assert.equal(r.error?.code,expected);
    assert.equal(r.error?.status,400);assert.equal(uploads,1);assert.equal(unexpected,0);
    assert.doesNotMatch(r.error?.message??'',/private provider diagnostic/);
  }
});
test('C01 ambiguous upload reuses exact object and bytes; changed bytes cannot register',async()=>{
  for(const variant of ['exact','different','missing'] as const){
    const bytes=variant==='different'?Uint8Array.from(c01Png.map((v,i)=>i===20?v^1:v)):c01Png;
    let uploads=0,reads=0,registrations=0;
    const {port,epoch}=await c01Port(async(url,init)=>{
      const u=String(url);
      if(u.includes('/rest/v1/projects?'))return json([{id:c01Project,owner_user_id:user.id}]);
      if(u.endsWith('/object/kadmeion-private-assets/'+c01Path)&&init?.method==='POST'){
        uploads++;throw Error('simulated lost response');
      }
      if(u.endsWith('/object/authenticated/kadmeion-private-assets/'+c01Path)){
        reads++;
        if(variant==='missing')return json({code:'NoSuchKey'},400);
        return new Response(bytes,{headers:{'content-type':'image/png','content-length':String(bytes.length)}});
      }
      if(u.endsWith('/rpc/register_private_project_image')){
        registrations++;
        assert.deepEqual(JSON.parse(String(init?.body)),{p_project_id:c01Project,p_object_path:c01Path,
          p_mime_type:'image/png',p_byte_size:c01Png.length,p_alt_text:'Synthetic cover'});
        return json({id:c01Asset,object_path:c01Path,storage_metadata_matched:true});
      }
      if(u.includes('/rest/v1/project_assets?'))return json([{id:c01Asset,owner_user_id:user.id,
        project_id:c01Project,object_path:c01Path,mime_type:'image/png',byte_size:c01Png.length,alt_text:'Synthetic cover'}]);
      return json({},404);
    });
    const result=await port.uploadOwnerProjectImage(c01Project,new File([c01Png],'cover.png',{type:'image/png'}),
      'Synthetic cover',{operationId:c01Operation,expectedEpoch:epoch});
    assert.equal(uploads,1);assert.equal(reads,1);
    if(variant==='exact'){
      assert.equal(result.error,null);assert.equal(result.data?.id,c01Asset);assert.equal(registrations,1);
      assert.equal(result.data?.publicDeliveryAllowed,false);
    }else{
      assert.equal(result.data,null);assert.equal(registrations,0);
      assert.equal(result.error?.code,variant==='different'?'CONFLICT':'PROVIDER_UNAVAILABLE');
    }
  }
});
test('C01 correct typed failures for interrupted, malformed and oversized successful response streams',async()=>{
  for(const variant of ['interrupted','malformed','oversized'] as const){
    const {port,epoch}=await c01Port(async()=>{
      if(variant==='interrupted')return new Response(new ReadableStream<Uint8Array>({
        start(c){c.error(new Error('private provider diagnostic'));}
      }),{headers:{'content-type':'application/json'}});
      return new Response(variant==='malformed'?'not JSON':'x'.repeat(65537),
        {headers:{'content-type':'application/json'}});
    });
    const r=await port.readOwnerProjectThumbnail(c01Project,epoch);
    assert.equal(r.data,null);
    assert.equal(r.error?.code,variant==='interrupted'?'PROVIDER_UNAVAILABLE':'INTEGRITY');
    assert.doesNotMatch(r.error?.message??'',/private provider diagnostic/);
  }
});
test('C01 exact CAS receipt needs authoritative readback; selected bytes cannot escape after replacement',async()=>{
  for(const variant of ['confirmed','wrong-ack','later-change'] as const){
    let writes=0,reads=0;
    const {port,epoch}=await c01Port(async(url)=>{
      if(String(url).endsWith('/rpc/set_private_project_thumbnail')){
        writes++;return json(variant==='wrong-ack'?{...c01Thumbnail,revision:9}:c01Thumbnail);
      }
      reads++;return json(variant==='later-change'?{...c01Thumbnail,revision:9,asset:null}:c01Thumbnail);
    });
    const r=await port.setOwnerProjectThumbnail(c01Project,7,c01Asset,c01Operation,epoch);
    assert.equal(writes,1);assert.equal(reads,variant==='wrong-ack'?0:1);
    if(variant==='confirmed'){
      assert.equal(r.error,null);assert.equal(r.data?.revision,8);assert.equal(r.data?.asset?.id,c01Asset);
    }else{
      assert.equal(r.data,null);assert.equal(r.error?.code,variant==='wrong-ack'?'INTEGRITY':'CONFLICT');
    }
  }
  let reads=0,downloads=0;
  const {port,epoch}=await c01Port(async(url)=>{
    if(String(url).endsWith('/rpc/read_private_project_thumbnail')){
      reads++;return json(reads===1?c01Thumbnail:{...c01Thumbnail,revision:9,asset:null});
    }
    assert.ok(String(url).endsWith('/object/authenticated/kadmeion-private-assets/'+c01Path));
    downloads++;return new Response(c01Png,{headers:{'content-type':'image/png'}});
  });
  const bytes=await port.readOwnerProjectThumbnailImage(c01Project,c01Asset,epoch);
  assert.equal(bytes.data,null);assert.equal(bytes.error?.code,'CONFLICT');
  assert.equal(reads,2);assert.equal(downloads,1);
});
test('C04 owner private bytes are bound to scope and immutable object identity, never a trusted hash pin',async()=>{
  for(const variant of ['valid','wrong-owner','wrong-project-path','version-race','wrong-mime','short-bytes','missing-version'] as const){
    let metadataReads=0,downloads=0;
    const {port,epoch}=await c01Port(async(url,init)=>{
      const u=String(url);
      const headers=init?.headers as Record<string,string>;
      assert.equal(headers.Authorization,'Bearer '+tokens.access_token);
      assert.equal(init?.redirect,'error');
      if(u.includes('/rest/v1/projects?'))return json([{id:c01Project,owner_user_id:user.id}]);
      if(u.includes('/rest/v1/project_assets?'))return json([{id:c01Asset,project_id:c01Project,
        owner_user_id:variant==='wrong-owner'?secondUser.id:user.id,
        object_path:variant==='wrong-project-path'?user.id+'/'+c01Asset+'/'+c01Operation+'.img':c01Path,
        mime_type:'image/png',byte_size:c01Png.length,alt_text:'Synthetic cover',created_at:c01Time}]);
      if(u.endsWith('/object/info/authenticated/kadmeion-private-assets/'+c01Path)){
        metadataReads++;
        return json({id:c01Object,name:c01Path,bucket_id:'kadmeion-private-assets',owner_id:user.id,
          version:variant==='missing-version'?null:variant==='version-race'&&metadataReads===2?'v2':'v1',
          last_modified:c01Time,size:c01Png.length,content_type:'image/png'});
      }
      if(u.endsWith('/object/authenticated/kadmeion-private-assets/'+c01Path)){
        downloads++;
        return new Response(variant==='short-bytes'?c01Png.slice(0,-1):c01Png,{
          headers:{'content-type':variant==='wrong-mime'?'text/plain':'image/png'}});
      }
      return json({},404);
    });
    const result=await port.readOwnerPrivateAsset(c01Project,c01Asset,epoch);
    if(variant==='valid'){
      assert.equal(result.error,null);assert.equal(result.data.serverAttestation,'NOT_VERIFIED');
      assert.equal(result.data.publicDeliveryAllowed,false);
      assert.equal(result.data.integrity.status,'OWNER_BYTES_VERIFIED');
      const expected=Buffer.from(await crypto.subtle.digest('SHA-256',c01Png)).toString('hex');
      assert.equal(result.data.integrity.computedSha256,expected);
      assert.deepEqual(new Uint8Array(await result.data.bytes.arrayBuffer()),c01Png);
      assert.equal(metadataReads,2);assert.equal(downloads,1);
    }else{
      assert.equal(result.data,null);
      assert.equal(result.error?.code,variant==='wrong-owner'||variant==='wrong-project-path'?'DENIED':'INTEGRITY');
      if(['wrong-owner','wrong-project-path','missing-version'].includes(variant))assert.equal(downloads,0);
    }
  }
});
