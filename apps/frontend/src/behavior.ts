/** Isolated, testable interaction contracts for approved public LIGHT screen 01. */
export type Theme = 'light' | 'dark';
export const THEME_KEY = 'kadmeion.theme';
export const DEMO_VIEWS = ['Workspace', 'Portfolio Studio', 'Growth'] as const;
export type DemoView = typeof DEMO_VIEWS[number];

export function parseTheme(value: unknown): Theme { return value === 'dark' ? 'dark' : 'light'; }
export function invertTheme(theme: Theme): Theme { return theme === 'light' ? 'dark' : 'light'; }
export function nextPreviewIndex(index: number, step: -1 | 1, length: number = DEMO_VIEWS.length): number {
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

/** Public-gallery concept filtering is client-only. It must not be mistaken for
 * an authorization filter or actual private/public portfolio data. */
export function filterShowcaseConcepts<T extends { title: string; description: string; field: string; tags: readonly string[] }>(
  items: readonly T[], query: string, category: string, sort: 'Featured' | 'Name A–Z'
): T[] {
  const term=query.trim().toLocaleLowerCase('en');
  const result=items.filter(item=>(category==='All'||item.field===category)&&
    (!term||[item.title,item.description,item.field,...item.tags].some(text=>text.toLocaleLowerCase('en').includes(term))));
  return sort==='Name A–Z' ? result.sort((a,b)=>a.title.localeCompare(b.title,'en')) : result;
}
