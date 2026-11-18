# Session 12 — Consented portfolio analytics

Paste MASTER_PROMPT.md first (or attach the complete kit), then this assignment. Do not operate from this assignment alone without current authority/ownership.

Run: 20261117-7232a31 / B16-v1. Shared plan: https://app.notion.com/p/41bb082297c781948335e8728d512fa9
Branch: work/20261117-7232a31/s12-b16
Log: S0 creates and links your own B16 log under the existing coordination tree before writes.
Primary workflow leads: WF-039
Mission: Implement approved P2 opt-in aggregates, collection/retention contracts, real charts/tables and disable/delete semantics.

## First actions

WF-039 is a real missing P2 capability, not a UI empty-state task. Read consent/data-retention and analytics approval details before designing schema. Reserve exact module/migration/test paths with S0; S10 owns growth.tsx and S14 router.

## Implementation / work sequence

Implement per-portfolio opt-in, aggregate collection/query/retention with bounded validated events, abuse/rate protection, bot/duplicate policy and no raw visitor identifiers or unnecessary fingerprinting. Create real chart/table/filter views, no-data/error/loading and disclosure; opt-out stops collection and honors approved retention/deletion. Public event receiver is server-side bounded and must not expose service keys or private owner data. S9 wires any approved collector hook; no tracking until actual consent. Specify any new aggregate contract before UI, then build it with isolated tests.

## Exit evidence

S13 consent/foreign/anon write bounds/rate/retention/aggregation tests, S6 real opt-in→visit→aggregate→opt-out journey and accessible chart tables. If approved policy or free-safe host limits are absent, record exact blocker and implement safe independent parts; never award whole WF-039 completion for off-state.

## Required reads and dependencies

Read MASTER_PROMPT.md, LATEST_STATE.md, EXECUTION_PLAN.md, FILE_OWNERSHIP.csv, WORKFLOW_BACKLOG.csv, REQUIREMENT_LEDGER.csv, CONTRACT_QUEUE.csv and COORDINATION_PROTOCOL.md. Read every named source file you edit, its direct contracts/tests, the workflow/screen specification linked by the reference index and the relevant engineering/quality docs. Read S0/S15 and dependency logs before each handoff. Do not reread all 165 documents each cycle; verify updated applicable sources.

The following complete proposed path list is an ownership index, not an instruction to rewrite every file. Transfers need the three-way RELEASED/GRANT/ACK. Historical reference bytes are read-only. Unlisted future files require exact reservation. New shared exports/manifest changes go to S15, router/CSS changes to S14.



## Continue until the assigned capability is delivered

Implement and commit reviewable functionality, request independent tests, and report exact F/R/V evidence. While blocked on a contract or CI, take the next independent assigned capability. Do not repeatedly run unchanged full suites, wait silently for another chat, merge your own PR into integration/main, or change a leased foreign file. End with the exact resume/handoff status in COORDINATION_PROTOCOL.md.
