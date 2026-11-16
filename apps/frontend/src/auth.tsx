import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { AuthService } from '../../../packages/contracts/src/auth-service.ts';
import { isSafeSupabaseClientKey } from '../../../packages/contracts/src/project.ts';
import { parseAuthRedirect } from '../../auth-web/src/auth-redirect.ts';
import { SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
import { cleanHandleInput, checkHandleInput, validatePasswordPair } from '../../auth-web/src/form-helpers.ts';
import { BrandMark, Icon, useTheme } from './landing.tsx';
import './auth.css';

type Mode = 'signin' | 'signup' | 'forgot-password' | 'set-password' | 'outcome' | 'callback' | 'workspace';
type Outcome = 'email-requested' | 'registered' | 'password-updated' | 'session-verified';
type AuthState = { auth: SupabaseBrowserAuthPort; service: AuthService; allowGoogle: boolean; emailAvailable: boolean };
const authRoutes = new Set(['/signin','/signup','/forgot-password','/reset-password','/set-password','/auth/callback','/workspace','/auth/outcome','/auth/recovery-status']);
export function isAuthRoute(path: string): boolean { return authRoutes.has(path); }
function initialMode(path: string): Mode {
  if (path==='/signup') return 'signup';
  if (path==='/forgot-password') return 'forgot-password';
  if (path==='/set-password'||path==='/reset-password') return 'set-password';
  if (path==='/auth/callback') return 'callback';
  if (path==='/workspace') return 'workspace';
  if (path==='/auth/outcome'||path==='/auth/recovery-status') return 'outcome';
  return 'signin';
}
function createAuth(): { value: AuthState | null; error: string } {
  const supabaseUrl=import.meta.env.VITE_SUPABASE_URL?.trim();
  const publishableKey=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl || !publishableKey)
    return { value:null, error:'Supabase authentication is not configured for this preview. Use a locally configured, verified environment.' };
  if (!isSafeSupabaseClientKey(publishableKey))
    return { value:null, error:'A privileged or invalid Supabase API key cannot be used in this public browser.' };
  try {
    const storage=window.localStorage;
    const oauthStorage=window.sessionStorage;
    const auth=new SupabaseBrowserAuthPort({
      supabaseUrl,publishableKey,appOrigin:window.location.origin,storage,oauthStorage
    });
    const allowGoogle=import.meta.env.VITE_KADMEION_GOOGLE_OAUTH_ENABLED==='true';
    const emailAvailable=import.meta.env.VITE_KADMEION_EMAIL_DELIVERY_VERIFIED==='true';
    return {
      value:{auth,service:new AuthService(auth,{
        siteOrigin:window.location.origin,googleOAuthConfigured:allowGoogle,emailDeliveryVerified:emailAvailable
      }),allowGoogle,emailAvailable},error:''
    };
  } catch {
    return {value:null,error:'Authentication initialization was rejected. Verify browser storage and public Supabase configuration.'};
  }
}
function readError(error:unknown): string {
  // Provider errors are normalized by AuthService/port and must not expose tokens.
  return error instanceof Error ? error.message : 'Authentication could not be completed.';
}
const authStories: Partial<Record<Mode, readonly [string, string, string]>> = {
  signup: ['A place to build,', 'showcase, and grow.', 'Create your Kadmeion account to build portfolios, organize projects, and grow your developer identity on your terms.'],
  'forgot-password': ['A clear way back', 'to your work.', 'Your projects and portfolio drafts stay connected to your account.'],
  'set-password': ['Keep your identity', 'under your control.', 'Your account protects work-in-progress portfolios, private projects, and your decisions about what goes public.'],
  outcome: ['Your work stays', 'yours.', 'Your private projects and portfolio drafts stay protected during account recovery.']
};

function AuthBrand({ mode }: { mode: Mode }) {
  const story = authStories[mode];
  return <aside className="auth-brand-panel" aria-label="Kadmeion identity">
    <div className="auth-brand-rings" aria-hidden="true"><span/><span/><span/></div>
    {story ? <div className="auth-brand-story">
      <div className="auth-story-signature">
        <BrandMark label="Kadmeion"/>
        <span className="auth-brand-role">DEVELOPER IDENTITY PLATFORM</span>
      </div>
      <div className="auth-story-message">
        <p className="auth-story-tagline">BUILD · SHOWCASE · EVOLVE</p>
        <p className="auth-story-title">{story[0]} <em>{story[1]}</em></p>
        <p className="auth-story-copy">{story[2]}</p>
      </div>
    </div> : <div className="auth-brand-content">
      <div className="auth-brand-signature">
        <BrandMark stacked label="Kadmeion"/>
        <span className="auth-brand-role">DEVELOPER IDENTITY PLATFORM</span>
      </div>
      <span className="auth-brand-rule" aria-hidden="true"/>
      <p className="auth-brand-tagline"><em>Build</em> · <em>Showcase</em> · <em>Evolve</em></p>
    </div>}
  </aside>;
}
function AuthInput({id,label,children}:{id:string;label:string;children:ReactNode}){
  return <div className="auth-field"><label htmlFor={id}>{label}</label>{children}</div>;
}
function AuthPassword({id,label,value,setValue,autoComplete}:{id:string;label:string;value:string;setValue:(next:string)=>void;autoComplete:'current-password'|'new-password'}){
  const [visible,setVisible]=useState(false);
  return <AuthInput id={id} label={label}>
    <div className="auth-password-wrap">
      <input id={id} required minLength={autoComplete==='new-password'?8:undefined} maxLength={128}
        type={visible?'text':'password'} autoComplete={autoComplete}
        value={value} onChange={event=>setValue(event.target.value)} />
      <button type="button" onClick={()=>setVisible(v=>!v)} aria-label={visible?'Hide '+label.toLowerCase():'Show '+label.toLowerCase()}
        aria-pressed={visible} className="auth-show-password">{visible?'Hide':'Show'}</button>
    </div>
  </AuthInput>;
}
export function AuthApp(){
  const [theme,toggleTheme]=useTheme();
  const [mode,setMode]=useState<Mode>(()=>initialMode(window.location.pathname));
  const [config]=useState(createAuth);
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [displayName,setDisplayName]=useState('');
  const [handle,setHandle]=useState('');
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [pending,setPending]=useState(false);
  const [outcome,setOutcome]=useState<Outcome | null>(null);
  const [identity,setIdentity]=useState<string|null>(null);
  const heading=useRef<HTMLHeadingElement>(null);
  const enteredCallback = useRef(window.location.pathname === '/auth/callback');
  const redirectStarted=useRef(false);
  const stillMounted=useRef(true);
  const auth=config.value;
  function setAuthMode(next:Mode,route?:string,clearSecrets=true){
    if(pending)return;
    if(clearSecrets){setPassword('');setConfirm('');}
    setError('');setNotice('');setOutcome(null);setIdentity(null);
    setMode(next);
    const target=route??('/'+next);
    history.replaceState(null,'',target);
    window.requestAnimationFrame(()=>heading.current?.focus());
  }
  function swapMode(next:'signin'|'signup'){
    // Do not clear passwords while reversing the in-place auth panel.
    setAuthMode(next,next==='signin'?'/signin':'/signup',false);
  }
  function result(kind:Outcome,message:string){
    setOutcome(kind);setNotice(message);
    setPassword('');setConfirm('');setError('');
    setMode('outcome');history.replaceState(null,'','/auth/outcome');
  }
  async function submit(event:FormEvent<HTMLFormElement>,action:()=>Promise<void>){
    event.preventDefault();
    if(pending)return;
    setPending(true);setError('');setNotice('');
    try{await action();}catch(reason){setError(readError(reason));}
    finally{setPending(false);}
  }
  async function signedIn(userEmail:string|null,kind:Outcome='session-verified'){
    setIdentity(userEmail);
    result(kind,'An authenticated session was independently verified. Open your private workspace to continue.');
  }
  useEffect(()=>{
    document.title='Kadmeion — '+({
      signin:'Sign in',signup:'Create account','forgot-password':'Password recovery','set-password':'Choose a password',
      callback:'Checking your link',workspace:'Private workspace',outcome:'Account status'
    }[mode]);
  },[mode]);
  useEffect(()=>{
    // StrictMode re-runs effects in development. A single-use OAuth or email
    // grant must never be exchanged twice. Let the initiating request finish
    // after the simulated cleanup and re-setup, but not after real unmount.
    stillMounted.current=true;
    if(redirectStarted.current)return ()=>{stillMounted.current=false;};
    redirectStarted.current=true;
    const redirect=parseAuthRedirect(location.href);
    const privateRoute=location.pathname;
    if(redirect.kind==='none' && privateRoute!=='/workspace' && privateRoute!=='/auth/callback') {
      if (privateRoute==='/reset-password'||privateRoute==='/set-password'){
        setMode('outcome');setError('This link does not contain an active recovery grant. Request another link.');
      }
      return;
    }
    // Scrub credentials BEFORE any async request or render-side navigation.
    if(redirect.kind!=='none')history.replaceState(null,'',privateRoute);
    if(!auth){
      setMode('outcome');setError(config.error);return;
    }
    void (async()=>{
      setMode('callback');
      try{
        if(redirect.kind==='error')throw new Error(redirect.message);
        if(redirect.kind==='oauth_code'){
          const who=await auth.service.finishOAuth(redirect.code);
          if(stillMounted.current)await signedIn(who.email??null);return;
        }
        if(redirect.kind==='tokens' || redirect.kind==='token_hash'){
          const kind=redirect.kind==='tokens'
            ? await auth.auth.acceptTokens(redirect.parameters)
            : await auth.auth.verifyTokenHash(redirect.tokenHash,redirect.type);
          if(!stillMounted.current)return;
          if(kind==='recovery'||kind==='invite'){
            setMode('set-password');
            setNotice('Your one-time link was verified. Choose a new password.');
            return;
          }
          const verified=await auth.auth.getUser();
          if(verified.error||!verified.data?.user)throw new Error('Account confirmation session could not be verified.');
          if(stillMounted.current)await signedIn(verified.data.user.email??null);
          return;
        }
        if(privateRoute==='/workspace'){
          const verified=await auth.auth.getUser();
          if(verified.error||!verified.data?.user)throw new Error('Sign in to access your private workspace.');
          if(stillMounted.current)await signedIn(verified.data.user.email??null);
          return;
        }
        throw new Error('This callback does not contain a supported one-time verification link.');
      }catch(reason){
        if(stillMounted.current){setMode('outcome');setError(readError(reason));setNotice('');}
      }
    })();
    return ()=>{stillMounted.current=false;};
  // Authentication callback must run at most once: auth instance fixed for mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(() => {
    if (mode === 'outcome' || mode === 'set-password') heading.current?.focus();
  }, [mode]);

  if (mode === 'callback' || (enteredCallback.current && mode === 'outcome')) {
    const checking = mode === 'callback';
    return <main className="auth-callback" id="auth-main">
      <header className="auth-callback-header">
        <a href="/" className="auth-home" aria-label="Kadmeion home"><BrandMark/></a>
        <button type="button" onClick={toggleTheme} className="theme-button"
          aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
          aria-pressed={theme === 'dark'}>
          <Icon name={theme === 'light' ? 'moon' : 'sun'} size={16}/>
          <span>{theme === 'light' ? 'Dark' : 'Light'}</span>
        </button>
      </header>
      <section className="auth-callback-card" aria-labelledby="auth-heading" aria-busy={checking}>
        <div className="auth-callback-banner" aria-hidden="true">
          <div className="auth-brand-rings"><span/><span/><span/></div>
        </div>
        <p className="eyebrow"><span/> Authentication</p>
        <h1 id="auth-heading" tabIndex={-1} ref={heading}>
          {checking ? 'Verifying your session.' : error ? 'Action not completed' :
            outcome === 'session-verified' ? 'Session verified' : 'Account status'}
        </h1>
        {checking ? <>
          <p>We check the return link and the account session before continuing.</p>
          <ol className="auth-callback-steps" aria-label="Verification steps">
            <li aria-current="step">Check your session</li>
            <li>Verify access</li>
            <li>Continue to Kadmeion</li>
          </ol>
          <p className="auth-callback-progress" role="status">Checking your link with the authentication service…</p>
          <p className="auth-advisory">If verification fails, you can return to sign in or request a fresh recovery link.</p>
        </> :
          error ? <p className="auth-error" role="alert">{error}</p> :
          notice && <p role="status">{notice}</p>}
        {!checking && <div className="auth-callback-actions">
          {identity && <a href="/app" className="auth-submit">Open private workspace</a>}
          <button type="button" className="auth-submit" onClick={() => setAuthMode('signin', '/signin')}>
            Return to sign in
          </button>
        </div>}
      </section>
    </main>;
  }
  const storyPanel = !!authStories[mode];
  return <>
    <a className="skip-link" href="#auth-main">Skip to account form</a>
    <main className="auth-page" id="auth-main" tabIndex={-1} data-mode={mode} data-panel={storyPanel ? 'left' : 'right'}>
      <section className="auth-form-panel" aria-label="Account access">
        <div className="auth-header">
          {storyPanel ? <a href="/signin" className="auth-home" aria-disabled={pending || undefined} onClick={event => {
            event.preventDefault();
            if (mode === 'signup') swapMode('signin');
            else setAuthMode('signin', '/signin');
          }}>Back to sign in</a> : <a href="/" className="auth-home" aria-label="Kadmeion home"><BrandMark/></a>}
          <button type="button" onClick={toggleTheme} className="theme-button"
            aria-label={theme==='light'?'Switch to dark theme':'Switch to light theme'} aria-pressed={theme==='dark'}>
            <Icon name={theme==='light'?'moon':'sun'} size={16}/><span>{theme==='light'?'Dark':'Light'}</span>
          </button>
        </div>
        <div className="auth-form-content">
          {error && mode!=='outcome' && <div className="auth-error" role="alert">{error}</div>}
          {notice && mode !== 'outcome' && mode !== 'set-password' && <div className="auth-notice" role="status">{notice}</div>}
          {mode==='signin' && <section aria-labelledby="auth-heading">
            <p className="eyebrow"><span/> Welcome to Kadmeion</p>
            <h1 id="auth-heading" tabIndex={-1} ref={heading}>Sign in to your account.</h1>
            <p className="auth-description">Access your workspace, portfolios, and projects. Your drafts and work stay private and in sync.</p>
            <form className="auth-fields" onSubmit={event=>void submit(event,async()=>{
              if(!auth)throw new Error(config.error);
              const who=await auth.service.login(email,password);
              await signedIn(who.email??null);
            })}>
              <AuthInput id="signin-email" label="Email address">
                <input id="signin-email" autoComplete="username" type="email" required value={email}
                  placeholder="you@example.com" onChange={event=>setEmail(event.target.value)}/>
              </AuthInput>
              <AuthPassword id="signin-password" label="Password" value={password} setValue={setPassword} autoComplete="current-password"/>
              <div className="auth-row"><span className="auth-privacy-note">Local session on this device</span>
                <a href="/forgot-password" aria-disabled={pending || undefined} onClick={event=>{event.preventDefault();setAuthMode('forgot-password','/forgot-password');}}>Forgot password? <span aria-hidden="true">→</span></a></div>
              <button type="submit" className="auth-submit" disabled={pending||!auth}>Sign in <span aria-hidden="true">→</span></button>
            </form>
            <div className="auth-or"><span>Or</span></div>
            <button className="auth-google" type="button" disabled={pending||!auth?.allowGoogle} onClick={()=>{
              if(!auth)return;
              setPending(true);setError('');
              void auth.service.googleLogin().then(url=>{window.location.assign(url);}).catch(reason=>{setError(readError(reason));setPending(false);});
            }}>{auth?.allowGoogle?'Continue with Google':'Google sign-in not configured'}</button>
            <p className="auth-switch">Don't have an account? <a href="/signup" aria-disabled={pending || undefined} onClick={event=>{event.preventDefault();swapMode('signup');}}>Create an account <span aria-hidden="true">→</span></a></p>
            <div className="auth-advisory">Drafts remain private until you explicitly choose what to share. Switching sign-in and sign-up preserves your entries.</div>
          </section>}
          {mode==='signup' && <section aria-labelledby="auth-heading">
            <p className="eyebrow"><span/> Begin your story</p>
            <h1 id="auth-heading" tabIndex={-1} ref={heading}>Create your account.</h1>
            <p className="auth-description">One identity for the projects, portfolios and developer work you want to showcase.</p>
            <form className="auth-fields" onSubmit={event=>void submit(event,async()=>{
              if(!auth)throw new Error(config.error);
              const handleIssue=checkHandleInput(handle);
              if(handleIssue)throw new Error(handleIssue);
              const passwordIssue=validatePasswordPair(password,confirm);
              if(passwordIssue)throw new Error(passwordIssue);
              const created=await auth.service.register({email,password,handle:cleanHandleInput(handle),displayName});
              if(created.status==='signed_in'){
                const verified=await auth.auth.getUser();
                if(verified.error||!verified.data?.user)throw new Error('Could not verify the new account session.');
                await signedIn(verified.data.user.email??null);
              } else result('registered','The registration request was accepted. A confirmation email may be sent if the provider is working.');
            })}>
              <AuthInput id="signup-name" label="Display name"><input id="signup-name" required maxLength={80} autoComplete="name" value={displayName} onChange={event=>setDisplayName(event.target.value)}/></AuthInput>
              <AuthInput id="signup-handle" label="Preferred handle"><input id="signup-handle" required minLength={3} maxLength={30} spellCheck={false} autoComplete="off" value={handle}
                aria-describedby="signup-handle-note" onChange={event=>setHandle(event.target.value)}/></AuthInput>
              <p id="signup-handle-note" className="auth-field-hint">Letters, numbers and underscores, beginning with a letter. Your handle is not reserved until the server confirms it.</p>
              <AuthInput id="signup-email" label="Email address"><input id="signup-email" required type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)}/></AuthInput>
              <AuthPassword id="signup-password" label="Create password" value={password} setValue={setPassword} autoComplete="new-password"/>
              <AuthPassword id="signup-confirm" label="Confirm password" value={confirm} setValue={setConfirm} autoComplete="new-password"/>
              <button type="submit" className="auth-submit" disabled={!auth||!auth.emailAvailable||pending}>Create account <span aria-hidden="true">→</span></button>
            </form>
            {!auth?.emailAvailable&&<p className="auth-field-hint">Registration remains unavailable until sender delivery is verified.</p>}
            <p className="auth-switch">Already have an account? <a href="/signin" aria-disabled={pending || undefined} onClick={event=>{event.preventDefault();swapMode('signin');}}>Sign in <span aria-hidden="true">→</span></a></p>
          </section>}
          {mode==='forgot-password' && <section aria-labelledby="auth-heading">
            <p className="eyebrow"><span/> Account recovery</p><h1 id="auth-heading" tabIndex={-1} ref={heading}>Reset your password.</h1>
            <p className="auth-description">Request a one-time link without revealing whether an email address has an account.</p>
            <form className="auth-fields" onSubmit={event=>void submit(event,async()=>{
              if(!auth)throw new Error(config.error);
              await auth.service.requestPasswordReset(email);
              result('email-requested','If the account exists, the provider accepted a recovery request. Delivery is not confirmed.');
            })}>
              <AuthInput id="forgot-email" label="Email address"><input id="forgot-email" required type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)}/></AuthInput>
              <button type="submit" className="auth-submit" disabled={pending||!auth?.emailAvailable}>Request recovery link <span aria-hidden="true">→</span></button>
            </form>
            {!auth?.emailAvailable&&<p className="auth-field-hint">Email recovery is not available until provider delivery is verified.</p>}
            <p className="auth-switch"><button type="button" className="auth-text-button" disabled={pending} onClick={()=>setAuthMode('signin','/signin')}>Return to sign in</button></p>
          </section>}
          {mode==='set-password' && <section aria-labelledby="auth-heading">
            <p className="eyebrow"><span/> Secure access</p><h1 id="auth-heading" tabIndex={-1} ref={heading}>Choose a new password.</h1>
            <p className="auth-description">This action requires a verified one-time recovery or invitation session.</p>
            <form className="auth-fields" onSubmit={event=>void submit(event,async()=>{
              if(!auth)throw new Error(config.error);
              const issue=validatePasswordPair(password,confirm);if(issue)throw new Error(issue);
              const current=await auth.auth.getUser();
              if(current.error||!current.data?.user)throw new Error('Your verified reset session has expired.');
              await auth.service.updatePassword(password);
              result('password-updated','The authenticated password update was accepted.');
            })}>
              <AuthPassword id="new-password" label="New password" value={password} setValue={setPassword} autoComplete="new-password"/>
              <AuthPassword id="confirm-password" label="Confirm new password" value={confirm} setValue={setConfirm} autoComplete="new-password"/>
              {notice && <p className="auth-notice auth-reset-note" role="status">{notice}</p>}
              <button className="auth-submit" type="submit" disabled={pending||!auth}>Save new password <span aria-hidden="true">→</span></button>
            </form>
          </section>}
          {mode==='outcome' && <section aria-labelledby="auth-heading">
            <p className="eyebrow"><span/> Account update</p><h1 id="auth-heading" tabIndex={-1} ref={heading}>
              {error?'Action not completed':outcome==='password-updated'?'Password updated':
                outcome==='registered'?'Registration submitted':outcome==='email-requested'?'Check your inbox':outcome==='session-verified'?'Session verified':'Account recovery status'}
            </h1>
            <p className="auth-description" role={error?'alert':notice?'status':undefined}>{notice||error||'Check your account details before continuing.'}</p>
            {outcome === 'email-requested' &&
              <aside className="auth-recovery-help">
                <strong>Waiting for the recovery email?</strong>
                <ul><li>Check your spam or junk folder.</li><li>Use the most recent link if you requested more than one.</li></ul>
              </aside>}
            {identity&&<p className="auth-identity">Verified account email: {identity}</p>}
            {identity&&<a className="auth-submit" href="/app">Open private workspace <span aria-hidden="true">→</span></a>}
            <button type="button" className="auth-submit" disabled={pending} onClick={()=>setAuthMode('signin','/signin')}>Return to sign in <span aria-hidden="true">→</span></button>
            {(outcome === 'email-requested' || (error && !identity)) &&
              <button type="button" className="auth-text-button" disabled={pending}
                onClick={()=>setAuthMode('forgot-password','/forgot-password')}>Request another link</button>}
            {identity&&auth&&<button type="button" className="auth-text-button" disabled={pending} onClick={()=>{
              setPending(true);
              void auth.service.logout('local').then(()=>{
                setAuthMode('signin','/signin');
              }).catch(reason=>setError(readError(reason))).finally(()=>setPending(false));
            }}>Sign out of this device</button>}
          </section>}
          {mode==='workspace' && <section aria-labelledby="auth-heading">
            <p className="eyebrow"><span/> Workspace</p><h1 id="auth-heading" tabIndex={-1} ref={heading}>Verifying your session.</h1>
            <p className="auth-description" role="status">An owner session is required. This React build does not render private portfolio data without authorization.</p>
          </section>}
        </div>
        <footer className="auth-footer"><span>Build · Showcase · Evolve</span><span>Private by default</span></footer>
      </section>
      <AuthBrand mode={mode}/>
    </main>
  </>;
}
