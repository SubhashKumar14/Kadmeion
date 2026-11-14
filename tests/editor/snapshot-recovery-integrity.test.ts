import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditorHead,applyEditorTransaction} from '../../packages/editor-core/src/index.ts';
import type {PortfolioSnapshot,SlotAssignment} from '../../packages/editor-core/src/index.ts';

const uuid='10000000-0000-4000-8000-000000000001';
const base=():PortfolioSnapshot=>({
  formatVersion:1,files:{'kadmeion.json':'{"formatVersion":1}'},
  slots:{hero:{state:'S0',componentId:'title-stacked@1',content:{title:'Developer'}}},
  stashes:{}
});
test('reserved JavaScript object-property names cannot become slots or content keys',()=>{
  const head=createEditorHead(base());
  assert.throws(()=>applyEditorTransaction(head,{
    operationId:uuid,baseRevision:0,intent:{kind:'ASSIGN_COMPONENT',slotKey:'__proto__',componentId:'safe@1'}
  }),{code:'VALIDATION'});
  const withReserved=base();
  withReserved.stashes=JSON.parse('{"__proto__":[]}') as PortfolioSnapshot['stashes'];
  assert.throws(()=>createEditorHead(withReserved),{code:'VALIDATION'});
  const withContent=base();
  withContent.slots.hero.content=JSON.parse('{"__proto__":"attack"}') as Record<string,string>;
  assert.throws(()=>createEditorHead(withContent),{code:'VALIDATION'});
});
test('a stashed owned source cannot refer to a missing or traversing file',()=>{
  const invalid=base();
  invalid.stashes.hero=[{
    state:'S2',componentId:'heading@1',content:{title:'old'},
    sourcePath:'slots/hero/../../admin/index.tsx',originalSource:'first'
  }];
  assert.throws(()=>createEditorHead(invalid),{code:'VALIDATION'});
  invalid.stashes.hero[0].sourcePath='slots/hero/index.tsx';
  assert.throws(()=>createEditorHead(invalid),{code:'VALIDATION'});
});
test('stashed S0 cannot smuggle source or omit pinned component',()=>{
  const invalid=base();
  invalid.stashes.hero=[{state:'S0',content:{title:'old'}}];
  assert.throws(()=>createEditorHead(invalid),{code:'VALIDATION'});
  invalid.stashes.hero=[{state:'S0',componentId:'heading@1',sourcePath:'slots/hero/index.tsx',content:{}}];
  assert.throws(()=>createEditorHead(invalid),{code:'VALIDATION'});
});
test('oversized pristine source and extra hidden assignment fields are rejected',()=>{
  const invalid=base();
  invalid.slots.hero={...invalid.slots.hero,originalSource:'x'.repeat(270000)};
  assert.throws(()=>createEditorHead(invalid),{code:'VALIDATION'});
  invalid.slots.hero={...base().slots.hero,extraSecret:'PRIVATE'} as unknown as SlotAssignment;
  assert.throws(()=>createEditorHead(invalid),{code:'VALIDATION'});
});
test('S1/S2 pristine vs modified source truth is enforced for active and stashed items',()=>{
  const valid=base();
  valid.files['slots/hero/index.tsx']='current';
  const source:SlotAssignment={
    state:'S2',componentId:'heading@1',content:{title:'old'},
    sourcePath:'slots/hero/index.tsx',originalSource:'original'
  };
  valid.stashes.hero=[source];
  assert.deepEqual(createEditorHead(valid).snapshot.stashes.hero,[source]);
  valid.stashes.hero=[{...source,state:'S1'}];
  assert.throws(()=>createEditorHead(valid),{code:'VALIDATION'});
  valid.stashes.hero=[{...source,state:'S2',originalSource:'current'}];
  assert.throws(()=>createEditorHead(valid),{code:'VALIDATION'});
});
test('normal owned-source modify, stash and restore still preserve bytes',()=>{
  const head=createEditorHead(base()),first=applyEditorTransaction(head,{
    operationId:uuid,baseRevision:0,
    intent:{kind:'CUSTOMIZE_COMPONENT',slotKey:'hero',copiedSource:'export const x=1;'}
  },{'title-stacked@1':'export const x=1;'});
  const cleared=applyEditorTransaction(first,{
    operationId:'20000000-0000-4000-8000-000000000002',baseRevision:1,
    intent:{kind:'CLEAR_SLOT',slotKey:'hero'}
  });
  assert.equal(cleared.snapshot.stashes.hero[0].state,'S1');
  const restored=applyEditorTransaction(cleared,{
    operationId:'30000000-0000-4000-8000-000000000003',baseRevision:2,
    intent:{kind:'RESTORE_STASH',slotKey:'hero'}
  });
  assert.equal(restored.snapshot.slots.hero.state,'S1');
  assert.equal(restored.snapshot.files[restored.snapshot.slots.hero.sourcePath!],'export const x=1;');
});
