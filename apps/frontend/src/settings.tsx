import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
import type { PrivateNotification, PrivateNotificationPage, PrivateNotificationPreferences } from '../../../packages/contracts/src/private-notifications-service.ts';
import type { AccountExitPreflight, AccountExitReauthChallenge, AccountExitReauthVerification, PrivateAccountErasureEntry } from '../../../packages/contracts/src/private-account-erasure-service.ts';
import type { PrivateTrashEntry, PrivateTrashKind } from '../../../packages/contracts/src/private-trash-service.ts';
import { PrivateTrashError } from '../../../packages/contracts/src/private-trash-service.ts';
import type { SharingPreferences } from '../../../packages/contracts/src/identity.ts';
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
  const scope = useMemo(() => ({port, path, retry}), [port, path, retry]);
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
      if (!active) return;
      setLoaded({
        scope, services: result.data ?? null,
        error: result.data ? '' : result.error?.message ?? 'Account settings are unavailable.',
        viewKey: crypto.randomUUID()
      });
    }).catch(() => {
      if (active) setLoaded({
        scope, services: null,
        error: 'Account settings could not be loaded. Retry when the connection is available.',
        viewKey: crypto.randomUUID()
      });
    });
    return () => {active = false;};
  }, [scope, port, path]);

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
      setError(''); setRetry(value => value + 1);
    }}>Retry account settings</button></>
    : <p role="status">Loading private account settings…</p>;
  else if (path === '/app/settings/privacy') content = <Privacy key={current!.viewKey} port={port} services={services}/>;
  else if (path === '/app/notifications') content = <Notifications key={current!.viewKey} service={services.notifications}/>;
  else if (path === '/app/settings/security') content = <Security key={current!.viewKey} port={port}/>;
  else if (path === '/app/trash') content = <Trash key={current!.viewKey} service={services.trash}/>;
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
  const [prefs, setPrefs] = useState<SharingPreferences | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<Message>(emptyMessage);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const fields: [keyof SharingPreferences, string][] = [
    ['shareDisplayName', 'Display name'], ['shareHeadline', 'Headline'], ['shareBio', 'About you']
  ];
  useEffect(() => {
    let active = true;
    setPrefs(null);
    setConfirmed(false);
    setMessage(null);
    void port.ownerSharingPreferences().then(result => {
      if (!active) return;
      if (result.data) setPrefs(result.data);
      else setMessage({error: true, text: result.error?.message ?? 'Privacy preferences are unavailable.'});
    }).catch(() => {
      if (active) setMessage({error: true, text: 'Privacy preferences could not be loaded.'});
    });
    return () => {active = false;};
  }, [port, reload]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prefs || !confirmed || busy) return;
    setBusy(true); setMessage(null);
    try {
      await services.identity.requestPublicIdentity(prefs);
      // A mutation acknowledgement alone is not a fresh owner-visible state.
      const saved = await port.ownerSharingPreferences();
      if (!saved.data || fields.some(([key]) => saved.data![key] !== prefs[key]) ||
          saved.data.publicationRequested !== prefs.publicationRequested)
        throw new Error('Sharing preferences could not be read back. Review the saved state before retrying.');
      setPrefs(saved.data);
      setConfirmed(false);
      setMessage({error: false, text: 'Sharing preferences saved privately.'});
    } catch (error) {setMessage(failure(error));}
    finally {setBusy(false);}
  }

  const selected=prefs?fields.filter(([key])=>prefs[key]).length:null;
  return <div className="ws-settings-privacy">
    <SettingsCard title="Profile visibility">
      <p>Select fields eligible for a later publication request. Saving these choices does not make a profile or portfolio public.</p>
      <Status message={message}/>
      {!prefs && !message && <p role="status">Loading sharing preferences…</p>}
      {!prefs && message?.error && <button type="button" className="ws-secondary"
        onClick={() => setReload(value => value + 1)}>Retry sharing preferences</button>}
      {prefs && <form onSubmit={event => void save(event)}>
        <p className="ws-settings-selection-count"><strong>{selected} of {fields.length}</strong> profile fields selected in this form.
          Selection is not publication.</p>
        <fieldset disabled={busy}>
          <legend>Shareable profile fields</legend>
          {fields.map(([key, label]) => <label className="ws-settings-check" key={key}>
            <input type="checkbox" checked={prefs[key]} onChange={event => {
              const next = {...prefs, [key]: event.target.checked};
              if (!next.shareDisplayName && !next.shareHeadline && !next.shareBio) next.publicationRequested = false;
              setPrefs(next); setConfirmed(false);
            }}/>{label}
          </label>)}
          <label className="ws-settings-check"><input type="checkbox" checked={prefs.publicationRequested}
            disabled={!prefs.shareDisplayName && !prefs.shareHeadline && !prefs.shareBio}
            onChange={event => {setPrefs({...prefs, publicationRequested: event.target.checked}); setConfirmed(false);}}/>
            Allow a later publication request
          </label>
          <label className="ws-settings-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>
            Save these preferences and withdraw any affected public profile projection
          </label>
        </fieldset>
        <button type="submit" className="ws-primary" disabled={!confirmed || busy}>{busy ? 'Saving…' : 'Save sharing preferences'}</button>
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
  return '/app/portfolios';
}

function Notifications({service}: {service: Services['notifications']}) {
  const [inbox, setInbox] = useState<PrivateNotificationPage | null>(null);
  const [prefs, setPrefs] = useState<PrivateNotificationPreferences | null | undefined>(undefined);
  const [pendingPrefs, setPendingPrefs] = useState<{
    reviewerEnabled: boolean; publishEnabled: boolean; syncEnabled: boolean;
  } | null>(null);
  const [preferenceMessage, setPreferenceMessage] = useState<Message>(emptyMessage);
  const [message, setMessage] = useState<Message>(emptyMessage);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [inboxFilter, setInboxFilter] = useState<'ALL'|'UNREAD'|'HIGH'>('ALL');
  useEffect(() => {
    let active = true;
    setInbox(null);
    setPrefs(undefined);
    setMessage(null);
    void Promise.all([service.listPage(), service.getPreferences()]).then(([items, settings]) => {
      if (active) {setInbox(items); setPrefs(settings);}
    }).catch(error => {if (active) setMessage(failure(error));});
    return () => {active = false;};
  }, [service, reload]);

  async function acknowledge(item: PrivateNotification, dismiss: boolean) {
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      const receipt = await service.acknowledge(item.id, dismiss);
      setInbox(current => current && {...current, items: dismiss ? current.items.filter(row => row.id !== item.id)
        : current.items.map(row => row.id === item.id ? {...row, read_at: receipt.read_at} : row)});
    } catch (error) {setMessage(failure(error));}
    finally {setBusy(false);}
  }

  async function review(item: PrivateNotification) {
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      if (!item.read_at) await service.acknowledge(item.id, false);
      window.location.assign(notificationDestination(item));
    } catch (error) {
      setMessage(failure(error));
      setBusy(false);
    }
  }

  async function more() {
    if (!inbox?.nextCursor || busy) return;
    const requestedCursor = inbox.nextCursor;
    setBusy(true); setMessage(null);
    try {
      const next = await service.listPage(50, requestedCursor);
      setInbox(current => {
        if (!current || current.nextCursor !== requestedCursor) return current;
        const seen = new Set(current.items.map(item => item.id));
        return {...next, items: [...current.items, ...next.items.filter(item => !seen.has(item.id))]};
      });
    } catch (error) {setMessage(failure(error));}
    finally {setBusy(false);}
  }

  // The database enables reviewer and publishing notices when no row exists.
  const effectivePrefs = {
    reviewerEnabled: prefs?.reviewer_enabled ?? true,
    publishEnabled: prefs?.publish_enabled ?? true,
    syncEnabled: prefs?.sync_enabled ?? false
  };
  const displayedPrefs = pendingPrefs ?? effectivePrefs;

  async function preference(key: keyof typeof effectivePrefs, checked: boolean) {
    if (busy) return;
    const next = {...effectivePrefs, [key]: checked};
    setBusy(true);
    setPendingPrefs(next);
    setPreferenceMessage(null);
    try {
      setPrefs(await service.setPreferences(next));
      setPreferenceMessage({error: false, text: 'Notification preferences saved.'});
    } catch {
      setPreferenceMessage({error: true, text: 'Could not confirm the change. Showing the last confirmed preferences. Try again or reload to check the saved settings.'});
    } finally {
      setPendingPrefs(null);
      setBusy(false);
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
    {inbox?.items.length ? <p>Review opens an owner-only area. Unread notices are marked read only after the server acknowledges the action.</p> : null}
    {inbox?.nextCursor && <button className="ws-secondary" type="button" disabled={busy} onClick={() => void more()}>Load more</button>}
  </SettingsCard><SettingsCard title="Optional in-app notifications">
    {prefs === null && !pendingPrefs && <p role="status">No saved preference record was returned. Reviewer and publishing notices are enabled by default; draft-sync notices are off until enabled. Security and moderation notices cannot be muted here.</p>}
    {prefs !== undefined && ([
      ['reviewerEnabled', 'Reviewer activity'],
      ['publishEnabled', 'Publishing activity'],
      ['syncEnabled', 'Draft sync activity']
    ] as const).map(([key, label]) => (
      <label className="ws-settings-check" key={key}>
        <input type="checkbox" checked={displayedPrefs[key]} aria-disabled={busy}
          onChange={event => void preference(key, event.target.checked)}/> {label}
      </label>
    ))}
    {pendingPrefs && <p role="status">Saving notification preferences…</p>}
    <Status message={preferenceMessage}/>
    <p>Security and moderation notices use the required in-app channel.</p>
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
  const [message, setMessage] = useState<Message>(null);
  async function move() {
    if (busy || disabled) return;
    setBusy(true);
    setMessage(null);
    try {
      const {data} = await port.ownerSettings();
      if (!data) throw new Error('Could not verify your private Trash session.');
      await data.trash.move(kind, id);
      dialog.current?.close();
      onMoved();
    } catch (error) {
      setMessage(failure(error));
    } finally {
      setBusy(false);
    }
  }
  return <>
    <button ref={trigger} type="button" className="ws-secondary" disabled={disabled}
      onClick={()=>{setMessage(null); dialog.current?.showModal();}}>Move to Trash</button>
    <dialog ref={dialog} className="ws-project-dialog ws-lifecycle-dialog" aria-labelledby={titleId}
      onCancel={event=>{if (busy) event.preventDefault();}} onClose={()=>trigger.current?.focus()}>
      <h2 id={titleId}>Move {title} to Trash?</h2>
      <p>You can restore this {kind} privately within 15 days. Any public delivery requires separate withdrawal verification.</p>
      <Status message={message}/>
      <div className="ws-actions">
        <button autoFocus type="button" className="ws-secondary" disabled={busy}
          onClick={()=>dialog.current?.close()}>Cancel</button>
        <button type="button" className="ws-primary" disabled={busy}
          onClick={()=>void move()}>{busy?'Moving…':'Confirm move to Trash'}</button>
      </div>
    </dialog>
  </>;
}

function Trash({service}: {service: Services['trash']}) {
  const [items, setItems] = useState<PrivateTrashEntry[] | null>(null);
  const [message, setMessage] = useState<Message>(emptyMessage);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [expiredByServer, setExpiredByServer] = useState<Set<string>>(()=>new Set());
  useEffect(() => {
    let active = true;
    setItems(null);
    setMessage(null);
    void service.list().then(rows => {if (active) setItems(rows);})
      .catch(error => {if (active) setMessage(failure(error));});
    return () => {active = false;};
  }, [service, reload]);

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
    if (busy || expiredByServer.has(key)) return;
    if (Date.parse(item.restore_until)<=Date.now()) {
      setNow(Date.now());
      setMessage({error:true,text:'The restore deadline has passed.'});
      return;
    }
    setBusy(true); setMessage(null);
    try {
      await service.restore(item.item_type, item.item_id);
      setItems(current => current?.filter(row => row.item_id !== item.item_id || row.item_type !== item.item_type) ?? []);
      setMessage({error: false, text: 'Item restored as private.'});
    } catch (error) {
      if (error instanceof PrivateTrashError && error.code==='TRASH_EXPIRED')
        setExpiredByServer(current=>new Set(current).add(key));
      setMessage(failure(error));
    }
    finally {setBusy(false);}
  }

  return <div className="ws-settings-grid"><SettingsCard title="Recoverable items">
    <Status message={message}/>
    {!items && !message && <p role="status">Loading Trash…</p>}
    {!items && message?.error && <button type="button" className="ws-secondary"
      onClick={() => setReload(value => value + 1)}>Retry Trash</button>}
    {items?.length === 0 && <p>Trash is empty.</p>}
    <ul className="ws-settings-records">{items?.map(item => {
      const expired = Date.parse(item.restore_until)<=now ||
        expiredByServer.has(item.item_type+':'+item.item_id+':'+item.trashed_at);
      return <li key={item.item_type + ':' + item.item_id}>
        <strong>{item.item_type} · {item.item_id.slice(0, 8)}</strong>
        <p>Moved to Trash <time dateTime={item.trashed_at}>{new Date(item.trashed_at).toLocaleString()}</time></p>
        <p>Restore by <time dateTime={item.restore_until}>{new Date(item.restore_until).toLocaleString()}</time></p>
        {expired && <p>Recovery window ended. Restore is unavailable.</p>}
        <button type="button" className="ws-secondary" disabled={busy || expired}
          onClick={() => void restore(item)}>Restore privately</button>
      </li>;
    })}</ul>
  </SettingsCard><SettingsCard title="15-day recovery window">
    <p>Restored items return to your library as private drafts. Recovery ends at the deadline shown for each item.</p>
    <p>Expired items are eligible for scheduled cleanup. Permanent removal is unavailable from this page.</p>
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

function ExportCenter({port, services}: {port: SupabaseBrowserAuthPort; services: Services}) {
  const [message, setMessage] = useState<Message>(emptyMessage);
  const [busy, setBusy] = useState<'metadata'|'recovery'|'source'|null>(null);
  const [portfolios, setPortfolios] = useState<{id:string;title:string}[]|null>(null);
  const [portfolioError, setPortfolioError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState('');
  useEffect(()=>{
    let active = true;
    void port.listOwnerPortfolios().then(({data})=>{
      if (!active) return;
      if (!data) throw new Error('Saved portfolios could not be loaded.');
      setPortfolios(data.filter(item=>item.revision>0));
    }).catch(()=>{if(active) setPortfolioError('Saved portfolios could not be loaded.');});
    return ()=>{active=false;};
  },[port,retry]);

  async function download(kind: NonNullable<typeof busy>) {
    if (busy) return;
    setBusy(kind); setMessage(null);
    try {
      if (kind==='source') {
        if (!selected) return;
        const {exportPortfolioSourceZip} = await import('../../../packages/storage-adapters/src/portable-source-archive.ts');
        const {data} = await port.readOwnerPortfolio(selected);
        if (!data?.snapshot || data.id!==selected) throw new Error('Could not verify the saved portfolio revision.');
        downloadPrivateFile('kadmeion-portfolio-revision-'+data.revision+'.zip', exportPortfolioSourceZip(data.snapshot), 'application/zip');
        setMessage({error:false,text:'Portfolio source download prepared.'});
      } else {
        const inventory = await services.account.captureInventory(crypto.randomUUID());
        if (kind==='metadata') {
          const result = await services.data.exportApplicationMetadata(inventory.snapshotId);
          downloadPrivateFile(result.filename,result.bytes,result.mime);
          setMessage({error:false,text:'Application metadata download prepared.'});
        } else {
          const result = await services.data.export(inventory.snapshotId);
          const {createBoundedPrivateAccountRecoveryBundle} = await import('../../../packages/storage-adapters/src/private-account-data-export.ts');
          const bundle = await createBoundedPrivateAccountRecoveryBundle(result.bytes);
          downloadPrivateFile(bundle.filename,bundle.zip,'application/zip');
          setMessage({error:false,text:'Private recovery download prepared.'});
        }
      }
    } catch (error) {setMessage(failure(error));}
    finally {setBusy(null);}
  }

  return <><Status message={message}/><div className="ws-settings-grid">
    <SettingsCard title="Editable portfolio ZIP">
      <p>Download the saved revision for editing or recovery. This archive contains private source and excludes uploaded media.</p>
      {portfolioError && <><p role="alert">{portfolioError}</p><button type="button" className="ws-secondary"
        onClick={()=>{setPortfolioError('');setRetry(value=>value+1);}}>Retry portfolio list</button></>}
      {!portfolios && !portfolioError && <p role="status">Loading saved portfolios…</p>}
      {portfolios?.length===0 && <p>No saved portfolio revisions to export.</p>}
      {!!portfolios?.length && <><label className="ws-export-select">Portfolio to export
        <select value={selected} disabled={busy!==null} onChange={event=>setSelected(event.target.value)}>
          <option value="">Select a portfolio</option>
          {portfolios.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}
        </select></label>
        <button className="ws-primary" type="button" disabled={!selected || busy!==null}
          onClick={()=>void download('source')}>{busy==='source'?'Preparing portfolio ZIP…':'Download portfolio source ZIP'}</button></>}
    </SettingsCard>
    <SettingsCard title="Private account data">
      <p>Download application records as JSON, or build a bounded recovery ZIP with owner records and verified uploaded files. Provider data and backups are excluded.</p>
      <div className="ws-actions">
        <button className="ws-primary" type="button" disabled={busy!==null}
          onClick={()=>void download('metadata')}>{busy==='metadata'?'Preparing export…':'Download application metadata'}</button>
        <button className="ws-secondary" type="button" disabled={busy!==null}
          onClick={()=>void download('recovery')}>{busy==='recovery'?'Checking records and files…':'Download private recovery ZIP'}</button>
      </div>
    </SettingsCard>
    <SettingsCard title="Offline static preview">
      <p>Run preflight on a saved revision to download an eligible scriptless HTML preview. The ZIP has no public URL and excludes custom code and private media.</p>
      {selected
        ? <a href={'/app/portfolios/'+selected+'/publish'}>Open preflight for selected portfolio</a>
        : <p>Select a saved portfolio above to open its preflight.</p>}
    </SettingsCard>
  </div></>;
}

function AccountExit({port,service}: {port: SupabaseBrowserAuthPort; service: Services['account']}) {
  const [inventory, setInventory] = useState<AccountExitPreflight | null>(null);
  const [requests, setRequests] = useState<PrivateAccountErasureEntry[] | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const operation = useRef<{key:string;id:string} | null>(null);
  const challenge = useRef<AccountExitReauthChallenge|null>(null);
  const challengeOperation = useRef<string|null>(null);
  const [reauth, setReauth] = useState<AccountExitReauthVerification|null>(null);
  const [withdrawConfirmation, setWithdrawConfirmation] = useState('');
  const withdrawalOperation = useRef<string|null>(null);
  const activeRequest = requests?.find(item=>item.status==='REQUESTED_BLOCKED');

  async function check() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setInventory(null);
    setRequests(null);
    setConfirmation('');
    setReauth(null);
    setWithdrawConfirmation('');
    withdrawalOperation.current=null;
    try {
      const [result, history] = await Promise.all([service.preflight(),service.list()]);
      setInventory(result);
      setRequests(history);
    } catch (error) {
      setMessage(failure(error));
    } finally {
      setBusy(false);
    }
  }

  async function changeRequest(requestId: string | null) {
    if (busy || !inventory || !requests) return;
    if (requestId ? activeRequest?.id!==requestId : !!activeRequest || confirmation!=='DELETE MY ACCOUNT') return;
    const key = requestId ?? 'request';
    if (operation.current?.key!==key) operation.current={key,id:crypto.randomUUID()};
    setBusy(true);
    setMessage(null);
    try {
      if (requestId) await service.withdraw(requestId,operation.current.id);
      else await service.request(operation.current.id,'DELETE MY ACCOUNT');
      // Hide old actions until a fresh read confirms the current request state.
      setRequests(null);
      setConfirmation('');
      setReauth(null);
      setWithdrawConfirmation('');
      withdrawalOperation.current=null;
      challenge.current=null;
      challengeOperation.current=null;
      operation.current=null;
      setRequests(await service.list());
      setMessage({error:false,text:requestId?'Account deletion request withdrawn.':'Deletion request recorded. No data has been erased.'});
    } catch (error) {
      setMessage(failure(error));
    } finally {
      setBusy(false);
    }
  }

  async function verifyIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !activeRequest) return;
    const form=event.currentTarget;
    const password=new FormData(form).get('current-password');
    if (typeof password!=='string' || !password) return;
    form.reset();
    setBusy(true);
    setMessage(null);
    setReauth(null);
    setWithdrawConfirmation('');
    withdrawalOperation.current=null;
    try {
      if (challenge.current && Date.parse(challenge.current.expiresAt)<=Date.now()) {
        challenge.current=null;
        challengeOperation.current=null;
      }
      challengeOperation.current ??= crypto.randomUUID();
      challenge.current ??= await service.beginReauth(challengeOperation.current);
      const reauth=await port.reauthenticateCurrentOwner(password);
      if (reauth.error) throw new Error(reauth.error.message);
      const challengeId=challenge.current.challengeId;
      // The next verification must begin a new challenge if this new session
      // cannot be confirmed. A consumed challenge is bound to one session.
      challenge.current=null;
      challengeOperation.current=null;
      const receipt=await service.completeReauth(challengeId);
      setReauth(receipt);
    } catch (error) {
      setMessage(failure(error));
    } finally {
      setBusy(false);
    }
  }

  async function withdrawAppContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !activeRequest || !reauth || withdrawConfirmation!=='WITHDRAW PUBLIC CONTENT') return;
    if (Date.parse(reauth.expiresAt)<=Date.now()) {
      setReauth(null);
      setMessage({error:true,text:'Identity verification expired. Sign in again to withdraw content.'});
      return;
    }
    withdrawalOperation.current ??= crypto.randomUUID();
    setBusy(true);
    setMessage(null);
    try {
      const receipt=await service.withdrawPublicContent(activeRequest.id,reauth.challengeId,
        withdrawalOperation.current,'WITHDRAW PUBLIC CONTENT');
      setWithdrawConfirmation('');
      setReauth(null);
      withdrawalOperation.current=null;
      setMessage({error:false,text:'Application withdrawal confirmed. Reviewer grants revoked: '+
        receipt.revokedReviewerGrants+'. Independent host withdrawal remains unverified.'});
    } catch (error) {
      setMessage(failure(error));
    } finally {
      setBusy(false);
    }
  }

  return <><Status message={message}/><div className="ws-settings-grid">
    <SettingsCard title="Deletion prerequisites">
      <p>Account deletion requires fresh identity verification, public revocation and storage checks. You can record or withdraw a request while these checks are pending.</p>
      <button className="ws-primary" type="button" disabled={busy}
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
