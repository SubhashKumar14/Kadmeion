# Kadmeion — Exhaustive Proposed Full-Stack Repository Structure

> **Planning-only, not application code.** Built from the 115 approved UI decisions, 52 screen specs, 53 workflow documents, and Kadmeion editor blueprint. Phase 1/2/3 distinctions are explicit; all unproven external technologies remain conditional.

**Every planned file (including code, backend, SQL, policies, tests, CI and documentation) is named in [FULL_REPOSITORY_FILE_TREE.txt](FULL_REPOSITORY_FILE_TREE.txt).** Each row of [FULL_REPOSITORY_FILE_MANIFEST.csv](FULL_REPOSITORY_FILE_MANIFEST.csv) provides a concrete file purpose, owning module, phase, and status. See [FILE_COUNT_REPORT.md](FILE_COUNT_REPORT.md) for exact auditable counts.

## Full stack, not frontend only

| Part | Owns | Security and boundaries |
| --- | --- | --- |
| Root + CI | Workspace dependency policies, CI scans, build/test budgets | No secrets committed; lockfile generated with approved versions |
| apps/web | Public, auth, workspace, editor, publishing, growth, settings and restricted admin UI | Client guards do not replace backend authorization; 52 mapped screen files |
| packages/contracts | Typed versioned data and command contracts | Untrusted input validated on both sides |
| packages/editor-core | Canonical readable file graph, one writer, EMPTY/S0/S1/S2 slots, stash, history, scoped tokens | No hidden duplicate source state or unsanctioned custom code rewriting |
| packages/builder-ui | Three-pane editor surface, accessible canvas/layers/inspector/source/history | No direct persistence mutation outside editor-core |
| packages/portfolio-kit | Five initial presets, eight sections, typed component implementations and variants | Catalogue extensible without hard-coded maximum |
| packages/publisher | Preflight, deterministic safe static HTML/CSS, metadata, manifest and ZIP export | No arbitrary untrusted JS on trusted public/app origin |
| packages/storage-adapters | IndexedDB, folder journal, cloud sync, portable archives | Browser storage best-effort; explicit local vs cloud save state |
| packages/shared-ui | Accessible shared control primitives | Public UI behavior and WCAG target, not claimed conformance |
| supabase/migrations | PostgreSQL schema, RLS and security-definer boundaries | No MongoDB/Mongoose; owner rights enforced in DB |
| supabase/functions | Server privileges, release, staging, moderation, erasure; Phase 2 sync and analytics | Supabase Edge Functions/RPC; **no independent Express business backend** |
| delivery | Adapter for independently available static public release storage/serving | Public URL, tombstones, cache invalidation, DB-off survival require live proof |
| tests | Unit, contract, hostile security, browser, accessibility, provider/spike tests | Planned suites only; not executed |
| scripts | File cap, ZIP/hash integrity and documentation mapping | No production changes without approval |
| docs, sources, assets, registers | Existing 115 decisions, 52 screen specs, 53 workflows and capstone planning files | Documents and visual references exist; they are **not working app code** |


## Screen coverage and workflows

- [Screen-to-source one-to-one index](SCREEN_TO_SOURCE_MAP.csv) has exactly 52 row mappings, including the nine editor panels.
- The application also has shared shells, actions, typed contracts, service/db adapters and test suites. This is why counting `.tsx` views alone would understate the project.
- The existing [eight workflow group documents](docs/03_workflows/README.md) cover 53 individual flows, from sign-in through admin appeals.
- Phase 1: authenticating, creating identity/projects, editor, releases, export, narrow privileged operations; Phase 2: public-handle sync and private growth; Phase 3: optional AI, with advanced admin dashboards requiring separately approved additional files if needed.

## Contracts and architectural choices

1. The only permitted business backend is Supabase Auth + PostgreSQL/RLS + Storage + Edge/RPC. `delivery/` is a public static-delivery abstraction, **not** a second business account/database backend.
2. Brevo was owner-selected for transactional email. SMTP configuration is **external** to this repository; only environment names and provider constraints are documented. No SMTP secret belongs in the browser.
3. Public project live links are URLs; no repository source imports, except users optionally exporting their own portfolio project files.
4. The optional website screenshot capture function remains a **conditional disabled module** until SSRF controls, legal permissions and zero recurring costs pass real tests.
5. Free public API availability for GitHub, LeetCode, Codeforces, HackerRank, Kaggle and Hugging Face is **not guaranteed**; Phase 2 handle-sync must degrade to manual links when unavailable.
6. The public portfolio release may not safely execute arbitrary user-owned JavaScript. Until isolated origin policy is proven, use allowed static output or full-source export, as approved.
7. No guest portfolio authoring, no mobile-phone portfolio/source editing. Qualifying tablets require viewport, browser and keyboard capability tests.
8. Portfolio/profile/project/visitor analytics visibility is private or disabled until a specifically approved exposure or opt-in.

## Honest file count and file ceiling

See the [revised file-count policy](FILE_COUNT_REPORT.md). The app-only tree and manifest contain **200 proposed source/config/test files**, and **no documentation files are included in that count**. The former mixed 333-path total is archived as superseded. These source files are not implemented by this documentation task.

## Reconciliation with v1

`PROPOSED_FUTURE_REPOSITORY_TREE.txt` now contains the same exhaustive tree. The older abbreviated tree embedded in [PROPOSED_REPOSITORY_STRUCTURE.md](docs/04_engineering/PROPOSED_REPOSITORY_STRUCTURE.md) is retained for context only; that file warns that its embedded tree is abbreviated and directs readers here.
