# Software Requirements Specification (SRS)

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

## 1. Scope and operating environment

Kadmeion's desired product is a responsive browser application + static published portfolio delivery. Application identity/data authority is Supabase Auth/PostgreSQL with row-level security, Storage and trusted RPC/Edge Functions. The browser maintains recoverable project drafts through IndexedDB and optionally a supported directory adapter; a deterministic renderer produces static HTML/CSS export. Public delivery host and caching mechanism remain to be selected and tested; no Express/Mongo backend is approved.

## 2. Use-case actor permissions

| Operation | Guest | Developer owner | Reviewer token | Restricted admin |
|---|---|---|---|---|
| View public published pages | Yes | Yes | Yes | Yes |
| Create account/sign in | Yes | Session-aware | No | Session-aware |
| Read unpublished drafts/files | No | Own only | No; pinned rendered staging only | No routine access |
| Edit project/portfolio/source | No | Own, qualified device | No | No |
| Publish/unpublish own release | No | Yes, guarded | No | Only narrow abuse takedown |
| Edit goals/provider handles/private analytics | No | Own only (phase 2) | No | No routine access |
| Review abuse/restore user access | No | Appeal only | No | Restricted, audited |

## 3. Precise external interfaces

- Browser surfaces: 52 documented screens/panels, route candidates and access conditions in `SCREENS.csv`; explicit owner-approved `/u/:handle` routes.
- Supabase Auth: signup/password/Google/reset/session operations with protected callbacks and login error nonenumeration; selected Brevo email provider remains unconfigured and proof-gated.
- Data: owner-scoped PostgREST/RPC and Storage; all mutating trusted actions enforce identity and idempotency independent of UI.
- Builder: pure typed operations on committed revision; managed grammar, versioned manifest, protected owned source, last-good preview.
- Publisher: immutable release and access pointer, pinned HTML/metadata, server-side staging expiry, public hosting static bytes with direct status and verified rollback.
- Optional P2 providers: public handle, documented free permitted API and source freshness, link-only on failure.

## 4. Input/output and validation contracts

- Handle: normalized unique identifier; reserved words and collision checked by authoritative transaction. Debounced availability UI is informative only.
- Project URLs: HTTPS or explicitly permitted schemes, no javascript/data URLs; link validation independent of screen. URL capture request separately SSRF-protected.
- Portfolio file import: path normalization, size/decompression ratio limits, schema versions, asset content validation and prohibited executable content handling.
- Published HTML: static source-free output, escaped user values, metadata from actual author content, controlled script restrictions, privacy-safe public projection.
- Error: stable codes, human remediation, retryable distinction, minimized logs without secrets.

## 5. Reliability, privacy and availability

Local drafts survive eligible offline failures within browser storage limitations; browser persistence is not guaranteed and explicit ZIP/folder backup remains available. Public delivery should remain available during Supabase DB pause *only if independent hosting and release resolver tests succeed*; not an entitlement. Tombstoned routes must fail closed, including direct release URLs. 15-day Trash applies to items, not a promise of immediate purge from provider backups. Account erasure has independent validated process. Analytics disabled before per-portfolio consent.

## 6. Security and performance acceptance

- RLS for private rows and Storage, JWT validation at trusted Edge boundary, no privileged keys in frontend/export; tested anonymous/owner/cross-owner/operator matrix.
- No untrusted authored JavaScript on Kadmeion privileged origin or public host absent hostile direct-open sandbox proof. Safe static publication or full export after disclosure.
- Performance benchmarks must specify actual device, dataset, network, cold/warm conditions and percentile. No fabricated Lighthouse scores, SLOs or launch measurements.
- WCAG 2.2 AA **target** and critical screen keyboard/SR/zoom/contrast release gate.
- Cost quotas and deny-billing flags enforced before accepting live open signup, capture, public release or scheduled synchronization.

## 7. Requirement verification scheme

Use distinct requirement `FR-*`, `SEC-*`, `UX-*` and UI-decision IDs, associate each with role permissions, data/storage, domain workflow and test ID. All listed tests in `registers/TEST_CASES.csv` are `NOT_RUN`. Evidence of execution requires command/environment/date/result and retained artifact. A generated screenshot or storyboard alone is not integration evidence.
