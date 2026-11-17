import { useEffect, useMemo, useState } from 'react';
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
    return 'The role-checked moderation operation was not confirmed. Check the current case state before retrying.';
  }
  return 'The private moderation service could not verify this operation.';
}
type Props = {service: SupabasePrivateModerationService; cases: OperatorModerationCase[];
  committed: (message: string) => void};

function Users({service, cases, committed}: Props) {
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState<ModerationReason>('ABUSE');
  const [summary, setSummary] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [operation, setOperation] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const filtered = cases.filter(item =>
    item.targetUserId.toLowerCase().includes(query.trim().toLowerCase()) ||
    item.caseId.toLowerCase().includes(query.trim().toLowerCase()));
  async function open(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !confirmed || summary.trim().length < 20) return;
    setBusy(true);setError('');
    try {
      const receipt = await service.openCase(target.trim(), operation, reason, summary);
      if (receipt.status !== 'OPEN' || receipt.restrictionEnforced !== false)
        throw new Error('Audit-only case receipt was not confirmed.');
      setOperation(crypto.randomUUID());setTarget('');setSummary('');setConfirmed(false);
      committed('Private audit case recorded. No account restriction or public suspension was performed.');
    } catch (error) {setError(errorMessage(error));}
    finally {setBusy(false);}
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
          <input required pattern={uuidPattern} value={target} onChange={event => {setTarget(event.target.value);setOperation(crypto.randomUUID());}}
            autoComplete="off" placeholder="UUID from a verified report"/></label>
        <label className="ws-ops-field">Documented reason
          <select value={reason} onChange={event => {setReason(event.target.value as ModerationReason);setOperation(crypto.randomUUID());}}>
            {reasons.map(item => <option key={item} value={item}>{item}</option>)}
          </select></label>
        <label className="ws-ops-field">Case summary
          <textarea required minLength={20} maxLength={500} value={summary} rows={5}
            onChange={event => {setSummary(event.target.value);setOperation(crypto.randomUUID());}}/></label>
        <label className="ws-ops-confirm"><input type="checkbox" required checked={confirmed}
          onChange={event => setConfirmed(event.target.checked)}/>
          I confirm the serious-abuse scope and understand this is audit-only.
        </label>
        {error && <p role="alert" className="ws-inline-alert">{error}</p>}
        <button type="submit" className="ws-primary" disabled={busy || !confirmed || summary.trim().length < 20}>
          {busy ? 'Recording…' : 'Record private case'}
        </button>
      </form>
    </section>
  </div>;
}

function Moderation({service, cases, reports, committed}: Props & {
  reports: OperatorPortfolioAbuseReport[];
}) {
  const [selected, setSelected] = useState('');
  const [decision, setDecision] = useState<'CASE_OPENED'|'DISMISSED'>('CASE_OPENED');
  const [rationale, setRationale] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [holdCase, setHoldCase] = useState('');
  const [portfolio, setPortfolio] = useState('');
  const [holdConfirmed, setHoldConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !confirmed || rationale.trim().length < 20 || busy) return;
    setBusy(true);setError('');
    try {
      const receipt = await service.reviewAbuseReport(selected, decision, rationale);
      if (receipt.reportId !== selected) throw new Error('Unverified report receipt.');
      setSelected('');setConfirmed(false);setRationale('');
      committed(receipt.status === 'CASE_OPENED'
        ? 'Report reviewed. Private audit case opened; public revocation remains unverified.'
        : 'Report dismissed with an audited rationale.');
    } catch (error) {setError(errorMessage(error));}
    finally {setBusy(false);}
  }
  async function hold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!holdConfirmed || busy) return;
    setBusy(true);setError('');
    try {
      const receipt = await service.blockPrivatePortfolio(holdCase, portfolio, crypto.randomUUID());
      if (!receipt.stillBlocked || receipt.publicServingEnabled !== false)
        throw new Error('Unverified hold receipt.');
      setHoldConfirmed(false);setPortfolio('');
      committed('Case-bound private portfolio hold confirmed. This is NOT public host revocation.');
    } catch (error) {setError(errorMessage(error));}
    finally {setBusy(false);}
  }
  return <div className="ws-ops-grid">
    <section className="ws-project-aside">
      <h2>Submitted portfolio reports</h2>
      <p>Reports are untrusted text, shown only after the backend verifies the operator session.</p>
      {reports.length === 0 && <p>No pending abuse reports were returned.</p>}
      {reports.length === 25 && <p>At most 25 pending reports are shown. Further pages require a scoped request.</p>}
      <ul className="ws-ops-records">{reports.map(report => <li key={report.id}>
        <strong>{report.reason_code} · {report.target_path}</strong>
        <small>{dateText(report.created_at)}</small>
        <p className="ws-ops-evidence">{report.evidence}</p>
        <button type="button" className="ws-secondary" aria-pressed={selected === report.id}
          onClick={() => {setSelected(report.id);setConfirmed(false);}}>Review report</button>
      </li>)}</ul>
      {selected && <form className="ws-ops-form" onSubmit={event => void review(event)}>
        <h3>Review selected report</h3>
        <label className="ws-ops-field">Decision<select value={decision}
          onChange={event => {setDecision(event.target.value as 'CASE_OPENED'|'DISMISSED');setConfirmed(false);}}>
          <option value="CASE_OPENED">Open audited case</option>
          <option value="DISMISSED">Dismiss report</option>
        </select></label>
        <label className="ws-ops-field">Reasoned review
          <textarea required minLength={20} maxLength={500} value={rationale} rows={4}
            onChange={event => setRationale(event.target.value)}/></label>
        <label className="ws-ops-confirm"><input type="checkbox" checked={confirmed} required onChange={event => setConfirmed(event.target.checked)}/>
          This decision is scoped to the selected report.
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" className="ws-primary" disabled={busy || !confirmed || rationale.trim().length < 20}>
          {busy ? 'Reviewing…' : 'Submit report decision'}</button>
      </form>}
    </section>
    <section className="ws-project-aside">
      <h2>Private moderation hold</h2>
      <p>A case-specific private hold is possible. It never proves public URL or CDN revocation.</p>
      <form className="ws-ops-form" onSubmit={event => void hold(event)}>
        <label className="ws-ops-field">Verified case<select required value={holdCase}
          onChange={event => {setHoldCase(event.target.value);setHoldConfirmed(false);}}>
          <option value="">Select a case</option>
          {cases.filter(item => item.status !== 'CLOSED').map(item =>
            <option key={item.caseId} value={item.caseId}>{item.caseId} ({item.status})</option>)}
        </select></label>
        <label className="ws-ops-field">Private portfolio ID
          <input required pattern={uuidPattern} value={portfolio} onChange={event => setPortfolio(event.target.value)}/>
        </label>
        <label className="ws-ops-confirm"><input type="checkbox" checked={holdConfirmed} required
          onChange={event => setHoldConfirmed(event.target.checked)}/>Apply only a case-bound private hold.</label>
        {error && <p role="alert">{error}</p>}
        <button className="ws-primary" type="submit" disabled={!holdCase || !holdConfirmed || busy}>
          {busy ? 'Applying…' : 'Apply private hold'}</button>
      </form>
    </section>
  </div>;
}

function Appeals({service, cases, committed}: Props) {
  const [chosen, setChosen] = useState('');
  const [evidence,setEvidence]=useState<OperatorAppealEvidence|null>(null);
  const [evidenceError,setEvidenceError]=useState(false);
  const [evidenceAttempt,setEvidenceAttempt]=useState(0);
  const [rationale, setRationale] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [operation, setOperation] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [holdPortfolio, setHoldPortfolio] = useState('');
  const [liftCase, setLiftCase] = useState('');
  const [liftReason, setLiftReason] = useState('');
  const [liftConfirm, setLiftConfirm] = useState(false);
  useEffect(()=>{
    let active=true;
    setEvidence(null);
    setEvidenceError(false);
    if (chosen) void service.readAppealEvidence(chosen)
      .then(data=>{if(active) setEvidence(data);})
      .catch(()=>{if(active) setEvidenceError(true);});
    return ()=>{active=false;};
  },[service,chosen,evidenceAttempt]);
  async function close(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chosen || evidence?.caseId!==chosen || !confirmed || rationale.trim().length < 20 || busy) return;
    setBusy(true);setError('');
    try {
      const receipt = await service.closeCase(chosen, operation, rationale);
      if (receipt.status !== 'CLOSED' || receipt.restrictionEnforced !== false)
        throw new Error('Unverified case closure.');
      setOperation(crypto.randomUUID());setChosen('');setRationale('');setConfirmed(false);
      committed('Case closed with an audit decision. No public release or account restoration was asserted.');
    } catch (error) {setError(errorMessage(error));}
    finally {setBusy(false);}
  }
  async function lift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!liftCase || !liftConfirm || liftReason.trim().length < 20 || busy) return;
    setBusy(true);setError('');
    try {
      const receipt = await service.liftPrivateHold(liftCase, holdPortfolio, crypto.randomUUID(), liftReason);
      if (receipt.publicServingEnabled !== false) throw new Error('Unverified release state.');
      setLiftCase('');setHoldPortfolio('');setLiftReason('');setLiftConfirm(false);
      committed('Private hold released after case review; public delivery remains blocked.');
    } catch (error) {setError(errorMessage(error));}
    finally {setBusy(false);}
  }
  return <div className="ws-ops-grid">
    <section className="ws-project-aside">
      <h2>Appeals awaiting review</h2>
      <p>Select a pending case to review its original summary and latest owner statement.</p>
      {cases.filter(item => item.status === 'APPEAL_PENDING').length === 0 && <p>No pending appeals were returned.</p>}
      <ul className="ws-ops-records">{cases.filter(item => item.status === 'APPEAL_PENDING').map(item => <li key={item.caseId}>
        <strong>{item.reasonCode} · Appeal pending</strong><span>Case {item.caseId}</span>
        <span>Owner ID {item.targetUserId}</span>
        <button type="button" className="ws-secondary" disabled={busy} onClick={()=>{
          if(chosen===item.caseId)return;
          setChosen(item.caseId);setEvidence(null);setEvidenceError(false);
          setConfirmed(false);setRationale('');setError('');setOperation(crypto.randomUUID());
        }}>
          Select for decision</button>
      </li>)}</ul>
      {chosen && !evidence && (evidenceError ? <div>
        <p role="alert">Evidence could not be verified. A decision requires the owner statement.</p>
        <button type="button" className="ws-secondary" onClick={()=>setEvidenceAttempt(value=>value+1)}>Retry appeal evidence</button>
      </div> : <p role="status">Loading private appeal evidence…</p>)}
      {evidence?.caseId===chosen && <form className="ws-ops-form" onSubmit={event => void close(event)}>
        <h3>Resolve a verified case</h3>
        <dl><dt>Original reason</dt><dd>{evidence.reasonCode}</dd><dt>Case summary</dt><dd>{evidence.summary}</dd>
          <dt>Owner statement</dt><dd>{evidence.statement}</dd>
          <dt>Submitted</dt><dd><time dateTime={evidence.submittedAt}>{dateText(evidence.submittedAt)}</time></dd></dl>
        <label className="ws-ops-field">Decision rationale<textarea required rows={4} minLength={20} maxLength={2000}
          value={rationale} onChange={event => {setRationale(event.target.value);setOperation(crypto.randomUUID());}}/></label>
        <label className="ws-ops-confirm"><input type="checkbox" required checked={confirmed}
          onChange={event => setConfirmed(event.target.checked)}/>Close only the selected audited case.</label>
        {error && <p role="alert">{error}</p>}
        <button className="ws-primary" disabled={busy || !confirmed || rationale.trim().length < 20} type="submit">
          {busy ? 'Recording…' : 'Record case decision'}</button>
      </form>}
    </section>
    <section className="ws-project-aside">
      <h2>Internal hold release</h2>
      <p>Administrator-only. Requires a resolved case and a matching private portfolio hold. This does not republish content.</p>
      <form className="ws-ops-form" onSubmit={event => void lift(event)}>
        <label className="ws-ops-field">Resolved case<select required value={liftCase}
          onChange={event => setLiftCase(event.target.value)}>
          <option value="">Select closed case</option>
          {cases.filter(item => item.status === 'CLOSED').map(item =>
            <option key={item.caseId} value={item.caseId}>{item.caseId}</option>)}
        </select></label>
        <label className="ws-ops-field">Portfolio ID
          <input required value={holdPortfolio} pattern={uuidPattern} onChange={event => setHoldPortfolio(event.target.value)}/></label>
        <label className="ws-ops-field">Hold-release rationale<textarea required minLength={20} maxLength={2000}
          rows={4} value={liftReason} onChange={event => setLiftReason(event.target.value)}/></label>
        <label className="ws-ops-confirm"><input type="checkbox" checked={liftConfirm} required
          onChange={event => setLiftConfirm(event.target.checked)}/>No public publication is authorized by this action.</label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" className="ws-primary" disabled={busy || !liftConfirm || !liftCase || liftReason.trim().length < 20}>
          {busy ? 'Recording…' : 'Release private hold'}</button>
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
    {path === '/app/operations/users' && <Users service={service} cases={cases} committed={committed}/>}
    {path === '/app/operations/moderation' &&
      <Moderation service={service} cases={cases} reports={reports} committed={committed}/>}
    {path === '/app/operations/appeals' && <Appeals service={service} cases={cases} committed={committed}/>}
  </section>;
}

const ownerCaseStatus = {OPEN:'Open',APPEAL_PENDING:'Appeal pending',CLOSED:'Closed'} as const;
const ownerEventTitle = {OPENED:'Case opened',OWNER_APPEAL:'Appeal submitted',
  OPERATOR_DECISION:'Decision recorded',OPERATOR_HOLD_LIFT:'Private hold lifted'} as const;

export function OwnerCaseHistory({port}:{port:SupabaseBrowserAuthPort}) {
  const [attempt,setAttempt]=useState(0);
  const scope=useMemo(()=>({port,attempt}),[port,attempt]);
  const [loaded,setLoaded]=useState<{
    scope:typeof scope;service:SupabasePrivateModerationService;
    cases:OwnerModerationCase[];events:OwnerModerationEvent[];
  }|null>(null);
  const records=loaded?.scope===scope?loaded:null;
  // Preserve the selected case across this owner's post-appeal refresh, but
  // discard it synchronously when a different auth adapter is supplied.
  const [selection,setSelection]=useState<{port:SupabaseBrowserAuthPort;id:string}|null>(null);
  const selected=selection?.port===port?selection.id:'';
  const [statement,setStatement]=useState('');
  const [operation,setOperation]=useState(()=>crypto.randomUUID());
  const [busy,setBusy]=useState(false);
  const [failedScope,setFailedScope]=useState<typeof scope|null>(null);
  const loadError=failedScope===scope;
  const [messageState,setMessage]=useState<{port:SupabaseBrowserAuthPort;error:boolean;text:string}|null>(null);
  const message=messageState?.port===port?messageState:null;
  const current=records?.cases.find(item=>item.id===selected);
  useEffect(()=>{
    let active=true;
    setLoaded(null);
    setFailedScope(null);
    setStatement('');
    void (async()=>{
      const {data:service}=await port.privateModeration();
      if (!service) throw new Error('Owner moderation service unavailable.');
      const [cases,events]=await Promise.all([service.listOwnerCases(),service.listOwnerEvents()]);
      if (active) setLoaded({scope,service,cases,events});
    })().catch(()=>{if(active) setFailedScope(scope);});
    return ()=>{active=false;};
  },[scope,port]);

  async function appeal(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !records || current?.status!=='OPEN' || statement.trim().length<20) return;
    setBusy(true);
    setMessage(null);
    try {
      await records.service.appeal(current.id,operation,statement);
      setStatement('');
      setOperation(crypto.randomUUID());
      setLoaded(null);
      setAttempt(value=>value+1);
      setMessage({port,error:false,text:'Private appeal submitted for review.'});
    } catch {
      setMessage({port,error:true,text:'The appeal could not be confirmed. Your statement is available to retry.'});
    } finally {
      setBusy(false);
    }
  }

  return <div className="ws-ops-grid">
    <section className="ws-project-aside">
      <h2>Private case history</h2>
      {message && <p role={message.error?'alert':'status'}>{message.text}</p>}
      {!records && !loadError && <p role="status">Loading your private cases…</p>}
      {loadError && <><p role="alert">Your cases could not be verified.</p>
        <button className="ws-secondary" type="button" onClick={()=>setAttempt(value=>value+1)}>Retry cases</button></>}
      {records?.cases.length===0 && <p>There are no cases for this account.</p>}
      {!!records?.cases.length && <label className="ws-ops-field">Case to review
        <select value={selected} disabled={busy} onChange={event=>{
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
        <ol className="ws-ops-records" aria-label="Case events">
          {records?.events.filter(item=>item.case_id===current.id).map(item=><li key={item.id}>
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
          <textarea required rows={5} minLength={20} maxLength={2000} value={statement} disabled={busy}
            onChange={event=>{setStatement(event.target.value);setOperation(crypto.randomUUID());}}/>
        </label>
        <button className="ws-primary" type="submit" disabled={busy || statement.trim().length<20}>Submit private appeal</button>
      </form>
    </section>}
  </div>;
}
