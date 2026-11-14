# Quality Assurance, Test Strategy and Acceptance Plan

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

## Test policy

This package defines **planned tests, none executed**. Every outcome must later include date, code commit/hash, test environment (browser, OS, viewport, network and Supabase/host versions), exact command, raw error/console or screenshot log and responsible reviewer. No imaginary test passes or Lighthouse scores.

## Testing levels and ownership

| Level | Target | Test families |
|---|---|---|
| Contract/schema | Project Format/Component/Operation/Build/Release versioning | Valid/invalid managed files, unknown fields, comment/bytes golden corpus, manifest pins |
| Unit | Pure editor-core transactions | S0/S1/S2/EMPTY, Add/Swap/Undo, field mapping, CSS token inheritance, hash and CAS |
| Component/UI | All surfaces and glyphs | Forms, focus, events, loaders, errors, responsive and reduced-motion |
| API/database | Auth, profiles, projects, quotas, RLS/Storage, operator actions | Owner A/B, expired JWT, role, path forgery, rate and privacy |
| Integration | Brevo emails, Supabase, project thumbnails, provider public API, static delivery | Real sender/route/quota, stale sync, released bytes and failures |
| End-to-end | From signup to live public release + rollback | Auth → private project → editor → public release → unpublish → Trash |
| Security adversarial | Custom JS, staging tokens, SSRF, ZIP import, role escalation | Direct-open, cross-origin, direct asset, host redirects, hostile URL |
| Visual/a11y | Aether Drift and user portfolio themes | Original brand reference comparison, WCAG 2.2 AA checks, manual SR/keyboard/zoom |
| Resilience | Offline/provider pause/quota, two tabs/devices, browser eviction | Recover/export, no fake sync/live status, rollback and incident states |
| Cost/operations | All chosen external service plans | No paid upgrade, host fair-use limits, provider quotas, rollback timeouts |

## Case inventory

The full [`registers/TEST_CASES.csv`](../../registers/TEST_CASES.csv) contains **one positive and one negative test per 53 workflow**, plus targeted adversarial and accessibility cases. Fields include domain, exact scenario, expected outcome, phase and `NOT_RUN` status. A story cannot be called Done until corresponding tests and specific technical proof gate pass.

## Test fixture design

Use synthetic Developer A, Developer B, valid reviewer, expired reviewer and narrow operator accounts. Use synthetic fake project URLs/media; **do not** use actual user passwords/secret keys. Include long Unicode names, RTL text, truncated project images, missing optional links, modified owned source, broken JSONC, conflicting tabs, malicious JS/ZIP and nested public/private project references. Real-provider tests require disposable accounts with explicit scope.

## Release blockers

- Public login/recovery unsupported by proven zero-cost email; cross-user RLS leakage; reviewer token bypass.
- Untrusted author JS can escape privileged origin or public release security gate.
- Required-empty slot publish allowed without justified policy; invalid project source causes loss.
- Live site reports Published before HTTP verification or fails private/unpublish direct-route check.
- Accessibility blocker in critical auth/editor/publication path.
- Broken strict ₹0 condition or automatically billed upgrade; unsafe screenshot capture SSRF.

## Test report format

Use `[PASS|FAIL|BLOCKED|NOT_RUN]`, expected vs observed, evidence paths, defect ID, decision/workflow IDs, severity, fix/retest and residual risk. A browser screenshot alone does not prove backend enforcement. Use [`TEST_REPORT_TEMPLATE.md`](TEST_REPORT_TEMPLATE.md) for future execution.
