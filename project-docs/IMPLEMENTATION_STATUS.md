# Implementation Status (historical)

# Kadmeion · Build · Showcase · Evolve

**Implementation status (12 November 2026):** B0 foundation, B1 private identity and authorization groundwork, B2 private project and asset persistence groundwork. No frontend, publish host, email provider, production-ready Auth flows or full app deployment yet.

## Backend implemented

- Node 22/npm monorepo, TypeScript contracts and GitHub Actions CI.
- Supabase Auth profile bootstrap, owner-private profiles and sharing preferences, isolated operator role grants.
- Private link-based projects, private project exposure requests, asset metadata and a private image Storage bucket.
- RLS policies for profiles, sharing, projects, exposure intents, assets and Storage objects.
- Synthetic A/B tenant-negative checks performed against dedicated Kadmeion PostgreSQL and rolled back.
- Database migration filenames match the hosted Supabase migration history.

## Verification commands

- npm ci
- npm run typecheck
- npm test
- npm run check:file-budget

Local pgTAP SQL tests in supabase/tests require Docker and Supabase CLI; they are not claimed as executed. Hosted signup, email recovery, SMTP, OAuth, object upload/download and browser E2E remain unverified.

Never expose privileged/service-role keys in client bundles. Project exposure settings represent intent only and do not make projects publicly accessible until independent B4 delivery proof.

## Documentation (not counted as code)

- [Handoff](project-docs/NEXT_SESSION_HANDOFF.md)
- [Approved design](project-docs/design.md)
- [Database/RLS model](project-docs/docs/04_engineering/DATA_MODEL_RLS_AND_STORAGE.md)
- [File-count policy](project-docs/FILE_COUNT_REPORT.md)

All project-docs files remain unchanged.


> B0–B2 snapshot before further backend milestones. Superseded by later code/CI evidence.

## 14 November 2026 — Verified B4 atomic private frozen-revision loader

**Branch:** `feat/b0-backend-foundation` in `SubhashKumar14/Kadmeion`. The older `DevFolio-App` repository is reference-only. The handoff's “implementation not started” statement is a historical 12 November snapshot, superseded by actual commits and CI; it is not current implementation status.

**Code:** [`a5d53a4`](https://github.com/SubhashKumar14/Kadmeion/commit/a5d53a4693bdbfce70dc64f4534ba119cf2dc692) added `load_private_frozen_revision(uuid)` as an owner-only Supabase RPC and changed the private frozen-revision client to use it instead of three separate REST reads. It joins owner, portfolio, immutable revision and frozen request in one database transaction, locks the portfolio against concurrent Trash writes, recomputes the canonical `jsonb::text` SHA-256 and rejects mismatched pins or trashed records. The new RPC returns private snapshot bytes **only to the authenticated owner**, not a public URL or release authority. SQL pgTAP, contract and local Auth/PostgREST integration tests cover tenant denial, Trash, restore, tampering and malformed receipts. [`79b98b8`](https://github.com/SubhashKumar14/Kadmeion/commit/79b98b8808a44397e4d011c9e9f39c88608cc01f) corrected a regression test that wrongly expected a valid-but-different portfolio UUID to be rejected without a known expected portfolio ID; no runtime logic was changed in that follow-up.

**Verified checks:** [GitHub Actions push run 43512296939](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43512296939) passed both `contracts` and `database` jobs. Contract job: `npm ci`, `npm run typecheck`, auth build/smoke, isolated auth-preview build verification, **127/127 Node tests**, and file-budget check **108 authored application/config/test files / planned 200**. Database job: `supabase start`, `supabase test db` **PASS**, and **12/12 local GoTrue/PostgREST/Storage HTTP subtests**. These are ephemeral local CI results, **not** hosted Supabase, browser E2E, production security, accessibility, or deployment proof. No dedicated lint or SAST command is configured; do not claim either passed.

**Source resolution:** The [Notion LIGHT 52-screen register](https://app.notion.com/p/417b082297c781c49168c54b656d9cca) ends with the owner's explicit **52/52 LIGHT screens approved** and **do not generate a DARK set**; older per-batch pending statuses are superseded for those exact images only. These images are chat-session artifact addresses rather than durable hosted assets. Do not implement from rejected Canva designs or infer that image approval proves a functional screen. Backend-first gate remains in force.

**Deployment boundary:** GitHub's existing Vercel integration automatically produced a **nonproduction preview** on branch pushes. No manual deployment, production promotion, host-selection approval, public portfolio publishing or verified public revocation occurred in this run. The `vercel.json` auth preview is not the 52-screen frontend or a public static portfolio host.

**Remaining B4/B5/B6 gaps:** host-neutral immutable release artifact generation/verification; approved public host and independent route/asset revocation; real staging token serving, atomic live pointer and rollback; account erasure/retention; hosted email/provider verification; full security, browser and accessibility testing. A frozen private revision is **not** a published release. The host-selection proof gate in `docs/04_engineering/STATIC_RELEASE_HOSTING_AND_EXPORT.md` is still unresolved.

**Next run:** start with latest CI/branch verification, then implement and test a host-neutral immutable static release artifact manifest and checksum verifier against a pinned frozen revision. Keep the public publishing switch and reviewer route disabled until an approved host can prove route and direct-asset revocation; preserve the last verified live release on failure.


## 14 November 2026 — B4 host-neutral immutable PRIVATE artifact candidate

**Baseline:** verified branch head 08b2b81 and its successful push CI (run 43512600549). Active repo is SubhashKumar14/Kadmeion, not historical DevFolio-App. The Notion LIGHT 52-Screen Image Approval & Asset Address Register ends with explicit owner approval of all 52 original LIGHT screen images and a prohibition on producing a DARK mockup set. This approval does not authorize unapproved Canva variants or prove application behavior. Current work remains backend-first.

**Implementation:** commit [7ae3c1f](https://github.com/SubhashKumar14/Kadmeion/commit/7ae3c1fe456c07edb9356c654fddd83ba9f0aff7) introduces packages/storage-adapters/src/private-immutable-artifact.ts, exports it from the storage-adapters index, and adds tests/editor/private-immutable-artifact.test.ts. The candidate is derived solely from a validated frozen owner revision and trusted scriptless safe-preview render plan. Its private manifest pins portfolio ID, revision, snapshot SHA-256, intended visibility, exact index.html byte length and SHA-256; the manifest itself has a SHA-256 digest. Verification re-renders against the expected pinned input, rejects changed bytes, additional files, changed source pins and fabricated public authority. Private source, user-owned TSX and credentials are not included in rendered HTML. Both API and manifest explicitly return deployable:false and publicUrl:null; **this is not a deployable release, public host, staging route or publishing proof**.

**Checks:** [GitHub Actions push run 43519648208](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43519648208) passed both contracts and database jobs on commit 7ae3c1f. Contracts job passed npm ci, TypeScript typecheck, auth build/smoke, isolated auth preview verification, Node test suite including the new negative tests, and file-budget check. Database job passed local Supabase startup, pgTAP and local Auth/PostgREST/Storage HTTP integration. No hosted-provider, browser E2E, lint, dedicated SAST, full WCAG, Vercel runtime alignment or public host proof is claimed. No production change or manual Vercel deployment was performed; Git integration may still create its existing nonproduction auth previews on branch pushes.

**Security boundary and next action:** the database RPC checks the canonical snapshot digest atomically at load time, but a mutable client-side snapshot can theoretically be altered after loading. The artifact verifier detects tampering *relative to the supplied input*; it does not independently attest that a subsequently modified in-memory snapshot still matches the database's canonical PostgreSQL jsonb-text SHA-256. Before enabling any real public delivery, implement an immutable/canonical snapshot attestation across the loader-to-renderer boundary (with negative tests for post-load mutation), then require an explicitly approved host with proven canonical-route and direct-asset revocation/rollback. The current public delivery blocker remains mandatory. Account erasure, hosted Brevo/email, full auth integration, accessibility and browser E2E are still open.


## 14 November 2026 — B4 canonical frozen snapshot attestation at the loader-to-artifact boundary

**Verified baseline:** active implementation repository is `SubhashKumar14/Kadmeion`, branch `feat/b0-backend-foundation`, from previous head `7f762db`; `DevFolio-App` is historical/reference-only. The latest Notion LIGHT 52-screen approval register ends with explicit 52/52 LIGHT image approval and no DARK mockup set. These are static image approvals, not frontend implementation or public-host approval. Older Notion pending labels and the original handoff's “implementation not started” statement are superseded.

**Implementation commits:** [`cf8dd6e`](https://github.com/SubhashKumar14/Kadmeion/commit/cf8dd6e4641373ff15801ac16c45dd9455f72818) adds a new owner-only `load_private_frozen_revision` SQL migration preserving its atomic authorization/Trash/digest check and returning `snapshotCanonicalJson` from PostgreSQL `jsonb::text`. The browser-side loader hashes these **exact** canonical UTF-8 bytes against the pinned database SHA-256, parses and validates them, checks that the parallel JSON snapshot agrees, recursively freezes the parsed object, and registers its identity in a process-local WeakMap. Added SQL, contract, and real local-HTTP assertions. [`5969745`](https://github.com/SubhashKumar14/Kadmeion/commit/59697457f19280e3dbb97cbc97ad17c3cb1621d6) requires this attested object before generating/verifying the private immutable artifact; new tests reject post-load mutation, clones, fabricated SHA fields, modified pins, and tampered artifact bytes. Unattested callers can still run the **preview-only** preflight, but cannot generate a private immutable artifact.

**Verification status at documentation time:** [GitHub Actions push run 43527392458](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43527392458) `contracts` job **PASS**: `npm ci`, `npm run typecheck`, auth build/smoke, isolated auth preview verification, `npm test`, and `npm run check:file-budget`. `database` job was still **RUNNING** during `supabase start`; pgTAP and local GoTrue/PostgREST/Storage HTTP integration tests are **NOT YET VERIFIED** for this commit. Do not upgrade that to PASS without checking the completed run. No dedicated lint, SAST, browser E2E, hosted email, live provider, or public-route proof was executed here.

**Security scope:** This is a *private client-process integrity gate*, not a signed server release, host-level authorization, proof of post-read revocation, or protection from compromised same-origin JavaScript. Public publishing, reviewer serving, rollback and route/direct-asset revocation remain disabled/unproven. Vercel Git integration may automatically build existing nonproduction auth previews on feature-branch pushes; no manual Vercel deployment, production promotion, or production database modification was performed.

**Next run:** first inspect the completed database job for commit `5969745` and repair any pgTAP or HTTP regression. Then implement and test a narrow B5 owner-only account-erasure *request/status* and retention workflow with explicit fail-closed public-route revocation dependency; do not perform irreversible deletion or claim external backups/CDN caches are erased. Preserve the existing B4 host-selection and public revocation proof gate, and do not start the 52-screen frontend until backend gates are met.

**Post-run verification addendum (same code commit):** [CI push run 43527392458](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43527392458) subsequently completed both `contracts` and `database` jobs successfully. Database steps `supabase start`, `supabase test db` (pgTAP), and the local real GoTrue/PostgREST/Storage HTTP integration test all report **PASS**. This updates the earlier running status for that code commit; it does not prove a hosted public deployment, browser E2E, external email, lint or SAST.

## 14 November 2026 — B5 owner-only account-exit REQUEST / withdrawal (no erasure)

**Verified baseline:** `SubhashKumar14/Kadmeion` on `feat/b0-backend-foundation`, previous head `12b7d91`. Historical `DevFolio-App` is reference-only. The latest Notion LIGHT image register confirms owner approval of exactly 52 original LIGHT screen images and expressly prohibits generating a DARK mockup set; image approval does not authorize frontend substitutions or public deployment. Governing account-exit decisions are UI-92/112, WF-047, and `set_07_account_exit.md`.

**Code:** [`4649cc0`](https://github.com/SubhashKumar14/Kadmeion/commit/4649cc09b2d755529112241753345bf244146650) adds a private, RLS owner-only `private_account_erasure_requests` journal, signed-in owner request and withdrawal RPCs, typed-confirmation validation, idempotent operation IDs, one-active-request constraint, bounded request quota, read-only owner history projection, browser-side Supabase client with no redirects/cookies/cache, and SQL/Node/real local HTTP tests. Owner requests are explicitly `REQUESTED_BLOCKED`, withdrawals `WITHDRAWN`. All server-enforced proof flags remain FALSE: `public_revocation_verified`, `reauth_verified`, `access_terminated`, `erasure_executed`, `retention_verified`. No irreversible deletion RPC, worker, session revocation, public route, or hosted cleanup was created. Typed confirmation is **not** provider-verified recent reauthentication. Item Trash retains its separate 15-day recovery contract.

**Verification:** [GitHub Actions push run 43534756934](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43534756934) completed both jobs **PASS** for `4649cc0`: application `npm ci`, TypeScript typecheck, auth build/smoke, isolated preview verification, `npm test`, file-budget; database ephemeral Supabase startup, pgTAP migrations/tests, and real local GoTrue/PostgREST/Storage HTTP integration. This is not hosted Supabase or browser E2E proof. The checked Git tree contains **115 authored application/config/test files of the proposed 200**; project documentation is excluded. No dedicated lint, SAST, hosted email, account reauthentication proof, or public-route/direct-asset revocation proof was run.

**Retention disclosure and nonclaims:** The request **does not** end access, delete primary data, schedule a purge date, revoke live URLs or prove deletion from external backups/CDN caches/web archives. No verified provider backup retention window or account-erasure SLA exists. Future destructive execution requires separately verified recent reauthentication, export and affected-data inventory, trusted host route **and direct-asset** revocation, retention disclosure, and a privileged auditable worker; failure must remain blocked, not be reported as success. Do not assume the per-item 15-day Trash timer applies to account erasure.

**Deployment:** Git integration automatically created a nonproduction Vercel auth preview from the feature-branch push; no manual Vercel deploy, production promotion, host selection, production DB mutation or public publishing was authorized or performed.

**Next action:** implement a bounded owner-only account-exit preflight/footprint (projects, portfolios, current release intents and export readiness) with tenant-negative SQL/HTTP tests, and define/test an actual recent reauthentication proof contract without treating a mere JWT or typed phrase as reauthentication. Keep erasure execution and public delivery disabled until independent host revocation and retention evidence are verified.


## B5 account-exit preflight — local implementation checkpoint (14 November 2026)

- Added an owner-only, count-capped (1,000 per category) advisory RPC and typed client.
- Counts are scoped to the requesting owner and include projects, portfolios, portfolio revisions,
  exposure intents, project asset *metadata*, frozen release intents, reviewer grants, Trash
  records and account-exit requests. Counts include historic/trashed rows where applicable.
- Requires a server-side `auth.sessions` row matching the authenticated JWT `session_id`;
  a signed-out JWT or a subject claim alone is not sufficient for access.
- A session created within five minutes is reported only as `freshSignInCandidate`.
  **This is not verified reauthentication**: `recentReauthVerified=false` and
  `deletionAllowed=false` are hardcoded, with no destructive worker.
- There is no export queue or integration inventory, public-route resolver, Storage object
  reconciliation or backup retention proof. Those are explicitly `NOT_TRACKED` /
  `UNVERIFIED` / `METADATA_ONLY`. Advisory counts are not an atomic purge manifest.
- Tests cover malformed receipts, unauthenticated/forged requests, tenant-scoped live
  GoTrue JWT preflight and signed-out session rejection. Check actual latest CI run
  before marking database tests as passed; no hosted Supabase changes authorized.


## B5: explicit recent reauthentication evidence (14 November 2026)

**Verified code (not account deletion):** Commits `62bca5a`, `09fc5c9` and
`046c126` add a server-only 5-minute reauthentication challenge table,
begin/complete RPCs, a typed client and response-specific errors. The owner
starts the challenge under one *live* GoTrue session, then performs a second real
sign-in to create a *different* session for the same owner. Completion proves
that the second session was created after the challenge, remains in
`auth.sessions`, belongs to the same owner, and is within the 5-minute window.
Old-session replay, cross-user completion, missing session, private-table access,
and false deletion receipts are rejected by tests. This is a deliberate recent
sign-in proof, **not proof of MFA, host revocation, or erasure readiness**.
The erasure-request journal retains its DB-enforced false proof flags; there
is no deleting worker, access termination, published content or hosted setup.

**CI evidence:** [GitHub Actions 43539180463](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43539180463)
passed 150 Node tests, 24 local Supabase HTTP integration tests, database pgTAP,
TypeScript, auth builds and file budget on commit `09fc5c9`. Subsequent
client error-mapping and documentation commits require separate CI confirmation.
The earlier B5 preflight commit `e823fe3` passed 147 Node and 20 HTTP tests
in [CI 43538636801](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43538636801).

**Evidence/scope limitations:** Counts are bounded informational snapshots,
not a transactionally frozen deletion inventory. Public routes and direct assets
are NOT verified, object Storage is only counted by registered metadata, and
exports/integrations are NOT TRACKED. Challenge retention cleanup is unimplemented.
No hosted data was queried or modified. No frontend screens were produced.
The latest Notion approval record supersedes older pending lists and confirms
52/52 original LIGHT screens approved; no DARK mockup set is authorized.

**Next backend critical path:** Design and test a host-neutral public route
visibility/revocation pointer plus direct immutable-asset denial contract, with
fail-closed privacy semantics and no deployment. Do not start destructive account
cleanup or claim public revocation before real host and cache tests are approved.


## 14 November 2026 — B4 host-neutral public route AND direct-asset denial policy

**Source reconciliation:** Active code repository is SubhashKumar14/Kadmeion,
branch feat/b0-backend-foundation; main remains documentation-only and the old
DevFolio-App is reference-only. Latest Notion 52-screen LIGHT register ends
with **52/52 exact original images approved** and **no DARK screen set**.
Older Canva/pending approval documents are superseded for those images only.
No frontend code or production deployment was authorized or added.

**Backend-only code:** Added typed PrivatePublicDeliveryPolicy in
packages/storage-adapters/src/public-delivery-policy.ts, exported from the
package index, with focused synthetic negative tests. It requires a fresh
trusted host-side visibility read separately for canonical HTML and every
direct immutable asset. It fails closed on unavailable/malformed/stale state,
private/unpublished/restricted pointers, incomplete revocation generation,
wrong release digest, non-allowlisted asset, path traversal and mismatched
content hash. A positive match returns HOST_PROOF_REQUIRED, always
deployable:false and publicUrl:null, **never content or HTTP permission**.
SVG is excluded due to active-content risks; future CSS hosting requires
trusted generation/sanitization. No actual public pointer database table,
authoritative host adapter, route interception, cache invalidation, CDN
revocation, rollback or public publication is implemented.

**Evidence:** Isolated local Node 22.16 --experimental-strip-types policy
tests and isolated TypeScript 5.8.3 strict module check passed before commit.
The GitHub Actions contracts and database jobs for the final branch commit
must be checked independently; do not claim them passed before they finish.
Earlier baseline commit 8d7b37a passed both jobs in runs 43539692728 and
43539687607. No hosted Supabase, real HTTP public-route tests, browser E2E,
lint, SAST, accessibility or provider/hosting proof was performed.

**Security caveat:** The policy trusts the injected reader's authority and
read freshness; a timestamp or generation field is not cryptographic proof
of strong consistency. A CDN/direct release URL that bypasses this gate
would invalidate the privacy guarantee. Do not wire a public HTTP handler
to HOST_PROOF_REQUIRED or report successful revocation without a selected
approved host and live canonical + direct-asset negative tests.

**Next critical action:** implement an owner/administrator-scoped,
transactional *private* release visibility/revocation pointer and a trusted
read contract with tenant/role tests. Keep all serving disabled until an
explicitly approved free host proves interception, cache controls,
unpublish, direct asset denial and rollback under races.


## 14 November 2026 — B4 private transactional release candidate/denial pointer

**Baseline and source precedence:** Verified active repository SubhashKumar14/Kadmeion,
branch feat/b0-backend-foundation, previous head 8de3775 (not the old DevFolio-App).
[CI 43541363249](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43541363249)
has now completed both contracts and database jobs PASS; the prior handoff left
the database result pending. The [Notion image approval register](https://app.notion.com/p/417b082297c781c49168c54b656d9cca)
ends with 52/52 original LIGHT images explicitly approved and no DARK mockup
set. Earlier per-batch pending labels and older dark-screen plans are superseded;
rejected Canva variants remain excluded. Original screenshot addresses are
session-local, not verified downloadable here. No frontend was started.

**Feature-branch commits:**
- [d322c0e](https://github.com/SubhashKumar14/Kadmeion/commit/d322c0eea986d02f160b653d020d882e1f3284d7):
  private owner-scoped visibility pointer and immutable operation journal with
  RLS, expected-generation CAS, idempotent operations, frozen-revision DB digest
  checks, and atomic candidate blocking on portfolio Trash. Only BLOCKED and
  PREPARED_PRIVATE exist; no LIVE state, public reader, host or URL.
- [22f164a](https://github.com/SubhashKumar14/Kadmeion/commit/22f164a25b7ecd947fe8ffc64369a0afc5f392f1):
  pgTAP owner isolation, direct-privilege, CAS, replay and Trash tests.
- [f6f4efb](https://github.com/SubhashKumar14/Kadmeion/commit/f6f4efb1bed75c60e56c5298cd24155e53ef8ee5),
  [9062bc5](https://github.com/SubhashKumar14/Kadmeion/commit/9062bc56c0d9fce40c3cd098e457fa87256479bc),
  [caf12bd](https://github.com/SubhashKumar14/Kadmeion/commit/caf12bdeefeb0eaf06e4c1790246b644da290c28):
  typed Supabase owner API client, fail-closed receipt validation, negative
  tests and package export.
- [72eab88](https://github.com/SubhashKumar14/Kadmeion/commit/72eab884bfe9469066e8a540ebfd2b14c368fa86):
  local real JWT/PostgREST owner/outsider, direct-write, CAS and Trash tests.
- [675d040](https://github.com/SubhashKumar14/Kadmeion/commit/675d0408df35e7fdc622396103e474c75e4f0c98),
  [06c8183](https://github.com/SubhashKumar14/Kadmeion/commit/06c8183dc7ce7721ec4f516b3050df698844547b),
  [7f04364](https://github.com/SubhashKumar14/Kadmeion/commit/7f043642ba5d2bd56b89450cbcb898be879b56f3):
  reject stale prepare-operation replay after a later block, with SQL and
  HTTP regression coverage. Historical idempotency must not imply current
  visibility.

**Verification at documentation time:** [CI 43546831045](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43546831045)
passed both contracts and database jobs for the initial migration and pgTAP
tests. Contracts on [CI 43546893135](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43546893135)
and [CI 43546936393](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43546936393)
passed TypeScript, Node tests, auth build/smoke, preview bundle checks and
file budget. Check final-head CI before claiming the latest stale-replay and
real HTTP integration tests passed. Dedicated lint, SAST, browser E2E,
hosted Supabase, production security and accessibility remain untested.

**Security boundary:** The candidate manifest SHA is owner-submitted,
not independently attested. Database generation is not proof of host/CDN
revocation. All receipts explicitly say publicServingEnabled=false,
hostRevocationVerified=false and publicUrl=null. PREPARED_PRIVATE and
HOST_PROOF_REQUIRED cannot authorize HTTP 200. A future explicitly approved
host must prove authoritative reads, canonical-route and direct-asset
interception, cache behavior, unpublish/rollback races and provider-failure
denial before public serving. No production DB mutation, manual Vercel
deployment or account deletion was performed. Git integration may still
produce existing nonproduction auth previews.

**Next action:** Verify final-head CI and repair failures; then implement
a moderation-case-bound operator BLOCK-only path with role/tenant-negative
tests, never operator prepare/publish authority. Keep public serving disabled.


**Post-run CI verification and correction:** The first stale-replay regression
test insertion contained a malformed SQL dollar-quote, causing database
CI failures (e.g. [43547031920](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43547031920)).
No runtime migration failure was reported; the pgTAP file stopped parsing.
[6ec95f6](https://github.com/SubhashKumar14/Kadmeion/commit/6ec95f69c0ae50f0742d1b4062963d5cfb49a4d8)
replaced the malformed delimiter with a named SQL dollar quote.
[Final code CI 43547240987](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43547240987)
completed **both jobs PASS** on that fix: 169/169 Node tests; 229 pgTAP
assertions across 16 files; 25/25 real local Supabase HTTP subtests;
TypeScript, auth build/smoke, isolated auth-preview verification and
125/200 authored application/config/test file budget. This proves the
ephemeral local CI paths, not a hosted provider, browser E2E, CDN revocation,
production security, lint, SAST or accessibility. No public route enabled.


## B4 trusted private canonical/direct-asset read — 14 November 2026

**Verified baseline:** Active repo `SubhashKumar14/Kadmeion`, branch
`feat/b0-backend-foundation`, prior head `b684449`. The original DevFolio
repo is historical only. Latest Notion owner register supersedes older pending
records and confirms **52/52 original LIGHT screens approved**, no DARK mockup
set and no permission to substitute rejected Canva mockups.

**Implementation:** `kadmeion_private.private_delivery_denial_gate` is a
service-role-only, non-exposed SQL RPC that performs one fresh private-pointer
read for either canonical HTML or a content-addressed direct immutable asset.
It validates input shape/digest and returns only an explicit **DENY**, a minimal
generation/revocation fence and `hostRevocationVerified=false`. Prepared
candidate, blocked state, missing portfolio, malicious paths, mismatched
hashes and unavailable providers never grant serving permission. The paired
`PrivateServerDeliveryDenialGate` TypeScript contract consumes this response
and rejects forged ALLOW receipts, public URLs, contradictory counters and
extra private data. There is **no public-serving implementation** here.

**Checks/evidence:** Initial code commit
[`1b29acb`](https://github.com/SubhashKumar14/Kadmeion/commit/1b29acbce127642d85feac282b1f373c9e26788e)
passed local database/pgTAP and HTTP CI but application CI detected
unsupported Node 22 parameter-property syntax. Fix commit
[`750c0bd`](https://github.com/SubhashKumar14/Kadmeion/commit/750c0bd26c202988be40d44378b7518bd4f8b34b)
passed application CI; check final SQL/HTTP and post-documentation CI separately.
Added an extra HTTP check that the internal RPC cannot be reached through
PostgREST even using a service role. Do not infer a host-level negative test
from an internal SQL test.

**Unresolved critical blocker:** No chosen/authorized external public host,
route adapter, cache proof, direct immutable object interception, rollback,
public-view verification, hosted email or production data lifecycle. SQL
pointer revocation does **not** prove previously cached hosted bytes are
inaccessible. No new frontend designs, manual Vercel deployment, production
change, account purge, or public release occurred.

**Next action:** Validate the final CI and then implement a verified
server-side artifact/manifest-to-private-candidate binding contract, without
activating a live pointer. Before any public serving, obtain approval for
the host and prove canonical/direct-asset 404/410, cache behavior, rollback
and privacy revocation in a nonproduction environment.


## 14 November 2026 — B4 trusted private artifact-to-pointer binding

**Verified baseline:** Active repo `SubhashKumar14/Kadmeion`, branch
`feat/b0-backend-foundation`, previous head `bbc3175`. Older DevFolio
repo is historical. Owner's latest Notion register confirms all 52 exact
LIGHT screen images approved and prohibits generating DARK-theme mockup
sets; static approval is not application implementation proof.

**Committed private-only functionality:** New
`kadmeion_private.private_artifact_bindings` registry (RLS, no anon or
authenticated privileges), and non-exposed
`kadmeion_private.bind_private_artifact_candidate()` executable only by
`service_role`. It acquires the owned portfolio row lock BEFORE the
candidate pointer lock, rehashes the frozen DB snapshot, verifies its
revision/visibility/source pins, checks expected pointer generation and
status, recomputes SHA-256 over supplied exact UTF-8 HTML and manifest
text, requires a single precisely matching `index.html` manifest,
and inserts an immutable, idempotent **private** binding for that
generation. Block/Trash or pointer replacement causes conflict;
historical bindings are never serving grants.

The `private-artifact-pointer-binding.ts` server-only orchestration
requires an *attested* frozen revision from the authenticated owner
loader, builds/independently verifies the safe scriptless HTML artifact,
compares the currently prepared private pointer and its manifest hash,
then invokes an injected **restricted SQL writer**. It validates
the returned receipt and never exposes public serving permission.
This module is intentionally NOT exported from the browser-facing
storage-adapters index. The runtime SQL writer is an interface,
**not yet wired to a real hosted server connection**. In particular,
SQL verifies byte/hash/source consistency but cannot prove that a
privileged caller used the trusted renderer; the deployed worker must
satisfy that prerequisite. No public release is served.

**Code references:** `6597b99` (restricted binding schema and pgTAP),
`ba13181` (trusted orchestration and Node negative tests),
`6e100c4` (fixed test harness without widening DB rights),
`2baf79c` (added real local HTTP tests that private binding
RPC/table remain unreachable through PostgREST even with service role).

**Verified CI:** [GitHub Actions 43549661331](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43549661331)
passed both jobs at `6e100c4`: 180/180 Node tests,
268 pgTAP tests in 18 SQL test files, 26/26 local GoTrue/PostgREST/Storage
HTTP tests, TypeScript, auth build/smoke/preview, file budget 133/200.
The HTTP-denial commit `2baf79c` has its own CI; confirm completion
before calling that extra test passed. No hosted Supabase, production
database, public HTTP route, CDN invalidation, browser E2E, lint or
dedicated SAST was verified.

**Security and release caveat:** Owner-provided manifest digest alone
remains untrusted. A trusted worker must rebuild rendered bytes and
obtain a matching restricted binding; neither binding nor hash equality
authorizes public visibility. Public host, immutable asset URL
interception, cache behavior, rollback races, selected free-tier
deployment and real host revocation remain unverified. There was no
manual Vercel deploy, production promotion, hosted data mutation,
account erasure or frontend implementation in this run.

**Next backend critical action:** Implement and locally integration-test
the **server-only direct-SQL binding executor** (without exposing
service credentials to client/Edge previews); prove it consumes a
frozen owner-RPC snapshot and writes only independently verified bytes
to the restricted binding RPC, with concurrency/revocation and malicious
renderer/manifest negatives. Do not activate public hosting until owner
approval and live canonical/direct-asset negative tests.


## 14 November 2026 — B4 server-only parameterized PostgreSQL binding adapter

**Baseline:** Active implementation branch `feat/b0-backend-foundation` at
`655d79d` before this iteration, not the historical DevFolio repository.
[CI 43549982097](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43549982097)
had passed on that baseline. Notion's final owner approval register explicitly
confirms **52/52 original LIGHT screen images** and prohibits a DARK screen
set. Exact image paths are session-local, not verified recoverable in this run.
No frontend work was authorized before the remaining backend gates.

**Code changes (feature branch only):**
- [aae3cda](https://github.com/SubhashKumar14/Kadmeion/commit/aae3cda0643cd3ce46298c8d3ddf94c7fc50b573):
  `private-artifact-direct-sql-writer.ts` provides a server-only, structurally
  `pg.Pool`/`pg.Client`-compatible query adapter. It invokes ONLY the
  parameterized `kadmeion_private.bind_private_artifact_candidate` SQL function,
  validates UUID/generation/UTF-8 sizes and NUL rejection, never interpolates
  HTML/manifest into SQL, and sanitizes provider errors. It is deliberately
  NOT exported from the browser-facing storage-adapters index.
- [8f1e6cf](https://github.com/SubhashKumar14/Kadmeion/commit/8f1e6cf883b3b5d78c4a8f3f96b3f3a43414e4f1):
  adapter validation, parameterization, failure and malformed receipt tests.
- [497e902](https://github.com/SubhashKumar14/Kadmeion/commit/497e902801910b935cb06d073c841ebf90f6ba3a):
  end-to-end-in-process adapter/orchestrator test from an attested frozen
  fixture to SQL query arguments and a simulated pointer-revocation error.
  [0cfb108](https://github.com/SubhashKumar14/Kadmeion/commit/0cfb10899db4f5fd8e04a2a4df2d45be3b90efdf)
  corrected an over-escaped regex assertion in that test; the intermediate
  commit's contracts CI failed, final code CI passed.

**Verified final-code CI:** [run 43552260096](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43552260096)
completed **contracts and database PASS** on `0cfb108`: TypeScript,
auth build/smoke (12 checks), isolated auth-preview verification (10 checks),
**184/184 Node tests**, **268/268 pgTAP assertions in 18 files**,
**27/27 local real GoTrue/PostgREST/Storage HTTP subtests**, and
**135/200** authored application/config/test file budget. A separate local
Node strip-types run passed the 3 adapter unit tests. Dedicated lint, SAST,
browser E2E, accessibility, hosted Supabase and real direct-`pg` driver
integration were **NOT RUN**.

**Security boundary:** This is a concrete SQL query adapter, not a deployed
worker or an independently tested database connection. The `pg` dependency,
restricted worker DB credential provisioning, actual driver/connection lifecycle,
local SQL executor integration and real concurrency test are NOT wired.
The existing trusted orchestrator must rebuild verified bytes; SQL verifies
the frozen source and pointer but cannot certify renderer provenance. The
private binding receipt is NEVER a public-serving grant. No public host,
direct-asset interception, cache revocation, live pointer, production write,
manual Vercel deploy or irreversible account erasure was performed. Existing
Git integration automatically created nonproduction auth previews on pushes.

**Next concrete action:** In a nonproduction local Supabase stack, provision
a narrowly scoped direct-PostgreSQL worker role/connection and test this
adapter with an actual `pg` client against the existing private binding RPC,
including concurrent owner block/Trash and tampered HTML/manifest. Do not
enable public serving or production credentials. Then continue moderation
operator block-only and remaining B4/B5/B6 gates.

## 14 November 2026 — B4 local direct PostgreSQL binding integration

**Verified baseline:** Active `SubhashKumar14/Kadmeion` branch
`feat/b0-backend-foundation`, starting from `dc1aa32`; Notion latest
approval register confirms **52/52 original LIGHT mockups approved** with
no DARK mockup set authorized. Prior direct SQL adapter and private
artifact binding contracts were already implemented and not recreated.

**Added (local-only, no provider secrets):**
`tests/integration/local-postgres-binding.test.mjs`, run in the
database CI job with explicit `KADMEION_LOCAL_INTEGRATION=1`.
It requires local Supabase URLs `127.0.0.1:54321` (API) and
`127.0.0.1:54322` (PostgreSQL), generates a random local temporary
PostgreSQL LOGIN role, grants only private schema USAGE and EXECUTE of
`kadmeion_private.bind_private_artifact_candidate`, and revokes/drops it
after the test. It checks that role cannot directly SELECT the
binding journal or UPDATE the private pointer.

The test uses **real PostgreSQL's psql wire client** with a prepared SQL
statement and quoted variables as an injected `pg`-compatible query port,
rather than installing a runtime `pg` package. It authenticates a real
local GoTrue owner, creates a private portfolio, commits and freezes an
immutable revision, loads the owner-attested revision, builds a scriptless
artifact, prepares the private pointer, binds bytes through the restricted
SQL executor and confirms idempotency, current generation, no public URL,
and no host serving. Negative cases include outsider owner-loader reads,
tampered HTML/manifest, wrong request/generation, a block between pointer
read and SQL bind (database must reject), and a Trash-triggered denial.
No additional production runtime packages or hosted credentials were added.

**Verified CI evidence:** [Run 43555748754](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43555748754)
passed both application and database jobs at commit `709f824`:
**184/184 Node tests**, **268 pgTAP assertions**, **27/27 real local
GoTrue/PostgREST/Storage HTTP tests**, **1/1 restricted PostgreSQL
wire integration test**, TypeScript, auth build/smoke/preview and source
file budget **136/200**. Initial failed runs were corrected: Node 22
test type-stripping flag and PostgreSQL boolean display test assumption.
The additional byte tampering and TOCTOU revocation coverage are in
the final passing run. These results do not demonstrate real host
revocation, uptime, public publishing or browser accessibility.

**Remaining:** The production Node `pg` Pool/client, connection lifecycle,
password/TLS provisioning, external host trust boundary, cache/direct
immutable asset interception and a deployed restricted worker are
not implemented or tested. The CI-only `psql` bridge MUST NOT be used as
a production server adapter. The internal DB binding is never a public
serving authorization. Account erasure stays disabled. No manual Vercel
deploy, production DB mutation, or frontend work occurred.

**Next:** Introduce a pinned, lockfile-managed `pg` driver for a
server-only restricted worker, test its real connection lifecycle and
hard fail-closed behavior locally without exposing credentials to a static
bundle; then continue operator moderation BLOCK-only and B6 gates.
Any public host, production deployment, irreversible deletion or
new design requires separate authorization.


## 14 November 2026 — B5 case-bound operator PRIVATE candidate block

**Baseline/source reconciliation:** Active repository is `SubhashKumar14/Kadmeion`,
branch `feat/b0-backend-foundation`, starting at `6225fb2` (both CI jobs
passed in [run 43556012831](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43556012831)).
The original `DevFolio-App` is reference-only. Latest explicit Notion owner
decision approves **all 52 original LIGHT screen images** and prohibits a DARK
mockup set; older pending statuses are superseded. Session-local image paths
are not durable hosted assets. This iteration did not touch frontend designs.

**Implementation:** `0678eeb` is the restored, complete source-tree commit
adding `supabase/migrations/20261114095000_case_bound_operator_private_block.sql`
and `supabase/tests/case-bound-operator-private-block.sql`. It creates a
private, RLS-protected, portfolio-specific moderation hold tied by foreign keys
to an existing operator case and its owner. A moderator/administrator can
invoke `operator_block_private_portfolio(case,portfolio,operation)` only
against an existing case for that portfolio owner. The function locks the
portfolio before the pointer, atomically clears a prepared candidate,
increments revocation generation and writes an immutable `OPERATOR_BLOCK`
audit event. An additional trigger rejects future `PREPARED_PRIVATE`
pointer writes while the hold persists. Exact replay is idempotent;
wrong-tenant case, nonoperator and conflicting operation are denied.
Case closure does **not** automatically restore the candidate.

`2ee15ab` and `093fbcb` add the typed client and fail-closed receipt
tests/fix. `eda8be5` adds real local PostgREST negatives for anonymous
and nonoperator calls, forged audit writes and private hold table exposure.
The first tree-write attempt (`6d13f16`) accidentally omitted baseline files;
the subsequent corrective commits culminated in `0678eeb`, whose
[base-to-restored comparison](https://github.com/SubhashKumar14/Kadmeion/compare/6225fb2108800851cb5a9f2a14de5dae30f2f367...0678eeb69fa877864d32566e3dde920a26a775cf)
confirms **only two added SQL files and no baseline deletions**.
The transient incomplete-tree CI failures must not be treated as final
implementation failures or silently omitted.

**Verification:** [CI 43557174030](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43557174030)
completed both jobs PASS on `093fbcb`: 187/187 Node tests, 289/289
pgTAP assertions across 19 SQL files, 27/27 local GoTrue/PostgREST/Storage
HTTP tests, one restricted direct-PostgreSQL integration, TypeScript,
auth build/smoke/preview and 138/200 authored source/config/test files.
The additional HTTP-negative commit `eda8be5` requires its own final
CI confirmation; do not claim its added test passed until checked.
No dedicated lint, SAST, browser E2E, hosted-provider verification,
accessibility or real public-host revocation was performed.

**Security boundary:** This is an enforced *private database hold* and
owner-visible audit, NOT a verified live-site takedown, email notice,
CDN purge, direct-asset invalidation or permission to serve a portfolio.
There is deliberately no automatic operator restore or public allow path.
No production mutation, account purge or manual Vercel deployment occurred.
Existing Git integration automatically produced nonproduction auth previews
on feature-branch pushes.

**Next action:** Check the completed CI for `eda8be5`; then implement a
server-only, pinned and lockfile-managed `pg` client with least-privileged
connection lifecycle against ephemeral local Supabase, without exposing DB
credentials in any browser bundle. Continue B6 moderation/revocation negative
tests; public serving remains disabled pending approved host and canonical
route/direct-asset/CDN revocation proof.
