/** Phase-1 contracts: never treat browser validation as an RLS substitute. */
export const HANDLE_PATTERN = /^[a-z][a-z0-9_]{2,29}$/;
export const RESERVED_HANDLES = new Set([
  'admin', 'api', 'auth', 'dashboard', 'edit', 'explore', 'help',
  'login', 'logout', 'new', 'profile', 'projects', 'settings',
  'signup', 'signin', 'register', 'workspace', 'status', 'r', 'app',
  'support', 'templates', 'u'
]);

export class ContractError extends Error {
  readonly code: 'VALIDATION' | 'REVISION_CONFLICT';
  constructor(code: 'VALIDATION' | 'REVISION_CONFLICT', message: string) {
    super(message);
    this.code = code;
    this.name = 'ContractError';
  }
}

export function normalizeHandle(input: unknown): string {
  if (typeof input !== 'string') throw new ContractError('VALIDATION', 'Handle must be text.');
  const handle = input.trim().toLowerCase();
  if (!HANDLE_PATTERN.test(handle) || RESERVED_HANDLES.has(handle)) {
    throw new ContractError('VALIDATION', 'Use 3–30 letters, digits or underscores; start with a letter and avoid reserved names.');
  }
  return handle;
}

export function normalizeExternalHttpsUrl(input: unknown): string {
  if (typeof input !== 'string' || input.length > 2048 || /[\u0000-\u001f\u007f]/.test(input)) {
    throw new ContractError('VALIDATION', 'A valid HTTPS URL is required.');
  }
  let url: URL;
  try { url = new URL(input.trim()); } catch {
    throw new ContractError('VALIDATION', 'A valid HTTPS URL is required.');
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password ||
    hostname === 'localhost' || hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') || hostname === '[::1]' ||
    /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(hostname)) {
    throw new ContractError('VALIDATION', 'Use a public HTTPS URL without credentials.');
  }
  return url.toString();
}

export interface PrivateProfile {
  userId: string;
  handle: string | null;
  displayName: string;
  headline: string;
  bio: string;
  onboardingComplete: boolean;
}

export interface PublicProfileProjection {
  handle: string;
  displayName: string;
  headline?: string;
  bio?: string;
  publishedAt: string;
}
