import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {SupabaseBrowserAuthPort, OwnerPortfolio, OwnerReviewerGrantSummary, SavedOwnerRevision, OwnerFrozenRequest} from '../../auth-web/src/supabase-auth-port.ts';
import type {PrivateFrozenRequest, FrozenVisibilityIntent, PrivateReleaseAcknowledgement, PrivateReleaseAcknowledgementCursor, PrivateReleaseAcknowledgementPage} from '../../../packages/contracts/src/private-release-service.ts';
import type {AuthOutcome} from '../../../packages/contracts/src/auth-service.ts';
import type {PrivatePointerReceipt, PrivatePointerSnapshot} from '../../../packages/contracts/src/private-release-visibility-service.ts';
import {prepareSafeStaticPreview, type SafeSlotPlan, type SafeSlotKind, type SafePreviewResult} from '../../../packages/editor-core/src/publish-preflight.ts';
import {portfolioLayout} from '../../../packages/editor-core/src/managed-project-files.ts';
import type {PortfolioSnapshot} from '../../../packages/editor-core/src/portfolio-revision-transactions.ts';
import {PortfolioCanvas} from './portfolio-tools.tsx';
import {downloadPrivateFile} from './settings.tsx';
import type {LoadedPrivateFrozenRevision} from '../../../packages/storage-adapters/src/private-frozen-revision-loader.ts';

/** Use the same receipt predicate for every owner-private pin consumer.
 * The loader separately validates the RPC request ID and canonical JSON digest. */
function matchesFrozenPin(pin:LoadedPrivateFrozenRevision|null|undefined,request:Pick<PrivateFrozenRequest,'portfolioId'|'revision'|'snapshotSha256'|'visibilityIntent'>):pin is LoadedPrivateFrozenRevision {
  return !!pin && pin.loadedPortfolioId===request.portfolioId &&
    pin.loadedRevision===request.revision && pin.loadedSnapshotSha256===request.snapshotSha256 &&
    pin.frozen.portfolioId===request.portfolioId && pin.frozen.revision===request.revision &&
    pin.frozen.snapshotSha256===request.snapshotSha256 && pin.frozen.visibilityIntent===request.visibilityIntent &&
    pin.frozen.status==='FROZEN' && pin.frozen.publicUrl===null;
}

const routes = {staging:'Reviewer staging', publish:'Publish preflight', releases:'Releases & rollback', share:'Sharing controls'} as const;
type ReleaseMode = keyof typeof routes;
type SafeGrant = {grantId:string;requestId:string;expiresAt:string;status:'REGISTERED_UNSERVABLE'|'REVOKED'};
type BlockAttempt={operationId:string;target:PrivatePointerSnapshot;receipt:PrivatePointerReceipt|null};
/** This is a best-effort precheck, not an atomic server CAS. */
function samePreparedPointer(a:PrivatePointerSnapshot,b:PrivatePointerSnapshot):boolean {
  return a.portfolioId===b.portfolioId&&a.status==='PREPARED_PRIVATE'&&b.status==='PREPARED_PRIVATE'&&
    a.generation===b.generation&&a.revocationGeneration===b.revocationGeneration&&
    a.candidateRequestId===b.candidateRequestId&&a.candidateManifestSha256===b.candidateManifestSha256;
}
type SnapshotDelta={key:string;kind:'Added'|'Removed'|'Changed';beforeBytes:number|null;afterBytes:number|null;fields?:string[]};
type FrozenComparison={
  requestId:string; frozenRevision:number; draftRevision:number;
  files:SnapshotDelta[];slots:SnapshotDelta[];stashes:SnapshotDelta[];
  frozenSnapshot:PortfolioSnapshot;draftSnapshot:PortfolioSnapshot;title:string;
};
function canonicalValue(value:unknown):string|undefined {
  return JSON.stringify(value,(_key,item:unknown)=>{
    if(item&&typeof item==='object'&&!Array.isArray(item))
      return Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0));
    return item;
  });
}
/** Reopen an archive without executing or persisting its authored source.
 * Compare all snapshot fields, including opaque text, slot and stash content. */
async function reopenFrozenArchive(file:File,expected:PortfolioSnapshot):
    Promise<{sha256:string;files:number;slots:number;stashes:number}> {
  if(!Number.isSafeInteger(file.size)||file.size<22||file.size>2*1024*1024)
    throw new Error('Invalid private source archive size.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(bytes.byteLength!==file.size)throw new Error('Incomplete source archive read.');
  const {importPortfolioSourceZip}=await import('../../../packages/storage-adapters/src/portable-source-archive.ts');
  const snapshot=importPortfolioSourceZip(bytes);
  if(canonicalValue(snapshot)!==canonicalValue(expected))
    throw new Error('Archive does not match this frozen snapshot.');
  const digest=await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes));
  return {sha256:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join(''),
    files:Object.keys(snapshot.files).length,slots:Object.keys(snapshot.slots).length,
    stashes:Object.keys(snapshot.stashes).length};
}
function snapshotDelta<T>(before:Record<string,T>,after:Record<string,T>):SnapshotDelta[]{
  return [...new Set([...Object.keys(before),...Object.keys(after)])].sort().flatMap<SnapshotDelta>(key=>{
    const hasBefore=Object.hasOwn(before,key),hasAfter=Object.hasOwn(after,key);
    const oldValue=before[key],newValue=after[key];
    const oldCanonical=hasBefore?canonicalValue(oldValue):undefined;
    const newCanonical=hasAfter?canonicalValue(newValue):undefined;
    if(hasBefore&&hasAfter&&oldCanonical===newCanonical)return [];
    const count=(value:T|undefined,encoded:string|undefined)=>encoded===undefined?null:
      new TextEncoder().encode(typeof value==='string'?value:encoded).byteLength;
    let fields:string[]|undefined;
    if(oldValue&&newValue&&typeof oldValue==='object'&&typeof newValue==='object'&&
       !Array.isArray(oldValue)&&!Array.isArray(newValue)){
      const left=oldValue as Record<string,unknown>,right=newValue as Record<string,unknown>;
      fields=[...new Set([...Object.keys(left),...Object.keys(right)])].sort()
        .filter(field=>canonicalValue(left[field])!==canonicalValue(right[field]));
    }
    return [{key,kind:!hasBefore?'Added':!hasAfter?'Removed':'Changed',
      beforeBytes:count(oldValue,oldCanonical),afterBytes:count(newValue,newCanonical),fields}];
  });
}
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

export function PortfolioRelease(props:{port:SupabaseBrowserAuthPort;id:string;mode:ReleaseMode}) {
  // Never inherit an old action/canvas across portfolio or release-step changes.
  // Same-port principal changes still require the workspace's owner epoch gate.
  return <PortfolioReleaseContent key={props.id+':'+props.mode} {...props}/>;
}

function PortfolioReleaseContent({port,id,mode}:{port:SupabaseBrowserAuthPort;id:string;mode:ReleaseMode}) {
  const [readPhase,setReadPhase]=useState<'portfolio'|'revisions'|'history'|'grants'|'pointer'|null>(null);
  const [record,setRecord]=useState<(OwnerPortfolio & {snapshot:PortfolioSnapshot|null})|null>(null);
  const [revisions,setRevisions]=useState<SavedOwnerRevision[]|null>(null);
  const [frozenRequests,setFrozenRequests]=useState<OwnerFrozenRequest[]|null>(null);
  const [frozenListError,setFrozenListError]=useState('');
  const [selectedRevision,setSelectedRevision]=useState<number|null>(null);
  const [revisionError,setRevisionError]=useState('');
  const [pointer,setPointer]=useState<PrivatePointerSnapshot|null>(null);
  const [visibility,setVisibility]=useState<FrozenVisibilityIntent>('UNLISTED');
  const [frozen,setFrozen]=useState<PrivateFrozenRequest|null>(null);
  const [pinnedPreviewReceipt,setPinnedPreviewReceipt]=useState<{requestId:string;snapshot:PortfolioSnapshot}|null>(null);
  const pinnedPreview=frozen&&pinnedPreviewReceipt?.requestId===frozen.requestId?pinnedPreviewReceipt.snapshot:null;
  const [pinnedPreviewPending,setPinnedPreviewPending]=useState(false);
  const [pinnedPreviewError,setPinnedPreviewError]=useState('');
  const [pinReadRetry,setPinReadRetry]=useState(0);
  const [historySelection,setHistorySelection]=useState<OwnerFrozenRequest|null>(null);
  const [ackSelection,setAckSelection]=useState<PrivateReleaseAcknowledgement|null>(null);
  const [historySelectionPending,setHistorySelectionPending]=useState(false);
  const [historySelectionError,setHistorySelectionError]=useState('');
  const [result,setResult]=useState<SafePreviewResult|null>(null);
  const [comparison,setComparison]=useState<FrozenComparison|null>(null);
  const [editableConsent,setEditableConsent]=useState<string|null>(null);
  const [sourceArchiveSha,setSourceArchiveSha]=useState<{requestId:string;sha256:string}|null>(null);
  const [staticArchiveSha,setStaticArchiveSha]=useState<{requestId:string;sha256:string;htmlSha256:string}|null>(null);
  const [grant,setGrant]=useState<SafeGrant|null>(null);
  const [grants,setGrants]=useState<OwnerReviewerGrantSummary[]|null>(null);
  // A confirmed database revocation is terminal for this grant ID. Keep the
  // local acknowledgement even if the subsequent catalogue refresh fails.
  const [revokedGrantIds,setRevokedGrantIds]=useState<ReadonlySet<string>>(()=>new Set());
  const [grantListError,setGrantListError]=useState('');
  const [validMinutes,setValidMinutes]=useState(60);
  const [grantNow,setGrantNow]=useState(()=>Date.now());
  const [confirmRevoke,setConfirmRevoke]=useState(false);
  const [confirmBlock,setConfirmBlock]=useState<PrivatePointerSnapshot|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [retry,setRetry]=useState(0);
  const operation=useRef<string|null>(null);
  const grantOperation=useRef<string|null>(null);
  const blockOperation=useRef<BlockAttempt|null>(null);
  const blockFlight=useRef<object|null>(null);
  const historySelectionEpoch=useRef(0);
  const routeEpoch=useRef(0);
  useLayoutEffect(()=>{
    routeEpoch.current+=1;
    return ()=>{routeEpoch.current+=1;historySelectionEpoch.current+=1;};
  },[port,id,mode]);
  const base='/app/portfolios/'+id;
  const readsBusy=busy||historySelectionPending||readPhase!==null;
  const retryPrivateReads=()=>setRetry(value=>value+1);

  // Reset only when the owner/route identity changes, not on Retry. A retry
  // must preserve the frozen request and its idempotency key after an
  // acknowledgement may have been lost over the network.
  useEffect(()=>{
    historySelectionEpoch.current+=1;
    setHistorySelection(null);setAckSelection(null);setHistorySelectionPending(false);setHistorySelectionError('');
    setPinReadRetry(0);
    setReadPhase(null);setRecord(null);setRevisions(null);setFrozenRequests(null);setFrozenListError('');
    setSelectedRevision(null);setRevisionError('');setPointer(null);
    setVisibility('UNLISTED');setFrozen(null);setPinnedPreviewReceipt(null);
    setPinnedPreviewPending(false);setPinnedPreviewError('');setResult(null);
    setComparison(null);setEditableConsent(null);setSourceArchiveSha(null);setStaticArchiveSha(null);
    setGrant(null);setGrants(null);setRevokedGrantIds(new Set());setGrantListError('');
    setConfirmRevoke(false);setConfirmBlock(null);setNotice('');setError('');setBusy(false);
    operation.current=null;grantOperation.current=null;blockOperation.current=null;blockFlight.current=null;
  },[port,id,mode]);

  useEffect(()=>{
    let active=true;
    setError('');setReadPhase('portfolio');
    void (async()=>{
      try {
        const reply=await port.readOwnerPortfolio(id);
        if (!active) return;
        if (!reply.data) {setError(reply.error?.message ?? 'Portfolio unavailable.');return;}
        setRecord(reply.data);
        setComparison(previous=>previous&&previous.draftRevision!==reply.data!.revision?null:previous);
        if (mode==='staging'||mode==='publish'||mode==='releases') {
          setReadPhase('revisions');
          const saved=await port.listOwnerPortfolioRevisions(id);
          if (!active) return;
          if (saved.data) {
            setRevisions(saved.data.filter(row=>row.revision<=reply.data!.revision));
            // Preserve a verified historical revision on an ordinary list Retry.
            setSelectedRevision(previous=>previous ?? (saved.data!.some(row=>row.revision===reply.data!.revision)
              ? reply.data!.revision : null));
            setRevisionError('');
          } else setRevisionError(saved.error?.message ?? 'The saved-revision catalogue is unavailable.');
        }
        if (mode==='staging'||mode==='publish'||mode==='releases') {
          setReadPhase('history');
          const history=await port.listOwnerFrozenRequests(id);
          if (!active) return;
          if (history.data) {setFrozenRequests(history.data);setFrozenListError('');}
          else setFrozenListError(history.error?.message ?? 'Frozen request history could not be loaded.');
        }
        if (mode==='staging') {
          setReadPhase('grants');
          const list=await port.listOwnerReviewerGrants(id);
          if (!active) return;
          if (list.data) {setGrants(list.data);setGrantListError('');}
          else setGrantListError(list.error?.message ?? 'Existing reviewer grants are unavailable.');
          return;
        }
        if (mode!=='releases' && mode!=='share') return;
        setReadPhase('pointer');
        const status=await port.readOwnerRelease(id);
        if (!active) return;
        if (status.data) {setPointer(status.data);setError('');}
        else setError(status.error?.message ?? 'Private release status unavailable.');
      } catch {
        if (active) setError('The private release service could not be reached.');
      } finally {if(active)setReadPhase(null);}
    })();
    return ()=>{active=false;};
  },[port,id,mode,retry]);

  /** Distinguish an owner-only saved-head visual from the exact frozen pin.
   * Never show a fallback HEAD while labeling it as the selected revision. */
  useEffect(()=>{
    if (mode==='share'||!frozen) {
      setPinnedPreviewReceipt(null);setPinnedPreviewError('');setPinnedPreviewPending(false);
      return;
    }
    let active=true;
    setPinnedPreviewReceipt(null);setPinnedPreviewError('');setPinnedPreviewPending(true);
    void port.loadOwnerFrozenRelease(frozen.requestId).then(reply=>{
      if (!active) return;
      if (frozen.portfolioId!==id||!matchesFrozenPin(reply.data,frozen)) {
        setPinnedPreviewError('The exact frozen revision could not be verified. The current draft is not substituted.');
      } else setPinnedPreviewReceipt({requestId:frozen.requestId,snapshot:reply.data.snapshot});
    }).catch(()=>{
      if (active) setPinnedPreviewError('The pinned preview is temporarily unavailable. No public data was released.');
    }).finally(()=>{if(active)setPinnedPreviewPending(false);});
    return()=>{active=false;};
  },[port,id,mode,frozen,pinReadRetry]);

  async function downloadStaticPreview(){
    if (readsBusy || !frozen || historySelection!==null || ackSelection!==null || result?.status!=='PREVIEW_ONLY' || !result.previewHtml) return;
    const reviewedHtml=result.previewHtml;
    const epoch=routeEpoch.current;
    const current=()=>epoch===routeEpoch.current;
    setBusy(true);setError('');setNotice('');setStaticArchiveSha(null);
    try {
      const {exportStandaloneStaticPreview}=await import('../../../packages/storage-adapters/src/static-preview-export.ts');
      if (!current()) return;
      const {data}=await port.loadOwnerFrozenRelease(frozen.requestId);
      if (!current()) return;
      if (frozen.portfolioId!==id||!matchesFrozenPin(data,frozen)) throw new Error('Invalid frozen revision receipt.');
      const archive=await exportStandaloneStaticPreview({...data,plan:buildPlan(data.snapshot)},reviewedHtml);
      if (!current()) return;
      downloadPrivateFile('kadmeion-static-preview-revision-'+data.loadedRevision+'.zip',archive.zip,'application/zip');
      setStaticArchiveSha({requestId:frozen.requestId,sha256:archive.archiveSha256,htmlSha256:archive.htmlSha256});
      setNotice('Offline static preview download prepared. ZIP structure and HTML digest checked.');
    } catch {
      if (current()) {setResult(null);setError('The frozen revision could not be exported. Run preflight again to check eligibility.');}
    } finally {if (current()) setBusy(false);}
  }

  /** Compare authenticated saved snapshots, not a live site or unsaved buffer. */
  async function compareFrozenWithSaved(){
    if(!frozen||readsBusy||historySelection!==null||ackSelection!==null)return;
    const epoch=routeEpoch.current;
    const current=()=>epoch===routeEpoch.current;
    setBusy(true);setComparison(null);setError('');setNotice('');
    try{
      const pin=await port.loadOwnerFrozenRelease(frozen.requestId);
      if(!current())return;
      if(frozen.portfolioId!==id||!matchesFrozenPin(pin.data,frozen))
        throw new Error('Frozen revision not verified.');
      const draft=await port.readOwnerPortfolio(id);
      if(!current())return;
      if(!draft.data?.snapshot||draft.data.id!==id||!Number.isSafeInteger(draft.data.revision)||
         draft.data.revision<frozen.revision)throw new Error('Saved draft not verified.');
      const before=pin.data.snapshot,after=draft.data.snapshot;
      if(draft.data.revision===frozen.revision&&canonicalValue(before)!==canonicalValue(after))
        throw new Error('Same-revision snapshots disagree.');
      setComparison({requestId:frozen.requestId,frozenRevision:frozen.revision,
        draftRevision:draft.data.revision,files:snapshotDelta(before.files,after.files),
        slots:snapshotDelta(before.slots,after.slots),stashes:snapshotDelta(before.stashes,after.stashes),
        frozenSnapshot:before,draftSnapshot:after,title:draft.data.title});
    }catch{
      if(current())setError('The frozen revision and current saved draft could not both be verified. No comparison was produced.');
    }finally{if(current())setBusy(false);}
  }

  /** Bounded, importable private source format, not static rendered HTML. */
  async function downloadFrozenEditable(){
    if(!frozen||readsBusy||historySelection!==null||ackSelection!==null||editableConsent!==frozen.requestId)return;
    const epoch=routeEpoch.current;
    const current=()=>epoch===routeEpoch.current;
    setBusy(true);setError('');setNotice('');setSourceArchiveSha(null);
    try{
      const pin=await port.loadOwnerFrozenRelease(frozen.requestId);
      if(!current())return;
      if(frozen.portfolioId!==id||!matchesFrozenPin(pin.data,frozen))
        throw new Error('Frozen revision not verified.');
      const {exportPortfolioSourceZip,importPortfolioSourceZip}=await import('../../../packages/storage-adapters/src/portable-source-archive.ts');
      if(!current())return;
      const zip=exportPortfolioSourceZip(pin.data.snapshot);
      if(canonicalValue(importPortfolioSourceZip(zip))!==canonicalValue(pin.data.snapshot))
        throw new Error('Source archive round trip did not match.');
      const digest=await crypto.subtle.digest('SHA-256',Uint8Array.from(zip));
      if(!current())return;
      const sha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
      downloadPrivateFile('kadmeion-editable-frozen-revision-'+frozen.revision+'.zip',zip,'application/zip');
      setSourceArchiveSha({requestId:frozen.requestId,sha256});
      setEditableConsent(null);
      setNotice('Private editable source archive prepared and round-trip checked. It has not been published.');
    }catch{
      if(current())setError('The exact private source archive could not be verified or exported. No download was prepared.');
    }finally{if(current())setBusy(false);}
  }

  async function inspect(){
    if (!record?.revision || selectedRevision===null || readsBusy || historySelection!==null || ackSelection!==null) return;
    const epoch=routeEpoch.current;
    const current=()=>epoch===routeEpoch.current;
    setBusy(true);setError('');setNotice('');setResult(null);setStaticArchiveSha(null);
    try {
      let request=frozen;
      if (!request) {
        const selected=revisions?.find(row=>row.revision===selectedRevision);
        if (!selected) {setError('Select a verified saved revision before freezing.');return;}
        operation.current ??= crypto.randomUUID();
        const saved=await port.freezeOwnerRelease(id,operation.current,selectedRevision,visibility);
        if (!current()) return;
        if (!saved.data) {setError(saved.error?.message ?? 'Private freeze could not be confirmed.');return;}
        if (saved.data.portfolioId!==id||saved.data.revision!==selectedRevision||
            saved.data.snapshotSha256!==selected.snapshotSha256||saved.data.visibilityIntent!==visibility||
            saved.data.status!=='FROZEN'||saved.data.publicUrl!==null) {
          setError('The freeze receipt conflicts with the selected saved revision. Retry the same operation to recheck it.');
          return;
        }
        request=saved.data;
        setFrozen(request);
        try{
          const refreshed=await port.listOwnerFrozenRequests(id);
          if (!current()) return;
          if (refreshed.data) {setFrozenRequests(refreshed.data);setFrozenListError('');}
          else setFrozenListError('Private freeze succeeded, but its history could not be refreshed.');
        }catch{
          if(!current())return;
          setFrozenListError('Private freeze succeeded, but its history could not be refreshed.');
        }
      }
      if (mode==='staging') return;
      const evidence=await port.loadOwnerFrozenRelease(request.requestId);
      if (!current()) return;
      if (request.portfolioId!==id||!matchesFrozenPin(evidence.data,request)) {
        setError(evidence.error?.message ?? 'The saved revision and frozen digest do not agree.');return;
      }
      setResult(prepareSafeStaticPreview({...evidence.data,plan:buildPlan(evidence.data.snapshot)}));
    } catch {
      if (current()) setError('The frozen revision could not be checked. Nothing was published.');
    } finally {if (current()) setBusy(false);}
  }

  /** Registration is a real owner-scoped RPC, not a published reviewer URL.
   * Raw tokens are intentionally discarded, never placed in React state or
   * web storage, while host delivery remains unproven. */
  async function registerReviewer(){
    // A registration must never run before the owner has verified the exact
    // frozen revision. The draft or an unverifiable pin is not a substitute.
    if (!frozen || grant || readsBusy || mode!=='staging' || historySelection!==null ||
        pinnedPreviewPending || !pinnedPreview || !!pinnedPreviewError) return;
    const epoch=routeEpoch.current;
    const current=()=>epoch===routeEpoch.current;
    setBusy(true);setError('');setNotice('');
    try {
      // Recheck owner pin immediately before registering, not merely the old canvas.
      const pin=await port.loadOwnerFrozenRelease(frozen.requestId);
      if (!current()) return;
      if (frozen.portfolioId!==id||!matchesFrozenPin(pin.data,frozen)) {
        setPinnedPreviewReceipt(null);setPinnedPreviewError('The exact frozen revision could not be rechecked. Retry verification before registering.');
        return;
      }
      grantOperation.current ??= crypto.randomUUID();
      const response=await port.issueOwnerReviewerGrant(frozen.requestId,grantOperation.current,validMinutes);
      if (!current()) return;
      if (!response.data) {setError(response.error?.message ?? 'Reviewer registration was not confirmed.');return;}
      const {grantId,expiresAt}=response.data;
      const now=Date.now();
      if (response.data.requestId!==frozen.requestId||response.data.status!=='REGISTERED_UNSERVABLE'||
          !Number.isFinite(Date.parse(expiresAt))||
          (!response.data.alreadyRegistered&&Date.parse(expiresAt)<=now)) {
        setError('Reviewer registration receipt could not be verified. Retry the same operation.');
        return;
      }
      setGrantNow(now);
      setGrant({grantId,requestId:frozen.requestId,expiresAt,status:'REGISTERED_UNSERVABLE'});
      // A verified registration receipt is durable independently of the list
      // readback. Do not report it as failed or retain a spent operation key
      // just because refreshing the owner catalogue throws.
      grantOperation.current=null;
      setNotice(Date.parse(expiresAt)<=Date.now()
        ? 'The recorded reviewer grant has expired. No reviewer link is available.'
        : 'Private reviewer grant registered. The link remains disabled pending hosted delivery verification.');
      try{
        const updated=await port.listOwnerReviewerGrants(id);
        if (!current()) return;
        if (updated.data) {setGrants(updated.data);setGrantListError('');}
        else setGrantListError('Grant registered, but the owner-only saved-grant list could not be refreshed.');
      }catch{
        if(current())setGrantListError('Grant registered, but the owner-only saved-grant list could not be refreshed.');
      }
    } catch {if (current()) setError('Reviewer registration failed. Retry the same request.');}
    finally {if (current()) setBusy(false);}
  }

  async function revokeReviewer(){
    if (!grant || grant.status==='REVOKED' || revokedGrantIds.has(grant.grantId) || readsBusy || !confirmRevoke) return;
    const epoch=routeEpoch.current;
    const current=()=>epoch===routeEpoch.current;
    setBusy(true);setError('');setNotice('');
    try {
      const response=await port.revokeOwnerReviewerGrant(grant.grantId);
      if (!current()) return;
      if (!response.data||response.data.grantId!==grant.grantId||
          response.data.status!=='REVOKED'||response.data.publicRevocationVerified!==false) {
        setError(response.error?.message ?? 'Reviewer revocation was not confirmed.');return;
      }
      setRevokedGrantIds(previous=>new Set([...previous,grant.grantId]));
      setGrant(previous=>previous?.grantId===grant.grantId ? {...previous,status:'REVOKED'} : previous);
      // A confirmed revoke is terminal for this grant ID, even if the
      // subsequent catalogue read throws or returns an unavailable result.
      setConfirmRevoke(false);
      setNotice('Private reviewer grant revoked. External delivery revocation has not been independently verified.');
      try{
        const refreshed=await port.listOwnerReviewerGrants(id);
        if (!current()) return;
        if (refreshed.data) {setGrants(refreshed.data);setGrantListError('');}
        else setGrantListError('Revocation succeeded but the reviewer list could not be refreshed.');
      }catch{
        if(current())setGrantListError('Revocation succeeded but the reviewer list could not be refreshed.');
      }
    } catch {if (current()) setError('Reviewer revocation could not be checked. Retry safely.');}
    finally {if (current()) setBusy(false);}
  }

  async function blockCandidate(){
    const target=confirmBlock;
    if (!target||target.portfolioId!==id||target.status!=='PREPARED_PRIVATE'||readsBusy||blockFlight.current) return;
    const epoch=routeEpoch.current;
    const current=()=>epoch===routeEpoch.current;
    const flight={};
    blockFlight.current=flight;
    setBusy(true);setError('');setNotice('');
    try {
      let attempt=blockOperation.current;
      if(attempt&&!samePreparedPointer(attempt.target,target)){
        setError('A previous block request is unresolved. Review its saved operation before submitting another.');
        return;
      }
      // Once acknowledged, a retry is a readback only. Never send a second
      // block just because the subsequent read was interrupted.
      if(!attempt?.receipt){
        const before=await port.readOwnerRelease(id);
        if(!current())return;
        if(!before.data){
          setError('Could not recheck the current private pointer. No new block was submitted.');
          return;
        }
        setPointer(before.data);
        if(!samePreparedPointer(before.data,target)){
          blockOperation.current=null;setConfirmBlock(null);
          setError(attempt
            ?'The pointer changed while the previous block was unresolved. Its original outcome is not confirmed; no retry was submitted. Review the refreshed state.'
            :'The private pointer changed since your confirmation. No block was submitted. Review its current state before deciding again.');
          return;
        }
        attempt??={operationId:crypto.randomUUID(),target,receipt:null};
        blockOperation.current=attempt;
        const response=await port.blockOwnerReleaseCandidate(id,attempt.operationId);
        if(!current())return;
        if(!response.data){
          setError('The block was not acknowledged. Review and retry the same operation only if the pointer still matches.');
          return;
        }
        const receipt=response.data;
        if(receipt.portfolioId!==id||!Number.isSafeInteger(receipt.generation)||
           receipt.generation<1||typeof receipt.alreadyRecorded!=='boolean'||
           typeof receipt.stillBlocked!=='boolean'||
           (receipt.status==='BLOCKED')!==receipt.stillBlocked||
           receipt.publicServingEnabled!==false||receipt.publicUrl!==null||receipt.hostRevocationVerified!==false){
          setError('The block receipt could not be verified. The original operation is retained for review.');
          return;
        }
        attempt.receipt=receipt;
      }
      const receipt=attempt.receipt;
      const reread=await port.readOwnerRelease(id);
      if(!current())return;
      if(!reread.data||reread.data.portfolioId!==id||reread.data.generation<receipt.generation){
        setError('Block recorded, but the current private pointer could not be verified. Recheck the pointer without resubmitting the block.');
        return;
      }
      setPointer(reread.data);
      blockOperation.current=null;setConfirmBlock(null);
      const exact=reread.data.status==='BLOCKED'&&receipt.stillBlocked===true&&
        reread.data.generation===receipt.generation&&reread.data.revocationGeneration===receipt.generation;
      const expected=receipt.generation===target.generation+1;
      const state=reread.data.status==='BLOCKED'?'blocked':'prepared privately';
      setNotice((exact&&expected
        ?'Database block recorded and current pointer rechecked at generation '+receipt.generation+'.'
        :'Block recorded at generation '+receipt.generation+'; current pointer is '+state+' at generation '+reread.data.generation+'. The originally reviewed generation may have changed.')+
        ' External delivery revocation has not been verified.');
    } catch {
      if (current()) setError('The private block or its readback could not be confirmed. Review the retained operation before retrying.');
    } finally {
      if(blockFlight.current===flight){blockFlight.current=null;if(current())setBusy(false);}
    }
  }

  /** A latest-50 catalogue omission is not an authorization failure.
   * Reuse an older request only after checking the exact owner-RPC frozen pin. */
  async function selectFrozenRequest(request:OwnerFrozenRequest){
    if (readsBusy) return;
    setAckSelection(null);
    setComparison(null);setEditableConsent(null);setSourceArchiveSha(null);setStaticArchiveSha(null);
    const visible=revisions?.find(item=>item.revision===request.revision);
    if (request.portfolioId!==id||request.status!=='FROZEN'||
        (visible!==undefined&&visible.snapshotSha256!==request.snapshotSha256)) {
      // Reject even before the RPC when owner-listed metadata is inconsistent.
      // Retain an explicit failed selection so the current HEAD is not shown
      // as the requested historical pin after this rejection.
      historySelectionEpoch.current+=1;
      setHistorySelection(request);setHistorySelectionPending(false);
      setHistorySelectionError('The frozen request conflicts with owner revision metadata. No draft was substituted.');
      setFrozen(null);setPinnedPreviewReceipt(null);setPinnedPreviewError('');
      setResult(null);setGrant(null);setError('');setNotice('');
      return;
    }
    const epoch=++historySelectionEpoch.current;
    setHistorySelection(request);setHistorySelectionPending(true);setHistorySelectionError('');
    setFrozen(null);setPinnedPreviewReceipt(null);setPinnedPreviewError('');
    setError('');setNotice('');setResult(null);setConfirmRevoke(false);setGrant(null);
    try {
      const response=await port.loadOwnerFrozenRelease(request.requestId);
      if (epoch!==historySelectionEpoch.current) return;
      const pin=response.data;
      if (!matchesFrozenPin(pin,request)) {
        setHistorySelectionError(response.error?.message ??
          'The exact owner-private frozen revision could not be verified. No saved draft was substituted.');
        return;
      }
      // Selection becomes authoritative only after a matching owner pin read.
      // Staging separately reads the same immutable pin and fails closed.
      setSelectedRevision(request.revision);setVisibility(request.visibilityIntent);
      setFrozen({requestId:request.requestId,portfolioId:id,revision:request.revision,
        snapshotSha256:request.snapshotSha256,visibilityIntent:request.visibilityIntent,
        status:'FROZEN',publicUrl:null,alreadyFrozen:true});
      setHistorySelection(null);setHistorySelectionError('');
      operation.current=null;grantOperation.current=null;
      setNotice('Exact owner-private frozen revision verified. Public delivery remains disabled.');
    } catch {
      if (epoch===historySelectionEpoch.current)
        setHistorySelectionError('The frozen pin could not be loaded. No saved draft was substituted.');
    } finally {
      if (epoch===historySelectionEpoch.current) setHistorySelectionPending(false);
    }
  }

  /** A DB ACK identifies a request but is not itself an immutable pin or proof
   * of current delivery. Read the real owner pin even if its row is older than
   * the bounded frozen-request catalogue. The loader checks exact request ID.
   */
  async function selectAcknowledgedRequest(row:PrivateReleaseAcknowledgement){
    if(mode!=='releases'||readsBusy||row.portfolioId!==id)return;
    const epoch=++historySelectionEpoch.current;
    setHistorySelection(null);setAckSelection(row);setHistorySelectionPending(true);setHistorySelectionError('');
    setFrozen(null);setPinnedPreviewReceipt(null);setPinnedPreviewError('');setResult(null);
    setComparison(null);setEditableConsent(null);setSourceArchiveSha(null);setStaticArchiveSha(null);
    setGrant(null);setConfirmRevoke(false);setError('');setNotice('');
    try{
      const response=await port.loadOwnerFrozenRelease(row.requestId);
      if(epoch!==historySelectionEpoch.current)return;
      const pin=response.data;
      if(!pin||pin.frozen.portfolioId!==id||!matchesFrozenPin(pin,pin.frozen)||
         revisions?.some(item=>item.revision===pin.loadedRevision&&item.snapshotSha256!==pin.loadedSnapshotSha256)){
        setHistorySelectionError('The acknowledged frozen request could not be verified. No current draft was substituted.');
        return;
      }
      setSelectedRevision(pin.loadedRevision);setVisibility(pin.frozen.visibilityIntent);
      setFrozen({requestId:row.requestId,portfolioId:id,revision:pin.loadedRevision,
        snapshotSha256:pin.loadedSnapshotSha256,visibilityIntent:pin.frozen.visibilityIntent,
        status:'FROZEN',publicUrl:null,alreadyFrozen:true});
      setAckSelection(null);setHistorySelectionError('');
      operation.current=null;grantOperation.current=null;
      setNotice('Exact owner-private frozen revision verified from the historical acknowledgement. Current delivery remains unverified.');
    }catch{
      if(epoch===historySelectionEpoch.current)
        setHistorySelectionError('The acknowledged frozen request could not be loaded. Retry the exact owner read.');
    }finally{
      if(epoch===historySelectionEpoch.current)setHistorySelectionPending(false);
    }
  }

  function cancelHistoricalSelection(){
    historySelectionEpoch.current+=1;
    setHistorySelection(null);setAckSelection(null);setHistorySelectionPending(false);setHistorySelectionError('');
    setComparison(null);setEditableConsent(null);setSourceArchiveSha(null);setStaticArchiveSha(null);
    // Returning to the saved draft requires an explicit, listed selection;
    // do not leave an older absent-in-list revision silently selected.
    setSelectedRevision(revisions?.some(row=>row.revision===record?.revision)
      ? record!.revision : null);
    operation.current=null;
    setError('');setNotice('');
  }
  // A returned grant may expire while the owner stays on this page. Update
  // the local display at the nearest expiry and on focus; this is not a
  // server-side token authorization or hosted revocation check.
  useEffect(()=>{
    if (mode!=='staging') return;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const expiries=[...(grants??[]).filter(item=>!item.revokedAt).map(item=>item.expiresAt),
      ...(grant&&grant.status!=='REVOKED'?[grant.expiresAt]:[])].map(value=>Date.parse(value));
    function refresh(){
      if (timer!==undefined) clearTimeout(timer);
      const now=Date.now();
      setGrantNow(now);
      const next=Math.min(...expiries.filter(time=>Number.isFinite(time)&&time>now));
      if (Number.isFinite(next)) timer=setTimeout(refresh,Math.min(next-now+1,2147483647));
    }
    refresh();
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    return ()=>{
      if (timer!==undefined) clearTimeout(timer);
      window.removeEventListener('focus',refresh);
      document.removeEventListener('visibilitychange',refresh);
    };
  },[mode,grant,grants]);
  // Revocation may also have been recorded by another owner session.
  // A successful catalogue read can establish terminal state, but absence
  // from the bounded catalogue never establishes either active or revoked.
  useEffect(()=>{
    if(!grants)return;
    const terminalIds=new Set(grants.filter(item=>item.revokedAt!==null).filter(item=>!!item.revokedAt).map(item=>item.grantId));
    if(!terminalIds.size)return;
    setRevokedGrantIds(previous=>{
      if([...terminalIds].every(grantId=>previous.has(grantId)))return previous;
      return new Set([...previous,...terminalIds]);
    });
    setGrant(previous=>previous&&previous.status!=='REVOKED'&&terminalIds.has(previous.grantId)
      ? {...previous,status:'REVOKED'}:previous);
    if(grant&&terminalIds.has(grant.grantId))setConfirmRevoke(false);
  },[grants,grant]);
  const grantExpired=grant!==null && Date.parse(grant.expiresAt)<=grantNow;
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
    {!record && !error && readPhase==='portfolio' && <ReleasePending label="Loading private release details…" detail />}
    {error && <button type="button" className="ws-secondary" disabled={readsBusy} onClick={()=>{setError('');setRetry(value=>value+1);}}>
      Retry private release check</button>}
    {record && <div className="ws-project-detail ws-owner-columns">
      {mode==='staging' && <aside className="ws-project-aside ws-release-visual" aria-labelledby="staging-visual-title">
        <p className="ws-kicker">REVISION APPEARANCE</p>
        <h2 id="staging-visual-title">What the reviewer would see</h2>
        <p>This is a read-only owner simulation. A shareable reviewer route requires independently verified host delivery.</p>
        <p className="ws-release-preview-label">{historySelection
          ? 'Frozen revision '+historySelection.revision+' · Awaiting owner pin readback'
          : frozen
            ? 'Frozen revision '+frozen.revision+' · '+(pinnedPreviewPending?'Verifying…':pinnedPreview?'Verified owner-private pin':'Pin verification required')
            : 'Current saved draft · Not yet frozen'}</p>
        {historySelectionPending && !historySelectionError && <ReleasePending label="Verifying the historical frozen revision with the owner service…" detail />}
        {pinnedPreviewPending && !historySelectionPending && !pinnedPreviewError && !pinnedPreview && <ReleasePending label="Verifying the exact private revision…" detail />}
        {pinnedPreviewError && <p role="alert">{pinnedPreviewError}</p>}
        {pinnedPreviewError && frozen && !pinnedPreviewPending &&
          <button type="button" className="ws-secondary" disabled={busy}
            onClick={()=>setPinReadRetry(value=>value+1)}>Retry exact frozen revision</button>}
        {!historySelection && (!frozen || (pinnedPreview&&!pinnedPreviewPending&&!pinnedPreviewError)) &&
          (frozen?pinnedPreview:record.snapshot)
          ? <div className="ws-release-visual-canvas">
              <PortfolioCanvas snapshot={frozen?pinnedPreview:record.snapshot} title={record.title} simulation keyboardScroll/>
            </div>
          : !historySelection&&!pinnedPreviewPending&&!pinnedPreviewError &&
            <p>No saved portfolio content is available for this private preview.</p>}
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
        {result && frozen ? <PreflightResults result={result} portfolioId={id} revision={frozen.revision} mode="publish"/> : <div role="group" aria-label="Unrun release checks">
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
            {(pointer.status==='PREPARED_PRIVATE'||confirmBlock||blockOperation.current) && <div className="ws-release-action">
              <h3>Withdraw private candidate</h3>
              <p>Blocking the pointer withdraws its database delivery route and pending delivery state while preserving the saved draft. External HTTP and CDN revocation still require independent verification.</p>
              {!confirmBlock ? <button type="button" className="ws-secondary" disabled={readsBusy}
                onClick={()=>setConfirmBlock(blockOperation.current?.target??pointer)}>
                {blockOperation.current?'Review pending private block':'Review private block'}</button> : <div className="ws-release-confirm">
                <p>Block this private candidate reviewed at generation {confirmBlock.generation}?</p>
                <p className="ws-field-hint">The current pointer is rechecked before submission. The service blocks the current pointer without an atomic expected-generation condition; a concurrent update can still change the target. A recorded block is not proof of public revocation.</p>
                {blockOperation.current?.receipt&&<p role="status">A database receipt was recorded. Retry checks current state without submitting another block.</p>}
                <button type="button" className="ws-primary" disabled={readsBusy} onClick={()=>void blockCandidate()}>
                  {busy?'Checking…':blockOperation.current?.receipt?'Recheck private pointer':'Confirm private block'}</button>
                <button type="button" className="ws-secondary" disabled={busy} onClick={()=>setConfirmBlock(null)}>
                  {blockOperation.current?'Close review (keep operation)':'Cancel'}</button>
              </div>}
            </div>}
          </> : !error && readPhase==='pointer' && <ReleasePending label="Checking the release pointer…" />}
          <h3>Release history and rollback</h3>
          <p>Review private freeze records, historical database acknowledgements and the candidate pointer. Current public delivery and rollback require separate verification.</p>
          <ReleaseAcknowledgementHistory port={port} portfolioId={id} frozenRequests={frozenRequests}
            onSelect={row=>void selectAcknowledgedRequest(row)} selectionDisabled={readsBusy} />
          {pointer?.candidateRequestId && <dl className="ws-release-facts">
            <dt>Prepared candidate request</dt><dd><code style={{overflowWrap:'anywhere'}}>{pointer.candidateRequestId}</code></dd>
            <dt>Candidate manifest fingerprint</dt><dd><code style={{overflowWrap:'anywhere'}}>{pointer.candidateManifestSha256}</code></dd>
          </dl>}
          {revisionError&&<><p role="alert">{revisionError}</p><button type="button" className="ws-secondary" disabled={readsBusy}
            onClick={retryPrivateReads}>Retry saved revisions</button></>}
          <FrozenRequestHistory requests={frozenRequests} error={frozenListError} pending={readPhase==='history'}
            onRetry={retryPrivateReads} retryDisabled={readsBusy}
            onSelect={request=>void selectFrozenRequest(request)}
            selectionDisabled={readsBusy}
            activeRequestId={frozen?.requestId}
            candidateRequestId={pointer?.candidateRequestId??undefined} />
          {historySelection && <div className="ws-release-action" role="group" aria-label="Historical frozen pin verification">
            {historySelectionPending&&!historySelectionError&&<ReleasePending label="Verifying the exact private frozen revision…" />}
            {historySelectionError&&<p role="alert">{historySelectionError}</p>}
            {historySelectionError&&!historySelectionPending&&
              <button type="button" className="ws-secondary" disabled={readsBusy}
                onClick={()=>void selectFrozenRequest(historySelection)}>Retry historical owner pin</button>}
            <button type="button" className="ws-secondary" disabled={busy}
              onClick={cancelHistoricalSelection}>Cancel frozen pin selection</button>
          </div>}
          {ackSelection&&<div className="ws-release-action" role="group" aria-label="Acknowledged frozen pin verification">
            <p>Frozen request <code style={{overflowWrap:'anywhere'}}>{ackSelection.requestId}</code></p>
            {historySelectionPending&&!historySelectionError&&<ReleasePending label="Verifying the acknowledged frozen revision…" />}
            {historySelectionError&&<p role="alert">{historySelectionError}</p>}
            {historySelectionError&&!historySelectionPending&&<button type="button" className="ws-secondary" disabled={readsBusy}
              onClick={()=>void selectAcknowledgedRequest(ackSelection)}>Retry acknowledged owner pin</button>}
            <button type="button" className="ws-secondary" disabled={busy} onClick={cancelHistoricalSelection}>Cancel acknowledged pin selection</button>
          </div>}
          <button type="button" className="ws-secondary" disabled>Public rollback unavailable — host proof required</button>
          <p className="ws-field-hint">A rollback requires a previously host-attested live release, a guarded pointer change and new GET/HEAD plus media verification. None is inferred from a private frozen request.</p>
        </> : <>
          <h2>{mode==='staging'?'Prepare a frozen reviewer revision':'Inspect a saved revision'}</h2>
          <p>Freeze a selected immutable saved revision with its content digest. Unsaved editor changes are not included.</p>
          {revisionError && <><p role="alert">{revisionError}</p><button type="button" className="ws-secondary" disabled={readsBusy}
            onClick={retryPrivateReads}>Retry saved revisions</button></>}
          {revisions===null&&!revisionError&&readPhase==='revisions'&&<ReleasePending label="Loading saved revisions…" />}
          <label>Saved revision
            <select aria-label="Saved revision" value={selectedRevision??''} disabled={readsBusy||historySelection!==null||!!frozen||!revisions?.length}
              onChange={event=>{
                const next=Number(event.target.value);
                setSelectedRevision(revisions?.some(row=>row.revision===next)?next:null);
                operation.current=null;setResult(null);
              }}>
              {selectedRevision===null && <option value="">Select a saved revision</option>}
              {frozen && selectedRevision===frozen.revision &&
                !revisions?.some(row=>row.revision===frozen.revision) &&
                <option value={frozen.revision}>Frozen revision {frozen.revision} · verified historical pin</option>}
              {revisions?.map(row=><option key={row.revision} value={row.revision}>
                Revision {row.revision} · {new Date(row.createdAt).toLocaleString()}
              </option>)}
            </select>
          </label>
          {revisions?.length===50 && <p className="ws-field-hint">Showing the latest 50 saved revisions.</p>}
          <label>Future visibility intent
            <select value={visibility} disabled={readsBusy||historySelection!==null||!!frozen} onChange={event=>{
              setVisibility(event.target.value==='PUBLIC'?'PUBLIC':'UNLISTED');
              operation.current=null;
            }}><option value="UNLISTED">Unlisted (not activated)</option>
              <option value="PUBLIC">Public (not activated)</option></select>
          </label>
          <button type="button" className="ws-primary" disabled={readsBusy||historySelection!==null||selectedRevision===null||(mode==='staging'&&!!frozen)}
            onClick={()=>void inspect()}>{busy?'Checking…':mode==='staging'?'Freeze private revision':'Run private preflight'}</button>
          {frozen && <div className="ws-release-action">
            <p role="status">Private revision {frozen.revision} frozen.</p>
            <dl className="ws-release-facts">
              <dt>Visibility request</dt><dd>{frozen.visibilityIntent==='PUBLIC'?'Public intent only':'Unlisted intent only'}</dd>
              <dt>Source digest</dt><dd><code>{frozen.snapshotSha256.slice(0,16)}…</code></dd>
              <dt>Public URL</dt><dd>Not issued</dd>
            </dl>
            {(mode==='staging'||mode==='publish') && (!grant||grant.status==='REVOKED'||grantExpired) &&
              <button type="button" className="ws-secondary" disabled={busy}
                onClick={()=>{
                  // A private preflight may examine another saved revision without
                  // reusing an old immutable freeze/digest or its idempotency key.
                  // Revoked grants stay revoked in the stored grant history.
                  historySelectionEpoch.current+=1;
                  setHistorySelection(null);setHistorySelectionPending(false);setHistorySelectionError('');
                  setFrozen(null);setResult(null);setGrant(null);setConfirmRevoke(false);
                  setComparison(null);setEditableConsent(null);setSourceArchiveSha(null);setStaticArchiveSha(null);
                  setSelectedRevision(revisions?.some(row=>row.revision===record?.revision)
                    ? record!.revision : null);
                  operation.current=null;grantOperation.current=null;
                }}>Choose another saved revision or visibility intent</button>}
          </div>}
          <FrozenRequestHistory requests={frozenRequests} error={frozenListError} pending={readPhase==='history'}
            onRetry={retryPrivateReads} retryDisabled={readsBusy}
            onSelect={request=>void selectFrozenRequest(request)}
            selectionDisabled={readsBusy}
            activeRequestId={frozen?.requestId} />
          {historySelection && <div className="ws-release-action" role="group" aria-label="Historical frozen pin verification">
            {mode==='publish'&&historySelectionPending&&!historySelectionError&&<ReleasePending label="Verifying the exact private frozen revision…" />}
            {historySelectionError && <p role="alert">{historySelectionError}</p>}
            {historySelectionError && !historySelectionPending &&
              historySelection.portfolioId===id&&historySelection.status==='FROZEN'&&
              !revisions?.some(row=>row.revision===historySelection.revision&&
                row.snapshotSha256!==historySelection.snapshotSha256) &&
              <button type="button" className="ws-secondary" disabled={readsBusy}
                onClick={()=>void selectFrozenRequest(historySelection)}>Retry historical owner pin</button>}
            <button type="button" className="ws-secondary" disabled={busy}
              onClick={cancelHistoricalSelection}>Cancel frozen pin selection</button>
          </div>}
          {mode==='staging' && <section className="ws-release-action" role="group" aria-labelledby="reviewer-history-title">
            <h3 id="reviewer-history-title">Registered reviewer grants</h3>
            <p>Owner-only metadata can be recovered after a reload. Raw reviewer credentials are never returned in this list.</p>
            {grantListError && <><p role="alert">{grantListError}</p><button type="button" className="ws-secondary" disabled={readsBusy}
              onClick={retryPrivateReads}>Retry reviewer grant history</button></>}
            {grants===null && !grantListError && readPhase==='grants' && <ReleasePending label="Loading private reviewer grant records…" />}
            {grants?.length===0 && <p>No reviewer grants have been registered.</p>}
            {!!grants?.length && <ul className="ws-release-grant-list">{grants.map(item=><li key={item.grantId}>
              <div><strong>{(item.revokedAt||revokedGrantIds.has(item.grantId))?'Revoked':Date.parse(item.expiresAt)<=grantNow?'Expired':'Registered (not servable)'}</strong>
                <p>Created <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>.
                  Expires <time dateTime={item.expiresAt}>{new Date(item.expiresAt).toLocaleString()}</time>.</p>
                <p>Private frozen request {item.requestId.slice(0,8)}…</p></div>
              {!item.revokedAt && !revokedGrantIds.has(item.grantId) && <button type="button" className="ws-secondary" disabled={readsBusy}
                onClick={()=>{setGrantNow(Date.now());setGrant({grantId:item.grantId,requestId:item.requestId,expiresAt:item.expiresAt,status:'REGISTERED_UNSERVABLE'});
                  setConfirmRevoke(true);}}>Review revocation</button>}
            </li>)}</ul>}
          </section>}
          {mode==='staging' && (frozen || grant) && <div className="ws-release-action" role="group" aria-labelledby="reviewer-grant-title">
            <h3 id="reviewer-grant-title">Reviewer access</h3>
            <p>Register a time-limited owner-private grant. No reviewer URL can be shared until host authorization, expiry and revocation are proven.</p>
            {!grant ? <>
              <label>Grant lifetime<select disabled={readsBusy||!!grantOperation.current} value={validMinutes}
                onChange={event=>{setValidMinutes(Number(event.target.value));grantOperation.current=null;}}>
                <option value={30}>30 minutes</option><option value={60}>1 hour</option>
                <option value={1440}>24 hours</option></select></label>
              {grantOperation.current&&!busy&&<p className="ws-field-hint">Retry uses the same registration request and lifetime.</p>}
              {(!pinnedPreview || pinnedPreviewPending || !!pinnedPreviewError) &&
                <p role="status" className="ws-field-hint">
                  Verify the exact frozen revision above before registering a reviewer grant.
                  A loading or failed preview cannot be used as evidence.
                </p>}
              <button type="button" className="ws-secondary"
                disabled={readsBusy || historySelection!==null || pinnedPreviewPending || !pinnedPreview || !!pinnedPreviewError}
                onClick={()=>void registerReviewer()}>
                {busy?'Registering…':'Register private reviewer grant'}</button>
            </> : <>
              <dl className="ws-release-facts">
                <dt>Grant state</dt><dd>{grant.status==='REVOKED'?'Revoked':grantExpired?'Expired':'Registered; not externally servable'}</dd>
                <dt>Frozen request</dt><dd><code>{grant.requestId.slice(0,12)}…</code></dd>
                <dt>Expires</dt><dd><time dateTime={grant.expiresAt}>{new Date(grant.expiresAt).toLocaleString()}</time></dd>
                <dt>Reviewer URL</dt><dd>Disabled pending host verification</dd>
              </dl>
              {grant.status!=='REVOKED' && !confirmRevoke && <button type="button" className="ws-secondary"
                disabled={readsBusy} onClick={()=>setConfirmRevoke(true)}>Revoke private reviewer grant</button>}
              {(grant.status==='REVOKED'||grantExpired) && frozen && <button type="button" className="ws-secondary" disabled={busy||confirmRevoke}
                onClick={()=>{setGrant(null);setConfirmRevoke(false);grantOperation.current=null;}}>Register another reviewer grant</button>}
              {confirmRevoke && grant.status!=='REVOKED' && <div className="ws-release-confirm">
                <p>Revoke this private grant? The saved snapshot will remain available to its owner.</p>
                <button type="button" className="ws-primary" disabled={readsBusy} onClick={()=>void revokeReviewer()}>
                  {busy?'Revoking…':'Confirm reviewer revocation'}</button>
                <button type="button" className="ws-secondary" disabled={busy} onClick={()=>setConfirmRevoke(false)}>Cancel</button>
              </div>}
            </>}
          </div>}
          {mode==='publish' && <div className="ws-release-action" role="group" aria-labelledby="publication-controls-title">
            <h3 id="publication-controls-title">Exposure and publication</h3>
            <p>Visibility above is an intent for a future release, not the current exposure of this private draft.
              No canonical URL or live SEO projection has been issued.</p>
            <dl className="ws-release-facts"><dt>Public URL</dt><dd>Unavailable until host verification</dd>
              <dt>Release status</dt><dd>Private · Not published</dd>
              <dt>SEO metadata</dt><dd>Read from the selected revision only during preflight</dd></dl>
            <div className="ws-actions">
              {result?.status==='PREVIEW_ONLY' && <button className="ws-primary" type="button" disabled={readsBusy}
                onClick={()=>void downloadStaticPreview()}>Download offline static preview ZIP</button>}
              <button className="ws-secondary" type="button" disabled>Publish unavailable — host proof required</button>
            </div>
          </div>}
        </>}
        {(mode==='publish'||mode==='releases')&&frozen&&!historySelection&&
          <section className="ws-release-action" aria-labelledby="private-pin-preview-title">
            <h3 id="private-pin-preview-title">Owner-private preview of frozen revision {frozen.revision}</h3>
            <p>Read-only simulation of the exact verified frozen snapshot using the current portfolio title. It is not a published artifact or a host receipt.</p>
            {pinnedPreviewPending&&!pinnedPreviewError&&!pinnedPreview&&<ReleasePending label="Verifying the exact private revision…" detail />}
            {pinnedPreviewError&&<p role="alert">{pinnedPreviewError}</p>}
            {pinnedPreviewError&&!pinnedPreviewPending&&<button type="button" className="ws-secondary" disabled={busy}
              onClick={()=>setPinReadRetry(value=>value+1)}>Retry exact frozen revision</button>}
            {pinnedPreview&&!pinnedPreviewPending&&!pinnedPreviewError&&<div className="ws-release-visual-canvas">
              <PortfolioCanvas snapshot={pinnedPreview} title={record.title} simulation keyboardScroll/>
            </div>}
          </section>}
        {(mode==='staging'||mode==='publish'||mode==='releases')&&frozen&&!historySelection&&
          <section className="ws-release-action" aria-labelledby="private-comparison-title">
            <h3 id="private-comparison-title">Compare private revision {frozen.revision}</h3>
            <p>Compare the immutable pin with the latest saved owner draft, not a live website. Unsaved changes are excluded.</p>
            <button className="ws-secondary" type="button" disabled={readsBusy} onClick={()=>void compareFrozenWithSaved()}>
              {busy?'Checking…':'Compare frozen revision with saved draft'}</button>
            {comparison?.requestId===frozen.requestId&&<FrozenComparisonResults comparison={comparison}/>}
          </section>}
        {(mode==='publish'||mode==='releases')&&frozen&&!historySelection&&
          <section className="ws-release-action" aria-labelledby="private-portable-title">
            <h3 id="private-portable-title">Portable private exports</h3>
            <h4>Editable project source ZIP</h4>
            <p>Contains exact frozen project files, component assignments and stashes for editing or recovery. Importable as a private project, not a deployable site. Uploaded media bytes and other saved revisions are excluded.</p>
            <p>Private authored source may contain sensitive content. Review for credentials and third-party data before sharing. No browser session or token storage is copied.</p>
            <label><input type="checkbox" disabled={busy} checked={editableConsent===frozen.requestId}
              onChange={event=>setEditableConsent(event.target.checked?frozen.requestId:null)}/> I understand this ZIP contains private editable source.</label>
            <div className="ws-release-actions">
              <button className="ws-primary" type="button" disabled={readsBusy||editableConsent!==frozen.requestId}
                onClick={()=>void downloadFrozenEditable()}>Download editable frozen project ZIP</button>
            </div>
            {sourceArchiveSha?.requestId===frozen.requestId&&<dl className="ws-release-facts">
              <dt>Downloaded archive SHA-256</dt><dd><code style={{overflowWrap:'anywhere'}}>{sourceArchiveSha.sha256}</code></dd>
            </dl>}
            <FrozenArchiveReopen key={frozen.requestId} port={port} request={frozen} disabled={readsBusy}/>
            <h4>Static preview ZIP</h4>
            <p>A separate scriptless rendered HTML preview with a SHA-256 file manifest. It excludes editable source and unsupported media; no hosted URL is created.</p>
            {mode==='releases'?<>
              <button className="ws-secondary" type="button" disabled={readsBusy} onClick={()=>void inspect()}>
                Run private preflight for selected frozen revision</button>
              {result&&<PreflightResults result={result} portfolioId={id} revision={frozen.revision} mode="releases"/>}
              {result?.status==='PREVIEW_ONLY'&&<button className="ws-primary" type="button" disabled={readsBusy}
                onClick={()=>void downloadStaticPreview()}>Download offline static preview ZIP</button>}
            </>:result?.status==='PREVIEW_ONLY'?<p>Use the eligible offline static preview download above.</p>:
                <p>Run successful private static preflight to enable the separate preview download.</p>}
            {staticArchiveSha?.requestId===frozen.requestId&&<dl className="ws-release-facts">
              <dt>Static archive SHA-256</dt><dd><code style={{overflowWrap:'anywhere'}}>{staticArchiveSha.sha256}</code></dd>
              <dt>Rendered HTML SHA-256</dt><dd><code style={{overflowWrap:'anywhere'}}>{staticArchiveSha.htmlSha256}</code></dd>
            </dl>}
          </section>}
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


function ReleasePending({label,detail=false}:{label:string;detail?:boolean}) {
  return <><p role="status">{label}</p><div className="glyph-skeleton" aria-hidden="true">
    <span className={'glyph-skeleton-line '+(detail?'is-title':'is-medium')} />
    <span className="glyph-skeleton-line is-medium" />
    <span className="glyph-skeleton-line is-short" />
  </div></>;
}

type ReleaseHistoryPort=SupabaseBrowserAuthPort & {
  listOwnerReleaseAcknowledgements(portfolioId:string,limit?:number,
    after?:PrivateReleaseAcknowledgementCursor|null):Promise<AuthOutcome<PrivateReleaseAcknowledgementPage>>;
};
const ACK_PAGE_SIZE=25,ACK_MAX_ROWS=500;
function mergeReleaseAcknowledgements(portfolioId:string,previous:readonly PrivateReleaseAcknowledgement[],
    page:PrivateReleaseAcknowledgementPage):PrivateReleaseAcknowledgementPage {
  const seen=new Set(previous.map(row=>row.intentId));
  if(page.items.length>ACK_PAGE_SIZE||previous.length+page.items.length>ACK_MAX_ROWS||
     (page.nextCursor!==null&&page.items.length!==ACK_PAGE_SIZE))
    throw new Error('Release acknowledgement page is inconsistent.');
  for(const row of page.items){
    if(row.portfolioId!==portfolioId||seen.has(row.intentId))
      throw new Error('Release acknowledgement page is inconsistent.');
    seen.add(row.intentId);
  }
  const last=page.items.at(-1);
  if(page.nextCursor!==null&&(!last||page.nextCursor.portfolioId!==portfolioId||
     page.nextCursor.intentId!==last.intentId||page.nextCursor.verifiedAt!==last.verifiedAt))
    throw new Error('Release acknowledgement cursor is inconsistent.');
  return {items:[...previous,...page.items],nextCursor:page.nextCursor};
}

/** Historical owner-RLS acknowledgements are not proof of a current live site.
 * The actual owner port checks the live session and portfolio before and after every page.
 */
function ReleaseAcknowledgementHistory({port,portfolioId,frozenRequests,onSelect,selectionDisabled}:{
  port:SupabaseBrowserAuthPort;portfolioId:string;frozenRequests:OwnerFrozenRequest[]|null;
  onSelect:(row:PrivateReleaseAcknowledgement)=>void;selectionDisabled:boolean;
}){
  const candidate=port as Partial<ReleaseHistoryPort>;
  const available=typeof candidate.listOwnerReleaseAcknowledgements==='function';
  const [page,setPage]=useState<PrivateReleaseAcknowledgementPage|null>(null);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState('');
  const epoch=useRef(0);
  const flight=useRef<object|null>(null);
  async function read(after:PrivateReleaseAcknowledgementCursor|null,previous:readonly PrivateReleaseAcknowledgement[],expected:number){
    if(!available||epoch.current!==expected||flight.current!==null)return;
    const ticket={};
    flight.current=ticket;setPending(true);setError('');
    const current=()=>epoch.current===expected&&flight.current===ticket;
    try{
      const reply=await (port as ReleaseHistoryPort).listOwnerReleaseAcknowledgements(portfolioId,ACK_PAGE_SIZE,after);
      if(!current())return;
      if(!reply.data)throw new Error('Owner acknowledgement history unavailable.');
      const next=mergeReleaseAcknowledgements(portfolioId,previous,reply.data);
      if(current())setPage(next);
    }catch{
      if(current())setError('The private release acknowledgement history could not be verified. Retry the owner read.');
    }finally{
      if(current()){flight.current=null;setPending(false);}
    }
  }
  useLayoutEffect(()=>{
    const expected=++epoch.current;
    flight.current=null;setPage(null);setPending(false);setError('');
    return ()=>{if(epoch.current===expected){epoch.current+=1;flight.current=null;}};
  },[port,portfolioId,available]);
  useEffect(()=>{
    if(available&&!selectionDisabled&&!page&&!error&&!pending&&flight.current===null)
      void read(null,[],epoch.current);
  },[available,selectionDisabled,page,error,pending,port,portfolioId]);
  return <section className="ws-release-action" role="group" aria-labelledby="release-ack-history-title">
    <h3 id="release-ack-history-title">Historical database acknowledgements</h3>
    <p>These owner-private records show an acknowledgement recorded by the database, not a current public URL, verified host state, rollback authority or revocation proof.</p>
    {!available?<p>Owner acknowledgement history is unavailable until the compatible authenticated service is installed.</p>:<>
      {pending&&!page&&<ReleasePending label="Loading private release acknowledgements…" />}
      {pending&&page&&<p role="status">Checking private release acknowledgement history…</p>}
      {error&&<p role="alert">{error}</p>}
      {page&&page.items.length===0&&!error&&<p>No historical database acknowledgements were returned.</p>}
      {!!page?.items.length&&<ol className="ws-release-grant-list">{page.items.map(row=>{
        const request=frozenRequests?.find(item=>item.requestId===row.requestId&&item.portfolioId===portfolioId);
        return <li key={row.intentId}><div>
          <strong>Database acknowledgement recorded</strong>
          <p><time dateTime={row.verifiedAt}>{new Date(row.verifiedAt).toLocaleString()}</time></p>
          <p>Intent <code style={{overflowWrap:'anywhere'}}>{row.intentId}</code></p>
          <p>Frozen request <code style={{overflowWrap:'anywhere'}}>{row.requestId}</code></p>
        </div><div>
          <button type="button" className="ws-secondary" disabled={selectionDisabled||pending}
            onClick={()=>onSelect(row)}>{request?'Inspect matching frozen revision '+request.revision:'Inspect acknowledged frozen request'}</button>
          {!request&&<p className="ws-field-hint">Outside the loaded catalogue; the exact owner pin will be checked before inspection.</p>}
        </div></li>;
      })}</ol>}
      <div className="ws-release-actions">
        <button type="button" className="ws-secondary" disabled={pending||selectionDisabled}
          onClick={()=>void read(null,[],epoch.current)}>{error&&!page?'Retry acknowledgement history':'Refresh acknowledgement history'}</button>
        {page?.nextCursor&&page.items.length<ACK_MAX_ROWS&&<button type="button" className="ws-secondary" disabled={pending||selectionDisabled}
          onClick={()=>void read(page.nextCursor,page.items,epoch.current)}>Load older acknowledgements</button>}
      </div>
      {page?.nextCursor&&page.items.length>=ACK_MAX_ROWS&&<p className="ws-field-hint">Showing the newest 500 records in this view; more records may exist.</p>}
    </>}
  </section>;
}

function FrozenRequestHistory({requests,error,pending,onRetry,retryDisabled,onSelect,activeRequestId,selectionDisabled,candidateRequestId}:{
  requests:OwnerFrozenRequest[]|null;error:string;pending:boolean;onRetry:()=>void;retryDisabled:boolean;
  onSelect?:(request:OwnerFrozenRequest)=>void;activeRequestId?:string;
  selectionDisabled?:boolean;candidateRequestId?:string
}) {
  return <section className="ws-release-action" role="group" aria-labelledby="frozen-history-title">
    <h3 id="frozen-history-title">Frozen private requests</h3>
    <p>Immutable owner-only revision pins. These records do not prove reviewer delivery, public hosting, release history or rollback.</p>
    {error && <><p role="alert">{error}</p><button type="button" className="ws-secondary" disabled={retryDisabled}
      onClick={onRetry}>Retry frozen request history</button></>}
    {requests===null&&!error&&pending&&<ReleasePending label="Loading frozen private requests…" />}
    {requests?.length===0&&<p>No private revisions have been frozen.</p>}
    {!!requests?.length&&<ol className="ws-release-grant-list">{requests.map(request=>
      <li key={request.requestId}>
        <div>
          <strong>Private revision {request.revision} · {request.visibilityIntent==='PUBLIC'?'Public intent':'Unlisted intent'}</strong>
          <p>Frozen <time dateTime={request.createdAt}>{new Date(request.createdAt).toLocaleString()}</time></p>
          <p>Snapshot fingerprint <code>{request.snapshotSha256.slice(0,12)}…</code> · Not published</p>
          {candidateRequestId===request.requestId&&<p>Current prepared private candidate</p>}
        </div>
        {onSelect&&<button type="button" className="ws-secondary"
          disabled={selectionDisabled}
          aria-pressed={activeRequestId===request.requestId}
          onClick={()=>onSelect(request)}>
          {activeRequestId===request.requestId?'Frozen request selected':'Use frozen revision '+request.revision}
        </button>}
      </li>)}</ol>}
    {requests?.length===100&&<p className="ws-field-hint">Showing the newest 100 private freeze records.</p>}
  </section>;
}


/** The reopened file never leaves the device. A fresh owner-scoped pin is
 * required before claiming a match; no import, save, upload or publication. */
function FrozenArchiveReopen({port,request,disabled}:{
  port:SupabaseBrowserAuthPort;request:PrivateFrozenRequest;disabled:boolean;
}){
  const [pending,setPending]=useState(false);
  const [error,setError]=useState('');
  const [result,setResult]=useState<Awaited<ReturnType<typeof reopenFrozenArchive>>|null>(null);
  const epoch=useRef(0);
  const flight=useRef<object|null>(null);
  useLayoutEffect(()=>{
    epoch.current+=1;flight.current=null;setPending(false);setResult(null);setError('');
    return()=>{epoch.current+=1;flight.current=null;};
  },[port,request.requestId,request.snapshotSha256]);
  async function reopen(file:File){
    if(disabled||flight.current!==null)return;
    const ticket={},expected=epoch.current;
    const current=()=>flight.current===ticket&&epoch.current===expected;
    flight.current=ticket;setPending(true);setError('');setResult(null);
    try{
      if(!Number.isSafeInteger(file.size)||file.size<22||file.size>2*1024*1024)
        throw new Error('Invalid archive size.');
      const pin=await port.loadOwnerFrozenRelease(request.requestId);
      if(!current())return;
      if(!matchesFrozenPin(pin.data,request))throw new Error('Frozen pin unavailable.');
      const reopened=await reopenFrozenArchive(file,pin.data.snapshot);
      if(current())setResult(reopened);
    }catch{
      if(current())setError('The selected ZIP could not be reopened and matched to this exact owner-private frozen revision. No project was changed.');
    }finally{
      if(current()){flight.current=null;setPending(false);}
    }
  }
  return <div className="ws-release-action" role="group" aria-label="Reopen editable frozen archive">
    <h4>Reopen an editable archive</h4>
    <p>Choose a downloaded source ZIP to check it against this exact frozen revision. This reads the file locally and does not import, execute, upload or change a project.</p>
    <label>Editable source ZIP
      <input type="file" accept=".zip,application/zip" disabled={disabled||pending}
        onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';
          if(file)void reopen(file);}}/>
    </label>
    {pending&&<p role="status">Reopening and checking private archive…</p>}
    {error&&<p role="alert">{error}</p>}
    {result&&<div role="status"><p>Archive contents match the frozen snapshot: {result.files} files, {result.slots} slots, {result.stashes} stash entries.</p>
      <p>Reopened ZIP SHA-256 <code style={{overflowWrap:'anywhere'}}>{result.sha256}</code></p>
      <p>Uploaded media and other revisions are not verified by this source archive.</p></div>}
  </div>;
}

function FrozenComparisonResults({comparison}:{comparison:FrozenComparison}){
  const groups=[['Project files',comparison.files],['Component slots',comparison.slots],
    ['Stash entries',comparison.stashes]] as const;
  return <div className="ws-release-diagnostics" aria-label="Verified private snapshot comparison">
    <p role="status">Private frozen revision {comparison.frozenRevision} compared with saved draft revision {comparison.draftRevision}.</p>
    {groups.map(([name,items])=><details key={name}>
      <summary>{name}: {items.length} {items.length===1?'difference':'differences'}</summary>
      {items.length?<ul>{items.map(item=><li key={item.key}><strong>{item.kind}</strong> · <code style={{overflowWrap:'anywhere'}}>{item.key}</code>
        <p>{item.beforeBytes===null?'Absent':item.beforeBytes+' bytes'} → {item.afterBytes===null?'Absent':item.afterBytes+' bytes'}</p>
        {!!item.fields?.length&&<p>Changed properties: {item.fields.join(', ')}</p>}
      </li>)}</ul>:
        <p>No differences in this group.</p>}
    </details>)}
    <p className="ws-field-hint">File sizes use UTF-8 source bytes; slot and stash sizes use canonical JSON bytes. Neither comparison nor export changes the saved draft or pointer.</p>
    <details>
      <summary>Open owner-private visual comparison</summary>
      <p>Read-only simulations of saved snapshots using the current portfolio title. Custom source is never executed here.</p>
      <h4>Frozen revision {comparison.frozenRevision}</h4>
      <div className="ws-release-visual-canvas"><PortfolioCanvas snapshot={comparison.frozenSnapshot} title={comparison.title} simulation keyboardScroll/></div>
      <h4>Saved draft revision {comparison.draftRevision}</h4>
      <div className="ws-release-visual-canvas"><PortfolioCanvas snapshot={comparison.draftSnapshot} title={comparison.title} simulation keyboardScroll/></div>
    </details>
  </div>;
}

/** A diagnostic is displayed only when emitted by the real frozen-snapshot
 * preflight engine. Never label an unexecuted check as passed. */
type PreflightIssue=SafePreviewResult['blockers'][number];
/** C09 initial editor selection hints only. Match the committed consumer's
 * allowlist and key grammar; the current authorized draft still validates
 * own declared-slot membership and falls back if a historical slot is gone. */
type RemediationPanel='Content'|'Theme'|'Metadata'|'Assets'|'Source';
type IssueDestination={href:string;label:string;hint:string;secondary?:{href:string;label:string}};
const slotIssueCodes=new Set([
  'REQUIRED_SLOT_EMPTY','OPTIONAL_SLOT_EMPTY','CUSTOM_SOURCE_UNTRUSTED',
  'COMPONENT_PIN_MISMATCH','INVALID_IMAGE_REFERENCE','IMAGE_BYTES_UNVERIFIED',
  'UNKNOWN_PUBLIC_FIELD','INVALID_HEADING','INVALID_PARAGRAPH','INVALID_BADGE',
  'INVALID_METRIC','INVALID_LIST','INVALID_PROJECT_CARD','UNSAFE_LINK','INVALID_LINK',
  'UNMAPPED_ACTIVE_SLOT'
]);
function issueDestination(item:PreflightIssue,portfolioId:string,mode:'publish'|'releases'):IssueDestination{
  const editor='/app/portfolios/'+encodeURIComponent(portfolioId)+'/edit';
  const slot=slotIssueCodes.has(item.code)&&/^[a-z0-9_-]{1,64}$/.test(item.target)&&
    !['__proto__','constructor','prototype'].includes(item.target)?item.target:null;
  const editorLink=(panel:RemediationPanel,includeSlot=false)=>{
    const query=new URLSearchParams({panel});
    if(includeSlot&&slot)query.set('slot',slot);
    return editor+'?'+query.toString();
  };
  if(item.target==='hosting')return {
    href:mode==='publish'?'#publication-controls-title':'#private-portable-title',
    label:'Review delivery restrictions',hint:'Editing content cannot clear the independent host gate.'};
  if(item.target==='revision')return {href:'#frozen-history-title',label:'Review frozen request history',
    hint:'Reverify the selected immutable owner pin before continuing.'};
  if(item.target==='kadmeion.json')return {href:editorLink('Metadata'),label:'Edit SEO metadata in private editor',
    hint:'Save changes as a new revision and run preflight on that revision.'};
  if(item.target==='theme/tokens.json')return {href:editorLink('Theme'),label:'Open editor for theme',
    hint:'Review saved theme tokens; save a new revision and recheck.'};
  if(item.target==='source'||item.code==='CUSTOM_SOURCE_UNTRUSTED')return {href:editorLink('Source',true),
    label:'Open editor for source',hint:'Inspect the owned source, or return to Content to replace an unsupported assignment. Untrusted code is never executed in this release.'};
  if(item.code==='IMAGE_BYTES_UNVERIFIED'||item.code==='INVALID_IMAGE_REFERENCE')return {href:editorLink('Content',true),
    label:'Open editor for image',hint:'Review the slot and its alt/decorative metadata. Unverified bytes remain blocked.',
    secondary:{href:editorLink('Assets',true),label:'Review private assets'}};
  if(slotIssueCodes.has(item.code))return {href:editorLink('Content',true),label:'Open editor for this slot',
    hint:slot?'Open the requested slot in the current saved draft. If it no longer exists, choose an available slot.':
      'Choose an available slot in Structure & layers; this target is not a supported slot key.'};
  return {href:editorLink('Content'),label:'Open editor to review structure',
    hint:'Inspect Structure & layers and Content; save a valid new revision.'};
}
/** Read only the escaped metadata emitted by the trusted scriptless renderer.
 * Do not construct a DOM, load resources or read the mutable draft metadata.
 */
function privatePreviewMetadata(html:string):{title:string;description:string;robots:string}|null {
  const head=/^<!doctype html><html lang="en"><head>([\s\S]*?)<style>/.exec(html)?.[1];
  if(!head)return null;
  const title=/<title>([^<]*)<\/title>/.exec(head)?.[1];
  const description=/<meta name="description" content="([^"]*)">/.exec(head)?.[1];
  const robots=/<meta name="robots" content="([^"]*)">/.exec(head)?.[1];
  if(title===undefined||description===undefined||robots!=='noindex,nofollow,noarchive')return null;
  const unescape=(value:string)=>value.replace(/&(?:amp|lt|gt|quot|#39);/g,entity=>{
    switch(entity){case '&amp;':return '&';case '&lt;':return '<';case '&gt;':return '>';
      case '&quot;':return '"';case '&#39;':return "'";default:return entity;}
  });
  return {title:unescape(title),description:unescape(description),robots};
}

function PreflightResults({result,portfolioId,revision,mode}:{result:SafePreviewResult;portfolioId:string;revision:number;mode:'publish'|'releases'}) {
  const [previewWidth,setPreviewWidth]=useState<'fit'|'390'|'768'|'1440'>('fit');
  const metadata=result.status==='PREVIEW_ONLY'&&result.previewHtml?privatePreviewMetadata(result.previewHtml):null;
  return <section className="ws-release-action" role="group" aria-labelledby="preflight-results">
    <h3 id="preflight-results">Preflight results</h3>
    <p role="status">Private renderability check for frozen revision {revision}. No published release or host readiness proof.</p>
    <p>Issues describe the immutable pin. Remediation links open the current private editor, not the frozen snapshot. Save a new revision and run preflight again; a historical slot may no longer exist.</p>
    {(result.blockers.length>0||result.warnings.length>0)&&<nav aria-label="Preflight issue navigation">
      <h4>Jump to issue</h4>
      <ul>{([['blocker',result.blockers],['warning',result.warnings]] as const).flatMap(([kind,items])=>
        items.map((item,index)=><li key={kind+'-'+index}><a href={'#preflight-'+kind+'-'+index}>{item.code} · {item.target}</a></li>))}</ul>
    </nav>}
    <div className="ws-release-summary" role="group" aria-label="Private preflight summary">
      <div><span>Blocking errors</span><strong>{result.blockers.length}</strong></div>
      <div><span>Warnings</span><strong>{result.warnings.length}</strong></div>
      <div><span>Passed checks</span><strong>{result.passed.length}</strong></div>
    </div>
    {([
      ['Blocking errors','blocker',result.blockers],['Warnings','warning',result.warnings],
      ['Checks performed and passed','passed',result.passed]
    ] as const).map(([heading,kind,items])=><div key={heading} className="ws-release-diagnostics">
      <h4>{heading} ({items.length})</h4>
      {items.length?<ul>{items.map((item,index)=>{
        const destination=kind==='passed'?null:issueDestination(item,portfolioId,mode);
        return <li key={item.code+':'+index} id={'preflight-'+kind+'-'+index} tabIndex={-1}>
          <strong>{item.code}</strong>: {item.message}
          <p>Target: <code style={{overflowWrap:'anywhere'}}>{item.target}</code></p>
          {destination&&<p><a href={destination.href}>{destination.label}</a> · {destination.hint}
            {destination.secondary&&<> · <a href={destination.secondary.href}>{destination.secondary.label}</a></>}
          </p>}
        </li>;
      })}</ul>:<p>None in this category.</p>}
    </div>)}
    {result.status==='PREVIEW_ONLY'&&result.previewHtml && <>
      <div className="ws-release-action" role="group" aria-labelledby="private-seo-title">
        <h4 id="private-seo-title">Frozen preview SEO metadata</h4>
        {metadata?<dl className="ws-release-facts">
          <dt>Page title</dt><dd style={{overflowWrap:'anywhere'}}>{metadata.title}</dd>
          <dt>Meta description</dt><dd style={{overflowWrap:'anywhere'}}>{metadata.description}</dd>
          <dt>Robots directive</dt><dd><code>{metadata.robots}</code></dd>
        </dl>:<p>The rendered metadata could not be read. Inspect preflight diagnostics before export.</p>}
        <p className="ws-field-hint">Exact private preview metadata, not a live search result. No verified canonical URL or sitemap entry is created.</p>
      </div>
      <div className="ws-release-actions">
        <label>Static preview viewport
          <select value={previewWidth} onChange={event=>{
            const value=event.target.value;
            if(value==='fit'||value==='390'||value==='768'||value==='1440')setPreviewWidth(value);
          }}>
            <option value="fit">Fit available width</option><option value="390">Phone (390 CSS px)</option>
            <option value="768">Tablet (768 CSS px)</option><option value="1440">Desktop (1440 CSS px)</option>
          </select>
        </label>
      </div>
      <p className="ws-field-hint">A fixed viewport may scroll horizontally. Portfolio content width may be smaller than the selected viewport. Export uses the same reviewed HTML at every width.</p>
      <div role="region" aria-label="Scrollable private static preview" tabIndex={0} style={{overflow:'auto',maxWidth:'100%'}}>
        <iframe title="Private scriptless preview" className="ws-private-static-preview"
          style={{width:previewWidth==='fit'?'100%':Number(previewWidth),maxWidth:'none',boxSizing:'content-box',display:'block'}}
          sandbox="" referrerPolicy="no-referrer" srcDoc={result.previewHtml}/>
      </div>
    </>}
    <p className="ws-field-hint">Publication remains blocked until host proof and separate authorization.</p>
  </section>;
}
