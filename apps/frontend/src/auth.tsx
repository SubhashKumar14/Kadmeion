import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { AuthFlowError, AuthService } from '../../../packages/contracts/src/auth-service.ts';
import { isSafeSupabaseClientKey } from '../../../packages/contracts/src/project.ts';
import { parseAuthRedirect } from '../../auth-web/src/auth-redirect.ts';
import { SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
import { cleanHandleInput, checkHandleInput, validatePasswordPair } from '../../auth-web/src/form-helpers.ts';
import { BrandMark, Icon, useTheme } from './landing.tsx';
import './auth.css';

type Mode = 'signin' | 'signup' | 'forgot-password' | 'set-password' | 'outcome' | 'callback' | 'workspace';
type Outcome = 'email-requested' | 'registered' | 'password-updated' | 'session-verified' | 'initialization-pending';
type VerifiedOutcomeIdentity = {ownerId:string;epoch:number;email:string|null};
type AuthState = { auth: SupabaseBrowserAuthPort; service: AuthService; allowGoogle: boolean; emailAvailable: boolean };
const authRoutes = new Set(['/signin','/login','/signup','/register','/forgot-password','/reset-password','/set-password','/auth/callback','/workspace','/auth/outcome','/auth/recovery-status']);
export function isAuthRoute(path: string): boolean { return authRoutes.has(path); }
function initialMode(path: string): Mode {
  if (path==='/signup'||path==='/register') return 'signup';
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
function AuthPassword({id,label,value,setValue,autoComplete,disabled}:{id:string;label:string;value:string;setValue:(next:string)=>void;autoComplete:'current-password'|'new-password';disabled:boolean}){
  const [visible,setVisible]=useState(false);
  return <AuthInput id={id} label={label}>
    <div className="auth-password-wrap">
      <input id={id} required minLength={autoComplete==='new-password'?8:undefined} maxLength={128}
        type={visible?'text':'password'} autoComplete={autoComplete}
        value={value} disabled={disabled} onChange={event=>setValue(event.target.value)} />
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
  // React state updates are not synchronous: fence duplicate submissions and
  // mode changes before the first provider call starts.
  const actionInFlight=useRef(false);
  const [outcome,setOutcome]=useState<Outcome | null>(null);
  const [identity,setIdentity]=useState<VerifiedOutcomeIdentity|null>(null);
  const identityBinding=useRef<VerifiedOutcomeIdentity|null>(null);
  const heading=useRef<HTMLHeadingElement>(null);
  const enteredCallback = useRef(window.location.pathname === '/auth/callback');
  const redirectStarted=useRef(false);
  const stillMounted=useRef(true);
  const recoveryBinding=useRef<{ownerId:string;epoch:number}|null>(null);
  const auth=config.value;
  const recoveryChanged=()=>new Error('Your verified reset session has expired or changed. Request another recovery link.');
  function retireRecovery(message:string) {
    recoveryBinding.current=null;
    identityBinding.current=null;
    if(!stillMounted.current)return;
    setPassword('');setConfirm('');setNotice('');setIdentity(null);setOutcome(null);
    setError(message);setMode('outcome');
    history.replaceState(null,'','/auth/recovery-status');
  }
  function setAuthMode(next:Mode,route?:string,clearSecrets=true){
    if(actionInFlight.current)return;
    recoveryBinding.current=null;identityBinding.current=null;
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
    if(!stillMounted.current)return;
    recoveryBinding.current=null;
    if(kind!=='session-verified'){identityBinding.current=null;setIdentity(null);}
    setOutcome(kind);setNotice(message);
    setPassword('');setConfirm('');setError('');
    setMode('outcome');history.replaceState(null,'','/auth/outcome');
  }
  async function runAuthAction(action:()=>Promise<void>):Promise<boolean>{
    if(actionInFlight.current||!stillMounted.current)return false;
    actionInFlight.current=true;
    setPending(true);setError('');setNotice('');
    try{await action();return stillMounted.current;}
    catch(reason){if(stillMounted.current)setError(readError(reason));return false;}
    finally{actionInFlight.current=false;if(stillMounted.current)setPending(false);}
  }
  async function submit(event:FormEvent<HTMLFormElement>,action:()=>Promise<void>){
    event.preventDefault();
    await runAuthAction(action);
  }
  async function verifyInitializedOwner(expected:{id:string}):Promise<VerifiedOutcomeIdentity|null>{
    if(!auth||!stillMounted.current)return null;
    const epoch=auth.auth.reconcileOwnerSessionEpoch();
    const current=await auth.auth.getUser();
    if(!stillMounted.current)return null;
    const assertCurrent=()=>{
      if(auth.auth.reconcileOwnerSessionEpoch()!==epoch)
        throw new AuthFlowError('AUTH_EXPIRED','The authenticated account changed. Sign in again.');
    };
    if(current?.error!==null||current.data?.user?.id!==expected.id)
      throw new AuthFlowError('AUTH_EXPIRED','The authenticated account changed. Sign in again.');
    assertCurrent();
    // Existing adapter verifies the live principal, RLS owner filter, exactly
    // one initialized profile row and initiating session epoch. Never create
    // a second account or synthesize a profile if bootstrap readback fails.
    const profile=await auth.auth.readOwnerProfile(epoch);
    if(!stillMounted.current)return null;
    assertCurrent();
    if(profile?.error!==null||typeof profile.data?.displayName!=='string'){
      result('initialization-pending','The account session was verified, but the private profile could not be confirmed. Return to sign in and retry; do not register another account.');
      return null;
    }
    return {ownerId:expected.id,epoch,email:current.data.user.email??null};
  }
  async function signedIn(expected:{id:string}){
    const binding=await verifyInitializedOwner(expected);
    if(!binding||!stillMounted.current||!auth)return;
    if(auth.auth.reconcileOwnerSessionEpoch()!==binding.epoch)
      throw new AuthFlowError('AUTH_EXPIRED','The authenticated account changed. Sign in again.');
    identityBinding.current=binding;setIdentity(binding);
    result('session-verified','An authenticated session and its private profile were verified. Open your private workspace to continue.');
  }
  useEffect(()=>{
    document.title='Kadmeion — '+({
      signin:'Sign in',signup:'Create account','forgot-password':'Password recovery','set-password':'Choose a password',
      callback:'Checking your link',workspace:'Private workspace',outcome:'Account status'
    }[mode]);
  },[mode]);
  useEffect(()=>{
    if(!auth)return;
    return auth.auth.subscribeOwnerSessionEpoch(epoch=>{
      const binding=recoveryBinding.current;
      const verified=identityBinding.current;
      if((!binding||epoch===binding.epoch)&&(!verified||epoch===verified.epoch))return;
      recoveryBinding.current=null;identityBinding.current=null;
      if(!stillMounted.current)return;
      // An observed owner/session transition permanently invalidates this form.
      // Remove the entered secrets and offer a fresh link instead of leaving a
      // stale reset form visible while an in-flight request settles.
      setPassword('');setConfirm('');
      setNotice('');setIdentity(null);setOutcome(null);
      setError(binding?recoveryChanged().message:'Your verified account session changed. Sign in again.');
      setMode('outcome');
      history.replaceState(null,'',binding?'/auth/recovery-status':'/auth/outcome');
    });
  },[auth]);
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
      return ()=>{stillMounted.current=false;};
    }
    // Scrub credentials BEFORE any async request or render-side navigation.
    if(redirect.kind!=='none')history.replaceState(null,'',privateRoute);
    if(!auth){
      setMode('outcome');setError(config.error);
      return ()=>{stillMounted.current=false;};
    }
    void (async()=>{
      setMode('callback');
      try{
        if(redirect.kind==='error')throw new Error(redirect.message);
        if(redirect.kind==='oauth_code'){
          const who=await auth.service.finishOAuth(redirect.code);
          if(stillMounted.current)await signedIn(who);return;
        }
        if(redirect.kind==='tokens' || redirect.kind==='token_hash'){
          const kind=redirect.kind==='tokens'
            ? await auth.auth.acceptTokens(redirect.parameters)
            : await auth.auth.verifyTokenHash(redirect.tokenHash,redirect.type);
          if(!stillMounted.current)return;
          if(kind==='recovery'||kind==='invite'){
            // The adapter records the initiating provider-verified session at
            // redemption. Never substitute a user from a later getUser call.
            const binding=auth.auth.readVerifiedRecoveryBinding();
            if(!binding||auth.auth.reconcileOwnerSessionEpoch()!==binding.epoch)throw recoveryChanged();
            recoveryBinding.current=binding;
            setMode('set-password');
            setNotice('Your one-time link was verified. Choose a new password.');
            return;
          }
          const verified=await auth.auth.getUser();
          if(verified.error||!verified.data?.user)throw new Error('Account confirmation session could not be verified.');
          if(stillMounted.current)await signedIn(verified.data.user);
          return;
        }
        if(privateRoute==='/workspace'){
          const verified=await auth.auth.getUser();
          if(verified.error||!verified.data?.user)throw new Error('Sign in to access your private workspace.');
          if(stillMounted.current)await signedIn(verified.data.user);
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
              try {
                const who=await auth.service.login(email,password);
                await signedIn(who);
              } catch (reason) {
                if (!(reason instanceof AuthFlowError) || reason.code !== 'EMAIL_CONFIRMATION_REQUIRED') throw reason;
                result('registered', reason.message);
              }
            })}>
              <AuthInput id="signin-email" label="Email address">
                <input id="signin-email" autoComplete="username" type="email" required value={email}
                  placeholder="you@example.com" disabled={pending} onChange={event=>{if(!actionInFlight.current)setEmail(event.target.value);}}/>
              </AuthInput>
              <AuthPassword id="signin-password" label="Password" value={password} setValue={value=>{if(!actionInFlight.current)setPassword(value);}} disabled={pending} autoComplete="current-password"/>
              <div className="auth-row"><span className="auth-privacy-note">Local session on this device</span>
                <a href="/forgot-password" aria-disabled={pending || undefined} onClick={event=>{event.preventDefault();setAuthMode('forgot-password','/forgot-password');}}>Forgot password? <span aria-hidden="true">→</span></a></div>
              <button type="submit" className="auth-submit" disabled={pending||!auth}>Sign in <span aria-hidden="true">→</span></button>
            </form>
            <div className="auth-or"><span>Or</span></div>
            <button className="auth-google" type="button" disabled={pending||!auth?.allowGoogle} onClick={()=>{
              if(!auth||!auth.allowGoogle)return;
              void runAuthAction(async()=>{
                const url=await auth.service.googleLogin();
                if(!stillMounted.current)return;
                setPassword('');setConfirm('');
                window.location.assign(url);
              });
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
              const created=await auth.service.registerWithIdentity({email,password,handle:cleanHandleInput(handle),displayName});
              if(!stillMounted.current)return;
              if(created.status==='signed_in'){
                // A successful provider signup can already have committed, even
                // if initialization readback later fails. Never repeat signup
                // automatically and never redirect into a different owner.
                try{
                  const verified=await verifyInitializedOwner(created.user);
                  if(!verified||!stillMounted.current)return;
                  if(auth.auth.reconcileOwnerSessionEpoch()!==verified.epoch)
                    throw new AuthFlowError('AUTH_EXPIRED','The authenticated account changed. Sign in again.');
                  setPassword('');setConfirm('');window.location.replace('/app');
                }catch{
                  result('initialization-pending','Registration returned a session, but access to the new private profile could not be confirmed. Return to sign in and retry; do not register again.');
                }
              } else result('registered','This environment requires email confirmation before sign-in. If the confirmation email arrives, open its link to continue.');
            })}>
              <AuthInput id="signup-name" label="Display name"><input id="signup-name" required maxLength={80} autoComplete="name" value={displayName} disabled={pending} onChange={event=>{if(!actionInFlight.current)setDisplayName(event.target.value);}}/></AuthInput>
              <AuthInput id="signup-handle" label="Preferred handle"><input id="signup-handle" required minLength={3} maxLength={30} spellCheck={false} autoComplete="off" value={handle}
                aria-describedby="signup-handle-note" disabled={pending} onChange={event=>{if(!actionInFlight.current)setHandle(event.target.value);}}/></AuthInput>
              <p id="signup-handle-note" className="auth-field-hint">Letters, numbers and underscores, beginning with a letter. Your handle is not reserved until the server confirms it.</p>
              <AuthInput id="signup-email" label="Email address"><input id="signup-email" required type="email" autoComplete="email" value={email} disabled={pending} onChange={event=>{if(!actionInFlight.current)setEmail(event.target.value);}}/></AuthInput>
              <AuthPassword id="signup-password" label="Create password" value={password} setValue={value=>{if(!actionInFlight.current)setPassword(value);}} disabled={pending} autoComplete="new-password"/>
              <AuthPassword id="signup-confirm" label="Confirm password" value={confirm} setValue={value=>{if(!actionInFlight.current)setConfirm(value);}} disabled={pending} autoComplete="new-password"/>
              <button type="submit" className="auth-submit" disabled={!auth||pending}>Create account <span aria-hidden="true">→</span></button>
            </form>
            {!auth&&<p className="auth-field-hint">Account creation is unavailable in this environment.</p>}
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
              <AuthInput id="forgot-email" label="Email address"><input id="forgot-email" required type="email" autoComplete="email" value={email} disabled={pending} onChange={event=>{if(!actionInFlight.current)setEmail(event.target.value);}}/></AuthInput>
              <button type="submit" className="auth-submit" disabled={pending||!auth}>Request recovery link <span aria-hidden="true">→</span></button>
            </form>
            {auth&&!auth.emailAvailable&&<p className="auth-field-hint">Email delivery is not verified. You can still request a recovery link.</p>}
            <p className="auth-switch"><button type="button" className="auth-text-button" disabled={pending} onClick={()=>setAuthMode('signin','/signin')}>Return to sign in</button></p>
          </section>}
          {mode==='set-password' && <section aria-labelledby="auth-heading">
            <p className="eyebrow"><span/> Secure access</p><h1 id="auth-heading" tabIndex={-1} ref={heading}>Choose a new password.</h1>
            <p className="auth-description">This action requires a verified one-time recovery or invitation session.</p>
            <form className="auth-fields" onSubmit={event=>void submit(event,async()=>{
              if(!auth)throw new Error(config.error);
              const issue=validatePasswordPair(password,confirm);if(issue)throw new Error(issue);
              const binding=recoveryBinding.current;
              if(!binding||auth.auth.reconcileOwnerSessionEpoch()!==binding.epoch){
                retireRecovery(recoveryChanged().message);return;
              }
              const issued=auth.auth.readVerifiedRecoveryBinding();
              if(!issued||issued.ownerId!==binding.ownerId||issued.epoch!==binding.epoch){
                retireRecovery(recoveryChanged().message);return;
              }
              // Do not reuse an ambiguous password-write acknowledgement. A PUT
              // can already have committed even if delivery of its receipt failed.
              try{
                const updated=await auth.auth.updateRecoveryPassword(password,binding);
                if(!stillMounted.current)return;
                if(recoveryBinding.current!==binding)return; // epoch listener already retired the form
                if(updated?.error!==null||updated.data?.user?.id!==binding.ownerId||
                  auth.auth.reconcileOwnerSessionEpoch()!==binding.epoch){
                  if(recoveryBinding.current===binding)
                    retireRecovery('The password update could not be confirmed. Try signing in with the intended new password or request another recovery link.');
                  return;
                }
                if(recoveryBinding.current===binding)
                  result('password-updated','The authenticated password update was accepted.');
              }catch{
                if(stillMounted.current&&recoveryBinding.current===binding)
                  retireRecovery('The password update could not be confirmed. Try signing in with the intended new password or request another recovery link.');
              }
            })}>
              <AuthPassword id="new-password" label="New password" value={password} setValue={value=>{if(!actionInFlight.current)setPassword(value);}} disabled={pending} autoComplete="new-password"/>
              <AuthPassword id="confirm-password" label="Confirm new password" value={confirm} setValue={value=>{if(!actionInFlight.current)setConfirm(value);}} disabled={pending} autoComplete="new-password"/>
              {notice && <p className="auth-notice auth-reset-note" role="status">{notice}</p>}
              <button className="auth-submit" type="submit" disabled={pending||!auth}>Save new password <span aria-hidden="true">→</span></button>
            </form>
          </section>}
          {mode==='outcome' && <section aria-labelledby="auth-heading">
            <p className="eyebrow"><span/> Account update</p><h1 id="auth-heading" tabIndex={-1} ref={heading}>
              {error?'Action not completed':outcome==='password-updated'?'Password updated':
                outcome==='registered'?'Registration submitted':outcome==='email-requested'?'Check your inbox':outcome==='session-verified'?'Session verified':outcome==='initialization-pending'?'Profile verification pending':'Account recovery status'}
            </h1>
            <p className="auth-description" role={error?'alert':notice?'status':undefined}>{notice||error||'Check your account details before continuing.'}</p>
            {outcome === 'email-requested' &&
              <aside className="auth-recovery-help">
                <strong>Waiting for the recovery email?</strong>
                <ul><li>Check your spam or junk folder.</li><li>Use the most recent link if you requested more than one.</li></ul>
              </aside>}
            {identity?.email&&<p className="auth-identity">Signed in as {identity.email}</p>}
            {identity&&<a className="auth-submit" href="/app">Open private workspace <span aria-hidden="true">→</span></a>}
            {outcome==='registered'&&auth&&<button type="button" className="auth-text-button" disabled={pending}
              onClick={()=>{
                if(!auth)return;
                void runAuthAction(async()=>{
                  await auth.service.resendSignupConfirmation(email);
                  if(stillMounted.current)setNotice('If confirmation is required, the provider accepted another request. Email delivery is not confirmed.');
                });
              }}>{pending?'Requesting…':'Request another confirmation link'}</button>}
            <button type="button" className="auth-submit" disabled={pending} onClick={()=>setAuthMode('signin','/signin')}>Return to sign in <span aria-hidden="true">→</span></button>
            {(outcome === 'email-requested' || (error && !identity)) &&
              <button type="button" className="auth-text-button" disabled={pending}
                onClick={()=>setAuthMode('forgot-password','/forgot-password')}>Request another link</button>}
            {identity&&auth&&<button type="button" className="auth-text-button" disabled={pending} onClick={()=>{
              void runAuthAction(async()=>{await auth.service.logout('local');}).then(ok=>{
                if(ok&&stillMounted.current)setAuthMode('signin','/signin');
              });
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
