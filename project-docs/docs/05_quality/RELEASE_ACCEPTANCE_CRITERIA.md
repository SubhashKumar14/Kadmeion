# Release Readiness and Definition of Done

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

## Gate matrix

| Gate | Evidence required | Failure policy |
|---|---|---|
| G0 Source/decision | UI-001–115 traceable, supersession register coherent, source licenses checked | Halt design-to-code until conflicts resolved |
| G1 Auth/data | Real Supabase Auth email/Google/reset, RLS/storage cross-owner matrix, no account enumeration | No public account launch |
| G2 Editor integrity | S0/S1/S2/EMPTY, transaction CAS, invalid buffers, file+source round trip, Undo | No authoring release with data-loss risk |
| G3 Public host | JS-off HTML, public route status/SEO, immutable release, staged revoke, unpublish/cache/direct URLs, rollback | Only static ZIP/offline demo; do not announce hosted publication |
| G4 Safety | Hostile custom JS sandbox matrix, SSRF if capture enabled, ZIP security, no secrets exported | Remove unsafe capability and use approved static fallback |
| G5 UX/a11y | Critical journey keyboard/SR/reduced-motion/zoom, brand reference match, mobile edit restriction | Block relevant inaccessible feature |
| G6 Cost and policy | Free plan/quotas, hard no-billing controls, UGC service terms, retention/disclosure | Disable unavailable provider feature; protect user exports |
| G7 Phase 2 | Public API permissions, metric provenance, opt-in analytics, private DevScore fairness | Link-only, private category scores or defer |

## Definition of Done

A feature is Done only when committed source and reproducing test evidence exist, its owning workflow and screens are implemented, failure states work, security/privacy implications have passed, owner UX is honored and the delivered release/route is verified if public. Documentation alone is NOT Done. Any unsupported feature should be visibly unavailable, never a decorative working-looking button.

## Verification artifact inventory to retain later

Commit SHA, deployment ID, host/provider terms, RLS migration/policy diff, test command/results, browser a11y report, visual reference comparison, public HTTP trace with JS off, release hash and pointer status, quota/usage evidence, incident/rollback record, screenshots and source licensing. No such application artifacts were created as part of this documentation task.
