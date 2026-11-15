# Kadmeion B07–B11 — Verified Backend / Frontend Handoff (15 November 2026)

## Exact source of truth and operating boundary
- Application repository: https://github.com/SubhashKumar14/Kadmeion
- Implementation branch: `feat/b0-backend-foundation`; verified code checkpoint `274c8683e278295f859564bb20f54d0127e774a4`. PR: https://github.com/SubhashKumar14/Kadmeion/pull/1
- User-approved D01–D90: Notion page `416b082297c781b2b6b1ec116ab4bb9e`. UI decisions and editor blueprints: existing `project-docs`; these are authoritative ahead of older planning.
- Verified CI: https://github.com/SubhashKumar14/Kadmeion/actions/runs/43703455588 (green; 444 Node tests, 494 pgTAP/database assertions, local HTTP/Edge/Mailpit/SQL smoke tests).
- No paid subscriptions or newly activated billable services were introduced here. Existing Vercel preview SSO protection must not be mistaken for anonymous publication.

## Verified database and hosted state
- 55/55 authored migration versions applied on hosted Supabase `scyooqjitjzjdxgtanso`. Latest `20261115133000_account_erasure_jwt_truthful_receipt.sql` (forward-only) is deployed; hosted function definition and role grants rechecked.
- 3 Edge Functions active: `publish`, `complete-private-asset`, `purge-expired-trash`. No production purge schedule enabled.
- 40/40 application tables have RLS enabled; anonymous SELECT grants none; 82 SECURITY DEFINER functions read-only audited, none executable by anon; search paths restricted to empty or pg_catalog. This is privilege metadata evidence, **not** a complete adversarial API proof.
- The live database had two Auth rows when inspected; tests run on a disposable local Supabase, not against those hosted identities.
- Vercel preview builds READY, but project `live=false` and SSO protected. Do not claim public host, anonymous SEO or independent CDN revocation acceptance.

## Backend-to-frontend integration inventory

| Surface | Actual source / endpoint | Safe usage contract |
|---|---|---|
| Email/password and Google | `packages/contracts/src/auth-service.ts`, `apps/auth-web/src/supabase-auth-port.ts`, `apps/auth-web/src/auth-redirect.ts` | Owner identity checked across sign-in, immediate registration and OAuth callback; live Brevo proof outstanding; no fake delivery |
| Private identity/onboarding | `packages/contracts/src/private-identity-service.ts`, `private-onboarding-service.ts` | Owner RLS and private profile by default; only a consented public projection may appear at `/u/:handle` |
| Projects/case studies | `packages/contracts/src/project-data-service.ts`, `private-project-case-studies.ts` | No required GitHub URL, owner-only writes, separate public exposure; `/u/:handle/projects/:slug` is a controlled projection |
| Portfolio editor | `packages/editor-core/src/managed-project-files.ts`, `portfolio-revision-transactions.ts` | Five presets + Blank; eight layout identifiers; single CAS writer; preserve EMPTY/S0/S1/S2 and owned source/stashes |
| Draft persistence/portability | `packages/storage-adapters/src/editor-save-coordinator.ts`, `supabase-portfolio-revisions.ts`, `portable-source-archive.ts` | Conflict/snapshot integrity before overwrite, private drafts, strict ZIP import/export; never accept client role claims |
| Safe private preview | `packages/editor-core/src/publish-preflight.ts`, `packages/storage-adapters/src/private-immutable-artifact.ts` | Scriptless pinned S0 projection; custom JS stays private and isolated; preview-only result never claims host publication |
| Frozen publication | `packages/contracts/src/private-release-service.ts`, `supabase/functions/publish/index.ts`, `packages/storage-adapters/src/public-delivery-policy.ts` | Explicit owner consent, immutable artifact/digest, independent host HTTP+media probe, atomic pointer/ack and revocation |
| Public portfolio | `/:handle/:slug` rewrite to `api/public-portfolio.mjs` | Exact frozen HTML/media digest; no-store; indexability only after confirmed release ack |
| Reviewer staging | `/r/:review` rewrite to `api/reviewer.mjs` | Expiring token, private/noindex, host-mediated scoped assets, no-cache; no direct Storage public bucket |
| Unlisted release | `api/unlisted.mjs` | Scriptless, noindex, owner-authorized scoped release and assets, fail closed |
| Public identity and case study | `api/published-identity.mjs` | Consent-based public fields; no private draft fetch from visitors |
| Private export and recovery | `packages/storage-adapters/src/private-account-data-export.ts` | Bounded app snapshot and verified private media ZIP; never promise Supabase Auth-provider backups/messages or provider erasure |
| Account exit and 15-day Trash | `packages/contracts/src/private-account-erasure-service.ts`, `private-trash-service.ts`, `supabase/functions/purge-expired-trash/index.ts` | Fresh owner proof and host withdrawal; JWTs may outlive deleted Auth session rows; scheduler opt-in and secret-gated |
| Restricted moderation, notifications | `packages/contracts/src/private-moderation-service.ts`, `private-notifications-service.ts` | Audited case-bound moderation; no editorial impersonation; owner-only inbox |
| Integration/growth | `packages/contracts/src/private-goals-service.ts` | Phase-2 metrics/DevScore/provider sync are not to be fabricated as Phase-1 working features |

## Rollout gates
1. **Code**: CI of final commit SHA must be green (the verified SHA above was green); re-run after later commits.
2. **Database**: hosted migration versions aligned; no need to replay 55 migrations. Future SQL must be forward-only.
3. **Release host**: owner approval required to switch protected Vercel preview to public; prove anonymous direct HTML, no-JS, CSP, exact PNG digest and unpublish/rollback/cache denial.
4. **Brevo**: owner will perform manual sender/DNS/SMTP, real recipient and expiry checks later. All independently testable code proceeds without this manual step.
5. **Trash cron**: no destructive scheduling until the workflow is merged to default branch, GitHub `KADMEION_TRASH_SWEEP_SCHEDULE_ENABLED=true`, GitHub `KADMEION_TRASH_SWEEP_SECRET` and matching Supabase function secret and `KADMEION_TRASH_SWEEP_ENABLED=true` are deliberately configured. Before enabling, rehearse on disposable data and review provider retention.
6. **Frontend**: use all 52 latest approved screens and branding sources; `apps/auth-web` is only a proof. Both light and derived dark theme must respect approved colors, with no invented mockups.
7. **Scope**: advanced AI, complete six-provider analytics synchronization and private composite DevScore remain later-phase features.

## Reconciliation and remaining blockers
- 53 workflow entries are recorded without false whole-screen completion in `registers/WORKFLOWS_BACKEND_EVIDENCE_2026-11-15.csv`; tests referenced by path are CI-source evidence, not a per-workflow acceptance certificate.
- The D01–D90 compliance matrix remains in `registers/D01_D90_BACKEND_TRACEABILITY.csv`. See `registers/UI_001_115_BACKEND_EVIDENCE_2026-11-15.csv`, `registers/TEST_CASES_BACKEND_EVIDENCE_2026-11-15.csv` and `registers/TECHNICAL_PROOFS_BACKEND_EVIDENCE_2026-11-15.csv` for 115/UI, 138 acceptance cases and 20 proof-gate evidence without invented pass states; 52 D01–D90 entries were conservatively PARTIAL, 2 BLOCKED_EXTERNAL, 12 DEFERRED_APPROVED and 24 NOT_APPLICABLE at baseline. Reclassify only with per-decision proof.
- 138 original acceptance cases and 20 technical proof gates need full matrix evidence; no claim they all passed. Key open gates include TP-01 live sender, TP-03/04 host independence/revocation, TP-05 malicious script browser proof, TP-17 accessibility, TP-18 cost/legal terms, TP-19 provider retention.
- Critical known limitations: no verified anonymous permanent public-host acceptance; Vercel protected preview; no real Brevo delivery proof; reviewer token/caching/CDN races lack hosted test; account export does not include provider-managed data/backups; ephemeral local tests do not validate a real user's production migration/erasure journey.
- **Status:** Phase 1 backend code NOT YET proven 100%; hosted backend NOT fully verified; ready for full frontend acceptance NOT YET. Never substitute file count or 444 green Node tests for these gates.

This document records actual completed work and exact remaining host/manual dependencies; it does not authorize a merge, protected configuration changes or public production launch.
