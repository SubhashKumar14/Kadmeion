# Technical Proof Register and Engineering Kill Rules

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

Each item is a **hypothesis/gate**, not an approved live integration. These failures should not silently force the UI to claim an inaccessible feature is working.

| Proof | Severity | Area | Status |
|---|---|---|---|
| TP-01 | P0 | Supabase Auth + Brevo | NOT_PROVEN |
| TP-02 | P0 | Supabase RLS and private Storage | NOT_PROVEN |
| TP-03 | P0 | Static HTML delivery & DB independence | NOT_PROVEN |
| TP-04 | P0 | Public route revocation/rollback | NOT_PROVEN |
| TP-05 | P0 | Untrusted custom JS isolation | NOT_PROVEN |
| TP-06 | P0 | Author asset/URL and ZIP validation | NOT_PROVEN |
| TP-07 | P0 | Reviewer token expiry/revocation | NOT_PROVEN |
| TP-08 | P0 | Project privacy across immutable releases | NOT_PROVEN |
| TP-09 | P0 | Auth without mandatory email confirmation | NOT_PROVEN |
| TP-10 | P1 | Approved original brand assets | NOT_PROVEN |
| TP-11 | P1 | Editor one-writer and lossless transactions | NOT_PROVEN |
| TP-12 | P1 | Preview/static output parity | NOT_PROVEN |
| TP-13 | P1 | Qualified large-tablet editing | NOT_PROVEN |
| TP-14 | P1 | Website screenshot capture | NOT_PROVEN |
| TP-15 | P1 | Six-platform public-handle data access | NOT_PROVEN |
| TP-16 | P1 | Analytics opt-in and privacy | NOT_PROVEN |
| TP-17 | P1 | WCAG 2.2 AA critical journeys | NOT_RUN |
| TP-18 | P1 | Strict ₹0 service viability | NOT_PROVEN |
| TP-19 | P1 | Account erasure and backup retention | NOT_PROVEN |
| TP-20 | P2 | Private score confidence | NOT_RUN |

## Stop/go ordering

**Gate A — identity/data:** real RLS/Auth/email and strict free-account eligibility. **Gate B — editor integrity:** one writer, full ZIP/owned code preservation, invalid source and conflicts. **Gate C — static publishing:** no dangerous custom JS, release host HTML/SEO/revocation and reviewer expiry. **Gate D — UX:** keyboard/screen-reader/zoom, responsive qualified devices and actual brand reference fidelity. **Gate E — Phase 2 data:** source permissions/accuracy and analytics opt-in. **Gate F — optional P3:** AI and advanced admin dashboards only upon a new authorization.

A failed P0 means do not proceed to public live operation of the affected feature, even if a visual demo looks complete. Provider rate/terms verification is not substitutable by a drawing, a benchmark from another app or generated code.
