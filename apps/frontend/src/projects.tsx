import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import type { NewPrivateProject, OwnerProject } from '../../auth-web/src/supabase-auth-port.ts';
import type { AuthOutcome } from '../../../packages/contracts/src/auth-service.ts';
import { SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
import { normalizeExternalHttpsUrl } from '../../../packages/contracts/src/project.ts';
import { normalizeProjectDraft, type PrivateProjectDraft } from '../../../packages/contracts/src/projects.ts';
import type { CaseStudySection } from '../../../packages/contracts/src/private-project-case-studies.ts';
import { Icon } from './landing.tsx';
import { MoveToTrash } from './settings.tsx';

/** Matches S1's additive OwnerPrivateCursorV1 projects subset.
 * The worker branch deliberately stays independent of S1-owned files. */
type ProjectCursor = Readonly<{
  version:1; collection:'projects'; ownerUserId:string; updatedAt:string; id:string;
}>;
type ProjectPage = {items:OwnerProject[]; nextCursor:ProjectCursor|null};
type ProjectPagePort = SupabaseBrowserAuthPort & {
  listOwnerProjectsPage?: (pageSize:number, after:ProjectCursor|null)=>Promise<AuthOutcome<ProjectPage>>;
};
type LoadState = {status:'loading'} | {status:'error'; message:string} |
  {status:'ready'; ownerId:string; items:OwnerProject[]; nextCursor:ProjectCursor|null};
const PAGE_SIZE=50;
const accountChangedMessage='Your account changed or its session could not be verified. Private projects were cleared. Retry to load the current account.';

function validProjectPage(page:ProjectPage, ownerId:string, previous:ProjectCursor|null):boolean {
  if (!page || !Array.isArray(page.items) || page.items.length>PAGE_SIZE ||
      new Set(page.items.map(item=>item.id)).size!==page.items.length) return false;
  const cursor=page.nextCursor;
  if (cursor===null) return true;
  return page.items.length>0 && cursor.version===1 && cursor.collection==='projects' &&
    cursor.ownerUserId===ownerId && typeof cursor.updatedAt==='string' &&
    Number.isFinite(Date.parse(cursor.updatedAt)) && typeof cursor.id==='string' &&
    !(previous && previous.id===cursor.id && previous.updatedAt===cursor.updatedAt);
}
const freshDraft=():NewPrivateProject=>({
  title:'',slug:'',summary:'',repositoryUrl:null,liveUrl:null
});
function suggestSlug(title:string):string {
  const derived=title.normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
    .slice(0,64).replace(/-+$/g,'');
  return derived.length>=3 ? derived : 'project-'+(derived||'untitled');
}
function safeProjectLink(value: string | null): string | undefined {
  try { return value ? normalizeExternalHttpsUrl(value) : undefined; }
  catch { return undefined; }
}

export function PrivateProjects({port}:{port:SupabaseBrowserAuthPort}) {
  const [state,setState]=useState<LoadState>({status:'loading'});
  const [reload,setReload]=useState(0);
  const [pageError,setPageError]=useState('');
  const [loadingMore,setLoadingMore]=useState(false);
  const requestEpoch=useRef(0);
  const pageInFlight=useRef(false);
  const [search,setSearch]=useState('');
  const [view,setView]=useState<'gallery'|'list'>('gallery');
  const [sort,setSort]=useState<'recent'|'oldest'|'name'|'name-desc'>('recent');
  const [linkFilter,setLinkFilter]=useState<'all'|'repository'|'live'|'both'|'none'>('all');
  const [detailFilter,setDetailFilter]=useState<'all'|'described'|'missing'>('all');
  const [draft,setDraft]=useState<NewPrivateProject>(freshDraft);
  const [customSlug,setCustomSlug]=useState(false);
  const [saving,setSaving]=useState(false);
  const creationInFlight=useRef(false);
  const creationAttempt=useRef(0);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const modal=useRef<HTMLDialogElement>(null);
  const opener=useRef<HTMLButtonElement>(null);
  const topOpener=useRef<HTMLButtonElement>(null);
  function invalidateOwner() {
    creationAttempt.current++;
    creationInFlight.current=false;
    setSaving(false);
    requestEpoch.current++;
    pageInFlight.current=false;
    setLoadingMore(false);
    setPageError('');
    setSearch('');
    setLinkFilter('all');
    setDetailFilter('all');
    setSort('recent');
    setDraft(freshDraft());
    setCustomSlug(false);
    setError('');
    setNotice('');
    modal.current?.close();
    setState({status:'error',message:accountChangedMessage});
  }
  useEffect(()=>{
    let active=true;
    const epoch=++requestEpoch.current;
    pageInFlight.current=false;
    setLoadingMore(false);
    setPageError('');
    setState({status:'loading'});
    const load=async()=>{
      const identity=await port.getUser();
      if (!active || epoch!==requestEpoch.current) return;
      const ownerId=identity.data?.user?.id;
      if (identity.error || !ownerId) {
        invalidateOwner();
        return;
      }
      const pageReader=(port as ProjectPagePort).listOwnerProjectsPage;
      if (typeof pageReader!=='function') {
        setState({status:'error',message:'Private project pagination is unavailable. Retry after the service is updated.'});
        return;
      }
      const reply=await pageReader.call(port,PAGE_SIZE,null);
      if (!active || epoch!==requestEpoch.current) return;
      const check=await port.getUser();
      if (!active || epoch!==requestEpoch.current) return;
      if (check.error || check.data?.user?.id!==ownerId) {
        invalidateOwner();
      } else if (!reply.data || reply.error) {
        setState({status:'error',message:reply.error?.message??'Your private project page could not be loaded.'});
      } else if (!validProjectPage(reply.data,ownerId,null)) {
        setState({status:'error',message:'The private project page failed validation; no records were displayed.'});
      } else {
        setState({status:'ready',ownerId,items:reply.data.items,nextCursor:reply.data.nextCursor});
      }
    };
    void load().catch(()=>{
      if(active && epoch===requestEpoch.current)
        setState({status:'error',message:'The private project service is unavailable. Retry securely.'});
    });
    return ()=>{active=false;requestEpoch.current++;};
  },[port,reload]);

  useEffect(()=>()=>{
    creationAttempt.current++;
    creationInFlight.current=false;
  },[port]);

  // Same-instance account switches do not necessarily remount the workspace.
  // Verify again on focus and cross-tab session changes; fail closed on mismatch.
  useEffect(()=>{
    if (state.status!=='ready') return;
    let active=true;
    const ownerId=state.ownerId;
    const epoch=requestEpoch.current;
    const verify=async()=>{
      try {
        const result=await port.getUser();
        if (active && epoch===requestEpoch.current &&
            (result.error || result.data?.user?.id!==ownerId)) {
          invalidateOwner();
        }
      } catch {
        if (active && epoch===requestEpoch.current) {
          invalidateOwner();
        }
      }
    };
    const onStorage=(event:StorageEvent)=>{
      if(event.key===null || event.key==='kadmeion.auth.session.v1') void verify();
    };
    const onVisibility=()=>{if(document.visibilityState==='visible') void verify();};
    window.addEventListener('focus',verify);
    window.addEventListener('storage',onStorage);
    document.addEventListener('visibilitychange',onVisibility);
    return ()=>{
      active=false;
      window.removeEventListener('focus',verify);
      window.removeEventListener('storage',onStorage);
      document.removeEventListener('visibilitychange',onVisibility);
    };
  },[port,state.status,state.status==='ready'?state.ownerId:null]);

  async function loadMore() {
    if(state.status!=='ready' || !state.nextCursor || pageInFlight.current) return;
    const {ownerId,nextCursor}=state;
    const epoch=requestEpoch.current;
    const pageReader=(port as ProjectPagePort).listOwnerProjectsPage;
    if(typeof pageReader!=='function') {
      setPageError('Private project pagination is unavailable. Retry later.');
      return;
    }
    pageInFlight.current=true;
    setLoadingMore(true);
    setPageError('');
    const rejectStaleOwner=()=>{
      if(epoch===requestEpoch.current) invalidateOwner();
    };
    try {
      const startIdentity=await port.getUser();
      if(epoch!==requestEpoch.current)return;
      if(startIdentity.error || startIdentity.data?.user?.id!==ownerId) {
        rejectStaleOwner();return;
      }
      const reply=await pageReader.call(port,PAGE_SIZE,nextCursor);
      if(epoch!==requestEpoch.current)return;
      const currentIdentity=await port.getUser();
      if(epoch!==requestEpoch.current)return;
      if(currentIdentity.error || currentIdentity.data?.user?.id!==ownerId) {
        rejectStaleOwner();return;
      }
      if(reply.error || !reply.data) {
        setPageError(reply.error?.message??'More private projects could not be loaded. Your earlier pages remain visible.');
        return;
      }
      if(!validProjectPage(reply.data,ownerId,nextCursor)) {
        setPageError('The next page failed validation. Previously loaded projects were kept.');
        return;
      }
      setState(old=>{
        if(old.status!=='ready' || old.ownerId!==ownerId ||
           old.nextCursor?.id!==nextCursor.id ||
           old.nextCursor?.updatedAt!==nextCursor.updatedAt) return old;
        const seen=new Set(old.items.map(project=>project.id));
        const added=reply.data!.items.filter(project=>{
          if(seen.has(project.id))return false;
          seen.add(project.id);return true;
        });
        return {...old,items:[...old.items,...added],nextCursor:reply.data!.nextCursor};
      });
    } catch {
      if(epoch===requestEpoch.current)
        setPageError('More private projects could not be loaded. Your earlier pages remain visible.');
    } finally {
      if(epoch===requestEpoch.current) {
        pageInFlight.current=false;
        setLoadingMore(false);
      }
    }
  }
  const filtered=useMemo(()=>{
    if(state.status!=='ready')return [];
    const term=search.trim().toLocaleLowerCase('en');
    const matches=state.items.filter(item=>{
      const repository=!!safeProjectLink(item.repositoryUrl), live=!!safeProjectLink(item.liveUrl);
      const typeMatches=linkFilter==='all' || (linkFilter==='repository' && repository) ||
        (linkFilter==='live' && live) || (linkFilter==='both' && repository && live) ||
        (linkFilter==='none' && !repository && !live);
      const hasDescription=!!item.description.trim();
      const detailMatches=detailFilter==='all'||(detailFilter==='described'?hasDescription:!hasDescription);
      const text=[item.title,item.slug,item.summary,item.description,item.repositoryUrl??'',item.liveUrl??'']
        .join(' ').normalize('NFKC').toLocaleLowerCase('en');
      return typeMatches && detailMatches && (!term || term.normalize('NFKC').split(/\s+/).every(word=>text.includes(word)));
    });
    // Keep server order for recent: microsecond keyset precision is not representable by Date.
    if(sort==='oldest')return [...matches].reverse();
    if(sort==='name'||sort==='name-desc')return matches.sort((a,b)=>
      (sort==='name'?1:-1)*a.title.localeCompare(b.title,'en') || a.id.localeCompare(b.id));
    return matches;
  },[state,search,sort,linkFilter,detailFilter]);
  const hasFilters=!!search.trim() || linkFilter!=='all'||detailFilter!=='all';
  function clearFilters(){setSearch('');setLinkFilter('all');setDetailFilter('all');setSort('recent');}
  function open(event: MouseEvent<HTMLButtonElement>) {
    if (!modal.current || modal.current.open) return;
    opener.current = event.currentTarget;
    setError('');
    modal.current.showModal();
  }
  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(creationInFlight.current)return;
    creationInFlight.current=true;
    const attempt=++creationAttempt.current;
    const sessionEpoch=port.getOwnerSessionEpoch();
    const submitted={...draft};
    const stillCurrent=()=>attempt===creationAttempt.current;
    setSaving(true);setError('');setNotice('');
    try {
      const identity=await port.getUser();
      if(!stillCurrent())return;
      if(port.getOwnerSessionEpoch()!==sessionEpoch){invalidateOwner();return;}
      const expectedOwner=identity.data?.user?.id;
      if(identity.error || !expectedOwner ||
         (state.status==='ready' && state.ownerId!==expectedOwner)) {
        invalidateOwner();
        return;
      }
      const saved=await port.createPrivateProject(submitted);
      if(!stillCurrent())return;
      if(port.getOwnerSessionEpoch()!==sessionEpoch){invalidateOwner();return;}
      const current=await port.getUser();
      if(!stillCurrent())return;
      if(port.getOwnerSessionEpoch()!==sessionEpoch || current.error || current.data?.user?.id!==expectedOwner) {
        invalidateOwner();
        return;
      }
      if(saved.error||!saved.data) {
        setError(saved.error?.message||'Private project save was not confirmed. Your form is retained.');
        return;
      }
      // Reload the owner-bound first page after a confirmed create. Do not
      // mix an optimistic record with a stale cursor or a previous owner.
      requestEpoch.current++;
      pageInFlight.current=false;
      setState({status:'loading'});
      setPageError('');
      setReload(value=>value+1);
      modal.current?.close();
      setDraft(freshDraft());setCustomSlug(false);
      setNotice('Saved privately in your account. This did not publish or connect a repository.');
    } catch {
      if(stillCurrent()) {
        if(port.getOwnerSessionEpoch()!==sessionEpoch) invalidateOwner();
        else setError('Project creation could not be verified. Your form values are retained.');
      }
    } finally {
      if(stillCurrent()) {
        creationInFlight.current=false;
        setSaving(false);
      }
    }
  }
  return <section className="ws-projects ws-owner-page" aria-labelledby="ws-title">
    <div className="ws-project-head">
      <div className="ws-heading"><p className="ws-kicker">WORKSPACE / PROJECT LIBRARY</p>
        <h1 id="ws-title">Project library.</h1>
        <p>Organize your projects and case studies. New project drafts stay private.</p>
      </div>
      <button type="button" className="ws-primary" ref={topOpener} onClick={open}>Add project <Icon name="arrow" size={16}/></button>
    </div>
    <div className="ws-project-controls">
      <label className="ws-project-search">Search private projects
        <input type="search" placeholder="Search project text and links" value={search}
          disabled={state.status!=='ready'} onChange={event=>setSearch(event.target.value)}/></label>
      <label>Project links
        <select value={linkFilter} disabled={state.status!=='ready'} onChange={event=>{
          const value=event.target.value;
          if(value==='all'||value==='repository'||value==='live'||value==='both'||value==='none')setLinkFilter(value);
        }}>
          <option value="all">All projects</option><option value="repository">Has repository</option>
          <option value="live">Has live website</option><option value="both">Has both links</option>
          <option value="none">No external links</option>
        </select></label>
      <label>Project description
        <select value={detailFilter} disabled={state.status!=='ready'} onChange={event=>{
          const value=event.target.value;if(value==='all'||value==='described'||value==='missing')setDetailFilter(value);
        }}>
          <option value="all">Any description</option><option value="described">Has detailed description</option>
          <option value="missing">Needs detailed description</option>
        </select></label>
      <label>Sort
        <select value={sort} disabled={state.status!=='ready'}
          onChange={event=>{const value=event.target.value;
            if(value==='recent'||value==='oldest'||value==='name'||value==='name-desc')setSort(value);}}>
          <option value="recent">Recently updated</option><option value="oldest">Oldest updated first</option>
          <option value="name">Name A–Z</option><option value="name-desc">Name Z–A</option>
        </select></label>
      <div className="ws-project-view" role="group" aria-label="Project view">
        <button type="button" aria-pressed={view==='gallery'} onClick={()=>setView('gallery')}>Gallery</button>
        <button type="button" aria-pressed={view==='list'} onClick={()=>setView('list')}>List</button>
      </div>
      <button type="button" className="ws-secondary" disabled={state.status!=='ready'}
        onClick={()=>{
          requestEpoch.current++;
          setState({status:'loading'});
          setReload(value=>value+1);
        }}>Refresh projects</button>
    </div>
    {state.status==='ready' && <div className="ws-actions">
      <p>Filters cover loaded private records. Publication status and technology tags are not available in this index.</p>
      {(hasFilters||sort!=='recent')&&<button type="button" className="ws-secondary" onClick={clearFilters}>Clear filters</button>}
    </div>}
    {notice&&<p role="status" className="ws-inline-alert">{notice}</p>}
    {state.status==='loading'?<p role="status" className="ws-project-state">Loading your private projects…</p>:
     state.status==='error'?<div role="alert" className="ws-project-state">
       <p>{state.message}</p><button type="button" className="ws-secondary" onClick={()=>{setState({status:'loading'});setReload(value=>value+1);}}>Retry securely</button></div>:
    <>
      <p className="ws-project-count" role="status">
        Showing {hasFilters ? filtered.length+' matching of ' : ''}{state.items.length} loaded private {state.items.length===1?'project':'projects'}.
        {state.nextCursor
          ? ' More projects are available. Search and sorting apply only to loaded records; link filters also cover loaded records only.'
          : ' All pages currently available were loaded; refresh if your projects changed.'}
      </p>
      {filtered.length===0?<div className="ws-project-empty-layout">
        <div className="ws-project-empty">
          <div className="ws-area-icon"><Icon name="folder" size={22}/></div>
          <h2>{hasFilters?'No matching loaded projects':'Your first project belongs here.'}</h2>
          <p>{hasFilters?'Change filters or load additional private pages to search older projects.':
            'Add a project title and a short description. You can add links later.'}</p>
          {hasFilters?<button type="button" className="ws-secondary" onClick={clearFilters}>{search&&linkFilter==='all'&&detailFilter==='all'?'Clear search':'Reset project filters'}</button>:
            <button type="button" className="ws-primary" onClick={open}>Add first project</button>}
        </div>
        {!hasFilters && <aside className="ws-project-aside" aria-labelledby="ws-project-guide">
          <h2 id="ws-project-guide">Show the work behind your code.</h2>
          <p>Adding a project gives you a private draft for the details you want to share later.</p>
          <ul className="ws-project-guide">
            <li><strong>Link your work.</strong> Add a repository or a live site if you have one.</li>
            <li><strong>Tell the story.</strong> Describe what you built and what you learned.</li>
            <li><strong>Choose what to share.</strong> Publishing requires a separate action.</li>
          </ul>
        </aside>}
      </div>:<ul className={'ws-project-grid'+(view==='list'?' as-list':'')}>
        {filtered.map(item => {
          const repository = safeProjectLink(item.repositoryUrl);
          const liveSite = safeProjectLink(item.liveUrl);
          return <li key={item.id}><article className="ws-project-card">
          <LibraryCover port={port} projectId={item.id} revision={item.revision}/>
          <div className="ws-project-card-body"><h2><a href={'/app/projects/' + item.id}>{item.title}</a></h2>
            <p>{item.summary||'No project summary yet.'}</p>
            <span>Private · Updated {new Date(item.updatedAt).toLocaleDateString()} · Revision {item.revision}</span>
            {(repository || liveSite) && <div className="ws-project-links">
              {repository && <a href={repository} target="_blank" rel="noopener noreferrer">Repository</a>}
              {liveSite && <a href={liveSite} target="_blank" rel="noopener noreferrer">Live site</a>}
            </div>}
          </div>
        </article></li>;
        })}
      </ul>}
      {state.nextCursor && <div className="ws-actions">
        <button type="button" className="ws-secondary"
          disabled={loadingMore} aria-busy={loadingMore}
          onClick={()=>void loadMore()}>
          {loadingMore?'Loading more…':pageError?'Retry loading more projects':'Load more projects'}
        </button>
        {pageError && <p role="alert" className="ws-inline-alert">{pageError}</p>}
      </div>}
    </>}
    <dialog ref={modal} className="ws-project-dialog" aria-labelledby="ws-project-modal-heading"
      onCancel={event => { if (creationInFlight.current) event.preventDefault(); }}
      onClose={() => (opener.current?.isConnected ? opener.current : topOpener.current)?.focus()}>
      <form onSubmit={event=>void save(event)}>
        <div className="ws-project-modal-heading"><div><p className="ws-kicker">QUICK ADD / PRIVATE</p>
          <h2 id="ws-project-modal-heading">Add a project</h2></div>
          <button type="button" aria-label="Close project drawer" className="ws-project-close"
            disabled={saving} onClick={()=>{if(!creationInFlight.current)modal.current?.close();}}>×</button></div>
        <p className="ws-project-privacy"><Icon name="folder" size={16}/> Saved to your private project library.</p>
        <label>Project title<input disabled={saving} required autoComplete="off" maxLength={120} value={draft.title}
          onChange={event=>{if(!creationInFlight.current)setDraft(old=>({...old,title:event.target.value,
            slug:customSlug?old.slug:suggestSlug(event.target.value)}));}}/></label>
        <details className="ws-project-slug"><summary>Edit private URL slug</summary>
        <label>Private URL slug<input disabled={saving} required spellCheck={false} minLength={3} maxLength={64}
          pattern="[a-z0-9]+(-[a-z0-9]+)*" value={draft.slug}
          onInvalid={event => {
            const disclosure = event.currentTarget.closest('details');
            if (disclosure) disclosure.open = true;
          }}
          onChange={event=>{if(creationInFlight.current)return;setCustomSlug(true);setDraft(old=>({...old,slug:event.target.value}));}}/>
          <small>Unique to your account. Lowercase letters, numbers and hyphens.</small></label></details>
        <label>Summary (optional)<textarea disabled={saving} rows={3} maxLength={360} value={draft.summary}
          onChange={event=>{if(!creationInFlight.current)setDraft(old=>({...old,summary:event.target.value}));}}/></label>
        <label>Repository URL (optional)<input disabled={saving} type="url" pattern="https://.+" title="Enter an HTTPS address" maxLength={2048}
          placeholder="https://example.com/repository" value={draft.repositoryUrl||''}
          onChange={event=>{if(!creationInFlight.current)setDraft(old=>({...old,repositoryUrl:event.target.value||null}));}}/></label>
        <label>Live website URL (optional)<input disabled={saving} type="url" pattern="https://.+" title="Enter an HTTPS address" maxLength={2048}
          placeholder="https://example.com/project" value={draft.liveUrl||''}
          onChange={event=>{if(!creationInFlight.current)setDraft(old=>({...old,liveUrl:event.target.value||null}));}}/></label>
        {saving&&<p role="status">Saving your private project…</p>}
        {error&&<p role="alert" className="ws-inline-alert">{error}</p>}
        <div className="ws-project-modal-actions">
          <button type="button" className="ws-secondary" disabled={saving} onClick={()=>{if(!creationInFlight.current)modal.current?.close();}}>Cancel</button>
          <button type="submit" className="ws-primary" disabled={saving}>{saving?'Saving…':'Save project'}</button>
        </div>
      </form>
    </dialog>
  </section>;
}

type DetailState =
  | {status: 'loading'}
  | {status: 'unavailable'}
  | {status: 'ready'; saved: OwnerProject; draft: PrivateProjectDraft};

// Only confirmed contiguous overview-only receipts can advance the sibling
// case-study baseline without replacing the user's independent section buffer.
type RevisionRange = Readonly<{from: number; to: number}>;
const projectConflict=(message:string)=>message.includes('changed while you were editing') ||
  message === 'Private workspace conflict. Reload the latest data before trying again.';

type DestinationChange = {label:string;before:string|null;after:string|null};
type DestinationReview = {changes:DestinationChange[];key:string|null;error:string};
function projectDestinationReview(saved:PrivateProjectDraft&{revision:number},draft:PrivateProjectDraft):DestinationReview{
  // Use the same normalizer as the private project write. Compare actual
  // canonical destinations, not display strings or guesses about a live route.
  const normalize=(value:string|null)=>value==null||value===''?null:normalizeExternalHttpsUrl(value);
  const changes:DestinationChange[]=[];
  for(const [field,label] of [['repositoryUrl','Repository URL'],['liveUrl','Live website URL']] as const){
    let after:string|null;
    try{after=normalize(draft[field]);}
    catch{return {changes:[],key:null,error:label+': enter a valid HTTPS destination or remove the value.'};}
    let before=saved[field];
    try{before=normalize(before);}catch{/* Preserve a historical invalid address for comparison only. */}
    if(before!==after)changes.push({label,before,after});
  }
  return {changes,key:changes.length?JSON.stringify([saved.revision,changes]):null,error:''};
}

export function PrivateProjectDetail({port, projectId}: {port: SupabaseBrowserAuthPort; projectId: string}) {
  const [detail, setDetail] = useState<DetailState>({status: 'loading'});
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{error: boolean; text: string} | null>(null);
  const [latest, setLatest] = useState<OwnerProject | null>(null);
  const [checking, setChecking] = useState(false);
  const [panel, setPanel] = useState<'details' | 'sections'>('details');
  const [openedSections, setOpenedSections] = useState(false);
  const [knownRevision, setKnownRevision] = useState(0);
  const [overviewAdvance, setOverviewAdvance] = useState<RevisionRange|null>(null);
  const [overviewConflict, setOverviewConflict] = useState(false);
  const [reviewedDestinationChange,setReviewedDestinationChange]=useState<string|null>(null);
  const [casePending, setCasePending] = useState(false);
  const [caseDirty, setCaseDirty] = useState(false);
  const [imagePending,setImagePending]=useState(false);
  const imagePendingRef=useRef(false);
  const markImagePending=useCallback((pending:boolean)=>{
    imagePendingRef.current=pending;setImagePending(pending);
  },[]);
  const overviewPending = useRef(false);
  const casePendingRef = useRef(false);
  const observeRevision = useCallback((revision:number) => {
    setKnownRevision(previous=>Math.max(previous,revision));
  },[]);
  const markCasePending = useCallback((pending:boolean) => {
    casePendingRef.current=pending;
    setCasePending(pending);
  },[]);
  const caseSaved = useCallback((from:number,to:number) => {
    observeRevision(to);
    // The case-study RPC modifies only sections at the exact CAS base.
    // A gap might include another owner's session's overview edit.
    setDetail(current=>current.status==='ready' && current.saved.revision===from && to===from+1
      ? {...current,saved:{...current.saved,revision:to}} : current);
  },[observeRevision]);
  const thumbnailSaved=useCallback((from:number,to:number)=>{
    if(to!==from+1)return;
    observeRevision(to);
    // An attached cover changes neither overview text nor case-study sections.
    // Advance only across this exact acknowledged contiguous mutation.
    setDetail(current=>current.status==='ready'&&current.saved.revision===from
      ? {...current,saved:{...current.saved,revision:to}}:current);
    setOverviewAdvance(old=>old&&old.to===from?{from:old.from,to}:{from,to});
  },[observeRevision]);
  const canStartImage=useCallback(()=>!overviewPending.current&&!casePendingRef.current&&!imagePendingRef.current,[]);

  useEffect(() => {
    let active = true;
    void port.readOwnerProject(projectId).then(result => {
      if (!active) return;
      if (result.data && !result.error) {
        observeRevision(result.data.revision);
        setDetail({status:'ready',saved:result.data,draft:result.data});
      } else setDetail({status:'unavailable'});
    }).catch(() => {if (active) setDetail({status:'unavailable'});});
    return () => { active = false; };
  }, [port, projectId, reload, observeRevision]);

  function edit(field: keyof PrivateProjectDraft, value: string) {
    if (overviewPending.current || casePendingRef.current || imagePendingRef.current) return;
    if(field==='repositoryUrl'||field==='liveUrl')setReviewedDestinationChange(null);
    setDetail(current => current.status === 'ready'
      ? {...current, draft: {...current.draft, [field]: value}}
      : current);
  }

  async function compareLatest(baseRevision: number) {
    if (overviewPending.current || casePendingRef.current || imagePendingRef.current) return;
    overviewPending.current=true;
    setReviewedDestinationChange(null);
    setChecking(true);
    setFeedback(null);
    setLatest(null);
    try {
      const {data,error} = await port.readOwnerProject(projectId);
      if (!data || error || data.revision < Math.max(baseRevision,knownRevision)) {
        setFeedback({error:true,text:'Could not verify the latest revision. Your edits are still here.'});
        return;
      }
      observeRevision(data.revision);
      setLatest(data.revision !== baseRevision ? data : null);
      if (data.revision === baseRevision) {
        setOverviewConflict(false);
        setFeedback({error:false,text:'You have the latest saved revision.'});
      } else setOverviewConflict(true);
    } catch {
      setFeedback({error:true,text:'Latest revision check failed. Your private draft is preserved.'});
    } finally {
      overviewPending.current=false;
      setChecking(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (detail.status !== 'ready' || overviewPending.current || casePendingRef.current || imagePendingRef.current ||
        overviewConflict || knownRevision>detail.saved.revision || latest) return;
    let submitted:PrivateProjectDraft;
    try{submitted=normalizeProjectDraft(detail.draft);}
    catch(cause){setFeedback({error:true,text:cause instanceof Error?cause.message:'Enter valid private project details.'});return;}
    const review=projectDestinationReview(detail.saved,submitted);
    if(review.error||(review.key!==null&&review.key!==reviewedDestinationChange)){
      setFeedback({error:true,text:review.error||'Review and confirm the changed external destinations before saving.'});return;
    }
    overviewPending.current=true;
    setSaving(true);
    setFeedback(null);
    const from=detail.saved.revision;
    try {
      const result = await port.saveOwnerProject(projectId, from, submitted);
      if (!result.data || result.error || result.data.revision!==from+1) {
        const message=result.error?.message ?? 'Save could not be confirmed.';
        if (projectConflict(message)) {setOverviewConflict(true);setReviewedDestinationChange(null);}
        setFeedback({error:true,text:message});
        return;
      }
      const to=result.data.revision;
      observeRevision(to);
      setOverviewAdvance(old=>old && old.to===from ? {from:old.from,to} : {from,to});
      setDetail({status:'ready',saved:result.data,draft:result.data});
      setReviewedDestinationChange(null);
      setFeedback({error:false,text:'Private draft saved.'});
    } catch {
      setFeedback({error:true,text:'Project save could not be verified. Your edits remain available.'});
    } finally {
      overviewPending.current=false;
      setSaving(false);
    }
  }

  const dirty = detail.status === 'ready' && (
    detail.saved.title !== detail.draft.title ||
    detail.saved.summary !== detail.draft.summary ||
    detail.saved.description !== detail.draft.description ||
    (detail.saved.repositoryUrl ?? '') !== (detail.draft.repositoryUrl ?? '') ||
    (detail.saved.liveUrl ?? '') !== (detail.draft.liveUrl ?? '')
  );
  const blocked=saving || checking || casePending || imagePending;
  const destinationReview=detail.status==='ready'?projectDestinationReview(detail.saved,detail.draft):null;
  const destinationUnconfirmed=!!destinationReview&&(!!destinationReview.error||
    (destinationReview.key!==null&&destinationReview.key!==reviewedDestinationChange));
  const stale=detail.status==='ready' && (overviewConflict || knownRevision>detail.saved.revision);
  const repository = detail.status === 'ready' ? safeProjectLink(detail.saved.repositoryUrl) : undefined;
  const liveSite = detail.status === 'ready' ? safeProjectLink(detail.saved.liveUrl) : undefined;

  return <section aria-labelledby="project-detail-title" className="ws-owner-page">
    <div className="ws-heading">
      <a href="/app/projects">Back to project library</a>
      <h1 id="project-detail-title">Build the case study.</h1>
      <p>Update your private project details.</p>
    </div>
    {detail.status === 'ready' && <div className="ws-profile-tabs" role="group" aria-label="Project sections">
      <button type="button" disabled={blocked} aria-pressed={panel === 'details'} onClick={() => {
        if (!overviewPending.current && !casePendingRef.current && !imagePendingRef.current) setPanel('details');
      }}>Overview</button>
      <button type="button" disabled={blocked} aria-pressed={panel === 'sections'} onClick={() => {
        if (overviewPending.current || casePendingRef.current || imagePendingRef.current) return;
        if (!openedSections) markCasePending(true);
        setOpenedSections(true); setPanel('sections');
      }}>Case study</button>
    </div>}
    {detail.status === 'loading' && <p role="status">Loading project…</p>}
    {detail.status === 'unavailable' && <div className="ws-project-state" role="alert">
      <p>Project unavailable. Check your connection and session before trying again.</p>
      <button type="button" className="ws-secondary" onClick={() => {
        setFeedback(null); setLatest(null); setDetail({status: 'loading'});
        setReload(current => current + 1);
      }}>Retry loading project</button>
    </div>}
    {detail.status === 'ready' && openedSections && <div hidden={panel !== 'sections'}><CaseStudyEditor port={port} projectId={projectId}
      overviewAdvance={overviewAdvance} knownRevision={knownRevision} onObserved={observeRevision}
      onSaved={caseSaved} onPending={markCasePending} onDirty={setCaseDirty}/></div>}
    {detail.status === 'ready' && panel === 'details' && <div className="ws-project-detail ws-owner-columns">
      <form className="ws-project-fields" onSubmit={event => void save(event)}>
        <fieldset disabled={blocked}>
          <legend>Project details</legend>
          <label>Project title
            <input maxLength={120} required value={detail.draft.title} onChange={e => edit('title', e.target.value)}/>
          </label>
          <label>Short description
            <textarea rows={2} maxLength={360} value={detail.draft.summary} onChange={e => edit('summary', e.target.value)}/>
          </label>
          <label>Project description
            <textarea rows={6} maxLength={12000} value={detail.draft.description} onChange={e => edit('description', e.target.value)}/>
          </label>
          <div className="ws-project-detail-links">
          <label>Repository URL (optional)
            <input type="url" pattern="https://.+" title="Enter an HTTPS address" maxLength={2048} value={detail.draft.repositoryUrl ?? ''} onChange={e => edit('repositoryUrl', e.target.value)}/>
          </label>
          <label>Live website URL (optional)
            <input type="url" pattern="https://.+" title="Enter an HTTPS address" maxLength={2048} value={detail.draft.liveUrl ?? ''} onChange={e => edit('liveUrl', e.target.value)}/>
          </label>
          </div>
        </fieldset>
        {destinationReview?.error&&<p role="alert" className="ws-inline-alert">{destinationReview.error}</p>}
        {destinationReview?.key&&<fieldset disabled={blocked||stale||!!latest}>
          <legend>Review changed external destinations</legend>
          <p>Review the saved and proposed addresses. These are self-supplied links; saving this private draft does not publish or verify them.</p>
          <dl>{destinationReview.changes.map(change=><div key={change.label}>
            <dt>{change.label}</dt>
            <dd>Saved: {change.before??'Not set'}</dd>
            <dd>Proposed: {change.after??'Remove destination'}</dd>
          </div>)}</dl>
          <label className="ws-profile-check"><input type="checkbox"
            checked={destinationReview.key===reviewedDestinationChange}
            onChange={event=>{
              if(overviewPending.current||casePendingRef.current||imagePendingRef.current)return;
              setReviewedDestinationChange(event.target.checked?destinationReview.key:null);
            }}/> I confirm these destination changes for this private revision.</label>
        </fieldset>}
        {feedback && <p role={feedback.error ? 'alert' : 'status'} className="ws-inline-alert">{feedback.text}</p>}
        {stale && <p>Check the latest saved revision before saving overview changes. Your edits are retained.</p>}
        <div className="ws-actions">
          <button type="submit" className="ws-primary" disabled={blocked || stale || !!latest || !dirty || destinationUnconfirmed}>{saving ? 'Saving…' : 'Save changes'}</button>
          <button type="button" className="ws-secondary" disabled={blocked}
            onClick={() => void compareLatest(detail.saved.revision)}>{checking ? 'Checking…' : 'Check latest revision'}</button>
          {dirty && <button type="button" className="ws-secondary" disabled={blocked}
            onClick={() => {
              if (overviewPending.current || casePendingRef.current || imagePendingRef.current) return;
              setDetail({status:'ready',saved:detail.saved,draft:detail.saved});
              setReviewedDestinationChange(null);
              if (!stale) setLatest(null);
              setFeedback({error:false,text:'Unsaved changes discarded; your saved revision is unchanged.'});
            }}>Discard changes</button>}
        </div>
      </form>
      <aside className="ws-project-aside" aria-label="Saved project preview">
        <h2 className="ws-owner-aside-title">Saved project</h2>
        <div className="ws-profile-card">
          <span className="ws-preview-identity"><Icon name="folder" size={22}/></span>
          <p className="ws-kicker">SAVED DRAFT · REVISION {detail.saved.revision}</p>
          <h3>{detail.saved.title}</h3>
          {detail.saved.summary && <p>{detail.saved.summary}</p>}
        </div>
        {(repository || liveSite) && <div className="ws-project-links">
          {repository && <a href={repository} target="_blank" rel="noopener noreferrer">Repository</a>}
          {liveSite && <a href={liveSite} target="_blank" rel="noopener noreferrer">Live website</a>}
        </div>}
        <MoveToTrash port={port} kind="project" id={projectId} title={detail.saved.title}
          disabled={dirty || caseDirty || imagePending || blocked || stale} onMoved={()=>window.location.assign('/app/trash')}/>
        {caseDirty && <p>Save or discard unsaved case-study sections before moving this project to Trash.</p>}
        {latest && <div className="ws-project-conflict">
          <h3>Saved revision {latest.revision} is newer</h3>
          {latest.revision<knownRevision && <p>A later revision is already known. Check the latest revision again before loading this draft.</p>}
          <dl>
            <dt>Title</dt><dd>{latest.title}</dd>
            <dt>Short description</dt><dd>{latest.summary || '—'}</dd>
            <dt>Project description</dt><dd>{latest.description || '—'}</dd>
            <dt>Repository URL</dt><dd>{latest.repositoryUrl || '—'}</dd>
            <dt>Live website URL</dt><dd>{latest.liveUrl || '—'}</dd>
          </dl>
          <button type="button" className="ws-secondary" disabled={blocked || latest.revision < knownRevision} onClick={() => {
            if (overviewPending.current || casePendingRef.current || imagePendingRef.current || latest.revision<knownRevision) return;
            setDetail({status:'ready',saved:latest,draft:latest});
            setReviewedDestinationChange(null);
            setOverviewConflict(false);
            setLatest(null);
            setFeedback({error: false, text: 'Loaded the latest saved draft.'});
          }}>Discard my edits and load saved draft</button>
        </div>}
      </aside>
    </div>}
    {detail.status==='ready' && <div hidden={panel!=='details'}>
      {thumbnailApi(port)?<AttachedProjectThumbnail port={port} projectId={projectId}
        knownRevision={knownRevision} otherPending={saving||checking||casePending}
        canStart={canStartImage} onPending={markImagePending} onObserved={observeRevision} onSaved={thumbnailSaved}/>
        :<PrivateProjectImages port={port} projectId={projectId} onPending={markImagePending}/>}

    </div>}
  </section>;
}

type RegisteredProjectImage={id:string;projectId:string;mime:string;size:number;altText:string};
const imageTypes=['image/png','image/jpeg','image/webp'];
// Exact structural subset of S1 PR #28 at a2e0382. Only usable when that
// implementation is installed. Do not import foreign code or invent a route.
type ThumbnailAsset=Readonly<{id:string;projectId:string;mime:'image/png'|'image/jpeg'|'image/webp';size:number;altText:string;createdAt:string}>;
type ThumbnailSelection=Readonly<{projectId:string;revision:number;asset:ThumbnailAsset|null;publicDeliveryAllowed:false}>;
type ThumbnailApi={
  readOwnerProjectThumbnail(projectId:string,expectedEpoch:number):Promise<AuthOutcome<ThumbnailSelection>>;
  setOwnerProjectThumbnail(projectId:string,baseRevision:number,assetId:string|null,operationId:string,expectedEpoch:number):Promise<AuthOutcome<ThumbnailSelection>>;
  readOwnerProjectThumbnailImage(projectId:string,assetId:string,expectedEpoch:number):Promise<AuthOutcome<Blob>>;
  uploadOwnerProjectImage(projectId:string,file:File,altText:string,context:{operationId:string;expectedEpoch:number}):
    ReturnType<SupabaseBrowserAuthPort['uploadOwnerProjectImage']>;
};
function thumbnailApi(port:SupabaseBrowserAuthPort):ThumbnailApi|null{
  const candidate=port as unknown as Partial<ThumbnailApi>;
  return typeof candidate.readOwnerProjectThumbnail==='function'&&typeof candidate.setOwnerProjectThumbnail==='function'&&
    typeof candidate.readOwnerProjectThumbnailImage==='function'&&typeof candidate.uploadOwnerProjectImage==='function'
    ?candidate as ThumbnailApi:null;
}
function verifiedSelection(value:ThumbnailSelection|null|undefined,projectId:string):value is ThumbnailSelection{
  return !!value&&value.projectId===projectId&&value.publicDeliveryAllowed===false&&
    Number.isSafeInteger(value.revision)&&value.revision>=0&&
    (value.asset===null||(value.asset.projectId===projectId&&imageTypes.includes(value.asset.mime)&&
      Number.isSafeInteger(value.asset.size)&&value.asset.size>0&&value.asset.size<=5242880&&
      typeof value.asset.id==='string'&&typeof value.asset.altText==='string'&&!!value.asset.altText.trim()));
}
type PreviewBytes={url:string;assetId:string;alt:string};
function verifiedBlob(blob:Blob|null|undefined,asset:ThumbnailAsset):blob is Blob{
  return blob instanceof Blob&&blob.type===asset.mime&&blob.size===asset.size;
}
// Shared bounded scheduling for visible owner library cards. No persistent
// image cache or URL survives a card leaving the viewport.
const libraryCoverJobs:Array<()=>Promise<void>>=[];
let libraryCoverActive=0;
function enqueueLibraryCover(job:()=>Promise<void>){
  libraryCoverJobs.push(job);
  pumpLibraryCovers();
}
function pumpLibraryCovers(){
  while(libraryCoverActive<2&&libraryCoverJobs.length){
    const job=libraryCoverJobs.shift()!;
    libraryCoverActive++;
    void job().catch(()=>{}).finally(()=>{libraryCoverActive--;pumpLibraryCovers();});
  }
}
function LibraryCover({port,projectId,revision}:{port:SupabaseBrowserAuthPort;projectId:string;revision:number}){
  const element=useRef<HTMLDivElement>(null);
  const [visible,setVisible]=useState(false);
  const [preview,setPreview]=useState<PreviewBytes|null>(null);
  const [failed,setFailed]=useState(false);
  const epoch=port.getOwnerSessionEpoch();
  useEffect(()=>{
    if(!thumbnailApi(port)||!element.current)return;
    if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)));
    observer.observe(element.current);
    return ()=>observer.disconnect();
  },[port,projectId]);
  useEffect(()=>{
    setPreview(null);setFailed(false);
    const api=thumbnailApi(port);
    if(!visible||!api)return;
    let active=true,url:string|undefined;
    const current=()=>active&&port.getOwnerSessionEpoch()===epoch;
    enqueueLibraryCover(async()=>{
      if(!current())return;
      try{
        const selection=await api.readOwnerProjectThumbnail(projectId,epoch);
        if(!current())return;
        if(selection.error||!verifiedSelection(selection.data,projectId)||selection.data.revision<revision){setFailed(true);return;}
        const asset=selection.data.asset;if(!asset)return;
        const result=await api.readOwnerProjectThumbnailImage(projectId,asset.id,epoch);
        if(!current())return;
        if(result.error||!verifiedBlob(result.data,asset)){setFailed(true);return;}
        url=URL.createObjectURL(result.data);
        setPreview({url,assetId:asset.id,alt:asset.altText});
      }catch{if(current())setFailed(true);}
    });
    return ()=>{active=false;if(url)URL.revokeObjectURL(url);};
  },[port,projectId,revision,visible,epoch]);
  return <div className="ws-project-mark" ref={element}>
    {preview&&!failed&&visible?<img src={preview.url} alt={preview.alt}
      style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'inherit'}} onError={()=>setFailed(true)}/>
      :<span aria-hidden="true"><Icon name="folder" size={21}/></span>}
  </div>;
}

type CoverOperation={base:number;uploadId:string;attachId:string;file:File|null;alt:string;assetId?:string|null};
function AttachedProjectThumbnail({port,projectId,knownRevision,otherPending,canStart,onPending,onObserved,onSaved}:{
  port:SupabaseBrowserAuthPort;projectId:string;knownRevision:number;otherPending:boolean;
  canStart:()=>boolean;onPending:(value:boolean)=>void;onObserved:(revision:number)=>void;onSaved:(from:number,to:number)=>void;
}){
  const [selection,setSelection]=useState<ThumbnailSelection|null>(null);
  const [selectionVerified,setSelectionVerified]=useState(false);
  const [preview,setPreview]=useState<PreviewBytes|null>(null);
  const [file,setFile]=useState<File|null>(null);
  const [alt,setAlt]=useState('');
  const [pendingOp,setPendingOp]=useState<CoverOperation|null>(null);
  const [busy,setBusy]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [confirmDetach,setConfirmDetach]=useState(false);
  const attempt=useRef(0),flight=useRef(false),epoch=useRef(port.getOwnerSessionEpoch());
  const currentUrl=useRef<string|null>(null),input=useRef<HTMLInputElement>(null);
  const current=(id:number)=>id===attempt.current&&port.getOwnerSessionEpoch()===epoch.current;
  function clearPreview(){
    if(currentUrl.current)URL.revokeObjectURL(currentUrl.current);
    currentUrl.current=null;setPreview(null);
  }
  function clearInputs(){
    setFile(null);setAlt('');setPendingOp(null);setConfirmDetach(false);
    if(input.current)input.current.value='';
  }
  function clearPrivate(){clearPreview();setSelection(null);setSelectionVerified(false);clearInputs();setNotice('');}
  function denied(message:string|undefined){return !!message&&/access was denied|owner session changed|session or project is unavailable/i.test(message);}
  async function renderSelection(api:ThumbnailApi,value:ThumbnailSelection,id:number){
    if(!current(id))return;
    if(!value.asset){clearPreview();return;}
    const asset=value.asset;
    const bytes=await api.readOwnerProjectThumbnailImage(projectId,asset.id,epoch.current);
    if(!current(id))return;
    if(bytes.error||!verifiedBlob(bytes.data,asset)){
      if(denied(bytes.error?.message)){clearPreview();setSelectionVerified(false);}
      setError('The saved cover was read, but its private image bytes could not be verified. Retry the preview.');return;
    }
    const url=URL.createObjectURL(bytes.data);
    // Decode before replacing the previous verified preview.
    try{
      const image=new Image();image.src=url;await image.decode();
      if(!current(id)){URL.revokeObjectURL(url);return;}
      if(currentUrl.current)URL.revokeObjectURL(currentUrl.current);
      currentUrl.current=url;setPreview({url,assetId:asset.id,alt:asset.altText});
    }catch{
      URL.revokeObjectURL(url);
      if(current(id))setError('The saved private image could not be decoded. Retry the preview.');
    }
  }
  async function refresh(initial=false){
    if(flight.current||(!initial&&!canStart()))return;
    const api=thumbnailApi(port);if(!api)return;
    flight.current=true;onPending(true);setBusy(true);setError('');setNotice('');setSelectionVerified(false);
    const id=++attempt.current;
    try{
      if(!current(id))return;
      const result=await api.readOwnerProjectThumbnail(projectId,epoch.current);
      if(!current(id))return;
      if(result.error||!verifiedSelection(result.data,projectId)||result.data.revision<knownRevision){
        if(denied(result.error?.message)){clearPreview();setSelection(null);setError('Private cover access was denied. No current preview is displayed.');}
        else setError('Current cover could not be verified. The previous preview and input were retained.');
        return;
      }
      setSelection(result.data);setSelectionVerified(true);onObserved(result.data.revision);
      await renderSelection(api,result.data,id);
    }catch{if(current(id))setError('Private cover read failed. Retry without uploading again.');}
    finally{if(id===attempt.current){flight.current=false;setBusy(false);onPending(false);
      if(!current(id)){clearPrivate();setError('Your owner session changed. Reopen this project.');}}}
  }
  useEffect(()=>{
    epoch.current=port.getOwnerSessionEpoch();
    void refresh(true);
    return ()=>{attempt.current++;flight.current=false;onPending(false);
      if(currentUrl.current)URL.revokeObjectURL(currentUrl.current);currentUrl.current=null;};
  },[port,projectId]);
  async function change(detach=false,reapply=false){
    if(flight.current||!canStart())return;
    const api=thumbnailApi(port);if(!api||!selection)return;
    if(epoch.current!==port.getOwnerSessionEpoch()){clearPrivate();setError('Your owner session changed. Reopen this project.');return;}
    if(!pendingOp&&(!selectionVerified||selection.revision<knownRevision)){setError('Refresh the current cover before changing it.');return;}
    if(!pendingOp&&!detach&&(!file||!imageTypes.includes(file.type)||file.size<12||file.size>5242880||!alt.trim()||alt.length>500)){
      setError('Choose a PNG, JPEG or WebP image up to 5 MB and enter descriptive alt text.');return;
    }
    if(!pendingOp&&detach&&(!selection.asset||!confirmDetach))return;
    if(reapply&&(!pendingOp||typeof pendingOp.assetId!=='string'||!selectionVerified||
      selection.revision<=pendingOp.base||selection.revision<knownRevision||selection.asset?.id===pendingOp.assetId))return;
    const op:CoverOperation=reapply&&pendingOp
      ?{...pendingOp,base:selection.revision,attachId:crypto.randomUUID()}
      :pendingOp??{base:selection.revision,uploadId:crypto.randomUUID(),attachId:crypto.randomUUID(),
        file:detach?null:file,alt:alt.trim(),...(detach?{assetId:null}: {})};
    setPendingOp(op);flight.current=true;onPending(true);setBusy(true);setError('');setNotice('');setSelectionVerified(false);
    const id=++attempt.current;
    try{
      if(!current(id))return;
      let assetId=op.assetId;
      if(assetId===undefined&&op.file){
        const registered=await api.uploadOwnerProjectImage(projectId,op.file,op.alt,{operationId:op.uploadId,expectedEpoch:epoch.current});
        if(!current(id))return;
        const value=registered.data;
        if(registered.error||!value||value.projectId!==projectId||value.mime!==op.file.type||
           value.size!==op.file.size||value.altText!==op.alt||value.publicDeliveryAllowed!==false||value.verifiedMetadata!==true){
          if(denied(registered.error?.message)){clearPreview();setSelection(null);}
          setError('Private image registration could not be confirmed. Retry the same upload operation.');return;
        }
        assetId=value.id;setPendingOp({...op,assetId});
      }
      if(assetId===undefined)return;
      // Same base, asset and UUID on ambiguous result; never invent a newer CAS.
      const result=await api.setOwnerProjectThumbnail(projectId,op.base,assetId,op.attachId,epoch.current);
      if(!current(id))return;
      if(result.error||!verifiedSelection(result.data,projectId)||result.data.revision!==op.base+1||
         (result.data.asset?.id??null)!==assetId){
        if(denied(result.error?.message)){clearPreview();setSelection(null);setError('Private cover access was denied. Refresh before another attempt.');}
        else setError('Cover change was not confirmed. The last verified preview remains. Retry the same change, or refresh the current revision.');
        return;
      }
      setSelection(result.data);setSelectionVerified(true);onSaved(op.base,result.data.revision);clearInputs();
      setNotice(assetId?'Private cover selection saved. Checking its image bytes.':'Private cover removed. Folder cover restored.');
      await renderSelection(api,result.data,id);
      if(current(id)&&assetId)setNotice('Private cover selection saved. No public image was created.');
    }catch{if(current(id))setError('Private cover change could not be verified. Retry the same operation; the previous preview remains.');}
    finally{if(id===attempt.current){flight.current=false;setBusy(false);onPending(false);
      if(!current(id)){clearPrivate();setError('Your owner session changed. Reopen this project.');}}}
  }
  const currentPreview=selectionVerified&&!!preview&&preview.assetId===selection?.asset?.id;
  const refreshedPending=!!pendingOp&&selectionVerified&&!!selection&&selection.revision>=knownRevision&&selection.revision>pendingOp.base;
  const desiredAlreadySaved=refreshedPending&&pendingOp!.assetId!==undefined&&
    (selection!.asset?.id??null)===pendingOp!.assetId;
  return <section className="ws-project-fields" aria-labelledby="attached-cover-title">
    <h2 id="attached-cover-title">Project thumbnail</h2>
    <div className="ws-profile-card">
      {preview?<><img src={preview.url} alt={preview.alt} style={{display:'block',width:'100%',maxHeight:320,objectFit:'contain'}}
        onError={()=>{clearPreview();setError('The private image could not be displayed. Retry the preview.');}}/>
        <p>{currentPreview?'Last verified private cover':'Previous verified cover – current selection or bytes are unconfirmed'}</p></>
        :<><span className="ws-preview-identity" aria-hidden="true"><Icon name="folder" size={22}/></span><strong>Folder cover</strong></>}
      {selection?.asset&&<p>Saved image description: {selection.asset.altText}</p>}
      <p>Manual private image only. Website capture and public delivery are unavailable.</p>
    </div>
    <div aria-live="polite">{busy&&<p>Checking or saving the private cover…</p>}{notice&&<p>{notice}</p>}</div>
    {error&&<p role="alert" className="ws-inline-alert">{error}</p>}
    <fieldset disabled={busy||otherPending||!!pendingOp}>
      <legend>Choose a new private cover</legend>
      <label>Image file (PNG, JPEG, WebP; up to 5 MB)<input ref={input} type="file" accept="image/png,image/jpeg,image/webp"
        onChange={event=>{if(!flight.current){setFile(event.target.files?.[0]??null);setError('');setNotice('');}}}/></label>
      <label>Image alt text<textarea value={alt} rows={2} maxLength={500}
        onChange={event=>{if(!flight.current)setAlt(event.target.value);}}/></label>
      <button type="button" className="ws-primary" disabled={!selection||!selectionVerified||selection.revision<knownRevision||!file||!alt.trim()}
        onClick={()=>void change()}>{selection?.asset?'Replace thumbnail':'Upload and attach thumbnail'}</button>
      {selection?.asset&&<><label className="ws-profile-check"><input type="checkbox" checked={confirmDetach}
        onChange={event=>setConfirmDetach(event.target.checked)}/> Confirm remove saved cover</label>
        <button type="button" className="ws-secondary" disabled={!confirmDetach||!selectionVerified||selection.revision<knownRevision}
          onClick={()=>void change(true)}>Remove thumbnail</button></>}
    </fieldset>
    {selection&&selection.revision<knownRevision&&<p>Another revision is known. Refresh the current cover before a new change.</p>}
    {pendingOp&&<div className="ws-actions">
      <button type="button" className="ws-secondary" disabled={busy||otherPending||!selection} onClick={()=>void change()}>Retry same cover operation</button>
      {desiredAlreadySaved&&<button type="button" className="ws-secondary" disabled={busy||otherPending}
        onClick={()=>{if(canStart()&&!flight.current){clearInputs();setNotice('The requested cover is confirmed in the latest saved selection. No additional write was made.');}}}>Accept current saved cover</button>}
      {refreshedPending&&!desiredAlreadySaved&&typeof pendingOp.assetId==='string'&&<>
        <p>Another revision is saved. Attach the already registered image to the verified latest revision only if you want to replace its cover.</p>
        <button type="button" className="ws-secondary" disabled={busy||otherPending}
          onClick={()=>void change(false,true)}>Attach registered image to latest revision</button>
      </>}
      <button type="button" className="ws-secondary" disabled={busy||otherPending} onClick={()=>{
        if(!canStart()||flight.current)return;
        // Discard only the local operation; no server deletion or rollback.
        clearInputs();setSelection(null);void refresh();
      }}>Discard pending operation and refresh cover</button>
    </div>}
    <button type="button" className="ws-secondary" disabled={busy||otherPending} onClick={()=>void refresh()}>Refresh private cover</button>
  </section>;
}
/** WF-013: real private registered assets, not an inferred cover attachment.
 * A distinct project-cover pointer/read contract is required to display saved bytes.
 */
function PrivateProjectImages({port,projectId,onPending}:{
  port:SupabaseBrowserAuthPort;projectId:string;onPending:(pending:boolean)=>void;
}){
  const [file,setFile]=useState<File|null>(null);
  const [alt,setAlt]=useState('');
  const [records,setRecords]=useState<RegisteredProjectImage[]|null>(null);
  const [receipt,setReceipt]=useState<RegisteredProjectImage|null>(null);
  const [busy,setBusy]=useState(false);
  const [reading,setReading]=useState(true);
  const [error,setError]=useState('');
  const [listError,setListError]=useState('');
  const [notice,setNotice]=useState('');
  const [ambiguous,setAmbiguous]=useState(false);
  const [confirmRetry,setConfirmRetry]=useState(false);
  const input=useRef<HTMLInputElement>(null);
  const pending=useRef(true);
  const generation=useRef(0);
  const liveEpoch=useRef(port.getOwnerSessionEpoch());
  const current=(attempt:number)=>attempt===generation.current && liveEpoch.current===port.getOwnerSessionEpoch();
  const clearPrivate=()=>{
    setRecords(null);setReceipt(null);setFile(null);setAlt('');setNotice('');setAmbiguous(false);setConfirmRetry(false);
    if(input.current)input.current.value='';
  };
  async function readImages(attempt:number){
    const result=await port.listOwnerAssets();
    if(!current(attempt))return;
    if(result.error||!result.data){
      setListError('Registered private images could not be checked. Retry the list; no cover change was assumed.');
      return;
    }
    setRecords(result.data.filter(row=>row.projectId===projectId));
    setListError('');
  }
  useEffect(()=>{
    const attempt=++generation.current;
    liveEpoch.current=port.getOwnerSessionEpoch();
    pending.current=true;
    setReading(true);
    void readImages(attempt).catch(()=>{
      if(current(attempt))setListError('Private image records are unavailable. Retry the list.');
    }).finally(()=>{if(attempt===generation.current){pending.current=false;setReading(false);if(!current(attempt))clearPrivate();}});
    return ()=>{generation.current++;pending.current=false;};
  },[port,projectId]);
  async function refresh(){
    if(pending.current||reading)return;
    if(liveEpoch.current!==port.getOwnerSessionEpoch()){clearPrivate();setError('Your owner session changed. Reopen the project.');return;}
    pending.current=true;setReading(true);setListError('');
    const attempt=++generation.current;
    try{await readImages(attempt);}
    catch{if(current(attempt))setListError('Private image records are unavailable. Retry the list.');}
    finally{if(attempt===generation.current){pending.current=false;setReading(false);if(!current(attempt))clearPrivate();}}
  }
  async function upload(){
    if(pending.current||reading||!file||(ambiguous&&!confirmRetry))return;
    if(liveEpoch.current!==port.getOwnerSessionEpoch()){clearPrivate();setError('Your owner session changed. Reopen the project.');return;}
    if(!imageTypes.includes(file.type)||file.size<12||file.size>5242880||!alt.trim()||alt.length>500){
      setError('Choose a PNG, JPEG or WebP image up to 5 MB and enter descriptive alt text.');return;
    }
    pending.current=true;setBusy(true);onPending(true);setError('');setNotice('');setConfirmRetry(false);
    const attempt=++generation.current, submitted=file, description=alt.trim();
    try{
      const result=await port.uploadOwnerProjectImage(projectId,submitted,description);
      if(!current(attempt))return;
      const row=result.data;
      if(result.error||!row||row.projectId!==projectId||row.mime!==submitted.type||
         row.size!==submitted.size||row.altText!==description||row.verifiedMetadata!==true||row.publicDeliveryAllowed!==false){
        setAmbiguous(true);
        setError(result.error?.message??'Image registration could not be confirmed. Check saved images before retrying; an interrupted upload may leave private bytes.');
        return;
      }
      setReceipt(row);setFile(null);setAlt('');setAmbiguous(false);
      if(input.current)input.current.value='';
      setNotice('Private image registered. It is not yet attached as the project cover.');
      // Recheck persisted metadata separately; a list failure does not re-upload.
      try{await readImages(attempt);}catch{
        if(current(attempt))setListError('Upload was acknowledged, but the image list could not be refreshed. Retry the list, not the upload.');
      }
    }catch{if(current(attempt)){setAmbiguous(true);setError('Private image upload could not be verified. Check saved images before retrying.');}}
    finally{
      if(attempt===generation.current){
        pending.current=false;setBusy(false);onPending(false);
        if(!current(attempt)){clearPrivate();setError('Your owner session changed. Reopen the project.');}
      }
    }
  }
  return <section className="ws-project-fields" aria-labelledby="private-project-images-title">
    <h2 id="private-project-images-title">Project thumbnail</h2>
    <div className="ws-profile-card">
      <span className="ws-preview-identity" aria-hidden="true"><Icon name="folder" size={22}/></span>
      <strong>Folder cover</strong>
      <p>Automatic website capture is unavailable. Registered images remain private; the folder cover stays until a verified thumbnail attachment is supported.</p>
    </div>
    <fieldset disabled={busy||reading}>
      <legend>Upload a private image for this project</legend>
      <label>Image file (PNG, JPEG, WebP; up to 5 MB)
        <input type="file" ref={input} accept="image/png,image/jpeg,image/webp"
          onChange={event=>{if(!pending.current){setFile(event.target.files?.[0]??null);setError('');setNotice('');setConfirmRetry(false);}}}/>
      </label>
      <label>Image alt text<textarea rows={2} maxLength={500} value={alt}
        onChange={event=>{if(!pending.current)setAlt(event.target.value);}}/></label>
      <p>Describe what the image shows. No repository import, website fetch or public publication occurs.</p>
      {ambiguous&&<label className="ws-profile-check"><input type="checkbox" checked={confirmRetry}
        onChange={event=>setConfirmRetry(event.target.checked)}/> I checked the registered images and understand another upload may create an extra private asset.</label>}
      <button type="button" className="ws-primary" disabled={!file||!alt.trim()||busy||reading||(ambiguous&&!confirmRetry)}
        onClick={()=>void upload()}>{busy?'Uploading…':error?'Retry private image upload':'Upload private image'}</button>
    </fieldset>
    <div aria-live="polite">{busy&&<p>Uploading and registering private image…</p>}{notice&&<p className="ws-inline-alert">{notice}</p>}</div>
    {error&&<p role="alert" className="ws-inline-alert">{error}</p>}
    <h3>Registered private images</h3>
    <div aria-live="polite">{reading&&<p>Checking registered images…</p>}</div>
    {listError&&<p role="alert" className="ws-inline-alert">{listError}</p>}
    {records!==null&&<><p>Showing this project's images from up to 100 recent owner asset records; this is not a complete asset count.</p>
      {records.length?<ul>{records.map(row=><li key={row.id}>{row.altText||'No description'} · {row.mime} · {Math.ceil(row.size/1024)} KB</li>)}</ul>:<p>No matching images in the loaded records.</p>}</>}
    {receipt&&!records?.some(row=>row.id===receipt.id)&&<p>Registration acknowledged: {receipt.altText}. Not present in the current bounded list.</p>}
    <button type="button" className="ws-secondary" disabled={busy||reading} onClick={()=>void refresh()}>
      {listError?'Retry image list':'Refresh image list'}</button>
  </section>;
}

const CASE_SECTION_KINDS: CaseStudySection['kind'][] = ['challenge', 'approach', 'implementation', 'results', 'media', 'custom'];

function CaseStudyEditor({port, projectId, overviewAdvance, knownRevision, onObserved, onSaved, onPending, onDirty}: {
  port: SupabaseBrowserAuthPort; projectId: string;
  overviewAdvance: RevisionRange|null; knownRevision:number;
  onObserved:(revision:number)=>void; onSaved:(from:number,to:number)=>void;
  onPending:(pending:boolean)=>void; onDirty:(dirty:boolean)=>void;
}) {
  const [draft, setDraft] = useState<{sections: CaseStudySection[]; revision: number} | null>(null);
  const [savedSections,setSavedSections]=useState<CaseStudySection[]|null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [needsReload, setNeedsReload] = useState(false);
  const pending = useRef(true);
  const minimumRevision=useRef(knownRevision);
  useEffect(()=>{minimumRevision.current=knownRevision;},[knownRevision]);
  const locked = busy || loading;
  // A known overview-only range can advance a matching case baseline, never
  // an unknown gap or a baseline with an unresolved server conflict.
  const baseRevision=draft && !needsReload && overviewAdvance &&
    draft.revision>=overviewAdvance.from && draft.revision<=overviewAdvance.to
      ? overviewAdvance.to : draft?.revision;
  const stale=needsReload || (baseRevision!==undefined && knownRevision>baseRevision);
  const dirty=!!(draft && savedSections && JSON.stringify(draft.sections)!==JSON.stringify(savedSections));
  useEffect(()=>{onDirty(dirty);},[dirty,onDirty]);

  useEffect(() => {
    let active = true;
    pending.current = true;
    onPending(true);
    setLoading(true);
    const failRead = (message: string) => {
      if (!active) return;
      setError(message);
      setNeedsReload(true);
    };
    void port.readOwnerCaseStudy(projectId).then(result => {
      if (!active) return;
      if (result.data && !result.error && result.data.revision>=minimumRevision.current) {
        setDraft(result.data);
        setSavedSections(result.data.sections);
        onObserved(result.data.revision);
        setError('');
        setNeedsReload(false);
      } else failRead(result.error?.message ?? 'The latest case-study revision could not be verified. Your edits are retained.');
    }).catch(() => {
      failRead('Could not reach your private case study. Your unsaved edits remain available.');
    }).finally(() => {
      if (active) {
        pending.current = false;
        setLoading(false);
        onPending(false);
      }
    });
    return () => { active = false; onPending(false); };
  }, [port, projectId, version, onObserved, onPending]);

  function reloadSections() {
    if (pending.current) return;
    pending.current = true;
    onPending(true);
    setLoading(true);
    setError('');
    setNotice('');
    // Do not discard the old section buffer until an authoritative read succeeds.
    setVersion(value => value + 1);
  }

  function update(index: number, changes: Partial<CaseStudySection>) {
    if (pending.current) return;
    setDraft(current => current && {...current, sections: current.sections.map((section, position) =>
      index === position ? {...section, ...changes} : section)});
    setNotice('');
  }

  function move(index: number, offset: number) {
    if (pending.current) return;
    setDraft(current => {
      if (!current) return current;
      const sections = [...current.sections];
      const a = sections[index], b = sections[index + offset];
      if (!a || !b) return current;
      sections[index] = b;
      sections[index + offset] = a;
      return {...current, sections};
    });
    setNotice('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || baseRevision===undefined || pending.current || stale) return;
    pending.current = true;
    onPending(true);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await port.saveOwnerCaseStudy(projectId, baseRevision, {sections: draft.sections});
      if (!result.data || result.error || result.data.revision!==baseRevision+1) {
        const message = result.error?.message ?? 'Case study save could not be confirmed.';
        setError(message);
        if (projectConflict(message)) setNeedsReload(true);
        return;
      }
      setDraft(result.data);
      setSavedSections(result.data.sections);
      onSaved(baseRevision,result.data.revision);
      setNotice('Private case study saved.');
    } catch {
      setError('The case study save could not be verified. Your unsaved sections are retained.');
    } finally {
      pending.current = false;
      setBusy(false);
      onPending(false);
    }
  }

  return <form className="ws-project-fields ws-case-form" onSubmit={event => void save(event)}>
    <h2>Case study sections</h2>
    <p>Add and order sections for your draft. Visibility applies to a future release.</p>
    {error && <p role="alert" className="ws-inline-alert">{error}</p>}
    {notice && <p role="status" className="ws-inline-alert">{notice}</p>}
    {loading && <p role="status">{draft
      ? 'Loading latest saved sections… Your edits are retained until the read succeeds.'
      : 'Loading case study…'}</p>}
    {(error || stale || dirty) && !loading && <button type="button" className="ws-secondary"
      disabled={locked} onClick={reloadSections}>{draft ? 'Discard section edits and reload' : 'Retry'}</button>}
    {draft && stale && !loading && <p>Load the latest saved sections before saving again. Your edits are replaced only after a successful read.</p>}
    {draft && <>
      {!draft.sections.length && <p>Your case study has no sections yet.</p>}
      {draft.sections.map((section, index) => <fieldset key={section.id} disabled={locked}>
        <legend>{section.title || 'Section ' + (index + 1)}</legend>
        <label>Section type<select value={section.kind} onChange={event => {
          const kind = CASE_SECTION_KINDS.find(value => value === event.target.value);
          if (kind) update(index, {kind});
        }}>{CASE_SECTION_KINDS.map(kind => <option key={kind} value={kind}>{kind}</option>)}</select></label>
        <label>Section title<input value={section.title} maxLength={120} onChange={event => update(index, {title: event.target.value})}/></label>
        <label htmlFor={'case-body-' + section.id}>Section content</label>
        <textarea id={'case-body-' + section.id} value={section.body} rows={4} maxLength={12000}
          onChange={event => update(index, {body: event.target.value})}/>
        <label className="ws-case-check"><input type="checkbox" checked={section.visible}
          onChange={event => update(index, {visible: event.target.checked})}/> Include in future release</label>
        <div className="ws-actions">
          <button type="button" className="ws-secondary" disabled={index === 0} onClick={() => move(index, -1)}>Move up</button>
          <button type="button" className="ws-secondary" disabled={index === draft.sections.length - 1} onClick={() => move(index, 1)}>Move down</button>
          <button type="button" className="ws-secondary" onClick={() => {
            if (pending.current) return;
            setDraft({...draft, sections: draft.sections.filter(item => item.id !== section.id)}); setNotice('');
          }}>Remove from draft</button>
        </div>
      </fieldset>)}
      <div className="ws-actions">
        <button type="button" className="ws-secondary" disabled={locked || draft.sections.length >= 24} onClick={() => {
          if (pending.current) return;
          setDraft({...draft, sections: [...draft.sections, {id: crypto.randomUUID(), kind: 'custom', title: '', body: '', visible: false}]});
          setNotice('');
        }}>Add section</button>
        <button type="submit" className="ws-primary" disabled={locked || stale}>{busy ? 'Saving…' : 'Save sections'}</button>
      </div>
    </>}
  </form>;
}
