import {useEffect, useMemo, useRef, useState} from 'react';
import type {FormEvent} from 'react';
import type {SupabaseBrowserAuthPort} from '../../auth-web/src/supabase-auth-port.ts';
import type {
  SupabasePrivateGoalsService, PrivateGoal, GoalProgress, GoalMilestone, GoalStatus,
  GoalProgressChronologicalPage
} from '../../../packages/contracts/src/private-goals-service.ts';
import {PrivateGoalsError} from '../../../packages/contracts/src/private-goals-service.ts';
import type {
  SupabasePrivatePlatformLinksService, PrivatePlatformLink, PlatformProvider
} from '../../../packages/contracts/src/private-platform-links-service.ts';
import {PrivatePlatformLinkError} from '../../../packages/contracts/src/private-platform-links-service.ts';

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
function goalNeedsReconciliation(err:unknown):boolean{
  return !(err instanceof PrivateGoalsError) ||
    (err.code==='CONFLICT'||err.code==='INVALID_ACK'||err.code==='PROVIDER_UNAVAILABLE');
}
export function mergeVerifiedGoalRows<T extends {id:string}>(previous:readonly T[], incoming:readonly T[]):T[]{
  const rows=new Map(previous.map(row=>[row.id,row]));
  for(const row of incoming)rows.set(row.id,row);
  return [...rows.values()];
}

function useGoals(service:SupabasePrivateGoalsService){
  type Page=Awaited<ReturnType<SupabasePrivateGoalsService['listGoalsPage']>>;
  const [goals,setGoals]=useState<PrivateGoal[]|null>(null);
  const [scan,setScan]=useState<Page|null>(null);
  const [canBrowse,setCanBrowse]=useState(false);
  const [error,setError]=useState('');
  const [scanError,setScanError]=useState(false);
  const [revision,setRevision]=useState(0);
  const [loading,setLoading]=useState(true);
  const [loadingMore,setLoadingMore]=useState(false);
  const listGeneration=useRef(0),listPending=useRef(false),scanPending=useRef(false),alive=useRef(false);
  const initial=useRef<{service:SupabasePrivateGoalsService;revision:number;promise:Promise<PrivateGoal[]>}|null>(null);
  function reload(){
    listGeneration.current++;listPending.current=true;scanPending.current=false;
    setLoading(true);setLoadingMore(false);setCanBrowse(false);setScan(null);setScanError(false);setError('');
    setRevision(value=>value+1);
  }
  useEffect(()=>{
    let active=true;alive.current=true;
    const generation=++listGeneration.current;
    listPending.current=true;setLoading(true);
    if(initial.current?.service!==service||initial.current.revision!==revision)
      initial.current={service,revision,promise:Promise.resolve().then(()=>service.listGoals())};
    void initial.current.promise.then(items=>{
      if(active&&generation===listGeneration.current){setGoals(items);setCanBrowse(items.length===100);setError('');}
    }).catch(err=>{
      if(active&&generation===listGeneration.current){
        setError(presentError(err));setCanBrowse(false);
        // Retain same-scope records during transient failure only.
        if(!(err instanceof PrivateGoalsError)||
          (err.code!=='PROVIDER_UNAVAILABLE'&&err.code!=='RATE_LIMITED'))setGoals(null);
      }
    }).finally(()=>{
      if(active&&generation===listGeneration.current){listPending.current=false;setLoading(false);}
    });
    return ()=>{active=false;alive.current=false;};
  },[service,revision]);
  const partial=canBrowse&&(scan===null||scan.nextCursor!==null);
  async function more(){
    if(!goals||!partial||listPending.current||scanPending.current)return;
    const generation=listGeneration.current,cursor=scan?.nextCursor??null;
    scanPending.current=true;setLoadingMore(true);setError('');setScanError(false);
    try{
      const next=await service.listGoalsPage(100,cursor);
      if(!alive.current||generation!==listGeneration.current)return;
      // The first keyset page can overlap the recent 100. Such overlap is
      // expected; duplicate/nonadvancing keyset pages themselves are not.
      const items=appendEvidenceItems(scan?.items??[],next.items,cursor??'',next.nextCursor);
      setScan({...next,items});
      setGoals(current=>current?mergeVerifiedGoalRows(current,next.items):null);
    }catch(err){
      if(alive.current&&generation===listGeneration.current){
        const transient=err instanceof PrivateGoalsError&&(err.code==='PROVIDER_UNAVAILABLE'||err.code==='RATE_LIMITED');
        if(!transient){setGoals(null);setScan(null);setCanBrowse(false);}
        setScanError(transient);setError(presentError(err));
      }
    }finally{
      if(generation===listGeneration.current){scanPending.current=false;if(alive.current)setLoadingMore(false);}
    }
  }
  function fencePendingScan(){
    if(scanPending.current){listGeneration.current++;scanPending.current=false;setLoadingMore(false);}
  }
  function acceptGoal(row:PrivateGoal,created=false){
    fencePendingScan();
    if(listPending.current||!goals)reload();
    setGoals(current=>current&&(created||current.some(goal=>goal.id===row.id))?
      mergeVerifiedGoalRows(current,[row]):current);
  }
  function forgetGoal(id:string){
    fencePendingScan();
    if(listPending.current)reload();
    setGoals(current=>current?.filter(goal=>goal.id!==id)??null);
  }
  return {goals,error,reload,retry:()=>{if(scanError)void more();else reload();},acceptGoal,forgetGoal,
    partial,scanned:scan?.items.length??0,loading,loadingMore,more};
}
function GoalListPaging({goals,partial,scanned,loading,loadingMore,more,busy=false,error=false}:{
  goals:PrivateGoal[]|null;partial:boolean;scanned:number;loading:boolean;loadingMore:boolean;more:()=>Promise<void>;busy?:boolean;error?:boolean
}){
  if(!goals)return null;
  return <><p>{goals.length} loaded private goals. {loading?
    'Refreshing the recent list; these are previously confirmed records.':
    error?'The current read is incomplete; retry before assuming coverage.':
    partial?'The recent list may omit records. Browse the owner-private keyset pages to find additional goals.':
    'End of this read; not a lifetime total.'}{scanned>0&&' '+scanned+' keyset records scanned (including overlaps).'}</p>
    {partial&&!error&&<button type="button" className="ws-secondary" disabled={busy||loading||loadingMore}
      onClick={()=>void more()}>{loadingMore?'Loading more private goals…':'Load more private goals'}</button>}</>;
}

function LoadingOrError({goals,error,retry}:{goals:PrivateGoal[]|null;error:string;retry:()=>void}){
  if(error)return <div role="alert" className="ws-inline-alert">{error}{goals&&' Previously confirmed records may be stale.'}
    <button type="button" className="ws-secondary" onClick={retry}>Retry private records</button></div>;
  if(goals===null)return <EvidencePending label="Loading owner-private goal records…"/>;
  return null;
}

function GrowthHome({service}: {service:SupabasePrivateGoalsService}){
  const {goals,error,retry,partial,scanned,loading,loadingMore,more}=useGoals(service);
  const active=goals?.filter(item=>item.status==='ACTIVE').length ?? 0;
  const completed=goals?.filter(item=>item.status==='COMPLETED').length ?? 0;
  return <div className="ws-growth-layout">
    <section className="ws-project-aside">
      <h2>Private progress, not a leaderboard.</h2>
      <p>Track personal development using your own goals. Nothing here is published to your profile or verified by outside providers.</p>
      <LoadingOrError goals={goals} error={error} retry={retry}/>
      {goals!==null && <div className="ws-growth-facts" role="group" aria-label="Loaded private goals">
        <div><strong>{active}</strong><span>Active goals in loaded records</span></div>
        <div><strong>{completed}</strong><span>Completed goals in loaded records</span></div>
      </div>}
      <GoalListPaging goals={goals} partial={partial} scanned={scanned} loading={loading} loadingMore={loadingMore} more={more} error={!!error}/>
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

export function appendEvidenceItems<T extends {id:string}>(previous:readonly T[],next:readonly T[],cursor:string,nextCursor:string|null):T[]{
  const seen=new Set(previous.map(item=>item.id));
  if(nextCursor!==null&&(next.length===0||nextCursor===cursor))throw new Error('Invalid evidence page');
  for(const item of next){if(seen.has(item.id))throw new Error('Invalid evidence page');seen.add(item.id);}
  return [...previous,...next];
}

function EvidencePending({label}:{label:string}){
  return <><p role="status">{label}</p><div className="glyph-skeleton" aria-hidden="true">
    <span className="glyph-skeleton-line is-medium"/>
    <span className="glyph-skeleton-line"/>
    <span className="glyph-skeleton-line is-short"/>
  </div></>;
}

/** Retain the service's raw microsecond cursor and append in its verified
 * newest-first PostgreSQL timestamp/UUID order. */
function ProgressHistory({service,goalId,onCorrection,busy=false}:{
  service:SupabasePrivateGoalsService;goalId:string;onCorrection?:(item:GoalProgress)=>void;busy?:boolean
}){
  const [page,setPage]=useState<GoalProgressChronologicalPage|null>(null);
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  const [loadingMore,setLoadingMore]=useState(false);
  const alive=useRef(false);
  const inFlight=useRef(false);
  // StrictMode replays mount effects. Share the initial request for the exact
  // service/goal/attempt, including its rejection, instead of silently
  // replacing a failed first read with an unrequested second read.
  const initial=useRef<{service:SupabasePrivateGoalsService;goalId:string;attempt:number;promise:ReturnType<SupabasePrivateGoalsService['listProgressChronologicalPage']>}|null>(null);
  useEffect(()=>{
    let active=true;alive.current=true;setPage(null);setError('');
    if(initial.current?.service!==service||initial.current.goalId!==goalId||initial.current.attempt!==attempt)
      initial.current={service,goalId,attempt,promise:Promise.resolve().then(()=>service.listProgressChronologicalPage(goalId,50))};
    void initial.current.promise.then(result=>{if(active)setPage(result);})
      .catch(err=>{if(active)setError(presentError(err));});
    return()=>{active=false;alive.current=false;};
  },[service,goalId,attempt]);
  async function more(){
    if(!page?.nextCursor||inFlight.current||busy)return;
    const cursor=page.nextCursor;
    const request=initial.current;
    inFlight.current=true;setLoadingMore(true);setError('');
    try{
      const next=await service.listProgressChronologicalPage(goalId,50,cursor);
      if(!alive.current||initial.current!==request)return;
      const items=appendEvidenceItems(page.items,next.items,cursor.id,next.nextCursor?.id??null);
      setPage(previous=>{
        if(!previous||previous.nextCursor!==cursor)return previous;
        return {...next,items};
      });
    }catch(err){if(alive.current&&initial.current===request){
      const transient=err instanceof PrivateGoalsError&&(err.code==='PROVIDER_UNAVAILABLE'||err.code==='RATE_LIMITED');
      if(!transient)setPage(null);
      setError(presentError(err)+(transient?' Previously confirmed entries may be stale.':' No records have been assumed.'));
    }}
    finally{
      if(initial.current===request){inFlight.current=false;if(alive.current)setLoadingMore(false);}
    }
  }
  const events=page?.items;
  return <section aria-label="Private manual progress history">
    {error&&<div><p role="alert">{error}</p>
      <button type="button" className="ws-secondary" disabled={busy||loadingMore}
        onClick={()=>page?void more():setAttempt(n=>n+1)}>Retry activity history</button>
    </div>}
    {!page&&!error&&<EvidencePending label="Loading manual progress history…"/>}
    {page?.items.length===0&&<p>No manual progress has been recorded for this goal.</p>}
    {!!events?.length&&<><p>{events.length} loaded self-reported entries. {page?.nextCursor?'More older entries exist; newest confirmed records are shown first.':'All pages reached for this read; refresh to check for changes.'}</p>
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
  const {goals,error,retry,partial,scanned,loading,loadingMore,more}=useGoals(service);
  const [id,setId]=useState('');
  const selected=goals?.find(goal=>goal.id===id);
  return <section className="ws-project-aside">
    <h2>Manual activity history</h2>
    <p>Entries are self-recorded absolute values, not GitHub commits, coding-platform statistics or verified daily streaks.</p>
    <LoadingOrError goals={goals} error={error} retry={retry}/>
    {goals&&<label className="ws-growth-field">Activity goal<select aria-label="Activity goal" value={selected?.id??''}
      onChange={event=>setId(event.target.value)}>
      <option value="">Choose a goal to inspect</option>
      {goals.map(goal=><option key={goal.id} value={goal.id}>{goal.title}</option>)}
    </select></label>}
    <GoalListPaging goals={goals} partial={partial} scanned={scanned} loading={loading} loadingMore={loadingMore} more={more} error={!!error}/>
    {selected&&<ProgressHistory key={selected.id} service={service} goalId={selected.id}/>}
    <a className="ws-secondary" href="/app/growth/goals">Add or correct progress manually</a>
  </section>;
}

/** Read-only, self-reported context. Goal templates are not persisted as an
 * authoritative category, so do not classify arbitrary titles or notes. */
function GoalEvidence({service,goal}:{service:SupabasePrivateGoalsService;goal:PrivateGoal}){
  const [attempt,setAttempt]=useState(0);
  type Page=Awaited<ReturnType<SupabasePrivateGoalsService['listMilestonesPage']>>;
  type Read={service:SupabasePrivateGoalsService;goalId:string;attempt:number;promise:Promise<Page>};
  const initial=useRef<Read|null>(null);
  const [loaded,setLoaded]=useState<{read:Read;page:Page|null;error:boolean}|null>(null);
  const [pending,setPending]=useState(false);
  const active=useRef(false);
  const flight=useRef<Read|null>(null);
  const current=loaded?.read.service===service&&loaded.read.goalId===goal.id&&loaded.read.attempt===attempt?loaded:null;
  const milestones=current?.page;
  useEffect(()=>{
    let subscribed=true;active.current=true;setPending(false);
    if(initial.current?.service!==service||initial.current.goalId!==goal.id||initial.current.attempt!==attempt)
      initial.current={service,goalId:goal.id,attempt,promise:Promise.resolve().then(()=>service.listMilestonesPage(goal.id,50))};
    const read=initial.current;
    void read.promise.then(page=>{
      if(subscribed)setLoaded({read,page,error:false});
    }).catch(()=>{if(subscribed)setLoaded({read,page:null,error:true});});
    return()=>{subscribed=false;active.current=false;};
  },[service,goal.id,attempt]);
  async function more(){
    const read=current?.read,cursor=milestones?.nextCursor;
    if(!read||!milestones||!cursor||flight.current===read)return;
    flight.current=read;setPending(true);
    setLoaded(previous=>previous?.read===read?{...previous,error:false}:previous);
    try{
      const page=await service.listMilestonesPage(goal.id,50,cursor);
      if(!active.current||initial.current!==read)return;
      const items=appendEvidenceItems(milestones.items,page.items,cursor,page.nextCursor);
      setLoaded(previous=>previous?.read===read&&previous.page?.nextCursor===cursor?
        {read,page:{...page,items},error:false}:previous);
    }catch(err){
      if(active.current&&initial.current===read){
        const transient=err instanceof PrivateGoalsError&&(err.code==='PROVIDER_UNAVAILABLE'||err.code==='RATE_LIMITED');
        setLoaded(previous=>previous?.read===read?{read,page:transient?previous.page:null,error:true}:previous);
      }
    }finally{
      if(flight.current===read)flight.current=null;
      if(active.current&&initial.current===read)setPending(false);
    }
  }
  return <section aria-label="Selected goal evidence">
    <h3>{goal.title}</h3>
    <dl>
      <dt>Source</dt><dd>Owner-entered private goal · self-reported</dd>
      <dt>Saved status</dt><dd>{goal.status}</dd>
      <dt>Personal target</dt><dd>{goal.target_value===null?'Not set':String(goal.target_value)+' '+(goal.unit??'units')}</dd>
      <dt>Last saved goal update</dt><dd><time dateTime={goal.updated_at}>{goal.updated_at}</time></dd>
    </dl>
    <p>Targets are personal intentions, not standardized benchmarks. The history below contains absolute values, including corrections; summing the entries would not measure achievement.</p>
    <ProgressHistory key={goal.id} service={service} goalId={goal.id}/>
    <h4>Milestone evidence</h4>
    <p>Source: owner-entered milestone records, not independent proof of project delivery.</p>
    {!current&&<EvidencePending label="Loading private milestone evidence…"/>}
    {current?.error&&<p role="alert">{milestones?'Could not load more milestones. Previously confirmed records may be stale.':'Milestone evidence is unavailable. No count has been assumed.'}</p>}
    {milestones&&<><p>{milestones.items.filter(item=>item.completed_at!==null).length} marked complete among {milestones.items.length} loaded milestones. {milestones.nextCursor?'Additional records may exist; this is a partial view.':'End of this read; records may change.'}</p>
      {milestones.items.length===0?<p>No milestones recorded for this goal.</p>:
        <ul className="ws-growth-milestones">{milestones.items.map(item=><li key={item.id}>
          <span>{item.title} · {item.completed_at?'Completed (manual)':'Open'}{item.completed_at&&<> · <time dateTime={item.completed_at}>{item.completed_at}</time></>}</span>
        </li>)}</ul>}</>}
    {milestones?.nextCursor&&<button type="button" className="ws-secondary" disabled={pending}
      onClick={()=>void more()}>{pending?'Loading more milestones…':current?.error?'Retry more milestones':'Load more milestones'}</button>}
    {current&&<button type="button" className="ws-secondary" disabled={pending} onClick={()=>setAttempt(n=>n+1)}>{current.error&&!milestones?'Retry milestone evidence':'Refresh milestone evidence'}</button>}
  </section>;
}

function DevScore({services}:{services:GrowthServices}){
  const service=services.goals;
  const [attempt,setAttempt]=useState(0);
  const [selectedId,setSelectedId]=useState('');
  type Page=Awaited<ReturnType<SupabasePrivateGoalsService['listGoalsPage']>>;
  type Read={service:SupabasePrivateGoalsService;attempt:number;promise:Promise<Page>};
  const initial=useRef<Read|null>(null);
  const active=useRef(false);
  const flight=useRef<Read|null>(null);
  const [loaded,setLoaded]=useState<{read:Read;page:Page|null;error:boolean}|null>(null);
  const [pending,setPending]=useState(false);
  const current=loaded?.read.attempt===attempt&&loaded.read.service===service?loaded:null;
  const goals=current?.page?.items;
  useEffect(()=>{
    let subscribed=true;active.current=true;setPending(false);
    if(initial.current?.service!==service||initial.current.attempt!==attempt)
      initial.current={service,attempt,promise:Promise.resolve().then(()=>service.listGoalsPage(50))};
    const read=initial.current;
    void read.promise.then(page=>{
      if(subscribed)setLoaded({read,page,error:false});
    }).catch(()=>{if(subscribed)setLoaded({read,page:null,error:true});});
    return()=>{subscribed=false;active.current=false;};
  },[service,attempt]);
  async function more(){
    const read=current?.read,page=current?.page,cursor=page?.nextCursor;
    if(!read||!page||!cursor||flight.current===read)return;
    flight.current=read;setPending(true);
    setLoaded(previous=>previous?.read===read?{...previous,error:false}:previous);
    try{
      const next=await service.listGoalsPage(50,cursor);
      if(!active.current||initial.current!==read)return;
      const items=appendEvidenceItems(page.items,next.items,cursor,next.nextCursor);
      setLoaded(previous=>previous?.read===read&&previous.page?.nextCursor===cursor?
        {read,page:{...next,items},error:false}:previous);
    }catch(err){
      if(active.current&&initial.current===read){
        const transient=err instanceof PrivateGoalsError&&(err.code==='PROVIDER_UNAVAILABLE'||err.code==='RATE_LIMITED');
        setLoaded(previous=>previous?.read===read?{read,page:transient?previous.page:null,error:true}:previous);
      }
    }finally{
      if(flight.current===read)flight.current=null;
      if(active.current&&initial.current===read)setPending(false);
    }
  }
  const selected=goals?.find(goal=>goal.id===selectedId);
  const ordered=goals?[...goals].sort((a,b)=>a.title.localeCompare(b.title)||a.id.localeCompare(b.id)):[];
  return <div className="ws-growth-layout">
    <section className="ws-project-aside">
      <h2>Evidence first.</h2>
      <p className="ws-growth-unknown">A numeric DevScore is unavailable.</p>
      <p>Evidence view: DevScore-evidence-v0. No composite, weights, ranks, streaks, or comparisons are calculated.</p>
      <h3>Practice, learning and project context</h3>
      <p>Choose a real private goal to inspect its recorded evidence. Goal titles and units are self-reported; they are not automatically classified or treated as validated competencies.</p>
      {!current&&<EvidencePending label="Loading private goal evidence…"/>}
      {current?.error&&<p role="alert">{goals?'Could not load more goals. Previously confirmed records may be stale.':'Goal evidence is unavailable. No saved value or coverage has been assumed.'}</p>}
      {goals&&<>
        {goals.length===0?<p>No private goals recorded yet. Missing evidence is not zero performance.</p>:
          <label className="ws-growth-field">Evidence goal<select value={selected?.id??''} onChange={event=>setSelectedId(event.target.value)}>
            <option value="">Choose a goal to inspect</option>
            {ordered.map(goal=><option key={goal.id} value={goal.id}>{goal.title}</option>)}
          </select></label>}
        <p>{goals.length} loaded private goals. {current?.page?.nextCursor?'More goals may exist; load additional records to inspect them.':'End of this read; new goals may be added later.'}</p>
        {current?.page?.nextCursor&&<button type="button" className="ws-secondary" disabled={pending}
          onClick={()=>void more()}>{pending?'Loading more goals…':current.error?'Retry more goals':'Load more evidence goals'}</button>}
        {selected&&<GoalEvidence key={selected.id+':'+attempt} service={service} goal={selected}/>}
      </>}
      {current&&<button type="button" className="ws-secondary" disabled={pending} onClick={()=>setAttempt(n=>n+1)}>{current.error&&!goals?'Retry goal evidence':'Refresh goal evidence'}</button>}
      <a href="/app/growth/goals" className="ws-primary">Track goals without scoring</a>
    </section>
    <section className="ws-project-aside">
      <h2>Evidence boundaries</h2>
      <dl>
        <dt>External coding and public artifact facts</dt><dd>Unavailable: platform links do not establish imported facts or account ownership.</dd>
        <dt>Competitive practice</dt><dd>Unavailable: no verified provider retrieval is active.</dd>
        <dt>Comparability and coverage</dt><dd>Unvalidated: personal units, time windows and correction histories differ.</dd>
      </dl>
      <p>Unavailable evidence is not treated as zero. No provider request is made from this view, and no analytics or popularity metric affects it.</p>
      <a className="ws-secondary" href="/app/integrations">Manage private platform links</a>
      <h3>What would a defensible score require?</h3>
      <ol className="ws-project-guide">
        <li><strong>Provenance</strong> Identify which facts come from an official source versus your own entries.</li>
        <li><strong>Fair coverage</strong> Avoid penalizing people who do not use a particular platform.</li>
        <li><strong>Explainability</strong> Validate comparable inputs and versioned methods before computation.</li>
      </ol>
    </section>
  </div>;
}

const goalTemplates=[
  {id:'free',label:'Free-form goal',title:'',description:'',target:'',unit:'',milestones:[]},
  {id:'practice',label:'Coding practice',title:'Build a consistent coding practice',description:'Record completed practice sessions manually.',target:'10',unit:'sessions',milestones:['Choose topics to practise','Finish the first practice session','Review difficult exercises']},
  {id:'project',label:'Project learning',title:'Complete a learning project',description:'Track personally completed project milestones.',target:'3',unit:'milestones',milestones:['Define the project scope','Build a working prototype','Review and document the result']},
  {id:'study',label:'Study a topic',title:'Study a new topic',description:'Record completed study sessions and review notes.',target:'5',unit:'sessions',milestones:['Choose learning resources','Complete the first study session','Summarise what I learned']}
] as const;

function GoalDetail({service,goal,onGoalUpdated,onGoalRecord,onGoalDeleted,templateId}:{service:SupabasePrivateGoalsService;goal:PrivateGoal;onGoalUpdated:()=>void;onGoalRecord:(row:PrivateGoal)=>void;onGoalDeleted:()=>void;templateId:string}){
  const [progress,setProgress]=useState<GoalProgress[]|null>(null);
  const [milestonePage,setMilestonePage]=useState<{items:GoalMilestone[];nextCursor:string|null}|null>(null);
  const milestones=milestonePage?.items;
  const [milestoneError,setMilestoneError]=useState('');
  const [milestoneLoading,setMilestoneLoading]=useState(false);
  const milestoneRead=useRef(false);
  type MilestoneRead={service:SupabasePrivateGoalsService;goalId:string;reload:number;attempt:number;promise:ReturnType<SupabasePrivateGoalsService['listMilestonesPage']>};
  const milestoneInitial=useRef<MilestoneRead|null>(null);
  const [milestoneAttempt,setMilestoneAttempt]=useState(0);
  const [milestoneEdit,setMilestoneEdit]=useState<{base:GoalMilestone;title:string;due:string;needsReview:boolean;reviewed:GoalMilestone|null}|null>(null);
  const [deleting,setDeleting]=useState<
    {kind:'goal';id:string;title:string;expectedUpdatedAt:string}|
    {kind:'milestone';id:string;title:string;base:GoalMilestone}|null>(null);
  const [confirmation,setConfirmation]=useState('');
  const [suggestion,setSuggestion]=useState('');
  const mutation=useRef(false);
  const mounted=useRef(false);
  const archived=goal.status==='ARCHIVED';
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
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
  const [editBase,setEditBase]=useState(goal.updated_at);
  const [reconcileRequired,setReconcileRequired]=useState(false);
  const [conflictGoal,setConflictGoal]=useState<PrivateGoal|null>(null);
  const [editTitle,setEditTitle]=useState(goal.title);
  const [editDescription,setEditDescription]=useState(goal.description);
  const [editTarget,setEditTarget]=useState(goal.target_value===null?'':String(goal.target_value));
  const [editUnit,setEditUnit]=useState(goal.unit??'');
  const [editDue,setEditDue]=useState(goal.due_on??'');
  function beginEdit(){
    setEditBase(goal.updated_at);setReconcileRequired(false);setConflictGoal(null);
    setEditTitle(goal.title);setEditDescription(goal.description);
    setEditTarget(goal.target_value===null?'':String(goal.target_value));
    setEditUnit(goal.unit??'');setEditDue(goal.due_on??'');setEditing(true);
  }
  async function readConflictVersion(){
    setConflictGoal(null);
    try{
      const latest=await service.readGoal(goal.id);
      if(!mounted.current)return;
      if(latest){setConflictGoal(latest);onGoalRecord(latest);}
      else setError('This goal is no longer available. The unsaved draft has been kept; no change was confirmed.');
    }catch(err){
      if(mounted.current)setError('Could not refresh the saved version. Your draft is still here. '+presentError(err));
    }
  }
  async function retryConflictRead(){
    if(busy||mutation.current||!reconcileRequired)return;
    mutation.current=true;setBusy(true);setError('');
    try{await readConflictVersion();}
    finally{mutation.current=false;if(mounted.current)setBusy(false);}
  }
  async function saveGoal(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy||mutation.current||milestoneRead.current||!editing||reconcileRequired||!editTitle.trim())return;
    mutation.current=true;setBusy(true);setError('');setStatus('');
    try{
      const saved=await service.updateGoalIfUnchanged(goal.id,editBase,{title:editTitle.trim(),description:editDescription.trim(),
        target_value:editTarget.trim()?Number(editTarget):null,
        unit:editTarget.trim()?editUnit.trim()||null:null,due_on:editDue||null});
      if(!mounted.current)return;
      setEditBase(saved.updated_at);setEditing(false);setConflictGoal(null);
      setStatus('Goal details updated privately.');onGoalRecord(saved);
    }catch(err){
      if(mounted.current){
        if(goalNeedsReconciliation(err)){
          setReconcileRequired(true);
          setError('Goal details were not confirmed. Compare the latest saved version with your draft before saving again.');
          await readConflictVersion();
        }else setError(presentError(err));
      }
    }
    finally{mutation.current=false;if(mounted.current)setBusy(false);}
  }
  useEffect(()=>{
    let active=true;setProgress(null);
    void service.listProgressChronologicalPage(goal.id,1).then(page=>{
      if(active)setProgress(page.items);
    }).catch(err=>{if(active)setError(presentError(err));});
    return ()=>{active=false;};
  },[service,goal.id,reload]);
  useEffect(()=>{
    let active=true;setMilestonePage(null);setMilestoneError('');
    milestoneRead.current=true;setMilestoneLoading(true);
    if(milestoneInitial.current?.service!==service||milestoneInitial.current.goalId!==goal.id||
      milestoneInitial.current.reload!==reload||milestoneInitial.current.attempt!==milestoneAttempt)
      milestoneInitial.current={service,goalId:goal.id,reload,attempt:milestoneAttempt,
        promise:Promise.resolve().then(()=>service.listMilestonesPage(goal.id,50))};
    const read=milestoneInitial.current;
    void read.promise.then(page=>{
      if(active&&milestoneInitial.current===read)setMilestonePage(page);
    }).catch(err=>{if(active&&milestoneInitial.current===read)setMilestoneError(presentError(err));})
      .finally(()=>{if(active&&milestoneInitial.current===read){milestoneRead.current=false;setMilestoneLoading(false);}});
    return()=>{active=false;};
  },[service,goal.id,reload,milestoneAttempt]);
  async function moreMilestones(){
    if(!milestonePage?.nextCursor||milestoneRead.current||busy||mutation.current)return;
    const cursor=milestonePage.nextCursor,read=milestoneInitial.current;
    if(!read)return;
    milestoneRead.current=true;setMilestoneLoading(true);setMilestoneError('');
    try{
      const next=await service.listMilestonesPage(goal.id,50,cursor);
      if(!mounted.current||milestoneInitial.current!==read)return;
      const items=appendEvidenceItems(milestonePage.items,next.items,cursor,next.nextCursor);
      setMilestonePage(previous=>previous?.nextCursor===cursor?{...next,items}:previous);
    }catch(err){
      if(mounted.current&&milestoneInitial.current===read){
        const transient=err instanceof PrivateGoalsError&&(err.code==='PROVIDER_UNAVAILABLE'||err.code==='RATE_LIMITED');
        if(!transient){setMilestonePage(null);setMilestoneEdit(current=>current?{...current,needsReview:true,reviewed:null}:null);setDeleting(current=>current?.kind==='milestone'?null:current);setConfirmation('');}
        setMilestoneError(presentError(err)+(transient?' Previously confirmed milestones may be stale.':' No milestones have been assumed.'));
      }
    }finally{
      if(milestoneInitial.current===read){milestoneRead.current=false;if(mounted.current)setMilestoneLoading(false);}
    }
  }
  function refreshMilestoneList(){
    milestoneRead.current=true;setMilestoneLoading(true);setMilestonePage(null);setMilestoneError('');
    setMilestoneAttempt(n=>n+1);
  }
  async function reviewMilestone(){
    if(!milestoneEdit?.needsReview||busy||mutation.current||milestoneRead.current)return;
    const base=milestoneEdit.base;mutation.current=true;setBusy(true);setError('');setStatus('');
    try{
      const latest=await service.readMilestone(base.id);
      if(!mounted.current)return;
      if(!latest||latest.goal_id!==base.goal_id||latest.owner_user_id!==base.owner_user_id||latest.operation_id!==base.operation_id){
        setMilestoneEdit(current=>current?{...current,reviewed:null}:null);
        setError('The saved milestone is unavailable. Your unsaved title and date remain here.');return;
      }
      setMilestoneEdit(current=>current?{...current,reviewed:latest}:null);
    }catch(err){
      if(mounted.current){setMilestoneEdit(current=>current?{...current,reviewed:null}:null);setError('Could not review the saved milestone. '+presentError(err));}
    }finally{mutation.current=false;if(mounted.current)setBusy(false);}
  }
  async function saveMilestone(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(busy||archived||mutation.current||milestoneRead.current||!milestoneEdit?.title.trim()||milestoneEdit.needsReview)return;
    const edit=milestoneEdit;mutation.current=true;setBusy(true);setError('');setStatus('');
    try{
      await service.updateMilestoneIfUnchanged(edit.base,{title:edit.title.trim(),due_on:edit.due||null});
      if(!mounted.current)return;
      setMilestoneEdit(null);setStatus('Milestone details updated privately.');refreshMilestoneList();
    }catch(err){if(mounted.current){
      if(!(err instanceof PrivateGoalsError)||err.code!=='VALIDATION'){
        setMilestoneEdit(current=>current?{...current,needsReview:true,reviewed:null}:null);
        refreshMilestoneList();setError('Milestone change was not confirmed. Review the saved version before trying again; your draft is retained.');
      }else setError(presentError(err));
    }}
    finally{mutation.current=false;if(mounted.current)setBusy(false);}
  }
  async function removeConfirmed(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!deleting||busy||mutation.current||milestoneRead.current||confirmation!==(deleting.kind==='goal'?'DELETE GOAL':'DELETE MILESTONE'))return;
    const deletion=deleting;mutation.current=true;setBusy(true);setError('');setStatus('');
    try{
      if(deletion.kind==='goal'){
        await service.deleteGoalIfUnchanged(deletion.id,deletion.expectedUpdatedAt);
        if(mounted.current)onGoalDeleted();
      }else{
        await service.deleteMilestoneIfUnchanged(deletion.base);
        if(!mounted.current)return;
        setDeleting(null);setConfirmation('');setMilestoneEdit(null);
        setStatus('Milestone deletion acknowledged.');refreshMilestoneList();
      }
    }catch{
      if(mounted.current){
        setDeleting(null);setConfirmation('');if(deletion.kind==='goal'){setReload(n=>n+1);onGoalUpdated();}else refreshMilestoneList();
        setError('Deletion was not confirmed. Private records are being refreshed; check them before confirming another deletion. No recovery or backup erasure is claimed.');
      }
    }finally{mutation.current=false;if(mounted.current)setBusy(false);}
  }
  const template=goalTemplates.find(item=>item.id===templateId);
  const suggestions=template?.milestones.length?template.milestones:['Define the next step','Review progress','Record what I learned'];
  async function addProgress(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy||archived||mutation.current||milestoneRead.current||value.trim()==='')return;
    mutation.current=true;setBusy(true);setError('');setStatus('');
    try{
      await service.addProgress(goal.id,operation,Number(value),note);
      if(!mounted.current)return;
      setOperation(crypto.randomUUID());setValue('');setNote('');
      setStatus('Manual progress saved privately.');setReload(r=>r+1);
    }catch(err){if(mounted.current)setError(presentError(err));}
    finally{mutation.current=false;if(mounted.current)setBusy(false);}
  }
  async function milestone(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy||archived||mutation.current||milestoneRead.current||!name.trim())return;
    mutation.current=true;setBusy(true);setError('');setStatus('');
    try{
      await service.addMilestone(goal.id,milestoneOp,name.trim(),due||null);
      if(!mounted.current)return;
      setMilestoneOp(crypto.randomUUID());setName('');setDue('');
      setStatus('Milestone saved privately.');setReload(r=>r+1);
    }catch(err){if(mounted.current)setError(presentError(err));}
    finally{mutation.current=false;if(mounted.current)setBusy(false);}
  }
  async function toggle(item:GoalMilestone){
    if(busy||archived||mutation.current||milestoneRead.current)return;
    mutation.current=true;setBusy(true);setError('');setStatus('');
    try{
      await service.updateMilestoneIfUnchanged(item,{completed_at:item.completed_at?null:new Date().toISOString()});
      if(!mounted.current)return;
      setStatus('Milestone state confirmed by the private server.');refreshMilestoneList();
    }catch(err){if(mounted.current){refreshMilestoneList();setError('Milestone completion change was not confirmed. Review the refreshed records before choosing again. '+presentError(err));}}
    finally{mutation.current=false;if(mounted.current)setBusy(false);}
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
      {reconcileRequired&&<section aria-label="Goal edit conflict">
        <p role="status">Your draft is retained. Review the saved version before choosing a new base; no write is retried automatically.</p>
        {conflictGoal&&<dl>
          <dt>Saved title</dt><dd>{conflictGoal.title}</dd>
          <dt>Saved description</dt><dd>{conflictGoal.description||'None'}</dd>
          <dt>Saved target</dt><dd>{conflictGoal.target_value??'None'} {conflictGoal.unit??''}</dd>
          <dt>Saved due date</dt><dd>{conflictGoal.due_on??'None'}</dd>
          <dt>Saved status</dt><dd>{conflictGoal.status}</dd>
        </dl>}
        <button type="button" className="ws-secondary" disabled={busy} onClick={()=>void retryConflictRead()}>Refresh saved version</button>
        {conflictGoal&&<button type="button" className="ws-secondary" disabled={busy} onClick={()=>{
          setEditBase(conflictGoal.updated_at);setReconcileRequired(false);setError('');
          setStatus('Saved version reviewed. Saving will replace its details with the displayed draft.');
        }}>Use reviewed version as base and keep draft</button>}
      </section>}
      <div className="ws-actions"><button type="submit" className="ws-secondary" disabled={busy||milestoneLoading||reconcileRequired||!editTitle.trim()}>Save goal details</button>
        <button type="button" className="ws-secondary" disabled={busy} onClick={()=>{setEditing(false);setReconcileRequired(false);setConflictGoal(null);setError('');}}>Cancel goal edit</button></div>
    </form>}
    <h4>Record or correct progress</h4>
    {archived&&<p>Archived goals are read-only for new progress and milestone edits. Change the goal status to resume tracking.</p>}
    <p>Record a new absolute value to correct a mistake. Existing history is preserved; no external provider progress is assumed.</p>
    <form className="ws-growth-form" onSubmit={event=>void addProgress(event)}>
      <label className="ws-growth-field">New absolute progress value
        <input type="number" required min="0" max="9999999999.99" step="0.01" value={value} disabled={busy||milestoneLoading||archived}
          onChange={event=>{setValue(event.target.value);setOperation(crypto.randomUUID());}}/></label>
      <label className="ws-growth-field">Manual progress note
        <input maxLength={500} value={note} disabled={busy||milestoneLoading||archived} onChange={event=>{setNote(event.target.value);setOperation(crypto.randomUUID());}}/></label>
      <button type="submit" className="ws-secondary" disabled={busy||milestoneLoading||archived||value.trim()===''}>Record manual progress</button>
    </form>
    <h4>Manual progress history</h4>
    <ProgressHistory key={goal.id+':'+reload} service={service} goalId={goal.id} busy={busy}
      onCorrection={archived?undefined:item=>{if(busy)return;setValue(String(item.value));setNote('Correction using recorded value: '+item.value);setOperation(crypto.randomUUID());}}/>
    <h4>Milestones</h4>
    {!milestonePage&&!milestoneError&&<EvidencePending label="Loading private milestones…"/>}
    {milestoneError&&<div><p role="alert">{milestoneError}</p><button type="button" className="ws-secondary"
      disabled={busy||milestoneLoading} onClick={()=>milestonePage?void moreMilestones():setMilestoneAttempt(n=>n+1)}>Retry milestones</button></div>}
    {milestonePage&&<p>{milestones?.length??0} loaded milestones. {milestonePage.nextCursor?'More milestones exist.':'All pages reached for this read.'}</p>}
    {milestones?.length===0&&<p>No milestones yet.</p>}
    <ul className="ws-growth-milestones">{milestones?.map(item=><li key={item.id}>
      <span>{item.title}{item.due_on?' · Due '+item.due_on:''}{item.completed_at?' · Completed (manual)':' · Open'}</span>
      <div className="ws-actions">
      <button type="button" disabled={busy||milestoneLoading||archived||milestoneEdit!==null} className="ws-secondary" onClick={()=>void toggle(item)}>
        {item.completed_at?'Mark incomplete':'Mark complete'}</button>
      <button type="button" className="ws-secondary" disabled={busy||milestoneLoading||archived||milestoneEdit!==null} onClick={()=>setMilestoneEdit({base:{...item},title:item.title,due:item.due_on??'',needsReview:false,reviewed:null})}>Edit milestone</button>
      <button type="button" className="ws-secondary" disabled={busy||milestoneLoading||milestoneEdit!==null} onClick={()=>{setDeleting({kind:'milestone',id:item.id,title:item.title,base:{...item}});setConfirmation('');}}>Delete milestone</button></div>
    </li>)}</ul>
    {milestonePage?.nextCursor&&!milestoneError&&<button type="button" className="ws-secondary" disabled={busy||milestoneLoading}
      onClick={()=>void moreMilestones()}>{milestoneLoading?'Loading more milestones…':'Load more milestones'}</button>}
    {milestoneEdit&&<form className="ws-growth-form" onSubmit={event=>void saveMilestone(event)}>
      <label className="ws-growth-field">Edit milestone title<input required maxLength={160} disabled={busy||milestoneLoading||archived} value={milestoneEdit.title}
        onChange={event=>setMilestoneEdit({...milestoneEdit,title:event.target.value})}/></label>
      <label className="ws-growth-field">Edit milestone due date<input type="date" disabled={busy||milestoneLoading||archived} value={milestoneEdit.due}
        onChange={event=>setMilestoneEdit({...milestoneEdit,due:event.target.value})}/></label>
      {milestoneEdit.needsReview&&<section aria-label="Milestone edit conflict">
        <p role="status">Your draft is retained. Review the saved record before choosing a new base. No write was retried.</p>
        {milestoneEdit.reviewed&&<dl><dt>Saved title</dt><dd>{milestoneEdit.reviewed.title}</dd>
          <dt>Saved due date</dt><dd>{milestoneEdit.reviewed.due_on??'Not set'}</dd>
          <dt>Saved completion</dt><dd>{milestoneEdit.reviewed.completed_at?'Complete':'Open'}</dd></dl>}
        <button type="button" className="ws-secondary" disabled={busy||milestoneLoading} onClick={()=>void reviewMilestone()}>Refresh saved milestone</button>
        {milestoneEdit.reviewed&&<button type="button" className="ws-secondary" disabled={busy||milestoneLoading||archived}
          onClick={()=>{setMilestoneEdit(current=>current?.reviewed?{...current,base:current.reviewed,reviewed:null,needsReview:false}:current);
            setError('');setStatus('Saved milestone reviewed; saving replaces its title and date with your draft.');}}>Use reviewed milestone and keep draft</button>}
      </section>}
      <div className="ws-actions"><button className="ws-secondary" type="submit" disabled={busy||milestoneLoading||archived||milestoneEdit.needsReview||!milestoneEdit.title.trim()}>Save milestone details</button>
      <button className="ws-secondary" type="button" disabled={busy} onClick={()=>setMilestoneEdit(null)}>Cancel milestone edit</button></div>
    </form>}
    <label className="ws-growth-field">Suggested milestone draft
      <select value={suggestion} disabled={busy||milestoneLoading||archived} onChange={event=>setSuggestion(event.target.value)}>
        <option value="">Choose a suggestion (optional)</option>{suggestions.map(item=><option key={item}>{item}</option>)}
      </select></label>
    <button type="button" className="ws-secondary" disabled={!suggestion||busy||archived||!!name.trim()}
      onClick={()=>{setName(suggestion);setMilestoneOp(crypto.randomUUID());setSuggestion('');}}>Use suggestion in new milestone</button>
    <p>Suggestions are drafts; adjust the title and due date before adding. No milestone is automatically recorded.</p>
    <form className="ws-growth-form" onSubmit={event=>void milestone(event)}>
      <label className="ws-growth-field">New milestone
        <input required maxLength={160} value={name} disabled={busy||milestoneLoading||archived} onChange={event=>{setName(event.target.value);setMilestoneOp(crypto.randomUUID());}}/></label>
      <label className="ws-growth-field">Milestone due date (optional)
        <input type="date" value={due} disabled={busy||milestoneLoading||archived} onChange={event=>{setDue(event.target.value);setMilestoneOp(crypto.randomUUID());}}/></label>
      <button type="submit" className="ws-secondary" disabled={busy||milestoneLoading||archived||!name.trim()}>Add milestone</button>
    </form>
    <h4>Goal lifecycle</h4>
    <p>Archive to keep progress and milestones. Deletion removes this goal and its associated records from the active private database; it does not use the 15-day project and portfolio Trash.</p>
    <button type="button" className="ws-secondary" disabled={busy||milestoneLoading} onClick={()=>{setDeleting({kind:'goal',id:goal.id,title:goal.title,expectedUpdatedAt:goal.updated_at});setConfirmation('');}}>Delete selected goal</button>
    {deleting&&<form className="ws-growth-form" onSubmit={event=>void removeConfirmed(event)}>
      <p>Delete {deleting.title}? {deleting.kind==='goal'?'Associated milestone and progress rows are removed by the database.':'Only this milestone is affected.'} No Undo or backup erasure is promised.</p>
      <label className="ws-growth-field">Type {deleting.kind==='goal'?'DELETE GOAL':'DELETE MILESTONE'} to confirm<input value={confirmation} disabled={busy} onChange={event=>setConfirmation(event.target.value)}/></label>
      <div className="ws-actions"><button type="submit" className="ws-secondary" disabled={busy||milestoneLoading||confirmation!==(deleting.kind==='goal'?'DELETE GOAL':'DELETE MILESTONE')}>Confirm {deleting.kind} deletion</button>
      <button type="button" className="ws-secondary" disabled={busy||milestoneLoading} onClick={()=>{setDeleting(null);setConfirmation('');}}>Cancel deletion</button></div>
    </form>}
  </div>;
}

function Goals({service}:{service:SupabasePrivateGoalsService}){
  const {goals,error,reload,retry,acceptGoal,forgetGoal,partial,scanned,loading,loadingMore,more}=useGoals(service);
  const mutation=useRef(false);
  const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [title,setTitle]=useState('');
  const [description,setDescription]=useState('');
  const [target,setTarget]=useState('');
  const [unit,setUnit]=useState('');
  const [due,setDue]=useState('');
  const [operation,setOperation]=useState(()=>crypto.randomUUID());
  const [selected,setSelected]=useState('');
  const [templateId,setTemplateId]=useState('free');
  const [goalTemplateIds,setGoalTemplateIds]=useState<Record<string,string>>({});
  const [statusBlocked,setStatusBlocked]=useState<ReadonlySet<string>>(()=>new Set());
  const [busy,setBusy]=useState(false);
  const [note,setNote]=useState('');
  function applyTemplate(id:string){
    const template=goalTemplates.find(item=>item.id===id);
    if(!template||busy)return;
    setTemplateId(id);
    if(id==='free')return;
    setTitle(template.title);setDescription(template.description);setTarget(template.target);setUnit(template.unit);setOperation(crypto.randomUUID());
  }
  const [failure,setFailure]=useState('');
  async function create(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy||mutation.current||!title.trim())return;
    mutation.current=true;setBusy(true);setFailure('');setNote('');
    try{
      const created=await service.createGoal(operation,title.trim(),description.trim(),
        target.trim()?Number(target):null,target.trim()?(unit.trim()||null):null,due||null);
      if(!mounted.current)return;
      if(templateId!=='free')setGoalTemplateIds(old=>({...old,[created.id]:templateId}));
      setTemplateId('free');setOperation(crypto.randomUUID());setTitle('');setDescription('');setTarget('');setUnit('');setDue('');
      setNote('Owner-private goal saved.');acceptGoal(created,true);
    }catch(err){if(mounted.current)setFailure(presentError(err));}
    finally{mutation.current=false;if(mounted.current)setBusy(false);}
  }
  async function refreshStatus(id:string){
    try{
      const latest=await service.readGoal(id);
      if(!mounted.current)return;
      if(latest){
        acceptGoal(latest);
        setStatusBlocked(current=>{const next=new Set(current);next.delete(id);return next;});
        setFailure('Review the refreshed goal status before choosing again. No automatic retry was made.');
      }else setFailure('This goal is unavailable. Refresh private records; no change was confirmed.');
    }catch{if(mounted.current)setFailure('Could not refresh the saved goal. Refresh its status before trying again.');}
  }
  async function retryStatusRead(id:string){
    if(busy||mutation.current)return;
    mutation.current=true;setBusy(true);setFailure('');
    try{await refreshStatus(id);}
    finally{mutation.current=false;if(mounted.current)setBusy(false);}
  }
  async function status(goal:PrivateGoal,next:GoalStatus){
    if(busy||mutation.current||statusBlocked.has(goal.id)||next===goal.status)return;
    mutation.current=true;setBusy(true);setFailure('');setNote('');
    try{
      const saved=await service.updateGoalIfUnchanged(goal.id,goal.updated_at,{status:next});
      if(mounted.current){acceptGoal(saved);setNote('Private goal status updated.');}
    }catch(err){
      if(mounted.current){
        if(goalNeedsReconciliation(err)){
          setStatusBlocked(current=>new Set([...current,goal.id]));
          setFailure('Goal status was not confirmed. Refreshing the saved record; review it and choose a status again.');
          await refreshStatus(goal.id);
        }else setFailure(presentError(err));
      }
    }
    finally{mutation.current=false;if(mounted.current)setBusy(false);}
  }
  const selectedGoal=goals?.find(goal=>goal.id===selected);
  return <div className="ws-growth-layout">
    <section className="ws-project-aside">
      <h2>Your private goals</h2>
      <p>Target values, history and milestone updates are self-reported. Goals are never made public here.</p>
      <LoadingOrError goals={goals} error={error} retry={retry}/>
      {failure&&<div><p role="alert">{failure}</p><button type="button" className="ws-secondary" disabled={busy} onClick={reload}>Refresh private goals</button></div>}{note&&<p role="status">{note}</p>}
      {goals?.length===0&&<p>No private goals yet. Create one below.</p>}
      <ul className="ws-growth-records">{goals?.map(goal=><li key={goal.id}>
        <button type="button" aria-pressed={selected===goal.id} className="ws-growth-pick"
          onClick={()=>setSelected(goal.id)}>{goal.title}</button>
        <span>{goal.status} {goal.due_on?'· Due '+goal.due_on:''}</span>
        <label className="ws-growth-field">Change goal status<select value={goal.status} disabled={busy||statusBlocked.has(goal.id)}
          onChange={event=>void status(goal,event.target.value as GoalStatus)}>
          {(['ACTIVE','PAUSED','COMPLETED','ARCHIVED'] as const).map(item=><option key={item}>{item}</option>)}
        </select></label>
        {statusBlocked.has(goal.id)&&<button type="button" className="ws-secondary" disabled={busy}
          onClick={()=>void retryStatusRead(goal.id)}>Refresh saved status</button>}
      </li>)}</ul>
      <GoalListPaging goals={goals} partial={partial} scanned={scanned} loading={loading} loadingMore={loadingMore} more={more} busy={busy} error={!!error}/>
      <h3>Create a goal</h3>
      <form className="ws-growth-form" onSubmit={event=>void create(event)}>
        <label className="ws-growth-field">Goal template<select value={templateId} disabled={busy} onChange={event=>applyTemplate(event.target.value)}>
          {goalTemplates.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        <p>Choosing a template fills the editable title, description and target fields. Review them before saving. Milestones remain optional owner-entered drafts.</p>
        {templateId!=='free'&&<p>Suggested milestones: {goalTemplates.find(item=>item.id===templateId)?.milestones.join(' · ')}</p>}
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
      {selectedGoal?<GoalDetail key={selectedGoal.id} service={service} goal={selectedGoal} onGoalUpdated={reload} onGoalRecord={acceptGoal} templateId={goalTemplateIds[selectedGoal.id]??'free'} onGoalDeleted={()=>{setSelected('');setNote('Private goal deletion acknowledged.');forgetGoal(selectedGoal.id);}}/>:
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

/** No retry of an uncertain write; only validated local input can be retried directly. */
export function linkFailureKind(err:unknown):'VALIDATION'|'OWNER_DENIED'|'REVIEW' {
  if(err instanceof PrivatePlatformLinkError){
    if(err.code==='AUTH_EXPIRED'||err.code==='FORBIDDEN')return 'OWNER_DENIED';
    if(err.code==='VALIDATION')return 'VALIDATION';
  }
  return 'REVIEW';
}
function ProviderCard({service,provider,existing,onUpdate,onRefresh,onInvalidate}:{
  service:SupabasePrivatePlatformLinksService;
  provider:{id:PlatformProvider;name:string;description:string};
  existing:PrivatePlatformLink|undefined;onUpdate:(record:PrivatePlatformLink|null)=>void;
  onRefresh:()=>void;onInvalidate:()=>void;
}){
  const [handle,setHandle]=useState(existing?.handle??'');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [confirm,setConfirm]=useState(false);
  const [review,setReview]=useState(false);
  const inFlight=useRef(false),mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{setHandle(existing?.handle??'');setConfirm(false);},[existing?.id,existing?.handle]);
  function failed(err:unknown){
    if(!mounted.current)return;
    const kind=linkFailureKind(err);
    if(kind==='OWNER_DENIED'){onInvalidate();return;}
    if(kind==='REVIEW'){setReview(true);setConfirm(false);}
    setError(presentError(err)+(kind==='REVIEW'?' Refresh saved links before choosing again. No write was retried.':''));
  }
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const draft=handle.trim();
    if(busy||inFlight.current||review||!draft||existing?.handle===draft)return;
    inFlight.current=true;setBusy(true);setError('');setNotice('');
    try{
      const result=await service.save(provider.id,draft,existing);
      if(!mounted.current)return;
      onUpdate(result);setNotice('Private link stored. No provider sync or ownership verification occurred.');
    }catch(err){failed(err);}
    finally{inFlight.current=false;if(mounted.current)setBusy(false);}
  }
  async function remove(){
    if(!existing||busy||inFlight.current||review||!confirm)return;
    inFlight.current=true;setBusy(true);setError('');setNotice('');
    try{
      await service.remove(existing);
      if(!mounted.current)return;
      onUpdate(null);setHandle('');setConfirm(false);setNotice('Private link disconnected.');
    }catch(err){failed(err);}
    finally{inFlight.current=false;if(mounted.current)setBusy(false);}
  }
  return <article className="ws-project-aside ws-growth-provider" aria-label={provider.name}>
    <h2>{provider.name}</h2><p>{provider.description}</p>
    <p className="ws-growth-status">Private manual link · Never synced · Ownership not verified</p>
    {existing&&<p>Stored link: <a href={existing.profile_url} target="_blank" rel="noopener noreferrer">{existing.profile_url}</a>{review&&' (Previously confirmed; current state is unverified.)'}</p>}
    <form className="ws-growth-form" onSubmit={event=>void save(event)}>
      <label className="ws-growth-field">Public handle
        <input maxLength={64} value={handle} required autoComplete="off" disabled={busy||review}
          onChange={event=>{setHandle(event.target.value);setConfirm(false);setError('');setNotice('');}}/></label>
      <button type="submit" className="ws-secondary" disabled={busy||review||!handle.trim()||existing?.handle===handle.trim()}>
        {busy?'Saving…':existing?'Update private link':'Save private link'}</button>
    </form>
    {existing&&<div className="ws-growth-form">
      <label className="ws-growth-confirm"><input type="checkbox" checked={confirm} disabled={busy||review} onChange={event=>setConfirm(event.target.checked)}/>
        Confirm disconnect of this stored link</label>
      <button type="button" className="ws-secondary" disabled={!confirm||busy||review} onClick={()=>void remove()}>Disconnect link</button>
    </div>}
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {review&&<><p>Refreshing replaces the displayed draft with saved records. Copy the draft first if needed.</p>
      <button type="button" className="ws-secondary" disabled={busy} onClick={onRefresh}>Refresh saved links</button></>}
  </article>;
}

function Connections({service}:{service:SupabasePrivatePlatformLinksService}){
  const [links,setLinks]=useState<PrivatePlatformLink[]|null>(null);
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  const generation=useRef(0);
  const initial=useRef<{service:SupabasePrivatePlatformLinksService;attempt:number;promise:Promise<PrivatePlatformLink[]>}|null>(null);
  function refresh(){
    generation.current++;setLinks(null);setError('');setAttempt(n=>n+1);
  }
  useEffect(()=>{
    let active=true;
    const request=++generation.current;
    if(initial.current?.service!==service||initial.current.attempt!==attempt)
      initial.current={service,attempt,promise:Promise.resolve().then(()=>service.list())};
    void initial.current.promise.then(items=>{if(active&&generation.current===request){setLinks(items);setError('');}})
      .catch(err=>{if(active&&generation.current===request){setLinks(null);setError(presentError(err));}});
    return ()=>{active=false;};
  },[service,attempt]);
  const viewGeneration=generation.current;
  function updated(provider:PlatformProvider,record:PrivatePlatformLink|null){
    if(generation.current!==viewGeneration)return;
    setLinks(current=>!current?current:
      [...current.filter(row=>row.provider!==provider),...(record?[record]:[])]);
  }
  function invalidate(){
    if(generation.current!==viewGeneration)return;
    generation.current++;setLinks(null);setError('The owner session or access was not confirmed. Private links have been hidden.');
  }
  return <section>
    <p>Optional public-handle links are stored privately. No OAuth, syncing, provider API, verification or public profile sharing is active.</p>
    {error&&<p role="alert">{error} <button className="ws-secondary" type="button" onClick={refresh}>Retry links</button></p>}
    {!links&&!error&&<EvidencePending label="Loading your private platform links…"/>}
    {links&&<div className="ws-growth-provider-grid">{providers.map(provider=>
      <ProviderCard key={viewGeneration+':'+provider.id} provider={provider} service={service}
        existing={links.find(item=>item.provider===provider.id)}
        onUpdate={record=>updated(provider.id,record)} onRefresh={refresh} onInvalidate={invalidate}/>)}</div>}
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
    if(path==='/app/analytics')return;
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
      error?<div className="ws-project-aside"><p role="alert">{error}</p>
        <button type="button" className="ws-secondary" onClick={()=>setAttempt(n=>n+1)}>Retry private Growth</button></div>:
      !services?<p role="status">Checking your owner-private growth records…</p>:
      path==='/app/growth/devscore'?<DevScore key={current!.viewKey} services={services}/>:
      path==='/app/growth'?<GrowthHome key={current!.viewKey} service={services.goals}/>:
      path==='/app/growth/activity'?<Activity key={current!.viewKey} service={services.goals}/>:
      path==='/app/growth/goals'?<Goals key={current!.viewKey} service={services.goals}/>:
      <Connections key={current!.viewKey} service={services.links}/>}
  </section>;
}
