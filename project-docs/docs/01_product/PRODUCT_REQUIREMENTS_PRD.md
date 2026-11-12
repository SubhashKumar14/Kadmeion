# Product Requirements Document (Full Capstone Scope)

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

## Product definition

Kadmeion is a developer identity and portfolio building platform with authentic project storytelling, versioned, file-exposed visual/code editing, privacy-first publishing, and later private progress/aggregate analytics. **Tagline:** *Build · Showcase · Evolve*. It is not a generic résumé generator, public developer rating marketplace, team analytics portal or automatic GitHub repository mirror.

## Problem statement and opportunity

Developers often need a credible public representation that adapts beyond a fixed template, but ordinary no-code tools constrain authored source while full code-first setups burden nonexperts. Static screenshots alone obscure project decision-making; developer statistics from incompatible sites can mislead; public web sharing creates privacy/hosting risks. Kadmeion seeks to combine authored identity, project evidence, slot-based customizable portfolios and optionally privately explained growth without requiring paid APIs or copying repositories.

## Target audiences and actors

- **Guest/visitor:** explore actual public profiles and portfolios, template demos; cannot edit without signing in.
- **Developer:** owns identity, projects, portfolios, releases, source, assets, privacy settings and later private growth.
- **Reviewer with scoped staging token:** sees only pinned, unexpired, unrevoked read-only preview.
- **Restricted operator:** user access restrictions, documented serious-abuse temporary unpublishing, notices and appeals; no impersonation/editorial editing.

## Primary user values

1. Distinctive portfolio identity without requiring GitHub or code experience.
2. Maintain source ownership; no auto-overwrites of modified components.
3. Explainable one-way transformation from template/slot edits to committed source and public static HTML.
4. Make public exposure intentional; drafts private, profiles/projects private, analytics off until opted in.
5. Continue to own/export work despite free service outage.
6. Clear visuals and accessibility across supported devices.

## Functional requirement catalogue

| Requirement | Critical behavior | Phase / Decision references |
|---|---|---|
| FR-01 | Email/password, optional Google, callback, recovery, validated handles, positive-only verified badge | P1 · UI-01–15 |
| FR-02 | Public landing, curated template demos and seven-second three-view showcase | P1 · UI-16–22/26 |
| FR-03 | Private account profile, editable/public preview, explicit Publish Profile | P1 · UI-23–24/27–28/87/108 |
| FR-04 | Private link-based projects, optional safe screenshot capture, modular case study, per-surface public exposure | P1 · UI-25/29–32/39–43/109 |
| FR-05 | Workspace three zones and explanatory empty states | P1 · UI-36–38 |
| FR-06 | Five initial extensible presets, eight initial section layouts, Blank, supported large-device editor | P1 · UI-44–50/55/60 |
| FR-07 | Owned reusable components, guarded swaps, responsive CSS token hierarchy, asset management | P1 · UI-48–59 |
| FR-08 | Source diagnostics, stale preview, one-file-set transactions, Undo/Redo and crash recovery | P1 · UI-52–65 |
| FR-09 | Author/Published preview, short-lived staging, security preflight and deliberate private-first publish | P1 · UI-62/66–68 |
| FR-10 | Immutable release/rollback, SEO/meta, URL rename, Draft vs Live, safe static JS degradation, export | P1 · UI-69–75 |
| FR-11 | Settings, notifications, account security, privacy, 15-day Trash and separate account erasure | P1 · UI-86–95/112 |
| FR-12 | Restricted Users and Portfolio Moderation, reasons, notices, appeals and mandatory audit | P1 · UI-74/93/113 |
| FR-13 | Private Developer Activity and optional permitted public-handle synchronization across six platforms | P2 · UI-76–79/89 |
| FR-14 | Opt-in aggregate per-portfolio analytics and accessible reporting | P2 · UI-80–81/115 |
| FR-15 | Private explainable DevScore and custom/template goals | P2 · UI-82–85 |
| FR-16 | Optional AI and advanced admin analytics only upon separate future authorization | P3 · UI-74/114 |
| FR-17 | Consistent shells, Aether Drift identity, glyph skeleton mechanism, themes, motion and WCAG design gates | All · UI-96–106 |

## Must-work acceptance journeys

- New user registers, handle uniqueness race rejects collision without losing fields, reaches welcome without forced GitHub.
- Owner adds private project with repo and live URL; remote screenshot service failure never loses project and manual image works.
- Owner starts Blank portfolio, adds compatible slot component, deletes it into EMPTY, Undo restores exact content/source; unsupported swap is non-destructive.
- Editor theme CSS variables and responsive preview correspond to exported static output; owned opaque code stays unchanged.
- Owner requests public release; all blockers listed; invalid custom JS cannot run with application privileges; only verified host fetch yields Published.
- Profile/private projects never leak by changing portfolio visibility; reversible item Trash lasts 15 days; account deletion separately disclosed.
- Reviewer link expires and revokes server-side; operator cannot edit author content; database RLS blocks cross-user reads.
- P2 later: profile handle sync fails gracefully if API disallowed; DevScore composite suppressed if insufficient evidence; analytics off before explicit opt-in.

## Nonfunctional and ethics requirements

Strict ₹0 recurring spend, open-source compatible dependencies, Supabase-only business backend, true static HTML SEO/JS-off, recovery/export, no fake stats, minimal telemetry, truthful data provenance, WCAG 2.2 AA target, no paid API/credit card auto-upgrade, rate-limited source capture/auth, comprehensive RLS tests, privacy-preserving administration. Unproven guarantees appear in Proof Register.

## Success measurement, NOT results

| Success measure | Definition / required test | Status |
|---|---|---|
| End-to-end portfolio release | One real account → project → editor → validated public static URL on tested free host | NOT RUN |
| Data integrity | Deleting/swapping/undoing preserves original owned source byte-for-byte in a golden corpus | NOT RUN |
| Accessibility | Keyboard, screen reader, contrast/reflow/manual assistive tech tests per critical screen | NOT RUN |
| Privacy | Cross-user RLS, private profile/project, staging and URL-revocation tests | NOT RUN |
| Export independence | Rebuild/open static ZIP without Kadmeion online service | NOT RUN |
| ₹0 compliance | Verify all project/service usage and hard quota handling with no billing mode | NOT RUN |
