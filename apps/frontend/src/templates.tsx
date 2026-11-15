import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ActionLink, Brand, Icon, useTheme, getAuthHref } from './landing.tsx';

type PresetCategory = 'All categories' | 'Showcase' | 'Editorial' | 'Minimal';
type LayoutFilter = 'All layouts' | 'Single page' | 'Project focused' | 'Modular';
type Preset = {
  id: string;
  title: string;
  description: string;
  category: Exclude<PresetCategory, 'All categories'>;
  layout: Exclude<LayoutFilter, 'All layouts'>;
  tone: string;
  tags: string[];
};
export const PRESET_PREVIEWS: readonly Preset[] = [
  {id:'curved-hero',title:'Curved Hero',description:'A bold, focused intro with fluid geometry.',category:'Showcase',layout:'Single page',tone:'curved',tags:['Portfolio','Single page']},
  {id:'interlocking-showcase',title:'Interlocking Showcase',description:'A dynamic composition that emphasizes real work.',category:'Showcase',layout:'Project focused',tone:'interlocking',tags:['Portfolio','Project-focused']},
  {id:'editorial-grid',title:'Editorial Grid',description:'A content-forward grid for work, writing and more.',category:'Editorial',layout:'Modular',tone:'editorial',tags:['Portfolio','Editorial']},
  {id:'modular-portfolio',title:'Modular Portfolio',description:'A flexible block layout with room to grow.',category:'Editorial',layout:'Modular',tone:'modular',tags:['Portfolio','Modular']},
  {id:'stepped-minimal',title:'Stepped Minimal',description:'A clean hierarchy that puts your work first.',category:'Minimal',layout:'Single page',tone:'stepped',tags:['Portfolio','Minimal']}
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
      <p className="eyebrow"><span/> Concept preview</p>
      <button type="button" className="dialog-close" onClick={onClose} aria-label="Close template preview">×</button>
    </div>
    <h2 id="template-dialog-title">{preset.title}</h2>
    <p>{preset.description} This is a visual concept, not an exported or published website.</p>
    <TemplateGraphic tone={preset.tone}/>
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
      <main id="templates-main" className="templates-main">
        <section className="templates-hero" aria-labelledby="templates-title">
          <div className="templates-geometry" aria-hidden="true"/>
          <p className="eyebrow"><span/> Templates</p>
          <h1 id="templates-title">Portfolio Templates</h1>
          <p className="templates-intro">Professional, developer-focused compositions to start from. Explore how your work can look, then sign in to build your own.</p>
          <div className="template-facts">
            <div><Icon name="layers" size={24}/><p><strong>5 planned presets</strong><span>Curated starting points; production renderer acceptance pending.</span></p></div>
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
        <p className="template-results" role="status">{available.length} template design {available.length===1?'concept':'concepts'} shown. These are previews, not live published portfolios.</p>
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
              <a className="header-signin" href={getAuthHref()}>Use Template <Icon name="arrow" size={16}/></a>
            </div>
          </article>)}</div>}
        <section className="template-signin-note" aria-labelledby="template-note-title">
          <span className="strip-icon"><Icon name="user" size={24}/></span><div>
            <h2 id="template-note-title">Explore templates, then sign in to author.</h2>
            <p>You can preview concepts publicly; creating, editing and publishing require an authenticated account and verified backend workflow.</p></div>
          <ActionLink href={getAuthHref()}>Sign in to get started</ActionLink>
        </section>
      </main>
    </div>
    {preview && <PreviewDialog preset={preview} onClose={closePreview}/>}
  </>;
}
