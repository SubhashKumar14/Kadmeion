# Kadmeion — Current Backend Implementation State

## B08–B11 backend continuation

The existing release host now serves scoped PNGs for canonical public pages, unlisted releases and token-scoped reviewer previews. The PostgreSQL media write enters the existing immutable stage atomically. Publication probes verify the normalized frozen HTML and exact same-origin media before acknowledgement. Public rollback requires explicit owner consent, a verified target at the same canonical address and a fresh host acknowledgement. Reviewer responses, direct assets and denials carry no-store.

Account exit has an explicit reauthenticated withdrawal call and a trusted CLI proof of GET/HEAD denial for the database's known canonical, API and direct-media URLs. The resulting receipt is bound to the active exit request, current publication state and a 30-minute freshness window. Reviewer grant revocation is enforced in PostgreSQL. Receipt scope excludes third-party copies, external backups and retention guarantees. Run `scripts/verify-host-revocation.mjs --account-exit <request-id>` in the trusted operator environment only after enabling `KADMEION_ACCOUNT_EXIT_HOST_RECEIPTS_ENABLED` and setting the verified host and protected Supabase configuration.

Account export has an additional single-statement PostgreSQL snapshot of all application record categories, restricted audit projections and verified release history. The client authenticates the owner, validates ownership and keeps the JSON download separate from the verified Storage archive. Over-limit accounts receive a quota error rather than a silently truncated snapshot. Provider backups, provider communications and Storage bytes are outside the metadata download.

Signup confirmation resend uses the pinned Auth callback and the same verified-delivery feature gate as registration and password recovery. The private custom preview worker accepts constrained synchronous JavaScript with explicit strings in and typed text blocks out. It has no guest host functions or public serving permission. It does not run arbitrary JSX and has no deployed browser preview route.

Deployable source migrations from `20261115130001` onward remain pending hosted authorization. Hosted acceptance still needs an approved public and reviewer host, real direct-media and rollback observations, email-domain verification and delivery, retention evidence, and full product and accessibility acceptance. Keep all production switches off pending scoped approval.

## B08 frozen image slots and private PostgreSQL persistence

- GitHub PR #1 continues on `feat/b0-backend-foundation`. The B07 hosted baseline is 47 applied migration versions and three deployed Edge Functions. Migration `20261115130001_private_frozen_media_candidates.sql` is a forward-only source change that has not been applied to the hosted project.
- The private PNG renderer binds image slots and accessible text alternatives to the attested revision, re-encodes and deduplicates the verified bytes, and preserves section layout in the static ZIP. The trusted SQL writer rebuilds from frozen slots and stores exact HTML and PNG bytes in one write-once, current-generation transaction. Each portfolio can retain up to five candidates, and candidate records cascade with their release request.
- The host withdrawal verifier checks the exact currently served media when a trusted manifest supplies the PNG paths, then checks canonical and every scoped direct path for GET/HEAD denial and cache-safety. A negative-only path does not count as previously served media.
- This private storage layer does not activate public routes, publish custom JavaScript, make historical objects directly public, or establish hosted release and reviewer revocation. A media-aware host adapter, provider acceptance and end-to-end publishing/rollback/withdrawal proof remain required.

## B09 erasure and upload cleanup share one revocation prerequisite

Pending migration `20261115130002_account_exit_storage_revocation_gate.sql` checks the same exposure predicate before listing uploads for erasure, deleting them via Storage RLS or deleting the active account. Cleanup also checks the live session expiry. This preserves private uploads for an owner whose exit is blocked by unverified release or reviewer withdrawal. The app stores no new deletion proof and keeps provider/backup erasure unverified.

## B10 email callback hardening

The auth proof accepts one unambiguous credential flow on a supported callback path. Duplicate or conflicting values, misplaced credentials and invalid email types are rejected without persisting a session. An email callback for a different account cannot replace the signed-in browser session. Hosted Brevo domain authentication, SMTP secrets and real sender delivery remain separate enablement and acceptance gates.

## B07 hosted foundation rollout — 15 November 2026

**B07 HOSTED FOUNDATION DEPLOYMENT: COMPLETE.** All 47 migrations, 3 Edge functions and live no-credential deny-by-default smoke verified; downstream production acceptance remains independent.

- [Supabase project](https://supabase.com/dashboard/project/scyooqjitjzjdxgtanso): **47 of 47 source migrations deployed**, all 47 exact filename versions present, no extra migration versions. The hosted migration ledger was aligned to original timestamps after the MCP deployment API allocated fresh timestamps; this prevented future CLI re-application of already deployed SQL.
- **Three Edge Functions deployed ACTIVE v1:** `publish` (`verify_jwt=true`), `complete-private-asset` (`verify_jwt=true`), `purge-expired-trash` (`verify_jwt=false`, separately gated by an absent-by-default 32+ character sweep secret). The first two got an explicit runtime `Deno.serve` binding in [`d93df80`](https://github.com/SubhashKumar14/Kadmeion/commit/d93df80d527078fe208222c078bfb08161be5b4c); [GitHub Actions CI 43694908230](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43694908230) passed contracts and the isolated database + Edge smoke jobs.
- **Hosted least privilege:** all public-schema tables have RLS; no public Storage bucket, `kadmeion-private-assets` private; zero anonymous-callable `SECURITY DEFINER` functions. Auth accounts remained 2, projects/portfolios/storage objects remained zero before and after the migration rollout.
- **Post-deployment advisors:** 40 authenticated callable SECURITY DEFINER warning findings; expected owner RPCs require per-function review, not automatically a confirmed leak. 14 INFO RLS-no-policy warnings (restricted service-only tables) and one leaked-password protection warning remain. These are not claimed resolved.
- **Public safety:** Release publishing, asset attestation and Trash sweeps stay disabled until independently proved/approved feature controls and secrets are configured. B07 deployment does **not** prove B08 independent host/revocation, B09 full erasure, B10 email sender delivery or B11 production acceptance.
- **Live HTTP security proof:** [GitHub Actions 43695497839](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43695497839) **PASS**, 426/426 Node tests and isolated database job both passed. Live no-credential hosted checks: `publish` POST → 401, `complete-private-asset` POST → 401, `purge-expired-trash` GET → 405, unauthorized POST → 404. These are denial tests, not proofs of enabled publishing or account deletion. Detailed evidence at `project-docs/B07_HOSTED_DEPLOYMENT_EVIDENCE.md`.


## B10 Auth provider failures and real Supabase sign-out contract — 15 November 2026

- **Latest code SHA:** `4cd62e1285e9a26e3411d24d8bc8b2e8b8b97494`, branch `feat/b0-backend-foundation`. Node/contracts job passed **426/426 tests** on [CI run 43693150989](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43693150989); database job status must be checked independently before marking this exact SHA fully green.
- **Implemented:** `packages/contracts/src/auth-service.ts` now normalizes thrown/network exceptions from registration, password login, current-user verification, password recovery, password change, sign-out and Google OAuth exchange into safe application errors. Missing signup user IDs or password-update acknowledgements are not accepted as success. `AuthPort.signOut` now matches Supabase's data-less `{error}` response, and `logout('others')` behavior is tested. All sensitive responses remain subject to live provider verification.
- **Source and tests:** [`585e985`](https://github.com/SubhashKumar14/Kadmeion/commit/585e9856ad84c151429d36edc3d1e41a6c58d80e) ([full CI PASS 43692947936](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43692947936)) and [`4cd62e1`](https://github.com/SubhashKumar14/Kadmeion/commit/4cd62e1285e9a26e3411d24d8bc8b2e8b8b97494). Local sign-out does not prove already issued access JWT invalidation; those may remain valid until expiry.
- **Brevo read-only status:** Free relay is enabled, and there is an active sender entry, but both configured Kadmeion sending domains are **unauthenticated and unverified**. This is NOT sender-domain authentication or evidence of delivered email. No DNS changes, SMTP secrets, messages, credits or paid subscriptions were used. Keep registration/password recovery gated until independently proven.
- **Remaining:** B07 33 pending hosted migrations and 3 Edge Functions; B08 public route/direct asset host and revocation; B09 external revocation-gated account deletion and full provider/retention evidence; B10 hosted sender verification and actual email delivery; B11 90-decision/53-workflow/138-acceptance/20-proof-gate audit.


## B09 private portability and account deletion revocation guard — 15 November 2026

- **Verified code SHA:** `b7cce7f27c9eb947a05968788b7252dd321f69c4` on `feat/b0-backend-foundation`; [GitHub Actions 43692318856](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43692318856) passed both contracts and ephemeral database jobs, **423/423 Node tests**.
- **Offline account portability:** `createBoundedPrivateAccountRecoveryBundle()` reorganizes an already verified bounded partial account JSON into a private, deterministic ZIP with structured owner records, separately stored SHA-256 pinned media, manifest and privacy warning. `restoreBoundedPrivateAccountJsonFromRecoveryBundle()` rejects corrupt and ambiguous ZIPs, verifies hashes and reconstructs the original bounded JSON byte-for-byte. This remains a user-controlled, **partial** export: it lacks provider data, historical unlimited records and independent server provenance; neither function performs deletion or server access.
- **Account deletion safety:** Forward-only migration `20261115130000_erasure_public_release_revocation_gate.sql` hardens `public.owner_execute_account_erasure`. After a verified live-session/reauth challenge but **before** deleting the Auth user, accounts with frozen release, reviewer-grant, unlisted publication, prepared visibility pointer, current public profile/case-study projection or outstanding public-sharing consent are blocked with `ERASURE_PUBLIC_REVOCATION_UNVERIFIED`. The owner client maps this to an explicit conflict rather than pretending deletion succeeded.
- **Conservative blocking tradeoff:** Accounts with *historical* release/reviewer records may remain unable to delete themselves until a separately approved, independently verified host-revocation acknowledgment flow exists. This is a deliberate **incomplete B09 release gate**, not a finished account-deletion feature. Accounts with no publication/reviewer history still follow the existing fresh-reauth and empty-Storage path. A database cascade cannot establish CDN or external archive erasure.
- **Source proof:** 208 authored source/config/test paths, 47 SQL migrations, 3 Edge Functions; original 200-file limit now has eight individually documented exception paths. Local Node/pgTAP/Auth/Storage/Edge test jobs passed at the named SHA. Hosted Supabase read-only status remained **14 applied migrations, 33 pending**, zero deployed Edge Functions; hosted Brevo domains remain unauthenticated/unverified. No hosted schema, SMTP/DNS or public-route changes were performed, and `main` is unchanged.
- **Next:** Build host-specific public-route/direct-media revocation evidence and an owner-safe exit acknowledgment sequence; complete provider/backup retention disclosures; deploy/test B07 only with the owner's specific hosted authorization; complete B10 sender authentication and mail delivery; finish B11 decision-by-decision and workflow acceptance.


## B09 owner source recovery from bounded account export — 15 November 2026

- **Latest code commit:** `f82063716452f72d57bbc1b33c6d9cde48417e51` (B09 source-recovery fix) on `feat/b0-backend-foundation`.
- **Verified CI:** [run 43690853795](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43690853795): **418/418 Node tests passed**, database job passed.
- **Implemented:** `recoverPortfolioSourceZipFromPartialAccountExport` in `packages/storage-adapters/src/private-account-data-export.ts`, which uses an already downloaded bounded partial-account JSON, validates owner-scoped data and embedded private image hashes, selects an exact existing owner portfolio/revision pair, validates its source snapshot through the existing editor ZIP rules and returns the portable source ZIP with a checksum. No network calls or hosted changes occur during source recovery. Invalid paths, missing/duplicated history and foreign owner records fail closed.
- **Explicit limits:** The ZIP contains the selected revision's authored source and managed files, **not** private Storage media or complete account/provider histories. It cannot prove the partial JSON originated from Supabase. The result retains `sourceAuthenticityVerified:false`, `privateMediaIncluded:false`, `completeAccountExport:false` and `deletionAllowed:false`. Handle exported user-authored source as private because owners may have included credentials.
- **Still blocked:** Hosted Supabase migrations (14/46 last observed) and three Edge Function rollouts; B08 public host/revocation; B09 complete account exit/export provider retention; B10 verified Brevo; B11 full acceptance. No main-branch merge, public delivery activation or paid service.


## B08 immutable-delivery byte verification — 15 November 2026

- **Latest source commit:** `89dff68ef39045244c41fc8833ac0d16bc2e255f` on `feat/b0-backend-foundation`.
- **Verified CI:** [run 43689978548](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43689978548), both contracts and database jobs **PASS**, **416/416 Node tests** passing.
- **Implemented code:** `packages/storage-adapters/src/public-delivery-policy.ts` now offers `PrivateVerifiedReleaseByteGate.inspect()`, a host-neutral **non-deployable** verifier for `index.html` and content-addressed `.png` objects. For each request, it validates a fresh authoritative visibility pointer, reads bounded immutable bytes, verifies SHA-256 against the allowlisted release manifest, and re-reads the pointer after the storage operation. It also rejects generation changes even if release bytes/hashes are identical (ABA republish).
- **Security tests:** `tests/editor/public-delivery-policy.test.ts` covers authorized reads, failed/oversized/wrong bytes, incorrect MIME/path, invalid requests, provider failure, revocation/moderation during blob reads, digest changes and identical-byte generation changes.
- **Important limit:** This only returns a **private verified-byte candidate** with `servingAllowed:false`, `publicUrl:null`, `hostRevocationVerified:false`. It does NOT implement a public host, proof of globally complete cache invalidation, public asset serving authorization or full publication. A host-scope independent final response/revocation gate remains mandatory before exposing routes. Do not deploy public assets on this evidence.
- **Hosted read-only inventory:** Supabase project `scyooqjitjzjdxgtanso` still had only 14 migrations applied and zero Edge Functions deployed when inspected in this continuation. The rest remain pending approval. Security advisors show 5 authenticated SECURITY DEFINER alerts requiring independent security review (some may be intentional owner RPCs), an info-level RLS-without-policy finding in the restricted operator schema, and a leaked-password-protection warning. No setting was changed.
- **Scope:** 90 approved decisions still not individually accepted; no new authored source files and no paid dependencies. Phase 1 backend, B07–B11, hosted acceptance and `main` merge remain incomplete.


## Latest backend continuation — 15 November 2026 (B08/B09)

**Feature branch:** `feat/b0-backend-foundation`. Source checkpoint before this documentation update: `9a5066e4d784df6791a68558eb2c94a6983158f8`. **Do not describe B07–B11 or Phase 1 as 100% implemented.**

- **B08 code:** A frozen, owner-RPC-attested HTML candidate can now be composed with up to eight content-addressed sanitized PNG assets from an owner-RLS checked, Storage-version-checked, write-once SHA-256 attestation reader. Exact candidate and media bytes can be rebuilt and checked. A bounded portable HTML+PNG static preview ZIP contains relative assets, no embedded owner source/private asset IDs, a checksum-only manifest and noindex/scriptless markup. Source-archive imports retain their separate 2 MiB cap.
- **B08 limits:** This remains a **PRIVATE, NON-DEPLOYABLE** candidate and offline preview; the trust boundary requires an independently vetted server-owned media inclusion plan, not arbitrary owner input. Fully approved reusable media slots, other image formats, actual immutable release storage, canonical/direct-asset public routing, independent host revocation and publication acceptance are not finished. Never activate public delivery based on these local tests alone.
- **B09 code:** Added an offline verifier for the existing **BOUNDED_PARTIAL_EXPORT** JSON. It checks owner-scoped table structure, excluded audit secrets, non-fabricated limitations and SHA-256 of all embedded private asset bytes. Verification explicitly returns `completeAccountExport:false`, `documentAuthenticityVerified:false` and `deletionAllowed:false`; it cannot prove provider retention, atomic snapshot, completeness or erasure.
- **Automated tests:** [Full CI at `457cd56`](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43688774285) **PASS** (contracts and ephemeral database). The later B09 `9a5066e` [run](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43689060333) had a passing contracts job, with the database job still running at this status snapshot. Verify final HEAD CI separately.
- **Unchanged hosted blockers:** Last observed hosted Supabase state is 14/46 migrations applied, 32 pending, 0/3 Edge Functions deployed. Brevo live SMTP and sender-domain verification remain unproven. No hosted migration, Edge deployment, public host activation, email/DNS change, paid subscription or merge to `main` occurred in this continuation.
- **Decision tracing:** `registers/D01_D90_BACKEND_TRACEABILITY.csv` is a conservative 90-row register, not 90 proofs; 115 UI decisions, 53 workflows, 138 acceptance cases and 20 technical gates still require reconciliation.


## Latest code continuation — 15 November 2026

**Additional WF-045 implementation checkpoint:** a typed, owner-JWT-scoped
notification inbox client, safe paginated reads, server-only preference RPCs,
explicit acknowledgments and negative contract tests are now authored on the
feature branch; full fresh CI remains the acceptance gate. This in-app service
does **not** imply Brevo email delivery. The checkpoint introduces two isolated
feature/test files rather than combining notification behavior with unrelated
auth code. Latest authored count is **205**, variance **+5** against the
original 200-file proposal; all five additions are separately enumerated
for review. The preceding 203-path snapshot remains historical.


- **Current feature-branch code:** `feat/b0-backend-foundation` at privacy invalidation commit
  `adb4d081` (subsequent housekeeping CI SHA may differ). This continuation
  added curated source-pinned starter assignments with empty owner content
  (no fabricated project/media data), hardened public route ambiguity and
  consented SEO projection, and added transactional withdrawal on private
  identity/case-study content edits.
- **Security regression proof:** the isolated database job for `adb4d081`
  passed migrations, pgTAP, PostgREST/Auth/Storage HTTP, Edge Function smoke,
  Mailpit recovery, restricted worker and moderation race. See
  [the latest PR checks](https://github.com/SubhashKumar14/Kadmeion/pull/1/checks).
  The accompanying contracts job passed TypeScript and Node tests but failed
  solely at source-file budget accounting because the new forward-only
  privacy migration was not yet on the explicit exception list; the
  housekeeping commit corrects this and requires its own fresh CI.
- **Audited count:** **203 authored application/config/test paths** excluding
  `project-docs`, caches, dependencies and build outputs. **46 SQL migrations**,
  3 Edge Functions. The originally proposed 200-file limit now has three
  individually identified security migration exceptions, not blanket approval.
- **Hosted Supabase read-only:** **14 of 46 migrations applied, 32 pending**;
  zero project Edge Functions deployed as of the last confirmed handoff.
  No hosted schema mutation, production deployment, feature-switch promotion
  or merge into main performed during this continuation.
- **Brevo account read-only:** free relay enabled, two configured Kadmeion
  domains both unauthenticated/unverified. No hosted email-delivery proof.
- **Release correctness:** the external host/canonical and direct-asset
  revocation gate remains open; B08 scriptless text-only serving does not yet
  cover safe owner media. B09 account export remains bounded/partial and
  provider erasure/retention are not proven. Neither should be described as
  fully complete or production ready.

**Do not enable public publishing or irreversible account deletion on the
basis of code presence or green ephemeral CI.** Hosted acceptance and explicit
owner approval of target migrations/host are independent gates.


**Repository:** SubhashKumar14/Kadmeion  
**Feature branch:** `feat/b0-backend-foundation`  
**Last verified code SHA:** `88dda7ecf0eef28aae95fa6db486b8c2a5aa4134`  
**Evidence:** https://github.com/SubhashKumar14/Kadmeion/actions/runs/43680601059  
**Status:** Significant P1 backend code and local automated tests implemented. **NOT 100% production-ready.**

This page supersedes the 12-Nov-2026 documentation-only "NOT IMPLEMENTED"
labels for verification of **existing code**, not for still-unproven features.
See `IMPLEMENTATION_STATUS.md` for chronological commit-by-commit history.
Latest owner selections remain authoritative over all historic drafts.

## Latest implementation verification — 15 November 2026

- **CI green at `88dda7e`:** 383/383 Node/auth/editor/contract tests; isolated Supabase migrations and pgTAP (PASS); 46/46 local GoTrue/PostgREST/Storage HTTP tests, local Deno Edge flows, Mailpit auth email, private PostgreSQL binding, and moderation races all PASS. See the linked run above. These are local/ephemeral proofs, not hosted production acceptance.
- **B08 publication repair:** Public release HTTP now requires service-RPC `indexable` acknowledgment. Before acknowledgment, a correctly scoped PUBLIC route serves a `noindex,nofollow,noarchive` canary. The trusted worker verifies those exact bytes, acknowledges, then independently re-fetches the new indexable bytes before claiming delivery. Strict failure behavior and canary withdrawal have new Node/pgTAP/real HTTP coverage. The extra forward-only migration is `20261115121000_public_release_indexing_ack_gate.sql`.
- **B5 operator intake:** typed private abuse queue listing/review adapters, exact-field receipt validation and bounded (256 KiB, 15-second timeout) RPC response handling; independent negative/cross-scope tests. Reports alone never impose a public restriction.
- **Source-file accounting:** 202 *actual tracked authored application/config/test paths*, excluding `project-docs`, runtime dependencies and generated outputs. This is **2 above** the original 200-file proposal, attributed to two auditable forward-only security migrations. Do not misrepresent 202 as 200 or compact security code artificially. The approved source budget needs review.
- **Hosted read-only proof:** 14 migrations currently applied out of 45 in the branch; 31 pending. Zero Edge Functions deployed. Two Brevo domains remain unverified. No hosted schema writes, SMTP enablement, public promotion or main merge in this continuation.
- **CI optimization:** replaced needless global serialization of isolated runners with branch-scoped `cancel-in-progress` for superseded local DB jobs. Full CI green on this workflow.
- **Vercel:** automatically generated feature-branch preview at `475f7ac` reports READY. This is a build outcome, not public-release/canonical-route validation.

## B07–B11 continuation checkpoint

| Phase | Code and verification | Open hosted acceptance |
|---|---|---|
| B07 Supabase | Migration history matches the first 14 local versions. The branch contains 45 migrations and three Edge Functions. | Apply the 31 pending migrations and deploy the three functions to the authorized project. Keep feature switches disabled during rollout. Check live auth/RLS, function JWT and origin boundaries, and the hosted Trash schedule. |
| B08 Publishing | Arc, Collage, Editorial, Stairs, Studio and Blank initialize typed drafts through the owner-only revision transaction. Private binding, reviewer staging and archive export resolve all eight frozen layout pins and palette tokens through the server-approved component plan. Fresh reviewer links use `/r/:token` and server-checked expiry and revocation. Withdrawal verification first hashes the live canonical release, then checks canonical and direct-path denial after withdrawal. | Select the ₹0 public host and run the hosted publish, rollback and withdrawal canary. Preset drafts currently supply documented layout and header structure with empty content slots. Curated default component assignments, media rendering and delivery are pending. |
| B09 Account lifecycle | Owner-scoped partial export verifies private asset hashes and includes private platform links, goals, manual progress, milestones, notifications and notification preferences. The owner inbox receives real account, moderation, reviewer, verified-publication and optional cloud-save notices. Upload cleanup keeps one owner session for inventory, removal and verification. | Prove the hosted lifecycle with disposable data, including release revocation and provider retention. Export remains partial and deletion receipts report backup and external copies as unverified. |
| B10 Auth email | Local signup and recovery use GoTrue and Mailpit. The existing Vercel preview reports email delivery disabled. | Verify an approved Brevo sender and secure SMTP configuration, then complete hosted confirmation and recovery with disposable mailboxes. Both configured Kadmeion domains are currently unverified. |
| B11 Handoff | The auth-only Vercel feature-branch preview at `b5e3d98` served `/signin` and `/config.json` with HTTP 200. The next code changes pass the pinned local Node/TypeScript checks. | Verify fresh feature-branch CI and hosted acceptance before merging to `main`. Final preview verification is tied to the merged SHA. |

### Hosted rollout order

1. Confirm the release SHA and exact target project. Compare the remote migration versions with the checked-out branch using `supabase migration list --remote` and `supabase db push --remote --dry-run`. The hosted project currently uses ref `scyooqjitjzjdxgtanso`. Preserve the old deployment and review each pending change before applying it.
2. After authorization, apply the reviewed migrations and deploy `complete-private-asset`, `publish` and `purge-expired-trash` with the corresponding `verify_jwt` values in `supabase/config.toml`. Verify anonymous, wrong-origin, cross-owner and stale-session requests before an owner canary. Use Vault for the scheduler bearer secret and verify the Edge response as well as the scheduled job record.
3. Use one disposable account and a known, previously reachable release to exercise publish, rollback, privacy withdrawal and direct-URL denial. A path that always returned 404 cannot prove revocation. Exercise archive download and active account cleanup, and record provider retention separately.
4. Configure the verified Brevo sender/SMTP in Supabase using server-side credentials. Validate the allowed callback origin and successful confirmation and password recovery before enabling the auth preview email flag.
5. Review the CI and hosted outcomes against the release criteria, then merge the reviewed SHA and verify the intended nonproduction Vercel preview. Preserve the ₹0 limit at each step.

References: [Supabase CLI v3](https://supabase.com/changelog/supabase-cli-v3),
[Edge scheduling](https://supabase.com/docs/guides/functions/schedule-functions),
[Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp),
[Brevo domain authentication](https://help.brevo.com/hc/en-us/articles/12163873383186-Authenticate-your-domain-with-Brevo-Brevo-code-DKIM-DMARC).

## Verified on the feature branch

- Node 26.13.1 LTS, TypeScript 7.0.2, npm 12.2.2, safe environment-variable conventions, GitHub
  Actions with branch-scoped superseded-run cancellation, and an authored-file budget tracker.
- Owner/Auth identity, private profile/project/asset persistence, owner RLS,
  immutable editor revision transactions, conflict/idempotency rules,
  portable snapshots and folder recovery, private Storage and registration.
- Private frozen revisions, hash-attested scriptless HTML artifacts, reviewer
  tokens, staged release binding, consented Public/Unlisted projections,
  authenticated publication Edge gateway **disabled by default**, immutable
  release verification/recovery and owner-only/operator-blocked pointers.
- Operator role/moderation audits, Trash and owner account-exit request/reauth
  workflows, bounded verified-byte **partial** export, restricted server asset
  attestation. No false claim of complete/atomic provider export or deletion.
- Transactional project privacy withdrawal blocks owner portfolio routes;
  project visibility keys are immutable. Reserved application path prefixes
  are checked in browser contract, public delivery and forward-only DB check.
- Anonymous EXECUTE was revoked from an internal private trigger function.
  Public/anon/service-role/RLS inventory checks run on ephemeral local DB.
- Fail-closed host canonical/direct-asset revocation probe (GET and HEAD)
  with a read-only opt-in CLI. No external host has yet been verified.
- Browser preview bundle scan denies server credential markers and symlinks.

**Completed CI at code SHA `00985446`:**

| Verification | Outcome |
|---|---|
| Node app/contract/auth/editor tests | 327/327 PASS |
| pgTAP isolated PostgreSQL | 409/409 assertions, 25 SQL files, PASS |
| Real local GoTrue/PostgREST/Storage HTTP | 43/43 PASS |
| Local Deno Edge asset, publication and Trash sweeper smoke | All PASS |
| Local Auth signup/recovery via Mailpit | PASS |
| Restricted direct PostgreSQL & moderation race | PASS |
| TypeScript, auth builds/smokes, bundle verification, PL/pgSQL lint | PASS |
| Authored application/configuration/test files | 194 / originally planned 200; docs excluded |

New backend hardening verified in this CI run: a strictly opt-in, bounded,
secret-authenticated expired-Trash Edge scheduler; real local Deno gateway
authentication tests; identity-encoded RPC response-length verification; bounded
frozen owner revision response streaming; reserved Vercel SPA routes ahead of
generic public portfolio rewrites; generation-checked UNLISTED privacy
revocation; and Supabase CLI v3 email-provider syntax. No paid dependency added.
The working branch still contains the P1 production-protected feature flags.

Tests are on ephemeral local Supabase and GitHub Actions, not hosted-production
verification. Public, reviewer and unlisted HTML HTTP adapters now reject executable
markup and unsafe URLs beyond SHA-256 integrity checks. The 26.13.1 pin incorporates
the 11-Nov-2026 Node security release. No true universal security guarantee or
100% functionality claim.

## External proof gates / unimplemented or unverified aspects

1. **Hosted Supabase:** the source currently contains **45** ordered migrations; the
   existing hosted project still reports only the initial **14** applied
   (**31 unapplied**). Verify a fresh read before any eventual authorized deployment.
2. **Brevo:** free SMTP relay is enabled; configured `kadmeion.com` and
   `mail.kadmeion.com` domains remain unauthenticated/unverified at the
   15-Nov-2026 read-only account check (free relay enabled, 300 credits). Hosted sender/recovery and multi-domain delivery are unproven.
3. **Actual free public host:** no separately approved production host and no
   canary proof of canonical-route/direct-release-asset revocation, CDN/cache
   behavior, independent JS-off delivery, rollback races or hosting quotas.
   Do not enable publishing flags or claim verified public publication.
   A preview build on the temporary backend-hardening branch failed
   because `VITE_SUPABASE_URL` was absent **for that branch**. Read-only Vercel
   inspection shows the public `VITE_SUPABASE_URL` and publishable-key variables
   are scoped to `feat/b0-backend-foundation`, not the temporary branch. This
   does not establish a successful new deployment; keep guard fail-closed.
4. **Account erasure:** separate 15-day item Trash exists; account-exit SQL
   and bounded partial export exist. Complete provider data export, backups,
   external copies, erasure receipts and legal retention are NOT proven.
   Do not claim complete erasure or permit deletion based on partial proofs.
5. **Frontend/WCAG:** only the auth proof preview exists. 52 original approved
   LIGHT-theme screen images and 115 decisions are requirements, not completed
   frontend; rejected Canva variants and DARK set are excluded. Browser/
   accessibility/manual acceptance tests remain future work.
6. **Optional P2/P3 features** (integrations/DevScore/goals/analytics, AI) are
   not counted as completed P1 backend and require their own approval/proofs.
7. **200-file original plan:** 202 application files currently exist (2 separately justified security-migration paths over the original count). Building
   all 52 frontend surfaces cleanly will require owner review of this
   originally planned file budget; never combine security-sensitive modules
   merely to meet an arbitrary number.

8. **Free-tier Auth security advisory:** hosted Supabase reports that leaked-password
   checks are disabled; this is Pro-only, not a feature available under the
   approved ₹0 limit. Five authenticated owner-intent `SECURITY DEFINER`
   functions are also advisory warnings: retain scoped ownership and negative
   RLS tests; do not revoke intended RPC access merely to silence an advisor.

## Next authorized engineering path

Keep implementation on `feat/b0-backend-foundation`, check live branch/CI,
reconcile future code against current project-docs and latest approvals, and
continue locally provable B4/B5/B6 work. A disposable hosted canary (with
no real user data) and a selected free host are needed for TP-01/02/03/04/07/
08/18/19, but **request separate owner approval before applying any live
migration, changing credentials, performing a public deploy or merging main**.

Test/switch semantics are evidence-first: `ACKNOWLEDGED` means a verified
HTTP response for that specific release, not proof of all caches; a read-only
revocation probe can verify only explicitly enumerated host paths. No made-up
published URL, sender proof or full account deletion guarantee.

## Owner update — 15 November 2026 (frontend design, authoritative)

- Implement **both LIGHT and DARK Kadmeion interface themes**. Reproduce the
  owner's explicitly approved light-screen images precisely; derive the dark
  variant from the approved brand palette and identical approved layout/interaction
  structure, not unapproved Canva redesigns. Check contrast, focus visibility,
  system preference, explicit override and reduced motion with automated and
  eventual owner visual tests. Do not invent new dark-brand assets.
- User-published portfolios follow their OWN selected theme tokens; Kadmeion
  application chrome must not override published portfolio visual identity.
- Neither set of the 52 frontend screens is yet implemented. Backend-first work
  does not imply the dark theme or frontend is complete.
- Strict **₹0 total spend**: no paid plan, trial with payment obligation, paid
  API, automatic upgrade, or usage-billed fallback. Free quotas and pauses are
  real operational constraints, not grounds to introduce charges.
