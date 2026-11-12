# Kadmeion · Build · Showcase · Evolve

> Status: B0 backend foundation started. The repository includes typed contracts, local Supabase configuration, and an una​​pplied private-profile migration; this is not a completed backend or live application.

## B0 foundation

- Node 22, npm workspaces, strict TypeScript domain contracts
- Private identity table migration and owner-scoped RLS policies (not applied to any cloud database)
- Email confirmation enabled in local Supabase config; Brevo delivery is not verified
- Contract tests and GitHub Actions checks

Run `npm ci && npm run typecheck && npm test && npm run check:file-budget` from the repository root.

PostgreSQL migration, pgTAP role tests, end-to-end Auth, and hosted CI require independent verification. Do not run `supabase db push` against a hosted project without owner approval.

## Authoritative specifications

- [Implementation handoff](project-docs/NEXT_SESSION_HANDOFF.md)
- [Design](project-docs/design.md)
- [Documentation index](project-docs/README.md)
- [Application-only proposed tree](project-docs/FULL_REPOSITORY_FILE_TREE.txt)

Planning documents in `project-docs/` and this README are excluded from the 200-file authored application baseline. B1–B6 remain unfinished.
