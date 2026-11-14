import type { AuthFailure, AuthOutcome, AuthPort, AuthSession, AuthUser } from '../../../packages/contracts/src/auth-service.ts';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Json = Record<string, unknown>;
type StoredSession = { access_token: string; refresh_token: string; expires_at: number; user: AuthUser };
const STORAGE_KEY = 'kadmeion.auth.session.v1';
const OAUTH_PKCE_KEY = 'kadmeion.oauth.google.pkce.v1';
const OAUTH_TTL_MS = 5*60*1000;
const encoder=new TextEncoder();
function base64url(bytes:Uint8Array):string {
  let raw='';for(const b of bytes)raw+=String.fromCharCode(b);
  return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
}
class AuthHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function userFrom(value: unknown): AuthUser | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Json;
  if (typeof data.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.id)) return null;
  const user: AuthUser = { id: data.id };
  if (typeof data.email === 'string') user.email = data.email;
  if (typeof data.email_confirmed_at === 'string' || data.email_confirmed_at === null)
    user.email_confirmed_at = data.email_confirmed_at;
  return user;
}

function failure(error: unknown): AuthFailure {
  return { message: error instanceof Error ? error.message : 'Authentication service unavailable.' };
}

export class SupabaseBrowserAuthPort implements AuthPort {
  private readonly origin: string;
  private readonly publishableKey: string;
  private readonly appOrigin: string;
  private readonly storage: StorageLike;
  private readonly oauthStorage: StorageLike | null;
  private readonly fetcher: typeof fetch;
  private session: StoredSession | null = null;
  private refreshPromise: Promise<StoredSession | null> | null = null;

  constructor(input: { supabaseUrl: string; publishableKey: string; appOrigin: string; storage: StorageLike; oauthStorage?: StorageLike; fetcher?: typeof fetch }) {
    const endpoint = new URL(input.supabaseUrl);
    if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname)))
      throw new Error('Supabase URL must use HTTPS.');
    const application = new URL(input.appOrigin);
    if ((application.protocol !== 'https:' && !(application.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(application.hostname))) || application.pathname !== '/')
      throw new Error('Invalid application origin.');
    if (!input.publishableKey || input.publishableKey.startsWith('replace-with-'))
      throw new Error('Missing Supabase publishable key.');
    this.origin = endpoint.origin;
    this.appOrigin = application.origin;
    this.publishableKey = input.publishableKey;
    this.storage = input.storage;
    // OAuth PKCE is a short-lived same-tab transaction, never localStorage.
    this.oauthStorage = input.oauthStorage ?? null;
    this.fetcher = input.fetcher ?? fetch;
    this.session = this.readSession();
  }

  private readSession(): StoredSession | null {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw || raw.length > 20000) return null;
      const s = JSON.parse(raw) as StoredSession;
      return typeof s.access_token === 'string' && s.access_token.length > 20 &&
        typeof s.refresh_token === 'string' && s.refresh_token.length > 10 &&
        typeof s.expires_at === 'number' && Number.isFinite(s.expires_at) && userFrom(s.user)
          ? s : null;
    } catch { return null; }
  }

  private store(value: StoredSession | null): void {
    this.session = value;
    try {
      if (value) this.storage.setItem(STORAGE_KEY, JSON.stringify(value));
      else this.storage.removeItem(STORAGE_KEY);
    } catch {
      // Failure to persist must never be mistaken for a durable browser session.
      if (value) this.session = null;
      throw new Error('Browser storage is unavailable. Enable storage to sign in.');
    }
  }

  private async request(path: string, method: string, body?: Json, token?: string): Promise<Json> {
    const headers: Record<string, string> = { apikey: this.publishableKey, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    let response: Response;
    try {
      response = await this.fetcher(this.origin + '/auth/v1' + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'omit', redirect: 'error'
      });
    } catch { throw new Error('Could not connect to the authentication service.'); }
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const data = (payload && typeof payload === 'object' ? payload : {}) as Json;
      const code = typeof data.error_code === 'string' ? data.error_code : '';
      if (response.status === 429) throw new Error('Too many requests. Try again later.');
      if (response.status === 401 || response.status === 403) throw new AuthHttpError(response.status, 'The authentication session or credentials were rejected.');
      if (code === 'otp_expired') throw new Error('This email link has expired. Request a new one.');
      throw new Error('Authentication request failed (' + response.status + ').');
    }
    return (payload && typeof payload === 'object' ? payload : {}) as Json;
  }

  private decodeSession(response: Json): StoredSession {
    const user = userFrom(response.user);
    const access_token = response.access_token;
    const refresh_token = response.refresh_token;
    const expires_in = response.expires_in;
    const expires_at = response.expires_at;
    if (!user || typeof access_token !== 'string' || access_token.length < 20 ||
      typeof refresh_token !== 'string' || refresh_token.length < 10)
      throw new Error('The authentication server returned an invalid session.');
    const expiry = typeof expires_at === 'number' && Number.isFinite(expires_at)
      ? expires_at : Math.floor(Date.now() / 1000) + (typeof expires_in === 'number' ? expires_in : 3600);
    return { access_token, refresh_token, expires_at: expiry, user };
  }

  private async refreshed(): Promise<StoredSession | null> {
    if (!this.session) return null;
    if (this.session.expires_at > Math.floor(Date.now() / 1000) + 45) return this.session;
    if (!this.refreshPromise) {
      const token = this.session.refresh_token;
      this.refreshPromise = (async () => {
        try {
          const response = await this.request('/token?grant_type=refresh_token', 'POST', { refresh_token: token });
          const updated = this.decodeSession(response);
          this.store(updated);
          return updated;
        } catch {
          try { this.store(null); } catch { /* already unavailable */ }
          return null;
        }
      })().finally(() => { this.refreshPromise = null; });
    }
    return this.refreshPromise;
  }

  private async outcome<T>(task: () => Promise<T>): Promise<AuthOutcome<T>> {
    try { return { data: await task(), error: null }; }
    catch (error) { return { data: null as T, error: failure(error) }; }
  }

  signUp({ email, password, options }: { email: string; password: string; options: { data: Record<string, string> } }): Promise<AuthOutcome<{ user: AuthUser | null; session: AuthSession | null }>> {
    return this.outcome(async () => {
      const response = await this.request('/signup?redirect_to=' + encodeURIComponent(this.appOrigin + '/auth/callback'), 'POST', {
        email, password, data: options.data
      });
      let session: StoredSession | null = null;
      if (typeof response.access_token === 'string') {
        session = this.decodeSession(response);
        this.store(session);
      }
      return { user: userFrom(response.user ?? response), session };
    });
  }

  signInWithPassword({ email, password }: { email: string; password: string }): Promise<AuthOutcome<{ user: AuthUser | null; session: AuthSession | null }>> {
    return this.outcome(async () => {
      const response = await this.request('/token?grant_type=password', 'POST', { email, password });
      const session = this.decodeSession(response);
      this.store(session);
      return { user: session.user, session };
    });
  }

  getUser(): Promise<AuthOutcome<{ user: AuthUser | null }>> {
    return this.outcome(async () => {
      const session = await this.refreshed();
      if (!session) throw new Error('Session expired.');
      try {
        const data = await this.request('/user', 'GET', undefined, session.access_token);
        const user = userFrom(data);
        if (!user) {
          this.store(null);
          throw new Error('User verification failed.');
        }
        return { user };
      } catch (error) {
        // Keep an otherwise valid session on transient network failures.
        if (error instanceof AuthHttpError && [401, 403].includes(error.status)) {
          try { this.store(null); } catch { /* storage already failed */ }
        }
        throw error;
      }
    });
  }

  resetPasswordForEmail(email: string, { redirectTo }: { redirectTo: string }): Promise<AuthOutcome<unknown>> {
    return this.outcome(async () => {
      const destination = new URL(redirectTo);
      if (destination.origin !== this.appOrigin || destination.pathname !== '/reset-password')
        throw new Error('Invalid recovery redirect.');
      return this.request('/recover?redirect_to=' + encodeURIComponent(destination.toString()), 'POST', { email });
    });
  }

  updateUser({ password }: { password: string }): Promise<AuthOutcome<{ user: AuthUser | null }>> {
    return this.outcome(async () => {
      const session = await this.refreshed();
      if (!session) throw new Error('Session expired.');
      const result = await this.request('/user', 'PUT', { password }, session.access_token);
      return { user: userFrom(result.user ?? result) };
    });
  }

  signOut({ scope = 'local' }: { scope: 'local' | 'global' | 'others' } = { scope: 'local' }): Promise<AuthOutcome<unknown>> {
    return this.outcome(async () => {
      const token = this.session?.access_token;
      try {
        if (token) await this.request('/logout?scope=' + scope, 'POST', {}, token);
      } finally {
        this.store(null);
      }
      return {};
    });
  }

  signInWithOAuth({provider,options}:{provider:'google';options:{redirectTo:string}}):
      Promise<AuthOutcome<{url:string|null}>> {
    return this.outcome(async()=>{
      if(provider!=='google'||options.redirectTo!==this.appOrigin+'/auth/callback')
        throw new Error('Google OAuth requires the approved same-origin callback.');
      if(!this.oauthStorage)
        throw new Error('Secure session storage is required for Google sign-in.');
      if(!globalThis.crypto?.getRandomValues || !globalThis.crypto?.subtle)
        throw new Error('Secure browser cryptography is unavailable.');
      const verifier=base64url(crypto.getRandomValues(new Uint8Array(48)));
      const challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(verifier))));
      // Store only the one-time verifier in same-tab storage, not a JWT or a
      // provider credential. A second flow intentionally invalidates the first.
      try{
        this.oauthStorage.setItem(OAUTH_PKCE_KEY,JSON.stringify({
          verifier,expiresAt:Date.now()+OAUTH_TTL_MS,redirectTo:options.redirectTo
        }));
      }catch{throw new Error('Cannot store a secure temporary OAuth session.');}
      const url=new URL(this.origin+'/auth/v1/authorize');
      url.searchParams.set('provider','google');
      url.searchParams.set('redirect_to',options.redirectTo);
      url.searchParams.set('flow_type','pkce');
      url.searchParams.set('code_challenge',challenge);
      url.searchParams.set('code_challenge_method','s256');
      return {url:url.toString()};
    });
  }

  exchangeCodeForSession(code:string):Promise<AuthOutcome<unknown>> {
    return this.outcome(async()=>{
      if(typeof code!=='string'|| !/^[A-Za-z0-9._-]{8,2048}$/.test(code))
        throw new Error('Invalid OAuth callback code.');
      if(!this.oauthStorage)
        throw new Error('The OAuth flow must be restarted in this browser tab.');
      let saved:string|null;
      try{
        saved=this.oauthStorage.getItem(OAUTH_PKCE_KEY);
        // One-shot, including on network failure; no replay of a consumed code.
        this.oauthStorage.removeItem(OAUTH_PKCE_KEY);
      }catch{throw new Error('Cannot recover the temporary OAuth session.');}
      let state:unknown;
      try{state=JSON.parse(saved??'null');}catch{state=null;}
      const tx=state&&typeof state==='object'?state as Json:null;
      if(!tx||typeof tx.verifier!=='string'||!/^[A-Za-z0-9_-]{64}$/.test(tx.verifier)||
        tx.redirectTo!==this.appOrigin+'/auth/callback'||
        typeof tx.expiresAt!=='number'||!Number.isFinite(tx.expiresAt)||
        Date.now()>=tx.expiresAt||tx.expiresAt>Date.now()+OAUTH_TTL_MS)
        throw new Error('The OAuth session expired or originated in another tab.');
      const result=await this.request('/token?grant_type=pkce','POST',
        {auth_code:code,code_verifier:tx.verifier});
      const session=this.decodeSession(result);
      this.store(session);
      return {user:session.user};
    });
  }

  /** Consumes an implicit-flow invitation, confirmation or recovery link. */
  async acceptTokens(parameters: URLSearchParams): Promise<'invite' | 'recovery' | 'confirmation'> {
    const access_token = parameters.get('access_token');
    const refresh_token = parameters.get('refresh_token');
    const expires_in = Number(parameters.get('expires_in') ?? '3600');
    const kind = parameters.get('type');
    if (!access_token || !refresh_token || !Number.isFinite(expires_in) || expires_in <= 0)
      throw new Error('The invitation link is incomplete or expired.');
    const userPayload = await this.request('/user', 'GET', undefined, access_token);
    const user = userFrom(userPayload);
    if (!user) throw new Error('Could not validate the invitation session.');
    this.store({ access_token, refresh_token, expires_at: Math.floor(Date.now() / 1000) + expires_in, user });
    return kind === 'invite' ? 'invite' : kind === 'recovery' ? 'recovery' : 'confirmation';
  }

  /** Supports server-side rendered emails that use token_hash instead of an implicit fragment. */
  async verifyTokenHash(tokenHash: string, type: string): Promise<'invite' | 'recovery' | 'confirmation'> {
    if (!/^[a-zA-Z0-9_-]{8,2048}$/.test(tokenHash) || !['invite', 'recovery', 'signup', 'email'].includes(type))
      throw new Error('Unsupported or invalid verification link.');
    const response = await this.request('/verify', 'POST', { token_hash: tokenHash, type });
    this.store(this.decodeSession(response));
    return type === 'invite' ? 'invite' : type === 'recovery' ? 'recovery' : 'confirmation';
  }
}
