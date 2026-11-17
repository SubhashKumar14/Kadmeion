import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {SupabaseBrowserAuthPort, OwnerPortfolio, OwnerReviewerGrantSummary, SavedOwnerRevision, OwnerFrozenRequest} from '../../auth-web/src/supabase-auth-port.ts';
import type {PrivateFrozenRequest, FrozenVisibilityIntent} from '../../../packages/contracts/src/private-release-service.ts';
import type {PrivatePointerSnapshot} from '../../../packages/contracts/src/private-release-visibility-service.ts';
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
  const [pinReadRetry,setPinReadRetry]=useState(0);
  const [historySelection,setHistorySelection]=useState<OwnerFrozenRequest|null>(null);
  const [historySelectionPending,setHistorySelectionPending]=useState(false);
  const [historySelectionError,setHistorySelectionError]=useState('');
  const [result,setResult]=useState<SafePreviewResult|null>(null);
  const [comparison,setComparison]=useState<FrozenComparison|null>(null);
  const [editableConsent,setEditableConsent]=useState<string|null>(null);
  const [sourceArchiveSha,setSourceArchiveSha]=useState<{requestId:string;sha256:string}|null>(null);
  const [staticArchiveSha,setStaticArchiveSha]=useState<{requestId:string;sha256:string;htmlSha256:string}|null>(null);
  const [grant,setGrant]=useState<SafeGrant|null>(null);
  const [grants,setGrants]=useState<OwnerReviewerGrantSummary[]|null>(null);
  const [grantListError,setGrantListError]=useState('');
  const [validMinutes,setValidMinutes]=useState(60);
  const [grantNow,setGrantNow]=useState(()=>Date.now());
  const [confirmRevoke,setConfirmRevoke]=useState(false);
  const [confirmBlock,setConfirmBlock]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [retry,setRetry]=useState(0);
  const operation=useRef<string|null>(null);
  const grantOperation=useRef<string|null>(null);
  const blockOperation=useRef<string|null>(null);
  const historySelectionEpoch=useRef(0);
  const routeEpoch=useRef(0);
  useLayoutEffect(()=>{
    routeEpoch.current+=1;
    return ()=>{routeEpoch.current+=1;historySelectionEpoch.current+=1;};
  },[port,id,mode]);
  const base='/app/portfolios/'+id;

  // Reset only when the owner/route identity changes, not on Retry. A retry
  // must preserve the frozen request and its idempotency key after an
  // acknowledgement may have been lost over the network.
  useEffect(()=>{
    historySelectionEpoch.current+=1;
    setHistorySelection(null);setHistorySelectionPending(false);setHistorySelectionError('');
    setPinReadRetry(0);
    setRecord(null);setRevisions(null);setFrozenRequests(null);setFrozenListError('');
    setSelectedRevision(null);setRevisionError('');setPointer(null);
    setVisibility('UNLISTED');setFrozen(null);setPinnedPreview(null);
    setPinnedPreviewPending(false);setPinnedPreviewError('');setResult(null);
    setComparison(null);setEditableConsent(null);setSourceArchiveSha(null);setStaticArchiveSha(null);
    setGrant(null);setGrants(null);setGrantListError('');
    setConfirmRevoke(false);setConfirmBlock(false);setNotice('');setError('');setBusy(false);
    operation.current=null;grantOperation.current=null;blockOperation.current=null;
  },[port,id,mode]);

  useEffect(()=>{
    let active=true;
    setError('');
    void (async()=>{
      try {
        const reply=await port.readOwnerPortfolio(id);
        if (!active) return;
        if (!reply.data) {setError(reply.error?.message ?? 'Portfolio unavailable.');return;}
        setRecord(reply.data);
        setComparison(previous=>previous&&previous.draftRevision!==reply.data!.revision?null:previous);
        if (mode==='staging'||mode==='publish'||mode==='releases') {
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
      if (frozen.portfolioId!==id||!matchesFrozenPin(reply.data,frozen)) {
        setPinnedPreviewError('The exact frozen revision could not be verified. The current draft is not substituted.');
      } else setPinnedPreview(reply.data.snapshot);
    }).catch(()=>{
      if (active) setPinnedPreviewError('The pinned preview is temporarily unavailable. No public data was released.');
    }).finally(()=>{if(active)setPinnedPreviewPending(false);});
    return()=>{active=false;};
  },[port,id,mode,frozen,pinReadRetry]);

  async function downloadStaticPreview(){
    if (busy || !frozen || result?.status!=='PREVIEW_ONLY') return;
    const epoch=routeEpoch.current;
    const current=()=>epoch===routeEpoch.current;
    setBusy(true);setError('');setNotice('');setStaticArchiveSha(null);
    try {
      const {exportStandaloneStaticPreview}=await import('../../../packages/storage-adapters/src/static-preview-export.ts');
      if (!current()) return;
      const {data}=await port.loadOwnerFrozenRelease(frozen.requestId);
      if (!current()) return;
      if (frozen.portfolioId!==id||!matchesFrozenPin(data,frozen)) throw new Error('Invalid frozen revision receipt.');
      const archive=await exportStandaloneStaticPreview({...data,plan:buildPlan(data.snapshot)});
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
    if(!frozen||busy||historySelection!==null)return;
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
    if(!frozen||busy||historySelection!==null||editableConsent!==frozen.requestId)return;
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
    if (!record?.revision || selectedRevision===null || busy || historySelection!==null) return;
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
        const refreshed=await port.listOwnerFrozenRequests(id);
        if (!current()) return;
        if (refreshed.data) {setFrozenRequests(refreshed.data);setFrozenListError('');}
        else setFrozenListError('Private freeze succeeded, but its history could not be refreshed.');
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
    if (!frozen || grant || busy || mode!=='staging' || historySelection!==null ||
        pinnedPreviewPending || !pinnedPreview || !!pinnedPreviewError) return;
    const epoch=routeEpoch.current;
    const current=()=>epoch===routeEpoch.current;
    setBusy(true);setError('');setNotice('');
    try {
      // Recheck owner pin immediately before registering, not merely the old canvas.
      const pin=await port.loadOwnerFrozenRelease(frozen.requestId);
      if (!current()) return;
      if (frozen.portfolioId!==id||!matchesFrozenPin(pin.data,frozen)) {
        setPinnedPreview(null);setPinnedPreviewError('The exact frozen revision could not be rechecked. Retry verification before registering.');
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
      const updated=await port.listOwnerReviewerGrants(id);
      if (!current()) return;
      if (updated.data) {setGrants(updated.data);setGrantListError('');}
      else setGrantListError('Grant registered, but the owner-only saved-grant list could not be refreshed.');
      grantOperation.current=null;
      setNotice(Date.parse(expiresAt)<=Date.now()
        ? 'The recorded reviewer grant has expired. No reviewer link is available.'
        : 'Private reviewer grant registered. The link remains disabled pending hosted delivery verification.');
    } catch {if (current()) setError('Reviewer registration failed. Retry the same request.');}
    finally {if (current()) setBusy(false);}
  }

  async function revokeReviewer(){
    if (!grant || grant.status==='REVOKED' || busy || !confirmRevoke) return;
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
      setGrant(previous=>previous?.grantId===grant.grantId ? {...previous,status:'REVOKED'} : previous);
      const refreshed=await port.listOwnerReviewerGrants(id);
      if (!current()) return;
      if (refreshed.data) {setGrants(refreshed.data);setGrantListError('');}
      else setGrantListError('Revocation succeeded but the reviewer list could not be refreshed.');
      setConfirmRevoke(false);
      setNotice('Private reviewer grant revoked. External delivery revocation has not been independently verified.');
    } catch {if (current()) setError('Reviewer revocation could not be checked. Retry safely.');}
    finally {if (current()) setBusy(false);}
  }

  async function blockCandidate(){
    if (!pointer || pointer.status!=='PREPARED_PRIVATE' || busy || !confirmBlock) return;
    const epoch=routeEpoch.current;
    const current=()=>epoch===routeEpoch.current;
    setBusy(true);setError('');setNotice('');
    try {
      blockOperation.current ??= crypto.randomUUID();
      const receipt=await port.blockOwnerReleaseCandidate(id,blockOperation.current);
      if (!current()) return;
      if (!receipt.data) {setError(receipt.error?.message ?? 'Private candidate block was not acknowledged.');return;}
      const reread=await port.readOwnerRelease(id);
      if (!current()) return;
      if (!reread.data) {setError('Block acknowledged, but current private pointer could not be rechecked.');return;}
      setPointer(reread.data);
      blockOperation.current=null;setConfirmBlock(false);
      setNotice('Private candidate pointer refreshed. This is not proof of public CDN revocation.');
    } catch {if (current()) setError('Private candidate could not be blocked. Refresh its state before retrying.');}
    finally {if (current()) setBusy(false);}
  }

  /** A latest-50 catalogue omission is not an authorization failure.
   * Reuse an older request only after checking the exact owner-RPC frozen pin. */
  async function selectFrozenRequest(request:OwnerFrozenRequest){
    if (busy||historySelectionPending) return;
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
      setFrozen(null);setPinnedPreview(null);setPinnedPreviewError('');
      setResult(null);setGrant(null);setError('');setNotice('');
      return;
    }
    const epoch=++historySelectionEpoch.current;
    setHistorySelection(request);setHistorySelectionPending(true);setHistorySelectionError('');
    setFrozen(null);setPinnedPreview(null);setPinnedPreviewError('');
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

  function cancelHistoricalSelection(){
    historySelectionEpoch.current+=1;
    setHistorySelection(null);setHistorySelectionPending(false);setHistorySelectionError('');
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
    {!record && !error && <p role="status">Loading private release details…</p>}
    {error && <button type="button" className="ws-secondary" disabled={busy||historySelectionPending} onClick={()=>{setError('');setRetry(value=>value+1);}}>
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
        {historySelectionPending && <p role="status">Verifying the historical frozen revision with the owner service…</p>}
        {pinnedPreviewPending && <p role="status">Verifying the exact private revision…</p>}
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
          <p>Review private freeze records and the candidate pointer. A verified live release timeline is unavailable; these records are not published releases.</p>
          {pointer?.candidateRequestId && <dl className="ws-release-facts">
            <dt>Prepared candidate request</dt><dd><code style={{overflowWrap:'anywhere'}}>{pointer.candidateRequestId}</code></dd>
            <dt>Candidate manifest fingerprint</dt><dd><code style={{overflowWrap:'anywhere'}}>{pointer.candidateManifestSha256}</code></dd>
          </dl>}
          {revisionError&&<p role="alert">{revisionError}</p>}
          <FrozenRequestHistory requests={frozenRequests} error={frozenListError}
            onSelect={request=>void selectFrozenRequest(request)}
            selectionDisabled={busy||historySelectionPending}
            activeRequestId={frozen?.requestId}
            candidateRequestId={pointer?.candidateRequestId??undefined} />
          {historySelection && <div className="ws-release-action" role="group" aria-label="Historical frozen pin verification">
            {historySelectionPending&&<p role="status">Verifying the exact private frozen revision…</p>}
            {historySelectionError&&<p role="alert">{historySelectionError}</p>}
            {historySelectionError&&!historySelectionPending&&
              <button type="button" className="ws-secondary" disabled={busy}
                onClick={()=>void selectFrozenRequest(historySelection)}>Retry historical owner pin</button>}
            <button type="button" className="ws-secondary" disabled={busy}
              onClick={cancelHistoricalSelection}>Cancel frozen pin selection</button>
          </div>}
          <button type="button" className="ws-secondary" disabled>Public rollback unavailable — host proof required</button>
          <p className="ws-field-hint">A rollback requires a previously host-attested live release, a guarded pointer change and new GET/HEAD plus media verification. None is inferred from a private frozen request.</p>
        </> : <>
          <h2>{mode==='staging'?'Prepare a frozen reviewer revision':'Inspect a saved revision'}</h2>
          <p>Freeze a selected immutable saved revision with its content digest. Unsaved editor changes are not included.</p>
          {revisionError && <p role="alert">{revisionError}</p>}
          <label>Saved revision
            <select aria-label="Saved revision" value={selectedRevision??''} disabled={busy||historySelection!==null||!!frozen||!revisions?.length}
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
            <select value={visibility} disabled={busy||historySelection!==null||!!frozen} onChange={event=>{
              setVisibility(event.target.value==='PUBLIC'?'PUBLIC':'UNLISTED');
              operation.current=null;
            }}><option value="UNLISTED">Unlisted (not activated)</option>
              <option value="PUBLIC">Public (not activated)</option></select>
          </label>
          <button type="button" className="ws-primary" disabled={busy||historySelection!==null||selectedRevision===null||(mode==='staging'&&!!frozen)}
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
          <FrozenRequestHistory requests={frozenRequests} error={frozenListError}
            onSelect={request=>void selectFrozenRequest(request)}
            selectionDisabled={busy||historySelectionPending}
            activeRequestId={frozen?.requestId} />
          {historySelection && <div className="ws-release-action" role="group" aria-label="Historical frozen pin verification">
            {historySelectionError && <p role="alert">{historySelectionError}</p>}
            {historySelectionError && !historySelectionPending &&
              historySelection.portfolioId===id&&historySelection.status==='FROZEN'&&
              !revisions?.some(row=>row.revision===historySelection.revision&&
                row.snapshotSha256!==historySelection.snapshotSha256) &&
              <button type="button" className="ws-secondary" disabled={busy}
                onClick={()=>void selectFrozenRequest(historySelection)}>Retry historical owner pin</button>}
            <button type="button" className="ws-secondary" disabled={busy}
              onClick={cancelHistoricalSelection}>Cancel frozen pin selection</button>
          </div>}
          {mode==='staging' && <section className="ws-release-action" role="group" aria-labelledby="reviewer-history-title">
            <h3 id="reviewer-history-title">Registered reviewer grants</h3>
            <p>Owner-only metadata can be recovered after a reload. Raw reviewer credentials are never returned in this list.</p>
            {grantListError && <p role="alert">{grantListError}</p>}
            {grants===null && !grantListError && <p role="status">Loading private reviewer grant records…</p>}
            {grants?.length===0 && <p>No reviewer grants have been registered.</p>}
            {!!grants?.length && <ul className="ws-release-grant-list">{grants.map(item=><li key={item.grantId}>
              <div><strong>{item.revokedAt?'Revoked':Date.parse(item.expiresAt)<=grantNow?'Expired':'Registered (not servable)'}</strong>
                <p>Created <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>.
                  Expires <time dateTime={item.expiresAt}>{new Date(item.expiresAt).toLocaleString()}</time>.</p>
                <p>Private frozen request {item.requestId.slice(0,8)}…</p></div>
              {!item.revokedAt && <button type="button" className="ws-secondary" disabled={busy}
                onClick={()=>{setGrantNow(Date.now());setGrant({grantId:item.grantId,requestId:item.requestId,expiresAt:item.expiresAt,status:'REGISTERED_UNSERVABLE'});
                  setConfirmRevoke(true);}}>Review revocation</button>}
            </li>)}</ul>}
          </section>}
          {mode==='staging' && (frozen || grant) && <div className="ws-release-action" role="group" aria-labelledby="reviewer-grant-title">
            <h3 id="reviewer-grant-title">Reviewer access</h3>
            <p>Register a time-limited owner-private grant. No reviewer URL can be shared until host authorization, expiry and revocation are proven.</p>
            {!grant ? <>
              <label>Grant lifetime<select disabled={busy||!!grantOperation.current} value={validMinutes}
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
                disabled={busy || historySelection!==null || pinnedPreviewPending || !pinnedPreview || !!pinnedPreviewError}
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
                onClick={()=>setConfirmRevoke(true)}>Revoke private reviewer grant</button>}
              {(grant.status==='REVOKED'||grantExpired) && frozen && <button type="button" className="ws-secondary" disabled={busy||confirmRevoke}
                onClick={()=>{setGrant(null);setConfirmRevoke(false);grantOperation.current=null;}}>Register another reviewer grant</button>}
              {confirmRevoke && grant.status!=='REVOKED' && <div className="ws-release-confirm">
                <p>Revoke this private grant? The saved snapshot will remain available to its owner.</p>
                <button type="button" className="ws-primary" disabled={busy} onClick={()=>void revokeReviewer()}>
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
              {result?.status==='PREVIEW_ONLY' && <button className="ws-primary" type="button" disabled={busy}
                onClick={()=>void downloadStaticPreview()}>Download offline static preview ZIP</button>}
              <button className="ws-secondary" type="button" disabled>Publish unavailable — host proof required</button>
            </div>
          </div>}
        </>}
        {(mode==='staging'||mode==='publish'||mode==='releases')&&frozen&&!historySelection&&
          <section className="ws-release-action" aria-labelledby="private-comparison-title">
            <h3 id="private-comparison-title">Compare private revision {frozen.revision}</h3>
            <p>Compare the immutable pin with the latest saved owner draft, not a live website. Unsaved changes are excluded.</p>
            <button className="ws-secondary" type="button" disabled={busy} onClick={()=>void compareFrozenWithSaved()}>
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
              <button className="ws-primary" type="button" disabled={busy||editableConsent!==frozen.requestId}
                onClick={()=>void downloadFrozenEditable()}>Download editable frozen project ZIP</button>
            </div>
            {sourceArchiveSha?.requestId===frozen.requestId&&<dl className="ws-release-facts">
              <dt>Downloaded archive SHA-256</dt><dd><code style={{overflowWrap:'anywhere'}}>{sourceArchiveSha.sha256}</code></dd>
            </dl>}
            <h4>Static preview ZIP</h4>
            <p>A separate scriptless rendered HTML preview with a SHA-256 file manifest. It excludes editable source and unsupported media; no hosted URL is created.</p>
            {mode==='releases'?<>
              <button className="ws-secondary" type="button" disabled={busy} onClick={()=>void inspect()}>
                Run private preflight for selected frozen revision</button>
              {result&&<PreflightResults result={result} portfolioId={id} revision={frozen.revision} mode="releases"/>}
              {result?.status==='PREVIEW_ONLY'&&<button className="ws-primary" type="button" disabled={busy}
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


function FrozenRequestHistory({requests,error,onSelect,activeRequestId,selectionDisabled,candidateRequestId}:{
  requests:OwnerFrozenRequest[]|null;error:string;
  onSelect?:(request:OwnerFrozenRequest)=>void;activeRequestId?:string;
  selectionDisabled?:boolean;candidateRequestId?:string
}) {
  return <section className="ws-release-action" role="group" aria-labelledby="frozen-history-title">
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
/** Only navigate to existing routes or local targets. The editor currently
 * accepts Metadata as its sole panel query; other panels need explicit manual selection. */
function issueDestination(item:PreflightIssue,portfolioId:string,mode:'publish'|'releases'){
  const editor='/app/portfolios/'+portfolioId+'/edit';
  if(item.target==='hosting')return {
    href:mode==='publish'?'#publication-controls-title':'#private-portable-title',
    label:'Review delivery restrictions',hint:'Editing content cannot clear the independent host gate.'};
  if(item.target==='revision')return {href:'#frozen-history-title',label:'Review frozen request history',
    hint:'Reverify the selected immutable owner pin before continuing.'};
  if(item.target==='kadmeion.json')return {href:editor+'?panel=Metadata',label:'Edit SEO metadata in private editor',
    hint:'Save changes as a new revision and run preflight on that revision.'};
  if(item.target==='theme/tokens.json')return {href:editor,label:'Open editor for theme',hint:'Choose Theme in the editor.'};
  if(item.target==='source'||item.code==='CUSTOM_SOURCE_UNTRUSTED')return {href:editor,
    label:'Open editor for source',hint:'Choose Source or Content. Do not execute untrusted code in the release.'};
  if(item.code==='IMAGE_BYTES_UNVERIFIED'||item.code==='INVALID_IMAGE_REFERENCE')return {href:editor,
    label:'Open editor for image',hint:'Choose Content and Assets; use an authorized image with valid alt/decorative metadata. Unverified bytes remain blocked.'};
  if(item.target==='pages/home.page.json'||item.target==='content'||item.target==='plan'||item.target==='snapshot'||item.target==='preview')
    return {href:editor,label:'Open editor to review structure',hint:'Inspect Structure & layers and Content; save a valid new revision.'};
  return {href:editor,label:'Open editor for this slot',hint:'Choose Content and locate the indicated slot in Structure & layers.'};
}
function PreflightResults({result,portfolioId,revision,mode}:{result:SafePreviewResult;portfolioId:string;revision:number;mode:'publish'|'releases'}) {
  return <section className="ws-release-action" role="group" aria-labelledby="preflight-results">
    <h3 id="preflight-results">Preflight results</h3>
    <p role="status">Private renderability check for frozen revision {revision}. No published release or host readiness proof.</p>
    <p>Issues describe the immutable pin; edits affect a new saved revision only.</p>
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
          {destination&&<p><a href={destination.href}>{destination.label}</a> · {destination.hint}</p>}
        </li>;
      })}</ul>:<p>None in this category.</p>}
    </div>)}
    {result.previewHtml && <iframe title="Private scriptless preview" className="ws-private-static-preview"
      sandbox="" referrerPolicy="no-referrer" srcDoc={result.previewHtml}/>}
    <p className="ws-field-hint">Publication remains blocked until host proof and separate authorization.</p>
  </section>;
}
