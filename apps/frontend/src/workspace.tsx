import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { isSafeSupabaseClientKey } from '../../../packages/contracts/src/project.ts';
import { SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
import { Icon, useTheme } from './landing.tsx';
import './workspace.css';

type Owner = { id: string; email?: string };
type Gate = { status: 'checking' } | { status: 'locked'; message: string } | { status: 'verified'; owner: Owner };
type StartChoice = 'profile' | 'portfolio' | 'connections';
const NAV = [
  { title: 'Overview', href: '/app', icon: 'layers' },
  { title: 'Welcome', href: '/app/onboarding', icon: 'target' },
  { title: 'Templates', href: '/templates', icon: 'folder' },
  { title: 'Explore', href: '/explore', icon: 'activity' }
] as const;

export function isWorkspaceRoute(path: string): boolean {
  return path === '/app' || path === '/app/onboarding';
}

function WorkspaceFrame({ owner, children, onSignOut, signOutPending, message }: {
  owner: Owner; children: ReactNode; onSignOut: () => void; signOutPending: boolean; message: string;
}) {
  const [theme, toggleTheme] = useTheme();
  const route = window.location.pathname.replace(/\/$/, '') || '/';
  return <div className="ws-shell">
    <a className="skip-link" href="#ws-content">Skip to workspace content</a>
    <aside className="ws-rail" aria-label="Workspace sidebar">
      <a className="ws-brand" href="/app" aria-label="Kadmeion workspace home">
        <strong>KADMEION</strong><small>BUILD · SHOWCASE · EVOLVE</small>
      </a>
      <p className="ws-rail-label">YOUR WORKSPACE</p>
      <nav aria-label="Workspace navigation">
        {NAV.map(item => <a key={item.href} href={item.href}
          aria-current={route === item.href ? 'page' : undefined}>
          <Icon name={item.icon} size={18}/><span>{item.title}</span>
        </a>)}
      </nav>
      <div className="ws-rail-bottom">
        <p>Private by default. No portfolio is published from this screen.</p>
        <button type="button" disabled={signOutPending} onClick={onSignOut}>
          {signOutPending ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </aside>
    <div className="ws-main-col">
      <header className="ws-topbar">
        <span className="ws-topbar-context">Personal workspace <span aria-hidden="true">/</span> {route === '/app/onboarding' ? 'Welcome' : 'Overview'}</span>
        <div className="ws-topbar-actions">
          <button type="button" className="ws-theme" onClick={toggleTheme}
            aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
            aria-pressed={theme === 'dark'}>
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={17}/>
            <span>{theme === 'light' ? 'Dark' : 'Light'}</span>
          </button>
          <span className="ws-owner" title="Verified with Supabase Auth">
            <Icon name="user" size={15}/>{owner.email || 'Authenticated owner'}
          </span>
        </div>
      </header>
      <main id="ws-content" className="ws-content">
        {message && <p role="alert" className="ws-inline-alert">{message}</p>}
        {children}
      </main>
    </div>
  </div>;
}

function Onboarding() {
  const [choice, setChoice] = useState<StartChoice>('portfolio');
  const [note, setNote] = useState('');
  const cards: { key: StartChoice; title: string; description: string; state: string }[] = [
    { key: 'profile', title: 'Complete your profile', description: 'Decide which identity details you want to share. Nothing is made public automatically.', state: 'Profile editor integration pending' },
    { key: 'portfolio', title: 'Create a portfolio', description: 'Browse the approved template concepts before starting a private portfolio.', state: 'Template explorer available' },
    { key: 'connections', title: 'Connect developer accounts', description: 'Optional. You can continue without GitHub or any external account.', state: 'Connection controls not available yet' }
  ];
  function choose() {
    if (choice === 'portfolio') { window.location.assign('/templates'); return; }
    setNote(choice === 'profile'
      ? 'The owner profile editor is not connected in this frontend build. Your choice has not been saved. You can continue in your workspace.'
      : 'Developer connections are optional and not enabled in this frontend build. No provider authorization was started.');
  }
  return <section className="ws-onboarding" aria-labelledby="ws-title">
    <div className="ws-heading"><p className="ws-kicker">WELCOME / FIRST STEPS</p>
      <h1 id="ws-title">Build your space,<br/><em>at your pace.</em></h1>
      <p>Choose where to begin. Your projects and portfolio stay private unless you explicitly publish them.</p>
    </div>
    <fieldset className="ws-choice-set">
      <legend>Choose your next step</legend>
      <div className="ws-choice-grid">
        {cards.map((card, i) => <label key={card.key} className={'ws-choice' + (choice === card.key ? ' selected' : '')}>
          <input type="radio" name="start-choice" value={card.key} checked={choice === card.key}
            onChange={() => { setChoice(card.key); setNote(''); }}/>
          <span className="ws-choice-index">0{i + 1} / START HERE</span>
          <strong>{card.title}</strong><span>{card.description}</span>
          <small>{card.state}</small>
        </label>)}
      </div>
    </fieldset>
    {note && <p role="status" className="ws-inline-alert">{note}</p>}
    <div className="ws-actions">
      <button type="button" className="ws-primary" onClick={choose}>Choose next step <Icon name="arrow" size={16}/></button>
      <a href="/app" className="ws-secondary">Skip for now — open workspace</a>
    </div>
    <p className="ws-footnote">No provider connection is required. Selection is temporary until an owner-scoped onboarding persistence contract is integrated.</p>
  </section>;
}

function Home() {
  return <section aria-labelledby="ws-title">
    <div className="ws-home-intro">
      <div className="ws-heading"><p className="ws-kicker">YOUR WORKSPACE / OVERVIEW</p>
        <h1 id="ws-title">Make room for<br/><em>what comes next.</em></h1>
        <p>One private place for portfolios, projects and your development journey. Personal records are not loaded in this initial screen.</p>
      </div>
      <a href="/templates" className="ws-primary">Continue work — explore templates <Icon name="arrow" size={16}/></a>
    </div>
    <div className="ws-section-head"><h2>Workspace areas</h2><span>Owner-only access verified</span></div>
    <div className="ws-area-grid">
      <article className="ws-area ws-area-featured">
        <div className="ws-area-icon"><Icon name="layers" size={20}/></div>
        <p className="ws-area-meta">01 / PORTFOLIO STUDIO</p>
        <h3>Shape your portfolio.</h3>
        <p>Choose a starting design. Private portfolio drafts and releases will appear here when their owner-scoped data integration is complete.</p>
        <a href="/templates">View templates <Icon name="arrow" size={15}/></a>
      </article>
      <article className="ws-area">
        <div className="ws-area-icon"><Icon name="folder" size={20}/></div>
        <p className="ws-area-meta">02 / PROJECTS</p>
        <h3>Your work, on your terms.</h3>
        <p>Private projects have not been fetched. No project count, sync result or public status is being inferred.</p>
        <p className="ws-unavailable">Owner project library integration pending</p>
      </article>
      <article className="ws-area">
        <div className="ws-area-icon"><Icon name="target" size={20}/></div>
        <p className="ws-area-meta">03 / PERSONAL GROWTH</p>
        <h3>Progress without the noise.</h3>
        <p>Growth and analytics are Phase 2 features. No scores or activity have been invented.</p>
        <p className="ws-unavailable">Planned for Phase 2</p>
      </article>
    </div>
    <div className="ws-bottom-strip">
      <div><p className="ws-kicker">START SIMPLE</p><h2>Prefer a guided start?</h2>
        <p>Return to your welcome choices. You can skip all connections and create later.</p></div>
      <a href="/app/onboarding" className="ws-secondary">Open welcome steps <Icon name="arrow" size={16}/></a>
    </div>
  </section>;
}

export function WorkspaceApp() {
  const [gate, setGate] = useState<Gate>({ status: 'checking' });
  const [message, setMessage] = useState('');
  const [signOutPending, setSignOutPending] = useState(false);
  const authRef = useRef<SupabaseBrowserAuthPort | null>(null);
  const route = window.location.pathname.replace(/\/$/, '') || '/';
  useEffect(() => {
    document.title = 'Kadmeion — ' + (route === '/app/onboarding' ? 'Welcome' : 'Workspace');
    let cancelled = false;
    const url = import.meta.env.VITE_SUPABASE_URL?.trim();
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
    if (!url || !key || !isSafeSupabaseClientKey(key)) {
      setGate({ status: 'locked', message: 'Owner authentication is not configured in this preview. No private workspace data was requested.' });
      return;
    }
    try {
      const port = new SupabaseBrowserAuthPort({
        supabaseUrl: url, publishableKey: key,
        appOrigin: window.location.origin,
        storage: window.localStorage, oauthStorage: window.sessionStorage
      });
      authRef.current = port;
      void port.getUser().then(result => {
        if (cancelled) return;
        if (result.error || !result.data?.user?.id) {
          setGate({ status: 'locked', message: 'Sign in to verify your owner session before opening this workspace.' });
          return;
        }
        setGate({ status: 'verified', owner: { id: result.data.user.id, email: result.data.user.email } });
      }).catch(() => {
        if (!cancelled) setGate({ status: 'locked', message: 'Owner session verification could not be completed. Please sign in again.' });
      });
    } catch {
      setGate({ status: 'locked', message: 'Secure browser storage or the authentication configuration is unavailable.' });
    }
    return () => { cancelled = true; authRef.current = null; };
  }, [route]);
  async function signOut() {
    const port = authRef.current;
    if (!port || signOutPending) return;
    setSignOutPending(true); setMessage('');
    try {
      const outcome = await port.signOut({ scope: 'local' });
      if (outcome.error) throw new Error('Provider sign-out was not confirmed.');
      window.location.assign('/signin');
    } catch {
      setMessage('Sign-out could not be verified. Retry while connected; do not assume other sessions were revoked.');
      setSignOutPending(false);
    }
  }
  if (gate.status === 'checking') return <main id="ws-content" className="ws-gate" role="main" aria-busy="true">
    <p role="status">Verifying your owner session with the authentication service…</p>
  </main>;
  if (gate.status === 'locked') return <main id="ws-content" className="ws-gate" role="main">
    <p className="ws-kicker">OWNER ACCESS REQUIRED</p>
    <h1>Sign in required.</h1>
    <p role="alert">{gate.message}</p>
    <div className="ws-actions"><a className="ws-primary" href="/signin">Go to sign in <Icon name="arrow" size={16}/></a>
      <button type="button" className="ws-secondary" onClick={() => window.location.reload()}>Retry verification</button></div>
    <a href="/" className="ws-back-link">Return to the public website</a>
  </main>;
  return <WorkspaceFrame owner={gate.owner} onSignOut={() => { void signOut(); }} signOutPending={signOutPending} message={message}>
    {route === '/app/onboarding' ? <Onboarding/> : <Home/>}
  </WorkspaceFrame>;
}
