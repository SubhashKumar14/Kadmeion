# Proposed Kadmeion Source Repository Structure and Ownership

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

**This tree is a blueprint. The code files listed below do not exist because of this documentation task.** The new greenfield repository is Kadmeion; the old DevFolio repo remains a reference only. The tree below is an **abbreviated legacy overview** (many directories are intentional placeholders). For a **fully enumerated future repository with every planned file and exact file count**, use [`FULL_REPOSITORY_FILE_TREE.txt`](../../FULL_REPOSITORY_FILE_TREE.txt), [`FULL_REPOSITORY_FILE_MANIFEST.csv`](../../FULL_REPOSITORY_FILE_MANIFEST.csv) and [`FILE_COUNT_REPORT.md`](../../FILE_COUNT_REPORT.md).

```text
Kadmeion/                                      # PROPOSED FUTURE CODE REPOSITORY (NOT CREATED)
├── README.md                                  # Verified user-facing project status and setup
├── LICENSE                                    # MIT only if final owner/licence conditions remain valid
├── package.json                               # Workspace scripts, pinned package manager
├── pnpm-workspace.yaml                        # Candidate monorepo manager, not chosen runtime requirement
├── tsconfig.base.json                         # Shared TypeScript configuration
├── .env.example                               # Non-secret environment variable names only
├── .github/
│   └── workflows/
│       ├── quality.yml                        # CI lint/unit/contract/a11y checks
│       └── security.yml                       # Dependency/license/secret scan, no unsafe action
├── apps/
│   └── web/                                   # Public/Auth/Workspace/Editor/Operator UIs
│       ├── index.html
│       ├── src/
│       │   ├── app/
│       │   │   ├── router.tsx                  # /u routes reserved; portfolio route conditional
│       │   │   ├── providers.tsx               # Auth, theme, query, route guards
│       │   │   └── permissions.ts              # UI projection of server-side authorization
│       │   ├── shells/
│       │   │   ├── PublicShell.tsx
│       │   │   ├── AuthShell.tsx
│       │   │   ├── WorkspaceShell.tsx
│       │   │   ├── EditorShell.tsx
│       │   │   └── OperationsShell.tsx
│       │   ├── features/
│       │   │   ├── auth/                        # SignIn, SignUp, Callback, Forgot/Reset
│       │   │   ├── landing/                     # Hero, Showcase, Templates, FAQ
│       │   │   ├── onboarding/                  # Welcome three choices
│       │   │   ├── identity/                    # Profile editor, /u/:handle public projection
│       │   │   ├── projects/                    # Gallery, QuickAdd, CaseStudy, LinkPreview
│       │   │   ├── portfolios/                  # List, template gallery, editor launcher
│       │   │   ├── editor/                      # Workbench integration; no direct data writes
│       │   │   ├── preview/                     # Author and Published preview lenses
│       │   │   ├── publishing/                  # Preflight, Staging, Releases, rollback
│       │   │   ├── sharing/                     # Public/canonical URL and metadata preview
│       │   │   ├── growth/                      # Phase 2 activity, DevScore, Goals
│       │   │   ├── analytics/                   # Phase 2 owner opt-in aggregates
│       │   │   ├── integrations/                # Phase 2 public handle/card + Sync
│       │   │   ├── settings/                    # Privacy, security, notifications, Trash
│       │   │   ├── export/                      # Static and project archive UI
│       │   │   ├── operations/                  # Users, moderation and appeals
│       │   │   └── system/                      # Access denied, gone, offline, device block
│       │   ├── design-system/
│       │   │   ├── tokens/                      # Aether tokens only after source verification
│       │   │   ├── components/                  # Inputs, buttons, modal, card, menu, status
│       │   │   ├── glyph-skeletons/              # True text-shaped content skeletons
│       │   │   ├── motion/                      # Ease-out, auth 280–320ms, reduced-motion
│       │   │   └── brand/                       # Approved original K, sparse pattern
│       │   ├── lib/
│       │   │   ├── supabase-client.ts           # Public anon client; no service secret
│       │   │   ├── accessibility.ts
│       │   │   └── safe-links.ts
│       │   └── main.tsx
│       └── public/                             # Safe non-secret public assets only
├── packages/
│   ├── contracts/                              # Shared versioned Project/Component/Op/Build/Release schemas
│   │   └── src/
│   │       ├── project-format.ts
│   │       ├── component-protocol.ts
│   │       ├── operation-contract.ts
│   │       ├── build-contract.ts
│   │       └── release-contract.ts
│   ├── editor-core/                            # Pure TS one-writer, NO React/DOM/network/service secrets
│   │   └── src/
│   │       ├── project-graph/
│   │       ├── grammar-guard/
│   │       ├── transaction-engine/
│   │       ├── content-mapping/
│   │       ├── slot-state/
│   │       ├── revisions-and-stash/
│   │       ├── conflict-resolution/
│   │       ├── token-resolution/
│   │       └── diagnostics/
│   ├── builder-ui/                             # Three-pane React views of editor core
│   │   └── src/
│   │       ├── canvas-and-layers/
│   │       ├── component-library/
│   │       ├── inspector/
│   │       ├── assets/
│   │       ├── source-workspace/
│   │       └── history-and-problems/
│   ├── portfolio-kit/                          # Trusted pinned presets, eight initial layouts
│   │   ├── manifests/
│   │   ├── presets/                            # Initial five; extensible not a fixed max
│   │   ├── layouts/                            # L1–L8 initial section variants
│   │   ├── trusted-components/
│   │   └── fixtures/
│   ├── publisher/                              # Pure static rendering + policy gates
│   │   └── src/
│   │       ├── static-html/
│   │       ├── seo-and-metadata/
│   │       ├── preflight/
│   │       ├── manifest-and-hashes/
│   │       ├── assets-transform/
│   │       └── archive-export/
│   ├── storage-adapters/
│   │   └── src/
│   │       ├── indexeddb/
│   │       ├── folder-with-journal/
│   │       ├── zip-import-export/
│   │       └── supabase-sync/
│   └── shared-ui/                              # Shared accessible primitives; no product secrets
│       └── src/
├── supabase/                                   # NOT initialized/migrated by this package
│   ├── migrations/                             # Owner-scoped RLS tables, immutable revisions, quotas
│   ├── tests/                                  # Policy/Storage/role negative tests
│   ├── functions/
│   │   ├── publish-request/                    # Pinned revision, idempotency, trust checks
│   │   ├── staging-links/                      # Short token expiry and revoke
│   │   ├── account-erasure/                    # Separate from 15-day item Trash
│   │   ├── admin-operations/                   # Narrow roles, notices, audit
│   │   ├── safe-thumbnail-capture/             # ONLY IF SSRF/free proof passes
│   │   └── public-provider-sync/               # Phase 2; permitted public API only
│   └── seed/                                   # Synthetic fixtures only
├── delivery/                                   # Static host adapter, not second business backend
│   ├── contracts/
│   ├── route-resolution/
│   ├── cache-and-tombstones/
│   └── providers/                              # Host-specific implementation ONLY after proof
├── tests/
│   ├── unit/
│   ├── contract-and-golden/
│   ├── database-rls/
│   ├── security-adversarial/
│   ├── browser-e2e/
│   ├── accessibility/
│   ├── visual-regression/
│   ├── release-host-integration/
│   └── fixtures/
├── docs/                                       # Adopt/copy this approved documentation after code starts
│   ├── design.md
│   ├── screens/
│   ├── workflows/
│   ├── architecture/
│   ├── decisions/
│   ├── testing/
│   ├── security/
│   └── capstone/
└── scripts/
    ├── check-source-file-budget.mjs           # Historical 200 executable/config target, re-evaluate
    └── verify-export-integrity.mjs
```

## Module rules

| Module | Owns | Must not own |
|---|---|---|
| `apps/web` | Navigation shells and accessible feature UIs | Secret roles, raw SQL authority or independent editor source model |
| `packages/contracts` | Five versioned interface schemas and ids | Runtime access to external providers |
| `packages/editor-core` | Versioned file graph, typed transactions, stash, revision, parser, token merge | React, direct DOM/network access, privileged provider credentials |
| `packages/builder-ui` | Accessible canvas, library, inspector, source UI, history/problems | Direct unsynchronized file writes or mutation of opaque owned code |
| `packages/portfolio-kit` | Trusted authored templates/layout manifests/components | User code execution or fabricated achievements |
| `packages/publisher` | Pinned static HTML/SEO build, hashes, ZIP and preflight | Dynamic account API, generic arbitrary source server execution |
| `packages/storage-adapters` | Explicit local/browser/cloud save and export responsibilities | Misleading universal “Saved” state |
| `supabase` | Auth, owner data RLS, Storage, Edge/RPC, quota, narrow admin | Raw author JS execution or independent hosted public route guarantee |
| `delivery` | Public release bytes, pointer/access/tombstones and tested host interface | Second unapproved business DB/account system |
| `tests` | Real code/browser/provider/security evidence and hostile fixtures | Claiming success based on source or plans alone |

## Proposed source-file budget

An earlier blueprint references a historical 200 executable/config source-file planning cap. Treat it as a *planning constraint requiring final counting policy* rather than justification to squash security-critical code into monolithic files. The current proposed tree lists representative files/directories—not 200 implemented source files. Record actual count and seek approval if safety/maintainability require extension.

## Security-sensitive separation

- Browser client only receives publishable Supabase anonymous key, never secret/service key.
- User-owned TSX/JS is stored and compiled in bounded isolation; does not run in trusted app/service runtime.
- Static exporter never includes `.env`, sessions, raw code backup paths, private unselected provider facts or admin data.
- Public host adapter must enforce tombstones/revocation, not merely render static client-side 404 after private bytes leaked.

## Initial implementation ordering

1. Set up source tree and contract tests; implement project file format/transaction engine before styling large dashboards.
2. Validate trusted presets/slots, portable static export and editor keyboard workflow in a self-contained fixture.
3. Add actual Auth/RLS/private project/identity flow and Brevo proof; then public hosting/rollback gates.
4. Build restricted admin and privacy/account lifecycle; only after core pass introduce Phase 2 growth.
