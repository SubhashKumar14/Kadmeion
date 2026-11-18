# Session 13 — Independent backend, security and contract QA

Paste MASTER_PROMPT.md first (or attach the complete kit), then this assignment. Do not operate from this assignment alone without current authority/ownership.

Run: 20261117-7232a31 / B16-v1. Shared plan: https://app.notion.com/p/41bb082297c781948335e8728d512fa9
Branch: work/20261117-7232a31/s13-b16
Log: S0 creates and links your own B16 log under the existing coordination tree before writes.
Primary workflow leads: Cross-cutting acceptance/integration; exact scope in requirements ledger.
Mission: After S6 fixture handoff: real SQL/RLS/CAS, media and quota negatives, delivery GET/HEAD, contract and export tests.

## First actions

Receive S6 backend/unit/SQL test leases after #25 is preserved. Pair S4 verifier+fixtures and #28 migration+permission checks under S15 combined candidate; independently verify new code, not only existing 511 SQL assertions.

## Implementation / work sequence

Own backend/contract/editor-domain/adapter test corpus: thumbnail/links/avatar/general media owner/byte/CAS/replay, goal chronology/conditional writes, export quota/inventory/hash, delivery GET/HEAD/revocation, recovery transaction integrity and opaque bytes, moderation/reauth/roles, P2 providers/score/analytics. Use isolated local Supabase/HTTP/Storage/Edge; never real destructive data tests. Strengthen feature gate checks so absent candidates cannot be silently skipped on release.

## Exit evidence

Evidence ties each relevant TC/TP/UI to exact source/test/runner SHA and environment. Review test harness errors separately from product failure; all critical negatives execute in combined tree. Route product fixes to sole owner. Check redaction; no raw tokens/traces. S15 retains artifacts and CI paths.

## Required reads and dependencies

Read MASTER_PROMPT.md, LATEST_STATE.md, EXECUTION_PLAN.md, FILE_OWNERSHIP.csv, WORKFLOW_BACKLOG.csv, REQUIREMENT_LEDGER.csv, CONTRACT_QUEUE.csv and COORDINATION_PROTOCOL.md. Read every named source file you edit, its direct contracts/tests, the workflow/screen specification linked by the reference index and the relevant engineering/quality docs. Read S0/S15 and dependency logs before each handoff. Do not reread all 165 documents each cycle; verify updated applicable sources.

The following complete proposed path list is an ownership index, not an instruction to rewrite every file. Transfers need the three-way RELEASED/GRANT/ACK. Historical reference bytes are read-only. Unlisted future files require exact reservation. New shared exports/manifest changes go to S15, router/CSS changes to S14.

- `supabase/tests/account-erasure-jwt-receipt.sql`
- `supabase/tests/case-bound-operator-private-block.sql`
- `supabase/tests/consented-public-delivery.sql`
- `supabase/tests/global-privileged-rpc-audit.sql`
- `supabase/tests/owner-isolation-and-transactional-revisions.sql`
- `supabase/tests/portfolio-private-revisions.sql`
- `supabase/tests/private-account-erasure-requests.sql`
- `supabase/tests/private-account-exit-inventory.sql`
- `supabase/tests/private-account-exit-preflight.sql`
- `supabase/tests/private-account-exit-reauth.sql`
- `supabase/tests/private-account-exit-storage-reconciliation.sql`
- `supabase/tests/private-artifact-pointer-binding.sql`
- `supabase/tests/private-asset-content-attestations.sql`
- `supabase/tests/private-delivery-denial-gate.sql`
- `supabase/tests/private-frozen-release-requests.sql`
- `supabase/tests/private-goals-and-manual-progress.sql`
- `supabase/tests/private-moderation-cases.sql`
- `supabase/tests/private-my-components.sql`
- `supabase/tests/private-onboarding-progress.sql`
- `supabase/tests/private-release-visibility-pointer.sql`
- `supabase/tests/private-reviewer-grants.sql`
- `supabase/tests/private-trash-lifecycle.sql`
- `supabase/tests/private-trash-owner-isolation.sql`
- `supabase/tests/project-exposure-identity-immutability.sql`
- `supabase/tests/projects-and-assets.sql`
- `supabase/tests/restricted-creation-privileges.sql`
- `supabase/tests/rls-and-roles.sql`
- `supabase/tests/verified-private-asset-registration.sql`
- `tests/auth-web/auth-redirect.test.ts`
- `tests/auth-web/form-helpers.test.ts`
- `tests/auth-web/public-bundle-audit.test.ts`
- `tests/auth-web/supabase-auth-port.test.ts`
- `tests/auth-web/theme-preference.test.ts`
- `tests/contracts/auth-service.test.ts`
- `tests/contracts/identity.test.ts`
- `tests/contracts/operations.test.ts`
- `tests/contracts/private-account-erasure-service.test.ts`
- `tests/contracts/private-asset-edge-handler.test.ts`
- `tests/contracts/private-asset-registration-completion.test.ts`
- `tests/contracts/private-goals-service.test.ts`
- `tests/contracts/private-identity-service.test.ts`
- `tests/contracts/private-moderation-service.test.ts`
- `tests/contracts/private-my-components-service.test.ts`
- `tests/contracts/private-notifications-service.test.ts`
- `tests/contracts/private-onboarding-service.test.ts`
- `tests/contracts/private-platform-links-service.test.ts`
- `tests/contracts/private-project-case-studies.test.ts`
- `tests/contracts/private-project-workflows.test.ts`
- `tests/contracts/private-release-service.test.ts`
- `tests/contracts/private-release-visibility-service.test.ts`
- `tests/contracts/private-reviewer-service.test.ts`
- `tests/contracts/private-trash-service.test.ts`
- `tests/contracts/project-data-service.test.ts`
- `tests/contracts/project-schema.test.ts`
- `tests/contracts/projects.test.ts`
- `tests/contracts/public-http-security.test.ts`
- `tests/contracts/publish-edge-handler.test.ts`
- `tests/contracts/reviewer-preview-handler.test.ts`
- `tests/contracts/unlisted-delivery-handler.test.ts`
- `tests/editor/editor-save-coordinator.test.ts`
- `tests/editor/host-revocation-cli.test.ts`
- `tests/editor/host-revocation-probe.test.ts`
- `tests/editor/journaled-editor-folder.test.ts`
- `tests/editor/portable-source-archive.test.ts`
- `tests/editor/portfolio-revision-transactions.test.ts`
- `tests/editor/private-account-data-export.test.ts`
- `tests/editor/private-artifact-direct-sql-writer.test.ts`
- `tests/editor/private-artifact-pg-worker.test.ts`
- `tests/editor/private-artifact-pointer-binding.test.ts`
- `tests/editor/private-delivery-denial-gate.test.ts`
- `tests/editor/private-frozen-revision-loader.test.ts`
- `tests/editor/private-immutable-artifact.test.ts`
- `tests/editor/private-server-asset-byte-attestor.test.ts`
- `tests/editor/public-delivery-policy.test.ts`
- `tests/editor/publish-preflight.test.ts`
- `tests/editor/safe-png-publication.test.ts`
- `tests/editor/snapshot-recovery-integrity.test.ts`
- `tests/editor/static-preview-export.test.ts`
- `tests/editor/supabase-portfolio-revisions.test.ts`
- `tests/editor/unlisted-release-verification.test.ts`
- `tests/integration/local-auth-email.test.mjs`
- `tests/integration/local-moderation-binding-race.test.mjs`
- `tests/integration/local-postgres-binding.test.mjs`
- `tests/integration/local-private-asset-edge.test.mjs`
- `tests/integration/local-publish-edge.test.mjs`
- `tests/integration/local-supabase-http.test.mjs`

## Continue until the assigned capability is delivered

Implement and commit reviewable functionality, request independent tests, and report exact F/R/V evidence. While blocked on a contract or CI, take the next independent assigned capability. Do not repeatedly run unchanged full suites, wait silently for another chat, merge your own PR into integration/main, or change a leased foreign file. End with the exact resume/handoff status in COORDINATION_PROTOCOL.md.
