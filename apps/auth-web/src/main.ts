import { AuthService } from '../../../packages/contracts/src/auth-service.ts';
import { parseAuthRedirect } from './auth-redirect.ts';
import { SupabaseBrowserAuthPort } from './supabase-auth-port.ts';
import { cleanHandleInput, checkHandleInput, validatePasswordPair } from './form-helpers.ts';
import { readStoredTheme, nextTheme, themeButtonCopy, writeStoredTheme } from './theme-preference.ts';

type Config = { supabaseUrl?: string; publishableKey?: string; emailDeliveryVerified?: boolean; googleOAuthEnabled?: boolean };
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
  const shell = document.getElementById('auth-shell');
  if (shell) shell.dataset.authMode = name === 'register' ? 'register' : 'login';
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
  clearPasswordBuffers();
  history.replaceState(null, '', '/' + name);
  show(name);
  message(success);
}

function setupTheme(): void {
  // The theme remains usable when configuration, network or storage is unavailable.
  const root = document.documentElement;
  const button = document.getElementById('theme-button');
  function render(theme: 'light' | 'dark'): void {
    root.dataset.theme = theme;
    if (button) {
      const copy = themeButtonCopy(theme);
      button.textContent = copy.text;
      button.setAttribute('aria-label', copy.label);
      button.setAttribute('aria-pressed', String(theme === 'dark'));
    }
  }
  // Accessing the localStorage property itself can throw in sandboxed origins.
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { /* volatile theme still works */ }
  render(readStoredTheme(storage));
  button?.addEventListener('click', () => {
    const theme = nextTheme(root.dataset.theme);
    render(theme);
    writeStoredTheme(storage, theme);
  });
}
function clearPasswordBuffers(): void {
  // Auth forms stay mounted during mode switches, but never after navigation.
  document.querySelectorAll<HTMLInputElement>('.password-field input').forEach(input => {
    input.value = '';
    input.type = 'password';
  });
  document.querySelectorAll<HTMLButtonElement>('.password-toggle').forEach(button => {
    button.textContent = 'Show';
    button.setAttribute('aria-pressed', 'false');
  });
}

async function main(): Promise<void> {
  setupTheme();
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
      storage: window.localStorage,
      oauthStorage: window.sessionStorage
    });
    service = new AuthService(auth, {
      siteOrigin: location.origin,
      // Explicit operator proof flags default OFF; do not infer SMTP success.
      emailDeliveryVerified: config.emailDeliveryVerified === true,
      googleOAuthConfigured: config.googleOAuthEnabled === true
    });
  } catch (error) {
    show('login');
    message(errorText(error), true);
    return;
  }


  // Switch panels in place, preserving unsent entries without new history entries.
  document.querySelectorAll<HTMLAnchorElement>('[data-auth-switch]').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      const mode = link.dataset.authSwitch;
      if (mode !== 'login' && mode !== 'register') return;
      history.replaceState(null, '', mode === 'register' ? '/signup' : '/signin');
      show(mode);
      message('');
      document.querySelector<HTMLElement>('#' + mode + ' h1')?.focus({ preventScroll: true });
    });
  });

  document.querySelectorAll<HTMLButtonElement>('.password-toggle').forEach(button => {
    button.addEventListener('click', () => {
      const target = document.getElementById(button.getAttribute('aria-controls') ?? '');
      if (!(target instanceof HTMLInputElement)) return;
      const visible = target.type === 'password';
      target.type = visible ? 'text' : 'password';
      button.textContent = visible ? 'Hide' : 'Show';
      button.setAttribute('aria-pressed', String(visible));
      target.focus({ preventScroll: true });
    });
  });
  const handleField = document.querySelector<HTMLInputElement>('#signup-handle');
  const handleError = document.querySelector<HTMLElement>('#handle-error');
  function handleFeedback(): string | null {
    if (!handleField || !handleError) return null;
    const error = checkHandleInput(handleField.value);
    handleError.textContent = error ?? '';
    handleError.hidden = !error;
    handleField.setAttribute('aria-invalid', String(!!error));
    return error;
  }
  handleField?.addEventListener('blur', () => {
    handleField.value = cleanHandleInput(handleField.value);
    if (handleField.value) handleFeedback();
  });
  handleField?.addEventListener('input', () => {
    if (handleError && !handleError.hidden) handleFeedback();
  });

  const googleButton = document.getElementById('google-login-button');
  if (googleButton instanceof HTMLButtonElement) {
    const configured = config.googleOAuthEnabled === true;
    googleButton.disabled = !configured;
    googleButton.textContent = configured ? 'Continue with Google' : 'Google sign-in not yet available';
    googleButton.setAttribute('aria-disabled', String(!configured));
    if (configured) {
      googleButton.addEventListener('click', () => {
        googleButton.disabled = true;
        message('');
        void (async () => {
          try {
            // AuthService + the PKCE adapter validate the provider redirect.
            const authorizationUrl = await service.googleLogin();
            window.location.assign(authorizationUrl);
          } catch (error) {
            message(errorText(error), true);
            googleButton.disabled = false;
          }
        })();
      });
    }
  }

  bind('login-form', async input => {
    await service.login(input.email, input.password);
    const result = await auth.getUser();
    if (!result.data?.user) throw new Error('Unable to verify the current session.');
    if (currentUser) currentUser.textContent = result.data.user.email ?? 'Your Kadmeion account';
    navigate('workspace', 'Signed in successfully.');
  });
  bind('register-form', async input => {
    if (handleFeedback()) throw new Error('Please correct your handle before continuing.');
    const pairError = validatePasswordPair(input.password, input.confirm);
    if (pairError) throw new Error(pairError);
    const result = await service.register({
      email: input.email, password: input.password, handle: cleanHandleInput(input.handle), displayName: input.displayName
    });
    if (result.status === 'signed_in') {
      navigate('workspace', 'Account created.');
    } else {
      navigate('login', 'This environment requires email confirmation before sign-in. If the confirmation email arrives, open its link to continue.');
    }
  });
  bind('forgot-form', async input => {
    await service.requestPasswordReset(input.email);
    navigate('login', 'If an account exists for this email, a recovery link may be sent.');
  });
  bind('password-form', async input => {
    const pairError = validatePasswordPair(input.password, input.confirm);
    if (pairError) throw new Error(pairError);
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
      if (redirect.kind === 'oauth_code') {
        const verified = await service.finishOAuth(redirect.code);
        if (currentUser) currentUser.textContent = verified.email ?? 'Your Kadmeion account';
        navigate('workspace', 'Google authentication session verified.');
        return;
      }
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
  if (route === '/register' || route === '/signup') show('register');
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
