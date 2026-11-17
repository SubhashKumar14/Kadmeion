# Session 4 — Release frontend and portable exports

Paste MASTER_PROMPT.md first (or attach the complete kit), then this assignment. Do not operate from this assignment alone without current authority/ownership.

Run: 20261117-7232a31 / B16-v1. Shared plan: https://app.notion.com/p/41bb082297c781948335e8728d512fa9
Branch: work/20261117-7232a31/s4-release
Log: https://app.notion.com/p/41ab082297c7819c9a51f338d94fe9f2
Primary workflow leads: WF-029, WF-030, WF-031, WF-032, WF-033, WF-034, WF-035, WF-036
Mission: Preserve #21; preflight deep links, frozen comparison, real publish/republish/history/rollback/unpublish/share and archive coverage.

## First actions

Preserve #21 87361bc: private comparison, clickable preflight index and ZIP readback/hashes exist. Stage verifier code with S6 fixtures via S15; six GET-only failures are not a reason to weaken the new verifier. After combined acceptance transfer verifier implementation to S9 and tests to S13.

## Implementation / work sequence

Consume S3 actual panel/slot link contract; implement usable reviewer, publish confirmation, live-vs-draft diff, republish preserving old live on failure, real release history/rollback selection, withdrawal and share from actual host receipts. Finish editable/static/account distinctions, archive import/export integrity and applicable source+asset coverage with S3/S5/S9; no external repository source archive unless actually stored. Owned source remains opaque; arbitrary JS publication remains blocked.

## Exit evidence

S6 tests selection >50, immutable pin, expiry/revoke/delayed response, actual downloaded bytes and checksum, retry identities and final success/denial. Live controls only succeed on approved authoritative delivery; private frozen requests cannot masquerade as live releases.

## Required reads and dependencies

Read MASTER_PROMPT.md, LATEST_STATE.md, EXECUTION_PLAN.md, FILE_OWNERSHIP.csv, WORKFLOW_BACKLOG.csv, REQUIREMENT_LEDGER.csv, CONTRACT_QUEUE.csv and COORDINATION_PROTOCOL.md. Read every named source file you edit, its direct contracts/tests, the workflow/screen specification linked by the reference index and the relevant engineering/quality docs. Read S0/S15 and dependency logs before each handoff. Do not reread all 165 documents each cycle; verify updated applicable sources.

The following complete proposed path list is an ownership index, not an instruction to rewrite every file. Transfers need the three-way RELEASED/GRANT/ACK. Historical reference bytes are read-only. Unlisted future files require exact reservation. New shared exports/manifest changes go to S15, router/CSS changes to S14.

- `apps/frontend/src/release.tsx`
- `packages/contracts/src/private-release-service.ts`
- `packages/contracts/src/private-reviewer-service.ts`
- `packages/storage-adapters/src/portable-source-archive.ts`
- `packages/storage-adapters/src/static-preview-export.ts`

## Continue until the assigned capability is delivered

Implement and commit reviewable functionality, request independent tests, and report exact F/R/V evidence. While blocked on a contract or CI, take the next independent assigned capability. Do not repeatedly run unchanged full suites, wait silently for another chat, merge your own PR into integration/main, or change a leased foreign file. End with the exact resume/handoff status in COORDINATION_PROTOCOL.md.
