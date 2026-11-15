/** Isolated, testable interaction contracts for approved public LIGHT screen 01. */
export type Theme = 'light' | 'dark';
export const THEME_KEY = 'kadmeion.theme';
export const DEMO_VIEWS = ['Workspace', 'Portfolio Studio', 'Growth'] as const;
export type DemoView = typeof DEMO_VIEWS[number];

export function parseTheme(value: unknown): Theme { return value === 'dark' ? 'dark' : 'light'; }
export function invertTheme(theme: Theme): Theme { return theme === 'light' ? 'dark' : 'light'; }
export function nextPreviewIndex(index: number, step: -1 | 1, length = DEMO_VIEWS.length): number {
  if (!Number.isSafeInteger(length) || length < 1 || !Number.isSafeInteger(index) || index < 0 || index >= length)
    throw new RangeError('Invalid product-demo index or length.');
  return (index + step + length) % length;
}
export function readTheme(storage: Pick<Storage, 'getItem'> | null): Theme {
  try { return parseTheme(storage?.getItem(THEME_KEY)); } catch { return 'light'; }
}
export function writeTheme(storage: Pick<Storage, 'setItem'> | null, theme: Theme): boolean {
  try { storage?.setItem(THEME_KEY, theme); return storage !== null; }
  catch { return false; }
}
export function canAutoAdvance(reducedMotion: boolean, manuallyPaused: boolean, interacting: boolean, documentVisible: boolean): boolean {
  return !reducedMotion && !manuallyPaused && !interacting && documentVisible;
}
