import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  applyEditorTransaction, createEditorHead, type EditorHead, type EditorIntent, type PortfolioPresetId
} from '../../../packages/editor-core/src/index.ts';
import type { OwnerPortfolio, SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
import { Icon } from './landing.tsx';
import { TemplateGraphic } from './templates.tsx';

const presets = [
  {id: 'arc', title: 'Arc', tone: 'curved', detail: 'Curved hero and a project showcase.'},
  {id: 'collage', title: 'Collage', tone: 'interlocking', detail: 'Interlocking images and featured projects.'},
  {id: 'editorial', title: 'Editorial', tone: 'editorial', detail: 'Modular typography and a layout built around content.'},
  {id: 'stairs', title: 'Stairs', tone: 'stepped', detail: 'A stepped composition with a restrained opening.'},
  {id: 'studio', title: 'Studio', tone: 'modular', detail: 'A project-led layout with room for experience and skills.'},
  {id: 'blank', title: 'Blank', tone: 'blank', detail: 'A private starting point with no preset sections.'}
] as const satisfies readonly {id: PortfolioPresetId; title: string; tone: string; detail: string}[];

const STUDIO = '/app/portfolios';
const editorPath = (id: string) => STUDIO + '/' + id + '/edit';
const authoringQuery = '(min-width: 900px)';
type PortfolioRecord = NonNullable<Awaited<ReturnType<SupabaseBrowserAuthPort['readOwnerPortfolio']>>['data']>;

export function portfolioIdFromRoute(path: string): string | undefined {
  return /^\/app\/portfolios\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/edit$/i.exec(path)?.[1]?.toLowerCase();
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
          <div className="ws-area-icon"><Icon name="layers" size={25}/></div>
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

  useEffect(() => {
    const key = id + ':' + attempt;
    if (!allowed || loaded.current === key) return;
    let active = true;
    void port.readOwnerPortfolio(id).then(result => {
      if (!active) return;
      if (!result.data) {setError(result.error?.message ?? 'Portfolio unavailable.'); return;}
      loaded.current = key;
      setRecord(result.data);
      setHead(result.data.snapshot ? createEditorHead(result.data.snapshot) : null);
      setSlot('');
      setOperation('');
      setError('');
    });
    return () => {active = false;};
  }, [port, id, attempt, allowed]);

  function apply(intent: EditorIntent) {
    if (!allowed || !head || saving) return;
    try {
      const next = applyEditorTransaction(head, {intent, operationId: crypto.randomUUID(), baseRevision: head.revision});
      setHead(next);
      setValue(next.snapshot.slots[slot]?.content.text ?? '');
      setOperation(crypto.randomUUID()); setError(''); setNotice('Unsaved changes');
    } catch (failure) {setError(failure instanceof Error ? failure.message : 'The editor could not apply the change.');}
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
  const assigned = Object.entries(head?.snapshot.slots ?? {});
  const contentPreview = <div className="ws-studio-canvas">
    <h2>{record?.title}</h2>
    {assigned.filter(([, entry]) => entry.content.text).map(([key, entry]) => <p key={key}>{entry.content.text}</p>)}
    {!assigned.some(([, entry]) => entry.content.text) && <p>This draft has no authored text yet.</p>}
  </div>;
  if (!allowed) return <DeviceLimit/>;
  return <section aria-labelledby="edit-title" className="ws-studio-editor">
    <div className="ws-project-head"><div className="ws-heading">
      <a href={STUDIO}>Back to portfolios</a><p className="ws-kicker">PORTFOLIO BUILDER</p>
      <h1 id="edit-title">{record?.title ?? 'Portfolio editor'}</h1>
      <p>{record ? 'Private draft · revision ' + record.revision : 'Open a private portfolio draft.'}</p>
    </div>{head && <div className="ws-actions">
      <button type="button" className="ws-secondary" onClick={() => setPreview(current => !current)}>{preview ? 'Back to editor' : 'Preview text'}</button>
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
    {head && (preview ? contentPreview : <div className="ws-editor-grid">
      <aside className="ws-project-aside"><h2>Structure &amp; layers</h2>
        {!assigned.length && <p>This blank draft has no slots.</p>}
        <ul className="ws-editor-slots">{assigned.map(([key, item]) => <li key={key}>
          <button type="button" aria-pressed={slot === key} onClick={() => {
            setSlot(key); setValue(item.content.text ?? '');
          }}>{key.replaceAll('-', ' ')} <span>{item.state}</span></button>
        </li>)}</ul>
        <div className="ws-actions">
          <button type="button" className="ws-secondary" disabled={!head.undo.length || saving}
            onClick={() => apply({kind: 'UNDO'})}>Undo</button>
          <button type="button" className="ws-secondary" disabled={!head.redo.length || saving}
            onClick={() => apply({kind: 'REDO'})}>Redo</button>
        </div>
      </aside>
      {contentPreview}
      <aside className="ws-project-fields"><h2>Content inspector</h2>
        {!active && <p>Select a slot to inspect it.</p>}
        {active && <><p>{active.componentId ?? 'Empty slot'}</p>
          {active.state === 'EMPTY'
            ? <button type="button" className="ws-secondary" disabled={saving}
                onClick={() => apply({kind: 'ASSIGN_COMPONENT', slotKey: slot, componentId: 'body-copy@1'})}>Assign text component</button>
            : <><label>Text content<textarea rows={5} maxLength={12000} value={value} onChange={event => setValue(event.target.value)}/></label>
              <button type="button" className="ws-secondary" disabled={saving || value === (active.content.text ?? '')}
                onClick={() => apply({kind: 'UPDATE_CONTENT', slotKey: slot, content: {text: value}})}>Apply text</button></>}
        </>}
      </aside>
    </div>)}
  </section>;
}
