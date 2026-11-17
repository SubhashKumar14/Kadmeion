import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IndexedDbEditorDraftStore, type EditorRecoveryPayload, type EditorRecoverySummary } from '../../../packages/storage-adapters/src/indexeddb-editor-drafts.ts';
import { unappliedSourceBufferCount } from './behavior.ts';
import { createPortal } from 'react-dom';
import type { FormEvent } from 'react';
import {
  applyEditorTransaction, canPlacePrivateImage, createEditorHead, restoreHistoricalSnapshot, type EditorHead, type EditorIntent, type PortfolioSnapshot
} from '../../../packages/editor-core/src/portfolio-revision-transactions.ts';
import { portfolioLayout, type PortfolioPresetId } from '../../../packages/editor-core/src/managed-project-files.ts';
import type { MyComponentVersion } from '../../../packages/contracts/src/private-my-components-service.ts';
import type { OwnerPortfolio, SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
import { Icon } from './landing.tsx';
import { TemplateGraphic } from './templates.tsx';
import { MoveToTrash } from './settings.tsx';
import { AssetList, ComponentLibrary, PortfolioCanvas, RevisionWorkspace, SourceInspector, ThemeInspector } from './portfolio-tools.tsx';

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

/** Parse known SEO fields without discarding other managed metadata. */
function readSeoFields(snapshot:PortfolioSnapshot|null|undefined):{title:string;description:string}{
  try{
    const parsed:unknown=JSON.parse(snapshot?.files['kadmeion.json']??'null');
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||!('seo' in parsed))
      return {title:'',description:''};
    const value=parsed.seo;
    if(!value||typeof value!=='object'||Array.isArray(value))
      return {title:'',description:''};
    const seo=value as Record<string,unknown>;
    return {title:typeof seo.title==='string'?seo.title:'',
      description:typeof seo.description==='string'?seo.description:''};
  }catch{return {title:'',description:''};}
}

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


/** Only validate links that an owner explicitly authors. Never treat a valid
 * URL as a verified provider account, deployed site, or publish approval. */
function ownerLinkError(source:string):string|null {
  if(source==='')return null;
  if(source.length>2048||/[\\\s\u0000-\u001f\u007f]/u.test(source))
    return 'Link must be a valid HTTPS address without spaces, backslashes or credentials (maximum 2048 characters).';
  try{
    const link=new URL(source);
    if(link.protocol==='https:'&&link.hostname&&link.username===''&&link.password==='')
      return null;
  }catch{ /* unparseable URL */ }
  return 'Link must be an HTTPS address without an embedded username or password.';
}

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
const authoringQuery = '(min-width: 900px) and (pointer: fine) and (hover: hover)';
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

function DeviceLimit({id}: {id?: string}) {
  const [copyStatus, setCopyStatus] = useState('');
  const continuation = new URL(id ? editorPath(id) : STUDIO + '/new', window.location.origin).href;
  const Heading = id ? 'h1' : 'h2';

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(continuation);
      setCopyStatus('Private workspace link copied.');
    } catch {
      setCopyStatus('Clipboard access is unavailable. Select and copy the private link from the field.');
    }
  }

  return <section className="ws-project-aside ws-studio-device" aria-labelledby="ws-device-title">
    <p className="ws-kicker">PORTFOLIO STUDIO</p>
    <Heading id="ws-device-title">Continue on a larger screen.</Heading>
    <p>Use a desktop or laptop with a mouse or trackpad to edit. You can still browse your workspace on this device.</p>
    {id && <p>Open the saved portfolio in read-only mode. Editing requires the private workspace.</p>}
    <label className="ws-device-link">
      Private continuation link
      <input readOnly value={continuation} onFocus={event=>event.currentTarget.select()}/>
    </label>
    <p className="ws-device-hint">The link requires your own Kadmeion sign-in.</p>
    <div className="ws-actions">
      <button type="button" className="ws-primary" onClick={()=>void copyLink()}>Copy continuation link</button>
      {id && <a className="ws-secondary" href={STUDIO+'/'+id+'/preview/fullscreen'}>View saved portfolio</a>}
      <a className="ws-secondary" href={STUDIO}>Return to your portfolios</a>
    </div>
    <p role="status" className="ws-device-hint">{copyStatus}</p>
  </section>;
}

/** Mirrors S1's additive v1 cursor without assuming this isolated S3 branch
 * already contains S1's auth-port commit. Once S0 integrates both branches the
 * exact S1 method is used; older adapter instances remain explicitly bounded. */
type OwnerPortfolioCursor = Readonly<{
  version: 1; collection: 'projects' | 'portfolios'; ownerUserId: string;
  updatedAt: string; id: string;
}>;
type PortfolioPage = {items: OwnerPortfolio[]; nextCursor: OwnerPortfolioCursor | null};
type PagedPortfolioPort = SupabaseBrowserAuthPort & {
  listOwnerPortfoliosPage?: (
    pageSize?: number, after?: OwnerPortfolioCursor | null
  ) => Promise<{data: PortfolioPage | null; error: {message: string} | null}>;
};

export function PortfolioLibrary({port}: {port: SupabaseBrowserAuthPort}) {
  const [items, setItems] = useState<OwnerPortfolio[] | null>(null);
  const [nextCursor, setNextCursor] = useState<OwnerPortfolioCursor | null>(null);
  const [isPaged, setIsPaged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [request, setRequest] = useState<{
    after: OwnerPortfolioCursor | null; reset: boolean; sequence: number;
  }>({after: null, reset: true, sequence: 0});
  const [query, setQuery] = useState('');

  // A reset re-reads the first page, including when the owner context
  // changes via an S0-controlled remount. Load-more requests preserve rows on
  // failure; stale promises from prior cursor requests never update the view.
  useEffect(() => {
    let active = true;
    setError('');
    setLoading(true);
    if (request.reset) {setItems(null); setNextCursor(null);}
    const paged = port as PagedPortfolioPort;
    const available = typeof paged.listOwnerPortfoliosPage === 'function';
    setIsPaged(available);
    const fetchPage = available
      ? paged.listOwnerPortfoliosPage!(50, request.after)
      : port.listOwnerPortfolios().then(result => ({
          data: result.data ? {items: result.data, nextCursor: null} : null,
          error: result.error
        }));
    void fetchPage.then(result => {
      if (!active) return;
      if (!result.data) {
        setError(result.error?.message ?? 'Your portfolios could not be loaded.');
        return;
      }
      const page = result.data;
      if (!Array.isArray(page.items) || page.nextCursor?.collection !== undefined &&
          page.nextCursor.collection !== 'portfolios') {
        setError('The portfolio page could not be verified. Refresh before continuing.');
        return;
      }
      setItems(previous => {
        if (request.reset || !previous) return page.items;
        const seen = new Set(previous.map(item => item.id));
        return [...previous, ...page.items.filter(item => !seen.has(item.id))];
      });
      setNextCursor(page.nextCursor);
      setError('');
    }).catch(() => {
      if (active) setError('The private portfolio service is unavailable. Retry without losing the loaded rows.');
    }).finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [port, request]);

  function refresh() {
    setRequest(previous => ({after: null, reset: true, sequence: previous.sequence + 1}));
  }
  function loadMore() {
    if (loading || !isPaged || !nextCursor) return;
    setRequest(previous => ({after: nextCursor, reset: false, sequence: previous.sequence + 1}));
  }
  const displayed = items?.filter(item => item.title.toLowerCase().includes(query.trim().toLowerCase()));
  return <section aria-labelledby="studio-title" className="ws-owner-page">
    <div className="ws-project-head"><div className="ws-heading">
      <p className="ws-kicker">PORTFOLIO STUDIO</p>
      <h1 id="studio-title">Your portfolios.</h1>
      <p>Create and manage your independent portfolio drafts.</p>
    </div><a className="ws-primary" href={STUDIO + '/new'}>Create portfolio <Icon name="arrow" size={15}/></a></div>
    {error && <><p role="alert" className="ws-inline-alert">{error}</p><div className="ws-actions">
      <button type="button" className="ws-secondary" disabled={loading}
        onClick={() => setRequest(previous => ({...previous, sequence: previous.sequence + 1}))}>
        Retry {request.reset ? 'portfolio library' : 'next page'}</button>
      {!request.reset && <button type="button" className="ws-secondary" disabled={loading}
        onClick={refresh}>Refresh from first page</button>}
    </div></>}
    {!items && !error && <p role="status">Loading your portfolios…</p>}
    {items && <div className="ws-project-detail ws-owner-columns">
      <div className="ws-studio-list">
        {items.length > 0 && <label className="ws-studio-search">Find a portfolio<input type="search" value={query} onChange={event => setQuery(event.target.value)}/></label>}
        {!items.length && <div className="ws-project-empty">
          <img className="ws-brand-folio" src="/brand/kadmeion-open-folio.svg"
            width="118" height="118" alt="" decoding="async"/>
          <h2>No portfolios yet.</h2><p>Choose a preset or start with a blank draft.</p>
          <a className="ws-primary" href={STUDIO + '/new'}>Create your first portfolio</a>
        </div>}
        {displayed?.length === 0 && items.length > 0 &&
          <p>No loaded portfolios match your search. Load more to search older records.</p>}
        {!!displayed?.length && <ul className="ws-studio-records">{displayed.map(item => {
          const preset = presets.find(candidate => candidate.id === item.templateId);
          return <li key={item.id}>
            <div className="ws-studio-record-icon" aria-hidden="true"><Icon name="layers" size={23}/></div>
            <div><h2><a href={editorPath(item.id)}>{item.title}</a></h2>
              <p>{item.revision ? 'Draft revision ' + item.revision : 'Setup pending'}{preset && ' · ' + preset.title + ' starting layout'}</p></div>
            <div className="ws-actions">
              <a className="ws-secondary" href={editorPath(item.id)} aria-label={'Open draft: ' + item.title}>Open draft</a>
              <MoveToTrash port={port} kind="portfolio" id={item.id} title={item.title}
                onMoved={()=>window.location.assign('/app/trash')}/>
            </div>
          </li>;
        })}</ul>}
        <div className="ws-actions">
          <button type="button" className="ws-secondary" disabled={loading} onClick={refresh}>
            Refresh portfolios</button>
          {isPaged && nextCursor && <button type="button" className="ws-secondary"
            disabled={loading || !!error} onClick={loadMore}>
            {loading ? 'Loading…' : 'Load more portfolios'}</button>}
        </div>
        {loading && items && <p role="status">Loading private portfolio records…</p>}
        {isPaged ? <p className="ws-footnote">{items.length} portfolio records loaded.
          {nextCursor ? ' More records may be available.' : ' No further page is indicated.'}
          {' '}Search filters loaded records only; refresh after changes in another tab.</p>
          : <p className="ws-footnote">This editor instance uses the legacy bounded portfolio list.
            {items.length === 100 ? ' Only the latest 100 records are shown.' : ''}
            {' '}Pagination becomes available after the updated private adapter is loaded.</p>}
      </div>
      <aside className="ws-project-aside"><h2 className="ws-owner-aside-title">From draft to live.</h2>
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
    } catch {
      setError('Portfolio setup could not be confirmed. Your chosen name and layout are retained.');
    } finally {
      setSaving(false);
    }
  }

  return <section aria-labelledby="choose-title" className="ws-owner-page ws-owner-chooser">
    <div className="ws-heading"><a href={STUDIO}>Back to portfolios</a><p className="ws-kicker">NEW PORTFOLIO</p>
      <h1 id="choose-title">Choose your foundation.</h1>
      <p>Compare the curated layouts before creating a private draft.</p>
    </div>
    {!allowed ? <DeviceLimit/> : <form className="ws-project-detail ws-owner-columns" onSubmit={event => void create(event)}>
      <fieldset className="ws-project-fields ws-preset-browser" disabled={saving || !!pending}>
        <legend>Curated starting points</legend>
        <div className="ws-preset-feature" role="group" aria-label="Selected layout preview">
          {selected.id === 'blank' ? <div className="ws-blank-template" aria-hidden="true"><Icon name="layers" size={30}/></div>
            : <TemplateGraphic tone={selected.tone}/>}
          <div><h2>{selected.title}</h2><p>{selected.detail}</p></div>
        </div>
        <div className="ws-studio-presets">{presets.map(preset => <label key={preset.id} className="ws-studio-preset">
          <input type="radio" name="portfolio-preset" value={preset.id} checked={choice === preset.id} onChange={() => setChoice(preset.id)}/>
          {preset.id === 'blank' ? <div className="ws-blank-template" aria-hidden="true"><Icon name="layers" size={20}/></div> : <TemplateGraphic tone={preset.tone}/>}
          <strong>{preset.title}</strong>
        </label>)}</div>
      </fieldset>
      <div className="ws-project-fields">
        <h2 className="ws-owner-aside-title">Set up your draft</h2>
        <p className="ws-draft-note">Start with {selected.title}. Your draft stays private until you publish it.</p>
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

/** Supplied exclusively by the live verified workspace gate. */
export type VerifiedEditorOwner = Readonly<{id:string;epoch:number}>;
export function PortfolioEditor({port,id,verifiedOwner}: {
  port:SupabaseBrowserAuthPort;id:string;verifiedOwner?:VerifiedEditorOwner;
}) {
  const allowed = useAuthoringViewport();
  const [record, setRecord] = useState<PortfolioRecord | null>(null);
  const [head, setHead] = useState<EditorHead | null>(null);
  const [slot, setSlot] = useState('');
  // Secondary controls preserve malformed user input without silently
  // committing it to the private snapshot or losing it on panel changes.
  const [fieldDrafts,setFieldDrafts]=useState<Record<string,string>>({});
  const [fieldIssues,setFieldIssues]=useState<Record<string,string>>({});
  const [seoDraft,setSeoDraft]=useState<{title:string;description:string}|null>(null);
  const [operation, setOperation] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState(false);
  const loaded = useRef('');
  const [sectionLayout, setSectionLayout] = useState('arc-hero@1');
  const [sectionPicker, setSectionPicker] = useState(false);
  const [tool, setTool] = useState(()=>new URLSearchParams(window.location.search).get('panel')==='Metadata'?'Metadata':'Content');
  const [componentSearch,setComponentSearch]=useState('');
  const [componentCategory,setComponentCategory]=useState<'All'|'Text'|'Links'|'Work'>('All');
  const [pickedComponent,setPickedComponent]=useState('');
  const [openedSource, setOpenedSource] = useState(false);
  const [openedAssets,setOpenedAssets]=useState(false);
  const [openedHistory,setOpenedHistory]=useState(false);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [sourceDrafts,setSourceDrafts]=useState<Record<string,string>>({});
  const sourceDirty=!!head&&unappliedSourceBufferCount(sourceDrafts,head.snapshot.files)>0;
  const [recoveryCopies,setRecoveryCopies]=useState<EditorRecoverySummary[]|null>(null);
  const [recoveryNotice,setRecoveryNotice]=useState('');
  const [recoveryBusy,setRecoveryBusy]=useState(false);
  const recoveryLock=useRef(false);
  const recoveryAttempt=useRef<{signature:string;copyId:string}|null>(null);
  const [sourceReset,setSourceReset]=useState(0);
  const editorPanels=['Content','Components','My Components','Theme','Metadata','Assets','Source','History'] as const;

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
      setSlot(chosen);
      setOperation('');
      setFieldDrafts({});setFieldIssues({});setSeoDraft(null);
      setSourceDrafts({});
      setError('');
    }).catch(()=>{if(active)setError('Private portfolio loading failed. Check your connection and retry.');});
    return () => {active = false;};
  }, [port, id, attempt, allowed]);

  function apply(intent: EditorIntent, versions?: Readonly<Record<string, MyComponentVersion>>): boolean {
    if (!allowed || !head || saving || recoveryLock.current) return false;
    // Changing an assignment or restoring another working snapshot must not
    // strand inspector/source buffers against a different component version.
    const replacesSlot = intent.kind === 'CLEAR_SLOT' || intent.kind === 'ASSIGN_COMPONENT' ||
      intent.kind === 'REUSE_SAVED_COMPONENT' || intent.kind === 'RESTORE_STASH' ||
      intent.kind === 'CUSTOMIZE_COMPONENT' || intent.kind === 'PLACE_PRIVATE_IMAGE';
    if (((intent.kind === 'UNDO' || intent.kind === 'REDO') && (pendingFields || sourceDirty)) ||
        (replacesSlot && 'slotKey' in intent && (sourceDirty || Object.entries(fieldDrafts).some(([key, draft]) => {
          if (!key.startsWith(intent.slotKey + ':')) return false;
          return draft !== (head.snapshot.slots[intent.slotKey]?.content[key.slice(intent.slotKey.length + 1)] ?? '');
        })))) {
      setError('Apply or discard unapplied content and source edits before changing this assignment or revision.');
      return false;
    }
    try {
      const next = applyEditorTransaction(head, {intent, operationId: crypto.randomUUID(), baseRevision: head.revision}, {}, versions ?? {});
      setHead(next);
      setOperation(crypto.randomUUID()); setError(''); setNotice('Unsaved changes');
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The editor could not apply the change.');
      return false;
    }
  }

  function restore(snapshot: PortfolioSnapshot): boolean {
    if (!head || !allowed || saving || recoveryLock.current) return false;
    if (pendingFields || sourceDirty) {
      setError('Apply or discard unapplied content and source buffers before restoring a saved checkpoint.');
      return false;
    }
    try {
      const next = restoreHistoricalSnapshot(head, snapshot, crypto.randomUUID());
      setHead(next);
      setSlot('');
      setOperation(crypto.randomUUID());
      setFieldDrafts({});setFieldIssues({});setSeoDraft(null);
      // A formerly clean source explorer must not carry an old snapshot's
      // buffer into the newly restored revision.
      setSourceReset(value => value + 1);
      setSourceDrafts({});
      setNotice('Revision restored into the working draft. Save to keep it.');
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The editor could not restore the revision.');
      return false;
    }
  }

  async function save() {
    if (!allowed || !record || !head || !operation || saving || recoveryLock.current || sourceDirty || pendingFields) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await port.saveOwnerPortfolio(id, operation, record.revision, head.snapshot);
      if (!result.data) {setError(result.error?.message ?? 'Draft save could not be confirmed.'); return;}
      setRecord({...record, revision: result.data, snapshot: head.snapshot});
      setOperation(''); setNotice('Private portfolio draft saved.');
    } catch {setError('Draft save could not be verified. Your edits remain in this editor.');}
    finally {setSaving(false);}
  }

  async function initialize() {
    const preset = presets.find(item => item.id === record?.templateId);
    if (!allowed || !record || !preset || saving) return;
    setSaving(true); setError('');
    try {
      const result = await port.initializeOwnerPortfolio(id, crypto.randomUUID(), preset.id);
      if (result.data) setAttempt(current => current + 1);
      else setError(result.error?.message ?? 'Draft setup could not be confirmed.');
    } catch {setError('Draft setup could not be confirmed. Retry safely.');}
    finally {setSaving(false);}
  }

  const active = slot ? head?.snapshot.slots[slot] : undefined;
  // Every inspector field, including the primary textarea, uses a per-slot
  // buffer. Selecting another slot cannot silently discard typed content.
  const primaryInputKey = slot && active ? slot + ':' + primaryField(active.componentId) : '';
  const savedPrimary = active?.content[primaryField(active.componentId)] ?? '';
  const value = primaryInputKey && Object.hasOwn(fieldDrafts, primaryInputKey)
    ? fieldDrafts[primaryInputKey]! : savedPrimary;
  const selectedSlotHasPendingDrafts = !!slot && Object.entries(fieldDrafts).some(([key, draft]) => {
    if (!key.startsWith(slot + ':')) return false;
    return draft !== (active?.content[key.slice(slot.length + 1)] ?? '');
  });
  const layerGroups=orderedLayerGroups(head?.snapshot);
  const compatible=compatibleComponentsForSlot(slot);
  const chosenComponent=compatible.find(item=>item.id===pickedComponent)??compatible[0];
  const categoryFor=(id:string):'Text'|'Links'|'Work'=>
    id==='external-link@1'?'Links':
    id==='project-card@1'||id==='skills-list@1'||id==='author-metric@1'?'Work':'Text';
  const assigned = Object.entries(head?.snapshot.slots ?? {});
  const savedSeo=readSeoFields(head?.snapshot);
  const seoValues=seoDraft??savedSeo;
  const seoPending=seoDraft!==null&&(seoDraft.title!==savedSeo.title||
    seoDraft.description!==savedSeo.description);
  const seoTitleValid=seoValues.title.trim().length>0&&seoValues.title.trim().length<=120;
  const seoDescriptionValid=seoValues.description.trim().length>0&&seoValues.description.trim().length<=300;
  function applySeoMetadata(){
    if(!head||saving||!seoPending||!seoTitleValid||!seoDescriptionValid)return;
    try{
      const raw:unknown=JSON.parse(head.snapshot.files['kadmeion.json']??'null');
      if(!raw||typeof raw!=='object'||Array.isArray(raw))
        throw new Error('Managed manifest is unavailable. Preserve its source and inspect the draft.');
      const data=raw as Record<string,unknown>;
      const previous=data.seo;
      const prevSeo=previous&&typeof previous==='object'&&!Array.isArray(previous)
        ?previous as Record<string,unknown>:{};
      const updated=JSON.stringify({...data,seo:{...prevSeo,
        title:seoValues.title.trim(),description:seoValues.description.trim()}});
      if(apply({kind:'WRITE_MANAGED_FILE',path:'kadmeion.json',source:updated}))setSeoDraft(null);
    }catch(failure){
      setError(failure instanceof Error?failure.message:'SEO metadata could not be applied.');
    }
  }
  function changeFieldBuffer(key:string, value:string, stored:string) {
    setFieldDrafts(previous=>{
      const next={...previous};
      if(value===stored)delete next[key];else next[key]=value;
      return next;
    });
    setFieldIssues(previous=>{const next={...previous};delete next[key];return next;});
  }
  function changeSeoBuffer(field:'title'|'description',value:string){
    setSeoDraft(previous=>{
      const next={...(previous??savedSeo),[field]:value};
      return next.title===savedSeo.title&&next.description===savedSeo.description?null:next;
    });
  }
  const pendingFields=Object.entries(fieldDrafts).some(([key,draft])=>{
    const pivot=key.lastIndexOf(':');
    if(pivot<0)return false;
    const parent=key.slice(0,pivot),field=key.slice(pivot+1);
    return (head?.snapshot.slots[parent]?.content[field]??'')!==draft;
  }) || seoPending;
  // Local storage is not an identity authority. Gate context is mandatory.
  type RecoveryView={port:SupabaseBrowserAuthPort;id:string;owner:VerifiedEditorOwner|undefined;
    record:PortfolioRecord|null;head:EditorHead|null;operation:string;fieldDrafts:Record<string,string>;
    sourceDrafts:Record<string,string>;seoDraft:{title:string;description:string}|null;dirty:boolean;saving:boolean;allowed:boolean};
  const latestRecovery=useRef<RecoveryView|null>(null);
  useLayoutEffect(()=>{
    latestRecovery.current={port,id,owner:verifiedOwner,record,head,operation,fieldDrafts,sourceDrafts,seoDraft,
      dirty:!!operation||pendingFields||sourceDirty,saving,allowed};
    return ()=>{latestRecovery.current=null;};
  },[port,id,verifiedOwner?.id,verifiedOwner?.epoch,record,head,operation,fieldDrafts,sourceDrafts,seoDraft,pendingFields,sourceDirty,saving,allowed]);
  function scopeCurrent(view:RecoveryView):boolean {
    const current=latestRecovery.current,owner=view.owner;
    if(!current||!owner||current.port!==view.port||current.id!==view.id||
       current.owner?.id!==owner.id||current.owner?.epoch!==owner.epoch)return false;
    return view.port.reconcileOwnerSessionEpoch()===owner.epoch;
  }
  function draftCurrent(view:RecoveryView):boolean {
    const current=latestRecovery.current;
    return !!current&&scopeCurrent(view)&&current.allowed&&current.record===view.record&&current.head===view.head&&
      current.operation===view.operation&&current.fieldDrafts===view.fieldDrafts&&current.sourceDrafts===view.sourceDrafts&&
      current.seoDraft===view.seoDraft&&!current.saving;
  }
  const recoveryRecordId=record?.id;
  useEffect(()=>{
    setRecoveryCopies(null);setRecoveryNotice('');recoveryAttempt.current=null;
    const view=latestRecovery.current;
    if(!view?.owner||!view.record||view.record.id!==id||!scopeCurrent(view))return;
    let active=true;
    void (async()=>{
      try{
        const copies=await new IndexedDbEditorDraftStore().listRecoveryCopies(view.owner!.id,id);
        if(active&&scopeCurrent(view))setRecoveryCopies(copies);
      }catch{
        if(active&&scopeCurrent(view))setRecoveryNotice('Browser recovery storage could not be read. Cloud draft unchanged.');
      }
    })();
    return ()=>{active=false;};
  },[port,id,verifiedOwner?.id,verifiedOwner?.epoch,recoveryRecordId]);
  function captureRecovery():RecoveryView|null {
    const view=latestRecovery.current;
    return view?.owner&&view.record?.id===id&&view.head&&view.allowed&&!view.saving&&scopeCurrent(view)?view:null;
  }
  async function refreshRecovery(view:RecoveryView,store:IndexedDbEditorDraftStore){
    const copies=await store.listRecoveryCopies(view.owner!.id,view.id);
    if(scopeCurrent(view))setRecoveryCopies(copies);
  }
  function installCloudDraft(fresh:PortfolioRecord){
    if(!fresh.snapshot)throw new Error('Saved cloud revision unavailable.');
    const next=createEditorHead(fresh.snapshot);
    setRecord(fresh);setHead(next);setOperation('');
    setSlot(orderedLayerGroups(fresh.snapshot).flatMap(group=>group.slots).find(item=>item.name==='title')?.key??'');
    setFieldDrafts({});setFieldIssues({});setSeoDraft(null);setSourceDrafts({});
    setSourceReset(value=>value+1);setError('');setNotice('');
  }
  async function preserveRecovery(keepBoth:boolean){
    const view=captureRecovery();
    if(!view||!view.dirty||recoveryLock.current||!view.record||!view.head)return;
    recoveryLock.current=true;setRecoveryBusy(true);setRecoveryNotice('');
    let acknowledged=false;
    try{
      const payload:EditorRecoveryPayload={formatVersion:1,cloudBaseRevision:view.record.revision,
        localRevision:view.head.revision,cloudOperationId:view.operation||null,
        snapshot:view.head.snapshot,fieldDrafts:view.fieldDrafts,sourceDrafts:view.sourceDrafts,seoDraft:view.seoDraft};
      const signature=JSON.stringify(payload);
      let attempt=recoveryAttempt.current;
      if(!attempt||attempt.signature!==signature){
        attempt={signature,copyId:crypto.randomUUID()};recoveryAttempt.current=attempt;
      }
      const store=new IndexedDbEditorDraftStore();
      await store.saveRecoveryCopy(view.owner!.id,view.id,attempt.copyId,payload);
      acknowledged=true;
      if(!scopeCurrent(view))return;
      setRecoveryNotice('Recovery copy saved on this browser only. Cloud draft unchanged.');
      await refreshRecovery(view,store);
      if(!keepBoth)return;
      if(!draftCurrent(view)){setRecoveryNotice('Recovery copy saved. Working edits changed; no cloud draft was loaded.');return;}
      const fresh=await view.port.readOwnerPortfolio(view.id);
      if(!scopeCurrent(view))return;
      if(!fresh.data?.snapshot||fresh.data.id!==view.id||!draftCurrent(view)){
        setRecoveryNotice('Recovery copy saved. Latest cloud draft could not be safely loaded; current edits remain.');return;
      }
      installCloudDraft(fresh.data);
      setRecoveryNotice('Both versions preserved: browser recovery copy and latest saved cloud draft. No cloud revision was overwritten.');
    }catch{
      if(scopeCurrent(view))setRecoveryNotice(acknowledged?
        'Recovery copy saved, but the follow-up read failed. Working edits remain.':
        'Recovery copy not confirmed. Keep the editor open; browser storage may be full or unavailable.');
    }finally{recoveryLock.current=false;if(scopeCurrent(view))setRecoveryBusy(false);}
  }
  async function inspectRecovery(copyId:string,action:'compare'|'open'|'export'){
    const view=captureRecovery();
    if(!view||recoveryLock.current||!view.record||!view.head||(action==='open'&&view.dirty))return;
    recoveryLock.current=true;setRecoveryBusy(true);setRecoveryNotice('');
    try{
      // No offline authentication bypass: all reopen/readback/export operations
      // require a fresh owner-scoped cloud read before retrieving copy bytes.
      const fresh=await view.port.readOwnerPortfolio(view.id);
      if(!scopeCurrent(view))return;
      if(!fresh.data?.snapshot||fresh.data.id!==view.id||!draftCurrent(view)){
        setRecoveryNotice('Current cloud draft could not be verified. Recovery copy remains stored.');return;
      }
      const copy=await new IndexedDbEditorDraftStore().loadRecoveryCopy(view.owner!.id,view.id,copyId);
      if(!scopeCurrent(view))return;
      if(!copy||!draftCurrent(view)){setRecoveryNotice('Recovery copy unavailable or editor changed. Nothing was replaced.');return;}
      const saved=fresh.data.snapshot,recovered=copy.payload;
      if(action==='export'){
        const url=URL.createObjectURL(new Blob([JSON.stringify(recovered,null,2)],{type:'application/json'}));
        const link=document.createElement('a');
        link.href=url;link.download='kadmeion-recovery-'+copy.copyId+'.json';
        try{document.body.append(link);link.click();}
        finally{link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
        setRecoveryNotice('Recovery export requested. This private file may contain sensitive authored text.');return;
      }
      if(action==='compare'||recovered.cloudBaseRevision!==fresh.data.revision||view.dirty){
        const paths=new Set([...Object.keys(saved.files),...Object.keys(recovered.snapshot.files)]);
        const changedFiles=[...paths].filter(path=>saved.files[path]!==recovered.snapshot.files[path]).length;
        const keys=new Set([...Object.keys(saved.slots),...Object.keys(recovered.snapshot.slots)]);
        const stable=(value:unknown)=>JSON.stringify(value,(_key,v:unknown)=>
          v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
        const changedSlots=[...keys].filter(key=>stable(saved.slots[key])!==stable(recovered.snapshot.slots[key])).length;
        setRecoveryNotice('Recovery base '+recovered.cloudBaseRevision+' · cloud revision '+fresh.data.revision+
          ' · '+changedFiles+' differing files · '+changedSlots+' differing slots. '+
          (recovered.cloudBaseRevision!==fresh.data.revision?'Cloud changed; copy retained separately. Export to recover manually.':'Copy remains separate; no cloud change.'));
        return;
      }
      const next=restoreHistoricalSnapshot(createEditorHead(saved),recovered.snapshot,crypto.randomUUID());
      const issues:Record<string,string>={};
      for(const [key,value] of Object.entries(recovered.fieldDrafts)){
        if(key.endsWith(':url')){const warning=ownerLinkError(value);if(warning)issues[key]=warning;}
      }
      installCloudDraft(fresh.data);
      setHead(next);setOperation(crypto.randomUUID());setFieldDrafts(recovered.fieldDrafts);
      setFieldIssues(issues);setSeoDraft(recovered.seoDraft);setSourceDrafts(recovered.sourceDrafts);
      if(Object.keys(recovered.sourceDrafts).length)setOpenedSource(true);
      setRecoveryNotice('Recovery copy opened as an unsaved working draft. Original copy and cloud revision unchanged.');
    }catch{
      if(scopeCurrent(view))setRecoveryNotice('Recovery operation not completed. No working or cloud draft was replaced.');
    }finally{recoveryLock.current=false;if(scopeCurrent(view))setRecoveryBusy(false);}
  }
  /** Revalidate the selected owner metadata immediately before placement.
   * No arbitrary URLs, storage keys or invented byte digests enter the slot. */
  async function placeAsset(assetId:string,target:string,altText:string):Promise<boolean>{
    const view=captureRecovery();
    if(!view||!view.head||recoveryLock.current||!canPlacePrivateImage(view.head.snapshot,target))return false;
    if(sourceDirty||Object.keys(view.fieldDrafts).some(key=>key.startsWith(target+':'))){
      setError('Apply or discard pending target/source edits before placing an image.');return false;
    }
    recoveryLock.current=true;setRecoveryBusy(true);
    try{
      const response=await view.port.listOwnerAssets();
      if(!draftCurrent(view))return false;
      const asset=response.data?.find(row=>row.id===assetId);
      if(!asset){setError('Current owner asset registration could not be verified. No slot was changed.');return false;}
      recoveryLock.current=false;
      if(!apply({kind:'PLACE_PRIVATE_IMAGE',slotKey:target,assetId:asset.id,altText}))return false;
      setSlot(target);setNotice('Private image reference applied to working draft. Save draft to persist it. Verified media bytes are still required for release.');
      return true;
    }catch{
      if(scopeCurrent(view))setError('Asset validation failed. No slot was changed.');
      return false;
    }finally{recoveryLock.current=false;if(scopeCurrent(view))setRecoveryBusy(false);}
  }
  async function removeRecovery(copyId:string){
    const view=captureRecovery();
    if(!view||recoveryLock.current||!window.confirm('Remove this browser recovery copy? This cannot be undone. Cloud draft is unaffected.'))return;
    if(!scopeCurrent(view))return;
    recoveryLock.current=true;setRecoveryBusy(true);setRecoveryNotice('');
    try{
      const store=new IndexedDbEditorDraftStore();
      await store.removeRecoveryCopy(view.owner!.id,view.id,copyId);
      if(!scopeCurrent(view))return;
      recoveryAttempt.current=null;
      setRecoveryNotice('Browser recovery copy removed. Cloud draft unchanged.');
      await refreshRecovery(view,store);
    }catch{if(scopeCurrent(view))setRecoveryNotice('Removal or catalogue refresh not confirmed. Reopen the editor to check.');}
    finally{recoveryLock.current=false;if(scopeCurrent(view))setRecoveryBusy(false);}
  }
  // Browser navigation must not silently discard the owner's private, unsaved
  // transaction journal or uncommitted secondary fields. This guard never
  // persists draft text to a public origin or external service.
  useEffect(()=>{
    if(!operation&&!pendingFields&&!sourceDirty)return;
    const warn=(event:BeforeUnloadEvent)=>{
      event.preventDefault();event.returnValue='';
    };
    window.addEventListener('beforeunload',warn);
    return ()=>window.removeEventListener('beforeunload',warn);
  },[operation,pendingFields,sourceDirty]);
  const contentPreview = <PortfolioCanvas snapshot={head?.snapshot} title={record?.title ?? 'Portfolio draft'}
    width={canvasWidth || undefined} selectedSlot={slot}
    onSelectSlot={preview?undefined:(key)=>{
      setSlot(key);setTool('Content');
    }}/>;
  if (!allowed && !record) return <DeviceLimit id={id}/>;
  return <>{!allowed && <DeviceLimit id={id}/>}
    <section aria-labelledby="edit-title" className="ws-studio-editor" hidden={!allowed} inert={!allowed}>
    <div className="ws-project-head"><div className="ws-heading">
      <a href={STUDIO}>Back to portfolios</a><p className="ws-kicker">PORTFOLIO BUILDER</p>
      <h1 id="edit-title">{record?.title ?? 'Portfolio editor'}</h1>
      <p>{record ? 'Private draft · revision ' + record.revision +
        (operation||pendingFields||sourceDirty?' · Uncommitted changes':' · Saved privately') : 'Open a private portfolio draft.'}</p>
    </div>{head && <div className="ws-actions">
      <button type="button" className="ws-secondary" onClick={() => setPreview(current => !current)}>{preview ? 'Back to editor' : 'Author preview'}</button>
      {record && !operation && !sourceDirty && !pendingFields && <>
        <a className="ws-secondary" href={STUDIO + '/' + id + '/preview'}>Preview modes</a>
        <a className="ws-secondary" href={STUDIO + '/' + id + '/preview/fullscreen'} target="_blank" rel="noopener">Fullscreen saved preview</a>
        <a className="ws-secondary" href={STUDIO + '/' + id + '/staging'}>Release workspace</a>
      </>}
      <button type="button" className="ws-primary" disabled={!operation||saving||recoveryBusy||pendingFields||sourceDirty}
        title={sourceDirty?'Apply or discard unapplied source before saving.':pendingFields?
          'Resolve or apply unfinished inspector fields before saving.':undefined}
        onClick={() => void save()}>{saving ? 'Saving…' : 'Save draft'}</button>
    </div>}</div>
    {error && <p role="alert" className="ws-inline-alert">{error}</p>}
    {error && <button type="button" className="ws-secondary" disabled={saving||recoveryBusy} onClick={() => {
      setRecord(null); setHead(null); setError(''); setAttempt(current => current + 1);
    }}>{operation || pendingFields || sourceDirty ? 'Discard changes and load saved draft' : 'Reload saved draft'}</button>}
    {notice && <p role="status" className="ws-inline-alert">{notice}</p>}
    {verifiedOwner&&record&&head&&<details className="ws-editor-safety">
      <summary>Browser recovery &amp; Keep Both</summary>
      <p>Copies stay on this device, separate from the saved cloud draft. Browser storage can be cleared; export important work. Opening requires a verified owner and fresh cloud read.</p>
      <div className="ws-actions">
        <button type="button" className="ws-secondary" disabled={saving||recoveryBusy||!(operation||pendingFields||sourceDirty)}
          data-inspector-buffer-action="true" onMouseDown={event=>event.preventDefault()}
          onClick={()=>void preserveRecovery(false)}>Save browser recovery copy</button>
        <button type="button" className="ws-secondary" disabled={saving||recoveryBusy||!(operation||pendingFields||sourceDirty)}
          data-inspector-buffer-action="true" onMouseDown={event=>event.preventDefault()}
          onClick={()=>void preserveRecovery(true)}>Keep Both and load latest cloud draft</button>
      </div>
      {recoveryBusy&&<p>Working with browser recovery storage…</p>}
      {recoveryNotice&&<p role="status">{recoveryNotice}</p>}
      {recoveryCopies===null?<p>Local recovery catalogue not confirmed.</p>:recoveryCopies.length===0?
        <p>No browser recovery copies.</p>:<ul className="ws-editor-slots">{recoveryCopies.map(copy=>
          <li key={copy.copyId}><strong>{new Date(copy.savedAt).toLocaleString()} · base revision {copy.cloudBaseRevision}</strong>
            <div className="ws-actions">
              <button type="button" className="ws-secondary" disabled={saving||recoveryBusy}
                onClick={()=>void inspectRecovery(copy.copyId,'compare')}>Compare copy</button>
              <button type="button" className="ws-secondary" disabled={saving||recoveryBusy||!!operation||pendingFields||sourceDirty||copy.cloudBaseRevision!==record.revision}
                onClick={()=>void inspectRecovery(copy.copyId,'open')}>Open recovery copy</button>
              <button type="button" className="ws-secondary" disabled={saving||recoveryBusy}
                onClick={()=>void inspectRecovery(copy.copyId,'export')}>Export recovery copy</button>
              <button type="button" className="ws-secondary" disabled={saving||recoveryBusy}
                onClick={()=>void removeRecovery(copy.copyId)}>Remove recovery copy</button>
            </div>
          </li>)}</ul>}
    </details>}
    {pendingFields&&<div className="ws-editor-safety">
      <span>Unapplied inspector edits are held in this editor.</span>
      <button type="button" className="ws-secondary" data-inspector-buffer-action="true"
        disabled={saving} onMouseDown={event=>event.preventDefault()}
        onClick={()=>{setFieldDrafts({});setFieldIssues({});setSeoDraft(null);}}>
        Discard all unapplied inspector edits</button>
    </div>}
    {sourceDirty&&<div role="status" className="ws-editor-safety"><span>Unapplied owned-source text is held only in this editor. Apply or discard the buffer before leaving or saving.</span>
      <button type="button" className="ws-secondary" onClick={()=>{setTool('Source');setPreview(false);}}>Review source edits</button></div>}
    {!record && !error && <p role="status">Loading portfolio…</p>}
    {record && !head && <button type="button" className="ws-primary" disabled={saving}
      onClick={() => void initialize()}>Complete draft setup</button>}
    {head&&!preview&&<nav className="ws-editor-modebar" aria-label="Editor panels">
      <span className="ws-editor-modebar-title">EDIT WORKSPACE</span>
      {editorPanels.map(item=><button type="button" key={item} className="ws-editor-modebar-button"
        aria-pressed={tool===item} onClick={()=>{setTool(item);
          if(item==='Source')setOpenedSource(true);
          if(item==='Assets')setOpenedAssets(true);
          if(item==='History')setOpenedHistory(true);
        }}>{item}</button>)}
    </nav>}
    {head && (preview ? contentPreview : <><div className="ws-editor-grid" hidden={tool==='Source'||tool==='Assets'||tool==='History'}>
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
          <div className="ws-editor-layer-reorder">
            <span>Section {index+1} / {layerGroups.length}</span>
            <div role="group" aria-label={'Reorder '+group.title}>
              <button type="button" className="ws-editor-reorder-action" aria-label={'Move '+group.title+' up'}
                disabled={index===0||saving} onClick={()=>apply({kind:'MOVE_SECTION',sectionId:group.id,direction:'up'})}>Up</button>
              <button type="button" className="ws-editor-reorder-action" aria-label={'Move '+group.title+' down'}
                disabled={index===layerGroups.length-1||saving}
                onClick={()=>apply({kind:'MOVE_SECTION',sectionId:group.id,direction:'down'})}>Down</button>
            </div>
          </div>
          <details className="ws-editor-layer-group" open={index===0||group.id.startsWith('section-')}>
          <summary>{group.title}<small>{group.slots.length} slots</small></summary>
          <ul className="ws-editor-slots">{group.slots.map(item=>{
            const label=item.name.replaceAll(/([A-Z])/g,' $1');
            const state=item.state==='EMPTY'?'Empty':item.state==='S0'?'Starter':item.state==='S1'?'Owned':'Custom';
            const section=group.id.startsWith('section-')?'New section: ':group.id.replaceAll('-',' ')+' ';
            return <li key={item.key}>
            <button type="button" aria-pressed={slot===item.key}
              aria-label={section+label+' '+state}
              onClick={()=>{
                setSlot(item.key);
                setTool('Content');
              }}>
              <span className="ws-editor-layer-name">{label}</span>{' '}
              <span className="ws-editor-layer-state">{state}</span>
            </button>
          </li>;})}</ul></details>
        </li>)}</ol>
        <div className="ws-actions">
          <button type="button" className="ws-secondary" disabled={!head.undo.length || saving || pendingFields || sourceDirty}
            onClick={() => apply({kind: 'UNDO'})}>Undo</button>
          <button type="button" className="ws-secondary" disabled={!head.redo.length || saving || pendingFields || sourceDirty}
            onClick={() => apply({kind: 'REDO'})}>Redo</button>
        </div></>}
      </aside>
      {contentPreview}
      <aside className="ws-project-fields">
        {tool === 'Components' && <div className="ws-editor-tool" role="group" aria-label="Slot compatibility">
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
        {tool === 'Metadata' && <section className="ws-editor-tool ws-metadata-inspector" aria-labelledby="metadata-title">
          <p className="ws-kicker">RELEASE CONTENT</p><h2 id="metadata-title">Page metadata</h2>
          <p>This author-written information stays private until an independently verified release is explicitly published.</p>
          <label htmlFor="kd-seo-title">SEO page title</label>
          <input id="kd-seo-title" type="text" maxLength={120} value={seoValues.title}
            aria-invalid={seoPending&&!seoTitleValid} onChange={event=>changeSeoBuffer('title',event.target.value)}/>
          <p className="ws-field-hint">Required, 1–120 characters. No invented rankings or credentials.</p>
          <label htmlFor="kd-seo-description">SEO description</label>
          <textarea id="kd-seo-description" rows={5} maxLength={300} value={seoValues.description}
            aria-invalid={seoPending&&!seoDescriptionValid} onChange={event=>changeSeoBuffer('description',event.target.value)}/>
          <p className="ws-field-hint">Required, 1–300 characters. Not currently exposed to crawlers.</p>
          {seoPending&&(!seoTitleValid||!seoDescriptionValid)&&
            <p role="alert" className="ws-field-error">Enter a nonempty title and description within the limits.</p>}
          <button type="button" className="ws-secondary"
            disabled={saving||!seoPending||!seoTitleValid||!seoDescriptionValid}
            onClick={applySeoMetadata}>Apply SEO metadata to draft</button>
          {seoPending&&<button type="button" className="ws-secondary" disabled={saving}
            onClick={()=>setSeoDraft(null)}>Discard unapplied SEO metadata</button>}
          {seoPending&&<p role="status">Metadata edits are held in this private editor.
            Apply them and save the draft to create a new immutable revision.</p>}
          {!seoPending&&seoTitleValid&&seoDescriptionValid&&
            <p className="ws-field-hint">Metadata is in your working revision. Save the draft before another frozen preflight.</p>}
          <a className="ws-secondary" href={STUDIO+'/'+id+'/publish'}>View private release preflight</a>
        </section>}
        {tool === 'My Components' && <ComponentLibrary port={port} head={head} committed={record?.snapshot ?? null} slot={slot} apply={apply}/>}

        {tool === 'Content' && <><h2>Content inspector</h2>
        {!active && <p>Select a slot to inspect it.</p>}
        {active && <><p>{active.componentId ?? 'Empty slot'}</p>
          {canPlacePrivateImage(head.snapshot,slot)&&<div className="ws-editor-tool">
            {active.componentId==='image@1'&&<p>Private image reference · {active.content.alt_text||'No alt text'}.
              {active.content.source_sha256?' Stored pin; release verification required.':' Metadata only; release blocked until trusted byte attestation.'}</p>}
            <button type="button" className="ws-secondary" disabled={saving||recoveryBusy}
              onClick={()=>{setOpenedAssets(true);setTool('Assets');}}>{active.state==='EMPTY'?'Choose private image':'Replace private image'}</button>
          </div>}
          {active.state === 'EMPTY'
            ? <button type="button" className="ws-secondary" disabled={saving}
                onClick={() => setTool('Components')}>Choose compatible component</button>
            : active.componentId==='image@1'&&active.state==='S0'?
              <button type="button" className="ws-secondary" disabled={saving||recoveryBusy||sourceDirty}
                onClick={()=>apply({kind:'CLEAR_SLOT',slotKey:slot})}>Move image to unplaced</button>
            : <><label>Text content<textarea rows={5} maxLength={12000} value={value}
                placeholder={active.componentId==='title-stacked@1'&&value===''?
                  'Example: Build things that make a difference. (not saved)':'Enter your own content'}
                onChange={event => changeFieldBuffer(primaryInputKey,event.target.value,savedPrimary)}/></label>
              <button type="button" className="ws-secondary" disabled={saving || value === savedPrimary}
                onClick={() => {
                  if (apply({kind: 'UPDATE_CONTENT', slotKey: slot, content: {[primaryField(active.componentId)]: value}})) {
                    setFieldDrafts(drafts => {
                      const next = {...drafts}; delete next[primaryInputKey]; return next;
                    });
                  }
                }}>Apply text</button>
              {value !== savedPrimary && <button type="button" className="ws-secondary"
                disabled={saving} onClick={() => setFieldDrafts(drafts => {
                  const next = {...drafts}; delete next[primaryInputKey]; return next;
                })}>Discard unapplied text</button>}
              {active.componentId && Object.hasOwn(contentFields, active.componentId) &&
                contentFields[active.componentId as keyof typeof contentFields].slice(1).map(field => {
                  const inputKey=slot+':'+field;
                  const stored=active.content[field]??'';
                  const draft=Object.hasOwn(fieldDrafts,inputKey)?fieldDrafts[inputKey]!:stored;
                  const issue=fieldIssues[inputKey];
                  const id='kd-field-'+inputKey;
                  const applySecondary=()=>{
                    if(draft===stored){changeFieldBuffer(inputKey,stored,stored);return;}
                    const warning=field==='url'?ownerLinkError(draft):null;
                    if(warning){
                      setFieldIssues(values=>({...values,[inputKey]:warning}));
                      return;
                    }
                    if(apply({kind:'UPDATE_CONTENT',slotKey:slot,content:{[field]:draft}})){
                      changeFieldBuffer(inputKey,stored,stored);
                    }
                  };
                  return <div key={inputKey} className="ws-inspector-secondary-field">
                    <label htmlFor={id}>{field}</label>
                    {/* Place explicit actions before the input in keyboard order.
                        Forward Tab still validates/applies as it did previously;
                        Shift+Tab or a pointer can explicitly choose Discard. */}
                    {draft!==stored&&<div className="ws-actions">
                      <button type="button" className="ws-secondary" data-inspector-buffer-action={inputKey}
                        disabled={saving} onMouseDown={event=>event.preventDefault()}
                        onClick={()=>{document.getElementById(id)?.focus();applySecondary();}}>Apply {field} edit</button>
                      <button type="button" className="ws-secondary" data-inspector-buffer-action={inputKey}
                        disabled={saving} onMouseDown={event=>event.preventDefault()}
                        onClick={()=>{document.getElementById(id)?.focus();changeFieldBuffer(inputKey,stored,stored);}}>Discard {field} edit</button>
                    </div>}
                    <input id={id}
                    type={field==='url'?'url':'text'} maxLength={field==='url'?2048:12000}
                    value={draft} aria-invalid={!!issue}
                    aria-describedby={issue?id+'-error':undefined}
                    onChange={event=>changeFieldBuffer(inputKey,event.target.value,stored)}
                    onBlur={event=>{
                      // Validation must run even when leaving for an explicit
                      // buffer action. Such an action may defer a valid commit.
                      const warning=draft!==stored&&field==='url'?ownerLinkError(draft):null;
                      if(warning){
                        setFieldIssues(values=>({...values,[inputKey]:warning}));
                        return;
                      }
                      const action=event.relatedTarget instanceof HTMLElement?
                        event.relatedTarget.dataset.inspectorBufferAction:undefined;
                      if(action===inputKey||action==='true')return;
                      applySecondary();
                    }}
                    onKeyDown={event=>{
                      if(event.key==='Escape'&&draft!==stored){
                        event.preventDefault();changeFieldBuffer(inputKey,stored,stored);
                      }
                    }}/>{issue&&<span id={id+'-error'} role="alert" className="ws-field-error">{issue}</span>}</div>;
                })}
              {pendingFields&&<p className="ws-field-hint" role="status">
                One or more content fields have unapplied edits. Apply or discard them before saving this draft.
              </p>}
              <button type="button" className="ws-secondary" disabled={saving || selectedSlotHasPendingDrafts || sourceDirty}
                title={selectedSlotHasPendingDrafts || sourceDirty ? 'Apply or discard content/source edits before moving this component.' : undefined}
                onClick={() => apply({kind: 'CLEAR_SLOT', slotKey: slot})}>Move to unplaced</button></>}
          {active.state === 'EMPTY' && (head.snapshot.stashes[slot]?.length ?? 0) > 0 &&
            <button type="button" className="ws-secondary" disabled={saving}
              onClick={() => apply({kind: 'RESTORE_STASH', slotKey: slot})}>Restore last assignment</button>}
        </>}</>}
      </aside>
    </div>{openedHistory&&record&&<div hidden={tool!=='History'}>
      <RevisionWorkspace port={port} id={id} revision={record.revision}
        working={head.snapshot} title={record.title} dirty={!!operation||pendingFields||sourceDirty}
        buffered={pendingFields||sourceDirty} onRestore={restore} back={()=>setTool('Content')}/>
    </div>}
    {openedAssets&&<div hidden={tool!=='Assets'}>
      <AssetList port={port} back={()=>setTool('Content')} snapshot={head.snapshot}
        targets={verifiedOwner?layerGroups.flatMap(group=>group.slots.filter(item=>canPlacePrivateImage(head.snapshot,item.key))
          .map(item=>({key:item.key,label:group.title+' · '+item.name,state:item.state}))):[]}
        selectedSlot={slot} placementDisabled={saving||recoveryBusy||sourceDirty} onPlace={placeAsset}/>
    </div>}
    </>)}
    {/* Author preview may hide the source panel, but must not unmount its
        private buffers. Only an explicit reload/accepted restore resets it. */}
    {head&&openedSource&&<div hidden={preview||tool!=='Source'}>
      <SourceInspector key={id+':'+attempt+':'+sourceReset} head={head} slot={slot} apply={apply}
        buffers={sourceDrafts} setBuffers={setSourceDrafts} back={()=>setTool('Content')}/>
    </div>}
  </section></>;
}



/** EDIT-09: an owner-only visual simulation. This route cannot activate
 * publishing, obtain reviewer grants or create consented public projections. */
/** PUBLIC-04: show only the actual saved, owner-private portfolio beneath
 * the share modal. Never insert illustrative projects or imply a public release.
 * This portal separates the visual portfolio surface from the workspace shell,
 * while the native dialog supplies focus containment and Escape handling. */
function PrivateShareScene({record,onClose}:{
  record:PortfolioRecord;onClose:()=>void;
}) {
  return createPortal(<>
    <div className="ws-share-scene" aria-hidden="true" data-public-delivery="disabled">
      <PortfolioCanvas snapshot={record.snapshot} title={record.title} standalone/>
    </div>
    <PrivateShareDialog onClose={onClose}/>
  </>, document.body);
}

/** PUBLIC-04 share-state preview. No owner-private draft has a public URL here. */
function PrivateShareDialog({onClose}:{onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement|null>(null);
  useEffect(()=>{
    const element=dialog.current;
    if(!element)return;
    element.showModal();
    return ()=>{if(element.open)element.close();};
  },[]);
  return <dialog ref={dialog} className="ws-share-dialog" aria-modal="true"
    aria-labelledby="kd-share-title" aria-describedby="kd-share-description"
    // StrictMode may close/reopen the same dialog during effect replay.
    // Ignore a queued close event if the dialog is open again.
    onClose={event=>{if(!event.currentTarget.open)onClose();}}>
    <header className="ws-share-heading">
      <div><p className="ws-kicker">SHARE PORTFOLIO</p><h2 id="kd-share-title">Share your work</h2></div>
      <button type="button" className="ws-share-close" aria-label="Close share dialog"
        onClick={()=>dialog.current?.close()}>×</button>
    </header>
    <p id="kd-share-description">This is a saved, owner-private preview. No publicly verified shareable URL is available.</p>
    <label htmlFor="kd-share-address">Verified public link</label>
    <div className="ws-share-address">
      <input id="kd-share-address" type="text" value="No verified public URL" readOnly
        aria-describedby="kd-share-gate"/>
      <button type="button" disabled>Copy link</button>
    </div>
    <p id="kd-share-gate" className="ws-share-gate">
      Sharing remains disabled until an approved public host confirms release visibility,
      direct-asset revocation and an authentic visitor URL. Private source and editor
      controls are never exposed through this dialog.
    </p>
    <div className="ws-share-actions">
      <button type="button" className="ws-secondary" disabled>Native Share unavailable</button>
      <button type="button" className="ws-primary" onClick={()=>dialog.current?.close()}>Done</button>
    </div>
    <footer className="ws-share-footer">
      <strong>Visitor experience</strong>
      <p>A verified released URL would open the independent portfolio, without the Kadmeion workspace shell.</p>
    </footer>
  </dialog>;
}

export function PortfolioPreviewModes({port,id}:{port:SupabaseBrowserAuthPort;id:string}){
  const [record,setRecord]=useState<PortfolioRecord|null>(null);
  const [error,setError]=useState('');
  const [view,setView]=useState<'author'|'visitor'>('visitor');
  const [device,setDevice]=useState<0|390|768>(0);
  const [attempt,setAttempt]=useState(0);
  const [shareOpen,setShareOpen]=useState(false);
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
        <button type="button" className="ws-secondary" onClick={()=>setShareOpen(true)}>Share portfolio</button>
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
    {record&&shareOpen&&<PrivateShareScene record={record} onClose={()=>setShareOpen(false)}/>} 
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
