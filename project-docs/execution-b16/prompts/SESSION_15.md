# Session 15 — Release integrator and main custodian

Paste MASTER_PROMPT.md first (or attach the complete kit), then this assignment. Do not operate from this assignment alone without current authority/ownership.

Run: 20261117-7232a31 / B16-v1. Shared plan: https://app.notion.com/p/41bb082297c781948335e8728d512fa9
Branch: S15-designated candidate/integration
Log: S0 creates and links your own B16 log under the existing coordination tree before writes.
Primary workflow leads: Cross-cutting acceptance/integration; exact scope in requirements ledger.
Mission: Sole candidate/integration/main writer after recorded handoff; preserve all work, resolve provenance, test combined tree, prepare one final main PR.

## First actions

Do not write integration until S0 records RELEASED and you ACK. Inventory live 12 branches, all PRs including known #9/#20/#21/#24/#25/#26/#27/#28, unique commits and current integration/main ancestry. Prefer live API over stale mirror. Preserve existing worker PRs. Build RELEASE_MANIFEST.csv and INTEGRATION_QUEUE.csv from exact reviewed SHAs.

## Implementation / work sequence

Own one work/20261117-7232a31/b16-candidate line, integration feat/b0-backend-foundation and final main PR. First combine known dependency groups: S4+S6 fixture, S1+S2+S13 thumbnail, S3+S14 owner context, S5 account features; resolve budget transparently. Incorporate owner-approved docs/CI/config and newer features in topological batches. Run exact combined checks; stop superseding in-flight runs for trivial updates. Resolve conflicts with owners, never ours/theirs wholesale. Keep original branches and commit/patch equivalence, not just a pretty final tree.

## Exit evidence

Follow MERGE_AND_RELEASE_RUNBOOK.md. One final integration→main PR with full scope/requirement ledger, source+test+runner hashes, migrations/flags/hosted status and rollback. Recheck main/base and approvals immediately before merge. Prepare concrete approval request if required; do not merge unspecified future code. After an authorized merge verify resulting main tree/CI and report actual release/deployment separately. No success if any unique work disappeared or mandatory feature is missing.

## Required reads and dependencies

Read MASTER_PROMPT.md, LATEST_STATE.md, EXECUTION_PLAN.md, FILE_OWNERSHIP.csv, WORKFLOW_BACKLOG.csv, REQUIREMENT_LEDGER.csv, CONTRACT_QUEUE.csv and COORDINATION_PROTOCOL.md. Read every named source file you edit, its direct contracts/tests, the workflow/screen specification linked by the reference index and the relevant engineering/quality docs. Read S0/S15 and dependency logs before each handoff. Do not reread all 165 documents each cycle; verify updated applicable sources.

The following complete proposed path list is an ownership index, not an instruction to rewrite every file. Transfers need the three-way RELEASED/GRANT/ACK. Historical reference bytes are read-only. Unlisted future files require exact reservation. New shared exports/manifest changes go to S15, router/CSS changes to S14.

- `.env.example`
- `.github/workflows/ci.yml`
- `.github/workflows/frontend.yml`
- `.github/workflows/trash-expiry.yml`
- `.gitignore`
- `.nvmrc`
- `README.md`
- `apps/frontend/index.html`
- `apps/frontend/package-lock.json`
- `apps/frontend/package.json`
- `apps/frontend/playwright.config.ts`
- `apps/frontend/tsconfig.json`
- `apps/frontend/vite.config.ts`
- `package-lock.json`
- `package.json`
- `packages/contracts/package.json`
- `packages/contracts/src/index.ts`
- `packages/editor-core/package.json`
- `packages/editor-core/src/index.ts`
- `packages/storage-adapters/package.json`
- `packages/storage-adapters/src/index.ts`
- `scripts/audit-public-bundle.mjs`
- `scripts/check-file-budget.mjs`
- `scripts/prepare-auth-preview.mjs`
- `scripts/publish-unlisted.mjs`
- `scripts/smoke-auth-server.mjs`
- `scripts/verify-approved-light-references.mjs`
- `scripts/verify-auth-preview.mjs`
- `scripts/verify-backend-traceability.mjs`
- `scripts/verify-host-revocation.mjs`
- `supabase/config.toml`
- `tsconfig.json`
- `vercel.json`

## Continue until the assigned capability is delivered

Implement and commit reviewable functionality, request independent tests, and report exact F/R/V evidence. While blocked on a contract or CI, take the next independent assigned capability. Do not repeatedly run unchanged full suites, wait silently for another chat, merge your own PR into integration/main, or change a leased foreign file. End with the exact resume/handoff status in COORDINATION_PROTOCOL.md.
