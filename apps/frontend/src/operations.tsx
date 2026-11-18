import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
import type {
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
  committed: (message: string) => void; recheck: () => void};

// The server remains the authority; this gate only synchronizes form submissions
// and discards completions from a panel that has been removed or reverified.
function useScopedActionGate(scope: object) {
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
      if(active.current!==scope)return false;
      active.current=null;
      pending.current=null;
      return true;
    },
    begin(): symbol|null {
      if (active.current!==scope || pending.current !== null) return null;
      const token = Symbol();
      pending.current = token;
      return token;
    },
    current(token: symbol): boolean {
      return active.current===scope && pending.current === token;
    },
    finish(token: symbol): boolean {
      if (active.current!==scope || pending.current !== token) return false;
      pending.current = null;
      return true;
    }
  };
}
function accessMustBeRechecked(error: unknown): boolean {
  return error instanceof Error && error.name === 'PrivateModerationError' &&
    'code' in error && (error.code === 'AUTH_EXPIRED' || error.code === 'FORBIDDEN');
}

function Users({service, cases, committed, recheck}: Props) {
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState<ModerationReason>('ABUSE');
  const [summary, setSummary] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [operation, setOperation] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const gate = useScopedActionGate(service);
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

function Moderation({service, cases, reports, committed, recheck}: Props & {
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
  const gate = useScopedActionGate(service);
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
    if ((!holdRetry&&!holdConfirmed) || busy || !!selected || !!uncertain || holdConflict) return;
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
        <label className="ws-ops-field">Verified case<select required value={holdCase} disabled={busy}
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

function Appeals({service, cases, committed, recheck}: Props) {
  const [chosen, setChosen] = useState('');
  const [evidence,setEvidence]=useState<OperatorAppealEvidence|null>(null);
  const [evidenceError,setEvidenceError]=useState(false);
  const [evidenceAttempt,setEvidenceAttempt]=useState(0);
  const [rationale, setRationale] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [operation, setOperation] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const gate = useScopedActionGate(service);
  const [holdPortfolio, setHoldPortfolio] = useState('');
  const [liftCase, setLiftCase] = useState('');
  const [liftReason, setLiftReason] = useState('');
  const [liftConfirm, setLiftConfirm] = useState(false);
  const [liftOperation, setLiftOperation] = useState(() => crypto.randomUUID());
  const [retry,setRetry]=useState<{kind:'close';caseId:string;operation:string;rationale:string}|{kind:'lift';caseId:string;portfolioId:string;operation:string;rationale:string}|null>(null);
  const [conflict,setConflict]=useState(false);
  useEffect(()=>{
    let active=true;
    setEvidence(null);
    setEvidenceError(false);
    if (chosen) void service.readAppealEvidence(chosen)
      .then(data=>{if(active) setEvidence(data);})
      .catch(error=>{
        if (!active) return;
        // The unavailable-evidence state remains closed; authoritative denial
        // also discards the old role-verified snapshot before another action.
        if (accessMustBeRechecked(error)) recheck();
        else setEvidenceError(true);
      });
    return ()=>{active=false;};
  },[service,chosen,evidenceAttempt,recheck]);
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

type OperatorScope = {port: SupabaseBrowserAuthPort; path: string; attempt: number};
type OperatorSnapshot = {
  scope: OperatorScope;
  access: 'allowed' | 'denied' | 'unavailable';
  service: SupabasePrivateModerationService | null;
  cases: OperatorModerationCase[];
  reports: OperatorPortfolioAbuseReport[];
};

export function OperatorConsole({port, path}: {port: SupabaseBrowserAuthPort; path: string}) {
  const [attempt, setAttempt] = useState(0);
  // An operator response is valid only for its exact owner adapter, route and
  // verification attempt. Fail closed immediately when any of those change.
  const scope = useMemo<OperatorScope>(() => ({port, path, attempt}), [port, path, attempt]);
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
      if (!connected.data) throw connected.error ?? new Error('Operator service unavailable.');
      const verifiedCases = await connected.data.listOperatorCases(25);
      const verifiedReports = path === '/app/operations/moderation' ?
        await connected.data.listAbuseReports(null, 25) : [];
      if (active) setSnapshot({
        scope, service: connected.data, cases: verifiedCases, reports: verifiedReports, access: 'allowed'
      });
    })().catch((error: unknown) => {
      if (active) {
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
  }, [scope, port, path]);
  const recheck = useCallback(() => {
    setLastNotice(null);
    setAttempt(value => value + 1);
  }, []);
  function committed(message: string) {
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
    {path === '/app/operations/users' && <Users service={service} cases={cases} committed={committed} recheck={recheck}/>}
    {path === '/app/operations/moderation' &&
      <Moderation service={service} cases={cases} reports={reports} committed={committed} recheck={recheck}/>}
    {path === '/app/operations/appeals' && <Appeals service={service} cases={cases} committed={committed} recheck={recheck}/>}
  </section>;
}

const ownerCaseStatus = {OPEN:'Open',APPEAL_PENDING:'Appeal pending',CLOSED:'Closed'} as const;
const ownerEventTitle = {OPENED:'Case opened',OWNER_APPEAL:'Appeal submitted',
  OPERATOR_DECISION:'Decision recorded',OPERATOR_HOLD_LIFT:'Private hold lifted'} as const;

export function OwnerCaseHistory({port}:{port:SupabaseBrowserAuthPort}) {
  const [attempt,setAttempt]=useState(0);
  const [cursorState,setCursorState]=useState<{port:SupabaseBrowserAuthPort;after:string|null}|null>(null);
  const after=cursorState?.port===port?cursorState.after:null;
  const pageSize=25;
  const scope=useMemo(()=>({port,attempt,after}),[port,attempt,after]);
  const [loaded,setLoaded]=useState<{
    scope:typeof scope;service:SupabasePrivateModerationService;
    cases:OwnerModerationCase[];
  }|null>(null);
  const records=loaded?.scope===scope?loaded:null;
  // Preserve the selected case across this owner's post-appeal refresh, but
  // discard it synchronously when a different auth adapter is supplied.
  const [selection,setSelection]=useState<{port:SupabaseBrowserAuthPort;id:string}|null>(null);
  const selected=selection?.port===port?selection.id:'';
  const [statement,setStatement]=useState('');
  const [operation,setOperation]=useState(()=>crypto.randomUUID());
  const [retryState,setRetryState]=useState<{scope:typeof scope;caseId:string;operation:string;statement:string}|null>(null);
  const retry=retryState?.scope===scope?retryState:null;
  const [pendingScope,setPendingScope]=useState<typeof scope|null>(null);
  const busy=pendingScope===scope;
  const gate=useScopedActionGate(scope);
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
      if (!service) throw new Error('Owner moderation service unavailable.');
      const cases=await service.listOwnerCasePage(after,pageSize);
      if (active) setLoaded({scope,service,cases});
    })().catch(()=>{if(active) setFailedScope(scope);});
    return ()=>{active=false;};
  },[scope,port,after]);
  useLayoutEffect(()=>{
    let active=true;
    setEventState(null);
    if(!records || !currentId)return ()=>{active=false;};
    void records.service.listOwnerEvents(currentId).then(events=>{
      if(active)setEventState({scope,caseId:currentId,attempt:eventAttempt,events});
    }).catch(error=>{
      if(!active)return;
      if(accessMustBeRechecked(error)){
        // Fail closed and wait for explicit re-verification; do not loop on
        // a denied event endpoint when the case-list endpoint still responds.
        if(gate.invalidate()){
          setPendingScope(null);setLoaded(null);setFailedScope(scope);
        }
      }else setEventState({scope,caseId:currentId,attempt:eventAttempt,events:null});
    });
    return ()=>{active=false;};
  },[scope,records,currentId,eventAttempt]);

  function openCasePage(cursor:string|null){
    if(busy||retry||!records||cursor===after)return;
    if(!gate.invalidate())return;
    setSelection(null);setStatement('');setMessage(null);setOperation(crypto.randomUUID());
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
    <section className="ws-project-aside">
      <h2>Private case history</h2>
      {message && <p role={message.error?'alert':'status'}>{message.text}</p>}
      {!records && !loadError && <p role="status">Loading your private cases…</p>}
      {loadError && <><p role="alert">Your cases could not be verified.</p>
        <button className="ws-secondary" type="button" onClick={()=>setAttempt(value=>value+1)}>Retry cases</button></>}
      {records?.cases.length===0 && <p>{after===null?'No cases were returned for this account.':'No further cases were returned.'}</p>}
      {records && <div className="ws-ops-nav" aria-label="Owner case pages">
        <p>Cases are ordered by case ID, not recency. New cases may appear on a fresh read.</p>
        <button type="button" className="ws-secondary" disabled={busy||!!retry||after===null} onClick={()=>openCasePage(null)}>First cases</button>
        <button type="button" className="ws-secondary" disabled={busy||!!retry||records.cases.length!==pageSize}
          onClick={()=>{const last=records.cases.at(-1);if(last)openCasePage(last.id);}}>Next cases</button>
      </div>}
      {!!records?.cases.length && <label className="ws-ops-field">Case to review
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
