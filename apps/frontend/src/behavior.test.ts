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

test('public concept searching and category filters do not mutate backing records', async () => {
  const { filterShowcaseConcepts } = await import('./behavior.ts');
  const items = [
    {title:'BidHub',description:'Bidding platform',field:'Full-Stack',tags:['Marketplace']},
    {title:'Aegis AI',description:'Assistant tools',field:'AI / ML',tags:['Tools']}
  ];
  assert.equal(filterShowcaseConcepts(items,'bid','All','Featured')[0]?.title,'BidHub');
  assert.deepEqual(filterShowcaseConcepts(items,'', 'AI / ML','Featured').map(x=>x.title),['Aegis AI']);
  assert.deepEqual(filterShowcaseConcepts(items,'', 'All','Name A–Z').map(x=>x.title),['Aegis AI','BidHub']);
  assert.equal(items[0]?.title,'BidHub');
  assert.equal(filterShowcaseConcepts(items,'unknown','All','Featured').length,0);
});

test('auth routing never trusts credentials, non-root paths or insecure remote origins', async () => {
  const { authHref } = await import('./behavior.ts');
  assert.equal(authHref(undefined),'/signin');
  assert.equal(authHref('https://login.example.com/'),'https://login.example.com/signin');
  assert.equal(authHref('http://127.0.0.1:3000/','/signup'),'http://127.0.0.1:3000/signup');
  assert.equal(authHref('https://evil.example/password'),'/signin');
  assert.equal(authHref('https://alice:secret@valid.example/'),'/signin');
  assert.equal(authHref('http://untrusted.example/'),'/signin');
  assert.equal(authHref('https://valid.example/?redirect=evil'),'/signin');
});
