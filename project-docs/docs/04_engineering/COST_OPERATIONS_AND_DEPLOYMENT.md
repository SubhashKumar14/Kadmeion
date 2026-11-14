# Strict ₹0 Operations, Free-Tier Quotas and Deployment Proof

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

## Cost contract

**Hard owner rule:** zero recurring expense; no paid APIs, automatic subscriptions or usage-based upgrades. No assumed ₹1000 fallback cap. Application libraries must be open-source-compatible; hosted Supabase/Vercel/Cloudflare/Brevo services can be proprietary free infrastructure and must be treated as external risk.

## Provider candidate gates

| Service | Approved? | Current intended role | Remaining proof |
|---|---|---|---|
| Supabase | Backend choice approved | Auth, Postgres RLS, Storage, Edge/RPC | Real free project, row/Storage policies, quotas and pause behavior |
| Brevo | Owner-selected email delivery | Auth/recovery transactional SMTP | Free account activation, sender identity, deliverability, reset quota, domain limitations |
| Vercel | Candidate only | Frontend and independent static release routing | Hostname, actual HTML, noncommercial/fair-use, access/purge and free limits |
| Cloudflare Pages/Workers | Candidate only | Alternate static/release resolver | Free CPU/requests, cache, revocation consistency, UGC terms and code ownership |
| Public code-platform APIs | Conditional P2 | Public-handle facts | Official permitted free data/fields and quotas per provider |
| Website thumbnail renderer | No candidate approved | Optional live URL screenshot | SSRF/egress hardening and guaranteed zero-charge limits |
| AI service | Deferred P3 | Optional contextual guidance | Free legal provider and data/secret handling; no paid fallthrough |

## Required deployment checklist

- Use disposable environment first with no user secrets and quotas configured. Pin dependency versions, check licenses and SBOM; no fake code/build status.
- Verify Auth invitation/recovery emails across provider recipients and failed delivery, Google redirect and rate limits.
- Apply versioned Postgres migrations only after owner-RLS negative tests; maintain reversible migration plan and backup/restore constraints.
- Build JS-off static HTML from frozen project; verify direct public fetch and SEO metadata, site-wide reserved routes, release checksums, staging expiry, cache and delete statuses.
- Prove free-host independent delivery with Supabase unavailable where chosen design requires; if not feasible state degraded capability and request scope/design decision rather than lying.
- Prove no secret/token emitted in client bundles, static HTML, logs or ZIP exports.
- Hard-block service work or signup when quotas would incur payment; expose honest “temporarily unavailable/please export” UX.
- Collect screenshots or metrics **only from measured tests**, recording tool/time/browser/network/host/cost evidence.

## Provider-loss playbook

Cloud DB unavailable → local previously owned project may remain exportable; owner cloud sync/publish disabled. Static host unavailable → live URL cannot be promised, but portable static ZIP is the user escape path. Brevo failure → no false recovery confirmation; defer open signup if password reset cannot work reliably. Provider API blocked → link-only integration. Capture disabled → manual screenshot.

## External documentation used as general proof references (not integration tests)

- Supabase custom SMTP: https://supabase.com/docs/guides/auth/auth-smtp (checked Nov 2026; default server restricted).
- Supabase row-level security: https://supabase.com/docs/guides/database/postgres/row-level-security (checked Nov 2026).
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/ (limits change; not chosen).
- WCAG 2.2: https://www.w3.org/TR/WCAG22/ .
- OWASP SSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html .
