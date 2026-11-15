import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Landing } from './landing.tsx';
import { TemplateExplorer } from './templates.tsx';
import { ExplorePortfolios } from './explore.tsx';
import { AuthApp, isAuthRoute } from './auth.tsx';
import './styles.css';

const mount = document.getElementById('root');
if (!mount) throw new Error('Kadmeion frontend root is missing.');
const path = window.location.pathname.replace(/\/$/, '') || '/';
const page = path === '/templates' ? <TemplateExplorer/> :
  path === '/explore' ? <ExplorePortfolios/> :
  isAuthRoute(path) ? <AuthApp/> :
  path === '/' ? <Landing/> :
  <main className="route-unavailable" id="main" role="main">
    <h1>Not available in this frontend preview.</h1>
    <p>This isolated build does not serve authentication or private workspace routes.
       Start the existing authenticated Kadmeion application separately; no sign-in or publication was attempted.</p>
    <a href="/">Return to the public landing page</a>
  </main>;
createRoot(mount).render(<StrictMode>{page}</StrictMode>);
