import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
import type { PrivateNotification, PrivateNotificationPage, NotificationPreferenceState, NotificationPreferenceChange, NotificationPreferenceInput } from '../../../packages/contracts/src/private-notifications-service.ts';
import type { AccountErasureReceipt, AccountExitPreflight, AccountExitReauthChallenge, AccountExitReauthVerification, PrivateAccountErasureEntry } from '../../../packages/contracts/src/private-account-erasure-service.ts';
import type { PrivateTrashEntry, PrivateTrashKind } from '../../../packages/contracts/src/private-trash-service.ts';
import { PrivateTrashError } from '../../../packages/contracts/src/private-trash-service.ts';
import { PrivateNotificationsError } from '../../../packages/contracts/src/private-notifications-service.ts';
import type { SharingPreferences } from '../../../packages/contracts/src/identity.ts';
import type { ProfileSharingState, ProfileSharingChange } from '../../../packages/contracts/src/private-identity-service.ts';
import { OwnerCaseHistory } from './operations.tsx';

const settingsLinks = [
  ['/app/settings/privacy', 'Privacy & sharing', 'Choose which profile fields are eligible for sharing.'],
  ['/app/notifications', 'Notifications', 'Review activity and notification preferences.'],
  ['/app/settings/security', 'Account security', 'Update your password or sign out other sessions.'],
  ['/app/trash', 'Trash', 'Review items you can restore privately.'],
  ['/app/export', 'Export center', 'Download private account records or portfolio source.'],
  ['/app/settings/account/delete', 'Account exit', 'Review prerequisites for account deletion.'],
  ['/app/settings/cases', 'Your cases and appeals', 'Review owner-private moderation records.']
] as const;
const settingsSections = [
  {title:'Your account',detail:'Identity and sign-in controls.',items:[
    ['/app/profile','Developer profile','Edit your private profile and eligible public fields.'],
    settingsLinks[2]
  ]},
  {title:'Control & privacy',detail:'Choose what can be disclosed and which activity you receive.',items:[
    settingsLinks[0],settingsLinks[1],
    ['/app/integrations','Platform connections','Review private links and genuine provider connection states.']
  ]},
  {title:'Your data',detail:'Export, recover and manage the lifecycle of account content.',items:[
    settingsLinks[4],settingsLinks[3],settingsLinks[5]
  ]},
  {title:'Visibility',detail:'Inspect private portfolio work and analytics availability.',items:[
    ['/app/portfolios','Portfolio library','Review private drafts and unpublished release candidates.'],
    ['/app/analytics','Portfolio analytics','Review the opt-in status; unavailable visitor data is never invented.']
  ]}
] as const;
type Services = NonNullable<Awaited<ReturnType<SupabaseBrowserAuthPort['ownerSettings']>>['data']>;
type Message = {error: boolean; text: string} | null;
const emptyMessage: Message = null;

export function isSettingsRoute(path: string) {
  return path === '/app/settings' || settingsLinks.some(([href]) => path === href);
}

function Status({message}: {message: Message}) {
  return message && <p className="ws-inline-alert" role={message.error ? 'alert' : 'status'}>{message.text}</p>;
}

function failure(error: unknown): Message {
  return {error: true, text: error instanceof Error ? error.message : 'The account service could not confirm that action.'};
}

function SettingsCard({title, children}: {title: string; children: ReactNode}) {
  return <section className="ws-project-aside ws-setting-card"><h2>{title}</h2>{children}</section>;
}

export function OwnerSettings({port, path}: {port: SupabaseBrowserAuthPort; path: string}) {
  const [retry, setRetry] = useState(0);
  // A new route, adapter or retry must never render the old account's settings
  // while the current owner request is still pending.
  const [epoch]=useState(()=>port.getOwnerSessionEpoch());
  const scope = useMemo(() => ({port, path, retry, epoch}), [port, path, retry, epoch]);
  const [loaded, setLoaded] = useState<{
    scope: typeof scope; services: Services | null; error: string; viewKey: string
  } | null>(null);
  const current = loaded?.scope === scope ? loaded : null;
  const services = current?.services ?? null;
  const error = current?.error ?? '';
  useEffect(() => {
    if (path === '/app/settings') return;
    let active = true;
    void port.ownerSettings().then(result => {
      if (!active || port.reconcileOwnerSessionEpoch()!==epoch) return;
      setLoaded({
        scope, services: result.data ?? null,
        error: result.data ? '' : result.error?.message ?? 'Account settings are unavailable.',
        viewKey: crypto.randomUUID()
      });
    }).catch(() => {
      if (active && port.reconcileOwnerSessionEpoch()===epoch) setLoaded({
        scope, services: null,
        error: 'Account settings could not be loaded. Retry when the connection is available.',
        viewKey: crypto.randomUUID()
      });
    });
    return () => {active = false;};
  }, [scope, port, path, epoch]);

  const title = settingsLinks.find(([href]) => href === path)?.[1] ?? 'Settings';
  let content: ReactNode = null;
  if (path === '/app/settings') content = <div className="ws-settings-grid ws-settings-hub" role="group" aria-label="Account settings sections">
    {settingsSections.map(group=><SettingsCard key={group.title} title={group.title}>
      <p className="ws-settings-group-description">{group.detail}</p>
      <ul className="ws-settings-hub-links">
        {group.items.map(([href,label,detail])=><li key={href}>
          <div><strong>{label}</strong><p>{detail}</p></div>
          <a href={href} className="ws-secondary">Open {label.toLowerCase()}</a>
        </li>)}
      </ul>
    </SettingsCard>)}
  </div>;
  else if (path==='/app/settings/cases') content = <OwnerCaseHistory port={port}/>;
  else if (!services) content = error
    ? <><p role="alert" className="ws-inline-alert">{error}</p><button type="button" className="ws-secondary" onClick={() => {
      setRetry(value => value + 1);
    }}>Retry account settings</button></>
    : <p role="status">Loading private account settings…</p>;
  else if (path === '/app/settings/privacy') content = <Privacy key={current!.viewKey} port={port} services={services}/>;
  else if (path === '/app/notifications') content = <Notifications key={current!.viewKey} port={port} service={services.notifications}/>;
  else if (path === '/app/settings/security') content = <Security key={current!.viewKey} port={port}/>;
  else if (path === '/app/trash') content = <Trash key={current!.viewKey} port={port} service={services.trash}/>;
  else if (path === '/app/export') content = <ExportCenter key={current!.viewKey} port={port} services={services}/>;
  else content = <AccountExit key={current!.viewKey} port={port} service={services.account}/>;

  return <section className="ws-settings-page" aria-labelledby="settings-title">
    <div className="ws-heading">
      {path !== '/app/settings' && <a href="/app/settings">Back to settings</a>}
      <p className="ws-kicker">YOUR ACCOUNT</p><h1 id="settings-title">{title}</h1>
    </div>
    <div className="ws-settings-body">{content}</div>
  </section>;
}

function Privacy({port, services}: {port: SupabaseBrowserAuthPort; services: Services}) {
  const [epoch]=useState(()=>port.getOwnerSessionEpoch());
  const alive=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const current=()=>alive.current&&port.reconcileOwnerSessionEpoch()===epoch;
  const [savedState,setSavedState]=useState<ProfileSharingState|null>(null);
  const [retryChange,setRetryChange]=useState<ProfileSharingChange|null>(null);
  const defaults:SharingPreferences={shareDisplayName:false,shareHeadline:false,shareBio:false,publicationRequested:false};
  const savedPrefs=savedState?(savedState.preferences??defaults):null;
  const terminal=savedState?.version===Number.MAX_SAFE_INTEGER;
  const terminalAbsent=terminal&&savedState?.preferences===null;
  const [prefs,setPrefs]=useState<SharingPreferences|null>(null);
  const [confirmed,setConfirmed]=useState(false);
  const [message,setMessage]=useState<Message>(emptyMessage);
  const [busy,setBusy]=useState(false);
  const [reading,setReading]=useState(true);
  const [needsReadback,setNeedsReadback]=useState(false);
  const readbackRequired=useRef(false);
  const [reload,setReload]=useState(0);
  const writing=useRef(false);
  const readPending=useRef(true);
  const fields: [keyof SharingPreferences,string][]=[
    ['shareDisplayName','Display name'],['shareHeadline','Headline'],['shareBio','About you']
  ];
  const same=(a:SharingPreferences,b:SharingPreferences)=>
    a.shareDisplayName===b.shareDisplayName&&a.shareHeadline===b.shareHeadline&&
    a.shareBio===b.shareBio&&a.publicationRequested===b.publicationRequested;
  useEffect(()=>{
    let active=true;readPending.current=true;setReading(true);setConfirmed(false);
    void services.identity.readProfileSharingState().then(result=>{
      if(!active||!current())return;
      setSavedState(result);setRetryChange(null);
      setPrefs(previous=>previous??result.preferences??defaults);
      readbackRequired.current=false;setNeedsReadback(false);setMessage(null);
    }).catch(()=>{
      if(active&&current()){
        readbackRequired.current=true;setNeedsReadback(true);
        setMessage({error:true,text:'Confirmed sharing preferences could not be loaded. Your draft has not been changed.'});
      }
    }).finally(()=>{
      if(active&&current()){readPending.current=false;setReading(false);}
    });
    return()=>{active=false;};
  },[port,services.identity,epoch,reload]);
  function refresh(){
    if(!current()||writing.current||readPending.current)return;
    readPending.current=true;readbackRequired.current=true;setNeedsReadback(true);
    setRetryChange(null);setReading(true);setConfirmed(false);setReload(n=>n+1);
  }
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!prefs||!savedState||terminalAbsent||!confirmed||retryChange||readbackRequired.current||readPending.current||writing.current||!current())return;
    if(terminal&&(prefs.publicationRequested||fields.some(([key])=>prefs[key]&&!savedState.preferences?.[key])))return;
    const expected={...savedState,preferences:savedState.preferences===null?null:{...savedState.preferences}};
    await applyChange({expected,desired:{...prefs},operationId:crypto.randomUUID()});
  }
  async function applyChange(change:ProfileSharingChange){
    if(!current()||writing.current||readPending.current)return;
    writing.current=true;setBusy(true);setMessage(null);setConfirmed(false);
    try{
      const saved=await services.identity.requestPublicIdentity(change);
      if(!current())return;
      setSavedState({ownerUserId:saved.ownerUserId,version:saved.version,preferences:saved.preferences});
      setPrefs(saved.preferences??defaults);setRetryChange(null);
      readbackRequired.current=false;setNeedsReadback(false);
      setMessage({error:false,text:'Sharing preferences saved privately.'});
    }catch(error){
      if(current()){
        const code=error&&typeof error==='object'&&'code' in error?error.code:null;
        setRetryChange(code==='PROVIDER_UNAVAILABLE'||code==='INVALID_ACK'?change:null);
        readbackRequired.current=true;setNeedsReadback(true);
        setMessage({error:true,text:code==='CONFLICT'?
          'Saved sharing preferences changed. Reload confirmed preferences, compare your draft and confirm again before saving.':
          'The requested privacy change was not confirmed. Your draft is retained. Retry the same operation if available or reload confirmed preferences.'});
      }
    }finally{
      writing.current=false;if(current())setBusy(false);
    }
  }
  const selected=prefs?fields.filter(([key])=>prefs[key]).length:null;
  const dirty=!!(prefs&&savedPrefs&&!same(prefs,savedPrefs));
  return <div className="ws-settings-privacy">
    <SettingsCard title="Profile visibility">
      <p>Select fields eligible for a later publication request. Saving these choices does not make a profile or portfolio public.</p>
      <Status message={message}/>
      {reading&&<p role="status">Loading sharing preferences…</p>}
      {!prefs&&!reading&&message?.error&&<button type="button" className="ws-secondary"
        onClick={refresh}>Retry sharing preferences</button>}
      {savedPrefs&&<div aria-label="Confirmed sharing preferences">
        <h3>Last confirmed private selection</h3>
        <p>{fields.filter(([key])=>savedPrefs[key]).map(([,label])=>label).join(', ')||'No fields selected'}.
          {savedPrefs.publicationRequested?' Later publication requested.':' Later publication not requested.'}</p>
        {savedState?.preferences===null&&<p>No saved preference record; showing private defaults.</p>}
        {terminal&&<p>Privacy changes are restricted to reducing previously selected fields. Publication cannot be enabled.</p>}
        <p>{needsReadback?'Readback required; the saved state may have changed.':'This is a private saved intent, not proof of public visibility.'}</p>
      </div>}
      {prefs&&<form onSubmit={event => void save(event)}>
        <p className="ws-settings-selection-count"><strong>{selected} of {fields.length}</strong> profile fields selected in this form.
          Selection is not publication. {dirty?'Unsaved draft differs from confirmed preferences.':'No draft differences from the last confirmed selection.'}</p>
        <fieldset disabled={busy||reading||!!retryChange||terminalAbsent}>
          <legend>Shareable profile fields</legend>
          {fields.map(([key, label]) => <label className="ws-settings-check" key={key}>
            <input type="checkbox" checked={prefs[key]} disabled={terminal&&!savedState?.preferences?.[key]&&!prefs[key]} onChange={event => {
              if(terminal&&event.target.checked&&!savedState?.preferences?.[key])return;
              const next = {...prefs, [key]: event.target.checked};
              if (!next.shareDisplayName && !next.shareHeadline && !next.shareBio) next.publicationRequested = false;
              setPrefs(next); setConfirmed(false);
            }}/>{label}
          </label>)}
          <label className="ws-settings-check"><input type="checkbox" checked={prefs.publicationRequested}
            disabled={(terminal&&!prefs.publicationRequested)||(!prefs.shareDisplayName && !prefs.shareHeadline && !prefs.shareBio)}
            onChange={event => {if(terminal&&event.target.checked)return;setPrefs({...prefs, publicationRequested: event.target.checked}); setConfirmed(false);}}/>
            Allow a later publication request
          </label>
          <label className="ws-settings-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>
            Save these preferences and withdraw any affected public profile projection
          </label>
          <p>This confirms the private sharing intent and withdrawal request, not verified withdrawal. Public withdrawal and live delivery require separate verification.</p>
        </fieldset>
        <div className="ws-actions">
          <button type="submit" className="ws-primary" disabled={!confirmed||!savedPrefs||busy||reading||needsReadback||terminalAbsent||!!retryChange||(terminal&&(prefs.publicationRequested||fields.some(([key])=>prefs[key]&&!savedState?.preferences?.[key])))}>{busy?'Saving…':'Save sharing preferences'}</button>
          {retryChange&&<button type="button" className="ws-secondary" disabled={busy||reading} onClick={()=>void applyChange(retryChange)}>Retry same privacy change</button>}
          <button type="button" className="ws-secondary" disabled={busy||reading} onClick={refresh}>Reload confirmed preferences</button>
          <button type="button" className="ws-secondary" disabled={!savedPrefs||busy||reading||needsReadback||!dirty}
            onClick={()=>{if(!current()||writing.current||!savedPrefs)return;setPrefs({...savedPrefs});setConfirmed(false);setMessage(null);}}>Discard draft changes</button>
        </div>
      </form>}
    </SettingsCard>
    <SettingsCard title="Privacy boundaries">
      <p>Profile preferences are only one part of visitor visibility. Review each surface at its authoritative workspace route.</p>
      <ul className="ws-settings-visibility-list">
        <li><strong>Developer profile</strong><p>Only explicitly eligible fields can be considered for a later public identity projection.</p>
          <a href="/app/profile">Review private profile</a></li>
        <li><strong>Projects and portfolios</strong><p>Drafts stay owner-private. A separate frozen release, consent and verified host determine any visitor delivery.</p>
          <a href="/app/portfolios">Review private portfolios</a></li>
        <li><strong>Platform connections</strong><p>Stored profile handles are private links, not provider-verified activity or synchronization.</p>
          <a href="/app/integrations">Review private connections</a></li>
        <li><strong>Visitor analytics</strong><p>No visitor measurements are inferred from these checkboxes. Analytics has a separate opt-in gate.</p>
          <a href="/app/analytics">Review analytics availability</a></li>
        <li><strong>Moderation</strong><p>Review notices and appeal a case involving your account.</p>
          <a href="/app/settings/cases">Your cases and appeals</a></li>
      </ul>
    </SettingsCard>
    <p className="ws-settings-privacy-note">Publication safeguards: owner-private projects,
      unpublished revisions, connection records and provider data never become visitor-visible
      merely because a profile field is selected. Preview and live delivery require separate verification.</p>
  </div>;
}

/** Notification target IDs are never interpreted as navigation URLs. */
function notificationDestination(item: PrivateNotification): string {
  if (item.event_type === 'ACCOUNT_EXIT_REQUESTED') return '/app/settings/account/delete';
  if (item.category === 'SECURITY') return '/app/settings/security';
  if (item.category === 'MODERATION') return '/app/settings/cases';
  // Trigger contract: reviewer/release/sync target_id is the portfolio UUID.
  // Related areas stay private and perform their own live owner readback.
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.target_id))
    return '/app/portfolios';
  const base='/app/portfolios/'+item.target_id;
  if(item.category==='REVIEWER')return base+'/staging';
  if(item.category==='PUBLISH')return base+'/releases';
  if(item.category==='SYNC')return base+'/preview';
  return '/app/portfolios';
}

function Notifications({port,service}: {port:SupabaseBrowserAuthPort;service: Services['notifications']}) {
  const [epoch]=useState(()=>port.getOwnerSessionEpoch());
  const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const current=()=>mounted.current&&port.reconcileOwnerSessionEpoch()===epoch;
  const pendingAction=useRef(false);
  const [inbox, setInbox] = useState<PrivateNotificationPage | null>(null);
  const [prefs, setPrefs] = useState<NotificationPreferenceState | undefined>(undefined);
  const [pendingPrefs, setPendingPrefs] = useState<{
    reviewerEnabled: boolean; publishEnabled: boolean; syncEnabled: boolean;
  } | null>(null);
  const [preferenceMessage, setPreferenceMessage] = useState<Message>(emptyMessage);
  const [message, setMessage] = useState<Message>(emptyMessage);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [prefsReload,setPrefsReload]=useState(0);
  type PreferenceInput=NotificationPreferenceInput;
  const [prefRetry,setPrefRetry]=useState<NotificationPreferenceChange|null>(null);
  const preferencesReading=useRef(true);
  const [preferencesLoading,setPreferencesLoading]=useState(true);
  const [preferencesStale,setPreferencesStale]=useState(true);
  const [inboxFilter, setInboxFilter] = useState<'ALL'|'UNREAD'|'HIGH'>('ALL');
  useEffect(() => {
    let active = true;
    setInbox(null);
    setMessage(null);
    void service.listPage().then(items=>{
      if(active&&port.reconcileOwnerSessionEpoch()===epoch)setInbox(items);
    }).catch(error=>{if(active&&port.reconcileOwnerSessionEpoch()===epoch)setMessage(failure(error));});
    return () => {active = false;};
  }, [service,port,epoch,reload]);
  useEffect(()=>{
    let active=true;
    preferencesReading.current=true;setPreferencesLoading(true);
    setPreferencesStale(true);setPreferenceMessage(null);setPrefRetry(null);
    void service.readPreferenceState().then(settings=>{
      if(active&&current()){setPrefs(settings);setPreferencesStale(false);}
    }).catch(error=>{
      if(active&&current())setPreferenceMessage(failure(error));
    }).finally(()=>{
      if(active&&current()){preferencesReading.current=false;setPreferencesLoading(false);}
    });
    return()=>{active=false;};
  },[service,port,epoch,prefsReload]);

  async function acknowledge(item: PrivateNotification, dismiss: boolean) {
    if (busy || pendingAction.current || !current()) return;
    pendingAction.current=true;setBusy(true); setMessage(null);
    try {
      const receipt = await service.acknowledge(item.id, dismiss);
      if(!current())return;
      setInbox(current => current && {...current, items: dismiss ? current.items.filter(row => row.id !== item.id)
        : current.items.map(row => row.id === item.id ? {...row, read_at: receipt.read_at} : row)});
    } catch (error) {if(current())setMessage(failure(error));}
    finally {pendingAction.current=false;if(current())setBusy(false);}
  }

  async function review(item: PrivateNotification) {
    if (busy || pendingAction.current || !current()) return;
    pendingAction.current=true;setBusy(true); setMessage(null);
    try {
      if (!item.read_at) {
        const receipt=await service.acknowledge(item.id, false);
        if(!current())return;
        setInbox(value=>value&&({...value,items:value.items.map(row=>row.id===item.id?{...row,read_at:receipt.read_at}:row)}));
      }
      if(current())window.location.assign(notificationDestination(item));
    } catch (error) {
      if(current())setMessage(failure(error));
    } finally {pendingAction.current=false;if(current())setBusy(false);}
  }

  async function more() {
    if (!inbox?.nextCursor || busy || pendingAction.current || !current()) return;
    const requestedCursor = inbox.nextCursor;
    pendingAction.current=true;setBusy(true); setMessage(null);
    try {
      const next = await service.listPage(50, requestedCursor);
      if(!current())return;
      setInbox(current => {
        if (!current || current.nextCursor !== requestedCursor) return current;
        const seen = new Set(current.items.map(item => item.id));
        return {...next, items: [...current.items, ...next.items.filter(item => !seen.has(item.id))]};
      });
    } catch (error) {if(current())setMessage(failure(error));}
    finally {pendingAction.current=false;if(current())setBusy(false);}
  }

  const effective=(state:NotificationPreferenceState|undefined):PreferenceInput=>
    state?.preferences??{reviewerEnabled:state?.version!==Number.MAX_SAFE_INTEGER,publishEnabled:state?.version!==Number.MAX_SAFE_INTEGER,syncEnabled:false};
  const displayedPrefs=pendingPrefs??effective(prefs);
  function reloadPreferences(){
    if(!current()||pendingAction.current||preferencesReading.current)return;
    preferencesReading.current=true;setPreferencesLoading(true);setPreferencesStale(true);setPrefRetry(null);setPrefsReload(n=>n+1);
  }
  async function savePreference(key:keyof PreferenceInput,checked:boolean){
    if(busy||pendingAction.current||preferencesReading.current||preferencesStale||!prefs||prefRetry||prefs.version===Number.MAX_SAFE_INTEGER||!current())return;
    const expected={...prefs,preferences:prefs.preferences===null?null:{...prefs.preferences}};
    await applyPreference({expected,desired:{...effective(prefs),[key]:checked},operationId:crypto.randomUUID()});
  }
  async function applyPreference(change:NotificationPreferenceChange){
    if(pendingAction.current||preferencesReading.current||!current())return;
    pendingAction.current=true;setBusy(true);setPendingPrefs(change.desired);
    setPreferenceMessage(null);setPrefRetry(null);
    try{
      const saved=await service.changePreferences(change);
      if(!current())return;
      setPrefs({ownerUserId:saved.ownerUserId,version:saved.version,preferences:saved.preferences});setPreferencesStale(false);
      setPreferenceMessage({error:false,text:'Notification preferences saved.'});
    }catch(error){
      if(!current())return;
      const code=error instanceof PrivateNotificationsError?error.code:null;
      if(code==='CONFLICT'){
        setPreferencesStale(true);
        setPreferenceMessage({error:true,text:'Saved notification preferences changed. Reload confirmed preferences and choose the desired setting again. No preferences were overwritten.'});
      }else{
        setPreferencesStale(true);
        if(code==='PROVIDER_UNAVAILABLE'||code==='INVALID_ACK'||code==='LIMIT_EXCEEDED')setPrefRetry(change);
        setPreferenceMessage({error:true,text:'Could not confirm the change. Retry the same operation if available or reload confirmed preferences.'});
      }
    }finally{
      pendingAction.current=false;
      if(current()){setPendingPrefs(null);setBusy(false);}
    }
  }


  const visibleNotices=inbox?.items.filter(item=>inboxFilter==='ALL' ||
    (inboxFilter==='UNREAD'&&!item.read_at) || (inboxFilter==='HIGH'&&item.priority==='HIGH'));
  return <div className="ws-settings-grid"><SettingsCard title="Inbox">
    <Status message={message}/>
    {!inbox && !message && <p role="status">Loading notifications…</p>}
    {!inbox && message?.error && <button type="button" className="ws-secondary"
      onClick={() => setReload(value => value + 1)}>Retry notifications</button>}
    {inbox && <div className="ws-notification-filters" role="group" aria-label="Filter loaded notifications">
      {([['ALL','All loaded'],['UNREAD','Unread'],['HIGH','High priority']] as const).map(([key,label])=>
        <button type="button" key={key} className="ws-secondary" aria-pressed={inboxFilter===key}
          onClick={()=>setInboxFilter(key)}>{label}</button>)}
    </div>}
    {inbox?.items.length === 0 && <p>You’re caught up.</p>}
    {inbox && inbox.items.length>0 && visibleNotices?.length===0 &&
      <p>No matching notices in the currently loaded records. Load older records to look further.</p>}
    <ul className="ws-settings-records">{visibleNotices?.map(item => <li key={item.id}>
      <strong>{item.event_type.toLowerCase().replaceAll('_', ' ')}</strong>
      <p>{new Date(item.created_at).toLocaleString()} · {item.read_at ? 'Read' : 'Unread'} ·
        {item.priority==='HIGH'?' High priority':' Routine'} · {item.category.toLowerCase()}</p>
      <div className="ws-actions">
        <button className="ws-secondary" type="button" disabled={busy}
          onClick={() => void review(item)}>Review related area</button>
        {!item.read_at && <button className="ws-secondary" type="button" disabled={busy}
        onClick={() => void acknowledge(item, false)}>Mark as read</button>}
        <button className="ws-secondary" type="button" disabled={busy} onClick={() => void acknowledge(item, true)}>Dismiss</button></div>
    </li>)}</ul>
    {inbox?.items.length ? <p>Review opens an owner-only area. Unread notices are marked read only after the server acknowledges the action. Filters apply to loaded notices only.</p> : null}
    {inbox?.nextCursor && <button className="ws-secondary" type="button" disabled={busy} onClick={() => void more()}>Load more</button>}
  </SettingsCard><SettingsCard title="Optional in-app notifications">
    {preferencesLoading&&<p role="status">Loading notification preferences…</p>}
    {prefs===undefined&&!preferencesLoading&&preferenceMessage?.error&&<button type="button" className="ws-secondary" disabled={busy} onClick={reloadPreferences}>Retry notification preferences</button>}
    {prefs!==undefined&&preferencesStale&&!pendingPrefs&&<p role="status">Showing last confirmed preferences; reload or resolve the pending change before making another choice.</p>}
    {prefs?.version===Number.MAX_SAFE_INTEGER&&<p>Optional notices are disabled and cannot be re-enabled. Security and moderation notices remain required.</p>}
    {prefs?.preferences === null && prefs.version!==Number.MAX_SAFE_INTEGER && !pendingPrefs && <p role="status">No saved preference record was returned. Reviewer and publishing notices are enabled by default; draft-sync notices are off until enabled. Security and moderation notices cannot be muted here.</p>}
    {prefs !== undefined && ([
      ['reviewerEnabled', 'Reviewer activity'],
      ['publishEnabled', 'Publishing activity'],
      ['syncEnabled', 'Draft sync activity']
    ] as const).map(([key, label]) => (
      <label className="ws-settings-check" key={key}>
        <input type="checkbox" checked={displayedPrefs[key]} disabled={busy||preferencesLoading||preferencesStale||!!prefRetry||prefs?.version===Number.MAX_SAFE_INTEGER}
          onChange={event=>void savePreference(key,event.target.checked)}/> {label}
      </label>
    ))}
    {pendingPrefs && <p role="status">Saving notification preferences…</p>}
    <Status message={preferenceMessage}/>
    {prefs!==undefined&&preferencesStale&&<div className="ws-actions">{prefRetry&&<button type="button" className="ws-secondary" disabled={busy||preferencesLoading} onClick={()=>void applyPreference(prefRetry)}>Retry preference change</button>}
      <button type="button" className="ws-secondary" disabled={busy||preferencesLoading} onClick={reloadPreferences}>Reload confirmed preferences</button></div>}
    <p>Security and moderation notices use the required in-app channel. Email delivery is not confirmed by these settings. Changes are conditional on the last confirmed version and exact saved values. A conflict requires a fresh read and a new choice.</p>
  </SettingsCard></div>;
}

function Security({port}: {port: SupabaseBrowserAuthPort}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [confirmOthers, setConfirmOthers] = useState(false);
  const otherSessionsTrigger = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(emptyMessage);
  useEffect(() => {
    if (!confirmOthers || busy) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setConfirmOthers(false);
        otherSessionsTrigger.current?.focus();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [confirmOthers, busy]);
  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (next !== confirm) {setMessage({error: true, text: 'Passwords do not match.'}); return;}
    setBusy(true); setMessage(null);
    try {
      const outcome = await port.changePasswordWithCurrentPassword({ currentPassword: current, newPassword: next });
      if (outcome.error) throw new Error(outcome.error.message);
      setCurrent(''); setNext(''); setConfirm(''); setShowPasswords(false);
      setMessage({error: false, text: 'Password updated.'});
    } catch (error) {setMessage(failure(error));}
    finally {setBusy(false);}
  }
  async function revoke() {
    if (busy || !confirmOthers) return;
    setBusy(true); setMessage(null);
    try {
      const result = await port.signOut({scope: 'others'});
      if (result.error) throw new Error('Sign-out for other sessions could not be confirmed.');
      setConfirmOthers(false);
      otherSessionsTrigger.current?.focus();
      setMessage({error: false, text: 'Other sessions were signed out.'});
    } catch (error) {setMessage(failure(error));}
    finally {setBusy(false);}
  }

  return <><Status message={message}/><div className="ws-settings-grid">
    <SettingsCard title="Change password"><form className="ws-settings-form" onSubmit={event => void change(event)}>
      <label>Current password<input type={showPasswords?'text':'password'} required maxLength={128} autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)}/></label>
      <label>New password<input type={showPasswords?'text':'password'} required minLength={8} maxLength={128} autoComplete="new-password" value={next} onChange={event => setNext(event.target.value)}/></label>
      <label>Confirm new password<input type={showPasswords?'text':'password'} required minLength={8} maxLength={128} autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)}/></label>
      <button type="button" className="ws-secondary" aria-pressed={showPasswords} disabled={busy}
        onClick={() => setShowPasswords(value => !value)}>{showPasswords?'Hide password entries':'Show password entries'}</button>
      <button className="ws-primary" type="submit" disabled={busy}>Update password</button>
    </form></SettingsCard>
    <SettingsCard title="Other sessions"><p>Revoke access on other signed-in browsers and devices.
      This does not erase their browser storage or claim every already-issued access token has expired.</p>
      <button ref={otherSessionsTrigger} type="button" className="ws-secondary"
        disabled={busy} aria-expanded={confirmOthers} aria-controls="other-session-confirmation"
        onClick={() => setConfirmOthers(value => !value)}>Sign out other sessions</button>
      {confirmOthers && <div id="other-session-confirmation" role="group"
        aria-label="Confirm other-session sign-out" className="ws-release-confirm">
        <p>Sign out other sessions? This asks the authentication provider to revoke other sessions;
          this browser stays signed in. It cannot prove that already-issued tokens stop instantly.</p>
        <button type="button" className="ws-primary" disabled={busy}
          onClick={() => void revoke()}>{busy ? 'Signing out…' : 'Confirm sign out other sessions'}</button>
        <button type="button" className="ws-secondary" disabled={busy}
          onClick={() => {setConfirmOthers(false); otherSessionsTrigger.current?.focus();}}>Cancel</button>
      </div>}</SettingsCard>
    </div>
    <section className="ws-security-guidance" aria-labelledby="security-guidance-title">
      <h2 id="security-guidance-title">Security confirmations</h2>
      <p>Password changes require the current password. Signing out other sessions requires a separate
        confirmation; a per-device session directory is not available in this interface. Neither action
        should be mistaken for immediate expiry of previously issued access tokens.</p>
      <a href="/forgot-password">Check password recovery availability</a>
    </section></>;
}

export function MoveToTrash({port, kind, id, title, disabled, onMoved}: {
  port: SupabaseBrowserAuthPort; kind: PrivateTrashKind; id: string; title: string;
  disabled?: boolean; onMoved: () => void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [message,setMessage]=useState<Message>(null);
  const [uncertain,setUncertain]=useState(false);
  const [epoch]=useState(()=>port.getOwnerSessionEpoch());
  const scope=useMemo(()=>({port,kind,id,epoch}),[port,kind,id,epoch]);
  const activeScope=useRef<typeof scope|null>(null);
  const inFlight=useRef<typeof scope|null>(null);
  const uncertainScope=useRef<typeof scope|null>(null);
  useEffect(()=>{
    activeScope.current=scope;
    setBusy(false);setUncertain(false);setMessage(null);
    return()=>{activeScope.current=null;};
  },[scope]);
  const current=()=>activeScope.current===scope&&port.reconcileOwnerSessionEpoch()===epoch;
  async function move(){
    if(inFlight.current===scope||busy||disabled||uncertainScope.current===scope||!current())return;
    inFlight.current=scope;setBusy(true);setMessage(null);
    let sent=false;
    try{
      const {data}=await port.ownerSettings();
      if(!current())return;
      if(!data)throw new Error('Could not verify your private Trash session.');
      sent=true;
      await data.trash.move(kind,id);
      if(!current())return;
      dialog.current?.close();
      onMoved();
    }catch{
      if(!current())return;
      if(sent){
        uncertainScope.current=scope;setUncertain(true);
        setMessage({error:true,text:'The move was not confirmed. Review Trash and your library before trying again. No move or public withdrawal is assumed.'});
      }else setMessage({error:true,text:'Could not verify your private Trash session. Sign in again or retry when available.'});
    }finally{
      if(inFlight.current===scope)inFlight.current=null;
      if(current())setBusy(false);
    }
  }
  return <>
    <button ref={trigger} type="button" className="ws-secondary" disabled={disabled}
      onClick={()=>{if(!current()||inFlight.current===scope)return;if(uncertainScope.current!==scope)setMessage(null);dialog.current?.showModal();}}>Move to Trash</button>
    <dialog ref={dialog} className="ws-project-dialog ws-lifecycle-dialog" aria-labelledby={titleId}
      onCancel={event=>{if(inFlight.current===scope)event.preventDefault();}} onClose={()=>{if(current())trigger.current?.focus();}}>
      <h2 id={titleId}>Move {title} to Trash?</h2>
      <p>You can restore this {kind} privately within 15 days. Any public delivery requires separate withdrawal verification.</p>
      <Status message={message}/>
      <div className="ws-actions">
        <button autoFocus type="button" className="ws-secondary" disabled={busy}
          onClick={()=>dialog.current?.close()}>Cancel</button>
        <button type="button" className="ws-primary" disabled={busy||uncertain}
          onClick={()=>void move()}>{busy?'Moving…':'Confirm move to Trash'}</button>
        {uncertain&&<a className="ws-secondary" href="/app/trash">Review Trash before retrying</a>}
      </div>
    </dialog>
  </>;
}

function Trash({port,service}: {port:SupabaseBrowserAuthPort;service:Services['trash']}) {
  const [epoch]=useState(()=>port.getOwnerSessionEpoch());
  const alive=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const current=()=>alive.current&&port.reconcileOwnerSessionEpoch()===epoch;
  const inFlight=useRef(false);
  const reading=useRef(true);
  const [needsReadback,setNeedsReadback]=useState(false);
  const readbackRequired=useRef(false);
  const uncertainRestore=useRef(false);
  const [loading,setLoading]=useState(true);
  const [items, setItems] = useState<PrivateTrashEntry[] | null>(null);
  const [message, setMessage] = useState<Message>(emptyMessage);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [expiredByServer, setExpiredByServer] = useState<Set<string>>(()=>new Set());
  useEffect(() => {
    let active=true;reading.current=true;setLoading(true);
    void service.list().then(rows=>{
      if(active&&current()){
        setItems(rows);setNow(Date.now());
        const visibleKeys=new Set(rows.map(row=>row.item_type+':'+row.item_id+':'+row.trashed_at));
        setExpiredByServer(previous=>new Set([...previous].filter(key=>visibleKeys.has(key))));
        readbackRequired.current=false;setNeedsReadback(false);
        setMessage(uncertainRestore.current?{error:false,text:'Trash refreshed. The previous restore was not acknowledged; verify your private library before retrying.'}:null);
        uncertainRestore.current=false;
      }
    }).catch(()=>{
      if(active&&current()){readbackRequired.current=true;setNeedsReadback(true);setMessage({error:true,text:'Trash could not be read. Refresh confirmed records before restoring.'});}
    }).finally(()=>{
      if(active&&current()){reading.current=false;setLoading(false);}
    });
    return()=>{active=false;};
  },[service,port,epoch,reload]);
  function refreshTrash(){
    if(!current()||inFlight.current||reading.current)return;
    reading.current=true;setLoading(true);setReload(n=>n+1);
  }

  useEffect(()=>{
    if (!items?.length) return;
    const next = Math.min(...items.map(item=>Date.parse(item.restore_until)).filter(deadline=>deadline>now));
    const update = () => setNow(Date.now());
    const timer = Number.isFinite(next)
      ? window.setTimeout(update, Math.max(0,next-Date.now()))
      : undefined;
    window.addEventListener('focus',update);
    document.addEventListener('visibilitychange',update);
    return ()=>{
      if (timer!==undefined) window.clearTimeout(timer);
      window.removeEventListener('focus',update);
      document.removeEventListener('visibilitychange',update);
    };
  },[items,now]);

  async function restore(item: PrivateTrashEntry) {
    const key = item.item_type+':'+item.item_id+':'+item.trashed_at;
    if(inFlight.current||busy||reading.current||readbackRequired.current||!current()||expiredByServer.has(key)||
      !items?.some(row=>row.item_type===item.item_type&&row.item_id===item.item_id&&row.trashed_at===item.trashed_at))return;
    if (Date.parse(item.restore_until)<=Date.now()) {
      setNow(Date.now());
      setMessage({error:true,text:'The restore deadline has passed.'});
      return;
    }
    inFlight.current=true;setBusy(true);setMessage(null);
    try{
      const receipt=await service.restore(item.item_type,item.item_id);
      if(!current())return;
      if(receipt.status!=='restored'||receipt.public_visibility!=='private')
        throw new PrivateTrashError('INVALID_STATE','Private restore was not confirmed.');
      setItems(rows=>rows?.filter(row=>row.item_id!==item.item_id||row.item_type!==item.item_type||row.trashed_at!==item.trashed_at)??[]);
      setMessage({error:false,text:'Item restored as private.'});
    }catch(error){
      if(!current())return;
      if(error instanceof PrivateTrashError&&error.code==='TRASH_EXPIRED'){
        setExpiredByServer(previous=>new Set(previous).add(key));setMessage(failure(error));
      }else{
        readbackRequired.current=true;uncertainRestore.current=true;setNeedsReadback(true);
        setMessage({error:true,text:'Restore was not confirmed. Refresh Trash and review your private library before retrying.'});
      }
    }finally{
      inFlight.current=false;if(current())setBusy(false);
    }
  }

  return <div className="ws-settings-grid"><SettingsCard title="Recoverable items">
    <Status message={message}/>
    {loading&&<p role="status">Loading Trash…</p>}
    {!loading&&(items!==null||needsReadback)&&<button type="button" className="ws-secondary" disabled={busy} onClick={refreshTrash}>{needsReadback?(items?'Refresh confirmed Trash':'Retry Trash'):'Refresh Trash'}</button>}
    {needsReadback&&items!==null&&<p>Showing the last confirmed records. Restore remains unavailable until refresh succeeds.</p>}
    {items?.length===0&&!loading&&!needsReadback&&<p>Trash is empty.</p>}
    {items?.length===100&&<p>Showing up to 100 loaded Trash records, not an account-wide total.</p>}
    <ul className="ws-settings-records">{items?.map(item => {
      const expired = Date.parse(item.restore_until)<=now ||
        expiredByServer.has(item.item_type+':'+item.item_id+':'+item.trashed_at);
      return <li key={item.item_type + ':' + item.item_id}>
        <strong>{item.item_type} · {item.item_id.slice(0, 8)}</strong>
        <p>Moved to Trash <time dateTime={item.trashed_at}>{new Date(item.trashed_at).toLocaleString()}</time></p>
        <p>Restore by <time dateTime={item.restore_until}>{new Date(item.restore_until).toLocaleString()}</time></p>
        {expired && <p>Recovery window ended. Restore is unavailable.</p>}
        <button type="button" className="ws-secondary" disabled={busy||loading||needsReadback||expired}
          onClick={() => void restore(item)}>Restore privately</button>
      </li>;
    })}</ul>
  </SettingsCard><SettingsCard title="15-day recovery window">
    <p>Restored items return to your library as private drafts. Recovery ends at the deadline shown for each item.</p>
    <p>Expired items are eligible for scheduled cleanup. Permanent removal is unavailable from this page. An expired deadline is not proof of primary deletion or backup erasure.</p>
    <div className="ws-actions"><a href="/app/projects">Project library</a><a href="/app/portfolios">Portfolio library</a></div>
  </SettingsCard></div>;
}

export function downloadPrivateFile(filename: string, bytes: Uint8Array, mime: string) {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], {type: mime}));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

type ExportKind = 'metadata'|'recovery'|'recovery-json'|'source';
type ExportReceipt = {kind:ExportKind;filename:string;bytes:number;sha256:string;scope:string;capturedAt?:string;revision?:number;assets?:number;assetFiles?:number;categories?:number;records?:number};
const formatExportBytes=(bytes:number)=>bytes>=1024*1024?(bytes/(1024*1024)).toFixed(2)+' MiB':(bytes/1024).toFixed(1)+' KiB';
async function exportDigest(bytes:Uint8Array):Promise<string>{
  const digest=await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function ExportCenter({port, services}: {port: SupabaseBrowserAuthPort; services: Services}) {
  const [epoch] = useState(()=>port.getOwnerSessionEpoch());
  const alive=useRef(false);
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  const current=()=>alive.current&&port.reconcileOwnerSessionEpoch()===epoch;
  const [message, setMessage] = useState<Message>(emptyMessage);
  const [busy, setBusy] = useState<ExportKind|null>(null);
  const operation=useRef<string|null>(null);
  const running=useRef(false);
  const [failedKind,setFailedKind]=useState<ExportKind|null>(null);
  const [quotaBlocked,setQuotaBlocked]=useState(false);
  const [receipt,setReceipt]=useState<ExportReceipt|null>(null);
  const [inventory,setInventory]=useState<Awaited<ReturnType<Services['account']['captureInventory']>>|null>(null);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState('');
  type Page=NonNullable<Awaited<ReturnType<SupabaseBrowserAuthPort['listOwnerPortfoliosPage']>>['data']>;
  const listRequest = useMemo(()=>({port,epoch,retry}),[port,epoch,retry]);
  const [listResult,setListResult] = useState<{
    request:typeof listRequest;page:Page|null;error:string
  }|null>(null);
  const [loadingMore,setLoadingMore]=useState(false);
  const [moreError,setMoreError]=useState('');
  const currentList = listResult?.request===listRequest ? listResult : null;
  const page=currentList?.page??null;
  const portfolios = page?.items.filter(item=>item.revision>0)??null;
  const portfolioError = currentList?.error??'';
  const selectedPortfolio = portfolios?.find(item=>item.id===selected);
  useEffect(()=>{
    let active = true;
    void port.listOwnerPortfoliosPage(50).then(({data,error})=>{
      if (!active || port.reconcileOwnerSessionEpoch()!==epoch) return;
      if (!data) throw new Error(error?.message??'Saved portfolios could not be loaded.');
      setListResult({request:listRequest,page:data,error:''});
    }).catch(()=>{
      if(active&&port.reconcileOwnerSessionEpoch()===epoch)setListResult({
        request:listRequest,page:null,error:'Saved portfolios could not be loaded.'
      });
    });
    return ()=>{active=false;};
  },[port,epoch,listRequest]);

  async function more(){
    if(!page?.nextCursor||loadingMore||busy||!current())return;
    const cursor=page.nextCursor;
    setLoadingMore(true);setMoreError('');
    try{
      const result=await port.listOwnerPortfoliosPage(50,cursor);
      if(!current())return;
      if(!result.data)throw new Error('Could not load older saved portfolios.');
      const next=result.data;
      setListResult(previous=>{
        if(previous?.request!==listRequest||previous.page?.nextCursor!==cursor)return previous;
        const seen=new Set(previous.page.items.map(item=>item.id));
        return {...previous,page:{...next,items:[...previous.page.items,...next.items.filter(item=>!seen.has(item.id))]}};
      });
    }catch(error){
      if(current())setMoreError(error instanceof Error?error.message:'Could not load older portfolios.');
    }finally{if(current())setLoadingMore(false);}
  }

  async function download(kind: ExportKind) {
    if(running.current||busy||!current()||(kind==='source'&&!selectedPortfolio)||
      (kind!=='source'&&quotaBlocked&&!inventory))return;
    // Capture has a durable owner quota. Reuse one acknowledged inventory
    // across formats and retries; only an explicit refresh requests a new one.
    // An unacknowledged capture replays its original operation UUID.
    running.current=true;setBusy(kind);setMessage(null);setReceipt(null);setFailedKind(null);
    try {
      let file:ExportReceipt;
      let bytes:Uint8Array;
      let mime='application/zip';
      if (kind==='source') {
        const selection=selectedPortfolio!;
        const {exportPortfolioSourceZip,importPortfolioSourceZip} = await import('../../../packages/storage-adapters/src/portable-source-archive.ts');
        if(!current())return;
        const {data} = await port.readOwnerPortfolio(selection.id);
        if(!current())return;
        if (!data?.snapshot || data.id!==selection.id || data.revision!==selection.revision)
          throw new Error('The saved revision changed or could not be verified. Refresh the portfolio list before exporting.');
        bytes=exportPortfolioSourceZip(data.snapshot);
        importPortfolioSourceZip(bytes);
        file={kind,filename:'kadmeion-portfolio-revision-'+data.revision+'.zip',bytes:bytes.byteLength,
          sha256:await exportDigest(bytes),scope:'Editable saved portfolio source; uploaded media excluded.',revision:data.revision};
      } else {
        if(!inventory)operation.current??=crypto.randomUUID();
        const captured = inventory??await services.account.captureInventory(operation.current!,null);
        if(!current())return;
        operation.current=null;setInventory(captured);
        if (kind==='metadata') {
          const result = await services.data.exportApplicationMetadata(captured.snapshotId);
          if(!current())return;
          bytes=result.bytes;mime=result.mime;
          // The exporter has already checked owner, envelope, schema, and bounds.
          const decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as {
            capturedAt:string;records:Record<string,unknown[]>;restrictedAudit:Record<string,unknown[]>;verifiedReleaseHistory:unknown[]
          };
          const categories=[...Object.values(decoded.records),...Object.values(decoded.restrictedAudit),decoded.verifiedReleaseHistory];
          file={kind,filename:result.filename,bytes:bytes.byteLength,sha256:await exportDigest(bytes),
            capturedAt:decoded.capturedAt,scope:'Acknowledged application metadata snapshot; no Storage bytes or provider data.',
            categories:categories.length,records:categories.reduce((count,rows)=>count+rows.length,0)};
        } else {
          const result = await services.data.export(captured.snapshotId);
          if(!current())return;
          const {createBoundedPrivateAccountRecoveryBundle,verifyBoundedPrivateAccountExport} =
            await import('../../../packages/storage-adapters/src/private-account-data-export.ts');
          if(!current())return;
          if(kind==='recovery-json'){
            const verified=await verifyBoundedPrivateAccountExport(result.bytes);
            bytes=result.bytes;mime=result.mime;
            file={kind,filename:result.filename,bytes:bytes.byteLength,sha256:verified.sha256,
              capturedAt:captured.capturedAt,scope:'Verified bounded partial recovery JSON; private data, not a full account export.'};
          }else{
            const bundle = await createBoundedPrivateAccountRecoveryBundle(result.bytes);
            bytes=bundle.zip;
            file={kind,filename:bundle.filename,bytes:bytes.byteLength,sha256:bundle.sha256,
              capturedAt:captured.capturedAt,scope:'Verified bounded partial recovery ZIP; private data, not a full account export.',
              assets:bundle.assetsReferenced,assetFiles:bundle.assetFiles};
          }
        }
      }
      // Critical final check: no stale owner download even if hashing/importing
      // or archive creation finished after logout or a same-port owner switch.
      if(!current())return;
      downloadPrivateFile(file.filename,bytes,mime);
      setReceipt(file);
      setMessage({error:false,text:kind==='recovery'?'Private recovery download prepared.':kind==='metadata'?'Application metadata download prepared.':kind==='source'?'Portfolio source download prepared.':'Verified recovery JSON download prepared.'});
    } catch (error) {
      if(!current())return;
      const code=typeof error==='object'&&error!==null&&'code' in error?error.code:undefined;
      const terminal=code==='QUOTA_EXCEEDED'||code==='AUTH_EXPIRED'||code==='FORBIDDEN'||code==='LIMIT_EXCEEDED';
      setFailedKind(terminal?null:kind);
      if(code==='QUOTA_EXCEEDED'){
        setQuotaBlocked(true);
        setMessage({error:true,text:'The durable account inventory quota has been reached (at most 10 snapshots per owner). No file was downloaded. No new inventory will be requested in this session; eligible saved portfolio source exports do not consume this quota.'});
      }else if(code==='RATE_LIMITED')
        setMessage({error:true,text:'The server temporarily rate-limited the export. No file was downloaded. Retry later; the same acknowledged inventory or original capture operation will be reused.'});
      else if(code==='LIMIT_EXCEEDED')
        setMessage({error:true,text:'The export exceeds a supported size or record limit. No file was downloaded. Choose a narrower saved portfolio source or try metadata / verified JSON where eligible.'});
      else if(code==='AUTH_EXPIRED'||code==='FORBIDDEN')
        setMessage({error:true,text:'The current owner session could not authorize the export. Sign in again before retrying.'});
      else if(code==='INTEGRITY'||code==='UNVERIFIED'||code==='INVALID_ACK')
        setMessage({error:true,text:'The export could not verify inventory, file hashes or server acknowledgment. No file was downloaded. Review metadata or retry when the source is consistent.'});
      else setMessage(failure(error));
    } finally {
      running.current=false;
      if(current())setBusy(null);
    }
  }

  function refreshPortfolios(){
    setSelected('');setMoreError('');setRetry(value=>value+1);
  }
  return <><Status message={message}/>
    {failedKind&&<div className="ws-actions">
      <button type="button" className="ws-secondary" disabled={busy!==null||(failedKind==='source'&&!selectedPortfolio)}
        onClick={()=>void download(failedKind)}>Retry failed export</button>
    </div>}
    {receipt&&<SettingsCard title="Latest download receipt">
      <p>{receipt.scope}</p>
      <dl><dt>Filename</dt><dd>{receipt.filename}</dd><dt>Size</dt><dd>{formatExportBytes(receipt.bytes)}</dd>
        {receipt.revision!==undefined&&<><dt>Saved revision</dt><dd>{receipt.revision}</dd></>}
        {receipt.capturedAt&&<><dt>Captured</dt><dd>{new Date(receipt.capturedAt).toLocaleString()}</dd></>}
        {receipt.categories!==undefined&&<><dt>Record categories</dt><dd>{receipt.categories}</dd><dt>Records in artifact (not unique entities)</dt><dd>{receipt.records}</dd></>}
        {receipt.assets!==undefined&&<><dt>Asset references</dt><dd>{receipt.assets}</dd><dt>Distinct archive files for assets</dt><dd>{receipt.assetFiles}</dd></>}
        <dt>SHA-256 (local artifact checksum)</dt><dd style={{overflowWrap:'anywhere'}}><code>{receipt.sha256}</code></dd></dl>
      <p>The browser was asked to download these bytes. This checksum identifies the prepared bytes, not a provider signature, proof of saved file, or erasure receipt.</p>
    </SettingsCard>}
    <div className="ws-settings-grid">
    <SettingsCard title="Editable portfolio ZIP">
      <p>Download a selected saved revision for editing or recovery. Private source is included; uploaded media, external repositories and unsaved editor buffers are excluded. Archive limit: 2 MiB, up to 101 entries and 256 KiB per entry.</p>
      {portfolioError && <><p role="alert">{portfolioError}</p><button type="button" className="ws-secondary"
        onClick={refreshPortfolios}>Retry portfolio list</button></>}
      {!portfolios && !portfolioError && <p role="status">Loading saved portfolios…</p>}
      {portfolios?.length===0 && <p>{page?.nextCursor?'No saved revisions in the loaded records. Load older portfolios to continue.':'No saved portfolio revisions to export.'}</p>}
      {portfolios&&<p>{portfolios.length} saved portfolios in loaded records.{page?.nextCursor?' More records are available; this is not an account-wide total.':''}</p>}
      {!!portfolios?.length && <><label className="ws-export-select">Portfolio to export
        <select value={selectedPortfolio?.id??''} disabled={busy!==null} onChange={event=>{setSelected(event.target.value);setFailedKind(null);setMessage(null);}}>
          <option value="">Select a portfolio</option>
          {portfolios.map(item=><option key={item.id} value={item.id}>{item.title} · revision {item.revision}</option>)}
        </select></label>
        <button className="ws-primary" type="button" disabled={!selectedPortfolio || busy!==null}
          onClick={()=>void download('source')}>{busy==='source'?'Preparing portfolio ZIP…':'Download portfolio source ZIP'}</button></>}
      {moreError&&<p role="alert">{moreError}</p>}
      {page?.nextCursor&&<button type="button" className="ws-secondary" disabled={loadingMore||busy!==null}
        onClick={()=>void more()}>{loadingMore?'Loading older portfolios…':moreError?'Retry older portfolios':'Load more portfolios'}</button>}
      {portfolios&&<button type="button" className="ws-secondary" disabled={loadingMore||busy!==null}
        onClick={refreshPortfolios}>Refresh saved portfolios</button>}
    </SettingsCard>
    <SettingsCard title="Private account data">
      <p>Choose an acknowledged application metadata JSON snapshot or bounded private recovery archive. Neither terminates access nor erases your account.</p>
      {!inventory&&!quotaBlocked&&<p>Choosing an account download explicitly requests an inventory if this session has none. If an earlier capture was not acknowledged, the same operation is retried; it may allocate a snapshot only if the original did not commit. No inventory is captured when this page loads.</p>}
      <h3>Application metadata JSON</h3>
      <p>Owner profile, projects, portfolio revisions, asset metadata, private goals, preferences, notifications, components and restricted owner audit/release records. Up to 100 records per category and a 12 MiB response limit; larger accounts may be refused. No uploaded bytes.</p>
      <button className="ws-primary" type="button" disabled={busy!==null||(quotaBlocked&&!inventory)}
        onClick={()=>void download('metadata')}>{busy==='metadata'?'Preparing export…':'Download application metadata'}</button>
      <h3>Bounded recovery archive</h3>
      <p>Includes eligible owner records plus independently checked asset bytes where trusted pins and current storage metadata agree. Up to 100 records per category, 8 assets, 5 MiB per asset, 8 MiB total asset bytes, 16 MiB recovery JSON and 10 MiB ZIP capacity. No partial file on verification failure.</p>
      <div className="ws-actions">
        <button className="ws-secondary" type="button" disabled={busy!==null||(quotaBlocked&&!inventory)}
          onClick={()=>void download('recovery')}>{busy==='recovery'?'Checking records and files…':'Download private recovery ZIP'}</button>
        <button className="ws-secondary" type="button" disabled={busy!==null||(quotaBlocked&&!inventory)}
          onClick={()=>void download('recovery-json')}>{busy==='recovery-json'?'Checking recovery JSON…':'Download verified recovery JSON'}</button>
      </div>
      <p>Verified recovery JSON is an alternative for archives that exceed ZIP capacity, not a bypass for asset or integrity limits.</p>
      <p>The server allows at most 10 recorded account inventory snapshots per owner. Formats and retries reuse this session’s acknowledged inventory until you explicitly refresh it. Remaining quota is not reported by the service. An export after opening a new session may allocate one snapshot; no background capture or prior-scope lookup is performed.</p>
      {quotaBlocked&&!inventory&&<p role="status">New account inventory captures are blocked for this session because the server reported its durable quota.</p>}
      {inventory&&<><h3>Acknowledged inventory</h3>
        <p>Captured {new Date(inventory.capturedAt).toLocaleString()}. Inventory is metadata only; an application metadata export reads current records separately. Recovery rechecks storage and prior inventory consistency.</p>
        <button type="button" className="ws-secondary" disabled={busy!==null||quotaBlocked} onClick={()=>{
          if(!current()||running.current||quotaBlocked)return;setInventory(null);operation.current=null;setFailedKind(null);setReceipt(null);setMessage(null);
        }}>Use a new inventory for next export</button>
        <dl><dt>Projects</dt><dd>{inventory.inventory.counts.projects}</dd><dt>Portfolios</dt><dd>{inventory.inventory.counts.portfolios}</dd>
          <dt>Portfolio revisions</dt><dd>{inventory.inventory.counts.portfolioRevisions}</dd><dt>Registered assets</dt><dd>{inventory.inventory.counts.projectAssetMetadata}</dd>
          <dt>Trash records</dt><dd>{inventory.inventory.counts.trashRecords}</dd></dl>
        {inventory.inventory.countsCapped&&<p>Some inventory counts are capped at {inventory.inventory.maxCountPerCategory} records.</p>}
      </>}
    </SettingsCard>
    <SettingsCard title="Offline static preview">
      <p>Run preflight on a saved revision to download an eligible scriptless HTML preview. The ZIP has no public URL and excludes custom code and private media.</p>
      {selectedPortfolio
        ? <a href={'/app/portfolios/'+selectedPortfolio.id+'/publish'}>Open preflight for selected portfolio</a>
        : <p>Select a saved portfolio above to open its preflight.</p>}
    </SettingsCard>
    <SettingsCard title="Coverage and exclusions">
      <p>Keep downloads private. They may contain personal information and editable source. Provider credentials, session tokens, restricted admin data, external platform records, backups, caches and third-party copies are not exported.</p>
      <p>Inventory quotas and provider availability may prevent preparation. Downloading an archive does not revoke public links, validate independent hosting, restore account access, or authorize deletion. External release/retention proof remains separate.</p>
      <a href="/app/settings/account/delete">Review account exit prerequisites</a>
    </SettingsCard>
  </div></>;
}

// A successful transport receipt is not sufficient to show success if the
// subsequent authoritative history disagrees or a different request is active.
const confirmedExit: (receipt:AccountErasureReceipt,history:PrivateAccountErasureEntry[],requestId:string|null)=>boolean = (receipt,history,requestId)=> {
  const matching=history.find(row=>row.id===receipt.requestId);
  if(requestId===null)
    return receipt.status==='REQUESTED_BLOCKED'&&matching?.status==='REQUESTED_BLOCKED'&&
      history.filter(row=>row.status==='REQUESTED_BLOCKED').length===1;
  return receipt.requestId===requestId&&receipt.status==='WITHDRAWN'&&matching?.status==='WITHDRAWN';
};

function AccountExit({port,service}: {port: SupabaseBrowserAuthPort; service: Services['account']}) {
  // The shell mounts this consumer only after live owner verification.
  // Capture the mount's epoch: never adopt a newer one from an old handler.
  const [epoch] = useState(() => port.getOwnerSessionEpoch());
  const mounted = useRef(false);
  const [recovery, setRecovery] = useState<'checking'|'failed'|'ready'>('checking');
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const [inventory, setInventory] = useState<AccountExitPreflight | null>(null);
  const [requests, setRequests] = useState<PrivateAccountErasureEntry[] | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const inFlight=useRef(false);
  const operation = useRef<{key:string;id:string} | null>(null);
  const challenge = useRef<AccountExitReauthChallenge|null>(null);
  const challengeOperation = useRef<string|null>(null);
  const [recoveredProof, setRecoveredProof] = useState<{requestId:string;verification:AccountExitReauthVerification}|null>(null);
  const [withdrawConfirmation, setWithdrawConfirmation] = useState('');
  const withdrawalOperation = useRef<string|null>(null);
  const activeRequest = requests?.find(item=>item.status==='REQUESTED_BLOCKED');
  const reauth = recoveredProof && activeRequest?.id === recoveredProof.requestId ? recoveredProof.verification : null;

  const current = () => mounted.current && port.reconcileOwnerSessionEpoch() === epoch;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // A successful intentional password rotation replaces the private subtree.
  // Recover the exact server-bound continuation in this new verified mount.
  // No receipt/password is persisted in browser storage or passed by the shell.
  useEffect(() => {
    let active = true;
    const stillCurrent = () => active && port.reconcileOwnerSessionEpoch() === epoch;
    setRecovery('checking');
    setMessage(null);
    setRecoveredProof(null);
    setWithdrawConfirmation('');
    withdrawalOperation.current = null;
    void (async () => {
      try {
        if (!stillCurrent()) return;
        const recovered = await port.recoverOwnerAccountExitReauth(epoch);
        if (!stillCurrent()) return;
        if (recovered.error) throw new Error(recovered.error.message);
        if (recovered.data) {
          const {requestId, verification} = recovered.data;
          const [result, history] = await Promise.all([service.preflight(),service.list()]);
          if (!stillCurrent()) return;
          if (history.find(item => item.status === 'REQUESTED_BLOCKED')?.id !== requestId ||
              !Number.isFinite(Date.parse(verification.expiresAt)) ||
              Date.parse(verification.expiresAt) <= Date.now()) {
            port.discardOwnerAccountExitReauth(epoch);
            throw new Error('The account-exit verification is expired or the request is no longer pending.');
          }
          setInventory(result);
          setRequests(history);
          setRecoveredProof({requestId,verification});
        }
        setRecovery('ready');
      } catch (error) {
        if (!stillCurrent()) return;
        setInventory(null);
        setRequests(null);
        setRecoveredProof(null);
        setMessage(failure(error));
        setRecovery('failed');
      }
    })();
    // Do not discard the pointer on cleanup: StrictMode and the intentional
    // epoch remount are not explicit cancellation.
    return () => { active = false; };
  }, [port,service,epoch,recoveryAttempt]);

  function discardProof() {
    port.discardOwnerAccountExitReauth(epoch);
    setRecoveredProof(null);
    setWithdrawConfirmation('');
    withdrawalOperation.current = null;
  }

  // A confirmed challenge is short-lived. Do not leave a success receipt or
  // destructive confirmation visible after its deadline, even without a click.
  useEffect(() => {
    if (!reauth) return;
    let timer: number | undefined;
    const reviewExpiry = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      const remaining = Date.parse(reauth.expiresAt) - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) {
        if (port.reconcileOwnerSessionEpoch() !== epoch) return;
        port.discardOwnerAccountExitReauth(epoch);
        setRecoveredProof(null);
        setWithdrawConfirmation('');
        withdrawalOperation.current = null;
        setMessage({error:true,text:'Identity verification expired. Sign in again to withdraw content.'});
        return;
      }
      timer = window.setTimeout(reviewExpiry, Math.min(remaining, 60_000));
    };
    reviewExpiry();
    window.addEventListener('focus', reviewExpiry);
    document.addEventListener('visibilitychange', reviewExpiry);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('focus', reviewExpiry);
      document.removeEventListener('visibilitychange', reviewExpiry);
    };
  }, [reauth,port,epoch]);

  async function check() {
    if (inFlight.current || busy || recovery !== 'ready' || !current()) return;
    inFlight.current=true;setBusy(true);
    setMessage(null);
    discardProof();
    challenge.current=null;
    challengeOperation.current=null;
    setInventory(null);
    setRequests(null);
    setConfirmation('');
    try {
      const [result, history] = await Promise.all([service.preflight(),service.list()]);
      if (!current()) return;
      setInventory(result);
      setRequests(history);
      // Only abandon an ambiguous command when the fresh history confirms
      // the target state. A missing record alone never permits a new UUID.
      if(operation.current&&(operation.current.key==='request'?
        history.some(row=>row.status==='REQUESTED_BLOCKED'):
        history.some(row=>row.id===operation.current?.key&&row.status==='WITHDRAWN')))
        operation.current=null;
    } catch (error) {
      if (current()) setMessage(failure(error));
    } finally {
      inFlight.current=false;
      if (current()) setBusy(false);
    }
  }

  async function changeRequest(requestId: string | null) {
    if (inFlight.current || busy || recovery !== 'ready' || !inventory || !requests || !current()) return;
    if (requestId ? activeRequest?.id!==requestId : !!activeRequest || confirmation!=='DELETE MY ACCOUNT') return;
    discardProof();
    challenge.current=null;
    challengeOperation.current=null;
    const key = requestId ?? 'request';
    if (operation.current?.key!==key) operation.current={key,id:crypto.randomUUID()};
    const command=operation.current;
    inFlight.current=true;setBusy(true);
    setMessage(null);
    // Do not allow reauthentication or another destructive intent while the
    // outcome of an account request remains unknown.
    setRequests(null);setConfirmation('');
    try {
      const receipt=requestId?await service.withdraw(requestId,command.id):
        await service.request(command.id,'DELETE MY ACCOUNT');
      if (!current()) return;
      const history=await service.list();
      if (!current()) return;
      setRequests(history);
      if(!confirmedExit(receipt,history,requestId)){
        if(history.some(row=>row.id===receipt.requestId&&row.status==='WITHDRAWN'))operation.current=null;
        setMessage({error:true,text:'The account request changed or could not be confirmed by current history. Review the prerequisites before retrying.'});
        return;
      }
      operation.current=null;
      setMessage({error:false,text:requestId?'Account deletion request withdrawn.':'Deletion request recorded. No data has been erased.'});
    } catch (error) {
      if (current()) setMessage({error:true,text:'The account request was not confirmed. Review deletion prerequisites to refresh the current state before retrying.'});
    } finally {
      inFlight.current=false;
      if (current()) setBusy(false);
    }
  }

  async function verifyIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || busy || recovery !== 'ready' || !activeRequest || !current()) return;
    const form=event.currentTarget;
    const password=new FormData(form).get('current-password');
    if (typeof password!=='string' || !password) return;
    form.reset();
    inFlight.current=true;setBusy(true);
    setMessage(null);
    discardProof();
    try {
      if (challenge.current && Date.parse(challenge.current.expiresAt)<=Date.now()) {
        challenge.current=null;
        challengeOperation.current=null;
      }
      challengeOperation.current ??= crypto.randomUUID();
      challenge.current ??= await service.beginReauth(challengeOperation.current);
      if (!current()) return;
      if (Date.parse(challenge.current.expiresAt)<=Date.now()) {
        challenge.current=null;
        challengeOperation.current=null;
        throw new Error('Identity verification challenge expired. Try again.');
      }
      // S1 owns the intentional session rotation and continuation. Keep the
      // same challenge/operation for a failed password before rotation.
      const result=await port.reauthenticateCurrentOwner(password,{
        expectedEpoch:epoch,requestId:activeRequest.id,challengeId:challenge.current.challengeId
      });
      if (!current()) return;
      if (result.error) throw new Error(result.error.message);
      // A successful rotation must invalidate this mount; never complete with
      // this old service or announce success without authoritative readback.
      throw new Error('A new verified session could not be established. Try again.');
    } catch (error) {
      if (current()) setMessage(failure(error));
    } finally {
      inFlight.current=false;
      if (current()) setBusy(false);
    }
  }

  async function withdrawAppContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || busy || recovery !== 'ready' || !activeRequest || !reauth || !current() || withdrawConfirmation!=='WITHDRAW PUBLIC CONTENT') return;
    if (Date.parse(reauth.expiresAt)<=Date.now()) {
      discardProof();
      setMessage({error:true,text:'Identity verification expired. Sign in again to withdraw content.'});
      return;
    }
    withdrawalOperation.current ??= crypto.randomUUID();
    inFlight.current=true;setBusy(true);
    setMessage(null);
    try {
      const receipt=await service.withdrawPublicContent(activeRequest.id,reauth.challengeId,
        withdrawalOperation.current,'WITHDRAW PUBLIC CONTENT');
      if (!current()) return;
      discardProof();
      setMessage({error:false,text:'Application withdrawal confirmed. Reviewer grants revoked: '+
        receipt.revokedReviewerGrants+'. Independent host withdrawal remains unverified.'});
    } catch (error) {
      if (current()) setMessage(failure(error));
    } finally {
      inFlight.current=false;
      if (current()) setBusy(false);
    }
  }

  return <><Status message={message}/><div className="ws-settings-grid">
    <SettingsCard title="Deletion prerequisites">
      {recovery === 'checking' && <p role="status">Checking current identity verification…</p>}
      {recovery === 'failed' && <div className="ws-actions">
        <button type="button" className="ws-secondary" onClick={()=>setRecoveryAttempt(value=>value+1)}>Retry identity verification recovery</button>
        <button type="button" className="ws-secondary" onClick={()=>{
          if (!current()) return;
          discardProof();
          setMessage(null);
          setRecovery('ready');
        }}>Cancel identity verification</button>
      </div>}
      <p>Account deletion requires fresh identity verification, public revocation and storage checks. You can record or withdraw a request while these checks are pending.</p>
      <button className="ws-primary" type="button" disabled={busy || recovery !== 'ready'}
        onClick={()=>void check()}>Review deletion prerequisites</button>
      {inventory && <section aria-label="Private inventory" className="ws-exit-inventory">
        <h3>Private inventory</h3>
        <dl><dt>Projects</dt><dd>{inventory.counts.projects}</dd><dt>Portfolios</dt><dd>{inventory.counts.portfolios}</dd>
          <dt>Portfolio revisions</dt><dd>{inventory.counts.portfolioRevisions}</dd>
          <dt>Registered files</dt><dd>{inventory.counts.projectAssetMetadata}</dd>
          <dt>Reviewer grants</dt><dd>{inventory.counts.reviewerGrants}</dd>
          <dt>Trash records</dt><dd>{inventory.counts.trashRecords}</dd></dl>
        {inventory.countsCapped && <p>Some categories show up to {inventory.maxCountPerCategory} records.</p>}
        <p>Public route withdrawal, storage cleanup, provider data and backups require separate verification.</p>
      </section>}
      <a href="/app/export">Open export center</a>
    </SettingsCard>
    <SettingsCard title="Account deletion request">
      {!requests && <p>Review the prerequisites to check your request history.</p>}
      {activeRequest && <>
        <p>Request pending verification. Your account and private data are still available.</p>
        <button type="button" className="ws-secondary" disabled={busy}
          onClick={()=>void changeRequest(activeRequest.id)}>Withdraw deletion request</button>
        <form onSubmit={event=>void verifyIdentity(event)}>
          <label className="ws-export-select">Current password for identity verification
            <input type="password" name="current-password" autoComplete="current-password" required maxLength={128} disabled={busy}/>
          </label>
          <button type="submit" className="ws-secondary" disabled={busy}>Verify identity for account exit</button>
        </form>
        {reauth && <>
          <p role="status">Fresh sign-in verified. Proof expires at <time dateTime={reauth.expiresAt}>{new Date(reauth.expiresAt).toLocaleTimeString()}</time>. Deletion remains gated.</p>
          <button type="button" className="ws-secondary" disabled={busy} onClick={()=>{
            if (!current()) return;
            discardProof();
            setMessage(null);
          }}>Cancel identity verification</button>
          <form onSubmit={event=>void withdrawAppContent(event)}>
            <p>Withdraw app-managed profile and case-study projections and revoke reviewer grants. External host and cache withdrawal require separate proof.</p>
            <label className="ws-export-select">Type WITHDRAW PUBLIC CONTENT to confirm
              <input autoComplete="off" value={withdrawConfirmation} disabled={busy}
                onChange={event=>setWithdrawConfirmation(event.target.value)}/>
            </label>
            <button type="submit" className="ws-secondary" disabled={busy || withdrawConfirmation!=='WITHDRAW PUBLIC CONTENT'}>
              Withdraw app-managed public content
            </button>
          </form>
        </>}
      </>}
      {requests && !activeRequest && <form onSubmit={event=>{event.preventDefault();void changeRequest(null);}}>
        <label className="ws-export-select">Type DELETE MY ACCOUNT to record the request
          <input autoComplete="off" value={confirmation} disabled={busy}
            onChange={event=>setConfirmation(event.target.value)}/></label>
        <button type="submit" className="ws-secondary" disabled={busy || confirmation!=='DELETE MY ACCOUNT'}>
          Record deletion request
        </button>
      </form>}
      {!!requests?.length && <ul className="ws-settings-records" aria-label="Recent deletion requests">
        {requests.map(item=><li key={item.id}>{item.status==='WITHDRAWN'?'Withdrawn':'Pending verification'} · <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></li>)}
      </ul>}
    </SettingsCard>
  </div></>;
}
