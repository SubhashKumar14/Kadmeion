import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSafeStaticPreview,type SafePreviewInput} from '../../packages/editor-core/src/index.ts';

const id='10000000-0000-4000-8000-000000000001',sha='a'.repeat(64);
const fixture:SafePreviewInput={
  snapshot:{formatVersion:1,
    files:{'kadmeion.json':JSON.stringify({formatVersion:1,seo:{title:'Developer page',description:'Developer projects'}})},
    slots:{
      hero:{state:'S0',componentId:'title-stacked@1',content:{title:'Hello',subtitle:'Engineer'}},
      about:{state:'S0',componentId:'body-copy@1',content:{text:'About'}},
      link:{state:'S0',componentId:'external-link@1',content:{label:'Work',url:'https://example.com/work?a=1&b=2'}}
    },stashes:{}},
  frozen:{portfolioId:id,revision:1,snapshotSha256:sha,status:'FROZEN',publicUrl:null,visibilityIntent:'PUBLIC'},
  loadedPortfolioId:id,loadedRevision:1,loadedSnapshotSha256:sha,
  plan:[
    {slotKey:'hero',componentId:'title-stacked@1',kind:'heading',required:true},
    {slotKey:'about',componentId:'body-copy@1',kind:'paragraph',required:true},
    {slotKey:'link',componentId:'external-link@1',kind:'external-link',required:false}
  ]
};
const edit=(mod:Partial<SafePreviewInput>):SafePreviewInput=>({...fixture,...mod});
const has=(x:ReturnType<typeof prepareSafeStaticPreview>,code:string)=>x.blockers.some(y=>y.code===code);

test('noindex scriptless preview never claims publication',()=>{
  const a=prepareSafeStaticPreview(fixture),b=prepareSafeStaticPreview(fixture);
  assert.equal(a.status,'PREVIEW_ONLY');assert.equal(a.publicationReady,false);
  assert.equal(a.previewHtml,b.previewHtml);assert.ok(has(a,'PUBLIC_DELIVERY_UNVERIFIED'));
  assert.match(a.previewHtml??'',/<meta name="robots" content="noindex,nofollow,noarchive">/);
  assert.match(a.previewHtml??'',/script-src &#39;none&#39;/);
  assert.match(a.previewHtml??'',/https:\/\/example.com\/work\?a=1&amp;b=2/);
  assert.doesNotMatch(a.previewHtml??'',/<script\b/i);
});
test('malicious input is escaped without invoking custom HTML or source',()=>{
  const snapshot=structuredClone(fixture.snapshot);
  snapshot.slots.hero.content.title='<script>alert(1)</script>';
  snapshot.slots.about.content.text='<img src=x onerror=alert(1)>';
  const r=prepareSafeStaticPreview(edit({snapshot}));
  assert.equal(r.status,'PREVIEW_ONLY');
  assert.match(r.previewHtml??'',/&lt;script&gt;/);
  assert.match(r.previewHtml??'',/&lt;img/);
  assert.doesNotMatch(r.previewHtml??'',/<script|<img/);
});
test('cross-portfolio, stale revision and untrusted digest fail closed',()=>{
  for(const mismatch of [{loadedRevision:2},{loadedPortfolioId:'20000000-0000-4000-8000-000000000002'},{loadedSnapshotSha256:'b'.repeat(64)}]){
    const r=prepareSafeStaticPreview(edit(mismatch));
    assert.ok(has(r,'FROZEN_REVISION_MISMATCH'));assert.equal(r.previewHtml,null);
  }
});
test('required empty slot blocks but does not discard stash',()=>{
  const snapshot=structuredClone(fixture.snapshot);
  snapshot.stashes.hero=[snapshot.slots.hero];
  snapshot.slots.hero={state:'EMPTY',content:{}};
  const r=prepareSafeStaticPreview(edit({snapshot}));
  assert.ok(has(r,'REQUIRED_SLOT_EMPTY'));assert.equal(r.previewHtml,null);
  assert.equal(snapshot.stashes.hero[0].content.title,'Hello');
});
test('active S2 and opaque source cannot pass publication preflight',()=>{
  const snapshot=structuredClone(fixture.snapshot);
  snapshot.files['slots/hero/index.tsx']='fetch("https://attacker.invalid")';
  snapshot.slots.hero={state:'S2',componentId:'title-stacked@1',
    content:{title:'Hi'},sourcePath:'slots/hero/index.tsx',originalSource:'old'};
  const r=prepareSafeStaticPreview(edit({snapshot}));
  assert.ok(has(r,'CUSTOM_SOURCE_UNTRUSTED'));assert.equal(r.previewHtml,null);
});
test('inactive owned code is privately preserved but never copied',()=>{
  const snapshot=structuredClone(fixture.snapshot);
  snapshot.files['slots/hero/index.tsx']='SECRET_PRIVATE_CODE';
  const r=prepareSafeStaticPreview(edit({snapshot}));
  assert.equal(r.status,'PREVIEW_ONLY');
  assert.ok(r.warnings.some(x=>x.code==='OWNED_SOURCE_OMITTED'));
  assert.ok(!r.previewHtml?.includes('SECRET_PRIVATE_CODE'));
});
test('unmapped active components and mismatched pins reject',()=>{
  const r=prepareSafeStaticPreview(edit({plan:[{slotKey:'hero',componentId:'other-pin@1',kind:'heading',required:true}]}));
  assert.ok(has(r,'COMPONENT_PIN_MISMATCH'));
  assert.ok(has(r,'UNMAPPED_ACTIVE_SLOT'));
});
test('unexpected private content fields never leak',()=>{
  const snapshot=structuredClone(fixture.snapshot);snapshot.slots.hero.content.secret='confidential';
  const r=prepareSafeStaticPreview(edit({snapshot}));
  assert.ok(has(r,'UNKNOWN_PUBLIC_FIELD'));assert.equal(r.previewHtml,null);
});
test('untrusted external URLs are rejected',()=>{
  for(const url of ['http://example.com','javascript:alert(1)','https://127.0.0.1','https://localhost']){
    const snapshot=structuredClone(fixture.snapshot);snapshot.slots.link.content.url=url;
    const r=prepareSafeStaticPreview(edit({snapshot}));
    assert.ok(has(r,'UNSAFE_LINK'));assert.equal(r.previewHtml,null);
  }
});
test('missing SEO and malformed source snapshot reject',()=>{
  const snapshot=structuredClone(fixture.snapshot);
  snapshot.files['kadmeion.json']='{"formatVersion":1}';
  assert.ok(has(prepareSafeStaticPreview(edit({snapshot})),'SEO_METADATA_REQUIRED'));
  snapshot.files['kadmeion.json']='{bad';
  assert.ok(has(prepareSafeStaticPreview(edit({snapshot})),'INVALID_SNAPSHOT'));
});
test('duplicate render-plan keys never produce bytes',()=>{
  const r=prepareSafeStaticPreview(edit({plan:[fixture.plan[0],fixture.plan[0]]}));
  assert.ok(has(r,'INVALID_RENDER_PLAN'));assert.equal(r.previewHtml,null);
});


test('safe text-only preview renders badge, list, project card and author-reported metrics',()=>{
  const snapshot=structuredClone(fixture.snapshot);
  snapshot.slots.badge={state:'S0',componentId:'technology-tag@1',content:{text:'TypeScript'}};
  snapshot.slots.metric={state:'S0',componentId:'author-metric@1',content:{label:'Experience',value:'2 years'}};
  snapshot.slots.skills={state:'S0',componentId:'skills-list@1',
    content:{items:JSON.stringify(['PostgreSQL','TypeScript','<unsafe>'])}};
  snapshot.slots.project={state:'S0',componentId:'project-card@1',content:{
    title:'Private <work>',summary:'A & B',url:'https://example.com/work?a=1&b=2'}};
  const plan=[...fixture.plan,
    {slotKey:'badge',componentId:'technology-tag@1',kind:'badge' as const,required:true},
    {slotKey:'metric',componentId:'author-metric@1',kind:'metric' as const,required:true},
    {slotKey:'skills',componentId:'skills-list@1',kind:'list' as const,required:true},
    {slotKey:'project',componentId:'project-card@1',kind:'project-card' as const,required:true}
  ];
  const result=prepareSafeStaticPreview(edit({snapshot,plan}));
  assert.equal(result.status,'PREVIEW_ONLY');
  const html=result.previewHtml??'';
  assert.match(html,/<span class="k-badge">TypeScript<\/span>/);
  assert.match(html,/data-provenance="author"/);
  assert.doesNotMatch(html,/data-verified|verified-badge/);
  assert.match(html,/<li>&lt;unsafe&gt;<\/li>/);
  assert.match(html,/<article class="k-project-card">/);
  assert.match(html,/&lt;work&gt;/);
  assert.match(html,/https:\/\/example.com\/work\?a=1&amp;b=2/);
  assert.doesNotMatch(html,/<script|<img|onerror=/i);
  assert.equal(result.publicationReady,false);
});
test('list output rejects unbounded arrays and nonstring values',()=>{
  for(const items of [
    'not-json','[]',JSON.stringify(Array(25).fill('skill')),
    JSON.stringify(['legit',null]),JSON.stringify([{}]),
    JSON.stringify(['x'.repeat(201)])
  ]){
    const snapshot=structuredClone(fixture.snapshot);
    snapshot.slots.skills={state:'S0',componentId:'skills-list@1',content:{items}};
    const result=prepareSafeStaticPreview(edit({snapshot,plan:[...fixture.plan,
      {slotKey:'skills',componentId:'skills-list@1',kind:'list',required:true}]}));
    assert.ok(has(result,'INVALID_LIST'));assert.equal(result.previewHtml,null);
  }
});
test('metric, badge and project fields fail closed without inventing claims',()=>{
  for(const [kind,content,code] of [
    ['badge',{text:'Hello',secret:'do-not-release'},'INVALID_BADGE'],
    ['metric',{label:'Followers',value:'123',provider_verified:'true'},'INVALID_METRIC'],
    ['project-card',{title:'Project',summary:'Real',url:'javascript:alert(1)'},'UNSAFE_LINK'],
    ['project-card',{title:'Project',summary:'Real',private_notes:'secret'},'INVALID_PROJECT_CARD']
  ] as const){
    const snapshot=structuredClone(fixture.snapshot);
    snapshot.slots.extra={state:'S0',componentId:'safe-card@1',content};
    const result=prepareSafeStaticPreview(edit({snapshot,plan:[...fixture.plan,
      {slotKey:'extra',componentId:'safe-card@1',kind,required:true}]}));
    assert.ok(has(result,code));assert.equal(result.previewHtml,null);
  }
});


test('trusted layout grouping preserves section order and independent portfolio colors',()=>{
  const input=edit({renderSections:[{id:'hero',layout:'L1',slotKeys:['hero','about','link']}],
    portfolioTheme:{mode:'dark',surface:'#15171a',text:'#f2f3f4',accent:'#9a8967'}});
  const result=prepareSafeStaticPreview(input);
  assert.equal(result.status,'PREVIEW_ONLY');
  assert.match(result.previewHtml??'',/data-layout="L1" data-section="hero"/);
  assert.match(result.previewHtml??'',/color:#f2f3f4;background:#15171a;color-scheme:dark/);
  assert.match(result.previewHtml??'',/@media\(max-width:48rem\)/);
  assert.equal(result.publicationReady,false);
});
test('untrusted layout grouping and malformed color tokens never produce HTML',()=>{
  for(const renderSections of [
    [{id:'hero" onclick="bad',layout:'L1',slotKeys:['hero','about','link']}],
    [{id:'hero',layout:'L9',slotKeys:['hero','about','link']}],
    [{id:'hero',layout:'L1',slotKeys:['hero','link','about']}],
    [{id:'hero',layout:'L1',slotKeys:['hero','about','link','private']}]
  ]){
    const result=prepareSafeStaticPreview(edit({renderSections}));
    assert.ok(has(result,'INVALID_TEMPLATE_GROUPING'));
    assert.equal(result.previewHtml,null);
  }
  const invalid=prepareSafeStaticPreview(edit({portfolioTheme:{
    mode:'dark',surface:'url(https://evil.invalid)',text:'#ffffff',accent:'#999999'
  }}));
  assert.ok(has(invalid,'INVALID_PORTFOLIO_THEME'));assert.equal(invalid.previewHtml,null);
});
