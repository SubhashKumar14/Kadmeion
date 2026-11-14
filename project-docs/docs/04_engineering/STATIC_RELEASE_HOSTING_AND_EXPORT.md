# Static Rendering, Hosting, Release Delivery and Portability

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

## Public release invariants

1. Build from one **frozen** project revision and pinned manifests; metadata and public CSS are generated from the same exact content.
2. Serve actual pre-rendered HTML/SEO data to plain HTTP and JavaScript-disabled browsers. Each public release is immutable by hash; live visibility is a mutable controlled mapping.
3. Public path must honor selected visibility: Private blocks unapproved visitors; Unlisted link access is not authentication; Public may be indexed. Staging is separate expiring/revocable server-token access.
4. A release is not live merely because an upload request succeeded. It is live when visitor fetch verifies intended release content, status and assets.
5. Unpublish/deletion/restrict action must verify both canonical route and any direct immutable asset/release URL bypass. Do not claim universal cache erasure.
6. A newly private project referenced inside an existing public immutable release requires route revocation or safe republish before privacy is claimed applied.

## Host selection remains unapproved

**Candidates:** Vercel static/route adapter or Cloudflare Pages/Workers Free, respecting usage terms and no billing/credit-card overages. Existing Supabase-only business backend remains; a narrow public release resolver is not permission to create a second business database. The source previously flagged the possibility of a separate strongly consistent visibility pointer: that architectural divergence must be explicitly reviewed if tests show it is necessary.

**Mandatory host proof:** hostname availability, per-route static HTML, route rewrites, direct asset statuses, noindex private staging, CDN caching and invalidation, unpublish/rollback races, fail-closed on quota/provider loss, cost/quota/terms, public UGC restrictions and independence from paused Supabase DB when possible.

## Public path and SEO

- Owner-approved public identity `/u/:handle`, case study `/u/:handle/projects/:projectSlug`.
- Independent portfolio route `/:username/:portfolioSlug` on intended `kadmeion.vercel.app` is a *preferred conditional shape*, not verified reservation/hosting.
- Reserve prefixes `u`, `app`, `auth`, `signin`, `signup`, `templates`, `r`, `status`, `explore`. Handle case-folding, Unicode normalization/slug syntax, redirects, 404/410, canonical and sitemap/robots policies.
- Metadata title, description and share image use actual author content, not fabricated projects or views; analytics is disabled until explicitly opted into for each published portfolio.

## Private and public delivery state differences

| Type | Can be indexed? | Requires access? | Script behavior |
|---|---|---|---|
| Owner draft | No | Owner only | Restricted preview only |
| Staging reviewer link | No | Server-checked random token/expiry/revoke | Visitor-simulation; safe restricted output |
| Published Public | If opted in under product setting | Anyone | Trusted static, user JS blocked unless separate isolation proven |
| Published Unlisted | No indexing intent | Anyone with URL | Same public trust restrictions |
| Private/unpublished/tombstone | No | Owner/admin only for management | Public response 404/410/denial, no source |

## Export products

- **Project archive:** human-readable manifest, content, theme, owned source, assets, pinned versions, optional carefully chosen revision history, importer instructions; never secrets or privileged data.
- **Static archive:** rendered HTML/CSS/raster media, actual metadata, verified relative links, checksums and clear limits on unsupported custom interactive code. It must serve from an independent static origin or local server under browser restrictions.
- **Failure safety:** if public provider disappears, do not promise the hosted URL lives forever. Allow download/independent republishing of the output wherever permitted.

## Deployment runbook prerequisite

Before any deployment, confirm account permissions, free-tier usage caps, nonbillable settings, secrets and callback hosts, RLS tests, static site terms, accessibility and browser tests. Never embed a service key into built static assets or commit provider secrets in a repository.
