# Kadmeion — Capstone Project Report: Source-Grounded Planning Draft

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

**Important academic integrity notice:** This draft is based on the approved design and editor specification, not a finished app. It therefore uses *proposes/will* instead of *implemented/tested/deployed*. Do not submit as a completed system report without updating implementation results, actual screenshots, actual tests, institutional author fields and verified references. Front-matter names/institution/guide need author confirmation.

## Suggested preliminary pages (institution format to confirm)

Title page → Certificate (signed only if genuine) → Declaration (author-confirmed original work) → Acknowledgement → Abstract → Table of Contents → List of Figures → List of Tables → Abbreviations → Chapters 1–8 → References → Appendices. Academic format, margins, faculty and student ID should follow the current department requirements instead of automatically reusing another project's front matter.

# CHAPTER 1 — INTRODUCTION

### 1.1 Background

A developer portfolio is both an identity document and a record of practical engineering work. A credible showcase requires more than project-name badges: visitors need to understand the developer's contribution, challenge, technical approach, artifacts and independently reachable demonstration/source links. A builder must also allow meaningful visual expression, accessibility and safe publication without requiring all users to master raw web deployment. Existing patterns often separate no-code convenience from advanced source ownership.

### 1.2 Problem statement

The design problem is to develop a privacy-first, accessible system in which a developer can compose distinctive portfolios using typed reusable sections and optionally customize source code, while retaining control of data and avoiding accidental overwrites. Public publication must remain intentional, source-accurate, SEO-friendly and recoverable. Other constraints include strict zero-recurring-cost services, strong cross-account isolation, and honest optional public developer-statistic availability.

### 1.3 Objectives

Create a versioned project format and one guarded edit pipeline; support initial curated presets, expandable catalogue and blank start; preserve code and content in EMPTY/S0/S1/S2 slot states; support private projects, external links, folder-style media previews; provide safe Author/Published Preview, staging, immutable release and rollback; test privacy/RLS, no privileged custom JS, static export, accessible keyboard workflows, and honest provider fallback. Later design private growth analytics with explainable coverage.

### 1.4 Scope

Phase 1 covers authentication, developer identity, projects/case studies, portfolio authoring/export/publishing and restricted moderation. Phase 2 covers optional public-handle retrieval, DevScore/goals and opt-in aggregated analytics. Phase 3 covers optional AI and advanced admin insights. The scope explicitly excludes guest authoring, phone portfolio/code editing, mandatory repository importing, public developer leaderboards, arbitrary public authored JavaScript and unapproved paid APIs.

### 1.5 Feasibility overview

Client UI/structured editing and portable static export are within conventional modern browser/TypeScript capabilities, pending integration and security tests. The main high-risk unknowns are secure JS isolation, truly free sender-domain delivery, host-independent static route resolution, immediate public revocation and provider data terms. These are treated as preconditions, not established achievements.

# CHAPTER 2 — REQUIREMENTS SPECIFICATION

### 2.1 Stakeholders and functional requirements

Actors: Guest, Developer, Reviewer Token Holder and Restricted Operator. The developer can own private profiles, projects, portfolios, source, releases and later private growth; visitors only see approved public projections; reviewer links grant pinned read-only stage; admins perform narrow documented exceptional actions. The product requirements FR-01–FR-17 are enumerated in `PRODUCT_REQUIREMENTS_PRD.md`, with owner decisions UI-001–115 recorded separately.

### 2.2 Functional modules

Authentication and recovery; onboarding and identity; manual/link-based project management; template selection and slot editor; component and owned-source management; responsive theme/asset controls; preview/staging/publishing; revision history and export; privacy/trash/settings; narrow user management/moderation; later growth/provider integration/analytics and optional AI. The complete feature-by-feature acceptance workflows appear in the `03_workflows/` directory.

### 2.3 Nonfunctional requirements

Confidentiality through Supabase RLS and private Storage, reliable transactional revision semantics, portable static output, non-billable service operation, WCAG 2.2 AA design target, no fake saved/live states, cryptographically controlled reviewer links and no privileged execution of user JS. Performance targets require measured device/network definitions; none has been benchmarked in Kadmeion.

### 2.4 Roles and permissions

Use the matrix from `SOFTWARE_REQUIREMENTS_SPECIFICATION_SRS.md`. Critical denial cases include guest editor access, another owner reading drafts/assets, revoked staging token access, developer modifying moderation cases, and admin impersonating authors.

# CHAPTER 3 — SYSTEM ANALYSIS AND USE CASES

### 3.1 Existing pattern assessment

Template-only portfolios restrict custom structure. Raw source editing grants freedom but may make iterative layout work harder and more error-prone for novices. Unbounded drag editors may not preserve code and schema semantics. Kadmeion chooses versioned named slots, content-separated components and explicit Customization ownership as a scoped compromise. These are architectural reasons, not a statistically proven superiority claim.

### 3.2 Use-case model and scenario analysis

UC-01 through UC-13 cover authentication, identity publication, projects, portfolios, source editing, staging, public viewing, restoring, growth and moderation. Critical scenarios: (i) a user deletes a heading block, the slot becomes EMPTY, all prior words/code survive in stash and Undo; (ii) a user updates S2 custom source, protected swap displays an impact diff and requires Keep/Stash/Cancel; (iii) a reviewer link expires without revealing raw source; (iv) publication fails after immutable upload, the previous confirmed live release remains until a verified pointer changes; (v) a formerly public project becomes private, forcing a safe route suspension or verified new release.

### 3.3 Activity and sequence descriptions

The authentication journey uses form validation, final handle uniqueness, Supabase Auth and neutral recovery outcomes; editor mutations use typed operations with revision CAS and guarded file commit; publication uses frozen revision, preflight, output build, upload, pointer update, public verification and rollback. Mermaid diagrams in `DIAGRAMS_AND_MODELS.md` are planned system diagrams, not screenshots from working code.

# CHAPTER 4 — SYSTEM DESIGN

### 4.1 Design architecture

The browser coordinates public/auth/workspace/editor shells with a pure headless editor-core. The committed project file set is the sole durable source of truth for portfolio composition. Supabase Auth and PostgreSQL/RLS/Storage enforce owner identity and private data, while trusted RPC/Edge Functions execute security-sensitive multi-step commands. Static publishing is an isolated bounded domain, with a future-selected free delivery adapter. Public authored source is not evaluated inside privileged application origin.

### 4.2 Editor model and file formats

Each portfolio contains versioned manifest, pinned locks, ordered layout/slot assignments, content records, CSS tokens, optional opaque user-owned components and media assets. Typed slot state EMPTY/S0/S1/S2 is independent of diagnostic state. Any structural operation validates preconditions and uses a crash-recoverable transaction; fields that cannot map into a new layout stay in an Unplaced tray rather than disappear. JSONC managed-file support is conditional on comment-preserving patch tests; plain JSON remains an admissible fallback.

### 4.3 Identity, privacy and data design

Profiles and projects start private, with deliberate public profile/project/portfolio publication. Public developer hub route `/u/:handle` and public project detail `/u/:handle/projects/:projectSlug` are owner-selected. Per-published-portfolio aggregate analytics is disabled until explicitly opted in. The proposed relational schema in `DATA_MODEL_RLS_AND_STORAGE.md` separates private authored data from immutable release bytes, public projections and moderation events. Any actual Supabase migrations and RLS policies require adversarial validation.

### 4.4 UI and theme design

The original angular K, approved Aether Drift C visual source and user-selected sparse K-derived pattern define Kadmeion's brand. The public landing uses a curved editorial hero, timed editor/portfolio/dashboard preview and asymmetrical showcases. The editor uses a three-pane layout with a content-first inspector and bottom history/problems drawer. Global/template/section/component/responsive semantic tokens compile into CSS custom properties, without secretly rewriting arbitrary user source. Exact fonts/colors await source/licensing verification. Real glyph-shaped skeletons fill pending content footprints only; auth slides 280–320ms with reduced-motion alternative.

### 4.5 Release state design

A draft is distinct from staging and publication. Author Preview and Preview as Published display different permitted behavior. Publish Preflight categorizes Blockers/Warnings/Passed; privacy defaults Private. Immutable static release is considered Live only after visitor-level URL/asset verification; Rollback changes the controlled pointer, not old source or private drafts. Unpublish requires verified route disablement and an explicit disclosure that third-party caches may persist.

# CHAPTER 5 — PLANNED IMPLEMENTATION AND MODULE STRUCTURE

### 5.1 Development approach

Use short proof-gated vertical slices. Start with pure manifest/transaction engine and minimal trusted templates, demonstrate local ZIP/JS-off output, then introduce Supabase owner-scoped data/auth and only subsequently verified external static hosting. UI should be assembled from responsive semantic components and original approved design assets, not an image of a mock application. Add later data and AI modules only after P1 is stable and security/cost proof passes.

### 5.2 Suggested implementation modules

`apps/web` for public/Auth/workspace/editor UIs; `packages/editor-core` for schemas/typed ops and history; `packages/portfolio-kit` for trusted templates and slot manifests; `packages/builder-ui` for canvas/layers/inspector; `packages/publisher` for build contract and static HTML; `supabase/` for migrations/policies/edge functions; `delivery/` for public host adapter; `tests/` for all negative and integration fixtures. This is a **proposed folder tree**, not an existing repository inventory.

### 5.3 Implementation status

**NOT IMPLEMENTED.** This document intentionally contains no fabricated committed modules, test totals, published URL results, dependency versions or source excerpts. The actual implementation report must replace this section with dated commit evidence and inspectable, licensed code, config and screenshots.

# CHAPTER 6 — USER INTERFACES AND USER SCREENS

### 6.1 Auth, public and first use

Landing, sign-in, sign-up, callback, recovery/reset/outcome, three-choice welcome and public developer hub. The sign-in/up panel traverses reversibly and retains in-session form inputs while preventing password persistence after navigation. Public identity and project exposure require explicit publication. Users can explore templates publicly but cannot enter authoring without signing in.

### 6.2 Developer workspace and editor

Dashboard with Portfolio Studio, Projects and Personal Growth; folder-styled project gallery, quick-add drawer, rich case-study editor; editable template gallery and no-phone authoring; three-pane editor with canvas, component library, content inspector, assets, source and history/problem states. Each screen has a dedicated specification under `docs/02_design/screens/` with route proposal, entry action, validation, empty/load/error states, keyboard access and mobile behavior.

### 6.3 Public, management and admin screens

Separate developer hub, case study, static portfolio, visitor share, staging, preflight, Releases, analytics/goals (P2), settings/privacy/security/notifications, 15-day Trash, account deletion and narrow admin Users/Moderation/Appeals. Proposed screenshots must later be captured from an actual running version; conceptual boards are not test evidence.

# CHAPTER 7 — TESTING METHODOLOGY AND EVALUATION PLAN

### 7.1 Test levels

Schema/contract and unit tests for editor operations, UI accessibility and state, API/RLS and Storage negative tests, real provider/email/host integration, browser E2E, secure custom-source preview, public URL access/revocation/SEO, offline ZIP recovery, visual reference checks, cost and release fault injection. Test cases and expected outcomes are specified in `registers/TEST_CASES.csv`.

### 7.2 Verification of key hypotheses

Run fixtures covering Empty → Add → Swap → S2 owned source → protected replacement → Undo → History Restore; measure exact hashes and content. Validate static output from the selected revision in a JS-disabled environment. Simulate DB pause and host cache behavior. Test review links after expiry/revocation, cross-account access through direct APIs and privacy revocation of a project embedded in a live release. Report each outcome as PASS/FAIL/BLOCKED/NOT_RUN, never infer results from code presence.

### 7.3 User acceptance and accessibility

Use task-based testing with consented participants, actual device/browser details and no invented satisfaction metrics. Cover signup, non-GitHub project adding, keyboard-only slot editing, public publish and rollback, phone visitor view, account recovery and admin restrictions. WCAG 2.2 AA remains a target requiring manual keyboard/screen-reader and 200% zoom evidence.

### 7.4 Actual test results

**NOT RUN — reserved for real evidence after implementation.** No benchmark, sample-size outcome, production deployment or pass count has been generated by this documentation package.

# CHAPTER 8 — CONCLUSION AND FUTURE ENHANCEMENTS (PLANNING CONCLUSION)

### 8.1 Design conclusion

The design establishes a coherent product scope built around explicit owner decisions, protected source ownership, accessible portfolio editing and intentional public sharing. It separates what the software should do from what has been tested. The project will be considered technically successful only when real code demonstrates sound data integrity, privacy/security and portable publication under the zero-cost constraint.

### 8.2 Deferred enhancements

Phase 2 introduces optional permitted developer-platform source facts, private explainable DevScore and goals, and opt-in aggregate visitor analytics. Phase 3 considers contextual opt-in AI assistance and advanced administrator analytics, after strict security and pricing proof. Optional hosted contact forms, more templates, expanded editor component variants and advanced capability support require independent owner approval and feasibility validation. No real-time multiplayer editor, public leaderboard, anonymous editor or arbitrary privileged user JavaScript is in the current release scope.

## References and appendices

Use `RESEARCH_AND_REFERENCES.md`; academic citation formatting, dates and URLs must be verified before submission. Append: 115-decision register, complete screen/workflow catalogues, UML diagrams, QA/test evidence, privacy threat model, cost ledger, source tree and only actual approved screenshot captures.
