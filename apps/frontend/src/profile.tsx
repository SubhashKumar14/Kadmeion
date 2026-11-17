import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { normalizeOwnerProfileLinks } from '../../auth-web/src/supabase-auth-port.ts';
import type { OwnerProfile, OwnerProfileLink, SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';

import { Icon } from './landing.tsx';
import type { PrivatePlatformLink, PlatformProvider } from '../../../packages/contracts/src/private-platform-links-service.ts';

type PreviewField = 'displayName' | 'headline' | 'bio';
const previewFields: {key: PreviewField; label: string}[] = [
  {key: 'displayName', label: 'Display name'}, {key: 'headline', label: 'Headline'}, {key: 'bio', label: 'About you'}
];

// Match owner_save_profile_draft's btrim (space only) and ordered private skills.
const trimProfileSpaces=(value:string)=>value.replace(/^ +| +$/g,'');
function canonicalProfileDraft(profile:OwnerProfile){
  return {displayName:trimProfileSpaces(profile.displayName),headline:trimProfileSpaces(profile.headline),
    bio:trimProfileSpaces(profile.bio),skills:profile.skills.map(trimProfileSpaces)};
}
function equalProfileFields(a:ReturnType<typeof canonicalProfileDraft>,b:ReturnType<typeof canonicalProfileDraft>){
  return a.displayName===b.displayName&&a.headline===b.headline&&a.bio===b.bio&&
    a.skills.length===b.skills.length&&a.skills.every((skill,index)=>skill===b.skills[index]);
}
function profileDraftError(profile:OwnerProfile){
  const value=canonicalProfileDraft(profile);
  if(!value.displayName.trim()||value.displayName.length>80)return 'Enter a display name of up to 80 characters.';
  if(value.headline.length>160||value.bio.length>2000||value.skills.length>20||
    value.skills.some(skill=>!skill.trim()||skill.length>40))return 'Check the length of your profile fields and skills.';
  return '';
}

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
  const [autosave,setAutosave]=useState(false);
  const [activeSaveMode,setActiveSaveMode]=useState<'manual'|'auto'|null>(null);
  const [latestProfile,setLatestProfile]=useState<OwnerProfile|null>(null);
  const [checkingLatest,setCheckingLatest]=useState(false);
  const [confirmRebase,setConfirmRebase]=useState(false);
  const [uncertainSave,setUncertainSave]=useState<ReturnType<typeof canonicalProfileDraft>|null>(null);
  const [sessionExpired,setSessionExpired]=useState(false);
  const profileEpoch=useRef(port.getOwnerSessionEpoch());
  const profileLifetime=useRef(0);
  const autoTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const autoEnabled=useRef(false);
  function cancelScheduledSave(){
    if(autoTimer.current!==null)clearTimeout(autoTimer.current);
    autoTimer.current=null;
  }
  function stopAutosave(){autoEnabled.current=false;cancelScheduledSave();setAutosave(false);}
  function expireProfile(){
    stopAutosave();invalidateProjection();setSaved(null);setDraft(null);setSkill('');setSkillError('');
    setLatestProfile(null);setUncertainSave(null);setConfirmRebase(false);setWithdrawal(false);
    setBusy(false);setActiveSaveMode(null);setLoadingProfile(false);setCheckingLatest(false);
    setNeedsReload(true);setSessionExpired(true);setNotice('');setError('Your owner session changed. Reopen your profile.');
  }
  function validEpoch(){
    return profileEpoch.current===port.reconcileOwnerSessionEpoch();
  }
  useEffect(()=>{
    profileEpoch.current=port.getOwnerSessionEpoch();
    profileLifetime.current++;
    const unsubscribe=port.subscribeOwnerSessionEpoch(next=>{
      if(next!==profileEpoch.current){profileLifetime.current++;operationPending.current=true;expireProfile();}
    });
    return ()=>{profileLifetime.current++;autoEnabled.current=false;cancelScheduledSave();unsubscribe();};
  },[port]);
  // A ref closes the synchronous gap before React commits disabled controls.
  const operationPending = useRef(true);
  const locked = busy || loadingProfile || checkingLatest || sessionExpired;

  useEffect(() => {
    let active = true;
    const lifetime=profileLifetime.current;
    const current=()=>active&&lifetime===profileLifetime.current&&validEpoch();
    operationPending.current = true;
    setLoadingProfile(true);
    const failRead = (message: string) => {
      if (!current()) return;
      setError(message);
      setNeedsReload(true);
      setReloadFailed(true);
      // Keep the current saved baseline, draft and unadded skill on failure.
    };
    if(!current())return;
    void port.readOwnerProfile().then(({data, error}) => {
      if (!current()) return;
      if (!data || error) { failRead(error?.message ?? 'Private profile is unavailable.'); return; }
      setSaved(data);
      setDraft(data);
      setSkill('');
      setSkillError('');
      setError('');
      setWithdrawal(false);
      setNeedsReload(false);
      setReloadFailed(false);
      setLatestProfile(null);setUncertainSave(null);setConfirmRebase(false);
    }).catch(() => {
      failRead('Could not reach your private profile. Retry when your connection is restored.');
    }).finally(() => {
      if (current()) {
        operationPending.current = false;
        setLoadingProfile(false);
      }
    });
    return () => { active = false; };
  }, [port, retry]);

  function requestReload() {
    if (operationPending.current||!validEpoch()) return;
    stopAutosave();setLatestProfile(null);setConfirmRebase(false);
    operationPending.current = true;
    invalidateProjection();
    setLoadingProfile(true);
    setError('');
    setNotice('');
    setWithdrawal(false);
    setRetry(value => value + 1);
  }

  function edit(field: PreviewField, value: string) {
    if (operationPending.current||!validEpoch()) return;
    cancelScheduledSave();setLatestProfile(null);setConfirmRebase(false);
    setDraft(current => current ? {...current, [field]: value} : current);
    setWithdrawal(false);
    setNotice('');
  }

  function addSkill() {
    const value = skill.trim();
    if (operationPending.current || !draft || !value || !validEpoch()) return;
    cancelScheduledSave();setLatestProfile(null);setConfirmRebase(false);
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

  // A failed CAS or uncertain receipt pauses the timer. A new save requires
  // a verified baseline; never use a retry that silently rebases the draft.
  function pauseForReview(message:string,desired:ReturnType<typeof canonicalProfileDraft>|null){
    stopAutosave();setError(message);setNeedsReload(true);setUncertainSave(desired);
    setLatestProfile(null);setConfirmRebase(false);setWithdrawal(false);
  }
  async function persistProfile(mode:'manual'|'auto'){
    cancelScheduledSave();
    if(!saved||!draft||operationPending.current||needsReload||!validEpoch())return;
    if(mode==='auto'&&(!autoEnabled.current||withdrawal))return;
    const validation=profileDraftError(draft);
    if(validation){if(mode==='manual'){setError(validation);setPanel('Profile');}return;}
    const desired=canonicalProfileDraft(draft),expected={...saved,skills:[...saved.skills]};
    if(equalProfileFields(expected,desired)){
      setDraft({...saved,skills:[...saved.skills]});setError('');setNotice('');return;
    }
    const lifetime=profileLifetime.current,current=()=>lifetime===profileLifetime.current&&validEpoch();
    operationPending.current=true;
    invalidateProjection();setBusy(true);setActiveSaveMode(mode);setError('');setNotice('');
    try{
      // SQL rejects a public-field write with a live projection unless an
      // explicit manual confirmation is passed. Autosave always sends false.
      const result=await port.saveOwnerProfile(expected,desired,mode==='manual'&&withdrawal);
      if(!current())return;
      if(result.error||!result.data){
        const message=result.error?.message??'Profile save could not be confirmed.';
        if(/Confirm withdrawal/i.test(message)){
          stopAutosave();setWithdrawal(false);setError(message);return;
        }
        if(authoredLinkDenial(message)){
          stopAutosave();setNotice('');setError(message);setNeedsReload(true);return;
        }
        pauseForReview(message,desired);return;
      }
      if(!equalProfileFields(result.data,desired)){
        pauseForReview('Profile save receipt did not match the requested draft. Check the latest saved profile.',desired);return;
      }
      // The response is the authenticated transactional CAS receipt. It is
      // the last acknowledged version, not a promise of current public state.
      setSaved(result.data);setDraft(result.data);setWithdrawal(false);
      setLatestProfile(null);setConfirmRebase(false);setUncertainSave(null);
      setNotice(mode==='auto'?'Private profile draft autosaved.':'Private profile draft saved.');
    }catch{
      if(current())pauseForReview('Private profile save could not be verified. Your edits are still here.',desired);
    }finally{
      if(current()){operationPending.current=false;setBusy(false);setActiveSaveMode(null);}
    }
  }
  function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();void persistProfile('manual');
  }
  async function checkLatestProfile(){
    if(operationPending.current||!saved||!draft||!validEpoch())return;
    stopAutosave();invalidateProjection();setWithdrawal(false);
    operationPending.current=true;setCheckingLatest(true);setLatestProfile(null);setConfirmRebase(false);setNotice('');
    const lifetime=profileLifetime.current,current=()=>lifetime===profileLifetime.current&&validEpoch();
    try{
      const result=await port.readOwnerProfile();
      if(!current())return;
      if(result.error||!result.data){
        setError('Latest private profile could not be verified. Your unsaved draft is retained.');return;
      }
      const latest=result.data;
      if(uncertainSave&&equalProfileFields(latest,uncertainSave)&&equalProfileFields(canonicalProfileDraft(draft),uncertainSave)){
        setSaved(latest);setDraft(latest);setNeedsReload(false);setUncertainSave(null);setReloadFailed(false);
        setError('');setNotice('Requested private draft is confirmed saved. No additional write was made.');return;
      }
      if(equalProfileFields(latest,saved)&&latest.handle===saved.handle){
        setSaved(latest);setNeedsReload(false);setUncertainSave(null);setReloadFailed(false);
        setError('');setNotice('Saved profile is unchanged. Your edits are retained; save explicitly.');return;
      }
      setLatestProfile(latest);setNeedsReload(true);
      setError('Your profile changed in another session. Compare the saved fields before choosing how to continue.');
    }catch{
      if(current())setError('Latest private profile check failed. Your draft is retained.');
    }finally{
      if(current()){operationPending.current=false;setCheckingLatest(false);}
    }
  }
  function resolveProfileComparison(keepDraft:boolean){
    if(operationPending.current||!latestProfile||!validEpoch()||(keepDraft&&!confirmRebase))return;
    stopAutosave();setSaved(latestProfile);setDraft(current=>keepDraft&&current?{...current,handle:latestProfile.handle}:latestProfile);
    setLatestProfile(null);setConfirmRebase(false);setUncertainSave(null);setNeedsReload(false);setReloadFailed(false);
    setError('');setWithdrawal(false);
    setNotice(keepDraft?'Latest saved fields loaded as the comparison baseline. Your edits still need an explicit save.':
      'Latest saved profile loaded; unsaved edits discarded.');
  }

  const dirty = !!(saved && draft && (
    saved.displayName !== draft.displayName || saved.headline !== draft.headline ||
    saved.bio !== draft.bio || saved.skills.join('\u0000') !== draft.skills.join('\u0000')
  ));
  // Opt-in is scoped to the mounted verified workspace. Never schedule a
  // request on a stale owner, a failed/ambiguous save, or confirmed withdrawal.
  useEffect(()=>{
    cancelScheduledSave();
    if(!autosave||!autoEnabled.current||!dirty||!draft||locked||needsReload||withdrawal||latestProfile||
      profileDraftError(draft)||!validEpoch())return;
    autoTimer.current=setTimeout(()=>{autoTimer.current=null;void persistProfile('auto');},1200);
    return cancelScheduledSave;
  },[autosave,saved,draft,dirty,locked,needsReload,withdrawal,latestProfile,port]);
  useEffect(()=>{
    if(!dirty&&!skill.trim()&&!busy&&!checkingLatest)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);
    return ()=>window.removeEventListener('beforeunload',warn);
  },[dirty,skill,busy,checkingLatest]);
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
        <button type="submit" className="ws-primary" disabled={locked || needsReload || !draft || !dirty}>{busy ? activeSaveMode==='auto'?'Autosaving…':'Saving…' : 'Save profile draft'}</button>
      </div>
      <div className="ws-profile-tabs" role="group" aria-label="Profile sections">
        {['Profile', 'Skills & links', 'Visibility', 'Public preview'].map(item =>
          <button key={item} type="button" aria-pressed={panel === item} onClick={() => {if(item==='Skills & links')setOpenedLinks(true);setPanel(item);}}>{item}</button>)}
      </div>
      {error && <div role="alert" className="ws-inline-alert">{error}</div>}
      {notice && <div role="status" className="ws-inline-alert">{notice}</div>}
      {draft&&<div className="ws-project-fields">
        <label className="ws-profile-check"><input type="checkbox" checked={autosave}
          disabled={locked||needsReload||withdrawal} onChange={event=>{
            if(operationPending.current||!validEpoch())return;
            if(event.target.checked){autoEnabled.current=true;setAutosave(true);}
            else stopAutosave();
          }}/> Autosave private profile fields</label>
        <p>Off by default each time this editor opens. Only name, headline, bio and skills are saved after a short pause; links save separately. Autosave never confirms publication withdrawal. Unsaved edits stay in this editor, not offline storage.</p>
        {autosave&&dirty&&!busy&&<p>{profileDraftError(draft)||'Unsaved private edits will be saved after you stop editing.'}</p>}
      </div>}
      {dirty && <div className="ws-unsaved-line" role="status">
        <span>Unsaved private changes</span>
        <button type="button" className="ws-text-action" disabled={locked} onClick={() => {
          if (operationPending.current||!validEpoch()) return;
          cancelScheduledSave();setLatestProfile(null);setConfirmRebase(false);
          if (saved) setDraft({...saved, skills:[...saved.skills]});
          setWithdrawal(false); if (!needsReload) setError(''); setNotice('');
        }}>Discard changes</button>
      </div>}
      {loadingProfile && <p role="status">{draft
        ? 'Loading the latest private draft… Your edits are retained until the read succeeds.'
        : 'Loading your private profile…'}</p>}
      {!draft && error && !loadingProfile && !sessionExpired && <button type="button" className="ws-secondary" disabled={locked} onClick={requestReload}>Retry profile</button>}
      {draft && needsReload && !loadingProfile && <>
        <p>Check the latest saved draft before saving again. You can compare without discarding your edits, or explicitly reload the saved draft.</p>
        <button type="button" className="ws-secondary" disabled={locked} onClick={()=>void checkLatestProfile()}>{checkingLatest?'Checking…':'Compare latest saved profile'}</button>
        <button type="button" className="ws-secondary" disabled={locked} onClick={requestReload}>
          {reloadFailed ? 'Retry loading latest draft (discard edits on success)' : 'Discard edits and load latest draft'}
        </button>
      </>}
      {latestProfile&&<fieldset className="ws-project-fields" disabled={locked}>
        <legend>Latest saved profile compared with your draft</legend>
        <dl>
          <dt>Display name</dt><dd>{latestProfile.displayName}</dd>
          <dt>Headline</dt><dd>{latestProfile.headline||'—'}</dd>
          <dt>About you</dt><dd>{latestProfile.bio||'—'}</dd>
          <dt>Skills</dt><dd>{latestProfile.skills.join(', ')||'—'}</dd>
        </dl>
        <label className="ws-profile-check"><input type="checkbox" checked={confirmRebase}
          onChange={event=>setConfirmRebase(event.target.checked)}/> I reviewed the latest fields and want to keep my draft for a separate save.</label>
        <button type="button" className="ws-secondary" disabled={!confirmRebase} onClick={()=>resolveProfileComparison(true)}>Keep draft against latest profile</button>
        <button type="button" className="ws-secondary" onClick={()=>resolveProfileComparison(false)}>Discard profile edits and use compared fields</button>
      </fieldset>}
      {error.includes('Confirm withdrawal') && <label className="ws-profile-confirm">
        <input type="checkbox" disabled={locked || needsReload} checked={withdrawal} onChange={event => {stopAutosave();setWithdrawal(event.target.checked);}}/>
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
                  if (operationPending.current||!validEpoch()) return;
                  cancelScheduledSave();setLatestProfile(null);setConfirmRebase(false);
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
            <p>Manage private authored HTTPS links and self-supplied platform handles below. Project URLs are managed in the <a href="/app/projects">project library</a>.</p>
          </>}
          {panel === 'Visibility' && <>
            <p>Choose which eligible fields to include in the private preview, or inspect your saved sharing preferences. These selections do not save sharing consent or publish anything. Skills, authored links, platform links, email and account details stay out of this projection.</p>
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
    {draft&&openedLinks&&<div hidden={panel!=='Skills & links'}><AuthoredProfileLinks port={port}/><PrivateProfileLinks port={port}/></div>}
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


type AuthoredLinkRow = OwnerProfileLink & {key:number};
type AuthoredLinkAttempt = {
  expected:OwnerProfileLink[];
  desired:OwnerProfileLink[];
  acknowledged:boolean;
  checkOnly:boolean;
};
const sameAuthoredLinks=(a:readonly OwnerProfileLink[],b:readonly OwnerProfileLink[]) =>
  a.length===b.length&&a.every((link,index)=>link.label===b[index]?.label&&link.url===b[index]?.url);
const authoredValues=(rows:readonly AuthoredLinkRow[])=>rows.map(({label,url})=>({label,url}));
function boundedAuthoredLinks(rows:readonly OwnerProfileLink[]):OwnerProfileLink[]{
  const normalized=normalizeOwnerProfileLinks(rows);
  // PostgreSQL's jsonb text adds whitespace to compact JSON. Leave space for
  // separators as well as enforce the actual UTF-8 budget on the canonical list.
  if(new TextEncoder().encode(JSON.stringify(normalized)).byteLength+normalized.length*4>32768)
    throw new Error('Private profile links exceed the saved-list size limit.');
  return normalized;
}
function authoredLinkDenial(message:string){
  return /access was denied|session (?:changed|verification is required)|owner session (?:changed|verification is required)/i.test(message);
}

/** Authenticated owner-private list, not a provider connection or public
 * projection. CAS compares the entire ordered list and replays only the
 * original desired state. A separate authoritative read reconciles receipts.
 */
function AuthoredProfileLinks({port}:{port:SupabaseBrowserAuthPort}){
  const [saved,setSaved]=useState<OwnerProfileLink[]|null>(null);
  const [rows,setRows]=useState<AuthoredLinkRow[]>([]);
  const [remote,setRemote]=useState<OwnerProfileLink[]|null>(null);
  const [operation,setOperation]=useState<AuthoredLinkAttempt|null>(null);
  const [busy,setBusy]=useState(true);
  const [needsCheck,setNeedsCheck]=useState(true);
  const [expired,setExpired]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [confirmReapply,setConfirmReapply]=useState(false);
  const sequence=useRef(0);
  const generation=useRef(0);
  const pending=useRef(true);
  const mounted=useRef(false);
  const epoch=useRef(port.getOwnerSessionEpoch());
  const current=(id:number)=>mounted.current&&id===generation.current&&epoch.current===port.getOwnerSessionEpoch();
  const freshRows=(links:readonly OwnerProfileLink[])=>links.map(link=>({...link,key:++sequence.current}));
  const raw=authoredValues(rows);
  const dirty=saved!==null&&!sameAuthoredLinks(saved,raw);
  const editable=!busy&&!operation&&!remote&&!expired&&saved!==null;

  function clearPrivate(message:string,sessionChanged=false){
    setSaved(null);setRows([]);setRemote(null);setOperation(null);
    setConfirmReapply(false);setNeedsCheck(true);setNotice('');setError(message);
    if(sessionChanged)setExpired(true);
  }
  function accept(links:OwnerProfileLink[],message:string){
    setSaved(links);setRows(freshRows(links));setRemote(null);setOperation(null);
    setNeedsCheck(false);setConfirmReapply(false);setError('');setNotice(message);
  }
  function compareRemote(links:OwnerProfileLink[],message:string){
    setRemote(links);setOperation(null);setNeedsCheck(true);setConfirmReapply(false);
    setError(message);setNotice('');
  }
  function fail(message:string){
    setNotice('');
    if(authoredLinkDenial(message)){
      clearPrivate('Private authored links are unavailable. Verify your owner session and reload.',
        epoch.current!==port.getOwnerSessionEpoch());return;
    }
    setError(message);setNeedsCheck(true);
  }
  async function read(id:number,attempt:AuthoredLinkAttempt|null,baseline:OwnerProfileLink[]|null,local:OwnerProfileLink[]){
    try{
      const result=await port.readOwnerProfileLinks(epoch.current);
      if(!current(id))return;
      if(result.error||!result.data||result.data.publicDeliveryAllowed!==false){
        fail(result.error?.message??'Private authored links could not be verified.');return;
      }
      const links=boundedAuthoredLinks(result.data.links);
      if(!sameAuthoredLinks(links,result.data.links))throw new Error('Noncanonical private links.');
      if(attempt){
        if(sameAuthoredLinks(links,attempt.desired)){
          accept(links,'Private authored links confirmed saved.');return;
        }
        if(!attempt.acknowledged&&sameAuthoredLinks(links,attempt.expected)){
          // A verified unchanged base permits explicit replay only; no auto write.
          setRemote(null);setNeedsCheck(false);setOperation({...attempt,checkOnly:false});
          setError('The original saved list is unchanged. Retry the original save or keep the draft.');
          return;
        }
        compareRemote(links,'Saved authored links changed. Compare the current saved list and your retained draft.');return;
      }
      if(baseline===null||sameAuthoredLinks(baseline,local)){
        accept(links,'Private authored links checked.');return;
      }
      // A manually refreshed dirty buffer must remain intact. Do not auto
      // adopt a new CAS baseline even when some rows happen to overlap.
      if(sameAuthoredLinks(links,baseline)){
        setRemote(null);setNeedsCheck(false);setConfirmReapply(false);
        setError('');setNotice('Saved list checked. Unsaved edits retained.');return;
      }
      compareRemote(links,'Saved authored links changed. Compare before replacing either list.');
    }catch{
      if(current(id))fail('Could not verify the saved authored links. Retry the read; your draft is retained.');
    }
  }
  function begin(){
    if(pending.current||!mounted.current||expired)return null;
    if(epoch.current!==port.getOwnerSessionEpoch()){
      clearPrivate('Your owner session changed. Reopen your profile.',true);return null;
    }
    pending.current=true;setBusy(true);setError('');setNotice('');
    return ++generation.current;
  }
  function finish(id:number){
    if(!mounted.current||id!==generation.current)return;
    pending.current=false;setBusy(false);
    if(!current(id))clearPrivate('Your owner session changed. Reopen your profile.',true);
  }
  useEffect(()=>{
    mounted.current=true;epoch.current=port.getOwnerSessionEpoch();
    pending.current=true;setBusy(true);
    const id=++generation.current;
    const unsubscribe=port.subscribeOwnerSessionEpoch(next=>{
      if(!mounted.current||next===epoch.current)return;
      ++generation.current;pending.current=false;setBusy(false);
      clearPrivate('Your owner session changed. Reopen your profile.',true);
    });
    void read(id,null,null,[]).finally(()=>finish(id));
    return ()=>{mounted.current=false;++generation.current;pending.current=false;unsubscribe();};
  },[port]);

  function change(update:(previous:AuthoredLinkRow[])=>AuthoredLinkRow[]){
    if(!editable||pending.current)return;
    if(epoch.current!==port.getOwnerSessionEpoch()){
      clearPrivate('Your owner session changed. Reopen your profile.',true);return;
    }
    setRows(update);setNotice('');if(!needsCheck)setError('');
  }
  function refresh(){
    const id=begin();if(id===null)return;
    setRemote(null);setConfirmReapply(false);
    void read(id,operation,saved,raw).finally(()=>finish(id));
  }
  async function save(){
    if(pending.current||expired||remote||saved===null)return;
    if(operation&&(operation.acknowledged||operation.checkOnly))return;
    if(!operation&&(needsCheck||!dirty))return;
    let attempt=operation;
    if(!attempt){
      let desired:OwnerProfileLink[];
      try{desired=boundedAuthoredLinks(raw);}
      catch(cause){setError(cause instanceof Error?cause.message:'Enter valid private HTTPS links.');return;}
      if(sameAuthoredLinks(saved,desired)){
        accept(saved,'No changes to save after link normalization.');return;
      }
      attempt={expected:saved.map(link=>({...link})),desired,acknowledged:false,checkOnly:false};
    }
    const id=begin();if(id===null)return;
    setOperation(attempt);
    try{
      const outcome=await port.saveOwnerProfileLinks(attempt.expected,attempt.desired,epoch.current);
      if(!current(id))return;
      if(outcome.error||!outcome.data||outcome.data.publicDeliveryAllowed!==false||
          !sameAuthoredLinks(outcome.data.links,attempt.desired)){
        const message=outcome.error?.message??'The save response could not be verified.';
        if(authoredLinkDenial(message)){fail(message);return;}
        const conflict=/another session|workspace conflict/i.test(message);
        setOperation({...attempt,checkOnly:conflict});
        fail(conflict?'Saved authored links changed. Check the latest list before retrying.':
          message+' Your original save is retained; check the saved list or retry the exact request.');
        return;
      }
      const received={...attempt,acknowledged:true,checkOnly:true};
      setOperation(received);setNeedsCheck(true);
      // A verified mutation receipt is not a fresh read after a concurrent edit.
      // Never replay an acknowledged mutation because its readback failed.
      await read(id,received,saved,raw);
    }catch{
      if(current(id)){
        fail('Private authored link save could not be verified. Check the saved list or retry the original request.');
      }
    }finally{finish(id);}
  }
  function loadRemote(reapply:boolean){
    if(pending.current||expired||!remote||(reapply&&!confirmReapply))return;
    if(epoch.current!==port.getOwnerSessionEpoch()){
      clearPrivate('Your owner session changed. Reopen your profile.',true);return;
    }
    if(reapply){
      setSaved(remote);setRemote(null);setOperation(null);setNeedsCheck(false);setConfirmReapply(false);
      setError('');setNotice('Latest saved list checked. Your draft is retained; save explicitly to replace it.');
    }else accept(remote,'Latest saved authored links loaded; unsaved edits discarded.');
  }
  function keepDraft(){
    if(pending.current||expired||!operation||operation.acknowledged||operation.checkOnly||needsCheck)return;
    if(epoch.current!==port.getOwnerSessionEpoch()){
      clearPrivate('Your owner session changed. Reopen your profile.',true);return;
    }
    // Only a successful read of the unchanged base permits releasing the
    // original ambiguous attempt to edit it again.
    setOperation(null);setError('');setNotice('Unsaved draft retained; no new request was sent.');
  }
  return <section className="ws-project-fields" aria-labelledby="profile-authored-links-title" aria-busy={busy}>
    <h2 id="profile-authored-links-title">Private authored links</h2>
    <p>Save up to 12 personal HTTPS links with labels. These are private, self-supplied destinations, not verified profiles or public sharing choices.</p>
    <div aria-live="polite">{busy&&<p>Checking or saving private authored links…</p>}{notice&&<p>{notice}</p>}
      {dirty&&<p>Unsaved authored link changes.</p>}</div>
    {error&&<p role="alert" className="ws-inline-alert">{error}</p>}
    {saved!==null&&!expired&&<>
      <fieldset disabled={!editable}>
        <legend>Edit authored links ({rows.length} of 12)</legend>
        {rows.length===0&&<p>No authored links in this draft.</p>}
        {rows.map((row,index)=><fieldset key={row.key}>
          <legend>Link {index+1}</legend>
          <label>Label {index+1}<input value={row.label} maxLength={80} autoComplete="off"
            onChange={event=>{const label=event.target.value;change(previous=>previous.map(item=>item.key===row.key?{...item,label}:item));}}/></label>
          <label>HTTPS URL {index+1}<input type="url" value={row.url} maxLength={2048} autoComplete="off" spellCheck={false}
            onChange={event=>{const url=event.target.value;change(previous=>previous.map(item=>item.key===row.key?{...item,url}:item));}}/></label>
          <div className="ws-actions">
            <button type="button" className="ws-secondary" aria-label={'Move link '+(index+1)+' up'} disabled={index===0} onClick={()=>change(previous=>{
              const at=previous.findIndex(item=>item.key===row.key);if(at<=0)return previous;
              const next=[...previous];const item=next.splice(at,1)[0];if(item)next.splice(at-1,0,item);return next;
            })}>Move up</button>
            <button type="button" className="ws-secondary" aria-label={'Move link '+(index+1)+' down'} disabled={index===rows.length-1} onClick={()=>change(previous=>{
              const at=previous.findIndex(item=>item.key===row.key);if(at<0||at>=previous.length-1)return previous;
              const next=[...previous];const item=next.splice(at,1)[0];if(item)next.splice(at+1,0,item);return next;
            })}>Move down</button>
            <button type="button" className="ws-secondary" aria-label={'Remove authored link '+(index+1)}
              onClick={()=>change(previous=>previous.filter(item=>item.key!==row.key))}>Remove link</button>
          </div>
        </fieldset>)}
        <button type="button" className="ws-secondary" disabled={rows.length>=12}
          onClick={()=>{const key=++sequence.current;change(previous=>previous.length>=12?previous:[...previous,{key,label:'',url:''}]);}}>Add authored link</button>
      </fieldset>
      {remote!==null&&<fieldset disabled={busy}>
        <legend>Compare latest saved authored links</legend>
        <p>Your draft above is retained. The current saved list is:</p>
        {remote.length?<ol>{remote.map((link,index)=><li key={index}><strong>{link.label}</strong>{' '}<span>{link.url}</span></li>)}</ol>:<p>No links are currently saved.</p>}
        <label className="ws-profile-check"><input type="checkbox" checked={confirmReapply} onChange={event=>setConfirmReapply(event.target.checked)}/>
          I reviewed this list and want to keep my draft for a separate save that replaces it.</label>
        <button type="button" className="ws-secondary" disabled={!confirmReapply} onClick={()=>loadRemote(true)}>Keep draft against latest list</button>
        <button type="button" className="ws-secondary" onClick={()=>loadRemote(false)}>Discard draft and load latest list</button>
      </fieldset>}
      {!remote&&<div className="ws-actions">
        {!operation&&<button type="button" className="ws-primary" disabled={busy||needsCheck||!dirty} onClick={()=>void save()}>Save authored links</button>}
        {operation&&!operation.checkOnly&&!operation.acknowledged&&<button type="button" className="ws-primary" disabled={busy} onClick={()=>void save()}>Retry original authored link save</button>}
        {operation&&!operation.checkOnly&&!operation.acknowledged&&!needsCheck&&<button type="button" className="ws-secondary" disabled={busy} onClick={keepDraft}>Keep editing unsaved links</button>}
        {!operation&&dirty&&<button type="button" className="ws-secondary" disabled={busy} onClick={()=>{
          if(pending.current||epoch.current!==port.getOwnerSessionEpoch())return;
          setRows(freshRows(saved));setNotice('Unsaved authored link changes discarded.');if(!needsCheck)setError('');
        }}>Discard authored link changes</button>}
      </div>}
    </>}
    {!expired&&<button type="button" className="ws-secondary" disabled={busy} onClick={refresh}>
      {operation?.acknowledged?'Verify saved authored links':saved===null?'Retry authored links':'Check latest authored links'}</button>}
  </section>;
}
