import {useEffect, useMemo, useRef, useState} from 'react';
import type {FormEvent} from 'react';
import type {SupabaseBrowserAuthPort} from '../../auth-web/src/supabase-auth-port.ts';
import type {
  SupabasePrivateGoalsService, PrivateGoal, GoalProgress, GoalMilestone, GoalStatus
} from '../../../packages/contracts/src/private-goals-service.ts';
import type {
  SupabasePrivatePlatformLinksService, PrivatePlatformLink, PlatformProvider
} from '../../../packages/contracts/src/private-platform-links-service.ts';

const routes={
  '/app/growth':'Growth overview',
  '/app/growth/activity':'Developer activity',
  '/app/growth/devscore':'Private DevScore',
  '/app/growth/goals':'Your goals',
  '/app/analytics':'Portfolio analytics',
  '/app/integrations':'Platform connections'
} as const;
type GrowthRoute=keyof typeof routes;
type GrowthServices={goals:SupabasePrivateGoalsService;links:SupabasePrivatePlatformLinksService};
export function isGrowthRoute(path:string):boolean{return Object.hasOwn(routes,path);}
const providers:Readonly<{id:PlatformProvider;name:string;description:string}[]>= [
  {id:'GITHUB',name:'GitHub',description:'Developer code profile'},
  {id:'LEETCODE',name:'LeetCode',description:'Programming practice profile'},
  {id:'CODEFORCES',name:'Codeforces',description:'Competitive programming profile'},
  {id:'HACKERRANK',name:'HackerRank',description:'Programming challenges profile'},
  {id:'KAGGLE',name:'Kaggle',description:'Data science profile'},
  {id:'HUGGING_FACE',name:'Hugging Face',description:'Machine learning community profile'}
];
function presentError(err:unknown):string {
  if(err instanceof Error && (err.name==='PrivateGoalsError'||err.name==='PrivatePlatformLinkError'))
    return 'The private server did not confirm the requested change. Verify your session and retry.';
  return 'Private growth data is currently unavailable. No saved value was assumed.';
}
function useGoals(service:SupabasePrivateGoalsService){
  const [goals,setGoals]=useState<PrivateGoal[]|null>(null);
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    let active=true;
    void service.listGoals().then(items=>{
      if(active){setGoals(items);setError('');}
    }).catch(err=>{if(active){setError(presentError(err));setGoals(null);}});
    return ()=>{active=false;};
  },[service,revision]);
  return {goals,error,reload:()=>setRevision(value=>value+1)};
}
function LoadingOrError({goals,error,retry}:{goals:PrivateGoal[]|null;error:string;retry:()=>void}){
  if(error)return <div role="alert" className="ws-inline-alert">{error}
    <button type="button" className="ws-secondary" onClick={retry}>Retry private records</button></div>;
  if(goals===null)return <p role="status">Loading owner-private goal records…</p>;
  return null;
}

function GrowthHome({service}: {service:SupabasePrivateGoalsService}){
  const {goals,error,reload}=useGoals(service);
  const active=goals?.filter(item=>item.status==='ACTIVE').length ?? 0;
  const completed=goals?.filter(item=>item.status==='COMPLETED').length ?? 0;
  return <div className="ws-growth-layout">
    <section className="ws-project-aside">
      <h2>Private progress, not a leaderboard.</h2>
      <p>Track personal development using your own goals. Nothing here is published to your profile or verified by outside providers.</p>
      <LoadingOrError goals={goals} error={error} retry={reload}/>
      {goals!==null && <div className="ws-growth-facts" role="group" aria-label="Loaded private goals">
        <div><strong>{active}</strong><span>Active goals in loaded records</span></div>
        <div><strong>{completed}</strong><span>Completed goals in loaded records</span></div>
      </div>}
      {goals?.length===100&&<p>Showing at most 100 recent goals, not a lifetime total.</p>}
      <a className="ws-primary" href="/app/growth/goals">Manage private goals</a>
    </section>
    <section className="ws-project-aside">
      <h2>Choose your next step</h2>
      <div className="ws-growth-links">
        <a href="/app/growth/activity">View self-reported activity</a>
        <a href="/app/growth/devscore">Understand DevScore evidence</a>
        <a href="/app/integrations">Add optional profile links</a>
        <a href="/app/analytics">Review analytics availability</a>
      </div>
      <p>External synchronization and visitor analytics are unavailable until independently verified. Missing integrations never reduce a score.</p>
    </section>
  </div>;
}

/** Existing backend cursor is UUID-ordered, not chronological. Sort only
 * loaded records and never claim a partial page is the latest history. */
function ProgressHistory({service,goalId,onCorrection,busy=false}:{
  service:SupabasePrivateGoalsService;goalId:string;onCorrection?:(item:GoalProgress)=>void;busy?:boolean
}){
  const [page,setPage]=useState<{items:GoalProgress[];nextCursor:string|null}|null>(null);
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  const [loadingMore,setLoadingMore]=useState(false);
  const alive=useRef(false);
  const inFlight=useRef(false);
  useEffect(()=>{
    let active=true;alive.current=true;setPage(null);setError('');
    void service.listProgressPage(goalId,50).then(result=>{if(active)setPage(result);})
      .catch(err=>{if(active)setError(presentError(err));});
    return()=>{active=false;alive.current=false;};
  },[service,goalId,attempt]);
  async function more(){
    if(!page?.nextCursor||inFlight.current||busy)return;
    const cursor=page.nextCursor;
    inFlight.current=true;setLoadingMore(true);setError('');
    try{
      const next=await service.listProgressPage(goalId,50,cursor);
      if(!alive.current)return;
      setPage(previous=>{
        if(!previous||previous.nextCursor!==cursor)return previous;
        const seen=new Set(previous.items.map(item=>item.id));
        return {...next,items:[...previous.items,...next.items.filter(item=>!seen.has(item.id))]};
      });
    }catch(err){if(alive.current)setError(presentError(err));}
    finally{inFlight.current=false;if(alive.current)setLoadingMore(false);}
  }
  const events=page?.items.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
  return <section aria-label="Private manual progress history">
    {error&&<div><p role="alert">{error}</p>
      <button type="button" className="ws-secondary" disabled={busy||loadingMore}
        onClick={()=>page?void more():setAttempt(n=>n+1)}>Retry activity history</button>
    </div>}
    {!page&&!error&&<p role="status">Loading manual progress history…</p>}
    {page?.items.length===0&&<p>No manual progress has been recorded for this goal.</p>}
    {!!events?.length&&<><p>{events.length} loaded self-reported entries. {page?.nextCursor?'More entries exist; the date order applies only to loaded records.':'All pages reached for this read; refresh to check for changes.'}</p>
      <ol className="ws-growth-events">{events.map(item=><li key={item.id}>
        <strong>{item.value.toLocaleString()} · Self-reported</strong>
        <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
        <p>{item.note||'No note added.'}</p>
        {onCorrection&&<button type="button" className="ws-secondary" disabled={busy}
          onClick={()=>onCorrection(item)}>Use value for correction</button>}
      </li>)}</ol></>}
    {page?.nextCursor&&!error&&<button type="button" className="ws-secondary" disabled={busy||loadingMore}
      onClick={()=>void more()}>{loadingMore?'Loading more history…':'Load more history'}</button>}
    {page&&!loadingMore&&<button type="button" className="ws-secondary" disabled={busy}
      onClick={()=>setAttempt(n=>n+1)}>Refresh activity history</button>}
  </section>;
}

function Activity({service}:{service:SupabasePrivateGoalsService}){
  const {goals,error,reload}=useGoals(service);
  const [id,setId]=useState('');
  const selected=goals?.find(goal=>goal.id===id);
  return <section className="ws-project-aside">
    <h2>Manual activity history</h2>
    <p>Entries are self-recorded absolute values, not GitHub commits, coding-platform statistics or verified daily streaks.</p>
    <LoadingOrError goals={goals} error={error} retry={reload}/>
    {goals&&<label className="ws-growth-field">Activity goal<select aria-label="Activity goal" value={selected?.id??''}
      onChange={event=>setId(event.target.value)}>
      <option value="">Choose a goal to inspect</option>
      {goals.map(goal=><option key={goal.id} value={goal.id}>{goal.title}</option>)}
    </select></label>}
    {goals?.length===100&&<p>Showing up to 100 recent goals. Earlier goals may exist.</p>}
    {selected&&<ProgressHistory key={selected.id} service={service} goalId={selected.id}/>}
    <a className="ws-secondary" href="/app/growth/goals">Add or correct progress manually</a>
  </section>;
}

function DevScore(){
  return <div className="ws-growth-layout">
    <section className="ws-project-aside">
      <h2>Evidence first.</h2>
      <p className="ws-growth-unknown">A numeric DevScore is unavailable.</p>
      <p>There is no validated composite formula with reliable source freshness, coverage and weighting. We do not invent points, ranks, streaks or comparisons.</p>
      <a href="/app/growth/goals" className="ws-primary">Track goals without scoring</a>
    </section>
    <section className="ws-project-aside">
      <h2>What would a defensible score require?</h2>
      <ol className="ws-project-guide">
        <li><strong>Provenance</strong> Identify which facts come from an official source versus your own entries.</li>
        <li><strong>Fair coverage</strong> Avoid penalizing people who do not use a particular platform.</li>
        <li><strong>Explainability</strong> Publish versioned weights, limitations and fresh data boundaries before computation.</li>
      </ol>
      <p>None of these requirements is demonstrated for a live composite score. This screen remains private and unscored.</p>
    </section>
  </div>;
}

function GoalDetail({service,goal,onGoalUpdated}:{service:SupabasePrivateGoalsService;goal:PrivateGoal;onGoalUpdated:()=>void}){
  const [progress,setProgress]=useState<GoalProgress[]|null>(null);
  const [milestones,setMilestones]=useState<GoalMilestone[]|null>(null);
  const [error,setError]=useState('');
  const [status,setStatus]=useState('');
  const [value,setValue]=useState('');
  const [note,setNote]=useState('');
  const [name,setName]=useState('');
  const [due,setDue]=useState('');
  const [busy,setBusy]=useState(false);
  const [operation,setOperation]=useState(()=>crypto.randomUUID());
  const [milestoneOp,setMilestoneOp]=useState(()=>crypto.randomUUID());
  const [reload,setReload]=useState(0);
  const [editing,setEditing]=useState(false);
  const [editTitle,setEditTitle]=useState(goal.title);
  const [editDescription,setEditDescription]=useState(goal.description);
  const [editTarget,setEditTarget]=useState(goal.target_value===null?'':String(goal.target_value));
  const [editUnit,setEditUnit]=useState(goal.unit??'');
  const [editDue,setEditDue]=useState(goal.due_on??'');
  function beginEdit(){
    setEditTitle(goal.title);setEditDescription(goal.description);
    setEditTarget(goal.target_value===null?'':String(goal.target_value));
    setEditUnit(goal.unit??'');setEditDue(goal.due_on??'');setEditing(true);
  }
  async function saveGoal(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy||!editing||!editTitle.trim())return;
    setBusy(true);setError('');setStatus('');
    try{
      await service.updateGoal(goal.id,{title:editTitle.trim(),description:editDescription.trim(),
        target_value:editTarget.trim()?Number(editTarget):null,
        unit:editTarget.trim()?editUnit.trim()||null:null,due_on:editDue||null});
      setEditing(false);setStatus('Goal details updated privately.');onGoalUpdated();
    }catch(err){setError(presentError(err));}
    finally{setBusy(false);}
  }
  useEffect(()=>{
    let active=true;setProgress(null);setMilestones(null);setError('');
    void Promise.all([service.listProgress(goal.id),service.listMilestones(goal.id)]).then(([records,items])=>{
      if(active){setProgress(records);setMilestones(items);}
    }).catch(err=>{if(active)setError(presentError(err));});
    return ()=>{active=false;};
  },[service,goal.id,reload]);
  async function addProgress(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy||value.trim()==='')return;
    setBusy(true);setError('');setStatus('');
    try{
      await service.addProgress(goal.id,operation,Number(value),note);
      setOperation(crypto.randomUUID());setValue('');setNote('');
      setStatus('Manual progress saved privately.');setReload(r=>r+1);
    }catch(err){setError(presentError(err));}
    finally{setBusy(false);}
  }
  async function milestone(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy||!name.trim())return;
    setBusy(true);setError('');setStatus('');
    try{
      await service.addMilestone(goal.id,milestoneOp,name.trim(),due||null);
      setMilestoneOp(crypto.randomUUID());setName('');setDue('');
      setStatus('Milestone saved privately.');setReload(r=>r+1);
    }catch(err){setError(presentError(err));}
    finally{setBusy(false);}
  }
  async function toggle(item:GoalMilestone){
    if(busy)return;
    setBusy(true);setError('');setStatus('');
    try{
      await service.updateMilestone(item.id,{completed_at:item.completed_at?null:new Date().toISOString()});
      setStatus('Milestone state confirmed by the private server.');setReload(r=>r+1);
    }catch(err){setError(presentError(err));}
    finally{setBusy(false);}
  }
  const current=progress?.[0];
  return <div className="ws-growth-detail">
    <h3>{goal.title}</h3>
    <p>{goal.description||'No description provided.'}</p>
    <p>Manual target: {goal.target_value===null?'Not set':goal.target_value+' '+(goal.unit??'units')}.
      Latest recorded value: {progress===null?'Not yet confirmed':current ? current.value : 'Not recorded'}.</p>
    {error&&<p role="alert">{error}</p>}{status&&<p role="status">{status}</p>}
    {progress===null&&!error&&<p role="status">Loading this goal's history…</p>}
    {progress===null&&error&&<button type="button" className="ws-secondary" disabled={busy}
      onClick={()=>setReload(n=>n+1)}>Retry goal details</button>}
    {!editing&&<button type="button" className="ws-secondary" disabled={busy} onClick={beginEdit}>Edit selected goal</button>}
    {editing&&<form className="ws-growth-form" onSubmit={event=>void saveGoal(event)}>
      <label className="ws-growth-field">Edit goal title<input required maxLength={160} disabled={busy} value={editTitle} onChange={event=>setEditTitle(event.target.value)}/></label>
      <label className="ws-growth-field">Edit goal description<textarea rows={3} maxLength={2000} disabled={busy} value={editDescription} onChange={event=>setEditDescription(event.target.value)}/></label>
      <label className="ws-growth-field">Edit target value<input type="number" min="0.01" step="0.01" max="9999999999.99" disabled={busy} value={editTarget} onChange={event=>setEditTarget(event.target.value)}/></label>
      <label className="ws-growth-field">Edit target unit<input maxLength={32} disabled={busy||!editTarget.trim()} value={editUnit} onChange={event=>setEditUnit(event.target.value)}/></label>
      <label className="ws-growth-field">Edit due date<input type="date" disabled={busy} value={editDue} onChange={event=>setEditDue(event.target.value)}/></label>
      <div className="ws-actions"><button type="submit" className="ws-secondary" disabled={busy||!editTitle.trim()}>Save goal details</button>
        <button type="button" className="ws-secondary" disabled={busy} onClick={()=>setEditing(false)}>Cancel goal edit</button></div>
    </form>}
    <h4>Record or correct progress</h4>
    <p>Record a new absolute value to correct a mistake. Existing history is preserved; no external provider progress is assumed.</p>
    <form className="ws-growth-form" onSubmit={event=>void addProgress(event)}>
      <label className="ws-growth-field">New absolute progress value
        <input type="number" required min="0" max="9999999999.99" step="0.01" value={value} disabled={busy}
          onChange={event=>{setValue(event.target.value);setOperation(crypto.randomUUID());}}/></label>
      <label className="ws-growth-field">Manual progress note
        <input maxLength={500} value={note} disabled={busy} onChange={event=>{setNote(event.target.value);setOperation(crypto.randomUUID());}}/></label>
      <button type="submit" className="ws-secondary" disabled={busy||value.trim()===''}>Record manual progress</button>
    </form>
    <h4>Manual progress history</h4>
    <ProgressHistory key={goal.id+':'+reload} service={service} goalId={goal.id} busy={busy}
      onCorrection={item=>{if(busy)return;setValue(String(item.value));setNote('Correction using recorded value: '+item.value);setOperation(crypto.randomUUID());}}/>
    <h4>Milestones</h4>
    {milestones?.length===100&&<p>Showing up to 100 milestones; additional milestones may exist.</p>}
    {milestones?.length===0&&<p>No milestones yet.</p>}
    <ul className="ws-growth-milestones">{milestones?.map(item=><li key={item.id}>
      <span>{item.title}{item.due_on?' · Due '+item.due_on:''}</span>
      <button type="button" disabled={busy} className="ws-secondary" onClick={()=>void toggle(item)}>
        {item.completed_at?'Mark incomplete':'Mark complete'}</button>
    </li>)}</ul>
    <form className="ws-growth-form" onSubmit={event=>void milestone(event)}>
      <label className="ws-growth-field">New milestone
        <input required maxLength={160} value={name} disabled={busy} onChange={event=>{setName(event.target.value);setMilestoneOp(crypto.randomUUID());}}/></label>
      <label className="ws-growth-field">Milestone due date (optional)
        <input type="date" value={due} disabled={busy} onChange={event=>{setDue(event.target.value);setMilestoneOp(crypto.randomUUID());}}/></label>
      <button type="submit" className="ws-secondary" disabled={busy||!name.trim()}>Add milestone</button>
    </form>
  </div>;
}

function Goals({service}:{service:SupabasePrivateGoalsService}){
  const {goals,error,reload}=useGoals(service);
  const [title,setTitle]=useState('');
  const [description,setDescription]=useState('');
  const [target,setTarget]=useState('');
  const [unit,setUnit]=useState('');
  const [due,setDue]=useState('');
  const [operation,setOperation]=useState(()=>crypto.randomUUID());
  const [selected,setSelected]=useState('');
  const [busy,setBusy]=useState(false);
  const [note,setNote]=useState('');
  const [failure,setFailure]=useState('');
  async function create(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy||!title.trim())return;
    setBusy(true);setFailure('');setNote('');
    try{
      await service.createGoal(operation,title.trim(),description.trim(),
        target.trim()?Number(target):null,target.trim()?(unit.trim()||null):null,due||null);
      setOperation(crypto.randomUUID());setTitle('');setDescription('');setTarget('');setUnit('');setDue('');
      setNote('Owner-private goal saved.');reload();
    }catch(err){setFailure(presentError(err));}
    finally{setBusy(false);}
  }
  async function status(goal:PrivateGoal,next:GoalStatus){
    if(busy||next===goal.status)return;
    setBusy(true);setFailure('');setNote('');
    try{await service.updateGoal(goal.id,{status:next});setNote('Private goal status updated.');reload();}
    catch(err){setFailure(presentError(err));}
    finally{setBusy(false);}
  }
  const selectedGoal=goals?.find(goal=>goal.id===selected);
  return <div className="ws-growth-layout">
    <section className="ws-project-aside">
      <h2>Your private goals</h2>
      <p>Target values, history and milestone updates are self-reported. Goals are never made public here.</p>
      <LoadingOrError goals={goals} error={error} retry={reload}/>
      {failure&&<p role="alert">{failure}</p>}{note&&<p role="status">{note}</p>}
      {goals?.length===0&&<p>No private goals yet. Create one below.</p>}
      <ul className="ws-growth-records">{goals?.map(goal=><li key={goal.id}>
        <button type="button" aria-pressed={selected===goal.id} className="ws-growth-pick"
          onClick={()=>setSelected(goal.id)}>{goal.title}</button>
        <span>{goal.status} {goal.due_on?'· Due '+goal.due_on:''}</span>
        <label className="ws-growth-field">Change goal status<select value={goal.status} disabled={busy}
          onChange={event=>void status(goal,event.target.value as GoalStatus)}>
          {(['ACTIVE','PAUSED','COMPLETED','ARCHIVED'] as const).map(item=><option key={item}>{item}</option>)}
        </select></label>
      </li>)}</ul>
      {goals?.length===100&&<p>Displaying at most 100 recent goals, not a lifetime total.</p>}
      <h3>Create a goal</h3>
      <form className="ws-growth-form" onSubmit={event=>void create(event)}>
        <label className="ws-growth-field">Goal title
          <input value={title} required maxLength={160} disabled={busy} onChange={event=>{setTitle(event.target.value);setOperation(crypto.randomUUID());}}/></label>
        <label className="ws-growth-field">Description
          <textarea value={description} rows={3} maxLength={2000} disabled={busy} onChange={event=>{setDescription(event.target.value);setOperation(crypto.randomUUID());}}/></label>
        <div className="ws-growth-pair">
          <label className="ws-growth-field">Optional target value
            <input value={target} type="number" min="0.01" step="0.01" max="9999999999.99" disabled={busy}
              onChange={event=>{setTarget(event.target.value);setOperation(crypto.randomUUID());}}/></label>
          <label className="ws-growth-field">Target unit
            <input value={unit} maxLength={32} disabled={busy||!target.trim()}
              onChange={event=>{setUnit(event.target.value);setOperation(crypto.randomUUID());}}/></label>
        </div>
        <label className="ws-growth-field">Optional due date
          <input type="date" value={due} disabled={busy} onChange={event=>{setDue(event.target.value);setOperation(crypto.randomUUID());}}/></label>
        <button className="ws-primary" type="submit" disabled={busy||!title.trim()}>{busy?'Saving…':'Create private goal'}</button>
      </form>
    </section>
    <section className="ws-project-aside">
      <h2>Selected goal</h2>
      {selectedGoal?<GoalDetail key={selectedGoal.id} service={service} goal={selectedGoal} onGoalUpdated={reload}/>:
        <p>Select a private goal to review manually recorded progress and milestones.</p>}
      <a href="/app/growth/activity" className="ws-secondary">Open manual activity</a>
    </section>
  </div>;
}

function Analytics(){
  return <div className="ws-growth-layout">
    <section className="ws-project-aside">
      <h2>Tracking remains off.</h2>
      <p className="ws-growth-unknown">No verified visitor analytics are available.</p>
      <p>There is no independently authorized public delivery host with confirmed consent, aggregated counters, retention rules and no visitor fingerprinting. We cannot claim page views or referrals.</p>
      <button type="button" disabled className="ws-primary" aria-describedby="analytics-gate">Enable portfolio analytics</button>
      <p id="analytics-gate">Requires a separately proven and explicitly approved privacy-first publication integration.</p>
    </section>
    <section className="ws-project-aside">
      <h2>What an enabled dashboard would require</h2>
      <p>Owner opt-in per portfolio, consent-safe aggregation, a true time window, no unique visitor tracking and verified backend storage. No charts are shown until there is actual data.</p>
      <a className="ws-secondary" href="/app/portfolios">Manage private portfolios</a>
    </section>
  </div>;
}

function ProviderCard({service,provider,existing,onUpdate}:{
  service:SupabasePrivatePlatformLinksService;
  provider:{id:PlatformProvider;name:string;description:string};
  existing:PrivatePlatformLink|undefined;onUpdate:(record:PrivatePlatformLink|null)=>void;
}){
  const [handle,setHandle]=useState(existing?.handle??'');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [confirm,setConfirm]=useState(false);
  useEffect(()=>{setHandle(existing?.handle??'');setConfirm(false);},[existing?.id,existing?.handle]);
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy||!handle.trim())return;
    setBusy(true);setError('');setNotice('');
    try{
      const result=await service.save(provider.id,handle.trim(),existing);
      onUpdate(result);setNotice('Private link stored. No provider sync or ownership verification occurred.');
    }catch(err){setError(presentError(err));}
    finally{setBusy(false);}
  }
  async function remove(){
    if(!existing||busy||!confirm)return;
    setBusy(true);setError('');setNotice('');
    try{await service.remove(existing);onUpdate(null);setHandle('');setConfirm(false);setNotice('Private link disconnected.');}
    catch(err){setError(presentError(err));}
    finally{setBusy(false);}
  }
  return <article className="ws-project-aside ws-growth-provider" aria-label={provider.name}>
    <h2>{provider.name}</h2><p>{provider.description}</p>
    <p className="ws-growth-status">Private manual link · Never synced · Ownership not verified</p>
    {existing&&<p>Stored link: <a href={existing.profile_url} target="_blank" rel="noopener noreferrer">{existing.profile_url}</a></p>}
    <form className="ws-growth-form" onSubmit={event=>void save(event)}>
      <label className="ws-growth-field">Public handle
        <input maxLength={64} value={handle} required autoComplete="off"
          onChange={event=>{setHandle(event.target.value);setConfirm(false);}}/></label>
      <button type="submit" className="ws-secondary" disabled={busy||!handle.trim()||existing?.handle===handle.trim()}>
        {busy?'Saving…':existing?'Update private link':'Save private link'}</button>
    </form>
    {existing&&<div className="ws-growth-form">
      <label className="ws-growth-confirm"><input type="checkbox" checked={confirm} onChange={event=>setConfirm(event.target.checked)}/>
        Confirm disconnect of this stored link</label>
      <button type="button" className="ws-secondary" disabled={!confirm||busy} onClick={()=>void remove()}>Disconnect link</button>
    </div>}
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </article>;
}

function Connections({service}:{service:SupabasePrivatePlatformLinksService}){
  const [links,setLinks]=useState<PrivatePlatformLink[]|null>(null);
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let active=true;
    void service.list().then(items=>{if(active){setLinks(items);setError('');}})
      .catch(err=>{if(active){setLinks(null);setError(presentError(err));}});
    return ()=>{active=false;};
  },[service,attempt]);
  function updated(provider:PlatformProvider,record:PrivatePlatformLink|null){
    setLinks(current=>!current?current:
      [...current.filter(row=>row.provider!==provider),...(record?[record]:[])]);
  }
  return <section>
    <p>Optional public-handle links are stored privately. No OAuth, syncing, provider API, verification or public profile sharing is active.</p>
    {error&&<p role="alert">{error} <button className="ws-secondary" type="button" onClick={()=>setAttempt(n=>n+1)}>Retry links</button></p>}
    {!links&&!error&&<p role="status">Loading your private platform links…</p>}
    {links&&<div className="ws-growth-provider-grid">{providers.map(provider=>
      <ProviderCard key={provider.id} provider={provider} service={service}
        existing={links.find(item=>item.provider===provider.id)}
        onUpdate={record=>updated(provider.id,record)}/>)}</div>}
  </section>;
}

type GrowthRequestScope = {port:SupabaseBrowserAuthPort;path:string;attempt:number};
type GrowthLoad = {scope:GrowthRequestScope;data:GrowthServices|null;error:string;viewKey:string};

export function GrowthApp({port,path}:{port:SupabaseBrowserAuthPort;path:string}){
  const [attempt,setAttempt]=useState(0);
  // Keep returned private data tied to the exact requesting adapter and route.
  // A late response, account adapter change or retry must not briefly render
  // a previous request's records while the next request is pending.
  const scope=useMemo<GrowthRequestScope>(()=>({port,path,attempt}),[port,path,attempt]);
  const [loaded,setLoaded]=useState<GrowthLoad|null>(null);
  const current=loaded?.scope===scope?loaded:null;
  const services=current?.data??null;
  const error=current?.error??'';
  const view=path as GrowthRoute;
  useEffect(()=>{
    if(path==='/app/analytics'||path==='/app/growth/devscore')return;
    let active=true;
    void port.ownerGrowth().then(result=>{
      if(!active)return;
      setLoaded({
        scope,
        data:result.data??null,
        error:result.data?'':result.error?.message??'Private growth service unavailable.',
        viewKey:crypto.randomUUID()
      });
    }).catch(err=>{
      if(active)setLoaded({scope,data:null,error:presentError(err),viewKey:crypto.randomUUID()});
    });
    return ()=>{active=false;};
  },[scope,port,path]);
  return <section className="ws-growth" aria-labelledby="growth-title">
    <div className="ws-heading">
      <p className="ws-kicker">BUILD · SHOWCASE · EVOLVE</p>
      <h1 id="growth-title">{routes[view]}</h1>
      <p>Private by default. Data provenance and real acknowledgments take priority over dashboards.</p>
    </div>
    <nav className="ws-growth-nav" aria-label="Growth sections">
      {(Object.entries(routes) as [GrowthRoute,string][]).map(([href,title])=>
        <a key={href} href={href} aria-current={href===path?'page':undefined}>{title}</a>)}
    </nav>
    {path==='/app/analytics'?<Analytics/>:
      path==='/app/growth/devscore'?<DevScore/>:
      error?<div className="ws-project-aside"><p role="alert">{error}</p>
        <button type="button" className="ws-secondary" onClick={()=>setAttempt(n=>n+1)}>Retry private Growth</button></div>:
      !services?<p role="status">Checking your owner-private growth records…</p>:
      path==='/app/growth'?<GrowthHome key={current!.viewKey} service={services.goals}/>:
      path==='/app/growth/activity'?<Activity key={current!.viewKey} service={services.goals}/>:
      path==='/app/growth/goals'?<Goals key={current!.viewKey} service={services.goals}/>:
      <Connections key={current!.viewKey} service={services.links}/>}
  </section>;
}
