/** Owner analytics panel; mount only with verified owner factory and backend capability.
 * No ambient transport, route mount, provider, collector, or persisted selection.
 */
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import type {SupabaseBrowserAuthPort,OwnerPortfolio,OwnerPrivateCursorV1,OwnerPrivatePageV1} from '../../auth-web/src/supabase-auth-port.ts';
import type {AnalyticsAction,ChangeOwnerAnalyticsInput,OwnerAnalytics,OwnerAnalyticsChange,OwnerAnalyticsState,SupabasePrivateAnalyticsService} from '../../../packages/contracts/src/private-analytics-service.ts';
import {PrivateAnalyticsError} from '../../../packages/contracts/src/private-analytics-service.ts';
export interface PortfolioAnalyticsProps {
  service:SupabasePrivateAnalyticsService;
  verifiedOwner:{id:string;epoch:number};
  portfolios:ReadonlyArray<{id:string;title:string}>;
  isCurrentOwner:()=>boolean;
  listLimited:boolean;
  loadingMore:boolean;
  onLoadMore:(()=>Promise<void>)|null;
}
const MAX=Number.MAX_SAFE_INTEGER;
const buckets=['DIRECT_OR_UNKNOWN','SEARCH','SOCIAL','OTHER_EXTERNAL','INTERNAL'] as const;
const labels={DIRECT_OR_UNKNOWN:'Direct or unknown',SEARCH:'Search',SOCIAL:'Social',OTHER_EXTERNAL:'Other external',INTERNAL:'Internal'};
const errorText=(e:unknown)=>e instanceof PrivateAnalyticsError&&e.code==='CONFLICT'?'Consent changed. Load the current state and confirm again.': 'The private server did not confirm the request. No saved change or visitor count is assumed.';
const safe=(f:()=>boolean)=>{try{return f()===true}catch{return false}};
type Scope={service:SupabasePrivateAnalyticsService;id:string;epoch:number};
type View={scope:Scope;ids:readonly string[];window:7|30;states:OwnerAnalyticsState[];data:OwnerAnalytics|null;error:string;note:string};
type Confirmation={scope:Scope;input:ChangeOwnerAnalyticsInput};
function canRepeatConsent(input:ChangeOwnerAnalyticsInput,state:OwnerAnalyticsState):boolean{
  if(state.portfolioId!==input.portfolioId||state.version!==input.expectedVersion)return false;
  if(input.action==='ENABLE')return !state.enabled&&state.eligible&&state.version<MAX-1;
  if(input.action==='CLEAR')return state.enabled&&state.version<MAX-1;
  return input.action==='DISABLE'&&state.enabled;
}
type ConsentStamp=Pick<OwnerAnalyticsState,'portfolioId'|'version'|'enabled'|'policyVersion'|'enabledAt'|'coverageStartedAt'|'updatedAt'>;
// Scope-local monotonic fence: an acknowledged privacy reduction must never be
// replaced by an older response, even after an explicit reload or filter change.
function observeConsent(floor:Map<string,ConsentStamp>,rows:readonly ConsentStamp[]){
  const next=new Map(floor);
  for(const row of rows){
    const before=next.get(row.portfolioId);
    if(before&&(row.version<before.version||row.version===before.version&&(
      row.enabled!==before.enabled||row.policyVersion!==before.policyVersion||
      row.enabledAt!==before.enabledAt||row.coverageStartedAt!==before.coverageStartedAt||row.updatedAt!==before.updatedAt)))throw new PrivateAnalyticsError('CONFLICT');
    next.set(row.portfolioId,{portfolioId:row.portfolioId,version:row.version,enabled:row.enabled,policyVersion:row.policyVersion,enabledAt:row.enabledAt,coverageStartedAt:row.coverageStartedAt,updatedAt:row.updatedAt});
  }
  for(const row of rows){const validated=next.get(row.portfolioId);if(validated)floor.set(row.portfolioId,validated)}
}
// Counts are optional; a failed comparison must not hide freshly verified privacy controls.
async function readAnalyticsView(service:SupabasePrivateAnalyticsService,requested:string[],period:7|30,loadMetrics:boolean,live:()=>boolean,observe:(rows:readonly ConsentStamp[])=>void=()=>{}){
  // Check exact positional identity as well as the service's wire validation.
  const readStates=async()=>{
    const rows=await Promise.all(requested.map(id=>service.getOwnerAnalyticsState(id)));
    if(rows.length!==requested.length||rows.some((row,i)=>row.portfolioId!==requested[i]))throw new PrivateAnalyticsError('INVALID_RESPONSE');
    return rows;
  };
  const states=await readStates();
  if(!live())return null;
  observe(states);
  if(!loadMetrics||!states.every(s=>s.enabled))return {states,data:null,error:''};
  let data:OwnerAnalytics|null=null,error='';
  try{data=await service.getOwnerAnalytics({portfolioIds:requested,windowDays:period})}
  catch(e){error=errorText(e)}
  if(!live())return null;
  // Revalidate even when metrics fail; a state-reread failure hides both state and counts.
  const after=await readStates();
  if(!live())return null;
  observe(after);
  const same=(a:OwnerAnalyticsState,b:OwnerAnalyticsState)=>a.enabled===b.enabled&&a.eligible===b.eligible&&a.version===b.version&&a.coverageStartedAt===b.coverageStartedAt;
  const changed=after.some((s,i)=>{const before=states[i];return !before||!same(s,before)});
  const mismatch=data!==null&&(data.portfolios.length!==requested.length||data.portfolios.some((p,i)=>{
    const current=after[i];
    return !current||p.portfolioId!==requested[i]||p.portfolioId!==current.portfolioId||!current.enabled||p.version!==current.version||p.coverageStartedAt!==current.coverageStartedAt||p.eligible!==current.eligible;
  }));
  if(changed||mismatch){
    return {states:after,data:null,error:'Consent or release eligibility changed. Counts were discarded. Review the current privacy controls.'};
  }
  return {states:after,data,error};
}
export function PortfolioAnalytics(props:PortfolioAnalyticsProps){
  // Reset on shell epoch or adapter identity change even if an owner ID returns.
  const scope=useMemo(()=>({service:props.service,id:props.verifiedOwner.id,epoch:props.verifiedOwner.epoch}),[props.service,props.verifiedOwner.id,props.verifiedOwner.epoch]);
  const consentFloor=useMemo(()=>new Map<string,ConsentStamp>(),[scope]);
  const active=useRef(scope);active.current=scope;
  const guard=useRef(props.isCurrentOwner);guard.current=props.isCurrentOwner;
  const available=useMemo(()=>new Map(props.portfolios.map(p=>[p.id,p.title])),[props.portfolios]);
  const authorized=useRef(available);authorized.current=available;
  const [selection,setSelection]=useState<{scope:Scope;ids:string[]}>({scope,ids:[]});
  const ids=selection.scope===scope?selection.ids.filter(id=>available.has(id)):[];
  const selectionKey=JSON.stringify(ids);
  const [window,setWindow]=useState<7|30>(7);
  const [view,setView]=useState<View|null>(null);
  const [busy,setBusy]=useState<{scope:Scope;message:string}|null>(null);
  const [confirmation,setConfirmation]=useState<Confirmation|null>(null);
  const [retry,setRetry]=useState<Confirmation|null>(null);
  const [pageError,setPageError]=useState('');
  const pageInFlight=useRef(false),rangeName=useId();
  const generation=useRef(0),inFlight=useRef(false),mounted=useRef(false);
  const confirmFocus=useRef<HTMLButtonElement|null>(null);
  const previousFocus=useRef<HTMLElement|null>(null);
  const live=(candidate:Scope,request:number,requested:readonly string[])=>mounted.current&&active.current===candidate&&generation.current===request&&safe(guard.current)&&requested.every(id=>authorized.current.has(id));
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;inFlight.current=false}},[]);
  useEffect(()=>{generation.current++;inFlight.current=false;pageInFlight.current=false;setBusy(null);setView(null);setConfirmation(null);setRetry(null);setPageError('');previousFocus.current=null;setWindow(7);},[scope]);
  useEffect(()=>{if(confirmation?.scope===scope)confirmFocus.current?.focus()},[confirmation,scope]);
  function invalidate(){generation.current++;inFlight.current=false;setBusy(null);setView(null);setConfirmation(null);setRetry(null)}
  function select(id:string,checked:boolean){if(inFlight.current||!available.has(id)||!safe(guard.current))return;invalidate();const next=checked?[...new Set([...ids,id])].slice(0,5):ids.filter(x=>x!==id);setSelection({scope,ids:next})}
  function changeWindow(value:7|30){if(inFlight.current)return;invalidate();setWindow(value)}
  function read(candidate:Scope,request:number,requested:string[],period:7|30,loadMetrics:boolean){
    return readAnalyticsView(candidate.service,requested,period,loadMetrics,()=>live(candidate,request,requested),rows=>observeConsent(consentFloor,rows));
  }
  async function load(){
    if(inFlight.current||ids.length===0||!safe(guard.current))return;
    const candidate=scope,requested=[...ids],period=window,request=++generation.current;
    inFlight.current=true;setBusy({scope,message:'Loading owner-private analytics…'});setView(null);setConfirmation(null);
    try{const result=await read(candidate,request,requested,period,true);if(result&&live(candidate,request,requested)){
      setRetry(prior=>prior?.scope===candidate&&result.states.some(s=>canRepeatConsent(prior.input,s))?prior:null);
      setView({scope,ids:requested,window:period,...result,note:''});
    }}
    catch(e){if(live(candidate,request,requested))setView({scope,ids:requested,window:period,states:[],data:null,error:errorText(e),note:''})}
    finally{if(mounted.current&&active.current===candidate&&generation.current===request){inFlight.current=false;setBusy(null)}}
  }
  const visible=safe(guard.current)&&view?.scope===scope&&JSON.stringify(view.ids)===selectionKey&&view.window===window?view:null;
  const pending=busy?.scope===scope;
  function propose(s:OwnerAnalyticsState,action:AnalyticsAction){
    if(pending||!visible?.states.some(row=>row.portfolioId===s.portfolioId&&row.version===s.version)||!safe(guard.current))return;
    if(action==='ENABLE'&&(s.enabled||!s.eligible||s.version>=MAX-1)||action==='CLEAR'&&(!s.enabled||s.version>=MAX-1)||action==='DISABLE'&&!s.enabled)return;
    previousFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const prior=retry?.scope===scope?retry.input:null;
    const input:ChangeOwnerAnalyticsInput=prior&&prior.portfolioId===s.portfolioId&&prior.action===action&&prior.expectedVersion===s.version?prior:{portfolioId:s.portfolioId,action,expectedVersion:s.version,operationId:crypto.randomUUID(),policyVersion:1};
    setConfirmation({scope,input});
  }
  function dismiss(){setConfirmation(null);previousFocus.current?.focus();previousFocus.current=null}
  async function mutate(){
    const c=confirmation;
    if(!c||c.scope!==scope||inFlight.current||!safe(guard.current)||!ids.includes(c.input.portfolioId)||!visible?.states.some(s=>s.portfolioId===c.input.portfolioId&&s.version===c.input.expectedVersion))return;
    const {input}=c,candidate=scope,requested=[...ids],period=window,request=++generation.current;
    inFlight.current=true;setConfirmation(null);setRetry(null);setView(null);setBusy({scope,message:'Checking the confirmed privacy change…'});
    let receipt:OwnerAnalyticsChange|null=null,uncertain=false,note='';
    try{receipt=await candidate.service.changeOwnerAnalytics(input)}
    catch(e){uncertain=!(e instanceof PrivateAnalyticsError)||['TRANSPORT','UNAVAILABLE','INVALID_RESPONSE'].includes(e.code);note=errorText(e)}
    try{
      if(!live(candidate,request,requested))return;
      if(receipt)observeConsent(consentFloor,[receipt]);
      // Do not fetch counts in the mutation path. Reconcile current consent first;
      // a later explicit Load is the only path to a new comparison.
      const result=await read(candidate,request,requested,period,false);
      if(!result||!live(candidate,request,requested))return;
      const current=result.states.find(s=>s.portfolioId===input.portfolioId);
      if(!receipt&&uncertain&&current&&canRepeatConsent(input,current))setRetry(c);
      setView({scope,ids:requested,window:period,...result,note:receipt?(current&&current.version>receipt.version?'The acknowledged change was superseded. Current consent was reread.':'Server receipt received; current consent was reread. Load analytics explicitly for current counts.'):note});
    }catch(e){if(live(candidate,request,requested)){
      // A failed reconciliation is not proof that an operation failed. Keep its
      // exact ID in memory until a fresh, matching state permits explicit retry.
      if(!receipt&&uncertain)setRetry(c);
      setView({scope,ids:requested,window:period,states:[],data:null,error:errorText(e),note:'Load current consent before another change.'});
    }}
    finally{if(mounted.current&&active.current===candidate&&generation.current===request){inFlight.current=false;setBusy(null);previousFocus.current?.focus();previousFocus.current=null}}
  }
  async function more(){if(!props.onLoadMore||props.loadingMore||pageInFlight.current||!safe(guard.current))return;const candidate=scope;pageInFlight.current=true;setPageError('');try{await props.onLoadMore()}catch{if(active.current===candidate&&mounted.current&&safe(guard.current))setPageError('The next owner portfolio page could not be loaded.')}finally{if(active.current===candidate&&mounted.current)pageInFlight.current=false}}
  if(!safe(guard.current))return <p role="status">Owner analytics unavailable. Verify your session.</p>;
  return <section className="ws-growth-layout" aria-label="Portfolio analytics controls">
    <section className="ws-project-aside"><h2>Compare portfolios</h2><p>Approximate recorded requests, not unique visitors. Consent starts off; no backfill. Missing days are unavailable, never zero traffic.</p>
      <fieldset disabled={pending}><legend>Choose up to five owner portfolios</legend>{props.portfolios.length===0&&!props.loadingMore&&<p>No owner portfolios loaded.</p>}{[...available].map(([id,title])=><label key={id}><input type="checkbox" checked={ids.includes(id)} disabled={!ids.includes(id)&&ids.length>=5} onChange={e=>select(id,e.target.checked)}/>{title}</label>)}</fieldset>
      {props.listLimited&&<p>The loaded portfolio list may be incomplete. Load another page if available.</p>}{props.onLoadMore&&<button type="button" className="ws-secondary" disabled={props.loadingMore||pending} onClick={()=>void more()}>{props.loadingMore?'Loading more portfolios…':'Load more portfolios'}</button>}{pageError&&<p role="alert">{pageError}</p>}
      <fieldset disabled={pending}><legend>Date range</legend>{([7,30] as const).map(n=><label key={n}><input type="radio" name={rangeName} checked={window===n} onChange={()=>changeWindow(n)}/>{n} days</label>)}</fieldset>
      <button type="button" className="ws-primary" disabled={pending||ids.length===0} onClick={()=>void load()}>Load analytics</button>{pending&&<><p role="status">{busy?.message}</p><div className="glyph-skeleton" aria-hidden="true"><span className="glyph-skeleton-line is-title"/><span className="glyph-skeleton-line is-medium"/><span className="glyph-skeleton-line is-short"/></div></>}
      {!visible?.states.length&&<><button type="button" className="ws-secondary" disabled>Enable portfolio analytics</button><p>Select a portfolio and load its current consent before making changes.</p></>}
      {visible?.states.some(s=>!s.enabled)&&<p>Only enabled portfolios can be compared. Deselect portfolios with consent off, or explicitly enable eligible portfolios before loading counts.</p>}{visible?.error&&<p role="alert">{visible.error}</p>}{visible?.note&&<p role="status">{visible.note}</p>}
    </section>
    {visible&&visible.states.map(s=><section className="ws-project-aside" key={s.portfolioId}><h2>{available.get(s.portfolioId)}</h2><p>Consent: {s.enabled?'On':'Off'} · {s.eligible?'Eligible release':'Not currently eligible'}</p>
      {!s.enabled&&<button type="button" className="ws-primary" disabled={!s.eligible||s.version>=MAX-1||pending} onClick={()=>propose(s,'ENABLE')}>Enable portfolio analytics</button>}
      {s.enabled&&<><button type="button" className="ws-secondary" disabled={pending||s.version>=MAX-1} onClick={()=>propose(s,'CLEAR')}>Clear analytics</button><button type="button" className="ws-secondary" disabled={pending} onClick={()=>propose(s,'DISABLE')}>Disable analytics</button></>}
      {(!s.eligible||!s.enabled)&&<p>Current availability is not proof of traffic or collection.</p>}
    </section>)}
    {confirmation?.scope===scope&&ids.includes(confirmation.input.portfolioId)&&!pending&&<section className="ws-project-aside" role="group" aria-label="Confirm analytics privacy change"><h2>Confirm {confirmation.input.action.toLowerCase()}</h2><p>{confirmation.input.action==='ENABLE'?'Allow future approximate aggregate counts for this eligible owner portfolio only. No past data will be collected. Collection remains unavailable until trusted delivery is separately proven.':'Delete retained counts for this portfolio. The minimal same-day operational quota counter can remain until UTC rollover.'}</p>{retry?.input.operationId===confirmation.input.operationId&&<p>Retrying the same operation identifier, not creating a second request.</p>}<button ref={confirmFocus} type="button" className="ws-secondary" onClick={dismiss}>Cancel</button><button type="button" className="ws-primary" onClick={()=>void mutate()}>Confirm {confirmation.input.action.toLowerCase()}</button></section>}
    {visible?.data?.portfolios.map(p=>{const total=p.days.reduce((sum,d)=>sum+(d.views??0),0);return <section className="ws-project-aside" key={p.portfolioId}><h2>{available.get(p.portfolioId)} — Recorded views (approximate)</h2><p>{p.quality==='PARTIAL'?`${total} recorded requests, partial data${total<10?' · low sample':''}`:'Unavailable — no confirmed counts'}. UTC {visible.data!.fromDay} to {visible.data!.toDay}.</p><figure aria-label="Recorded daily requests chart"><figcaption>Daily recorded requests (partial coverage; gaps are unavailable)</figcaption><div style={{overflowX:'auto'}}><svg role="img" aria-label="Recorded daily requests, maximum scale 250. See the daily table for exact values and unavailable dates." viewBox={`0 0 ${Math.max(210,p.days.length*17+32)} 116`} width="100%" style={{minWidth:210,maxWidth:'100%'}}><line x1="24" y1="8" x2="24" y2="94" stroke="currentColor" opacity="0.45"/><line x1="24" y1="94" x2={p.days.length*17+24} y2="94" stroke="currentColor" opacity="0.45"/><text x="1" y="12" fontSize="8" fill="currentColor">250</text><text x="12" y="94" fontSize="8" fill="currentColor">0</text>{p.days.map((d,i)=>d.views===null?<path key={d.day} d={`M${28+i*17} 85 l7 -7 m-7 0 l7 7`} stroke="currentColor" opacity="0.45"><title>{d.day}: unavailable</title></path>:<rect key={d.day} x={28+i*17} y={94-(d.views/250)*86} width="9" height={(d.views/250)*86} rx="1" fill="currentColor"><title>{d.day}: {d.views} recorded requests, partial</title></rect>)}</svg></div></figure><div style={{overflowX:'auto'}}><table><caption>Daily recorded counts by coarse referrer category</caption><thead><tr><th scope="col">UTC date</th><th scope="col">Recorded views</th>{buckets.map(k=><th key={k} scope="col">{labels[k]}</th>)}<th scope="col">Coverage</th></tr></thead><tbody>{p.days.map(d=><tr key={d.day}><th scope="row">{d.day}</th><td>{d.views===null?'Unavailable':<><meter min={0} max={250} value={d.views} aria-label={`${d.day}: ${d.views} recorded views`}/>{d.views}</>}</td>{buckets.map(k=><td key={k}>{d.buckets===null?'—':d.buckets[k]}</td>)}<td>{d.quality==='PARTIAL'?'Partial data':'Unavailable'}</td></tr>)}</tbody></table></div></section>})}
    <p>Zero within a recorded referrer bucket means no accepted count in that bucket, not evidence of no traffic. Retention is 30 UTC days. No visitor identifiers are displayed. Consent and recorded requests do not establish that tracking is active.</p>
  </section>;
}

/** Bind the panel to the existing verified owner factory and authoritative
 * keyset library, not a second auth cache. The shell supplies its verified
 * identity; the service receives the distinct adapter epoch. */
type OwnerAnalyticsFactory=NonNullable<Awaited<ReturnType<SupabaseBrowserAuthPort['ownerAnalytics']>>['data']>;
type OwnerAnalyticsPage=OwnerPrivatePageV1<OwnerPortfolio>;
type OwnerBridgeScope={port:SupabaseBrowserAuthPort;ownerId:string;shellEpoch:number;attempt:number};
type OwnerBridgeReady={scope:OwnerBridgeScope;factory:OwnerAnalyticsFactory;items:OwnerPortfolio[];nextCursor:OwnerPrivateCursorV1|null};
const OWNER_PAGE=50,OWNER_MAX=1000;
function mergeOwnerAnalyticsPage(ownerId:string,existing:OwnerPortfolio[],page:OwnerAnalyticsPage,previous:OwnerPrivateCursorV1|null):{items:OwnerPortfolio[];nextCursor:OwnerPrivateCursorV1|null}{
  if(!Array.isArray(page.items)||page.items.length>OWNER_PAGE||existing.length+page.items.length>OWNER_MAX)throw new PrivateAnalyticsError('INVALID_RESPONSE');
  const ids=new Set(existing.map(p=>p.id));
  for(const row of page.items){if(!row||typeof row.id!=='string'||typeof row.title!=='string'||ids.has(row.id))throw new PrivateAnalyticsError('INVALID_RESPONSE');ids.add(row.id)}
  const next=page.nextCursor;
  if(next!==null&&(page.items.length===0||next.version!==1||next.collection!=='portfolios'||next.ownerUserId!==ownerId||next.id!==page.items[page.items.length-1]?.id||previous&&next.id===previous.id&&next.updatedAt===previous.updatedAt))throw new PrivateAnalyticsError('INVALID_RESPONSE');
  return {items:[...existing,...page.items],nextCursor:next};
}
async function prepareOwnerAnalytics(scope:OwnerBridgeScope,live:()=>boolean):Promise<OwnerBridgeReady|null>{
  const ready=await scope.port.ownerAnalytics();
  if(!live())return null;
  const factory=ready.data;
  if(ready.error||!factory||factory.ownerId!==scope.ownerId||!safe(factory.isCurrentOwner))throw new PrivateAnalyticsError('NOT_FOUND_OR_FORBIDDEN');
  const page=await scope.port.listOwnerPortfoliosPage(OWNER_PAGE,null);
  if(!live())return null;
  if(!safe(factory.isCurrentOwner)||page.error||!page.data)throw new PrivateAnalyticsError('UNAVAILABLE');
  const result=mergeOwnerAnalyticsPage(scope.ownerId,[],page.data,null);
  const first=result.items[0];
  // A real owner-state read proves the expected private RPC contract; never
  // mutate consent or request aggregate counts as part of route initialization.
  if(first){const state=await factory.service.getOwnerAnalyticsState(first.id);
    if(!live())return null;
    if(!safe(factory.isCurrentOwner)||state.portfolioId!==first.id)throw new PrivateAnalyticsError('NOT_FOUND_OR_FORBIDDEN');}
  if(!live())return null;
  if(!safe(factory.isCurrentOwner))throw new PrivateAnalyticsError('NOT_FOUND_OR_FORBIDDEN');
  return {scope,factory,...result};
}
export function VerifiedOwnerAnalytics({port,verifiedOwner}:{port:SupabaseBrowserAuthPort;verifiedOwner:{id:string;epoch:number}}){
  const [attempt,setAttempt]=useState(0);
  const scope=useMemo(()=>({port,ownerId:verifiedOwner.id,shellEpoch:verifiedOwner.epoch,attempt}),[port,verifiedOwner.id,verifiedOwner.epoch,attempt]);
  const active=useRef(scope);active.current=scope;
  const generation=useRef(0),paging=useRef(false);
  const [loaded,setLoaded]=useState<OwnerBridgeReady|null>(null);
  const [failure,setFailure]=useState<OwnerBridgeScope|null>(null);
  const [pageBusy,setPageBusy]=useState<OwnerBridgeScope|null>(null);
  const current=loaded?.scope===scope?loaded:null;
  useEffect(()=>{const request=++generation.current;let mounted=true;paging.current=false;setPageBusy(null);setLoaded(null);setFailure(null);
    const live=()=>mounted&&active.current===scope&&generation.current===request;
    void prepareOwnerAnalytics(scope,live).then(result=>{if(result&&live())setLoaded(result)}).catch(()=>{if(live())setFailure(scope)});
    return()=>{mounted=false;generation.current++;paging.current=false};
  },[scope]);
  async function more(){
    const snapshot=current,request=generation.current;
    if(!snapshot||!snapshot.nextCursor||snapshot.items.length>=OWNER_MAX||paging.current||!safe(snapshot.factory.isCurrentOwner))return;
    paging.current=true;setPageBusy(scope);
    try{
      const page=await port.listOwnerPortfoliosPage(Math.min(OWNER_PAGE,OWNER_MAX-snapshot.items.length),snapshot.nextCursor);
      if(active.current!==scope||generation.current!==request)return;
      if(!safe(snapshot.factory.isCurrentOwner)||page.error||!page.data)throw new PrivateAnalyticsError('UNAVAILABLE');
      const result=mergeOwnerAnalyticsPage(scope.ownerId,snapshot.items,page.data,snapshot.nextCursor);
      setLoaded(prior=>prior===snapshot?{...snapshot,...result}:prior);
    }finally{if(active.current===scope&&generation.current===request){paging.current=false;setPageBusy(null)}}
  }
  if(failure===scope||current&&!safe(current.factory.isCurrentOwner))return <section className="ws-project-aside"><h2>Analytics unavailable</h2><p role="alert">The private analytics service or current owner could not be verified. No counts or consent changes are assumed.</p><button type="button" className="ws-secondary" onClick={()=>setAttempt(n=>n+1)}>Retry private analytics</button></section>;
  if(!current)return <section className="ws-project-aside" aria-busy="true"><p role="status">Checking owner-private analytics…</p><div className="glyph-skeleton" aria-hidden="true"><span className="glyph-skeleton-line is-title"/><span className="glyph-skeleton-line is-medium"/></div></section>;
  if(!current.items.length)return <section className="ws-project-aside"><h2>Tracking remains off.</h2><p className="ws-growth-unknown">No verified visitor analytics are available.</p><p>Create a portfolio before reviewing its analytics consent. No collection is started here.</p><button type="button" className="ws-primary" disabled>Enable portfolio analytics</button><a href="/app/portfolios">Manage private portfolios</a><button type="button" className="ws-secondary" onClick={()=>setAttempt(n=>n+1)}>Refresh portfolios</button></section>;
  return <PortfolioAnalytics service={current.factory.service} verifiedOwner={{id:current.factory.ownerId,epoch:current.factory.adapterEpoch}} portfolios={current.items} isCurrentOwner={()=>active.current===scope&&safe(current.factory.isCurrentOwner)} listLimited={current.nextCursor!==null} loadingMore={pageBusy===scope} onLoadMore={current.nextCursor&&current.items.length<OWNER_MAX?more:null}/>;
}
