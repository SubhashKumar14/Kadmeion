import { ContractError, normalizeHandle } from './project.ts';

export type AuthFailure = { message: string; providerCode?: 'email_not_confirmed'; status?: number | undefined };
export type AuthOutcome<T> = { data: T; error: AuthFailure | null };
export type AuthUser = { id: string; email?: string; email_confirmed_at?: string | null };
export type AuthSession = { access_token: string; user: AuthUser };
export type OAuthProvider = 'google';
export type RegistrationInput = {email:string;password:string;displayName:string;handle:string};
export type VerifiedRegistration =
  | {status:'confirmation_required';handleCandidate:string}
  | {status:'signed_in';handleCandidate:string;user:AuthUser};

/** Narrow Supabase Auth interface; inject the real @supabase/supabase-js auth client. */
export interface AuthPort {
  signUp(options: { email: string; password: string; options: { data: Record<string, string> } }):
    Promise<AuthOutcome<{ user: AuthUser | null; session: AuthSession | null }>>;
  signInWithPassword(options: { email: string; password: string }):
    Promise<AuthOutcome<{ user: AuthUser | null; session: AuthSession | null }>>;
  getUser(): Promise<AuthOutcome<{ user: AuthUser | null }>>;
  /** Supabase signup resend; optional for legacy AuthPort implementations. */
  resend?(options: {type:'signup';email:string;options:{emailRedirectTo:string}}):Promise<AuthOutcome<unknown>>;
  resetPasswordForEmail(email: string, options: { redirectTo: string }): Promise<AuthOutcome<unknown>>;
  updateUser(changes: { password: string }): Promise<AuthOutcome<{ user: AuthUser | null }>>;
  // Supabase Auth signOut returns {error} WITHOUT a data envelope.
  signOut(options?: { scope: 'local' | 'global' | 'others' }):
    Promise<{ error: AuthFailure | null }>;
  signInWithOAuth(options: { provider: OAuthProvider; options: { redirectTo: string } }): Promise<AuthOutcome<{ url: string | null }>>;
  exchangeCodeForSession(code: string): Promise<AuthOutcome<{ user: AuthUser | null }>>;
}

export class AuthFlowError extends Error {
  readonly code: 'VALIDATION' | 'PROVIDER_UNAVAILABLE' | 'AUTH_FAILED' | 'AUTH_EXPIRED' | 'EMAIL_CONFIRMATION_REQUIRED';
  constructor(code: 'VALIDATION' | 'PROVIDER_UNAVAILABLE' | 'AUTH_FAILED' | 'AUTH_EXPIRED' | 'EMAIL_CONFIRMATION_REQUIRED', message: string) {
    super(message); this.name = 'AuthFlowError'; this.code=code;
  }
}

/**
 * Normalize thrown Supabase/network failures. Provider URLs, raw error
 * objects and credentials must never escape into auth UI error messages.
 * Errors returned inside AuthOutcome are handled separately by each flow.
 */
async function authProviderCall<T>(fn:()=>Promise<T>,message:string):Promise<T>{
  try{return await fn();}
  catch{throw new AuthFlowError('PROVIDER_UNAVAILABLE',message);}
}

export function validateAuthEmail(value: unknown): string {
  if (typeof value !== 'string') throw new AuthFlowError('VALIDATION', 'Email is required.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new AuthFlowError('VALIDATION', 'Enter a valid email address.');
  return email;
}

export function safeAfterAuthPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') ||
      /[\\\u0000-\u001f]/.test(value) || /%2f|%5c/i.test(value)) return '/workspace';
  try {
    const parsed = new URL(value, 'https://kadmeion.invalid');
    if (parsed.origin !== 'https://kadmeion.invalid') return '/workspace';
    if (!['/workspace', '/projects', '/settings', '/portfolios'].some(
      base => parsed.pathname === base || parsed.pathname.startsWith(base + '/')
    )) return '/workspace';
    return parsed.pathname + parsed.search;
  } catch { return '/workspace'; }
}

function passwordForCreation(password: string): void {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128)
    throw new AuthFlowError('VALIDATION', 'Use an 8–128 character password.');
}

export class AuthService {
  private readonly auth: AuthPort;
  private readonly config: { siteOrigin:string; emailDeliveryVerified:boolean; googleOAuthConfigured:boolean };
  constructor(auth: AuthPort, config: {siteOrigin:string;emailDeliveryVerified:boolean;googleOAuthConfigured:boolean}) {
    let url:URL;
    try{url=new URL(config.siteOrigin);}
    catch{throw new AuthFlowError('VALIDATION','Invalid application origin.');}
    const local=url.protocol==='http:'&&
      ['localhost','127.0.0.1'].includes(url.hostname);
    if(typeof config.siteOrigin!=='string'||
       config.siteOrigin.trim()!==config.siteOrigin||
       /[\s\u0000-\u001f\u007f]/.test(config.siteOrigin)||
       (url.protocol!=='https:'&&!local)||url.username||url.password||
       url.pathname!=='/'||url.search||url.hash)
      throw new AuthFlowError('VALIDATION','Invalid application origin.');
    this.auth=auth;this.config={...config,siteOrigin:url.origin};
  }

  /** Keep the historical confirmation receipt for existing consumers. The
   * interactive signup flow uses the verified identity variant below. */
  async register(input:RegistrationInput){
    const registered=await this.registerWithIdentity(input);
    return {status:registered.status,handleCandidate:registered.handleCandidate} as const;
  }

  async registerWithIdentity(input:RegistrationInput):Promise<VerifiedRegistration> {
    const email = validateAuthEmail(input.email);
    passwordForCreation(input.password);
    const handleCandidate = normalizeHandle(input.handle);
    const displayName = input.displayName?.trim();
    if (!displayName || displayName.length > 80) throw new AuthFlowError('VALIDATION', 'Enter a display name.');
    const outcome = await authProviderCall(()=>this.auth.signUp({
      email, password: input.password,
      options: { data: { display_name: displayName, handle_candidate: handleCandidate } }
    }), 'Registration is temporarily unavailable.');
    const data=outcome?.data;
    if (outcome?.error !== null || typeof data?.user?.id !== 'string' || !data.user.id.trim())
      throw new AuthFlowError('AUTH_FAILED', 'Registration could not be completed.');
    // A non-null signup session must belong to the newly created identity.
    // Password-confirmation-required registrations deliberately have no session.
    if (data.session !== null) {
      if (typeof data.session?.access_token !== 'string' || !data.session.access_token.trim() || data.session.user?.id !== data.user.id)
        throw new AuthFlowError('AUTH_EXPIRED', 'Registration session could not be verified.');
      const current = await authProviderCall(
        ()=>this.auth.getUser(), 'Unable to verify the registration session.');
      if (current?.error !== null || current.data?.user?.id !== data.user.id)
        throw new AuthFlowError('AUTH_EXPIRED', 'Registration session could not be verified.');
      // Expose only the live verified owner, never the access token or an
      // identity from a subsequent session. The UI binds its profile read to it.
      return {status:'signed_in',handleCandidate,user:current.data.user};
    }
    // Confirmation-required receipts do not disclose a claimed user ID.
    // Handle candidate is NOT reserved until authenticated ownership/uniqueness update.
    return {status:'confirmation_required',handleCandidate};
  }

  async login(emailInput: unknown, password: string): Promise<AuthUser> {
    const email = validateAuthEmail(emailInput);
    if (!password) throw new AuthFlowError('VALIDATION', 'Password is required.');
    const attempt = await authProviderCall(
      ()=>this.auth.signInWithPassword({ email, password }),
      'Sign-in service is temporarily unavailable.');
    if (attempt?.error?.providerCode === 'email_not_confirmed')
      throw new AuthFlowError('EMAIL_CONFIRMATION_REQUIRED', 'Open the confirmation link in your email, then sign in. Check your spam folder or request another link below.');
    if (attempt?.error !== null || typeof attempt.data?.session?.access_token !== 'string' || !attempt.data.session.access_token.trim())
      throw new AuthFlowError('AUTH_FAILED', 'Incorrect credentials or sign-in unavailable.');
    const check = await authProviderCall(
      ()=>this.auth.getUser(),'Unable to verify the sign-in session.');
    if (check?.error !== null || typeof check.data?.user?.id !== 'string' || !check.data.user.id.trim())
      throw new AuthFlowError('AUTH_EXPIRED', 'Unable to verify the authenticated session.');
    // A second tab/provider callback may replace the local session while the
    // password request is in flight. Never silently switch account identity.
    if (attempt.data?.session?.user?.id !== check.data.user.id ||
        (attempt.data?.user?.id && attempt.data.user.id !== check.data.user.id))
      throw new AuthFlowError('AUTH_EXPIRED', 'The account changed during sign-in. Sign in again.');
    return check.data.user;
  }

  async requestPasswordReset(emailInput: unknown): Promise<void> {
    // Delivery verification is not a prerequisite to submitting a recovery request.
    // The provider still enforces abuse controls and the recovery session is verified separately.
    const email = validateAuthEmail(emailInput);
    const outcome = await authProviderCall(
      ()=>this.auth.resetPasswordForEmail(email, {
        redirectTo: this.config.siteOrigin + '/reset-password'
      }), 'Unable to submit the recovery request.');
    if (!outcome || outcome.error !== null || !outcome.data ||
        typeof outcome.data !== 'object' || Array.isArray(outcome.data) ||
        Object.keys(outcome.data).length !== 0)
      throw new AuthFlowError('PROVIDER_UNAVAILABLE', 'Unable to submit the recovery request.');
    // Do not claim a message was delivered or an account exists.
  }

  async resendSignupConfirmation(emailInput:unknown):Promise<void>{
    const resend=this.auth.resend;
    if(!resend)
      throw new AuthFlowError('PROVIDER_UNAVAILABLE','Confirmation email is temporarily unavailable.');
    const email=validateAuthEmail(emailInput);
    const outcome=await authProviderCall(()=>resend.call(this.auth,{
      type:'signup',email,options:{emailRedirectTo:this.config.siteOrigin+'/auth/callback'}
    }),'Unable to submit the confirmation request.');
    // A successful email resend acknowledges a request, not an identity or delivery.
    // Reject malformed envelopes and unexpected session/user payloads.
    if(!outcome || outcome.error !== null || !outcome.data ||
       typeof outcome.data !== 'object' || Array.isArray(outcome.data) ||
       Object.keys(outcome.data).length !== 0)
      throw new AuthFlowError('PROVIDER_UNAVAILABLE','Unable to submit the confirmation request.');
  }

  async updatePassword(password: string): Promise<void> {
    passwordForCreation(password);
    const outcome = await authProviderCall(
      ()=>this.auth.updateUser({ password }),
      'Password update service is temporarily unavailable.');
    if (outcome?.error !== null || typeof outcome.data?.user?.id !== 'string' || !outcome.data.user.id.trim())
      throw new AuthFlowError('AUTH_EXPIRED',
        'The password reset session is invalid or expired.');
  }

  /** Refresh tokens are revoked by the provider; issued access JWTs may remain
   * valid until expiration. 'others' does not emit a local SIGNED_OUT event. */
  async logout(scope: 'local' | 'global' | 'others' = 'local'): Promise<void> {
    if(scope!=='local'&&scope!=='global'&&scope!=='others')
      throw new AuthFlowError('VALIDATION','Invalid sign-out scope.');
    const outcome = await authProviderCall(
      ()=>this.auth.signOut({ scope }),
      'Unable to complete sign-out.');
    if (outcome?.error !== null) throw new AuthFlowError('PROVIDER_UNAVAILABLE', 'Unable to complete sign-out.');
  }

  async googleLogin(): Promise<string> {
    if (!this.config.googleOAuthConfigured)
      throw new AuthFlowError('PROVIDER_UNAVAILABLE', 'Google sign-in is not configured.');
    const outcome = await authProviderCall(
      ()=>this.auth.signInWithOAuth({
        provider: 'google', options: { redirectTo: this.config.siteOrigin + '/auth/callback' }
      }), 'OAuth service is temporarily unavailable.');
    if (outcome?.error !== null || typeof outcome.data?.url !== 'string' || !outcome.data.url.trim())
      throw new AuthFlowError('PROVIDER_UNAVAILABLE', 'OAuth could not begin.');
    let url:URL;
    try{url=new URL(outcome.data.url);}catch{throw new AuthFlowError('PROVIDER_UNAVAILABLE','OAuth could not begin.');}
    if((url.protocol!=='https:' && !(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))||
       url.username||url.password||url.hash||outcome.data.url.trim()!==outcome.data.url||/[\s\u0000-\u001f\u007f]/.test(outcome.data.url))
      throw new AuthFlowError('PROVIDER_UNAVAILABLE','OAuth could not begin.');
    return outcome.data.url;
  }

  async finishOAuth(code: string): Promise<AuthUser> {
    if (!/^[\w.-]{8,2048}$/.test(code))
      throw new AuthFlowError('VALIDATION', 'Invalid OAuth callback.');
    const result = await authProviderCall(
      ()=>this.auth.exchangeCodeForSession(code),
      'OAuth callback provider is temporarily unavailable.');
    if (result?.error !== null || typeof result.data?.user?.id !== 'string' || !result.data.user.id.trim())
      throw new AuthFlowError('AUTH_FAILED', 'OAuth callback failed.');
    const current = await authProviderCall(
      ()=>this.auth.getUser(),'OAuth session verification is temporarily unavailable.');
    if (current?.error !== null || current.data?.user?.id !== result.data.user.id)
      throw new AuthFlowError('AUTH_EXPIRED', 'OAuth session could not be verified.');
    return current.data.user;
  }
}
