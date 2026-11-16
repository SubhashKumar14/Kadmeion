import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
import type { PrivateNotification, PrivateNotificationPage, PrivateNotificationPreferences } from '../../../packages/contracts/src/private-notifications-service.ts';
import type { AccountExitPreflight } from '../../../packages/contracts/src/private-account-erasure-service.ts';
import type { PrivateTrashEntry } from '../../../packages/contracts/src/private-trash-service.ts';
import type { SharingPreferences } from '../../../packages/contracts/src/identity.ts';

const settingsLinks = [
  ['/app/settings/privacy', 'Privacy & sharing', 'Choose which profile fields are eligible for sharing.'],
  ['/app/notifications', 'Notifications', 'Review activity and notification preferences.'],
  ['/app/settings/security', 'Account security', 'Update your password or sign out other sessions.'],
  ['/app/trash', 'Trash', 'Review items you can restore privately.'],
  ['/app/export', 'Export center', 'Download your application metadata.'],
  ['/app/settings/account/delete', 'Account exit', 'Review prerequisites for account deletion.']
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
  const [services, setServices] = useState<Services | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (path === '/app/settings') return;
    let active = true;
    setServices(null);
    setError('');
    void port.ownerSettings().then(result => {
      if (!active) return;
      if (result.data) {setServices(result.data); setError('');}
      else setError(result.error?.message ?? 'Account settings are unavailable.');
    }).catch(() => {
      if (active) setError('Account settings could not be loaded. Retry when the connection is available.');
    });
    return () => {active = false;};
  }, [port, path, retry]);

  const title = settingsLinks.find(([href]) => href === path)?.[1] ?? 'Settings';
  let content: ReactNode = null;
  if (path === '/app/settings') content = <div className="ws-settings-grid ws-settings-hub" aria-label="Account settings sections">
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
  else if (!services) content = error
    ? <><p role="alert" className="ws-inline-alert">{error}</p><button type="button" className="ws-secondary" onClick={() => {
      setError(''); setRetry(value => value + 1);
    }}>Retry account settings</button></>
    : <p role="status">Loading private account settings…</p>;
  else if (path === '/app/settings/privacy') content = <Privacy port={port} services={services}/>;
  else if (path === '/app/notifications') content = <Notifications service={services.notifications}/>;
  else if (path === '/app/settings/security') content = <Security port={port}/>;
  else if (path === '/app/trash') content = <Trash service={services.trash}/>;
  else if (path === '/app/export') content = <ExportCenter services={services}/>;
  else content = <AccountExit service={services.account}/>;

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

function Trash({service}: {service: Services['trash']}) {
  const [items, setItems] = useState<PrivateTrashEntry[] | null>(null);
  const [message, setMessage] = useState<Message>(emptyMessage);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setItems(null);
    setMessage(null);
    void service.list().then(rows => {if (active) setItems(rows);})
      .catch(error => {if (active) setMessage(failure(error));});
    return () => {active = false;};
  }, [service, reload]);

  async function restore(item: PrivateTrashEntry) {
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      await service.restore(item.item_type, item.item_id);
      setItems(current => current?.filter(row => row.item_id !== item.item_id || row.item_type !== item.item_type) ?? []);
      setMessage({error: false, text: 'Item restored as private.'});
    } catch (error) {setMessage(failure(error));}
    finally {setBusy(false);}
  }

  return <SettingsCard title="Recoverable items">
    <Status message={message}/>
    {!items && !message && <p role="status">Loading Trash…</p>}
    {!items && message?.error && <button type="button" className="ws-secondary"
      onClick={() => setReload(value => value + 1)}>Retry Trash</button>}
    {items?.length === 0 && <p>Trash is empty.</p>}
    <ul className="ws-settings-records">{items?.map(item => {
      const expired = Date.parse(item.restore_until) <= Date.now();
      return <li key={item.item_type + ':' + item.item_id}>
        <strong>{item.item_type} · {item.item_id.slice(0, 8)}</strong>
        <p>Restore by {new Date(item.restore_until).toLocaleString()}</p>
        {expired && <p>Recovery window ended. Restore is unavailable.</p>}
        <button type="button" className="ws-secondary" disabled={busy || expired}
          onClick={() => void restore(item)}>Restore privately</button>
      </li>;
    })}</ul>
  </SettingsCard>;
}

function ExportCenter({services}: {services: Services}) {
  const [message, setMessage] = useState<Message>(emptyMessage);
  const [busy, setBusy] = useState(false);
  async function download() {
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      const inventory = await services.account.captureInventory(crypto.randomUUID());
      const result = await services.data.exportApplicationMetadata(inventory.snapshotId);
      const bytes = Uint8Array.from(result.bytes);
      const url = URL.createObjectURL(new Blob([bytes], {type: result.mime}));
      const link = document.createElement('a');
      link.href = url; link.download = result.filename; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage({error: false, text: 'Application metadata download prepared.'});
    } catch (error) {setMessage(failure(error));}
    finally {setBusy(false);}
  }

  return <SettingsCard title="Application metadata">
    <p>Download a verified JSON snapshot of application records. Storage bytes and external provider data are excluded.</p>
    <Status message={message}/>
    <button className="ws-primary" type="button" disabled={busy} onClick={() => void download()}>{busy ? 'Preparing export…' : 'Download application metadata'}</button>
  </SettingsCard>;
}

function AccountExit({service}: {service: Services['account']}) {
  const [inventory, setInventory] = useState<AccountExitPreflight | null>(null);
  const [message, setMessage] = useState<Message>(emptyMessage);
  const [busy, setBusy] = useState(false);
  async function check() {
    if (busy) return;
    setBusy(true); setMessage(null); setInventory(null);
    try {setInventory(await service.preflight());}
    catch (error) {setMessage(failure(error));}
    finally {setBusy(false);}
  }
  return <SettingsCard title="Deletion prerequisites">
    <p>Account deletion requires identity, public revocation and storage verification.</p>
    <Status message={message}/>
    <button className="ws-primary" type="button" disabled={busy} onClick={() => void check()}>{busy ? 'Checking…' : 'Review deletion prerequisites'}</button>
    {inventory && <div role="status">
      <h3>Private inventory</h3>
      <dl><dt>Projects</dt><dd>{inventory.counts.projects}</dd><dt>Portfolios</dt><dd>{inventory.counts.portfolios}</dd>
        <dt>Public routes</dt><dd>Awaiting revocation verification</dd><dt>Active session</dt><dd>Verified for inventory</dd></dl>
      <p>Deletion is blocked pending the required evidence.</p>
    </div>}
  </SettingsCard>;
}
