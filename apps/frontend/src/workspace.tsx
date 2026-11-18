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
type Gate = { status: 'checking' } | { status: 'locked'; message: string } | { status: 'unavailable'; message: string } | { status: 'verified'; owner: Owner; epoch: number; portGeneration: number };
type SnapshotState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; value: OwnerWorkspaceSnapshot };
type StartChoice = PrivateStep;
type SkipOutcome = 'confirmed' | 'unconfirmed' | 'offline' | 'completed';

/** Transport errors never establish logout; all nonverified outcomes stay private. */
function ownerVerificationUnavailable(message: string | undefined, online: boolean): boolean {
  if (!online) return true;
  if (!message) return false;
  // Only the adapter's explicit session rejection/expiry or identity mismatch
  // is presented as sign-in required. Unknown failures remain retryable.
  return message !== 'Session expired.' &&
    message !== 'The authentication session or credentials were rejected.' &&
    message !== 'User verification did not match the active session.';
}
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

/** Contextual browser titles are part of accessible navigation: a generic
 * "Workspace" label hides the task after opening another owner-only screen. */
function workspacePageTitle(path: string): string {
  if (path === '/app') return 'Workspace overview';
  if (path === '/app/onboarding') return 'Welcome';
  if (path === '/app/profile') return 'Developer profile';
  if (path === '/app/projects') return 'Private project library';
  if (projectIdFromRoute(path)) return 'Private project details';
  if (path === '/app/portfolios') return 'Private portfolio library';
  if (path === '/app/portfolios/new') return 'Choose a portfolio template';
  const portfolio = portfolioIdFromRoute(path);
  if (portfolio && path.endsWith('/preview/fullscreen')) return 'Fullscreen portfolio preview';
  if (portfolio && path.endsWith('/preview')) return 'Portfolio preview';
  const release = releaseRoute(path);
  if (release) return ({staging:'Reviewer staging',publish:'Publish preflight',releases:'Releases & rollback',share:'Sharing controls'} as const)[release.mode];
  if (portfolio) return 'Portfolio editor';
  if (isSettingsRoute(path)) {
    const titles: Record<string,string> = {
      '/app/settings':'Account settings', '/app/settings/privacy':'Privacy & sharing',
      '/app/notifications':'Notifications', '/app/settings/security':'Account security',
      '/app/trash':'Trash', '/app/export':'Export center',
      '/app/settings/account/delete':'Account exit', '/app/settings/cases':'Your cases and appeals'
    };
    return titles[path] ?? 'Account settings';
  }
  if (isOperatorRoute(path)) {
    const titles: Record<string,string> = {
      '/app/operations/users':'Admin users', '/app/operations/moderation':'Portfolio moderation',
      '/app/operations/appeals':'Appeals & case history'
    };
    return titles[path] ?? 'Restricted operations';
  }
  if (isGrowthRoute(path)) {
    const titles: Record<string,string> = {
      '/app/growth':'Personal growth', '/app/growth/activity':'Developer activity',
      '/app/growth/goals':'Your goals', '/app/growth/devscore':'Private DevScore',
      '/app/analytics':'Portfolio analytics', '/app/integrations':'Platform connections'
    };
    return titles[path] ?? 'Personal growth';
  }
  return 'Workspace';
}

function WorkspaceFrame({ owner, children, onSignOut, signOutPending, message, offline }: {
  owner: Owner; children: ReactNode; onSignOut: () => void; signOutPending: boolean; message: string; offline: boolean;
}) {
  const [theme, toggleTheme] = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const railRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const rail = railRef.current;
    const trigger = rail?.querySelector<HTMLButtonElement>('.ws-mobile-menu');
    const nav = rail?.querySelector<HTMLElement>('#ws-nav');
    if (!rail || !trigger || !nav) return;
    // Keep this media query aligned with the compact rail in workspace.css.
    const media = window.matchMedia('(max-width:720px)');
    const editorMedia = window.matchMedia('(min-width:901px)');
    const railTheme = rail.querySelector<HTMLButtonElement>('.ws-editor-theme-switch');
    const headerTheme = rail.closest('.ws-shell')?.querySelector<HTMLButtonElement>('.ws-topbar .ws-theme');
    let previousFocus: Element | null = document.activeElement;
    const rememberFocus = (event: FocusEvent) => {
      previousFocus = event.target instanceof Element ? event.target : null;
    };
    const clearPointerFocus = () => { previousFocus = null; };
    const onViewportChange = (event: MediaQueryListEvent) => {
      // CSS can hide a focused control before the media change event fires.
      const active = document.activeElement;
      const focused = active === document.body ? previousFocus : active;
      if (document.hasFocus()) {
        if (event.matches && focused && nav.contains(focused) && !nav.getClientRects().length) {
          trigger.focus();
        } else if (!event.matches && focused === trigger) {
          (nav.querySelector<HTMLAnchorElement>('[aria-current="page"]') ?? nav.querySelector<HTMLAnchorElement>('a'))?.focus();
        }
      }
      if (!event.matches) setMenuOpen(false);
    };
    const onEditorViewportChange = (event: MediaQueryListEvent) => {
      if (!railTheme || !headerTheme || !document.hasFocus()) return;
      const focused = document.activeElement === document.body ? previousFocus : document.activeElement;
      const hidden = event.matches ? headerTheme : railTheme;
      const visible = event.matches ? railTheme : headerTheme;
      if (focused === hidden && visible.getClientRects().length) visible.focus();
    };
    document.addEventListener('focusin', rememberFocus);
    document.addEventListener('pointerdown', clearPointerFocus);
    media.addEventListener('change', onViewportChange);
    editorMedia.addEventListener('change', onEditorViewportChange);
    return () => {
      document.removeEventListener('focusin', rememberFocus);
      document.removeEventListener('pointerdown', clearPointerFocus);
      media.removeEventListener('change', onViewportChange);
      editorMedia.removeEventListener('change', onEditorViewportChange);
    };
  }, []);
  const route = window.location.pathname.replace(/\/$/, '') || '/';
  const editorOnly=!!portfolioIdFromRoute(route)&&(route.endsWith('/edit')||route.endsWith('/preview'));
  const overview = route === '/app' || route === '/app/onboarding';
  return <div className={'ws-shell' + (editorOnly ? ' ws-editor-shell' : overview ? ' ws-overview-shell' : '')}>
    <a className="skip-link" href="#ws-content" onClick={event => {
      const content = document.getElementById('ws-content');
      if (content) { event.preventDefault(); content.focus(); }
    }}>Skip to workspace content</a>
    <aside ref={railRef} className="ws-rail" aria-label="Workspace sidebar" onKeyDown={event => {
      if (event.key === 'Escape' && menuOpen) {
        setMenuOpen(false);
        const trigger = event.currentTarget.querySelector<HTMLButtonElement>('.ws-mobile-menu');
        if (trigger?.getClientRects().length) {
          event.preventDefault();
          trigger.focus();
        }
      }
    }}>
      <a className="ws-brand" href="/app" aria-label="Kadmeion workspace home, Build · Showcase · Evolve">
        <BrandMark/><small>BUILD · SHOWCASE · EVOLVE</small>
      </a>
      <p className="ws-rail-label">YOUR WORKSPACE</p>
      <button type="button" className="ws-mobile-menu" aria-expanded={menuOpen} aria-controls="ws-nav"
        onClick={() => setMenuOpen(open => !open)}>Menu <Icon name="chevron" size={16}/></button>
      <nav id="ws-nav" className={menuOpen ? 'ws-nav-open' : undefined} aria-label="Workspace navigation">
        {NAV.map(item => <a key={item.href} href={item.href} aria-label={item.title}
          aria-current={route === item.href || (item.href === '/app/projects' && projectIdFromRoute(route)) || (item.href === '/app/portfolios' && route.startsWith('/app/portfolios/')) || (item.href === '/app/settings' && isSettingsRoute(route)) || (item.href === '/app/growth' && isGrowthRoute(route)) ? 'page' : undefined}>
          <Icon name={item.icon} size={18}/><span>{item.title}</span>
        </a>)}
      </nav>
      {editorOnly&&<button type="button" className="ws-editor-theme-switch" onClick={toggleTheme}
        aria-label={theme==='light'?'Switch to dark theme · Dark mode':'Switch to light theme · Light mode'}
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
        <p className="ws-network-status" data-state={offline ? 'offline' : 'online'} aria-live="polite" aria-atomic="true">
          {offline
            ? 'Browser reports offline. Cloud actions may fail; keep this page open and retry when connected.'
            : 'Browser online · cloud actions verify separately.'}
        </p>
        {message && <p role="alert" className="ws-inline-alert">{message}</p>}
        {children}
      </main>
    </div>
  </div>;
}

function preferredOnboardingChoice(steps: OwnerWorkspaceSnapshot['onboarding']): StartChoice {
  // Resume an unfinished step when the verified initial snapshot has one.
  // Do not move the user's choice automatically after a later skip receipt.
  const priority: readonly StartChoice[] = ['portfolio','profile','connections'];
  return priority.find(choice => {
    const status=steps.find(step=>step.step===choice)?.status;
    return status===undefined || status==='pending';
  }) ?? 'portfolio';
}

function Onboarding({ steps, onSkip, offline }: { steps: OwnerWorkspaceSnapshot['onboarding']; onSkip: (choice: PrivateStep) => Promise<SkipOutcome>; offline: boolean }) {
  const [choice, setChoice] = useState<StartChoice>(()=>preferredOnboardingChoice(steps));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const skipFlight = useRef(false);
  const selectedStatus = steps.find(step=>step.step===choice)?.status;
  const cards: { key: StartChoice; title: string; description: string; state: string }[] = [
    { key: 'profile', title: 'Complete your profile', description: 'Decide which identity details you want to share. Nothing is made public automatically.', state: 'Private profile editor available' },
    { key: 'portfolio', title: 'Create a portfolio', description: 'Browse the approved template concepts before starting a private portfolio.', state: 'Private portfolio chooser available' },
    { key: 'connections', title: 'Connect developer accounts', description: 'Optional. You can continue without GitHub or any external account.', state: 'Optional private handle links available' }
  ];
  function choose() {
    if (skipFlight.current) return;
    if (choice === 'portfolio') { window.location.assign('/app/portfolios/new'); return; }
    if (choice === 'profile') { window.location.assign('/app/profile'); return; }
    window.location.assign('/app/integrations');
  }
  return <section className="ws-onboarding" aria-labelledby="ws-title">
    <div className="ws-heading"><p className="ws-kicker">WELCOME / FIRST STEPS</p>
      <h1 id="ws-title">Your developer identity starts here.</h1>
      <p>Choose where to begin. Your projects and portfolio stay private unless you explicitly publish them.</p>
    </div>
    <fieldset className="ws-choice-set" disabled={saving}>
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
    <p role="status" className={note ? "ws-onboarding-note ws-inline-alert" : "ws-onboarding-note"}>{note}</p>
    <div className="ws-actions">
      <button type="button" className="ws-primary" disabled={saving} onClick={choose}>Choose next step <Icon name="arrow" size={16}/></button>
      <button type="button" className="ws-secondary" aria-disabled={saving || offline || selectedStatus === 'completed' || selectedStatus === 'skipped'} onClick={() => {
        if (skipFlight.current || selectedStatus === 'completed' || selectedStatus === 'skipped') return;
        if (offline || !navigator.onLine) return;
        skipFlight.current = true;
        const selectedStep = choice;
        setSaving(true); setNote('Saving selected step…');
        void onSkip(selectedStep).then(outcome => {
          setNote(outcome === 'confirmed' ? 'The current private account record is saved as skipped. You can return later.' :
            outcome === 'offline' ? 'Browser reports offline. No skip request was sent. You can leave without saving; the destination may not load until you reconnect.' :
            outcome === 'completed' ? 'The current private account record is completed. No skipped state was confirmed.' :
            'The server did not confirm this skipped step. Nothing was marked saved. Reopen Welcome to check the account before retrying; the write outcome may be uncertain.');
        }).catch(() => {
          setNote('The private onboarding update could not be confirmed. Reopen Welcome to check the account before retrying.');
        }).finally(() => {
          skipFlight.current = false;
          setSaving(false);
        });
      }}>{saving ? 'Saving…' : 'Skip selected step'}</button>
      <a href="/app" className="ws-secondary">{saving ? "Open workspace (save may still finish)" : "Open workspace without saving"}</a>
    </div>
    {offline && <p className="ws-footnote">Saving a skipped step requires a connection. You can leave without saving, but the workspace may not load until you reconnect and verify your owner session.</p>}
    {selectedStatus === 'completed' && <p className="ws-footnote">This step was marked completed in the loaded account records. You can open it again without changing its status.</p>}
    {selectedStatus === 'skipped' && <p className="ws-footnote">This step was already marked skipped in the loaded account records. You can open it again whenever you are ready.</p>}
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
          <li><a href="/app/integrations">Connect developer accounts <Icon name="arrow" size={15}/></a></li>
          <li><a href="/app/onboarding">Open welcome steps <Icon name="arrow" size={15}/></a></li>
        </ul>
      </nav>
    </div>
  </section>;
}

export function WorkspaceApp() {
  // Connection hints are not authorization. Share one browser subscription across
  // the gate, workspace and onboarding; reconnect never initiates verification.
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
  const [gate, setGate] = useState<Gate>({ status: 'checking' });
  const [snapshot, setSnapshot] = useState<SnapshotState>({status:'loading'});
  const [message, setMessage] = useState('');
  const [signOutPending, setSignOutPending] = useState(false);
  const [verificationAttempt, setVerificationAttempt] = useState(0);
  const authRef = useRef<SupabaseBrowserAuthPort | null>(null);
  const portGenerationRef = useRef(0);
  const retryRecordsRef = useRef<(() => void) | null>(null);
  const transitionFocusRef = useRef(false);
  function retryVerification() {
    transitionFocusRef.current = true;
    setVerificationAttempt(value=>value+1);
  }
  const route = window.location.pathname.replace(/\/$/, '') || '/';
  const projectId = projectIdFromRoute(route);
  const portfolioId = portfolioIdFromRoute(route);
  const release = releaseRoute(route);
  // Title follows access state independently of the existing provider gate.
  useEffect(() => {
    document.title = (gate.status === 'verified' ? workspacePageTitle(route) :
      gate.status === 'checking' ? 'Verifying owner session' :
      gate.status === 'unavailable' ? 'Owner verification unavailable' : 'Sign in required') + ' · Kadmeion';
  }, [route, gate.status]);
  const focusGateKey = gate.status === 'verified'
    ? `${gate.status}:${gate.owner.id}:${gate.portGeneration}:${gate.epoch}` : gate.status;
  useEffect(() => {
    const content = document.getElementById('ws-content');
    if (transitionFocusRef.current) {
      // A Retry or owner invalidation can remove the focused private control.
      // Restore only the replacement landmark, never a previous owner's control.
      // A batched verified-to-verified owner change also changes focusGateKey.
      if (document.hasFocus() && (document.activeElement === document.body || document.activeElement === content)) content?.focus();
      if (gate.status !== 'checking') transitionFocusRef.current = false;
    } else if ((gate.status === 'locked' || gate.status === 'unavailable') && document.activeElement === document.body && document.hasFocus()) {
      content?.focus();
    }
  }, [focusGateKey, gate.status]);
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let unsubscribe = () => {};
    const url = import.meta.env.VITE_SUPABASE_URL?.trim();
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
    // Never retain a verified private subtree between route/port instances.
    setGate({status:'checking'});
    setSnapshot({status:'loading'});
    setMessage('');
    setSignOutPending(false);
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
      const generation = ++portGenerationRef.current;
      authRef.current = port;
      const stillCurrent = (seq:number, epoch:number) =>
        !cancelled && authRef.current === port && portGenerationRef.current === generation &&
        attempt === seq && port.getOwnerSessionEpoch() === epoch;
      const verify = () => {
        const seq = ++attempt;
        retryRecordsRef.current = null;
        const epoch = port.getOwnerSessionEpoch();
        setGate({status:'checking'});
        setSnapshot({status:'loading'});
        // Do not consume a refresh token against a known offline transport.
        // Reopening the gate ALWAYS requires fresh provider verification.
        if (!navigator.onLine) {
          setGate({status:'unavailable',message:'Your browser reports offline. Reconnect and retry owner verification. No private records have been requested.'});
          return;
        }
        void port.getUser().then(result => {
          if (!stillCurrent(seq,epoch)) return;
          if (result.error || !result.data?.user?.id) {
            // Both branches withhold every private route and record; retryable
            // transport, rate-limit and malformed responses are not logout.
            if (ownerVerificationUnavailable(result.error?.message, navigator.onLine)) {
              setGate({status:'unavailable',message:'Owner verification could not reach the authentication service. Reconnect or retry verification; no private records are shown.'});
            } else {
              setGate({status:'locked',message:'Sign in to verify your owner session before opening this workspace.'});
            }
            return;
          }
          const owner = { id: result.data.user.id, email: result.data.user.email };
          setGate({status:'verified',owner,epoch,portGeneration:generation});
          // Every feature route owns its own verified data-loading contract.
          // Only Overview and Welcome consume the aggregate workspace records.
          if (route !== '/app' && route !== '/app/onboarding') return;
          // The owner gate stays mounted while only its overview records retry.
          // Never reuse a callback after the initiating port/owner epoch changes.
          let reading = false;
          const readRecords = async () => {
            if (reading || !stillCurrent(seq,epoch)) return;
            if (!navigator.onLine) {
              setSnapshot({status:'error',message:'Your browser reports offline. Reconnect and retry these private records; no cached records are shown.'});
              return;
            }
            reading = true;
            setSnapshot({status:'loading'});
            try {
              const read=await port.readOwnerWorkspace();
              if (!stillCurrent(seq,epoch)) return;
              if (read.error || !read.data) {
                setSnapshot({status:'error',message:'Private records could not be loaded or validated. No cached or illustrative records are shown.'});
              } else setSnapshot({status:'ready',value:read.data});
            } catch {
              if (stillCurrent(seq,epoch)) setSnapshot({status:'error',message:'Private workspace data is currently unavailable.'});
            } finally { reading = false; }
          };
          retryRecordsRef.current=()=>{void readRecords();};
          void readRecords();
        }).catch(() => {
          if (stillCurrent(seq,epoch)) setGate({status:'unavailable',message:'Owner session verification could not be completed. Retry verification or sign in again; no private records are shown.'});
        });
      };
      // Register before the first owner read. An epoch is an invalidation
      // signal only: the live provider /user response supplies owner authority.
      unsubscribe = port.subscribeOwnerSessionEpoch(() => {
        if (cancelled || authRef.current !== port) return;
        const active = document.activeElement;
        if (document.hasFocus() && active && active !== document.body && active.closest('.ws-shell, #ws-content')) {
          transitionFocusRef.current = true;
        }
        ++attempt;
        setGate({status:'checking'});
        setSnapshot({status:'loading'});
        setMessage('');
        setSignOutPending(false);
        verify();
      });
      verify();
    } catch {
      setGate({ status: 'locked', message: 'Secure browser storage or the authentication configuration is unavailable.' });
    }
    return () => { cancelled = true; ++attempt; unsubscribe(); retryRecordsRef.current = null; authRef.current = null; };
  }, [route, verificationAttempt]);
  async function skipChoice(choice: PrivateStep): Promise<SkipOutcome> {
    const port=authRef.current;
    if (!port || gate.status !== 'verified') return 'unconfirmed';
    const ownerEpoch = port.getOwnerSessionEpoch();
    const current = () => authRef.current === port && port.getOwnerSessionEpoch() === ownerEpoch;
    if (ownerEpoch !== gate.epoch || !current()) return 'unconfirmed';
    if (!navigator.onLine) return 'offline';
    // This protects a loaded completed record, not a server-side CAS guarantee.
    if (snapshot.status !== 'ready') return 'unconfirmed';
    if (snapshot.value.onboarding.some(step=>step.step===choice && step.status==='completed')) return 'completed';
    try {
      const result=await port.setPrivateOnboardingStep(choice,'skipped');
      if (!current()) return 'unconfirmed';
      if (!result.error && result.data?.step === choice && result.data.status === 'skipped') {
        setSnapshot(state=>state.status !== 'ready' ? state : {
          status:'ready',value:{...state.value,onboarding:[
            ...state.value.onboarding.filter(item=>item.step!==choice),
            {step:choice,status:'skipped' as PrivateStepStatus}
          ]}
        });
        return 'confirmed';
      }
    } catch {
      // An absent acknowledgement does not establish whether the write committed.
    }
    if (!current() || !navigator.onLine) return 'unconfirmed';
    try {
      const read=await port.readOwnerWorkspace();
      if (!current() || read.error || !read.data) return 'unconfirmed';
      const steps=read.data.onboarding;
      setSnapshot(state=>state.status !== 'ready' ? state : {
        status:'ready',value:{...state.value,onboarding:steps}
      });
      const status=steps.find(step=>step.step===choice)?.status;
      return status==='skipped' ? 'confirmed' : status==='completed' ? 'completed' : 'unconfirmed';
    } catch { return 'unconfirmed'; }
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
  if (gate.status === 'checking') return <main id="ws-content" className="ws-gate" role="main" tabIndex={-1} aria-busy="true">
    <h1>Verifying owner session…</h1>
    <p role="status">Verifying your owner session with the authentication service…</p>
    <div className="glyph-skeleton" aria-hidden="true">
      <span className="glyph-skeleton-line is-medium"/>
      <span className="glyph-skeleton-line is-short"/>
    </div>
  </main>;
  if (gate.status === 'unavailable') return <main id="ws-content" className="ws-gate" role="main" tabIndex={-1}>
    <p className="ws-kicker">OWNER VERIFICATION UNAVAILABLE</p>
    <h1>Owner verification unavailable.</h1>
    <p role="alert">{gate.message}</p>
    <p className="ws-network-status" data-state={offline ? 'offline' : 'online'} aria-live="polite" aria-atomic="true">
      {offline ? 'Browser offline · owner verification requires a connection.' : 'Browser online · retry to verify your owner session.'}
    </p>
    <div className="ws-actions"><button type="button" className="ws-primary" onClick={retryVerification}>Retry verification</button>
      <a className="ws-secondary" href="/signin">Go to sign in</a></div>
    <a href="/" className="ws-back-link">Return to the public website</a>
  </main>;
  if (gate.status === 'locked') return <main id="ws-content" className="ws-gate" role="main" tabIndex={-1}>
    <p className="ws-kicker">OWNER ACCESS REQUIRED</p>
    <h1>Sign in required.</h1>
    <p role="alert">{gate.message}</p>
    <p className="ws-network-status" data-state={offline ? 'offline' : 'online'} aria-live="polite" aria-atomic="true">
      {offline ? 'Browser offline · owner verification requires a connection.' : 'Browser online · sign in or retry verification.'}
    </p>
    <div className="ws-actions"><a className="ws-primary" href="/signin">Go to sign in <Icon name="arrow" size={16}/></a>
      <button type="button" className="ws-secondary" onClick={retryVerification}>Retry verification</button></div>
    <a href="/" className="ws-back-link">Return to the public website</a>
  </main>;
  const ownerKey = gate.owner.id + ':' + gate.portGeneration + ':' + gate.epoch;
  if (route.endsWith('/preview/fullscreen') && portfolioId && authRef.current)
    return <FullscreenPortfolioPreview key={ownerKey} port={authRef.current} id={portfolioId}/>;
  return <WorkspaceFrame key={ownerKey} owner={gate.owner} onSignOut={() => { void signOut(); }} signOutPending={signOutPending} message={message} offline={offline}>
    {projectId && authRef.current ? <PrivateProjectDetail port={authRef.current} projectId={projectId}/> :
      route === '/app/projects' && authRef.current ? <PrivateProjects port={authRef.current}/> :
      route === '/app/profile' && authRef.current ? <DeveloperProfile port={authRef.current}/> :
      release && authRef.current ? <PortfolioRelease port={authRef.current} id={release.id} mode={release.mode}/> :
      portfolioId && route.endsWith('/preview') && authRef.current
        ? <PortfolioPreviewModes port={authRef.current} id={portfolioId}/> :
      portfolioId && authRef.current ? <PortfolioEditor port={authRef.current} id={portfolioId} verifiedOwner={{id:gate.owner.id,epoch:gate.epoch}}/> :
      route === '/app/portfolios/new' && authRef.current ? <PortfolioChooser port={authRef.current}/> :
      route === '/app/portfolios' && authRef.current ? <PortfolioLibrary port={authRef.current}/> :
      isSettingsRoute(route) && authRef.current ? <OwnerSettings port={authRef.current} path={route}/> :
      isOperatorRoute(route) && authRef.current ? <OperatorConsole port={authRef.current} path={route}/> :
      isGrowthRoute(route) && authRef.current ? <GrowthApp port={authRef.current} path={route}/> :
      snapshot.status === 'loading' ? <section className="ws-loading" aria-busy="true">
      <p role="status">Loading your private workspace records…</p>
      <div aria-hidden="true">
        <div className="ws-skeleton-heading glyph-skeleton">
          <span className="glyph-skeleton-line is-title"/>
          <span className="glyph-skeleton-line"/>
          <span className="glyph-skeleton-line is-medium"/>
        </div>
        <div className="ws-skeleton-grid">
          {[0, 1, 2].map(index => <div className="glyph-skeleton" key={index}>
            <span className="glyph-skeleton-line is-label"/>
            <span className="glyph-skeleton-line"/>
            <span className="glyph-skeleton-line is-medium"/>
            <span className="glyph-skeleton-line is-short"/>
          </div>)}
        </div>
        {route === '/app' && <div className="ws-recent-grid">
          {[0,1].map(index=><div className="glyph-skeleton" key={index}>
            <span className="glyph-skeleton-line is-medium"/>
            <span className="glyph-skeleton-line"/>
            <span className="glyph-skeleton-line is-short"/>
          </div>)}
        </div>}
      </div>
    </section> : snapshot.status === 'error' ? <section className="ws-error">
      <h1>Private records unavailable.</h1><p role="alert">{snapshot.message}</p>
      <button type="button" className="ws-secondary" onClick={event=>{
        event.currentTarget.closest<HTMLElement>('main')?.focus();
        retryRecordsRef.current?.();
      }}>Retry securely</button>
    </section> : route === '/app/onboarding' ?
      <Onboarding offline={offline} steps={snapshot.value.onboarding} onSkip={skipChoice}/> :
      <Home snapshot={snapshot.value}/>}
  </WorkspaceFrame>;
}
