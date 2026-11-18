import { normalizeProjectDraft, type PrivateProjectDraft } from '../../../packages/contracts/src/projects.ts';
import { normalizePrivateCaseStudy, type PrivateCaseStudy } from '../../../packages/contracts/src/private-project-case-studies.ts';
import type { PortfolioPresetId } from '../../../packages/editor-core/src/managed-project-files.ts';
import type { PortfolioSnapshot } from '../../../packages/editor-core/src/portfolio-revision-transactions.ts';
import type { MyComponentInput, MyComponentVersion } from '../../../packages/contracts/src/private-my-components-service.ts';
import type { FrozenVisibilityIntent, PrivateFrozenRequest, PrivateReleaseAcknowledgementCursor, PrivateReleaseAcknowledgementPage } from '../../../packages/contracts/src/private-release-service.ts';
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

import type { AccountExitReauthVerification } from '../../../packages/contracts/src/private-account-erasure-service.ts';

export type OwnerAccountExitReauthContext = Readonly<{
  expectedEpoch:number; requestId:string; challengeId:string;
}>;
export type RecoveredOwnerAccountExitReauth = Readonly<{
  requestId:string; verification:AccountExitReauthVerification;
}>;
// A pointer to an existing server challenge, NOT an authentication receipt.
// Kept in this port's memory only; never copied to browser storage.
type AccountExitContinuation = Readonly<{
  ownerUserId:string; requestId:string; challengeId:string; deadline:number;
}>;
type PendingAccountExitContinuation = AccountExitContinuation & {epoch:number;authAttempt:number};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Json = Record<string, unknown>;
type StoredSession = { access_token: string; refresh_token: string; expires_at: number; user: AuthUser };
export type OwnerRecoveryBinding=Readonly<{ownerId:string;epoch:number}>;
type PendingRecoveryBinding=OwnerRecoveryBinding & {session:StoredSession;attempt:number};

/** Auth-state invalidation broadcasts never carry access tokens or identity claims. */
type OwnerSessionWriteNotice = (storage: StorageLike, source: SupabaseBrowserAuthPort, notice:object) => void;
const ownerSessionWriteNotices = new Set<OwnerSessionWriteNotice>();
function sameSession(a:StoredSession|null,b:StoredSession|null):boolean {
  return a===b || Boolean(a && b && a.user.id===b.user.id &&
    a.access_token===b.access_token && a.refresh_token===b.refresh_token);
}
export type ProfileDraft = { displayName: string; headline: string; bio: string; skills: string[] };
export type OwnerProfile = ProfileDraft & { handle: string | null };
export type OwnerProfileLink = Readonly<{label:string;url:string}>;
export type OwnerPrivateProfileLinks = Readonly<{links:OwnerProfileLink[];publicDeliveryAllowed:false}>;
export function normalizeOwnerProfileLinks(raw:unknown):OwnerProfileLink[] {
  if(!Array.isArray(raw)||raw.length>12)throw new Error('Choose at most 12 private profile links.');
  const seen=new Set<string>();
  const result:OwnerProfileLink[]=[];
  for(const item of raw){
    if(!item||typeof item!=='object'||Array.isArray(item)||
      Object.keys(item).sort().join(',')!=='label,url'||
      typeof item.label!=='string'||typeof item.url!=='string'||
      !item.label.trim()||item.label.trim().length>80||/[\u0000-\u001f\u007f]/.test(item.label)||
      item.url.length>2048||/\s/.test(item.url)||/[\u0000-\u001f\u007f]/.test(item.url))
      throw new Error('Use a descriptive label and a valid HTTPS profile link.');
    let url:URL;
    try{url=new URL(item.url);}catch{throw new Error('Profile links must use valid HTTPS URLs.');}
    if(url.protocol!=='https:'||url.username||url.password||url.port||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(url.hostname)||
      url.href.length>2048||seen.has(url.href))
      throw new Error('Use unique HTTPS links without credentials or custom ports.');
    seen.add(url.href);result.push({label:item.label.trim(),url:url.href});
  }
  return result;
}

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
export type OwnerPrivateImageMime = 'image/png'|'image/jpeg'|'image/webp';
export type OwnerMediaErrorCode = 'VALIDATION'|'DENIED'|'AUTH_CHANGED'|'CONFLICT'|
  'LIMIT_EXCEEDED'|'RATE_LIMITED'|'PROVIDER_UNAVAILABLE'|'INTEGRITY'|'ATTESTATION_UNAVAILABLE';
export type OwnerMediaFailure = AuthFailure & {code:OwnerMediaErrorCode};
export type OwnerMediaOutcome<T> = {data:T;error:OwnerMediaFailure|null};
/** A locally computed SHA is useful for private preview, never a publication pin. */
export type OwnerPrivateAssetRead = Readonly<{
  asset:OwnerProjectThumbnailAsset;bytes:Blob;
  integrity:Readonly<{status:'OWNER_BYTES_VERIFIED';computedSha256:string}>;
  serverAttestation:'NOT_VERIFIED'|'SERVER_HASH_PINNED';publicDeliveryAllowed:false;
}>;
export type OwnerPrivateAssetAttestationReceipt=Readonly<{
  assetId:string;status:'WRITE_ONCE_ATTESTED';publicPublishingAllowed:false;accountDeletionAllowed:false;
}>;
class OwnerMediaError extends Error {
  constructor(code:OwnerMediaErrorCode,message:string,status?:number){
    super(message);this.code=code;this.status=status;
  }
  readonly code:OwnerMediaErrorCode;
  readonly status:number|undefined;
}
function mediaError(code:OwnerMediaErrorCode,message:string,status?:number):OwnerMediaError {
  return new OwnerMediaError(code,message,status);
}
function mediaHttpError(status:number,payload:unknown,attestation=false,storage=false):OwnerMediaError {
  const row=payload&&typeof payload==='object'&&!Array.isArray(payload)?payload as Json:null;
  const code=row?.code;
  // Older Storage gateways may wrap an actual denial/conflict/limit in HTTP 400.
  // Interpret only allowlisted codes on the Storage endpoint, never raw provider text.
  const legacy=storage&&status===400?String(row?.statusCode??''):'';
  const storageCode=storage&&status===400?String(code??''):'';
  // PostgREST serialization errors need not use HTTP 409.
  if(status===401||status===403||code==='42501'||(!attestation&&status===404)||
    ['401','403','404'].includes(legacy)||['AccessDenied','InvalidJWT','NoSuchKey','NoSuchBucket'].includes(storageCode))
    return mediaError('DENIED','Private media access was denied.',status);
  if(status===429||legacy==='429')return mediaError('RATE_LIMITED','Too many private media requests. Try again later.',status);
  if(status===413||code==='54000'||legacy==='413'||storageCode==='EntityTooLarge')
    return mediaError('LIMIT_EXCEEDED','The private media limit was exceeded.',status);
  if(status===409||code==='40001'||code==='23505'||legacy==='409'||
    ['ResourceAlreadyExists','KeyAlreadyExists'].includes(storageCode))
    return mediaError(attestation?'INTEGRITY':'CONFLICT',attestation?'Private asset attestation did not verify.':
      'This project changed while you were editing. Load the latest revision before saving again.',status);
  if(code==='22023'&&(row?.message==='PRIVATE_THUMBNAIL_UNAVAILABLE'||row?.message==='PRIVATE_ASSET_PIN_INTEGRITY'||row?.message==='PRIVATE_STORAGE_OBJECT_NOT_VERIFIED'))
    return mediaError('INTEGRITY','Private thumbnail could not be verified.',status);
  if(code==='22023'||(attestation&&status===400)||['InvalidMimeType','InvalidKey','InvalidRequest'].includes(storageCode))
    return mediaError('VALIDATION','Invalid private media request.',status);
  return mediaError(attestation?'ATTESTATION_UNAVAILABLE':'PROVIDER_UNAVAILABLE',
    attestation?'Private asset attestation is unavailable.':'Private media service is unavailable.',status);
}
export type OwnerPrivateImageUploadContext = Readonly<{operationId:string;expectedEpoch:number}>;
/** Provider-reported linked identities, not verification badges or password recovery grants. */
export type OwnerLinkedIdentity = Readonly<{
  identityId:string;provider:string;createdAt:string|null;lastSignInAt:string|null;
}>;
export type OwnerLinkedMethods = Readonly<{
  ownerUserId:string;source:'GOTRUE_LIVE_USER';identities:readonly OwnerLinkedIdentity[];
  passwordMethodConfirmed:false;publicVerificationAllowed:false;
}>;
export type OwnerProjectThumbnailAsset = Readonly<{
  id:string;projectId:string;mime:OwnerPrivateImageMime;size:number;altText:string;createdAt:string;
}>;
export type OwnerProjectThumbnail = Readonly<{
  projectId:string;revision:number;asset:OwnerProjectThumbnailAsset|null;publicDeliveryAllowed:false;
}>;
export type OwnerProfileAvatarAsset = Readonly<{
  id:string;scope:'PROFILE';mime:OwnerPrivateImageMime;size:number;altText:string;createdAt:string;
}>;
export type OwnerProfileAvatar = Readonly<{
  revision:number;asset:OwnerProfileAvatarAsset|null;publicDeliveryAllowed:false;
}>;
export type OwnerProfileAvatarUpload = Readonly<{
  id:string;scope:'PROFILE';mime:OwnerPrivateImageMime;size:number;altText:string;
  verifiedMetadata:true;publicDeliveryAllowed:false;
}>;
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
class EmailConfirmationRequired extends Error {}

class AuthHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
/** Only a transient idempotent owner verification read may retry. */
class AuthTransientUserReadError extends Error {
  constructor(){super('Owner verification is temporarily unavailable. Use Retry if it persists.');}
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
  if (error instanceof EmailConfirmationRequired) return { message: error.message, providerCode: 'email_not_confirmed' };
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
  private pendingRecovery:PendingRecoveryBinding|null=null;
  private recoveryWrite:object|null=null;
  private accountExitContinuation:PendingAccountExitContinuation|null = null;
  private accountExitGeneration=0;
  private accountExitRecovery:{
    pending:PendingAccountExitContinuation;
    promise:Promise<RecoveredOwnerAccountExitReauth>;
  }|null=null;
  private readonly ownerSessionEpochListeners = new Set<(epoch:number)=>void>();
  private readonly observedOwnerSessionWrites=new WeakSet<object>();
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

  private clearAccountExitContinuation():void {
    ++this.accountExitGeneration;
    this.accountExitContinuation=null;
    this.accountExitRecovery=null;
  }

  private invalidateOwnerSessionEpoch(continuation:AccountExitContinuation|null=null):void {
    this.pendingRecovery=null;
    this.recoveryWrite=null;
    this.clearAccountExitContinuation();
    ++this.ownerSessionEpoch;
    // Only an explicitly verified account-exit password rotation can carry a
    // challenge pointer into its own new epoch. Every other transition clears it.
    this.accountExitContinuation=continuation
      ? {...continuation,epoch:this.ownerSessionEpoch,authAttempt:this.authAttempt} : null;
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

  /** A real change notice must invalidate even when the latest persisted
   * tuple has already returned to A (e.g. queued cross-tab A→B→A events).
   * Reset object identity too, so pending operations on old A cannot pass
   * isCurrentSession merely because the same credentials were restored. */
  private observeOwnerSessionWrite(notice:object):void {
    if(this.observedOwnerSessionWrites.has(notice))return;
    this.observedOwnerSessionWrites.add(notice);
    const epoch=this.ownerSessionEpoch;
    this.reconcileOwnerSessionEpoch();
    if(this.ownerSessionEpoch===epoch){
      this.session=this.readSession();
      ++this.authAttempt;
      this.refreshPromise=null;
      this.invalidateOwnerSessionEpoch();
    }
  }

  /**
   * Subscribe BEFORE the shell's initial getUser call. Every emission makes
   * the existing private subtree untrusted until fresh /auth/v1/user succeeds.
   * Includes same-tab distinct auth ports, cross-tab storage and window return.
   */
  subscribeOwnerSessionEpoch(listener:(epoch:number)=>void):()=>void {
    this.ownerSessionEpochListeners.add(listener);
    const sameTab:OwnerSessionWriteNotice=(storage,source,notice)=>{
      if(source!==this && storage===this.storage)this.observeOwnerSessionWrite(notice);
    };
    const storageChanged=(event:StorageEvent)=>{
      if(event.storageArea && event.storageArea!==this.storage)return;
      if(event.key===STORAGE_KEY||event.key===null)this.observeOwnerSessionWrite(event);
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

  private store(value: StoredSession | null, continuation:AccountExitContinuation|null=null): void {
    const previous=this.session;
    this.session = value;
    try {
      if (value) this.storage.setItem(STORAGE_KEY, JSON.stringify(value));
      else this.storage.removeItem(STORAGE_KEY);
    } catch {
      // Failure to persist must never be mistaken for a durable browser session.
      this.clearAccountExitContinuation();
      if (value) this.session = null;
      if (!sameSession(previous,this.session)) this.invalidateOwnerSessionEpoch();
      throw new Error('Browser storage is unavailable. Enable storage to sign in.');
    }
    if (!sameSession(previous,value)) {
      this.invalidateOwnerSessionEpoch(continuation);
      const notice={};
      for (const notify of ownerSessionWriteNotices) {
        try { notify(this.storage,this,notice); } catch { /* isolated subscriber */ }
      }
    }
  }

  private async request(path: string, method: string, body?: Json, token?: string, boundedOwnerGet=false): Promise<Json> {
    const headers: Record<string, string> = { apikey: this.publishableKey, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const ownerVerification=boundedOwnerGet&&method==='GET'&&path==='/user'&&typeof token==='string';
    const corePasswordExchange=method==='POST'&&(path.startsWith('/signup?redirect_to=')||path==='/token?grant_type=password');
    const requestUrl=this.origin+'/auth/v1'+path;
    let response: Response;
    try {
      response = await this.fetcher(requestUrl, {
        method,headers,body:body===undefined?undefined:JSON.stringify(body),
        cache:'no-store',credentials:'omit',redirect:'error',
        ...(ownerVerification?{signal:AbortSignal.timeout(10_000)}:corePasswordExchange?{signal:AbortSignal.timeout(20_000)}:{})
      });
    } catch {
      if(ownerVerification)throw new AuthTransientUserReadError();
      throw new Error('Could not connect to the authentication service.');
    }
    if(ownerVerification&&(response.redirected||(response.url&&response.url!==requestUrl)||
       response.status>=500))throw new AuthTransientUserReadError();
    if(corePasswordExchange&&(response.redirected||(response.url&&response.url!==requestUrl))){
      void response.body?.cancel().catch(()=>{});
      throw new Error('Authentication response origin could not be verified.');
    }
    const strictSignupResend = method === 'POST' && path.startsWith('/resend?redirect_to=') && body?.type === 'signup';
    const strictRecovery = method === 'POST' && path.startsWith('/recover?redirect_to=');
    const payload: unknown = await response.json().catch(() => undefined);
    if(corePasswordExchange&&response.ok&&(!payload||typeof payload!=='object'||Array.isArray(payload)))
      throw new Error('Authentication response could not be verified.');
    if(ownerVerification&&response.ok&&(!payload||typeof payload!=='object'||Array.isArray(payload)))
      throw new AuthTransientUserReadError();
    if (response.ok && (strictSignupResend || strictRecovery) &&
        (response.status !== 200 || !payload || typeof payload !== 'object' ||
         Array.isArray(payload) || Object.keys(payload).length !== 0))
      throw new Error(strictRecovery
        ? 'The authentication server returned an invalid recovery acknowledgement.'
        : 'The authentication server returned an invalid confirmation acknowledgement.');
    if (!response.ok) {
      const data = (payload && typeof payload === 'object' ? payload : {}) as Json;
      const code = typeof data.error_code === 'string' ? data.error_code : '';
      if (path === '/token?grant_type=password' && code === 'email_not_confirmed')
        throw new EmailConfirmationRequired('Email confirmation is required.');
      if (response.status === 429) throw new AuthHttpError(429,'Too many requests. Try again later.');
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
      this.reconcileOwnerSessionEpoch();
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
      this.reconcileOwnerSessionEpoch();
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
      const checked=await this.verifyLiveSession();
      if(!this.isCurrentSession(checked.session) || checked.epoch!==this.ownerSessionEpoch)
        throw new Error('User verification did not match the active session.');
      return {user:checked.user};
    });
  }

  /** Bind the live provider response to the exact verified credential object
   * and epoch, never a subsequent same-owner token from another session. */
  private async verifyLiveSession():Promise<{session:StoredSession;user:AuthUser;epoch:number}> {
    const session=await this.refreshed();
    if(!session || !this.isCurrentSession(session))throw new Error('Session expired.');
    const epoch=this.ownerSessionEpoch;
    const current=()=>this.reconcileOwnerSessionEpoch()===epoch&&this.isCurrentSession(session);
    try{
      for(let attempt=0;attempt<2;attempt++){
        if(!current())throw new Error('Owner session changed during verification.');
        let data:Json;
        try{data=await this.request('/user','GET',undefined,session.access_token,true);}
        catch(error){
          if(error instanceof AuthTransientUserReadError&&attempt===0&&current())continue;
          throw error;
        }
        if(!current())throw new Error('Owner session changed during verification.');
        const user=userFrom(data);
        if(!user){
          if(attempt===0)continue;
          throw new AuthTransientUserReadError();
        }
        if(user.id!==session.user.id){
          if(current())this.store(null);
          throw new Error('User verification did not match the active session.');
        }
        if(!current())throw new Error('Owner session changed during verification.');
        return {session,user,epoch};
      }
      throw new AuthTransientUserReadError();
    }catch(error){
      // A transient read never logs out the legitimate owner; a proven
      // mismatch or 401/403 still does. No cached identity fallback.
      if(error instanceof AuthHttpError && [401,403].includes(error.status) &&
          current()){
        try{this.store(null);}catch{/* storage already failed */}
      }
      throw error;
    }
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

  private async verifyCurrentOwnerPassword(password: string,attempt: number,expectedEpoch?:number,exitGeneration?:number) {
    const {session,userId}=await this.ownerSession();
    const email=session.user.email;
    if (!email) throw new Error('Sign in with a verified email account first.');
    this.assertCurrentAuthAttempt(attempt);
    if((expectedEpoch!==undefined && expectedEpoch!==this.ownerSessionEpoch) ||
        (exitGeneration!==undefined && exitGeneration!==this.accountExitGeneration))
      throw new Error('Owner session or identity verification changed before verifying identity.');
    const verified=this.decodeSession(await this.request('/token?grant_type=password','POST',{email,password}));
    this.assertCurrentAuthAttempt(attempt);
    if((expectedEpoch!==undefined && expectedEpoch!==this.ownerSessionEpoch) ||
        (exitGeneration!==undefined && exitGeneration!==this.accountExitGeneration))
      throw new Error('Owner session or identity verification changed while verifying identity.');
    if (!this.isCurrentSession(session) || verified.user.id!==userId ||
        verified.user.email?.trim().toLowerCase()!==email.trim().toLowerCase())
      throw new Error('Current password verification did not match the active account.');
    return {session,verified};
  }

  async reauthenticateCurrentOwner(password: string,accountExit?:OwnerAccountExitReauthContext): Promise<AuthOutcome<{verified:true}>> {
    return this.outcome(async () => {
      const context=accountExit ? {...accountExit} : null;
      if(context && (this.reconcileOwnerSessionEpoch()!==context.expectedEpoch ||
          !PROJECT_ID_PATTERN.test(context.requestId) || !PROJECT_ID_PATTERN.test(context.challengeId)))
        throw new Error('Account-exit verification is no longer current.');
      // A new explicit verification supersedes any previous challenge pointer.
      // Dismissal during a pending password exchange must not install a new one.
      this.clearAccountExitContinuation();
      const generation=this.accountExitGeneration;
      const attempt=++this.authAttempt;
      const {session,verified}=await this.verifyCurrentOwnerPassword(
        password,attempt,context?.expectedEpoch,context?generation:undefined);
      this.assertCurrentAuthAttempt(attempt);
      if (!this.isCurrentSession(session) || verified.access_token===session.access_token ||
          (context && (context.expectedEpoch!==this.ownerSessionEpoch ||
            generation!==this.accountExitGeneration)))
        throw new Error('A fresh sign-in could not be confirmed.');
      // Store the non-authoritative pointer before synchronous epoch notification
      // so a newly mounted, verified Settings consumer can recover the challenge.
      this.store(verified,context ? {
        ownerUserId:verified.user.id,requestId:context.requestId,
        challengeId:context.challengeId,deadline:Date.now()+5*60*1000
      } : null);
      return {verified:true};
    });
  }

  /** Re-read the server's short-lived proof after fail-closed workspace remount.
   * Concurrent consumers of the same pointer share one server completion.
   * No local receipt, owner ID or challenge ID is itself reauthentication authority. */
  async recoverOwnerAccountExitReauth(expectedEpoch:number):
    Promise<AuthOutcome<RecoveredOwnerAccountExitReauth|null>> {
    return this.outcome(async()=>{
      if(this.reconcileOwnerSessionEpoch()!==expectedEpoch)
        throw new Error('Owner session changed before recovering identity verification.');
      const pending=this.accountExitContinuation;
      if(!pending || pending.epoch!==expectedEpoch)return null;
      if(pending.deadline<=Date.now() || pending.authAttempt!==this.authAttempt){
        this.clearAccountExitContinuation();return null;
      }
      // Defer the worker until the flight record is installed, including when
      // the initial live /user check triggers a synchronous epoch notification.
      const existing=this.accountExitRecovery;
      const flight=existing?.pending===pending ? existing : {
        pending,promise:Promise.resolve().then(()=>this.recoverAccountExitContinuation(pending))
      };
      this.accountExitRecovery=flight;
      try{
        const result=await flight.promise;
        // Each waiter checks currentness independently, including if a caller
        // discarded the challenge after the shared promise resolved.
        if(!this.isAccountExitContinuationCurrent(pending) ||
            Date.parse(result.verification.expiresAt)<=Date.now()){
          if(this.accountExitContinuation===pending)this.clearAccountExitContinuation();
          throw new Error('Identity verification expired or the owner session changed.');
        }
        return result;
      }finally{
        // An old completion must never clear a newer recovery's tracking.
        if(this.accountExitRecovery===flight)this.accountExitRecovery=null;
      }
    });
  }

  private isAccountExitContinuationCurrent(pending:PendingAccountExitContinuation):boolean {
    return this.reconcileOwnerSessionEpoch()===pending.epoch &&
      this.accountExitContinuation===pending && this.authAttempt===pending.authAttempt &&
      pending.deadline>Date.now();
  }

  private async recoverAccountExitContinuation(pending:PendingAccountExitContinuation):
    Promise<RecoveredOwnerAccountExitReauth> {
    if(!this.isAccountExitContinuationCurrent(pending))
      throw new Error('Owner session changed during identity verification.');
    const {session,userId}=await this.ownerSession();
    const stillCurrent=()=>this.isAccountExitContinuationCurrent(pending) &&
      pending.ownerUserId===userId && this.isCurrentSession(session);
    if(!stillCurrent())throw new Error('Owner session changed during identity verification.');
    const account=await import('../../../packages/contracts/src/private-account-erasure-service.ts');
    if(!stillCurrent())throw new Error('Owner session changed during identity verification.');
    // Pin the verified initiating credential rather than dynamically adopting
    // a newly signed-in owner or even another session of the same owner.
    const service=new account.SupabasePrivateAccountErasureService(
      this.origin,this.publishableKey,async()=>stillCurrent()?session.access_token:null,this.fetcher);
    try{
      const requests=await service.list();
      if(!stillCurrent())throw new Error('Owner session changed during identity verification.');
      if(!requests.some(item=>item.id===pending.requestId && item.status==='REQUESTED_BLOCKED')){
        if(this.accountExitContinuation===pending)this.clearAccountExitContinuation();
        throw new Error('The account-exit request is no longer pending.');
      }
      // Existing SQL validates live auth.sessions, same owner, different initial
      // session, creation time and expiry. Same-session replay is idempotent.
      const verification=await service.completeReauth(pending.challengeId);
      if(!stillCurrent() || Date.parse(verification.expiresAt)<=Date.now()){
        if(this.accountExitContinuation===pending)this.clearAccountExitContinuation();
        throw new Error('Identity verification expired or the owner session changed.');
      }
      return {requestId:pending.requestId,verification};
    }catch(error){
      // A lost/failed RPC response can be retried with exactly this pointer.
      // Definitive provider rejections and malformed acknowledgments do not
      // become reusable authority.
      if(this.accountExitContinuation===pending &&
          error instanceof account.PrivateAccountErasureError &&
          error.code!=='PROVIDER_UNAVAILABLE')this.clearAccountExitContinuation();
      throw error;
    }
  }

  /** Dismissal also aborts local continuation installation during an in-flight
   * password exchange. It does not revoke a server session or challenge. */
  discardOwnerAccountExitReauth(expectedEpoch:number):void {
    if(this.reconcileOwnerSessionEpoch()===expectedEpoch)
      this.clearAccountExitContinuation();
  }

  /** In-memory continuation for the initiating provider-verified email session.
   * It is not a replacement for GoTrue authorization, and is never persisted. */
  private installRecoveryBinding(kind:string,session:StoredSession,attempt:number):void{
    this.pendingRecovery=null;
    if(kind!=='recovery'&&kind!=='invite')return;
    this.assertCurrentAuthAttempt(attempt);
    if(!this.isCurrentSession(session))throw new Error('Recovery session changed.');
    this.pendingRecovery={ownerId:session.user.id,epoch:this.ownerSessionEpoch,session,attempt};
  }

  private currentRecovery(binding:OwnerRecoveryBinding):PendingRecoveryBinding{
    const grant=this.pendingRecovery;
    const epoch=this.reconcileOwnerSessionEpoch();
    if(!grant||this.pendingRecovery!==grant||grant.attempt!==this.authAttempt||
      epoch!==grant.epoch||binding.ownerId!==grant.ownerId||binding.epoch!==grant.epoch||
      !this.isCurrentSession(grant.session))
      throw new Error('Recovery session changed. Request a new link.');
    return grant;
  }

  readVerifiedRecoveryBinding():OwnerRecoveryBinding|null{
    const grant=this.pendingRecovery;
    if(!grant)return null;
    try{this.currentRecovery(grant);return {ownerId:grant.ownerId,epoch:grant.epoch};}
    catch{return null;}
  }

  /** Use the initiating grant's verified bearer, not a replacement session.
   * Refresh/owner change/another Auth action invalidates this continuation. */
  updateRecoveryPassword(password:string,binding:OwnerRecoveryBinding):Promise<AuthOutcome<{user:AuthUser}>>{
    const expected={...binding};
    return this.outcome(async()=>{
      if(typeof password!=='string'||!password)throw new Error('A new password is required.');
      const grant=this.currentRecovery(expected);
      if(this.recoveryWrite)throw new Error('A recovery password update is already pending.');
      const flight={};
      this.recoveryWrite=flight;
      try{
        const checked=await this.verifyLiveSession();
        if(this.currentRecovery(expected)!==grant||checked.session!==grant.session||
          checked.user.id!==grant.ownerId||checked.epoch!==grant.epoch||this.recoveryWrite!==flight)
          throw new Error('Recovery session changed. Request a new link.');
        const payload=await this.request('/user','PUT',{password},grant.session.access_token);
        const updated=userFrom(payload.user??payload);
        if(this.currentRecovery(expected)!==grant||this.recoveryWrite!==flight||
          !updated||updated.id!==grant.ownerId)
          throw new Error('Password update could not be confirmed for the recovery account.');
        this.pendingRecovery=null;
        return {user:updated};
      }finally{if(this.recoveryWrite===flight)this.recoveryWrite=null;}
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
    const session={access_token,refresh_token,expires_at:Math.floor(Date.now()/1000)+expires_in,user};
    this.storeEmailSession(session);
    this.installRecoveryBinding(kind,session,attempt);
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
    const verifiedSession={...session,user:verified};
    this.storeEmailSession(verifiedSession);
    this.installRecoveryBinding(type,verifiedSession,attempt);
    return type === 'invite' ? 'invite' : type === 'recovery' ? 'recovery' : 'confirmation';
  }


  /** The only workspace PostgREST surface exposed to this browser port.
   * Always authenticate with live /auth/v1/user and send an owner filter even
   * though the database's RLS is the final authorization boundary. */
  private async ownerSession(): Promise<{session:StoredSession;userId:string;epoch:number}> {
    let checked:Awaited<ReturnType<SupabaseBrowserAuthPort['verifyLiveSession']>>;
    try{checked=await this.verifyLiveSession();}
    catch{throw new Error('Owner session verification is required.');}
    if(!this.isCurrentSession(checked.session) || checked.epoch!==this.ownerSessionEpoch)
      throw new Error('Owner session changed before the private request.');
    return {session:checked.session,userId:checked.user.id,epoch:checked.epoch};
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
    if (!response.ok && ['rpc/update_private_project', 'rpc/owner_save_profile_draft', 'rpc/owner_save_private_profile_links', 'rpc/update_private_project_case_study', 'rpc/set_private_project_thumbnail'].includes(path)) {
      const payload: unknown = await response.json().catch(() => null);
      if (payload && typeof payload === 'object') {
        if ('code' in payload && payload.code === '40001')
          throw new Error((path === 'rpc/owner_save_profile_draft' || path === 'rpc/owner_save_private_profile_links')
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

  /** Optional initiating mount epoch protects delayed/automatic profile saves
   * across owner transitions. Older explicit callers retain the same signature
   * and live-session verification; their returned owner epoch is still checked. */
  private assertOwnerProfileEpoch(session:StoredSession,epoch:number):void {
    if(this.reconcileOwnerSessionEpoch()!==epoch||!this.isCurrentSession(session))
      throw new Error('Owner session changed during profile access.');
  }

  private async ownerProfileDraftSession(expectedEpoch?:number) {
    if(expectedEpoch!==undefined&&this.reconcileOwnerSessionEpoch()!==expectedEpoch)
      throw new Error('Owner session changed before profile access.');
    const checked=await this.ownerSession();
    this.assertOwnerProfileEpoch(checked.session,expectedEpoch??checked.epoch);
    return checked;
  }

  async readOwnerProfile(expectedEpoch?:number): Promise<AuthOutcome<OwnerProfile>> {
    return this.outcome(async () => {
      const {session, userId, epoch} = await this.ownerProfileDraftSession(expectedEpoch);
      this.assertOwnerProfileEpoch(session,expectedEpoch??epoch);
      const rows = await this.ownerRest('profiles?select=user_id,handle,display_name,headline,bio,private_skills&user_id=eq.' +
        encodeURIComponent(userId) + '&limit=1', session.access_token);
      this.assertOwnerProfileEpoch(session,expectedEpoch??epoch);
      if (!Array.isArray(rows) || rows.length !== 1)
        throw new Error('Private profile could not be loaded.');
      return this.parseOwnerProfile(rows[0], userId);
    });
  }

  async saveOwnerProfile(expected: ProfileDraft, draft: ProfileDraft, confirmWithdrawal: boolean,
    expectedEpoch?:number): Promise<AuthOutcome<OwnerProfile>> {
    return this.outcome(async () => {
      // Snapshot the caller's exact CAS inputs before live verification awaits.
      const baseline={displayName:expected.displayName,headline:expected.headline,bio:expected.bio,skills:[...expected.skills]};
      const desired={displayName:draft.displayName,headline:draft.headline,bio:draft.bio,skills:[...draft.skills]};
      const {session, userId, epoch} = await this.ownerProfileDraftSession(expectedEpoch);
      this.assertOwnerProfileEpoch(session,expectedEpoch??epoch);
      const result = await this.ownerRest('rpc/owner_save_profile_draft', session.access_token, 'POST', {
        p_expected: baseline,
        p_draft: desired, p_confirm_projection_withdrawal: confirmWithdrawal
      });
      this.assertOwnerProfileEpoch(session,expectedEpoch??epoch);
      return this.parseOwnerProfile(result, userId);
    });
  }

  private parsePrivateProfileLinks(raw:unknown,userId:string):OwnerPrivateProfileLinks{
    const row=raw as Json|null;
    if(!row||Array.isArray(row)||row.user_id!==userId)
      throw new Error('Private profile links could not be verified.');
    const links=normalizeOwnerProfileLinks(row.private_links);
    if(!Array.isArray(row.private_links)||row.private_links.some((link,index)=>
      link?.label!==links[index]?.label||link?.url!==links[index]?.url))
      throw new Error('Private profile links were not in canonical form.');
    return {links,publicDeliveryAllowed:false};
  }

  private async profileLinksSession(expectedEpoch:number){
    if(this.reconcileOwnerSessionEpoch()!==expectedEpoch)
      throw new Error('Owner session changed before profile link access.');
    const checked=await this.ownerSession();
    this.assertOwnerImageEpoch(checked.session,expectedEpoch);
    return checked;
  }

  /** Owner-private authored HTTPS links; distinct from provider integrations. */
  async readOwnerProfileLinks(expectedEpoch:number):Promise<AuthOutcome<OwnerPrivateProfileLinks>>{
    return this.outcome(async()=>{
      const {session,userId}=await this.profileLinksSession(expectedEpoch);
      const query=new URLSearchParams({select:'user_id,private_links',user_id:'eq.'+userId,limit:'1'});
      const rows=await this.ownerRest('profiles?'+query,session.access_token);
      this.assertOwnerImageEpoch(session,expectedEpoch);
      if(!Array.isArray(rows)||rows.length!==1)throw new Error('Private profile links are unavailable.');
      return this.parsePrivateProfileLinks(rows[0],userId);
    });
  }

  async saveOwnerProfileLinks(expected:readonly OwnerProfileLink[],draft:readonly OwnerProfileLink[],expectedEpoch:number):
    Promise<AuthOutcome<OwnerPrivateProfileLinks>>{
    return this.outcome(async()=>{
      const input=normalizeOwnerProfileLinks(draft),base=normalizeOwnerProfileLinks(expected);
      const {session,userId}=await this.profileLinksSession(expectedEpoch);
      const receipt=await this.ownerRest('rpc/owner_save_private_profile_links',session.access_token,'POST',{
        p_expected:base,p_links:input
      });
      this.assertOwnerImageEpoch(session,expectedEpoch);
      const result=this.parsePrivateProfileLinks(receipt,userId);
      if(JSON.stringify(result.links)!==JSON.stringify(input))
        throw new Error('The requested private profile links were not confirmed.');
      return result;
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

  /** Historical DB acknowledgements, not current public delivery or rollback authority. */
  async listOwnerReleaseAcknowledgements(portfolioId:string,limit=25,
    after:PrivateReleaseAcknowledgementCursor|null=null):Promise<AuthOutcome<PrivateReleaseAcknowledgementPage>> {
    return this.outcome(async()=>{
      if(!PROJECT_ID_PATTERN.test(portfolioId)||!Number.isSafeInteger(limit)||limit<1||limit>50)
        throw new Error('Invalid release history request.');
      const id=portfolioId.toLowerCase();
      const cursor=after===null?null:{...after};
      const {session,userId,epoch}=await this.ownerSession();
      const current=()=>this.reconcileOwnerSessionEpoch()===epoch &&
        this.isCurrentSession(session) && session.user.id===userId;
      const requireOwned=async()=>{
        if(!current())throw new Error('Account changed while loading release history.');
        const params=new URLSearchParams({select:'id,owner_user_id',id:'eq.'+id,
          owner_user_id:'eq.'+userId,trashed_at:'is.null',limit:'2'});
        const rows=await this.ownerRest('portfolios?'+params,session.access_token);
        const row=Array.isArray(rows)&&rows.length===1?rows[0]:null;
        if(!current()||!row||typeof row!=='object'||Array.isArray(row)||
          Object.keys(row).length!==2||row.id!==id||row.owner_user_id!==userId)
          throw new Error('Portfolio release history is unavailable.');
      };
      await requireOwned();
      const {SupabasePrivateReleaseService}=await import('../../../packages/contracts/src/private-release-service.ts');
      if(!current())throw new Error('Account changed while loading release history.');
      const service=new SupabasePrivateReleaseService(this.origin,this.publishableKey,
        async()=>current()?session.access_token:null,this.fetcher);
      const page=await service.listAcknowledgements(id,limit,cursor);
      await requireOwned();
      if(!current())throw new Error('Account changed while loading release history.');
      return page;
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


  /** Keep legacy AuthOutcome callers structurally compatible; don't change AuthPort or its security gate. */
  private async mediaOutcome<T>(epoch:number,task:()=>Promise<T>):Promise<OwnerMediaOutcome<T>>{
    try{
      if(this.reconcileOwnerSessionEpoch()!==epoch)throw mediaError('AUTH_CHANGED','Owner session changed before private media access.');
      const data=await task();
      if(this.reconcileOwnerSessionEpoch()!==epoch)throw mediaError('AUTH_CHANGED','Owner session changed during private media access.');
      return {data,error:null};
    }catch(error){
      const cause=this.reconcileOwnerSessionEpoch()!==epoch?
        mediaError('AUTH_CHANGED','Owner session changed during private media access.'):
        error instanceof OwnerMediaError?error:mediaError('PROVIDER_UNAVAILABLE','Private media service is unavailable.');
      return {data:null as T,error:{code:cause.code,message:cause.message,
        ...(cause.status===undefined?{}:{status:cause.status})}};
    }
  }

  /** Parse one bounded JSON stream; distinguish invalid data from interrupted transport. */
  private async readBoundedOwnerMedia(response:Response,session:StoredSession,epoch:number,max:number,timeoutMs:number):Promise<Uint8Array>{
    if(!Number.isSafeInteger(max)||max<1||max>5242880)
      throw mediaError('INTEGRITY','Private media response exceeds its verified bounds.');
    const reader=response.body?.getReader();
    if(!reader)throw mediaError('INTEGRITY','Private media response could not be verified.');
    const buffer=new Uint8Array(max);
    let size=0,empty=0,chunks=0,timer:ReturnType<typeof setTimeout>|undefined;
    const deadline=performance.now()+timeoutMs;
    const expiry=new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>reject(mediaError('PROVIDER_UNAVAILABLE','Private media response timed out.')),timeoutMs);
    });
    try{
      for(;;){
        if(performance.now()>=deadline)throw mediaError('PROVIDER_UNAVAILABLE','Private media response timed out.');
        let part:ReadableStreamReadResult<Uint8Array>;
        try{part=await Promise.race([reader.read(),expiry]);}
        catch(error){
          if(error instanceof OwnerMediaError)throw error;
          throw mediaError('PROVIDER_UNAVAILABLE','Private media response stream was interrupted.');
        }
        this.assertOwnerImageEpoch(session,epoch);
        if(performance.now()>=deadline)throw mediaError('PROVIDER_UNAVAILABLE','Private media response timed out.');
        if(part.done)break;
        if(!(part.value instanceof Uint8Array)||++chunks>16384||part.value.byteLength>max-size)
          throw mediaError('INTEGRITY','Private media response exceeds its verified bounds.');
        if(part.value.byteLength===0){
          if(++empty>=16)throw mediaError('INTEGRITY','Private media response made no progress.');
          continue;
        }
        empty=0;buffer.set(part.value,size);size+=part.value.byteLength;
      }
      return buffer.subarray(0,size);
    }finally{
      if(timer!==undefined)clearTimeout(timer);
      try{void reader.cancel().catch(()=>{});}catch{/* best effort */}
      try{reader.releaseLock();}catch{/* pending read cancelled */}
    }
  }

  private async readMediaJsonBody(response:Response,session:StoredSession,epoch:number,max:number):Promise<unknown>{
    const bytes=await this.readBoundedOwnerMedia(response,session,epoch,max,15000);
    this.assertOwnerImageEpoch(session,epoch);
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch{throw mediaError('INTEGRITY','Private media response could not be verified.');}
  }

  private async mediaResponseError(response:Response,session:StoredSession,epoch:number,attestation=false,storage=false):Promise<OwnerMediaError>{
    let raw:unknown=null;
    try{raw=await this.readMediaJsonBody(response,session,epoch,8192);}
    catch(error){if(error instanceof OwnerMediaError&&error.code==='AUTH_CHANGED')throw error;}
    this.assertOwnerImageEpoch(session,epoch);
    return mediaHttpError(response.status,raw,attestation,storage);
  }

  /** Owner-only metadata receipt. Bounded error and success bodies; no raw provider diagnostics. */
  private async mediaJson(path:string,session:StoredSession,epoch:number,body?:Json,attestation=false):Promise<unknown>{
    this.assertOwnerImageEpoch(session,epoch);
    let response:Response;
    try{
      response=await this.fetcher(this.origin+path,{
        method:body===undefined?'GET':'POST',
        headers:{apikey:this.publishableKey,Authorization:'Bearer '+session.access_token,
          Accept:'application/json','Content-Type':'application/json'},
        body:body===undefined?undefined:JSON.stringify(body),
        credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)
      });
    }catch{throw mediaError(attestation?'ATTESTATION_UNAVAILABLE':'PROVIDER_UNAVAILABLE','Private media service is unavailable.');}
    try{
      this.assertOwnerImageEpoch(session,epoch);
      if(response.redirected||(response.url&&response.url!==this.origin+path))
        throw mediaError('INTEGRITY','Private media response origin could not be verified.');
      if(!response.ok)throw await this.mediaResponseError(response,session,epoch,attestation,path.startsWith('/storage/v1/'));
      const raw=await this.readMediaJsonBody(response,session,epoch,65536);
      this.assertOwnerImageEpoch(session,epoch);
      if(raw===null)throw mediaError('INTEGRITY','Private media response could not be verified.');
      return raw;
    }finally{void response.body?.cancel().catch(()=>{});}
  }

  private async validateOwnerRaster(file:Blob,reading=false):Promise<{ext:string;mime:OwnerPrivateImageMime}> {
    const formats:Readonly<Record<string,{ext:string;magic:(bytes:Uint8Array)=>boolean}>>={
      'image/png':{ext:'png',magic:bytes=>bytes.length>=8&&
        [137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)},
      'image/jpeg':{ext:'jpg',magic:bytes=>bytes.length>=3&&
        bytes[0]===255&&bytes[1]===216&&bytes[2]===255},
      'image/webp':{ext:'webp',magic:bytes=>bytes.length>=12&&
        String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&
        String.fromCharCode(...bytes.slice(8,12))==='WEBP'}
    };
    if(file.size<12||file.size>5242880||!Object.hasOwn(formats,file.type))
      throw mediaError(reading?'INTEGRITY':file.size>5242880?'LIMIT_EXCEEDED':'VALIDATION','Choose a PNG/JPEG/WebP image under 5 MB.');
    const format=formats[file.type];
    const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer());
    if(!format||!format.magic(bytes))throw mediaError(reading?'INTEGRITY':'VALIDATION','File bytes do not match the selected image format.');
    // Header/MIME checks do not detect truncated or decompression-bomb
    // images. Browser-native decoding must succeed before write-once upload.
    // Node contract tests independently test bytes and RPC protocol without
    // a browser decoder; authenticated Chromium covers real image decoding.
    if(typeof window!=='undefined'){
      let width=0,height=0;
      if(typeof createImageBitmap==='function'){
        let bitmap:ImageBitmap;
        try{bitmap=await createImageBitmap(file);}
        catch{throw mediaError(reading?'INTEGRITY':'VALIDATION',reading?'Private image bytes cannot be decoded.':'The selected image cannot be decoded. No private bytes were uploaded.');}
        try{width=bitmap.width;height=bitmap.height;}
        finally{bitmap.close();}
      }else{
        if(typeof Image==='undefined'||typeof URL.createObjectURL!=='function')
        throw mediaError('PROVIDER_UNAVAILABLE','Private image validation is unavailable in this browser.');
        const temporary=URL.createObjectURL(file);
        try{
        const image=new Image();
        image.src=temporary;
        await image.decode();
        width=image.naturalWidth;height=image.naturalHeight;
        }catch{throw mediaError(reading?'INTEGRITY':'VALIDATION',reading?'Private image bytes cannot be decoded.':'The selected image cannot be decoded. No private bytes were uploaded.');}
        finally{URL.revokeObjectURL(temporary);}
      }
      if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||
        width<1||height<1||width>8192||height>8192||width*height>24_000_000)
        throw mediaError('LIMIT_EXCEEDED','Image dimensions exceed the private preview safety limit.');
    }

    return {ext:format.ext,mime:file.type as OwnerPrivateImageMime};
  }

  private assertOwnerImageEpoch(session:StoredSession,epoch:number):void {
    if(this.reconcileOwnerSessionEpoch()!==epoch||!this.isCurrentSession(session))
      throw mediaError('AUTH_CHANGED','Owner session changed during private image access.');
  }

  /** Download only a previously verified private object, never an external URL.
   * Bound streamed bytes before constructing a Blob, and reject stale sessions. */
  private async readOwnerImageBytes(session:StoredSession,epoch:number,path:string,mime:OwnerPrivateImageMime,size:number):Promise<Blob> {
    this.assertOwnerImageEpoch(session,epoch);
    const url=this.origin+'/storage/v1/object/authenticated/kadmeion-private-assets/'+path;
    let response:Response;
    try{
      response=await this.fetcher(url,{
        headers:{apikey:this.publishableKey,Authorization:'Bearer '+session.access_token},
        credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(60_000)
      });
    }catch{throw mediaError('PROVIDER_UNAVAILABLE','Private image bytes could not be read. Retry or use the folder cover.');}
    try{
      this.assertOwnerImageEpoch(session,epoch);
      if(response.redirected||(response.url&&response.url!==url))
        throw mediaError('INTEGRITY','Private image response origin could not be verified.');
      const declared=response.headers.get('content-length');
      if(!response.ok)throw await this.mediaResponseError(response,session,epoch,false,true);
      if(response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!==mime||
        (declared!==null&&(!/^\d+$/.test(declared)||Number(declared)!==size))||!response.body)
        throw mediaError('INTEGRITY','Private image readback was not verified.');
      const bytes=await this.readBoundedOwnerMedia(response,session,epoch,size,60000);
      if(bytes.byteLength!==size)throw mediaError('INTEGRITY','Private image size did not match its registered metadata.');
      const blob=new Blob([new Uint8Array(bytes)],{type:mime});
      await this.validateOwnerRaster(blob,true);
      this.assertOwnerImageEpoch(session,epoch);
      return blob;
    }finally{void response.body?.cancel().catch(()=>{});}
  }

  /** Private-only, write-once upload. With the optional stable operation UUID,
   * a lost response is recovered only by exact-byte readback of the same object.
   * Metadata registration is NOT a server-attested publication byte pin. */
  async uploadOwnerProjectImage(projectId:string,file:File,altText:string,context?:OwnerPrivateImageUploadContext):
    Promise<OwnerMediaOutcome<{id:string;projectId:string;mime:string;size:number;altText:string;verifiedMetadata:true;publicDeliveryAllowed:false}>> {
    const request=context?{...context}:null;
    const expectedEpoch=request?.expectedEpoch??this.reconcileOwnerSessionEpoch();
    return this.mediaOutcome(expectedEpoch,async()=>{
      if(!PROJECT_ID_PATTERN.test(projectId)||!(file instanceof File)||
        typeof altText!=='string'||altText.trim().length<1||altText.length>500||
        (request&&!PROJECT_ID_PATTERN.test(request.operationId)))
        throw mediaError('VALIDATION','Choose a private project, a PNG/JPEG/WebP image under 5 MB, and descriptive alt text.');
      const format=await this.validateOwnerRaster(file);
      if(this.reconcileOwnerSessionEpoch()!==expectedEpoch)
        throw mediaError('AUTH_CHANGED','Owner session changed before private image upload.');
      const {session,userId,epoch}=await this.ownerThumbnailSession(projectId,expectedEpoch);
      const params=new URLSearchParams({select:'id,owner_user_id',
        id:'eq.'+projectId,owner_user_id:'eq.'+userId,trashed_at:'is.null',limit:'1'});
      const project=await this.mediaJson('/rest/v1/projects?'+params,session,epoch);
      this.assertOwnerImageEpoch(session,epoch);
      if(!Array.isArray(project)||project.length!==1||
        project[0]?.id!==projectId.toLowerCase()||project[0]?.owner_user_id!==userId)
        throw mediaError('DENIED','The selected private project could not be verified.');
      // Stable object identity is independent of MIME so a reused operation
      // cannot create a second object simply by changing file format.
      const objectPath=userId+'/'+projectId.toLowerCase()+'/'+
        (request?request.operationId.toLowerCase()+'.img':crypto.randomUUID()+'.'+format.ext);
      let upload:Response|null=null;
      try{
        upload=await this.fetcher(this.origin+'/storage/v1/object/kadmeion-private-assets/'+objectPath,{
          method:'POST',headers:{apikey:this.publishableKey,Authorization:'Bearer '+session.access_token,
            'Content-Type':format.mime,'x-upsert':'false','Cache-Control':'no-store'},
          body:file,credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(60_000)
        });
      }catch{ /* An uncertain result is recoverable only for a stable operation. */ }
      const accepted=upload?.ok===true;
      let rejected:OwnerMediaError|null=null;
      try{
        this.assertOwnerImageEpoch(session,epoch);
        if(upload&&!accepted)rejected=await this.mediaResponseError(upload,session,epoch,false,true);
      }finally{void upload?.body?.cancel().catch(()=>{});}
      this.assertOwnerImageEpoch(session,epoch);
      if(!accepted){
        const ambiguous=!upload||rejected?.code==='CONFLICT'||
          (rejected?.code==='PROVIDER_UNAVAILABLE'&&(upload.status===400||upload.status>=500));
        if(!request||!ambiguous)
          throw rejected??mediaError('PROVIDER_UNAVAILABLE','Private image upload was not confirmed. No public image was created.');
        let existing:Blob;
        try{existing=await this.readOwnerImageBytes(session,epoch,objectPath,format.mime,file.size);}
        catch(error){
          // A missing object after an uncertain upload is not proof the owner lost access.
          // Preserve stable retry context; never recapture/write here.
          if(error instanceof OwnerMediaError&&error.code==='DENIED'&&rejected?.code!=='CONFLICT')
            throw mediaError('PROVIDER_UNAVAILABLE','Private image upload was not confirmed. Retry the same operation.');
          throw error;
        }
        const [stored,selected]=await Promise.all([existing.arrayBuffer(),file.arrayBuffer()]);
        this.assertOwnerImageEpoch(session,epoch);
        const a=new Uint8Array(stored),b=new Uint8Array(selected);
        if(a.length!==b.length||a.some((byte,i)=>byte!==b[i]))
          throw mediaError('CONFLICT','This upload operation already refers to different bytes. Choose a new operation.');
      }
      const receipt=await this.mediaJson('/rest/v1/rpc/register_private_project_image',session,epoch,{
        p_project_id:projectId,p_object_path:objectPath,p_mime_type:format.mime,
        p_byte_size:file.size,p_alt_text:altText.trim()
      });
      this.assertOwnerImageEpoch(session,epoch);
      if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||
        !('id' in receipt)||typeof receipt.id!=='string'||!PROJECT_ID_PATTERN.test(receipt.id)||
        !('object_path' in receipt)||receipt.object_path!==objectPath||
        !('storage_metadata_matched' in receipt)||receipt.storage_metadata_matched!==true)
        throw mediaError('INTEGRITY','Private upload registration was not confirmed; orphaned private bytes may require cleanup.');
      if(request){
        const query=new URLSearchParams({select:'id,owner_user_id,project_id,object_path,mime_type,byte_size,alt_text',
          id:'eq.'+receipt.id,owner_user_id:'eq.'+userId,project_id:'eq.'+projectId,limit:'1'});
        const rows=await this.mediaJson('/rest/v1/project_assets?'+query,session,epoch);
        this.assertOwnerImageEpoch(session,epoch);
        const row=Array.isArray(rows)&&rows.length===1?rows[0]:null;
        if(!row||row.id!==receipt.id||row.owner_user_id!==userId||row.project_id!==projectId.toLowerCase()||
          row.object_path!==objectPath||row.mime_type!==format.mime||row.byte_size!==file.size||row.alt_text!==altText.trim())
          throw mediaError('INTEGRITY','Private upload registration did not match the exact selected image.');
      }
      return {id:receipt.id,projectId:projectId.toLowerCase(),mime:format.mime,size:file.size,
        altText:altText.trim(),verifiedMetadata:true as const,publicDeliveryAllowed:false as const};
    });
  }

  private parseProjectThumbnail(raw:unknown,projectId:string,ownerId:string):
    {value:OwnerProjectThumbnail;path:string|null} {
    const row=raw as Json|null;
    if(!row||Array.isArray(row)||row.projectId!==projectId.toLowerCase()||
      row.ownerUserId!==ownerId||row.publicDeliveryAllowed!==false||
      typeof row.revision!=='number'||!Number.isSafeInteger(row.revision)||row.revision<0)
      throw mediaError('INTEGRITY','Private thumbnail response could not be verified.');
    if(row.asset===null)return {value:{projectId:projectId.toLowerCase(),revision:row.revision,asset:null,publicDeliveryAllowed:false},path:null};
    const asset=row.asset as Json|null;
    if(!asset||Array.isArray(asset)||typeof asset.id!=='string'||!PROJECT_ID_PATTERN.test(asset.id)||
      asset.projectId!==projectId.toLowerCase()||!['image/png','image/jpeg','image/webp'].includes(String(asset.mime))||
      typeof asset.size!=='number'||!Number.isSafeInteger(asset.size)||asset.size<12||asset.size>5242880||
      typeof asset.altText!=='string'||!asset.altText.trim()||asset.altText.length>500||
      typeof asset.createdAt!=='string'||!Number.isFinite(Date.parse(asset.createdAt))||
      typeof asset.objectPath!=='string')
      throw mediaError('INTEGRITY','Private thumbnail asset response could not be verified.');
    const prefix=ownerId+'/'+projectId.toLowerCase()+'/';
    const name=asset.objectPath.slice(prefix.length);
    const extension=asset.mime==='image/png'?'png':asset.mime==='image/jpeg'?'jpg':'webp';
    const suffix=name.endsWith('.img')?'img':extension;
    if(!asset.objectPath.startsWith(prefix)||!name.endsWith('.'+suffix)||
      !PROJECT_ID_PATTERN.test(name.slice(0,-suffix.length-1)))
      throw mediaError('INTEGRITY','Private thumbnail path was rejected.');
    return {value:{projectId:projectId.toLowerCase(),revision:row.revision,publicDeliveryAllowed:false,
      asset:{id:asset.id,projectId:projectId.toLowerCase(),mime:asset.mime as OwnerPrivateImageMime,
        size:asset.size,altText:asset.altText,createdAt:asset.createdAt}},path:asset.objectPath};
  }

  private async ownerThumbnailSession(projectId:string,expectedEpoch:number){
    if(!PROJECT_ID_PATTERN.test(projectId))throw mediaError('VALIDATION','Invalid private project.');
    if(this.reconcileOwnerSessionEpoch()!==expectedEpoch)
      throw mediaError('AUTH_CHANGED','Owner session changed before private media access.');
    if(!this.session)throw mediaError('DENIED','Private media access was denied.');
    let checked:Awaited<ReturnType<SupabaseBrowserAuthPort['verifyLiveSession']>>;
    try{checked=await this.verifyLiveSession();}
    catch(error){
      if(this.reconcileOwnerSessionEpoch()!==expectedEpoch)
        throw mediaError('AUTH_CHANGED','Owner session changed before private media access.');
      if(error instanceof AuthHttpError)throw mediaHttpError(error.status,null);
      throw mediaError('PROVIDER_UNAVAILABLE','Owner session could not be verified for private media.');
    }
    this.assertOwnerImageEpoch(checked.session,expectedEpoch);
    return {session:checked.session,userId:checked.user.id,epoch:checked.epoch};
  }

  private async readProjectThumbnail(session:StoredSession,userId:string,projectId:string,epoch:number){
    this.assertOwnerImageEpoch(session,epoch);
    const raw=await this.mediaJson('/rest/v1/rpc/read_private_project_thumbnail',session,epoch,{p_project_id:projectId});
    this.assertOwnerImageEpoch(session,epoch);
    return this.parseProjectThumbnail(raw,projectId,userId);
  }

  /** Exact selected metadata, independent of bounded asset-library pagination. */
  async readOwnerProjectThumbnail(projectId:string,expectedEpoch:number):Promise<OwnerMediaOutcome<OwnerProjectThumbnail>>{
    return this.mediaOutcome(expectedEpoch,async()=>{
      const {session,userId}=await this.ownerThumbnailSession(projectId,expectedEpoch);
      return (await this.readProjectThumbnail(session,userId,projectId,expectedEpoch)).value;
    });
  }

  /** Attach/detach via the project's existing revision CAS; no public mutation. */
  async setOwnerProjectThumbnail(projectId:string,baseRevision:number,assetId:string|null,operationId:string,expectedEpoch:number):
    Promise<OwnerMediaOutcome<OwnerProjectThumbnail>>{
    return this.mediaOutcome(expectedEpoch,async()=>{
      if(!Number.isSafeInteger(baseRevision)||baseRevision<0||baseRevision>=Number.MAX_SAFE_INTEGER||
        !PROJECT_ID_PATTERN.test(operationId)||(assetId!==null&&!PROJECT_ID_PATTERN.test(assetId)))
        throw mediaError('VALIDATION','Invalid private thumbnail change.');
      const {session,userId}=await this.ownerThumbnailSession(projectId,expectedEpoch);
      const raw=await this.mediaJson('/rest/v1/rpc/set_private_project_thumbnail',session,expectedEpoch,{
        p_project_id:projectId,p_base_revision:baseRevision,p_asset_id:assetId,p_operation_id:operationId
      });
      this.assertOwnerImageEpoch(session,expectedEpoch);
      const {value}=this.parseProjectThumbnail(raw,projectId,userId);
      if(value.revision!==baseRevision+1||(value.asset?.id??null)!==(assetId?.toLowerCase()??null))
        throw mediaError('INTEGRITY','Private thumbnail change was not confirmed. Reload the current project.');
      // Confirm the current durable selection, not merely an operation acknowledgement.
      const current=(await this.readProjectThumbnail(session,userId,projectId,expectedEpoch)).value;
      if(current.revision!==value.revision||(current.asset?.id??null)!==(value.asset?.id??null))
        throw mediaError('CONFLICT','The project changed after the thumbnail save. Reload the current revision.');
      return current;
    });
  }

  /** Authenticated image bytes, not a URL. The consumer owns temporary blob URL
   * lifetime. Recheck the selected asset after download to reject replacements. */
  async readOwnerProjectThumbnailImage(projectId:string,assetId:string,expectedEpoch:number):Promise<OwnerMediaOutcome<Blob>>{
    return this.mediaOutcome(expectedEpoch,async()=>{
      if(!PROJECT_ID_PATTERN.test(assetId))throw mediaError('VALIDATION','Private thumbnail is unavailable.');
      const {session,userId}=await this.ownerThumbnailSession(projectId,expectedEpoch);
      const current=await this.readProjectThumbnail(session,userId,projectId,expectedEpoch);
      if(!current.path||current.value.asset?.id!==assetId.toLowerCase())
        throw mediaError('CONFLICT','The selected thumbnail changed. Reload the project.');
      const blob=await this.readOwnerImageBytes(session,expectedEpoch,current.path,current.value.asset.mime,current.value.asset.size);
      const latest=await this.readProjectThumbnail(session,userId,projectId,expectedEpoch);
      if(latest.value.revision!==current.value.revision||latest.path!==current.path||
         latest.value.asset?.id!==current.value.asset.id||latest.value.asset.mime!==current.value.asset.mime||
         latest.value.asset.size!==current.value.asset.size)
        throw mediaError('CONFLICT','The private thumbnail changed during image readback.');
      return blob;
    });
  }

  /** Independent of thumbnail selection and the bounded gallery list. RLS is necessary
   * but not sufficient: also require the exact live project and canonical object path. */
  private async readBoundProjectAsset(session:StoredSession,ownerId:string,epoch:number,projectId:string,assetId:string){
    this.assertOwnerImageEpoch(session,epoch);
    if(!PROJECT_ID_PATTERN.test(ownerId)||!PROJECT_ID_PATTERN.test(projectId)||!PROJECT_ID_PATTERN.test(assetId))
      throw mediaError('VALIDATION','Invalid private media selection.');
    projectId=projectId.toLowerCase();assetId=assetId.toLowerCase();
    const projectQuery=new URLSearchParams({select:'id,owner_user_id',id:'eq.'+projectId,
      owner_user_id:'eq.'+ownerId,trashed_at:'is.null',limit:'2'});
    const projects=await this.mediaJson('/rest/v1/projects?'+projectQuery,session,epoch);
    if(!Array.isArray(projects)||projects.length!==1||
      projects[0]?.id!==projectId||projects[0]?.owner_user_id!==ownerId)
      throw mediaError('DENIED','Private media access was denied.');
    const query=new URLSearchParams({select:'id,project_id,owner_user_id,object_path,mime_type,byte_size,alt_text,created_at',
      id:'eq.'+assetId,project_id:'eq.'+projectId,owner_user_id:'eq.'+ownerId,limit:'2'});
    const rows=await this.mediaJson('/rest/v1/project_assets?'+query,session,epoch);
    if(!Array.isArray(rows)||rows.length!==1||rows[0]?.id!==assetId||
      rows[0]?.project_id!==projectId||rows[0]?.owner_user_id!==ownerId)
      throw mediaError('DENIED','Private media access was denied.');
    const row=rows[0] as Json;
    if(!['image/png','image/jpeg','image/webp'].includes(String(row.mime_type))||
      typeof row.byte_size!=='number'||!Number.isSafeInteger(row.byte_size)||row.byte_size<12||row.byte_size>5242880||
      typeof row.alt_text!=='string'||!row.alt_text.trim()||row.alt_text.length>500||
      typeof row.created_at!=='string'||!Number.isFinite(Date.parse(row.created_at))||
      typeof row.object_path!=='string')
      throw mediaError('INTEGRITY','Private asset is not supported for verified byte preview.');
    const mime=row.mime_type as OwnerPrivateImageMime;
    const extension=mime==='image/png'?'png':mime==='image/jpeg'?'jpg':'webp';
    const prefix=ownerId+'/'+projectId+'/';
    const name=row.object_path.slice(prefix.length);
    const suffix=name.endsWith('.img')?'img':extension;
    if(!row.object_path.startsWith(prefix)||!name.endsWith('.'+suffix)||
      !PROJECT_ID_PATTERN.test(name.slice(0,-suffix.length-1)))
      throw mediaError('DENIED','Private media access was denied.');
    const asset:OwnerProjectThumbnailAsset={id:assetId,projectId,mime,size:row.byte_size,
      altText:row.alt_text,createdAt:row.created_at};
    return {asset,path:row.object_path};
  }

  /** The same owner-authorized Storage info endpoint is used by the trusted worker.
   * Version identity is not a server SHA pin, and absence/mismatch fails closed. */
  private async readPrivateObjectIdentity(session:StoredSession,ownerId:string,epoch:number,
    binding:{asset:Pick<OwnerProjectThumbnailAsset,'mime'|'size'>;path:string}){
    const path=binding.path.split('/').map(encodeURIComponent).join('/');
    const raw=await this.mediaJson('/storage/v1/object/info/authenticated/kadmeion-private-assets/'+path,session,epoch);
    const row=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Json:null;
    const meta=row?.metadata&&typeof row.metadata==='object'?row.metadata as Json:null;
    const size=row?.size??meta?.size,mime=row?.content_type??meta?.mimetype;
    const modified=row?.last_modified??row?.updated_at;
    if(!row||typeof row.id!=='string'||!PROJECT_ID_PATTERN.test(row.id)||
      row.name!==binding.path||row.bucket_id!=='kadmeion-private-assets'||
      (row.owner_id!==undefined&&row.owner_id!==ownerId)||
      typeof row.version!=='string'||!row.version||row.version.length>128||
      typeof modified!=='string'||!Number.isFinite(Date.parse(modified))||
      !((typeof size==='number'&&Number.isSafeInteger(size))||
        (typeof size==='string'&&/^\d{1,10}$/.test(size)))||
      Number(size)!==binding.asset.size||typeof mime!=='string'||mime.toLowerCase()!==binding.asset.mime)
      throw mediaError('INTEGRITY','Private Storage object identity could not be verified.');
    return {id:row.id,version:row.version,modified};
  }

  private async confirmBoundProjectAsset(session:StoredSession,ownerId:string,epoch:number,
    before:{asset:OwnerProjectThumbnailAsset;path:string},identity:{id:string;version:string;modified:string}){
    const current=await this.readBoundProjectAsset(session,ownerId,epoch,before.asset.projectId,before.asset.id);
    const after=await this.readPrivateObjectIdentity(session,ownerId,epoch,current);
    if(current.path!==before.path||JSON.stringify(current.asset)!==JSON.stringify(before.asset)||
       after.id!==identity.id||after.version!==identity.version||after.modified!==identity.modified)
      throw mediaError('INTEGRITY','Private asset changed during verification.');
  }

  private async readProjectAssetPin(session:StoredSession,ownerId:string,epoch:number,
    binding:{asset:OwnerProjectThumbnailAsset;path:string},identity:{id:string;version:string}){
    const raw=await this.mediaJson('/rest/v1/rpc/read_owner_private_asset_pin',session,epoch,{
      p_scope:'PROJECT',p_asset_id:binding.asset.id,p_project_id:binding.asset.projectId});
    const row=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Json:null;
    if(!row||Object.keys(row).length!==11||row.scope!=='PROJECT'||
      row.assetId!==binding.asset.id||row.ownerUserId!==ownerId||row.projectId!==binding.asset.projectId||
      row.objectId!==identity.id||row.version!==identity.version||row.mimeType!==binding.asset.mime||
      row.byteSize!==binding.asset.size||row.publicDeliveryAllowed!==false||
      !((row.status==='UNPINNED'&&row.expectedSha256===null)||
        (row.status==='SERVER_HASH_PINNED'&&typeof row.expectedSha256==='string'&&/^[0-9a-f]{64}$/.test(row.expectedSha256))))
      throw mediaError('INTEGRITY','Private asset pin could not be verified.');
    return {status:row.status as 'UNPINNED'|'SERVER_HASH_PINNED',expectedSha256:row.expectedSha256 as string|null};
  }

  /** Owner-only bounded bytes, checked against the current independent server pin. */
  async readOwnerPrivateAsset(projectId:string,assetId:string,expectedEpoch:number):Promise<OwnerMediaOutcome<OwnerPrivateAssetRead>>{
    return this.mediaOutcome(expectedEpoch,async()=>{
      if(!PROJECT_ID_PATTERN.test(assetId))throw mediaError('VALIDATION','Invalid private asset.');
      const {session,userId}=await this.ownerThumbnailSession(projectId,expectedEpoch);
      const binding=await this.readBoundProjectAsset(session,userId,expectedEpoch,projectId,assetId);
      const identity=await this.readPrivateObjectIdentity(session,userId,expectedEpoch,binding);
      const pin=await this.readProjectAssetPin(session,userId,expectedEpoch,binding,identity);
      const bytes=await this.readOwnerImageBytes(session,expectedEpoch,binding.path,binding.asset.mime,binding.asset.size);
      const digest=await crypto.subtle.digest('SHA-256',await bytes.arrayBuffer());
      this.assertOwnerImageEpoch(session,expectedEpoch);
      await this.confirmBoundProjectAsset(session,userId,expectedEpoch,binding,identity);
      const afterPin=await this.readProjectAssetPin(session,userId,expectedEpoch,binding,identity);
      const computedSha256=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
      if(pin.status!==afterPin.status||pin.expectedSha256!==afterPin.expectedSha256||
        (pin.status==='SERVER_HASH_PINNED'&&computedSha256!==pin.expectedSha256))
        throw mediaError('INTEGRITY','Private asset pin or bytes changed during verification.');
      return {asset:binding.asset,bytes,integrity:{status:'OWNER_BYTES_VERIFIED',computedSha256},
        serverAttestation:pin.status==='SERVER_HASH_PINNED'?'SERVER_HASH_PINNED':'NOT_VERIFIED',publicDeliveryAllowed:false};
    });
  }

  /** Separate explicit request using the existing default-disabled Edge contract.
   * Its receipt does not contain a digest; never promote a preview hash to a pin. */
  async requestOwnerPrivateAssetAttestation(projectId:string,assetId:string,expectedEpoch:number):
    Promise<OwnerMediaOutcome<OwnerPrivateAssetAttestationReceipt>>{
    return this.mediaOutcome(expectedEpoch,async()=>{
      if(!PROJECT_ID_PATTERN.test(assetId))throw mediaError('VALIDATION','Invalid private asset.');
      const {session,userId}=await this.ownerThumbnailSession(projectId,expectedEpoch);
      const binding=await this.readBoundProjectAsset(session,userId,expectedEpoch,projectId,assetId);
      const identity=await this.readPrivateObjectIdentity(session,userId,expectedEpoch,binding);
      const raw=await this.mediaJson('/functions/v1/complete-private-asset',session,expectedEpoch,{assetId:binding.asset.id},true);
      const row=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Json:null;
      if(!row||row.assetId!==binding.asset.id||row.status!=='WRITE_ONCE_ATTESTED'||
        row.publicPublishingAllowed!==false||row.accountDeletionAllowed!==false)
        throw mediaError('INTEGRITY','Private asset attestation receipt could not be verified.');
      await this.confirmBoundProjectAsset(session,userId,expectedEpoch,binding,identity);
      return {assetId:binding.asset.id,status:'WRITE_ONCE_ATTESTED',publicPublishingAllowed:false,accountDeletionAllowed:false};
    });
  }


  /** Profile assets are separately registered, and never use dummy project IDs. */
  private async ownerAvatarSession(expectedEpoch:number){
    if(this.reconcileOwnerSessionEpoch()!==expectedEpoch)
      throw mediaError('AUTH_CHANGED','Owner session changed before private avatar access.');
    if(!this.session)throw mediaError('DENIED','Private avatar access was denied.');
    let checked:Awaited<ReturnType<SupabaseBrowserAuthPort['verifyLiveSession']>>;
    try{checked=await this.verifyLiveSession();}
    catch(error){
      if(this.reconcileOwnerSessionEpoch()!==expectedEpoch)
        throw mediaError('AUTH_CHANGED','Owner session changed before private avatar access.');
      if(error instanceof AuthHttpError)throw mediaHttpError(error.status,null);
      throw mediaError('PROVIDER_UNAVAILABLE','Owner session could not be verified for private avatar.');
    }
    this.assertOwnerImageEpoch(checked.session,expectedEpoch);
    return {session:checked.session,userId:checked.user.id,epoch:checked.epoch};
  }

  private canonicalProfileAssetPath(owner:string,path:unknown):path is string{
    if(!PROJECT_ID_PATTERN.test(owner)||typeof path!=='string')return false;
    const prefix=owner+'/profile/';
    const file=path.slice(prefix.length);
    return path.startsWith(prefix)&&file.endsWith('.img')&&
      PROJECT_ID_PATTERN.test(file.slice(0,-4))&&file===file.toLowerCase();
  }

  private parseOwnerAvatar(raw:unknown,ownerId:string):{value:OwnerProfileAvatar;path:string|null}{
    const row=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Json:null;
    if(!row||Object.keys(row).length!==4||row.ownerUserId!==ownerId||
      typeof row.revision!=='number'||!Number.isSafeInteger(row.revision)||row.revision<0||
      row.publicDeliveryAllowed!==false)
      throw mediaError('INTEGRITY','Private avatar selection could not be verified.');
    if(row.asset===null)return {value:{revision:row.revision,asset:null,publicDeliveryAllowed:false},path:null};
    const a=row.asset&&typeof row.asset==='object'&&!Array.isArray(row.asset)?row.asset as Json:null;
    if(!a||Object.keys(a).length!==7||a.scope!=='PROFILE'||
      typeof a.id!=='string'||!PROJECT_ID_PATTERN.test(a.id)||a.id!==a.id.toLowerCase()||
      typeof a.mime!=='string'||!['image/png','image/jpeg','image/webp'].includes(a.mime)||
      typeof a.size!=='number'||!Number.isSafeInteger(a.size)||a.size<12||a.size>5242880||
      typeof a.altText!=='string'||a.altText!==a.altText.trim()||!a.altText||a.altText.length>500||
      typeof a.createdAt!=='string'||!Number.isFinite(Date.parse(a.createdAt))||
      !this.canonicalProfileAssetPath(ownerId,a.objectPath))
      throw mediaError('INTEGRITY','Private avatar metadata could not be verified.');
    const asset:OwnerProfileAvatarAsset={id:a.id,scope:'PROFILE',mime:a.mime as OwnerPrivateImageMime,
      size:a.size,altText:a.altText,createdAt:a.createdAt};
    return {value:{revision:row.revision,asset,publicDeliveryAllowed:false},path:a.objectPath};
  }
  private async readOwnerAvatarBound(session:StoredSession,ownerId:string,epoch:number){
    const raw=await this.mediaJson('/rest/v1/rpc/read_private_profile_avatar',session,epoch,{});
    return this.parseOwnerAvatar(raw,ownerId);
  }

  private async readProfileAssetPin(session:StoredSession,ownerId:string,epoch:number,
    asset:{id:string;mime:OwnerPrivateImageMime;size:number},identity:{id:string;version:string}){
    const raw=await this.mediaJson('/rest/v1/rpc/read_owner_private_asset_pin',session,epoch,{
      p_scope:'PROFILE',p_asset_id:asset.id,p_project_id:null});
    const row=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Json:null;
    if(!row||Object.keys(row).length!==11||row.scope!=='PROFILE'||row.projectId!==null||
      row.assetId!==asset.id||row.ownerUserId!==ownerId||row.objectId!==identity.id||
      row.version!==identity.version||row.mimeType!==asset.mime||row.byteSize!==asset.size||
      row.publicDeliveryAllowed!==false||
      !((row.status==='UNPINNED'&&row.expectedSha256===null)||
        (row.status==='SERVER_HASH_PINNED'&&typeof row.expectedSha256==='string'&&/^[0-9a-f]{64}$/.test(row.expectedSha256))))
      throw mediaError('INTEGRITY','Private profile asset pin could not be verified.');
    return {status:row.status as 'UNPINNED'|'SERVER_HASH_PINNED',expectedSha256:row.expectedSha256 as string|null};
  }

  async readOwnerProfileAvatar(expectedEpoch:number):Promise<OwnerMediaOutcome<OwnerProfileAvatar>>{
    return this.mediaOutcome(expectedEpoch,async()=>{
      const {session,userId}=await this.ownerAvatarSession(expectedEpoch);
      return (await this.readOwnerAvatarBound(session,userId,expectedEpoch)).value;
    });
  }

  /** Upload is a two-phase owner reservation and immutable registration.
   * An uncertain upload or registered replay succeeds only on exact byte readback.
   * This does not attach, publish or delete the asset. */
  async uploadOwnerProfileAvatar(file:File,altText:string,context:OwnerPrivateImageUploadContext):
    Promise<OwnerMediaOutcome<OwnerProfileAvatarUpload>>{
    const operationId=context?.operationId,expectedEpoch=context?.expectedEpoch;
    if(!Number.isSafeInteger(expectedEpoch)||typeof operationId!=='string')
      return {data:null as unknown as OwnerProfileAvatarUpload,error:{code:'VALIDATION',message:'A stable avatar upload operation is required.'}};
    return this.mediaOutcome(expectedEpoch,async()=>{
      if(!PROJECT_ID_PATTERN.test(operationId)||!(file instanceof File)||typeof altText!=='string'||
        altText.trim().length<1||altText.length>500)
        throw mediaError('VALIDATION','Choose a private image and descriptive alt text.');
      const description=altText.trim(),operation=operationId.toLowerCase();
      const format=await this.validateOwnerRaster(file);
      const {session,userId}=await this.ownerAvatarSession(expectedEpoch);
      const path=userId+'/profile/'+operation+'.img';
      const raw=await this.mediaJson('/rest/v1/rpc/reserve_private_profile_asset',session,expectedEpoch,{
        p_operation_id:operation,p_mime_type:format.mime,p_byte_size:file.size,p_alt_text:description});
      const reserve=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Json:null;
      if(!reserve||Object.keys(reserve).length!==8||reserve.ownerUserId!==userId||reserve.scope!=='PROFILE'||
        typeof reserve.assetId!=='string'||!PROJECT_ID_PATTERN.test(reserve.assetId)||reserve.assetId!==reserve.assetId.toLowerCase()||
        reserve.objectPath!==path||reserve.mime!==format.mime||reserve.size!==file.size||
        reserve.altText!==description||(reserve.state!=='PENDING_UPLOAD'&&reserve.state!=='REGISTERED'))
        throw mediaError('INTEGRITY','Private avatar reservation could not be verified.');
      const assetId=reserve.assetId;
      let accepted=reserve.state==='REGISTERED',ambiguous=false;
      if(reserve.state==='PENDING_UPLOAD'){
        const uploadUrl=this.origin+'/storage/v1/object/kadmeion-private-assets/'+path;
        let response:Response|null=null;
        try{
          response=await this.fetcher(uploadUrl,{
            method:'POST',headers:{apikey:this.publishableKey,Authorization:'Bearer '+session.access_token,
              'Content-Type':format.mime,'x-upsert':'false','Cache-Control':'no-store'},
            body:file,credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(60_000)
          });
        }catch{/* ambiguous, recover by exact bounded bytes */}
        let rejection:OwnerMediaError|null=null;
        try{
          this.assertOwnerImageEpoch(session,expectedEpoch);
          if(response&&(response.redirected||(response.url&&response.url!==uploadUrl)))
            throw mediaError('INTEGRITY','Private avatar upload response origin could not be verified.');
          accepted=response?.ok===true;
          if(response&&!accepted)rejection=await this.mediaResponseError(response,session,expectedEpoch,false,true);
          ambiguous=!response||rejection?.code==='CONFLICT'||
            (rejection?.code==='PROVIDER_UNAVAILABLE'&&(response.status===400||response.status>=500));
          if(!accepted&&!ambiguous)throw rejection??mediaError('PROVIDER_UNAVAILABLE','Private avatar upload was not confirmed.');
        }finally{void response?.body?.cancel().catch(()=>{});}
      }
      // Never treat an existing path or metadata-only receipt as byte equivalence.
      const binding={asset:{id:assetId,mime:format.mime,size:file.size},path};
      let before:Awaited<ReturnType<SupabaseBrowserAuthPort['readPrivateObjectIdentity']>>,stored:Blob;
      try{
        before=await this.readPrivateObjectIdentity(session,userId,expectedEpoch,binding);
        stored=await this.readOwnerImageBytes(session,expectedEpoch,path,format.mime,file.size);
      }catch(error){
        if(ambiguous&&!accepted&&error instanceof OwnerMediaError&&error.code==='DENIED')
          throw mediaError('PROVIDER_UNAVAILABLE','Private avatar upload was not confirmed. Retry the same operation.');
        throw error;
      }
      const [actual,selected]=await Promise.all([stored.arrayBuffer(),file.arrayBuffer()]);
      this.assertOwnerImageEpoch(session,expectedEpoch);
      const a=new Uint8Array(actual),b=new Uint8Array(selected);
      if(a.length!==b.length||a.some((v,i)=>v!==b[i]))
        throw mediaError('CONFLICT','This avatar operation refers to different bytes. Choose a new operation.');
      const registered=await this.mediaJson('/rest/v1/rpc/register_private_profile_asset',session,expectedEpoch,{p_asset_id:assetId});
      const row=registered&&typeof registered==='object'&&!Array.isArray(registered)?registered as Json:null;
      if(!row||Object.keys(row).length!==11||row.assetId!==assetId||row.ownerUserId!==userId||
        row.scope!=='PROFILE'||row.state!=='REGISTERED'||row.objectPath!==path||row.mime!==format.mime||
        row.size!==file.size||row.altText!==description||row.publicDeliveryAllowed!==false||
        typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt))||
        typeof row.registeredAt!=='string'||!Number.isFinite(Date.parse(row.registeredAt)))
        throw mediaError('INTEGRITY','Private avatar registration could not be verified.');
      const after=await this.readPrivateObjectIdentity(session,userId,expectedEpoch,binding);
      if(after.id!==before.id||after.version!==before.version||after.modified!==before.modified)
        throw mediaError('INTEGRITY','Private avatar identity changed before registration.');
      const pin=await this.readProfileAssetPin(session,userId,expectedEpoch,binding.asset,after);
      if(pin.status==='SERVER_HASH_PINNED'){
        const digest=await crypto.subtle.digest('SHA-256',actual);
        if(Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')!==pin.expectedSha256)
          throw mediaError('INTEGRITY','Private avatar bytes do not match the trusted pin.');
      }
      this.assertOwnerImageEpoch(session,expectedEpoch);
      return {id:assetId,scope:'PROFILE',mime:format.mime,size:file.size,altText:description,
        verifiedMetadata:true,publicDeliveryAllowed:false};
    });
  }

  async setOwnerProfileAvatar(baseRevision:number,assetId:string|null,operationId:string,expectedEpoch:number):
    Promise<OwnerMediaOutcome<OwnerProfileAvatar>>{
    return this.mediaOutcome(expectedEpoch,async()=>{
      if(!Number.isSafeInteger(baseRevision)||baseRevision<0||!PROJECT_ID_PATTERN.test(operationId)||
        (assetId!==null&&!PROJECT_ID_PATTERN.test(assetId)))
        throw mediaError('VALIDATION','Invalid private avatar change.');
      const {session,userId}=await this.ownerAvatarSession(expectedEpoch);
      const desired=assetId?.toLowerCase()??null;
      const raw=await this.mediaJson('/rest/v1/rpc/set_private_profile_avatar',session,expectedEpoch,{
        p_base_revision:baseRevision,p_asset_id:desired,p_operation_id:operationId.toLowerCase()});
      const receipt=this.parseOwnerAvatar(raw,userId);
      const acceptedRevision=receipt.value.revision===baseRevision||
        (baseRevision<Number.MAX_SAFE_INTEGER&&receipt.value.revision===baseRevision+1);
      if(!acceptedRevision||(receipt.value.asset?.id??null)!==desired)
        throw mediaError('INTEGRITY','Private avatar change was not confirmed.');
      const current=await this.readOwnerAvatarBound(session,userId,expectedEpoch);
      if(current.path!==receipt.path||JSON.stringify(current.value)!==JSON.stringify(receipt.value))
        throw mediaError('CONFLICT','Private avatar changed after the save. Reload the current selection.');
      return current.value;
    });
  }

  async readOwnerProfileAvatarImage(assetId:string,expectedEpoch:number):Promise<OwnerMediaOutcome<Blob>>{
    return this.mediaOutcome(expectedEpoch,async()=>{
      if(!PROJECT_ID_PATTERN.test(assetId))throw mediaError('VALIDATION','Private avatar is unavailable.');
      const {session,userId}=await this.ownerAvatarSession(expectedEpoch);
      const before=await this.readOwnerAvatarBound(session,userId,expectedEpoch);
      if(!before.path||before.value.asset?.id!==assetId.toLowerCase())
        throw mediaError('CONFLICT','The selected avatar changed. Reload the private profile.');
      const binding={asset:before.value.asset,path:before.path};
      const object=await this.readPrivateObjectIdentity(session,userId,expectedEpoch,binding);
      const pin=await this.readProfileAssetPin(session,userId,expectedEpoch,binding.asset,object);
      const bytes=await this.readOwnerImageBytes(session,expectedEpoch,binding.path,binding.asset.mime,binding.asset.size);
      const digest=await crypto.subtle.digest('SHA-256',await bytes.arrayBuffer());
      const latest=await this.readOwnerAvatarBound(session,userId,expectedEpoch);
      if(latest.path!==before.path||JSON.stringify(latest.value)!==JSON.stringify(before.value))
        throw mediaError('CONFLICT','Private avatar changed during verified image readback.');
      const newObject=await this.readPrivateObjectIdentity(session,userId,expectedEpoch,binding);
      const newPin=await this.readProfileAssetPin(session,userId,expectedEpoch,binding.asset,newObject);
      if(JSON.stringify(newObject)!==JSON.stringify(object)||JSON.stringify(newPin)!==JSON.stringify(pin)||
        (pin.status==='SERVER_HASH_PINNED'&&
          Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')!==pin.expectedSha256))
        throw mediaError('INTEGRITY','Private avatar identity, digest or pin changed.');
      this.assertOwnerImageEpoch(session,expectedEpoch);
      return bytes;
    });
  }

  /** A delegated service is scoped to its creating verified owner epoch.
   * On refresh or any observed transition the shell creates a new service.
   * A stale service must never acquire a bearer merely because A returned. */
  private ownerEpochToken(userId:string,epoch:number):()=>Promise<string|null> {
    return async()=>{
      try{
        if(this.reconcileOwnerSessionEpoch()!==epoch)return null;
        const current=await this.ownerSession();
        return this.reconcileOwnerSessionEpoch()===epoch && current.userId===userId &&
          this.isCurrentSession(current.session) ? current.session.access_token : null;
      }catch{return null;}
    };
  }

  /** Owner reads rely on RLS. Operator RPCs independently check the role. */
  async privateModeration() {
    return this.outcome(async () => {
      const {userId,epoch} = await this.ownerSession();
      const {SupabasePrivateModerationService} = await import('../../../packages/contracts/src/private-moderation-service.ts');
      const token=this.ownerEpochToken(userId,epoch);
      return new SupabasePrivateModerationService(this.origin, this.publishableKey, token, this.fetcher);
    });
  }

  /** Refresh-only, owner-bound view of GoTrue identities. Never publishes
   * identity_data, email addresses or provider subject IDs. A missing
   * identities property is not evidence of zero linked methods. */
  async readOwnerLinkedMethods():Promise<AuthOutcome<OwnerLinkedMethods>>{
    return this.outcome(async()=>{
      const {session,userId,epoch}=await this.ownerSession();
      const current=()=>this.reconcileOwnerSessionEpoch()===epoch &&
        this.isCurrentSession(session) && session.user.id===userId;
      if(!current())throw new Error('Owner session changed before linked-method read.');
      const url=this.origin+'/auth/v1/user';
      let response:Response;
      try{
        response=await this.fetcher(url,{
          method:'GET',headers:{apikey:this.publishableKey,Authorization:'Bearer '+session.access_token,
            Accept:'application/json'},
          credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10_000)
        });
      }catch{throw new Error('Linked authentication methods are temporarily unavailable.');}
      try{
        if(!current()||response.redirected||(response.url&&response.url!==url)||
          !response.ok||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')||
          !response.body)throw new Error('Linked authentication methods could not be verified.');
        const length=response.headers.get('content-length');
        if(length!==null&&(!/^\d+$/.test(length)||Number(length)>32768))
          throw new Error('Linked authentication response exceeded its verified bounds.');
        const reader=response.body.getReader();
        const chunks:Uint8Array[]=[];let size=0;let empty=0;let count=0;
        try{
          for(;;){
            const part=await reader.read();
            if(!current())throw new Error('Owner session changed during linked-method read.');
            if(part.done)break;
            if(++count>128||!(part.value instanceof Uint8Array)||
              (size+=part.value.byteLength)>32768)throw new Error('Linked authentication response exceeded its verified bounds.');
            if(part.value.byteLength===0){if(++empty>8)throw new Error('Invalid authentication response stream.');continue;}
            empty=0;chunks.push(part.value);
          }
        }finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
        if(length!==null&&size!==Number(length))throw new Error('Linked authentication response length mismatch.');
        const body=new Uint8Array(size);let offset=0;
        for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
        let raw:unknown;
        try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}
        catch{throw new Error('Invalid linked authentication response.');}
        const row=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Json:null;
        if(!row||row.id!==userId||!Array.isArray(row.identities)||row.identities.length>16)
          throw new Error('Linked authentication methods could not be verified.');
        const identities:OwnerLinkedIdentity[]=[];const seen=new Set<string>();
        const date=(value:unknown):string|null=>{
          if(value===null||value===undefined)return null;
          if(typeof value!=='string'||value.length>40||!Number.isFinite(Date.parse(value)))
            throw new Error('Invalid authentication identity timestamp.');
          return value;
        };
        for(const value of row.identities){
          const identity=value&&typeof value==='object'&&!Array.isArray(value)?value as Json:null;
          const id=identity?.id;
          const provider=identity?.provider;
          if(!identity||(identity.user_id!==undefined&&identity.user_id!==userId)||
            typeof id!=='string'||!PROJECT_ID_PATTERN.test(id)||id!==id.toLowerCase()||
            seen.has(id)||typeof provider!=='string'||!/[a-z]/.test(provider)||
            !/^[a-z][a-z0-9_-]{0,31}$/.test(provider))
            throw new Error('Linked authentication identity was invalid.');
          seen.add(id);
          identities.push({identityId:id,provider,createdAt:date(identity.created_at),
            lastSignInAt:date(identity.last_sign_in_at)});
        }
        if(!current())throw new Error('Owner session changed during linked-method read.');
        return {ownerUserId:userId,source:'GOTRUE_LIVE_USER' as const,identities,
          passwordMethodConfirmed:false as const,publicVerificationAllowed:false as const};
      }finally{void response.body?.cancel().catch(()=>{});}
    });
  }

  /** Owner-scoped manual Goals + LINK_ONLY profiles. No external provider sync or analytics. */
  async ownerGrowth() {
    return this.outcome(async () => {
      const {userId,epoch} = await this.ownerSession();
      const token=this.ownerEpochToken(userId,epoch);
      const [goalModule,linkModule] = await Promise.all([
        import('../../../packages/contracts/src/private-goals-service.ts'),
        import('../../../packages/contracts/src/private-platform-links-service.ts')
      ]);
      return {
        goals: new goalModule.SupabasePrivateGoalsService(this.origin,this.publishableKey,token,this.fetcher,userId),
        links: new linkModule.SupabasePrivatePlatformLinksService(this.origin,this.publishableKey,userId,token,this.fetcher)
      };
    });
  }

  /** Private owner service factory only; no collector activation or schema assumption. */
  async ownerAnalytics(){
    return this.outcome(async()=>{
      const {session,userId,epoch}=await this.ownerSession();
      const isCurrentOwner=()=>this.reconcileOwnerSessionEpoch()===epoch &&
        this.isCurrentSession(session) && session.user.id===userId;
      const token=this.ownerEpochToken(userId,epoch);
      const {SupabasePrivateAnalyticsService}=await import('../../../packages/contracts/src/private-analytics-service.ts');
      if(!isCurrentOwner())throw new Error('Owner session changed while preparing private analytics.');
      const service=new SupabasePrivateAnalyticsService(this.origin,this.publishableKey,userId,token,isCurrentOwner,this.fetcher);
      if(!isCurrentOwner())throw new Error('Owner session changed while preparing private analytics.');
      return {service,ownerId:userId,adapterEpoch:epoch,isCurrentOwner};
    });
  }

  async ownerSettings() {
    return this.outcome(async () => {
      const {session,userId,epoch} = await this.ownerSession();
      const isCurrentOwner=()=>this.reconcileOwnerSessionEpoch()===epoch &&
        this.isCurrentSession(session) && session.user.id===userId;
      const token=this.ownerEpochToken(userId,epoch);
      const [identity, notifications, trash, account, data] = await Promise.all([
        import('../../../packages/contracts/src/private-identity-service.ts'),
        import('../../../packages/contracts/src/private-notifications-service.ts'),
        import('../../../packages/contracts/src/private-trash-service.ts'),
        import('../../../packages/contracts/src/private-account-erasure-service.ts'),
        import('../../../packages/storage-adapters/src/private-account-data-export.ts')
      ]);
      if(!isCurrentOwner())throw new Error('Owner session changed while preparing private settings.');
      return {
        identity: new identity.SupabasePrivateIdentityService(this.origin, this.publishableKey, token, this.fetcher, userId, isCurrentOwner),
        notifications: new notifications.SupabasePrivateNotificationsService(this.origin, this.publishableKey, userId, token, this.fetcher, isCurrentOwner),
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
  async listOwnerProjects(expectedEpoch = this.getOwnerSessionEpoch()):Promise<AuthOutcome<OwnerProject[]>> {
    return this.outcome(async()=>{
      if(this.getOwnerSessionEpoch()!==expectedEpoch)throw new Error('Owner session changed before project loading.');
      const {session,userId,epoch}=await this.ownerSession();
      if(epoch!==expectedEpoch||this.getOwnerSessionEpoch()!==expectedEpoch||!this.isCurrentSession(session))
        throw new Error('Owner session changed before project loading.');
      const result=await this.ownerRest('projects?select='+OWNER_PROJECT_FIELDS+
        '&owner_user_id=eq.'+encodeURIComponent(userId)+
        '&trashed_at=is.null&order=updated_at.desc&limit=100',session.access_token);
      if (this.getOwnerSessionEpoch()!==expectedEpoch||!this.isCurrentSession(session))throw new Error('Owner session changed during project loading.');
      if (!Array.isArray(result)||result.length>100)throw new Error('Invalid owner project list response.');
      const items=result.map(row=>this.parsePrivateProject(row,userId));
      if (new Set(items.map(item=>item.id)).size!==items.length)
        throw new Error('Duplicate private projects were rejected.');
      return items;
    });
  }

  async readOwnerProject(projectId: string, expectedEpoch = this.getOwnerSessionEpoch()): Promise<AuthOutcome<OwnerProject>> {
    return this.outcome(async () => {
      if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error('Project is unavailable.');
      if (this.getOwnerSessionEpoch() !== expectedEpoch) throw new Error('Owner session changed before the private request.');
      const {session, userId, epoch} = await this.ownerSession();
      if (epoch !== expectedEpoch || this.getOwnerSessionEpoch() !== expectedEpoch || !this.isCurrentSession(session)) throw new Error('Owner session changed before the private request.');
      const rows = await this.ownerRest('projects?select=' + OWNER_PROJECT_FIELDS +
        '&id=eq.' + projectId + '&owner_user_id=eq.' + encodeURIComponent(userId) +
        '&trashed_at=is.null&limit=1', session.access_token);
      if (this.getOwnerSessionEpoch() !== expectedEpoch || !this.isCurrentSession(session) || !Array.isArray(rows) || rows.length !== 1)
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

  async saveOwnerProject(projectId: string, revision: number, input: PrivateProjectDraft, expectedEpoch = this.getOwnerSessionEpoch()):
    Promise<AuthOutcome<Pick<OwnerProject, 'id' | 'revision' | 'updatedAt'> & PrivateProjectDraft>> {
    return this.outcome(async () => {
      if (!PROJECT_ID_PATTERN.test(projectId) || !Number.isSafeInteger(revision) || revision < 0)
        throw new Error('Invalid project revision.');
      const draft = normalizeProjectDraft(input);
      if (this.getOwnerSessionEpoch() !== expectedEpoch) throw new Error('Owner session changed before the private request.');
      const {session, epoch} = await this.ownerSession();
      if (epoch !== expectedEpoch || this.getOwnerSessionEpoch() !== expectedEpoch || !this.isCurrentSession(session)) throw new Error('Owner session changed before the private request.');
      const receipt = await this.ownerRest('rpc/update_private_project', session.access_token, 'POST', {
        p_project_id: projectId, p_base_revision: revision, p_title: draft.title,
        p_summary: draft.summary, p_description: draft.description,
        p_repository_url: draft.repositoryUrl, p_live_url: draft.liveUrl
      });
      if (this.getOwnerSessionEpoch() !== expectedEpoch || !this.isCurrentSession(session) || !receipt || typeof receipt !== 'object' ||
          !('id' in receipt) || receipt.id !== projectId.toLowerCase() ||
          !('revision' in receipt) || !Number.isSafeInteger(receipt.revision) || receipt.revision !== revision + 1 ||
          !('updated_at' in receipt) || typeof receipt.updated_at !== 'string' ||
          !Number.isFinite(Date.parse(receipt.updated_at)))
        throw new Error('The server did not confirm the new project revision.');
      return {...draft, id: projectId, revision: receipt.revision, updatedAt: receipt.updated_at};
    });
  }

  /** Creates an owner-private draft, never a shared or published project. */
  async createPrivateProject(input:NewPrivateProject, expectedEpoch = this.getOwnerSessionEpoch()):Promise<AuthOutcome<OwnerProject>> {
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
      if(this.getOwnerSessionEpoch()!==expectedEpoch)throw new Error('Owner session changed before project creation.');
      const {session,userId,epoch}=await this.ownerSession();
      if(epoch!==expectedEpoch||this.getOwnerSessionEpoch()!==expectedEpoch||!this.isCurrentSession(session))
        throw new Error('Owner session changed before project creation.');
      const data=await this.ownerRest('projects?select='+OWNER_PROJECT_FIELDS,session.access_token,'POST',{
        owner_user_id:userId,title,slug,summary,description:'',
        repository_url:repositoryUrl,live_url:liveUrl
      },true);
      if (this.getOwnerSessionEpoch()!==expectedEpoch||!this.isCurrentSession(session))throw new Error('Owner session changed during project creation.');
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
