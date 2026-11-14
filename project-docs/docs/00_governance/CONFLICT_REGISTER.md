# Conflict Resolution and Supersession Register

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

This is a **decision reconciliation**, not an implementation fix. Every row prevents resurrection of older behavior.

| ID | Area | Superseding owner requirement | Status |
|---|---|---|---|
| CF-01 | Mobile authoring | UI-44/55/103: phone portfolio/code authoring prohibited | SUPERSEDED |
| CF-02 | Guest authoring | UI-110: login required before authoring | SUPERSEDED |
| CF-03 | Template maximum | UI-46: five initially, not a permanent cap | SUPERSEDED |
| CF-04 | Projects ingestion | UI-25/30/31/41: link-based projects, optional safe thumbnail | SUPERSEDED |
| CF-05 | Account signup | UI-03/06/12: email/password with handle/name, confirmation not mandatory | RESOLVED |
| CF-06 | Published project/profile visibility | UI-108/109: private until explicitly published; each project surface selected | SUPERSEDED |
| CF-07 | Visitor analytics | UI-115: OFF by default; per-published-portfolio explicit opt-in | SUPERSEDED |
| CF-08 | Theme customization | UI-57: tiered CSS-variable overrides down to component/responsive | EXPANDED |
| CF-09 | Public custom JS | UI-59/73 and isolated sandbox finding: safe static release or source export | GATED |
| CF-10 | Admin privilege | UI-74/93/113: separate role-limited Users and Moderation, appeals; advanced dashboards P3 | SUPERSEDED |
| CF-11 | Trash and account deletion | UI-112: 15-day item Trash, account erasure separate | RESOLVED |
| CF-12 | Release phases | UI-114: P1 core+admin, P2 growth, P3 optional AI/admin analytics | SUPERSEDED |
| CF-13 | Typography | UI-106: roles approved, exact families remain unverified | OPEN TECH DESIGN |
| CF-14 | Public URLs | UI-107: /u/:handle, /u/:handle/projects/:slug; portfolio route conditional | RESOLVED PARTIAL |
| CF-15 | ₹1000 allowance | Later strict ₹0 recurring / no paid activation | SUPERSEDED |
| CF-16 | Real-time integrations | UI-77: public handles + permitted free lookup/Sync; link-only fallback | SUPERSEDED |

## Priority implementation notes

- **CF-01 / CF-02:** Mobile and guest authoring changes invalidate earlier responsive/source fallback acceptance tests. Replace those tests with denial, continuation, preview fidelity and authenticated offline recovery.
- **CF-09 / CF-14:** A host capable of static HTML is not automatically capable of revocation; direct immutable object URLs and CDN caches must be verified before claiming Unpublish succeeded.
- **CF-06 / CF-07:** Publishing a portfolio does not automatically publish the developer profile or enable analytics. Each setting has an independent affirmative action.
- **CF-10:** Required security audit events for early admin actions are not the same as optional P3 admin analytics dashboards.
- **CF-13:** Typography remains a design proof rather than permission to substitute a convenient web font.

See [technical proofs](../../registers/TECHNICAL_PROOFS.csv) and [owner decisions](../../registers/DECISIONS_UI_001_115.csv).
