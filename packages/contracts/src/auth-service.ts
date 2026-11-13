import { ContractError, normalizeHandle } from './project.ts';

export type AuthFailure = { message: string; status?: number | undefined };
export type AuthOutcome<T> = { data: T; error: AuthFailure | null };
export type AuthUser = { id: string; email?: string; email_confirmed_at?: string | null };
export type AuthSession = { access_token: string; user: AuthUser };
export type OAuthProvider = 'google';

/** Narrow Supabase Auth interface; inject the real @supabase/supabase-js auth client. */
export interface AuthPort {
  signUp(options: { email: string; password: string; options: { data: Record<string, string> } }):
    Promise<AuthOutcome<{ user: AuthUser | null; session: AuthSession | null }>>;
  signInWithPassword(options: { email: string; password: string }):
    Promise<AuthOutcome<{ user: AuthUser | null; session: AuthSession | null }>>;
  getUser(): Promise<AuthOutcome<{ user: AuthUser | null }>>;
  resetPasswordForEmail(email: string, options: { redirectTo: string }): Promise<AuthOutcome<unknown>>;
  updateUser(changes: { password: string }): Promise<AuthOutcome<{ user: AuthUser | null }>>;
  signOut(options?: { scope: 'local' | 'global' | 'others' }): Promise<AuthOutcome<unknown>>;
  signInWithOAuth(options: { provider: OAuthProvider; options: { redirectTo: string } }): Promise<AuthOutcome<{ url: string | null }>>;
  exchangeCodeForSession(code: string): Promise<AuthOutcome<unknown>>;
}

export class AuthFlowError extends Error {
  readonly code: 'VALIDATION' | 'PROVIDER_UNAVAILABLE' | 'AUTH_FAILED' | 'AUTH_EXPIRED';
  constructor(code: 'VALIDATION' | 'PROVIDER_UNAVAILABLE' | 'AUTH_FAILED' | 'AUTH_EXPIRED', message: string) {
    super(message); this.name = 'AuthFlowError'; this.code=code;
  }
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
    this.auth=auth; this.config=config;
    if (!/^https?:\/\/[^/]+$/.test(config.siteOrigin))
      throw new AuthFlowError('VALIDATION', 'Invalid application origin.');
  }

  async register(input: { email: string; password: string; displayName: string; handle: string }) {
    if (!this.config.emailDeliveryVerified)
      throw new AuthFlowError('PROVIDER_UNAVAILABLE', 'Registration is unavailable until email delivery is verified.');
    const email = validateAuthEmail(input.email);
    passwordForCreation(input.password);
    const handleCandidate = normalizeHandle(input.handle);
    const displayName = input.displayName?.trim();
    if (!displayName || displayName.length > 80) throw new AuthFlowError('VALIDATION', 'Enter a display name.');
    const { data, error } = await this.auth.signUp({
      email, password: input.password,
      options: { data: { display_name: displayName, handle_candidate: handleCandidate } }
    });
    if (error) throw new AuthFlowError('AUTH_FAILED', 'Registration could not be completed.');
    // Handle candidate is NOT reserved until authenticated ownership/uniqueness update.
    return { status: data.session && data.user ? 'signed_in' : 'confirmation_required', handleCandidate } as const;
  }

  async login(emailInput: unknown, password: string): Promise<AuthUser> {
    const email = validateAuthEmail(emailInput);
    if (!password) throw new AuthFlowError('VALIDATION', 'Password is required.');
    const attempt = await this.auth.signInWithPassword({ email, password });
    if (attempt.error || !attempt.data?.session?.access_token)
      throw new AuthFlowError('AUTH_FAILED', 'Incorrect credentials or sign-in unavailable.');
    const check = await this.auth.getUser();
    if (check.error || !check.data?.user?.id)
      throw new AuthFlowError('AUTH_EXPIRED', 'Unable to verify the authenticated session.');
    return check.data.user;
  }

  async requestPasswordReset(emailInput: unknown): Promise<void> {
    if (!this.config.emailDeliveryVerified)
      throw new AuthFlowError('PROVIDER_UNAVAILABLE', 'Password recovery is unavailable until email delivery is verified.');
    const email = validateAuthEmail(emailInput);
    const { error } = await this.auth.resetPasswordForEmail(email, {
      redirectTo: this.config.siteOrigin + '/reset-password'
    });
    if (error) throw new AuthFlowError('PROVIDER_UNAVAILABLE', 'Unable to submit the recovery request.');
    // Do not claim a message was delivered or an account exists.
  }

  async updatePassword(password: string): Promise<void> {
    passwordForCreation(password);
    const { error } = await this.auth.updateUser({ password });
    if (error) throw new AuthFlowError('AUTH_EXPIRED', 'The password reset session is invalid or expired.');
  }

  async logout(scope: 'local' | 'global' | 'others' = 'local'): Promise<void> {
    const { error } = await this.auth.signOut({ scope });
    if (error) throw new AuthFlowError('PROVIDER_UNAVAILABLE', 'Unable to complete sign-out.');
  }

  async googleLogin(): Promise<string> {
    if (!this.config.googleOAuthConfigured)
      throw new AuthFlowError('PROVIDER_UNAVAILABLE', 'Google sign-in is not configured.');
    const { data, error } = await this.auth.signInWithOAuth({
      provider: 'google', options: { redirectTo: this.config.siteOrigin + '/auth/callback' }
    });
    if (error || !data.url) throw new AuthFlowError('PROVIDER_UNAVAILABLE', 'OAuth could not begin.');
    return data.url;
  }

  async finishOAuth(code: string): Promise<AuthUser> {
    if (!/^[\w.-]{8,2048}$/.test(code))
      throw new AuthFlowError('VALIDATION', 'Invalid OAuth callback.');
    const result = await this.auth.exchangeCodeForSession(code);
    if (result.error) throw new AuthFlowError('AUTH_FAILED', 'OAuth callback failed.');
    const current = await this.auth.getUser();
    if (current.error || !current.data.user)
      throw new AuthFlowError('AUTH_EXPIRED', 'OAuth session could not be verified.');
    return current.data.user;
  }
}
