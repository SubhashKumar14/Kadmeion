import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { OwnerProfile, SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';

import { Icon } from './landing.tsx';
import type { PrivatePlatformLink, PlatformProvider } from '../../../packages/contracts/src/private-platform-links-service.ts';

type PreviewField = 'displayName' | 'headline' | 'bio';
const previewFields: {key: PreviewField; label: string}[] = [
  {key: 'displayName', label: 'Display name'}, {key: 'headline', label: 'Headline'}, {key: 'bio', label: 'About you'}
];

export function DeveloperProfile({port}: {port: SupabaseBrowserAuthPort}) {
  const [saved, setSaved] = useState<OwnerProfile | null>(null);
  const [draft, setDraft] = useState<OwnerProfile | null>(null);
  const [panel, setPanel] = useState('Profile');
  const [openedLinks,setOpenedLinks]=useState(false);
  const [previewSaved,setPreviewSaved]=useState(false);
  const [projectionMode,setProjectionMode]=useState<'draft'|'preferences'>('draft');
  const [projectionFields,setProjectionFields]=useState<PreviewField[]|null>(null);
  const [projectionSnapshot,setProjectionSnapshot]=useState<OwnerProfile|null>(null);
  const [projectionRequested,setProjectionRequested]=useState(false);
  const [projectionError,setProjectionError]=useState('');
  const [projectionLoading,setProjectionLoading]=useState(false);
  const projectionAttempt=useRef(0);
  const projectionPending=useRef(false);
  const projectionEpoch=useRef(port.getOwnerSessionEpoch());
  useEffect(()=>()=>{projectionAttempt.current++;projectionPending.current=false;},[port]);
  function invalidateProjection(){
    projectionAttempt.current++;projectionPending.current=false;setProjectionLoading(false);
    setProjectionFields(null);setProjectionSnapshot(null);setProjectionRequested(false);setProjectionError('');
  }
  async function readProjection(){
    if(projectionPending.current||operationPending.current)return;
    projectionPending.current=true;
    const attempt=++projectionAttempt.current,epoch=projectionEpoch.current;
    const current=()=>attempt===projectionAttempt.current&&epoch===port.getOwnerSessionEpoch();
    setProjectionLoading(true);setProjectionFields(null);setProjectionSnapshot(null);setProjectionRequested(false);setProjectionError('');
    try{
      if(!current())return;
      const [result,profile]=await Promise.all([port.ownerSharingPreferences(),port.readOwnerProfile()]);
      if(!current())return;
      if(result.error||!result.data||profile.error||!profile.data){
        setProjectionError('Saved profile and sharing preferences could not both be verified. Retry to preview them.');return;
      }
      const prefs=result.data;
      setProjectionSnapshot(profile.data);
      setProjectionFields([...(prefs.shareDisplayName?['displayName' as const]:[]),
        ...(prefs.shareHeadline?['headline' as const]:[]),...(prefs.shareBio?['bio' as const]:[])]);
      setProjectionRequested(prefs.publicationRequested);
    }catch{if(current())setProjectionError('Saved sharing preferences are unavailable. Retry securely.');}
    finally{if(attempt===projectionAttempt.current){projectionPending.current=false;setProjectionLoading(false);
      if(!current()){setProjectionFields(null);setProjectionSnapshot(null);setProjectionRequested(false);setProjectionError('Your session changed. Reopen your profile.');}}}
  }
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
    invalidateProjection();
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
    invalidateProjection();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const {displayName, headline, bio, skills} = draft;
      const result = await port.saveOwnerProfile(saved, {displayName, headline, bio, skills}, withdrawal);
      if (!result.data || result.error) {
        const message = result.error?.message ?? 'Profile save could not be confirmed.';
        setError(message);
        if (message.includes('another session') ||
            message === 'Private workspace conflict. Reload the latest data before trying again.') setNeedsReload(true);
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
  const preview=projectionMode==='preferences'?projectionSnapshot:previewSaved?saved:draft;
  const previewSelection=projectionMode==='preferences'?(projectionFields??[]):visible;

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
          <button key={item} type="button" aria-pressed={panel === item} onClick={() => {if(item==='Skills & links')setOpenedLinks(true);setPanel(item);}}>{item}</button>)}
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
              <p>Initials are the current avatar fallback. Private avatar storage and attachment are not available yet.</p>
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
            <p>Manage self-supplied private platform links below. Project URLs are managed in the <a href="/app/projects">project library</a>.</p>
          </>}
          {panel === 'Visibility' && <>
            <p>Choose which eligible fields to include in the private preview, or inspect your saved sharing preferences. These selections do not save sharing consent or publish anything. Skills, platform links, email and account details stay out of this projection.</p>
            <a className="ws-secondary" href="/app/settings/privacy">Open privacy settings</a>
          </>}
          {panel === 'Public preview' && <p>Compare the selected draft or last saved fields. This is an owner-only approximation, not a live visitor route.</p>}
        </fieldset>
        <div className="ws-profile-preview">
          <aside className="ws-project-aside" aria-label="Public profile preview">
            <h2>Public profile preview</h2>
            <div className="ws-profile-card">
              <span className="ws-preview-identity"><Icon name="user" size={22}/></span>
              <p className="ws-kicker">PREVIEW ONLY</p>
              <h3>{previewSelection.includes('displayName') && preview?.displayName.trim() ? preview.displayName : 'Developer profile'}</h3>
              {previewSelection.includes('headline') && preview?.headline.trim() && <p>{preview.headline}</p>}
              {previewSelection.includes('bio') && preview?.bio.trim() && <p>{preview.bio}</p>}
              {projectionMode==='preferences'&&projectionFields===null
                ? <p>Saved sharing preferences have not been verified.</p>
                : !previewSelection.length&&<p>No fields selected for preview.</p>}
            </div>
            <fieldset className="ws-preview-fields" disabled={locked}>
              <legend>Fields to preview</legend>
              <div className="ws-actions" role="group" aria-label="Preview source">
                <button type="button" className="ws-secondary" aria-pressed={projectionMode==='draft'} onClick={()=>setProjectionMode('draft')}>Draft selection</button>
                <button type="button" className="ws-secondary" aria-pressed={projectionMode==='preferences'} disabled={projectionLoading}
                  onClick={()=>{setProjectionMode('preferences');void readProjection();}}>Saved sharing preferences</button>
              </div>
              {projectionMode==='preferences'?<>
                <p>{projectionFields===null?'No verified selection.':projectionFields.length+' of 3 eligible fields selected in saved preferences.'}</p>
                {projectionFields!==null&&<p>{projectionRequested?'A later publication request is allowed by saved preferences.':'No publication request is enabled in saved preferences.'} This does not prove live visibility.</p>}
                <div aria-live="polite">{projectionLoading&&<p>Checking saved sharing preferences…</p>}</div>
                {projectionError&&<p role="alert" className="ws-inline-alert">{projectionError}</p>}
                <button type="button" className="ws-secondary" disabled={projectionLoading} onClick={()=>void readProjection()}>{projectionError?'Retry sharing preferences':'Refresh sharing preferences'}</button>
                <a href="/app/settings/privacy">Change sharing preferences in privacy settings</a>
              </>:<>
              <label className="ws-profile-check"><input type="checkbox" checked={previewSaved}
                onChange={event=>setPreviewSaved(event.target.checked)}/> Use last saved profile instead of current draft</label>
              {previewFields.map(({key, label}) => <label key={key} className="ws-profile-check">
                <input type="checkbox" aria-label={'Include ' + label + ' in preview'} checked={visible.includes(key)} onChange={event => {
                  const checked = event.target.checked;
                  setVisible(current => checked ? [...current, key] : current.filter(field => field !== key));
                }}/>{label}</label>)}
              <button type="button" className="ws-secondary" disabled={!visible.length} onClick={()=>setVisible([])}>Clear preview selection</button>
              </>}
            </fieldset>
            <p>{projectionMode==='preferences'?'Owner-only approximation using freshly read saved profile fields and sharing preferences, not an atomic public projection.':previewSaved?'Preview of last confirmed private profile.':'Preview of current unsaved or saved draft.'} This stays in your workspace; it does not publish.</p>
          </aside>
        </div>
      </div>}
    </form>
    {draft&&openedLinks&&<div hidden={panel!=='Skills & links'}><PrivateProfileLinks port={port}/></div>}
  </section>;
}

const profileProviders:ReadonlyArray<{id:PlatformProvider;label:string}>=[
  {id:'GITHUB',label:'GitHub'},{id:'LEETCODE',label:'LeetCode'},
  {id:'CODEFORCES',label:'Codeforces'},{id:'HACKERRANK',label:'HackerRank'},
  {id:'KAGGLE',label:'Kaggle'},{id:'HUGGING_FACE',label:'Hugging Face'}
];

/** Separate private LINK_ONLY records: profile draft save does not alter them,
 * nor does selecting a link imply provider ownership or public consent.
 */
function PrivateProfileLinks({port}:{port:SupabaseBrowserAuthPort}){
  const [records,setRecords]=useState<PrivatePlatformLink[]|null>(null);
  const [provider,setProvider]=useState<PlatformProvider>('GITHUB');
  const [handle,setHandle]=useState('');
  const [confirmRemove,setConfirmRemove]=useState(false);
  const [busy,setBusy]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const pending=useRef(true);
  const generation=useRef(0);
  const epoch=useRef(port.getOwnerSessionEpoch());
  const current=(attempt:number)=>attempt===generation.current&&epoch.current===port.getOwnerSessionEpoch();
  function clearOwner(){
    setRecords(null);setHandle('');setConfirmRemove(false);setNotice('');
    setError('Your owner session changed. Reopen your profile.');
  }
  async function freshService(attempt:number){
    const verified=await port.getUser();
    if(!current(attempt)||verified.error||!verified.data?.user)throw new Error('Session unavailable');
    const services=await port.ownerGrowth();
    if(!current(attempt)||services.error||!services.data)throw new Error('Private link service unavailable');
    return services.data.links;
  }
  useEffect(()=>{
    const attempt=++generation.current;epoch.current=port.getOwnerSessionEpoch();
    pending.current=true;setBusy(true);
    void (async()=>{
      try{
        const service=await freshService(attempt);
        const rows=await service.list();
        if(current(attempt)){setRecords(rows);setHandle(rows.find(row=>row.provider==='GITHUB')?.handle??'');setError('');}
      }catch{if(current(attempt))setError('Private links could not be loaded. Retry securely.');}
      finally{if(attempt===generation.current){pending.current=false;setBusy(false);if(!current(attempt))clearOwner();}}
    })();
    return ()=>{generation.current++;pending.current=false;};
  },[port]);
  async function operate(action:'read'|'save'|'remove'){
    if(pending.current)return;
    if(epoch.current!==port.getOwnerSessionEpoch()){clearOwner();return;}
    if(action!=='read'&&!records)return;
    const existing=records?.find(row=>row.provider===provider);
    const selected=provider, submitted=handle.trim();
    if(action==='save'&&(!submitted||submitted.length>64)){setError('Enter a valid platform handle.');return;}
    if(action==='remove'&&(!existing||!confirmRemove))return;
    pending.current=true;setBusy(true);setError('');setNotice('');
    const attempt=++generation.current;
    try{
      const service=await freshService(attempt);
      const before=await service.list();
      if(!current(attempt))return;
      const row=before.find(item=>item.provider===selected);
      setRecords(before);
      if(action==='read'){
        if(records===null)setHandle(row?.handle??'');
        setNotice('Private links checked.');
        return;
      }
      // A previous ambiguous response may already have committed; never blindly create twice.
      if(action==='save'&&row?.handle===submitted){setNotice('Private link confirmed saved.');setConfirmRemove(false);return;}
      if(action==='remove'&&!row){setHandle('');setConfirmRemove(false);setNotice('Private link is absent from the saved records.');return;}
      if((row?.id??null)!==(existing?.id??null)||(row?.updated_at??null)!==(existing?.updated_at??null)||
          (row?.handle??null)!==(existing?.handle??null)){
        setError('The saved link changed. Review the current record before retrying. Your typed handle is retained.');
        setConfirmRemove(false);
        return;
      }
      if(!current(attempt))return;
      if(action==='save')await service.save(selected,submitted,row);
      else if(row)await service.remove(row);
      if(!current(attempt))return;
      const after=await service.list();
      if(!current(attempt))return;
      setRecords(after);
      const confirmed=after.find(item=>item.provider===selected);
      if(action==='save'?confirmed?.handle!==submitted:!!confirmed){
        setError('The requested link state could not be confirmed. Refresh before retrying.');
        return;
      }
      if(action==='remove')setHandle('');
      setConfirmRemove(false);
      setNotice(action==='save'?'Private link confirmed saved.':'Private link confirmed removed.');
    }catch{
      if(current(attempt))setError('The private link request could not be confirmed. Your input is retained; retry checks saved records first.');
    }finally{
      if(attempt===generation.current){pending.current=false;setBusy(false);if(!current(attempt))clearOwner();}
    }
  }
  const selected=records?.find(row=>row.provider===provider);
  return <section className="ws-project-fields" aria-labelledby="profile-private-links-title">
    <h2 id="profile-private-links-title">Private platform links</h2>
    <p>Personal handles only. No OAuth connection, provider verification, metrics sync or public exposure.</p>
    <div aria-live="polite">{busy&&<p>Checking private links…</p>}{notice&&<p>{notice}</p>}</div>
    {error&&<p role="alert" className="ws-inline-alert">{error}</p>}
    {records!==null&&<>
      {records.length?<ul>{records.map(row=><li key={row.id}>
        <strong>{profileProviders.find(item=>item.id===row.provider)?.label}</strong>{' '}
        <a href={row.profile_url} target="_blank" rel="noopener noreferrer">{row.handle}</a> · Self-supplied, not verified
      </li>)}</ul>:<p>No private platform links saved.</p>}
      <fieldset disabled={busy}>
        <legend>Add or update a private link</legend>
        <label>Platform<select value={provider} onChange={event=>{
          if(pending.current)return;
          const item=profileProviders.find(row=>row.id===event.target.value);
          if(item){setProvider(item.id);setHandle(records.find(row=>row.provider===item.id)?.handle??'');setError('');setNotice('');setConfirmRemove(false);}
        }}>{profileProviders.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Platform handle<input maxLength={64} autoComplete="off" spellCheck={false} value={handle}
          onChange={event=>{if(!pending.current){setHandle(event.target.value);setConfirmRemove(false);setNotice('');}}}/></label>
        <button type="button" className="ws-primary" disabled={!handle.trim()||handle.trim()===selected?.handle}
          onClick={()=>void operate('save')}>Save private link</button>
        {selected&&<>
          <label className="ws-profile-check"><input type="checkbox" checked={confirmRemove}
            onChange={event=>setConfirmRemove(event.target.checked)}/> Confirm removal of this saved platform link</label>
          <button type="button" className="ws-secondary" disabled={!confirmRemove} onClick={()=>void operate('remove')}>Remove private link</button>
        </>}
      </fieldset>
    </>}
    <button type="button" className="ws-secondary" disabled={busy} onClick={()=>void operate('read')}>
      {error?'Retry or refresh private links':'Refresh private links'}</button>
  </section>;
}
