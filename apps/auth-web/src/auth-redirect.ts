export type AuthRedirect =
  | { kind: 'tokens'; parameters: URLSearchParams }
  | { kind: 'token_hash'; tokenHash: string; type: string }
  | { kind: 'oauth_code'; code: string }
  | { kind: 'error'; message: string }
  | { kind: 'none' };

/** Extract and immediately discard one-time credentials from the browser address bar. */
export function parseAuthRedirect(address: string): AuthRedirect {
  const url = new URL(address);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  const query = url.searchParams;
  if (fragment.has('error') || query.has('error') || query.has('error_code'))
    return { kind: 'error', message: 'This authentication link was rejected or has expired. Request a new link.' };
  if (fragment.has('access_token') || fragment.has('refresh_token'))
    return { kind: 'tokens', parameters: fragment };
  if (query.has('token_hash') && query.has('type'))
    return { kind: 'token_hash', tokenHash: query.get('token_hash') ?? '', type: query.get('type') ?? '' };
  if (query.has('code'))
    return url.pathname === '/auth/callback' ?
      { kind: 'oauth_code', code: query.get('code') ?? '' } :
      { kind: 'error', message: 'OAuth callback was delivered to an unexpected route.' };
  return { kind: 'none' };
}
