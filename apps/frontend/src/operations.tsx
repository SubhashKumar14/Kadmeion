import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
import type {
  SupabasePrivateModerationService, OperatorModerationCase,
  OperatorPortfolioAbuseReport, ModerationReason
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
  const [rationale, setRationale] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [operation, setOperation] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [holdPortfolio, setHoldPortfolio] = useState('');
  const [liftCase, setLiftCase] = useState('');
  const [liftReason, setLiftReason] = useState('');
  const [liftConfirm, setLiftConfirm] = useState(false);
  async function close(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chosen || !confirmed || rationale.trim().length < 20 || busy) return;
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
      <p>Only case metadata is provided by the restricted API. Owner appeal statements and full event histories are not exposed to this view; do not infer their content.</p>
      {cases.filter(item => item.status === 'APPEAL_PENDING').length === 0 && <p>No pending appeals were returned.</p>}
      <ul className="ws-ops-records">{cases.filter(item => item.status === 'APPEAL_PENDING').map(item => <li key={item.caseId}>
        <strong>{item.reasonCode} · Appeal pending</strong><span>Case {item.caseId}</span>
        <span>Owner ID {item.targetUserId}</span>
        <button type="button" className="ws-secondary" onClick={() => {setChosen(item.caseId);setConfirmed(false);}}>
          Select for decision</button>
      </li>)}</ul>
      {chosen && <form className="ws-ops-form" onSubmit={event => void close(event)}>
        <h3>Resolve a verified case</h3>
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

export function OperatorConsole({port, path}: {port: SupabaseBrowserAuthPort; path: string}) {
  const [access, setAccess] = useState<'checking'|'denied'|'allowed'>('checking');
  const [service, setService] = useState<SupabasePrivateModerationService | null>(null);
  const [cases, setCases] = useState<OperatorModerationCase[]>([]);
  const [reports, setReports] = useState<OperatorPortfolioAbuseReport[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    setAccess('checking');
    void (async () => {
      const connected = await port.operatorModeration();
      if (!connected.data) throw new Error('Operator service unavailable.');
      const verifiedCases = await connected.data.listOperatorCases(25);
      const verifiedReports = path === '/app/operations/moderation' ?
        await connected.data.listAbuseReports(null, 25) : [];
      if (active) {
        setCases(verifiedCases);setReports(verifiedReports);
        setService(connected.data);setAccess('allowed');
      }
    })().catch(() => {
      if (active) {
        setService(null);setCases([]);setReports([]);setAccess('denied');
      }
    });
    return () => {active = false;};
  }, [port, path, attempt]);
  function committed(message: string) {
    setNotice(message);
    setAttempt(value => value + 1);
  }
  if (!isOperatorRoute(path)) return null;
  if (access === 'checking') return <section className="ws-ops-lock" aria-busy="true">
    <h1>Checking operator authorization.</h1><p role="status">Verifying restricted case access with the server…</p>
  </section>;
  if (access === 'denied' || !service) return <section className="ws-ops-lock">
    <h1>Restricted operations.</h1>
    <p role="alert">Only verified operators may inspect moderation cases. No case or user records were loaded.</p>
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
