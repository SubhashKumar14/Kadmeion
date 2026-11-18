# Kadmeion — Session 0 Coordination / READY_FOR_WORKERS
Date 2026-11-17 (Asia/Kolkata). Run ID `20261117-7232a31`.

**READY_FOR_WORKERS** — isolated branches and owned Notion logs exist. A worker can act only in the listed ownership scope; these sessions have NOT been independently started. Baseline `7232a312c821459e6d88ba400eed6a391738c979`, base tree `398c145718da8dbb8b6f43695a399c54f8b6b389`. Sole integration branch `feat/b0-backend-foundation`. Before applying anything re-fetch the branch head and relevant logs; do not assume this checkpoint is still current.

## Canonical coordination
[Run dashboard](https://app.notion.com/p/41ab082297c78134b007f69c52bd5475) · [Execution ledger](https://app.notion.com/p/419b082297c781db810cd756ec0343eb).
- Session 0 owned Notion log: https://app.notion.com/p/41ab082297c78147a3bee76433f1f63b
- Session 1 owned Notion log: https://app.notion.com/p/41ab082297c781048ae8e1aed99469a1
- Session 2 owned Notion log: https://app.notion.com/p/41ab082297c781309dc4e1d6ea63acf4
- Session 3 owned Notion log: https://app.notion.com/p/41ab082297c78182ba7bdf09cf96da89
- Session 4 owned Notion log: https://app.notion.com/p/41ab082297c7819c9a51f338d94fe9f2
- Session 5 owned Notion log: https://app.notion.com/p/41ab082297c781faa41fe270adf4c7ec
- Session 6 owned Notion log: https://app.notion.com/p/41ab082297c781d2a861ca24be8bc5a5

## Verified worker branches
- Session 1: `work/20261117-7232a31/s1-contracts` — [branch](https://github.com/SubhashKumar14/Kadmeion/tree/work/20261117-7232a31/s1-contracts)
- Session 2: `work/20261117-7232a31/s2-public-workspace` — [branch](https://github.com/SubhashKumar14/Kadmeion/tree/work/20261117-7232a31/s2-public-workspace)
- Session 3: `work/20261117-7232a31/s3-editor` — [branch](https://github.com/SubhashKumar14/Kadmeion/tree/work/20261117-7232a31/s3-editor)
- Session 4: `work/20261117-7232a31/s4-release` — [branch](https://github.com/SubhashKumar14/Kadmeion/tree/work/20261117-7232a31/s4-release)
- Session 5: `work/20261117-7232a31/s5-account-growth` — [branch](https://github.com/SubhashKumar14/Kadmeion/tree/work/20261117-7232a31/s5-account-growth)
- Session 6: `work/20261117-7232a31/s6-acceptance` — [branch](https://github.com/SubhashKumar14/Kadmeion/tree/work/20261117-7232a31/s6-acceptance)

## Exact inventory / ownership
`project-docs/registers/SESSION0_SOURCE_AND_DOCUMENT_INVENTORY_2026-11-17.csv` enumerates **all 425 tracked baseline files**, plus its own and the two coordination files (428 total after this commit), with a sole writer, reader assignment and review state. Of the baseline files 160 are under `project-docs/`, including 52 exact screen specifications, 15 capstone documents, 8 originals/historical files, and 5 reference/reference-derived assets. The current tree contains 425 files; file additions are doc-only and excluded from the original application source file budget. Binary references require actual inspection and approval proof.

**Source owner counts in this inventory (including new documents):** S0=202; S1=97; S5=9; S6=91; S2=5; S3=14; S4=10. Every file is assigned. For new files proposed later, S0 must assign a sole writer before the first edit.

**S0 exclusively owns:** `apps/frontend/src/main.tsx`, `workspace.tsx`, `behavior.ts`, `styles.css`, `workspace.css`; common shell/router/theme; all package manifests/lockfiles; configuration/CI/deployment; shared `scripts/`; app's public/brand assets; central evidence registers; `project-docs/` status, handoff and document ownership. S0 is also sole author of cross-worker integration commits.

**S1:** `packages/contracts/src/`, `apps/auth-web/src/supabase-auth-port.ts` and `auth-redirect.ts`, `api/`, `supabase/migrations/` and `supabase/functions/`; non-editor/non-release service adapters as enumerated in inventory.
**S2:** `landing.tsx`, `explore.tsx`, `templates.tsx`, `profile.tsx`, `projects.tsx`.
**S3:** both `portfolios.tsx` and `portfolio-tools.tsx` (including all library/chooser code); `packages/editor-core/src/`; editor/draft storage adapters.
**S4:** `release.tsx` and release/delivery-specific storage adapters; requests API/migration changes from S1.
**S5:** `auth.tsx`, `auth.css`, `growth.tsx`, `settings.tsx`, `operations.tsx`, auth-web UI helpers and CSS.
**S6:** `apps/frontend/e2e/`, `tests/`, `supabase/tests/`, `behavior.test.ts`. S6 produces evidence proposals; S0 writes shared registers.

## Document reading obligations
Each session must read **all shared governing** documents including all five `docs/00_governance` and five `docs/01_product` files, `docs/02_design/SCREEN_CATALOG.md`, `docs/05_quality/RELEASE_ACCEPTANCE_CRITERIA.md` and the five governing `project-docs/` masters. **All 52 screens** are individually reader-assigned by exact file path in inventory; workflows, engineering and quality specs are reader-assigned likewise. `docs/06_capstone/` contains 15 files: S6 reads DEMONSTRATION, DELIVERY, REQUIREMENTS, RISK and SUBMISSION; S0 handles remaining capstone scope review. Historical sources are not approvals. All asset paths require actual provenance checks; filename and old Notion sandbox aliases are insufficient. Re-scan `git ls-files project-docs` on resumption.

## Initial dependency queue
1. **TASK-1-001 (S1):** freeze source-backed API/RPC/Edge adapter map; supply real input, output, bearer, role, 400/401/403/409/429 paths, persisted readbacks, source migration and existing hosted proof. Begin with `supabase-auth-port.ts`, contracts package, `api/`, `supabase/functions/`, `supabase/migrations/`; coordinate test contracts with S6.
2. **TASK-2-001 (S2):** seven-section landing order Hero → Social proof → Problem → Solution/value → How it works → FAQ → CTA, responsive fit and honest demo data. Runs independently of backend mutation. **TASK-2-002:** verify Explore/Templates/Profile/Projects; request S3 (not direct edit) for portfolio chooser changes.
3. **TASK-3-001 (S3):** existing editor Save→Reload/Undo/conflict/stale-tab/preview, owned slots, source buffer persistence and viewport, private library/chooser; consume S1 stable contract only. Do not claim completed static hosting.
4. **TASK-4-001 (S4):** reviewer staging, release preflight, source/export/download, rollback, direct-media denial/revocation; independently test UI guard and private preflight while external host proof remains blocked. Ask S1 for service fixes.
5. **TASK-5-001 (S5):** immediate password signup, OAuth/recovery, Settings/Trash/Exit, Growth/Goals, role-limited Ops; distinguish provider and hosted proof gaps.
6. **TASK-6-001 (S6):** reconcile 52 screen IDs, 53 workflows, 138 UAT cases, 20 proofs, 90 backend decisions and 115 UI decisions; source vs automated vs hosted vs human acceptance. Actual browser zoom/AT/device testing remains separate from axe.
7. **TASK-0-002 (S0):** receive shell/router/theme/CSS requests, assess consumer impact of `landing.tsx` and `portfolio-tools.tsx` exports, merge small dependency-ready commits, run full integrated checks. S0 never changes worker-owned modules without explicit reassignment.

## Canonical backend inventory
[Frontend/Backend contract inventory](registers/FRONTEND_BACKEND_CONTRACT_INVENTORY_2026-11-17.md) begins from inspected auth-port source, not synthetic API success. **UNASSESSED** means a row is not yet classified; S1 must assign only VERIFIED_EXISTING, EXISTS_UNWIRED, CONTRACT_GAP, DEPLOYMENT_GAP, EXTERNAL_PROOF_REQUIRED or DEFERRED_APPROVED after tracing each actual operation.

## Questions, branch safety and integration
Stable IDs TASK-N-N, QUESTION-N-N, CHANGE-N-N, EVIDENCE-N-N. Each worker writes to their own Notion log, includes base/head SHA, exact file changes, reproducible commands/results and dependency. A worker submits a pushed coherent commit for review; S0 checks base, ownership, interface contracts, affected consumers and cross-branch imports. No worker force-pushes the integration branch. Notion pages are durable logs, not transaction locks or auto-running agents. S0 alone updates merge queue, consolidated decisions and shared evidence. New code does NOT authorize main, production deployment, schema mutation of hosted data, public route or destructive scheduled jobs.

## Evidence and reconciliation
Historical source `3d25001544de287f355281e7c4456f655166a936` passed 22 public and 8 owner Chromium scenarios and 511 DB assertions; at baseline handoff 121 axe samples across all 52 IDs have 0 automated violations but 49 contextual review items. UAT: only 36/138 mapped across 26/53 workflows (12 isolated-pass, 24 partial). These are historical exact-SHA claims, **not new tests executed here**. No completion percentage. The 263 versus 200 authored-file variance remains unresolved and is not hidden by this documentation-only commit.

## Risks and stop rules
Real provider mail/OAuth, trusted starter bytes, independent static host and revocation, physical erasure, AT review, native zoom and device verification need independent proof. The approved 12-page Canva brand assets require actual provenance and suitable use; the old 52-image Notion page contains ephemeral sandbox references; consult exact archived approved bytes/checksums. If a runtime/spec conflict is discovered, preserve owner supersession and publish the precise conflict, resolution authority and test impact rather than silently changing product behavior.
