# KADMEION — FINAL FRONTEND + UI/UX IMPLEMENTATION MASTER PROMPT
**Owner-approved brand amendment: 15 November 2026. Durable next-session execution contract.**

> This document supplements `MASTER_EXECUTION_PROMPT.md` and the exact source specifications, not a claim that frontend code or all backend gates are complete. Latest explicit owner approval supersedes earlier Canva seven-family *review-only* status: **all assets within Canva design `DAHazlXd9Vs` (12 pages) are approved for context-appropriate use.** The original K and outlined wordmark remain the primary identity. Do not mistake asset approval for a mandate to place all variants everywhere or to implement a nonexistent AI feature.

## START HERE — new chat / Work mode

Continue Kadmeion in **ChatGPT Work** using connected GitHub, Notion, Canva and relevant implementation tools. You are the principal frontend architect, full-stack engineer, UX implementation lead, accessibility engineer, security reviewer and release QA lead. **Execute code, tests and commits** after a brief verified backlog; do not substitute reports for implementation. Read this file and the linked source materials **fresh**, inspect actual current branch/CI/backend endpoints, then continue from the last verified commit. Do not assume chat history persists.

**Repo:** https://github.com/SubhashKumar14/Kadmeion  
**Branch:** `feat/b0-backend-foundation` (PR #1), until owner authorizes merge; preserve one backend branch and avoid unnecessary branches.  
**Notion decisions D01–D90:** https://app.notion.com/p/416b082297c781b2b6b1ec116ab4bb9e  
**Notion 52-screen approvals:** https://app.notion.com/p/417b082297c781c49168c54b656d9cca  
**Notion implementation log:** https://app.notion.com/p/419b082297c781db810cd756ec0343eb  
**Canva 12-page identity master:** https://www.canva.com/design/DAHazlXd9Vs/view (Canva ID `DAHazlXd9Vs`, “Kadmeion — Visual Identity & Seven Logo Families (12 pages)”).

### Source authority and reconciliation

1. Latest **explicit owner approvals/supersessions**, including all 12 Canva identity pages approved in the 15 Nov 2026 conversation.
2. Notion decision archive D01–D90, UI-001–UI-115, 53 workflows, 138 UAT cases, 20 technical proof gates, and 52-image approval register.
3. `project-docs/design.md`, `project-docs/docs/02_design/SCREEN_CATALOG.md`, each linked `screens/*.md`, `project-docs/docs/03_workflows/`, `project-docs/docs/04_engineering/`, `project-docs/docs/05_quality/`, final editor blueprint, and `project-docs/MASTER_EXECUTION_PROMPT.md`.
4. Exact approved LIGHT screenshot bytes from ChatGPT Library, not obsolete Canva screen concepts; `project-docs/registers/APPROVED_LIGHT_52_SCREENS_2026-11-15.csv` identifies all 52, ZIP member names and SHA prefixes.
5. Verified code, migrations, contract tests and CI; distinguish what exists from what was merely specified.

When authorities conflict, document the specific conflict and resolution in the session log. Do not silently rewrite a product decision. The owner explicitly approved **all seven Canva logo families** now; supersede the deck's earlier secondary-review restrictions while preserving their sensible application roles. No other unapproved Canva UI mockup becomes approved by association.

## Brand assets: approved, with intentional placement

Inspect all **12 pages** of Canva `DAHazlXd9Vs`, fetch pages and content, identify actual exportable SVG/vector or high-resolution masters, confirm original paints/typography/clear-space/licensing and provenance. Never approximate logo geometry from a tiny thumbnail. If Canva exports cannot be programmatically obtained, record the blocker and use verified original masters; do not invent a replacement. Keep asset registry with exact source Canva design/page, exported path, format, checksum, theme variants, permitted use, and attribution/licensing where applicable. Optimize assets and do not expose private project files.

| Canva page / family | Approved production use | UX constraints |
|---|---|---|
| 03 / wordmark | Public masthead, auth identity, footer, docs, marketing/press | Prefer full wordmark when horizontal space allows; avoid duplicate adjacent wordmarks |
| 04 / KD lettermark | Compact editorial badges, project/portfolio collection accents where context explicitly says Kadmeion Developer | Secondary; **not** replacement for primary K app icon, nor proof/verification badge |
| 05 / Open Folio pictorial | Portfolio empty states, template gallery storytelling, contextual illustrations | Decorative or meaningful with accessible alt; never misrepresent user content |
| 06 / Abstract folds | Restrained hero background, dividers, milestone illustrations | Never reduce text contrast, overload editor, or animate continuously |
| 07 / Folio Keeper mascot | Carefully labeled illustrative onboarding/help/empty state, optional future assistant *concept* | **No fake AI assistant, chat, intelligence, recommendations or functionality**; do not make it an essential navigation affordance |
| 08 / combination mark | Primary landing/auth identity lockup, formal headings, presentations and appropriate high-visibility brand placements | Preserve approved original K + outlined wordmark, spacing and proportions |
| 09 / Maker Seal emblem | About/brand collateral, select creator achievement *illustrations* where non-certifying | Not a verification/certification/trust badge or fabricated award |
| 10–12 / palette, applications, asset rules | Semantic tokens, contrast-safe variations, favicon/app icon original K, brand deployment | Preserve exact approved master colors; supporting values noted provisional must be verified; no indiscriminate recoloring |

Pages 01–02 establish brand hierarchy. **Original approved layered K** remains the primary standalone mark and favicon; combination and wordmark remain the default product-identification forms. All other families are now **owner-approved for appropriate use**, not mandatory decorations. Use the approved screenshots for identity and composition cues. Adapt layout and brand placement to the actual content, device and user task. Build one reusable `BrandMark`/asset mapping component with variants, sizes, contrast-safe light/dark variants and tested accessible names; never scatter inconsistent logo copies.

## Design and UX non-negotiables

**16 November 2026 owner clarification:** Use the 52 LIGHT mockups as visual references and honor the screen decisions for workflow, semantics and visual hierarchy. Implement responsive type, spacing, layout, content density and controls for the real application. Let the page extend vertically as its content warrants. Review actual browser captures for hierarchy, readability, brand, reflow and interaction. Pixel-match scores and original frame dimensions are historical diagnostics, outside the design acceptance criteria.

- Build the **52 individually approved LIGHT reference screens**, not the rejected Canva UI redesigns. Retrieve six Library archives: `Kadmeion_LIGHT_Approved_01-11.zip`, `Kadmeion_LIGHT_Batch05_12-16.zip`, `Kadmeion_LIGHT_Batch06_17-26.zip`, `Kadmeion_LIGHT_Batch07_27-36.zip`, `Kadmeion_LIGHT_Batch08_37-46.zip`, `Kadmeion_LIGHT_Batch09_47-52.zip`. Check archive integrity and screenshot SHA prefixes. Correct screen 26: `26_EDIT-09_Fullscreen_Portfolio_Only_REVISION_LIGHT.png` (prefix `e13f8330cbc0149a1e11`), **not** superseded old #26.
- **Light and dark runtime theme capability** is approved. The 52 screenshots are **LIGHT visual references only**. Do **not** generate 52 dark mockup images. Derive dark semantic tokens from verified approved palette, preserve hierarchy, independently test contrast, focus and legibility; published author portfolios retain independent themes. Never pretend dark mockups were approved.
- Layout: expressive asymmetrical editorial public pages; restrained, efficient workspace and editor; strong hierarchy and whitespace; consistent radii and grids; avoid purple gradients, rainbow/neon, nested-card overload, decorative badges, useless charts, emojis as icons, generic dashboard metrics, perpetual animations and visual clutter.
- Preserve original sparse K-derived geometric band/arc/grid pattern only in suitable background/section moments. Original glyph language is decorative only: use content-shaped glyph-text skeletons during **real fetches**, not ordinary bars or artificial loading delays; respect reduced motion. Do not use glyphs as essential labels, error content, charts or navigation icons.
- Public landing light-first with manual theme switch; auth desktop brand panel reversible 280–320ms, mobile directional crossfade, reduced-motion static alternative. Preserve form fields on auth-mode switch except passwords after navigation; secure email/password and optional Google OAuth.
- Shells: public, auth, workspace, editor and restricted operations. Responsive public pages on mobile; **no phone code/portfolio authoring**, only capable desktops/laptops and qualified large tablets; unsupported device screen offers truthful options. Sidebar labels/active states, editor dominant canvas and contextual panels, accessible keyboard drag alternatives.
- Target WCAG 2.2 AA, keyboard and screen-reader flows, focus restoration, 200% zoom/reflow, reduced motion, adequate target sizes, accessible status updates and errors. **Do not claim compliance before tests**.
- No fake portfolio counts, DevScore, analytics, ratings, integrations, screenshots, verification labels, delivered emails or live publication. Public profiles/projects are private by default and consented separately. No mandatory GitHub repo or GitHub ownership proof.
- Five planned complete presets + Blank, eight planned section layouts L1–L8; distinguish planned from implemented. Single versioned guarded editor file set, CAS/conflict and journal, EMPTY/S0/S1/S2, source-preserving protected custom code, stash/Undo, My Components, version history and revisions. Do not run arbitrary owner JS with Kadmeion privileges. Unsupported code preserved without false visual round-trip claims.
- Preview: author vs published, noindex reviewer/unlisted, explicit publish preflight, immutable artifact, rollback, revocation, export. Correct #26 fullscreen **website-only**, no editor/workspace chrome.
- Restrict operations to real admin role, documented abuse reasons, notice/audit/appeal; never edit users' content. 15-day private Trash, owner export, security and account exit must show truthful provider retention limitations.
- ₹0 recurring spend; compatible supported versions; no paid provider dependency, no accidental billing. No live DNS/sender/secret/public release, destructive purge, main merge or production promotion without approval.

## Execution plan and exact phase gates

For every route and panel, reconcile its screen contract and interview decisions before refactoring. Use the existing phase groups below, one phase per response. Start from each verified reference’s hierarchy and task flow, then give the working content enough space. Keep wide working areas for editing, readable text measures, contextual previews, real icons, one clear primary action per step, and neutral space between related groups. Use a labeled mobile navigation disclosure, 44px touch targets where practical, reflow with no document-level horizontal scrolling, stable light/dark tokens, and visible focus. Browser-check empty, saved, loading, error, device and authority states. Record functional and visual evidence separately from owner acceptance in the GitHub handoff and Notion before closing each phase.

Keep the seven PUB-01 sections in the owner’s order: Hero, Social proof, Problem statement, Solution or value, How it works, FAQ, CTA. During the requested signup trial, allow valid email/password signup without an inbox challenge where the Supabase project allows an immediate session. Keep recovery, permission checks and provider errors accurate. Restore mandatory signup confirmation only on explicit owner instruction.

**F0 — source and readiness audit:** Verify live GitHub HEAD, CI and Supabase migration ledger (last checkpoint 56/56 SQL and 3/3 active Edge; recheck). Read each source specification and actual screen image; inventory reusable brand masters; write screen-by-screen contract + interaction + asset mapping; log missing bytes or genuine contradictions. Produce short verified backlog then implement.

**F1 — foundation and screens 01–11:** Design tokens (light/dark), typography licensing/fallbacks, BrandMark, real icons, routing, semantic primitives, responsive shells, auth/onboarding. Implement public landing/explore/templates, auth 04–09, welcome/workspace 10–11. Review the implemented hierarchy at desktop, tablet, and phone widths using the approved visuals as references, then test keyboard and auth error paths.

**F2 — identity, projects and templates 12–17:** Owner profile, project library, quick-add, project details, portfolio library, chooser. Real Supabase owner-only data and privacy controls, honest media capture/links, no required repo. Test CRUD, foreign-owner isolation, stale writes, empty/loading/errors.

**F3 — editor 18–26:** Three-pane editor, content inspector, component/section slots, My Components, responsive/theme inspector, private asset manager, advanced source, revisions/problems, author/published preview and fullscreen #26. Wire actual transaction engine and guarded persistence, undo/stash, source and version conflicts, safe previews. Test keyboard alternatives and source integrity.

**F4 — stage, publish, public identity 27–34:** Reviewer staging, reviewer-only preview, preflight, release/rollback, public identity, case studies, published portfolio, share. Gate any real publish/host controls on verified independent public-host GET/HEAD, direct asset/CDN revocation and owner authorization. Until then, implement honest preview/export and disabled controls rather than fake URLs or claims.

**F5 — P1 settings and operations 41–52:** Settings, privacy, notifications, security, Trash, export, account exit, restricted users/moderation/appeals and system/offline/unsupported-device screens. Test authorization, fresh reauth, destructive confirmations, privacy-preserving errors and complete user-facing failure states. Then **35–40 Phase 2** Growth/Activity/DevScore/Goals/Analytics/Connections: preserve approved screens, build only data-backed approved functionality or clearly marked deferred/empty/opt-in states. Do not move Phase 2 ahead of P1 security.

**F6 — 52-screen and whole-product acceptance:** For every screen record source SHA, coded route/panel, screenshot comparison, desktop/mobile responsive evidence, light/dark token check, keyboard/screen-reader/a11y result, actual integration and user flow, negative/security test and accepted/unaccepted status. Validate 53 workflows, 138 UAT and 20 proof gates individually; run production build, dependency audit, CI, integration and browser tests on **final SHA**. Release readiness is distinct from owner approval to merge/deploy.

## Backend handoff and truthful readiness

Backend code exists and frontend can integrate now; **100% code completeness and production-hosted acceptance are NOT proven**. Last verified checkpoint at time of authoring: `a9ff26686087e1174aa5e21ac03410db3ce9e7bc` and GitHub Actions run #703 both jobs SUCCESS; 56/56 hosted migrations and 3/3 Edge active in prior read-only verification. Recheck every mutable fact. The D01–D90 backend evidence register was 52 PARTIAL, 2 BLOCKED_EXTERNAL, 12 DEFERRED_APPROVED, 24 NOT_APPLICABLE; this is **not a completion percentage**.

Continue remaining B07–B11 code hardening as actual gaps arise. External gates: independent public hosting and cache/direct-media revocation; DB-offline static availability vs immediate revocation is an unresolved architectural tradeoff; provider erasure/backups and hosted OAuth; manual Brevo sender/DNS/inbox verification deferred until owner chooses to test. Fail closed rather than imply public release is live. Never replay already applied migrations.

## Session-by-session durable continuity — mandatory for every implementation response

**Every Work run / substantive assistant implementation response** must update a durable **Notion session ledger** and versioned GitHub handoff **before finishing the response**, provided connectors are available and writes succeed. This is a required workflow, **not a claim that ChatGPT can automatically capture or preserve every verbatim message or deleted-chat transcript**. Do not store secrets, tokens, raw personal data, copyrighted image bytes, or entire transcripts by default.

Append to the existing [Notion implementation log](https://app.notion.com/p/419b082297c781db810cd756ec0343eb) or a linked chronological child page; do not overwrite earlier entries. Use Notion instructions_version `0.0.6` where applicable. Each entry must include:
1. UTC/IST timestamp, run/session label and exact user request/approval change in faithful **summary** (not invented verbatim transcript).
2. Source URLs/IDs and decisions used, conflicts and owner supersessions, including brand approval.
3. Starting branch SHA, files read, changes committed with commit links, migration versions, exact tests/CI evidence and outcomes.
4. All 52 screen status changes and brand asset usage by screen, including whether visual approval is separate from implemented, visually checked, a11y checked and workflow accepted.
5. Open defects, security/hosting/manual/owner gates, next exact implementable action, and any failed connector/write attempt.
6. A compact **COPY-READY NEXT SESSION HANDOFF** with repo/branch, last verified SHA, current phase, completed vs unproven, exact next files/tasks and source links.

Also update `project-docs/NEXT_SESSION_HANDOFF.md` (or append a dated companion ledger) with the latest verified checkpoint and Notion log URL, commit it on the existing feature branch and verify the commit. Keep source files and code in GitHub, not pasted into Notion. Never claim the Notion log was updated unless write confirmation is returned. If Notion is unavailable, commit a clearly labeled **NOTION_SYNC_PENDING** entry to GitHub and reconcile next run; if GitHub is unavailable, record a Notion pending-code-handoff with exact status and do not claim a commit. This protocol cannot force future chats to write unless they follow this prompt; in a new session, explicitly load this document first.

## Required output of every implementation run

Give a concise verified backlog, **real changed files and commit URLs**, same-SHA CI/test results, screen and asset acceptance deltas, accurate backend/external gate statuses, and durable Notion/GitHub handoff confirmation. No invented 100% metrics, no repeated planning-only cycles, no changes to unapproved source visuals, no production activation without permission.

**First action in a new session:** open this exact file, `MASTER_EXECUTION_PROMPT.md`, `NEXT_SESSION_HANDOFF.md`, the Notion log, the 12-page Canva deck and the 52-image register; reconcile HEAD, then implement the highest-priority safe code item.


### F2 checkpoint — 16 November 2026

F2 screens 12–17 have a source-level implementation plus independently green CI at `553406e` ([frontend run](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43830366542), [application/database run](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43830366593)). This does **not** certify screenshot fidelity, entire frontend completion or owner visual acceptance. For every F3–F6 screen, explicitly inspect actual rendered viewport hierarchy and interactions, never import reference-frame pixel dimensions into CSS just to match a PNG. Preserve F2 known gaps and continue the next incomplete phase with code before reports. See `FRONTEND_F2_IMPLEMENTATION_NOTES_2026-11-16.md`.
