import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import type { NewPrivateProject, OwnerProject } from '../../auth-web/src/supabase-auth-port.ts';
import { SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
import { normalizeExternalHttpsUrl } from '../../../packages/contracts/src/project.ts';
import type { PrivateProjectDraft } from '../../../packages/contracts/src/projects.ts';
import { Icon } from './landing.tsx';

type LoadState = { status:'loading' } | { status:'error'; message:string } |
  { status:'ready'; items:OwnerProject[] };
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
  const [search,setSearch]=useState('');
  const [view,setView]=useState<'gallery'|'list'>('gallery');
  const [sort,setSort]=useState<'recent'|'name'>('recent');
  const [draft,setDraft]=useState<NewPrivateProject>(freshDraft);
  const [customSlug,setCustomSlug]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const modal=useRef<HTMLDialogElement>(null);
  const opener=useRef<HTMLButtonElement>(null);
  const topOpener=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    let active=true;
    void port.listOwnerProjects().then(reply=>{
      if (!active)return;
      setState(reply.error||!reply.data
        ? {status:'error',message:'Your private projects could not be loaded. No sample records are displayed.'}
        : {status:'ready',items:reply.data});
    }).catch(()=>{
      if (active)setState({status:'error',message:'The private project service is unavailable.'});
    });
    return ()=>{active=false;};
  },[port]);
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
    if(saving)return;
    setSaving(true);setError('');setNotice('');
    try {
      const saved=await port.createPrivateProject(draft);
      if(saved.error||!saved.data) {
        setError(saved.error?.message||'Private project save was not confirmed. Your form is retained.');
        return;
      }
      const created=saved.data;
      setState(old=>old.status==='ready'
        ? {status:'ready',items:[created,...old.items.filter(item=>item.id!==created.id)].slice(0,100)}
        : {status:'ready',items:[created]});
      modal.current?.close();
      setDraft(freshDraft());setCustomSlug(false);
      setNotice('Saved privately in your account. This did not publish or connect a repository.');
    } catch {
      setError('Project creation could not be verified. Your form values are retained.');
    } finally {setSaving(false);}
  }
  return <section className="ws-projects" aria-labelledby="ws-title">
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
    </div>
    {notice&&<p role="status" className="ws-inline-alert">{notice}</p>}
    {state.status==='loading'?<p role="status" className="ws-project-state">Loading your private projects…</p>:
     state.status==='error'?<div role="alert" className="ws-project-state">
       <p>{state.message}</p><button type="button" className="ws-secondary" onClick={()=>location.reload()}>Retry securely</button></div>:
    <>
      <p className="ws-project-count">{filtered.length} of {state.items.length} loaded private projects
        {state.items.length===100?' (latest 100 only; older projects are not shown)':''}</p>
      {filtered.length===0?<div className="ws-project-empty-layout">
        <div className="ws-project-empty">
          <div className="ws-area-icon"><Icon name="folder" size={22}/></div>
          <h2>{search?'No matching projects':'Your first project belongs here.'}</h2>
          <p>{search?'Try a different search in your private records.':
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
          <div className="ws-project-card-body"><p className="ws-area-meta">PRIVATE PROJECT</p><h2><a href={'/app/projects/' + item.id}>{item.title}</a></h2>
            <p>{item.summary||'No project summary yet.'}</p>
            <span>Updated {new Date(item.updatedAt).toLocaleDateString()} · Revision {item.revision}</span>
            {(repository || liveSite) && <div className="ws-project-links">
              {repository && <a href={repository} target="_blank" rel="noopener noreferrer">Repository</a>}
              {liveSite && <a href={liveSite} target="_blank" rel="noopener noreferrer">Live site</a>}
            </div>}
          </div>
        </article></li>;
        })}
      </ul>}
    </>}
    <dialog ref={modal} className="ws-project-dialog" aria-labelledby="ws-project-modal-heading"
      onCancel={event => { if (saving) event.preventDefault(); }}
      onClose={() => (opener.current?.isConnected ? opener.current : topOpener.current)?.focus()}>
      <form onSubmit={event=>void save(event)}>
        <div className="ws-project-modal-heading"><div><p className="ws-kicker">QUICK ADD / PRIVATE</p>
          <h2 id="ws-project-modal-heading">Add a project</h2></div>
          <button type="button" aria-label="Close project drawer" className="ws-project-close"
            disabled={saving} onClick={()=>modal.current?.close()}>×</button></div>
        <p className="ws-project-help">Nothing becomes public from this form. Optional links are never required.</p>
        <label>Project title<input required autoComplete="off" maxLength={120} value={draft.title}
          onChange={event=>setDraft(old=>({...old,title:event.target.value,
            slug:customSlug?old.slug:suggestSlug(event.target.value)}))}/></label>
        <label>Private URL slug<input required spellCheck={false} minLength={3} maxLength={64}
          pattern="[a-z0-9]+(-[a-z0-9]+)*" value={draft.slug}
          onChange={event=>{setCustomSlug(true);setDraft(old=>({...old,slug:event.target.value}));}}/>
          <small>Unique to your account. Lowercase letters, numbers and hyphens.</small></label>
        <label>Summary (optional)<textarea rows={3} maxLength={360} value={draft.summary}
          onChange={event=>setDraft(old=>({...old,summary:event.target.value}))}/></label>
        <label>Repository URL (optional)<input type="url" maxLength={2048}
          placeholder="https://example.com/repository" value={draft.repositoryUrl||''}
          onChange={event=>setDraft(old=>({...old,repositoryUrl:event.target.value||null}))}/></label>
        <label>Live website URL (optional)<input type="url" maxLength={2048}
          placeholder="https://example.com/project" value={draft.liveUrl||''}
          onChange={event=>setDraft(old=>({...old,liveUrl:event.target.value||null}))}/></label>
        <p className="ws-project-privacy">Visibility: <strong>Private</strong>. Sharing requires a separate owner action.</p>
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
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{error: boolean; text: string} | null>(null);
  const [latest, setLatest] = useState<OwnerProject | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let active = true;
    void port.readOwnerProject(projectId).then(result => {
      if (!active) return;
      setDetail(result.data
        ? {status: 'ready', saved: result.data, draft: result.data}
        : {status: 'unavailable'});
    });
    return () => { active = false; };
  }, [port, projectId]);

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
    } finally {
      setSaving(false);
    }
  }

  const repository = detail.status === 'ready' ? safeProjectLink(detail.saved.repositoryUrl) : undefined;
  const liveSite = detail.status === 'ready' ? safeProjectLink(detail.saved.liveUrl) : undefined;

  return <section aria-labelledby="project-detail-title">
    <div className="ws-heading">
      <a href="/app/projects">Back to project library</a>
      <h1 id="project-detail-title">Build the case study.</h1>
      <p>Update your private project details.</p>
    </div>
    {detail.status === 'loading' && <p role="status">Loading project…</p>}
    {detail.status === 'unavailable' && <p role="alert">Project unavailable. Check your session or return to the project library.</p>}
    {detail.status === 'ready' && <div className="ws-project-detail">
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
          <label>Repository URL (optional)
            <input type="url" maxLength={2048} value={detail.draft.repositoryUrl ?? ''} onChange={e => edit('repositoryUrl', e.target.value)}/>
          </label>
          <label>Live website URL (optional)
            <input type="url" maxLength={2048} value={detail.draft.liveUrl ?? ''} onChange={e => edit('liveUrl', e.target.value)}/>
          </label>
        </fieldset>
        {feedback && <p role={feedback.error ? 'alert' : 'status'} className="ws-inline-alert">{feedback.text}</p>}
        <div className="ws-actions">
          <button type="submit" className="ws-primary" disabled={saving || checking || !!latest}>{saving ? 'Saving…' : 'Save changes'}</button>
          <button type="button" className="ws-secondary" disabled={saving || checking}
            onClick={() => void compareLatest(detail.saved.revision)}>{checking ? 'Checking…' : 'Check latest revision'}</button>
        </div>
      </form>
      <aside className="ws-project-aside" aria-label="Saved project preview">
        <p className="ws-kicker">SAVED DRAFT · REVISION {detail.saved.revision}</p>
        <h2>{detail.saved.title}</h2>
        {detail.saved.summary && <p>{detail.saved.summary}</p>}
        {repository &&
          <p><a href={repository} target="_blank" rel="noopener noreferrer">Repository</a></p>}
        {liveSite &&
          <p><a href={liveSite} target="_blank" rel="noopener noreferrer">Live website</a></p>}
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
