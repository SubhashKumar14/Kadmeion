# Kadmeion — F2 implementation, viewport and CI checkpoint (16 Nov 2026)

> Phase 2 scope: approved LIGHT screens 12–17 are design references; functional behavior comes from the documented screen-level decisions. This is verified engineering evidence, **not** final design or owner acceptance.

## Verified source and implementation

- Branch `feat/b0-backend-foundation` on [Kadmeion](https://github.com/SubhashKumar14/Kadmeion).
- Code commit [`553406e`](https://github.com/SubhashKumar14/Kadmeion/commit/553406e4f5d7905b65d8189e5c7847b029a1109b).
- Updated `apps/frontend/src/profile.tsx`, `apps/frontend/src/projects.tsx`, `apps/frontend/src/portfolios.tsx`, `apps/frontend/src/workspace.css`, `apps/frontend/e2e/owner.spec.ts`.
- Profile has real private persistence, preview-field controls with unique accessible names, explicit unsaved edit status and discard, and guarded failed load/save; not public profile publication.
- Project library, quick-add drawer and detail editor have private owner authentication, recovery on errors, stale-revision comparison and tested case-study persistence.
- Portfolio library and chooser retain private-by-default drafts, a genuine Blank choice, retries with form state preserved and the desktop/tablet authoring gate.
- CSS uses responsive grids, readable form controls, breakpoints and natural document height. Does not impose 1440×900/1600×1000 mockup dimensions.
- Theme rendering remains token-driven for light/dark; developer portfolio authored themes remain independent. No new dark mockups or logo approximations were produced.

## Exact CI at code SHA

| Gate | Run | Status / evidence |
| --- | --- | --- |
| Frontend | [43830366542](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43830366542) | SUCCESS; TypeScript, Vite build, 19 public Chromium tests, production dependency audit |
| Application contracts | [43830366593](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43830366593) | SUCCESS; 504 Node tests, root production dependency audit |
| Local database | [43830366593](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43830366593) | SUCCESS; 511 pgTAP assertions across 28 files and database lint |
| Authenticated browser | [43830366593](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43830366593) | SUCCESS; four isolated Chromium flows with GoTrue/PostgREST and preserved privacy boundaries |

The previous head `cbbc0ab` failed authenticated browser checks because `getByLabel('Display name')` matched both text input and preview checkbox; the F2 fix disambiguates by purpose-specific checkbox label. Both workflows returned GREEN for the corrected code SHA.

## Six F2 page states inspected

From authenticated 1600×1000 browser screenshots captured by the application/database CI:
12 `PROFILE_BROWSER`: private editor + preview;
13 `PROJECTS_BROWSER`: authentic empty project library;
14 `PROJECT_DRAWER_BROWSER`: modal project quick-add with focus;
15 `PROJECT_DETAIL_BROWSER`: saved private case-study;
16 `PORTFOLIO_LIBRARY_BROWSER`: authentic empty library + guidance;
17 `PORTFOLIO_CHOOSER_BROWSER`: choice gallery + private draft name/slug form.

The source-approved PNGs 12–17 could not be independently fetched from the user's Library here; do **not** treat those rendered captures as proof of reference fidelity. The owner has explicitly superseded pixel parity and fixed-frame copying, but material visual hierarchy, readable density and intentional branding still require human assessment.

## Unresolved / deferred

- Per-screen side-by-side qualitative reference review and original screenshot SHA validation; unverified.
- Independent F2 dark-theme screenshot and contrast review; screen-reader/keyboard audit beyond browser automation; WCAG 2.2 AA claim prohibited.
- Hosted Google OAuth, Brevo mail confirmation, public portfolio CDN/rollback and owner UAT separate from source-level CI proof.
- All screens beyond F2 need the same responsive, decision-led treatment; no blanket 52/52 design acceptance.
- No main merge, production promotion, paid dependency or hosted authentication setting changed.

## Next phase

F3: owner-approved LIGHT screens 18–26 editor surfaces, starting at `EDIT-01`; inspect exact approved image addresses, including revised #26 `26_EDIT-09_Fullscreen_Portfolio_Only_REVISION_LIGHT.png`; keep real canvas dominant; exercise true slot-component/undo/keyboard and mobile gate; capture desktop, narrow and dark runtime states. Commit, run both workflows on the final code SHA, then log Notion and update handoff.

**Decision ledger:** [Notion implementation record](https://app.notion.com/p/419b082297c781db810cd756ec0343eb).
