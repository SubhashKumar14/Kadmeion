import { useEffect, useRef, useState } from 'react';
import { ActionLink, Brand, Icon, useTheme, getAuthHref } from './landing.tsx';
import { normalizeHandle } from '../../../packages/contracts/src/project.ts';
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
type PublicAddressKind='identity'|'case-study'|'portfolio';
export function knownPublicAddress(kind:PublicAddressKind,rawHandle:string,rawSlug:string,normalize:(s:string)=>string):string|null {
  if(typeof rawHandle!=='string'||typeof rawSlug!=='string'||/[\x00-\x1f\x7f]/.test(rawHandle+rawSlug))return null;
  const handle=rawHandle.trim();
  if(!/^[A-Za-z][A-Za-z0-9_]{2,29}$/.test(handle))return null;
  let canonicalHandle:string;
  try{canonicalHandle=normalize(handle);}catch{return null;}
  if(!/^[a-z][a-z0-9_]{2,29}$/.test(canonicalHandle))return null;
  if(kind==='identity')return rawSlug.trim()===''?'/u/'+canonicalHandle:null;
  const slug=rawSlug.trim();
  if(!/^(?=.{3,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))return null;
  if(kind==='case-study')return '/u/'+canonicalHandle+'/projects/'+slug;
  if(kind==='portfolio')return '/'+canonicalHandle+'/'+slug;
  return null;
}

function publicShareTarget(path:string,origin:string):URL|null {
  if(typeof path!=='string'||typeof origin!=='string'||/[\x00-\x20\x7f\\?#]/.test(path))return null;
  const slug='[a-z0-9]+(?:-[a-z0-9]+)*';
  const handle='[a-z][a-z0-9_]{2,29}';
  const route=new RegExp('^/(?:u/'+handle+'(?:/projects/('+slug+'))?|'+handle+'/('+slug+'))$').exec(path);
  const page=route?.[1]??route?.[2];
  if(!route||(page&&(page.length<3||page.length>64)))return null;
  try{
    const site=new URL(origin);
    if(site.origin!==origin||site.username||site.password||
      !(site.protocol==='https:'||(site.protocol==='http:'&&['localhost','127.0.0.1'].includes(site.hostname))))return null;
    const url=new URL(path,site);
    return url.origin===origin&&url.pathname===path&&!url.search&&!url.hash?url:null;
  }catch{return null;}
}
export function canonicalShareAddress(response:Response,path:string,origin:string):string|null {
  const target=publicShareTarget(path,origin);
  if(!target||response.status!==200||response.redirected||response.url!==target.href||response.body!==null)return null;
  const headers=response.headers;
  const robots=(headers.get('x-robots-tag')??'').toLowerCase().split(',').map(x=>x.trim());
  const cache=(headers.get('cache-control')??'').toLowerCase().split(',').map(x=>x.trim());
  if(robots.length!==2||!robots.includes('index')||!robots.includes('follow')||
    cache.length!==2||!cache.includes('private')||!cache.includes('no-store')||
    !/^text\/html(?:\s*;|$)/i.test(headers.get('content-type')??'')||
    !/^[a-f0-9]{64}$/.test(headers.get('x-kadmeion-served-sha256')??'')||headers.has('location'))return null;
  const match=/^<([^<>\s]+)>;\s*rel="canonical"$/i.exec(headers.get('link')??'');
  if(!match)return null;
  // The same-origin canonical must match the requested address byte-for-byte.
  // Do not follow redirects, infer other hosts, or accept reported aliases.
  const canonical=match[1];
  return canonical===path||canonical===target.href?target.href:null;
}
export async function observeCanonicalShare(path:string,origin:string,signal:AbortSignal,
  http:typeof fetch=fetch,timeoutMs=8000):Promise<string|null>{
  const target=publicShareTarget(path,origin);
  if(!target||signal.aborted||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>8000)return null;
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  let stop:()=>void=()=>{};
  const deadline=new Promise<null>(resolve=>{
    stop=()=>{controller.abort();resolve(null);};
    signal.addEventListener('abort',stop,{once:true});
    timer=setTimeout(stop,timeoutMs);
  });
  const read=async()=>{
    try{
      const result=await http(target.href,{method:'HEAD',cache:'no-store',credentials:'omit',redirect:'error',
        headers:{Accept:'text/html'},signal:controller.signal});
      if(result.body!==null){void result.body?.cancel().catch(()=>{});return null;}
      return controller.signal.aborted?null:canonicalShareAddress(result,path,origin);
    }catch{return null;}
  };
  try{
    const result=await Promise.race([read(),deadline]);
    return signal.aborted||controller.signal.aborted?null:result;
  }finally{
    clearTimeout(timer);signal.removeEventListener('abort',stop);
  }
}

/** Open a known address, not an account search or a discovery listing.
 * The server, not the address builder, decides whether anything is public. */
function KnownPublicAddress(){
  const [kind,setKind]=useState<PublicAddressKind>('identity');
  const [handle,setHandle]=useState('');
  const [slug,setSlug]=useState('');
  const [error,setError]=useState('');
  const [observation,setObservation]=useState<{path:string;url:string;expiresAt:number}|null>(null);
  const [checking,setChecking]=useState(false);
  const [shareNotice,setShareNotice]=useState('');
  const [sharing,setSharing]=useState(false);
  const generation=useRef(0);
  const activeCheck=useRef<AbortController|null>(null);
  const sharingPending=useRef(false);
  const manualAddress=useRef<HTMLInputElement>(null);
  const resetShare=()=>{
    generation.current++;activeCheck.current?.abort();activeCheck.current=null;
    setChecking(false);setObservation(null);setShareNotice('');setSharing(false);
  };
  useEffect(()=>()=>{generation.current++;activeCheck.current?.abort();},[]);
  useEffect(()=>{
    if(!observation)return;
    const timer=setTimeout(()=>{
      generation.current++;setObservation(null);setSharing(false);
      setShareNotice('The observation expired. Check the address again before sharing.');
    },Math.max(0,observation.expiresAt-performance.now()));
    return ()=>clearTimeout(timer);
  },[observation]);
  async function checkShare(){
    resetShare();
    const path=knownPublicAddress(kind,handle,slug,normalizeHandle);
    if(!path){setError('Enter a valid handle and exact page slug first.');return;}
    setError('');
    const attempt=generation.current,controller=new AbortController();
    activeCheck.current=controller;setChecking(true);
    const url=await observeCanonicalShare(path,window.location.origin,controller.signal);
    if(generation.current!==attempt||controller.signal.aborted)return;
    activeCheck.current=null;setChecking(false);
    if(!url){setShareNotice('A shareable canonical page could not be confirmed. The address may be private, withdrawn or unavailable.');return;}
    setObservation({path,url,expiresAt:performance.now()+30000});
    setShareNotice('Server confirmed this canonical address. Sharing remains available for 30 seconds; publication can change later.');
  }
  async function shareAddress(mode:'copy'|'native'){
    if(sharingPending.current||!observation||
      observation.path!==knownPublicAddress(kind,handle,slug,normalizeHandle))return;
    if(performance.now()>=observation.expiresAt){resetShare();setShareNotice('Check the address again before sharing.');return;}
    const attempt=generation.current;
    sharingPending.current=true;setSharing(true);
    try{
      if(mode==='native'&&typeof navigator.share==='function')await navigator.share({url:observation.url});
      else if(mode==='copy'&&navigator.clipboard?.writeText)await navigator.clipboard.writeText(observation.url);
      else throw Error('Use manual copy');
      if(generation.current===attempt)setShareNotice(mode==='copy'?'Canonical address copied.':'Share action completed.');
    }catch(error){
      if(generation.current===attempt){
        if(mode==='native'&&error instanceof Error&&error.name==='AbortError')setShareNotice('Sharing cancelled.');
        else{setShareNotice('Use the selectable canonical address to copy manually.');manualAddress.current?.focus();manualAddress.current?.select();}
      }
    }finally{
      sharingPending.current=false;if(generation.current===attempt)setSharing(false);
    }
  }
  return <section className="explore-browse" aria-labelledby="known-public-title">
    <h2 id="known-public-title">Open a known public address</h2>
    <p id="known-public-help" className="explore-disclosure">Enter an address shared with you. This does not search accounts, reveal private records or certify publication. The destination server checks access.</p>
    <form aria-describedby="known-public-help" onSubmit={event=>{
      event.preventDefault();
      const address=knownPublicAddress(kind,handle,slug,normalizeHandle);
      if(address===null){setError('Enter a valid handle and, when required, the exact lowercase slug. Reserved names and URLs are not accepted.');return;}
      window.location.assign(address);
    }}>
      <div className="explore-filters">
        <div><label htmlFor="known-public-handle">Developer handle</label>
          <div className="template-query"><input id="known-public-handle" value={handle}
            required maxLength={64} autoComplete="off" autoCapitalize="none" spellCheck={false}
            onChange={event=>{setHandle(event.target.value);setError('');resetShare();}} placeholder="developer_handle"/></div></div>
        <div><label htmlFor="known-public-kind">Address type</label>
          <select id="known-public-kind" value={kind} onChange={event=>{setKind(event.target.value as PublicAddressKind);setSlug('');setError('');resetShare();}}>
            <option value="identity">Developer identity</option><option value="case-study">Project case study</option><option value="portfolio">Portfolio</option>
          </select></div>
        {kind!=='identity'&&<div><label htmlFor="known-public-slug">Exact page slug</label>
          <div className="template-query"><input id="known-public-slug" value={slug} required maxLength={64}
            autoComplete="off" autoCapitalize="none" spellCheck={false}
            onChange={event=>{setSlug(event.target.value);setError('');resetShare();}} placeholder="project-slug"/></div></div>}
      </div>
      {error&&<p role="alert">{error}</p>}
      <div className="hero-actions"><button type="submit" className="outline-small">Open public address</button>
        <button type="button" className="outline-small" disabled={checking||sharing} onClick={()=>void checkShare()}>{checking?'Checking…':'Check canonical share link'}</button></div>
      <p role="status" aria-live="polite">{shareNotice}</p>
      {observation&&<div aria-label="Server-confirmed canonical share address">
        <label htmlFor="known-canonical-address">Canonical address</label>
        <div className="template-query"><input id="known-canonical-address" ref={manualAddress} readOnly value={observation.url} onFocus={event=>event.currentTarget.select()}/></div>
        <div className="hero-actions"><button type="button" className="outline-small" disabled={sharing} onClick={()=>void shareAddress('copy')}>Copy link</button>
          {typeof navigator.share==='function'&&<button type="button" className="outline-small" disabled={sharing} onClick={()=>void shareAddress('native')}>Share</button>}</div>
      </div>}
    </form>
  </section>;
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
        <KnownPublicAddress/>
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
