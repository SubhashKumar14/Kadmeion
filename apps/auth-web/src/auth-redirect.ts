export type AuthRedirect =
  | { kind: 'tokens'; parameters: URLSearchParams }
  | { kind: 'token_hash'; tokenHash: string; type: string }
  | { kind: 'oauth_code'; code: string }
  | { kind: 'error'; message: string }
  | { kind: 'none' };

const emailTypes = new Set(['invite', 'recovery', 'signup', 'email']);
export function isEmailAuthType(value: string | null): value is string {
  return value !== null && emailTypes.has(value);
}

function genericError(): AuthRedirect {
  return { kind: 'error', message: 'This authentication link was rejected or has expired. Request a new link.' };
}

function once(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  return values.length === 1 && values[0] ? values[0] : null;
}

/** Classify exactly one credential flow so the caller can scrub the URL immediately. */
export function parseAuthRedirect(address: string): AuthRedirect {
  const url = new URL(address);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const query = url.searchParams;
  if ([fragment, query].some(params =>
    ['error', 'error_code', 'error_description'].some(key => params.has(key)))) return genericError();

  const routes = ['/', '/auth/callback', '/reset-password'];
  const implicit = ['access_token', 'refresh_token'].some(key => fragment.has(key));
  const hashed = query.has('token_hash');
  const oauth = query.has('code');
  if (['access_token', 'refresh_token'].some(key => query.has(key)) ||
      ['token_hash', 'code'].some(key => fragment.has(key)) ||
      Number(implicit) + Number(hashed) + Number(oauth) > 1) return genericError();

  if (implicit || hashed) {
    const credentials = implicit ? fragment : query;
    const type = once(credentials, 'type');
    if (!isEmailAuthType(type) || !routes.includes(url.pathname) ||
        (url.pathname === '/reset-password' && type !== 'recovery')) return genericError();
    if (implicit) {
      if (!once(fragment, 'access_token') || !once(fragment, 'refresh_token') ||
          fragment.getAll('expires_in').length > 1) return genericError();
      return { kind: 'tokens', parameters: fragment };
    }
    const tokenHash = once(query, 'token_hash');
    return tokenHash ? { kind: 'token_hash', tokenHash, type } : genericError();
  }
  if (oauth) {
    const code = once(query, 'code');
    return code && url.pathname === '/auth/callback' ? { kind: 'oauth_code', code } : genericError();
  }
  return { kind: 'none' };
}
