import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEditorTransaction, createEditorHead, restoreHistoricalSnapshot, type EditorHead, type PortfolioSnapshot } from '../../packages/editor-core/src/index.ts';

const make = (): EditorHead => createEditorHead({
  formatVersion:1,
  files:{'kadmeion.json':'{"formatVersion":1}', 'pages/home.page.json':'{}'},
  slots:{hero:{state:'S0',componentId:'title-stacked@1',content:{title:'First'}}},
  stashes:{}
});
let step = 0;
const op = (head:EditorHead,intent: Parameters<typeof applyEditorTransaction>[1]['intent']) => ({
  operationId:'00000000-0000-4000-8000-'+String(++step).padStart(12,'0'),baseRevision:head.revision,intent
});

test('clearing a slot preserves content in stash and restore is reversible',()=>{
  const original=make();
  const cleared=applyEditorTransaction(original,op(original,{kind:'CLEAR_SLOT',slotKey:'hero'}));
  assert.equal(original.snapshot.slots.hero.state,'S0');
  assert.equal(cleared.snapshot.slots.hero.state,'EMPTY');
  assert.deepEqual(cleared.snapshot.stashes.hero[0].content,{title:'First'});
  const restored=applyEditorTransaction(cleared,op(cleared,{kind:'RESTORE_STASH',slotKey:'hero'}));
  assert.equal(restored.snapshot.slots.hero.state,'S0');
  assert.equal(restored.snapshot.slots.hero.content.title,'First');
  assert.equal(restored.revision,2);
});

test('customize protected source S0 => S1; user edit => S2, without rewriting library code',()=>{
  const head=make();
  assert.throws(()=>applyEditorTransaction(head,op(head,{kind:'CUSTOMIZE_COMPONENT',slotKey:'hero',copiedSource:'forged'})));
  const copy=applyEditorTransaction(head,op(head,{kind:'CUSTOMIZE_COMPONENT',slotKey:'hero',copiedSource:'export const x=1;'}),{'title-stacked@1':'export const x=1;'});
  assert.equal(copy.snapshot.slots.hero.state,'S1');
  const firstPath=copy.snapshot.slots.hero.sourcePath!;
  assert.match(firstPath,/^slots\/hero\/owned\/[0-9a-f-]+\/component-source\.tsx$/);
  assert.equal(copy.snapshot.files[firstPath],'export const x=1;');
  const edit=applyEditorTransaction(copy,op(copy,{kind:'EDIT_OWNED_SOURCE',slotKey:'hero',source:'export const x=2;'}));
  assert.equal(edit.snapshot.slots.hero.state,'S2');
  assert.equal(copy.snapshot.files[firstPath],'export const x=1;');
  assert.throws(()=>applyEditorTransaction(edit,op(edit,{kind:'ASSIGN_COMPONENT',slotKey:'hero',componentId:'new-hero@1'})));
  const replaced=applyEditorTransaction(edit,op(edit,{kind:'ASSIGN_COMPONENT',slotKey:'hero',componentId:'new-hero@1',confirmOwnedReplacement:true}));
  assert.equal(replaced.snapshot.stashes.hero.at(-1)?.state,'S2');
  assert.equal(replaced.snapshot.files[firstPath],'export const x=2;');
  const nextCustomization=applyEditorTransaction(
    replaced,
    op(replaced,{kind:'CUSTOMIZE_COMPONENT',slotKey:'hero',copiedSource:'export const next = 3;'}),
    {'new-hero@1':'export const next = 3;'}
  );
  const secondPath=nextCustomization.snapshot.slots.hero.sourcePath!;
  assert.notEqual(secondPath,firstPath);
  assert.equal(nextCustomization.snapshot.files[firstPath],'export const x=2;');
  assert.equal(nextCustomization.snapshot.files[secondPath],'export const next = 3;');
  assert.equal(nextCustomization.snapshot.slots.hero.state,'S1');
});

test('stale base revisions and invalid writes never mutate the previously saved head',()=>{
  const head=make();
  assert.throws(()=>applyEditorTransaction(head,{...op(head,{kind:'CLEAR_SLOT',slotKey:'hero'}),baseRevision:1}),{code:'REVISION_CONFLICT'});
  assert.throws(()=>applyEditorTransaction(head,op(head,{kind:'WRITE_MANAGED_FILE',path:'../private.json',source:'{}'})));
  assert.throws(()=>applyEditorTransaction(head,op(head,{kind:'WRITE_MANAGED_FILE',path:'pages/home.page.json',source:'{bad json'})));
  assert.equal(head.snapshot.files['pages/home.page.json'],'{}');
  assert.equal(head.revision,0);
});

test('managed writer preserves exact valid source bytes',()=>{
  const head=make(), bytes='{\n  "text": "preserve spacing"\n}\n';
  const next=applyEditorTransaction(head,op(head,{kind:'WRITE_MANAGED_FILE',path:'pages/home.page.json',source:bytes}));
  assert.equal(next.snapshot.files['pages/home.page.json'],bytes);
});

test('undo and redo commit new monotonic revisions, not history rewrites',()=>{
  const first=make();
  const second=applyEditorTransaction(first,op(first,{kind:'UPDATE_CONTENT',slotKey:'hero',content:{title:'Second'}}));
  const undone=applyEditorTransaction(second,op(second,{kind:'UNDO'}));
  assert.equal(undone.snapshot.slots.hero.content.title,'First');
  const redone=applyEditorTransaction(undone,op(undone,{kind:'REDO'}));
  assert.equal(redone.snapshot.slots.hero.content.title,'Second');
  assert.equal(redone.revision,3);
  const restored=restoreHistoricalSnapshot(redone,first.snapshot,'a0000000-0000-4000-8000-000000000000');
  assert.equal(restored.snapshot.slots.hero.content.title,'First');
  assert.equal(restored.revision,4);
});

test('an identical retried operation never creates another revision',()=>{
  const first=make(), command=op(first,{kind:'CLEAR_SLOT',slotKey:'hero'});
  const second=applyEditorTransaction(first,command);
  assert.strictEqual(applyEditorTransaction(second,command),second);
  assert.throws(()=>applyEditorTransaction(second,{...command,intent:{kind:'UPDATE_CONTENT',slotKey:'hero',content:{title:'x'}}}));
});

test('portable snapshots reject path traversal and arbitrary import files',()=>{
  const valid=make().snapshot;
  assert.throws(()=>createEditorHead({...valid,files:{...valid.files,'slots/../../attack.tsx':'bad'}}));
  assert.throws(()=>createEditorHead({...valid,files:{...valid.files,'components/library/locked.tsx':'bad'}}));
  const json=JSON.stringify(valid),reloaded=JSON.parse(json) as PortfolioSnapshot;
  assert.deepEqual(createEditorHead(reloaded).snapshot,valid);
});
