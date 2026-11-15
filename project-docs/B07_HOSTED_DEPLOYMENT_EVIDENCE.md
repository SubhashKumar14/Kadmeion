# B07 — Hosted Supabase Deployment Evidence

**Date:** 15 November 2026  
**Repository:** [SubhashKumar14/Kadmeion](https://github.com/SubhashKumar14/Kadmeion)  
**Branch:** `feat/b0-backend-foundation`  
**Supabase project:** [Kadmeion project dashboard](https://supabase.com/dashboard/project/scyooqjitjzjdxgtanso)

## Deployment ledger

- **Before:** 14 applied SQL migrations, zero Edge Functions; 2 Auth accounts, 0 portfolios, 0 projects, 0 Storage objects.
- **Applied:** all 33 pending SQL migrations in version order, from `20261113163000_private_item_trash_and_restore.sql` through `20261115130000_erasure_public_release_revocation_gate.sql`; no Supabase branch/project creation, paid plan or extra backend branch.
- **After:** 47/47 source migration timestamps present in hosted history, no unknown source versions, existing Auth accounts still 2, projects/portfolios/Storage objects still 0.
- **Migration-history compatibility:** The MCP `apply_migration` action assigned new UTC versions and prefixed the user-provided file timestamp to the migration name. Immediately after each successful SQL application, the one newly created version/name was checked and corrected in `supabase_migrations.schema_migrations` to the original repository timestamp/name. This is a bounded migration-ledger repair, *not* a schema reapplication. All 47 versions were subsequently compared against the GitHub migration file list; no missing or unexpected versions. Follow-up CLI `supabase migration list` is recommended as independent confirmation.
- **Edge deployed:** `publish` ACTIVE version 1 JWT required; `complete-private-asset` ACTIVE version 1 JWT required; `purge-expired-trash` ACTIVE version 1, JWT gateway not required but separate internal secret/feature gate remains off. Deployment metadata and retrieved file contents verified.
- **Source fix:** [commit `d93df80`](https://github.com/SubhashKumar14/Kadmeion/commit/d93df80d527078fe208222c078bfb08161be5b4c) registers the `Deno.serve` handlers for two deployed functions. [Green local CI](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43694908230) includes local GoTrue/PostgREST/Storage and Edge smoke.
- **Hosted security readback:** zero public-schema tables without RLS; zero public Storage buckets; private asset bucket present; zero `SECURITY DEFINER` functions executable by `anon` (74 definer functions scanned). The hosted database contains 2 existing Auth users and no authored portfolio/project/Storage records.

## Outstanding proof is not B07 migration deployment

- **Live hosted negative HTTP smoke: PASSED** on [CI 43695497839](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43695497839) at [commit 168ec73](https://github.com/SubhashKumar14/Kadmeion/commit/168ec73ed6dc2492c3811fd4b39945370094e0e7): no-JWT `publish` POST → **401**, no-JWT `complete-private-asset` POST → **401**, disabled `purge-expired-trash` GET → **405**, unauthenticated POST → **404**. The HTTP checks sent no credentials or user data and made no destructive changes. 426/426 Node tests and database job both passed.
- Supabase Security Advisors: 40 authenticated-callable SECURITY DEFINER warnings require owner-predicate and ACL review, 14 INFO RLS-no-policy warnings correspond to service-only tables, and one leaked-password-protection warning is still pending Auth controls.
- B08 external HTML/asset host activation, route/direct-asset cache invalidation, public delivery and privacy evidence **NOT PROVEN**.
- B09 cross-provider erasure, backup retention, public-release host revocation proof **NOT PROVEN**.
- B10 authenticated Brevo sending domains and real password-reset email delivery **NOT PROVEN**.
- B11 production UAT, 90 product decisions, 20 technical gates and approval-controlled public go-live **NOT COMPLETE**.

**B07 final status: COMPLETE — hosted foundation deployment plus negative HTTP verification.** B08–B11 independent production gates remain open. Supabase organization verified **Free**; no new project, paid plan, or deployment branch was created. No unrelated production feature or paid service activation implied. Source is still on the backend feature branch, not merged into `main`.
