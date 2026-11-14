# Kadmeion — New-Chat Continuation Prompt (Authoritative Handoff v3)

> Copy the section under **BEGIN COPY-READY PROMPT** into a fresh ChatGPT chat. The implementation is *not started* as of this handoff. Any claims about the current GitHub branch or test status must be freshly verified; do not assume a later session retained these facts.

## BEGIN COPY-READY PROMPT

You are taking over **Kadmeion (formerly DevFolio)**, a 2026–27 B.Tech IT capstone application for developer identities and editable portfolio websites. This is a **real full-stack engineering execution task**, not merely a UI proposal. Work as principal full-stack architect, database/RLS engineer, security reviewer, QA lead, accessibility engineer, and disciplined release engineer. Be evidence-first; challenge weak designs, do not invent tests or deployed functionality.

**Repository:** https://github.com/SubhashKumar14/Kadmeion — fresh greenfield repo; **do not modify** the old `DevFolio-App` repository. 
**Canonical public handoff documents in this repo:** `project-docs/README.md`, `project-docs/design.md`, `project-docs/docs/01_product/PRODUCT_REQUIREMENTS_PRD.md`, `project-docs/docs/01_product/SOFTWARE_REQUIREMENTS_SPECIFICATION_SRS.md`, `project-docs/docs/02_design/SCREEN_CATALOG.md` plus 52 screen specs, `project-docs/docs/03_workflows/` with 53 detailed ordered workflows, `project-docs/docs/04_engineering/`, `project-docs/docs/05_quality/`, `project-docs/registers/DECISIONS_UI_001_115.csv`, `project-docs/registers/TECHNICAL_PROOFS.csv`, `project-docs/FULL_REPOSITORY_FILE_MANIFEST.csv`, `project-docs/FULL_REPOSITORY_FILE_TREE.txt`, `project-docs/FILE_COUNT_REPORT.md`, and `project-docs/NEXT_SESSION_HANDOFF.md`. If some of these GitHub files are missing or cannot be read, **state exactly which are missing and ask me to attach** `Kadmeion_Handoff_Documentation_v3_2026-11-12.zip`; never fabricate content or assume all files were pushed.

### Source/decision precedence
1. My newest explicit requirements and owner-approved **UI-001–UI-115**, including final UI-106–UI-115.
2. The current `project-docs/design.md`, PRD, SRS, screen and workflow documents, architecture, security and proof registers.
3. Approved editor blueprint source under `project-docs/sources/EDITOR_FINAL_BLUEPRINT_v1_ORIGINAL_UNMODIFIED.md`, except where superseded.
4. Older Phase-2 and preliminary 31-screen docs are historical references, not present governing requirements.
Distinguish `[APPROVED]` owner choices, `[PROPOSED]` technical design and `[PROOF]` untested feasibility. Publicly stored docs may redact private Notion URLs; absence of private Notion access does not authorize inventing decisions.

### Non-negotiable product constraints
- Name **Kadmeion**, tagline **Build · Showcase · Evolve**. Original angular layered K mark and approved Aether Drift C identity and brand pattern. Typography has editorial/productivity/code roles; exact families require master reference and licensing confirmation. No generic AI-look or unapproved brand change.
- **₹0 recurring cost**; free/open-source first, but truthfully identify quotas and feasibility risk. No paid APIs or fabricated production readiness.
- **Supabase-only business backend**: Supabase Auth, PostgreSQL with tested RLS, Storage, Edge Functions and safe RPC as necessary. **No MongoDB/Mongoose/Express backend**. Selected email provider **Brevo**, feasibility/delivery unverified; fail gracefully until proven. Google sign-in optional.
- Authoring **requires sign-in**; visitors can explore templates/demos only. Phones can view public pages and supported account actions but **cannot author portfolio/code**; qualifying tablets require capability testing.
- Identity profile private until explicitly Publish Profile with selected fields. Projects private by default with independent exposure on identity hub, selected portfolios and public case studies. Public routes `/u/:handle` and `/u/:handle/projects/:projectSlug`; separate portfolio URL scheme is an independent decision and hosting proof gate.
- Editor: source-backed slot architecture, 5 initial extensible templates, 8 sections layouts, reusable React components/variants, EMPTY/S0/S1/S2 source ownership, transactional writer, protected source → customizable copy, reversible component replacement, stash, Undo/Redo/history, typed contracts, responsive token overrides, file/folder/ZIP adapters, last-good preview and problem diagnostics. No arbitrary external DOM import or untrusted JS in public releases without provably isolated execution.
- Publishing: strict Draft vs Live, preflight blockers, reviewer staging, static SEO HTML independent of app session, immutable release artifacts, compare/rollback, visibility, export. Privacy revocation must protect private projects despite earlier published releases/caches; never claim instantaneous CDN deletion without proof.
- Privacy: provider handles optional; no false verification claims, default private growth and DevScore, no public leaderboard; aggregate analytics OFF by default, developer opt-in per published portfolio. Individual Trash recovery 15 days; account erasure separate and clearly disclosed.
- Early admin: scoped Users and Portfolio Moderation (status, reasoned restrict/restore, abuse handling, temporary unpublish, notices/appeals, auditable); NO impersonation, editing users' content, broad private data access. Full admin analytics later.
- Backend-first **Phase 1** = auth, identity, projects, editor persistence/transactions, publishing/export, restricted administration. **Phase 2** = Growth, permitted developer-platform syncing, private DevScore/goals, opt-in aggregate analytics. **Phase 3** = optional AI assistant and advanced admin dashboards **only after separate feasibility/owner gate**. No unsupported scrapers/captcha bypass.
- **Documentation files are EXCLUDED from the application source-file count**, even if `project-docs/` is tracked in GitHub. The application-only manifest enumerates **200 proposed source/config/test files** (P1 183, P2 14, P3 3); these are *plans*, not implemented files. Test/config/SQL/CI files count, docs/source screenshots/vendor/generated outputs do not. Do not force security-sensitive monoliths solely to preserve 200; report changes and request approval for a justified increase.

### What to do in this new session
**Begin immediately with evidence-based read-only verification**: inspect repository default branch, real commit/tree, existing code/documentation, connectivity and required access; read governing docs first, check any incompatible/stale assumptions. Do not claim the backend has already been implemented. Inventory package.json, tooling, runtime, Supabase CLI/Docker availability; check whether a real Supabase project or provider integration is connected without exposing secrets. Never commit credentials or `.env` values.

Then carry out implementation **one milestone at a time** (not all backend in one unreviewable commit). Use a feature branch, preserve `main`, and test after each stage. Coding for Phase 1 is authorized by this prompt; **do not merge to `main`, deploy live, mutate production data, or incur cost without my explicit approval**. Prefer focused PR(s), clearly communicate blockers if write access is missing. Do not modify the old repo. Do not silently create new cloud projects.

**Milestone B0 — repo/backend foundation:** Monorepo workspace, TypeScript shared contracts, consistent package lock/runtime, Supabase local stack/migration/seed/test configuration, lint/typecheck/tests, environment examples without secrets, ignore rules, CI baseline, architecture/security boundary decisions. Recheck authoritative current Supabase guidance before implementing CLI/API calls.

**B1 — Auth, accounts, identity:** Supabase Auth email/password/recovery/optional Google integration contract, profiles, linked identities/session management where supported; tenant-scoped RLS, public profile field projection, explicit publication and positive verification only when real. Transactional event/audit patterns; role/scope tests. Validate Brevo free SMTP sender and recovery before claiming mail works.

**B2 — Projects and assets:** Link-based projects (not repo imports), safe URL validation, private-by-default records, optional external site thumbnail behind SSRF/egress guard or explicit fallback, owner-controlled hub/portfolio/case-study exposure, storage grants and ownership/RLS, version optimistic concurrency, tests for leaked/deleted projects.

**B3 — Editor persistence and core contracts:** Typed canonical file/document model, files-to-slots deterministic mapping, versioned drafts, transaction writer, ownership/protected files, explicit override/copy/stash, history checkpoints, restore/recovery; local IndexedDB/folder/ZIP sync contracts; tests for data corruption, conflicts and lossless round trips. Validate contract with minimal headless fixture before building all UI.

**B4 — Publishing/delivery/export:** Authentic preflight, immutable release snapshots, staging tokens with bounded expiry/revocation, static SEO HTML public independent of authenticated Supabase runtime, safe customization/execution gate, verified restore/rollback, independent export. Implement cache/visibility revocation semantics, fail closed where proof is missing, keep last good Live on failed publish; verify free host quotas before real delivery.

**B5 — Admin/retention:** Narrow user and moderation privileges, read limits, reasoned status changes, notice and appeal trail, no impersonation/editorial editing, data-lifecycle / 15-day item Trash, separate account erasure with retention disclosures, comprehensive policy and audit tests.

**B6 — backend integration gate:** Running local migrations from empty DB, RLS automated roles matrix, Storage policies, HTTP/Edge contracts, concurrency, idempotence, offline recovery, safe release publication, privacy revocation, negative/abuse tests. CI must be reproducible. Report tests honestly (`RUN/PASS/FAIL/NOT RUN`) and external host/provider proof separately.

Only once backend contracts are stable, plan and implement **Phase 1 frontend** in small vertical slices: auth + branded slides, landing/explore/public identity, workspace/project flows, portfolio editor, publishing UI, settings/account lifecycle, restricted admin screens, responsive/accessibility/motion contracts and authentic glyph skeleton loaders. Validate keyboard and screen reader acceptance for each screen; reduced-motion, mobile non-authoring restriction, real empty/loading/error states.

Then follow owner-approved **Phase 2** provider sync/growth/opt-in analytics with API terms and privacy proof, and **Phase 3** optional AI/advanced admin only after feasibility and approval gates. Do not pretend Phase 3 is preapproved to implement merely because a file path is listed.

### Per milestone deliverable and acceptance protocol
1. Verified repository SHA/branch/working tree, implemented vs proposed gap, explicit assumptions and prioritized small plan.
2. Precise changed paths (no doc files in application count), schema/RLS/API contract, and security/data migration ramifications.
3. Actual code modifications and test commands/results with error text; retry/fix failing checks rather than labeling success.
4. Red-team audit: cross-tenant leakage, private-to-public transitions, stale cache/links, SSRF, token/session abuse, RLS bypass through Edge Functions and service-role keys, race/conflict restore behavior.
5. Count **actual authored application files** separately from tracked documentation; compare to planned 200 and explain any justified departures.
6. Commit/PR to feature branch only after tests as allowed, link immutable commit and tests, request approval before merge, public deployment or paid dependency.
7. Update only the small repo technical README or implementation status as needed; preserve planning specs and decision history unless explicitly authorized to change design decisions.

**First response in the new chat:** Identify the actual GitHub commit/tree, read the available handoff docs, report what is and is not proven, show an exact B0 implementation plan and start B0 immediately using supported tools. Do not ask me to repeat the 115 decisions. If the docs cannot be fetched, ask only for the v3 ZIP; otherwise proceed. Give me a concise checkpoint after B0 and clear next milestone B1. Never describe tests, remote pushes or cloud deployments as done until tool evidence confirms them.

## END COPY-READY PROMPT

---

## Latest implementation handoff — 14 November 2026 (supersedes historical “not started” statement)

Active implementation repository: `SubhashKumar14/Kadmeion`, branch `feat/b0-backend-foundation`; older `DevFolio-App` is reference-only. Last code commit: [`4649cc0`](https://github.com/SubhashKumar14/Kadmeion/commit/4649cc09b2d755529112241753345bf244146650), which implemented owner-only B5 account-erasure **request/status/withdrawal only**. [CI 43534756934](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43534756934) passed application and local database/HTTP jobs. Check the newest branch head and CI again before writing.

Account requests are `REQUESTED_BLOCKED`, not a deletion commitment. `reauth_verified`, `public_revocation_verified`, `access_terminated`, `erasure_executed`, and `retention_verified` are DB-constrained false. There is no destructive worker, no account access termination, no verified backup/cache retention window and no public-host revocation proof. Account deletion is separate from 15-day item Trash. Read `project-docs/IMPLEMENTATION_STATUS.md` newest B5 section and source UI-92/112 + WF-047.

Next implement **bounded owner-only account-exit preflight/inventory and a verified recent-reauth contract**, with negative tenant and stale-session tests; do not create a purge or pretend JWT possession alone proves recent reauthentication. Public hosting, rollback, direct-asset revocation, hosted Brevo email, browser accessibility, dedicated lint/SAST and B6 backend integration gates remain open. Use only 52 explicitly approved original LIGHT images after backend completion; no DARK mockup set or rejected Canva designs. Do not deploy manually or change production without approval; existing Git integration automatically produces nonproduction auth previews.


## B5 implementation continuation — verified update (14 November 2026)

Newest implementation work is on `SubhashKumar14/Kadmeion`
branch `feat/b0-backend-foundation` (never edit the old DevFolio repo).
Freshly verify HEAD and CI before writing. The B5 account-exit milestone added:

1. `private_account_exit_preflight()`: owner-only bounded counts of projects,
   portfolios, revisions, exposure intents, private asset metadata, frozen
   release intents, reviewer grants, Trash and erasure requests. Requires a
   matching live GoTrue `auth.sessions` row; JWT possession alone is insufficient.
   Public routes and external export/integration inventory remain unverified.
2. `begin_private_account_exit_reauth(uuid)` and
   `complete_private_account_exit_reauth(uuid)`: explicit 5-minute challenge,
   a subsequent *different* real login session for the same owner, owner-private
   challenge journal with RLS, denial of original-session/foreign-session replay.
   Proof is informational and not linked to an erasure worker.
3. Tests exercise missing/stale sessions, cross-tenant visibility, hard caps,
   challenge replays, malformed receipts and an actual second password sign-in
   through ephemeral local Supabase Auth. See [CI 43539180463](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43539180463)
   for verified 150 Node + 24 local HTTP tests and passing database pgTAP at
   commit `09fc5c9`. Later commits require fresh CI checks.

**No destructive operation is authorized or implemented.** Request-only
`reauth_verified`, `public_revocation_verified`, `access_terminated`,
`erasure_executed`, `retention_verified` continue to be constrained false.
Do not treat a fresh sign-in *candidate* as evidence of the explicit
second-session challenge; do not treat even a completed challenge as
permission to delete without independently verified host revocation and
retention/backup handling. The 52 owner-approved LIGHT screen images exist as
session-local artifact references in Notion and must be recovered before any
frontend fidelity claim; never generate DARK variants or use rejected Canva
mockups.

**Next action:** Implement and negative-test host-neutral route-state and
direct-asset revocation semantics without deploying. Verify host selection,
cache controls, direct immutable URLs and rollback before anyone can claim a
published link revoked. Continue backend-first and obtain approval before any
Vercel static preview, production change, or irreversible deletion.


## Current B4 trusted read continuation (14 November 2026)

Freshly verify `feat/b0-backend-foundation` HEAD/CI. The host-neutral
`PrivatePublicDeliveryPolicy` and owner-only transactional
`private_release_visibility_pointers` already existed before this run.
This iteration added `kadmeion_private.private_delivery_denial_gate`
(only service_role, non-exposed schema, both canonical and direct hashed
asset inputs) and `PrivateServerDeliveryDenialGate` fail-closed validation,
with pgTAP/Node/HTTP negative tests.

The SQL function NEVER grants access. Candidate manifests are still owner-
submitted and unverified by DB, and no trusted public host, CDN invalidation,
asset storage adapter or serving endpoint exists. Owner block increments
revocation generation; this is evidence of a private DB mutation, not live
URL or direct-asset revocation. Do not conflate the private restricted
denial contract with a host public resolver. Maintain all 52 owner-approved
original LIGHT screens but do not begin frontend until backend gate passes;
DARK-theme mockup production and rejected Canva assets remain prohibited.

NEXT: verify final CI, then implement secure server-side private artifact
manifest binding/attestation prior to any host selection. Require explicit
user approval before Vercel preview deployment, public delivery, production
changes or irreversible account deletion.


## Latest B4 handoff — restricted artifact verification and private binding (14 Nov 2026)

Active branch: `feat/b0-backend-foundation` in
`SubhashKumar14/Kadmeion`; do NOT mutate original DevFolio.
Previous B4 state: owner-only pointer (`PREPARED_PRIVATE`/`BLOCKED`),
frozen authenticated owner loader, deterministic static preview
candidate, and DB-only canonical/direct asset denial gate.

This iteration adds:
- `supabase/migrations/20261114091000_private_artifact_pointer_binding.sql`:
  `kadmeion_private.private_artifact_bindings`, server-only SQL
  `bind_private_artifact_candidate(request,generation,manifest_json,html)`,
  exact JSON-schema/frozen-revision/HTML and manifest SHA verification,
  owner portfolio -> pointer lock ordering, current generation CAS,
  idempotent private record. A later owner block or Trash prevents binding
  even of previously verified private bytes.
- `packages/storage-adapters/src/private-artifact-pointer-binding.ts`:
  restricted-server orchestration from the attested frozen owner loader,
  trusted render plan, verified artifact and prepared owner pointer to an
  injected SQL-only binding executor. **NOT exported for browsers.**
- pgTAP, Node and non-exposure HTTP regression tests.

CI `6e100c4` is verified green:
[run 43549661331](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43549661331)
(180 Node, 268 pgTAP, 26 local HTTP tests). Check freshest HEAD/CI,
especially follow-on `2baf79c` HTTP-denial test, before proceeding.

**Uncompleted:** A real restricted server SQL executor has not been
implemented or deployed. Do not substitute a browser PostgREST call
or expose service-role keys in frontend code, logs or Vercel static
assets. SQL cannot independently certify that HTML was generated by
the pinned renderer: the trusted server must recreate/verifiably hash
it before submitting. Only then is the binding an integrity record,
and still NOT a publish authorization.

**Next exact step:** Implement/test the trusted direct SQL executor with
safe secret handling and injected connection, negative tests for wrong
owner/request, modified/oversize HTML and manifests, pointer CAS races,
and permanent denial of public routes and immutable direct asset
access until the owner approves a host and actual cache-revocation
proof exists. Hosted deployments and irreversible account cleanup
remain unauthorized. The 52 owner-approved original LIGHT screen
references in Notion are authoritative; do not use rejected Canva
screens, generate DARK mockups or begin frontend until backend gates pass.
