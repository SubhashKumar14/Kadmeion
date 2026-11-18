import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IndexedDbEditorDraftStore, MAX_RECOVERY_BYTES, recoverEditorHistory, validateRecoveryPayload, type EditorRecoveryPayload, type EditorRecoverySummary } from '../../../packages/storage-adapters/src/indexeddb-editor-drafts.ts';
import { JournaledEditorFolderStore, FolderCommitError, type FolderDirectory } from '../../../packages/storage-adapters/src/journaled-editor-folder.ts';
import { exportPortableSnapshot, importPortableSnapshot } from '../../../packages/storage-adapters/src/portable-editor-snapshot.ts';
import { unappliedSourceBufferCount } from './behavior.ts';
import { createPortal } from 'react-dom';
import type { FormEvent } from 'react';
import {
  applyEditorTransaction, canPlacePrivateImage, matchingReplacementContent, createEditorHead, restoreHistoricalSnapshot, planSectionLayoutChange, type EditorHead, type EditorIntent, type PortfolioSnapshot
} from '../../../packages/editor-core/src/portfolio-revision-transactions.ts';
import { canonicalLibraryComponentSource, portfolioLayout, type PortfolioPresetId } from '../../../packages/editor-core/src/managed-project-files.ts';
import { ContractError } from '../../../packages/contracts/src/project.ts';
import type { MyComponentVersion } from '../../../packages/contracts/src/private-my-components-service.ts';
import type { OwnerPortfolio, SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
import { Icon } from './landing.tsx';
import { TemplateGraphic } from './templates.tsx';
import { MoveToTrash } from './settings.tsx';
import { AssetList, ComponentLibrary, LayoutTools, PortfolioCanvas, RevisionWorkspace, SourceInspector, ThemeInspector, usePinnedCatalogueFavorites, type ComponentSaveRetryState } from './portfolio-tools.tsx';

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


const editorPanels=['Content','Components','My Components','Theme','Metadata','Assets','Source','History'] as const;
type EditorPanel=typeof editorPanels[number];
type InitialEditorLink={panel:EditorPanel;slot:string|null;invalidPanel:boolean;invalidSlot:boolean};
const validLinkSlot=(key:string)=>/^[a-z0-9_-]{1,64}$/.test(key)&&
  !['__proto__','constructor','prototype'].includes(key);

/** C09 is a read-only initial selection hint, never an identity or write request.
 * Bound parsing and reject ambiguous keys rather than accepting the first value. */
function readInitialEditorLink(search:string):InitialEditorLink{
  if(search.length>4096)return {panel:'Content',slot:null,invalidPanel:true,invalidSlot:true};
  const params=new URLSearchParams(search);
  const panels=params.getAll('panel'),slots=params.getAll('slot');
  const panel=panels.length===1?editorPanels.find(value=>value===panels[0]):undefined;
  const slot=slots.length===1&&validLinkSlot(slots[0]!)?slots[0]!:null;
  return {panel:panel??'Content',slot,invalidPanel:panels.length>0&&!panel,
    invalidSlot:slots.length>0&&slot===null};
}

function resolveInitialEditorSlot(snapshot:PortfolioSnapshot,requested:string|null){
  const declared=orderedLayerGroups(snapshot).flatMap(group=>group.slots);
  const counts=new Map<string,number>();
  for(const item of declared)counts.set(item.key,(counts.get(item.key)??0)+1);
  const available=declared.filter(item=>validLinkSlot(item.key)&&counts.get(item.key)===1&&
    Object.hasOwn(snapshot.slots,item.key));
  const found=requested!==null&&available.some(item=>item.key===requested);
  return {key:found?requested!:available.find(item=>item.name==='title')?.key??'',
    missing:requested!==null&&!found};
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
/** JSONB may reorder object keys on readback. Keep arrays and exact source
 * strings ordered, but never confuse insertion order with a content change. */
function stableDraftValue(value:unknown):string|undefined{
  return JSON.stringify(value,(_key,v:unknown)=>v&&typeof v==='object'&&!Array.isArray(v)?
    Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v);
}
function sameDraftSnapshot(a:PortfolioSnapshot|null,b:PortfolioSnapshot|null):boolean{
  return !!a&&!!b&&stableDraftValue(a)===stableDraftValue(b);
}

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
    {!items && !error && <><p role="status">Loading your portfolios…</p><div className="glyph-skeleton" aria-hidden="true"><span className="glyph-skeleton-line is-title"/><span className="glyph-skeleton-line is-medium"/><span className="glyph-skeleton-line is-short"/></div></>}
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
  type PendingSetup={id:string;operation:string;preset:PortfolioPresetId;epoch:number;port:SupabaseBrowserAuthPort};
  const [pending,setPending]=useState<PendingSetup|null>(null);
  const pendingRef=useRef<PendingSetup|null>(null);
  const flight=useRef(false);
  const mounted=useRef(false);
  const currentPort=useRef(port);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const selected=presets.find(preset=>preset.id===choice)??presets[0];
  useLayoutEffect(()=>{
    mounted.current=true;currentPort.current=port;
    return()=>{mounted.current=false;};
  },[port]);

  async function create(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!allowed||saving||flight.current||!mounted.current)return;
    const epoch=port.reconcileOwnerSessionEpoch();
    const current=()=>mounted.current&&currentPort.current===port&&port.reconcileOwnerSessionEpoch()===epoch;
    let setup=pendingRef.current;
    if(setup&&(setup.epoch!==epoch||setup.port!==port)){
      pendingRef.current=null;setPending(null);setError('Owner session changed. Review your private portfolio library before creating another draft.');return;
    }
    flight.current=true;setSaving(true);setError('');
    try{
      if(!setup){
        const result=await port.createOwnerPortfolio(title,slug,selected.id);
        if(!current())return;
        if(!result.data){
          setError((result.error?.message??'Portfolio creation could not be confirmed.')+' Check your private portfolio library before creating another draft.');return;
        }
        setup={id:result.data,operation:crypto.randomUUID(),preset:selected.id,epoch,port};
        pendingRef.current=setup;setPending(setup);
      }
      const initialized=await port.initializeOwnerPortfolio(setup.id,setup.operation,setup.preset);
      if(!current())return;
      if(typeof initialized.data!=='number'||!Number.isSafeInteger(initialized.data)||initialized.data<1){
        setError(initialized.error?.message??'Draft created. Retry the same initialization to continue.');return;
      }
      window.location.assign(editorPath(setup.id));
    }catch{
      if(current())setError(setup?'Draft setup could not be confirmed. Retry the same setup.':
        'Portfolio creation could not be confirmed. Check your private portfolio library before creating another draft.');
    }finally{
      flight.current=false;
      if(current())setSaving(false);
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
  const lastAppliedHead=useRef<EditorHead|null>(null);
  const setupFlight=useRef(false);
  const setupAttempt=useRef<{id:string;preset:PortfolioPresetId;epoch:number;operation:string}|null>(null);
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
  const [initialLink]=useState(()=>readInitialEditorLink(window.location.search));
  const initialLinkConsumed=useRef(false);
  const [linkNotice,setLinkNotice]=useState('');
  const [tool, setTool] = useState<string>('Content');
  const [componentSearch,setComponentSearch]=useState('');
  // Device-only public pinned IDs, shared with S7's placement board; never private component IDs.
  const {favorites,toggle:toggleFavorite,storageAvailable}=usePinnedCatalogueFavorites();
  const [favoriteComponentsOnly,setFavoriteComponentsOnly]=useState(false);
  const [componentCategory,setComponentCategory]=useState<'All'|'Text'|'Links'|'Work'>('All');
  const [pickedComponent,setPickedComponent]=useState('');
  const componentDrag=useRef<{head:EditorHead;pin:string}|null>(null);
  const sectionDrag=useRef<{head:EditorHead;id:string}|null>(null);
  const [draggingSection,setDraggingSection]=useState<string|null>(null);
  const componentSaveRetry=useRef<ComponentSaveRetryState>({pending:null,inFlight:false});
  const [openedSource, setOpenedSource] = useState(false);
  const [openedAssets,setOpenedAssets]=useState(false);
  const [openedHistory,setOpenedHistory]=useState(false);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [measuredCanvasWidth,setMeasuredCanvasWidth]=useState<number|null>(null);
  const [sourceDrafts,setSourceDrafts]=useState<Record<string,string>>({});
  const sourceDirty=!!head&&unappliedSourceBufferCount(sourceDrafts,head.snapshot.files)>0;
  const [recoveryCopies,setRecoveryCopies]=useState<EditorRecoverySummary[]|null>(null);
  const [recoveryNotice,setRecoveryNotice]=useState('');
  const [savedHistoryNotice,setSavedHistoryNotice]=useState('');
  const [recoveryExpanded,setRecoveryExpanded]=useState(false);
  const [folderNotice,setFolderNotice]=useState('');
  const [portableNotice,setPortableNotice]=useState('');
  const [portableComparison,setPortableComparison]=useState<{snapshot:PortfolioSnapshot;baseSnapshot:PortfolioSnapshot;
    ownerKey:string;cloudRevision:number;format:'json'|'zip';archiveSha256:string;
    changedFiles:string[];changedSlots:string[]}|null>(null);
  const [portableFile,setPortableFile]=useState('');
  const [folderComparison,setFolderComparison]=useState<{directory:FolderDirectory;folderHead:EditorHead;
    cloudRevision:number;changedFiles:string[];changedSlots:string[]}|null>(null);
  const folderPicker=(window as Window&{showDirectoryPicker?:(options:{mode:'readwrite'})=>Promise<FolderDirectory>}).showDirectoryPicker;
  const folderSupported=window.isSecureContext&&typeof folderPicker==='function'&&typeof navigator.locks?.request==='function';
  const [autoRecovery,setAutoRecovery]=useState(false);
  const [checkpointState,setCheckpointState]=useState<'idle'|'pending'|'saved'|'failed'>('idle');
  const [checkpointRetry,setCheckpointRetry]=useState(0);
  const checkpointWriter=useRef<{id:string;sequence:number;signature:string}|null>(null);
  const frozenCheckpoint=useRef<{id:string;signature:string}|null>(null);
  const checkpointFlight=useRef(false);
  // A rejected sequence must never silently recreate or replace a different tab's copy.
  const checkpointConflict=useRef<string|null>(null);
  const checkpointEnabled=useRef(false);
  const saveFlight=useRef(false);
  const [recoveryComparison,setRecoveryComparison]=useState<{copyId:string;cloudRevision:number;
    changedFiles:string[];changedSlots:string[];pendingCount:number;checkpointSequence?:number}|null>(null);
  const catalogueRequest=useRef(0);
  const [recoveryBusy,setRecoveryBusy]=useState(false);
  const recoveryLock=useRef(false);
  const recoveryAttempt=useRef<{signature:string;copyId:string}|null>(null);
  const importedRecoveryAttempt=useRef<{signature:string;copyId:string}|null>(null);
  const [sourceReset,setSourceReset]=useState(0);
  useEffect(() => {
    if(!allowed||!verifiedOwner)return;
    const key=verifiedOwner.id+':'+verifiedOwner.epoch+':'+id+':'+attempt;
    if(loaded.current===key)return;
    const epoch=port.reconcileOwnerSessionEpoch();
    if(verifiedOwner.epoch!==epoch)return;
    let active = true;
    const current=()=>active&&port.reconcileOwnerSessionEpoch()===epoch;
    void port.readOwnerPortfolio(id).then(async result => {
      if(!current())return;
      if(!result.data||result.data.id!==id){
        setError(result.error?.message??'Portfolio unavailable.');return;
      }
      const snapshot=result.data.snapshot;
      let nextHead=snapshot?createEditorHead(snapshot):null;
      let historyNotice='';
      if(snapshot){
        try{
          const cached=await new IndexedDbEditorDraftStore().loadCommittedHistory(
            verifiedOwner.id,id,result.data.revision,snapshot);
          if(!current())return;
          if(cached){nextHead=cached;historyNotice='Saved Undo/Redo history restored from this browser.';}
        }catch{
          if(!current())return;
          historyNotice='Saved cloud draft loaded; browser Undo/Redo history could not be read.';
        }
      }
      if(!current())return;
      setSavedHistoryNotice(historyNotice);
      loaded.current = key;
      setRecord(result.data);
      setHead(nextHead);
      // Consume only on the first authorized, validated snapshot. A missing
      // snapshot keeps the existing setup flow; later reads never reapply URL.
      if(snapshot&&!initialLinkConsumed.current){
        const choice=resolveInitialEditorSlot(snapshot,initialLink.slot);
        initialLinkConsumed.current=true;
        setSlot(choice.key);setTool(initialLink.panel);
        if(initialLink.panel==='Source')setOpenedSource(true);
        if(initialLink.panel==='Assets')setOpenedAssets(true);
        if(initialLink.panel==='History')setOpenedHistory(true);
        const invalid=initialLink.invalidSlot||choice.missing;
        setLinkNotice(initialLink.invalidPanel&&invalid?
          'Requested editor panel and slot are unavailable. Using the default selection.':
          initialLink.invalidPanel?'Requested editor panel is unavailable. Opened Content.':
          invalid?'Requested slot is unavailable in this draft. Choose an available slot in Structure & layers.':'');
      }else{
        setSlot(snapshot?resolveInitialEditorSlot(snapshot,null).key:'');
      }
      setOperation('');
      setFieldDrafts({});setFieldIssues({});setSeoDraft(null);
      setSourceDrafts({});
      setError('');
    }).catch(()=>{if(current())setError('Private portfolio loading failed. Check your connection and retry.');});
    return () => {active = false;};
  }, [port,id,attempt,allowed,verifiedOwner?.id,verifiedOwner?.epoch,initialLink]);

  function apply(intent: EditorIntent, versions?: Readonly<Record<string, MyComponentVersion>>): boolean {
    if (!allowed || !verifiedOwner || !head || preview || saving || saveFlight.current || recoveryLock.current || lastAppliedHead.current===head) return false;
    const live=latestRecovery.current;
    if(!live||live.head!==head||live.id!==id||live.port!==port||!scopeCurrent(live))return false;
    const layoutMutation=intent.kind==='CHANGE_SECTION_LAYOUT'||intent.kind==='RESTORE_LAYOUT_STASH';
    const historyMutation=intent.kind==='UNDO'||intent.kind==='REDO';
    const sectionOrderMutation=intent.kind==='MOVE_SECTION_BEFORE'||intent.kind==='MOVE_SECTION';
    const themeMutation=intent.kind==='EDIT_SCOPED_THEME'||(intent.kind==='WRITE_MANAGED_FILE'&&intent.path==='theme/tokens.json');
    const addSectionMutation=intent.kind==='ADD_SECTION';
    if(layoutMutation||themeMutation||sectionOrderMutation||addSectionMutation){
      const view=latestRecovery.current;
      if(!view||view.head!==head||!view.owner||!view.allowed||!draftCurrent(view)||
         preview||(layoutMutation?tool!=='Components':themeMutation?tool!=='Theme':sectionOrderMutation?!canReorderSection():['Source','Assets','History'].includes(tool))){
        setError('Layout and theme changes require the current verified editor and a fresh review.');return false;
      }
      if('expectedRevision' in intent&&intent.expectedRevision!==head.revision){
        setError('Working revision changed. Review the layout or theme again.');return false;
      }
    }
    // Changing an assignment or restoring another working snapshot must not
    // strand inspector/source buffers against a different component version.
    const replacesSlot = intent.kind === 'CLEAR_SLOT' || intent.kind === 'ASSIGN_COMPONENT' ||
      intent.kind === 'REUSE_SAVED_COMPONENT' || intent.kind === 'RESTORE_STASH' ||
      intent.kind === 'CUSTOMIZE_COMPONENT' || intent.kind === 'PLACE_PRIVATE_IMAGE';
    if (((layoutMutation||themeMutation||historyMutation||sectionOrderMutation||addSectionMutation) && (pendingFields || sourceDirty))||
        (replacesSlot && 'slotKey' in intent && (sourceDirty || Object.entries(fieldDrafts).some(([key, draft]) => {
          if (!key.startsWith(intent.slotKey + ':')) return false;
          return draft !== (head.snapshot.slots[intent.slotKey]?.content[key.slice(intent.slotKey.length + 1)] ?? '');
        })))) {
      setError('Apply or discard unapplied content and source edits before changing this assignment or revision.');
      return false;
    }
    try {
      let trustedSources:Readonly<Record<string,string>>={};
      if(intent.kind==='CUSTOMIZE_COMPONENT'){
        const pin=head.snapshot.slots[intent.slotKey]?.componentId;
        const canonical=pin&&canonicalLibraryComponentSource(pin);
        if(!pin||!canonical||canonical!==intent.copiedSource||!live.owner||!draftCurrent(live)||
          preview||tool!=='Content'||pendingFields||sourceDirty){
          setError('A verified, current pinned source copy is required before customization.');return false;
        }
        trustedSources={[pin]:canonical};
      }
      if(intent.kind==='REUSE_SAVED_COMPONENT'){
        const version=versions&&Object.hasOwn(versions,intent.componentVersionId)?versions[intent.componentVersionId]:undefined;
        if(!version||version.id!==intent.componentVersionId||tool!=='My Components'||
           !draftCurrent(live)||pendingFields||sourceDirty){
          setError('Reuse requires the current verified private component catalogue and applied buffers.');return false;
        }
        // The fetched version is not authority for pristine library bytes.
        // Supply only the application's immutable canonical pin, allowing the
        // engine to distinguish byte-identical owned copies from custom code.
        const canonical=canonicalLibraryComponentSource(version.base_component_pin);
        if(canonical)trustedSources={[version.base_component_pin]:canonical};
      }
      const next = applyEditorTransaction(head, {intent, operationId: crypto.randomUUID(), baseRevision: head.revision}, trustedSources, versions ?? {});
      if(layoutMutation||historyMutation){
        // Raw buffers have already been proven clean; do not reattach a clean
        // inspector cache to a different assignment after an explicit revision.
        let preferred=slot;
        if(intent.kind==='CHANGE_SECTION_LAYOUT'){
          const mapping=intent.mappings.find(row=>row.fromSlotKey===slot);
          if(mapping)preferred=mapping.toSlotKey??'';
          const candidates=orderedLayerGroups(next.snapshot).filter(group=>group.id===intent.sectionId);
          if(candidates.length===1&&!candidates[0]!.slots.some(item=>item.key===preferred)){
            preferred=candidates[0]!.slots.find(item=>item.name==='title')?.key??
              candidates[0]!.slots[0]?.key??'';
          }
        }else if(intent.kind==='RESTORE_LAYOUT_STASH')preferred=intent.toSlotKey;
        setSlot(resolveInitialEditorSlot(next.snapshot,preferred||null).key);
        setFieldDrafts({});setFieldIssues({});setSeoDraft(null);setSourceDrafts({});
        setSourceReset(value=>value+1);
      }
      lastAppliedHead.current=head;
      setHead(next);
      setOperation(crypto.randomUUID()); setError(''); setNotice(layoutMutation||sectionOrderMutation?
        'Layout transaction applied to the working draft. Save to persist, or use Undo.':themeMutation?
        'Theme transaction applied to the working draft. Save to persist, or use Undo.':'Unsaved changes');
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The editor could not apply the change.');
      return false;
    }
  }

  function restore(snapshot: PortfolioSnapshot): boolean {
    const view=latestRecovery.current;
    if (!head || !allowed || !verifiedOwner || preview || tool!=='History' || saving || saveFlight.current || recoveryLock.current ||
        lastAppliedHead.current===head||!view||view.head!==head||!draftCurrent(view)) return false;
    if (pendingFields || sourceDirty) {
      setError('Apply or discard unapplied content and source buffers before restoring a saved checkpoint.');
      return false;
    }
    try {
      const next = restoreHistoricalSnapshot(head, snapshot, crypto.randomUUID());
      lastAppliedHead.current=head;
      setHead(next);
      setSlot(resolveInitialEditorSlot(next.snapshot,null).key);
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
    if(!allowed||!verifiedOwner||!record||!head||!operation||saving||saveFlight.current||recoveryLock.current||sourceDirty||pendingFields)return;
    const view=latestRecovery.current;
    if(!view||view.record!==record||view.head!==head||!scopeCurrent(view))return;
    const epoch=port.reconcileOwnerSessionEpoch();
    const currentSave=()=>{
      const current=latestRecovery.current;
      return !!current&&current.port===port&&current.id===id&&port.reconcileOwnerSessionEpoch()===epoch&&
        scopeCurrent(view)&&current.record===record&&current.head===head&&current.operation===operation;
    };
    async function persistAcknowledgedHistory(revision:number){
      if(!currentSave())return;
      try{
        const accepted=await new IndexedDbEditorDraftStore().saveCommittedHistory(
          verifiedOwner!.id,id,revision,head!);
        if(currentSave())setSavedHistoryNotice(accepted?
          'Undo/Redo history saved on this browser.':
          'Cloud draft saved; a different or newer browser history was retained.');
      }catch{
        if(currentSave())setSavedHistoryNotice('Cloud draft saved; browser history not confirmed. Export a working recovery copy before leaving.');
      }
    }
    saveFlight.current=true;
    setSaving(true);setError('');setNotice('');
    try{
      let confirmed:number|null=null;
      let failure='Draft save could not be confirmed.';
      try{
        const reply=await port.saveOwnerPortfolio(id,operation,record.revision,head.snapshot);
        if(!currentSave())return;
        if(reply.data===record.revision+1)confirmed=reply.data;
        else failure=reply.error?.message??failure;
      }catch{
        if(!currentSave())return;
      }
      if(confirmed!==null){
        await persistAcknowledgedHistory(confirmed);
        if(!currentSave())return;
        setRecord({...record,revision:confirmed,snapshot:head.snapshot});
        setOperation('');setNotice('Private portfolio draft saved.');return;
      }
      // A lost acknowledgement is not a failed commit. Reconcile using an
      // authenticated exact next-revision read, never a second mutation or
      // a new operation ID. A same-content concurrent commit is only evidence
      // that the intended draft is saved, not evidence of our operation ID.
      try{
        const fresh=await port.readOwnerPortfolio(id);
        if(!currentSave())return;
        if(fresh.data?.id===id&&fresh.data.revision===record.revision+1&&
           sameDraftSnapshot(fresh.data.snapshot,head.snapshot)){
          await persistAcknowledgedHistory(fresh.data.revision);
          if(!currentSave())return;
          setRecord(fresh.data);setOperation('');
          setNotice('Saved private revision verified by readback.');return;
        }
        if(fresh.data&&fresh.data.id===id&&fresh.data.revision!==record.revision)
          failure='The saved cloud revision changed. Compare or preserve your working draft before retrying.';
      }catch{
        if(!currentSave())return;
      }
      if(currentSave()){
        setError(failure);
        if(verifiedOwner)setRecoveryExpanded(true);
      }
    }finally{
      saveFlight.current=false;
      const current=latestRecovery.current;
      if(current?.port===port&&current.id===id&&port.reconcileOwnerSessionEpoch()===epoch&&
         scopeCurrent(view))setSaving(false);
    }
  }

  async function initialize() {
    const preset = presets.find(item => item.id === record?.templateId);
    if(!allowed||!verifiedOwner||!record||record.id!==id||!preset||saving||setupFlight.current||head)return;
    const view=latestRecovery.current;
    if(!view||view.record!==record||!scopeCurrent(view))return;
    const epoch=port.reconcileOwnerSessionEpoch();
    let pending=setupAttempt.current;
    if(!pending||pending.id!==id||pending.preset!==preset.id||pending.epoch!==epoch){
      pending={id,preset:preset.id,epoch,operation:crypto.randomUUID()};
      setupAttempt.current=pending;
    }
    const current=()=>{
      const live=latestRecovery.current;
      return !!live&&live.port===port&&live.id===id&&live.record===record&&
        port.reconcileOwnerSessionEpoch()===epoch&&scopeCurrent(view);
    };
    setupFlight.current=true;setSaving(true);setError('');
    try{
      const result=await port.initializeOwnerPortfolio(id,pending.operation,preset.id);
      if(!current())return;
      if(typeof result.data==='number'&&Number.isSafeInteger(result.data)&&result.data>0){
        setupAttempt.current=null;setAttempt(value=>value+1);
      }else setError(result.error?.message??'Draft setup could not be confirmed. Retry the same setup.');
    }catch{if(current())setError('Draft setup could not be confirmed. Retry the same setup.');}
    finally{setupFlight.current=false;if(current())setSaving(false);}
  }

  const active = slot ? head?.snapshot.slots[slot] : undefined;
  const canonicalSource=active?.state==='S0'&&active.componentId?canonicalLibraryComponentSource(active.componentId):undefined;
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
  const selectedLayoutSections=layerGroups.filter(group=>group.slots.some(item=>item.key===slot));
  const selectedLayoutSectionId=selectedLayoutSections.length===1?selectedLayoutSections[0]!.id:'';
  const compatible=compatibleComponentsForSlot(slot);
  const chosenComponent=compatible.find(item=>item.id===pickedComponent)??compatible[0];
  const targetPin=insertableComponentPins.find(item=>item.id===pickedComponent)??chosenComponent;
  const emptyComponentTargets=layerGroups.flatMap(group=>group.slots.filter(item=>item.state==='EMPTY')
    .map(item=>({key:item.key,label:group.title+' · '+item.name})));
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
  function canPlaceComponent(pin:string,target:string):boolean{
    return !!head&&!!verifiedOwner&&allowed&&!preview&&tool==='Components'&&!saving&&!recoveryBusy&&
      !pendingFields&&!sourceDirty&&head.snapshot.slots[target]?.state==='EMPTY'&&
      emptyComponentTargets.filter(item=>item.key===target).length===1&&
      compatibleComponentsForSlot(target).some(item=>item.id===pin);
  }
  function placeComponent(pin:string,target:string):boolean{
    const view=latestRecovery.current;
    if(!view||!head||view.head!==head||!draftCurrent(view)||!canPlaceComponent(pin,target))return false;
    if(!apply({kind:'ASSIGN_COMPONENT',slotKey:target,componentId:pin}))return false;
    setSlot(target);setTool('Content');return true;
  }
  function canReorderSection():boolean{
    return !!head&&!!verifiedOwner&&allowed&&!preview&&!['Source','Assets','History'].includes(tool)&&
      !saving&&!recoveryBusy&&!pendingFields&&!sourceDirty&&layerGroups.length>1;
  }
  function sectionDropAllowed(sectionId:string,beforeSectionId:string|null):boolean{
    if(!canReorderSection()||sectionId===beforeSectionId)return false;
    const ids=layerGroups.map(group=>group.id);
    if(new Set(ids).size!==ids.length||!ids.includes(sectionId))return false;
    const next=ids.filter(id=>id!==sectionId);
    const to=beforeSectionId===null?next.length:next.indexOf(beforeSectionId);
    if(to<0)return false;
    next.splice(to,0,sectionId);
    return next.some((id,index)=>id!==ids[index]);
  }
  function moveSectionBefore(beforeSectionId:string|null):boolean{
    const drag=sectionDrag.current;sectionDrag.current=null;setDraggingSection(null);
    const view=latestRecovery.current;
    if(!head||!drag||drag.head!==head||!view||!draftCurrent(view)||!sectionDropAllowed(drag.id,beforeSectionId))return false;
    return apply({kind:'MOVE_SECTION_BEFORE',sectionId:drag.id,beforeSectionId,expectedRevision:head.revision});
  }
  function canDropCanvasComponent(key:string):boolean{
    const drag=componentDrag.current,view=latestRecovery.current;
    return !!drag&&drag.head===head&&!!view&&view.head===head&&draftCurrent(view)&&canPlaceComponent(drag.pin,key);
  }
  function dropCanvasComponent(key:string):boolean{
    if(!canDropCanvasComponent(key))return false;
    const drag=componentDrag.current!;
    componentDrag.current=null;
    const placed=placeComponent(drag.pin,key);
    if(placed)setPickedComponent(drag.pin);
    return placed;
  }
  function canDropCanvasSection(before:string|null):boolean{
    const drag=sectionDrag.current,view=latestRecovery.current;
    return !!drag&&drag.head===head&&!!view&&view.head===head&&draftCurrent(view)&&sectionDropAllowed(drag.id,before);
  }
  function dropCanvasSection(before:string|null):boolean{
    return canDropCanvasSection(before)&&moveSectionBefore(before);
  }
  // Local storage is not an identity authority. Gate context is mandatory.
  type RecoveryView={port:SupabaseBrowserAuthPort;id:string;owner:VerifiedEditorOwner|undefined;
    record:PortfolioRecord|null;head:EditorHead|null;operation:string;fieldDrafts:Record<string,string>;
    sourceDrafts:Record<string,string>;seoDraft:{title:string;description:string}|null;dirty:boolean;saving:boolean;allowed:boolean;tool:string;preview:boolean};
  const latestRecovery=useRef<RecoveryView|null>(null);
  useLayoutEffect(()=>{
    latestRecovery.current={port,id,owner:verifiedOwner,record,head,operation,fieldDrafts,sourceDrafts,seoDraft,
      dirty:!!operation||pendingFields||sourceDirty,saving,allowed,tool,preview};
    return ()=>{latestRecovery.current=null;};
  },[port,id,verifiedOwner?.id,verifiedOwner?.epoch,record,head,operation,fieldDrafts,sourceDrafts,seoDraft,pendingFields,sourceDirty,saving,allowed,tool,preview]);
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
    setRecoveryCopies(null);setRecoveryNotice('');setRecoveryComparison(null);recoveryAttempt.current=null;importedRecoveryAttempt.current=null;
    const request=++catalogueRequest.current;
    const view=latestRecovery.current;
    if(!view?.owner||!view.record||view.record.id!==id||!scopeCurrent(view))return;
    let active=true;
    void (async()=>{
      try{
        const copies=await new IndexedDbEditorDraftStore().listRecoveryCopies(view.owner!.id,id);
        if(active&&request===catalogueRequest.current&&scopeCurrent(view))setRecoveryCopies(copies);
      }catch{
        if(active&&request===catalogueRequest.current&&scopeCurrent(view))setRecoveryNotice('Browser recovery storage could not be read. Cloud draft unchanged.');
      }
    })();
    return ()=>{active=false;};
  },[port,id,verifiedOwner?.id,verifiedOwner?.epoch,recoveryRecordId]);
  function captureRecovery():RecoveryView|null {
    const view=latestRecovery.current;
    return view?.owner&&view.record?.id===id&&view.head&&view.allowed&&!view.saving&&!saveFlight.current&&scopeCurrent(view)?view:null;
  }
  async function refreshRecovery(view:RecoveryView,store:IndexedDbEditorDraftStore){
    const request=++catalogueRequest.current;
    const copies=await store.listRecoveryCopies(view.owner!.id,view.id);
    if(request===catalogueRequest.current&&scopeCurrent(view))setRecoveryCopies(copies);
  }
  function recoveryPayload(view:RecoveryView):EditorRecoveryPayload {
    if(!view.record||!view.head)throw new Error('Working draft unavailable.');
    return {formatVersion:1,cloudBaseRevision:view.record.revision,localRevision:view.head.revision,
      cloudOperationId:view.operation||null,snapshot:view.head.snapshot,fieldDrafts:view.fieldDrafts,
      ...((view.head.undo.length||view.head.redo.length)?{history:{undo:view.head.undo,redo:view.head.redo}}:{}),
      sourceDrafts:view.sourceDrafts,seoDraft:view.seoDraft};
  }
  const hasHistory=!!head&&(head.undo.length>0||head.redo.length>0);
  const canPreserveWorking=!!operation||pendingFields||sourceDirty||hasHistory;
  // A checkpoint is optional and bound to this verified mounted editor only.
  // It never authenticates a new session, replaces another tab, or writes cloud.
  useLayoutEffect(()=>{
    checkpointEnabled.current=autoRecovery;
    return ()=>{checkpointEnabled.current=false;};
  },[autoRecovery]);
  useEffect(()=>{
    if(!autoRecovery||!verifiedOwner||!head||!record||!canPreserveWorking||saving||recoveryBusy)return;
    const view=latestRecovery.current;
    if(!view||!scopeCurrent(view))return;
    const payload=recoveryPayload(view);
    const signature=JSON.stringify(payload);
    if(checkpointWriter.current?.signature===signature||frozenCheckpoint.current?.signature===signature){setCheckpointState('saved');return;}
    setCheckpointState('pending');
    let cancelled=false;
    const timer=window.setTimeout(()=>{
      if(cancelled||!checkpointEnabled.current||!draftCurrent(view)||checkpointFlight.current||recoveryLock.current)return;
      let writer=checkpointWriter.current;
      if(!writer){writer={id:crypto.randomUUID(),sequence:0,signature:''};checkpointWriter.current=writer;}
      const activeWriter=writer;
      if(checkpointConflict.current===activeWriter.id){setCheckpointState('failed');return;}
      checkpointFlight.current=true;
      void (async()=>{
        try{
          const store=new IndexedDbEditorDraftStore();
          const receipt=await store.writeRecoveryCheckpoint(view.owner!.id,view.id,activeWriter.id,activeWriter.sequence,payload);
          if(!Number.isSafeInteger(receipt.checkpointSequence)||receipt.checkpointSequence!==activeWriter.sequence+1)
            throw new Error('Invalid checkpoint acknowledgement.');
          activeWriter.sequence=receipt.checkpointSequence!;
          activeWriter.signature=signature;
          checkpointConflict.current=null;
          if(!scopeCurrent(view))return;
          // A newer buffer may have arrived during IndexedDB I/O.
          if(draftCurrent(view))setCheckpointState('saved');else setCheckpointState('pending');
          await refreshRecovery(view,store);
        }catch(cause){
          if(cause instanceof ContractError&&cause.code==='REVISION_CONFLICT')checkpointConflict.current=activeWriter.id;
          if(scopeCurrent(view)){setCheckpointState('failed');setRecoveryExpanded(true);}
        }finally{
          checkpointFlight.current=false;
          // Re-evaluate a newer pending draft after the single writer releases.
          if(scopeCurrent(view)&&checkpointEnabled.current&&!draftCurrent(view))setCheckpointRetry(n=>n+1);
        }
      })();
    },650);
    return ()=>{cancelled=true;window.clearTimeout(timer);};
  },[autoRecovery,verifiedOwner?.id,verifiedOwner?.epoch,port,id,record,head,operation,fieldDrafts,sourceDrafts,seoDraft,pendingFields,sourceDirty,saving,recoveryBusy,checkpointRetry]);
  function retryCheckpoint(){
    const view=captureRecovery();
    if(!view||(!view.dirty&&!view.head?.undo.length&&!view.head?.redo.length)||!checkpointEnabled.current||checkpointFlight.current||recoveryLock.current)return;
    const writer=checkpointWriter.current;
    // Only an explicit owner retry may abandon a rejected sequence. Ordinary I/O
    // failures retain the ID and sequence for an idempotent acknowledgement retry.
    if(writer&&checkpointConflict.current===writer.id){
      checkpointWriter.current=null;checkpointConflict.current=null;
    }
    setCheckpointRetry(n=>n+1);
  }
  /** Recovery destinations all use the same authenticated, exact saved-base
   * history. A cache failure never blocks the cloud draft or authorizes a
   * stale write. Callers fence the asynchronous read against their live view. */
  async function readCommittedCloudHead(view:RecoveryView,fresh:PortfolioRecord){
    if(!view.owner||fresh.id!==view.id||!fresh.snapshot)throw new Error('Saved cloud revision unavailable.');
    const fallback=createEditorHead(fresh.snapshot);
    try{
      const cached=await new IndexedDbEditorDraftStore().loadCommittedHistory(
        view.owner.id,view.id,fresh.revision,fresh.snapshot);
      return {head:cached??fallback,notice:cached?'Saved Undo/Redo history restored from this browser.':
        'No matching browser history for this saved cloud revision.'};
    }catch{
      return {head:fallback,notice:'Saved cloud draft loaded; browser Undo/Redo history could not be read.'};
    }
  }
  function installCloudDraft(fresh:PortfolioRecord,committed?:{head:EditorHead;notice:string}){
    if(!fresh.snapshot)throw new Error('Saved cloud revision unavailable.');
    const next=committed?.head??createEditorHead(fresh.snapshot);
    if(!sameDraftSnapshot(next.snapshot,fresh.snapshot))throw new Error('Saved history does not match cloud draft.');
    setSavedHistoryNotice(committed?.notice??'');
    setPortableComparison(null);setPortableFile('');setFolderComparison(null);setRecoveryComparison(null);
    setRecord(fresh);setHead(next);setOperation('');
    setSlot(orderedLayerGroups(fresh.snapshot).flatMap(group=>group.slots).find(item=>item.name==='title')?.key??'');
    setFieldDrafts({});setFieldIssues({});setSeoDraft(null);setSourceDrafts({});
    setSourceReset(value=>value+1);setError('');setNotice('');
  }
  async function forgetSavedHistory(){
    const view=captureRecovery();
    if(!view?.record||!view.head||view.dirty||recoveryLock.current)return;
    if(!window.confirm('Forget the saved Undo/Redo cache on this browser? Your current working stack, browser recovery copies and cloud draft will not be changed.'))return;
    if(!draftCurrent(view))return;
    recoveryLock.current=true;setRecoveryBusy(true);
    try{
      const removed=await new IndexedDbEditorDraftStore().forgetCommittedHistory(
        view.owner!.id,view.id,view.record.revision);
      if(scopeCurrent(view))setSavedHistoryNotice(removed?
        'Saved history removed from this browser. Current editor history and cloud draft remain unchanged.':
        'A newer saved history exists in another tab. Nothing was removed.');
    }catch{if(scopeCurrent(view))setSavedHistoryNotice('Browser history removal was not confirmed.');}
    finally{recoveryLock.current=false;if(scopeCurrent(view))setRecoveryBusy(false);}
  }
  async function preserveRecovery(keepBoth:boolean){
    const view=captureRecovery();
    if(!view||!view.record||!view.head||recoveryLock.current||(!view.dirty&&(keepBoth||(!view.head.undo.length&&!view.head.redo.length))))return;
    recoveryLock.current=true;setRecoveryBusy(true);setRecoveryNotice('');
    let acknowledged=false;
    try{
      const payload=recoveryPayload(view);
      const signature=JSON.stringify(payload);
      const store=new IndexedDbEditorDraftStore();
      const writer=checkpointWriter.current;
      let attempt=recoveryAttempt.current;
      if(writer&&writer.sequence>0&&writer.signature===signature&&!checkpointFlight.current){
        // Reuse an exact local checkpoint instead of consuming another quota slot.
        await store.freezeRecoveryCheckpoint(view.owner!.id,view.id,writer.id,writer.sequence,payload);
        attempt={signature,copyId:writer.id};recoveryAttempt.current=attempt;
        frozenCheckpoint.current={signature,id:writer.id};checkpointWriter.current=null;
      }else{
        if(!attempt||attempt.signature!==signature){
          attempt={signature,copyId:crypto.randomUUID()};recoveryAttempt.current=attempt;
        }
        await store.saveRecoveryCopy(view.owner!.id,view.id,attempt.copyId,payload);
      }
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
      const committed=await readCommittedCloudHead(view,fresh.data);
      if(!draftCurrent(view))return;
      installCloudDraft(fresh.data,committed);
      setRecoveryNotice('Both versions preserved: browser recovery copy and latest saved cloud draft. No cloud revision was overwritten.');
    }catch{
      if(scopeCurrent(view))setRecoveryNotice(acknowledged?
        'Recovery copy saved, but the follow-up read failed. Working edits remain.':
        'Recovery copy not confirmed. Keep the editor open; browser storage may be full or unavailable.');
    }finally{recoveryLock.current=false;if(scopeCurrent(view))setRecoveryBusy(false);}
  }
  async function inspectRecovery(copyId:string,action:'compare'|'open'|'restore'|'export'){
    const view=captureRecovery();
    if(!view||recoveryLock.current||!view.record||!view.head||((action==='open'||action==='restore')&&view.dirty))return;
    const priorComparison=recoveryComparison;
    if(action==='restore'&&priorComparison?.copyId!==copyId)return;
    recoveryLock.current=true;setRecoveryBusy(true);setRecoveryNotice('');setRecoveryComparison(null);
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
      const stale=recovered.cloudBaseRevision!==fresh.data.revision;
      if(action==='restore'&&(!stale||priorComparison?.cloudRevision!==fresh.data.revision||
        priorComparison.checkpointSequence!==copy.checkpointSequence)){
        setRecoveryNotice('The compared cloud revision is no longer current. Compare the recovery copy again; no draft was replaced.');
        return;
      }
      if(action==='compare'||(action==='open'&&stale)||view.dirty){
        const paths=new Set([...Object.keys(saved.files),...Object.keys(recovered.snapshot.files)]);
        const changedFiles=[...paths].filter(path=>saved.files[path]!==recovered.snapshot.files[path]).sort();
        const keys=new Set([...Object.keys(saved.slots),...Object.keys(recovered.snapshot.slots),
          ...Object.keys(saved.stashes),...Object.keys(recovered.snapshot.stashes)]);
        const stable=(value:unknown)=>JSON.stringify(value,(_key,v:unknown)=>
          v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
        const changedSlots=[...keys].filter(key=>stable(saved.slots[key])!==stable(recovered.snapshot.slots[key])||
          stable(saved.stashes[key])!==stable(recovered.snapshot.stashes[key])).sort();
        setRecoveryComparison({copyId:copy.copyId,cloudRevision:fresh.data.revision,changedFiles,changedSlots,
          checkpointSequence:copy.checkpointSequence,
          pendingCount:Object.keys(recovered.fieldDrafts).length+Object.keys(recovered.sourceDrafts).length+(recovered.seoDraft?1:0)});
        setRecoveryNotice('Recovery base '+recovered.cloudBaseRevision+' · cloud revision '+fresh.data.revision+
          ' · '+changedFiles.length+' differing files · '+changedSlots.length+' differing slots/stashes. '+
          (stale?'Cloud changed; both versions remain separate. Export the copy, or explicitly restore it into an unsaved draft after reviewing this comparison.':'Copy remains separate; no cloud change.'));
        return;
      }
      if(action==='restore'){
        const accepted=window.confirm('Restore recovery copy based on revision '+recovered.cloudBaseRevision+
          ' as an unsaved working draft against cloud revision '+fresh.data.revision+
          '? The original recovery copy and current saved cloud revision will remain intact. '+
          'A separate Save is required and will be rejected if the cloud advances again.');
        if(!accepted||!draftCurrent(view)){setRecoveryNotice('Recovery restore cancelled. Both versions remain unchanged.');return;}
      }
      // Reopen same-base history losslessly; stale restore is a deliberate new
      // transaction against current cloud, never resurrect an old replay ID.
      const recoveredHistory=stale?null:recoverEditorHistory(recovered);
      const next=recoveredHistory??restoreHistoricalSnapshot(createEditorHead(saved),recovered.snapshot,crypto.randomUUID());
      const issues:Record<string,string>={};
      for(const [key,value] of Object.entries(recovered.fieldDrafts)){
        if(key.endsWith(':url')){const warning=ownerLinkError(value);if(warning)issues[key]=warning;}
      }
      installCloudDraft(fresh.data);
      setHead(next);setOperation(sameDraftSnapshot(saved,next.snapshot)?'':crypto.randomUUID());setFieldDrafts(recovered.fieldDrafts);
      setFieldIssues(issues);setSeoDraft(recovered.seoDraft);setSourceDrafts(recovered.sourceDrafts);
      if(Object.keys(recovered.sourceDrafts).length)setOpenedSource(true);
      const recoveredEdits=!sameDraftSnapshot(saved,next.snapshot)||Object.keys(recovered.fieldDrafts).length>0||
        Object.keys(recovered.sourceDrafts).length>0||recovered.seoDraft!==null;
      setRecoveryNotice(action==='restore'?
        'Older recovery copy restored into an unsaved working draft. Both saved versions remain intact; review buffers before an explicit CAS Save.':
        recoveredEdits?'Recovery copy opened as an unsaved working draft. Original copy and cloud revision unchanged.':
        recoveredHistory?'Recovery copy reopened with its exact local Undo/Redo history. Original copy and cloud revision unchanged.':
        'Recovery copy opened as a working draft. Original copy and cloud revision unchanged.');
    }catch{
      if(scopeCurrent(view))setRecoveryNotice('Recovery operation not completed. No working or cloud draft was replaced.');
    }finally{recoveryLock.current=false;if(scopeCurrent(view))setRecoveryBusy(false);}
  }
  /** Revalidate the selected owner metadata immediately before placement.
   * No arbitrary URLs, storage keys or invented byte digests enter the slot. */
  async function placeAsset(assetId:string,target:string,altText:string):Promise<boolean>{
    const view=captureRecovery();
    if(!view||!view.head||view.tool!=='Assets'||view.preview||recoveryLock.current||!canPlacePrivateImage(view.head.snapshot,target))return false;
    if(sourceDirty||Object.keys(view.fieldDrafts).some(key=>key.startsWith(target+':'))){
      setError('Apply or discard pending target/source edits before placing an image.');return false;
    }
    recoveryLock.current=true;setRecoveryBusy(true);
    try{
      const response=await view.port.listOwnerAssets();
      if(!draftCurrent(view)||latestRecovery.current?.tool!=='Assets'||latestRecovery.current.preview)return false;
      const asset=response.data?.find(row=>row.id===assetId);
      if(response.error||!asset||!['image/png','image/jpeg','image/webp'].includes(asset.mime)||
         !Number.isSafeInteger(asset.size)||asset.size<1||asset.size>5*1024*1024){
        setError('Current owner image registration could not be verified. No slot was changed.');return false;
      }
      // Validate physical owner-private bytes through the authenticated port.
      // This is still a draft reference, never a public asset or a new digest pin.
      const read=await view.port.readOwnerPrivateAsset(asset.projectId,asset.id,view.owner!.epoch);
      if(!draftCurrent(view)||latestRecovery.current?.tool!=='Assets'||latestRecovery.current.preview)return false;
      const data=read.data;
      if(read.error||!data||data.asset.id!==asset.id||data.asset.projectId!==asset.projectId||
         data.asset.mime!==asset.mime||data.asset.size!==asset.size||!(data.bytes instanceof Blob)||
         data.bytes.type!==asset.mime||data.bytes.size!==asset.size||
         data.integrity.status!=='OWNER_BYTES_VERIFIED'||!/^[a-f0-9]{64}$/.test(data.integrity.computedSha256)||
         !['NOT_VERIFIED','SERVER_HASH_PINNED'].includes(data.serverAttestation)||data.publicDeliveryAllowed!==false){
        setError('Owner-private image bytes could not be verified. Retry from Assets; existing assignment was kept.');return false;
      }
      // The transport receipt is necessary, but a registration or matching
      // header alone is not a decodable image. Verify the exact immutable
      // bytes and decode locally before committing the slot transaction.
      const bound=()=>draftCurrent(view)&&latestRecovery.current?.tool==='Assets'&&!latestRecovery.current.preview;
      const buffer=await data.bytes.arrayBuffer();
      if(!bound())return false;
      const bytes=new Uint8Array(buffer);
      const png=bytes.length>=8&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value);
      const jpeg=bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
      const webp=bytes.length>=12&&[82,73,70,70].every((value,index)=>bytes[index]===value)&&
        [87,69,66,80].every((value,index)=>bytes[index+8]===value);
      if(bytes.byteLength!==asset.size||!(asset.mime==='image/png'?png:asset.mime==='image/jpeg'?jpeg:webp)){
        setError('Image bytes do not match the verified raster format. Existing assignment was kept.');return false;
      }
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),value=>value.toString(16).padStart(2,'0')).join('');
      if(!bound())return false;
      if(digest!==data.integrity.computedSha256){
        setError('Image bytes do not match the verified digest. Existing assignment was kept.');return false;
      }
      const url=URL.createObjectURL(data.bytes);
      const probe=new Image();
      let deadline:number|undefined;
      try{
        probe.src=url;
        await Promise.race([probe.decode(),new Promise<never>((_,reject)=>{
          deadline=window.setTimeout(()=>reject(new Error('Image decode timed out.')),10000);
        })]);
        if(!bound())return false;
        if(!Number.isSafeInteger(probe.naturalWidth)||!Number.isSafeInteger(probe.naturalHeight)||
          probe.naturalWidth<1||probe.naturalHeight<1)throw new Error('Empty image decode.');
      }catch{
        if(bound())setError('The private raster could not be decoded. Existing assignment was kept.');
        return false;
      }finally{
        if(deadline!==undefined)window.clearTimeout(deadline);
        probe.removeAttribute('src');
        URL.revokeObjectURL(url);
      }
      if(!bound())return false;
      recoveryLock.current=false;
      if(!apply({kind:'PLACE_PRIVATE_IMAGE',slotKey:target,assetId:asset.id,altText}))return false;
      setSlot(target);setNotice('Private image reference applied after exact byte verification and raster decoding. Save draft to persist it; no publication pin or release authority was granted.');
      return true;
    }catch{
      if(scopeCurrent(view))setError('Asset validation failed. No slot was changed.');
      return false;
    }finally{recoveryLock.current=false;if(scopeCurrent(view))setRecoveryBusy(false);}
  }
  // The explicit folder backup is a separate persistence destination and
  // starts its own revision at zero. Never equate it with a cloud Save.
  // Reopening receives data only after a fresh authenticated owner read.
  function portableDifference(before:PortfolioSnapshot,after:PortfolioSnapshot){
    const paths=new Set([...Object.keys(before.files),...Object.keys(after.files)]);
    const keys=new Set([...Object.keys(before.slots),...Object.keys(after.slots),
      ...Object.keys(before.stashes),...Object.keys(after.stashes)]);
    const stable=(value:unknown)=>JSON.stringify(value,(_key,v:unknown)=>
      v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
    return {changedFiles:[...paths].filter(path=>before.files[path]!==after.files[path]).sort(),
      changedSlots:[...keys].filter(key=>stable(before.slots[key])!==stable(after.slots[key])||
        stable(before.stashes[key])!==stable(after.stashes[key])).sort()};
  }
  async function folderOperation(action:'backup'|'compare'|'restore'){
    const view=captureRecovery(),previewed=folderComparison;
    if(!view||!view.head||!view.record||recoveryLock.current||!folderSupported||
       pendingFields||sourceDirty||((action==='compare'||action==='restore')&&view.dirty))return;
    if(action==='restore'&&!previewed)return;
    if(!draftCurrent(view))return;
    recoveryLock.current=true;setRecoveryBusy(true);setFolderNotice('');
    if(action!=='restore')setFolderComparison(null);
    try{
      // Invoke the picker directly in the user action, before any await of
      // network/other APIs; browsers require transient user activation.
      const directory=action==='restore'?previewed!.directory:await folderPicker!.call(window,{mode:'readwrite'});
      if(!draftCurrent(view))return;
      if(action==='backup'&&!window.confirm('Create a new private folder backup of the applied working snapshot? No cloud save, raw buffers, image bytes or editor undo history will be included.')){
        setFolderNotice('Folder backup cancelled. Draft unchanged.');return;
      }
      if(action==='compare'&&!window.confirm('Inspect this folder for an existing backup? A verified interrupted journal may be repaired; no cloud revision will be changed.')){
        setFolderNotice('Folder comparison cancelled. Draft unchanged.');return;
      }
      if(!draftCurrent(view))return;
      const store=new JournaledEditorFolderStore(directory,view.owner!.id,view.id,undefined,()=>draftCurrent(view));
      if(action==='backup'){
        const receipt=await store.save(createEditorHead(view.head.snapshot),null,true);
        if(!scopeCurrent(view))return;
        setFolderNotice(receipt.status==='FOLDER_SAVED'?
          'New folder backup saved. Cloud draft unchanged; image files are not included.':
          'Folder head acknowledged, but journal cleanup is pending. Verify the folder again before relying on it; cloud draft unchanged.');
        return;
      }
      const fresh=await view.port.readOwnerPortfolio(view.id);
      if(!draftCurrent(view))return;
      if(!fresh.data?.snapshot||fresh.data.id!==view.id||fresh.data.revision!==view.record.revision||
         !sameDraftSnapshot(fresh.data.snapshot,view.record.snapshot)){
        setFolderComparison(null);setFolderNotice('Current cloud revision could not be verified or has changed. Reload the saved draft before comparing a folder.');return;
      }
      const recovered=await store.load();
      if(!draftCurrent(view))return;
      if(!recovered){setFolderComparison(null);setFolderNotice('No verified backup head found in this folder. Nothing was imported.');return;}
      if(action==='compare'){
        setFolderComparison({directory,folderHead:recovered,cloudRevision:fresh.data.revision,
          ...portableDifference(fresh.data.snapshot,recovered.snapshot)});
        setFolderNotice('Compared the verified folder snapshot with the current cloud draft. Both remain separate.');return;
      }
      if(!previewed||previewed.cloudRevision!==fresh.data.revision||
        stableDraftValue(previewed.folderHead)!==stableDraftValue(recovered)){
        setFolderComparison(null);setFolderNotice('Folder or cloud version changed after comparison. Compare again; no draft was replaced.');return;
      }
      if(!window.confirm('Restore the compared folder snapshot as an unsaved working draft? The folder and currently saved cloud revision remain separate. Review private asset references before a separate Save.'))return;
      if(!draftCurrent(view))return;
      const next=restoreHistoricalSnapshot(view.head,recovered.snapshot,crypto.randomUUID());
      setHead(next);setRecord(fresh.data);setOperation(crypto.randomUUID());
      setSlot(resolveInitialEditorSlot(next.snapshot,null).key);
      setFieldDrafts({});setFieldIssues({});setSeoDraft(null);setSourceDrafts({});
      setSourceReset(value=>value+1);setFolderComparison(null);
      setFolderNotice('Folder snapshot opened as an unsaved working draft. Undo is available. No cloud save or media-byte verification occurred.');
    }catch(cause){
      if(scopeCurrent(view)){
        setFolderComparison(null);
        const cancelled=(cause as {name?:string}|null)?.name==='AbortError';
        setFolderNotice(cancelled?'Folder selection cancelled. Draft unchanged.':
          cause instanceof FolderCommitError&&cause.code==='CONFLICT'?
            'Folder conflict or existing backup detected. No draft was replaced. Choose a new folder or explicitly compare the existing backup.':
            'Folder operation not confirmed. Permission, storage or journal recovery may be required. Your working draft remains intact.');
      }
    }finally{recoveryLock.current=false;if(scopeCurrent(view))setRecoveryBusy(false);}
  }
  async function portableOperation(action:'export'|'compare'|'restore',file?:File,format:'json'|'zip'='json'){
    const view=captureRecovery(),previewed=portableComparison;
    if(!view||!view.head||!view.record||recoveryLock.current||pendingFields||sourceDirty||
      (action!=='export'&&view.dirty))return;
    if(action==='compare'&&!file||action==='restore'&&!previewed)return;
    recoveryLock.current=true;setRecoveryBusy(true);setPortableNotice('');
    if(action==='compare'){setPortableComparison(null);setPortableFile('');}
    try{
      if(action==='export'){
        let data:Blob;
        if(format==='zip'){
          const {exportPortfolioSourceZip,importPortfolioSourceZip}=await import('../../../packages/storage-adapters/src/portable-source-archive.ts');
          if(!draftCurrent(view))return;
          const archive=exportPortfolioSourceZip(view.head.snapshot);
          if(!sameDraftSnapshot(importPortfolioSourceZip(archive),view.head.snapshot))throw new Error('Source ZIP round-trip failed.');
          data=new Blob([new Uint8Array(archive).buffer],{type:'application/zip'});
        }else data=new Blob([exportPortableSnapshot(view.head.snapshot)],{type:'application/json'});
        if(!draftCurrent(view))return;
        const url=URL.createObjectURL(data);
        const link=document.createElement('a');
        link.href=url;link.download='kadmeion-private-project-'+view.id+'.'+format;
        try{document.body.append(link);link.click();}
        finally{link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
        setPortableNotice('Private snapshot download requested. No cloud save or media-file export occurred.');return;
      }
      const sizeLimit=(format==='zip'?2:1)*1024*1024;
      if(action==='compare'&&(!file||file.size<1||file.size>sizeLimit)){
        setPortableNotice(format==='zip'?'Choose an editable Kadmeion source ZIP within 2 MiB. Nothing was imported.':
          'Choose a Kadmeion private project JSON file within 1 MiB. Nothing was imported.');return;
      }
      const fresh=await view.port.readOwnerPortfolio(view.id);
      if(!draftCurrent(view))return;
      if(!fresh.data?.snapshot||fresh.data.id!==view.id||fresh.data.revision!==view.record.revision||
         !sameDraftSnapshot(fresh.data.snapshot,view.record.snapshot)){
        setPortableComparison(null);setPortableNotice('Current cloud revision changed or could not be verified. Reload the saved draft and compare again.');return;
      }
      if(action==='compare'){
        const bytes=await file!.arrayBuffer();
        if(!draftCurrent(view))return;
        if(bytes.byteLength<1||bytes.byteLength>sizeLimit)throw new Error('Invalid snapshot byte length.');
        let snapshot:PortfolioSnapshot;
        if(format==='zip'){
          const {importPortfolioSourceZip}=await import('../../../packages/storage-adapters/src/portable-source-archive.ts');
          if(!draftCurrent(view))return;
          snapshot=importPortfolioSourceZip(new Uint8Array(bytes));
        }else snapshot=importPortableSnapshot(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));
        if(!draftCurrent(view))return;
        // Verify the digest of the exact user-provided bytes, not a normalized
        // JSON string or generated replacement archive. This is a fingerprint,
        // not a signature, media attestation, or claim of trusted code.
        const digest=await crypto.subtle.digest('SHA-256',bytes);
        if(!draftCurrent(view))return;
        const archiveSha256=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
        const difference=portableDifference(fresh.data.snapshot,snapshot);
        setPortableFile(difference.changedFiles[0]??'');
        setPortableComparison({snapshot,baseSnapshot:fresh.data.snapshot,
          ownerKey:JSON.stringify([view.owner!.id,view.owner!.epoch,view.id]),
          format,cloudRevision:fresh.data.revision,archiveSha256,...difference});
        setPortableNotice((format==='zip'?'Private source ZIP verified and compared.':'Private project JSON parsed and compared.')+
          ' This is user-provided data, not proof of asset access or trusted code. No draft was changed.');return;
      }
      if(!previewed||previewed.cloudRevision!==fresh.data.revision||
         previewed.ownerKey!==JSON.stringify([view.owner!.id,view.owner!.epoch,view.id])||
         !sameDraftSnapshot(previewed.baseSnapshot,fresh.data.snapshot)){
        setPortableComparison(null);setPortableNotice('Cloud version changed after comparison. Compare again; no draft was replaced.');return;
      }
      if(sameDraftSnapshot(previewed.snapshot,fresh.data.snapshot)){
        setPortableNotice('The compared snapshot is identical to the saved draft. No duplicate revision was created.');return;
      }
      if(!window.confirm('Restore the compared private snapshot as an unsaved draft in this portfolio? The original file and saved cloud revision remain unchanged until a separate Save. Review imported source and asset references.'))return;
      if(!draftCurrent(view))return;
      const next=restoreHistoricalSnapshot(view.head,previewed.snapshot,crypto.randomUUID());
      setHead(next);setRecord(fresh.data);setOperation(crypto.randomUUID());
      setSlot(resolveInitialEditorSlot(next.snapshot,null).key);
      setFieldDrafts({});setFieldIssues({});setSeoDraft(null);setSourceDrafts({});
      setSourceReset(value=>value+1);setPortableComparison(null);
      setPortableNotice('Imported as an unsaved draft. Undo is available. No cloud save, media-byte verification or source execution occurred.');
    }catch{
      if(scopeCurrent(view)){setPortableComparison(null);setPortableNotice('Snapshot operation rejected or not confirmed. Use a valid bounded Kadmeion private project JSON or editable source ZIP; your draft remains intact.');}
    }finally{recoveryLock.current=false;if(scopeCurrent(view))setRecoveryBusy(false);}
  }
  function exportWorkingRecovery(includeHistory=true){
    // This exports only bytes currently visible to an already verified,
    // mounted owner. It never loads local copies or bypasses the gate.
    const view=captureRecovery();
    if(!view||(!view.dirty&&!view.head?.undo.length&&!view.head?.redo.length)||recoveryLock.current)return;
    try{
      const payload=recoveryPayload(view);
      if(!includeHistory)delete payload.history;
      const url=URL.createObjectURL(new Blob([JSON.stringify(payload)],{type:'application/json'}));
      const link=document.createElement('a');
      link.href=url;link.download='kadmeion-working-recovery-'+view.id+'.json';
      try{if(!scopeCurrent(view))return;document.body.append(link);link.click();}
      finally{link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
      setRecoveryNotice(includeHistory?'Working recovery export requested. No browser or cloud save is implied. Keep this private file safe.':
        'Draft and buffer export requested without Undo/Redo history. Your current history is unchanged. Keep this private file safe.');
    }catch{if(scopeCurrent(view))setRecoveryNotice('Working recovery export could not be prepared. Your current edits remain.');}
  }
  /** Import a private working-recovery JSON as a separate local copy, never
   * directly as current working state. Exported v1 files contain no identity
   * assertion; the selected owner must explicitly review the target. */
  async function importWorkingRecovery(file:File){
    const view=captureRecovery();
    if(!view||!view.record||!view.head||recoveryLock.current)return;
    if(file.size<1||file.size>MAX_RECOVERY_BYTES){
      setRecoveryNotice('Choose a working recovery JSON within 8 MiB. No recovery copy was added.');return;
    }
    recoveryLock.current=true;setRecoveryBusy(true);setRecoveryNotice('');
    try{
      const fresh=await view.port.readOwnerPortfolio(view.id);
      if(!draftCurrent(view))return;
      if(!fresh.data?.snapshot||fresh.data.id!==view.id||fresh.data.revision!==view.record.revision||
         !sameDraftSnapshot(fresh.data.snapshot,view.record.snapshot)){
        setRecoveryNotice('Current cloud revision changed or is unavailable. Reload and compare before importing a recovery copy.');return;
      }
      const bytes=await file.arrayBuffer();
      if(!draftCurrent(view))return;
      if(bytes.byteLength<1||bytes.byteLength>MAX_RECOVERY_BYTES)throw new Error('Invalid recovery byte length.');
      const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
      const payload=JSON.parse(text) as EditorRecoveryPayload;
      validateRecoveryPayload(payload);
      const {changedFiles,changedSlots}=portableDifference(fresh.data.snapshot,payload.snapshot);
      const buffers=Object.keys(payload.fieldDrafts).length+Object.keys(payload.sourceDrafts).length+(payload.seoDraft?1:0);
      if(!window.confirm('Import this private working recovery into '+view.record.title+
        '? The file claims base revision '+payload.cloudBaseRevision+'; current cloud revision '+fresh.data.revision+
        '. '+changedFiles.length+' different file paths, '+changedSlots.length+' different slots or stashes, '+
        buffers+' unapplied buffers. Only import a file you recognize as belonging to this project. '+
        'It will be stored as a separate browser copy, not opened or saved to cloud. No source or media trust is granted.')){
        setRecoveryNotice('Working recovery import cancelled. Current draft and cloud are unchanged.');return;
      }
      if(!draftCurrent(view))return;
      const signature=JSON.stringify(payload);
      let attempt=importedRecoveryAttempt.current;
      if(!attempt||attempt.signature!==signature){
        attempt={signature,copyId:crypto.randomUUID()};importedRecoveryAttempt.current=attempt;
      }
      const store=new IndexedDbEditorDraftStore();
      const receipt=await store.saveRecoveryCopy(view.owner!.id,view.id,attempt.copyId,payload);
      if(!scopeCurrent(view))return;
      if(receipt.copyId!==attempt.copyId||receipt.cloudBaseRevision!==payload.cloudBaseRevision||
         receipt.checkpointSequence!==undefined)throw new Error('Unconfirmed recovery import receipt.');
      setRecoveryNotice('Working recovery JSON saved as a separate browser copy. Compare or open it explicitly. Current draft and cloud unchanged.');
      try{await refreshRecovery(view,store);}
      catch{if(scopeCurrent(view))setRecoveryNotice('Working recovery import acknowledged; the catalogue refresh failed. Reopen the editor to inspect the copy.');}
    }catch(cause){
      if(scopeCurrent(view))setRecoveryNotice(cause instanceof ContractError?cause.message:
        'Working recovery file rejected or storage not confirmed. Your current draft and original file remain intact.');
    }finally{recoveryLock.current=false;if(scopeCurrent(view))setRecoveryBusy(false);}
  }
  async function reloadSavedDraft(){
    // Never erase buffers or the current head until the read has succeeded.
    const view=latestRecovery.current;
    if(!view?.owner||!view.allowed||saving||saveFlight.current||recoveryLock.current||!scopeCurrent(view))return;
    if(!view.record||!view.head){setError('');setAttempt(n=>n+1);return;}
    if(view.dirty&&(!window.confirm('Discard current unsaved edits and load the latest private cloud draft? Existing browser recovery copies are not removed.')||!draftCurrent(view)))return;
    recoveryLock.current=true;setRecoveryBusy(true);
    try{
      const result=await view.port.readOwnerPortfolio(view.id);
      if(!draftCurrent(view))return;
      if(result.error||!result.data?.snapshot||result.data.id!==view.id){
        setError('Latest cloud draft could not be verified. Current edits remain intact.');return;
      }
      const committed=await readCommittedCloudHead(view,result.data);
      if(!draftCurrent(view))return;
      installCloudDraft(result.data,committed);
      setNotice('Latest saved cloud draft loaded. Existing browser recovery copies were retained.');
    }catch{if(scopeCurrent(view))setError('Cloud reload failed. Current edits remain intact.');}
    finally{recoveryLock.current=false;if(scopeCurrent(view))setRecoveryBusy(false);}
  }
  async function removeRecovery(copyId:string){
    const view=captureRecovery();
    if(!view||recoveryLock.current||!window.confirm('Remove this browser recovery copy? This cannot be undone. Cloud draft is unaffected.'))return;
    if(!scopeCurrent(view))return;
    recoveryLock.current=true;setRecoveryBusy(true);setRecoveryNotice('');
    try{
      const store=new IndexedDbEditorDraftStore();
      const selected=recoveryCopies?.find(copy=>copy.copyId===copyId);
      if(!selected)return;
      const removingWriter=checkpointWriter.current?.id===copyId;
      if(removingWriter&&checkpointFlight.current)return;
      await store.removeRecoveryCopy(view.owner!.id,view.id,copyId,selected.checkpointSequence);
      if(!scopeCurrent(view))return;
      // Do not disable or forget the writer until deletion is acknowledged.
      if(removingWriter&&checkpointWriter.current?.id===copyId){
        setAutoRecovery(false);checkpointEnabled.current=false;checkpointWriter.current=null;
        checkpointConflict.current=null;setCheckpointState('idle');
      }
      recoveryAttempt.current=null;setRecoveryComparison(null);
      if(importedRecoveryAttempt.current?.copyId===copyId)importedRecoveryAttempt.current=null;
      if(frozenCheckpoint.current?.id===copyId){frozenCheckpoint.current=null;setCheckpointRetry(n=>n+1);}
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
  // An author preview is still the private, verified editor. Never provide
  // this context to standalone/simulated visitor or unverified owner views.
  const canvasOwner=verifiedOwner&&allowed&&record?.id===id&&
    port.getOwnerSessionEpoch()===verifiedOwner.epoch?
    {port,ownerKey:JSON.stringify([verifiedOwner.id,verifiedOwner.epoch,id])}:undefined;
  const canvasMeasurement={onContentWidth:setMeasuredCanvasWidth,privateMedia:canvasOwner,
    dropTargets:canvasOwner&&!preview?{canDropComponent:canDropCanvasComponent,dropComponent:dropCanvasComponent,
      canDropSection:canDropCanvasSection,dropSection:dropCanvasSection}:undefined,
    onAddFirstSection:canvasOwner&&!preview&&!saving&&!recoveryBusy?()=>{
      const view=latestRecovery.current;
      if(!view||!draftCurrent(view)||view.preview)return;
      setTool('Content');setSectionPicker(true);
    }:undefined};
  const themeControls={contentWidth:measuredCanvasWidth,disabled:!allowed||!verifiedOwner||preview||saving||recoveryBusy||pendingFields||sourceDirty};
  const contentPreview = <PortfolioCanvas {...canvasMeasurement} snapshot={head?.snapshot} title={record?.title ?? 'Portfolio draft'}
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
      {!preview&&<>
        <button type="button" className="ws-secondary" disabled={!head.undo.length||saving||recoveryBusy||pendingFields||sourceDirty}
          onClick={()=>apply({kind:'UNDO'})}>Undo</button>
        <button type="button" className="ws-secondary" disabled={!head.redo.length||saving||recoveryBusy||pendingFields||sourceDirty}
          onClick={()=>apply({kind:'REDO'})}>Redo</button>
      </>}
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
    {error && <button type="button" className="ws-secondary" disabled={saving||recoveryBusy}
      onClick={()=>void reloadSavedDraft()}>{operation||pendingFields||sourceDirty?'Discard changes and load saved draft':'Reload saved draft'}</button>}
    {notice && <p role="status" className="ws-inline-alert">{notice}</p>}
    {linkNotice&&head&&<div className="ws-inline-alert">
      <p role="status">{linkNotice}</p>
      <button type="button" className="ws-secondary" onClick={()=>setLinkNotice('')}>Dismiss editor link notice</button>
    </div>}
    {verifiedOwner&&record&&head&&<details className="ws-editor-safety" open={recoveryExpanded}
      onToggle={event=>setRecoveryExpanded(event.currentTarget.open)}>
      <summary>Browser recovery &amp; Keep Both</summary>
      <p>Copies stay on this device, separate from the saved cloud draft. Browser storage can be cleared; export important work. Opening requires a verified owner and fresh cloud read.</p>
      <p>Confirmed cloud saves also keep a bounded Undo/Redo history on this browser. It is restored only when the exact saved cloud revision and snapshot match, and is not synced to other devices. Unsaved automatic checkpoints remain optional.</p>
      {savedHistoryNotice&&<p role="status">{savedHistoryNotice}</p>}
      <button type="button" className="ws-secondary" disabled={saving||recoveryBusy||!!operation||pendingFields||sourceDirty}
        onClick={()=>void reloadSavedDraft()}>Reload saved draft and history</button>
      <button type="button" className="ws-secondary" disabled={saving||recoveryBusy||!!operation||pendingFields||sourceDirty}
        onClick={()=>void forgetSavedHistory()}>Forget saved history on this browser</button>
      <label><input type="checkbox" checked={autoRecovery} onChange={event=>{
        checkpointEnabled.current=event.target.checked;setAutoRecovery(event.target.checked);
        if(!event.target.checked)setCheckpointState('idle');
      }}/> Automatically checkpoint unsaved edits on this browser during this editor session</label>
      {autoRecovery&&<p role="status">{!canPreserveWorking?'No unsaved edits. Existing browser copies are retained.':checkpointState==='pending'?'Browser checkpoint pending. Do not assume it has been saved.':
        checkpointState==='saved'?'Latest captured working edits acknowledged by browser storage only.':
        checkpointState==='failed'?'Browser checkpoint failed or storage is full; your current edits remain.':
        'Automatic browser checkpoints enabled; waiting for unsaved edits.'}
        {checkpointState==='failed'&&canPreserveWorking&&<button type="button" className="ws-secondary" disabled={saving||recoveryBusy} onClick={retryCheckpoint}>Retry checkpoint</button>}
      </p>}
      <p>When enabled, automatic checkpoints also preserve Undo/Redo history after a confirmed cloud Save. Each editor session uses a separate checkpoint ID. Checkpoints count toward the same eight-copy limit and 8 MiB per-copy bound, never prune another copy, and are retained until explicitly removed. Opening a same-base copy restores its acknowledged Undo/Redo history. Restoring an older copy creates one new undoable draft against the current cloud revision; the original history remains in that copy.</p>
      <div className="ws-actions">
        <button type="button" className="ws-secondary" disabled={saving||recoveryBusy||!canPreserveWorking}
          data-inspector-buffer-action="true" onMouseDown={event=>event.preventDefault()}
          onClick={()=>void preserveRecovery(false)}>Save browser recovery copy</button>
        <button type="button" className="ws-secondary" disabled={saving||recoveryBusy||!(operation||pendingFields||sourceDirty)}
          data-inspector-buffer-action="true" onMouseDown={event=>event.preventDefault()}
          onClick={()=>void preserveRecovery(true)}>Keep Both and load latest cloud draft</button>
        <button type="button" className="ws-secondary" disabled={saving||recoveryBusy||!canPreserveWorking}
          data-inspector-buffer-action="true" onMouseDown={event=>event.preventDefault()}
          onClick={()=>exportWorkingRecovery()}>Export current working recovery</button>
        {hasHistory&&<button type="button" className="ws-secondary" disabled={saving||recoveryBusy}
          data-inspector-buffer-action="true" onMouseDown={event=>event.preventDefault()}
          onClick={()=>exportWorkingRecovery(false)}>Export draft and buffers without history</button>}
        <label>Import working recovery JSON
          <input type="file" accept=".json,application/json" disabled={saving||recoveryBusy}
            onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void importWorkingRecovery(file);}}/>
        </label>
      </div>
      {recoveryBusy&&<p>Working with browser recovery storage…</p>}
      {recoveryNotice&&<p role="status">{recoveryNotice}</p>}
      {recoveryComparison&&<div aria-label="Recovery copy comparison">
        <p>Compared with saved cloud revision {recoveryComparison.cloudRevision}. This comparison is a point-in-time read, not a new save.</p>
        <p>{recoveryComparison.pendingCount} unapplied buffer entries in the recovery copy.</p>
        <details><summary>Different file paths ({recoveryComparison.changedFiles.length})</summary>
          <ul>{recoveryComparison.changedFiles.map(path=><li key={path}><code>{path}</code></li>)}</ul></details>
        <details><summary>Different slots or stash entries ({recoveryComparison.changedSlots.length})</summary>
          <ul>{recoveryComparison.changedSlots.map(key=><li key={key}>{key}</li>)}</ul></details>
      </div>}
      {recoveryCopies===null?<p>Local recovery catalogue not confirmed.</p>:recoveryCopies.length===0?
        <p>No browser recovery copies.</p>:<ul className="ws-editor-slots">{recoveryCopies.map(copy=>
          <li key={copy.copyId}><strong>{copy.checkpointSequence===undefined?'Recovery copy':'Working checkpoint'} · {new Date(copy.savedAt).toLocaleString()} · base revision {copy.cloudBaseRevision}</strong>
            <div className="ws-actions">
              <button type="button" className="ws-secondary" disabled={saving||recoveryBusy}
                onClick={()=>void inspectRecovery(copy.copyId,'compare')}>Compare copy</button>
              <button type="button" className="ws-secondary" disabled={saving||recoveryBusy||!!operation||pendingFields||sourceDirty||copy.cloudBaseRevision!==record.revision}
                onClick={()=>void inspectRecovery(copy.copyId,'open')}>Open recovery copy</button>
              {recoveryComparison?.copyId===copy.copyId&&copy.cloudBaseRevision!==recoveryComparison.cloudRevision&&
                <button type="button" className="ws-secondary" disabled={saving||recoveryBusy||!!operation||pendingFields||sourceDirty}
                  onClick={()=>void inspectRecovery(copy.copyId,'restore')}>Restore older copy as unsaved draft</button>}
              <button type="button" className="ws-secondary" disabled={saving||recoveryBusy}
                onClick={()=>void inspectRecovery(copy.copyId,'export')}>Export recovery copy</button>
              <button type="button" className="ws-secondary" disabled={saving||recoveryBusy||(checkpointWriter.current?.id===copy.copyId&&checkpointFlight.current)}
                onClick={()=>void removeRecovery(copy.copyId)}>Remove recovery copy</button>
            </div>
          </li>)}</ul>}
    </details>}
    {verifiedOwner&&record&&head&&<details className="ws-editor-safety">
      <summary>Private folder backup &amp; recovery</summary>
      <p>Folder backups contain the applied managed and owned source snapshot, slot data and stashes, not unapplied inspector buffers, media files, account-session data or cloud history. Authored code and text may themselves contain sensitive information; keep backups private. Folder writes use a recovery journal, not filesystem-wide atomicity.</p>
      {!folderSupported?<p role="status">Folder access requires a supported secure desktop browser and Web Locks. Use browser recovery and the private working recovery export instead.</p>:<>
        <p>Choose a new dedicated folder for each backup. An existing backup is never silently overwritten. To restore, compare it against the currently verified cloud draft first.</p>
        <div className="ws-actions">
          <button type="button" className="ws-secondary" disabled={saving||recoveryBusy||pendingFields||sourceDirty}
            data-inspector-buffer-action="true" onMouseDown={event=>event.preventDefault()}
            onClick={()=>void folderOperation('backup')}>Create private folder backup</button>
          <button type="button" className="ws-secondary" disabled={saving||recoveryBusy||!!operation||pendingFields||sourceDirty}
            data-inspector-buffer-action="true" onMouseDown={event=>event.preventDefault()}
            onClick={()=>void folderOperation('compare')}>Compare private folder backup</button>
        </div>
        {(pendingFields||sourceDirty)&&<p>Apply or preserve unfinished buffers using browser recovery before folder operations.</p>}
      </>}
      {folderNotice&&<p role="status">{folderNotice}</p>}
      {folderComparison&&<div aria-label="Folder backup comparison">
        <p>Folder snapshot versus saved cloud revision {folderComparison.cloudRevision}: {folderComparison.changedFiles.length} different files, {folderComparison.changedSlots.length} different slot/stash keys.</p>
        <details><summary>Different file paths</summary><ul>{folderComparison.changedFiles.map(path=><li key={path}><code>{path}</code></li>)}</ul></details>
        <details><summary>Different slots or stashes</summary><ul>{folderComparison.changedSlots.map(key=><li key={key}>{key}</li>)}</ul></details>
        <div className="ws-actions">
          <button type="button" className="ws-secondary" disabled={saving||recoveryBusy||!!operation||pendingFields||sourceDirty||!folderSupported}
            onClick={()=>void folderOperation('restore')}>Restore compared folder as unsaved draft</button>
          <button type="button" className="ws-secondary" disabled={recoveryBusy} onClick={()=>setFolderComparison(null)}>Close folder comparison</button>
        </div>
      </div>}
    </details>}
    {verifiedOwner&&record&&head&&<details className="ws-editor-safety">
      <summary>Private project JSON import &amp; export</summary>
      <p>Portable applied snapshots: private JSON up to 1 MiB or editable Kadmeion source ZIP up to 2 MiB. Neither includes media bytes, public pages, cloud history or unapplied buffers. Authored source and text may contain sensitive information.</p>
      <div className="ws-actions">
        <button type="button" className="ws-secondary" disabled={saving||recoveryBusy||pendingFields||sourceDirty}
          data-inspector-buffer-action="true" onMouseDown={event=>event.preventDefault()}
          onClick={()=>void portableOperation('export')}>Export private project JSON</button>
        <label>Compare private project JSON
          <input type="file" accept=".json,application/json" disabled={saving||recoveryBusy||!!operation||pendingFields||sourceDirty}
            onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';
              if(file)void portableOperation('compare',file);}}/>
        </label>
        <button type="button" className="ws-secondary" disabled={saving||recoveryBusy||pendingFields||sourceDirty}
          data-inspector-buffer-action="true" onMouseDown={event=>event.preventDefault()}
          onClick={()=>void portableOperation('export',undefined,'zip')}>Export editable source ZIP</button>
        <label>Compare editable source ZIP
          <input type="file" accept=".zip,application/zip" disabled={saving||recoveryBusy||!!operation||pendingFields||sourceDirty}
            onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';
              if(file)void portableOperation('compare',file,'zip');}}/>
        </label>
      </div>
      {portableNotice&&<p role="status">{portableNotice}</p>}
      {portableComparison&&<div aria-label="Portable snapshot comparison">
        <p>Compared to saved cloud revision {portableComparison.cloudRevision}: {portableComparison.changedFiles.length} different files and {portableComparison.changedSlots.length} different slot/stash keys.</p>
        <p>Input file SHA-256: <code style={{overflowWrap:'anywhere'}}>{portableComparison.archiveSha256}</code>. This fingerprint identifies the compared bytes; it is not a signature or publication approval.</p>
        {portableComparison.changedFiles.length>0&&<section aria-label="Exact source comparison">
          <label>Changed source file<select value={portableFile} onChange={event=>setPortableFile(event.currentTarget.value)}>
            <option value="">Select a changed file</option>{portableComparison.changedFiles.map(path=><option key={path} value={path}>{path}</option>)}
          </select></label>
          {portableComparison.changedFiles.includes(portableFile)&&<div aria-label="Reviewed file contents">
            {([{label:'Saved source',files:portableComparison.baseSnapshot.files},{label:'Imported source',files:portableComparison.snapshot.files}]).map(({label,files})=>{
              const present=Object.hasOwn(files,portableFile),source=present?files[portableFile]!:undefined;
              return <div key={label}>
                <h4>{label}</h4>
                {source===undefined?<p>File absent.</p>:<>
                  <p>{new TextEncoder().encode(source).byteLength} UTF-8 bytes · {source.startsWith('\uFEFF')?'BOM present':'No BOM'} · {(source.match(/\r\n/g)??[]).length} CRLF line endings</p>
                  <pre tabIndex={0} aria-label={label+' text'} style={{maxHeight:240,overflow:'auto',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{source}</pre>
                </>}
              </div>;
            })}
            <p>Read-only text comparison. No source execution or rewriting; whitespace and line endings remain in the restored snapshot.</p>
          </div>}
        </section>}
        <details><summary>Different file paths</summary><ul>{portableComparison.changedFiles.map(path=><li key={path}><code>{path}</code></li>)}</ul></details>
        <details><summary>Different slots or stashes</summary><ul>{portableComparison.changedSlots.map(key=><li key={key}>{key}</li>)}</ul></details>
        <div className="ws-actions">
          <button type="button" className="ws-secondary" disabled={saving||recoveryBusy||!!operation||pendingFields||sourceDirty}
            onClick={()=>void portableOperation('restore')}>{portableComparison.format==='zip'?'Restore compared ZIP as unsaved draft':'Restore compared JSON as unsaved draft'}</button>
          <button type="button" className="ws-secondary" disabled={recoveryBusy} onClick={()=>setPortableComparison(null)}>{portableComparison.format==='zip'?'Close ZIP comparison':'Close JSON comparison'}</button>
        </div>
      </div>}
    </details>}
    {pendingFields&&<div className="ws-editor-safety">
      <span>Unapplied inspector edits are held in this editor.</span>
      <button type="button" className="ws-secondary" data-inspector-buffer-action="true"
        disabled={saving} onMouseDown={event=>event.preventDefault()}
        onClick={()=>{setFieldDrafts({});setFieldIssues({});setSeoDraft(null);}}>
        Discard all unapplied inspector edits</button>
    </div>}
    {sourceDirty&&<div role="status" className="ws-editor-safety"><span>STALE preview: unapplied owned-source text is not reflected in the last applied draft. Apply, preserve or discard the buffer before leaving or saving. Arbitrary source is not executed in this preview.</span>
      <button type="button" className="ws-secondary" onClick={()=>{setTool('Source');setPreview(false);}}>Review source edits</button></div>}
    {!record && !error && <><p role="status">Loading portfolio…</p><div className="glyph-skeleton" aria-hidden="true"><span className="glyph-skeleton-line is-title"/><span className="glyph-skeleton-line is-medium"/><span className="glyph-skeleton-line is-short"/></div></>}
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
        <label><input type="checkbox" checked={favoriteComponentsOnly}
          onChange={event=>setFavoriteComponentsOnly(event.target.checked)}/> Show only favorite components</label>
        <p className="ws-footnote">Device favorites are not account-synced.{storageAvailable===false?' Storage is unavailable; changes may last only for this visit.':''}</p>
        <ul className="ws-editor-component-list">{insertableComponentPins.filter(item=>
          (!favoriteComponentsOnly||favorites.includes(item.id))&&
          (componentCategory==='All'||categoryFor(item.id)===componentCategory)&&
          (item.label.toLowerCase().includes(componentSearch.trim().toLowerCase())||
           item.id.toLowerCase().includes(componentSearch.trim().toLowerCase()))
        ).map(item=>{
          const fit=compatible.some(candidate=>candidate.id===item.id);
          const hasTarget=emptyComponentTargets.some(target=>canPlaceComponent(item.id,target.key));
          return <li key={item.id}><button type="button" aria-pressed={targetPin?.id===item.id}
            disabled={(!fit&&!hasTarget)||saving||recoveryBusy}
            draggable={hasTarget}
            onDragStart={event=>{
              const view=latestRecovery.current;
              if(!hasTarget||!head||!view||!draftCurrent(view)){event.preventDefault();return;}
              // Keep layout stable during native drag. Selection/target lists
              // must not reflow under the pointer before the actual drop.
              componentDrag.current={head,pin:item.id};
              event.dataTransfer.effectAllowed='copy';
              event.dataTransfer.setData('application/x-kadmeion-component','pinned');
            }}
            onDragEnd={()=>{componentDrag.current=null;}}
            onClick={()=>setPickedComponent(item.id)}>
            <strong>{item.label}</strong>
            <small>{item.id}</small>
            <span>{fit?'Compatible with selected slot':hasTarget?'Compatible empty targets available':'Choose another slot'}</span>
          </button><button type="button" className="ws-secondary" aria-pressed={favorites.includes(item.id)}
            aria-label={(favorites.includes(item.id)?'Remove favorite: ':'Add favorite: ')+item.label}
            onClick={()=>toggleFavorite(item.id)}>{favorites.includes(item.id)?'Remove favorite':'Favorite'}</button></li>;
        })}</ul>
        {favoriteComponentsOnly&&!insertableComponentPins.some(item=>favorites.includes(item.id)&&
          (componentCategory==='All'||categoryFor(item.id)===componentCategory)&&
          (item.label.toLowerCase().includes(componentSearch.trim().toLowerCase())||item.id.toLowerCase().includes(componentSearch.trim().toLowerCase())))&&
          <p role="status">No favorites match these filters. <button type="button" className="ws-secondary" onClick={()=>{setFavoriteComponentsOnly(false);setComponentSearch('');setComponentCategory('All');}}>Clear filters</button></p>}
        {!active&&<p className="ws-footnote">Select a target in Structure &amp; layers before replacing components.</p>}
        {targetPin&&<section aria-label="Compatible empty component targets">
          <h3>Place {targetPin.label}</h3>
          <p>Drag the selected component to a compatible empty target below, or use its Add button. Existing assignments are never replaced by dropping.</p>
          {emptyComponentTargets.filter(target=>compatibleComponentsForSlot(target.key).some(item=>item.id===targetPin.id)).length===0?
            <p>No compatible empty slots. Add a section or clear an assignment deliberately.</p>:
            <ul className="ws-editor-slots">{emptyComponentTargets.filter(target=>
              compatibleComponentsForSlot(target.key).some(item=>item.id===targetPin.id)).map(target=><li key={target.key}
                onDragOver={event=>{
                  if(canDropCanvasComponent(target.key)){
                    event.preventDefault();event.dataTransfer.dropEffect='copy';
                  }
                }}
                onDrop={event=>{
                  if(!canDropCanvasComponent(target.key))return;
                  event.preventDefault();dropCanvasComponent(target.key);
                }}>
                <button type="button" disabled={!canPlaceComponent(targetPin.id,target.key)}
                  onClick={()=>placeComponent(targetPin.id,target.key)}>Add {targetPin.label} to {target.label}</button>
              </li>)}</ul>}
        </section>}
        <button type="button" className="ws-secondary" onClick={()=>setTool('Content')}>Return to layers</button>
        <LayoutTools head={head} sectionId={selectedLayoutSectionId}
          blocked={!verifiedOwner||!allowed||saving||recoveryBusy||pendingFields||sourceDirty}
          planLayout={planSectionLayoutChange} applyLayout={apply}/>
      </div>:<><h2>Structure &amp; layers</h2>
        {!assigned.length && <p>This blank draft has no slots.</p>}
        <button type="button" className="ws-secondary" aria-expanded={sectionPicker}
          onClick={() => setSectionPicker(current => !current)}>Sections</button>
        {sectionPicker && <div className="ws-editor-section-picker">
          <label>Section layout<select value={sectionLayout} onChange={event => setSectionLayout(event.target.value)}>
            {sectionLayouts.map(([pin, label]) => <option key={pin} value={pin}>{label}</option>)}
          </select></label>
          <button type="button" className="ws-secondary" disabled={!verifiedOwner||saving||recoveryBusy||pendingFields||sourceDirty}
            onClick={() => apply({kind: 'ADD_SECTION', layout: sectionLayout})}>Add section</button>
        </div>}
        <ol className="ws-editor-layers">{layerGroups.map((group,index)=><li key={group.id}
          onDragOver={event=>{
            const drag=sectionDrag.current;
            if(drag&&drag.head===head&&sectionDropAllowed(drag.id,group.id)){
              event.preventDefault();event.dataTransfer.dropEffect='move';
            }
          }}
          onDrop={event=>{
            const drag=sectionDrag.current;
            if(!drag||drag.head!==head||!sectionDropAllowed(drag.id,group.id))return;
            event.preventDefault();moveSectionBefore(group.id);
          }}>
          <div className="ws-editor-layer-reorder">
            <span>Section {index+1} / {layerGroups.length}</span>
            <div role="group" aria-label={'Reorder '+group.title}>
              <button type="button" className="ws-editor-reorder-action" draggable={canReorderSection()}
                disabled={!canReorderSection()} aria-label={'Drag '+group.title+' to reorder; use Up and Down for keyboard'}
                onDragStart={event=>{
                  const view=latestRecovery.current;
                  if(!head||!view||!canReorderSection()||!draftCurrent(view)){event.preventDefault();return;}
                  sectionDrag.current={head,id:group.id};setDraggingSection(group.id);
                  event.dataTransfer.effectAllowed='move';
                  event.dataTransfer.setData('application/x-kadmeion-section','section');
                }}
                onDragEnd={()=>{sectionDrag.current=null;setDraggingSection(null);}}>Drag</button>
              <button type="button" className="ws-editor-reorder-action" aria-label={'Move '+group.title+' up'}
                disabled={index===0||!canReorderSection()} onClick={()=>apply({kind:'MOVE_SECTION',sectionId:group.id,direction:'up'})}>Up</button>
              <button type="button" className="ws-editor-reorder-action" aria-label={'Move '+group.title+' down'}
                disabled={index===layerGroups.length-1||!canReorderSection()}
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
        </li>)}{draggingSection&&sectionDropAllowed(draggingSection,null)&&<li
          onDragOver={event=>{if(sectionDrag.current?.head===head){event.preventDefault();event.dataTransfer.dropEffect='move';}}}
          onDrop={event=>{event.preventDefault();moveSectionBefore(null);}}>
          <span>Drop here to move the section to the end</span>
        </li>}</ol>
        </>}
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
            {chosenComponent&&active.state==='EMPTY'?<button type="button" className="ws-primary" disabled={saving||recoveryBusy}
                onClick={()=>{if(apply({kind:'ASSIGN_COMPONENT',slotKey:slot,componentId:chosenComponent.id}))setTool('Content');}}>
                Add to empty slot</button>:chosenComponent&&
                !(active.state==='S0'&&active.componentId===chosenComponent.id)?<>
                  <p>Replace and stash preserves the entire outgoing assignment, including unmatched fields and owned source.</p>
                  {active.sourcePath&&<p>Protected source: <code>{active.sourcePath}</code></p>}
                  <p>Matching declared fields retained: {Object.keys(matchingReplacementContent(active,chosenComponent.id)).join(', ')||'None'}.</p>
                  {(active.state==='S1'||active.state==='S2')&&<button type="button" className="ws-secondary"
                    onClick={()=>setTool('My Components')}>Keep as My Component</button>}
                  <button type="button" className="ws-primary" disabled={saving||recoveryBusy||sourceDirty||selectedSlotHasPendingDrafts}
                    onClick={()=>{
                      if(!window.confirm('Replace this component and stash all outgoing content'+(active.sourcePath?' and owned source '+active.sourcePath:'')+'? You can undo this transaction.'))return;
                      if(apply({kind:'ASSIGN_COMPONENT',slotKey:slot,componentId:chosenComponent.id,
                        confirmOwnedReplacement:active.state==='S1'||active.state==='S2',preserveMatchingContent:true}))setTool('Content');
                    }}>Replace and stash</button>
                  <button type="button" className="ws-secondary" onClick={()=>setTool('Content')}>Cancel replacement</button>
                </>:chosenComponent?<p>This pristine pinned component is already assigned.</p>:
                <p role="status">Use Assets for an owner-verified image placement; no generic media source is guessed.</p>}
          </>}
        </div>}
        {tool === 'Theme' && <ThemeInspector {...themeControls} head={head} apply={apply} width={canvasWidth} resize={setCanvasWidth}/>}
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
        {tool === 'My Components' && <ComponentLibrary port={port} head={head} committed={record?.snapshot ?? null}
          slot={slot} apply={apply} saveRetry={componentSaveRetry} blocked={!verifiedOwner||saving||recoveryBusy||sourceDirty||pendingFields}
          {...{onReuseTarget:(target:string)=>{
            if(layerGroups.flatMap(group=>group.slots).filter(item=>item.key===target).length===1)setSlot(target);
          }}}/>}

        {tool === 'Content' && <><h2>Content inspector</h2>
        {!active && <p>Select a slot to inspect it.</p>}
        {active && <><p>{active.componentId ?? 'Empty slot'}</p>
          {active.state!=='EMPTY'&&active.componentId!=='image@1'&&<button type="button" className="ws-secondary"
            disabled={saving||recoveryBusy} onClick={()=>setTool('Components')}>Review compatible replacements</button>}
          {canonicalSource&&<div className="ws-editor-tool">
            <h3>Customize source</h3>
            <p>Copy this pinned block's canonical React reference source into your private owned files. The library remains unchanged. The author canvas does not execute custom code.</p>
            <button type="button" className="ws-secondary" disabled={!verifiedOwner||saving||recoveryBusy||pendingFields||sourceDirty}
              onClick={()=>{
                if(!window.confirm('Create a private editable source copy of this pinned component? Its custom source will not execute or be publicly released. Undo is available.'))return;
                if(apply({kind:'CUSTOMIZE_COMPONENT',slotKey:slot,copiedSource:canonicalSource})){
                  setOpenedSource(true);setSourceReset(value=>value+1);setTool('Source');
                }
              }}>Create owned source copy</button>
          </div>}
          {(active.state==='S1'||active.state==='S2')&&<button type="button" className="ws-secondary"
            disabled={saving||recoveryBusy} onClick={()=>{setOpenedSource(true);setTool('Source');}}>Edit owned source</button>}
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
          {(head.snapshot.stashes[slot]?.length??0)>0&&<section aria-label="Unplaced assignments">
            <h3>Unplaced assignments</h3>
            <p>Archived content and source remain in this private draft. Restore requires an empty target.</p>
            {active.state==='EMPTY'&&<button type="button" className="ws-secondary" disabled={saving||recoveryBusy||sourceDirty||selectedSlotHasPendingDrafts}
              onClick={()=>apply({kind:'RESTORE_STASH',slotKey:slot})}>Restore last assignment</button>}
            <ul className="ws-editor-slots">{(head.snapshot.stashes[slot]??[]).map((entry,index)=><li key={index}>
              <strong>Archived assignment {index+1} · {entry.componentId??'Unknown'}</strong>
              <span>{entry.state} · {Object.keys(entry.content).length} content fields</span>
              {entry.sourcePath&&<code>{entry.sourcePath}</code>}
              {entry.componentId==='image@1'&&entry.content.alt_text&&<span>{entry.content.alt_text}</span>}
              {active.state==='EMPTY'&&index!==(head.snapshot.stashes[slot]?.length??0)-1&&
                <button type="button" className="ws-secondary" disabled={saving||recoveryBusy||sourceDirty||selectedSlotHasPendingDrafts}
                  onClick={()=>apply({kind:'RESTORE_STASH',slotKey:slot,stashIndex:index})}>Restore archived assignment {index+1}</button>}
            </li>)}</ul>
          </section>}
        </>}</>}
      </aside>
    </div>{openedHistory&&record&&<div hidden={tool!=='History'}>
      <RevisionWorkspace port={port} id={id} revision={record.revision}
        working={head.snapshot} title={record.title} dirty={!!operation||pendingFields||sourceDirty}
        active={tool==='History'&&!preview&&allowed&&!saving&&!recoveryBusy}
        buffered={pendingFields||sourceDirty} onRestore={restore} back={()=>setTool('Content')}/>
    </div>}
    {openedAssets&&<div hidden={tool!=='Assets'}>
      <AssetList port={port} back={()=>setTool('Content')} snapshot={head.snapshot}
        targets={verifiedOwner?layerGroups.flatMap(group=>group.slots.filter(item=>canPlacePrivateImage(head.snapshot,item.key))
          .map(item=>({key:item.key,label:group.title+' · '+item.name,state:item.state}))):[]}
        selectedSlot={slot} placementDisabled={saving||recoveryBusy||sourceDirty} onPlace={placeAsset}
        {...{active:!!verifiedOwner&&allowed&&!preview&&tool==='Assets'&&!saving&&!recoveryBusy}}/>
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
  const [loadedPreview,setLoadedPreview]=useState<{port:SupabaseBrowserAuthPort;id:string;record:PortfolioRecord}|null>(null);
  const record=loadedPreview?.port===port&&loadedPreview.id===id?loadedPreview.record:null;
  const [error,setError]=useState('');
  const [view,setView]=useState<'author'|'visitor'>('visitor');
  const [device,setDevice]=useState<0|390|768>(0);
  const [attempt,setAttempt]=useState(0);
  const [shareOpen,setShareOpen]=useState(false);
  useEffect(()=>{
    let active=true;
    setLoadedPreview(null);setError('');setShareOpen(false);
    const epoch=port.reconcileOwnerSessionEpoch();
    void port.readOwnerPortfolio(id).then(reply=>{
      if(!active)return;
      if(port.reconcileOwnerSessionEpoch()!==epoch){setError('The saved private revision could not be verified.');return;}
      if(reply.data?.snapshot&&reply.data.id===id){setLoadedPreview({port,id,record:reply.data});return;}
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
    {!record&&!error&&<><p role="status" className="ws-preview-loading">Loading your saved, owner-scoped preview…</p><div className="glyph-skeleton" aria-hidden="true"><span className="glyph-skeleton-line is-title"/><span className="glyph-skeleton-line is-medium"/><span className="glyph-skeleton-line is-short"/></div></>}
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
  const [loadedPreview,setLoadedPreview]=useState<{port:SupabaseBrowserAuthPort;id:string;record:PortfolioRecord}|null>(null);
  const record=loadedPreview?.port===port&&loadedPreview.id===id?loadedPreview.record:null;
  const [error,setError]=useState(false);
  const [attempt,setAttempt]=useState(0);

  useEffect(()=>{
    let active=true;
    setLoadedPreview(null);setError(false);
    const epoch=port.reconcileOwnerSessionEpoch();
    void port.readOwnerPortfolio(id).then(result=>{
      if(!active)return;
      if(port.reconcileOwnerSessionEpoch()!==epoch||!result.data?.snapshot||result.data.id!==id){
        setError(true);return;
      }
      setLoadedPreview({port,id,record:result.data});
    }).catch(()=>{if(active)setError(true);});
    return ()=>{active=false;};
  },[port,id,attempt]);

  if(error)return <main className="ws-gate"><h1>Portfolio unavailable.</h1><button type="button" className="ws-secondary" onClick={()=>setAttempt(v=>v+1)}>Retry private preview</button><a href={STUDIO}>Return to portfolio library</a></main>;
  if(!record)return <main className="ws-gate"><p role="status">Loading saved portfolio preview…</p><div className="glyph-skeleton" aria-hidden="true"><span className="glyph-skeleton-line is-title"/><span className="glyph-skeleton-line is-medium"/><span className="glyph-skeleton-line is-short"/></div></main>;
  return <PortfolioCanvas snapshot={record.snapshot} title={record.title} standalone/>;
}
