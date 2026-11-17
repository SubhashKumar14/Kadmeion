# Session 11 — Authentication, moderation and lifecycle

Paste MASTER_PROMPT.md first (or attach the complete kit), then this assignment. Do not operate from this assignment alone without current authority/ownership.

Run: 20261117-7232a31 / B16-v1. Shared plan: https://app.notion.com/p/41bb082297c781948335e8728d512fa9
Branch: work/20261117-7232a31/s11-b16
Log: S0 creates and links your own B16 log under the existing coordination tree before writes.
Primary workflow leads: WF-001, WF-002, WF-003, WF-004, WF-005, WF-006, WF-007, WF-044, WF-049, WF-050, WF-051, WF-052
Mission: Preserve verified auth; finish actual recovery/OAuth paths, restricted operations/appeals, Trash/session lifecycle and cleanup readiness.

## First actions

Take auth.tsx/auth.css/operations.tsx and associated domain contracts after S5 release. Verified reauth/epoch baseline is integrated: do not rewrite it without demonstrated defect. Hosted appeal RPC was absent at audit; recheck before deployment planning.

## Implementation / work sequence

Complete supported password recovery/OAuth/confirmation controls and abuse/error paths, accurate security/session UX; role-scoped moderation/case/appeal/report handling, reason/audit/notice and restoration. Finish 15-day item Trash and deliberate permanent deletion only where contract supports it, account lifecycle coordination with S5/S9, cleanup dry-run/retention/runbook. Propose new backend support if a required session directory/linked-method operation is actually missing; do not show a cosmetic list. Keep operations separate from P3 advanced admin.

## Exit evidence

S13 role downgrade/ordinary-owner/anon/expiry/CAS, S6 UI cases, hosted mail/OAuth/operator outcomes only when executed. No impersonation, arbitrary author edits, purge execution or hosted migration without approval. Gate actual provider actions separately from implemented code.

## Required reads and dependencies

Read MASTER_PROMPT.md, LATEST_STATE.md, EXECUTION_PLAN.md, FILE_OWNERSHIP.csv, WORKFLOW_BACKLOG.csv, REQUIREMENT_LEDGER.csv, CONTRACT_QUEUE.csv and COORDINATION_PROTOCOL.md. Read every named source file you edit, its direct contracts/tests, the workflow/screen specification linked by the reference index and the relevant engineering/quality docs. Read S0/S15 and dependency logs before each handoff. Do not reread all 165 documents each cycle; verify updated applicable sources.

The following complete proposed path list is an ownership index, not an instruction to rewrite every file. Transfers need the three-way RELEASED/GRANT/ACK. Historical reference bytes are read-only. Unlisted future files require exact reservation. New shared exports/manifest changes go to S15, router/CSS changes to S14.

- `apps/frontend/src/auth.css`
- `apps/frontend/src/auth.tsx`
- `apps/frontend/src/operations.tsx`
- `packages/contracts/src/auth-service.ts`
- `packages/contracts/src/operations.ts`
- `packages/contracts/src/private-moderation-service.ts`
- `packages/contracts/src/private-trash-service.ts`
- `supabase/functions/purge-expired-trash/index.ts`

## Continue until the assigned capability is delivered

Implement and commit reviewable functionality, request independent tests, and report exact F/R/V evidence. While blocked on a contract or CI, take the next independent assigned capability. Do not repeatedly run unchanged full suites, wait silently for another chat, merge your own PR into integration/main, or change a leased foreign file. End with the exact resume/handoff status in COORDINATION_PROTOCOL.md.
