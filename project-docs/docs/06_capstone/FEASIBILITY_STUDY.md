# Technical, Economic, Operational and Ethical Feasibility Study

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

## Summary decision

**Conditionally feasible as a staged student capstone**, but secure public user-code execution, truly free unrestricted SMTP and provable public unpublish/rollback are major risks. The proposed minimum safe outcome is a functional accessible versioned editor and independent static export; public hosting only after real security and free-tier evidence. A polished dashboard without tested source integrity/public privacy does not count as successful feasibility.

## Feasibility dimensions

| Dimension | Supporting factors | Material constraints | Mitigation / decision rule |
|---|---|---|---|
| Technical | React/TypeScript, Supabase/Auth/Postgres/RLS, structured manifests, standard browser storage, static HTML export | Source grammar, custom TSX isolation, single writer, SPA/public route resolution, unsafe JS sandbox | Start with pure editor core, static render, tests; block unsafe code/public host |
| Economic | Many free software libraries and service free tiers, student-owned local hardware | Quotas, free-project pauses, email sender/domain, build/render limits, unexpected billable usage | Strict ₹0 hard stop, portable ZIP, link-only provider fallback; do not assume free forever |
| Operational | One student can implement bounded features with phase gates | Moderation burden, abuse, account erasure, uptime/service policy and release support | Narrow admin roles and early user controls, no public signup before trustworthy auth |
| Scheduling | Phase 1 core prioritized before P2/P3 | 115 design decisions, 52 surfaces and complex host integration | Build vertical slices, cut optional features before security guarantees |
| Legal/ethical | Author-owned data, explicit opt-in, external contact links | Third-party scraping rights, project image/source licenses, UGC hosting terms, content takedown, privacy laws | Public API/terms checks, attribution/consent, limited moderators and clear retention; obtain qualified legal review if needed |
| Accessibility | WCAG 2.2 AA target, keyboard layer tree, reduced motion, public responsive pages | Source editor complexity and qualifying tablet/browser support | Real keyboard/SR/zoom tests and device gating; no phone authoring |

## Architecture tradeoffs

**Slot-based structured editor over arbitrary DOM reverse engineering:** loses unconstrained drag-to-anywhere, gains versioning/compatibility and less accidental code corruption. **Static public output over runtime author JS:** loses some public interactive authored components, gains safer SEO/portability. **Supabase-only business backend:** reduces server maintenance, but requires careful RLS/Edge roles and independent public-delivery evaluation. **Free services:** lowers immediate financial cost, increases outage/quota and policy risk.

## Premortem and stop rules

- *R1 — Lost custom work*: affected source diff unexpectedly changes outside intended files → halt patch, preserve preimage, require one-writer golden tests.
- *R2 — Unpublish leak*: old release remains reachable through CDN/raw object → halt public launch, suspend route and investigate strongly consistent authority.
- *R3 — Email recovery broken*: provider rejects sender/unverified domain → no open registration claims, prove alternate free legitimate flow or request separate scope approval.
- *R4 — Fake integration metrics*: unknown public APIs blocked → link-only and source timestamp labels, do not scrape around barriers.
- *R5 — Unsafe code iframe*: navigation into privileged origin → no public user JS, static release/export.
- *R6 — Strict ₹0 violation*: credit card required/paid overages → do not activate provider; restrict feature and disclose.
- *R7 — Accessibility blocked*: layer editing cannot be completed by keyboard/SR → block critical editor release and fix operation alternatives.

## Feasibility decision gate

Mark `POSSIBLE`, `PENDING REAL PROOF`, or `NOT SAFE/NOT ALLOWED` per planned technical proof. Do not convert a researched vendor documentation link into evidence that the complete Kadmeion application was deployed.
