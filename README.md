# Kadmeion

**Build · Showcase · Evolve** — privacy-first developer portfolio builder (B.Tech capstone).

This is the NEW Kadmeion repository. The historical `DevFolio-App` is reference-only.
Application implementation is on the feature branch `feat/b0-backend-foundation`.
Production merges, hosted migrations, public deployment and destructive account
operations remain owner-approval-gated.

## Source of truth

- [Current verified implementation and unresolved gates](project-docs/BACKEND_CURRENT_STATUS.md)
- [Original handoff](project-docs/NEXT_SESSION_HANDOFF.md) — historic 12-Nov-2026 planning snapshot
- [Architecture](project-docs/docs/04_engineering/SYSTEM_ARCHITECTURE.md)
- [Database, RLS and Storage](project-docs/docs/04_engineering/DATA_MODEL_RLS_AND_STORAGE.md)
- [Editor invariants](project-docs/docs/04_engineering/EDITOR_CORE_AND_FILE_CONTRACT.md)
- [Publication/host proof contract](project-docs/docs/04_engineering/STATIC_RELEASE_HOSTING_AND_EXPORT.md)
- [20 technical proofs](project-docs/registers/TECHNICAL_PROOFS.csv)
- [52 approved LIGHT screen specs](project-docs/docs/02_design/SCREEN_CATALOG.md)

## Backend technology

Node 26 LTS/npm workspaces; TypeScript contracts, editor transaction engine, local
browser/folder/cloud storage adapters; **Supabase Auth, PostgreSQL with RLS,
private Storage and Edge Functions**; isolated, hash-pinned static release
generation and restricted public HTTP adapters. No MongoDB/Mongoose/Express
business backend, browser-side service-role credentials, or required paid API.

## Local development and automated checks

Prerequisites: Node version from `.nvmrc` (26.13.1 or newer 26.x security patch), npm 12, Docker, Supabase CLI 3.1.x.
Run from the repository root:

```sh
npm ci
npm run typecheck
npm test
npm run check:file-budget
supabase start
supabase test db
supabase db lint --schema public,kadmeion_private --level error --fail-on error
KADMEION_LOCAL_INTEGRATION=1 node --experimental-strip-types --test tests/integration/local-supabase-http.test.mjs
```

For local Auth-only preview use `npm run dev:auth` with locally configured
**publishable** Supabase values. This auth preview is NOT the 52-screen frontend.
Never commit or prefix privileged keys with `VITE_`.

CI additionally runs local GoTrue/Mailpit confirmation/recovery, Deno Edge
gateway smoke tests, the restricted PostgreSQL worker and moderation race
tests. It does **not** claim hosted Supabase, Vercel/CDN or browser/WCAG proofs.

## Publication and revocation

Server-side publication is disabled by default and needs a separately approved
host plus proven direct-asset/canonical-route revocation. A read-only host
inspection command is included:

```sh
KADMEION_HOST_REVOCATION_PROBE_ENABLED=true \
KADMEION_RELEASE_HOST_ORIGIN=https://approved-host.example \
KADMEION_RELEASE_HOSTNAME=approved-host.example \
npm run probe:host:revocation -- \
  --canonical /owner/portfolio \
  --direct /owner/portfolio/releases/<verified-asset-path>
```

Use only your actually enumerated immutable/direct routes. The command makes
GET and HEAD requests and verifies 404/410 + non-cacheable/non-indexable
responses; it neither revokes anything nor proves global cache or archive
erasure. Do not run against an unapproved external host. The strict ₹0 recurring
cost and privacy proof gates override any convenience deployment shortcut.
