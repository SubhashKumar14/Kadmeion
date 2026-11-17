import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, Dispatch, SetStateAction } from 'react';
import {unappliedSourceBufferCount} from './behavior.ts';
import {portfolioLayout, MAX_FILE_BYTES} from '../../../packages/editor-core/src/managed-project-files.ts';
import type { SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
import type { MyComponentVersion } from '../../../packages/contracts/src/private-my-components-service.ts';
import { matchingReplacementContent, savedComponentInputFromOwnedSlot, type EditorHead, type EditorIntent, type PortfolioSnapshot } from
  '../../../packages/editor-core/src/portfolio-revision-transactions.ts';

type Apply = (intent: EditorIntent, versions?: Readonly<Record<string, MyComponentVersion>>) => boolean;
const THEME_PATH = 'theme/tokens.json';
const colors = ['surface', 'text', 'accent'] as const;
type PortfolioTheme = {mode: 'light' | 'dark'; surface: string; text: string; accent: string};
type ThemePalette=Pick<PortfolioTheme,typeof colors[number]>;
function paletteOf(theme:PortfolioTheme):ThemePalette{
  return {surface:theme.surface,text:theme.text,accent:theme.accent};
}
function objectRecord(value:unknown):Record<string,unknown>|undefined{
  return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
}
function validPalette(value:unknown):value is ThemePalette{
  const candidate=objectRecord(value);
  return !!candidate&&colors.every(key=>typeof candidate[key]==='string'&&/^#[0-9a-f]{6}$/i.test(candidate[key] as string));
}
const defaultTheme: PortfolioTheme = {mode: 'light', surface: '#f9fafb', text: '#152738', accent: '#b9734d'};
const defaultDarkTheme:PortfolioTheme={mode:'dark',surface:'#162433',text:'#f7f5ef',accent:'#eab087'};
function themeContrast(foreground:string,background:string):number {
  const luminance=(hex:string)=>{
    const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
      .map(v=>v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4));
    return 0.2126*rgb[0]!+0.7152*rgb[1]!+0.0722*rgb[2]!;
  };
  const a=luminance(foreground),b=luminance(background);
  return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
}

function readTheme(snapshot: PortfolioSnapshot | null | undefined): PortfolioTheme {
  try {
    const source = snapshot?.files[THEME_PATH];
    if (!source) return defaultTheme;
    const value = JSON.parse(source) as Partial<PortfolioTheme>;
    return (value.mode === 'light' || value.mode === 'dark') && colors.every(key => /^#[0-9a-f]{6}$/i.test(value[key] ?? ''))
      ? {mode:value.mode,surface:value.surface!,text:value.text!,accent:value.accent!} : defaultTheme;
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
    const imageReference=assignment?.state==='S0'&&assignment.componentId==='image@1'&&!!assignment.content.asset_id;
    const imageLabel=imageReference?'Private image reference — '+(assignment.content.alt_text||'Alt text missing'):'';
    const label=SLOT_TITLES[name.toLowerCase()]??name;
    const example=editing&&!text?layoutExample(section.renderId,name):null;
    const visibleLabel=imageLabel||text|| (kind==='media' ? '' : example??('Add '+label));
    const className='pv-slot pv-slot-'+kind+(text?' pv-filled':' pv-unfilled')+
      (selectedSlot===key?' pv-selected':'');
    if(editing)return <button className={className} type="button"
      aria-label={'Edit '+section.renderId+' '+name+' slot in preview'+(visibleLabel?' — '+visibleLabel:'')}
      aria-pressed={selectedSlot===key} onClick={()=>onSelectSlot?.(key)}>
      {imageReference?<span>{imageLabel}<small> · Media bytes not verified in this canvas</small></span>:text||(
        kind==='media'?<span className="pv-placeholder pv-media-blank" aria-hidden="true"/>:
        example?<span className="pv-placeholder pv-layout-example">{example}</span>:
        <span className="pv-placeholder">Add {label}</span>
      )}
    </button>;
    // Reference labels are author-only, never fabricated visitor imagery.
    if(imageReference)return showMissing?<span className={className}>{imageLabel} · Preview bytes unavailable</span>:null;
    return text?<span className={className}>{text}</span>:
      !showMissing?null:<span className={className} aria-hidden="true">Not added: {label}</span>;
  };

/** Partition manifest-declared slots once; do not project historical stashes
 * or let a special-case hero silently omit a declared assignment. */
function canvasSlotGroups(section:CanvasSection){
  const hero=['L1','L2','L5'].includes(section.renderId);
  const headline=section.slots.includes('title');
  const textSlot=section.slots.includes('text')?'text':section.slots.includes('text1')?'text1':undefined;
  const buttons=section.slots.filter(name=>['cta','cta1','cta2','btn1','btn2'].includes(name));
  const media=hero?section.slots.filter(name=>/^(avatar|image|imageA|imageB|media|thumbs)$/i.test(name)):[];
  const note=hero&&section.slots.includes('note');
  const reserved=new Set(['title',...(textSlot?[textSlot]:[]),...buttons,...media,...(note?['note']:[])]);
  const others=section.slots.filter(name=>!reserved.has(name));
  return {hero,headline,textSlot,buttons,media,note,others};
}

export function PortfolioCanvas({snapshot, title, standalone, simulation, width, selectedSlot, onSelectSlot, keyboardScroll}: {
  snapshot: PortfolioSnapshot | null | undefined; title: string; standalone?: boolean;
  simulation?:boolean; width?: number; keyboardScroll?:boolean;
  selectedSlot?:string; onSelectSlot?:(key:string)=>void;
}) {
  const theme=readTheme(snapshot);
  const style:CSSProperties & {'--portfolio-surface': string}={
    '--portfolio-surface':theme.surface,
    background:theme.surface,color:theme.text,colorScheme:theme.mode,
    borderTopColor:theme.accent,maxWidth:width
  };
  const sections=canvasSections(snapshot);
  const editing=typeof onSelectSlot==='function'&&!standalone&&!simulation;
  const slotProps={snapshot,editing,selectedSlot,onSelectSlot,showMissing:!standalone&&!simulation};
  const Tag=standalone?'main':'div';
  return <Tag className={standalone?'portfolio-only-preview pv-document':'ws-studio-canvas pv-document'}
    style={style} role={standalone?undefined:'region'} tabIndex={keyboardScroll?0:undefined}
    aria-label={standalone?'Saved private portfolio author preview':
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
        const {hero,headline,textSlot,buttons,media,note,others}=canvasSlotGroups(section);
        return <section key={section.id} className={'pv-section pv-layout-'+section.renderId+(hero?' pv-hero':' pv-content-section')}
          aria-label={'Portfolio section '+(index+1)}>
          {hero?<div className="pv-hero-grid">
            <div className="pv-hero-copy">
              <span className="pv-eyebrow">{section.renderId==='L5'?'YOUR STORY':'PORTFOLIO / INTRODUCTION'}</span>
              {headline&&<h2><PortfolioSlot {...slotProps} section={section} name="title" kind="title"/></h2>}
              {textSlot&&<div className="pv-summary"><PortfolioSlot {...slotProps} section={section} name={textSlot}/></div>}
              <div className="pv-actions">{buttons.map(name=>
                <PortfolioSlot {...slotProps} section={section} key={name} name={name} kind="action"/>)}</div>
              {note&&<div className="pv-hero-note"><PortfolioSlot {...slotProps} section={section} name="note" kind="tag"/></div>}
              {others.map(name=><div className="pv-slot-cell" key={name}>
                <PortfolioSlot {...slotProps} section={section} name={name}/>
              </div>)}
            </div>
            {media.length>0?
              <div className="pv-hero-art">{media.map(name=>
                <PortfolioSlot {...slotProps} section={section} key={name} name={name} kind="media"/>)}</div>:
              <div className="pv-hero-art" aria-hidden="true"><div className="pv-art-arc"/><div className="pv-art-fold"/></div>}
          </div>:<>
            <div className="pv-section-heading">
              {headline&&<h2><PortfolioSlot {...slotProps} section={section} name="title" kind="title"/></h2>}
              <span className="pv-section-index">{String(index+1).padStart(2,'0')}</span>
            </div>
            {textSlot&&<div className="pv-summary"><PortfolioSlot {...slotProps} section={section} name={textSlot}/></div>}
            <div className={'pv-section-slots pv-section-slots-'+section.renderId}>
              {others.map(name=>{
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
  const ratio=themeContrast(theme.text,theme.surface);
  const previous=head.snapshot.files[THEME_PATH];
  const tokens=previous?objectRecord(JSON.parse(previous))??{}:{};
  // Retain the renderer's established flat active fields. This editor-only
  // history is optional; unknown token fields are not rewritten.
  const history=objectRecord(tokens.authorModePalettes);
  const historySupported=tokens.authorModePalettes===undefined||!!history&&
    ['light','dark'].every(mode=>history[mode]===undefined||validPalette(history[mode]));
  function setTheme(next: PortfolioTheme) {
    if(!historySupported){
      if(next.mode!==theme.mode)return;
      apply({kind:'WRITE_MANAGED_FILE',path:THEME_PATH,source:JSON.stringify({...tokens,...next},null,2)});
      return;
    }
    const nextHistory={...history,
      [theme.mode]:{...objectRecord(history?.[theme.mode]),...paletteOf(theme)},
      [next.mode]:{...objectRecord(history?.[next.mode]),...paletteOf(next)}};
    apply({kind:'WRITE_MANAGED_FILE',path:THEME_PATH,source:JSON.stringify({...tokens,...next,authorModePalettes:nextHistory},null,2)});
  }
  function switchMode(mode:PortfolioTheme['mode']){
    if(!historySupported||mode===theme.mode)return;
    const saved=history?.[mode];
    const palette=validPalette(saved)?paletteOf({...saved,mode}):paletteOf(mode==='dark'?defaultDarkTheme:defaultTheme);
    setTheme({mode,...palette});
  }
  return <div className="ws-editor-tool">
    <h2>Theme &amp; responsive</h2>
    <label>Preview width<select value={width} onChange={event => resize(Number(event.target.value))}>
      <option value={0}>Fit canvas</option><option value={1440}>Desktop · up to 1440 px</option><option value={768}>Tablet · 768 px</option><option value={390}>Phone · 390 px</option>
    </select></label>
    <label>Portfolio theme<select value={theme.mode} disabled={!historySupported} onChange={event=>{
      if(event.target.value==='light'||event.target.value==='dark')switchMode(event.target.value);
    }}><option value="light">Light</option><option value="dark">Dark</option></select></label>
    {!historySupported&&<p role="alert">Existing palette-history data is unsupported. The current colors can be edited, but switching modes is blocked to avoid losing data.</p>}
    {colors.map(key => <label key={key}>{key}<input type="color" value={theme[key]} onChange={event =>
      setTheme({...theme, [key]: event.target.value})}/></label>)}
    <p>Global portfolio tokens · independent of the workspace theme. Preview widths do not authorize phone editing.</p>
    <p role={ratio<4.5?'alert':undefined}>Text on surface: {ratio.toFixed(2)}:1 contrast.
      {ratio<4.5?' Below 4.5:1 for ordinary text; adjust the colors before release.':' Meets the 4.5:1 reference for these two colors only.'}
      {' '}This is not a complete accessibility or publication check.</p>
    <button type="button" className="ws-secondary"
      disabled={colors.every(key=>theme[key]===(theme.mode==='dark'?defaultDarkTheme:defaultTheme)[key])}
      onClick={()=>setTheme({... (theme.mode==='dark'?defaultDarkTheme:defaultTheme)})}>Reset global palette</button>
    <p>Each mode retains its own global palette; reset affects only the active palette. Changes use the private transaction and Undo. Unsupported scoped tokens are left untouched; their static export parity is not yet verified.</p>
  </div>;
}

export function SourceInspector({head,apply,back,buffers,setBuffers}:{
  head:EditorHead;slot:string;apply:Apply;back:()=>void;
  buffers:Record<string,string>;setBuffers:Dispatch<SetStateAction<Record<string,string>>>;
}) {
  const [selected,setSelected]=useState('');
  const [notice,setNotice]=useState('');
  const pendingSource=unappliedSourceBufferCount(buffers,head.snapshot.files);
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
  return <div className="ws-source-explorer" role="group" aria-label="Advanced source workspace">
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
        <span>{changed?'Unapplied source buffer':'Matches working snapshot'}</span>
      </header>
      {path?owned?<div className="ws-source-code-window">
        <label htmlFor="kd-source-editor">Owned source buffer</label>
        <textarea id="kd-source-editor" spellCheck={false} rows={22} value={buffer}
          onChange={event=>{
            const next=event.target.value;
            setBuffers(previous=>{
              const updated={...previous};
              if(next===current)delete updated[path];else updated[path]=next;
              return updated;
            });
            setNotice('');
          }}/>
      </div>:<div className="ws-source-code-window ws-source-preview" role="group" aria-label="Readonly generated file">
        <pre><code>{current}</code></pre>
      </div>:<p>No source file is available.</p>}
      <div className="ws-source-footer">
        <p>{owned?'Owned source can be changed in the private draft, but no code is executed in the author canvas.':
          'Generated JSON composition and library files are protected from direct editing. Use Content and Sections instead.'}</p>
        {owned&&<button type="button" className="ws-primary" disabled={!changed||overLimit}
          onClick={applyBuffer}>Apply owned source to draft</button>}
        {changed&&<button type="button" className="ws-secondary" onClick={()=>{
          setBuffers(values=>{const next={...values};delete next[path];return next;});
          setNotice('Unapplied source buffer discarded; the private snapshot was unchanged.');
        }}>Discard source buffer</button>}
      </div>
      {pendingSource>0&&<p className="ws-source-unapplied" role="status">{pendingSource} unapplied source {pendingSource===1?'buffer':'buffers'}.
        Apply or discard each before saving or leaving this editor.
        <button type="button" className="ws-secondary ws-source-clear-all" onClick={()=>{
          setBuffers({});
          setNotice('All unapplied source buffers were discarded. The saved private snapshot is unchanged.');
        }}>Discard all unapplied source buffers</button>
      </p>}
      {notice&&<p role="status" className="ws-inline-alert">{notice}</p>}
    </section>
    <aside className="ws-source-diagnostics">
      <p className="ws-kicker">SOURCE DIAGNOSTICS</p>
      <h2>Editor rules</h2>
      <p>Only a verified editor transaction can modify owner source. Source text is never evaluated on the privileged workspace origin.</p>
      <dl>
        <div><dt>Source protection</dt><dd>{owned?'Owner-controlled version':'Read-only generated or archived file'}</dd></div>
        <div><dt>File size</dt><dd>{bytes.toLocaleString()} / {MAX_FILE_BYTES.toLocaleString()} bytes</dd></div>
        <div><dt>Draft buffer</dt><dd>{pendingSource?pendingSource+' unapplied file'+(pendingSource===1?'':'s'):'Matches working revision'}</dd></div>
        <div><dt>Author preview</dt><dd>Code execution disabled</dd></div>
        <div><dt>Public custom JavaScript</dt><dd>Blocked pending proven isolation</dd></div>
      </dl>
      {overLimit&&<p role="alert">The owned source exceeds the {MAX_FILE_BYTES.toLocaleString()}-byte limit. Your buffer is preserved; it cannot be applied.</p>}
      <p className="ws-source-diagnostics-note">No compilation, static security analysis, or public preview validation has run on this source. A successful draft save is not a release approval.</p>
    </aside>
  </div>;
}

/** One editor mount retains the operation UUID even when the panel closes
 * before an acknowledgement. This is not an offline login or cross-reload queue. */
export type ComponentSaveRetryState={
  pending:{signature:string;id:string;epoch:number}|null;inFlight:boolean;
};
export function ComponentLibrary({port, head, committed, slot, apply, blocked,saveRetry}: {
  port: SupabaseBrowserAuthPort; head: EditorHead; committed: PortfolioSnapshot | null; slot: string; apply: Apply;blocked:boolean;
  saveRetry:{current:ComponentSaveRetryState};
}) {
  const [versions, setVersions] = useState<MyComponentVersion[] | null>(null);
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState('');
  const [compatibleOnly,setCompatibleOnly]=useState(false);
  const [review,setReview]=useState<{
    versionId:string;slotKey:string;snapshot:PortfolioSnapshot;epoch:number;generation:number
  }|null>(null);
  const reviewHeading=useRef<HTMLHeadingElement>(null);
  const reviewTrigger=useRef<HTMLButtonElement|null>(null);
  const searchInput=useRef<HTMLInputElement>(null);
  const componentNameInput=useRef<HTMLInputElement>(null);
  const reviewSubmitting=useRef(false);
  const slotKind = slot.slice(slot.lastIndexOf('-') + 1);
  const state = head.snapshot.slots[slot]?.state;
  const owned=head.snapshot.slots[slot],savedSlot=committed?.slots[slot];
  const canSave=!!owned?.sourcePath&&!!savedSlot?.sourcePath&&['S1','S2'].includes(savedSlot.state)&&
    owned.sourcePath===savedSlot.sourcePath&&owned.originalSource===savedSlot.originalSource&&
    owned.componentId===savedSlot.componentId&&head.snapshot.files[owned.sourcePath]===committed?.files[savedSlot.sourcePath];
  const [refresh,setRefresh]=useState(0);
   const componentListGeneration=useRef(0);
  const catalogueEpoch=useRef<number|null>(null);
  const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);

  useEffect(() => {
    let active = true;
    const epoch=port.reconcileOwnerSessionEpoch(),generation=++componentListGeneration.current;
    setMessage('');setVersions(null);
    void port.listOwnerComponents().then(result => {
      if(!active||generation!==componentListGeneration.current||port.reconcileOwnerSessionEpoch()!==epoch)return;
      if(result.data){catalogueEpoch.current=epoch;setVersions(result.data);}
      else setMessage(result.error?.message??'My Components could not be loaded.');
    }).catch(()=>{if(active&&generation===componentListGeneration.current&&port.reconcileOwnerSessionEpoch()===epoch)setMessage('My Components could not be loaded.');});
    return ()=>{active=false;};
  }, [port,refresh]);

  async function save() {
    if(!committed||!canSave||blocked||!name.trim()||busy)return;
    const retry=saveRetry.current;
    if(retry.inFlight){setMessage('A component save is still in progress. Retry after it completes.');return;}
    const epoch=port.reconcileOwnerSessionEpoch();
    retry.inFlight=true;setBusy(true);setMessage('');
    try {
      const key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55);
      if (!/^[a-z][a-z0-9-]{2,63}$/.test(key)) {setMessage('Choose a component name with at least three letters or digits, beginning with a letter.'); return;}
      const input=savedComponentInputFromOwnedSlot(committed,slot,{
        operationId:crypto.randomUUID(),componentKey:key,displayName:name,compatibleSlotKinds:[slotKind]
      });
      const signature=JSON.stringify({...input,operationId:''});
      if(retry.pending?.signature!==signature||retry.pending.epoch!==epoch)retry.pending={signature,id:input.operationId,epoch};
      input.operationId=retry.pending.id;
      const result=await port.saveOwnerComponent(input);
      if(!mounted.current||port.reconcileOwnerSessionEpoch()!==epoch)return;
      if (!result.data) {setMessage(result.error?.message ?? 'Component save could not be confirmed.'); return;}
      const saved = result.data;
      // Invalidate an older pending catalogue read, then reload the actual list.
      ++componentListGeneration.current;catalogueEpoch.current=epoch;
      setVersions(current => [saved, ...(current ?? []).filter(version => version.id !== saved.id)]);
      setRefresh(n=>n+1);
      retry.pending=null;setName('');setMessage('Private component version saved.');
    }catch(error){if(mounted.current&&port.reconcileOwnerSessionEpoch()===epoch)
      setMessage(error instanceof Error?error.message:'Component save could not be confirmed.');}
    finally{retry.inFlight=false;if(mounted.current&&port.reconcileOwnerSessionEpoch()===epoch)setBusy(false);}
  }

  // Discovery is a projection of the verified private catalogue, not an
  // invented public listing, popularity score or persisted Favorites service.
  const categories=[...new Set(versions?.flatMap(version=>version.compatible_slot_kinds)??[])].sort();
  const normalizedQuery=query.trim().toLowerCase();
  const visibleVersions=versions?.filter(version=>
    (!compatibleOnly||!!state&&version.compatible_slot_kinds.includes(slotKind))&&
    (!category||version.compatible_slot_kinds.includes(category))&&
    (!normalizedQuery||[version.display_name,version.component_key,version.base_component_pin,
      'v'+version.version,...version.compatible_slot_kinds].some(value=>value.toLowerCase().includes(normalizedQuery))))??[];
  const reviewedVersion=review&&versions?.find(version=>version.id===review.versionId);
  const reviewCurrent=!!review&&!!reviewedVersion&&review.slotKey===slot&&review.snapshot===head.snapshot&&
    review.epoch===catalogueEpoch.current&&review.generation===componentListGeneration.current&&
    !!state&&state!=='EMPTY'&&!!owned&&reviewedVersion.compatible_slot_kinds.includes(slotKind);
  const retainedFields=reviewCurrent&&owned&&reviewedVersion?
    Object.keys(matchingReplacementContent(owned,reviewedVersion.base_component_pin)).sort():[];
  const stashedOnlyFields=reviewCurrent&&owned?
    Object.keys(owned.content).filter(key=>!retainedFields.includes(key)).sort():[];
  const sourceBytes=reviewCurrent&&owned?.sourcePath&&Object.hasOwn(head.snapshot.files,owned.sourcePath)?
    new TextEncoder().encode(head.snapshot.files[owned.sourcePath]!).byteLength:null;
  const protectedSource=state==='S1'||state==='S2';

  useLayoutEffect(()=>{if(review)reviewHeading.current?.focus();},[review]);
  function closeReview(restoreFocus=true){
    setReview(null);reviewSubmitting.current=false;
    if(restoreFocus){
      const trigger=reviewTrigger.current;
      if(trigger?.isConnected&&!trigger.disabled)trigger.focus();
      else searchInput.current?.focus();
    }
    reviewTrigger.current=null;
  }
  function openReuse(version:MyComponentVersion,trigger:HTMLButtonElement){
    if(blocked||busy||!owned||!state||!versions?.some(item=>item.id===version.id)||
      !version.compatible_slot_kinds.includes(slotKind))return;
    const epoch=port.reconcileOwnerSessionEpoch();
    if(epoch!==catalogueEpoch.current)return;
    setMessage('');
    if(state==='EMPTY'){
      closeReview(false);
      const ok=apply({kind:'REUSE_SAVED_COMPONENT',slotKey:slot,componentVersionId:version.id,
        preserveMatchingContent:true},{[version.id]:version});
      if(ok)setMessage('Private component applied to the working draft. Save to persist; source execution remains disabled.');
      return;
    }
    reviewTrigger.current=trigger;reviewSubmitting.current=false;
    setReview({versionId:version.id,slotKey:slot,snapshot:head.snapshot,epoch,
      generation:componentListGeneration.current});
  }
  function confirmReplacement(){
    if(reviewSubmitting.current||!reviewCurrent||!review||!reviewedVersion||blocked||busy)return;
    if(port.reconcileOwnerSessionEpoch()!==review.epoch||
      review.generation!==componentListGeneration.current){
      closeReview();setMessage('The private component catalogue changed. Reload it and review the replacement again.');return;
    }
    reviewSubmitting.current=true;
    const ok=apply({kind:'REUSE_SAVED_COMPONENT',slotKey:review.slotKey,componentVersionId:review.versionId,
      confirmOwnedReplacement:protectedSource,preserveMatchingContent:true},{[reviewedVersion.id]:reviewedVersion});
    closeReview();
    if(ok)setMessage('Replacement applied to the working draft. Outgoing assignment is stashed; use Undo or Save.');
    else setMessage('Replacement was not applied. Review current draft and resolve outstanding edits before retrying.');
  }

  return <div className="ws-editor-tool"><h2>My Components</h2>
    {message && <p role="status">{message}</p>}
    {!versions&&message&&<button type="button" className="ws-secondary" onClick={()=>setRefresh(n=>n+1)}>Retry private components</button>}
    {!versions && !message && <p role="status">Loading saved components…</p>}
    {versions?.length === 0 && <p>You haven’t saved any component versions.</p>}
    {!!versions?.length&&<>
      <p>Selected target: {state?slotKind+' slot':'No slot selected'}. Private saved versions only.</p>
      <label>Search saved components<input ref={searchInput} type="search" value={query} maxLength={120}
        onChange={event=>setQuery(event.target.value)} placeholder="Name, version, pin or slot kind"/></label>
      <label>Compatible slot category<select value={category} onChange={event=>setCategory(event.target.value)}>
        <option value="">All categories</option>
        {categories.map(kind=><option key={kind} value={kind}>{kind}</option>)}
      </select></label>
      <label><input type="checkbox" checked={compatibleOnly} disabled={!state}
        onChange={event=>setCompatibleOnly(event.target.checked)}/> Only versions compatible with the selected slot</label>
      <p role="status">{visibleVersions.length} of {versions.length} private versions shown.</p>
      {visibleVersions.length===0&&<><p>No saved versions match these filters.</p>
        <button type="button" className="ws-secondary" onClick={()=>{setQuery('');setCategory('');setCompatibleOnly(false);searchInput.current?.focus();}}>Clear filters</button></>}
    </>}
    <ul className="ws-editor-slots">{visibleVersions.map(version=>{
      const compatible=!!state&&version.compatible_slot_kinds.includes(slotKind);
      return <li key={version.id}>
        <strong>{version.display_name} · v{version.version}</strong>
        <span>Base: {version.base_component_pin} · Fits: {version.compatible_slot_kinds.join(', ')}</span>
        <small>{compatible?'Fits selected slot':state?'Not compatible with selected slot':'Select a slot first'} · Private source, not trusted public code</small>
        <button type="button" aria-expanded={review?.versionId===version.id}
          disabled={!compatible||blocked||busy}
          onClick={event=>openReuse(version,event.currentTarget)}>
          {state==='EMPTY'?'Reuse in selected slot':'Review replacement'}
        </button>
      </li>;
    })}</ul>
    {review&&<section aria-label="Replacement impact" onKeyDown={event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeReview();}
    }}>
      <h3 ref={reviewHeading} tabIndex={-1}>Review replacement impact</h3>
      {!reviewCurrent?<p role="alert">The selected slot, working draft or catalogue changed. Cancel and review the replacement again.</p>:<>
        <p>Replace {owned?.componentId??'current assignment'} with {reviewedVersion?.display_name} · v{reviewedVersion?.version} in {slotKind}.</p>
        <p>{protectedSource?(state==='S1'?'Owned pristine override (S1).':'Owned modified override (S2).'):'Pristine library assignment (S0).'} The entire outgoing assignment will be stashed.</p>
        {owned?.sourcePath&&<p>Protected source: <code>{owned.sourcePath}</code>{sourceBytes===null?'': ' · '+sourceBytes+' bytes'}. Existing source is retained; reuse creates a separate owned file.</p>}
        <dl>
          <div><dt>Matching declared fields retained</dt><dd>{retainedFields.join(', ')||'None'}</dd></div>
          <div><dt>Fields retained only in the outgoing stash</dt><dd>{stashedOnlyFields.join(', ')||'None'}</dd></div>
          <div><dt>Incoming source</dt><dd>Private saved version; no arbitrary source execution or public trust granted.</dd></div>
        </dl>
        {protectedSource&&<button type="button" className="ws-secondary" disabled={!canSave||blocked||busy}
          onClick={()=>{closeReview(false);componentNameInput.current?.focus();setMessage('Save the committed outgoing source as a private component before reviewing replacement again.');}}>Keep as My Component</button>}
        {protectedSource&&!canSave&&<p>To keep this exact outgoing version, cancel and save the portfolio after resolving unapplied buffers.</p>}
        {blocked&&<p role="status">Resolve pending source/content edits or saves before replacement.</p>}
        <button type="button" className="ws-primary" disabled={blocked||busy}
          onClick={confirmReplacement}>Replace and stash</button>
      </>}
      <button type="button" className="ws-secondary" onClick={()=>closeReview()}>Cancel replacement</button>
    </section>}
    {canSave && <><label>Component name<input ref={componentNameInput} disabled={busy} value={name} maxLength={80} onChange={event => setName(event.target.value)}/></label>
      <button type="button" className="ws-secondary" disabled={busy||blocked||!name.trim()} onClick={()=>void save()}>Save committed component</button></>}
    {!canSave&&(state==='S1'||state==='S2')&&<p>Save the portfolio and resolve unapplied source edits before keeping this exact owned version.</p>}
  </div>;
}


/** C10 UI boundary. S3 owns the authoritative planner, the parent write gate
 * and atomic transaction engine. No fallback applies unvalidated mutations.
 * These intent shapes match the agreed S03-004 contract; the parent supplies
 * the actual typed planner and apply once its engine is committed. */
export type LayoutMappingRequest={
  sectionId:string;expectedLayout:string;targetLayout:string;
  mappings:Array<{fromSlotKey:string;toSlotKey:string|null}>;
};
export type LayoutToolsIntent=
  | (LayoutMappingRequest & {kind:'CHANGE_SECTION_LAYOUT';expectedRevision:number;
      confirmStash:boolean;confirmOwnedRelocation:boolean})
  | {kind:'RESTORE_LAYOUT_STASH';fromSlotKey:string;stashIndex:number;toSlotKey:string;
      expectedRevision:number;confirmOwnedRelocation:boolean};
type LayoutPlanFlags={requiresStashConfirmation:boolean;requiresOwnedRelocationConfirmation:boolean};
export type LayoutToolsProps={
  head:EditorHead;sectionId:string;blocked:boolean;
  planLayout:(head:EditorHead,request:LayoutMappingRequest)=>LayoutPlanFlags;
  applyLayout:(intent:LayoutToolsIntent)=>boolean;
};
type MappingDraft={head:EditorHead;sectionId:string;expectedLayout:string;targetLayout:string;
  choices:Record<string,string>};
type MappingReview={draft:MappingDraft;request:LayoutMappingRequest;flags:LayoutPlanFlags};
type RestoreDraft={head:EditorHead;fromSlotKey:string;stashIndex:number;toSlotKey:string};
type Assignment=PortfolioSnapshot['slots'][string];
const C10_LAYOUT_PINS=['arc-hero@1','collage-hero@1','project-showcase@1','editorial-bento@1',
  'stepped-hero@1','skills@1','experience@1','contact@1'] as const;
const C10_STASH='__stash__';
const layoutSlotKey=(sectionId:string,name:string)=>sectionId+'-'+name.toLowerCase();
const usableLayoutKey=(key:string)=>/^[a-z0-9_-]{1,64}$/.test(key)&&
  !['__proto__','prototype','constructor'].includes(key);
const layoutLabel=(pin:string)=>{const layout=portfolioLayout(pin);return layout?
  layout.renderId+' · '+pin.split('@')[0]!.replaceAll('-',' '):'Unavailable layout';};
const ownAssignment=(snapshot:PortfolioSnapshot,key:string):Assignment|undefined=>
  Object.hasOwn(snapshot.slots,key)?snapshot.slots[key]:undefined;
const ownedAssignment=(value:Assignment|undefined)=>value?.state==='S1'||value?.state==='S2';
function sameWorkingHead(captured:EditorHead,current:EditorHead):boolean{
  return captured.revision===current.revision&&captured.snapshot===current.snapshot;
}
/** Build the exact proposed mapping from explicit choices only. The engine
 * must still validate pin compatibility, quotas, provenance and collisions. */
function explicitLayoutMappings(keys:readonly string[],targetKeys:readonly string[],
  choices:Readonly<Record<string,string>>):LayoutMappingRequest['mappings']|null {
  const used=new Set<string>();
  const rows:LayoutMappingRequest['mappings']=[];
  for(const key of keys){
    if(!usableLayoutKey(key)||!Object.hasOwn(choices,key))return null;
    const choice=choices[key];
    if(choice===C10_STASH){rows.push({fromSlotKey:key,toSlotKey:null});continue;}
    if(!choice||!targetKeys.includes(choice)||!usableLayoutKey(choice)||used.has(choice))return null;
    used.add(choice);rows.push({fromSlotKey:key,toSlotKey:choice});
  }
  return rows;
}
function AssignmentImpact({assignment,snapshot}:{assignment:Assignment|undefined;snapshot:PortfolioSnapshot}){
  if(!assignment||assignment.state==='EMPTY')return <span>Empty slot</span>;
  const sourcePath=assignment.sourcePath;
  const byteCount=sourcePath&&Object.hasOwn(snapshot.files,sourcePath)?
    new TextEncoder().encode(snapshot.files[sourcePath]!).byteLength:null;
  return <div>
    <strong>{assignment.componentId??'Unknown pin'}</strong> · {assignment.state}
    <p>Content fields: {Object.keys(assignment.content).sort().join(', ')||'None'}</p>
    {sourcePath&&<p>Owned source: <code>{sourcePath}</code>{byteCount===null?' · bytes unavailable':' · '+byteCount+' bytes'}</p>}
    {assignment.content.asset_id&&<p>Private media reference retained; no publication or byte verification granted.</p>}
  </div>;
}

/** Private editor only. Structural comparison uses real pinned slot names;
 * this is not a simulated visitor render or a public preview. */
export function LayoutTools({head,sectionId,blocked,planLayout,applyLayout}:LayoutToolsProps){
  const [draft,setDraft]=useState<MappingDraft|null>(null);
  const [review,setReview]=useState<MappingReview|null>(null);
  const [confirmStash,setConfirmStash]=useState(false);
  const [confirmRelocation,setConfirmRelocation]=useState(false);
  const [restore,setRestore]=useState<RestoreDraft|null>(null);
  const [restoreReviewed,setRestoreReviewed]=useState(false);
  const [restoreRelocation,setRestoreRelocation]=useState(false);
  const [message,setMessage]=useState('');
  const targetSelect=useRef<HTMLSelectElement>(null);
  const stashSelect=useRef<HTMLSelectElement>(null);
  const layoutTitle=useRef<HTMLHeadingElement>(null);
  const unplacedTitle=useRef<HTMLHeadingElement>(null);
  const planButton=useRef<HTMLButtonElement>(null);
  const restoreButton=useRef<HTMLButtonElement>(null);
  const reviewTitle=useRef<HTMLHeadingElement>(null);
  const restoreTitle=useRef<HTMLHeadingElement>(null);
  const submitting=useRef(false);
  const sections=canvasSections(head.snapshot);
  const matchingSections=sections.filter(section=>section.id===sectionId);
  const section=matchingSections.length===1?matchingSections[0]:undefined;
  const draftCurrent=!!draft&&!!section&&draft.sectionId===sectionId&&
    draft.expectedLayout===section.layout&&sameWorkingHead(draft.head,head);
  const sourceSection=draft?canvasSections(draft.head.snapshot).find(item=>item.id===draft.sectionId):undefined;
  const sourceSlots=sourceSection?sourceSection.slots.map(name=>({name,key:layoutSlotKey(sourceSection.id,name)})):[];
  const targetManifest=draft?portfolioLayout(draft.targetLayout):undefined;
  const targetSlots=draft?(targetManifest?.slots??[]).
    map(name=>({name,key:layoutSlotKey(draft.sectionId,name),required:targetManifest?.required.includes(name)===true})):[];
  const assignedKeys=sourceSlots.filter(item=>{
    const assignment=draft&&ownAssignment(draft.head.snapshot,item.key);
    return !!assignment&&assignment.state!=='EMPTY';
  }).map(item=>item.key);
  const mappings=draft?explicitLayoutMappings(assignedKeys,targetSlots.map(item=>item.key),draft.choices):null;
  const requiredUnfilled=targetSlots.filter(item=>item.required&&
    !assignedKeys.some(key=>draft?.choices[key]===item.key));
  const reviewCurrent=!!review&&draftCurrent&&review.draft===draft;
  const emptyTargets=sections.flatMap(item=>item.slots.map(name=>({
    key:layoutSlotKey(item.id,name),label:item.renderId+' · '+name+' ('+item.id+')'
  }))).filter((item,index,all)=>usableLayoutKey(item.key)&&
    all.filter(other=>other.key===item.key).length===1&&
    ownAssignment(head.snapshot,item.key)?.state==='EMPTY');
  // Include historical keys that no longer exist in the active layout.
  const entries=Object.entries(head.snapshot.stashes).filter(([key])=>usableLayoutKey(key)).
    flatMap(([key,items])=>items.flatMap((assignment,index)=>assignment.state==='EMPTY'?[]:
      [{key,index,assignment,token:key+':'+index}]));
  const restoreCurrent=!!restore&&sameWorkingHead(restore.head,head);
  const restoration=restoreCurrent&&restore?entries.find(item=>item.key===restore.fromSlotKey&&
    item.index===restore.stashIndex):undefined;
  const restoreTarget=restoreCurrent&&restore?emptyTargets.find(item=>item.key===restore.toSlotKey):undefined;
  const restoreMovesOwned=!!restoration&&!!restore&&restore.fromSlotKey!==restore.toSlotKey&&
    ownedAssignment(restoration.assignment);
  const restoreLegacy=restoreMovesOwned&&!restoration?.assignment.sourcePath?.endsWith('.tsx');
  const restoreSelectionRef=useRef<RestoreDraft|null>(null);

  useLayoutEffect(()=>{if(review)reviewTitle.current?.focus();},[review]);
  useLayoutEffect(()=>{if(restoreReviewed)restoreTitle.current?.focus();},[restoreReviewed]);
  useLayoutEffect(()=>{
    if(restoreSelectionRef.current&&!restore&&!stashSelect.current)unplacedTitle.current?.focus();
    restoreSelectionRef.current=restore;
  },[restore]);

  function resetReview(focus=false){
    setReview(null);setConfirmStash(false);setConfirmRelocation(false);
    if(focus)planButton.current?.focus();
  }
  function cancelMapping(){
    resetReview();setDraft(null);setMessage('Layout change cancelled; no transaction was submitted.');
    if(targetSelect.current)targetSelect.current.focus();else layoutTitle.current?.focus();
  }
  function beginMapping(targetLayout:string){
    if(blocked||!section||!portfolioLayout(targetLayout)||section.layout===targetLayout)return;
    resetReview();setMessage('');
    setDraft({head,sectionId:section.id,expectedLayout:section.layout,targetLayout,choices:{}});
  }
  function chooseDestination(from:string,to:string){
    if(blocked||!draftCurrent||!draft)return;
    resetReview();setMessage('');
    setDraft({...draft,choices:{...draft.choices,[from]:to}});
  }
  function reviewMapping(){
    if(blocked||!draftCurrent||!draft||!mappings||submitting.current)return;
    resetReview();setMessage('');
    const request={sectionId:draft.sectionId,expectedLayout:draft.expectedLayout,
      targetLayout:draft.targetLayout,mappings};
    try{
      const flags=planLayout(draft.head,request);
      if(typeof flags.requiresStashConfirmation!=='boolean'||typeof flags.requiresOwnedRelocationConfirmation!=='boolean'){
        setMessage('The authoritative layout plan is unavailable. No change was applied.');return;
      }
      setReview({draft,request,flags});
    }catch{
      setMessage('This mapping was rejected by the layout planner. Check compatible targets, owned source relocation, and stash limits. No change was applied.');
    }
  }
  function commitMapping(){
    if(blocked||!reviewCurrent||!review||submitting.current||
      (review.flags.requiresStashConfirmation&&!confirmStash)||
      (review.flags.requiresOwnedRelocationConfirmation&&!confirmRelocation))return;
    submitting.current=true;
    try{
      const ok=applyLayout({kind:'CHANGE_SECTION_LAYOUT',...review.request,
        expectedRevision:review.draft.head.revision,confirmStash,confirmOwnedRelocation:confirmRelocation});
      if(ok){setDraft(null);resetReview();setMessage('Layout transaction applied to the working draft. Save to persist, or use Undo.');targetSelect.current?.focus();}
      else{resetReview();setMessage('Layout transaction was not applied. Review the current draft again.');planButton.current?.focus();}
    }catch{resetReview();setMessage('Layout transaction could not be confirmed. Review the current draft before retrying.');}
    finally{submitting.current=false;}
  }
  function cancelRestore(){
    setRestore(null);setRestoreReviewed(false);setRestoreRelocation(false);
    setMessage('Restore cancelled; no transaction was submitted.');
    if(stashSelect.current)stashSelect.current.focus();else unplacedTitle.current?.focus();
  }
  function selectStash(token:string){
    if(blocked)return;
    const item=entries.find(entry=>entry.token===token);
    setRestoreReviewed(false);setRestoreRelocation(false);setMessage('');
    setRestore(item?{head,fromSlotKey:item.key,stashIndex:item.index,toSlotKey:''}:null);
  }
  function reviewRestore(){
    if(blocked||!restoreCurrent||!restoration||!restoreTarget||restoreLegacy)return;
    setRestoreRelocation(false);setRestoreReviewed(true);setMessage('');
  }
  function commitRestore(){
    if(blocked||submitting.current||!restoreCurrent||!restoreReviewed||!restore||
      !restoration||!restoreTarget||restoreLegacy||(restoreMovesOwned&&!restoreRelocation))return;
    submitting.current=true;
    try{
      const ok=applyLayout({kind:'RESTORE_LAYOUT_STASH',fromSlotKey:restore.fromSlotKey,
        stashIndex:restore.stashIndex,toSlotKey:restore.toSlotKey,expectedRevision:restore.head.revision,
        confirmOwnedRelocation:restoreRelocation});
      if(ok){setRestore(null);setMessage('Stashed assignment restored to the working draft. Save to persist, or use Undo.');stashSelect.current?.focus();}
      else setMessage('Restore was rejected. Check target compatibility or source restrictions; no successful restore is claimed.');
    }catch{setMessage('Restore could not be confirmed. Review the current draft before retrying.');}
    finally{setRestoreReviewed(false);setRestoreRelocation(false);submitting.current=false;}
  }

  return <div className="ws-editor-tool">
    <h2>Layout mapping and Unplaced</h2>
    {blocked&&<p role="status">Resolve pending edits, saves or recovery before changing the layout or restoring a stash.</p>}
    {message&&<p role="status">{message}</p>}
    <section aria-label="Change section layout">
      <h3 ref={layoutTitle} tabIndex={-1}>Change section layout</h3>
      {!section?<p>Choose an actual section in the layers tree to change its layout.</p>:<>
        <p>Current: {layoutLabel(section.layout)}. Choose a different pinned layout, then map each filled slot.</p>
        <label>Target layout<select ref={targetSelect} disabled={blocked}
          value={draftCurrent&&draft?draft.targetLayout:''} onChange={event=>{
            if(event.target.value)beginMapping(event.target.value);else cancelMapping();
          }}>
          <option value="">Choose a layout</option>
          {C10_LAYOUT_PINS.filter(pin=>pin!==section.layout&&!!portfolioLayout(pin)).map(pin=>
            <option key={pin} value={pin}>{layoutLabel(pin)}</option>)}
        </select></label>
      </>}
      {draft&&!draftCurrent&&<><p role="alert">The section or working revision changed. This mapping is stale; cancel and start a new review.</p>
        <button type="button" className="ws-secondary" onClick={cancelMapping}>Cancel layout mapping</button></>}
      {draft&&draftCurrent&&<div onKeyDown={event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(review)resetReview(true);else cancelMapping();}
      }}>
        <div className="ws-layout-comparison" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%, 220px),1fr))',gap:'1rem'}}>
          <section aria-label="Current layout"><h4>Current · {layoutLabel(draft.expectedLayout)}</h4>
            <ol>{sourceSlots.map(item=><li key={item.key}>
              <strong>{item.name}</strong>
              <AssignmentImpact assignment={ownAssignment(draft.head.snapshot,item.key)} snapshot={draft.head.snapshot}/>
            </li>)}</ol>
          </section>
          <section aria-label="Proposed layout"><h4>Proposed · {layoutLabel(draft.targetLayout)}</h4>
            <ol>{targetSlots.map(item=>{
              const candidates=assignedKeys.filter(key=>draft.choices[key]===item.key);
              return <li key={item.key}><strong>{item.name}{item.required?' · Required for release':''}</strong>
                {candidates.length===1?<AssignmentImpact assignment={ownAssignment(draft.head.snapshot,candidates[0]!)} snapshot={draft.head.snapshot}/>:
                  <p>{candidates.length?'Mapping conflict':'No assignment mapped; will be empty'}</p>}
              </li>;
            })}</ol>
          </section>
        </div>
        {requiredUnfilled.length>0&&<p role="status">Required target slots not yet mapped: {requiredUnfilled.map(item=>item.name).join(', ')}. A draft may retain empty slots, but release needs separate preflight.</p>}
        <p>Slot structure comparison only. Responsive appearance and static export must be checked after the layout transaction; no source is executed here.</p>
        <fieldset disabled={blocked}>
          <legend>Map outgoing assignments</legend>
          {assignedKeys.length===0&&<p>No filled slots to map. The new layout starts empty.</p>}
          {assignedKeys.map(key=>{
            const assignment=ownAssignment(draft.head.snapshot,key);
            const choice=draft.choices[key]??'';
            return <div key={key}>
              <label>Destination for {key}<select value={choice} onChange={event=>chooseDestination(key,event.target.value)}>
                <option value="">Choose a destination</option>
                <option value={C10_STASH}>Unplaced — stash complete assignment</option>
                {targetSlots.map(item=><option key={item.key} value={item.key}
                  disabled={assignedKeys.some(other=>other!==key&&draft.choices[other]===item.key)}>{item.name} ({item.key})</option>)}
              </select></label>
              {choice&&choice!==C10_STASH&&choice!==key&&ownedAssignment(assignment)&&
                <p>Cross-slot owned source: requires explicit relocation. Legacy CSS and unsupported source cannot be moved.</p>}
            </div>;
          })}
        </fieldset>
        <button ref={planButton} type="button" className="ws-secondary" disabled={blocked||!mappings}
          onClick={reviewMapping}>Review layout impact</button>
        <button type="button" className="ws-secondary" onClick={cancelMapping}>Cancel layout mapping</button>
        {review&&reviewCurrent&&<section aria-label="Layout change confirmation">
          <h4 ref={reviewTitle} tabIndex={-1}>Confirm layout transformation</h4>
          <p>Validated working revision {review.draft.head.revision}. {review.request.mappings.filter(row=>row.toSlotKey===null).length} assignments marked Unplaced.</p>
          <ul>{review.request.mappings.map(row=><li key={row.fromSlotKey}>
            {row.fromSlotKey} → {row.toSlotKey??'Unplaced (full assignment)'}
            {row.toSlotKey&&row.toSlotKey!==row.fromSlotKey&&ownedAssignment(ownAssignment(review.draft.head.snapshot,row.fromSlotKey))?
              <span> · Original owned file and outgoing assignment retained; new operation-specific file required</span>:null}
          </li>)}</ul>
          {review.flags.requiresStashConfirmation&&<label><input type="checkbox" checked={confirmStash}
            disabled={blocked} onChange={event=>setConfirmStash(event.target.checked)}/> Confirm preservation of outgoing assignments in Unplaced</label>}
          {review.flags.requiresOwnedRelocationConfirmation&&<>
            <p>The engine copies compatible owned TSX to a new operation-specific slot path and retains the original source and provenance. Relative imports may no longer resolve; no imports are rewritten.</p>
            <label><input type="checkbox" checked={confirmRelocation} disabled={blocked}
              onChange={event=>setConfirmRelocation(event.target.checked)}/> Confirm explicit owned-source relocation</label>
          </>}
          <button type="button" className="ws-primary" disabled={blocked||
            (review.flags.requiresStashConfirmation&&!confirmStash)||
            (review.flags.requiresOwnedRelocationConfirmation&&!confirmRelocation)} onClick={commitMapping}>Confirm layout change</button>
          <button type="button" className="ws-secondary" onClick={()=>resetReview(true)}>Back to mapping</button>
        </section>}
      </div>}
    </section>
    <section aria-label="Global Unplaced assignments" onKeyDown={event=>{
      if(event.key==='Escape'&&restore){event.preventDefault();event.stopPropagation();cancelRestore();}
    }}>
      <h3 ref={unplacedTitle} tabIndex={-1}>Unplaced assignments</h3>
      <p role="status">{entries.length} stashed assignments across current and previous layouts.</p>
      {!entries.length?<p>No stashed assignments.</p>:<>
        <label>Stashed assignment<select ref={stashSelect} disabled={blocked} value={restoreCurrent&&restore?
          restore.fromSlotKey+':'+restore.stashIndex:''} onChange={event=>selectStash(event.target.value)}>
          <option value="">Choose a stashed assignment</option>
          {entries.map(item=><option key={item.token} value={item.token}>
            {item.key} · #{item.index+1} · {item.assignment.componentId??'Unknown pin'} · {item.assignment.state}
          </option>)}
        </select></label>
      </>}
      {restore&&!restoreCurrent&&<><p role="alert">The stash changed with the working revision. Cancel and select the saved assignment again.</p>
        <button type="button" className="ws-secondary" onClick={cancelRestore}>Cancel restore</button></>}
      {restore&&restoration&&restoreCurrent&&<>
        <AssignmentImpact assignment={restoration.assignment} snapshot={head.snapshot}/>
        <label>Restore to empty slot<select disabled={blocked} value={restore.toSlotKey} onChange={event=>{
          setRestore({...restore,toSlotKey:event.target.value});setRestoreReviewed(false);setRestoreRelocation(false);setMessage('');
        }}>
          <option value="">Choose an empty slot</option>
          {emptyTargets.map(item=><option key={item.key} value={item.key}>{item.label}</option>)}
        </select></label>
        {!emptyTargets.length&&<p>No empty declared slots. Clear or add a compatible slot first.</p>}
        <p>Only declared empty slots are offered. The transaction engine checks actual component compatibility and source restrictions before restoring.</p>
        {restoreLegacy&&<p role="alert">Cross-slot relocation of this legacy or unsupported source is not available. Restore to its original compatible slot instead.</p>}
        <button ref={restoreButton} type="button" className="ws-secondary" disabled={blocked||!restoreTarget||restoreLegacy} onClick={reviewRestore}>Review restore impact</button>
        <button type="button" className="ws-secondary" onClick={cancelRestore}>Cancel restore</button>
        {restoreReviewed&&restoreTarget&&<section aria-label="Stash restore confirmation">
          <h4 ref={restoreTitle} tabIndex={-1}>Confirm stash restore</h4>
          <p>Restore {restore.fromSlotKey} assignment #{restore.stashIndex+1} to {restoreTarget.label}. Other stash entries remain intact; no source runs.</p>
          {restoreMovesOwned&&<><p>Owned TSX relocation retains original bytes and provenance; relative imports may stop resolving.</p>
            <label><input type="checkbox" disabled={blocked} checked={restoreRelocation}
              onChange={event=>setRestoreRelocation(event.target.checked)}/> Confirm explicit owned-source relocation</label></>}
          <button type="button" className="ws-primary" disabled={blocked||(restoreMovesOwned&&!restoreRelocation)}
            onClick={commitRestore}>Confirm restore</button>
          <button type="button" className="ws-secondary" onClick={()=>{setRestoreReviewed(false);setRestoreRelocation(false);restoreButton.current?.focus();}}>Back to restore selection</button>
        </section>}
      </>}
    </section>
  </div>;
}


export function AssetList({port,back,snapshot,targets,selectedSlot,placementDisabled,onPlace}:{
  port:SupabaseBrowserAuthPort;back:()=>void;snapshot:PortfolioSnapshot;
  targets:readonly {key:string;label:string;state:string}[];selectedSlot:string;placementDisabled:boolean;
  onPlace:(assetId:string,slot:string,altText:string)=>Promise<boolean>;
}) {
  const [assets,setAssets]=useState<NonNullable<Awaited<ReturnType<SupabaseBrowserAuthPort['listOwnerAssets']>>['data']>|null>(null);
  const [projects,setProjects]=useState<NonNullable<Awaited<ReturnType<SupabaseBrowserAuthPort['listOwnerProjects']>>['data']>|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [projectId,setProjectId]=useState('');
  const [collection,setCollection]=useState('');
  const [selectedAssetId,setSelectedAssetId]=useState('');
  const [targetKey,setTargetKey]=useState('');
  const [placementAlt,setPlacementAlt]=useState('');
  const [placing,setPlacing]=useState(false);
  const placementFlight=useRef(false);
  const uploadFlight=useRef(false);
  const assetMounted=useRef(false);
  useEffect(()=>{assetMounted.current=true;return()=>{assetMounted.current=false;};},[]);
  const [uploadOpen,setUploadOpen]=useState(false);
  const [file,setFile]=useState<File|null>(null);
  const [alt,setAlt]=useState('');
  const [busy,setBusy]=useState(false);
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    let active=true;const epoch=port.reconcileOwnerSessionEpoch();setError('');setAssets(null);setProjects(null);
    void Promise.all([port.listOwnerAssets(),port.listOwnerProjects()]).then(([assetReply,projectReply])=>{
      if(!active||port.reconcileOwnerSessionEpoch()!==epoch)return;
      if(!assetReply.data||!projectReply.data){
        setError(assetReply.error?.message??projectReply.error?.message??'Private asset records could not be verified.');
        setAssets(null);setProjects(null);return;
      }
      setAssets(assetReply.data);setProjects(projectReply.data);
    }).catch(()=>{if(active&&port.reconcileOwnerSessionEpoch()===epoch){setError('Private asset records could not be loaded.');setAssets(null);setProjects(null);}});
    return ()=>{active=false;};
  },[port,refresh]);
  const visible=assets?.filter(item=>!collection||item.projectId===collection)??[];
  const selected=visible.find(item=>item.id===selectedAssetId);
  // Explicitly selected target disappearing must not redirect a placement.
  const target=targets.find(item=>item.key===(targetKey||selectedSlot));
  const uses=selected?Object.entries(snapshot.slots).filter(([,assignment])=>
    assignment.state!=='EMPTY'&&assignment.content.asset_id===selected.id):[];
  async function place(){
    if(!selected||!target||placing||busy||placementFlight.current||uploadFlight.current||placementDisabled||!placementAlt.trim()||placementAlt.length>300)return;
    const epoch=port.reconcileOwnerSessionEpoch();placementFlight.current=true;setPlacing(true);setNotice('');
    try{
      const placed=await onPlace(selected.id,target.key,placementAlt.trim());
      if(!assetMounted.current||port.reconcileOwnerSessionEpoch()!==epoch)return;
      setNotice(placed?'Private image reference applied. Save draft to persist the assignment; media bytes have not been attested.':
        'Image placement was not completed. Existing assignment and selected image were retained.');
    }finally{placementFlight.current=false;if(assetMounted.current&&port.reconcileOwnerSessionEpoch()===epoch)setPlacing(false);}
  }
  async function upload(event:import('react').FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(busy||uploadFlight.current||placementFlight.current||!file||!projectId||!alt.trim())return;
    const epoch=port.reconcileOwnerSessionEpoch();
    uploadFlight.current=true;setBusy(true);setError('');setNotice('');
    try{
      const receipt=await port.uploadOwnerProjectImage(projectId,file,alt.trim());
      if(!assetMounted.current||port.reconcileOwnerSessionEpoch()!==epoch)return;
      if(!receipt.data||receipt.data.publicDeliveryAllowed!==false||
        receipt.data.verifiedMetadata!==true)
        throw new Error(receipt.error?.message??'The private registration receipt was not verified.');
      setNotice('Image uploaded and privately registered. Public delivery remains blocked; a trusted byte attestation is still required.');
      setSelectedAssetId(receipt.data.id);setPlacementAlt(receipt.data.altText);setCollection('');
      setAlt('');setFile(null);setUploadOpen(false);setRefresh(n=>n+1);
      const input=document.getElementById('kd-private-image-file');
      if(input instanceof HTMLInputElement)input.value='';
    }catch(cause){if(assetMounted.current&&port.reconcileOwnerSessionEpoch()===epoch)
      setError(cause instanceof Error?cause.message:'Image registration was not confirmed.');}
    finally{uploadFlight.current=false;if(assetMounted.current&&port.reconcileOwnerSessionEpoch()===epoch)setBusy(false);}
  }
  return <div className="ws-asset-library ws-asset-manager" role="group" aria-label="Private asset manager">
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
          onClick={()=>{setSelectedAssetId(asset.id);setPlacementAlt(asset.altText);setUploadOpen(false);}}>
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
            <label>Owner project<select required disabled={busy} value={projectId} onChange={event=>setProjectId(event.target.value)}>
              <option value="">Select a private project</option>
              {projects?.map(project=><option key={project.id} value={project.id}>{project.title}</option>)}
            </select></label>
            <label htmlFor="kd-private-image-file">Private image file</label>
            <input id="kd-private-image-file" type="file" required disabled={busy}
              accept="image/png,image/jpeg,image/webp"
              onChange={event=>setFile(event.currentTarget.files?.[0]??null)}/>
            <label>Image alt text<textarea rows={3} required disabled={busy} maxLength={500} value={alt}
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
          <div><dt>Current working draft uses</dt><dd>{uses.length?uses.map(([key])=>key).join(', '):'None in current draft'}</dd></div>
          <div><dt>Focal point</dt><dd>Not stored</dd></div>
        </dl>
        <p className="ws-asset-protection">Place only a verified owner-private registration into an actual compatible slot. Replacing a pristine image stashes its previous assignment; historical asset bytes are not deleted. No public URL or digest is fabricated.</p>
        {targets.length===0?<p>No compatible empty/pristine image slot is available in this verified editor. Add a suitable section or select a different slot.</p>:<>
          <label>Compatible image slot<select value={target?.key??''} onChange={event=>setTargetKey(event.target.value)}>
            <option value="">Choose an image-compatible slot</option>
            {targets.map(item=><option key={item.key} value={item.key}>{item.label} · {item.state==='EMPTY'?'Empty':'Replace image'}</option>)}
          </select></label>
          <label>Placement alt text<textarea rows={3} value={placementAlt}
            aria-invalid={!placementAlt.trim()||placementAlt.length>300}
            onChange={event=>setPlacementAlt(event.target.value)}/></label>
          <p>Use 1–300 characters. No automatic truncation of existing alt text.</p>
          <button type="button" className="ws-primary" disabled={!target||placementDisabled||busy||placing||!placementAlt.trim()||placementAlt.length>300}
            onClick={()=>void place()}>{placing?'Verifying placement…':target?.state==='S0'?'Replace image and stash previous':'Assign image to selected slot'}</button>
        </>}
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

export function RevisionHistory({port,id,revision,onRestore,working,buffered,active}: {
  port:SupabaseBrowserAuthPort;id:string;revision:number;
  onRestore:(snapshot:PortfolioSnapshot)=>boolean;working:PortfolioSnapshot;buffered:boolean;active:boolean;
}) {
  const [items,setItems]=useState<{revision:number;createdAt:string}[]|null>(null);
  const [selected,setSelected]=useState<number|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [comparison,setComparison]=useState<{
    revision:number;changedFiles:number;changedSlots:number;
  }|null>(null);
  useEffect(()=>{
    let active=true;
    setItems(null);setSelected(null);setComparison(null);setError('');
    void port.listOwnerRevisions(id).then(result=>{
      if(!active)return;
      if(result.data)setItems(result.data);
      else setError(result.error?.message??'Revision history could not be loaded.');
    }).catch(()=>{
      if(active)setError('Revision history could not be loaded. Please retry.');
    });
    return ()=>{active=false;};
  },[port,id,revision]);
  // A read can resolve after the owner edits, saves, changes account/route,
  // or closes History. Never use the old captured editor callback to restore.
  const latest=useRef<{port:SupabaseBrowserAuthPort;id:string;revision:number;
    working:PortfolioSnapshot;buffered:boolean;active:boolean;epoch:number;onRestore:(snapshot:PortfolioSnapshot)=>boolean}|null>(null);
  useLayoutEffect(()=>{
    latest.current={port,id,revision,working,buffered,active,epoch:port.getOwnerSessionEpoch(),onRestore};
    return ()=>{latest.current=null;};
  },[port,id,revision,working,buffered,active,onRestore]);
  // A comparison describes one exact working snapshot, not later edits/restores.
  useEffect(()=>{setComparison(null);},[working]);
  async function compare(){
    if(!selected||busy||!active)return;
    const epoch=port.reconcileOwnerSessionEpoch();
    setBusy(true);setError('');setComparison(null);
    try{
      const historical=await readSelectedUnsafe(selected);
      if(!historical)return;
      const current=latest.current;
      if(!current||!current.active||current.port!==port||current.id!==id||current.revision!==revision||
        current.epoch!==epoch||port.reconcileOwnerSessionEpoch()!==epoch)return;
      if(current.working!==working){
        setError('The working draft changed during comparison. Compare again.');
        return;
      }
      const paths=new Set([...Object.keys(working.files),...Object.keys(historical.files)]);
      const keys=new Set([...Object.keys(working.slots),...Object.keys(historical.slots)]);
      const changedFiles=[...paths].filter(path=>working.files[path]!==historical.files[path]).length;
      const stable=(v:unknown):string=>JSON.stringify(v,(_key,value)=>{
        if(value&&typeof value==='object'&&!Array.isArray(value)){
          return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)));
        }
        return value;
      });
      const changedSlots=[...keys].filter(key=>stable(working.slots[key])!==stable(historical.slots[key])).length;
      setComparison({revision:selected,changedFiles,changedSlots});
    }finally{setBusy(false);}
  }
  async function readSelectedUnsafe(version:number):Promise<PortfolioSnapshot|null>{
    try {
      const result=await port.readOwnerRevision(id,version);
      if(!result.data){setError(result.error?.message??'Historical revision cannot be verified.');return null;}
      return result.data;
    } catch {
      setError('Historical revision could not be verified. Please retry.');
      return null;
    }
  }
  async function restore(){
    if(!selected||busy||buffered||!active)return;
    const epoch=port.reconcileOwnerSessionEpoch();
    setBusy(true);setError('');
    try{
      const snapshot=await readSelectedUnsafe(selected);
      const current=latest.current;
      if(!snapshot||!current||!current.active||current.port!==port||current.id!==id||current.revision!==revision||
        current.epoch!==epoch||port.reconcileOwnerSessionEpoch()!==epoch)return;
      if(current.working!==working||current.buffered){
        setError('The working draft or its unapplied edits changed during restore. Review them and retry.');
        return;
      }
      if(current.onRestore(snapshot)){setSelected(null);setComparison(null);}
    }finally{setBusy(false);}
  }
  return <div className="ws-editor-tool ws-revision-list">
    <h2>Saved checkpoints</h2>
    {error&&<p role="alert">{error}</p>}
    {!items&&!error&&<p role="status">Loading owner-private revisions…</p>}
    {items?.length===0&&<p>No saved checkpoints have been returned.</p>}
    <ul className="ws-editor-slots">{items?.map(item=><li key={item.revision}>
      <button type="button" disabled={busy} aria-pressed={item.revision===selected}
        onClick={()=>{setSelected(item.revision);setComparison(null);}}>
        Revision {item.revision}<span>{new Date(item.createdAt).toLocaleString()}</span>
      </button></li>)}</ul>
    <section id="history-comparison" className="ws-revision-compare" aria-label="Version comparison">
      <h3>Compare &amp; restore</h3>
      {!selected&&<p>Select a saved checkpoint above to compare it with the current working draft.</p>}
      {selected&&<>
        <p>Revision {selected} is an owner-private saved checkpoint. Comparison only reads its historical snapshot.</p>
        <div className="ws-revision-buttons">
          <button type="button" className="ws-secondary" disabled={busy} onClick={()=>void compare()}>
            Compare to working copy</button>
          <button type="button" className="ws-secondary" disabled={busy||buffered||!active} onClick={()=>void restore()}>
            Restore selected checkpoint to draft</button>
        </div>
      </>}
      {comparison&&<div role="status" aria-label="Actual snapshot comparison"><dl className="ws-revision-difference">
        <div><dt>Compared revision</dt><dd>{comparison.revision}</dd></div>
        <div><dt>Different project files</dt><dd>{comparison.changedFiles}</dd></div>
        <div><dt>Different component slots</dt><dd>{comparison.changedSlots}</dd></div>
      </dl></div>}
      {buffered&&<p role="status">Apply or discard unapplied inspector and source text before restoring a checkpoint. Your existing buffers remain untouched.</p>}
      <p>Restore is a reversible editor transaction, not a public rollback; save the private draft to persist it.</p>
    </section>
  </div>;
}

/** EDIT-08: the approved history layout is a three-pane private workbench,
 * not a small history list inside the Content inspector. */
export function RevisionWorkspace({port,id,revision,working,title,dirty,buffered,active,onRestore,back}:{
  port:SupabaseBrowserAuthPort;id:string;revision:number;
  working:PortfolioSnapshot;title:string;dirty:boolean;buffered:boolean;active:boolean;
  onRestore:(snapshot:PortfolioSnapshot)=>boolean;back:()=>void;
}){
  const [tab,setTab]=useState<'History'|'Problems'|'Conflicts'>('History');
  const views=['History','Problems','Conflicts'] as const;
  function moveTab(event:KeyboardEvent<HTMLButtonElement>,index:number){
    const last=views.length-1;
    const next=event.key==='ArrowRight'?(index+1)%views.length:
      event.key==='ArrowLeft'?(index+last)%views.length:
      event.key==='Home'?0:event.key==='End'?last:null;
    if(next===null)return;
    const nextView=views[next];
    if(!nextView)return;
    event.preventDefault();
    setTab(nextView);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]').item(next)?.focus();
  }
  return <div className="ws-revision-workspace">
    <aside className="ws-revision-nav">
      <p className="ws-kicker">DOCUMENT HISTORY</p>
      <h2>Revisions</h2>
      <p>Compare actual saved checkpoints. Restore into a working copy without replacing published content.</p>
      <nav aria-label="Revision history navigation">
        <a href="#history-current">Current working draft</a>
        <a href="#history-checkpoints">Saved checkpoints</a>
        <a href="#history-comparison">Compare &amp; restore</a>
      </nav>
      <p className="ws-source-tree-note">Your private draft is versioned. Undo/Redo and a checkpoint restore never bypass release verification.</p>
      <button type="button" className="ws-secondary" onClick={back}>Back to editor canvas</button>
    </aside>
    <section className="ws-revision-center">
      <div className="ws-revision-breadcrumb">HISTORY / PRIVATE AUTHOR PREVIEW
        <span>Saved revision {revision} · {dirty?'Uncommitted edits':'No uncommitted edits'}</span></div>
      <div id="history-current" className="ws-revision-canvas" role="region" aria-label="Current revision preview" tabIndex={0}>
        <PortfolioCanvas snapshot={working} title={title}/>
      </div>
      <section id="history-checkpoints" className="ws-revision-bottom">
        <div className="ws-revision-tab-row"><h2>History &amp; problems</h2>
          <span>Private revisions · diagnostics are explicitly scoped</span></div>
        <div className="ws-revision-tabs" role="tablist" aria-label="Revision views">
          {views.map((view,index)=>
            <button role="tab" type="button" key={view} id={'kd-revision-tab-'+view.toLowerCase()}
              aria-controls="kd-revision-panel" aria-selected={tab===view}
              tabIndex={tab===view?0:-1} onKeyDown={event=>moveTab(event,index)}
              onClick={()=>setTab(view)}>{view}</button>)}
        </div>
        <div id="kd-revision-panel" role="tabpanel" tabIndex={0}
          aria-labelledby={'kd-revision-tab-'+tab.toLowerCase()}>
          {tab==='History'?<RevisionHistory port={port} id={id} revision={revision}
            working={working} onRestore={onRestore} buffered={buffered} active={active}/>:
          tab==='Problems'?<div className="ws-revision-honest-state">
            <h3>Validation has not been run here.</h3>
            <p>Saved revision integrity is checked on read. This history page does not run source lint, custom-code analysis, media attestation or public host checks.</p>
            <a href={'/app/portfolios/'+id+'/publish'}>Open private release preflight</a>
          </div>:
          <div className="ws-revision-honest-state">
            <h3>Concurrent-save checks happen on save.</h3>
            <p>This screen cannot infer other active editing sessions. A stale private revision is rejected by the compare-and-swap save writer without replacing the newer version.</p>
          </div>}
        </div>
      </section>
    </section>
    <aside className="ws-revision-diagnostics">
      <p className="ws-kicker">PROBLEMS</p><h2>Diagnostics</h2>
      <p>A private draft check is not a public deployment or a compilation audit.</p>
      <dl>
        <div><dt>Current working state</dt><dd>{dirty?'Uncommitted private changes':'Same revision as last save'}</dd></div>
        <div><dt>Saved revision</dt><dd>{revision}</dd></div>
        <div><dt>Source diagnostics</dt><dd>Not executed or compiled here</dd></div>
        <div><dt>Concurrent save conflicts</dt><dd>Checked only on the next compare-and-swap save</dd></div>
        <div><dt>Public release</dt><dd>Not authorized by revision history</dd></div>
      </dl>
      <p className="ws-source-diagnostics-note">History can restore versioned private bytes. It cannot assert host/CDN withdrawal, public image delivery or current visitor reachability.</p>
    </aside>
  </div>;
}
