import { ContractError, normalizeHandle, type PrivateProfile } from './project.ts';

export interface IdentityDraft {
  handle: string;
  displayName: string;
  headline: string;
  bio: string;
}

export interface SharingPreferences {
  shareDisplayName: boolean;
  shareHeadline: boolean;
  shareBio: boolean;
  publicationRequested: boolean;
}

/** Preview data is not a published release. The B4 route check remains authoritative. */
export interface IdentityPreview {
  handle: string;
  displayName?: string;
  headline?: string;
  bio?: string;
}

function safeText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new ContractError('VALIDATION', field + ' must be text.');
  const result = value.trim();
  if (result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) {
    throw new ContractError('VALIDATION', field + ' exceeds limits or contains control characters.');
  }
  return result;
}

/** UI validation complements, but does not replace, PostgreSQL constraints and RLS. */
export function normalizeIdentityDraft(input: unknown): IdentityDraft {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ContractError('VALIDATION', 'Identity must be an object.');
  }
  const data = input as Record<string, unknown>;
  return {
    handle: normalizeHandle(data.handle),
    displayName: safeText(data.displayName, 'Display name', 80),
    headline: safeText(data.headline ?? '', 'Headline', 160),
    bio: safeText(data.bio ?? '', 'Bio', 2000)
  };
}

export function identityPreview(profile: PrivateProfile, prefs: SharingPreferences): IdentityPreview | null {
  if (!prefs.publicationRequested || !profile.handle ||
      !(prefs.shareDisplayName || prefs.shareHeadline || prefs.shareBio)) return null;
  const preview: IdentityPreview = { handle: normalizeHandle(profile.handle) };
  if (prefs.shareDisplayName) preview.displayName = profile.displayName;
  if (prefs.shareHeadline) preview.headline = profile.headline;
  if (prefs.shareBio) preview.bio = profile.bio;
  return preview;
}
