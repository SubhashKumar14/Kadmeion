/** Small dependency-free app theme policy. Never require persistent storage to render. */
export type AppTheme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'kadmeion.theme';
export function parseTheme(value: unknown): AppTheme {
  return value === 'dark' ? 'dark' : 'light';
}
export function nextTheme(current: unknown): AppTheme {
  return parseTheme(current) === 'light' ? 'dark' : 'light';
}
export function themeButtonCopy(current: AppTheme): { text: string; label: string } {
  return current === 'light'
    ? { text: 'Dark mode', label: 'Switch to dark theme' }
    : { text: 'Light mode', label: 'Switch to light theme' };
}
export function readStoredTheme(storage: Pick<Storage, 'getItem'> | null): AppTheme {
  try { return parseTheme(storage?.getItem(THEME_STORAGE_KEY)); }
  catch { return 'light'; }
}
export function writeStoredTheme(storage: Pick<Storage, 'setItem'> | null, theme: AppTheme): boolean {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
    return storage !== null;
  } catch { return false; }
}
