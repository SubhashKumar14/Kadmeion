# Shared Notion and task protocol

Use the existing coordination tree https://app.notion.com/p/41ab082297c78134b007f69c52bd5475; B16 activation page https://app.notion.com/p/41bb082297c781948335e8728d512fa9. This is the same project memory, not a new disconnected workspace. New S7–S15 logs are proposed until S0 creates and verifies them. S0–S6 retain existing logs.

## Ownership transfer (mandatory before conflicting writers)

1. Old owner checkpoints latest branch/PR and records RELEASED exact paths, final SHA, dirty/unpushed state and outstanding questions. It stops edits on released paths.
2. S0 records transfer ID and new owner, anchored to that exact SHA, in the ownership map. A previous owner’s silence is not release.
3. New owner fetches source, preserves it, ACKs and gets a branch based on accepted composition or declared dependency. Only then write.
4. S15 validates effective changed files before integration. Rejected foreign changes go back to their owner; never quietly overwrite.

S0→S15 integration lease is transferred first. S0 no longer pushes integration after ACK. S15 can ask product owners to fix code, but cannot seize their files or accept its own feature without independent review. If S15 session is lost, S0 must explicitly revoke/reissue the lease after verifying branch state; no second active integrator.

## Event schema

```text
RUN: 20261117-7232a31 / B16-v1
EVENT: CHANGE-B16-S03-001 (unique, never reused)
TIME: ISO timestamp + timezone
TASK / REQUIREMENTS: task + WF/UI/TC/TP/screen IDs
STATE: ACTIVE | BLOCKED_CONTRACT | BLOCKED_EXTERNAL | READY_FOR_QA | READY_FOR_INTEGRATION | INTEGRATED | ACCEPTED | DEFERRED_APPROVED
BASE / HEAD / PR: exact SHAs and URL
FILES: exact owned changed paths
F: observable new capability
R: demonstrated defect and correction
V: command/run; tested source + runner merge SHA; environment; pass/fail/skip
CONTRACTS / QUESTIONS: IDs; producer/consumer; resolved or pending
ACCEPTANCE: source / integration / isolated / hosted / manual separately
NEXT: one concrete independent task; resume required yes/no
```

## Questions and messages

Use QUESTION-B16-SNN-### in your own log, addressed to explicit recipients and linked from S0's queue. State the exact signature/decision needed, source SHA and proposed compatible behavior; distinguish a real blocker from optional improvement. Recipient answers in their own log, linking the original ID; S0 reconciles. Before shared schema changes, producer and consumer ACK exact version. No Notion write is a push notification or guarantee another chat wakes. User may paste `Resume your B16 assignment; read your latest log, S0/S15 state and questions addressed to you; preserve current work and continue your next unblocked task.`

## Normal active cadence

At start and each material checkpoint read relevant messages. Update own log after a capability, failed acceptance or ~30–45 minutes of active work. S0 batches ready reports roughly hourly while active; S15 integrates ready dependency batches rather than waiting for every worker. These are execution habits, not configured timers or automations. If a session yields, it needs another user message to resume.

## Missing resources and decisions

No repository/Notion access: state exactly what cannot be verified; do not invent branches or log writes. No current approved image: keep functional work moving and flag visual acceptance. No backend contract: implement independent pure UI against the documented proposed interface, never mark its live action complete. No owner response to a permission/budget/production decision: retain blocker; do not treat time as approval.

## Batch coordinator prompt

Read all latest B16 logs and live refs. Process new events since the last recorded checkpoint, including related dependencies. Preserve unfinished commits. Reconcile questions and sole-writer leases. Send dependency-ready exact SHAs to S15; do not merge yourself. For every session report integrated/accepted vs remaining, next concrete task, exact short resume message, and source-backed blocker. Re-read updates to verify they saved. No repeated unchanged audit loops.

## Session recovery prompt

Resume Session [number] for 20261117-7232a31/B16-v1 using https://app.notion.com/p/41bb082297c781948335e8728d512fa9. Read MASTER_PROMPT and your assignment, current S0/S15 state, your durable log and live branch. Treat earlier chat text as historical. Recover exact committed/unpushed state if accessible, ACK your active file leases, and continue the next unblocked task without recreating finished work. Never reset or take another worker’s file because a chat was lost.
