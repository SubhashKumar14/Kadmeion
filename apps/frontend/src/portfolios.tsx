import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  applyEditorTransaction, createEditorHead, restoreHistoricalSnapshot, type EditorHead, type EditorIntent, type PortfolioSnapshot
} from '../../../packages/editor-core/src/portfolio-revision-transactions.ts';
import { portfolioLayout, type PortfolioPresetId } from '../../../packages/editor-core/src/managed-project-files.ts';
import type { MyComponentVersion } from '../../../packages/contracts/src/private-my-components-service.ts';
import type { OwnerPortfolio, SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
import { Icon } from './landing.tsx';
import { TemplateGraphic } from './templates.tsx';
import { AssetList, ComponentLibrary, PortfolioCanvas, RevisionHistory, SourceInspector, ThemeInspector } from './portfolio-tools.tsx';

const presets = [
  {id: 'arc', title: 'Arc', tone: 'curved', detail: 'Curved hero and a project showcase.'},
  {id: 'collage', title: 'Collage', tone: 'interlocking', detail: 'Interlocking images and featured projects.'},
  {id: 'editorial', title: 'Editorial', tone: 'editorial', detail: 'Modular typography and a layout built around content.'},
  {id: 'stairs', title: 'Stairs', tone: 'stepped', detail: 'A stepped composition with a restrained opening.'},
  {id: 'studio', title: 'Studio', tone: 'modular', detail: 'A project-led layout with room for experience and skills.'},
  {id: 'blank', title: 'Blank', tone: 'blank', detail: 'A private starting point with no preset sections.'}
] as const satisfies readonly {id: PortfolioPresetId; title: string; tone: string; detail: string}[];

const sectionLayouts = [
  ['arc-hero@1', 'Arc hero'], ['collage-hero@1', 'Collage hero'],
  ['project-showcase@1', 'Project showcase'], ['editorial-bento@1', 'Editorial grid'],
  ['stepped-hero@1', 'Stepped hero'], ['skills@1', 'Skills'], ['experience@1', 'Experience'], ['contact@1', 'Contact']
] as const;

const contentFields = {
  'title-stacked@1': ['title', 'subtitle'],
  'body-copy@1': ['text'],
  'external-link@1': ['label', 'url'],
  'project-card@1': ['title', 'summary', 'url'],
  'skills-list@1': ['items'],
  'experience-list@1': ['items'],
  'technology-tag@1': ['text'],
  'author-metric@1': ['label', 'value']
} as const satisfies Record<string, readonly string[]>;

function primaryField(component?: string): string {
  return component && Object.hasOwn(contentFields, component)
    ? contentFields[component as keyof typeof contentFields][0] : 'text';
}

/** The JSONB slot map is unordered. Navigation must follow saved page section
 * order and each pinned layout's declared slot order, never object key sort. */
function orderedLayerGroups(snapshot:PortfolioSnapshot | null | undefined):Array<{
  id:string;title:string;slots:Array<{key:string;name:string;state:string;componentId?:string}>;
}> {
  const source=snapshot?.files['pages/home.page.json'];
  if(!source||!snapshot)return [];
  try {
    const page:unknown=JSON.parse(source);
    if(!page||typeof page!=='object'||Array.isArray(page)||!('sections' in page)||
      !Array.isArray(page.sections))return [];
    return page.sections.slice(0,32).flatMap((section:unknown)=>{
      if(!section||typeof section!=='object'||Array.isArray(section)||
        !('id' in section)||typeof section.id!=='string'||
        !('layout' in section)||typeof section.layout!=='string')return [];
      const layout=portfolioLayout(section.layout);
      if(!layout)return [];
      const title=section.id.startsWith('section-')
        ? 'New section: '+section.layout.split('@')[0]?.replaceAll('-',' ')
        : (sectionLayouts.find(([pin])=>pin===section.layout)?.[1]??section.id.replaceAll('-',' '));
      const slots=layout.slots.flatMap(name=>{
        const key=section.id+'-'+name.toLowerCase();
        const assigned=snapshot.slots[key];
        return assigned?[{key,name,state:assigned.state,componentId:assigned.componentId}]:[];
      });
      return [{id:section.id,title,slots}];
    });
  }catch{return [];}
}


/** Known compatible pinned library components only. An empty slot must not
 * silently accept a mismatched component, an arbitrary code pin, or a media
 * source without independently verified private asset registration. */
const insertableComponentPins=[
  {id:'title-stacked@1',label:'Heading',kinds:['title']},
  {id:'body-copy@1',label:'Paragraph',kinds:['text','text1','text2','note']},
  {id:'external-link@1',label:'External link',kinds:['cta','cta1','cta2','btn1','btn2','links']},
  {id:'project-card@1',label:'Project summary',kinds:['project','card']},
  {id:'skills-list@1',label:'Skills or experience',kinds:['items','entries']},
  {id:'technology-tag@1',label:'Technology tag',kinds:['badge']},
  {id:'author-metric@1',label:'Self-reported metric',kinds:['meta']}
] as const;
function compatibleComponentsForSlot(key:string){
  const kind=key.slice(key.lastIndexOf('-')+1);
  return insertableComponentPins.filter(item=>(item.kinds as readonly string[]).includes(kind));
}

const STUDIO = '/app/portfolios';
const editorPath = (id: string) => STUDIO + '/' + id + '/edit';
const authoringQuery = '(min-width: 900px)';
type PortfolioRecord = NonNullable<Awaited<ReturnType<SupabaseBrowserAuthPort['readOwnerPortfolio']>>['data']>;

export function portfolioIdFromRoute(path: string): string | undefined {
  return /^\/app\/portfolios\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(?:edit|preview(?:\/fullscreen)?)$/i.exec(path)?.[1]?.toLowerCase();
}

function useAuthoringViewport() {
  const [allowed, setAllowed] = useState(() => window.matchMedia(authoringQuery).matches);
  useEffect(() => {
    const query = window.matchMedia(authoringQuery);
    const update = () => setAllowed(query.matches);
    query.addEventListener('change', update);
    update();
    return () => query.removeEventListener('change', update);
  }, []);
  return allowed;
}

function DeviceLimit() {
  return <div className="ws-project-aside ws-studio-device" role="status">
    <h2>Continue on a larger screen.</h2>
    <p>Open this workspace on a desktop, laptop or a tablet with enough room for the editor.</p>
    <a className="ws-secondary" href={STUDIO}>Return to your portfolios</a>
  </div>;
}

export function PortfolioLibrary({port}: {port: SupabaseBrowserAuthPort}) {
  const [items, setItems] = useState<OwnerPortfolio[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  useEffect(() => {
    let active = true;
    void port.listOwnerPortfolios().then(result => {
      if (!active) return;
      if (result.data) {setItems(result.data); setError('');}
      else setError(result.error?.message ?? 'Your portfolios could not be loaded.');
    });
    return () => {active = false;};
  }, [port, attempt]);
  const displayed = items?.filter(item => item.title.toLowerCase().includes(query.trim().toLowerCase()));
  return <section aria-labelledby="studio-title">
    <div className="ws-project-head"><div className="ws-heading">
      <p className="ws-kicker">PORTFOLIO STUDIO</p>
      <h1 id="studio-title">Your portfolios.</h1>
      <p>Create and manage your independent portfolio drafts.</p>
    </div><a className="ws-primary" href={STUDIO + '/new'}>Create portfolio <Icon name="arrow" size={15}/></a></div>
    {error && <><p role="alert" className="ws-inline-alert">{error}</p><button type="button" className="ws-secondary"
      onClick={() => {setError(''); setAttempt(value => value + 1);}}>Retry portfolio library</button></>}
    {!items && !error && <p role="status">Loading your portfolios…</p>}
    {items && <div className="ws-project-detail">
      <div className="ws-project-aside ws-studio-list">
        {items.length > 0 && <label className="ws-studio-search">Find a portfolio<input type="search" value={query} onChange={event => setQuery(event.target.value)}/></label>}
        {!items.length && <div className="ws-project-empty">
          <img className="ws-brand-folio" src="/brand/kadmeion-open-folio.svg"
            width="118" height="118" alt="" decoding="async"/>
          <h2>No portfolios yet.</h2><p>Choose a preset or start with a blank draft.</p>
          <a className="ws-primary" href={STUDIO + '/new'}>Create your first portfolio</a>
        </div>}
        {displayed?.length === 0 && items.length > 0 && <p>No portfolios match your search.</p>}
        {!!displayed?.length && <ul className="ws-studio-records">{displayed.map(item => <li key={item.id}>
          <div><h2><a href={editorPath(item.id)}>{item.title}</a></h2>
            <p>{item.revision ? 'Draft revision ' + item.revision : 'Setup pending'}</p></div>
          <a className="ws-secondary" href={editorPath(item.id)} aria-label={'Open ' + item.title}>Open draft</a>
        </li>)}</ul>}
        {items.length === 100 && <p>Showing the latest 100 portfolios.</p>}
      </div>
      <aside className="ws-project-aside"><p className="ws-kicker">AUTHORING JOURNEY</p><h2>From draft to live.</h2>
        <ol className="ws-project-guide">
          <li><strong>Choose a foundation</strong> Pick a starter layout or a blank canvas.</li>
          <li><strong>Build and preview</strong> Review your draft before release.</li>
          <li><strong>Publish deliberately</strong> Publication requires a separate readiness check.</li>
        </ol>
      </aside>
    </div>}
  </section>;
}

export function PortfolioChooser({port}: {port: SupabaseBrowserAuthPort}) {
  const allowed = useAuthoringViewport();
  const [choice, setChoice] = useState<PortfolioPresetId>('arc');
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [pending, setPending] = useState<{id: string; operation: string} | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selected = presets.find(preset => preset.id === choice) ?? presets[0];

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allowed || saving) return;
    setSaving(true);
    setError('');
    try {
      let current = pending;
      if (!current) {
        const result = await port.createOwnerPortfolio(title, slug, selected.id);
        if (!result.data) {setError(result.error?.message ?? 'Portfolio creation could not be confirmed.'); return;}
        current = {id: result.data, operation: crypto.randomUUID()};
        setPending(current);
      }
      const initialized = await port.initializeOwnerPortfolio(current.id, current.operation, selected.id);
      if (!initialized.data) {setError(initialized.error?.message ?? 'Draft created. Retry initialization to continue.'); return;}
      window.location.assign(editorPath(current.id));
    } finally {
      setSaving(false);
    }
  }

  return <section aria-labelledby="choose-title">
    <div className="ws-heading"><a href={STUDIO}>Back to portfolios</a><p className="ws-kicker">NEW PORTFOLIO</p>
      <h1 id="choose-title">Choose your foundation.</h1>
      <p>Compare the curated layouts before creating a private draft.</p>
    </div>
    {!allowed ? <DeviceLimit/> : <form className="ws-project-detail" onSubmit={event => void create(event)}>
      <fieldset className="ws-project-fields" disabled={saving || !!pending}>
        <legend>Curated starting points</legend>
        <div className="ws-studio-presets">{presets.map(preset => <label key={preset.id} className="ws-studio-preset">
          <input type="radio" name="portfolio-preset" value={preset.id} checked={choice === preset.id} onChange={() => setChoice(preset.id)}/>
          {preset.id === 'blank' ? <div className="ws-blank-template" aria-hidden="true">＋</div> : <TemplateGraphic tone={preset.tone}/>}
          <strong>{preset.title}</strong><small>{preset.detail}</small>
        </label>)}</div>
      </fieldset>
      <div className="ws-project-fields">
        <p className="ws-kicker">SELECTED PRESET</p>
        <h2>{selected.title}</h2>
        {selected.id === 'blank' ? <div className="ws-blank-template" aria-hidden="true">＋</div> : <TemplateGraphic tone={selected.tone}/>}
        <p>{selected.detail}</p>
        <fieldset disabled={saving || !!pending}>
          <label>Portfolio name<input required value={title} maxLength={120} onChange={event => {
            setTitle(event.target.value);
            if (!slug || slug === title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64))
              setSlug(event.target.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64));
          }}/></label>
          <label>Portfolio slug<input required minLength={3} maxLength={64} pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            value={slug} onChange={event => setSlug(event.target.value)}/></label>
        </fieldset>
        {error && <p role="alert" className="ws-inline-alert">{error}</p>}
        <button type="submit" className="ws-primary" disabled={saving}>
          {saving ? 'Creating…' : pending ? 'Retry draft setup' : 'Choose template and create draft'}
        </button>
      </div>
    </form>}
  </section>;
}

export function PortfolioEditor({port, id}: {port: SupabaseBrowserAuthPort; id: string}) {
  const allowed = useAuthoringViewport();
  const [record, setRecord] = useState<PortfolioRecord | null>(null);
  const [head, setHead] = useState<EditorHead | null>(null);
  const [slot, setSlot] = useState('');
  const [value, setValue] = useState('');
  const [operation, setOperation] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState(false);
  const loaded = useRef('');
  const [sectionLayout, setSectionLayout] = useState('arc-hero@1');
  const [sectionPicker, setSectionPicker] = useState(false);
  const [tool, setTool] = useState('Content');
  const [componentSearch,setComponentSearch]=useState('');
  const [componentCategory,setComponentCategory]=useState<'All'|'Text'|'Links'|'Work'>('All');
  const [pickedComponent,setPickedComponent]=useState('');
  const [openedSource, setOpenedSource] = useState(false);
  const [openedAssets,setOpenedAssets]=useState(false);
  const [canvasWidth, setCanvasWidth] = useState(0);

  useEffect(() => {
    const key = id + ':' + attempt;
    if (!allowed || loaded.current === key) return;
    let active = true;
    void port.readOwnerPortfolio(id).then(result => {
      if (!active) return;
      if (!result.data) {setError(result.error?.message ?? 'Portfolio unavailable.'); return;}
      loaded.current = key;
      setRecord(result.data);
      const snapshot=result.data.snapshot;
      setHead(snapshot ? createEditorHead(snapshot) : null);
      // Highlight the first actual managed title slot rather than whichever
      // JSONB map key happened to deserialize first; never insert sample bytes.
      const chosen=orderedLayerGroups(snapshot).flatMap(group=>group.slots)
        .find(item=>item.name==='title')?.key??'';
      const initial=chosen?snapshot?.slots[chosen]:undefined;
      setSlot(chosen);
      setValue(initial?.content[primaryField(initial.componentId)]??'');
      setOperation('');
      setError('');
    });
    return () => {active = false;};
  }, [port, id, attempt, allowed]);

  function apply(intent: EditorIntent, versions?: Readonly<Record<string, MyComponentVersion>>): boolean {
    if (!allowed || !head || saving) return false;
    try {
      const next = applyEditorTransaction(head, {intent, operationId: crypto.randomUUID(), baseRevision: head.revision}, {}, versions ?? {});
      setHead(next);
      const selected = next.snapshot.slots[slot];
      setValue(selected?.content[primaryField(selected.componentId)] ?? '');
      setOperation(crypto.randomUUID()); setError(''); setNotice('Unsaved changes');
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The editor could not apply the change.');
      return false;
    }
  }

  function restore(snapshot: PortfolioSnapshot) {
    if (!head || !allowed || saving) return;
    try {
      const next = restoreHistoricalSnapshot(head, snapshot, crypto.randomUUID());
      setHead(next);
      setSlot('');
      setValue('');
      setOperation(crypto.randomUUID());
      setNotice('Revision restored into the working draft. Save to keep it.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The editor could not restore the revision.');
    }
  }

  async function save() {
    if (!allowed || !record || !head || !operation || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await port.saveOwnerPortfolio(id, operation, record.revision, head.snapshot);
      if (!result.data) {setError(result.error?.message ?? 'Draft save could not be confirmed.'); return;}
      setRecord({...record, revision: result.data, snapshot: head.snapshot});
      setOperation(''); setNotice('Private portfolio draft saved.');
    } finally {setSaving(false);}
  }

  async function initialize() {
    const preset = presets.find(item => item.id === record?.templateId);
    if (!allowed || !record || !preset || saving) return;
    setSaving(true); setError('');
    try {
      const result = await port.initializeOwnerPortfolio(id, crypto.randomUUID(), preset.id);
      if (result.data) setAttempt(current => current + 1);
      else setError(result.error?.message ?? 'Draft setup could not be confirmed.');
    } finally {setSaving(false);}
  }

  const active = slot ? head?.snapshot.slots[slot] : undefined;
  const layerGroups=orderedLayerGroups(head?.snapshot);
  const compatible=compatibleComponentsForSlot(slot);
  const chosenComponent=compatible.find(item=>item.id===pickedComponent)??compatible[0];
  const categoryFor=(id:string):'Text'|'Links'|'Work'=>
    id==='external-link@1'?'Links':
    id==='project-card@1'||id==='skills-list@1'||id==='author-metric@1'?'Work':'Text';
  const assigned = Object.entries(head?.snapshot.slots ?? {});
  const contentPreview = <PortfolioCanvas snapshot={head?.snapshot} title={record?.title ?? 'Portfolio draft'}
    width={canvasWidth || undefined} selectedSlot={slot}
    onSelectSlot={preview?undefined:(key)=>{
      const entry=head?.snapshot.slots[key];
      setSlot(key);setValue(entry?.content[primaryField(entry.componentId)]??'');setTool('Content');
    }}/>;
  if (!allowed) return <DeviceLimit/>;
  return <section aria-labelledby="edit-title" className="ws-studio-editor">
    <div className="ws-project-head"><div className="ws-heading">
      <a href={STUDIO}>Back to portfolios</a><p className="ws-kicker">PORTFOLIO BUILDER</p>
      <h1 id="edit-title">{record?.title ?? 'Portfolio editor'}</h1>
      <p>{record ? 'Private draft · revision ' + record.revision : 'Open a private portfolio draft.'}</p>
    </div>{head && <div className="ws-actions">
      <button type="button" className="ws-secondary" onClick={() => setPreview(current => !current)}>{preview ? 'Back to editor' : 'Author preview'}</button>
      {record && !operation && <>
        <a className="ws-secondary" href={STUDIO + '/' + id + '/preview'}>Preview modes</a>
        <a className="ws-secondary" href={STUDIO + '/' + id + '/preview/fullscreen'} target="_blank" rel="noopener">Fullscreen saved preview</a>
        <a className="ws-secondary" href={STUDIO + '/' + id + '/staging'}>Release workspace</a>
      </>}
      <button type="button" className="ws-primary" disabled={!operation || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save draft'}</button>
    </div>}</div>
    {error && <p role="alert" className="ws-inline-alert">{error}</p>}
    {error && <button type="button" className="ws-secondary" onClick={() => {
      setRecord(null); setHead(null); setError(''); setAttempt(current => current + 1);
    }}>{operation ? 'Discard changes and load saved draft' : 'Reload saved draft'}</button>}
    {notice && <p role="status" className="ws-inline-alert">{notice}</p>}
    {!record && !error && <p role="status">Loading portfolio…</p>}
    {record && !head && <button type="button" className="ws-primary" disabled={saving}
      onClick={() => void initialize()}>Complete draft setup</button>}
    {head && (preview ? contentPreview : <><div className="ws-editor-grid" hidden={tool==='Source'||tool==='Assets'}>
      <aside className="ws-project-aside">{tool==='Components'?<div className="ws-editor-component-catalog">
        <p className="ws-kicker">COMPATIBLE BUILDING BLOCKS</p>
        <h2>Components</h2>
        <p>Choose a trusted component to place in a compatible, empty slot. Unverified media stays unavailable.</p>
        <label className="ws-editor-search">Find components
          <input type="search" value={componentSearch} onChange={event=>setComponentSearch(event.target.value)}
            placeholder="Search pinned components"/></label>
        <div className="ws-editor-component-filters" role="group" aria-label="Component categories">
          {(['All','Text','Links','Work'] as const).map(category=>
            <button type="button" className="ws-secondary" key={category}
              aria-pressed={componentCategory===category} onClick={()=>setComponentCategory(category)}>
              {category}</button>)}
        </div>
        <ul className="ws-editor-component-list">{insertableComponentPins.filter(item=>
          (componentCategory==='All'||categoryFor(item.id)===componentCategory)&&
          (item.label.toLowerCase().includes(componentSearch.trim().toLowerCase())||
           item.id.toLowerCase().includes(componentSearch.trim().toLowerCase()))
        ).map(item=>{
          const fit=compatible.some(candidate=>candidate.id===item.id);
          return <li key={item.id}><button type="button" aria-pressed={chosenComponent?.id===item.id&&fit}
            disabled={active?.state!=='EMPTY'||!fit||saving}
            onClick={()=>setPickedComponent(item.id)}>
            <strong>{item.label}</strong>
            <small>{item.id}</small>
            <span>{fit?'Compatible with selected slot':'Choose another slot'}</span>
          </button></li>;
        })}</ul>
        {active?.state!=='EMPTY'&&<p className="ws-footnote">Select an empty slot in Structure &amp; layers before adding components.</p>}
        <button type="button" className="ws-secondary" onClick={()=>setTool('Content')}>Return to layers</button>
      </div>:<><h2>Structure &amp; layers</h2>
        {!assigned.length && <p>This blank draft has no slots.</p>}
        <button type="button" className="ws-secondary" aria-expanded={sectionPicker}
          onClick={() => setSectionPicker(current => !current)}>Sections</button>
        {sectionPicker && <div className="ws-editor-section-picker">
          <label>Section layout<select value={sectionLayout} onChange={event => setSectionLayout(event.target.value)}>
            {sectionLayouts.map(([pin, label]) => <option key={pin} value={pin}>{label}</option>)}
          </select></label>
          <button type="button" className="ws-secondary" disabled={saving}
            onClick={() => apply({kind: 'ADD_SECTION', layout: sectionLayout})}>Add section</button>
        </div>}
        <ol className="ws-editor-layers">{layerGroups.map((group,index)=><li key={group.id}>
          <details className="ws-editor-layer-group" open={index===0||group.id.startsWith('section-')}>
          <summary>{group.title}<small>{group.slots.length} slots</small></summary>
          <ul className="ws-editor-slots">{group.slots.map(item=><li key={item.key}>
            <button type="button" aria-pressed={slot===item.key}
              aria-label={(group.id.startsWith('section-')?'New section: ':group.id.replaceAll('-',' ')+' ')+item.name}
              onClick={()=>{
                setSlot(item.key);
                const assignment=head?.snapshot.slots[item.key];
                setValue(assignment?.content[primaryField(assignment.componentId)]??'');
                setTool('Content');
              }}>
              <span className="ws-editor-layer-name">{item.name.replaceAll(/([A-Z])/g,' $1')}</span>
              <span className="ws-editor-layer-state">{item.state==='EMPTY'?'Empty':item.state==='S0'?'Starter':item.state==='S1'?'Owned':'Custom'}</span>
            </button>
          </li>)}</ul></details>
        </li>)}</ol>
        <div className="ws-actions">
          <button type="button" className="ws-secondary" disabled={!head.undo.length || saving}
            onClick={() => apply({kind: 'UNDO'})}>Undo</button>
          <button type="button" className="ws-secondary" disabled={!head.redo.length || saving}
            onClick={() => apply({kind: 'REDO'})}>Redo</button>
        </div></>}
      </aside>
      {contentPreview}
      <aside className="ws-project-fields">
        <div className="ws-editor-tool"><nav aria-label="Editor panels">{['Content', 'Components', 'My Components', 'Theme', 'Assets', 'Source', 'History'].map(item =>
          <button type="button" key={item} className="ws-secondary" aria-pressed={tool === item} onClick={() => {
            setTool(item); if(item==='Source')setOpenedSource(true); if(item==='Assets')setOpenedAssets(true);
          }}>{item}</button>)}</nav></div>
        {tool === 'Components' && <div className="ws-editor-tool" aria-label="Slot compatibility">
          <p className="ws-kicker">COMPONENT PLACEMENT</p>
          <h2>Slot compatibility</h2>
          <p>Only compatible, pinned source can be assigned; existing authored content is not silently replaced.</p>
          {!active?<p role="status">Select an empty slot in Structure &amp; layers first.</p>:<>
            <div className="ws-editor-compatibility">
              <strong>Target slot</strong><span>{slot.replaceAll('-',' ')}</span>
              <strong>State</strong><span>{active.state}</span>
              <strong>Selected component</strong><span>{chosenComponent?.label??'Unavailable'}</span>
              <strong>Required source</strong><span>{chosenComponent?.id??'Not verified'}</span>
            </div>
            {active.state!=='EMPTY'?<p role="status">This slot already holds a component. Move it to unplaced from Content to preserve an Undo path.</p>:
              chosenComponent?<button type="button" className="ws-primary" disabled={saving}
                onClick={()=>{if(apply({kind:'ASSIGN_COMPONENT',slotKey:slot,componentId:chosenComponent.id}))setTool('Content');}}>
                Add to empty slot</button>:
                <p role="status">No verified component is available for this media slot.</p>}
          </>}
        </div>}
        {tool === 'Theme' && <ThemeInspector head={head} apply={apply} width={canvasWidth} resize={setCanvasWidth}/>}
        {tool === 'My Components' && <ComponentLibrary port={port} head={head} committed={record?.snapshot ?? null} slot={slot} apply={apply}/>}

        {tool === 'History' && record && <RevisionHistory port={port} id={id} revision={record.revision} onRestore={restore}/>}
        {tool === 'Content' && <><h2>Content inspector</h2>
        {!active && <p>Select a slot to inspect it.</p>}
        {active && <><p>{active.componentId ?? 'Empty slot'}</p>
          {active.state === 'EMPTY'
            ? <button type="button" className="ws-secondary" disabled={saving}
                onClick={() => setTool('Components')}>Choose compatible component</button>
            : <><label>Text content<textarea rows={5} maxLength={12000} value={value}
                placeholder={active.componentId==='title-stacked@1'&&value===''?
                  'Example: Build things that make a difference. (not saved)':'Enter your own content'}
                onChange={event => setValue(event.target.value)}/></label>
              <button type="button" className="ws-secondary" disabled={saving || value === (active.content[primaryField(active.componentId)] ?? '')}
                onClick={() => apply({kind: 'UPDATE_CONTENT', slotKey: slot, content: {[primaryField(active.componentId)]: value}})}>Apply text</button>
              {active.componentId && Object.hasOwn(contentFields, active.componentId) &&
                contentFields[active.componentId as keyof typeof contentFields].slice(1).map(field =>
                  <label key={field}>{field}<input defaultValue={active.content[field] ?? ''} key={slot + ':' + field + ':' + (active.content[field] ?? '')}
                    onBlur={event => {if ((active.content[field] ?? '') !== event.target.value)
                      apply({kind: 'UPDATE_CONTENT', slotKey: slot, content: {[field]: event.target.value}});
                    }}/></label>)}
              <button type="button" className="ws-secondary" disabled={saving}
                onClick={() => apply({kind: 'CLEAR_SLOT', slotKey: slot})}>Move to unplaced</button></>}
          {active.state === 'EMPTY' && (head.snapshot.stashes[slot]?.length ?? 0) > 0 &&
            <button type="button" className="ws-secondary" disabled={saving}
              onClick={() => apply({kind: 'RESTORE_STASH', slotKey: slot})}>Restore last assignment</button>}
        </>}</>}
      </aside>
    </div>{openedAssets&&<div hidden={tool!=='Assets'}><AssetList port={port}/></div>}
    {openedSource&&<div hidden={tool!=='Source'}>
      <SourceInspector head={head} slot={slot} apply={apply} back={()=>setTool('Content')}/>
    </div>}</>)}
  </section>;
}



/** EDIT-09: an owner-only visual simulation. This route cannot activate
 * publishing, obtain reviewer grants or create consented public projections. */
export function PortfolioPreviewModes({port,id}:{port:SupabaseBrowserAuthPort;id:string}){
  const [record,setRecord]=useState<PortfolioRecord|null>(null);
  const [error,setError]=useState('');
  const [view,setView]=useState<'author'|'visitor'>('visitor');
  const [device,setDevice]=useState<0|390|768>(0);
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let active=true;
    setRecord(null);setError('');
    void port.readOwnerPortfolio(id).then(reply=>{
      if(!active)return;
      if(reply.data?.snapshot){setRecord(reply.data);return;}
      setError(reply.error?.message??'A saved private portfolio revision is not available.');
    }).catch(()=>{
      if(active)setError('The saved private revision could not be verified.');
    });
    return ()=>{active=false;};
  },[port,id,attempt]);
  return <section className="ws-portfolio-preview" aria-labelledby="ws-preview-title">
    <header className="ws-project-head ws-preview-header">
      <div className="ws-heading">
        <a href={STUDIO+'/'+id+'/edit'}>Back to portfolio editor</a>
        <p className="ws-kicker">PORTFOLIO STUDIO / PREVIEW</p>
        <h1 id="ws-preview-title">{record?.title??'Portfolio preview'}</h1>
        <p>{record?'Saved owner-private revision '+record.revision:'Checking private draft'}</p>
      </div>
      {record&&<div className="ws-preview-header-status">
        <span>Private preview</span>
        <span>{device===390?'Phone':device===768?'Tablet':'Desktop'}</span>
      </div>}
    </header>
    {error&&<div className="ws-inline-alert" role="alert">
      {error}
      <button type="button" className="ws-secondary" onClick={()=>setAttempt(v=>v+1)}>Retry private preview</button>
    </div>}
    {!record&&!error&&<p role="status" className="ws-preview-loading">Loading your saved, owner-scoped preview…</p>}
    {record&&<div className="ws-preview-workbench">
      <aside className="ws-preview-sidebar" aria-label="Preview controls">
        <p className="ws-kicker">REVIEW BEFORE PUBLISHING</p>
        <h2>Preview modes</h2>
        <p>Switch between the author view and a simulation of visitor appearance.</p>
        <div className="ws-preview-mode-set" role="group" aria-label="Appearance mode">
          <button type="button" className="ws-secondary" aria-pressed={view==='author'}
            onClick={()=>setView('author')}>Author preview
            <small>Private authoring content</small></button>
          <button type="button" className="ws-secondary" aria-pressed={view==='visitor'}
            onClick={()=>setView('visitor')}>Visitor appearance (simulation)
            <small>Only saved portfolio content</small></button>
        </div>
        <div className="ws-preview-device-group">
          <label htmlFor="preview-device">Preview device</label>
          <select id="preview-device" value={device} onChange={event=>{
            const next=Number(event.target.value);
            setDevice(next===390?390:next===768?768:0);
          }}>
            <option value={0}>Desktop · fit</option>
            <option value={768}>Tablet · 768 px</option>
            <option value={390}>Phone · 390 px</option>
          </select>
        </div>
        <p className="ws-preview-readonly">Phone preview is read-only. Editing on a phone remains unavailable.</p>
        <a className="ws-secondary" href={STUDIO+'/'+id+'/edit'}>Back to editor</a>
      </aside>
      <div className="ws-preview-center">
        <div className="ws-preview-canvas-heading">
          <span>CANVAS / {device===390?'PHONE':device===768?'TABLET':'DESKTOP'}</span>
          <span>Saved revision · No public delivery</span>
        </div>
        <div className="ws-preview-stage">
          <PortfolioCanvas snapshot={record.snapshot} title={record.title}
            simulation={view==='visitor'} width={device||undefined}/>
        </div>
        <p className="ws-preview-caution" role="status">{view==='visitor'
          ? 'Appearance-only simulation. This is not a published or visitor-accessible URL, and no external code or images are executed.'
          : 'Private author preview. Empty slots may be indicated; no draft is published from this page.'}</p>
      </div>
      <aside className="ws-preview-checklist" aria-label="Private release checklist">
        <p className="ws-kicker">PREVIEW CHECKLIST</p>
        <h2>Public projection</h2>
        <p>This screen cannot certify the live release or what a visitor could access.</p>
        <dl>
          <div><dt>Portfolio visibility</dt><dd>Private preview</dd></div>
          <div><dt>Private project records</dt><dd>Not separately read</dd></div>
          <div><dt>Owned source code</dt><dd>Not executed</dd></div>
          <div><dt>Release preflight</dt><dd>Not run here</dd></div>
          <div><dt>Reviewer link</dt><dd>Not checked</dd></div>
        </dl>
        <p className="ws-preview-protection">Preview does not establish static-host publication or asset revocation. Run a private preflight before any further release decision.</p>
        <div className="ws-preview-checklist-actions">
          <a className="ws-secondary" href={STUDIO+'/'+id+'/staging'}>Private staging</a>
          <a className="ws-primary" href={STUDIO+'/'+id+'/publish'}>Run preflight</a>
        </div>
      </aside>
    </div>}
  </section>;
}

export function FullscreenPortfolioPreview({port, id}: {port: SupabaseBrowserAuthPort; id: string}) {
  const [record, setRecord] = useState<PortfolioRecord | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void port.readOwnerPortfolio(id).then(result => {
      if (!active) return;
      if (result.data?.snapshot) setRecord(result.data);
      else setError(true);
    });
    return () => {active = false;};
  }, [port, id]);

  if (error) return <main className="ws-gate"><h1>Portfolio unavailable.</h1><a href={STUDIO}>Return to portfolio library</a></main>;
  if (!record) return <main className="ws-gate" aria-busy="true"><p role="status">Loading saved portfolio preview…</p></main>;
  return <PortfolioCanvas snapshot={record.snapshot} title={record.title} standalone/>;
}
