import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { SupabaseBrowserAuthPort } from '../../auth-web/src/supabase-auth-port.ts';
import type { MyComponentVersion } from '../../../packages/contracts/src/private-my-components-service.ts';
import { savedComponentInputFromOwnedSlot, type EditorHead, type EditorIntent, type PortfolioSnapshot } from
  '../../../packages/editor-core/src/portfolio-revision-transactions.ts';

type Apply = (intent: EditorIntent, versions?: Readonly<Record<string, MyComponentVersion>>) => boolean;
const THEME_PATH = 'theme/tokens.json';
const colors = ['surface', 'text', 'accent'] as const;
type PortfolioTheme = {mode: 'light' | 'dark'; surface: string; text: string; accent: string};
const defaultTheme: PortfolioTheme = {mode: 'light', surface: '#f9fafb', text: '#152738', accent: '#b9734d'};

function readTheme(snapshot: PortfolioSnapshot | null | undefined): PortfolioTheme {
  try {
    const source = snapshot?.files[THEME_PATH];
    if (!source) return defaultTheme;
    const value = JSON.parse(source) as Partial<PortfolioTheme>;
    return (value.mode === 'light' || value.mode === 'dark') && colors.every(key => /^#[0-9a-f]{6}$/i.test(value[key] ?? ''))
      ? value as PortfolioTheme : defaultTheme;
  } catch { return defaultTheme; }
}

export function PortfolioCanvas({snapshot, title, standalone, width}: {
  snapshot: PortfolioSnapshot | null | undefined; title: string; standalone?: boolean; width?: number;
}) {
  const theme = readTheme(snapshot);
  const style: CSSProperties = {
    background: theme.surface, color: theme.text, colorScheme: theme.mode, borderTopColor: theme.accent, maxWidth: width
  };
  const slots = Object.entries(snapshot?.slots ?? {});
  const Tag = standalone ? 'main' : 'div';
  return <Tag className={standalone ? 'portfolio-only-preview' : 'ws-studio-canvas'} style={style}>
    {standalone ? <h1>{title}</h1> : <h2>{title}</h2>}
    {slots.filter(([, entry]) => entry.content.text).map(([key, entry]) => <p key={key}>{entry.content.text}</p>)}
    {!standalone && !slots.some(([, entry]) => entry.content.text) && <p>This draft has no authored text yet.</p>}
  </Tag>;
}

export function ThemeInspector({head, apply, width, resize}: {
  head: EditorHead; apply: Apply; width: number; resize: (width: number) => void;
}) {
  const theme = readTheme(head.snapshot);
  function setTheme(next: PortfolioTheme) {
    const previous = head.snapshot.files[THEME_PATH];
    const tokens = previous ? JSON.parse(previous) as Record<string, unknown> : {};
    apply({kind: 'WRITE_MANAGED_FILE', path: THEME_PATH, source: JSON.stringify({...tokens, ...next}, null, 2)});
  }
  return <div className="ws-editor-tool">
    <h2>Theme &amp; responsive</h2>
    <label>Preview width<select value={width} onChange={event => resize(Number(event.target.value))}>
      <option value={0}>Fit canvas</option><option value={768}>Tablet · 768 px</option><option value={390}>Phone · 390 px</option>
    </select></label>
    <label>Portfolio theme<select value={theme.mode} onChange={event => {
      const mode = event.target.value;
      if (mode === 'dark') setTheme({mode, surface: '#162433', text: '#f7f5ef', accent: '#eab087'});
      else setTheme({...defaultTheme});
    }}><option value="light">Light</option><option value="dark">Dark</option></select></label>
    {colors.map(key => <label key={key}>{key}<input type="color" value={theme[key]} onChange={event =>
      setTheme({...theme, [key]: event.target.value})}/></label>)}
  </div>;
}

export function SourceInspector({head, slot, apply}: {head: EditorHead; slot: string; apply: Apply}) {
  const [selected, setSelected] = useState('');
  const [buffers, setBuffers] = useState<Record<string, string>>({});
  const active = head.snapshot.slots[slot];
  const files = Object.keys(head.snapshot.files).filter(path => path.endsWith('.json') || path === active?.sourcePath);
  const path = files.includes(selected) ? selected : files[0] ?? '';
  const original = head.snapshot.files[path] ?? '';
  const value = buffers[path] ?? original;

  function applyBuffer() {
    const intent: EditorIntent = path.endsWith('.json')
      ? {kind: 'WRITE_MANAGED_FILE', path, source: value}
      : {kind: 'EDIT_OWNED_SOURCE', slotKey: slot, source: value};
    if (apply(intent)) setBuffers(current => {
      const next = {...current}; delete next[path]; return next;
    });
  }

  return <div className="ws-editor-tool">
    <h2>Advanced source</h2>
    <p>Managed JSON and your owned code can be edited here. The author preview renders text without executing custom code.</p>
    <label>Source file<select value={path} onChange={event => setSelected(event.target.value)}>
      {files.map(file => <option key={file}>{file}</option>)}
    </select></label>
    <label>Source buffer<textarea spellCheck={false} rows={10} value={value} onChange={event => {
      const source = event.target.value;
      setBuffers(current => ({...current, [path]: source}));
    }}/></label>
    <button type="button" className="ws-secondary" disabled={!path || value === original} onClick={applyBuffer}>Apply source</button>
  </div>;
}

export function ComponentLibrary({port, head, committed, slot, apply}: {
  port: SupabaseBrowserAuthPort; head: EditorHead; committed: PortfolioSnapshot | null; slot: string; apply: Apply;
}) {
  const [versions, setVersions] = useState<MyComponentVersion[] | null>(null);
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const slotKind = slot.slice(slot.lastIndexOf('-') + 1);
  const state = head.snapshot.slots[slot]?.state;
  const canSave = !!committed && ['S1', 'S2'].includes(committed.slots[slot]?.state ?? '');

  useEffect(() => {
    let active = true;
    void port.listOwnerComponents().then(result => {
      if (!active) return;
      if (result.data) setVersions(result.data);
      else setMessage(result.error?.message ?? 'My Components could not be loaded.');
    });
    return () => {active = false;};
  }, [port]);

  async function save() {
    if (!committed || !name.trim() || busy) return;
    setBusy(true); setMessage('');
    try {
      const key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55);
      if (!/^[a-z][a-z0-9-]{2,63}$/.test(key)) {setMessage('Choose a component name with at least three letters or digits, beginning with a letter.'); return;}
      const input = savedComponentInputFromOwnedSlot(committed, slot, {
        operationId: crypto.randomUUID(), componentKey: key, displayName: name, compatibleSlotKinds: [slotKind]
      });
      const result = await port.saveOwnerComponent(input);
      if (!result.data) {setMessage(result.error?.message ?? 'Component save could not be confirmed.'); return;}
      const saved = result.data;
      setVersions(current => [saved, ...(current ?? []).filter(version => version.id !== saved.id)]);
      setName(''); setMessage('Private component version saved.');
    } catch (error) {setMessage(error instanceof Error ? error.message : 'Component save could not be confirmed.');}
    finally {setBusy(false);}
  }

  return <div className="ws-editor-tool"><h2>My Components</h2>
    {message && <p role="status">{message}</p>}
    {!versions && !message && <p role="status">Loading saved components…</p>}
    {versions?.length === 0 && <p>You haven’t saved any component versions.</p>}
    <ul className="ws-editor-slots">{versions?.map(version => <li key={version.id}>
      <strong>{version.display_name}</strong> <span>{version.compatible_slot_kinds.join(', ')}</span>
      <button type="button" disabled={!state || state === 'S1' || state === 'S2' || !version.compatible_slot_kinds.includes(slotKind)}
        onClick={() => apply({kind: 'REUSE_SAVED_COMPONENT', slotKey: slot, componentVersionId: version.id}, {[version.id]: version})}>
        Reuse in selected slot
      </button>
    </li>)}</ul>
    {canSave && <><label>Component name<input value={name} maxLength={80} onChange={event => setName(event.target.value)}/></label>
      <button type="button" className="ws-secondary" disabled={busy || !name.trim()} onClick={() => void save()}>Save committed component</button></>}
  </div>;
}

export function AssetList({port}: {port: SupabaseBrowserAuthPort}) {
  const [assets, setAssets] = useState<NonNullable<Awaited<ReturnType<SupabaseBrowserAuthPort['listOwnerAssets']>>['data']> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void port.listOwnerAssets().then(result => {
      if (!active) return;
      if (result.data) setAssets(result.data);
      else setError(result.error?.message ?? 'Private assets could not be loaded.');
    });
    return () => {active = false;};
  }, [port]);
  return <div className="ws-editor-tool"><h2>Assets</h2>
    {error && <p role="alert">{error}</p>}
    {!assets && !error && <p role="status">Loading private asset records…</p>}
    {assets?.length === 0 && <p>No private project assets are registered.</p>}
    {!!assets?.length && <ul className="ws-editor-slots">{assets.map(asset => <li key={asset.id}>
      <strong>{asset.altText || 'Image ' + asset.id.slice(0, 8)}</strong>
      <span>{asset.mime} · {Math.ceil(asset.size / 1024)} KB</span>
    </li>)}</ul>}
    <p>Asset registration and replacement controls are unavailable in this panel.</p>
  </div>;
}

export function RevisionHistory({port, id, revision, onRestore}: {
  port: SupabaseBrowserAuthPort; id: string; revision: number; onRestore: (snapshot: PortfolioSnapshot) => void;
}) {
  const [items, setItems] = useState<{revision: number; createdAt: string}[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void port.listOwnerRevisions(id).then(result => {
      if (!active) return;
      if (result.data) setItems(result.data);
      else setError(result.error?.message ?? 'Revision history could not be loaded.');
    });
    return () => {active = false;};
  }, [port, id, revision]);

  async function restore() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const result = await port.readOwnerRevision(id, selected);
      if (!result.data) {setError(result.error?.message ?? 'Could not open the revision.'); return;}
      onRestore(result.data); setSelected(null);
    } finally {setBusy(false);}
  }

  return <div className="ws-editor-tool"><h2>Revision history</h2>
    {error && <p role="alert">{error}</p>}
    {!items && !error && <p role="status">Loading saved revisions…</p>}
    <ul className="ws-editor-slots">{items?.map(item => <li key={item.revision}>
      <button type="button" disabled={busy} aria-pressed={item.revision === selected} onClick={() => setSelected(item.revision)}>
        Revision {item.revision}<span>{new Date(item.createdAt).toLocaleString()}</span>
      </button></li>)}</ul>
    {selected && <><p>Restore revision {selected} into the working draft. The current working copy can be recovered with Undo.</p>
      <button type="button" className="ws-secondary" disabled={busy} onClick={() => void restore()}>Restore to draft</button></>}
  </div>;
}
