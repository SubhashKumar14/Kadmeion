import { AuthService } from '../../../packages/contracts/src/auth-service.ts';
import { parseAuthRedirect } from './auth-redirect.ts';
import { SupabaseBrowserAuthPort } from './supabase-auth-port.ts';

type Config = { supabaseUrl?: string; publishableKey?: string };
const sections = ['login', 'register', 'forgot-password', 'set-password', 'workspace', 'callback'] as const;
const notice = document.querySelector<HTMLParagraphElement>('#notice');
const currentUser = document.querySelector<HTMLParagraphElement>('#current-user');
if (!notice || !currentUser) throw new Error('Authentication shell is incomplete.');

function message(value: string, error = false): void {
  notice!.textContent = value;
  notice!.classList.toggle('error', error);
}
function show(name: typeof sections[number]): void {
  for (const id of sections) {
    const section = document.getElementById(id);
    if (section) section.hidden = id !== name;
  }
  document.title = 'Kadmeion — ' + name.replaceAll('-', ' ');
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}
function values(form: HTMLFormElement): Record<string, string> {
  const result: Record<string, string> = {};
  new FormData(form).forEach((value, key) => { if (typeof value === 'string') result[key] = value; });
  return result;
}
async function busy(form: HTMLFormElement, action: () => Promise<void>): Promise<void> {
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]');
  if (button) button.disabled = true;
  message('');
  try { await action(); }
  catch (error) { message(errorText(error), true); }
  finally { if (button) button.disabled = false; }
}
function bind(id: string, action: (input: Record<string, string>) => Promise<void>): void {
  const form = document.getElementById(id);
  if (!(form instanceof HTMLFormElement)) throw new Error('Missing form: ' + id);
  form.addEventListener('submit', event => {
    event.preventDefault();
    void busy(form, () => action(values(form)));
  });
}
function navigate(name: 'login' | 'workspace' | 'set-password', success = ''): void {
  history.replaceState(null, '', '/' + name);
  show(name);
  message(success);
}

async function main(): Promise<void> {
  let config: Config;
  try {
    const response = await fetch('/config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Configuration endpoint unavailable.');
    config = await response.json() as Config;
    if (!config.supabaseUrl || !config.publishableKey) throw new Error('Missing Supabase configuration.');
  } catch {
    show('login');
    message('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, then restart the local server.', true);
    return;
  }
  let auth: SupabaseBrowserAuthPort;
  let service: AuthService;
  try {
    auth = new SupabaseBrowserAuthPort({
      supabaseUrl: config.supabaseUrl,
      publishableKey: config.publishableKey,
      appOrigin: location.origin,
      storage: window.localStorage
    });
    service = new AuthService(auth, { siteOrigin: location.origin, emailDeliveryVerified: true, googleOAuthConfigured: false });
  } catch (error) {
    show('login');
    message(errorText(error), true);
    return;
  }

  bind('login-form', async input => {
    await service.login(input.email, input.password);
    const result = await auth.getUser();
    if (!result.data?.user) throw new Error('Unable to verify the current session.');
    if (currentUser) currentUser.textContent = result.data.user.email ?? 'Your Kadmeion account';
    navigate('workspace', 'Signed in successfully.');
  });
  bind('register-form', async input => {
    const result = await service.register({
      email: input.email, password: input.password, handle: input.handle, displayName: input.displayName
    });
    if (result.status === 'signed_in') {
      navigate('workspace', 'Account created.');
    } else {
      navigate('login', 'Check your email for the confirmation link. This may appear in spam.');
    }
  });
  bind('forgot-form', async input => {
    await service.requestPasswordReset(input.email);
    navigate('login', 'If an account exists for this email, a recovery link may be sent.');
  });
  bind('password-form', async input => {
    if (input.password !== input.confirm) throw new Error('Passwords do not match.');
    const verified = await auth.getUser();
    if (!verified.data?.user) throw new Error('Your invitation or recovery session has expired. Request another link.');
    await service.updatePassword(input.password);
    if (currentUser) currentUser.textContent = verified.data.user.email ?? 'Your Kadmeion account';
    navigate('workspace', 'Password saved. Your session is active.');
  });
  document.getElementById('logout-button')?.addEventListener('click', () => {
    void (async () => {
      try { await service.logout('local'); navigate('login', 'Signed out.'); }
      catch (error) { message(errorText(error), true); }
    })();
  });

  const redirect = parseAuthRedirect(location.href);
  if (redirect.kind !== 'none') {
    // Never retain tokens, token hashes, codes or provider errors in the address bar.
    history.replaceState(null, '', location.pathname);
    show('callback');
    try {
      let kind: 'invite' | 'recovery' | 'confirmation';
      if (redirect.kind === 'error') throw new Error(redirect.message);
      if (redirect.kind === 'unsupported_oauth')
        throw new Error('Google sign-in is not configured for this verification application.');
      if (redirect.kind === 'tokens') kind = await auth.acceptTokens(redirect.parameters);
      else kind = await auth.verifyTokenHash(redirect.tokenHash, redirect.type);
      if (kind === 'invite' || kind === 'recovery') navigate('set-password', 'Authentication link verified. Choose a password.');
      else {
        const verified = await auth.getUser();
        if (!verified.data?.user) throw new Error('Confirmation session not verified.');
        if (currentUser) currentUser.textContent = verified.data.user.email ?? 'Your Kadmeion account';
        navigate('workspace', 'Email confirmation successful.');
      }
    } catch (error) { navigate('login'); message(errorText(error), true); }
    return;
  }

  const route = location.pathname;
  if (route === '/register') show('register');
  else if (route === '/forgot-password') show('forgot-password');
  else if (route === '/auth/callback' || route === '/reset-password' || route === '/set-password') {
    navigate('login');
    message('This link does not contain an active invitation or recovery token. Request a new link.', true);
  } else if (route === '/workspace') {
    const verified = await auth.getUser();
    if (verified.data?.user) {
      if (currentUser) currentUser.textContent = verified.data.user.email ?? 'Your Kadmeion account';
      show('workspace');
    } else navigate('login', 'Sign in to continue.');
  } else show('login');
}
void main().catch(() => {
  show('login');
  message('Authentication could not be initialized. Check the browser console without sharing tokens.', true);
});
