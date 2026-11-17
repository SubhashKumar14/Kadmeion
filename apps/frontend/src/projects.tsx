import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import type { NewPrivateProject, OwnerProject } from '../../auth-web/src/supabase-auth-port.ts';
import type { AuthOutcome } from '../../../packages/contracts/src/auth-service.ts';
import { SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
import { normalizeExternalHttpsUrl } from '../../../packages/contracts/src/project.ts';
import type { PrivateProjectDraft } from '../../../packages/contracts/src/projects.ts';
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
  const [sort,setSort]=useState<'recent'|'name'>('recent');
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
    const matches=state.items.filter(item=>!term||
      [item.title,item.slug,item.summary].some(value=>value.toLocaleLowerCase('en').includes(term)));
    return sort==='name'?matches.sort((a,b)=>a.title.localeCompare(b.title,'en')):matches;
  },[state,search,sort]);
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
        <input type="search" placeholder="Search titles, slugs and summaries" value={search}
          disabled={state.status!=='ready'} onChange={event=>setSearch(event.target.value)}/></label>
      <label>Sort
        <select value={sort} disabled={state.status!=='ready'}
          onChange={event=>setSort(event.target.value==='name'?'name':'recent')}>
          <option value="recent">Recently updated</option><option value="name">Name A–Z</option>
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
    {notice&&<p role="status" className="ws-inline-alert">{notice}</p>}
    {state.status==='loading'?<p role="status" className="ws-project-state">Loading your private projects…</p>:
     state.status==='error'?<div role="alert" className="ws-project-state">
       <p>{state.message}</p><button type="button" className="ws-secondary" onClick={()=>{setState({status:'loading'});setReload(value=>value+1);}}>Retry securely</button></div>:
    <>
      <p className="ws-project-count" role="status">
        Showing {search ? filtered.length+' matching of ' : ''}{state.items.length} loaded private {state.items.length===1?'project':'projects'}.
        {state.nextCursor
          ? ' More projects are available. Search and sorting apply only to loaded records.'
          : ' All pages currently available were loaded; refresh if your projects changed.'}
      </p>
      {filtered.length===0?<div className="ws-project-empty-layout">
        <div className="ws-project-empty">
          <div className="ws-area-icon"><Icon name="folder" size={22}/></div>
          <h2>{search?'No matching loaded projects':'Your first project belongs here.'}</h2>
          <p>{search?'Try a different search or load additional private pages to search older projects.':
            'Add a project title and a short description. You can add links later.'}</p>
          {search?<button type="button" className="ws-secondary" onClick={()=>setSearch('')}>Clear search</button>:
            <button type="button" className="ws-primary" onClick={open}>Add first project</button>}
        </div>
        {!search && <aside className="ws-project-aside" aria-labelledby="ws-project-guide">
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
          <div className="ws-project-mark" aria-hidden="true"><Icon name="folder" size={21}/></div>
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
            disabled={saving} onClick={()=>modal.current?.close()}>×</button></div>
        <p className="ws-project-privacy"><Icon name="folder" size={16}/> Saved to your private project library.</p>
        <label>Project title<input disabled={saving} required autoComplete="off" maxLength={120} value={draft.title}
          onChange={event=>setDraft(old=>({...old,title:event.target.value,
            slug:customSlug?old.slug:suggestSlug(event.target.value)}))}/></label>
        <details className="ws-project-slug"><summary>Edit private URL slug</summary>
        <label>Private URL slug<input disabled={saving} required spellCheck={false} minLength={3} maxLength={64}
          pattern="[a-z0-9]+(-[a-z0-9]+)*" value={draft.slug}
          onInvalid={event => {
            const disclosure = event.currentTarget.closest('details');
            if (disclosure) disclosure.open = true;
          }}
          onChange={event=>{setCustomSlug(true);setDraft(old=>({...old,slug:event.target.value}));}}/>
          <small>Unique to your account. Lowercase letters, numbers and hyphens.</small></label></details>
        <label>Summary (optional)<textarea disabled={saving} rows={3} maxLength={360} value={draft.summary}
          onChange={event=>setDraft(old=>({...old,summary:event.target.value}))}/></label>
        <label>Repository URL (optional)<input disabled={saving} type="url" pattern="https://.+" title="Enter an HTTPS address" maxLength={2048}
          placeholder="https://example.com/repository" value={draft.repositoryUrl||''}
          onChange={event=>setDraft(old=>({...old,repositoryUrl:event.target.value||null}))}/></label>
        <label>Live website URL (optional)<input disabled={saving} type="url" pattern="https://.+" title="Enter an HTTPS address" maxLength={2048}
          placeholder="https://example.com/project" value={draft.liveUrl||''}
          onChange={event=>setDraft(old=>({...old,liveUrl:event.target.value||null}))}/></label>
        {saving&&<p role="status">Saving your private project…</p>}
        {error&&<p role="alert" className="ws-inline-alert">{error}</p>}
        <div className="ws-project-modal-actions">
          <button type="button" className="ws-secondary" disabled={saving} onClick={()=>modal.current?.close()}>Cancel</button>
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

export function PrivateProjectDetail({port, projectId}: {port: SupabaseBrowserAuthPort; projectId: string}) {
  const [detail, setDetail] = useState<DetailState>({status: 'loading'});
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{error: boolean; text: string} | null>(null);
  const [latest, setLatest] = useState<OwnerProject | null>(null);
  const [checking, setChecking] = useState(false);
  const [panel, setPanel] = useState<'details' | 'sections'>('details');
  const [openedSections, setOpenedSections] = useState(false);

  useEffect(() => {
    let active = true;
    void port.readOwnerProject(projectId).then(result => {
      if (!active) return;
      setDetail(result.data
        ? {status: 'ready', saved: result.data, draft: result.data}
        : {status: 'unavailable'});
    }).catch(() => {if (active) setDetail({status:'unavailable'});});
    return () => { active = false; };
  }, [port, projectId, reload]);

  function edit(field: keyof PrivateProjectDraft, value: string) {
    setDetail(current => current.status === 'ready'
      ? {...current, draft: {...current.draft, [field]: value}}
      : current);
  }

  async function compareLatest(baseRevision: number) {
    setChecking(true);
    setFeedback(null);
    try {
      const {data} = await port.readOwnerProject(projectId);
      setLatest(data && data.revision !== baseRevision ? data : null);
      if (!data) setFeedback({error: true, text: 'Could not check the latest revision. Your edits are still here.'});
      else if (data.revision === baseRevision) setFeedback({error: false, text: 'You have the latest saved revision.'});
    } catch {
      setFeedback({error:true,text:'Latest revision check failed. Your private draft is preserved.'});
    } finally {
      setChecking(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (detail.status !== 'ready' || saving || checking || latest) return;
    setSaving(true);
    setFeedback(null);
    try {
      const result = await port.saveOwnerProject(projectId, detail.saved.revision, detail.draft);
      if (!result.data) {
        setFeedback({error: true, text: result.error?.message ?? 'Save could not be confirmed.'});
        return;
      }
      setDetail({status: 'ready', saved: result.data, draft: result.data});
      setFeedback({error: false, text: 'Private draft saved.'});
    } catch {
      setFeedback({error:true,text:'Project save could not be verified. Your edits remain available.'});
    } finally {
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
  const repository = detail.status === 'ready' ? safeProjectLink(detail.saved.repositoryUrl) : undefined;
  const liveSite = detail.status === 'ready' ? safeProjectLink(detail.saved.liveUrl) : undefined;

  return <section aria-labelledby="project-detail-title" className="ws-owner-page">
    <div className="ws-heading">
      <a href="/app/projects">Back to project library</a>
      <h1 id="project-detail-title">Build the case study.</h1>
      <p>Update your private project details.</p>
    </div>
    {detail.status === 'ready' && <div className="ws-profile-tabs" role="group" aria-label="Project sections">
      <button type="button" aria-pressed={panel === 'details'} onClick={() => setPanel('details')}>Overview</button>
      <button type="button" aria-pressed={panel === 'sections'} onClick={() => {setOpenedSections(true); setPanel('sections');}}>Case study</button>
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
      onSaved={revision => setDetail(current => current.status === 'ready' && revision === current.saved.revision + 1
        ? {...current, saved: {...current.saved, revision}} : current)}/></div>}
    {detail.status === 'ready' && panel === 'details' && <div className="ws-project-detail ws-owner-columns">
      <form className="ws-project-fields" onSubmit={event => void save(event)}>
        <fieldset disabled={saving || checking}>
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
        {feedback && <p role={feedback.error ? 'alert' : 'status'} className="ws-inline-alert">{feedback.text}</p>}
        <div className="ws-actions">
          <button type="submit" className="ws-primary" disabled={saving || checking || !!latest || !dirty}>{saving ? 'Saving…' : 'Save changes'}</button>
          <button type="button" className="ws-secondary" disabled={saving || checking}
            onClick={() => void compareLatest(detail.saved.revision)}>{checking ? 'Checking…' : 'Check latest revision'}</button>
          {dirty && <button type="button" className="ws-secondary" disabled={saving || checking}
            onClick={() => {
              setDetail({status:'ready',saved:detail.saved,draft:detail.saved});
              setLatest(null);
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
          disabled={dirty || saving || checking} onMoved={()=>window.location.assign('/app/trash')}/>
        {latest && <div className="ws-project-conflict">
          <h3>Saved revision {latest.revision} is newer</h3>
          <dl>
            <dt>Title</dt><dd>{latest.title}</dd>
            <dt>Short description</dt><dd>{latest.summary || '—'}</dd>
            <dt>Project description</dt><dd>{latest.description || '—'}</dd>
            <dt>Repository URL</dt><dd>{latest.repositoryUrl || '—'}</dd>
            <dt>Live website URL</dt><dd>{latest.liveUrl || '—'}</dd>
          </dl>
          <button type="button" className="ws-secondary" onClick={() => {
            setDetail({status: 'ready', saved: latest, draft: latest});
            setLatest(null);
            setFeedback({error: false, text: 'Loaded the latest saved draft.'});
          }}>Discard my edits and load saved draft</button>
        </div>}
      </aside>
    </div>}
  </section>;
}

const CASE_SECTION_KINDS: CaseStudySection['kind'][] = ['challenge', 'approach', 'implementation', 'results', 'media', 'custom'];

function CaseStudyEditor({port, projectId, onSaved}: {
  port: SupabaseBrowserAuthPort; projectId: string; onSaved: (revision: number) => void;
}) {
  const [draft, setDraft] = useState<{sections: CaseStudySection[]; revision: number} | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    void port.readOwnerCaseStudy(projectId).then(result => {
      if (!active) return;
      if (result.data) { setDraft(result.data); setError(''); }
      else setError(result.error?.message ?? 'Case study could not be loaded.');
    }).catch(() => {
      if (active) setError('Could not reach your private case study. Your unsaved edits remain available.');
    });
    return () => { active = false; };
  }, [port, projectId, version]);

  function update(index: number, changes: Partial<CaseStudySection>) {
    setDraft(current => current && {...current, sections: current.sections.map((section, position) =>
      index === position ? {...section, ...changes} : section)});
    setNotice('');
  }

  function move(index: number, offset: number) {
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
    if (!draft || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await port.saveOwnerCaseStudy(projectId, draft.revision, {sections: draft.sections});
      if (!result.data) { setError(result.error?.message ?? 'Case study save could not be confirmed.'); return; }
      setDraft(result.data);
      onSaved(result.data.revision);
      setNotice('Private case study saved.');
    } catch {
      setError('The case study save could not be verified. Your unsaved sections are retained.');
    } finally {
      setBusy(false);
    }
  }

  return <form className="ws-project-fields ws-case-form" onSubmit={event => void save(event)}>
    <h2>Case study sections</h2>
    <p>Add and order sections for your draft. Visibility applies to a future release.</p>
    {error && <p role="alert" className="ws-inline-alert">{error}</p>}
    {notice && <p role="status" className="ws-inline-alert">{notice}</p>}
    {!draft && !error && <p role="status">Loading case study…</p>}
    {error && <button type="button" className="ws-secondary" onClick={() => {
      setDraft(null); setError(''); setVersion(value => value + 1);
    }}>{draft ? 'Discard section edits and reload' : 'Retry'}</button>}
    {draft && <>
      {!draft.sections.length && <p>Your case study has no sections yet.</p>}
      {draft.sections.map((section, index) => <fieldset key={section.id} disabled={busy}>
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
            setDraft({...draft, sections: draft.sections.filter(item => item.id !== section.id)}); setNotice('');
          }}>Remove from draft</button>
        </div>
      </fieldset>)}
      <div className="ws-actions">
        <button type="button" className="ws-secondary" disabled={busy || draft.sections.length >= 24} onClick={() => {
          setDraft({...draft, sections: [...draft.sections, {id: crypto.randomUUID(), kind: 'custom', title: '', body: '', visible: false}]});
          setNotice('');
        }}>Add section</button>
        <button type="submit" className="ws-primary" disabled={busy}>{busy ? 'Saving…' : 'Save sections'}</button>
      </div>
    </>}
  </form>;
}
