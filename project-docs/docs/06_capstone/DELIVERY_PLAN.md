# Phased Development Plan, Work Breakdown and Gate Dependencies

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

**This is a proposed execution plan.** It neither schedules background work nor authorizes code or provider deployment. Durations are intentionally uncommitted until verified estimates exist.

## Phase 0 — Preflight and project scaffolding

Document authority/ADR, font/asset license source, architecture interfaces, free provider evidence and repo initialization after approval. Establish the five versioned editor contracts and required test harnesses before full UI polish.

## Phase 1 — Owner-approved core scope

| Milestone | Work package | Acceptance and dependency |
|---|---|---|
| P1-M1 | Versioned project format/one-writer transaction engine | S0/S1/S2/EMPTY, journal, Undo, two-tab CAS and export golden corpus |
| P1-M2 | Trusted template kit and basic accessible three-pane editor | Five initial presets, eight initial layouts, Blank, keyboard layer tree, content-first inspector, no phone authoring |
| P1-M3 | Theme/assets/custom owned source | Tiered CSS custom properties, safe media, protected swap, source buffers/diagnostics, no privileged custom JS |
| P1-M4 | Supabase auth + profiles/projects and RLS | Email/password/Google, recovery with real selected Brevo, private profile/project, link-based case studies, cross-user tests |
| P1-M5 | Author/Published preview + deterministic static export | Correct pinned revision, JS-off SEO HTML, portable project and public ZIP, no secrets |
| P1-M6 | Staging, public publishing and Releases | P0 hosting/tombstone/cache proof, verified live route, rollback and 15-day Trash |
| P1-M7 | Settings, privacy, account erasure and narrow admin | Users and Portfolio Moderation, appeals, minimal audit, no impersonation |
| P1-M8 | End-to-end/a11y/cost acceptance | Real workflows including severe failure modes, brand fidelity and no-billing proof |

## Phase 2 — Growth scope

Public-handle provider cards and legal/free source validation; private activity timeline, explainable DevScore and goals; per-portfolio opt-in aggregate analytics with no persistent visitor identity; responsive dashboards/charts with accessible tables; provider outage and source-missing fallback. This phase does not imply every provider can be automatically synchronized.

## Phase 3 — Later optional scope

Context-aware opt-in AI assistant only after privacy/secret filtering, user-reviewed edits and legitimate free provider; advanced admin analytics/activity/reporting with narrowly derived permissions. Additional templates beyond five and hosted contact form depend on separate maintenance/cost/security decisions.

## Dependency and critical path

`editor source integrity → reliable static build/export → Supabase ownership and public Auth/recovery → release hosting privacy/rollback proof → real integrated publish → a11y/security/cost acceptance`. Optional analytics cannot rescue a broken portfolio release. P0 failure stops the dependent feature; safe static/export or link-only mode is the explicit fallback.

## Milestone evidence package (future)

Commit/hash, API/schema migration, negative RLS tests, sample project export, public HTTP screenshots/logs, WCAG results, release manifest and rollback trace, provider quota/cost evidence, source media licenses, decision references and open defects. Avoid percentage-complete claims based only on files generated in this pack.
