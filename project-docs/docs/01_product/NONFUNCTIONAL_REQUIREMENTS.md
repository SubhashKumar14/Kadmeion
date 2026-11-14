# Nonfunctional Requirements and Testable Quality Targets

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

| Area | Requirement | Test method | Status |
|---|---|---|---|
| Accessibility | Target WCAG 2.2 AA on supported critical journeys; keyboard equivalent for drag, focus/announcement/reduced motion | axe-like automated screening **plus** manual screen reader, keyboard and 200% zoom checks | NOT RUN |
| Security | RLS/storage owner isolation, auth callbacks allowlist, no raw code privileged execution, signed reviewer access | Negative API/SQL, direct URLs, hostile JS and SSRF tests | NOT RUN |
| Integrity | A valid committed revision remains single authority across canvas/source/export | Golden-file roundtrip, revision/undo/crash fault tests | NOT RUN |
| Privacy | Identity/projects private, analytics off by default, no other-user data leak | Public projection + consent disabled + token revocation matrix | NOT RUN |
| Performance | Maintain responsive perceivable feedback without artificial loader hold; quantify on measured devices | Defined dataset/network/browser performance profile, cold/warm and percentile | NOT RUN |
| Interoperability | Static export works without Kadmeion client-side JS or Supabase credentials | Offline independent local server/JS-disabled source test | NOT RUN |
| Portability | Project archive includes owned code/assets, excludes secrets, preserves manifest versions | Import/reopen and checksum validation; adversarial ZIP test | NOT RUN |
| Cost | Strict ₹0 recurring and deny auto billing/overage; safe fallback on quotas | Provider terms, service quotas, real enforced hard stops | NOT RUN |
| Auditability | Admin change/event reasons and decisions are retained with minimal PII | Roles/differential access, audit immutability/replay tests | NOT RUN |
| Operability | During host failure prior release remains live where possible; no silent publish success | Fault injection before/after pointer switch and rollback | NOT RUN |

**No unsupported numeric SLO is claimed.** Specific thresholds (TTFB, CLS, bundle, API rate caps, max per-owner storage) must be selected after hosting/data and realistic test evidence. Current `3s` in older source is a target hypothesis, not a guarantee.
