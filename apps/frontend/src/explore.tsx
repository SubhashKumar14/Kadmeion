import { useState } from 'react';
import { ActionLink, Brand, Icon, useTheme, getAuthHref } from './landing.tsx';
import { filterShowcaseConcepts } from './behavior.ts';

type ConceptCategory = 'All'|'Full-Stack'|'Frontend'|'AI / ML'|'Product';
type Concept = {id:string;title:string;field:Exclude<ConceptCategory,'All'>;description:string;tags:string[];type:string;year:string;tone:string;initials:string};
const concepts:readonly Concept[]=[
  {id:'bidhub',title:'BidHub',field:'Full-Stack',description:'A collaborative project-bidding platform concept.',tags:['Web','Marketplace'],type:'Product example',year:'2025',tone:'bidhub',initials:'B'},
  {id:'streamflix',title:'StreamFlix',field:'Frontend',description:'A film discovery and recommendation app concept.',tags:['React','Media'],type:'Project example',year:'2025',tone:'streamflix',initials:'S'},
  {id:'aegis-ai',title:'Aegis AI',field:'AI / ML',description:'Applied AI systems and software tooling concept.',tags:['AI / ML','Tools'],type:'Project example',year:'2025',tone:'aegis',initials:'A'},
  {id:'kadmeion',title:'Kadmeion',field:'Product',description:'The developer identity platform now being built.',tags:['Portfolio','Identity'],type:'Platform concept',year:'2026',tone:'kadmeion',initials:'K'}
];
function ConceptCover({item}:{item:Concept}){
  return <div className={'showcase-cover '+item.tone} aria-hidden="true">
    <div className="showcase-cover-name"><span>{item.initials}</span> {item.title}</div>
    <div className="cover-lines"><span/><span/><span/></div>
    <div className="cover-geometry"/>
  </div>;
}
export function ExplorePortfolios(){
  const [theme,toggleTheme]=useTheme();
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState<ConceptCategory>('All');
  const [order,setOrder]=useState<'Featured'|'Name A–Z'>('Featured');
  const filtered=filterShowcaseConcepts(concepts,query,category,order);
  return <>
    <a className="skip-link" href="#explore-main">Skip to showcase</a>
    <div className="site-shell explore-shell">
      <header className="site-header">
        <Brand/>
        <nav aria-label="Primary navigation" className="site-navigation">
          <a href="/explore" aria-current="page">Explore Portfolios</a><a href="/templates">Templates</a><a href="/">Build on Kadmeion</a>
        </nav>
        <div className="header-actions">
          <button type="button" className="theme-button" onClick={toggleTheme} aria-pressed={theme==='dark'}
            aria-label={theme==='light'?'Switch to dark theme':'Switch to light theme'}>
            <Icon name={theme==='light'?'moon':'sun'} size={16}/><span>{theme==='light'?'Dark':'Light'}</span>
          </button>
          <a className="header-signin" href={getAuthHref()}><Icon name="user" size={15}/> Sign in</a>
        </div>
      </header>
      <main id="explore-main" tabIndex={-1} className="explore-main">
        <section className="explore-hero" aria-labelledby="explore-title">
          <div className="explore-copy">
            <p className="eyebrow"><span/> Portfolio concepts</p>
            <h1 id="explore-title">Explore developer<br/><em>portfolio ideas.</em></h1>
            <p>Browse illustrative presentation ideas for developer work. These examples are not published Kadmeion accounts.</p>
            <div className="hero-actions"><ActionLink href="/templates">Explore Templates</ActionLink>
              <ActionLink href={getAuthHref()} kind="outline">Create Your Portfolio</ActionLink></div>
          </div>
          <div className="explore-featured">
            <div className="explore-featured-art" aria-hidden="true"><span/><span/><span/></div>
            <div className="explore-featured-info">
              <p className="eyebrow"><span/> Illustration only</p>
              <h2>Make your work yours.</h2>
              <p>Curate projects, reflect on what you learned and present your story without inventing achievements.</p>
              <div className="tag-row"><span className="tag">Portfolio</span><span className="tag">Developer identity</span></div>
              <ActionLink href="/templates">See template concepts</ActionLink>
            </div>
          </div>
        </section>
        <section aria-labelledby="browse-title" className="explore-browse">
          <h2 id="browse-title" className="sr-only">Browse layout examples</h2>
          <p className="explore-disclosure">The verified public directory is not connected to this gallery. Its availability and listing count are unconfirmed. The search and filters below apply only to illustrative layouts—not live published accounts or verified project ownership.</p>
          <form className="explore-filters" role="search" onSubmit={event=>event.preventDefault()}>
            <label className="sr-only" htmlFor="explore-search">Search concept examples</label>
            <div className="template-query"><Icon name="target" size={18}/>
              <input id="explore-search" type="search" value={query} onChange={event=>setQuery(event.target.value)}
                placeholder="Search illustrative project examples..."/></div>
            <label className="sr-only" htmlFor="explore-category">Category</label>
            <select id="explore-category" value={category} onChange={event=>setCategory(event.target.value as ConceptCategory)}>
              <option>All</option><option>Full-Stack</option><option>Frontend</option><option>AI / ML</option><option>Product</option>
            </select>
            <label className="sr-only" htmlFor="explore-sort">Sort examples</label>
            <select id="explore-sort" value={order} onChange={event=>setOrder(event.target.value as 'Featured'|'Name A–Z')}>
              <option>Featured</option><option>Name A–Z</option>
            </select>
          </form>
          <div className="category-chips" role="group" aria-label="Category shortcuts">
            {(['All','Full-Stack','Frontend','AI / ML','Product'] as const).map(item=>
              <button key={item} type="button" aria-pressed={category===item} onClick={()=>setCategory(item)}>{item}</button>)}
          </div>
          <p className="showcase-result-count" role="status">{filtered.length} illustrative {filtered.length===1?'example':'examples'} match.</p>
          {filtered.length===0?<div className="no-template-results">
            <h2>No matching concepts</h2><p>Clear the search or try another category.</p>
            <button type="button" className="outline-small" onClick={()=>{setQuery('');setCategory('All');setOrder('Featured');}}>Clear filters</button>
          </div>:<div className="showcase-card-grid">
            {filtered.map(item=><article className="showcase-card" key={item.id}>
              <ConceptCover item={item}/>
              <div className="showcase-card-content">
                <p className="showcase-card-type">{item.type}</p><h3>{item.title}</h3><p>{item.description}</p>
                <div className="tag-row">{item.tags.map(tag=><span className="tag" key={tag}>{tag}</span>)}</div>
                <footer><span>{item.field}</span><span>Concept preview</span></footer>
              </div>
            </article>)}
          </div>}
        </section>
        <section className="explore-footer-note" aria-labelledby="explore-footer-title">
          <div><h2 id="explore-footer-title">Ready to show your own work?</h2>
            <p>Sign in to author privately. Public portfolios appear only when genuine publication and revocation checks pass.</p></div>
          <ActionLink href={getAuthHref()}>Create Your Portfolio</ActionLink>
        </section>
      </main>
    </div>
  </>;
}
