import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { isSafeSupabaseClientKey } from '../../../packages/contracts/src/project.ts';
import { SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
import type { OwnerWorkspaceSnapshot, PrivateStep, PrivateStepStatus } from '../../auth-web/src/supabase-auth-port.ts';
import { BrandMark, Icon, useTheme } from './landing.tsx';
import { PrivateProjectDetail, PrivateProjects } from './projects.tsx';
import { DeveloperProfile } from './profile.tsx';
import { FullscreenPortfolioPreview, PortfolioChooser, PortfolioEditor, PortfolioLibrary, PortfolioPreviewModes, portfolioIdFromRoute } from './portfolios.tsx';
import { PortfolioRelease, releaseRoute } from './release.tsx';
import { OwnerSettings, isSettingsRoute } from './settings.tsx';
import { OperatorConsole, isOperatorRoute } from './operations.tsx';
import { GrowthApp, isGrowthRoute } from './growth.tsx';
import './workspace.css';

type Owner = { id: string; email?: string };
type Gate = { status: 'checking' } | { status: 'locked'; message: string } | { status: 'verified'; owner: Owner };
type SnapshotState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; value: OwnerWorkspaceSnapshot };
type StartChoice = PrivateStep;
const NAV = [
  { title: 'Overview', href: '/app', icon: 'layers' },
  { title: 'Welcome', href: '/app/onboarding', icon: 'target' },
  { title: 'Portfolio Studio', href: '/app/portfolios', icon: 'layers' },
  { title: 'Profile', href: '/app/profile', icon: 'user' },
  { title: 'Projects', href: '/app/projects', icon: 'folder' },
  { title: 'Growth', href: '/app/growth', icon: 'activity' },
  { title: 'Settings', href: '/app/settings', icon: 'user' },
  { title: 'Templates', href: '/templates', icon: 'folder' },
  { title: 'Explore', href: '/explore', icon: 'activity' }
] as const;

function projectIdFromRoute(path: string): string | undefined {
  return /^\/app\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(path)?.[1]?.toLowerCase();
}

export function isWorkspaceRoute(path: string): boolean {
  return path === '/app' || path === '/app/onboarding' || path === '/app/projects' || path === '/app/profile' || path === '/app/portfolios' || path === '/app/portfolios/new' || isSettingsRoute(path) || isOperatorRoute(path) || isGrowthRoute(path) || !!releaseRoute(path) || !!portfolioIdFromRoute(path) || !!projectIdFromRoute(path);
}

function WorkspaceFrame({ owner, children, onSignOut, signOutPending, message }: {
  owner: Owner; children: ReactNode; onSignOut: () => void; signOutPending: boolean; message: string;
}) {
  const [theme, toggleTheme] = useTheme();
  const route = window.location.pathname.replace(/\/$/, '') || '/';
  const editorOnly=!!portfolioIdFromRoute(route)&&(route.endsWith('/edit')||route.endsWith('/preview'));
  const overview = route === '/app' || route === '/app/onboarding';
  return <div className={'ws-shell' + (editorOnly ? ' ws-editor-shell' : overview ? ' ws-overview-shell' : '')}>
    <a className="skip-link" href="#ws-content">Skip to workspace content</a>
    <aside className="ws-rail" aria-label="Workspace sidebar">
      <a className="ws-brand" href="/app" aria-label="Kadmeion workspace home">
        <BrandMark/><small>BUILD · SHOWCASE · EVOLVE</small>
      </a>
      <p className="ws-rail-label">YOUR WORKSPACE</p>
      <nav aria-label="Workspace navigation">
        {NAV.map(item => <a key={item.href} href={item.href} aria-label={item.title}
          aria-current={route === item.href || (item.href === '/app/projects' && projectIdFromRoute(route)) || (item.href === '/app/portfolios' && route.startsWith('/app/portfolios/')) || (item.href === '/app/settings' && isSettingsRoute(route)) ? 'page' : undefined}>
          <Icon name={item.icon} size={18}/><span>{item.title}</span>
        </a>)}
      </nav>
      {editorOnly&&<button type="button" className="ws-editor-theme-switch" onClick={toggleTheme}
        aria-label={theme==='light'?'Switch to dark theme':'Switch to light theme'}
        aria-pressed={theme==='dark'}>
        <Icon name={theme==='light'?'moon':'sun'} size={18}/>
        <span>{theme==='light'?'Dark':'Light'} mode</span>
      </button>}
      <div className="ws-rail-bottom">
        <p>Private by default. No portfolio is published from this screen.</p>
        <button type="button" disabled={signOutPending} onClick={onSignOut}>
          {signOutPending ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </aside>
    <div className="ws-main-col">
      <header className="ws-topbar">
        <span className="ws-topbar-context">Personal workspace <span aria-hidden="true">/</span> {route === '/app/onboarding' ? 'Welcome' : route.startsWith('/app/projects') ? 'Projects' : route === '/app/profile' ? 'Developer profile' : route.startsWith('/app/portfolios') ? 'Portfolio Studio' : isSettingsRoute(route) ? 'Settings' : isOperatorRoute(route) ? 'Restricted operations' : isGrowthRoute(route) ? 'Growth' : 'Overview'}</span>
        <div className="ws-topbar-actions">
          <button type="button" className="ws-theme" onClick={toggleTheme}
            aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
            aria-pressed={theme === 'dark'}>
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={17}/>
            <span>{theme === 'light' ? 'Dark' : 'Light'}</span>
          </button>
          <span className="ws-owner" title="Verified with Supabase Auth">
            <Icon name="user" size={15}/><span>{owner.email || 'Authenticated owner'}</span>
          </span>
        </div>
      </header>
      <main id="ws-content" className="ws-content" tabIndex={-1}>
        {message && <p role="alert" className="ws-inline-alert">{message}</p>}
        {children}
      </main>
    </div>
  </div>;
}

function Onboarding({ steps, onSkip }: { steps: OwnerWorkspaceSnapshot['onboarding']; onSkip: (choice: PrivateStep) => Promise<boolean> }) {
  const [choice, setChoice] = useState<StartChoice>('portfolio');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const cards: { key: StartChoice; title: string; description: string; state: string }[] = [
    { key: 'profile', title: 'Complete your profile', description: 'Decide which identity details you want to share. Nothing is made public automatically.', state: 'Private profile editor available' },
    { key: 'portfolio', title: 'Create a portfolio', description: 'Browse the approved template concepts before starting a private portfolio.', state: 'Private portfolio chooser available' },
    { key: 'connections', title: 'Connect developer accounts', description: 'Optional. You can continue without GitHub or any external account.', state: 'Optional private handle links available' }
  ];
  function choose() {
    if (choice === 'portfolio') { window.location.assign('/app/portfolios/new'); return; }
    if (choice === 'profile') { window.location.assign('/app/profile'); return; }
    window.location.assign('/app/integrations');
  }
  return <section className="ws-onboarding" aria-labelledby="ws-title">
    <div className="ws-heading"><p className="ws-kicker">WELCOME / FIRST STEPS</p>
      <h1 id="ws-title">Your developer identity starts here.</h1>
      <p>Choose where to begin. Your projects and portfolio stay private unless you explicitly publish them.</p>
    </div>
    <fieldset className="ws-choice-set">
      <legend>Choose your next step</legend>
      <div className="ws-choice-grid">
        {cards.map(card => <label key={card.key} className={'ws-choice' + (choice === card.key ? ' selected' : '')}>
          <input type="radio" name="start-choice" value={card.key} checked={choice === card.key}
            onChange={() => { setChoice(card.key); setNote(''); }}/>
          <span className="ws-area-icon"><Icon name={card.key === 'profile' ? 'user' : card.key === 'portfolio' ? 'layers' : 'target'} size={20}/></span>
          <strong>{card.title}</strong><span>{card.description}</span>
          <small>{steps.find(saved=>saved.step===card.key)?.status === 'skipped' ? 'Skipped in your private account' : steps.find(saved=>saved.step===card.key)?.status === 'completed' ? 'Completed in your private account' : card.state}</small>
        </label>)}
      </div>
    </fieldset>
    {note && <p role="status" className="ws-inline-alert">{note}</p>}
    <div className="ws-actions">
      <button type="button" className="ws-primary" onClick={choose}>Choose next step <Icon name="arrow" size={16}/></button>
      <button type="button" className="ws-secondary" disabled={saving} onClick={() => {
        setSaving(true); setNote('');
        void onSkip(choice).then(saved => {
          setNote(saved ? 'This step was saved as skipped in your private account. You can return later.' :
            'The server did not confirm this skipped step. Nothing was marked saved.');
        }).finally(()=>setSaving(false));
      }}>{saving ? 'Saving…' : 'Skip selected step'}</button>
      <a href="/app" className="ws-secondary">Open workspace without saving</a>
    </div>
    <p className="ws-footnote">You can get started without connecting a developer account.</p>
  </section>;
}

function Home({ snapshot }: { snapshot: OwnerWorkspaceSnapshot }) {
  return <section className="ws-home" aria-labelledby="ws-title">
    <div className="ws-home-intro">
      <div className="ws-heading"><p className="ws-kicker">YOUR WORKSPACE / OVERVIEW</p>
        <h1 id="ws-title">A place for what you build next.</h1>
        <p>One private place for portfolios, projects and your development journey. {snapshot.profile?.displayName ? 'Welcome back, ' + snapshot.profile.displayName + '.' : 'Your verified private workspace is ready.'}</p>
      </div>
      <a href="/app/portfolios/new" className="ws-primary">Create portfolio <Icon name="arrow" size={16}/></a>
    </div>
    <div className="ws-section-head"><h2>Workspace areas</h2><span>Owner-only access verified</span></div>
    <div className="ws-area-grid">
      <article className="ws-area ws-area-featured">
        <div className="ws-area-icon"><Icon name="layers" size={20}/></div>
        <p className="ws-area-meta">01 / PORTFOLIO STUDIO</p>
        <h3>Shape your portfolio.</h3>
        <p>{snapshot.portfolios.length ? 'Your latest private portfolio drafts are shown below.' :
          'No portfolios yet. Start a private draft when you’re ready.'}</p>
        <a href="/app/portfolios">Open portfolio studio <Icon name="arrow" size={15}/></a>
      </article>
      <article className="ws-area">
        <div className="ws-area-icon"><Icon name="folder" size={20}/></div>
        <p className="ws-area-meta">02 / PROJECTS</p>
        <h3>Your projects live here.</h3>
        <p>{snapshot.projects.length ? 'Your latest private projects are shown below.' :
          'Add a project to keep its details in one place.'}</p>
        <a href="/app/projects">Open private project library <Icon name="arrow" size={15}/></a>
      </article>
      <article className="ws-area">
        <div className="ws-area-icon"><Icon name="target" size={20}/></div>
        <p className="ws-area-meta">03 / PERSONAL GROWTH</p>
        <h3>Build today. Grow next.</h3>
        <p>Manage private goals and see which growth features are available.</p>
        <a href="/app/growth">Open Growth <Icon name="arrow" size={15}/></a>
      </article>
    </div>
    <div className="ws-recent-grid">
      <section aria-labelledby="ws-recent-title">
        <h2 id="ws-recent-title">Recent work</h2>
        <ul>
          {snapshot.portfolios.map(item=><li key={'portfolio-' + item.id}>
            <a href={'/app/portfolios/' + item.id + '/edit'}>{item.title}</a>
            <span>Draft · revision {item.revision}</span></li>)}
          {snapshot.projects.map(item=><li key={'project-' + item.id}>
            <a href={'/app/projects/' + item.id}>{item.title}</a><span>Private project</span></li>)}
        </ul>
        {!snapshot.portfolios.length && !snapshot.projects.length &&
          <p>Nothing to show yet. Your recent private projects and portfolios will appear here.</p>}
      </section>
      <nav aria-labelledby="ws-next-title">
        <h2 id="ws-next-title">Next steps</h2>
        <ul>
          <li><a href="/app/profile">Complete your profile <Icon name="arrow" size={15}/></a></li>
          <li><a href="/app/projects">Add a project <Icon name="arrow" size={15}/></a></li>
          <li><a href="/app/onboarding">Open welcome steps <Icon name="arrow" size={15}/></a></li>
        </ul>
      </nav>
    </div>
  </section>;
}

export function WorkspaceApp() {
  const [gate, setGate] = useState<Gate>({ status: 'checking' });
  const [snapshot, setSnapshot] = useState<SnapshotState>({status:'loading'});
  const [message, setMessage] = useState('');
  const [signOutPending, setSignOutPending] = useState(false);
  const authRef = useRef<SupabaseBrowserAuthPort | null>(null);
  const route = window.location.pathname.replace(/\/$/, '') || '/';
  const projectId = projectIdFromRoute(route);
  const portfolioId = portfolioIdFromRoute(route);
  const release = releaseRoute(route);
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
        if (route.startsWith('/app/projects') || route === '/app/profile' || route.startsWith('/app/portfolios') || isSettingsRoute(route) || isOperatorRoute(route) || isGrowthRoute(route)) return;
        void port.readOwnerWorkspace().then(read=>{
          if (cancelled) return;
          if (read.error || !read.data) {
            setSnapshot({status:'error',message:'Private records could not be loaded or validated. No cached or illustrative records are shown.'});
          } else setSnapshot({status:'ready',value:read.data});
        }).catch(()=>{
          if (!cancelled) setSnapshot({status:'error',message:'Private workspace data is currently unavailable.'});
        });
      }).catch(() => {
        if (!cancelled) setGate({ status: 'locked', message: 'Owner session verification could not be completed. Please sign in again.' });
      });
    } catch {
      setGate({ status: 'locked', message: 'Secure browser storage or the authentication configuration is unavailable.' });
    }
    return () => { cancelled = true; authRef.current = null; };
  }, [route]);
  async function skipChoice(choice: PrivateStep): Promise<boolean> {
    const port=authRef.current;
    if (!port) return false;
    const result=await port.setPrivateOnboardingStep(choice,'skipped');
    if (result.error || !result.data || result.data.step !== choice || result.data.status !== 'skipped')
      return false;
    setSnapshot(state=>state.status !== 'ready' ? state : {
      status:'ready',value:{...state.value,onboarding:[
        ...state.value.onboarding.filter(item=>item.step!==choice),
        {step:choice,status:'skipped' as PrivateStepStatus}
      ]}
    });
    return true;
  }
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
  if (route.endsWith('/preview/fullscreen') && portfolioId && authRef.current)
    return <FullscreenPortfolioPreview port={authRef.current} id={portfolioId}/>;
  return <WorkspaceFrame owner={gate.owner} onSignOut={() => { void signOut(); }} signOutPending={signOutPending} message={message}>
    {projectId && authRef.current ? <PrivateProjectDetail port={authRef.current} projectId={projectId}/> :
      route === '/app/projects' && authRef.current ? <PrivateProjects port={authRef.current}/> :
      route === '/app/profile' && authRef.current ? <DeveloperProfile port={authRef.current}/> :
      release && authRef.current ? <PortfolioRelease port={authRef.current} id={release.id} mode={release.mode}/> :
      portfolioId && route.endsWith('/preview') && authRef.current
        ? <PortfolioPreviewModes port={authRef.current} id={portfolioId}/> :
      portfolioId && authRef.current ? <PortfolioEditor port={authRef.current} id={portfolioId}/> :
      route === '/app/portfolios/new' && authRef.current ? <PortfolioChooser port={authRef.current}/> :
      route === '/app/portfolios' && authRef.current ? <PortfolioLibrary port={authRef.current}/> :
      isSettingsRoute(route) && authRef.current ? <OwnerSettings port={authRef.current} path={route}/> :
      isOperatorRoute(route) && authRef.current ? <OperatorConsole port={authRef.current} path={route}/> :
      isGrowthRoute(route) && authRef.current ? <GrowthApp port={authRef.current} path={route}/> :
      snapshot.status === 'loading' ? <section className="ws-loading" aria-busy="true">
      <p role="status">Loading your private workspace records…</p>
      <div aria-hidden="true">
        <div className="ws-skeleton-heading">◩ ◿ ◬ ◜ ◩ ◿ ◬</div>
        <div className="ws-skeleton-grid">
          {[0, 1, 2].map(index => <span key={index}>◩ ◿ ◬<br/>◜ ◩ ◿ ◬ ◜</span>)}
        </div>
      </div>
    </section> : snapshot.status === 'error' ? <section className="ws-error">
      <h1>Private records unavailable.</h1><p role="alert">{snapshot.message}</p>
      <button type="button" className="ws-secondary" onClick={()=>window.location.reload()}>Retry securely</button>
    </section> : route === '/app/onboarding' ?
      <Onboarding steps={snapshot.value.onboarding} onSkip={skipChoice}/> :
      <Home snapshot={snapshot.value}/>}
  </WorkspaceFrame>;
}
