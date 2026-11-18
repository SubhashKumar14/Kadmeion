import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortfolioPresetDraft, type PortfolioPresetId } from '../../../packages/editor-core/src/managed-project-files.ts';
import type { PortfolioSnapshot } from '../../../packages/editor-core/src/portfolio-revision-transactions.ts';
import { ActionLink, Brand, Icon, useTheme, getAuthHref } from './landing.tsx';

type PresetCategory = 'All categories' | 'Showcase' | 'Editorial' | 'Minimal';
type LayoutFilter = 'All layouts' | 'Single page' | 'Project focused' | 'Modular';
type Preset = {
  id: string;
  presetId: Exclude<PortfolioPresetId, 'blank'>;
  title: string;
  description: string;
  category: Exclude<PresetCategory, 'All categories'>;
  layout: Exclude<LayoutFilter, 'All layouts'>;
  tone: string;
  tags: string[];
};
export const PRESET_PREVIEWS: readonly Preset[] = [
  {id:'curved-hero',presetId:'arc',title:'Curved Hero',description:'A bold, focused intro with fluid geometry.',category:'Showcase',layout:'Single page',tone:'curved',tags:['Portfolio','Single page']},
  {id:'interlocking-showcase',presetId:'collage',title:'Interlocking Showcase',description:'A dynamic composition that emphasizes real work.',category:'Showcase',layout:'Project focused',tone:'interlocking',tags:['Portfolio','Project-focused']},
  {id:'editorial-grid',presetId:'editorial',title:'Editorial Grid',description:'A content-forward grid for work, writing and more.',category:'Editorial',layout:'Modular',tone:'editorial',tags:['Portfolio','Editorial']},
  {id:'modular-portfolio',presetId:'studio',title:'Modular Portfolio',description:'A flexible block layout with room to grow.',category:'Editorial',layout:'Modular',tone:'modular',tags:['Portfolio','Modular']},
  {id:'stepped-minimal',presetId:'stairs',title:'Stepped Minimal',description:'A clean hierarchy that puts your work first.',category:'Minimal',layout:'Single page',tone:'stepped',tags:['Portfolio','Minimal']}
] as const;
export function filterPresets(items: readonly Preset[],query:string,category:PresetCategory,layout:LayoutFilter,order:'Featured'|'A–Z'):Preset[] {
  const term=query.trim().toLocaleLowerCase('en');
  const found=items.filter(item=>{
    if(category!=='All categories'&&item.category!==category)return false;
    if(layout!=='All layouts'&&item.layout!==layout)return false;
    return !term||[item.title,item.description,item.category,item.layout,...item.tags].some(value=>value.toLowerCase().includes(term));
  });
  return order==='A–Z'?found.sort((a,b)=>a.title.localeCompare(b.title,'en')):found;
}
export function TemplateGraphic({tone}:{tone:string}){
  return <div className={'template-graphic '+tone} aria-hidden="true">
    <span className="template-faux-nav"/><span className="template-faux-lines"/><span className="template-faux-accent"/>
    <span className="template-faux-geometry"/>
  </div>;
}
// Public, deterministic demo of the actual editor preset. These values are not
// read from a user, saved, applied to drafts, or passed to the publish pipeline.
// Leave EMPTY media slots untouched; sample copy cannot attest an image or URL.
const demoSectionTitles: Readonly<Record<string,string>> = {
  'arc-hero':'Introduce your work', 'collage-hero':'Introduce your work',
  'stepped-hero':'Introduce your work', 'project-showcase':'Selected work',
  'editorial-bento':'Project stories', 'skills':'Skills', 'experience':'Experience',
  'contact':'Contact'
};
export function createPublicPresetDemo(presetId:Preset['presetId']):PortfolioSnapshot {
  const snapshot=createPortfolioPresetDraft(presetId);
  for (const [slotKey,slot] of Object.entries(snapshot.slots)) {
    if(slot.state!=='S0')continue;
    const section=slotKey.slice(0,slotKey.lastIndexOf('-'));
    switch(slot.componentId){
      case 'title-stacked@1': slot.content={title:demoSectionTitles[section]??'Section title'};break;
      case 'body-copy@1': slot.content={text:'Describe your work, responsibilities and what you learned here.'};break;
      case 'external-link@1': slot.content={label:'Example action (inactive)'};break;
      case 'project-card@1': slot.content={title:'Example project',summary:'Add an authored project story.'};break;
      case 'skills-list@1': slot.content={items:'Add your own skills or experience.'};break;
      case 'technology-tag@1': slot.content={text:'Technology label'};break;
      // Never invent metrics or imply that a real provider verified demo content.
      default: break;
    }
  }
  return snapshot;
}

type DemoCanvas=typeof import('./portfolio-tools.tsx').PortfolioCanvas;
type DemoTheme='light'|'dark';
// Use the existing editor's flat preview palette contract. Only the ephemeral
// demo snapshot is changed; this never applies a template or persists a theme.
const demoPalettes:Readonly<Record<DemoTheme,{surface:string;text:string;accent:string}>>={
  light:{surface:'#f9fafb',text:'#152738',accent:'#b9734d'},
  dark:{surface:'#162433',text:'#f7f5ef',accent:'#eab087'}
};
function withDemoPalette(snapshot:PortfolioSnapshot,mode:DemoTheme):PortfolioSnapshot {
  return {...snapshot,files:{...snapshot.files,'theme/tokens.json':JSON.stringify({mode,...demoPalettes[mode]})}};
}
function ActualPresetPreview({preset}:{preset:Preset}){
  const [mode,setMode]=useState<DemoTheme>('light');
  const snapshot=useMemo(()=>withDemoPalette(createPublicPresetDemo(preset.presetId),mode),[preset.presetId,mode]);
  const [Canvas,setCanvas]=useState<DemoCanvas|null>(null);
  const [failed,setFailed]=useState(false);
  const [width,setWidth]=useState<number|undefined>(undefined);
  const [measuredWidth,setMeasuredWidth]=useState<number|null>(null);
  useEffect(()=>{
    let active=true;
    // Reuse the actual escaped React canvas and its layout styles; do not load
    // the authenticated workspace or instantiate an auth/service client.
    void Promise.all([import('./portfolio-tools.tsx'),import('./workspace.css')]).then(
      ([module])=>{if(active)setCanvas(()=>module.PortfolioCanvas);},
      ()=>{if(active)setFailed(true);}
    );
    return ()=>{active=false;};
  },[]);
  const page=JSON.parse(snapshot.files['pages/home.page.json']!) as {header:{layout:string}|null;sections:{id:string;layout:string}[]};
  return <section aria-label={'Demo of '+preset.title+' preset'}>
    <p>Demo content only. The shared editor canvas uses the real preset section order. Its author-preview labels do not indicate a saved or published portfolio. Media and example actions are inactive.</p>
    <p>Included sections: {page.sections.map(section=>demoSectionTitles[section.id]??section.layout).join(' · ')}</p>
    <p>Preset header: {page.header?.layout.split('@')[0]?.replace(/^header-/,'').replace(/-/g,' ')??'None'}. The shared canvas currently uses a common header preview.</p>
    <fieldset disabled={failed||!Canvas}>
      <legend>Preview width</legend>
      <p>Width limits, not device emulation. The canvas can be narrower than the selected limit; some layout rules follow the browser viewport.</p>
      <button type="button" className="outline-small" aria-pressed={width===undefined} onClick={()=>setWidth(undefined)}>Fit</button>{' '}
      <button type="button" className="outline-small" aria-pressed={width===1440} onClick={()=>setWidth(1440)}>Up to 1440 px (desktop)</button>{' '}
      <button type="button" className="outline-small" aria-pressed={width===768} onClick={()=>setWidth(768)}>Up to 768 px (tablet)</button>{' '}
      <button type="button" className="outline-small" aria-pressed={width===390} onClick={()=>setWidth(390)}>Up to 390 px (phone width)</button>
      {Canvas&&!failed&&<p>{measuredWidth===null?'Canvas content width is not measured.':'Measured canvas content width: '+Math.round(measuredWidth)+' px.'}</p>}
    </fieldset>
    <fieldset disabled={failed||!Canvas}>
      <legend>Portfolio preview theme</legend>
      <p>Compare the two editor palettes in this demo only. This does not change your site theme or save a portfolio.</p>
      <button type="button" className="outline-small" aria-pressed={mode==='light'} onClick={()=>setMode('light')}>Light</button>{' '}
      <button type="button" className="outline-small" aria-pressed={mode==='dark'} onClick={()=>setMode('dark')}>Dark</button>
    </fieldset>
    {failed?<p role="alert">The preset renderer could not load. Close the preview and reload this page to try again.</p>:
      Canvas?<div data-public-preset={preset.presetId}><Canvas snapshot={snapshot} title={preset.title+' — demo'} simulation width={width} keyboardScroll onContentWidth={setMeasuredWidth}/></div>:
      <div>
        <p role="status">Loading preset layout…</p>
        <div className="glyph-skeleton" aria-hidden="true">
          <span className="glyph-skeleton-line is-title"/>
          <span className="glyph-skeleton-line is-medium"/>
          <span className="glyph-skeleton-line is-short"/>
        </div>
      </div>}
  </section>;
}

function PreviewDialog({preset,onClose}:{preset:Preset,onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const node=dialog.current;
    if(!node)return;
    node.showModal();
    return ()=>{if(node.open)node.close();};
  },[]);
  return <dialog ref={dialog} className="template-dialog"
    // StrictMode's effect cleanup closes the native dialog. That close must
    // not be interpreted as a user request to dismiss the React preview state.
    onCancel={event=>{event.preventDefault();onClose();}} aria-labelledby="template-dialog-title">
    <div className="template-dialog-top">
      <p className="eyebrow"><span/> Preset preview</p>
      <button type="button" className="dialog-close" onClick={onClose} aria-label="Close template preview">×</button>
    </div>
    <h2 id="template-dialog-title">{preset.title}</h2>
    <p>{preset.description} This is an in-app layout demo, not an exported or published website.</p>
    <ActualPresetPreview preset={preset}/>
    <div className="template-dialog-actions"><button type="button" onClick={onClose} className="outline-small">Back to templates</button>
      <ActionLink href={getAuthHref()}>Sign in to begin</ActionLink></div>
  </dialog>;
}
export function TemplateExplorer(){
  const [theme,toggleTheme]=useTheme();
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState<PresetCategory>('All categories');
  const [layout,setLayout]=useState<LayoutFilter>('All layouts');
  const [sort,setSort]=useState<'Featured'|'A–Z'>('Featured');
  const [preview,setPreview]=useState<Preset|null>(null);
  const previewOpener=useRef<HTMLButtonElement|null>(null);
  const closePreview=()=>{
    setPreview(null);
    // Native <dialog> handles Escape and the inert background while open.
    requestAnimationFrame(()=>previewOpener.current?.focus());
  };
  const available=filterPresets(PRESET_PREVIEWS,query,category,layout,sort);
  return <>
    <a className="skip-link" href="#templates-main">Skip to templates</a>
    <div className="site-shell template-shell">
      <header className="site-header">
        <Brand/>
        <nav aria-label="Primary navigation" className="site-navigation">
          <a href="/templates" aria-current="page">Templates</a>
          <a href="/#showcase">Showcase</a>
          <a href="/">Home</a>
          <a href="https://github.com/SubhashKumar14/Kadmeion/tree/main/project-docs" rel="noopener noreferrer" target="_blank">Resources</a>
        </nav>
        <div className="header-actions">
          <button type="button" className="theme-button" onClick={toggleTheme} aria-pressed={theme==='dark'}
            aria-label={theme==='light'?'Switch to dark theme':'Switch to light theme'}>
            <Icon name={theme==='light'?'moon':'sun'} size={16}/><span>{theme==='light'?'Dark':'Light'}</span>
          </button>
          <a className="header-signin" href={getAuthHref()}>Sign in <Icon name="arrow" size={15}/></a>
        </div>
      </header>
      <main id="templates-main" tabIndex={-1} className="templates-main">
        <section className="templates-hero" aria-labelledby="templates-title">
          <div className="templates-geometry" aria-hidden="true"/>
          <p className="eyebrow"><span/> Templates</p>
          <h1 id="templates-title">Portfolio Templates</h1>
          <p className="templates-intro">Professional, developer-focused compositions to start from. Explore how your work can look, then sign in to build your own.</p>
          <div className="template-facts">
            <div><Icon name="layers" size={24}/><p><strong>5 initial presets</strong><span>Curated starting layouts; published renderer acceptance pending.</span></p></div>
            <div><Icon name="arrow" size={23}/><p><strong>Built to extend</strong><span>A template system designed to grow with your work.</span></p></div>
          </div>
        </section>
        <form className="template-filters" role="search" onSubmit={event=>event.preventDefault()}>
          <label className="sr-only" htmlFor="template-query">Search templates</label>
          <div className="template-query"><span aria-hidden="true"><Icon name="target" size={18}/></span>
            <input id="template-query" type="search" placeholder="Search templates" value={query} onChange={event=>setQuery(event.target.value)}/></div>
          <label className="sr-only" htmlFor="template-category">Category</label>
          <select id="template-category" value={category} onChange={event=>setCategory(event.target.value as PresetCategory)}>
            <option>All categories</option><option>Showcase</option><option>Editorial</option><option>Minimal</option>
          </select>
          <label className="sr-only" htmlFor="template-layout">Layout</label>
          <select id="template-layout" value={layout} onChange={event=>setLayout(event.target.value as LayoutFilter)}>
            <option>All layouts</option><option>Single page</option><option>Project focused</option><option>Modular</option>
          </select>
          <label className="sr-only" htmlFor="template-sort">Sort</label>
          <select id="template-sort" value={sort} onChange={event=>setSort(event.target.value as 'Featured'|'A–Z')}>
            <option value="Featured">Sort: Featured</option><option value="A–Z">Sort: A–Z</option>
          </select>
        </form>
        <p className="template-results" role="status">{available.length} template design {available.length===1?'concept':'concepts'} shown. Open Preview to view the corresponding editor layout with demo content. Nothing is applied or published.</p>
        {available.length===0 ?
          <div className="no-template-results"><h2>No matching templates</h2><p>Try another search or choose a broader category.</p>
            <button className="outline-small" type="button" onClick={()=>{setQuery('');setCategory('All categories');setLayout('All layouts');setSort('Featured');}}>Clear filters</button></div>
          :<div className="template-card-grid">{available.map(item=>
          <article className="template-card" key={item.id}>
            <div className="template-card-top">
              <TemplateGraphic tone={item.tone}/>
              <div className="template-card-copy">
                <h2>{item.title}</h2><p>{item.description}</p>
                <div className="tag-row">{item.tags.map(tag=><span className="tag" key={tag}>{tag}</span>)}</div>
              </div>
            </div>
            <div className="template-card-actions">
              <button type="button" className="outline-small" onClick={event=>{previewOpener.current=event.currentTarget;setPreview(item);}}>Preview</button>
              <a className="header-signin" href={getAuthHref()} aria-label={'Sign in to build — ' + item.title + ' concept preview'}>Sign in to build <Icon name="arrow" size={16}/></a>
            </div>
          </article>)}</div>}
        <section className="template-signin-note" aria-labelledby="template-note-title">
          <span className="strip-icon"><Icon name="user" size={24}/></span><div>
            <h2 id="template-note-title">Explore templates, then sign in to author.</h2>
            <p>Preview preset layouts publicly. Sign in, then choose an available preset in your workspace; this gallery does not silently apply or reserve a template.</p></div>
          <ActionLink href={getAuthHref()}>Sign in to get started</ActionLink>
        </section>
      </main>
    </div>
    {preview && <PreviewDialog preset={preview} onClose={closePreview}/>}
  </>;
}
