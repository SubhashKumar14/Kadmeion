import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  canAutoAdvance, DEMO_VIEWS, invertTheme, nextPreviewIndex,
  readTheme, writeTheme, authHref, type DemoView, type Theme
} from './behavior.ts';

type IconName = 'arrow' | 'user' | 'layers' | 'folder' | 'target' | 'code' | 'sun' | 'moon' | 'chevron' | 'rocket' | 'activity' | 'pause' | 'play' | 'spark';
const iconPaths: Record<IconName, ReactNode> = {
  arrow: <><path d="M5 12h14m-6-6 6 6-6 6"/></>,
  user: <><circle cx="12" cy="7" r="3.5"/><path d="M5 21v-2c0-4 3-6 7-6s7 2 7 6v2"/></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5m-18 5 9 5 9-5"/></>,
  folder: <><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/></>,
  target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
  code: <><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 20"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M19.8 4.2l-1.4 1.4M5.6 18.4l-1.4 1.4"/></>,
  moon: <><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/></>,
  chevron: <><path d="m7 10 5 5 5-5"/></>,
  rocket: <><path d="M13 5c3-3 7-3 8-3 0 1 0 5-3 8l-4 4-5-5 4-4ZM9 9l-4 1-3 4 5 1m7-1 1 5 4-3 1-4M9 15l-2 2m-3 3 3-3"/></>,
  activity: <><path d="M3 16h4l3-9 4 12 3-7h4"/></>,
  pause: <><path d="M8 5v14m8-14v14"/></>,
  play: <><path d="m8 5 11 7-11 7V5Z"/></>,
  spark: <><path d="m12 2 2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2L12 2Z"/></>
};
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{iconPaths[name]}</svg>;
}
export function BrandMark({ stacked = false, label }: { stacked?: boolean; label?: string }) {
  return <span className={stacked ? 'brand-mark brand-mark-stacked' : 'brand-mark'}
    role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <img className="brand-symbol" src="/brand/kadmeion-mark.svg" alt="" width="110" height="110"/>
    <span className="brand-letters"/>
  </span>;
}

export function Brand({ tagline = true }: { tagline?: boolean }) {
  return <a className="brand" href="/" aria-label={tagline?'Kadmeion home, Developer Identity Platform':'Kadmeion home'}>
    <BrandMark/>
    {tagline && <span className="brand-subtitle">DEVELOPER IDENTITY PLATFORM</span>}
  </a>;
}
export function getAuthHref(route: '/signin' | '/signup' = '/signin'): string {
  return authHref(import.meta.env.VITE_KADMEION_AUTH_ORIGIN, route);
}
function getTheme(): Theme {
  try { return readTheme(window.localStorage); } catch { return 'light'; }
}
function initialReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return true; }
}
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(getTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#FAFAF9' : '#0B1A21');
    try { writeTheme(window.localStorage, theme); } catch { /* volatile theme */ }
  }, [theme]);
  return [theme, () => setTheme(current => invertTheme(current))];
}
const projectExamples = [
  { name: 'BidHub', summary: 'Project discovery and competitive bidding.', href: 'https://github.com/SubhashKumar14/Bid-Hub' },
  { name: 'StreamFlix', summary: 'Movie discovery and recommendations.', href: 'https://github.com/thandriyalahimaja/Stream-Flix' }
] as const;
function DemoWorkspace({ view }: { view: DemoView }) {
  return <div className="demo-window" data-view={view} aria-label={view + ' illustrative interface concept'} role="img">
    <div className="demo-crumb"><Icon name={view === 'Workspace' ? 'folder' : 'layers'} size={16}/><strong>{view}</strong></div>
    {view === 'Workspace' ? <div className="demo-overview">
      <p className="demo-stage-head">Your private workspace</p>
      <div className="demo-rows"><span><Icon name="user"/> Profile</span><span><Icon name="folder"/> Projects</span><span><Icon name="layers"/> Portfolio drafts</span></div>
    </div> : <div className="demo-document">
      {view === 'Portfolio Studio' && <div className="demo-rail">
        <strong>Structure</strong><span className="active">Introduction</span><span>Projects</span><span>Contact</span>
      </div>}
      <div className="demo-canvas">
        <div className="demo-canvas-copy">
          <p className="demo-canvas-label">Developer portfolio</p>
          <p className="demo-stage-head">Good work deserves a story.</p>
          <p className="demo-canvas-note">A selection of projects and what I learned building them.</p>
        </div>
        <div className="demo-art" aria-hidden="true"><span/></div>
      </div>
    </div>}
  </div>;
}
function ProductDemo() {
  const [index,setIndex] = useState(0);
  const [reduced,setReduced] = useState(initialReducedMotion);
  const [paused,setPaused] = useState(false);
  const [hovered,setHovered] = useState(false);
  const [focused,setFocused] = useState(false);
  const [visible,setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => setReduced(media.matches);
    media.addEventListener('change', onMotion);
    return () => media.removeEventListener('change', onMotion);
  },[]);
  useEffect(() => {
    const onVisible = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  },[]);
  useEffect(() => {
    if (!canAutoAdvance(reduced,paused,hovered || focused,visible)) return;
    const timer=window.setInterval(() => setIndex(current=>nextPreviewIndex(current,1)),7000);
    return () => window.clearInterval(timer);
  },[reduced,paused,hovered,focused,visible]);
  const change=(step:-1|1) => setIndex(current=>nextPreviewIndex(current,step));
  return <figure className="hero-demo" onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}
    onFocusCapture={()=>setFocused(true)}
    onBlurCapture={event=>{ if(!event.currentTarget.contains(event.relatedTarget as Node|null))setFocused(false); }}>
    <DemoWorkspace view={DEMO_VIEWS[index] ?? DEMO_VIEWS[0]} />
    <figcaption className="demo-caption">Illustrative product preview
    <div className="demo-controls" role="group" aria-label="Product preview controls">
      <button type="button" aria-label="Previous product example" onClick={()=>change(-1)}>‹</button>
      <span>{index+1} / {DEMO_VIEWS.length}</span>
      <button type="button" aria-label="Next product example" onClick={()=>change(1)}>›</button>
      <button className="demo-pause" type="button" aria-label={paused?'Resume automatic preview':'Pause automatic preview'}
        aria-pressed={paused} onClick={()=>setPaused(v=>!v)}><Icon name={paused?'play':'pause'} size={13}/></button>
    </div>
    </figcaption>
  </figure>;
}
export function ActionLink({children,href,kind='primary'}:{children:ReactNode,href:string,kind?:'primary'|'outline'}) {
  return <a className={'action-link '+kind} href={href}>{children}<Icon name="arrow" size={17}/></a>;
}
const faqs=[
  ['What is Kadmeion?', 'Kadmeion is a developer identity and portfolio creation platform. Build a profile, curate your work and prepare independently themed portfolios.'],
  ['Is my work private by default?', 'Yes. Draft profiles, projects and portfolio work remain private until you explicitly choose what to share. A preview is not a public release.'],
  ['Can I connect existing developer accounts?', 'You can save links to your developer profiles. Automatic activity sync is currently unavailable.']
] as const;
export function Landing() {
  const [theme,toggleTheme]=useTheme();
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <div className="site-shell landing-shell">
      <header className="site-header">
        <Brand/>
        <nav aria-label="Primary navigation" className="site-navigation">
          <a href="/" aria-current="page">Home</a>
          <a href="#showcase">Showcase</a>
          <a href="#templates">Templates</a>
          <a href="https://github.com/SubhashKumar14/Kadmeion/tree/main/project-docs" target="_blank" rel="noopener noreferrer">Docs <span aria-hidden="true">↗</span></a>
        </nav>
        <div className="header-actions">
          <button type="button" className="theme-button" onClick={toggleTheme}
            aria-label={theme==='light'?'Switch to dark theme':'Switch to light theme'} aria-pressed={theme==='dark'}>
            <Icon name={theme==='light'?'moon':'sun'} size={16}/><span>{theme==='light'?'Dark':'Light'}</span>
          </button>
          <a className="header-signin" href={getAuthHref()}><Icon name="user" size={15}/> Sign in</a>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-decoration" aria-hidden="true"><span/></div>
          <div className="hero-copy">
            <div className="eyebrow"><span/> Build · Showcase · Evolve</div>
            <h1 id="hero-title">Your Developer Identity,<br/><em>On your terms.</em></h1>
            <p>Build a portfolio that shows what you made, how you worked, and what you want to build next.</p>
            <div className="hero-actions">
              <ActionLink href={getAuthHref()}>Create Your Portfolio</ActionLink>
              <ActionLink href="/explore" kind="outline">Explore Portfolios</ActionLink>
            </div>
          </div>
          <ProductDemo />
        </section>

        <section className="showcase section" id="showcase" aria-labelledby="showcase-title">
          <div className="section-heading">
            <h2 id="showcase-title">Real Work from Developers.</h2>
            <a href="/explore" className="inline-link">Explore the showcase <Icon name="arrow" size={16}/></a>
          </div>
          <p className="example-disclosure">Independent projects with public source code.</p>
          <div className="project-grid">
            {projectExamples.map(project=><article className="project-card" key={project.name}>
              <span className="statement-icon"><Icon name="code" size={22}/></span>
              <div className="project-copy">
                <h3><a href={project.href}>{project.name} <span aria-hidden="true">↗</span></a></h3>
                <p>{project.summary}</p>
              </div>
            </article>)}
          </div>
        </section>

        <section className="landing-problem section" aria-labelledby="problem-title">
          <div><h2 id="problem-title">The Challenge</h2>
            <p className="landing-lead">A repository shows the code. Where do you tell the rest of the story?</p></div>
          <p>Your decisions, responsibilities, demos, and lessons learned can end up across several platforms. Give visitors one place to understand the work and see what you contributed.</p>
        </section>

        <section className="landing-value section" aria-labelledby="value-title">
          <div><h2 id="value-title">The Kadmeion Solution</h2>
            <p className="landing-lead">Give your work a place of its own.</p>
            <p>Bring your projects, skills, and case studies together. Choose a template, edit privately, and decide what to share.</p>
            <a id="templates" className="inline-link" href="/templates">Browse templates <Icon name="arrow" size={16}/></a>
          </div>
          <div className="template-thumbnails" aria-hidden="true">
            <span className="mini-template demo-template-front"><strong>Selected work</strong><span/></span>
            <span className="mini-template demo-template-back"><strong>Portfolio</strong><span/></span>
          </div>
        </section>

        <section className="steps section" aria-labelledby="steps-heading">
          <h2 id="steps-heading">Your Portfolio in Three Simple Steps.</h2>
          <ol className="step-grid">
            <li className="step"><Icon name="user" size={23}/><div><h3>Set up your profile</h3><p>Write a short introduction and choose which details you want to share.</p></div></li>
            <li className="step"><Icon name="layers" size={23}/><div><h3>Build your portfolio</h3><p>Add projects, choose a layout, and preview your draft as you go.</p></div></li>
            <li className="step"><Icon name="rocket" size={23}/><div><h3>Decide what to share</h3><p>Review your work and choose what to publish when it is ready.</p></div></li>
          </ol>
        </section>

        <section className="faq section" aria-labelledby="faq-heading">
          <h2 id="faq-heading">Common Questions.</h2>
          <div className="faq-items">{faqs.map(([question,answer])=>
            <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}
          </div>
        </section>
        <section className="closing-cta" aria-labelledby="closing-heading">
          <h2 id="closing-heading">Build Your Developer Identity Today.</h2>
          <ActionLink href={getAuthHref()} kind="outline">Create Your Portfolio</ActionLink>
          <div className="closing-pattern" aria-hidden="true"/>
        </section>
      </main>
      <footer className="site-footer"><span>© Kadmeion · Build · Showcase · Evolve</span><span>Noncommercial capstone · Private by default</span></footer>
    </div>
  </>;
}
