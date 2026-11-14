# Optional Public Developer Data and Website Thumbnail Feasibility

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

## Handle-based platform linking (Phase 2)

Approved integration UI: GitHub, LeetCode, Codeforces, HackerRank, Kaggle and Hugging Face. Owner supplies a public handle or profile link, not necessarily OAuth or MCP. Only a verified permitted free endpoint may retrieve public facts, source timestamps and provider-specific units; Sync Now is explicit. If API terms/free availability make that impossible, preserve **link-only** mode and show `Unavailable / Not synced / Last successful sync` instead of fabricated data. A public handle match is not verified account ownership.

| Provider | Candidate data, NOT promised | Required independent proof | Fallback |
|---|---|---|---|
| GitHub | Public repositories/profile events/contributions where documented | API permission, rate limits, token need, provenance, user visibility | URL + user-supplied project links |
| LeetCode | Profile/progress if an authorized documented endpoint exists | Site/API terms, public availability, limits, no anti-bot bypass | URL only |
| Codeforces | Rating/contests if API permits | Official fields, rate, errors and identity ambiguity | URL only |
| HackerRank | Public profile/achievements only where permitted | Public data endpoint/terms, no scraping bypass | URL only |
| Kaggle | Profile/public competitions/projects only where permitted | API/auth/permission/terms | URL only |
| Hugging Face | Public models/datasets/spaces where API permits | Endpoint, authorship semantics and rate limits | URL only |

**Critical rule:** A service offering a web page does not automatically authorize automated scraping. Do not bypass login, robots/terms limitations, captcha, IP limits or bot protection; only use documented/publicly permitted retrieval. Do not label derived contribution graphs as proven achievements if source semantics differ. Each sync record stores source URL, timestamp, original metric name, error and owner consent.

## Live URL screenshot capture (Phase 1, conditional)

Owner requested: developer enters live URL → project saved **immediately** → optionally try a screenshot at submission → result becomes a thumbnail in folder-like project card; otherwise user uploads image or accepts fallback.

A server-side renderer with arbitrary URLs is a high-risk **SSRF surface**, even if a browser screenshot looks harmless. Before any capture, prove: allowed URL protocols and redirects, private/reserved-IP block before and after every DNS/redirect hop, no service credentials/cookies, prohibit internal metadata endpoints, egress allowlist where possible, content size and render timeout, concurrency/quota, safe filename/image rasterization, data retention, site terms and absence of paid charges. Browser client capture of third-party sites is often blocked by cross-origin policy and cannot be guaranteed.

**No approved capture infrastructure yet.** The correct currently supportable UX specification is: preserve the project, indicate `Thumbnail unavailable` with manual Upload/Replace/Retry where permitted, and never claim capture occurred. Avoid asking the user to enter live-site credentials.

## Brevo transactional email (Phase 1, selected vendor)

Brevo is the **owner-selected provider**, but is not configured. Verify free eligibility, sender-domain/address requirements, SMTP credentials and restrictions, delivery to multiple providers, password-reset expiry/resend, quota enforcement, spam/reputation and account-creation edge cases. Supabase default sender is restricted and not a production substitute. No password recovery success may be claimed before actual provider confirmation.

## Minimal provider evidence record

`provider; official docs URL; verified_at; free account requirements; method; permitted fields; quotas; auth need; owner privacy; sandbox results; fallback; approval/status`. Link-only is allowed by UI-77; automated capture/sync is not guaranteed. The current project must never auto-upgrade or buy credits.
