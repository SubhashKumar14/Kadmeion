import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrandMark, Landing, useTheme } from './landing.tsx';
import { TemplateExplorer } from './templates.tsx';
import { ExplorePortfolios } from './explore.tsx';
import { AuthApp, isAuthRoute } from './auth.tsx';
import './styles.css';


type VisitorSurface='reviewer'|'identity'|'case-study'|'portfolio';
const visitorHandles=/^[a-z][a-z0-9_]{2,29}$/;
const visitorSlugs=/^(?=.{3,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const reservedVisitorHandles=new Set(['admin','api','app','auth','dashboard','edit',
  'explore','help','login','logout','new','profile','projects','r','register',
  'settings','signin','signup','support','templates','u','workspace','status']);
function visitorSurface(path:string):VisitorSurface|null {
  const reviewer=/^\/r\/([0-9a-f]{8}-[0-9a-f-]{27,40}\.[0-9a-f]{64})$/i.exec(path);
  if(reviewer)return 'reviewer';
  const study=/^\/u\/([^/]+)\/projects\/([^/]+)$/.exec(path);
  if(study&&visitorHandles.test(study[1]??'')&&visitorSlugs.test(study[2]??''))
    return 'case-study';
  const identity=/^\/u\/([^/]+)$/.exec(path);
  if(identity&&visitorHandles.test(identity[1]??''))return 'identity';
  const portfolio=/^\/([^/]+)\/([^/]+)$/.exec(path);
  if(portfolio&&visitorHandles.test(portfolio[1]??'')&&
    !reservedVisitorHandles.has(portfolio[1]??'')&&
    visitorSlugs.test(portfolio[2]??''))return 'portfolio';
  return null;
}
/** These are no-data, no-token-echo states only, NEVER a delivery API.
 * Host GET/HEAD and CDN revocation remain server-only authorization gates. */
function VisitorDeliveryGate({surface}:{surface:VisitorSurface}) {
  // Even disabled visitor routes must respect the saved Kadmeion runtime theme.
  // This is a Kadmeion status surface, never an author-published portfolio theme.
  useTheme();
  const type=surface==='reviewer'?'REVIEWER ACCESS':'PUBLIC DELIVERY';
  const headline=surface==='reviewer'?'Reviewer preview unavailable.':
    surface==='identity'?'Developer identity unavailable.':
    surface==='case-study'?'Project story unavailable.':'Portfolio page unavailable.';
  useEffect(()=>{
    document.title='Content unavailable · Kadmeion';
    const existing=document.querySelector('meta[name="robots"]');
    const created=!existing;
    const tag=existing??document.createElement('meta');
    if(created){tag.setAttribute('name','robots');document.head.append(tag);}
    const previous=tag.getAttribute('content');
    tag.setAttribute('content','noindex, nofollow, noarchive');
    return ()=>{
      if(created)tag.remove();
      else if(previous===null)tag.removeAttribute('content');
      else tag.setAttribute('content',previous);
    };
  },[]);
  return <main className="system-status-shell" id="main">
    <section className="system-status visitor-delivery-gate" aria-labelledby="visitor-title">
      <a href="/" aria-label="Kadmeion home" className="system-status-brand"><BrandMark/></a>
      <p className="system-status-kicker">{type}</p>
      <h1 id="visitor-title">{headline}</h1>
      <p className="system-status-description" role="status">
        {surface==='reviewer'
          ? 'This route cannot verify a reviewer token here. A separate server must validate the exact grant, expiry and revocation before any staged content can be served.'
          : 'This address may be unpublished, withdrawn, private or unavailable. Only an independently verified public delivery service may return consented author content.'}
      </p>
      <p className="system-status-disclosure">For privacy, this page does not confirm whether any account, project, review grant or portfolio exists.</p>
      <div className="system-status-actions">
        <button type="button" className="system-status-primary" onClick={()=>window.location.reload()}>
          Retry safely</button>
        <a className="system-status-secondary" href="/explore">Explore the public gallery</a>
        <a className="system-status-secondary" href="/">Kadmeion home</a>
      </div>
      <p className="system-status-note">No user data, private source, access token or unverified public URL is displayed.</p>
    </section>
  </main>;
}

/** SYS-01: a privacy-preserving editorial error screen. The same generic
 * response hides whether a private, removed or mistyped resource exists.
 * Offline is a different browser-reported state, never a false 404 claim. */
function UnavailableRoute() {
  useTheme();
  const [offline, setOffline] = useState(() => !navigator.onLine);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    // A SPA fallback is not an authoritative HTTP 404; keep it nonindexable
    // and give users an accurate, state-specific page title.
    const previousTitle=document.title;
    document.title=offline ? 'Offline · Kadmeion' : 'Page unavailable · Kadmeion';
    const existing=document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const tag=existing??document.createElement('meta');
    const previous=tag.getAttribute('content');
    if(!existing){tag.name='robots';document.head.append(tag);}
    tag.setAttribute('content','noindex, nofollow, noarchive');
    return () => {
      document.title=previousTitle;
      if(!existing)tag.remove();
      else if(previous===null)tag.removeAttribute('content');
      else tag.setAttribute('content',previous);
    };
  }, [offline]);
  return <main id="main" className="system-status-shell system-status-editorial-shell">
    <section className="system-status system-status-editorial"
      aria-labelledby="system-status-title" data-state={offline ? 'offline' : 'unavailable'}>
      <header className="sys51-header">
        <a href="/" aria-label="Kadmeion home, Developer Identity & Portfolio Builder" className="sys51-brand"><BrandMark/>
          <small>DEVELOPER IDENTITY &amp; PORTFOLIO BUILDER</small>
        </a>
        <span className="sys51-privacy-label">PUBLIC ROUTE · CONTENT WITHHELD</span>
      </header>
      <div className="sys51-body">
        <div className="sys51-copy">
          <p className="system-status-kicker">SYSTEM STATUS · SAFE RECOVERY</p>
          <div className="sys51-code" aria-hidden="true">{offline?'OFFLINE':'404'}</div>
          <h1 id="system-status-title">{offline ? 'Your browser reports no connection.' : 'This page is unavailable.'}</h1>
          <p role="status" className="system-status-description">{offline
            ? 'Reconnect to retry this address. This page will stay open while you are offline.'
            : 'The address may be incorrect, private, or no longer accessible. For privacy, we do not confirm whether a private record exists.'}</p>
          <div className="system-status-actions">
            <a href="/" className="system-status-primary">Return to home</a>
            <button type="button" className="system-status-secondary" aria-disabled={offline}
              onClick={() => {if (navigator.onLine) window.location.reload();}}>
              Retry this address
            </button>
          </div>
          {!offline && <p className="sys51-disclosure">
            Looking for your own work? <a href="/signin">Sign in to review your workspace</a>.
          </p>}
        </div>
        <div className="sys51-art" aria-hidden="true">
          <span className="sys51-art-label">NO CONTENT DISCLOSED</span>
          <span className="sys51-art-orbit"/>
          <span className="sys51-art-wave"/>
          <span className="sys51-art-diamond"/>
          <span className="sys51-art-fold"/>
          <span className="sys51-art-tagline">Build · Showcase · Evolve</span>
        </div>
      </div>
      <footer className="sys51-footer">This is a privacy-preserving public status page.
        It does not verify whether an account, project or private link exists.</footer>
    </section>
  </main>;
}

const mount = document.getElementById('root');
if (!mount) throw new Error('Kadmeion frontend root is missing.');
const WorkspaceRoute=lazy(async()=>{
  const {WorkspaceApp,isWorkspaceRoute}=await import('./workspace.tsx');
  return {default:function WorkspaceEntry({path}:{path:string}) {
    return isWorkspaceRoute(path) ? <WorkspaceApp/> : <UnavailableRoute/>;
  }};
});
const path = window.location.pathname.replace(/\/$/, '') || '/';
if (path === '/templates') document.title = 'Portfolio templates · Kadmeion';
if (path === '/explore') document.title = 'Explore portfolios · Kadmeion';
const page = path === '/templates' ? <TemplateExplorer/> :
  path === '/explore' ? <ExplorePortfolios/> :
  (path === '/app' || path.startsWith('/app/')) ?
    <Suspense fallback={<main id="main"><p role="status">Loading workspace…</p></main>}>
      <WorkspaceRoute path={path}/>
    </Suspense> :
  isAuthRoute(path) ? <AuthApp/> :
  path === '/' ? <Landing/> :
  visitorSurface(path) ? <VisitorDeliveryGate surface={visitorSurface(path)!}/> :
  <UnavailableRoute/>;
createRoot(mount).render(<StrictMode>{page}</StrictMode>);
