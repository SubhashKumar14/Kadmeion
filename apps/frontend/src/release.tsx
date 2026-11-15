import { useEffect, useRef, useState } from 'react';
import type { SupabaseBrowserAuthPort, OwnerPortfolio } from '../../auth-web/src/supabase-auth-port.ts';
import type { PrivateFrozenRequest, FrozenVisibilityIntent } from '../../../packages/contracts/src/private-release-service.ts';
import type { PrivatePointerSnapshot } from '../../../packages/contracts/src/private-release-visibility-service.ts';
import { prepareSafeStaticPreview, type SafeSlotPlan, type SafeSlotKind, type SafePreviewResult } from '../../../packages/editor-core/src/publish-preflight.ts';
import { portfolioLayout } from '../../../packages/editor-core/src/managed-project-files.ts';
import type { PortfolioSnapshot } from '../../../packages/editor-core/src/portfolio-revision-transactions.ts';

const routes = {
  staging: 'Reviewer staging',
  publish: 'Publish preflight',
  releases: 'Releases & rollback'
} as const;
type ReleaseMode = keyof typeof routes;

const dataComponents: Readonly<Record<string, SafeSlotKind>> = {
  'title-stacked@1': 'heading', 'body-copy@1': 'paragraph', 'external-link@1': 'external-link',
  'technology-tag@1': 'badge', 'author-metric@1': 'metric', 'skills-list@1': 'list',
  'project-card@1': 'project-card', 'image@1': 'image'
};

function buildPlan(snapshot: PortfolioSnapshot): SafeSlotPlan[] {
  const source = snapshot.files['pages/home.page.json'];
  if (!source) return [];
  const page = JSON.parse(source) as {sections?: {id?: unknown; layout?: unknown}[]};
  if (!Array.isArray(page.sections)) return [];
  return page.sections.flatMap(section => {
    if (!section || typeof section.id !== 'string' || typeof section.layout !== 'string') return [];
    const layout = portfolioLayout(section.layout);
    if (!layout) return [];
    return layout.slots.map(slot => {
      const slotKey = section.id + '-' + slot.toLowerCase();
      const assigned = snapshot.slots[slotKey]?.componentId;
      const approvedKind = assigned && Object.hasOwn(dataComponents, assigned) ? dataComponents[assigned] : undefined;
      const componentId = approvedKind && assigned ? assigned : 'body-copy@1';
      return {slotKey, componentId, kind: approvedKind ?? 'paragraph', required: layout.required.includes(slot)};
    });
  });
}

export function releaseRoute(path: string): {id: string; mode: ReleaseMode} | undefined {
  const match = /^\/app\/portfolios\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(staging|publish|releases)$/i.exec(path);
  if (match?.[1] && match[2] && Object.hasOwn(routes, match[2])) return {id: match[1].toLowerCase(), mode: match[2] as ReleaseMode};
}

export function PortfolioRelease({port, id, mode}: {port: SupabaseBrowserAuthPort; id: string; mode: ReleaseMode}) {
  const [record, setRecord] = useState<OwnerPortfolio | null>(null);
  const [pointer, setPointer] = useState<PrivatePointerSnapshot | null>(null);
  const [visibility, setVisibility] = useState<FrozenVisibilityIntent>('UNLISTED');
  const [frozen, setFrozen] = useState<PrivateFrozenRequest | null>(null);
  const [result, setResult] = useState<SafePreviewResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const operation = useRef<string | null>(null);
  const base = '/app/portfolios/' + id;
  useEffect(() => {
    let active = true;
    void port.readOwnerPortfolio(id).then(async reply => {
      if (!active) return;
      if (!reply.data) {setError(reply.error?.message ?? 'Portfolio unavailable.'); return;}
      setRecord(reply.data);
      if (mode !== 'releases') return;
      const status = await port.readOwnerRelease(id);
      if (!active) return;
      if (status.data) setPointer(status.data);
      else setError(status.error?.message ?? 'Release status unavailable.');
    });
    return () => {active = false;};
  }, [port, id, mode]);

  async function inspect() {
    if (!record?.revision || busy) return;
    setBusy(true); setError(''); setResult(null);
    try {
      let request = frozen;
      if (!request) {
        operation.current ??= crypto.randomUUID();
        const saved = await port.freezeOwnerRelease(id, operation.current, record.revision, visibility);
        if (!saved.data) {setError(saved.error?.message ?? 'Private freeze could not be confirmed.'); return;}
        request = saved.data;
        setFrozen(request);
      }
      if (mode === 'staging') return;
      const evidence = await port.loadOwnerFrozenRelease(request.requestId);
      if (!evidence.data || evidence.data.loadedPortfolioId !== id || evidence.data.loadedRevision !== request.revision ||
          evidence.data.loadedSnapshotSha256 !== request.snapshotSha256) {
        setError(evidence.error?.message ?? 'This preview could not be matched to the frozen draft.'); return;
      }
      setResult(prepareSafeStaticPreview({...evidence.data, plan: buildPlan(evidence.data.snapshot)}));
    } catch {
      setError('The frozen draft could not be checked.');
    } finally {setBusy(false);}
  }

  return <section aria-labelledby="release-title">
    <div className="ws-heading">
      <a href={base + '/edit'}>Back to portfolio editor</a>
      <p className="ws-kicker">PORTFOLIO RELEASE</p><h1 id="release-title">{routes[mode]}.</h1>
      {record && <p>{record.title} · Saved draft revision {record.revision}</p>}
    </div>
    <nav className="ws-profile-tabs" aria-label="Release steps">
      {(Object.keys(routes) as ReleaseMode[]).map(step => <a className="ws-secondary" key={step} aria-current={step === mode ? 'page' : undefined}
        href={base + '/' + step}>{routes[step]}</a>)}
    </nav>
    {error && <p role="alert" className="ws-inline-alert">{error}</p>}
    {!record && !error && <p role="status">Loading private release details…</p>}
    {record && <div className="ws-project-detail">
      <div className="ws-project-fields">
        {mode === 'releases' ? <>
          <h2>Release status</h2>
          {pointer ? <dl><dt>Private pointer</dt><dd>{pointer.status === 'BLOCKED' ? 'Blocked' : 'Prepared privately'}</dd>
            <dt>Generation</dt><dd>{pointer.generation}</dd><dt>Host revocation</dt><dd>Awaiting verification</dd></dl>
            : !error && <p role="status">Checking the release pointer…</p>}
        </> : <>
          <h2>{mode === 'staging' ? 'Freeze a private revision' : 'Check the saved snapshot'}</h2>
          <p>The saved revision is pinned with a content digest. Freeze and preflight are private.</p>
          <label>Visibility intent<select value={visibility} disabled={busy || !!frozen} onChange={event => {
            setVisibility(event.target.value === 'PUBLIC' ? 'PUBLIC' : 'UNLISTED');
            operation.current = null;
          }}><option value="UNLISTED">Unlisted</option><option value="PUBLIC">Public</option></select></label>
          <button type="button" className="ws-primary" disabled={busy || !record.revision || (mode === 'staging' && !!frozen)}
            onClick={() => void inspect()}>{busy ? 'Checking…' : mode === 'staging' ? 'Freeze private revision' : 'Run private preflight'}</button>
          {frozen && <p role="status">Private revision {frozen.revision} frozen.</p>}
          {result && <>
            <h3>Preflight results</h3>
            <ul>{[...result.blockers, ...result.warnings, ...result.passed].map((item, index) =>
              <li key={item.code + ':' + index}>{item.message}</li>)}</ul>
            {result.previewHtml && <iframe title="Private scriptless preview" className="ws-private-static-preview" sandbox="" srcDoc={result.previewHtml}/>}
          </>}
        </>}
      </div>
      <aside className="ws-project-aside">
        <h2>Delivery status</h2>
        <p>Review links, publication, and rollback require verified hosting and revocation.</p>
        <a className="ws-secondary" href={base + '/preview/fullscreen'} target="_blank" rel="noopener">Open saved author preview</a>
      </aside>
    </div>}
  </section>;
}
