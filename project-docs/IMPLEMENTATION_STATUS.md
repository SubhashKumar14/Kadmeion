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
