import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import {portfolioLayout} from '../../../packages/editor-core/src/managed-project-files.ts';
import type { SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
import type { MyComponentVersion } from '../../../packages/contracts/src/private-my-components-service.ts';
import { savedComponentInputFromOwnedSlot, type EditorHead, type EditorIntent, type PortfolioSnapshot } from
  '../../../packages/editor-core/src/portfolio-revision-transactions.ts';

type Apply = (intent: EditorIntent, versions?: Readonly<Record<string, MyComponentVersion>>) => boolean;
const THEME_PATH = 'theme/tokens.json';
const colors = ['surface', 'text', 'accent'] as const;
type PortfolioTheme = {mode: 'light' | 'dark'; surface: string; text: string; accent: string};
const defaultTheme: PortfolioTheme = {mode: 'light', surface: '#f9fafb', text: '#152738', accent: '#b9734d'};

function readTheme(snapshot: PortfolioSnapshot | null | undefined): PortfolioTheme {
  try {
    const source = snapshot?.files[THEME_PATH];
    if (!source) return defaultTheme;
    const value = JSON.parse(source) as Partial<PortfolioTheme>;
    return (value.mode === 'light' || value.mode === 'dark') && colors.every(key => /^#[0-9a-f]{6}$/i.test(value[key] ?? ''))
      ? value as PortfolioTheme : defaultTheme;
  } catch { return defaultTheme; }
}


type CanvasSection={id:string;layout:string;renderId:string;slots:string[]};
const TEXT_FIELDS=['title','text','label','description','value','items','note'] as const;
/** Layout illustration only, not a saved author value and never emitted by fullscreen
 * preview or any delivery adapter. Actual user content always takes precedence. */
function layoutExample(renderId:string,name:string):string|null {
  if(renderId==='L1'&&name==='title')return 'Build things that make a difference.';
  if(renderId==='L1'&&name==='text')return 'Selected work, practical skills and project stories.';
  if(renderId==='L1'&&name==='cta1')return 'Explore projects';
  if(renderId==='L3'&&name==='title')return 'Selected projects';
  return null;
}
const SLOT_TITLES:Readonly<Record<string,string>>={
  title:'headline',text:'introduction',cta:'call to action',cta1:'primary action',
  cta2:'secondary action',btn1:'primary action',btn2:'secondary action',
  image:'image',imagea:'image A',imageb:'image B',avatar:'portrait',
  media:'media',thumbs:'thumbnails',project:'project',card:'project',
  entries:'experience',items:'skills',links:'links',text1:'first paragraph',
  text2:'second paragraph',badge:'category',meta:'detail',note:'note'
};
function canvasSections(snapshot:PortfolioSnapshot|null|undefined):CanvasSection[] {
  const source=snapshot?.files['pages/home.page.json'];
  if(typeof source!=='string')return [];
  try {
    const page:unknown=JSON.parse(source);
    if(!page||typeof page!=='object'||Array.isArray(page)||
      !('sections' in page)||!Array.isArray(page.sections))return [];
    const sections:CanvasSection[]=[];
    for(const item of page.sections.slice(0,32)){
      if(!item||typeof item!=='object'||Array.isArray(item)||
        !('id' in item)||typeof item.id!=='string'||
        !('layout' in item)||typeof item.layout!=='string')continue;
      const layout=portfolioLayout(item.layout);
      if(!layout)continue;
      sections.push({id:item.id,layout:item.layout,renderId:layout.renderId,slots:layout.slots});
    }
    return sections;
  }catch{return [];}
}
/** Source bytes never execute in the app. This is only an escaped React text projection. */
function slotDisplay(slot:PortfolioSnapshot['slots'][string]|undefined):string {
  if(!slot||slot.state==='EMPTY')return '';
  for(const key of TEXT_FIELDS){
    const text=slot.content[key];
    if(typeof text==='string'&&text.trim())return text;
  }
  return '';
}

const PortfolioSlot=({section,name,kind='copy',snapshot,editing,selectedSlot,onSelectSlot,showMissing}:{
    section:CanvasSection;name:string;kind?:'title'|'copy'|'action'|'media'|'tag';snapshot:PortfolioSnapshot|null|undefined;editing:boolean;selectedSlot?:string;onSelectSlot?:(key:string)=>void;showMissing:boolean;
  })=>{
    const key=section.id+'-'+name.toLowerCase();
    const assignment=snapshot?.slots[key];
    const text=slotDisplay(assignment);
    const label=SLOT_TITLES[name.toLowerCase()]??name;
    const example=editing&&!text?layoutExample(section.renderId,name):null;
    const className='pv-slot pv-slot-'+kind+(text?' pv-filled':' pv-unfilled')+
      (selectedSlot===key?' pv-selected':'');
    if(editing)return <button className={className} type="button"
      aria-label={'Edit '+section.renderId+' '+name+' slot in preview'}
      aria-pressed={selectedSlot===key} onClick={()=>onSelectSlot?.(key)}>
      {text||(
        kind==='media'?<span className="pv-placeholder pv-media-blank" aria-hidden="true"/>:
        example?<span className="pv-placeholder pv-layout-example">{example}</span>:
        <span className="pv-placeholder">Add {label}</span>
      )}
    </button>;
    return text?<span className={className}>{text}</span>:
      !showMissing?null:<span className={className} aria-hidden="true">Not added: {label}</span>;
  };

export function PortfolioCanvas({snapshot, title, standalone, simulation, width, selectedSlot, onSelectSlot}: {
  snapshot: PortfolioSnapshot | null | undefined; title: string; standalone?: boolean;
  simulation?:boolean; width?: number;
  selectedSlot?:string; onSelectSlot?:(key:string)=>void;
}) {
  const theme=readTheme(snapshot);
  const style:CSSProperties={
    background:theme.surface,color:theme.text,colorScheme:theme.mode,
    borderTopColor:theme.accent,maxWidth:width
  };
  const sections=canvasSections(snapshot);
  const editing=typeof onSelectSlot==='function'&&!standalone&&!simulation;
  const slotProps={snapshot,editing,selectedSlot,onSelectSlot,showMissing:!standalone&&!simulation};
  const Tag=standalone?'main':'div';
  return <Tag className={standalone?'portfolio-only-preview pv-document':'ws-studio-canvas pv-document'}
    style={style} aria-label={standalone?'Saved private portfolio author preview':
      simulation?'Simulated visitor portfolio appearance':'Private authoring canvas'}>
    {!standalone&&<div className="pv-editor-caption">
      <span>AUTHOR CANVAS / {theme.mode.toUpperCase()}</span>
      <span>Illustrative empty-slot copy · Never saved or published</span>
    </div>}
    <div className="pv-site">
      <header className="pv-site-head"><strong>{title}</strong>
        <span>Owner-authored portfolio</span></header>
      {sections.length===0?<section className="pv-empty-page">
        <h2>No authored sections yet.</h2>
        <p>{standalone?'This saved portfolio has no authored sections.':'Add a section using Structure & layers to begin building your page.'}</p>
      </section>:sections.map((section,index)=>{
        const headline=section.slots.includes('title');
        const hero=['L1','L2','L5'].includes(section.renderId);
        const others=section.slots.filter(name=>name!=='title'&&!['text','cta1','cta2','btn1','btn2'].includes(name));
        const textSlot=section.slots.includes('text')?'text':
          section.slots.includes('text1')?'text1':undefined;
        const buttons=section.slots.filter(name=>['cta','cta1','cta2','btn1','btn2'].includes(name));
        return <section key={section.id} className={'pv-section pv-layout-'+section.renderId+(hero?' pv-hero':' pv-content-section')}
          aria-label={'Portfolio section '+(index+1)}>
          {hero?<div className="pv-hero-grid">
            <div className="pv-hero-copy">
              <span className="pv-eyebrow">{section.renderId==='L5'?'YOUR STORY':'PORTFOLIO / INTRODUCTION'}</span>
              {headline&&<h2><PortfolioSlot {...slotProps} section={section} name="title" kind="title"/></h2>}
              {textSlot&&<div className="pv-summary"><PortfolioSlot {...slotProps} section={section} name={textSlot}/></div>}
              <div className="pv-actions">{buttons.map(name=>
                <PortfolioSlot {...slotProps} section={section} key={name} name={name} kind="action"/>)}</div>
              {section.slots.includes('note')&&<div className="pv-hero-note"><PortfolioSlot {...slotProps} section={section} name="note" kind="tag"/></div>}
            </div>
            <div className="pv-hero-art" aria-hidden="true"><div className="pv-art-arc"/><div className="pv-art-fold"/></div>
          </div>:<>
            <div className="pv-section-heading">
              {headline&&<h2><PortfolioSlot {...slotProps} section={section} name="title" kind="title"/></h2>}
              <span className="pv-section-index">{String(index+1).padStart(2,'0')}</span>
            </div>
            {textSlot&&<div className="pv-summary"><PortfolioSlot {...slotProps} section={section} name={textSlot}/></div>}
            <div className={'pv-section-slots pv-section-slots-'+section.renderId}>
              {others.filter(name=>name!==textSlot).map(name=>{
                const media=/^(image|imageA|imageB|media|avatar|thumbs)$/i.test(name);
                return <div className={'pv-slot-cell'+(media?' pv-media-cell':'')} key={name}>
                  <PortfolioSlot {...slotProps} section={section} name={name} kind={media?'media':'copy'}/>
                </div>;
              })}
            </div>
            {buttons.length>0&&<div className="pv-actions pv-section-actions">{buttons.map(name=>
              <PortfolioSlot {...slotProps} section={section} key={name} name={name} kind="action"/>)}</div>}
          </>}
        </section>;
      })}
      <footer className="pv-site-footer"><span>{title}</span><span>Author preview · Saved content only</span></footer>
    </div>
  </Tag>;
}

export function ThemeInspector({head, apply, width, resize}: {
  head: EditorHead; apply: Apply; width: number; resize: (width: number) => void;
}) {
  const theme = readTheme(head.snapshot);
  function setTheme(next: PortfolioTheme) {
    const previous = head.snapshot.files[THEME_PATH];
    const tokens = previous ? JSON.parse(previous) as Record<string, unknown> : {};
    apply({kind: 'WRITE_MANAGED_FILE', path: THEME_PATH, source: JSON.stringify({...tokens, ...next}, null, 2)});
  }
  return <div className="ws-editor-tool">
    <h2>Theme &amp; responsive</h2>
    <label>Preview width<select value={width} onChange={event => resize(Number(event.target.value))}>
      <option value={0}>Fit canvas</option><option value={768}>Tablet · 768 px</option><option value={390}>Phone · 390 px</option>
    </select></label>
    <label>Portfolio theme<select value={theme.mode} onChange={event => {
      const mode = event.target.value;
      if (mode === 'dark') setTheme({mode, surface: '#162433', text: '#f7f5ef', accent: '#eab087'});
      else setTheme({...defaultTheme});
    }}><option value="light">Light</option><option value="dark">Dark</option></select></label>
    {colors.map(key => <label key={key}>{key}<input type="color" value={theme[key]} onChange={event =>
      setTheme({...theme, [key]: event.target.value})}/></label>)}
  </div>;
}

export function SourceInspector({head, slot, apply}: {head: EditorHead; slot: string; apply: Apply}) {
  const [selected, setSelected] = useState('');
  const [buffers, setBuffers] = useState<Record<string, string>>({});
  const active = head.snapshot.slots[slot];
  const files = Object.keys(head.snapshot.files).filter(path => path.endsWith('.json') || path === active?.sourcePath);
  const path = files.includes(selected) ? selected : files[0] ?? '';
  const original = head.snapshot.files[path] ?? '';
  const value = buffers[path] ?? original;

  function applyBuffer() {
    const intent: EditorIntent = path.endsWith('.json')
      ? {kind: 'WRITE_MANAGED_FILE', path, source: value}
      : {kind: 'EDIT_OWNED_SOURCE', slotKey: slot, source: value};
    if (apply(intent)) setBuffers(current => {
      const next = {...current}; delete next[path]; return next;
    });
  }

  return <div className="ws-editor-tool">
    <h2>Advanced source</h2>
    <p>Managed JSON and your owned code can be edited here. The author preview renders text without executing custom code.</p>
    <label>Source file<select value={path} onChange={event => setSelected(event.target.value)}>
      {files.map(file => <option key={file}>{file}</option>)}
    </select></label>
    <label>Source buffer<textarea spellCheck={false} rows={10} value={value} onChange={event => {
      const source = event.target.value;
      setBuffers(current => ({...current, [path]: source}));
    }}/></label>
    <button type="button" className="ws-secondary" disabled={!path || value === original} onClick={applyBuffer}>Apply source</button>
  </div>;
}

export function ComponentLibrary({port, head, committed, slot, apply}: {
  port: SupabaseBrowserAuthPort; head: EditorHead; committed: PortfolioSnapshot | null; slot: string; apply: Apply;
}) {
  const [versions, setVersions] = useState<MyComponentVersion[] | null>(null);
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const slotKind = slot.slice(slot.lastIndexOf('-') + 1);
  const state = head.snapshot.slots[slot]?.state;
  const canSave = !!committed && ['S1', 'S2'].includes(committed.slots[slot]?.state ?? '');

  useEffect(() => {
    let active = true;
    void port.listOwnerComponents().then(result => {
      if (!active) return;
      if (result.data) setVersions(result.data);
      else setMessage(result.error?.message ?? 'My Components could not be loaded.');
    });
    return () => {active = false;};
  }, [port]);

  async function save() {
    if (!committed || !name.trim() || busy) return;
    setBusy(true); setMessage('');
    try {
      const key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55);
      if (!/^[a-z][a-z0-9-]{2,63}$/.test(key)) {setMessage('Choose a component name with at least three letters or digits, beginning with a letter.'); return;}
      const input = savedComponentInputFromOwnedSlot(committed, slot, {
        operationId: crypto.randomUUID(), componentKey: key, displayName: name, compatibleSlotKinds: [slotKind]
      });
      const result = await port.saveOwnerComponent(input);
      if (!result.data) {setMessage(result.error?.message ?? 'Component save could not be confirmed.'); return;}
      const saved = result.data;
      setVersions(current => [saved, ...(current ?? []).filter(version => version.id !== saved.id)]);
      setName(''); setMessage('Private component version saved.');
    } catch (error) {setMessage(error instanceof Error ? error.message : 'Component save could not be confirmed.');}
    finally {setBusy(false);}
  }

  return <div className="ws-editor-tool"><h2>My Components</h2>
    {message && <p role="status">{message}</p>}
    {!versions && !message && <p role="status">Loading saved components…</p>}
    {versions?.length === 0 && <p>You haven’t saved any component versions.</p>}
    <ul className="ws-editor-slots">{versions?.map(version => <li key={version.id}>
      <strong>{version.display_name}</strong> <span>{version.compatible_slot_kinds.join(', ')}</span>
      <button type="button" disabled={!state || state === 'S1' || state === 'S2' || !version.compatible_slot_kinds.includes(slotKind)}
        onClick={() => apply({kind: 'REUSE_SAVED_COMPONENT', slotKey: slot, componentVersionId: version.id}, {[version.id]: version})}>
        Reuse in selected slot
      </button>
    </li>)}</ul>
    {canSave && <><label>Component name<input value={name} maxLength={80} onChange={event => setName(event.target.value)}/></label>
      <button type="button" className="ws-secondary" disabled={busy || !name.trim()} onClick={() => void save()}>Save committed component</button></>}
  </div>;
}

export function AssetList({port}: {port: SupabaseBrowserAuthPort}) {
  const [assets, setAssets] = useState<NonNullable<Awaited<ReturnType<SupabaseBrowserAuthPort['listOwnerAssets']>>['data']> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void port.listOwnerAssets().then(result => {
      if (!active) return;
      if (result.data) setAssets(result.data);
      else setError(result.error?.message ?? 'Private assets could not be loaded.');
    });
    return () => {active = false;};
  }, [port]);
  return <div className="ws-editor-tool"><h2>Assets</h2>
    {error && <p role="alert">{error}</p>}
    {!assets && !error && <p role="status">Loading private asset records…</p>}
    {assets?.length === 0 && <p>No private project assets are registered.</p>}
    {!!assets?.length && <ul className="ws-editor-slots">{assets.map(asset => <li key={asset.id}>
      <strong>{asset.altText || 'Image ' + asset.id.slice(0, 8)}</strong>
      <span>{asset.mime} · {Math.ceil(asset.size / 1024)} KB</span>
    </li>)}</ul>}
    <p>Asset registration and replacement controls are unavailable in this panel.</p>
  </div>;
}

export function RevisionHistory({port, id, revision, onRestore}: {
  port: SupabaseBrowserAuthPort; id: string; revision: number; onRestore: (snapshot: PortfolioSnapshot) => void;
}) {
  const [items, setItems] = useState<{revision: number; createdAt: string}[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void port.listOwnerRevisions(id).then(result => {
      if (!active) return;
      if (result.data) setItems(result.data);
      else setError(result.error?.message ?? 'Revision history could not be loaded.');
    });
    return () => {active = false;};
  }, [port, id, revision]);

  async function restore() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const result = await port.readOwnerRevision(id, selected);
      if (!result.data) {setError(result.error?.message ?? 'Could not open the revision.'); return;}
      onRestore(result.data); setSelected(null);
    } finally {setBusy(false);}
  }

  return <div className="ws-editor-tool"><h2>Revision history</h2>
    {error && <p role="alert">{error}</p>}
    {!items && !error && <p role="status">Loading saved revisions…</p>}
    <ul className="ws-editor-slots">{items?.map(item => <li key={item.revision}>
      <button type="button" disabled={busy} aria-pressed={item.revision === selected} onClick={() => setSelected(item.revision)}>
        Revision {item.revision}<span>{new Date(item.createdAt).toLocaleString()}</span>
      </button></li>)}</ul>
    {selected && <><p>Restore revision {selected} into the working draft. The current working copy can be recovered with Undo.</p>
      <button type="button" className="ws-secondary" disabled={busy} onClick={() => void restore()}>Restore to draft</button></>}
  </div>;
}
