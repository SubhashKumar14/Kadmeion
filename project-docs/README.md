# Kadmeion — Complete Capstone Design and Documentation Package

> **Current implementation differs from this historical 12-Nov planning snapshot.** See [current backend evidence and unresolved gates](BACKEND_CURRENT_STATUS.md) and [chronological implementation changes](IMPLEMENTATION_STATUS.md). "NOT IMPLEMENTED" labels below describe the document creation date, not today's feature branch.


> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

**Date:** 2026-11-12 · **Owner decisions recorded:** 115 (`UI-001`–`UI-115`) · **Screens/panels:** 52 · **Detailed end-to-end workflows:** 53 · **Planned tests:** 138 (`NOT_RUN`) · **Technical proofs:** 20 (unproven/not run).

## Start here

1. **[Master `design.md`](design.md)** — approved brand, motion, navigation, editor, themes, responsive, privacy and release contracts.
2. **[Full screen catalog](docs/02_design/SCREEN_CATALOG.md)** — every page/panel from sign-in to administration, with individual state and accessibility specs in `docs/02_design/screens/`.
3. **[Feature workflow catalogue](docs/03_workflows/README.md)** — 53 ordered success/failure workflows from auth through owner data, public pages, safe code editing, publishing and restricted admin.
4. **[Application-only full-stack source file tree](FULL_REPOSITORY_FILE_TREE.txt)**, [per-file manifest](FULL_REPOSITORY_FILE_MANIFEST.csv), [exact file counts](FILE_COUNT_REPORT.md), [52 screen→source mappings](SCREEN_TO_SOURCE_MAP.csv), and [structure rationale](FULL_REPOSITORY_STRUCTURE.md). **All application code files are proposed names only; no application source repo was created.**
5. **[PRD](docs/01_product/PRODUCT_REQUIREMENTS_PRD.md)**, **[SRS](docs/01_product/SOFTWARE_REQUIREMENTS_SPECIFICATION_SRS.md)**, [Use cases](docs/01_product/USE_CASE_CATALOG.md), [Information architecture](docs/01_product/INFORMATION_ARCHITECTURE.md).
6. Engineering: [System architecture](docs/04_engineering/SYSTEM_ARCHITECTURE.md), [Editor core](docs/04_engineering/EDITOR_CORE_AND_FILE_CONTRACT.md), [Data/RLS](docs/04_engineering/DATA_MODEL_RLS_AND_STORAGE.md), [API and events](docs/04_engineering/API_COMMANDS_EVENTS_AND_ERRORS.md), [Release host](docs/04_engineering/STATIC_RELEASE_HOSTING_AND_EXPORT.md), [Security](docs/04_engineering/SECURITY_AND_PRIVACY.md), [Costs](docs/04_engineering/COST_OPERATIONS_AND_DEPLOYMENT.md).
7. Quality: [Test plan](docs/05_quality/TEST_STRATEGY_AND_PLAN.md), [138 planned test cases](registers/TEST_CASES.csv), [Accessibility](docs/05_quality/ACCESSIBILITY_RESPONSIVE_TEST_PLAN.md), [Design QA](docs/05_quality/DESIGN_REVIEW_CHECKLIST.md), [20 proof gates](registers/TECHNICAL_PROOFS.csv).
8. Capstone: [Charter](docs/06_capstone/PROJECT_CHARTER_AND_PROPOSAL.md), [Abstract](docs/06_capstone/ABSTRACT_AND_PROBLEM_FORMULATION.md), [Feasibility](docs/06_capstone/FEASIBILITY_STUDY.md), [Capstone 8-chapter report planning draft](docs/06_capstone/CAPSTONE_REPORT_DRAFT.md), [Mermaid/UML models](docs/06_capstone/DIAGRAMS_AND_MODELS.md), [Presentation](docs/06_capstone/PRESENTATION_OUTLINE.md), [Viva](docs/06_capstone/VIVA_QUESTIONS_AND_RESPONSES.md), [References](docs/06_capstone/RESEARCH_AND_REFERENCES.md), [Delivery plan](docs/06_capstone/DELIVERY_PLAN.md).
9. Governance: [Decision authority](docs/00_governance/AUTHORITY_AND_SUPERSESSION.md), [Conflict matrix](docs/00_governance/CONFLICT_REGISTER.md), [115 decisions CSV](registers/DECISIONS_UI_001_115.csv), [Decision→screens/workflows](registers/FEATURE_TRACEABILITY.csv), [technical proof/status](docs/05_quality/TECHNICAL_VERIFICATION_GATES.md).

## What this package actually delivers

It creates editable Markdown specifications, a proposed code repository tree, machine-readable trace/test registers, diagrams and capstone report/project management drafts. It archives a few prior source documents and visual references **unmodified** for provenance. It does **not** build code, change the user's GitHub/Notion sources, set up Supabase/Brevo, run application tests, deploy anything or establish that features are implemented.

## Governing constraints and phase order

- Brand name Kadmeion, tagline Build · Showcase · Evolve; original K, selected Aether Drift C and sparse user-approved geometric pattern; exact production font families remain unverified.
- Supabase Auth/Postgres/RLS/Storage/Edge/RPC, strict ₹0 recurring, no MongoDB/Express backend, selected but unconfigured Brevo SMTP.
- Phase 1: auth, identity, project links/case studies, editor, static publishing/export, user/portfolio admin. Phase 2: permitted public platform data, private DevScore/goals and opt-in aggregate analytics. Phase 3: optional AI and expanded admin analytics.
- Initial five presets **not an upper bound**, eight section layouts, protected source slots, one transactional writer; no guest authoring and no phone portfolio/source editing.
- Public profile/project private by default; `/u/:handle` and `/u/:handle/projects/:slug` approved. Independent public portfolio URL host/availability unverified. Unpublish/JS isolation remain P0 proof gates.

## Navigation and version integrity

`DOCUMENTATION_FILE_TREE.txt` lists the actual documentation package. `PROPOSED_FUTURE_REPOSITORY_TREE.txt` lists **suggested code files that are not created**. `registers/MANIFEST_SHA256.csv` (generated in the final packaging pass) provides cryptographic hashes for every included file other than the manifest itself. All source/provenance image files are reference-only, and the decision record remains at [Notion]([private Notion decision record — not publicly linked]).

## Complete full-stack repository inventory (v2 addition)

The v3 file tree enumerates **exactly 200 proposed source/config/test files**, including the web application, editor engine, Supabase migrations/Edge Functions, publishing, tests and CI. Documentation, including this file and the full capstone package, does **not** count toward application files; the former mixed 333-file count is superseded. The repository is not implemented. See `FULL_REPOSITORY_STRUCTURE.md` and `FILE_COUNT_REPORT.md`. This documentation package **does not** contain implemented source code.

## New-session and repository handoff (v3)

- **[Next-session implementation instructions](NEXT_SESSION_HANDOFF.md)**: authoritative backend-first continuation prompt and implementation gates.
- **[Application file-count policy](FILE_COUNT_REPORT.md)**: documentation files expressly excluded.
- Full source planning tree and CSV list **only app files**. Historical v2 mixed counting is retained in `sources/` solely for provenance.
- In the public GitHub repository, the documentation mirrors this package under `project-docs/`. Never treat that mirrored folder as application source or count it against the application-file target.
