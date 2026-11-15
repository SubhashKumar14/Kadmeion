import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTheme, nextTheme, themeButtonCopy, readStoredTheme, writeStoredTheme, THEME_STORAGE_KEY } from '../../apps/auth-web/src/theme-preference.ts';

test('light theme is the default; unknown persisted values never become a theme', () => {
  assert.equal(parseTheme(null), 'light');
  assert.equal(parseTheme('system'), 'light');
  assert.equal(parseTheme('DARK'), 'light');
  assert.equal(parseTheme('dark'), 'dark');
  assert.equal(nextTheme('dark'), 'light');
  assert.equal(nextTheme('unknown'), 'dark');
});
test('toggle copy and accessibility label reflect the actual next mode', () => {
  assert.deepEqual(themeButtonCopy('light'), { text: 'Dark mode', label: 'Switch to dark theme' });
  assert.deepEqual(themeButtonCopy('dark'), { text: 'Light mode', label: 'Switch to light theme' });
});
test('denied storage does not prevent theme rendering or toggling', () => {
  const denied = {
    getItem(_key:string):string|null { throw new Error('blocked'); },
    setItem(_key:string,_value:string):void { throw new Error('blocked'); }
  };
  assert.equal(readStoredTheme(denied), 'light');
  assert.equal(writeStoredTheme(denied, 'dark'), false);
  assert.equal(readStoredTheme(null), 'light');
  assert.equal(writeStoredTheme(null, 'light'), false);
});
test('approved local preference key is stable across light/dark', () => {
  const values = new Map<string,string>();
  const storage = {
    getItem(key:string) { return values.get(key) ?? null; },
    setItem(key:string,value:string) { values.set(key, value); }
  };
  assert.equal(readStoredTheme(storage), 'light');
  assert.equal(writeStoredTheme(storage, 'dark'), true);
  assert.equal(values.get(THEME_STORAGE_KEY), 'dark');
  assert.equal(readStoredTheme(storage), 'dark');
});
