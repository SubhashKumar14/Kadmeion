# Session 10 — Goals, provider integrations and DevScore

Paste MASTER_PROMPT.md first (or attach the complete kit), then this assignment. Do not operate from this assignment alone without current authority/ownership.

Run: 20261117-7232a31 / B16-v1. Shared plan: https://app.notion.com/p/41bb082297c781948335e8728d512fa9
Branch: work/20261117-7232a31/s10-b16
Log: S0 creates and links your own B16 log under the existing coordination tree before writes.
Primary workflow leads: WF-037, WF-038, WF-040, WF-041, WF-042
Mission: After S5/S1 handoff: consume conditional goals/cursors, finish goal journey; implement permitted provider facts and explainable private score.

## First actions

After S5/S1 checkpoint take growth.tsx, private-goals-service.ts and private-platform-links-service.ts. Preserve already-built templates, milestone CRUD, typed deletes, paged manual history and corrections. Consume new conditional goal update and chronological cursor.

## Implementation / work sequence

Finish real goal lifecycle/CAS/archiving/deletion and sourced-vs-manual history. Verify each of six provider permissions/rate limits through official current sources; implement permitted public-handle retrieval, provenance, sync/cooldown/stale/partial state and disconnect/delete derived facts. Supported link-only fallback is valid where a provider forbids retrieval, but not a completed sync. Implement private versioned DevScore categories, missingness/confidence, sufficient-coverage threshold, correction/guidance per approved formula; where formula lacks approval ask S0, do not invent weights as approved. Connect S12 analytics module without rewriting it.

## Exit evidence

S13 >100 chronological progress/cursor/foreign/CAS and provider parser/error tests; S6 real goal flow. Never claim link matches prove ownership. No scraping/captcha bypass, public ranking or fake numeric scores. API permission/score-decision gaps remain blocking scope records.

## Required reads and dependencies

Read MASTER_PROMPT.md, LATEST_STATE.md, EXECUTION_PLAN.md, FILE_OWNERSHIP.csv, WORKFLOW_BACKLOG.csv, REQUIREMENT_LEDGER.csv, CONTRACT_QUEUE.csv and COORDINATION_PROTOCOL.md. Read every named source file you edit, its direct contracts/tests, the workflow/screen specification linked by the reference index and the relevant engineering/quality docs. Read S0/S15 and dependency logs before each handoff. Do not reread all 165 documents each cycle; verify updated applicable sources.

The following complete proposed path list is an ownership index, not an instruction to rewrite every file. Transfers need the three-way RELEASED/GRANT/ACK. Historical reference bytes are read-only. Unlisted future files require exact reservation. New shared exports/manifest changes go to S15, router/CSS changes to S14.

- `apps/frontend/src/growth.tsx`
- `packages/contracts/src/private-goals-service.ts`
- `packages/contracts/src/private-platform-links-service.ts`

## Continue until the assigned capability is delivered

Implement and commit reviewable functionality, request independent tests, and report exact F/R/V evidence. While blocked on a contract or CI, take the next independent assigned capability. Do not repeatedly run unchanged full suites, wait silently for another chat, merge your own PR into integration/main, or change a leased foreign file. End with the exact resume/handoff status in COORDINATION_PROTOCOL.md.
