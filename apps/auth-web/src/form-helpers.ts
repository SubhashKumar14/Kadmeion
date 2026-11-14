/** Normalize user-facing @handles without weakening the stored public-handle contract. */
export function cleanHandleInput(value: string): string {
  return value.trim().replace(/^@/, '').trim().toLowerCase();
}
export function checkHandleInput(value: string): string | null {
  const handle = cleanHandleInput(value);
  if (!/^[a-z][a-z0-9_]{2,29}$/.test(handle))
    return 'Use 3–30 letters, numbers or underscores, beginning with a letter.';
  if (new Set(['admin','api','auth','dashboard','edit','explore','help','login','logout','new','profile','projects','settings','signup','support','templates','u']).has(handle))
    return 'That name is reserved. Choose another handle.';
  return null;
}
export function validatePasswordPair(password: string, confirmation: string): string | null {
  if (password.length < 8 || password.length > 128)
    return 'Use a password between 8 and 128 characters.';
  if (password !== confirmation) return 'Passwords do not match.';
  return null;
}
