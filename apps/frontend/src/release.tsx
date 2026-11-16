import {useEffect, useRef, useState} from 'react';
import type {SupabaseBrowserAuthPort, OwnerPortfolio, OwnerReviewerGrantSummary, SavedOwnerRevision, OwnerFrozenRequest} from '../../auth-web/src/supabase-auth-port.ts';
import type {PrivateFrozenRequest, FrozenVisibilityIntent} from '../../../packages/contracts/src/private-release-service.ts';
import type {PrivatePointerSnapshot} from '../../../packages/contracts/src/private-release-visibility-service.ts';
import {prepareSafeStaticPreview, type SafeSlotPlan, type SafeSlotKind, type SafePreviewResult} from '../../../packages/editor-core/src/publish-preflight.ts';
import {portfolioLayout} from '../../../packages/editor-core/src/managed-project-files.ts';
import type {PortfolioSnapshot} from '../../../packages/editor-core/src/portfolio-revision-transactions.ts';
import {PortfolioCanvas} from './portfolio-tools.tsx';
import {downloadPrivateFile} from './settings.tsx';

const routes = {staging:'Reviewer staging', publish:'Publish preflight', releases:'Releases & rollback', share:'Sharing controls'} as const;
type ReleaseMode = keyof typeof routes;
type SafeGrant = {grantId:string;expiresAt:string;status:'REGISTERED_UNSERVABLE'|'REVOKED'};
const dataComponents:Readonly<Record<string,SafeSlotKind>> = {
  'title-stacked@1':'heading','body-copy@1':'paragraph','external-link@1':'external-link',
  'technology-tag@1':'badge','author-metric@1':'metric','skills-list@1':'list',
  'project-card@1':'project-card','image@1':'image'
};

/** This plan comes from pinned layouts and known component IDs only. Untrusted
 * owned source never becomes renderable merely because a slot has a label. */
function buildPlan(snapshot:PortfolioSnapshot):SafeSlotPlan[] {
  const source=snapshot.files['pages/home.page.json'];
  if (!source) return [];
  const page=JSON.parse(source) as {sections?:{id?:unknown;layout?:unknown}[]};
  if (!Array.isArray(page.sections)) return [];
  return page.sections.flatMap(section=>{
    if (!section || typeof section.id!=='string' || typeof section.layout!=='string') return [];
    const layout=portfolioLayout(section.layout);
    if (!layout) return [];
    return layout.slots.map(slot=>{
      const slotKey=section.id+'-'+slot.toLowerCase();
      const assigned=snapshot.slots[slotKey]?.componentId;
      const trusted=assigned && Object.hasOwn(dataComponents,assigned) ? dataComponents[assigned] : undefined;
      return {slotKey,componentId:trusted && assigned ? assigned : 'body-copy@1',
        kind:trusted ?? 'paragraph',required:layout.required.includes(slot)};
    });
  });
}

export function releaseRoute(path:string):{id:string;mode:ReleaseMode}|undefined {
  const match=/^\/app\/portfolios\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(staging|publish|releases|share)$/i.exec(path);
  if (match?.[1] && match[2] && Object.hasOwn(routes,match[2]))
    return {id:match[1].toLowerCase(),mode:match[2] as ReleaseMode};
}

export function PortfolioRelease({port,id,mode}:{port:SupabaseBrowserAuthPort;id:string;mode:ReleaseMode}) {
  const [record,setRecord]=useState<(OwnerPortfolio & {snapshot:PortfolioSnapshot|null})|null>(null);
  const [revisions,setRevisions]=useState<SavedOwnerRevision[]|null>(null);
  const [frozenRequests,setFrozenRequests]=useState<OwnerFrozenRequest[]|null>(null);
  const [frozenListError,setFrozenListError]=useState('');
  const [selectedRevision,setSelectedRevision]=useState<number|null>(null);
  const [revisionError,setRevisionError]=useState('');
  const [pointer,setPointer]=useState<PrivatePointerSnapshot|null>(null);
  const [visibility,setVisibility]=useState<FrozenVisibilityIntent>('UNLISTED');
  const [frozen,setFrozen]=useState<PrivateFrozenRequest|null>(null);
  const [pinnedPreview,setPinnedPreview]=useState<PortfolioSnapshot|null>(null);
  const [pinnedPreviewPending,setPinnedPreviewPending]=useState(false);
  const [pinnedPreviewError,setPinnedPreviewError]=useState('');
  const [result,setResult]=useState<SafePreviewResult|null>(null);
  const [grant,setGrant]=useState<SafeGrant|null>(null);
  const [grants,setGrants]=useState<OwnerReviewerGrantSummary[]|null>(null);
  const [grantListError,setGrantListError]=useState('');
  const [validMinutes,setValidMinutes]=useState(60);
  const [confirmRevoke,setConfirmRevoke]=useState(false);
  const [confirmBlock,setConfirmBlock]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [retry,setRetry]=useState(0);
  const operation=useRef<string|null>(null);
  const grantOperation=useRef<string|null>(null);
  const blockOperation=useRef<string|null>(null);
  const base='/app/portfolios/'+id;

  useEffect(()=>{
    let active=true;
    setError('');
    void (async()=>{
      try {
        const reply=await port.readOwnerPortfolio(id);
        if (!active) return;
        if (!reply.data) {setError(reply.error?.message ?? 'Portfolio unavailable.');return;}
        setRecord(reply.data);
        if (mode==='staging'||mode==='publish') {
          const saved=await port.listOwnerPortfolioRevisions(id);
          if (!active) return;
          if (saved.data) {
            setRevisions(saved.data.filter(row=>row.revision<=reply.data!.revision));
            setSelectedRevision(saved.data.some(row=>row.revision===reply.data!.revision)
              ? reply.data.revision : null);
            setRevisionError('');
          } else setRevisionError(saved.error?.message ?? 'The saved-revision catalogue is unavailable.');
        }
        if (mode==='staging'||mode==='publish'||mode==='releases') {
          const history=await port.listOwnerFrozenRequests(id);
          if (!active) return;
          if (history.data) {setFrozenRequests(history.data);setFrozenListError('');}
          else setFrozenListError(history.error?.message ?? 'Frozen request history could not be loaded.');
        }
        if (mode==='staging') {
          const list=await port.listOwnerReviewerGrants(id);
          if (!active) return;
          if (list.data) {setGrants(list.data);setGrantListError('');}
          else setGrantListError(list.error?.message ?? 'Existing reviewer grants are unavailable.');
          return;
        }
        if (mode!=='releases' && mode!=='share') return;
        const status=await port.readOwnerRelease(id);
        if (!active) return;
        if (status.data) {setPointer(status.data);setError('');}
        else setError(status.error?.message ?? 'Private release status unavailable.');
      } catch {
        if (active) setError('The private release service could not be reached.');
      }
    })();
    return ()=>{active=false;};
  },[port,id,mode,retry]);

  /** Distinguish an owner-only saved-head visual from the exact frozen pin.
   * Never show a fallback HEAD while labeling it as the selected revision. */
  useEffect(()=>{
    if (mode!=='staging'||!frozen) {
      setPinnedPreview(null);setPinnedPreviewError('');setPinnedPreviewPending(false);
      return;
    }
    let active=true;
    setPinnedPreview(null);setPinnedPreviewError('');setPinnedPreviewPending(true);
    void port.loadOwnerFrozenRelease(frozen.requestId).then(reply=>{
      if (!active) return;
      if (!reply.data||reply.data.loadedPortfolioId!==id||
          reply.data.loadedRevision!==frozen.revision||
          reply.data.loadedSnapshotSha256!==frozen.snapshotSha256) {
        setPinnedPreviewError('The exact frozen revision could not be verified. The current draft is not substituted.');
      } else setPinnedPreview(reply.data.snapshot);
    }).catch(()=>{
      if (active) setPinnedPreviewError('The pinned preview is temporarily unavailable. No public data was released.');
    }).finally(()=>{if(active)setPinnedPreviewPending(false);});
    return()=>{active=false;};
  },[port,id,mode,frozen]);

  async function downloadStaticPreview(){
    if (busy || !frozen || result?.status!=='PREVIEW_ONLY') return;
    setBusy(true);setError('');setNotice('');
    try {
      const {exportStandaloneStaticPreview}=await import('../../../packages/storage-adapters/src/static-preview-export.ts');
      const {data}=await port.loadOwnerFrozenRelease(frozen.requestId);
      if (!data || data.loadedPortfolioId!==id || data.loadedRevision!==frozen.revision ||
          data.loadedSnapshotSha256!==frozen.snapshotSha256) throw new Error('Invalid frozen revision receipt.');
      const archive=await exportStandaloneStaticPreview({...data,plan:buildPlan(data.snapshot)});
      downloadPrivateFile('kadmeion-static-preview-revision-'+data.loadedRevision+'.zip',archive.zip,'application/zip');
      setNotice('Offline static preview download prepared.');
    } catch {
      setError('The frozen revision could not be exported. Run preflight again to check eligibility.');
    } finally {setBusy(false);}
  }

  async function inspect(){
    if (!record?.revision || selectedRevision===null || busy) return;
    setBusy(true);setError('');setNotice('');setResult(null);
    try {
      let request=frozen;
      if (!request) {
        operation.current ??= crypto.randomUUID();
        const saved=await port.freezeOwnerRelease(id,operation.current,selectedRevision,visibility);
        if (!saved.data) {setError(saved.error?.message ?? 'Private freeze could not be confirmed.');return;}
        request=saved.data;
        setFrozen(request);
        const refreshed=await port.listOwnerFrozenRequests(id);
        if (refreshed.data) {setFrozenRequests(refreshed.data);setFrozenListError('');}
        else setFrozenListError('Private freeze succeeded, but its history could not be refreshed.');
      }
      if (mode==='staging') return;
      const evidence=await port.loadOwnerFrozenRelease(request.requestId);
      if (!evidence.data || evidence.data.loadedPortfolioId!==id ||
          evidence.data.loadedRevision!==request.revision ||
          evidence.data.loadedSnapshotSha256!==request.snapshotSha256) {
        setError(evidence.error?.message ?? 'The saved revision and frozen digest do not agree.');return;
      }
      setResult(prepareSafeStaticPreview({...evidence.data,plan:buildPlan(evidence.data.snapshot)}));
    } catch {
      setError('The frozen revision could not be checked. Nothing was published.');
    } finally {setBusy(false);}
  }

  /** Registration is a real owner-scoped RPC, not a published reviewer URL.
   * Raw tokens are intentionally discarded, never placed in React state or
   * web storage, while host delivery remains unproven. */
  async function registerReviewer(){
    if (!frozen || grant || busy || mode!=='staging') return;
    setBusy(true);setError('');setNotice('');
    try {
      grantOperation.current ??= crypto.randomUUID();
      const response=await port.issueOwnerReviewerGrant(frozen.requestId,grantOperation.current,validMinutes);
      if (!response.data) {setError(response.error?.message ?? 'Reviewer registration was not confirmed.');return;}
      const {grantId,expiresAt}=response.data;
      setGrant({grantId,expiresAt,status:'REGISTERED_UNSERVABLE'});
      const updated=await port.listOwnerReviewerGrants(id);
      if (updated.data) {setGrants(updated.data);setGrantListError('');}
      else setGrantListError('Grant registered, but the owner-only saved-grant list could not be refreshed.');
      grantOperation.current=null;
      setNotice('Private reviewer grant registered. The link remains disabled pending hosted delivery verification.');
    } catch {setError('Reviewer registration failed. Retry the same request.');}
    finally {setBusy(false);}
  }

  async function revokeReviewer(){
    if (!grant || grant.status==='REVOKED' || busy || !confirmRevoke) return;
    setBusy(true);setError('');setNotice('');
    try {
      const response=await port.revokeOwnerReviewerGrant(grant.grantId);
      if (!response.data) {setError(response.error?.message ?? 'Reviewer revocation was not confirmed.');return;}
      setGrant(previous=>previous ? {...previous,status:'REVOKED'} : previous);
      const refreshed=await port.listOwnerReviewerGrants(id);
      if (refreshed.data) {setGrants(refreshed.data);setGrantListError('');}
      else setGrantListError('Revocation succeeded but the reviewer list could not be refreshed.');
      setConfirmRevoke(false);
      setNotice('Private reviewer grant revoked. External delivery revocation has not been independently verified.');
    } catch {setError('Reviewer revocation could not be checked. Retry safely.');}
    finally {setBusy(false);}
  }

  async function blockCandidate(){
    if (!pointer || pointer.status!=='PREPARED_PRIVATE' || busy || !confirmBlock) return;
    setBusy(true);setError('');setNotice('');
    try {
      blockOperation.current ??= crypto.randomUUID();
      const receipt=await port.blockOwnerReleaseCandidate(id,blockOperation.current);
      if (!receipt.data) {setError(receipt.error?.message ?? 'Private candidate block was not acknowledged.');return;}
      const reread=await port.readOwnerRelease(id);
      if (!reread.data) {setError('Block acknowledged, but current private pointer could not be rechecked.');return;}
      setPointer(reread.data);
      blockOperation.current=null;setConfirmBlock(false);
      setNotice('Private candidate pointer refreshed. This is not proof of public CDN revocation.');
    } catch {setError('Private candidate could not be blocked. Refresh its state before retrying.');}
    finally {setBusy(false);}
  }

  /** A saved private freeze can be reopened without spending another quota slot.
   * The digest must still match the owner-restricted revision journal. */
  function selectFrozenRequest(request:OwnerFrozenRequest){
    if (busy) return;
    const revision=revisions?.find(item=>item.revision===request.revision);
    if (!revision||revision.snapshotSha256!==request.snapshotSha256) {
      setError('Frozen request no longer matches a visible saved revision. Nothing was published.');
      return;
    }
    setError('');setNotice('');setResult(null);setConfirmRevoke(false);setGrant(null);
    setSelectedRevision(request.revision);setVisibility(request.visibilityIntent);
    setFrozen({requestId:request.requestId,portfolioId:id,revision:request.revision,
      snapshotSha256:request.snapshotSha256,visibilityIntent:request.visibilityIntent,
      status:'FROZEN',publicUrl:null,alreadyFrozen:true});
    operation.current=null;grantOperation.current=null;
    setNotice('Loaded an existing owner-private frozen request. Public delivery is still disabled.');
  }
  const grantExpired=grant!==null && Date.parse(grant.expiresAt)<=Date.now();
  return <section aria-labelledby="release-title" data-release-mode={mode} className="ws-owner-page ws-release-page">
    <div className="ws-heading">
      <a href={base+'/edit'}>Back to portfolio editor</a>
      <p className="ws-kicker">PORTFOLIO RELEASE</p><h1 id="release-title">{routes[mode]}.</h1>
      {record && <p>{record.title} · Saved draft revision {record.revision}</p>}
      <p>Drafts and prepared candidates remain private. External publication needs a separately verified host.</p>
    </div>
    <nav className="ws-profile-tabs ws-release-steps" aria-label="Release steps">
      {(Object.keys(routes) as ReleaseMode[]).map(step=><a className="ws-secondary" key={step}
        aria-current={step===mode?'page':undefined} href={base+'/'+step}>{routes[step]}</a>)}
    </nav>
    {error && <p role="alert" className="ws-inline-alert">{error}</p>}
    {notice && <p role="status" className="ws-field-hint">{notice}</p>}
    {!record && !error && <p role="status">Loading private release details…</p>}
    {error && <button type="button" className="ws-secondary" onClick={()=>{setError('');setRetry(value=>value+1);}}>
      Retry private release check</button>}
    {record && <div className="ws-project-detail ws-owner-columns">
      {mode==='staging' && <aside className="ws-project-aside ws-release-visual" aria-labelledby="staging-visual-title">
        <p className="ws-kicker">REVISION APPEARANCE</p>
        <h2 id="staging-visual-title">What the reviewer would see</h2>
        <p>This is a read-only owner simulation. A shareable reviewer route requires independently verified host delivery.</p>
        <p className="ws-release-preview-label">{frozen
          ? 'Frozen revision '+frozen.revision+' · '+(pinnedPreviewPending?'Verifying…':'Pinned private request')
          : 'Current saved draft · Not yet frozen'}</p>
        {pinnedPreviewPending && <p role="status">Verifying the exact private revision…</p>}
        {pinnedPreviewError && <p role="alert">{pinnedPreviewError}</p>}
        {(!frozen || (pinnedPreview&&!pinnedPreviewPending&&!pinnedPreviewError)) &&
          (frozen?pinnedPreview:record.snapshot)
          ? <div className="ws-release-visual-canvas">
              <PortfolioCanvas snapshot={frozen?pinnedPreview:record.snapshot} title={record.title} simulation/>
            </div>
          : !pinnedPreviewPending&&!pinnedPreviewError && <p>No saved portfolio content is available for this private preview.</p>}
        <div className="ws-release-visual-foot">
          <strong>Private preview only</strong>
          <p>No reviewer token or public link is exposed. Custom source is not executed in this canvas.</p>
          <button type="button" className="ws-secondary" disabled>Copy public link unavailable</button>
        </div>
      </aside>}
      {mode==='publish' && <section className="ws-project-aside ws-release-preflight-gates" aria-labelledby="preflight-checks-title">
        <p className="ws-kicker">RELEASE GATES</p>
        <h2 id="preflight-checks-title">Preflight checks</h2>
        <p>Only checks executed against a verified frozen revision are reported as passed.
          Public delivery is a separate host proof.</p>
        {result ? <PreflightResults result={result} portfolioId={id}/> : <div aria-label="Unrun release checks">
          <p role="status">Not evaluated. Select a saved revision and run private preflight.</p>
          <ul className="ws-release-unrun-checks">
            {['Revision and snapshot integrity','Content and required slots','Metadata and links',
              'Accessible static structure','Static output and delivery safety'].map(name=><li key={name}>
              <span>{name}</span><span>Not checked</span>
            </li>)}
          </ul>
        </div>}
      </section>}
      <div className="ws-project-fields">
        {mode==='share'?<>
          <h2>Public sharing controls</h2>
          <p>These controls require a separately verified release. An editor URL, a private review grant and a prepared pointer are not shareable public links.</p>
          <div className="ws-release-action">
            <h3>Release visibility</h3>
            <dl className="ws-release-facts">
              <dt>Private</dt><dd>Only authenticated owner access. Never copy the author-preview URL as a public link.</dd>
              <dt>Unlisted</dt><dd>A real published address may be shared by its holder, but it is not a private access-control mechanism.</dd>
              <dt>Public</dt><dd>Requires explicit consent, verified host delivery and correct indexability before sharing.</dd>
              <dt>Current pointer</dt><dd>{pointer ? pointer.status==='BLOCKED'?'No active private candidate':'Private candidate prepared; not live'
                : error?'Status could not be verified':'Checking private pointer…'}</dd>
            </dl>
          </div>
          <div className="ws-release-action">
            <h3>Share a verified address</h3>
            <p>There is no host-attested public URL on this owner route. Copy and native sharing are unavailable until publication, consent and revocation checks pass.</p>
            <div className="ws-release-actions">
              <button type="button" className="ws-secondary" disabled>Copy verified public URL</button>
              <button type="button" className="ws-secondary" disabled>Share verified public URL</button>
            </div>
            <p className="ws-field-hint">The absence of a public URL is not a failure of your private saved portfolio.</p>
          </div>
        </> : mode==='releases'?<>
          <h2>Private release pointer</h2>
          {pointer ? <>
            <dl className="ws-release-facts">
              <dt>Candidate status</dt><dd>{pointer.status==='BLOCKED'?'Blocked':'Prepared privately, not published'}</dd>
              <dt>Generation</dt><dd>{pointer.generation}</dd>
              <dt>Revocation generation</dt><dd>{pointer.revocationGeneration}</dd>
              <dt>Public delivery</dt><dd>Not enabled</dd>
              <dt>Host revocation</dt><dd>Awaiting verification</dd>
            </dl>
            {pointer.status==='PREPARED_PRIVATE' && <div className="ws-release-action">
              <h3>Withdraw private candidate</h3>
              <p>Only the private candidate pointer is affected. The saved draft remains intact. This does not unpublish or invalidate a public CDN artifact.</p>
              {!confirmBlock ? <button type="button" className="ws-secondary" onClick={()=>setConfirmBlock(true)}>
                Review private block</button> : <div className="ws-release-confirm">
                <p>Block this private candidate?</p>
                <button type="button" className="ws-primary" disabled={busy} onClick={()=>void blockCandidate()}>
                  {busy?'Checking…':'Confirm private block'}</button>
                <button type="button" className="ws-secondary" disabled={busy} onClick={()=>setConfirmBlock(false)}>Cancel</button>
              </div>}
            </div>}
          </> : !error && <p role="status">Checking the release pointer…</p>}
          <h3>Release history and rollback</h3>
          <p>A verified live release timeline and rollback target are unavailable here. Private frozen requests below are not published releases.</p>
          <FrozenRequestHistory requests={frozenRequests} error={frozenListError} />
          <p className="ws-field-hint">A rollback requires a previously host-attested live release, a guarded pointer change and new GET/HEAD plus media verification. None is inferred from a private frozen request.</p>
        </> : <>
          <h2>{mode==='staging'?'Prepare a frozen reviewer revision':'Inspect a saved revision'}</h2>
          <p>Freeze a selected immutable saved revision with its content digest. Unsaved editor changes are not included.</p>
          {revisionError && <p role="alert">{revisionError}</p>}
          <label>Saved revision
            <select aria-label="Saved revision" value={selectedRevision??''} disabled={busy||!!frozen||!revisions?.length}
              onChange={event=>{
                const next=Number(event.target.value);
                setSelectedRevision(revisions?.some(row=>row.revision===next)?next:null);
                operation.current=null;setResult(null);
              }}>
              {selectedRevision===null && <option value="">Select a saved revision</option>}
              {revisions?.map(row=><option key={row.revision} value={row.revision}>
                Revision {row.revision} · {new Date(row.createdAt).toLocaleString()}
              </option>)}
            </select>
          </label>
          {revisions?.length===50 && <p className="ws-field-hint">Showing the latest 50 saved revisions.</p>}
          <label>Future visibility intent
            <select value={visibility} disabled={busy||!!frozen} onChange={event=>{
              setVisibility(event.target.value==='PUBLIC'?'PUBLIC':'UNLISTED');
              operation.current=null;
            }}><option value="UNLISTED">Unlisted (not activated)</option>
              <option value="PUBLIC">Public (not activated)</option></select>
          </label>
          <button type="button" className="ws-primary" disabled={busy||selectedRevision===null||(mode==='staging'&&!!frozen)}
            onClick={()=>void inspect()}>{busy?'Checking…':mode==='staging'?'Freeze private revision':'Run private preflight'}</button>
          {frozen && <div className="ws-release-action">
            <p role="status">Private revision {frozen.revision} frozen.</p>
            <dl className="ws-release-facts">
              <dt>Visibility request</dt><dd>{frozen.visibilityIntent==='PUBLIC'?'Public intent only':'Unlisted intent only'}</dd>
              <dt>Source digest</dt><dd><code>{frozen.snapshotSha256.slice(0,16)}…</code></dd>
              <dt>Public URL</dt><dd>Not issued</dd>
            </dl>
            {(mode==='staging'||mode==='publish') && (!grant||grant.status==='REVOKED') &&
              <button type="button" className="ws-secondary" disabled={busy}
                onClick={()=>{
                  // A private preflight may examine another saved revision without
                  // reusing an old immutable freeze/digest or its idempotency key.
                  // Revoked grants stay revoked in the stored grant history.
                  setFrozen(null);setResult(null);setGrant(null);setConfirmRevoke(false);
                  operation.current=null;grantOperation.current=null;
                }}>Choose another saved revision or visibility intent</button>}
          </div>}
          <FrozenRequestHistory requests={frozenRequests} error={frozenListError}
            onSelect={!busy?selectFrozenRequest:undefined} activeRequestId={frozen?.requestId} />
          {mode==='staging' && <section className="ws-release-action" aria-labelledby="reviewer-history-title">
            <h3 id="reviewer-history-title">Registered reviewer grants</h3>
            <p>Owner-only metadata can be recovered after a reload. Raw reviewer credentials are never returned in this list.</p>
            {grantListError && <p role="alert">{grantListError}</p>}
            {grants===null && !grantListError && <p role="status">Loading private reviewer grant records…</p>}
            {grants?.length===0 && <p>No reviewer grants have been registered.</p>}
            {!!grants?.length && <ul className="ws-release-grant-list">{grants.map(item=><li key={item.grantId}>
              <div><strong>{item.revokedAt?'Revoked':Date.parse(item.expiresAt)<=Date.now()?'Expired':'Registered (not servable)'}</strong>
                <p>Created <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>.
                  Expires <time dateTime={item.expiresAt}>{new Date(item.expiresAt).toLocaleString()}</time>.</p>
                <p>Private frozen request {item.requestId.slice(0,8)}…</p></div>
              {!item.revokedAt && <button type="button" className="ws-secondary" disabled={busy}
                onClick={()=>{setGrant({grantId:item.grantId,expiresAt:item.expiresAt,status:'REGISTERED_UNSERVABLE'});
                  setConfirmRevoke(true);}}>Review revocation</button>}
            </li>)}</ul>}
          </section>}
          {mode==='staging' && (frozen || grant) && <div className="ws-release-action" aria-labelledby="reviewer-grant-title">
            <h3 id="reviewer-grant-title">Reviewer access</h3>
            <p>Register a time-limited owner-private grant. No reviewer URL can be shared until host authorization, expiry and revocation are proven.</p>
            {!grant ? <>
              <label>Grant lifetime<select disabled={busy} value={validMinutes}
                onChange={event=>{setValidMinutes(Number(event.target.value));grantOperation.current=null;}}>
                <option value={30}>30 minutes</option><option value={60}>1 hour</option>
                <option value={1440}>24 hours</option></select></label>
              <button type="button" className="ws-secondary" disabled={busy} onClick={()=>void registerReviewer()}>
                {busy?'Registering…':'Register private reviewer grant'}</button>
            </> : <>
              <dl className="ws-release-facts">
                <dt>Grant state</dt><dd>{grant.status==='REVOKED'?'Revoked':grantExpired?'Expired':'Registered; not externally servable'}</dd>
                <dt>Expires</dt><dd><time dateTime={grant.expiresAt}>{new Date(grant.expiresAt).toLocaleString()}</time></dd>
                <dt>Reviewer URL</dt><dd>Disabled pending host verification</dd>
              </dl>
              {grant.status!=='REVOKED' && !confirmRevoke && <button type="button" className="ws-secondary"
                onClick={()=>setConfirmRevoke(true)}>Revoke private reviewer grant</button>}
              {grant.status==='REVOKED' && frozen && <button type="button" className="ws-secondary"
                onClick={()=>{setGrant(null);grantOperation.current=null;}}>Register another reviewer grant</button>}
              {confirmRevoke && grant.status!=='REVOKED' && <div className="ws-release-confirm">
                <p>Revoke this private grant? The saved snapshot will remain available to its owner.</p>
                <button type="button" className="ws-primary" disabled={busy} onClick={()=>void revokeReviewer()}>
                  {busy?'Revoking…':'Confirm reviewer revocation'}</button>
                <button type="button" className="ws-secondary" disabled={busy} onClick={()=>setConfirmRevoke(false)}>Cancel</button>
              </div>}
            </>}
          </div>}
          {mode==='publish' && <div className="ws-release-action" aria-labelledby="publication-controls-title">
            <h3 id="publication-controls-title">Exposure and publication</h3>
            <p>Visibility above is an intent for a future release, not the current exposure of this private draft.
              No canonical URL or live SEO projection has been issued.</p>
            <dl className="ws-release-facts"><dt>Public URL</dt><dd>Unavailable until host verification</dd>
              <dt>Release status</dt><dd>Private · Not published</dd>
              <dt>SEO metadata</dt><dd>Read from the selected revision only during preflight</dd></dl>
            <div className="ws-actions">
              {result?.status==='PREVIEW_ONLY' && <button className="ws-primary" type="button" disabled={busy}
                onClick={()=>void downloadStaticPreview()}>Download offline static preview ZIP</button>}
              <button className="ws-secondary" type="button" disabled>Publish unavailable — host proof required</button>
            </div>
          </div>}
        </>}
      </div>
      {mode!=='staging' && mode!=='publish' && <aside className="ws-project-aside">
        <h2>Delivery &amp; sharing</h2>
        <p>No public or reviewer address is verified. An owner preview is not a shareable release.</p>
        <dl className="ws-release-facts"><dt>Owner preview</dt><dd>Private to your signed-in account</dd>
          <dt>Reviewer delivery</dt><dd>Host proof required</dd>
          <dt>Public release</dt><dd>Not verified</dd></dl>
        <div className="ws-release-actions">
          <a className="ws-secondary" href={base+'/preview/fullscreen'} target="_blank" rel="noopener">Open private author preview</a>
          <button type="button" className="ws-secondary" disabled title="No verified public release exists">Copy public link unavailable</button>
        </div>
        <p className="ws-field-hint">Nothing on this page activates external sharing. Private, unlisted and public are delivery policies, not just labels.</p>
      </aside>}
    </div>}
  </section>;
}


function FrozenRequestHistory({requests,error,onSelect,activeRequestId}:{
  requests:OwnerFrozenRequest[]|null;error:string;
  onSelect?:(request:OwnerFrozenRequest)=>void;activeRequestId?:string
}) {
  return <section className="ws-release-action" aria-labelledby="frozen-history-title">
    <h3 id="frozen-history-title">Frozen private requests</h3>
    <p>Immutable owner-only revision pins. These records do not prove reviewer delivery, public hosting, release history or rollback.</p>
    {error && <p role="alert">{error}</p>}
    {requests===null&&!error&&<p role="status">Loading frozen private requests…</p>}
    {requests?.length===0&&<p>No private revisions have been frozen.</p>}
    {!!requests?.length&&<ol className="ws-release-grant-list">{requests.map(request=>
      <li key={request.requestId}>
        <div>
          <strong>Private revision {request.revision} · {request.visibilityIntent==='PUBLIC'?'Public intent':'Unlisted intent'}</strong>
          <p>Frozen <time dateTime={request.createdAt}>{new Date(request.createdAt).toLocaleString()}</time></p>
          <p>Snapshot fingerprint <code>{request.snapshotSha256.slice(0,12)}…</code> · Not published</p>
        </div>
        {onSelect&&<button type="button" className="ws-secondary"
          aria-pressed={activeRequestId===request.requestId}
          onClick={()=>onSelect(request)}>
          {activeRequestId===request.requestId?'Frozen request selected':'Use frozen revision '+request.revision}
        </button>}
      </li>)}</ol>}
    {requests?.length===100&&<p className="ws-field-hint">Showing the newest 100 private freeze records.</p>}
  </section>;
}


/** A diagnostic is displayed only when emitted by the real frozen-snapshot
 * preflight engine. Never label an unexecuted check as passed. */
function PreflightResults({result,portfolioId}:{result:SafePreviewResult;portfolioId:string}) {
  return <section className="ws-release-action" aria-labelledby="preflight-results">
    <h3 id="preflight-results">Preflight results</h3>
    <p role="status">Private renderability check. No published release or host readiness proof.</p>
    <div className="ws-release-summary" role="group" aria-label="Private preflight summary">
      <div><span>Blocking errors</span><strong>{result.blockers.length}</strong></div>
      <div><span>Warnings</span><strong>{result.warnings.length}</strong></div>
      <div><span>Passed checks</span><strong>{result.passed.length}</strong></div>
    </div>
    {([
      ['Blocking errors',result.blockers],['Warnings',result.warnings],
      ['Checks performed and passed',result.passed]
    ] as const).map(([heading,items])=><div key={heading} className="ws-release-diagnostics">
      <h4>{heading} ({items.length})</h4>
      {items.length?<ul>{items.map((item,index)=><li key={item.code+':'+index}>
        <strong>{item.code}</strong>: {item.message}
        {item.code==='SEO_METADATA_REQUIRED'&&<span> · <a href={'/app/portfolios/'+portfolioId+'/edit?panel=Metadata'}>
          Edit SEO metadata in private editor</a></span>}
        </li>)}</ul>:<p>None in this category.</p>}
    </div>)}
    {result.previewHtml && <iframe title="Private scriptless preview" className="ws-private-static-preview"
      sandbox="" referrerPolicy="no-referrer" srcDoc={result.previewHtml}/>}
    <p className="ws-field-hint">Publication remains blocked until host proof and separate authorization.</p>
  </section>;
}
