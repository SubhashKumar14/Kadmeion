import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEditorTransaction, createEditorHead, createPortfolioPresetDraft, restoreHistoricalSnapshot, savedComponentInputFromOwnedSlot, type EditorHead, type PortfolioSnapshot } from '../../packages/editor-core/src/index.ts';

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

test('the five documented presets and Blank initialize valid drafts with independent assignments',()=>{
  for(const [preset,header,sections] of [
    ['arc','header-pill','arc-hero project-showcase editorial-bento skills contact'],
    ['collage','header-cta','collage-hero project-showcase experience contact'],
    ['editorial','header-menu','editorial-bento project-showcase skills contact'],
    ['stairs','header-menu','stepped-hero editorial-bento project-showcase contact'],
    ['studio','header-full','arc-hero project-showcase experience skills contact']
  ] as const){
    const first=createEditorHead(createPortfolioPresetDraft(preset));
    const page=first.snapshot.files['pages/home.page.json'];
    assert.equal(JSON.parse(page).header.layout,header+'@1');
    assert.deepEqual(JSON.parse(page).sections.map((section:{layout:string})=>section.layout),
      sections.split(' ').map(layout=>layout+'@1'));
    const title=sections.split(' ')[0]+'-title';
    const next=applyEditorTransaction(first,op(first,{
      kind:'ASSIGN_COMPONENT',slotKey:title,componentId:'title-stacked@1'
    }));
    assert.equal(next.snapshot.slots[title].state,'S0');
    assert.equal(next.snapshot.files['pages/home.page.json'],page);
    assert.equal(createPortfolioPresetDraft(preset).slots[title].state,'S0');
    assert.equal(createPortfolioPresetDraft(preset).slots[title].componentId,'title-stacked@1');
    assert.deepEqual(first.snapshot.slots[title].content,{});
    assert.deepEqual(next.snapshot.stashes[title][0].content,{});
  }
  assert.deepEqual(createEditorHead(createPortfolioPresetDraft('blank')).snapshot.slots,{});
  assert.throws(()=>createPortfolioPresetDraft('constructor' as never),{code:'VALIDATION'});
});

test('curated presets pin safe starters without invented content or automatic media exposure',()=>{
  for(const preset of ['arc','collage','editorial','stairs','studio'] as const){
    const draft=createPortfolioPresetDraft(preset);
    const validated=createEditorHead(draft);
    const assigned=Object.entries(validated.snapshot.slots).filter(([,slot])=>slot.state==='S0');
    assert.ok(assigned.length>0);
    for(const [key,slot] of Object.entries(validated.snapshot.slots)){
      assert.deepEqual(slot.content,{},key+' must never fabricate the author profile or project');
      if (/(?:-avatar|-thumbs|-media|-image|-imagea|-imageb)$/.test(key)){
        assert.equal(slot.state,'EMPTY',key+' requires real, separately validated media');
        assert.equal(slot.componentId,undefined);
      }
      if(slot.state==='S0'){
        assert.match(slot.componentId??'',/^[a-z][a-z0-9-]*@1$/);
        assert.equal(slot.sourcePath,undefined);
      }
    }
    const changed=createPortfolioPresetDraft(preset);
    const firstKey=Object.keys(changed.slots)[0];
    changed.slots[firstKey].content.title='Only this draft';
    assert.deepEqual(createPortfolioPresetDraft(preset).slots[firstKey].content,{},
      'Preset construction must not share mutable user data');
  }
  const blank=createPortfolioPresetDraft('blank');
  assert.deepEqual(blank.slots,{});
  assert.deepEqual(JSON.parse(blank.files['pages/home.page.json']).sections,[]);
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


test('managed JSON denies prototype keys, deep nesting and oversized graphs without altering saved bytes',()=>{
  const original=make(),baseline=original.snapshot.files['pages/home.page.json'];
  const malicious=[
    '{"__proto__":{"isAdmin":true}}',
    '{"nested":{"constructor":{"prototype":{"danger":true}}}}',
    '{"a":'+('[ '.repeat(40))+'0'+(' ]'.repeat(40))+'}',
    JSON.stringify({rows:Array.from({length:513},(_,i)=>i)}),
    JSON.stringify(Object.fromEntries(Array.from({length:513},(_,i)=>['field'+i,i])))
  ];
  for(const source of malicious){
    const cmd=op(original,{kind:'WRITE_MANAGED_FILE',path:'pages/home.page.json',source});
    assert.throws(()=>applyEditorTransaction(original,cmd),{code:'VALIDATION'});
    assert.equal(original.snapshot.files['pages/home.page.json'],baseline);
    assert.equal(original.revision,0);
  }
});

test('schema envelope rejects hidden snapshot fields while preserving benign unknown JSON keys',()=>{
  const head=make();
  assert.throws(()=>createEditorHead({...head.snapshot,ownerIsAdmin:true} as PortfolioSnapshot),{
    code:'VALIDATION'});
  const valid='{\n  "vendorExtension": {"customLabel": "preserved"},\n  "sections": []\n}';
  const next=applyEditorTransaction(head,op(head,{kind:'WRITE_MANAGED_FILE',
    path:'pages/home.page.json',source:valid}));
  assert.equal(next.snapshot.files['pages/home.page.json'],valid);
});


test('reordered equivalent editor commands replay idempotently by canonical UUID',()=>{
  const original=make();
  const first={
    operationId:'A0000000-0000-4000-8000-000000000005',baseRevision:0,
    intent:{kind:'UPDATE_CONTENT' as const,slotKey:'hero',content:{title:'Third',subtitle:'Owner'}}
  };
  const saved=applyEditorTransaction(original,first);
  const replay={
    baseRevision:0,intent:{content:{subtitle:'Owner',title:'Third'},slotKey:'hero',
      kind:'UPDATE_CONTENT' as const},
    operationId:'a0000000-0000-4000-8000-000000000005'
  };
  assert.strictEqual(applyEditorTransaction(saved,replay),saved);
  assert.equal(Object.keys(saved.operations).length,1);
  assert.equal(saved.snapshot.slots.hero.content.title,'Third');
  assert.throws(()=>applyEditorTransaction(saved,{...replay,
    intent:{...replay.intent,content:{title:'CHANGED'}}}),{code:'VALIDATION'});
});

test('runtime rejects unknown no-op intents and hidden transaction properties',()=>{
  const head=make(),operationId='b0000000-0000-4000-8000-000000000005';
  for(const command of [
    {operationId,baseRevision:0,intent:{kind:'DELETE_EVERYTHING',slotKey:'hero'}},
    {operationId,baseRevision:0,intent:{kind:'CLEAR_SLOT',slotKey:'hero',extra:'hidden'}},
    {operationId,baseRevision:0,intent:{kind:'CLEAR_SLOT',slotKey:'hero'},privateToken:'do-not-log'},
    {operationId,baseRevision:-1,intent:{kind:'UNDO'}}
  ]){
    assert.throws(()=>applyEditorTransaction(head,command as never),{code:'VALIDATION'});
    assert.equal(head.revision,0);
    assert.equal(Object.keys(head.operations).length,0);
  }
});


test('a legacy insertion-order operation record remains safely replayable after upgrade',()=>{
  const original=make();
  const command={
    operationId:'c0000000-0000-4000-8000-000000000009',
    baseRevision:0,
    intent:{kind:'UPDATE_CONTENT' as const,slotKey:'hero',content:{title:'Legacy'}}
  };
  const saved=applyEditorTransaction(original,command);
  const legacy={...saved,operations:{[command.operationId]:JSON.stringify(command)}};
  const replay={intent:{content:{title:'Legacy'},slotKey:'hero',
    kind:'UPDATE_CONTENT' as const},baseRevision:0,operationId:command.operationId};
  assert.strictEqual(applyEditorTransaction(legacy,replay),legacy);
  assert.throws(()=>applyEditorTransaction(legacy,{
    ...replay,intent:{...replay.intent,content:{title:'Altered'}}}),{code:'VALIDATION'});
});

test('malformed runtime slot identifiers cannot coerce to an existing slot',()=>{
  const snapshot=make().snapshot;
  snapshot.slots.undefined={state:'S0',componentId:'title-stacked@1',content:{title:'Untouched'}};
  const head=createEditorHead(snapshot);
  for(const slotKey of [undefined,null,123,{},[]]){
    assert.throws(()=>applyEditorTransaction(head,{
      operationId:'d0000000-0000-4000-8000-000000000001',baseRevision:0,
      intent:{kind:'CLEAR_SLOT',slotKey}
    } as never),{code:'VALIDATION'});
  }
  assert.equal(head.snapshot.slots.undefined.content.title,'Untouched');
  assert.equal(head.revision,0);
});

test('WF-025 a saved private owned component reuses exact bytes only in compatible slots',()=>{
  const head=createEditorHead({
    formatVersion:1,
    files:{'kadmeion.json':'{"formatVersion":1}'},
    slots:{
      'arc-hero-title':{state:'EMPTY',content:{}},
      'arc-hero-text':{state:'EMPTY',content:{}}
    },stashes:{}
  });
  const id='96000000-0000-4000-8000-000000000001';
  const saved={
    id,owner_user_id:'96000000-0000-4000-8000-000000000002',
    component_key:'my-title',version:1,display_name:'My Title',
    base_component_pin:'title-stacked@1',pristine_source:'export const title=1;',
    source_code:'export const title=2;',compatible_slot_kinds:['title'],
    source_sha256:'a'.repeat(64),created_at:'2026-11-15T11:00:00Z'
  };
  const cmd={operationId:'96000000-0000-4000-8000-000000000003',
    baseRevision:0,intent:{kind:'REUSE_SAVED_COMPONENT' as const,
      slotKey:'arc-hero-title',componentVersionId:id}};
  assert.throws(()=>applyEditorTransaction(head,cmd),{code:'VALIDATION'});
  const next=applyEditorTransaction(head,cmd,{}, {[id]:saved});
  assert.equal(next.snapshot.slots['arc-hero-title'].state,'S2');
  assert.equal(next.snapshot.slots['arc-hero-title'].componentId,'title-stacked@1');
  const path=next.snapshot.slots['arc-hero-title'].sourcePath!;
  assert.equal(next.snapshot.files[path],'export const title=2;');
  assert.equal(next.snapshot.slots['arc-hero-title'].originalSource,'export const title=1;');
  assert.strictEqual(applyEditorTransaction(next,cmd,{},{}),next,'idempotent replay needs no new fetch');
  assert.deepEqual(head.snapshot.slots['arc-hero-title'],{state:'EMPTY',content:{}});
  const other={...cmd,operationId:'96000000-0000-4000-8000-000000000004',
    intent:{...cmd.intent,slotKey:'arc-hero-text'}};
  assert.throws(()=>applyEditorTransaction(head,other,{}, {[id]:saved}),{code:'VALIDATION'});
});

test('WF-025 no user-saved file can impersonate S1 without matching pinned library bytes',()=>{
  const head=createEditorHead({
    formatVersion:1,files:{'kadmeion.json':'{"formatVersion":1}'},
    slots:{'arc-hero-title':{state:'S0',componentId:'title-stacked@1',content:{title:'Prior'}}},
    stashes:{}
  });
  const id='97000000-0000-4000-8000-000000000001';
  const source='export const title="Saved text";';
  const saved={
    id,owner_user_id:'97000000-0000-4000-8000-000000000002',
    component_key:'my-title',version:1,display_name:'My Title',
    base_component_pin:'title-stacked@1',pristine_source:source,source_code:source,
    compatible_slot_kinds:['title'],source_sha256:'a'.repeat(64),
    created_at:'2026-11-15T11:00:00Z'
  };
  const command={operationId:'97000000-0000-4000-8000-000000000003',
    baseRevision:0,intent:{kind:'REUSE_SAVED_COMPONENT' as const,
      slotKey:'arc-hero-title',componentVersionId:id}};
  const unsafe=applyEditorTransaction(head,command,{}, {[id]:saved});
  assert.equal(unsafe.snapshot.slots['arc-hero-title'].state,'S2');
  assert.equal(unsafe.snapshot.files[unsafe.snapshot.slots['arc-hero-title'].sourcePath!],source);
  assert.notEqual(unsafe.snapshot.slots['arc-hero-title'].originalSource,source);
  assert.equal(unsafe.snapshot.stashes['arc-hero-title'][0].content.title,'Prior');
  const pinned=applyEditorTransaction(head,command,
    {'title-stacked@1':source},{[id]:saved});
  assert.equal(pinned.snapshot.slots['arc-hero-title'].state,'S1');
  assert.equal(pinned.snapshot.slots['arc-hero-title'].originalSource,source);
  const forged={...saved,compatible_slot_kinds:['text']};
  assert.throws(()=>applyEditorTransaction(head,command,{}, {[id]:forged}),
    {code:'VALIDATION'});
});

test('WF-025 capture My Component from a committed owned source without losing byte provenance',()=>{
  const snap=createEditorHead({formatVersion:1,
    files:{'kadmeion.json':'{"formatVersion":1}'},
    slots:{'arc-hero-title':{state:'S0',componentId:'title-stacked@1',content:{title:'First'}}},
    stashes:{}
  });
  const trusted='export const t = "pristine";';
  const first=applyEditorTransaction(snap,{
    operationId:'91000000-0000-4000-8000-000000000001',baseRevision:0,
    intent:{kind:'CUSTOMIZE_COMPONENT',slotKey:'arc-hero-title',copiedSource:trusted}
  },{'title-stacked@1':trusted});
  const modified='export const t = "owner";';
  const changed=applyEditorTransaction(first,{
    operationId:'91000000-0000-4000-8000-000000000002',baseRevision:1,
    intent:{kind:'EDIT_OWNED_SOURCE',slotKey:'arc-hero-title',source:modified}
  });
  const id='91000000-0000-4000-8000-000000000003';
  const options={operationId:id,componentKey:'personal-heading',displayName:'Personal Heading',
    compatibleSlotKinds:['title','text']};
  const exported=savedComponentInputFromOwnedSlot(changed.snapshot,'arc-hero-title',options);
  assert.deepEqual(exported,{
    operationId:id,componentKey:'personal-heading',displayName:'Personal Heading',
    baseComponentPin:'title-stacked@1',pristineSource:trusted,
    sourceCode:modified,compatibleSlotKinds:['text','title']
  });
  assert.equal(changed.snapshot.slots['arc-hero-title'].state,'S2');
  assert.equal(first.snapshot.files[first.snapshot.slots['arc-hero-title'].sourcePath!],trusted);
  assert.throws(()=>savedComponentInputFromOwnedSlot(snap.snapshot,'arc-hero-title',options),
    {code:'VALIDATION'},'A protected S0 block is not saved as a fabricated user component');
  for(const bad of [
    {...options,compatibleSlotKinds:['image']},
    {...options,compatibleSlotKinds:['title','title']},
    {...options,compatibleSlotKinds:['title','__proto__']},
    {...options,displayName:' '},
    {...options,operationId:'not-an-id'}
  ])assert.throws(()=>savedComponentInputFromOwnedSlot(changed.snapshot,'arc-hero-title',bad),
    {code:'VALIDATION'});
});
