# Session 3 — Editor transactions and durable recovery

Paste MASTER_PROMPT.md first (or attach the complete kit), then this assignment. Do not operate from this assignment alone without current authority/ownership.

Run: 20261117-7232a31 / B16-v1. Shared plan: https://app.notion.com/p/41bb082297c781948335e8728d512fa9
Branch: work/20261117-7232a31/s3-editor
Log: https://app.notion.com/p/41ab082297c78182ba7bdf09cf96da89
Primary workflow leads: WF-018, WF-019, WF-020, WF-026, WF-027, WF-028
Mission: Preserve #20; verified-owner composition, checkpoint/recovery/Keep Both, exact bytes, source buffers, folder/import and autosave semantics.

## First actions

Preserve #20 cc34735: green standalone CI, working checkpoint freeze/recovery, palette history and slot guards already exist. S15/S14 compose the verifiedOwner prop with latest source; old #27 is stale.

## Implementation / work sequence

Complete acknowledged journal persistence, exact-buffer reload/Restore/Keep Both, quota/abort/two-tab/owner-epoch handling, safe local working export, folder/import UX and source diagnostics/last-good preview within approved model. Clarify private autosave vs cloud Save with the specification. Maintain transactional engine for S7 typed layout/theme/asset commands and one acknowledged mutation; no opaque-source loss. Add bounded initial editor panel/slot query handling for S4 exact deep links. Hand portfolio-tools.tsx to S7 at a pinned checkpoint; then only S7 edits it.

## Exit evidence

Real IndexedDB restart/transaction/quota tests, exact managed+owned bytes before/after Restore and cloud reload, no offline identity bypass, all supported buffers and new commands covered. Core exports/theme schema stay compatible with S4; no drag UI that bypasses typed transaction writer.

## Required reads and dependencies

Read MASTER_PROMPT.md, LATEST_STATE.md, EXECUTION_PLAN.md, FILE_OWNERSHIP.csv, WORKFLOW_BACKLOG.csv, REQUIREMENT_LEDGER.csv, CONTRACT_QUEUE.csv and COORDINATION_PROTOCOL.md. Read every named source file you edit, its direct contracts/tests, the workflow/screen specification linked by the reference index and the relevant engineering/quality docs. Read S0/S15 and dependency logs before each handoff. Do not reread all 165 documents each cycle; verify updated applicable sources.

The following complete proposed path list is an ownership index, not an instruction to rewrite every file. Transfers need the three-way RELEASED/GRANT/ACK. Historical reference bytes are read-only. Unlisted future files require exact reservation. New shared exports/manifest changes go to S15, router/CSS changes to S14.

- `apps/frontend/src/portfolios.tsx`
- `packages/editor-core/src/isolated-owned-preview.ts`
- `packages/editor-core/src/managed-project-files.ts`
- `packages/editor-core/src/portfolio-revision-transactions.ts`
- `packages/editor-core/src/publish-preflight.ts`
- `packages/storage-adapters/src/editor-save-coordinator.ts`
- `packages/storage-adapters/src/indexeddb-editor-drafts.ts`
- `packages/storage-adapters/src/journaled-editor-folder.ts`
- `packages/storage-adapters/src/portable-editor-snapshot.ts`
- `packages/storage-adapters/src/supabase-portfolio-revisions.ts`

## Continue until the assigned capability is delivered

Implement and commit reviewable functionality, request independent tests, and report exact F/R/V evidence. While blocked on a contract or CI, take the next independent assigned capability. Do not repeatedly run unchanged full suites, wait silently for another chat, merge your own PR into integration/main, or change a leased foreign file. End with the exact resume/handoff status in COORDINATION_PROTOCOL.md.
