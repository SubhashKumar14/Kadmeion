import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import {portfolioLayout, MAX_FILE_BYTES} from '../../../packages/editor-core/src/managed-project-files.ts';
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

export function SourceInspector({head,apply,back}:{
  head:EditorHead;slot:string;apply:Apply;back:()=>void;
}) {
  const [selected,setSelected]=useState('');
  const [buffers,setBuffers]=useState<Record<string,string>>({});
  const [notice,setNotice]=useState('');
  const files=Object.keys(head.snapshot.files).sort((left,right)=>{
    const a=left.startsWith('slots/'),b=right.startsWith('slots/');
    return a===b?left.localeCompare(right):a?-1:1;
  });
  const path=files.includes(selected)?selected:files[0]??'';
  const current=head.snapshot.files[path]??'';
  const buffer=buffers[path]??current;
  const ownerSource=Object.entries(head.snapshot.slots).find(([,entry])=>
    (entry.state==='S1'||entry.state==='S2')&&entry.sourcePath===path);
  const owned=!!ownerSource;
  const bytes=new TextEncoder().encode(buffer).byteLength;
  const changed=buffer!==current;
  const overLimit=bytes>MAX_FILE_BYTES;
  function applyBuffer(){
    if(!owned||!ownerSource||!path||!changed||overLimit)return;
    setNotice('');
    const ok=apply({kind:'EDIT_OWNED_SOURCE',slotKey:ownerSource[0],source:buffer});
    if(ok){
      setBuffers(values=>{const next={...values};delete next[path];return next;});
      setNotice('Owned source applied to the unsaved private editor revision. The preview does not execute this code.');
    } else setNotice('Source change was not applied. Your unsaved buffer remains in this editor.');
  }
  return <div className="ws-source-explorer" aria-label="Advanced source workspace">
    <aside className="ws-source-tree">
      <p className="ws-kicker">ADVANCED EDITOR</p>
      <h2>Source explorer</h2>
      <p>Generated composition files are read-only. Only personally owned source files can be edited after the trusted customization step.</p>
      <nav aria-label="Source files">
        <ul>{files.map(file=>{
          const owner=Object.values(head.snapshot.slots).some(entry=>
            (entry.state==='S1'||entry.state==='S2')&&entry.sourcePath===file);
          const managed=file.endsWith('.json');
          return <li key={file}><button type="button" aria-pressed={path===file} onClick={()=>{
            setSelected(file);setNotice('');
          }}>
            <span>{file.split('/').at(-1)}</span>
            <small>{owner?'Owned':managed?'Generated · protected':'Archived · protected'}</small>
          </button></li>;
        })}</ul>
      </nav>
      {files.length===0&&<p>No project source files in this private draft.</p>}
      <p className="ws-source-tree-note">Source files are real private snapshot records. No example source is generated or executed here.</p>
      <button type="button" className="ws-secondary" onClick={back}>Back to editor canvas</button>
    </aside>
    <section className="ws-source-editor" aria-label="Selected project source">
      <header className="ws-source-editor-header">
        <span>{path||'No source'} · {owned?'Owned editable text':'Protected generated composition'}</span>
        <span>{changed?'Unsaved source buffer':'Saved local snapshot'}</span>
      </header>
      {path?owned?<div className="ws-source-code-window">
        <label htmlFor="kd-source-editor">Owned source buffer</label>
        <textarea id="kd-source-editor" spellCheck={false} rows={22} value={buffer}
          onChange={event=>{const next=event.target.value;setBuffers(current=>({...current,[path]:next}));setNotice('');}}/>
      </div>:<div className="ws-source-code-window ws-source-preview" aria-label="Readonly generated file">
        <pre><code>{current}</code></pre>
      </div>:<p>No source file is available.</p>}
      <div className="ws-source-footer">
        <p>{owned?'Owned source can be changed in the private draft, but no code is executed in the author canvas.':
          'Generated JSON composition and library files are protected from direct editing. Use Content and Sections instead.'}</p>
        {owned&&<button type="button" className="ws-primary" disabled={!changed||overLimit}
          onClick={applyBuffer}>Apply owned source to draft</button>}
      </div>
      {notice&&<p role="status" className="ws-inline-alert">{notice}</p>}
    </section>
    <aside className="ws-source-diagnostics">
      <p className="ws-kicker">SOURCE DIAGNOSTICS</p>
      <h2>Editor rules</h2>
      <p>Only a verified editor transaction can modify owner source. Source text is never evaluated on the privileged workspace origin.</p>
      <dl>
        <div><dt>Source protection</dt><dd>{owned?'Owner-controlled version':'Read-only generated or archived file'}</dd></div>
        <div><dt>File size</dt><dd>{bytes.toLocaleString()} / {MAX_FILE_BYTES.toLocaleString()} bytes</dd></div>
        <div><dt>Draft buffer</dt><dd>{changed?'Unapplied changes':'Matches working revision'}</dd></div>
        <div><dt>Author preview</dt><dd>Code execution disabled</dd></div>
        <div><dt>Public custom JavaScript</dt><dd>Blocked pending proven isolation</dd></div>
      </dl>
      {overLimit&&<p role="alert">The owned source exceeds the {MAX_FILE_BYTES.toLocaleString()}-byte limit. Your buffer is preserved; it cannot be applied.</p>}
      <p className="ws-source-diagnostics-note">No compilation, static security analysis, or public preview validation has run on this source. A successful draft save is not a release approval.</p>
    </aside>
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

export function AssetList({port,back}:{port:SupabaseBrowserAuthPort;back:()=>void}) {
  const [assets,setAssets]=useState<NonNullable<Awaited<ReturnType<SupabaseBrowserAuthPort['listOwnerAssets']>>['data']>|null>(null);
  const [projects,setProjects]=useState<NonNullable<Awaited<ReturnType<SupabaseBrowserAuthPort['listOwnerProjects']>>['data']>|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [projectId,setProjectId]=useState('');
  const [collection,setCollection]=useState('');
  const [selectedAssetId,setSelectedAssetId]=useState('');
  const [uploadOpen,setUploadOpen]=useState(false);
  const [file,setFile]=useState<File|null>(null);
  const [alt,setAlt]=useState('');
  const [busy,setBusy]=useState(false);
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    let active=true;setError('');
    void Promise.all([port.listOwnerAssets(),port.listOwnerProjects()]).then(([assetReply,projectReply])=>{
      if(!active)return;
      if(!assetReply.data||!projectReply.data){
        setError(assetReply.error?.message??projectReply.error?.message??'Private asset records could not be verified.');
        setAssets(null);setProjects(null);return;
      }
      setAssets(assetReply.data);setProjects(projectReply.data);
    }).catch(()=>{if(active){setError('Private asset records could not be loaded.');setAssets(null);setProjects(null);}});
    return ()=>{active=false;};
  },[port,refresh]);
  const visible=assets?.filter(item=>!collection||item.projectId===collection)??[];
  const selected=assets?.find(item=>item.id===selectedAssetId);
  async function upload(event:import('react').FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(busy||!file||!projectId||!alt.trim())return;
    setBusy(true);setError('');setNotice('');
    try{
      const receipt=await port.uploadOwnerProjectImage(projectId,file,alt.trim());
      if(!receipt.data||receipt.data.publicDeliveryAllowed!==false||
        receipt.data.verifiedMetadata!==true)
        throw new Error(receipt.error?.message??'The private registration receipt was not verified.');
      setNotice('Image uploaded and privately registered. Public delivery remains blocked; a trusted byte attestation is still required.');
      setSelectedAssetId(receipt.data.id);setCollection('');
      setAlt('');setFile(null);setUploadOpen(false);setRefresh(n=>n+1);
      const input=document.getElementById('kd-private-image-file');
      if(input instanceof HTMLInputElement)input.value='';
    }catch(cause){setError(cause instanceof Error?cause.message:'Image registration was not confirmed.');}
    finally{setBusy(false);}
  }
  return <div className="ws-asset-library ws-asset-manager" aria-label="Private asset manager">
    <aside className="ws-asset-collections">
      <p className="ws-kicker">ASSET LIBRARY</p>
      <h2>Collections</h2>
      <p>Owner-private project media. Collections are grouped by real source projects, not invented media tags.</p>
      <nav aria-label="Asset collections">
        <button type="button" aria-pressed={!collection} onClick={()=>setCollection('')}>
          <span>All assets</span><small>{assets?.length??0}</small>
        </button>
        {projects?.map(project=><button key={project.id} type="button"
          aria-pressed={collection===project.id} onClick={()=>setCollection(project.id)}>
          <span>{project.title}</span><small>{assets?.filter(asset=>asset.projectId===project.id).length??0}</small>
        </button>)}
      </nav>
      <p className="ws-asset-protection">Private uploads require an owner project, server-verified metadata and a unique write-once Storage object path.</p>
      <a className="ws-secondary" href="/app/projects">Manage private projects</a>
      <button type="button" className="ws-secondary" onClick={back}>Back to editor canvas</button>
    </aside>
    <section className="ws-asset-center" aria-label="Owner-private media records">
      <div className="ws-asset-toolbar">
        <span>PRIVATE ASSET CANVAS · {collection?'PROJECT COLLECTION':'ALL PROJECTS'}</span>
        <span>{visible.length} shown · Not public</span>
      </div>
      {error&&<div role="alert" className="ws-inline-alert">{error}
        <button className="ws-secondary" type="button" onClick={()=>setRefresh(n=>n+1)}>Retry private records</button></div>}
      {notice&&<p role="status" className="ws-inline-alert">{notice}</p>}
      {assets===null&&!error&&<p role="status">Checking private assets and projects…</p>}
      {assets?.length===0&&<div className="ws-asset-empty">
        <div className="ws-asset-empty-glyph" aria-hidden="true"><span/></div>
        <h2>Your asset library is empty.</h2>
        <p>Upload an owner-private image with descriptive alt text. It stays unpublishable until trusted media validation and host gates pass.</p>
        <button type="button" className="ws-primary" onClick={()=>setUploadOpen(true)}>Open private uploader</button>
      </div>}
      {assets!==null&&assets.length>0&&visible.length===0&&<div className="ws-asset-empty">
        <h2>No images in this project.</h2><p>Choose a different owner collection or add a private image.</p>
        <button type="button" className="ws-secondary" onClick={()=>setUploadOpen(true)}>Open private uploader</button>
      </div>}
      {visible.length>0&&<ul className="ws-asset-gallery">{visible.map(asset=><li key={asset.id}>
        <button type="button" aria-pressed={selectedAssetId===asset.id}
          onClick={()=>{setSelectedAssetId(asset.id);setUploadOpen(false);}}>
          <span className="ws-asset-gallery-icon" aria-hidden="true">▧</span>
          <strong>{asset.altText}</strong><small>{asset.mime} · {Math.ceil(asset.size/1024)} KB</small>
          <small>Private metadata · No public image URL</small>
        </button></li>)}</ul>}
      {assets?.length===100&&<p className="ws-asset-limits">At most 100 recent private records returned; older records may exist.</p>}
      {assets?.length!==0&&<div className="ws-asset-add">
        <button type="button" className="ws-secondary" onClick={()=>setUploadOpen(true)}>Open private uploader</button>
      </div>}
      <footer className="ws-asset-center-foot">Actual private records only · No public asset serving or verified media bytes</footer>
    </section>
    <aside className="ws-asset-details">
      <p className="ws-kicker">ASSET DETAILS</p>
      {uploadOpen?<><h2>Private upload</h2>
        <p>This is an irreversible write-once private Storage upload. No owner-side delete or public publish follows.</p>
        {projects?.length===0?<p>First <a href="/app/projects">create a private project</a>.</p>:
          <form className="ws-asset-upload" onSubmit={event=>void upload(event)}>
            <label>Owner project<select required value={projectId} onChange={event=>setProjectId(event.target.value)}>
              <option value="">Select a private project</option>
              {projects?.map(project=><option key={project.id} value={project.id}>{project.title}</option>)}
            </select></label>
            <label htmlFor="kd-private-image-file">Private image file</label>
            <input id="kd-private-image-file" type="file" required
              accept="image/png,image/jpeg,image/webp"
              onChange={event=>setFile(event.currentTarget.files?.[0]??null)}/>
            <label>Image alt text<textarea rows={3} required maxLength={500} value={alt}
              onChange={event=>setAlt(event.target.value)}
              placeholder="Describe the image for assistive technology"/></label>
            <p className="ws-asset-limits">PNG, JPEG or WebP · 5 MB max. Your filename is never used as a public path.
              Failed registration may leave private bytes needing administrator cleanup.
              A registered asset is not SHA-attested or publishable.</p>
            <button className="ws-primary" type="submit"
              disabled={busy||!projects||!file||!projectId||!alt.trim()}>
              {busy?'Registering private image…':'Upload private image'}</button>
            <button type="button" className="ws-secondary" disabled={busy}
              onClick={()=>setUploadOpen(false)}>Cancel uploader</button>
          </form>}
      </>:selected?<><h2>Selected image</h2>
        <p>Registered private metadata. Thumbnail bytes are not fetched or exposed without a verified owner-only media projection.</p>
        <dl className="ws-asset-metadata">
          <div><dt>Alt text</dt><dd>{selected.altText}</dd></div>
          <div><dt>Project</dt><dd>{projects?.find(item=>item.id===selected.projectId)?.title??selected.projectId}</dd></div>
          <div><dt>MIME type</dt><dd>{selected.mime}</dd></div>
          <div><dt>Size</dt><dd>{Math.ceil(selected.size/1024)} KB</dd></div>
          <div><dt>Usage references</dt><dd>Not independently verified</dd></div>
          <div><dt>Focal point</dt><dd>Not stored</dd></div>
        </dl>
        <p className="ws-asset-protection">Replacement must use a new immutable object and a separately authorized references workflow.</p>
        <button type="button" className="ws-secondary" onClick={()=>setUploadOpen(true)}>Register another image</button>
      </>:<><h2>No asset selected.</h2>
        <p>Select a private image to inspect its verified metadata, or use the uploader.</p>
        <div className="ws-asset-detail-placeholder" aria-hidden="true"><span>▧</span></div>
        <dl className="ws-asset-metadata">
          {['Alt text','File name','Usage references','Focal point'].map(name=>
            <div key={name}><dt>{name}</dt><dd>Not available without a selected image</dd></div>)}
        </dl>
        <p className="ws-asset-protection">Replacing an image requires a new private object and a review of affected uses.</p>
      </>}
    </aside>
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
