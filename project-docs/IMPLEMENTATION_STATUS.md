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
