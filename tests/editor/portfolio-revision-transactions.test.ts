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
 

test('owner section reorder preserves slot ownership, is undoable, and rejects invalid boundaries',()=>{
  const original=createEditorHead(createPortfolioPresetDraft('arc'));
  const initial=JSON.parse(original.snapshot.files['pages/home.page.json']).sections as Array<{id:string}>;
  assert.ok(initial.length>2);
  const first=initial[0].id;
  const second=initial[1].id;
  const moved=applyEditorTransaction(original,op(original,{kind:'MOVE_SECTION',sectionId:first,direction:'down'}));
  const order=JSON.parse(moved.snapshot.files['pages/home.page.json']).sections as Array<{id:string}>;
  assert.equal(order[0].id,second);
  assert.equal(order[1].id,first);
  assert.deepEqual(moved.snapshot.slots,original.snapshot.slots);
  assert.deepEqual(moved.snapshot.stashes,original.snapshot.stashes);
  assert.equal(JSON.parse(original.snapshot.files['pages/home.page.json']).sections[0].id,first);
  const undone=applyEditorTransaction(moved,op(moved,{kind:'UNDO'}));
  assert.deepEqual(undone.snapshot.files['pages/home.page.json'],original.snapshot.files['pages/home.page.json']);
  assert.throws(()=>applyEditorTransaction(original,op(original,{
    kind:'MOVE_SECTION',sectionId:first,direction:'up'})),{code:'VALIDATION'});
  assert.throws(()=>applyEditorTransaction(original,op(original,{
    kind:'MOVE_SECTION',sectionId:'not-present',direction:'down'})),{code:'VALIDATION'});
  assert.throws(()=>applyEditorTransaction(original,op(original,{
    kind:'MOVE_SECTION',sectionId:first,direction:'sideways' as never})),{code:'VALIDATION'});
});

/** C10 contract tests: must be composed with S3's real engine, never skipped.
 * Local type bridge intentionally describes the approved pending public engine
 * interface without requiring this test-only branch to own its declaration. */
type C10Request={sectionId:string;expectedLayout:string;targetLayout:string;
  mappings:Array<{fromSlotKey:string;toSlotKey:string|null}>};
type C10Intent=({kind:'CHANGE_SECTION_LAYOUT';expectedRevision:number;confirmStash:boolean;
  confirmOwnedRelocation:boolean}&C10Request)|{kind:'RESTORE_LAYOUT_STASH';fromSlotKey:string;
  stashIndex:number;toSlotKey:string;expectedRevision:number;confirmOwnedRelocation:boolean};
async function c10Planner(){
  const engine=await import('../../packages/editor-core/src/portfolio-revision-transactions.ts');
  const planner=(engine as unknown as {planSectionLayoutChange?:(
    head:EditorHead,request:C10Request)=>{requiresStashConfirmation:boolean;requiresOwnedRelocationConfirmation:boolean}})
    .planSectionLayoutChange;
  assert.equal(typeof planner,'function','Approved C10 engine planner must be present');
  return planner!;
}
const c10Apply=(head:EditorHead,intent:C10Intent,operationId='75000000-0000-4000-8000-000000000001')=>
  applyEditorTransaction(head,{operationId,baseRevision:head.revision,
    intent:intent as Parameters<typeof applyEditorTransaction>[1]['intent']});
const c10Fixture=()=>{
  const draft=createPortfolioPresetDraft('arc');
  const page=JSON.parse(draft.files['pages/home.page.json']);
  page.privateUnknown={preserve:'opaque'};
  page.sections[0].privateUnknown={preserve:'section metadata'};
  draft.files['pages/home.page.json']=JSON.stringify(page,null,2);
  const p='arc-hero-';
  const source='\uFEFFimport {x} from "./relative";\r\nexport const link=x;\r\n';
  const original='export const link="Original";';
  const sourcePath='slots/arc-hero-cta1/index.tsx';
  draft.files[sourcePath]=source;
  draft.slots[p+'cta1']={state:'S2',componentId:'external-link@1',
    content:{label:'Private CTA',url:'https://example.com/',unknown:'preserve field'},sourcePath,originalSource:original};
  draft.slots[p+'text'].content={text:'Body goes to Unplaced'};
  draft.stashes[p+'cta1']=[{state:'S0',componentId:'external-link@1',content:{label:'Older stash'}}];
  const head=createEditorHead(draft);
  const request:C10Request={sectionId:'arc-hero',expectedLayout:'arc-hero@1',targetLayout:'stepped-hero@1',
    mappings:[
      {fromSlotKey:p+'title',toSlotKey:p+'title'},
      {fromSlotKey:p+'text',toSlotKey:null},
      {fromSlotKey:p+'cta1',toSlotKey:p+'cta'},
      {fromSlotKey:p+'cta2',toSlotKey:null},
      {fromSlotKey:p+'note',toSlotKey:null}
    ]};
  const intent:C10Intent={kind:'CHANGE_SECTION_LAYOUT',...request,expectedRevision:0,
    confirmStash:true,confirmOwnedRelocation:true};
  return {head,request,intent,p,source,original,sourcePath};
};
test('C10 atomic layout preview and apply preserve opaque source, stashes and unrelated sections; Undo exact',async()=>{
  const {head,request,intent,p,source,original,sourcePath}=c10Fixture();
  const before=structuredClone(head),plan=await c10Planner();
  const receipt=plan(head,request);
  assert.equal(receipt.requiresStashConfirmation,true);
  assert.equal(receipt.requiresOwnedRelocationConfirmation,true);
  assert.deepEqual(head,before,'Pure preview must not modify the working head');
  const changed=c10Apply(head,intent);
  assert.equal(changed.revision,1);assert.equal(changed.undo.length,1);
  const page=JSON.parse(changed.snapshot.files['pages/home.page.json']);
  const oldPage=JSON.parse(before.snapshot.files['pages/home.page.json']);
  assert.equal(page.sections[0].id,'arc-hero');assert.equal(page.sections[0].layout,'stepped-hero@1');
  assert.deepEqual(page.sections[0].slotKeys,['title','cta']);
  assert.deepEqual(page.sections.slice(1),oldPage.sections.slice(1));
  assert.deepEqual(page.privateUnknown,oldPage.privateUnknown);
  assert.deepEqual(page.sections[0].privateUnknown,oldPage.sections[0].privateUnknown);
  assert.deepEqual(changed.snapshot.slots[p+'title'],before.snapshot.slots[p+'title']);
  assert.equal(Object.hasOwn(changed.snapshot.slots,p+'text'),false);
  assert.deepEqual(changed.snapshot.stashes[p+'text'].at(-1),before.snapshot.slots[p+'text']);
  assert.deepEqual(changed.snapshot.stashes[p+'cta1'][0],before.snapshot.stashes[p+'cta1'][0]);
  assert.deepEqual(changed.snapshot.stashes[p+'cta1'].at(-1),before.snapshot.slots[p+'cta1']);
  const relocated=changed.snapshot.slots[p+'cta'];
  assert.equal(relocated.state,'S2');assert.equal(relocated.originalSource,original);
  assert.deepEqual(relocated.content,before.snapshot.slots[p+'cta1'].content);
  assert.equal(relocated.sourcePath,'slots/arc-hero-cta/owned/75000000-0000-4000-8000-000000000001/component-source.tsx');
  assert.equal(changed.snapshot.files[sourcePath],source);
  assert.equal(changed.snapshot.files[relocated.sourcePath!],source);
  assert.deepEqual(head,before);
  assert.deepEqual(applyEditorTransaction(changed,{operationId:'75000000-0000-4000-8000-000000000001',
    baseRevision:0,intent:intent as Parameters<typeof applyEditorTransaction>[1]['intent']}),changed,
    'Identical operation replay does not advance revision');
  const undone=applyEditorTransaction(changed,op(changed,{kind:'UNDO'}));
  assert.deepEqual(undone.snapshot,before.snapshot);
});
test('C10 stale preview, missing confirmation, duplicate target, incompatible mapping and source collision are atomic denials',async()=>{
  const {head,intent,request,p}=c10Fixture(),before=structuredClone(head);
  const planner=await c10Planner();
  for(const malformed of [
    {...request,mappings:request.mappings.slice(1)},
    {...request,mappings:request.mappings.map((row,i)=>i===2?{...row,toSlotKey:p+'title'}:row)},
    {...request,mappings:request.mappings.map((row,i)=>i===1?{...row,toSlotKey:p+'cta'}:row)},
    {...request,mappings:request.mappings.map((row,i)=>i===2?{...row,toSlotKey:'contact-cta1'}:row)}
  ])assert.throws(()=>planner(head,malformed));
  for(const denial of [{...intent,expectedRevision:1},{...intent,confirmStash:false},
    {...intent,confirmOwnedRelocation:false}]){
    assert.throws(()=>c10Apply(head,denial));assert.deepEqual(head,before);
  }
  const occupied=structuredClone(head);
  occupied.snapshot.files['slots/arc-hero-cta/owned/75000000-0000-4000-8000-000000000001/component-source.tsx']='unrelated owner bytes';
  const collisionBefore=structuredClone(occupied);
  assert.throws(()=>c10Apply(occupied,intent));
  assert.deepEqual(occupied,collisionBefore);
});
test('C10 Unplaced restore targets a declared EMPTY compatible slot and never rewrites original source',async()=>{
  const {head,intent,p,source,sourcePath}=c10Fixture();
  await c10Planner();
  const changed=c10Apply(head,intent);
  const cleared=applyEditorTransaction(changed,op(changed,{kind:'CLEAR_SLOT',slotKey:p+'cta'}));
  const before=structuredClone(cleared);
  const restore:C10Intent={kind:'RESTORE_LAYOUT_STASH',fromSlotKey:p+'cta1',
    stashIndex:changed.snapshot.stashes[p+'cta1'].length-1,toSlotKey:p+'cta',
    expectedRevision:cleared.revision,confirmOwnedRelocation:true};
  assert.throws(()=>c10Apply(cleared,{...restore,confirmOwnedRelocation:false},
    '75000000-0000-4000-8000-000000000002'));
  assert.deepEqual(cleared,before);
  const moved=c10Apply(cleared,restore,'75000000-0000-4000-8000-000000000002');
  const result=moved.snapshot.slots[p+'cta'];
  assert.equal(result.state,'S2');
  assert.equal(moved.snapshot.files[sourcePath],source);
  assert.equal(moved.snapshot.files[result.sourcePath!],source);
  assert.equal(moved.snapshot.stashes[p+'cta1'].length,before.snapshot.stashes[p+'cta1'].length-1);
  assert.deepEqual(moved.snapshot.stashes[p+'cta1'][0],before.snapshot.stashes[p+'cta1'][0]);
  assert.deepEqual(cleared,before);
  assert.throws(()=>c10Apply(changed,{...restore,expectedRevision:changed.revision},
    '75000000-0000-4000-8000-000000000003'),'Occupied target must not replace current assignment');
});
