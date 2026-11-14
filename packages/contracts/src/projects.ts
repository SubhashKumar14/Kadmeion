import { ContractError, normalizeExternalHttpsUrl } from './project.ts';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface PrivateProjectDraft {
  slug: string;
  title: string;
  summary: string;
  description: string;
  repositoryUrl: string | null;
  liveUrl: string | null;
}

function limitText(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== 'string') throw new ContractError('VALIDATION', label + ' must be text.');
  const cleaned = value.trim();
  if (cleaned.length > max || (required && !cleaned) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(cleaned)) {
    throw new ContractError('VALIDATION', label + ' is invalid.');
  }
  return cleaned;
}

function optionalLink(value: unknown): string | null {
  if (value == null || value === '') return null;
  return normalizeExternalHttpsUrl(value);
}

export function normalizeProjectDraft(input: unknown): PrivateProjectDraft {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ContractError('VALIDATION', 'Project must be an object.');
  const record = input as Record<string, unknown>;
  const slug = limitText(record.slug, 'Slug', 64);
  if (slug.length < 3 || !SLUG_PATTERN.test(slug)) throw new ContractError('VALIDATION', 'Invalid project slug.');
  return {
    slug,
    title: limitText(record.title, 'Title', 120, true),
    summary: limitText(record.summary ?? '', 'Summary', 360),
    description: limitText(record.description ?? '', 'Description', 12000),
    repositoryUrl: optionalLink(record.repositoryUrl),
    liveUrl: optionalLink(record.liveUrl)
  };
}
