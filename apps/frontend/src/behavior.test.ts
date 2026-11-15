import test from 'node:test';
import assert from 'node:assert/strict';
import { THEME_KEY, parseTheme, invertTheme, readTheme, writeTheme, nextPreviewIndex, canAutoAdvance } from './behavior.ts';

test('light first, persist valid dark only and survive restricted storage', () => {
  assert.equal(parseTheme(undefined),'light');
  assert.equal(parseTheme('system'),'light');
  assert.equal(parseTheme('dark'),'dark');
  assert.equal(invertTheme('dark'),'light');
  const store = new Map<string,string>();
  const storage = {getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value);}};
  assert.equal(readTheme(storage),'light');
  assert.equal(writeTheme(storage,'dark'),true);
  assert.equal(store.get(THEME_KEY),'dark');
  assert.equal(readTheme(storage),'dark');
  assert.equal(readTheme({getItem(){throw new Error('SecurityError');}}),'light');
  assert.equal(writeTheme({setItem(){throw new Error('SecurityError');}},'dark'),false);
});
test('approved product-demo controls wrap correctly and reject corrupt indexes', () => {
  assert.equal(nextPreviewIndex(0,-1),2);
  assert.equal(nextPreviewIndex(2,1),0);
  assert.equal(nextPreviewIndex(1,1),2);
  assert.throws(()=>nextPreviewIndex(-1,1),RangeError);
  assert.throws(()=>nextPreviewIndex(0,1,0),RangeError);
});
test('reduced motion, manual pause, focus, pointer and hidden tab prevent auto movement', () => {
  assert.equal(canAutoAdvance(false,false,false,true),true);
  assert.equal(canAutoAdvance(true,false,false,true),false);
  assert.equal(canAutoAdvance(false,true,false,true),false);
  assert.equal(canAutoAdvance(false,false,true,true),false);
  assert.equal(canAutoAdvance(false,false,false,false),false);
});
