import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  canAutoAdvance, DEMO_VIEWS, invertTheme, nextPreviewIndex,
  readTheme, writeTheme, type DemoView, type Theme
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
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{iconPaths[name]}</svg>;
}
function Brand({ tagline = true }: { tagline?: boolean }) {
  // Primary vector logo/outlined wordmark master still requires original export.
  // Text-only fallback is intentional: no fabricated logo geometry.
  return <a className="brand" href="/" aria-label="Kadmeion home">
    <span className="brand-name">KADMEION</span>
    {tagline && <span className="brand-subtitle">DEVELOPER IDENTITY PLATFORM</span>}
  </a>;
}
function getTheme(): Theme {
  try { return readTheme(window.localStorage); } catch { return 'light'; }
}
function initialReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return true; }
}
function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(getTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#FAFAF9' : '#0B1A21');
    try { writeTheme(window.localStorage, theme); } catch { /* volatile theme */ }
  }, [theme]);
  return [theme, () => setTheme(current => invertTheme(current))];
}
const projectCards = [
  { name: 'BidHub', type: 'Micro-freelance platform', summary: 'Project discovery and collaborative bidding.', tags: ['Product', 'Web'], symbol: 'B', tone: 'blue' },
  { name: 'StreamFlix', type: 'Movie discovery experience', summary: 'Personalized viewing and recommendations.', tags: ['Media', 'Web'], symbol: '▶', tone: 'coal' },
  { name: 'Aegis AI', type: 'Applied AI concept', summary: 'AI-assisted analysis and developer tooling.', tags: ['AI / ML', 'Tools'], symbol: 'A', tone: 'teal' },
  { name: 'Kadmeion', type: 'Developer identity platform', summary: 'The portfolio builder under development.', tags: ['Identity', 'Portfolio'], symbol: 'K', tone: 'copper' }
] as const;
function DemoWorkspace({ view }: { view: DemoView }) {
  const viewHeading = view === 'Workspace' ? 'A place for what you build next.'
    : view === 'Portfolio Studio' ? 'Shape your portfolio your way.'
    : 'See your growth, privately.';
  return <div className="demo-window" aria-label={view + ' illustrative interface concept'} role="img">
    <div className="demo-rail">
      <div className="demo-rail-title">KADMEION</div>
      <p>YOUR WORKSPACE</p>
      <div className="demo-rail-item active"><Icon name="folder" size={13} /> Workspace</div>
      <div className="demo-rail-item"><Icon name="layers" size={13}/> Studio</div>
      <div className="demo-rail-item"><Icon name="code" size={13}/> Projects</div>
      <div className="demo-rail-item"><Icon name="activity" size={13}/> Growth</div>
    </div>
    <div className="demo-stage">
      <div className="demo-crumb">Workspace <span>›</span> {view} <span className="demo-dots">◌ &nbsp; ◌</span></div>
      <div className="demo-stage-body">
        <div className="demo-stage-head">{viewHeading}</div>
        <div className="demo-metrics">
          <div><Icon name="code" size={16}/><span>Projects</span></div>
          <div><Icon name="layers" size={16}/><span>Portfolios</span></div>
          <div><Icon name="activity" size={16}/><span>Progress</span></div>
        </div>
        <div className="demo-chart">
          <span>{view === 'Workspace' ? 'Your work, in one place' : view === 'Portfolio Studio' ? 'Build and preview' : 'Goals and activity'}</span>
          <svg aria-hidden="true" viewBox="0 0 310 54" preserveAspectRatio="none"><path d="M0 48 C32 40 45 44 70 34 S112 41 140 25 S183 36 212 17 S257 27 282 12 S299 18 310 7" fill="none" stroke="#427CB8" strokeWidth="2"/></svg>
        </div>
        <span className="demo-truth">Illustrative interface · no account data</span>
      </div>
    </div>
  </div>;
}
function ProductDemo() {
  const [index,setIndex] = useState(0);
  const [reduced,setReduced] = useState(initialReducedMotion);
  const [paused,setPaused] = useState(false);
  const [interacting,setInteracting] = useState(false);
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
    if (!canAutoAdvance(reduced,paused,interacting,visible)) return;
    const timer=window.setInterval(() => setIndex(current=>nextPreviewIndex(current,1)),7000);
    return () => window.clearInterval(timer);
  },[reduced,paused,interacting,visible]);
  const change=(step:-1|1) => setIndex(current=>nextPreviewIndex(current,step));
  return <div className="hero-demo" onMouseEnter={()=>setInteracting(true)} onMouseLeave={()=>setInteracting(false)}
    onFocusCapture={()=>setInteracting(true)}
    onBlurCapture={event=>{ if(!event.currentTarget.contains(event.relatedTarget as Node|null))setInteracting(false); }}>
    <DemoWorkspace view={DEMO_VIEWS[index] ?? DEMO_VIEWS[0]} />
    <div className="demo-controls">
      <button type="button" aria-label="Previous product example" onClick={()=>change(-1)}>‹</button>
      <span aria-label={'Illustrative product view '+(index+1)+' of 3'}>{index+1} / {DEMO_VIEWS.length}</span>
      <button type="button" aria-label="Next product example" onClick={()=>change(1)}>›</button>
      <button className="demo-pause" type="button" aria-label={paused?'Resume automatic preview':'Pause automatic preview'}
        aria-pressed={paused} onClick={()=>setPaused(v=>!v)}><Icon name={paused?'play':'pause'} size={13}/></button>
    </div>
  </div>;
}
function ActionLink({children,href,kind='primary'}:{children:ReactNode,href:string,kind?:'primary'|'outline'}) {
  return <a className={'action-link '+kind} href={href}>{children}<Icon name="arrow" size={17}/></a>;
}
const faqs=[
  ['What is Kadmeion?', 'Kadmeion is a developer identity and portfolio creation platform. Build a profile, curate your work and prepare independently themed portfolios.'],
  ['Is my work private by default?', 'Yes. Draft profiles, projects and portfolio work remain private until you explicitly choose what to share. A preview is not a public release.'],
  ['Can I connect existing developer accounts?', 'Optional connections are planned and require provider permissions. An unconnected platform is not evidence of verified activity or achievements.']
] as const;
export function Landing() {
  const [theme,toggleTheme]=useTheme();
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <div className="site-shell">
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
          <a className="header-signin" href="/signin"><Icon name="user" size={15}/> Sign in</a>
        </div>
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-decoration" aria-hidden="true"><span/><span/><span/></div>
          <div className="hero-copy">
            <div className="eyebrow"><span/> Build · Showcase · Evolve</div>
            <h1 id="hero-title">Your Developer Identity,<br/><em>Crafted with Purpose.</em></h1>
            <p>Create a distinct portfolio, showcase real work, and build your developer presence with intention.</p>
            <div className="hero-actions">
              <ActionLink href="/signin">Create Your Portfolio</ActionLink>
              <ActionLink href="#showcase" kind="outline">Explore Portfolios</ActionLink>
            </div>
          </div>
          <ProductDemo />
        </section>

        <section className="problem-solution" aria-label="Why Kadmeion">
          <div className="statement">
            <span className="statement-icon"><Icon name="target" size={24}/></span>
            <div><h2>The Challenge</h2><p>Your work lives across platforms, making it harder to present a complete, professional identity.</p></div>
          </div>
          <div className="statement">
            <span className="statement-icon warm"><Icon name="layers" size={24}/></span>
            <div><h2>The Kadmeion Solution</h2><p>One considered place for projects, skills and the portfolio experiences you choose to share.</p></div>
          </div>
        </section>

        <section className="showcase section" id="showcase" aria-labelledby="showcase-title">
          <div className="section-heading"><div><div className="eyebrow"><span/> Showcase</div><h2 id="showcase-title">Make your work the story.</h2></div>
            <a href="#project-examples" className="inline-link">Explore the showcase <Icon name="arrow" size={16}/></a></div>
          <p className="example-disclosure">Illustrative project cards from the approved visual concept; not a directory of verified public portfolios.</p>
          <div className="project-grid" id="project-examples">
            {projectCards.map(card=><article className="project-card" key={card.name}>
              <span className={'project-icon '+card.tone} aria-hidden="true">{card.symbol}</span>
              <div className="project-copy">
                <h3>{card.name}</h3><p className="project-type">{card.type}</p>
                <p>{card.summary}</p>
                <div className="tag-row">{card.tags.map(tag=><span className="tag" key={tag}>{tag}</span>)}</div>
              </div>
            </article>)}
          </div>
        </section>

        <section className="template-strip" id="templates" aria-labelledby="templates-heading">
          <span className="strip-icon"><Icon name="layers" size={24}/></span>
          <div className="template-copy"><h2 id="templates-heading">Start Faster with Templates.</h2>
            <p>Curated portfolio compositions, with space for your own voice and work.</p></div>
          <div className="template-thumbnails" aria-label="Illustrative template arrangements">
            <span className="mini-template one" aria-hidden="true"/><span className="mini-template two" aria-hidden="true"/><span className="mini-template three" aria-hidden="true"/>
          </div>
          <a className="outline-small" href="/signin">Create your portfolio <Icon name="arrow" size={16}/></a>
        </section>

        <section className="steps section" aria-labelledby="steps-heading">
          <div><div className="eyebrow"><span/> How it works</div><h2 id="steps-heading">Your Portfolio in Three Simple Steps.</h2></div>
          <div className="step-grid">
            <div className="step"><span className="step-icon"><Icon name="user" size={23}/></span><p><strong>1. Set Up</strong><span>Create your private developer profile.</span></p></div>
            <div className="step"><span className="step-icon warm"><Icon name="layers" size={23}/></span><p><strong>2. Build</strong><span>Add real projects and shape your portfolio.</span></p></div>
            <div className="step"><span className="step-icon"><Icon name="rocket" size={23}/></span><p><strong>3. Share & Grow</strong><span>Publish only after the release is verified.</span></p></div>
          </div>
        </section>

        <section className="connections-strip" aria-label="Developer activity connections">
          <span className="strip-icon"><Icon name="activity" size={23}/></span>
          <div><h2>Bring Your Developer Activity Together.</h2><p>Optional platform connections are planned; no account sync is implied here.</p></div>
          <div className="platform-tags" aria-label="Possible future integrations"><span>GitHub</span><span>LeetCode</span><span>Codeforces</span><span>HackerRank</span><span>Kaggle</span><span>Hugging Face</span></div>
        </section>

        <section className="faq section" aria-labelledby="faq-heading">
          <div><div className="eyebrow"><span/> FAQ</div><h2 id="faq-heading">Common Questions.</h2></div>
          <div className="faq-items">{faqs.map(([question,answer])=>
            <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}
          </div>
        </section>
        <section className="closing-cta" aria-labelledby="closing-heading">
          <div><h2 id="closing-heading">Build Your Developer Identity Today.</h2>
            <p>Create a portfolio that represents your work, your growth, and what you build next.</p></div>
          <ActionLink href="/signin" kind="outline">Create Your Portfolio</ActionLink>
          <div className="closing-pattern" aria-hidden="true"/>
        </section>
      </main>
      <footer className="site-footer"><span>© Kadmeion · Build · Showcase · Evolve</span><span>Noncommercial capstone · Private by default</span></footer>
    </div>
  </>;
}
