# Kadmeion — Current Backend Implementation State

**Repository:** SubhashKumar14/Kadmeion  
**Feature branch:** `feat/b0-backend-foundation`  
**Last verified code SHA:** `f904583718dafc0555e977b9b42b1723d44c3f2a`  
**Evidence:** https://github.com/SubhashKumar14/Kadmeion/actions/runs/43632411670  
**Status:** Significant P1 backend code and local automated tests implemented. **NOT 100% production-ready.**

This page supersedes the 12-Nov-2026 documentation-only "NOT IMPLEMENTED"
labels for verification of **existing code**, not for still-unproven features.
See `IMPLEMENTATION_STATUS.md` for chronological commit-by-commit history.
Latest owner selections remain authoritative over all historic drafts.

## Verified on the feature branch

- Node 26.13.1 LTS, TypeScript 7.0.2, npm 12.2.2, safe environment-variable conventions, GitHub
  Actions with database jobs serialized, and an authored-file budget tracker.
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

**Completed CI at code SHA `f9045837`:**

| Verification | Outcome |
|---|---|
| Node app/contract/auth/editor tests | 319/319 PASS |
| pgTAP isolated PostgreSQL | 408/408 assertions, 25 SQL files, PASS |
| Real local GoTrue/PostgREST/Storage HTTP | 43/43 PASS |
| Local Deno Edge asset and publication smoke | Both PASS |
| Local Auth signup/recovery via Mailpit | PASS |
| Restricted direct PostgreSQL & moderation race | PASS |
| TypeScript, auth builds/smokes, bundle verification, PL/pgSQL lint | PASS |
| Authored application/configuration/test files | 194 / originally planned 200; docs excluded |

Tests are on ephemeral local Supabase and GitHub Actions, not hosted-production
verification. Public, reviewer and unlisted HTML HTTP adapters now reject executable
markup and unsafe URLs beyond SHA-256 integrity checks. The 26.13.1 pin incorporates
the 11-Nov-2026 Node security release. No true universal security guarantee or
100% functionality claim.

## External proof gates / unimplemented or unverified aspects

1. **Hosted Supabase:** the source currently contains **40** ordered migrations; the
   existing hosted project still reports only the initial **14** applied
   (**26 unapplied**). Verify a fresh read before any eventual authorized deployment.
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
7. **200-file original plan:** 194 application files exist already. Building
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
