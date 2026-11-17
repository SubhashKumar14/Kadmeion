import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { OwnerProfile, SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';

import { Icon } from './landing.tsx';

type PreviewField = 'displayName' | 'headline' | 'bio';
const previewFields: {key: PreviewField; label: string}[] = [
  {key: 'displayName', label: 'Display name'}, {key: 'headline', label: 'Headline'}, {key: 'bio', label: 'About you'}
];

export function DeveloperProfile({port}: {port: SupabaseBrowserAuthPort}) {
  const [saved, setSaved] = useState<OwnerProfile | null>(null);
  const [draft, setDraft] = useState<OwnerProfile | null>(null);
  const [panel, setPanel] = useState('Profile');
  const [skill, setSkill] = useState('');
  const [skillError, setSkillError] = useState('');
  const [visible, setVisible] = useState<PreviewField[]>(['displayName', 'headline']);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [withdrawal, setWithdrawal] = useState(false);
  const [retry, setRetry] = useState(0);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [needsReload, setNeedsReload] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);
  // A ref closes the synchronous gap before React commits disabled controls.
  const operationPending = useRef(true);
  const locked = busy || loadingProfile;

  useEffect(() => {
    let active = true;
    operationPending.current = true;
    setLoadingProfile(true);
    const failRead = (message: string) => {
      if (!active) return;
      setError(message);
      setNeedsReload(true);
      setReloadFailed(true);
      // Keep the current saved baseline, draft and unadded skill on failure.
    };
    void port.readOwnerProfile().then(({data, error}) => {
      if (!active) return;
      if (!data || error) { failRead(error?.message ?? 'Private profile is unavailable.'); return; }
      setSaved(data);
      setDraft(data);
      setSkill('');
      setSkillError('');
      setError('');
      setWithdrawal(false);
      setNeedsReload(false);
      setReloadFailed(false);
    }).catch(() => {
      failRead('Could not reach your private profile. Retry when your connection is restored.');
    }).finally(() => {
      if (active) {
        operationPending.current = false;
        setLoadingProfile(false);
      }
    });
    return () => { active = false; };
  }, [port, retry]);

  function requestReload() {
    if (operationPending.current) return;
    operationPending.current = true;
    setLoadingProfile(true);
    setError('');
    setNotice('');
    setWithdrawal(false);
    setRetry(value => value + 1);
  }

  function edit(field: PreviewField, value: string) {
    if (operationPending.current) return;
    setDraft(current => current ? {...current, [field]: value} : current);
    setWithdrawal(false);
    setNotice('');
  }

  function addSkill() {
    const value = skill.trim();
    if (operationPending.current || !draft || !value) return;
    if (draft.skills.length >= 20) {
      setSkillError('You can list up to 20 skills.');
      return;
    }
    if (draft.skills.some(existing => existing.toLocaleLowerCase('en') === value.toLocaleLowerCase('en'))) {
      setSkillError('This skill is already in your profile.');
      return;
    }
    setDraft({...draft, skills: [...draft.skills, value]});
    setSkill('');
    setSkillError('');
    setWithdrawal(false);
    setNotice('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!saved || !draft || operationPending.current || needsReload) return;
    if (!draft.displayName.trim()) { setError('Enter a display name before saving.'); setPanel('Profile'); return; }
    operationPending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const {displayName, headline, bio, skills} = draft;
      const result = await port.saveOwnerProfile(saved, {displayName, headline, bio, skills}, withdrawal);
      if (!result.data || result.error) {
        const message = result.error?.message ?? 'Profile save could not be confirmed.';
        setError(message);
        if (message.includes('another session')) setNeedsReload(true);
        return;
      }
      setSaved(result.data);
      setDraft(result.data);
      setWithdrawal(false);
      setNotice('Private profile draft saved.');
    } catch {
      setError('Private profile save could not be verified. Your edits are still here.');
    } finally {
      operationPending.current = false;
      setBusy(false);
    }
  }

  const dirty = !!(saved && draft && (
    saved.displayName !== draft.displayName || saved.headline !== draft.headline ||
    saved.bio !== draft.bio || saved.skills.join('\u0000') !== draft.skills.join('\u0000')
  ));
  const initials = draft?.displayName.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase();

  return <section aria-labelledby="profile-title" className="ws-profile ws-owner-page">
    <form onSubmit={event => void save(event)}>
      <div className="ws-project-head">
        <div className="ws-heading">
          <p className="ws-kicker">YOUR IDENTITY</p>
          <h1 id="profile-title">Your developer profile.</h1>
          <p>Edit your draft and preview the fields visitors could see.</p>
        </div>
        <button type="submit" className="ws-primary" disabled={locked || needsReload || !draft || !dirty}>{busy ? 'Saving…' : 'Save profile draft'}</button>
      </div>
      <div className="ws-profile-tabs" role="group" aria-label="Profile sections">
        {['Profile', 'Skills & links', 'Visibility', 'Public preview'].map(item =>
          <button key={item} type="button" aria-pressed={panel === item} onClick={() => setPanel(item)}>{item}</button>)}
      </div>
      {error && <div role="alert" className="ws-inline-alert">{error}</div>}
      {notice && <div role="status" className="ws-inline-alert">{notice}</div>}
      {dirty && <div className="ws-unsaved-line" role="status">
        <span>Unsaved private changes</span>
        <button type="button" className="ws-text-action" disabled={locked} onClick={() => {
          if (operationPending.current) return;
          if (saved) setDraft({...saved, skills:[...saved.skills]});
          setWithdrawal(false); if (!needsReload) setError(''); setNotice('');
        }}>Discard changes</button>
      </div>}
      {loadingProfile && <p role="status">{draft
        ? 'Loading the latest private draft… Your edits are retained until the read succeeds.'
        : 'Loading your private profile…'}</p>}
      {!draft && error && !loadingProfile && <button type="button" className="ws-secondary" disabled={locked} onClick={requestReload}>Retry profile</button>}
      {draft && needsReload && !loadingProfile && <>
        <p>Load the latest saved draft before saving again. Your current edits will be replaced only after a successful read.</p>
        <button type="button" className="ws-secondary" disabled={locked} onClick={requestReload}>
          {reloadFailed ? 'Retry loading latest draft (discard edits on success)' : 'Discard edits and load latest draft'}
        </button>
      </>}
      {error.includes('Confirm withdrawal') && <label className="ws-profile-confirm">
        <input type="checkbox" disabled={locked || needsReload} checked={withdrawal} onChange={event => setWithdrawal(event.target.checked)}/>
        Withdraw my current public profile when I save this draft
      </label>}
      {draft && <div className="ws-project-detail ws-owner-columns">
        <fieldset className="ws-project-fields" disabled={locked}>
          <legend>{panel}</legend>
          {panel === 'Profile' && <>
            <div className="ws-profile-avatar"><span aria-hidden="true">{initials || '•'}</span><div>
              <strong>Profile identity</strong><p>{draft.handle ? '@' + draft.handle : 'A public handle has not been claimed.'}</p>
            </div></div>
            <label>Display name<input value={draft.displayName} maxLength={80} onChange={event => edit('displayName', event.target.value)} /></label>
            <label>Headline<input value={draft.headline} maxLength={160} onChange={event => edit('headline', event.target.value)} /></label>
            <label>About you<textarea value={draft.bio} rows={4} maxLength={2000} onChange={event => edit('bio', event.target.value)} /></label>
          </>}
          {panel === 'Skills & links' && <>
            <ul className="ws-profile-skills" aria-label="Private skills">{draft.skills.map((item, index) =>
              <li key={index}><button type="button" aria-label={'Remove ' + item}
                onClick={() => {
                  if (operationPending.current) return;
                  setDraft({...draft, skills: draft.skills.filter((_, pos) => pos !== index)});
                  setSkillError(''); setWithdrawal(false); setNotice('');
                }}>{item} ×</button></li>)}</ul>
            <label>Add skill<input value={skill} maxLength={40}
              aria-invalid={!!skillError} aria-describedby={skillError ? 'profile-skill-error' : undefined}
              onChange={event => {if (!operationPending.current) {setSkill(event.target.value); setSkillError('');}}}
              onKeyDown={event => {if (event.key === 'Enter') {event.preventDefault(); addSkill();}}}/></label>
            {skillError && <p id="profile-skill-error" role="alert" className="ws-inline-alert">{skillError}</p>}
            <p>{draft.skills.length} of 20 skills added to this private draft.</p>
            <button type="button" className="ws-secondary" disabled={!skill.trim() || draft.skills.length >= 20} onClick={addSkill}>Add skill</button>
            {panel === 'Skills & links' && <p>Project links are managed in the <a href="/app/projects">project library</a>.</p>}
          </>}
          {panel === 'Visibility' && <>
            <p>Use the preview card to choose which fields to show. These selections apply to this preview only.</p>
            <a className="ws-secondary" href="/app/settings/privacy">Open privacy settings</a>
          </>}
          {panel === 'Public preview' && <p>The card shows the selected draft fields. The preview is private.</p>}
        </fieldset>
        <div className="ws-profile-preview">
          <aside className="ws-project-aside" aria-label="Public profile preview">
            <h2>Public profile preview</h2>
            <div className="ws-profile-card">
              <span className="ws-preview-identity"><Icon name="user" size={22}/></span>
              <p className="ws-kicker">PREVIEW ONLY</p>
              <h3>{visible.includes('displayName') && draft.displayName.trim() ? draft.displayName : 'Developer profile'}</h3>
              {visible.includes('headline') && <p>{draft.headline}</p>}
              {visible.includes('bio') && <p>{draft.bio}</p>}
            </div>
            <fieldset className="ws-preview-fields" disabled={locked}>
              <legend>Fields to preview</legend>
              {previewFields.map(({key, label}) => <label key={key} className="ws-profile-check">
                <input type="checkbox" aria-label={'Include ' + label + ' in preview'} checked={visible.includes(key)} onChange={event => {
                  const checked = event.target.checked;
                  setVisible(current => checked ? [...current, key] : current.filter(field => field !== key));
                }}/>{label}</label>)}
            </fieldset>
            <p>This preview stays in your workspace. Saving updates your private draft.</p>
          </aside>
        </div>
      </div>}
    </form>
  </section>;
}
