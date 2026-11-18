import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
import { accountSharingConfirmations } from '../../../packages/contracts/src/private-moderation-service.ts';
import type {
  AccountSharingAction,AccountSharingIntent,OperatorAccountSharingState,
  SupabasePrivateModerationService, OperatorModerationCase,
  OperatorPortfolioAbuseReport, ModerationReason, OwnerModerationCase, OwnerModerationEvent, OperatorAppealEvidence
} from '../../../packages/contracts/src/private-moderation-service.ts';

/** Only these known paths can load the restricted operations shell. */
const routes = {
  '/app/operations/users': 'Admin users',
  '/app/operations/moderation': 'Portfolio moderation',
  '/app/operations/appeals': 'Appeals & case history'
} as const;
export function isOperatorRoute(path: string): boolean {
  return Object.hasOwn(routes, path);
}
type OperatorRoute = keyof typeof routes;
const reasons: ModerationReason[] = ['ABUSE', 'SECURITY', 'LEGAL', 'SPAM'];
const uuidPattern = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
function dateText(value: string) { return new Date(value).toLocaleString(); }
function errorMessage(value: unknown): string {
  if (value instanceof Error && value.name === 'PrivateModerationError') {
    return 'The role-checked moderation operation was not confirmed. Retry unchanged input for the same operation where supported. Check the current case state before starting a different action.';
  }
  return 'The private moderation service could not verify this operation.';
}
type Props = {service: SupabasePrivateModerationService; cases: OperatorModerationCase[];
  committed: (message: string) => void; recheck: () => void; isCurrent:()=>boolean};

// The server remains the authority; this gate only synchronizes form submissions
// and discards completions from a panel that has been removed or reverified.
function useScopedActionGate(scope: object,isCurrent:()=>boolean) {
  const active = useRef<object|null>(null);
  const pending = useRef<symbol|null>(null);
  useLayoutEffect(() => {
    active.current = scope;
    pending.current = null;
    return () => {
      if(active.current===scope){active.current=null;pending.current=null;}
    };
  }, [scope]);
  return {
    invalidate(): boolean {
      if(active.current!==scope||!isCurrent())return false;
      active.current=null;
      pending.current=null;
      return true;
    },
    begin(): symbol|null {
      if (active.current!==scope || pending.current !== null || !isCurrent()) return null;
      const token = Symbol();
      pending.current = token;
      return token;
    },
    current(token: symbol): boolean {
      return active.current===scope && pending.current === token && isCurrent();
    },
    finish(token: symbol): boolean {
      if (active.current!==scope || pending.current !== token || !isCurrent()) return false;
      pending.current = null;
      return true;
    }
  };
}
function accessMustBeRechecked(error: unknown): boolean {
  return error instanceof Error && error.name === 'PrivateModerationError' &&
    'code' in error && (error.code === 'AUTH_EXPIRED' || error.code === 'FORBIDDEN');
}

function Users({service, cases, committed, recheck,isCurrent}: Props) {
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState<ModerationReason>('ABUSE');
  const [summary, setSummary] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [operation, setOperation] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const gate = useScopedActionGate(service,isCurrent);
  const [retry,setRetry]=useState<{target:string;operation:string;reason:ModerationReason;summary:string}|null>(null);
  const [conflict,setConflict]=useState(false);
  const filtered = cases.filter(item =>
    item.targetUserId.toLowerCase().includes(query.trim().toLowerCase()) ||
    item.caseId.toLowerCase().includes(query.trim().toLowerCase()));
  async function open(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || conflict || (!retry&&(!confirmed || summary.trim().length < 20))) return;
    const submitted=retry??{target:target.trim(),operation,reason,summary:summary.trim()};
    const token = gate.begin();
    if (token === null) return;
    setBusy(true);setError('');
    try {
      const receipt = await service.openCase(submitted.target,submitted.operation,submitted.reason,submitted.summary);
      if (!gate.current(token)) return;
      if (receipt.status !== 'OPEN' || receipt.restrictionEnforced !== false)
        throw new Error('Audit-only case receipt was not confirmed.');
      setRetry(null);setConflict(false);setOperation(crypto.randomUUID());setTarget('');setSummary('');setConfirmed(false);
      committed('Private audit case recorded. No account restriction or public suspension was performed.');
    } catch (error) {
      if (gate.current(token)) {
        if (accessMustBeRechecked(error)) recheck();
        else if(!retry&&error instanceof Error&&'code' in error&&error.code==='VALIDATION'){
          setConfirmed(false);setError('The case was rejected as invalid. Review the details.');
        }else{
          setRetry(submitted);setConflict(error instanceof Error&&'code' in error&&error.code==='CONFLICT');
          setError('The case outcome is unconfirmed. Retry the exact request or reload the case list.');
        }
      }
    } finally {if (gate.finish(token)) setBusy(false);}
  }
  return <div className="ws-ops-grid">
    <section className="ws-project-aside">
      <h2>Scoped case directory</h2>
      <p>Only server-authorized case metadata is listed. No global user directory or private source browsing is available.</p>
      <label className="ws-ops-field">Find a case or owner ID
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search returned case IDs"/></label>
      {cases.length === 0 && <p>No operator cases were returned.</p>}
      {cases.length === 25 && <p>Showing at most 25 latest cases; this is not a platform-wide user count.</p>}
      {cases.length > 0 && filtered.length === 0 && <p>No matching authorized case.</p>}
      <ul className="ws-ops-records">{filtered.map(item => <li key={item.caseId}>
        <strong>{item.reasonCode} · {item.status}</strong>
        <span>Case {item.caseId}</span><span>Owner ID {item.targetUserId}</span>
        <small>{dateText(item.createdAt)}</small>
      </li>)}</ul>
    </section>
    <section className="ws-project-aside">
      <h2>Open a documented case</h2>
      <p>Opening a case creates an audit record, not an account ban, content edit, or verified public takedown.</p>
      <form className="ws-ops-form" onSubmit={event => void open(event)}>
        <label className="ws-ops-field">Exact target user ID
          <input required pattern={uuidPattern} value={target} disabled={busy||!!retry} onChange={event => {setTarget(event.target.value);setOperation(crypto.randomUUID());setConfirmed(false);}}
            autoComplete="off" placeholder="UUID from a verified report"/></label>
        <label className="ws-ops-field">Documented reason
          <select value={reason} disabled={busy||!!retry} onChange={event => {setReason(event.target.value as ModerationReason);setOperation(crypto.randomUUID());setConfirmed(false);}}>
            {reasons.map(item => <option key={item} value={item}>{item}</option>)}
          </select></label>
        <label className="ws-ops-field">Case summary
          <textarea required minLength={20} maxLength={500} value={summary} rows={5} disabled={busy||!!retry}
            onChange={event => {setSummary(event.target.value);setOperation(crypto.randomUUID());setConfirmed(false);}}/></label>
        <label className="ws-ops-confirm"><input type="checkbox" required checked={confirmed} disabled={busy||!!retry}
          onChange={event => setConfirmed(event.target.checked)}/>
          I confirm the serious-abuse scope and understand this is audit-only.
        </label>
        {error && <p role="alert" className="ws-inline-alert">{error}</p>}
        <button type="submit" className="ws-primary" disabled={busy || conflict || (!retry&&(!confirmed || summary.trim().length < 20))}>
          {busy ? 'Recording…' : retry?'Retry exact case':'Record private case'}
        </button>
        {retry&&<button type="button" className="ws-secondary" disabled={busy} onClick={recheck}>Reload cases (outcome unverified)</button>}
      </form>
    </section>
  </div>;
}

function Moderation({service, cases, reports, committed, recheck,isCurrent}: Props & {
  reports: OperatorPortfolioAbuseReport[];
}) {
  const pageSize=25;
  const [page,setPage]=useState({after:null as string|null,rows:reports});
  const [pageError,setPageError]=useState('');
  const [failedCursor,setFailedCursor]=useState<{after:string|null}|null>(null);
  const [selected, setSelected] = useState('');
  const [uncertain,setUncertain]=useState<{
    reportId:string; decision:'CASE_OPENED'|'DISMISSED'; rationale:string
  }|null>(null);
  const [reviewConflict,setReviewConflict]=useState(false);
  const [reviewError,setReviewError]=useState('');
  const [decision, setDecision] = useState<'CASE_OPENED'|'DISMISSED'>('CASE_OPENED');
  const [rationale, setRationale] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [holdCase, setHoldCase] = useState('');
  const [portfolio, setPortfolio] = useState('');
  const [holdConfirmed, setHoldConfirmed] = useState(false);
  const [holdOperation, setHoldOperation] = useState(() => crypto.randomUUID());
  const [holdRetry,setHoldRetry]=useState<{caseId:string;portfolioId:string;operation:string}|null>(null);
  const [holdConflict,setHoldConflict]=useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const gate = useScopedActionGate(service,isCurrent);
  function clearReview() {
    setSelected('');setRationale('');setConfirmed(false);
    setUncertain(null);setReviewConflict(false);setReviewError('');
  }
  // Keep one bounded page. Every page is a fresh role-checked RPC.
  async function loadPage(after:string|null) {
    if(busy||selected||uncertain||holdRetry)return;
    const token=gate.begin();
    if(token===null)return;
    setBusy(true);setPageError('');setFailedCursor(null);
    try{
      const rows=await service.listAbuseReports(after,pageSize);
      if(gate.current(token))setPage({after,rows});
    }catch(error){
      if(!gate.current(token))return;
      if(accessMustBeRechecked(error))recheck();
      else{
        setPageError('The requested page could not be verified. The previous page is unchanged.');
        setFailedCursor({after});
      }
    }finally{if(gate.finish(token))setBusy(false);}
  }
  async function review(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(busy||reviewConflict||holdRetry)return;
    if(!uncertain&&(!selected||!confirmed||rationale.trim().length<20||
      !page.rows.some(report=>report.id===selected)))return;
    // The server's replay identity is actor+report+decision+trimmed rationale.
    const submitted=uncertain??{reportId:selected,decision,rationale:rationale.trim()};
    const token=gate.begin();
    if(token===null)return;
    setBusy(true);setReviewError('');
    try{
      const receipt=await service.reviewAbuseReport(submitted.reportId,submitted.decision,submitted.rationale);
      if(!gate.current(token))return;
      if(receipt.reportId!==submitted.reportId||receipt.status!==submitted.decision)
        throw new Error('Unverified report receipt.');
      clearReview();
      committed(receipt.status==='CASE_OPENED'
        ? 'Report reviewed. Private audit case opened; public revocation remains unverified.'
        : 'Report dismissed with an audited rationale.');
    }catch(error){
      if(!gate.current(token))return;
      if(accessMustBeRechecked(error)){recheck();return;}
      const code=error instanceof Error&&'code' in error?error.code:null;
      if(code==='CONFLICT'){
        setUncertain(submitted);setReviewConflict(true);
        setReviewError('The server reported a conflicting review. Reload the queue; this is not confirmation of your decision.');
      }else if(code==='VALIDATION'&&!uncertain){
        setConfirmed(false);
        setReviewError('The review was rejected as invalid. Check the decision and rationale.');
      }else{
        setUncertain(submitted);
        setReviewError('The decision was not acknowledged. Retry the exact submission, or reload without claiming success.');
      }
    }finally{if(gate.finish(token))setBusy(false);}
  }
  async function hold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((!holdRetry&&(!holdConfirmed||!cases.some(item=>item.caseId===holdCase&&item.status!=='CLOSED'))) || busy || !!selected || !!uncertain || holdConflict) return;
    const submitted=holdRetry??{caseId:holdCase,portfolioId:portfolio.trim(),operation:holdOperation};
    const token = gate.begin();
    if (token === null) return;
    setBusy(true);setError('');
    try {
      const receipt = await service.blockPrivatePortfolio(submitted.caseId,submitted.portfolioId,submitted.operation);
      if (!gate.current(token)) return;
      if (!receipt.stillBlocked || receipt.publicServingEnabled !== false)
        throw new Error('Unverified hold receipt.');
      setHoldRetry(null);setHoldConflict(false);setHoldConfirmed(false);setPortfolio('');setHoldOperation(crypto.randomUUID());
      committed('Case-bound private portfolio hold confirmed. This is NOT public host revocation.');
    } catch (error) {
      if (gate.current(token)) {
        if (accessMustBeRechecked(error)) recheck();
        else if(!holdRetry&&error instanceof Error&&'code' in error&&error.code==='VALIDATION'){
          setHoldConfirmed(false);setError('The hold request was rejected as invalid. Review the target.');
        }else{
          setHoldRetry(submitted);setHoldConflict(error instanceof Error&&'code' in error&&error.code==='CONFLICT');
          setError('The hold outcome is unconfirmed. Retry the exact hold or reload before another action.');
        }
      }
    } finally {if (gate.finish(token)) setBusy(false);}
  }
  return <div className="ws-ops-grid">
    <section className="ws-project-aside">
      <h2>Submitted portfolio reports</h2>
      <p>Reports are untrusted text, shown only after the backend verifies the operator session.</p>
      <p>Pending reports are ordered by report ID, not submission time. The queue may change during review.</p>
      {page.rows.length===0&&<p>{page.after===null?'No pending abuse reports were returned.':'No further pending reports were returned.'}</p>}
      {pageError&&<p role="alert">{pageError}</p>}
      <div className="ws-ops-nav" aria-label="Report queue pages">
        <button type="button" className="ws-secondary" disabled={busy||!!selected||!!uncertain||!!holdRetry}
          onClick={()=>void loadPage(null)}>{page.after===null?'Refresh first page':'Return to first page'}</button>
        {page.rows.length===pageSize&&<button type="button" className="ws-secondary"
          disabled={busy||!!selected||!!uncertain||!!holdRetry}
          onClick={()=>void loadPage(page.rows[page.rows.length-1]!.id)}>Next reports</button>}
        {failedCursor&&<button type="button" className="ws-secondary" disabled={busy||!!selected||!!uncertain||!!holdRetry}
          onClick={()=>void loadPage(failedCursor.after)}>Retry requested page</button>}
      </div>
      <ul className="ws-ops-records">{page.rows.map(report => <li key={report.id}>
        <strong>{report.reason_code} · {report.target_path}</strong>
        <small>{dateText(report.created_at)}</small>
        <p className="ws-ops-evidence">{report.evidence}</p>
        <button type="button" className="ws-secondary" aria-pressed={selected === report.id} disabled={busy||!!uncertain||!!selected||!!holdRetry}
          onClick={() => {setSelected(report.id);setRationale('');setConfirmed(false);setReviewError('');}}>Review report</button>
      </li>)}</ul>
      {selected && <form className="ws-ops-form" onSubmit={event => void review(event)}>
        <h3>Review selected report</h3>
        <p>Report ID: {selected}</p>
        <label className="ws-ops-field">Decision<select value={decision} disabled={busy||!!uncertain}
          onChange={event => {setDecision(event.target.value as 'CASE_OPENED'|'DISMISSED');setConfirmed(false);}}>
          <option value="CASE_OPENED">Open audited case</option>
          <option value="DISMISSED">Dismiss report</option>
        </select></label>
        <label className="ws-ops-field">Reasoned review
          <textarea required minLength={20} maxLength={500} value={rationale} rows={4} disabled={busy||!!uncertain}
            onChange={event => {setRationale(event.target.value);setConfirmed(false);}}/></label>
        <label className="ws-ops-confirm"><input type="checkbox" checked={confirmed} required disabled={busy||!!uncertain} onChange={event => setConfirmed(event.target.checked)}/>
          This decision is scoped to the selected report.
        </label>
        {reviewError&&<p role="alert">{reviewError}</p>}
        <button type="submit" className="ws-primary"
          disabled={busy||reviewConflict||(!uncertain&&(!confirmed||rationale.trim().length<20))}>
          {busy?'Reviewing…':uncertain?'Retry exact decision':'Submit report decision'}
        </button>
        {uncertain?<button type="button" className="ws-secondary" disabled={busy}
          onClick={()=>recheck()}>Discard retry details and reload queue (outcome unverified)</button>:
          <button type="button" className="ws-secondary" disabled={busy} onClick={clearReview}>Cancel review</button>}
      </form>}
    </section>
    <section className="ws-project-aside">
      <h2>Private moderation hold</h2>
      <p>A case-specific private hold is possible. It never proves public URL or CDN revocation.</p>
      <form className="ws-ops-form" onSubmit={event => void hold(event)}>
        <label className="ws-ops-field">Verified case<select required value={holdCase} disabled={busy||!!holdRetry||!!selected||!!uncertain}
          onChange={event => {setHoldCase(event.target.value);setHoldConfirmed(false);setHoldOperation(crypto.randomUUID());}}>
          <option value="">Select a case</option>
          {cases.filter(item => item.status !== 'CLOSED').map(item =>
            <option key={item.caseId} value={item.caseId}>{item.caseId} ({item.status})</option>)}
        </select></label>
        <label className="ws-ops-field">Private portfolio ID
          <input required pattern={uuidPattern} value={portfolio} disabled={busy||!!holdRetry} onChange={event => {setPortfolio(event.target.value);setHoldConfirmed(false);setHoldOperation(crypto.randomUUID());}}/>
        </label>
        <label className="ws-ops-confirm"><input type="checkbox" checked={holdConfirmed} required disabled={busy||!!holdRetry}
          onChange={event => setHoldConfirmed(event.target.checked)}/>Apply only a case-bound private hold.</label>
        {error && <p role="alert">{error}</p>}
        <button className="ws-primary" type="submit" disabled={busy || !!selected || !!uncertain || holdConflict || (!holdRetry&&(!holdCase || !holdConfirmed))}>
          {busy ? 'Applying…' : holdRetry?'Retry exact hold':'Apply private hold'}</button>
        {holdRetry&&<button type="button" className="ws-secondary" disabled={busy} onClick={recheck}>Reload case state (outcome unverified)</button>}
      </form>
    </section>
  </div>;
}

function Appeals({service, cases, committed, recheck,isCurrent}: Props) {
  const [chosen, setChosen] = useState('');
  const [evidence,setEvidence]=useState<OperatorAppealEvidence|null>(null);
  const [evidenceError,setEvidenceError]=useState(false);
  const [evidenceAttempt,setEvidenceAttempt]=useState(0);
  const [rationale, setRationale] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [operation, setOperation] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const gate = useScopedActionGate(service,isCurrent);
  const [holdPortfolio, setHoldPortfolio] = useState('');
  const [liftCase, setLiftCase] = useState('');
  const [liftReason, setLiftReason] = useState('');
  const [liftConfirm, setLiftConfirm] = useState(false);
  const [liftOperation, setLiftOperation] = useState(() => crypto.randomUUID());
  const [retry,setRetry]=useState<{kind:'close';caseId:string;operation:string;rationale:string}|{kind:'lift';caseId:string;portfolioId:string;operation:string;rationale:string}|null>(null);
  const [conflict,setConflict]=useState(false);
  useLayoutEffect(()=>{
    let active=true;
    setEvidence(null);
    setEvidenceError(false);
    if (chosen) void service.readAppealEvidence(chosen)
      .then(data=>{if(active&&isCurrent()) setEvidence(data);})
      .catch(error=>{
        if (!active||!isCurrent()) return;
        // The unavailable-evidence state remains closed; authoritative denial
        // also discards the old role-verified snapshot before another action.
        if (accessMustBeRechecked(error)) recheck();
        else setEvidenceError(true);
      });
    return ()=>{active=false;};
  },[service,chosen,evidenceAttempt,recheck,isCurrent]);
  async function close(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(busy||conflict||retry?.kind==='lift'||(!retry&&(!chosen || evidence?.caseId!==chosen || !confirmed || rationale.trim().length < 20)))return;
    const submitted=retry?.kind==='close'?retry:{kind:'close' as const,caseId:chosen,operation,rationale:rationale.trim()};
    const token = gate.begin();
    if (token === null) return;
    setBusy(true);setError('');
    try {
      const receipt = await service.closeCase(submitted.caseId,submitted.operation,submitted.rationale);
      if (!gate.current(token)) return;
      if (receipt.status !== 'CLOSED' || receipt.restrictionEnforced !== false)
        throw new Error('Unverified case closure.');
      setRetry(null);setConflict(false);setOperation(crypto.randomUUID());setChosen('');setRationale('');setConfirmed(false);
      committed('Case closed with an audit decision. No public release or account restoration was asserted.');
    } catch (error) {
      if (gate.current(token)) {
        if (accessMustBeRechecked(error)) recheck();
        else if(!retry&&error instanceof Error&&'code' in error&&error.code==='VALIDATION'){
          setError('The case action was rejected as invalid. Review the details.');
        }else{
          setRetry(submitted);setConflict(error instanceof Error&&'code' in error&&error.code==='CONFLICT');
          setError('The action outcome is unconfirmed. Retry the exact action or reload before continuing.');
        }
      }
    } finally {if (gate.finish(token)) setBusy(false);}
  }
  async function lift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(busy||conflict||retry?.kind==='close'||(!retry&&(!liftCase || !liftConfirm || liftReason.trim().length < 20)))return;
    const submitted=retry?.kind==='lift'?retry:{kind:'lift' as const,caseId:liftCase,portfolioId:holdPortfolio.trim(),operation:liftOperation,rationale:liftReason.trim()};
    const token = gate.begin();
    if (token === null) return;
    setBusy(true);setError('');
    try {
      const receipt = await service.liftPrivateHold(submitted.caseId,submitted.portfolioId,submitted.operation,submitted.rationale);
      if (!gate.current(token)) return;
      if (receipt.publicServingEnabled !== false) throw new Error('Unverified release state.');
      setRetry(null);setConflict(false);setLiftCase('');setHoldPortfolio('');setLiftReason('');setLiftConfirm(false);setLiftOperation(crypto.randomUUID());
      committed('Private hold released after case review; public delivery remains blocked.');
    } catch (error) {
      if (gate.current(token)) {
        if (accessMustBeRechecked(error)) recheck();
        else if(!retry&&error instanceof Error&&'code' in error&&error.code==='VALIDATION'){
          setError('The case action was rejected as invalid. Review the details.');
        }else{
          setRetry(submitted);setConflict(error instanceof Error&&'code' in error&&error.code==='CONFLICT');
          setError('The action outcome is unconfirmed. Retry the exact action or reload before continuing.');
        }
      }
    } finally {if (gate.finish(token)) setBusy(false);}
  }
  return <div className="ws-ops-grid">
    <section className="ws-project-aside">
      <h2>Appeals awaiting review</h2>
      <p>Select a pending case to review its original summary and latest owner statement.</p>
      {cases.filter(item => item.status === 'APPEAL_PENDING').length === 0 && <p>No pending appeals were returned.</p>}
      <ul className="ws-ops-records">{cases.filter(item => item.status === 'APPEAL_PENDING').map(item => <li key={item.caseId}>
        <strong>{item.reasonCode} · Appeal pending</strong><span>Case {item.caseId}</span>
        <span>Owner ID {item.targetUserId}</span>
        <button type="button" className="ws-secondary" disabled={busy||!!retry} onClick={()=>{
          if(chosen===item.caseId)return;
          setChosen(item.caseId);setEvidence(null);setEvidenceError(false);
          setConfirmed(false);setRationale('');setError('');setOperation(crypto.randomUUID());
        }}>
          Select for decision</button>
      </li>)}</ul>
      {chosen && !evidence && (evidenceError ? <div>
        <p role="alert">Evidence could not be verified. A decision requires the owner statement.</p>
        <button type="button" className="ws-secondary" disabled={busy||!!retry} onClick={()=>{setConfirmed(false);setEvidenceAttempt(value=>value+1);}}>Retry appeal evidence</button>
      </div> : <p role="status">Loading private appeal evidence…</p>)}
      {evidence?.caseId===chosen && <form className="ws-ops-form" onSubmit={event => void close(event)}>
        <h3>Resolve a verified case</h3>
        <dl><dt>Original reason</dt><dd>{evidence.reasonCode}</dd><dt>Case summary</dt><dd>{evidence.summary}</dd>
          <dt>Owner statement</dt><dd>{evidence.statement}</dd>
          <dt>Submitted</dt><dd><time dateTime={evidence.submittedAt}>{dateText(evidence.submittedAt)}</time></dd></dl>
        <label className="ws-ops-field">Decision rationale<textarea required rows={4} minLength={20} maxLength={2000}
          value={rationale} disabled={busy||!!retry} onChange={event => {setRationale(event.target.value);setOperation(crypto.randomUUID());setConfirmed(false);}}/></label>
        <label className="ws-ops-confirm"><input type="checkbox" required checked={confirmed} disabled={busy||!!retry}
          onChange={event => setConfirmed(event.target.checked)}/>Close only the selected audited case.</label>
        {error && <p role="alert">{error}</p>}
        <button className="ws-primary" disabled={busy||conflict||retry?.kind==='lift'||(!retry&&(!confirmed||rationale.trim().length<20))} type="submit">
          {busy ? 'Recording…' : retry?.kind==='close'?'Retry exact decision':'Record case decision'}</button>
      </form>}
    </section>
    <section className="ws-project-aside">
      <h2>Internal hold release</h2>
      <p>Administrator-only. Requires a resolved case and a matching private portfolio hold. This does not republish content.</p>
      <form className="ws-ops-form" onSubmit={event => void lift(event)}>
        <label className="ws-ops-field">Resolved case<select required value={liftCase} disabled={busy||!!retry}
          onChange={event => {setLiftCase(event.target.value);setLiftConfirm(false);setLiftOperation(crypto.randomUUID());}}>
          <option value="">Select closed case</option>
          {cases.filter(item => item.status === 'CLOSED').map(item =>
            <option key={item.caseId} value={item.caseId}>{item.caseId}</option>)}
        </select></label>
        <label className="ws-ops-field">Portfolio ID
          <input required value={holdPortfolio} pattern={uuidPattern} disabled={busy||!!retry} onChange={event => {setHoldPortfolio(event.target.value);setLiftConfirm(false);setLiftOperation(crypto.randomUUID());}}/></label>
        <label className="ws-ops-field">Hold-release rationale<textarea required minLength={20} maxLength={2000}
          rows={4} value={liftReason} disabled={busy||!!retry} onChange={event => {setLiftReason(event.target.value);setLiftConfirm(false);setLiftOperation(crypto.randomUUID());}}/></label>
        <label className="ws-ops-confirm"><input type="checkbox" checked={liftConfirm} required disabled={busy||!!retry}
          onChange={event => setLiftConfirm(event.target.checked)}/>No public publication is authorized by this action.</label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" className="ws-primary" disabled={busy||conflict||retry?.kind==='close'||(!retry&&(!liftConfirm||!liftCase||liftReason.trim().length<20))}>
          {busy ? 'Recording…' : retry?.kind==='lift'?'Retry exact release':'Release private hold'}</button>
        {retry&&<button type="button" className="ws-secondary" disabled={busy} onClick={recheck}>Reload cases (outcome unverified)</button>}
      </form>
    </section>
  </div>;
}


const sharingActionLabel:Record<AccountSharingAction,string>={
  RESTRICT:'Restrict public sharing',UPHOLD:'Uphold restriction',RESTORE:'Restore sharing eligibility'
};
function AccountSharingPanel({service,cases,committed,recheck,isCurrent}:Props){
  const [chosen,setChosen]=useState('');
  const target=cases.find(item=>item.caseId===chosen);
  const [attempt,setAttempt]=useState(0);
  const scope=useMemo(()=>({service,chosen,attempt}),[service,chosen,attempt]);
  const gate=useScopedActionGate(scope,isCurrent);
  const [loaded,setLoaded]=useState<{scope:typeof scope;state:OperatorAccountSharingState;evidence:OperatorAppealEvidence|null}|null>(null);
  const snapshot=loaded?.scope===scope?loaded:null;
  const [failed,setFailed]=useState(false);
  const [action,setAction]=useState<AccountSharingAction|null>(null);
  const [rationale,setRationale]=useState('');
  const [confirmation,setConfirmation]=useState('');
  const [busy,setBusy]=useState(false);
  const [retry,setRetry]=useState<AccountSharingIntent|null>(null);
  const [conflict,setConflict]=useState(false);
  const [error,setError]=useState('');
  const clearDecision=()=>{
    setAction(null);setRationale('');setConfirmation('');setRetry(null);setConflict(false);setError('');
  };
  useLayoutEffect(()=>{
    let active=true;setFailed(false);setLoaded(null);
    if(!target)return ()=>{active=false;};
    void(async()=>{
      const state=await service.readAccountSharingRestriction(target.caseId,target.targetUserId);
      if(!active||!isCurrent())return;
      let evidence:OperatorAppealEvidence|null=null;
      if(target.status==='APPEAL_PENDING'&&state.allowedActions.length>0){
        evidence=await service.readAppealEvidence(target.caseId);
        if(evidence.caseId!==target.caseId)throw new Error('Unverified appeal evidence.');
      }
      if(active&&isCurrent())setLoaded({scope,state,evidence});
    })().catch(reason=>{
      if(!active||!isCurrent())return;
      if(accessMustBeRechecked(reason))recheck();
      else setFailed(true);
    });
    return ()=>{active=false;};
  },[scope,target,service,isCurrent,recheck]);
  function refresh(){
    if(busy)return;
    if(!gate.invalidate())return;
    clearDecision();setLoaded(null);setAttempt(value=>value+1);
  }
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(busy||conflict||!snapshot||!target)return;
    if(!retry&&(!action||!snapshot.state.allowedActions.includes(action)||
      confirmation!==accountSharingConfirmations[action]||rationale.trim().length<20||
      (target.status==='APPEAL_PENDING'&&snapshot.evidence?.caseId!==target.caseId)))return;
    const intent=retry??(action?{
      caseId:target.caseId,ownerUserId:snapshot.state.ownerUserId,action,
      expectedVersion:snapshot.state.version,operationId:crypto.randomUUID(),
      rationale:rationale.trim(),confirmation
    }:null);
    if(!intent)return;
    const token=gate.begin();if(token===null)return;
    setBusy(true);setError('');
    try{
      const receipt=await service.changeAccountSharingRestriction(intent);
      if(!gate.current(token))return;
      clearDecision();
      committed(receipt.status==='ACTIVE'
        ?'Application public-sharing restriction recorded for the case. Private account access remains available; independent host revocation is not verified.'
        :'Sharing eligibility restored. Previous releases remain withdrawn; nothing was republished.');
    }catch(reason){
      if(!gate.current(token))return;
      if(accessMustBeRechecked(reason)){recheck();return;}
      const code=reason instanceof Error&&'code' in reason?reason.code:null;
      if(!retry&&code==='VALIDATION'){
        setConfirmation('');setError('Decision rejected as invalid. Review the exact rationale and confirmation.');
      }else{
        setRetry(intent);setConflict(code==='CONFLICT');
        setError(code==='CONFLICT'
          ?'The case version or operation conflicts. Reload the authoritative case state before another decision.'
          :'Decision acknowledgement is unverified. Retry the identical operation or reload without assuming success.');
      }
    }finally{if(gate.finish(token))setBusy(false);}
  }
  const state=snapshot?.state;
  const canSubmit=!!state&&!!action&&state.allowedActions.includes(action)&&
    confirmation===accountSharingConfirmations[action]&&rationale.trim().length>=20&&
    (target?.status!=='APPEAL_PENDING'||snapshot?.evidence?.caseId===target.caseId);
  return <section className="ws-project-aside" aria-label="Account public-sharing authority">
    <h2>Case-bound public-sharing restriction</h2>
    <p>Only an administrator can apply or resolve a verified restriction. Private authoring, account access and appeals are not revoked. Restoring eligibility never republishes old releases.</p>
    <label className="ws-ops-field">Account restriction case
      <select value={chosen} disabled={busy||!!retry} onChange={event=>{
        if(busy||retry||!gate.invalidate())return;clearDecision();setLoaded(null);setChosen(event.target.value);
      }}><option value="">Choose a documented case</option>
        {cases.map(item=><option key={item.caseId} value={item.caseId}>{item.caseId} · {item.status}</option>)}
      </select>
    </label>
    {chosen&&!snapshot&&!failed&&<p role="status">Checking current restriction authority…</p>}
    {chosen&&failed&&<><p role="alert">Account sharing authority could not be verified. No restriction action is available.</p>
      <button className="ws-secondary" type="button" onClick={refresh}>Retry authority read</button></>}
    {state&&<>
      <dl><dt>Account sharing</dt><dd>{state.status==='ACTIVE'?'Restricted':'Clear'}</dd>
        <dt>Current case</dt><dd>{state.currentCaseId??'None'}</dd>
        <dt>Authority version</dt><dd>{state.version}</dd>
      </dl>
      {state.allowedActions.length===0&&<p>No account-sharing decision is currently authorized for this case and session.</p>}
      {snapshot?.evidence&&<dl><dt>Case summary</dt><dd>{snapshot.evidence.summary}</dd>
        <dt>Owner appeal</dt><dd>{snapshot.evidence.statement}</dd></dl>}
      {state.allowedActions.length>0&&<form className="ws-ops-form" onSubmit={event=>void submit(event)}>
        <label className="ws-ops-field">Restriction decision<select required value={action??''} disabled={busy||!!retry} onChange={event=>{
          const value=event.target.value as AccountSharingAction;
          setAction(state.allowedActions.includes(value)?value:null);setConfirmation('');setError('');
        }}><option value="">Choose decision</option>{state.allowedActions.map(value=><option key={value} value={value}>{sharingActionLabel[value]}</option>)}</select></label>
        <label className="ws-ops-field">Owner-visible decision rationale<textarea required rows={4} minLength={20} maxLength={500} value={rationale} disabled={busy||!!retry} onChange={event=>{setRationale(event.target.value);setConfirmation('');}}/></label>
        {action&&<label className="ws-ops-field">Type {accountSharingConfirmations[action]} to confirm
          <input required autoComplete="off" value={confirmation} disabled={busy||!!retry} onChange={event=>setConfirmation(event.target.value)}/>
        </label>}
        {error&&<p role="alert">{error}</p>}
        <button className="ws-primary" type="submit" disabled={busy||conflict||(!retry&&!canSubmit)}>{busy?'Recording…':retry?'Retry exact restriction decision':'Record restriction decision'}</button>
      </form>}
      <button className="ws-secondary" type="button" disabled={busy} onClick={refresh}>{retry?'Discard retry details and reload authority (outcome unverified)':'Refresh restriction authority'}</button>
    </>}
  </section>;
}

type OperatorScope = {port: SupabaseBrowserAuthPort; path: string; attempt: number;epoch:number};
type OperatorSnapshot = {
  scope: OperatorScope;
  access: 'allowed' | 'denied' | 'unavailable';
  service: SupabasePrivateModerationService | null;
  cases: OperatorModerationCase[];
  reports: OperatorPortfolioAbuseReport[];
};

export function OperatorConsole({port, path}: {port: SupabaseBrowserAuthPort; path: string}) {
  const [attempt, setAttempt] = useState(0);
  const [epoch]=useState(()=>port.getOwnerSessionEpoch());
  const isCurrent=useCallback(()=>{
    try{return port.reconcileOwnerSessionEpoch()===epoch;}catch{return false;}
  },[port,epoch]);
  // An operator response is valid only for its exact owner adapter, route and
  // verification attempt. Fail closed immediately when any of those change.
  const scope = useMemo<OperatorScope>(() => ({port, path, attempt,epoch}), [port, path, attempt,epoch]);
  const [snapshot, setSnapshot] = useState<OperatorSnapshot | null>(null);
  const current = snapshot?.scope === scope ? snapshot : null;
  const access = current?.access ?? 'checking';
  const service = current?.service ?? null;
  const cases = current?.cases ?? [];
  const reports = current?.reports ?? [];
  const [lastNotice, setLastNotice] = useState<{port:SupabaseBrowserAuthPort;path:string;text:string}|null>(null);
  const notice = lastNotice?.port === port && lastNotice.path === path ? lastNotice.text : '';
  useEffect(() => {
    let active = true;
    void (async () => {
      const connected = await port.privateModeration();
      if(!active||!isCurrent())return;
      if (!connected.data) throw connected.error ?? new Error('Operator service unavailable.');
      const verifiedCases = await connected.data.listOperatorCases(25);
      if(!active||!isCurrent())return;
      const verifiedReports = path === '/app/operations/moderation' ?
        await connected.data.listAbuseReports(null, 25) : [];
      if (active&&isCurrent()) setSnapshot({
        scope, service: connected.data, cases: verifiedCases, reports: verifiedReports, access: 'allowed'
      });
    })().catch((error: unknown) => {
      if (active&&isCurrent()) {
        // Only definitive server authorization errors count as role denial.
        const code = error instanceof Error && error.name === 'PrivateModerationError' &&
          'code' in error ? String(error.code) : '';
        setSnapshot({
          scope, service: null, cases: [], reports: [],
          access: code === 'FORBIDDEN' || code === 'AUTH_EXPIRED' ? 'denied' : 'unavailable'
        });
      }
    });
    return () => {active = false;};
  }, [scope, port, path,isCurrent]);
  const recheck = useCallback(() => {
    if(!isCurrent())return;
    setLastNotice(null);
    setAttempt(value => value + 1);
  }, [isCurrent]);
  function committed(message: string) {
    if(!isCurrent())return;
    setLastNotice({port,path,text:message});
    setAttempt(value => value + 1);
  }
  if (!isOperatorRoute(path)) return null;
  if (access === 'checking') return <section className="ws-ops-lock" aria-busy="true">
    <h1>Checking operator authorization.</h1><p role="status">Verifying restricted case access with the server…</p>
  </section>;
  if (access !== 'allowed' || !service) return <section className="ws-ops-lock">
    <h1>{access === 'denied' ? 'Restricted operations.' : 'Operator verification unavailable.'}</h1>
    <p role="alert">{access === 'denied'
      ? 'The server did not authorize this session to inspect moderation cases. No private case or user records were loaded.'
      : 'Operator authorization or private case records could not be verified. Access stays closed until a successful server response; this is not proof your role was denied.'}</p>
    <button type="button" className="ws-secondary" onClick={() => setAttempt(value => value + 1)}>Retry operator verification</button>
    <p><a href="/app">Return to your private workspace</a></p>
  </section>;
  return <section aria-labelledby="ops-title" className="ws-ops">
    <div className="ws-heading">
      <p className="ws-kicker">RESTRICTED OPERATIONS</p>
      <h1 id="ops-title">{routes[path as OperatorRoute]}</h1>
      <p>Role-checked case handling. No impersonation, private source editing or public release authority.</p>
    </div>
    <nav className="ws-ops-nav" aria-label="Restricted operation areas">
      {(Object.entries(routes) as [OperatorRoute,string][]).map(([href,label]) =>
        <a className="ws-secondary" key={href} href={href} aria-current={path === href ? 'page' : undefined}>{label}</a>)}
    </nav>
    {notice && <p role="status" className="ws-inline-alert">{notice}</p>}
    {path === '/app/operations/users' && <Users service={service} cases={cases} committed={committed} recheck={recheck} isCurrent={isCurrent}/>}
    {path === '/app/operations/moderation' &&
      <Moderation service={service} cases={cases} reports={reports} committed={committed} recheck={recheck} isCurrent={isCurrent}/>}
    {path === '/app/operations/appeals' && <Appeals service={service} cases={cases} committed={committed} recheck={recheck} isCurrent={isCurrent}/>}
    {(path==='/app/operations/moderation'||path==='/app/operations/appeals')&&
      <AccountSharingPanel service={service} cases={cases} committed={committed} recheck={recheck} isCurrent={isCurrent}/>}
  </section>;
}

const ownerCaseStatus = {OPEN:'Open',APPEAL_PENDING:'Appeal pending',CLOSED:'Closed'} as const;
const ownerEventTitle = {OPENED:'Case opened',OWNER_APPEAL:'Appeal submitted',
  OPERATOR_DECISION:'Decision recorded',OPERATOR_HOLD_LIFT:'Private hold lifted',
  ACCOUNT_SHARING_RESTRICTED:'Public sharing restricted',ACCOUNT_SHARING_UPHELD:'Restriction upheld',
  ACCOUNT_SHARING_RESTORED:'Sharing eligibility restored'} as const;

/** Notice links carry only a private case ID, never owner/provider credentials. */
function noticeCaseId(search:string):string|null {
  const values=new URLSearchParams(search).getAll('case');
  return values.length===1 && new RegExp('^'+uuidPattern+'$').test(values[0]!)
    ? values[0]!.toLowerCase() : null;
}
type OwnerSharingReceipt={status:'CLEAR'|'ACTIVE';version:number;currentCaseId:string|null;
  scope:'ACCOUNT_PUBLIC_SHARING';updatedAt:string|null};
type OwnerSharingTransport={readOwnerAccountSharingRestriction(epoch:number):Promise<{data:OwnerSharingReceipt|null;error:unknown|null}>};
/** #119 is supplied by S1. A missing/unavailable producer is never a CLEAR receipt. */
function OwnerSharingStatus({port,epoch,attempt,isCurrent}:{port:SupabaseBrowserAuthPort;
  epoch:number;attempt:number;isCurrent:()=>boolean}){
  const [retry,setRetry]=useState(0);
  const scope=useMemo(()=>({port,epoch,attempt,retry}),[port,epoch,attempt,retry]);
  const [result,setResult]=useState<{scope:typeof scope;receipt:OwnerSharingReceipt|null}|null>(null);
  const current=result?.scope===scope?result:null;
  useLayoutEffect(()=>{
    let active=true;
    const reader=(port as SupabaseBrowserAuthPort&Partial<OwnerSharingTransport>).readOwnerAccountSharingRestriction;
    if(typeof reader!=='function'){
      if(isCurrent())setResult({scope,receipt:null});
      return ()=>{active=false;};
    }
    void reader.call(port,epoch).then(response=>{
      if(active&&isCurrent())setResult({scope,receipt:response.error===null?response.data:null});
    }).catch(()=>{if(active&&isCurrent())setResult({scope,receipt:null});});
    return ()=>{active=false;};
  },[scope,port,epoch,isCurrent]);
  return <section className="ws-project-aside" aria-label="Your account public-sharing status">
    <h2>Public sharing status</h2>
    {!current&&<p role="status">Checking your account sharing status…</p>}
    {current&&!current.receipt&&<><p>Current public-sharing authority is unavailable. This is not confirmation that sharing is unrestricted.</p>
      <button type="button" className="ws-secondary" onClick={()=>setRetry(value=>value+1)}>Retry sharing status</button></>}
    {current?.receipt?.status==='CLEAR'&&<p>No active account-wide public-sharing restriction was returned. Individual portfolio holds and publication checks still apply.</p>}
    {current?.receipt?.status==='ACTIVE'&&<>
      <p>Your account's public sharing is restricted. Private workspace access, editing and account recovery remain available. Review the case and appeal if eligible.</p>
      <a className="ws-secondary" href={'/app/settings/cases?case='+encodeURIComponent(current.receipt.currentCaseId!)}>Open restriction case</a>
    </>}
  </section>;
}

export function OwnerCaseHistory({port}:{port:SupabaseBrowserAuthPort}) {
  const [attempt,setAttempt]=useState(0);
  const [epoch]=useState(()=>port.getOwnerSessionEpoch());
  const isCurrent=useCallback(()=>{
    try{return port.reconcileOwnerSessionEpoch()===epoch;}catch{return false;}
  },[port,epoch]);
  const [directState,setDirectState]=useState<{port:SupabaseBrowserAuthPort;id:string}|null>(()=>{
    const id=typeof window==='undefined'?null:noticeCaseId(window.location.search);
    return id?{port,id}:null;
  });
  const directId=directState?.port===port?directState.id:null;
  const [cursorState,setCursorState]=useState<{port:SupabaseBrowserAuthPort;after:string|null}|null>(null);
  const after=cursorState?.port===port?cursorState.after:null;
  const pageSize=25;
  const scope=useMemo(()=>({port,attempt,after,directId,epoch}),[port,attempt,after,directId,epoch]);
  const [loaded,setLoaded]=useState<{
    scope:typeof scope;service:SupabasePrivateModerationService;
    cases:OwnerModerationCase[];
  }|null>(null);
  const records=loaded?.scope===scope?loaded:null;
  // Preserve the selected case across this owner's post-appeal refresh, but
  // discard it synchronously when a different auth adapter is supplied.
  const [selection,setSelection]=useState<{port:SupabaseBrowserAuthPort;id:string}|null>(null);
  const selected=directId??(selection?.port===port?selection.id:'');
  const [statement,setStatement]=useState('');
  const [operation,setOperation]=useState(()=>crypto.randomUUID());
  const [retryState,setRetryState]=useState<{scope:typeof scope;caseId:string;operation:string;statement:string}|null>(null);
  const retry=retryState?.scope===scope?retryState:null;
  const [pendingScope,setPendingScope]=useState<typeof scope|null>(null);
  const busy=pendingScope===scope;
  const gate=useScopedActionGate(scope,isCurrent);
  const [failedScope,setFailedScope]=useState<typeof scope|null>(null);
  const loadError=failedScope===scope;
  const [messageState,setMessage]=useState<{port:SupabaseBrowserAuthPort;error:boolean;text:string}|null>(null);
  const message=messageState?.port===port?messageState:null;
  const current=records?.cases.find(item=>item.id===selected);
  const currentId=current?.id??null;
  const [eventAttempt,setEventAttempt]=useState(0);
  const [eventState,setEventState]=useState<{
    scope:typeof scope;caseId:string;attempt:number;events:OwnerModerationEvent[]|null;
  }|null>(null);
  const caseEvents=eventState?.scope===scope && eventState.caseId===currentId &&
    eventState.attempt===eventAttempt ? eventState : null;
  useEffect(()=>{
    let active=true;
    setLoaded(null);
    setFailedScope(null);
    setStatement('');
    setRetryState(null);
    void (async()=>{
      const {data:service}=await port.privateModeration();
      if(!active||!isCurrent())return;
      if (!service) throw new Error('Owner moderation service unavailable.');
      const found=directId?await service.readOwnerCase(directId):null;
      const cases=directId?(found?[found]:[]):await service.listOwnerCasePage(after,pageSize);
      if (active&&isCurrent()) setLoaded({scope,service,cases});
    })().catch(()=>{if(active&&isCurrent()) setFailedScope(scope);});
    return ()=>{active=false;};
  },[scope,port,after,directId,isCurrent]);
  useLayoutEffect(()=>{
    let active=true;
    setEventState(null);
    if(!records || !currentId)return ()=>{active=false;};
    void records.service.listOwnerEvents(currentId).then(events=>{
      if(active&&isCurrent())setEventState({scope,caseId:currentId,attempt:eventAttempt,events});
    }).catch(error=>{
      if(!active||!isCurrent())return;
      if(accessMustBeRechecked(error)){
        // Fail closed and wait for explicit re-verification; do not loop on
        // a denied event endpoint when the case-list endpoint still responds.
        if(gate.invalidate()){
          setPendingScope(null);setLoaded(null);setFailedScope(scope);
        }
      }else setEventState({scope,caseId:currentId,attempt:eventAttempt,events:null});
    });
    return ()=>{active=false;};
  },[scope,records,currentId,eventAttempt,isCurrent]);

  function openCasePage(cursor:string|null){
    if(busy||retry||!records||(!directId&&cursor===after))return;
    if(!gate.invalidate())return;
    setSelection(null);setStatement('');setMessage(null);setOperation(crypto.randomUUID());
    if(directId){
      setDirectState(null);
      if(typeof window!=='undefined'&&window.location.pathname==='/app/settings/cases'){
        const url=new URL(window.location.href);url.searchParams.delete('case');
        window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
      }
    }
    setCursorState({port,after:cursor});setAttempt(value=>value+1);
  }
  async function appeal(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !records || !current || current.status!=='OPEN' || statement.trim().length<20) return;
    if(retry && (retry.caseId!==current.id || retry.operation!==operation || retry.statement!==statement.trim()))return;
    const exact=retry??{scope,caseId:current.id,operation,statement:statement.trim()};
    const token=gate.begin();
    if(token===null)return;
    setPendingScope(scope);
    setMessage(null);
    try {
      const receipt=await records.service.appeal(exact.caseId,exact.operation,exact.statement);
      if(!gate.current(token))return;
      if(receipt.caseId!==exact.caseId||receipt.status!=='APPEAL_RECORDED'||receipt.publicRevocationVerified!==false)
        throw new Error('Unverified appeal receipt.');
      setRetryState(null);
      setStatement('');
      setOperation(crypto.randomUUID());
      setLoaded(null);
      setAttempt(value=>value+1);
      setMessage({port,error:false,text:'Private appeal submitted for review.'});
    } catch(error) {
      if(!gate.current(token))return;
      if(accessMustBeRechecked(error)){
        setRetryState(null);
        setStatement('');
        setOperation(crypto.randomUUID());
        setLoaded(null);
        setMessage({port,error:true,text:'Appeal access could not be verified. Checking your current account access before continuing.'});
        setAttempt(value=>value+1);
      }else if(error instanceof Error && 'code' in error && error.code==='CONFLICT'){
        setRetryState(null);setStatement('');setOperation(crypto.randomUUID());setLoaded(null);
        setMessage({port,error:true,text:'The appeal outcome is unconfirmed or the case changed. Checking the current case before another action.'});
        setAttempt(value=>value+1);
      }else if(!retry && error instanceof Error && 'code' in error && error.code==='VALIDATION'){
        setMessage({port,error:true,text:'The appeal statement was rejected. Review it before submitting again.'});
      }else{
        // Ambiguous delivery may already have committed. Freeze the initiating
        // tuple for explicit same-operation retry, never a changed statement.
        setRetryState(exact);
        setMessage({port,error:true,text:'The appeal could not be confirmed. Retry the unchanged statement for the same operation.'});
      }
    } finally {
      if(gate.finish(token))setPendingScope(null);
    }
  }

  return <div className="ws-ops-grid">
    <OwnerSharingStatus port={port} epoch={epoch} attempt={attempt} isCurrent={isCurrent}/>
    <section className="ws-project-aside">
      <h2>Private case history</h2>
      {message && <p role={message.error?'alert':'status'}>{message.text}</p>}
      {!records && !loadError && <p role="status">Loading your private cases…</p>}
      {loadError && <><p role="alert">Your cases could not be verified.</p>
        <button className="ws-secondary" type="button" onClick={()=>setAttempt(value=>value+1)}>Retry cases</button></>}
      {records?.cases.length===0 && <p>{directId?'This case is unavailable to the current account.':after===null?'No cases were returned for this account.':'No further cases were returned.'}</p>}
      {directId&&loadError&&<p><a href="/app/settings/cases">Return to all cases</a></p>}
      {records && <div className="ws-ops-nav" aria-label="Owner case pages">
        <p>{directId?'This view is restricted to the case referenced by your notice.':'Cases are ordered by case ID, not recency. New cases may appear on a fresh read.'}</p>
        <button type="button" className="ws-secondary" disabled={busy||!!retry||(!directId&&after===null)} onClick={()=>openCasePage(null)}>{directId?'Return to all cases':'First cases'}</button>
        <button type="button" className="ws-secondary" disabled={busy||!!retry||!!directId||records.cases.length!==pageSize}
          onClick={()=>{const last=records.cases.at(-1);if(last)openCasePage(last.id);}}>Next cases</button>
      </div>}
      {!directId&&!!records?.cases.length && <label className="ws-ops-field">Case to review
        <select value={selected} disabled={busy||!!retry} onChange={event=>{
          if(busy||retry)return;
          setEventState(null);setEventAttempt(value=>value+1);
          setSelection({port,id:event.target.value});setStatement('');setMessage(null);setOperation(crypto.randomUUID());
        }}>
          <option value="">Choose a case</option>
          {records.cases.map(item=><option key={item.id} value={item.id}>
            {item.reason_code} · {ownerCaseStatus[item.status]} · {dateText(item.created_at)}
          </option>)}
        </select>
      </label>}
      {current && <>
        <h3>{ownerCaseStatus[current.status]}</h3>
        <p>{current.summary}</p>
        {!caseEvents && <p role="status">Loading this case's events…</p>}
        {caseEvents && caseEvents.events===null && <div>
          <p role="alert">This case's events could not be verified.</p>
          <button type="button" className="ws-secondary" disabled={busy} onClick={()=>setEventAttempt(value=>value+1)}>Retry case events</button>
        </div>}
        {caseEvents?.events?.length===0 && <p>No events were returned for this case.</p>}
        {caseEvents?.events?.length===100 && <p>Showing the latest 100 events for this case.</p>}
        <ol className="ws-ops-records" aria-label="Case events">
          {caseEvents?.events?.map(item=><li key={item.id}>
            <strong>{ownerEventTitle[item.event_type]}</strong>
            <time dateTime={item.created_at}>{dateText(item.created_at)}</time><p>{item.detail}</p>
          </li>)}
        </ol>
      </>}
    </section>
    {current?.status==='OPEN' && <section className="ws-project-aside">
      <h2>Appeal this case</h2>
      <p>Your statement is available for restricted case review.</p>
      <form className="ws-ops-form" onSubmit={event=>void appeal(event)}>
        <label className="ws-ops-field">Appeal statement
          <textarea required rows={5} minLength={20} maxLength={2000} value={statement} disabled={busy||!!retry}
            onChange={event=>{if(busy||retry)return;setStatement(event.target.value);setOperation(crypto.randomUUID());}}/>
        </label>
        <button className="ws-primary" type="submit" disabled={busy || statement.trim().length<20}>Submit private appeal</button>
      </form>
    </section>}
  </div>;
}
