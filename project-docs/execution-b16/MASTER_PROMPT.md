# Shared master prompt — Kadmeion 16-session completion run

You are one of sixteen separately launched sessions, S0–S15, in run 20261117-7232a31, coordination revision B16-v1. This supplements the existing run; do not restart the project, erase older evidence or create competing integration histories. Read your SESSION_XX prompt after this master.

Repository: https://github.com/SubhashKumar14/Kadmeion
Existing shared Notion coordination: https://app.notion.com/p/41ab082297c78134b007f69c52bd5475
B16 plan and activation record: https://app.notion.com/p/41bb082297c781948335e8728d512fa9
Last reviewed integration: feat/b0-backend-foundation @ 7d03713fbbef4f02215d38b28932ad3952adefad. Current main: ead5455faa2cd0d7f4aba87384215175fbe13aa0. Re-fetch live refs before acting; the local mirror lagged live GitHub in the planning review. The recorded SHA is a checkpoint, not permission to reset a newer branch.

## Objective and completion truth

Implement every approved in-scope P1 and P2 behavior from the governing documents, owner decisions and audit. Target 24 elapsed hours after S0 records T0. This is a stretch execution window, not a guarantee or permission to omit requirements. P3 optional AI/advanced administration remains explicitly deferred unless separately approved. Never count unavailable panels, mocked datasets, a route existing, or green unrelated tests as completed successful functionality. Existing supported fallbacks remain honest without being marked full capability.

Do real implementation, repairs and focused validation. Report F (new functionality), R (repairs), V (verification/docs) separately. Do not spend the day repeatedly auditing unchanged green code. Inspect first; preserve newly completed work listed in LATEST_STATE.md. If a feature is already implemented, validate the gap and move to the next missing behavior. Backend first means verify/reuse the actual contract, then wire the UI; it does not mean every UI worker waits for one backend worker. Develop independent pure components and typed integrations against an agreed interface, but keep them unaccepted until real persistence and authorization are tested.

## Authority and required references

Read current project-docs/MASTER_EXECUTION_PROMPT.md, FRONTEND_UIUX_BRAND_MASTER_EXECUTION_2026-11-15.md, NEXT_SESSION_HANDOFF.md, docs/00_governance/AUTHORITY_AND_SUPERSESSION.md, PRODUCT_SCOPE_AND_PHASES.md, CONFLICT_REGISTER.md, docs/01_product/PRODUCT_REQUIREMENTS_PRD.md, SOFTWARE_REQUIREMENTS_SPECIFICATION_SRS.md, NONFUNCTIONAL_REQUIREMENTS.md, docs/05_quality/RELEASE_ACCEPTANCE_CRITERIA.md and TECHNICAL_VERIFICATION_GATES.md. Prefix abbreviated sibling names with their immediately preceding directory. Read your assigned workflow specifications, screen specifications, relevant engineering docs and exact UI/D/TC/TP rows. DOCUMENT_REFERENCE_INDEX.md lists every tracked project-docs path; FILE_OWNERSHIP.csv lists every known repository path. Proposed future apps/web filenames are not current missing-source proof: current UI is apps/frontend.

Read the current B16 execution kit, latest Notion S0/S15 and dependency logs, and live branch/PR source. Original approvals: https://app.notion.com/p/416b082297c781b2b6b1ec116ab4bb9e and LIGHT designs https://app.notion.com/p/417b082297c781c49168c54b656d9cca. Prior ChatGPT excerpts are contextual evidence, not a complete accessible archive. Do not invent missing approvals. Explicit current owner decisions supersede older contradictory notes; resolve unclear material conflicts through S0 with exact source links.

Preserve Kadmeion branding, five initial presets + Blank/eight layouts, private defaults, no GitHub hard block, immediate password signup exemption, 15-day item Trash, ₹0 recurring constraint, supported desktop/qualified-tablet authoring and phone preview only. Use only verified approved visual sources; no new dark mockup set, while runtime light/dark remains required. No arbitrary public JS, unapproved scraping, fake metrics, paid upgrade or privacy-gate bypass. Do not promise all JWTs/backups/CDNs disappear on sign-out/deletion.

## Activation and ownership

This plan is PREPARED until S0 publishes B16_ACTIVE with exact handoff SHAs and S15 acknowledges the integration lease. Existing S1–S6 must checkpoint their latest changes first. S0 must stop being integration writer before S15 becomes writer. S7/S10/S13 and all transferred paths are read-only until the old owner records RELEASED(path, SHA), S0 grants the new lease, and the new owner ACKs. A timer or stale log does not revoke a lease. Notion is not an atomic lock service.

One file has one writer at a time. Consult FILE_OWNERSHIP.csv plus newer approved lease events. No glob overrides an explicit file lease. New files require S0 allocation of exact path, owner and file-budget treatment before writing. Do not edit shared router/CSS/manifests/barrels/CI or another worker's monolithic file. Send an interface request; the sole owner wires it. Do not split monoliths just to add workers; prefer a sequential lease transfer or a small independently testable module when justified. Migrations already deployed are immutable. New migrations use unique reserved names; do not have two workers amend the same unapplied migration.

S0 owns scope, priorities, ownership/decision/task ledgers and capstone reconciliation. S15 alone owns the integration candidate, existing integration branch and final main PR, plus CI/manifests/configuration and release manifest. S14 owns shared application shell/CSS after handoff. Product owners own code, S6/S13 own independent acceptance files; S14 may own designated visual checks but cannot independently sign off its own changes.

## Working and communicating

Keep your existing branch if you are S1–S6; preserve unmerged commits. New sessions branch from S15's announced accepted base, proposed name work/20261117-7232a31/sNN-b16-topic. Separate worktrees/directories and per-worker ports/test databases; never share a mutable checkout. Do not force-push, reset remote work, overwrite foreign blobs or merge verification-only PRs #26/#27 wholesale. Normal non-force merges and reviewed conflict resolution preserve provenance. S15 may stage approved dependent commits together before accepting them.

At task start, before changing a shared contract, before opening/updating a PR, and before yielding: read the coordinator, your log and relevant dependency responses. While actively running, checkpoint after a capability or about every 30–45 minutes; do not create artificial no-op commits. Notion does not wake chats and chats do not keep running after yielding. The user launches/resumes sessions; never claim background agents are active without evidence. Do not sleep-poll when independent work is ready.

Use your existing Notion log for S0–S6; S0 creates linked logs for S7–S15 under the same coordination tree on activation. Append events, never rewrite another worker's log or replace the shared dashboard. Every event has run/revision/session/task/event ID, timestamp with timezone, exact base/head, owned files, requirement IDs, F/R/V, actual tests/environment, blockers, next action. S0 alone reconciles shared status; S15 alone updates release provenance. Logs are not completion evidence by themselves.

Question format: QUESTION-B16-SNN-###; target session(s); exact blocker; contract/signature/behavior proposed; source evidence; affected files/IDs; safe independent next task. The addressee answers in its own log referencing the question; S0 links both. No-answer is not approval. Surface unresolved critical dependencies promptly; S0 routes them at the next active checkpoint. See COORDINATION_PROTOCOL.md.

## Contracts, tests and acceptance

Before connecting a UI action, record concrete browser method → service/RPC/HTTP/Edge → migration/RLS/storage boundary → input/output/error taxonomy → ownership/epoch → CAS/idempotency → limits → source SHA → local/hosted evidence. Reuse existing services; add backward-compatible methods only where required. Never invent an endpoint from a desired UI. Stable operation IDs preserve exact retry input; conflicts require explicit recovery, not automatic stale overwrite. Local IDs and browser journals are hints, never identity authority.

Deliver one reviewable capability at a time. Run relevant type/build checks and focused behavioral tests; full suites belong to meaningful integrated checkpoints. Test successful persistence/reload plus failure/retry, quota, cross-owner/anonymous denial, stale responses and source/byte integrity as applicable. No assertion weakening, quarantining a failing critical test or fixture success on absent APIs. Feature-gated tests must become mandatory in the combined candidate. Required new-feature checks cannot be skipped because the dependency was absent from a standalone branch.

Track independently: source implemented; merged into integration; isolated tests; hosted validation; manual/visual acceptance. PASS must cite tested source head, actual runner merge/base if applicable, command/run, cases, environment and result. Preserve failures and supersession. Sanitized diagnostics only: no tokens, raw traces, headers, query strings or user bytes in evidence. Retrieve relevant approved references before visual claims. A CI PR head often tests a synthetic merge tree; record that tree rather than assuming head alone.

## Release and one-day safeguards

Use ONE designated candidate line and ONE final integration→main PR. All worker PRs target integration, not main. S15 inventories all known refs/PRs and records every unique commit as included, superseded with equivalent patch proof, or explicitly excluded with reason. No 'merge every branch'. S15 retains original refs and audit evidence through final acceptance. Close obsolete verification PRs only after equivalence and retained receipts are recorded; do not delete branches during this run.

Code completion, hosted release and final main merge are distinct gates. Existing run forbids main/production mutation; this planning request does not itself authorize merging an unspecified future SHA or changing a hosted system. S15 prepares the exact tested main PR and scope manifest, checks existing current authorization, and requests only any still-required concrete final approval. Do not ask repeatedly for already-authorized reversible work. No public activation, production migrations, cleanup execution or spending without applicable authorization and prerequisites. A draft PR and isolated tests are allowed.

At H16 evaluate remaining critical path; at H20 freeze new feature admissions and stabilize. If mandatory scope is missing, continue to fix within the window and publish the exact residual backlog at H24. Never relabel incomplete work DONE to meet the clock. A partial accepted release must be labeled partial and requires owner scope decision; it cannot satisfy the full-project finish claim. Do not silently defer P2 merely because P1 ran late.

## End-of-turn handoff

Report: session/task IDs; implemented F and repaired R; exact branch/head/PR and changed files; tests passed/failed/skipped with environment and tested tree; contract questions/dependencies; feature/integration/hosted/manual states; next actionable task; whether another session must resume and its short message. If all owned work is accepted, ask S0 for a new unowned task or independent verification slice; never take a foreign file. Continue implementation during unblocked time rather than stopping at a report.
