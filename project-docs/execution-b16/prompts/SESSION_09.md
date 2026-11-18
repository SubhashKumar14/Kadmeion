# Session 9 — Public delivery and hosting verification

Paste MASTER_PROMPT.md first (or attach the complete kit), then this assignment. Do not operate from this assignment alone without current authority/ownership.

Run: 20261117-7232a31 / B16-v1. Shared plan: https://app.notion.com/p/41bb082297c781948335e8728d512fa9
Branch: work/20261117-7232a31/s09-b16
Log: S0 creates and links your own B16 log under the existing coordination tree before writes.
Primary workflow leads: Cross-cutting acceptance/integration; exact scope in requirements ledger.
Mission: Immutable bytes/media, method-aware verifier, revocation/cache/rollback receipts and actual hosting proof; public activation remains gated.

## First actions

After S4 checkpoint, take unlisted-release-verification.ts and delivery server/adapters. Existing method-aware GET/HEAD already implemented; preserve it and accept S13 updated fixtures.

## Implementation / work sequence

Complete immutable public HTML/media delivery, safe canonical route, live pointer/history/revoke/rollback receipts, cache and hostile-origin denial. Verify hosting capability and availability architecture against specs and ₹0 constraint; current per-request DB dependency cannot be called DB-independent delivery. Provide S4/S8 genuine typed results. Prepare exact hosted proof runbook, deployment/migration diff and rollback; use read-only observations and disposable local tests until authorized activation. Do not turn failure gates off to meet a date.

## Exit evidence

GET proves actual bytes/digests; HEAD proves applicable status/headers/bodylessness, not universal hash headers. Canonical/API/direct-media revocation and stale grant/redirect/cache negatives, DB outage behavior documented and accepted. Real host/authorization blockers are explicit, not replaced with mock receipts.

## Required reads and dependencies

Read MASTER_PROMPT.md, LATEST_STATE.md, EXECUTION_PLAN.md, FILE_OWNERSHIP.csv, WORKFLOW_BACKLOG.csv, REQUIREMENT_LEDGER.csv, CONTRACT_QUEUE.csv and COORDINATION_PROTOCOL.md. Read every named source file you edit, its direct contracts/tests, the workflow/screen specification linked by the reference index and the relevant engineering/quality docs. Read S0/S15 and dependency logs before each handoff. Do not reread all 165 documents each cycle; verify updated applicable sources.

The following complete proposed path list is an ownership index, not an instruction to rewrite every file. Transfers need the three-way RELEASED/GRANT/ACK. Historical reference bytes are read-only. Unlisted future files require exact reservation. New shared exports/manifest changes go to S15, router/CSS changes to S14.

- `api/_bounded-rpc-json.mjs`
- `api/public-portfolio.mjs`
- `api/reviewer.mjs`
- `api/unlisted.mjs`
- `packages/contracts/src/private-release-visibility-service.ts`
- `packages/contracts/src/releases.ts`
- `packages/storage-adapters/src/host-revocation-probe.ts`
- `packages/storage-adapters/src/private-artifact-direct-sql-writer.ts`
- `packages/storage-adapters/src/private-artifact-pg-worker.ts`
- `packages/storage-adapters/src/private-artifact-pointer-binding.ts`
- `packages/storage-adapters/src/private-asset-registration-completion.ts`
- `packages/storage-adapters/src/private-delivery-denial-gate.ts`
- `packages/storage-adapters/src/private-frozen-revision-loader.ts`
- `packages/storage-adapters/src/private-immutable-artifact.ts`
- `packages/storage-adapters/src/private-reviewer-staging.ts`
- `packages/storage-adapters/src/private-server-asset-byte-attestor.ts`
- `packages/storage-adapters/src/public-delivery-policy.ts`
- `packages/storage-adapters/src/safe-png-publication.ts`
- `packages/storage-adapters/src/unlisted-release-verification.ts`
- `supabase/functions/complete-private-asset/index.ts`
- `supabase/functions/publish/index.ts`

## Continue until the assigned capability is delivered

Implement and commit reviewable functionality, request independent tests, and report exact F/R/V evidence. While blocked on a contract or CI, take the next independent assigned capability. Do not repeatedly run unchanged full suites, wait silently for another chat, merge your own PR into integration/main, or change a leased foreign file. End with the exact resume/handoff status in COORDINATION_PROTOCOL.md.
