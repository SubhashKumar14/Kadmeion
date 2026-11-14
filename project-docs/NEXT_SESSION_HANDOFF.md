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


## Latest B4 direct SQL adapter handoff — 14 November 2026

Active branch `feat/b0-backend-foundation` in `SubhashKumar14/Kadmeion`.
The private artifact binding SQL function and trusted frozen-snapshot
orchestrator already existed. This iteration added the server-only
`DirectSqlPrivateArtifactBindingWriter` (parameterized `pg`-compatible
query port; not browser-exported), its negative tests and an in-process
orchestrator-to-SQL contract test. The final **code** commit is
[0cfb108](https://github.com/SubhashKumar14/Kadmeion/commit/0cfb10899db4f5fd8e04a2a4df2d45be3b90efdf);
[CI 43552260096](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43552260096)
passed 184 Node tests, 268 pgTAP assertions, 27 local HTTP subtests,
TypeScript, auth builds and 135/200 file budget. Check latest branch HEAD
and CI before new changes; a subsequent documentation-only commit may
trigger Git integration. The exact owner-approved 52 LIGHT screen references
are in Notion, but image files are session-local. No DARK set or Canva
substitution is authorized.

**Start next run here:** implement a real local direct PostgreSQL `pg`
integration harness with a least-privileged, nonproduction worker role and
exercise the restricted SQL binding RPC from the trusted orchestrator under
concurrent block/Trash, stale generation, tampered manifest and HTML.
Current adapter is tested against an injected query port, **not yet an
actual direct PostgreSQL driver**. Do not use a browser Supabase client,
PostgREST, hosted service credentials, public-serving endpoints or production
writes. No selected/approved public host or direct-asset/cache revocation
proof exists. Operator moderation BLOCK-only and backend B6 remain pending.

## 14 November 2026 — latest B4 verified local PostgreSQL handoff

Repo `SubhashKumar14/Kadmeion`, `feat/b0-backend-foundation`.
Freshly verify HEAD before any next write; latest implemented and
tested commit `709f824`. Local-only
`tests/integration/local-postgres-binding.test.mjs` uses the actual
PostgreSQL wire protocol via `psql` plus a prepared query to exercise
the existing `DirectSqlPrivateArtifactBindingWriter`, real authenticated
owner frozen revision, trusted render plan and manifest hash. A temporary
random LOGIN worker role has schema USAGE + specific function EXECUTE,
not table SELECT or pointer UPDATE, and is dropped in test cleanup.
DB rechecks a pointer block injected between read and bind; forged HTML,
manifest, request ID, generation, cross-owner reads and Trash fail closed.
It is deliberately **NOT** a production `pg` Pool runtime, and no DB
service-role credentials are exposed to frontends or production.

Verified green CI:
[run 43555748754](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43555748754)
(184 Node, 268 pgTAP, 27 local HTTP, one direct PostgreSQL integration,
TypeScript/builds, 136/200 application source files).
Subsequent documentation commits need separate CI checks.
Earlier CI failures were fixed, not omitted from the audit trail.

**Start next run:** implement a production-suitable, server-only
`node-postgres` (`pg`) driver adapter on a compatible pinned/locked
version and test a least-privileged connection lifecycle against the
ephemeral local database. Retain SQL CAS, attested loader + trusted plan,
strict secret isolation, no public PostgREST binding, no owner-provided
hash authorization, and no browser bundle exports. If an actual host
or credentials require approval, keep those boundaries unconfigured and
continue moderation operator BLOCK-only / B6 tests instead.
No public publishing, CDN/direct asset revocation, production data
mutation, Vercel manual deployment, or account purge is authorized.
Use only the 52 latest owner-approved original LIGHT screens when the
backend gate is complete; do not use rejected Canva mockups or create
DARK screen sets.


## Latest B5 operator BLOCK-only handoff — 14 November 2026

Active repo `SubhashKumar14/Kadmeion`, branch
`feat/b0-backend-foundation`. Verified code at `093fbcb`:
[CI 43557174030](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43557174030)
passed 187 Node, 289 pgTAP, 27 local HTTP and 1 local direct PostgreSQL
test, plus TypeScript/auth builds and 138/200 source budget.
`eda8be5` added a further real HTTP nonoperator/private-table denial
test; **check its CI completion** before reporting it as passed.

New case-bound operator RPC `operator_block_private_portfolio` creates
an owner-matched private hold, blocks the private pointer with an audit
event and prevents owner reprepare while held. No public serving,
host/CDN revocation, content editing, case-close auto-restore or
account deletion is enabled. An intermediate incomplete-tree commit was
corrected; the current branch contains the full baseline plus only
the intended new SQL and moderation-client/test changes.

**Next:** Verify latest CI, then integrate a pinned server-only `pg`
Pool/Client against the existing restricted SQL binding adapter in
local ephemeral Supabase, including connection teardown, bad credentials,
TLS policy and revocation races. Do not wire secrets into the Vercel
auth preview or start frontend until backend B6 gates are complete.
The exact original 52 approved LIGHT image references are in Notion;
no DARK set and no rejected Canva designs.


**Final-code verification addendum:** [CI 43557275632](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43557275632)
passed both jobs on `eda8be5`: 187 Node, 289 pgTAP, 28 local HTTP,
1 direct PostgreSQL integration, TypeScript and auth builds; 138/200
file budget. This supersedes the earlier pending-HTTP-test note.
Documentation-only follow-up commits need no new code-completeness claim.

## Latest verified handoff — B4 real pg.Pool lifecycle (14 November 2026)

Active repository: `SubhashKumar14/Kadmeion`, branch
`feat/b0-backend-foundation`; old DevFolio repo reference-only.
Code commit [d033597](https://github.com/SubhashKumar14/Kadmeion/commit/d033597e767589651991c0c478d4d952a9afdb46),
CI correction [3a73b80](https://github.com/SubhashKumar14/Kadmeion/commit/3a73b80946070167b7692e689fed70d36e37df62).
[CI 43562124246](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43562124246)
PASS in both jobs: 191 Node, 289 pgTAP, 28 local HTTP,
one real restricted node-postgres `pg.Pool` integration, TypeScript/builds,
140/200 authored files. The initial database CI failure at d033597
was missing `npm ci`, corrected and retested at 3a73b80.

`packages/storage-adapters/src/private-artifact-pg-worker.ts` is server-only,
not browser-exported. It requires restricted role proof, strict TLS on remote
hosts, explicit local opt-in for plaintext loopback, bounded timeouts,
sanitized errors and idempotent close. `pg@8.23.1` and declarations are
pinned in lockfile. The real local Supabase test checks bad credentials,
role isolation, byte tampering, owner block and Trash revocation.
No hosted worker or credentials have been provisioned.

**Start next iteration:** add an operator case-bound moderation hold race
to the real local `pg.Pool` binding integration, including stale-generation
denial and no reprepare while held; verify CI. Do not deploy or enable
public routes. Public-host/CDN/direct-asset revocation, remote TLS/provider,
account deletion, browser E2E, lint/SAST/accessibility remain unproven.
The original 52 LIGHT mockup images are approved in Notion but stored at
session-local artifact addresses; recover originals before frontend work.
No DARK set, rejected Canva designs or unapproved static preview.


## Latest verified handoff — B6 operator/private binding concurrency (14 November 2026)

Active repo SubhashKumar14/Kadmeion; branch feat/b0-backend-foundation.
Starting HEAD 5ebeb2b. Code commits
[fadc75b](https://github.com/SubhashKumar14/Kadmeion/commit/fadc75b8d91cf0ad49ec51e1e1aadd7cacb37083)
and [ff4f333](https://github.com/SubhashKumar14/Kadmeion/commit/ff4f3334e4ff2a76e5ecfe35a4857a2638dfb413)
add a real ephemeral local Supabase/pg.Pool test for a moderator case-bound
block racing artifact binding. It verifies cross-tenant/operator denial,
stale generation rejection, idempotent audit, no reprepare under hold, and
a live PostgreSQL row-lock race. No business SQL or frontend changes.

[CI 43567116761](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43567116761)
passed both jobs on ff4f333: 191 Node, 289 pgTAP, 28 local HTTP,
one prior restricted pg binding test, one new moderator pg race test,
TypeScript/auth build/smoke/preview and 141/200 source budget.
Check the current HEAD and CI again before further changes.

**Start next iteration:** add a local-only HTTP-level deny-only regression
for canonical portfolio HTML and direct immutable asset requests, using
the existing private delivery-denial gate under operator hold, owner
Trash, cross-tenant and unavailable-provider conditions. Do not infer
a live-host/CDN revocation proof from this test. No selected host or
production authorization; public publishing and account erasure stay
disabled. No frontend work until the backend critical path is verified.
Notion confirms 52/52 original LIGHT mockups approved; the original PNG
addresses are session-local, and DARK/previously rejected Canva designs
are not authorized.


## Latest verified B6 handoff — local HTTP deny-only canonical/direct-asset gate (14 November 2026)

Active repository: SubhashKumar14/Kadmeion, branch feat/b0-backend-foundation; starting SHA 963a7cc. Code commits [75924ff](https://github.com/SubhashKumar14/Kadmeion/commit/75924ff21672d3e79d27466a2ff23c46b8c90a47), [c2a4d8](https://github.com/SubhashKumar14/Kadmeion/commit/c2a4d873318afa16445ed7347f74c0cb35b82336), [0488c71](https://github.com/SubhashKumar14/Kadmeion/commit/0488c714eb58d738b9373aa6bb963a89488cd50e), [a77c574](https://github.com/SubhashKumar14/Kadmeion/commit/a77c57433def3a57529b1a5a212a473b65baa5b4). Existing tests/integration/local-supabase-http.test.mjs now runs a loopback HTTP fixture using the actual restricted SQL private_delivery_denial_gate via pg.Pool, including fresh reads for canonical HTML and immutable direct assets; tests prepared private pointer, operator hold, Trash/restore, cross-tenant denial, outage, malformed state/path and HEAD. The fixture always returns uniform 404 and never exposes artifact bytes. No public allow path, production host, new package or migration.

[GitHub Actions run 43572035732](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43572035732) on a77c574: both jobs PASS. 191 Node tests, 289 pgTAP assertions, 29 local HTTP tests, 1 restricted PostgreSQL binding integration and 1 moderation/pg.Pool race integration; TypeScript, auth build/smoke/preview and 141/200 application file budget PASS. Dedicated lint/SAST, hosted Supabase/TLS, email, real host route and direct-asset/CDN revocation, browser E2E, accessibility and irreversible erasure remain NOT VERIFIED.

Notion's latest explicit owner decision approves exactly 52 original LIGHT screen images; no DARK screen set or rejected Canva substitutions. The image addresses are session-local, so recover exact originals before frontend work. No frontend started, manual Vercel deployment, production modification, public publish or main merge. Git integration automatically produced nonproduction feature-branch previews.

**Next run concrete starting point:** Implement a strictly non-destructive, owner-only account-exit export/erasure inventory manifest with versioned/idempotent snapshot and cross-tenant/negative tests. The existing advisory account-exit counts are not an atomic purge manifest. Keep actual deletion and public serving disabled until independently verified recent reauthentication, canonical AND direct immutable-asset revocation, and provider retention proof. Verify fresh HEAD and CI first.


## Latest B5 handoff — account-exit metadata snapshots (14 November 2026)

Active repo `SubhashKumar14/Kadmeion`, feature branch
`feat/b0-backend-foundation`; baseline `9e1eb602`. New code commits
`919a8e3`, `ac1ab65`, `249f9b6`, `9939964`, `88b8f84`;
CI serialization fix `5c28d79`. Inspect current branch HEAD and the
latest `Application and Database CI` push/PR runs before proceeding.
Earlier database CI failures occurred during `supabase start` from
host-port 54322 collisions between overlapping runs. These are
infrastructure failures, not passing tests; concurrency was added to
the database job to prevent future overlap.

New migration `20261114110000_private_account_exit_inventory_snapshots.sql`
and typed client capture/retrieve owner-only versioned immutable
**metadata-only** inventory snapshots. Nine owner-scoped bounded counts
share one SQL statement snapshot. Replay uses the same operation ID;
optional erasure-request association must be active and same-owner.
New pgTAP and real local HTTP tests check denial of anonymous,
cross-owner, forged, stale-session and withdrawn-request access,
immutability and idempotency. This is NOT a full export, public URL or
asset inventory, retention proof, erasure authorization or deletion
worker. Keep account requests blocked, public serving disabled,
frontend postponed, and no DARK/rejected Canva assets.

**Start next run:** confirm final CI on the latest code SHA and repair
any genuine SQL/HTTP failures. Then implement a safe, bounded owner
data-export artifact contract with Storage reconciliation and
retention disclosures, without destructive operations or production
deployment. Independently prove host canonical-route AND direct-asset
revocation before ever enabling public publishing/erasure.


**Verified code CI addendum:** [run 43576521919](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43576521919)
passed both jobs on code commit `88b8f843`: 194 Node,
300 pgTAP, 34 real local HTTP, 1 restricted PostgreSQL and
1 operator/pg.Pool race, plus typecheck/auth builds and 143/200 file
budget. Do not confuse earlier port-binding failures with application
test failures. The later database CI concurrency fix `5c28d79`
requires a separate run result. Next task remains safe owner-data export
and Storage/provider inventory reconciliation, with no destructive
account deletion or public serving.


**CI serialization confirmation:** [run 43576583998](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43576583998)
completed both jobs PASS on `5c28d791`, including local Supabase
startup and all database integration gates. This supersedes the
earlier pending workflow-fix note. Code remains non-destructive and
metadata-only; next implement verified export readiness, not deletion.


## Latest verified B5 handoff — Storage reconciliation and metadata hardening (14 November 2026)

**Active source:** `SubhashKumar14/Kadmeion`, `feat/b0-backend-foundation`; starting SHA `613d292`. Notion's final owner approval is 52/52 **original LIGHT-theme images only**. Original sandbox image addresses are session-local; recover the exact images/checksums before frontend. No rejected Canva designs or DARK mockup set.

**New backend code:** `supabase/migrations/20261114123000_private_account_exit_storage_reconciliation.sql` implements live-session owner-only bounded comparison between `project_assets` and `storage.objects` for the owner's private bucket, bound to an existing inventory snapshot. Returns counts and explicit `METADATA_MATCH_ONLY`, `DISCREPANCY` or `LIMIT_EXCEEDED`, with inventory drift and all export/revocation/erasure proof flags false. The same migration revokes unsafe client updates to registered asset identity fields while allowing `alt_text`. Typed client `SupabasePrivateAccountErasureService.reconcileStorage(snapshotId)` rejects forged readiness and false-success receipts. pgTAP and local HTTP tests verify privilege isolation, real upload/orphan registration, cross-owner and stale-session denial, and post-registration tamper rejection. Latest code SHA [187de67](https://github.com/SubhashKumar14/Kadmeion/commit/187de67ac95a4be17799dafe3d80db3f45bb264c).

**CI verified:** [run 43580753110](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43580753110), both jobs PASS on `187de67`: 197 Node, 308 pgTAP/21 files, 37 local HTTP, one restricted PostgreSQL and one operator race integration; TypeScript, auth builds/smoke, preview check, file budget 145/200 PASS. Documentation-only commits after this code SHA do not extend the code evidence.

**Strict boundaries:** Metadata reconciliation is NOT a downloadable full data export, byte integrity proof, backup retention verification, CDN/direct asset revocation, or deletion authorization. It does not expose object paths; 100-object cap per side fails closed on overflow. No public delivery, account erasure, manual Vercel deployment, production change, frontend or main merge.

**Next iteration starting point:** implement a bounded, downloadable owner export of private project/profile/portfolio records plus private Storage bytes. Prove each object's size/hash, detect missing/orphan/changed objects, enforce safe ZIP/JSON limits, and return honest partial-failure results. Do not mark export complete until bytes and data categories are actually covered. Then continue independent host canonical-route and direct-asset revocation proof; keep public serving and erasure disabled until proven.

## Latest B5 handoff — bounded private account JSON export (14 November 2026)

Active repo: SubhashKumar14/Kadmeion, feature branch feat/b0-backend-foundation. Starting SHA 82f17b1; latest verified CODE SHA [85a79ca](https://github.com/SubhashKumar14/Kadmeion/commit/85a79ca638971d28452a3bf3a4cd6d7f3061983b). The current branch HEAD includes later documentation-only commits; verify fresh HEAD before writing. The old DevFolio-App is reference-only. Notion's latest explicit owner decision approves all 52 original LIGHT screen images, forbids a DARK mockup set and excludes rejected Canva mockups. No frontend implementation yet.

New backend module: packages/storage-adapters/src/private-account-data-export.ts, exported from index.ts. It returns owner-only, bounded JSON bytes containing five private RLS-scoped table categories and registered Storage bytes (base64, computed SHA-256). It validates Auth owner, row ownership, current Storage reconciliation before/after, MIME/size, quotas, stale-session and foreign-user denial. It does NOT produce a complete account export, atomically pin source content, authorize deletion, publish routes or deploy a host. Current bounds: 100 rows per table, 1 MiB/table response, 8 assets, 8 MiB total assets, 16 MiB JSON. No UI-triggered download is wired.

[GitHub Actions run 43585866065](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43585866065) PASS on 85a79ca: 205 Node, 308 pgTAP, 38 real local HTTP including actual JWT/RLS/Storage byte export, one restricted PostgreSQL binding and one moderation race; typecheck/auth builds/smoke/preview and 147/200 file budget PASS. Earlier Node 22 strip-types failure fixed in b31ec46. Dedicated lint/SAST, hosted provider, browser E2E and accessibility not verified.

**Next iteration start:** (1) verify current HEAD and code CI; (2) expand the export to omitted private categories with a coherent bounded paging/consistency policy, and add a trusted provider content hash/object-version pin to rule out same-size Storage replacement; (3) test cross-tenant, concurrent mutation, oversized/partial failure and signed-out cases against ephemeral Supabase; (4) only then integrate a user-triggered local download. Keep public publishing, account deletion, production writes, manual Vercel deployment and frontend screens blocked until independent canonical-route/direct-asset revocation and retention proof. No DARK-theme work.

## Latest verified B5/B6 handoff — expanded private export and fixed concurrent-test rejection (14 November 2026)

**Repo/branch:** `SubhashKumar14/Kadmeion` / `feat/b0-backend-foundation`. Start from fresh branch HEAD, not the historical handoff's old SHA. New code commits: [ef3f960](https://github.com/SubhashKumar14/Kadmeion/commit/ef3f960f2bda7b541d369df56002243f13836cd9), [c4c13aa](https://github.com/SubhashKumar14/Kadmeion/commit/c4c13aa7b3b6f974227ad22f26f0837ef18c29d7), [b45a698](https://github.com/SubhashKumar14/Kadmeion/commit/b45a69816eff70368b9714089ee74554c2c362d9). The old DevFolio-App repo remains reference-only. Notion confirms 52/52 original LIGHT screens approved, no DARK set, rejected Canva images excluded. No frontend or production change.

**Implemented:** Owner-only bounded JSON export now covers ten readable categories: profiles, sharing preferences, onboarding steps, projects, exposure intents, portfolios, portfolio revisions, asset metadata, private release requests and Trash records. Five newly included categories have Node tenant-injection and content tests. The B6 PostgreSQL row-lock test now immediately handles the expected rejected promise, avoiding an unhandled rejection before the post-COMMIT assertion. Reviewer grants, moderation/appeals, account erasure history and other restricted categories remain omitted; no broad grants were introduced.

**Verification:** [CI 43590606510](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43590606510) both jobs PASS on code SHA `b45a698`: Node 207/207, pgTAP 308/308, local HTTP 38/38, restricted pg 1/1, moderator race 1/1, TypeScript/auth build/smoke/preview/file budget 147/200 PASS. Intermediate [CI 43590266850](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43590266850) failed the pre-existing race test's unhandled rejection; this was corrected and independently verified. No dedicated lint/SAST, browser E2E, hosted TLS, accessibility or live CDN tests.

**Next starting point:** Read `packages/storage-adapters/src/private-account-data-export.ts`, `supabase/migrations/20261114123000_private_account_exit_storage_reconciliation.sql` and `tests/integration/local-supabase-http.test.mjs`. Implement trusted read-only provider object identity/version pinning and detect same-size/same-MIME overwrites during export, with real local Supabase negative tests. If a provider cannot supply a trustworthy expected content hash, mark hash pinning unverified rather than asserting it. Do not enable account deletion, public serving, production deployment, or frontend until remaining backend proof gates are independently met. Preserve `BOUNDED_PARTIAL_EXPORT`, `completeAccountExport=false`, `deletionAllowed=false` and original approved LIGHT image fidelity.

## Latest verified B5 handoff — Storage version-race detection (14 November 2026)

Active repo `SubhashKumar14/Kadmeion`, branch `feat/b0-backend-foundation`; previous head `8afe768`; last **tested code** commit `2fe68dea`. The old `DevFolio-App` is reference-only. The latest Notion approval register confirms 52/52 **original LIGHT** images approved and no DARK screen production. Original image paths are chat-session-local, not hosted source files. No frontend changes.

Owner private Storage paths are now **write-once** via migration `20261114140000_private_storage_immutable_uploads.sql` (owner UPDATE policy removed, owner INSERT/SELECT retained). The partial account exporter checks RLS-authorized Storage object ID/version/last-modified/MIME/size before and after all byte downloads, while preserving bounded owner-only reads, pre/post inventory reconciliation and downloaded SHA-256. Normalized Storage info fields are `size`, `content_type`, `last_modified`; `owner_id` is omitted by the provider's info renderer. A local privileged same-size overwrite during export is detected and rejected; owner same-path overwrite is denied. This is **NOT** an immutable provider-version read or trusted expected content-hash pin.

[CI 43595827191](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43595827191) PASS both jobs on `2fe68dea`: 210 Node, 309 pgTAP, 39 local HTTP, 1 restricted pg, 1 moderator pg race, typecheck/auth builds/smoke/preview and 148/200 file budget. Intermediate SQL-policy-count and normalized-info assumptions caused failing runs and were corrected; never cite those runs as green. No hosted, browser, lint/SAST or accessibility proof; no production deploy, public serving, account deletion or main merge.

**Start next iteration:** recheck current branch HEAD/CI; then implement a narrowly scoped **server-verified expected SHA-256** for registered private Storage assets, with immutable owner-scoped association and byte quota, and compare against export bytes. Prove real local same-size privileged overwrite denial and missing/hash-mismatch fail-closed. Do not accept a client-submitted digest as proof or claim S3 historical version retention. Keep public route AND direct immutable asset revocation, external backup retention, complete export and erasure gates blocked. Only start frontend after backend critical path is independently verified.


## Latest B5 handoff — server-verified private asset SHA-256 (14 November 2026)

**Active source:** `SubhashKumar14/Kadmeion` /
`feat/b0-backend-foundation`; previous HEAD `e311f8b`.
The old `DevFolio-App` remains reference-only. Notion confirms all
52 original LIGHT screen images approved, with session-local PNG addresses.
Rejected Canva screens and DARK variants are not approved.

**Implemented on the feature branch:** A private RLS/write-once
`private_asset_content_attestations` table, service-role-only digest
recording RPC and live-owner-only read RPC; server-only Node byte attestor
computing SHA-256 from owner-JWT-authorized Storage bytes with before/after
object-version checks; bounded account export now requires matching trusted
hashes and fails closed on missing pins or same-size altered content.
Attestation cannot be forged by a browser JWT. This is NOT a provider-signed
hash, immutable version-addressed download, complete export or deletion proof.
The trusted worker is **not yet connected to the registration workflow**;
existing assets require a secure backfill before export succeeds.

**Verified CI:** [43600553448](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43600553448)
both jobs PASS on `23d8fbe`: Node 217, pgTAP 318, local HTTP 39,
restricted PostgreSQL 1, moderation race 1; typecheck/auth build/smoke,
preview and source budget 152/200 PASS. New idempotency/conflict assertions
in code commit `460690d` were added afterward; verify their own CI.

**Start next iteration:** (1) verify current branch HEAD and final CI;
(2) connect the attestor to an authenticated, server-only asset-registration
completion path, without a browser-accessible service-role key or arbitrary
user-provided digest; (3) test missing/unattested assets, owner/tenant
isolation, repeated registration, concurrent privileged same-size overwrite,
and malformed/oversized bytes on real ephemeral Supabase; (4) retain
`BOUNDED_PARTIAL_EXPORT`, no public publishing or account deletion.
Then proceed to canonical-route AND direct-asset host revocation and provider
retention evidence. No manual Vercel deployment, production mutation,
frontend code or merge to `main` is authorized.


## 14 November 2026 — registration completion boundary (unverified CI)

Commits `4aabfd5` and `b39b858` added a server-only `completePrivateAssetRegistration` boundary and four contract tests. It accepts a previously committed registration and calls the existing trusted byte attestor, rejects forged receipts, and never authorizes public publishing or deletion. **No actual HTTP handler or post-insert trigger has been wired.** A boolean `registrationCommitted` is an internal caller assertion, not independently verified transaction proof; only trusted server code may call this boundary. The attestor independently checks owner JWT and registered asset row. No CI result was available at writing; do not count these tests as passed. Next: run CI and fix any TS/test errors; inspect the actual project-assets registration path and connect a trusted server handler that verifies the committed row, then exercise real local Supabase race tests. No production or frontend changes.
