import { useEffect, useState } from 'react';
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
  const [visible, setVisible] = useState<PreviewField[]>(['displayName', 'headline']);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [withdrawal, setWithdrawal] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    void port.readOwnerProfile().then(({data, error}) => {
      if (!active) return;
      if (!data) { setError(error?.message ?? 'Private profile is unavailable.'); return; }
      setSaved(data);
      setDraft(data);
      setError('');
      setWithdrawal(false);
    });
    return () => { active = false; };
  }, [port, retry]);

  function edit(field: PreviewField, value: string) {
    setDraft(current => current ? {...current, [field]: value} : current);
    setWithdrawal(false);
    setNotice('');
  }

  function addSkill() {
    const value = skill.trim();
    if (!draft || !value || draft.skills.length >= 20 ||
        draft.skills.some(existing => existing.toLowerCase() === value.toLowerCase())) return;
    setDraft({...draft, skills: [...draft.skills, value]});
    setSkill('');
    setNotice('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!saved || !draft || busy) return;
    if (!draft.displayName.trim()) { setError('Enter a display name before saving.'); setPanel('Profile'); return; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const {displayName, headline, bio, skills} = draft;
      const result = await port.saveOwnerProfile(saved, {displayName, headline, bio, skills}, withdrawal);
      if (!result.data) { setError(result.error?.message ?? 'Profile save could not be confirmed.'); return; }
      setSaved(result.data);
      setDraft(result.data);
      setWithdrawal(false);
      setNotice('Private profile draft saved.');
    } finally {
      setBusy(false);
    }
  }

  const initials = draft?.displayName.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase();

  return <section aria-labelledby="profile-title" className="ws-profile ws-owner-page">
    <form onSubmit={event => void save(event)}>
      <div className="ws-project-head">
        <div className="ws-heading">
          <p className="ws-kicker">YOUR IDENTITY</p>
          <h1 id="profile-title">Your developer profile.</h1>
          <p>Edit your draft and preview the fields visitors could see.</p>
        </div>
        <button type="submit" className="ws-primary" disabled={busy || !draft || draft === saved}>{busy ? 'Saving…' : 'Save profile draft'}</button>
      </div>
      <div className="ws-profile-tabs" role="group" aria-label="Profile sections">
        {['Profile', 'Skills & links', 'Visibility', 'Public preview'].map(item =>
          <button key={item} type="button" aria-pressed={panel === item} onClick={() => setPanel(item)}>{item}</button>)}
      </div>
      {error && <div role="alert" className="ws-inline-alert">{error}</div>}
      {notice && <div role="status" className="ws-inline-alert">{notice}</div>}
      {!draft && !error && <p role="status">Loading your private profile…</p>}
      {!draft && error && <button type="button" className="ws-secondary" onClick={() => setRetry(value => value + 1)}>Retry profile</button>}
      {error.includes('another session') && <button type="button" className="ws-secondary"
        onClick={() => {setError(''); setRetry(value => value + 1);}}>Discard edits and load latest draft</button>}
      {error.includes('Confirm withdrawal') && <label className="ws-profile-confirm">
        <input type="checkbox" checked={withdrawal} onChange={event => setWithdrawal(event.target.checked)}/>
        Withdraw my current public profile when I save this draft
      </label>}
      {draft && <div className="ws-project-detail ws-owner-columns">
        <fieldset className="ws-project-fields" disabled={busy}>
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
                onClick={() => setDraft({...draft, skills: draft.skills.filter((_, pos) => pos !== index)})}>{item} ×</button></li>)}</ul>
            <label>Add skill<input value={skill} maxLength={40} onChange={event => setSkill(event.target.value)}
              onKeyDown={event => {if (event.key === 'Enter') {event.preventDefault(); addSkill();}}}/></label>
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
            <fieldset className="ws-preview-fields" disabled={busy}>
              <legend>Fields to preview</legend>
              {previewFields.map(({key, label}) => <label key={key} className="ws-profile-check">
                <input type="checkbox" checked={visible.includes(key)} onChange={event => {
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
