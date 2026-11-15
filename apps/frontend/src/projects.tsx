import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { NewPrivateProject, OwnerProject } from '../../auth-web/src/supabase-auth-port.ts';
import { SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
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
  function open() {
    setError('');
    modal.current?.showModal();
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
        <h1 id="ws-title">Projects worth<br/><em>showing well.</em></h1>
        <p>Organize your work privately before choosing anything to publish. No repository is required.</p>
      </div>
      <button type="button" className="ws-primary" ref={opener} onClick={open}>Add project <Icon name="arrow" size={16}/></button>
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
      {filtered.length===0?<div className="ws-project-empty">
        <div className="ws-area-icon"><Icon name="folder" size={22}/></div>
        <h2>{search?'No matching projects':'Start your project library.'}</h2>
        <p>{search?'Try a different search in your private records.':
          'No active private projects were returned. Create one without needing a GitHub repository.'}</p>
        {search?<button type="button" className="ws-secondary" onClick={()=>setSearch('')}>Clear search</button>:
          <button type="button" className="ws-primary" onClick={open}>Add first project</button>}
      </div>:<ul className={'ws-project-grid'+(view==='list'?' as-list':'')}>
        {filtered.map(item=><li key={item.id}><article className="ws-project-card">
          <div className="ws-project-mark" aria-hidden="true"><Icon name="folder" size={21}/></div>
          <div className="ws-project-card-body"><p className="ws-area-meta">PRIVATE PROJECT</p><h2>{item.title}</h2>
            <p>{item.summary||'No project summary yet.'}</p>
            <span>Updated {new Date(item.updatedAt).toLocaleDateString()} · Revision {item.revision}</span>
            {(item.repositoryUrl||item.liveUrl)&&<div className="ws-project-links">
              {item.repositoryUrl&&<a href={item.repositoryUrl} target="_blank" rel="noopener noreferrer">Repository</a>}
              {item.liveUrl&&<a href={item.liveUrl} target="_blank" rel="noopener noreferrer">Live site</a>}
            </div>}
          </div>
        </article></li>)}
      </ul>}
    </>}
    <dialog ref={modal} className="ws-project-dialog" aria-labelledby="ws-project-modal-heading"
      onClose={()=>opener.current?.focus()}>
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
