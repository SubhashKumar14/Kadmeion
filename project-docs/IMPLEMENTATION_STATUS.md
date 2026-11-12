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
