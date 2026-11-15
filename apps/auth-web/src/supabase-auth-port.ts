import {isEmailAuthType} from './auth-redirect.ts';
import type { AuthFailure, AuthOutcome, AuthPort, AuthSession, AuthUser } from '../../../packages/contracts/src/auth-service.ts';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Json = Record<string, unknown>;
type StoredSession = { access_token: string; refresh_token: string; expires_at: number; user: AuthUser };
export type PrivateStep = 'profile' | 'portfolio' | 'connections';
export type PrivateStepStatus = 'pending' | 'completed' | 'skipped';
export type OwnerWorkspaceSnapshot = {
  profile: { displayName: string; handle: string | null } | null;
  projects: Array<{ id: string; title: string; slug: string; updatedAt: string }>;
  portfolios: Array<{ id: string; title: string; slug: string; updatedAt: string; revision: number }>;
  onboarding: Array<{ step: PrivateStep; status: PrivateStepStatus }>;
};

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
  // Last-started explicit Auth action wins; old network responses cannot
  // replace a newer login or reinstate a session after explicit logout.
  private authAttempt = 0;
  private assertCurrentAuthAttempt(attempt:number):void {
    if (attempt !== this.authAttempt)
      throw new Error('This authentication attempt was superseded.');
  }

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

  /**
   * A network response belongs only to the session that initiated it.
   * Another tab, explicit sign-in or logout may replace that session while
   * /user, /logout or the refresh-token endpoint is pending.
   */
  private isCurrentSession(session: StoredSession): boolean {
    const persisted = this.readSession();
    return this.session === session && persisted !== null &&
      persisted.access_token === session.access_token &&
      persisted.refresh_token === session.refresh_token &&
      persisted.user.id === session.user.id;
  }

  private async refreshed(): Promise<StoredSession | null> {
    const starting = this.session;
    if (!starting) return null;
    if (starting.expires_at > Math.floor(Date.now() / 1000) + 45) return starting;
    if (!this.refreshPromise) {
      const token = starting.refresh_token;
      this.refreshPromise = (async () => {
        try {
          const response = await this.request('/token?grant_type=refresh_token', 'POST', { refresh_token: token });
          const updated = this.decodeSession(response);
          if (updated.user.id !== starting.user.id || !this.isCurrentSession(starting))
            throw new Error('Authentication session changed during refresh.');
          this.store(updated);
          return updated;
        } catch {
          // A failed refresh can invalidate only its own session, never a
          // newer login or another tab's rotated token.
          if (this.isCurrentSession(starting)) {
            try { this.store(null); } catch { /* already unavailable */ }
          }
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
      const attempt=++this.authAttempt;
      const response = await this.request('/signup?redirect_to=' + encodeURIComponent(this.appOrigin + '/auth/callback'), 'POST', {
        email, password, data: options.data
      });
      let session: StoredSession | null = null;
      this.assertCurrentAuthAttempt(attempt);
      const registered = userFrom(response.user ?? response);
      if (typeof response.access_token === 'string') {
        session = this.decodeSession(response);
        if (!registered || session.user.id !== registered.id ||
            typeof registered.email !== 'string' ||
            registered.email.trim().toLowerCase() !== email.trim().toLowerCase() ||
            (session.user.email !== undefined &&
             session.user.email.trim().toLowerCase() !== email.trim().toLowerCase()))
          throw new Error('The registration session identity was inconsistent.');
        this.storeEmailSession(session);
      }
      return { user: registered, session };
    });
  }

  signInWithPassword({ email, password }: { email: string; password: string }): Promise<AuthOutcome<{ user: AuthUser | null; session: AuthSession | null }>> {
    return this.outcome(async () => {
      const attempt=++this.authAttempt;
      const response = await this.request('/token?grant_type=password', 'POST', { email, password });
      this.assertCurrentAuthAttempt(attempt);
      const session = this.decodeSession(response);
      if (typeof session.user.email !== 'string' ||
          session.user.email.trim().toLowerCase() !== email.trim().toLowerCase())
        throw new Error('The sign-in response does not match the requested email.');
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
        if (!user || user.id !== session.user.id || !this.isCurrentSession(session)) {
          if (this.isCurrentSession(session)) this.store(null);
          throw new Error('User verification did not match the active session.');
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
      if (destination.href !== this.appOrigin + '/reset-password')
        throw new Error('Invalid recovery redirect.');
      return this.request('/recover?redirect_to=' + encodeURIComponent(destination.toString()), 'POST', { email });
    });
  }

  resend({type,email,options}:{
    type:'signup';email:string;options:{emailRedirectTo:string};
  }):Promise<AuthOutcome<unknown>>{
    return this.outcome(async()=>{
      if(type!=='signup'||options.emailRedirectTo!==this.appOrigin+'/auth/callback')
        throw new Error('Invalid confirmation redirect.');
      return this.request('/resend?redirect_to='+encodeURIComponent(options.emailRedirectTo),
        'POST',{type,email});
    });
  }

  updateUser({ password }: { password: string }): Promise<AuthOutcome<{ user: AuthUser | null }>> {
    return this.outcome(async () => {
      const session = await this.refreshed();
      if (!session) throw new Error('Session expired.');
      const result = await this.request('/user', 'PUT', { password }, session.access_token);
      const updated = userFrom(result.user ?? result);
      if (!updated || updated.id !== session.user.id || !this.isCurrentSession(session)) {
        if (this.isCurrentSession(session)) this.store(null);
        throw new Error('Password update response did not match the active user.');
      }
      return { user: updated };
    });
  }

  signOut({ scope = 'local' }: { scope: 'local' | 'global' | 'others' } = { scope: 'local' }): Promise<AuthOutcome<unknown>> {
    return this.outcome(async () => {
      if(!['local','global','others'].includes(scope))
        throw new Error('Invalid sign-out scope.');
      ++this.authAttempt;
      const current = await this.refreshed();
      if(scope === 'others'){
        // Supabase preserves the invoking session for 'others'. A network
        // rejection cannot be reported as successful remote revocation.
        if(!current)throw new Error('Sign in again to revoke other sessions.');
        await this.request('/logout?scope=others','POST',{},current.access_token);
        if (!this.isCurrentSession(current))
          throw new Error('Account changed while revoking other sessions.');
        return {};
      }
      try {
        if(current)await this.request('/logout?scope='+scope,'POST',{},current.access_token);
      } finally {
        // Local/global sign-out clears only the initiating session; a newer
        // login while the logout request was pending must not be discarded.
        // Network failure still does not prove remote refresh revocation.
        if (current && this.isCurrentSession(current)) this.store(null);
        if (!current && !this.session) this.store(null);
      }
      return {};
    });
  }

  signInWithOAuth({provider,options}:{provider:'google';options:{redirectTo:string}}):
      Promise<AuthOutcome<{url:string|null}>> {
    return this.outcome(async()=>{
      if(provider!=='google'||options.redirectTo!==this.appOrigin+'/auth/callback')
        throw new Error('Google OAuth requires the approved same-origin callback.');
      ++this.authAttempt;
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

  exchangeCodeForSession(code:string):Promise<AuthOutcome<{user:AuthUser|null}>> {
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
      const attempt=++this.authAttempt;
      const result=await this.request('/token?grant_type=pkce','POST',
        {auth_code:code,code_verifier:tx.verifier});
      this.assertCurrentAuthAttempt(attempt);
      const session=this.decodeSession(result);
      this.storeEmailSession(session);
      return {user:session.user};
    });
  }

  /** Consumes an implicit-flow invitation, confirmation or recovery link. */
  async acceptTokens(parameters: URLSearchParams): Promise<'invite' | 'recovery' | 'confirmation'> {
    const access_token = parameters.get('access_token');
    const refresh_token = parameters.get('refresh_token');
    const expires_in = Number(parameters.get('expires_in') ?? '3600');
    const kind = parameters.get('type');
    if (!access_token || !refresh_token || !isEmailAuthType(kind) ||
        ['access_token', 'refresh_token', 'expires_in', 'type'].some(key => parameters.getAll(key).length > 1) ||
        !Number.isSafeInteger(expires_in) || expires_in <= 0 || expires_in > 86400)
      throw new Error('The authentication link is incomplete or expired.');
    const attempt=++this.authAttempt;
    const userPayload = await this.request('/user', 'GET', undefined, access_token);
    this.assertCurrentAuthAttempt(attempt);
    const user = userFrom(userPayload);
    if (!user) throw new Error('Could not validate the invitation session.');
    this.storeEmailSession({ access_token, refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + expires_in, user });
    return kind === 'invite' ? 'invite' : kind === 'recovery' ? 'recovery' : 'confirmation';
  }

  /** Supports server-side rendered emails that use token_hash instead of an implicit fragment. */
  async verifyTokenHash(tokenHash: string, type: string): Promise<'invite' | 'recovery' | 'confirmation'> {
    if (!/^[a-zA-Z0-9_-]{8,2048}$/.test(tokenHash) || !isEmailAuthType(type))
      throw new Error('Unsupported or invalid verification link.');
    const attempt=++this.authAttempt;
    const response = await this.request('/verify', 'POST', { token_hash: tokenHash, type });
    const session = this.decodeSession(response);
    // A redeemed token hash is not sufficient proof of the callback owner:
    // independently check the returned JWT through the live Auth /user API,
    // exactly as for implicit callback tokens, before browser persistence.
    const result = await this.request('/user', 'GET', undefined, session.access_token);
    const verified = userFrom(result);
    this.assertCurrentAuthAttempt(attempt);
    if (!verified || verified.id !== session.user.id)
      throw new Error('Email link was not verified for the active account.');
    this.storeEmailSession({...session, user:verified});
    return type === 'invite' ? 'invite' : type === 'recovery' ? 'recovery' : 'confirmation';
  }


  /** The only workspace PostgREST surface exposed to this browser port.
   * Always authenticate with live /auth/v1/user and send an owner filter even
   * though the database's RLS is the final authorization boundary. */
  private async ownerSession(): Promise<{ session: StoredSession; userId: string }> {
    const checked = await this.getUser();
    if (checked.error || !checked.data?.user?.id)
      throw new Error('Owner session verification is required.');
    const session = await this.refreshed();
    if (!session || session.user.id !== checked.data.user.id || !this.isCurrentSession(session))
      throw new Error('Owner session changed before the private request.');
    return { session, userId: session.user.id };
  }

  private async ownerRest(path: string, bearer: string, method: 'GET' | 'POST' = 'GET', body?: Json): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(this.origin + '/rest/v1/' + path, {
        method, headers: {
          apikey: this.publishableKey,
          Authorization: 'Bearer ' + bearer,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store', credentials: 'omit', redirect: 'error'
      });
    } catch { throw new Error('Private workspace service is unavailable.'); }
    if (!response.ok)
      throw new Error(response.status === 401 || response.status === 403
        ? 'Private workspace access was denied.' : 'Private workspace request failed.');
    try { return await response.json() as unknown; }
    catch { throw new Error('Private workspace returned an invalid response.'); }
  }

  async readOwnerWorkspace(): Promise<AuthOutcome<OwnerWorkspaceSnapshot>> {
    return this.outcome(async () => {
      const { session, userId } = await this.ownerSession();
      const owner = encodeURIComponent(userId);
      const endpoints = [
        'profiles?select=user_id,display_name,handle&user_id=eq.' + owner + '&limit=1',
        'projects?select=id,owner_user_id,title,slug,updated_at&owner_user_id=eq.' + owner + '&trashed_at=is.null&order=updated_at.desc&limit=5',
        'portfolios?select=id,owner_user_id,title,slug,updated_at,head_revision&owner_user_id=eq.' + owner + '&trashed_at=is.null&order=updated_at.desc&limit=5',
        'private_onboarding_steps?select=user_id,step,status&user_id=eq.' + owner + '&limit=3'
      ];
      const all = await Promise.all(endpoints.map(path => this.ownerRest(path,session.access_token)));
      if (!this.isCurrentSession(session))
        throw new Error('Owner session changed during private data loading.');
      const rows = all.map((value,index) => {
        if (!Array.isArray(value) || value.length > [1,5,5,3][index]!)
          throw new Error('Private workspace data response was invalid.');
        return value as Json[];
      });
      const [profiles, projects, portfolios, steps] = rows as [Json[],Json[],Json[],Json[]];
      function isOwner(row: Json, ownerField: 'user_id'|'owner_user_id'): boolean {
        return row && typeof row === 'object' && row[ownerField] === userId;
      }
      if (!profiles.every(row=>isOwner(row,'user_id')) ||
          !projects.every(row=>isOwner(row,'owner_user_id')) ||
          !portfolios.every(row=>isOwner(row,'owner_user_id')) ||
          !steps.every(row=>isOwner(row,'user_id')))
        throw new Error('Private workspace identity did not match the signed-in owner.');
      const profile = profiles[0];
      if (profile && (typeof profile.display_name !== 'string' ||
          !(profile.handle === null || typeof profile.handle === 'string')))
        throw new Error('Private profile format was invalid.');
      const parseItem=(row:Json) => {
        if (typeof row.id !== 'string' || typeof row.title !== 'string' ||
          typeof row.slug !== 'string' || typeof row.updated_at !== 'string')
          throw new Error('Private record format was invalid.');
        return {id:row.id,title:row.title,slug:row.slug,updatedAt:row.updated_at};
      };
      const parsedProjects = projects.map(parseItem);
      const parsedPortfolios = portfolios.map(row=>{
        if (typeof row.head_revision !== 'number' || !Number.isSafeInteger(row.head_revision))
          throw new Error('Portfolio revision format was invalid.');
        return {...parseItem(row),revision:row.head_revision as number};
      });
      const permittedSteps = new Set(['profile','portfolio','connections']);
      const permittedStatuses = new Set(['pending','completed','skipped']);
      if (!steps.every(row=>typeof row.step === 'string' && permittedSteps.has(row.step) &&
          typeof row.status === 'string' && permittedStatuses.has(row.status)) ||
          new Set(steps.map(row=>row.step)).size !== steps.length)
        throw new Error('Onboarding status response was invalid.');
      return {
        profile: profile ? {displayName:profile.display_name as string,handle:profile.handle as string|null} : null,
        projects:parsedProjects,portfolios:parsedPortfolios,
        onboarding:steps.map(row=>({step:row.step as PrivateStep,status:row.status as PrivateStepStatus}))
      };
    });
  }

  /** A choice can be skipped, but no UI may mark an unperformed step completed.
   * Successful RPC response and the current initiating owner are both required. */
  async setPrivateOnboardingStep(step: PrivateStep, status: PrivateStepStatus): Promise<AuthOutcome<{ step: PrivateStep; status: PrivateStepStatus }>> {
    return this.outcome(async () => {
      if (!['profile','portfolio','connections'].includes(step) ||
          !['pending','skipped','completed'].includes(status))
        throw new Error('Invalid onboarding state.');
      const { session } = await this.ownerSession();
      const result = await this.ownerRest('rpc/set_private_onboarding_step',session.access_token,'POST',
        {p_step:step,p_status:status});
      if (!this.isCurrentSession(session))
        throw new Error('Owner session changed while saving onboarding.');
      if (!result || typeof result !== 'object' || Array.isArray(result) ||
          (result as Json).step !== step || (result as Json).status !== status)
        throw new Error('Onboarding update was not confirmed by the server.');
      return {step,status};
    });
  }

  private storeEmailSession(session: StoredSession): void {
    // A link may be opened during a sign-in on this or another browser tab.
    // Preserve that account and require explicit sign-out before switching.
    const current = this.readSession() ?? this.session;
    if (current && current.user.id !== session.user.id)
      throw new Error('Sign out before opening a link for a different account.');
    this.store(session);
  }
}
