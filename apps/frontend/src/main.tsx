import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrandMark, Landing } from './landing.tsx';
import { TemplateExplorer } from './templates.tsx';
import { ExplorePortfolios } from './explore.tsx';
import { AuthApp, isAuthRoute } from './auth.tsx';
import { WorkspaceApp, isWorkspaceRoute } from './workspace.tsx';
import './styles.css';

/** SYS-01: do not confirm whether a missing address identifies a private resource. */
function UnavailableRoute() {
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
  return <main id="main" className="system-status-shell">
    <section className="system-status" aria-labelledby="system-status-title" data-state={offline ? 'offline' : 'unavailable'}>
      <a href="/" aria-label="Kadmeion home" className="system-status-brand"><BrandMark/></a>
      <p className="system-status-kicker">{offline ? 'CONNECTION STATUS' : 'PAGE STATUS'}</p>
      <h1 id="system-status-title">{offline ? 'Your browser reports no connection.' : 'This page is unavailable.'}</h1>
      <p role="status" className="system-status-description">{offline
        ? 'You appear to be offline. Reconnect and retry; the browser connection indicator cannot verify whether this address exists.'
        : 'The address may be incorrect, private, or no longer accessible. For privacy, we do not confirm whether a private record exists.'}</p>
      <div className="system-status-actions">
        <button type="button" className="system-status-primary" onClick={() => window.location.reload()}>
          Retry this address
        </button>
        <a href="/" className="system-status-secondary">Return to home</a>
      </div>
      <p className="system-status-note">No private account information is shown on this page.</p>
    </section>
  </main>;
}

const mount = document.getElementById('root');
if (!mount) throw new Error('Kadmeion frontend root is missing.');
const path = window.location.pathname.replace(/\/$/, '') || '/';
const page = path === '/templates' ? <TemplateExplorer/> :
  path === '/explore' ? <ExplorePortfolios/> :
  isWorkspaceRoute(path) ? <WorkspaceApp/> :
  isAuthRoute(path) ? <AuthApp/> :
  path === '/' ? <Landing/> :
  <UnavailableRoute/>;
createRoot(mount).render(<StrictMode>{page}</StrictMode>);
