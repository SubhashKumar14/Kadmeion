import { normalizeProjectDraft, type PrivateProjectDraft } from '../../../packages/contracts/src/projects.ts';
import { normalizePrivateCaseStudy, type PrivateCaseStudy } from '../../../packages/contracts/src/private-project-case-studies.ts';
import type { PortfolioPresetId } from '../../../packages/editor-core/src/managed-project-files.ts';
import type { PortfolioSnapshot } from '../../../packages/editor-core/src/portfolio-revision-transactions.ts';
import type { MyComponentInput, MyComponentVersion } from '../../../packages/contracts/src/private-my-components-service.ts';
import type { FrozenVisibilityIntent, PrivateFrozenRequest } from '../../../packages/contracts/src/private-release-service.ts';
import type { PrivatePointerSnapshot, PrivatePointerReceipt } from '../../../packages/contracts/src/private-release-visibility-service.ts';
import type { PrivateReviewerGrant, PrivateReviewerRevocation } from '../../../packages/contracts/src/private-reviewer-service.ts';
export type OwnerReviewerGrantSummary = {grantId:string;requestId:string;portfolioId:string;expiresAt:string;revokedAt:string|null;createdAt:string};
export type SavedOwnerRevision = {revision:number;createdAt:string;snapshotSha256:string};
export type OwnerFrozenRequest = {
  requestId:string; portfolioId:string; revision:number; snapshotSha256:string;
  visibilityIntent:FrozenVisibilityIntent; createdAt:string; status:'FROZEN';
};
import type { LoadedPrivateFrozenRevision } from '../../../packages/storage-adapters/src/private-frozen-revision-loader.ts';
import {isEmailAuthType} from './auth-redirect.ts';
import type { AuthFailure, AuthOutcome, AuthPort, AuthSession, AuthUser } from '../../../packages/contracts/src/auth-service.ts';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Json = Record<string, unknown>;
type StoredSession = { access_token: string; refresh_token: string; expires_at: number; user: AuthUser };

/** Auth-state invalidation broadcasts never carry access tokens or identity claims. */
type OwnerSessionWriteNotice = (storage: StorageLike, source: SupabaseBrowserAuthPort) => void;
const ownerSessionWriteNotices = new Set<OwnerSessionWriteNotice>();
function sameSession(a:StoredSession|null,b:StoredSession|null):boolean {
  return a===b || Boolean(a && b && a.user.id===b.user.id &&
    a.access_token===b.access_token && a.refresh_token===b.refresh_token);
}
export type ProfileDraft = { displayName: string; headline: string; bio: string; skills: string[] };
export type OwnerProfile = ProfileDraft & { handle: string | null };

export type OwnerPortfolio = {id: string; title: string; slug: string; templateId: string; revision: number};

/** Versioned owner-bound keyset cursor; never an authorization credential. */
export type OwnerPrivateCursorV1 = Readonly<{
  version: 1; collection: 'projects' | 'portfolios'; ownerUserId: string;
  updatedAt: string; id: string;
}>;
export type OwnerPrivatePageV1<T> = { items: T[]; nextCursor: OwnerPrivateCursorV1 | null };

export type OwnerProject = {
  id: string; title: string; slug: string; summary: string; description: string;
  repositoryUrl: string | null; liveUrl: string | null; revision: number; updatedAt: string;
};
export type NewPrivateProject = {
  title: string; slug: string; summary: string; repositoryUrl: string | null; liveUrl: string | null;
};
export type PrivateStep = 'profile' | 'portfolio' | 'connections';
export type PrivateStepStatus = 'pending' | 'completed' | 'skipped';
export type OwnerWorkspaceSnapshot = {
  profile: { displayName: string; handle: string | null } | null;
  projects: Array<{ id: string; title: string; slug: string; updatedAt: string }>;
  portfolios: Array<{ id: string; title: string; slug: string; updatedAt: string; revision: number }>;
  onboarding: Array<{ step: PrivateStep; status: PrivateStepStatus }>;
};

const OWNER_PROJECT_FIELDS = 'id,owner_user_id,title,slug,summary,description,repository_url,live_url,revision,updated_at';
const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// PostgreSQL timestamps can have microseconds; never round a cursor through JS Date.
const OWNER_CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
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
  private ownerSessionEpoch = 0;
  private readonly ownerSessionEpochListeners = new Set<(epoch:number)=>void>();
  // Last-started explicit Auth action wins; old network responses cannot
  // replace a newer login or reinstate a session after explicit logout.
  private authAttempt = 0;
  private assertCurrentAuthAttempt(attempt:number):void {
    // An unfocused tab may have missed another port's write. Never let an
    // older successful Auth response overwrite a different persisted principal.
    this.reconcileOwnerSessionEpoch();
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
    this.fetcher = input.fetcher ?? globalThis.fetch.bind(globalThis);
    this.session = this.readSession();
  }

  /**
   * S0 shell contract: epoch is local to this port, strictly an invalidation
   * sequence, NEVER proof of an owner. Live /auth/v1/user must verify identity.
   * Each sign-in/logout/session replacement increments it, including A→B→A.
   */
  getOwnerSessionEpoch():number { return this.ownerSessionEpoch; }

  private invalidateOwnerSessionEpoch():void {
    ++this.ownerSessionEpoch;
    for (const listener of this.ownerSessionEpochListeners) {
      // UI listener errors must not roll back an already-persisted auth change.
      try { listener(this.ownerSessionEpoch); } catch { /* isolated subscriber */ }
    }
  }

  /**
   * Reconcile mutations made by another tab or a different port instance.
   * A persisted owner ID is unverified input, not a grant of private access.
   */
  reconcileOwnerSessionEpoch():number {
    const persisted=this.readSession();
    if (!sameSession(this.session,persisted)) {
      this.session=persisted;
      ++this.authAttempt; // Prevent an earlier sign-in response replacing it.
      this.refreshPromise=null;
      this.invalidateOwnerSessionEpoch();
    }
    return this.ownerSessionEpoch;
  }

  /**
   * Subscribe BEFORE the shell's initial getUser call. Every emission makes
   * the existing private subtree untrusted until fresh /auth/v1/user succeeds.
   * Includes same-tab distinct auth ports, cross-tab storage and window return.
   */
  subscribeOwnerSessionEpoch(listener:(epoch:number)=>void):()=>void {
    this.ownerSessionEpochListeners.add(listener);
    const sameTab:OwnerSessionWriteNotice=(storage,source)=>{
      if(source!==this && storage===this.storage)this.reconcileOwnerSessionEpoch();
    };
    const storageChanged=(event:StorageEvent)=>{
      if(event.key===STORAGE_KEY||event.key===null)this.reconcileOwnerSessionEpoch();
    };
    const resumed=()=>{this.reconcileOwnerSessionEpoch();};
    const visible=()=>{
      if(typeof document!=='undefined'&&document.visibilityState==='visible')resumed();
    };
    ownerSessionWriteNotices.add(sameTab);
    if(typeof window!=='undefined'){
      window.addEventListener('storage',storageChanged);
      window.addEventListener('focus',resumed);
      if(typeof document!=='undefined')document.addEventListener('visibilitychange',visible);
    }
    this.reconcileOwnerSessionEpoch();
    return ()=>{
      this.ownerSessionEpochListeners.delete(listener);
      ownerSessionWriteNotices.delete(sameTab);
      if(typeof window!=='undefined'){
        window.removeEventListener('storage',storageChanged);
        window.removeEventListener('focus',resumed);
        if(typeof document!=='undefined')document.removeEventListener('visibilitychange',visible);
      }
    };
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
    const previous=this.session;
    this.session = value;
    try {
      if (value) this.storage.setItem(STORAGE_KEY, JSON.stringify(value));
      else this.storage.removeItem(STORAGE_KEY);
    } catch {
      // Failure to persist must never be mistaken for a durable browser session.
      if (value) this.session = null;
      if (!sameSession(previous,this.session)) this.invalidateOwnerSessionEpoch();
      throw new Error('Browser storage is unavailable. Enable storage to sign in.');
    }
    if (!sameSession(previous,value)) {
      this.invalidateOwnerSessionEpoch();
      for (const notify of ownerSessionWriteNotices) {
        try { notify(this.storage,this); } catch { /* isolated subscriber */ }
      }
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
    this.reconcileOwnerSessionEpoch(); // Recheck even without a mounted observer.
    const starting = this.session;
    if (!starting) return null;
    if (starting.expires_at > Math.floor(Date.now() / 1000) + 45) return starting;
    if (!this.refreshPromise) {
      const token = starting.refresh_token;
      const pending = (async () => {
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
      })();
      const tracked = pending.finally(() => {
        if (this.refreshPromise === tracked) this.refreshPromise = null;
      });
      this.refreshPromise = tracked;
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
        if (error instanceof AuthHttpError && [401, 403].includes(error.status) && this.isCurrentSession(session)) {
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

  changePasswordWithCurrentPassword({ currentPassword, newPassword }: {
    currentPassword: string; newPassword: string;
  }): Promise<AuthOutcome<{ user: AuthUser }>> {
    return this.outcome(async () => {
      const attempt = ++this.authAttempt;
      const {session,verified}=await this.verifyCurrentOwnerPassword(currentPassword,attempt);

      const result = await this.request('/user', 'PUT', { password: newPassword }, verified.access_token);
      const updated = userFrom(result.user ?? result);
      this.assertCurrentAuthAttempt(attempt);
      if (!this.isCurrentSession(session) || !updated || updated.id !== session.user.id)
        throw new Error('Password update could not be confirmed for the active account.');

      this.store({ ...verified, user: { ...verified.user, ...updated } });
      return { user: updated };
    });
  }

  private async verifyCurrentOwnerPassword(password: string,attempt: number) {
    const {session,userId}=await this.ownerSession();
    const email=session.user.email;
    if (!email) throw new Error('Sign in with a verified email account first.');
    this.assertCurrentAuthAttempt(attempt);
    const verified=this.decodeSession(await this.request('/token?grant_type=password','POST',{email,password}));
    this.assertCurrentAuthAttempt(attempt);
    if (!this.isCurrentSession(session) || verified.user.id!==userId ||
        verified.user.email?.trim().toLowerCase()!==email.trim().toLowerCase())
      throw new Error('Current password verification did not match the active account.');
    return {session,verified};
  }

  async reauthenticateCurrentOwner(password: string): Promise<AuthOutcome<{verified:true}>> {
    return this.outcome(async () => {
      const attempt=++this.authAttempt;
      const {session,verified}=await this.verifyCurrentOwnerPassword(password,attempt);
      this.assertCurrentAuthAttempt(attempt);
      if (!this.isCurrentSession(session) || verified.access_token===session.access_token)
        throw new Error('A fresh sign-in could not be confirmed.');
      this.store(verified);
      return {verified:true};
    });
  }

  updateUser({ password }: { password: string }): Promise<AuthOutcome<{ user: AuthUser | null }>> {
    return this.outcome(async () => {
      // Password updates must not silently adopt a different persisted owner.
      // The shell must reverify that principal before any protected mutation.
      const starting = this.session;
      this.reconcileOwnerSessionEpoch();
      if (starting !== this.session) throw new Error('Session expired or changed.');
      const session = await this.refreshed();
      if (!session || !this.isCurrentSession(session)) throw new Error('Session expired or changed.');
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

  private async ownerRest(path: string, bearer: string, method: 'GET' | 'POST' = 'GET', body?: Json, representation = false): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(this.origin + '/rest/v1/' + path, {
        method, headers: {
          apikey: this.publishableKey,
          Authorization: 'Bearer ' + bearer,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(representation ? {Prefer:'return=representation'} : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store', credentials: 'omit', redirect: 'error'
      });
    } catch { throw new Error('Private workspace service is unavailable.'); }
    if (!response.ok && ['rpc/update_private_project', 'rpc/owner_save_profile_draft', 'rpc/update_private_project_case_study'].includes(path)) {
      const payload: unknown = await response.json().catch(() => null);
      if (payload && typeof payload === 'object') {
        if ('code' in payload && payload.code === '40001')
          throw new Error(path === 'rpc/owner_save_profile_draft'
            ? 'Your profile changed in another session. Load the latest draft before saving.'
            : 'This project changed while you were editing. Load the latest revision before saving again.');
        if ('message' in payload && payload.message === 'PROFILE_WITHDRAWAL_CONFIRMATION_REQUIRED')
          throw new Error('Your public profile is live. Confirm withdrawal before saving these changes.');
      }
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw new Error('Private workspace access was denied.');
      if (response.status === 429)
        throw new Error('Too many private workspace requests. Try again later.');
      if (response.status === 409) {
        const isProjectCreation = method === 'POST' && path.startsWith('projects?');
        throw new Error(isProjectCreation
          ? 'Project conflicts with an existing owner record. Choose a different slug.'
          : 'Private workspace conflict. Reload the latest data before trying again.');
      }
      throw new Error('Private workspace request failed.');
    }
    try { return await response.json() as unknown; }
    catch { throw new Error('Private workspace returned an invalid response.'); }
  }

  private parseOwnerProfile(value: unknown, userId: string): OwnerProfile {
    const row = value as Json | null;
    if (!row || row.user_id !== userId || typeof row.display_name !== 'string' ||
        typeof row.headline !== 'string' || typeof row.bio !== 'string' ||
        (row.handle !== null && typeof row.handle !== 'string') ||
        !Array.isArray(row.private_skills) || row.private_skills.some(skill => typeof skill !== 'string'))
      throw new Error('Private profile response could not be verified.');
    return {displayName: row.display_name, headline: row.headline, bio: row.bio,
      handle: row.handle, skills: row.private_skills as string[]};
  }

  async readOwnerProfile(): Promise<AuthOutcome<OwnerProfile>> {
    return this.outcome(async () => {
      const {session, userId} = await this.ownerSession();
      const rows = await this.ownerRest('profiles?select=user_id,handle,display_name,headline,bio,private_skills&user_id=eq.' +
        encodeURIComponent(userId) + '&limit=1', session.access_token);
      if (!this.isCurrentSession(session) || !Array.isArray(rows) || rows.length !== 1)
        throw new Error('Private profile could not be loaded.');
      return this.parseOwnerProfile(rows[0], userId);
    });
  }

  async saveOwnerProfile(expected: ProfileDraft, draft: ProfileDraft, confirmWithdrawal: boolean): Promise<AuthOutcome<OwnerProfile>> {
    return this.outcome(async () => {
      const {session, userId} = await this.ownerSession();
      const {displayName, headline, bio, skills} = expected;
      const result = await this.ownerRest('rpc/owner_save_profile_draft', session.access_token, 'POST', {
        p_expected: {displayName, headline, bio, skills},
        p_draft: draft, p_confirm_projection_withdrawal: confirmWithdrawal
      });
      if (!this.isCurrentSession(session)) throw new Error('Owner session changed during profile save.');
      return this.parseOwnerProfile(result, userId);
    });
  }

  private async portfolioStore(session: StoredSession) {
    const {SupabasePortfolioRevisionStore} = await import('../../../packages/storage-adapters/src/supabase-portfolio-revisions.ts');
    return new SupabasePortfolioRevisionStore(this.origin, this.publishableKey,
      async () => this.isCurrentSession(session) ? session.access_token : null, this.fetcher);
  }

  private parseOwnerPortfolio(row: Json, userId: string): OwnerPortfolio {
    if (!row || row.owner_user_id !== userId || typeof row.id !== 'string' || !PROJECT_ID_PATTERN.test(row.id) ||
        typeof row.title !== 'string' || typeof row.slug !== 'string' || typeof row.template_id !== 'string' ||
        typeof row.head_revision !== 'number' || !Number.isSafeInteger(row.head_revision) || row.head_revision < 0)
      throw new Error('Private portfolio response could not be verified.');
    return {id: row.id, title: row.title, slug: row.slug, templateId: row.template_id, revision: row.head_revision};
  }

  /**
   * Additive v1 owner-private keyset pagination. Legacy list methods stay
   * unchanged until S2/S3 consumers migrate. No global total is claimed.
   * Concurrent edits can move rows between pages; callers must dedupe/reset.
   */
  private ownerLibraryPage<T>(
    collection: 'projects' | 'portfolios',
    select: string, pageSize: number, after: OwnerPrivateCursorV1 | null,
    parse: (row: Json, ownerId: string) => T
  ): Promise<AuthOutcome<OwnerPrivatePageV1<T>>> {
    return this.outcome(async () => {
      if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50)
        throw new Error('Private library page size must be between 1 and 50.');
      const {session, userId} = await this.ownerSession();
      if (after !== null && (
        typeof after !== 'object' || Array.isArray(after) ||
        Object.keys(after).length !== 5 ||
        after.version !== 1 || after.collection !== collection ||
        after.ownerUserId !== userId ||
        typeof after.id !== 'string' || !PROJECT_ID_PATTERN.test(after.id) ||
        typeof after.updatedAt !== 'string' ||
        !OWNER_CURSOR_TIMESTAMP.test(after.updatedAt) ||
        !Number.isFinite(Date.parse(after.updatedAt))
      )) throw new Error('Private library cursor is invalid for the current owner.');

      const params = new URLSearchParams({
        select, owner_user_id: 'eq.' + userId, trashed_at: 'is.null',
        order: 'updated_at.desc,id.asc', limit: String(pageSize + 1)
      });
      if (after !== null) {
        // AND with the owner/Trash filters. User input is shape-validated, then encoded.
        params.set('or', '(updated_at.lt.' + after.updatedAt +
          ',and(updated_at.eq.' + after.updatedAt + ',id.gt.' + after.id + '))');
      }
      const raw = await this.ownerRest(collection + '?' + params, session.access_token);
      if (!this.isCurrentSession(session) || !Array.isArray(raw) || raw.length > pageSize + 1)
        throw new Error('Private library page could not be verified.');
      const seen = new Set<string>();
      const records = raw.map((value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('Private library page returned an invalid row.');
        const row = value as Json;
        if (row.owner_user_id !== userId ||
            typeof row.id !== 'string' || !PROJECT_ID_PATTERN.test(row.id) ||
            seen.has(row.id) || typeof row.updated_at !== 'string' ||
            !OWNER_CURSOR_TIMESTAMP.test(row.updated_at) ||
            !Number.isFinite(Date.parse(row.updated_at)))
          throw new Error('Private library page failed owner or cursor validation.');
        seen.add(row.id);
        return {item: parse(row, userId), updatedAt: row.updated_at, id: row.id};
      });
      const visible = records.slice(0, pageSize);
      const tail = records.length > pageSize ? visible[visible.length - 1] : undefined;
      return {
        items: visible.map(row => row.item),
        nextCursor: tail ? {
          version: 1 as const, collection, ownerUserId: userId,
          updatedAt: tail.updatedAt, id: tail.id
        } : null
      };
    });
  }

  listOwnerPortfoliosPage(
    pageSize = 50, after: OwnerPrivateCursorV1 | null = null
  ): Promise<AuthOutcome<OwnerPrivatePageV1<OwnerPortfolio>>> {
    return this.ownerLibraryPage('portfolios',
      'id,owner_user_id,title,slug,template_id,head_revision,updated_at',
      pageSize, after, (row, ownerId) => this.parseOwnerPortfolio(row, ownerId));
  }

  async listOwnerPortfolios(): Promise<AuthOutcome<OwnerPortfolio[]>> {
    return this.outcome(async () => {
      const {session, userId} = await this.ownerSession();
      const params = new URLSearchParams({select: 'id,owner_user_id,title,slug,template_id,head_revision',
        owner_user_id: 'eq.' + userId, trashed_at: 'is.null', order: 'updated_at.desc,id.asc', limit: '100'});
      const rows = await this.ownerRest('portfolios?' + params, session.access_token);
      if (!this.isCurrentSession(session) || !Array.isArray(rows) || rows.length > 100)
        throw new Error('Private portfolio library could not be verified.');
      return rows.map(row => this.parseOwnerPortfolio(row as Json, userId));
    });
  }

  async createOwnerPortfolio(title: string, slug: string, templateId: PortfolioPresetId): Promise<AuthOutcome<string>> {
    return this.outcome(async () => {
      const {session, userId} = await this.ownerSession();
      const store = await this.portfolioStore(session);
      const id = await store.createPrivatePortfolio(userId, {title, slug, templateId});
      if (!this.isCurrentSession(session) || !PROJECT_ID_PATTERN.test(id))
        throw new Error('Private portfolio creation could not be verified.');
      return id;
    });
  }

  async initializeOwnerPortfolio(id: string, operation: string, preset: PortfolioPresetId): Promise<AuthOutcome<number>> {
    return this.outcome(async () => {
      if (!PROJECT_ID_PATTERN.test(id)) throw new Error('Portfolio unavailable.');
      const {session} = await this.ownerSession();
      const store = await this.portfolioStore(session);
      const head = await store.loadHead(id);
      const revision = head.revision || (await store.initializePreset(id, operation, preset)).revision;
      if (!this.isCurrentSession(session)) throw new Error('Account changed during portfolio setup.');
      return revision;
    });
  }

  async readOwnerPortfolio(id: string): Promise<AuthOutcome<OwnerPortfolio & {snapshot: PortfolioSnapshot | null}>> {
    return this.outcome(async () => {
      if (!PROJECT_ID_PATTERN.test(id)) throw new Error('Portfolio unavailable.');
      const {session, userId} = await this.ownerSession();
      const params = new URLSearchParams({select: 'id,owner_user_id,title,slug,template_id,head_revision',
        owner_user_id: 'eq.' + userId, id: 'eq.' + id, trashed_at: 'is.null', limit: '1'});
      const rows = await this.ownerRest('portfolios?' + params, session.access_token);
      if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Portfolio unavailable.');
      const portfolio = this.parseOwnerPortfolio(rows[0] as Json, userId);
      if (portfolio.id !== id) throw new Error('Portfolio unavailable.');
      const store = await this.portfolioStore(session);
      const head = await store.loadHead(id);
      if (!this.isCurrentSession(session)) throw new Error('Account changed while loading the portfolio.');
      return {...portfolio, ...head};
    });
  }

  async saveOwnerPortfolio(id: string, operation: string, revision: number, snapshot: PortfolioSnapshot): Promise<AuthOutcome<number>> {
    return this.outcome(async () => {
      if (!PROJECT_ID_PATTERN.test(id)) throw new Error('Portfolio unavailable.');
      const {session} = await this.ownerSession();
      const store = await this.portfolioStore(session);
      const result = await store.commit(id, operation, revision, snapshot);
      if (!this.isCurrentSession(session) || result.revision !== revision + 1)
        throw new Error('The new portfolio revision could not be confirmed.');
      return result.revision;
    });
  }

  /** Bounded immutable saved-revision catalogue, with owner RLS as the
   * authorization boundary; no draft source is sent just to list revisions. */
  async listOwnerPortfolioRevisions(id:string):Promise<AuthOutcome<SavedOwnerRevision[]>> {
    return this.outcome(async()=>{
      if (!PROJECT_ID_PATTERN.test(id)) throw new Error('Portfolio unavailable.');
      const {session}=await this.ownerSession();
      const query=new URLSearchParams({select:'revision,created_at,snapshot_sha256',
        portfolio_id:'eq.'+id,order:'revision.desc',limit:'50'});
      const rows=await this.ownerRest('portfolio_revisions?'+query,session.access_token);
      if (!this.isCurrentSession(session)||!Array.isArray(rows)||rows.length>50)
        throw new Error('Saved portfolio revisions could not be loaded.');
      const seen=new Set<number>();
      return rows.map((raw:unknown)=>{
        if (!raw||typeof raw!=='object'||Array.isArray(raw))
          throw new Error('Invalid saved revision record.');
        const row=raw as Record<string,unknown>;
        if (Object.keys(row).some(key=>!['revision','created_at','snapshot_sha256'].includes(key))||
          !Number.isSafeInteger(row.revision) || typeof row.revision!=='number' || row.revision<1 ||
          seen.has(row.revision)||typeof row.created_at!=='string'||
          !Number.isFinite(Date.parse(row.created_at))||
          typeof row.snapshot_sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.snapshot_sha256))
          throw new Error('A saved revision could not be validated.');
        seen.add(row.revision);
        return {revision:row.revision,createdAt:row.created_at,snapshotSha256:row.snapshot_sha256};
      });
    });
  }

  /** Owner-scoped metadata only; a FROZEN row is never an externally
   * delivered artifact. Existing grants and private source are excluded. */
  async listOwnerFrozenRequests(portfolioId:string):Promise<AuthOutcome<OwnerFrozenRequest[]>> {
    return this.outcome(async()=>{
      if (!PROJECT_ID_PATTERN.test(portfolioId)) throw new Error('Portfolio unavailable.');
      const {session,userId}=await this.ownerSession();
      const params=new URLSearchParams({
        select:'id,portfolio_id,owner_user_id,revision,snapshot_sha256,visibility_intent,status,created_at',
        portfolio_id:'eq.'+portfolioId,owner_user_id:'eq.'+userId,
        order:'created_at.desc',limit:'100'
      });
      const rawRows=await this.ownerRest('private_release_requests?'+params,session.access_token);
      if (!this.isCurrentSession(session)||!Array.isArray(rawRows)||rawRows.length>100)
        throw new Error('Private frozen request history could not be loaded.');
      const seen=new Set<string>();
      return rawRows.map((raw:unknown)=>{
        if (!raw||typeof raw!=='object'||Array.isArray(raw))
          throw new Error('Invalid frozen request record.');
        const row=raw as Record<string,unknown>;
        if (Object.keys(row).some(key=>!['id','portfolio_id','owner_user_id','revision','snapshot_sha256',
          'visibility_intent','status','created_at'].includes(key)) ||
          typeof row.id!=='string'||!PROJECT_ID_PATTERN.test(row.id)||seen.has(row.id)||
          row.portfolio_id!==portfolioId||row.owner_user_id!==userId||
          typeof row.revision!=='number'||!Number.isSafeInteger(row.revision)||row.revision<1||
          typeof row.snapshot_sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.snapshot_sha256)||
          (row.visibility_intent!=='UNLISTED'&&row.visibility_intent!=='PUBLIC')||
          row.status!=='FROZEN'||typeof row.created_at!=='string'||
          !Number.isFinite(Date.parse(row.created_at)))
          throw new Error('Frozen request metadata failed owner or schema validation.');
        seen.add(row.id);
        return {requestId:row.id,portfolioId,revision:row.revision,
          snapshotSha256:row.snapshot_sha256,
          visibilityIntent:row.visibility_intent as FrozenVisibilityIntent,
          createdAt:row.created_at,status:'FROZEN' as const};
      });
    });
  }

  async freezeOwnerRelease(id: string, operation: string, revision: number, visibility: FrozenVisibilityIntent):
    Promise<AuthOutcome<PrivateFrozenRequest>> {
    return this.outcome(async () => {
      const {session} = await this.ownerSession();
      const {SupabasePrivateReleaseService} = await import('../../../packages/contracts/src/private-release-service.ts');
      const service = new SupabasePrivateReleaseService(this.origin, this.publishableKey,
        async () => this.isCurrentSession(session) ? session.access_token : null, this.fetcher);
      const receipt = await service.freeze(id, operation, revision, visibility);
      if (!this.isCurrentSession(session)) throw new Error('Account changed while freezing the draft.');
      return receipt;
    });
  }

  async loadOwnerFrozenRelease(requestId: string): Promise<AuthOutcome<LoadedPrivateFrozenRevision>> {
    return this.outcome(async () => {
      const {session} = await this.ownerSession();
      const {SupabasePrivateFrozenRevisionLoader} = await import('../../../packages/storage-adapters/src/private-frozen-revision-loader.ts');
      const loader = new SupabasePrivateFrozenRevisionLoader(this.origin, this.publishableKey,
        async () => this.isCurrentSession(session) ? session.access_token : null, this.fetcher);
      const result = await loader.load(requestId);
      if (!this.isCurrentSession(session)) throw new Error('Account changed during preflight.');
      return result;
    });
  }

  async readOwnerRelease(id: string): Promise<AuthOutcome<PrivatePointerSnapshot>> {
    return this.outcome(async () => {
      const {session} = await this.ownerSession();
      const {SupabasePrivateReleasePointerService} = await import('../../../packages/contracts/src/private-release-visibility-service.ts');
      const service = new SupabasePrivateReleasePointerService(this.origin, this.publishableKey,
        async () => this.isCurrentSession(session) ? session.access_token : null, this.fetcher);
      const result = await service.read(id);
      if (!this.isCurrentSession(session)) throw new Error('Account changed while loading release status.');
      return result;
    });
  }


  /** Reviewer credentials are returned by the provider once. Callers must never
   * save, log or expose rawToken while hosted review delivery is unverified. */
  async issueOwnerReviewerGrant(requestId:string,operationId:string,validMinutes:number):
    Promise<AuthOutcome<PrivateReviewerGrant>> {
    return this.outcome(async () => {
      const {session} = await this.ownerSession();
      const {SupabasePrivateReviewerService} = await import('../../../packages/contracts/src/private-reviewer-service.ts');
      const service = new SupabasePrivateReviewerService(this.origin,this.publishableKey,
        async () => this.isCurrentSession(session) ? session.access_token : null,this.fetcher);
      const receipt = await service.issue(requestId,operationId,validMinutes);
      if (!this.isCurrentSession(session)) throw new Error('Account changed while registering a private reviewer.');
      return receipt;
    });
  }


  /** RLS-limited metadata listing. Only the six explicitly granted safe
   * columns are selected; token digests and credentials never leave SQL. */
  async listOwnerReviewerGrants(portfolioId:string):Promise<AuthOutcome<OwnerReviewerGrantSummary[]>> {
    return this.outcome(async () => {
      if (!PROJECT_ID_PATTERN.test(portfolioId)) throw new Error('Portfolio unavailable.');
      const {session}=await this.ownerSession();
      const params=new URLSearchParams({select:'id,request_id,portfolio_id,expires_at,revoked_at,created_at',
        portfolio_id:'eq.'+portfolioId,order:'created_at.desc',limit:'50'});
      const rows=await this.ownerRest('private_reviewer_grants?'+params,session.access_token);
      if (!this.isCurrentSession(session) || !Array.isArray(rows) || rows.length>50)
        throw new Error('Private reviewer grant list is unavailable.');
      const validTime=(value:unknown):value is string=>
        typeof value==='string' && Number.isFinite(Date.parse(value));
      const list:OwnerReviewerGrantSummary[]=rows.map((row:unknown)=>{
        if (!row || typeof row!=='object' || Array.isArray(row)) throw new Error('Invalid grant record.');
        const data=row as Record<string,unknown>;
        if (Object.keys(data).some(key=>!['id','request_id','portfolio_id','expires_at','revoked_at','created_at'].includes(key)) ||
          typeof data.id!=='string' || !PROJECT_ID_PATTERN.test(data.id) ||
          typeof data.request_id!=='string' || !PROJECT_ID_PATTERN.test(data.request_id) ||
          data.portfolio_id!==portfolioId || !validTime(data.expires_at) ||
          !validTime(data.created_at) ||
          !(data.revoked_at===null || validTime(data.revoked_at)))
          throw new Error('Private reviewer metadata did not match the owner request.');
        return {grantId:data.id,requestId:data.request_id,portfolioId,
          expiresAt:data.expires_at,revokedAt:data.revoked_at,createdAt:data.created_at};
      });
      if (new Set(list.map(row=>row.grantId)).size!==list.length)
        throw new Error('Duplicate private reviewer grants were rejected.');
      return list;
    });
  }

  async revokeOwnerReviewerGrant(grantId:string):Promise<AuthOutcome<PrivateReviewerRevocation>> {
    return this.outcome(async () => {
      const {session} = await this.ownerSession();
      const {SupabasePrivateReviewerService} = await import('../../../packages/contracts/src/private-reviewer-service.ts');
      const service = new SupabasePrivateReviewerService(this.origin,this.publishableKey,
        async () => this.isCurrentSession(session) ? session.access_token : null,this.fetcher);
      const receipt = await service.revoke(grantId);
      if (!this.isCurrentSession(session)) throw new Error('Account changed while revoking reviewer access.');
      return receipt;
    });
  }

  /** Blocks only the owner-private candidate pointer, not a live CDN artifact.
   * Never call this an externally verified unpublish operation. */
  async blockOwnerReleaseCandidate(id:string,operationId:string):
    Promise<AuthOutcome<PrivatePointerReceipt>> {
    return this.outcome(async () => {
      const {session} = await this.ownerSession();
      const {SupabasePrivateReleasePointerService} = await import('../../../packages/contracts/src/private-release-visibility-service.ts');
      const service = new SupabasePrivateReleasePointerService(this.origin,this.publishableKey,
        async () => this.isCurrentSession(session) ? session.access_token : null,this.fetcher);
      const receipt = await service.block(id,operationId);
      if (!this.isCurrentSession(session)) throw new Error('Account changed while blocking the private candidate.');
      return receipt;
    });
  }

  async listOwnerComponents(): Promise<AuthOutcome<MyComponentVersion[]>> {
    return this.outcome(async () => {
      const {session} = await this.ownerSession();
      const {SupabaseMyComponentsService} = await import('../../../packages/contracts/src/private-my-components-service.ts');
      const service = new SupabaseMyComponentsService(this.origin, this.publishableKey,
        async () => this.isCurrentSession(session) ? session.access_token : null, this.fetcher);
      const versions = await service.listVersions();
      if (!this.isCurrentSession(session)) throw new Error('Account changed while loading My Components.');
      return versions;
    });
  }

  async saveOwnerComponent(input: MyComponentInput): Promise<AuthOutcome<MyComponentVersion>> {
    return this.outcome(async () => {
      const {session} = await this.ownerSession();
      const {SupabaseMyComponentsService} = await import('../../../packages/contracts/src/private-my-components-service.ts');
      const service = new SupabaseMyComponentsService(this.origin, this.publishableKey,
        async () => this.isCurrentSession(session) ? session.access_token : null, this.fetcher);
      const version = await service.saveVersion(input);
      if (!this.isCurrentSession(session)) throw new Error('Account changed during component save.');
      return version;
    });
  }

  async listOwnerRevisions(id: string): Promise<AuthOutcome<{revision: number; createdAt: string}[]>> {
    return this.outcome(async () => {
      if (!PROJECT_ID_PATTERN.test(id)) throw new Error('Portfolio unavailable.');
      const {session} = await this.ownerSession();
      const params = new URLSearchParams({select: 'portfolio_id,revision,created_at',
        portfolio_id: 'eq.' + id, order: 'revision.desc', limit: '50'});
      const rows = await this.ownerRest('portfolio_revisions?' + params, session.access_token);
      if (!this.isCurrentSession(session) || !Array.isArray(rows) || rows.length > 50)
        throw new Error('Revision history could not be verified.');
      return rows.map((row: Json) => {
        if (!row || row.portfolio_id !== id || typeof row.revision !== 'number' || row.revision <= 0 ||
            !Number.isSafeInteger(row.revision) || typeof row.created_at !== 'string' ||
            !Number.isFinite(Date.parse(row.created_at))) throw new Error('Invalid revision response.');
        return {revision: row.revision, createdAt: row.created_at};
      });
    });
  }

  async readOwnerRevision(id: string, revision: number): Promise<AuthOutcome<PortfolioSnapshot>> {
    return this.outcome(async () => {
      if (!PROJECT_ID_PATTERN.test(id) || !Number.isSafeInteger(revision) || revision <= 0)
        throw new Error('Revision unavailable.');
      const {session} = await this.ownerSession();
      const params = new URLSearchParams({select: 'portfolio_id,revision,snapshot',
        portfolio_id: 'eq.' + id, revision: 'eq.' + revision, limit: '1'});
      const rows = await this.ownerRest('portfolio_revisions?' + params, session.access_token);
      const row = Array.isArray(rows) && rows.length === 1 ? rows[0] as Json : null;
      if (!this.isCurrentSession(session) || !row || row.portfolio_id !== id || row.revision !== revision)
        throw new Error('Revision could not be verified.');
      const {validateSnapshot} = await import('../../../packages/editor-core/src/portfolio-revision-transactions.ts');
      const snapshot = row.snapshot as PortfolioSnapshot;
      validateSnapshot(snapshot);
      return snapshot;
    });
  }

  async listOwnerAssets(): Promise<AuthOutcome<{id: string; projectId: string; mime: string; size: number; altText: string}[]>> {
    return this.outcome(async () => {
      const {session, userId} = await this.ownerSession();
      const params = new URLSearchParams({select: 'id,owner_user_id,project_id,mime_type,byte_size,alt_text',
        owner_user_id: 'eq.' + userId, order: 'created_at.desc', limit: '100'});
      const rows = await this.ownerRest('project_assets?' + params, session.access_token);
      if (!this.isCurrentSession(session) || !Array.isArray(rows) || rows.length > 100)
        throw new Error('Private assets could not be verified.');
      return rows.map((row: Json) => {
        if (!row || row.owner_user_id !== userId || typeof row.id !== 'string' || !PROJECT_ID_PATTERN.test(row.id) ||
            typeof row.project_id !== 'string' || !PROJECT_ID_PATTERN.test(row.project_id) || typeof row.mime_type !== 'string' ||
            !['image/png', 'image/jpeg', 'image/webp', 'image/avif'].includes(row.mime_type) ||
            typeof row.byte_size !== 'number' || !Number.isSafeInteger(row.byte_size) ||
            row.byte_size <= 0 || row.byte_size > 5242880 || typeof row.alt_text !== 'string')
          throw new Error('Invalid private asset response.');
        return {id: row.id, projectId: row.project_id, mime: row.mime_type, size: row.byte_size, altText: row.alt_text};
      });
    });
  }


  /** Private-only, write-once Storage upload with server-validated registration.
   * Registered metadata is NOT an attested media byte pin or publish authority.
   */
  async uploadOwnerProjectImage(projectId:string,file:File,altText:string):
    Promise<AuthOutcome<{id:string;projectId:string;mime:string;size:number;altText:string;verifiedMetadata:true;publicDeliveryAllowed:false}>> {
    return this.outcome(async()=>{
      const mime:Readonly<Record<string,{ext:string;magic:(bytes:Uint8Array)=>boolean}>>={
        'image/png':{ext:'png',magic:bytes=>bytes.length>=8&&
          [137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)},
        'image/jpeg':{ext:'jpg',magic:bytes=>bytes.length>=3&&
          bytes[0]===255&&bytes[1]===216&&bytes[2]===255},
        'image/webp':{ext:'webp',magic:bytes=>bytes.length>=12&&
          String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&
          String.fromCharCode(...bytes.slice(8,12))==='WEBP'}
      };
      if(!PROJECT_ID_PATTERN.test(projectId)||!(file instanceof File)||
        file.size<12||file.size>5242880||!Object.hasOwn(mime,file.type)||
        typeof altText!=='string'||altText.trim().length<1||altText.length>500)
        throw new Error('Choose a private project, a PNG/JPEG/WebP image under 5 MB, and descriptive alt text.');
      const format=mime[file.type];
      const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer());
      if(!format||!format.magic(bytes))throw new Error('File bytes do not match the selected image format.');
      // Header/MIME checks do not detect truncated or decompression-bomb
      // images. Browser-native decoding must succeed before write-once upload.
      // Node contract tests independently test bytes and RPC protocol without
      // a browser decoder; authenticated Chromium covers real image decoding.
      if(typeof window!=='undefined'){
        let width=0,height=0;
        if(typeof createImageBitmap==='function'){
          let bitmap:ImageBitmap;
          try{bitmap=await createImageBitmap(file);}
          catch{throw new Error('The selected image cannot be decoded. No private bytes were uploaded.');}
          try{width=bitmap.width;height=bitmap.height;}
          finally{bitmap.close();}
        }else{
          if(typeof Image==='undefined'||typeof URL.createObjectURL!=='function')
            throw new Error('Private image validation is unavailable in this browser.');
          const temporary=URL.createObjectURL(file);
          try{
            const image=new Image();
            image.src=temporary;
            await image.decode();
            width=image.naturalWidth;height=image.naturalHeight;
          }catch{throw new Error('The selected image cannot be decoded. No private bytes were uploaded.');}
          finally{URL.revokeObjectURL(temporary);}
        }
        if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||
          width<1||height<1||width>8192||height>8192||width*height>24_000_000)
          throw new Error('Image dimensions exceed the private preview safety limit.');
      }
      const {session,userId}=await this.ownerSession();
      const params=new URLSearchParams({select:'id,owner_user_id',
        id:'eq.'+projectId,owner_user_id:'eq.'+userId,
        trashed_at:'is.null',limit:'1'});
      const project=await this.ownerRest('projects?'+params,session.access_token);
      if(!this.isCurrentSession(session)||!Array.isArray(project)||project.length!==1||
        project[0]?.id!==projectId||project[0]?.owner_user_id!==userId)
        throw new Error('The selected private project could not be verified.');
      // Never use the owner's upload filename for a Storage path.
      const objectPath=userId+'/'+projectId+'/'+crypto.randomUUID()+'.'+format.ext;
      let upload:Response;
      try{
        upload=await this.fetcher(this.origin+'/storage/v1/object/kadmeion-private-assets/'+objectPath,{
          method:'POST',
          headers:{apikey:this.publishableKey,Authorization:'Bearer '+session.access_token,
            'Content-Type':file.type,'x-upsert':'false','Cache-Control':'no-store'},
          body:file,credentials:'omit',cache:'no-store',redirect:'error',
          signal:AbortSignal.timeout(60_000)
        });
      }catch{throw new Error('The private Storage upload was not confirmed. Retry with a new upload.');}
      if(!upload.ok||!this.isCurrentSession(session)){
        await upload.body?.cancel().catch(()=>{});
        throw new Error('Private image upload was not confirmed. No public image was created.');
      }
      await upload.body?.cancel().catch(()=>{});
      const receipt=await this.ownerRest('rpc/register_private_project_image',
        session.access_token,'POST',{
          p_project_id:projectId,p_object_path:objectPath,p_mime_type:file.type,
          p_byte_size:file.size,p_alt_text:altText.trim()
        });
      if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||
        !('id' in receipt)||typeof receipt.id!=='string'||
        !PROJECT_ID_PATTERN.test(receipt.id)||
        !('object_path' in receipt)||receipt.object_path!==objectPath||
        !('storage_metadata_matched' in receipt)||receipt.storage_metadata_matched!==true||
        !this.isCurrentSession(session))
        throw new Error('Private upload registration was not confirmed; orphaned private bytes may require cleanup.');
      return {id:receipt.id,projectId,mime:file.type,size:file.size,
        altText:altText.trim(),verifiedMetadata:true as const,publicDeliveryAllowed:false as const};
    });
  }

  /** Owner reads rely on RLS. Operator RPCs independently check the role. */
  async privateModeration() {
    return this.outcome(async () => {
      const {userId} = await this.ownerSession();
      const {SupabasePrivateModerationService} = await import('../../../packages/contracts/src/private-moderation-service.ts');
      const token = async () => {
        try {
          const current = await this.ownerSession();
          return current.userId === userId ? current.session.access_token : null;
        } catch { return null; }
      };
      return new SupabasePrivateModerationService(this.origin, this.publishableKey, token, this.fetcher);
    });
  }

  /** Owner-scoped manual Goals + LINK_ONLY profiles. No external provider sync or analytics. */
  async ownerGrowth() {
    return this.outcome(async () => {
      const {userId} = await this.ownerSession();
      const token = async () => {
        try {
          const current = await this.ownerSession();
          return current.userId === userId ? current.session.access_token : null;
        } catch { return null; }
      };
      const [goalModule,linkModule] = await Promise.all([
        import('../../../packages/contracts/src/private-goals-service.ts'),
        import('../../../packages/contracts/src/private-platform-links-service.ts')
      ]);
      return {
        goals: new goalModule.SupabasePrivateGoalsService(this.origin,this.publishableKey,token,this.fetcher),
        links: new linkModule.SupabasePrivatePlatformLinksService(this.origin,this.publishableKey,userId,token,this.fetcher)
      };
    });
  }

  async ownerSettings() {
    return this.outcome(async () => {
      const {userId} = await this.ownerSession();
      const token = async () => {
        try {
          const current = await this.ownerSession();
          return current.userId === userId ? current.session.access_token : null;
        } catch { return null; }
      };
      const [identity, notifications, trash, account, data] = await Promise.all([
        import('../../../packages/contracts/src/private-identity-service.ts'),
        import('../../../packages/contracts/src/private-notifications-service.ts'),
        import('../../../packages/contracts/src/private-trash-service.ts'),
        import('../../../packages/contracts/src/private-account-erasure-service.ts'),
        import('../../../packages/storage-adapters/src/private-account-data-export.ts')
      ]);
      return {
        identity: new identity.SupabasePrivateIdentityService(this.origin, this.publishableKey, token, this.fetcher),
        notifications: new notifications.SupabasePrivateNotificationsService(this.origin, this.publishableKey, userId, token, this.fetcher),
        trash: new trash.SupabasePrivateTrashService(this.origin, this.publishableKey, token, this.fetcher),
        account: new account.SupabasePrivateAccountErasureService(this.origin, this.publishableKey, token, this.fetcher),
        data: new data.SupabasePrivateAccountDataExporter(this.origin, this.publishableKey, token, this.fetcher)
      };
    });
  }

  async ownerSharingPreferences(): Promise<AuthOutcome<{shareDisplayName: boolean; shareHeadline: boolean; shareBio: boolean; publicationRequested: boolean}>> {
    return this.outcome(async () => {
      const {session, userId} = await this.ownerSession();
      const params = new URLSearchParams({select: 'user_id,share_display_name,share_headline,share_bio,publication_requested',
        user_id: 'eq.' + userId, limit: '1'});
      const rows = await this.ownerRest('profile_sharing_preferences?' + params, session.access_token);
      if (!this.isCurrentSession(session) || !Array.isArray(rows) || rows.length > 1)
        throw new Error('Private sharing preferences could not be verified.');
      const row = rows[0] as Json | undefined;
      if (!row) return {shareDisplayName: false, shareHeadline: false, shareBio: false, publicationRequested: false};
      if (row.user_id !== userId || typeof row.share_display_name !== 'boolean' ||
          typeof row.share_headline !== 'boolean' || typeof row.share_bio !== 'boolean' ||
          typeof row.publication_requested !== 'boolean') throw new Error('Invalid sharing preferences.');
      return {shareDisplayName: row.share_display_name, shareHeadline: row.share_headline,
        shareBio: row.share_bio, publicationRequested: row.publication_requested};
    });
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


  /** Every row must originate from the verified current owner, even when the
   * PostgREST projection or a proxy is incorrectly configured. */
  private parsePrivateProject(value:unknown,ownerId:string):OwnerProject {
    if (!value || typeof value!=='object' || Array.isArray(value))
      throw new Error('Invalid private project response.');
    const row=value as Json;
    if (row.owner_user_id!==ownerId ||
      typeof row.id!=='string' || !PROJECT_ID_PATTERN.test(row.id) ||
      typeof row.title!=='string' || row.title.trim().length===0 || row.title.length>120 ||
      typeof row.slug!=='string' || row.slug.length<3 || row.slug.length>64 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug) ||
      typeof row.summary!=='string' || row.summary.length>360 ||
      typeof row.description!=='string' || row.description.length>12000 ||
      typeof row.updated_at!=='string' || !Number.isFinite(Date.parse(row.updated_at)) ||
      typeof row.revision!=='number' || !Number.isSafeInteger(row.revision) || row.revision<0 ||
      !(row.repository_url===null||typeof row.repository_url==='string') ||
      !(row.live_url===null||typeof row.live_url==='string'))
      throw new Error('Private project response failed ownership or schema validation.');
    return {
      id:row.id,title:row.title,slug:row.slug,summary:row.summary,
      description:row.description,updatedAt:row.updated_at,revision:row.revision,
      repositoryUrl:row.repository_url,liveUrl:row.live_url
    };
  }

  listOwnerProjectsPage(
    pageSize = 50, after: OwnerPrivateCursorV1 | null = null
  ): Promise<AuthOutcome<OwnerPrivatePageV1<OwnerProject>>> {
    return this.ownerLibraryPage('projects', OWNER_PROJECT_FIELDS,
      pageSize, after, (row, ownerId) => this.parsePrivateProject(row, ownerId));
  }

  /** Bounded initial owner-private library. 100 is a page size, not a total. */
  async listOwnerProjects():Promise<AuthOutcome<OwnerProject[]>> {
    return this.outcome(async()=>{
      const {session,userId}=await this.ownerSession();
      const result=await this.ownerRest('projects?select='+OWNER_PROJECT_FIELDS+
        '&owner_user_id=eq.'+encodeURIComponent(userId)+
        '&trashed_at=is.null&order=updated_at.desc&limit=100',session.access_token);
      if (!this.isCurrentSession(session))throw new Error('Owner session changed during project loading.');
      if (!Array.isArray(result)||result.length>100)throw new Error('Invalid owner project list response.');
      const items=result.map(row=>this.parsePrivateProject(row,userId));
      if (new Set(items.map(item=>item.id)).size!==items.length)
        throw new Error('Duplicate private projects were rejected.');
      return items;
    });
  }

  async readOwnerProject(projectId: string): Promise<AuthOutcome<OwnerProject>> {
    return this.outcome(async () => {
      if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error('Project is unavailable.');
      const {session, userId} = await this.ownerSession();
      const rows = await this.ownerRest('projects?select=' + OWNER_PROJECT_FIELDS +
        '&id=eq.' + projectId + '&owner_user_id=eq.' + encodeURIComponent(userId) +
        '&trashed_at=is.null&limit=1', session.access_token);
      if (!this.isCurrentSession(session) || !Array.isArray(rows) || rows.length !== 1)
        throw new Error('Project is unavailable.');
      const project = this.parsePrivateProject(rows[0], userId);
      if (project.id !== projectId.toLowerCase()) throw new Error('Project is unavailable.');
      return project;
    });
  }

  async readOwnerCaseStudy(projectId: string): Promise<AuthOutcome<PrivateCaseStudy & {revision: number}>> {
    return this.outcome(async () => {
      if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error('Case study is unavailable.');
      const {session, userId} = await this.ownerSession();
      const params = new URLSearchParams({select: 'id,owner_user_id,revision,case_study',
        id: 'eq.' + projectId, owner_user_id: 'eq.' + userId, trashed_at: 'is.null', limit: '1'});
      const rows = await this.ownerRest('projects?' + params, session.access_token);
      const row = Array.isArray(rows) && rows.length === 1 ? rows[0] as Json : null;
      if (!this.isCurrentSession(session) || !row || row.owner_user_id !== userId || row.id !== projectId ||
          typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 0)
        throw new Error('Private case study response could not be verified.');
      return {...normalizePrivateCaseStudy(row.case_study), revision: row.revision};
    });
  }

  async saveOwnerCaseStudy(projectId: string, revision: number, input: PrivateCaseStudy):
    Promise<AuthOutcome<PrivateCaseStudy & {revision: number}>> {
    return this.outcome(async () => {
      if (!PROJECT_ID_PATTERN.test(projectId) || !Number.isSafeInteger(revision) || revision < 0)
        throw new Error('Invalid case study revision.');
      const draft = normalizePrivateCaseStudy(input);
      const {session} = await this.ownerSession();
      const receipt = await this.ownerRest('rpc/update_private_project_case_study', session.access_token, 'POST', {
        p_project_id: projectId, p_base_revision: revision, p_case_study: draft
      }) as Json | null;
      if (!this.isCurrentSession(session) || receipt?.id !== projectId || receipt.revision !== revision + 1)
        throw new Error('The server did not confirm the new case study revision.');
      return {...draft, revision: revision + 1};
    });
  }

  async saveOwnerProject(projectId: string, revision: number, input: PrivateProjectDraft):
    Promise<AuthOutcome<Pick<OwnerProject, 'id' | 'revision' | 'updatedAt'> & PrivateProjectDraft>> {
    return this.outcome(async () => {
      if (!PROJECT_ID_PATTERN.test(projectId) || !Number.isSafeInteger(revision) || revision < 0)
        throw new Error('Invalid project revision.');
      const draft = normalizeProjectDraft(input);
      const {session} = await this.ownerSession();
      const receipt = await this.ownerRest('rpc/update_private_project', session.access_token, 'POST', {
        p_project_id: projectId, p_base_revision: revision, p_title: draft.title,
        p_summary: draft.summary, p_description: draft.description,
        p_repository_url: draft.repositoryUrl, p_live_url: draft.liveUrl
      });
      if (!this.isCurrentSession(session) || !receipt || typeof receipt !== 'object' ||
          !('id' in receipt) || receipt.id !== projectId.toLowerCase() ||
          !('revision' in receipt) || !Number.isSafeInteger(receipt.revision) || receipt.revision !== revision + 1 ||
          !('updated_at' in receipt) || typeof receipt.updated_at !== 'string' ||
          !Number.isFinite(Date.parse(receipt.updated_at)))
        throw new Error('The server did not confirm the new project revision.');
      return {...draft, id: projectId, revision: receipt.revision, updatedAt: receipt.updated_at};
    });
  }

  /** Creates an owner-private draft, never a shared or published project. */
  async createPrivateProject(input:NewPrivateProject):Promise<AuthOutcome<OwnerProject>> {
    return this.outcome(async()=>{
      if (!input || typeof input.title!=='string' ||
        typeof input.slug!=='string' || typeof input.summary!=='string')
        throw new Error('Invalid project data.');
      const title=input.title.trim(),slug=input.slug.trim(),summary=input.summary.trim();
      if (!title||title.length>120||summary.length>360||slug.length<3||slug.length>64||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
        throw new Error('Invalid project title, summary or slug.');
      function urlOption(value:unknown):string|null {
        if (value===null || value==='')return null;
        if(typeof value!=='string'||value.length>2048||/\s/.test(value))
          throw new Error('A project link must be a valid HTTPS URL.');
        try {
          const u=new URL(value);
          if(u.protocol!=='https:'||!u.hostname.includes('.')||u.username||u.password||u.hash)
            throw new Error('Invalid HTTPS link.');
          return u.href;
        } catch {throw new Error('A project link must be a valid HTTPS URL.');}
      }
      const repositoryUrl=urlOption(input.repositoryUrl),liveUrl=urlOption(input.liveUrl);
      const {session,userId}=await this.ownerSession();
      const data=await this.ownerRest('projects?select='+OWNER_PROJECT_FIELDS,session.access_token,'POST',{
        owner_user_id:userId,title,slug,summary,description:'',
        repository_url:repositoryUrl,live_url:liveUrl
      },true);
      if (!this.isCurrentSession(session))throw new Error('Owner session changed during project creation.');
      if(!Array.isArray(data)||data.length!==1)
        throw new Error('The private insert was not confirmed.');
      const created=this.parsePrivateProject(data[0],userId);
      if(created.title!==title||created.slug!==slug||created.summary!==summary||
        created.repositoryUrl!==repositoryUrl||created.liveUrl!==liveUrl||
        created.revision!==0)
        throw new Error('Saved project did not match the private request.');
      return created;
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
