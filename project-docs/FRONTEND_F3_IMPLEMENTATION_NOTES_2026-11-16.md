# Kadmeion — F3 editor phase engineering and visual QA checkpoint

**Date:** 16 November 2026  
**Branch:** `feat/b0-backend-foundation` (no merge, production approval or paid dependencies)  
**Verified application and browser code SHA:** [`9af4968`](https://github.com/SubhashKumar14/Kadmeion/commit/9af4968579e8796a298cec7c27893e643ddca2ef)

## Screens and approved source verification

F3 covers approved EDIT-01–EDIT-09, application screen numbers **18–26**. All nine original PNG SHA-256 prefixes match the approved registry, retrieved from the user's Library archives:
- `Kadmeion_LIGHT_Batch06_17-26.zip` supplied approved 18–25;
- `Kadmeion_LIGHT_Batch07_27-36.zip` supplied the **corrected** fullscreen-only screen 26 `26_EDIT-09_Fullscreen_Portfolio_Only_REVISION_LIGHT.png`, SHA prefix `e13f8330cbc0149a1e11`. Do not restore the superseded Preview Modes illustration as screen 26.
- Canva `DAHazlXd9Vs` remains the approved 12-page brand source; no new logo geometry, dark mockup or unlicensed media was introduced.

The actual CI browser artifact `kadmeion-owner-browser-captures` on [Application/Database run 43834927534](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43834927534) includes 18–26 authenticated 1600x1000 screenshots and **18_EDITOR_RUNTIME_DARK_BROWSER**. Browser capture helper now scrolls to document top before recording, preventing viewport comparison at a random focused-control scroll offset. The approved LIGHT images direct hierarchy, not literal frame dimensions; qualitative readability/contrast and task flow matter more than raw pixel similarity.

## Implemented source and UX

- `056735a` and fix `87d8df2`: move editor panel selection from tiny, crowded inspector buttons into a full-width 44px-minimum keyboard/focus-visible modebar; use a content-driven canvas rather than a fixed-height screenshot box; improve inspector typography. Distinguish real private saved state from unsaved edits.
- `a537cb0`: track every unapplied advanced-source textarea buffer, including removed-path edits; preserve them across editor panel switches, disable private save until resolved, add browser leave guard plus targeted and all-buffer discard recovery. No source text runs on privileged origin.
- `23baa0f` and type correction `019d9e8`: implement typed `MOVE_SECTION` on the established revision transaction engine. Up/Down UI uses labeled keyboard buttons, guards first/last item, preserves all component slot assignments/stashes and is Undo/Redo-compatible. Test invalid moves. No untrusted drag-only movement required.
- `9af4968`: normalize screenshot capture and add separately verified runtime-dark editor screenshot. The approved source LIGHT images were not modified.
- Existing editor panels continue to use owner-private snapshots, case-insensitive revision/CAS saves, true token palettes, safe preflight and publisher gates, and author preview (not a public release).

**Changed code:** `apps/frontend/src/portfolios.tsx`, `portfolio-tools.tsx`, `workspace.css`, `behavior.ts`, `behavior.test.ts`, `e2e/owner.spec.ts`, `packages/editor-core/src/portfolio-revision-transactions.ts`, `tests/editor/portfolio-revision-transactions.test.ts`.

## Verified same-SHA automated evidence

| Gate | Verified result | Link |
| --- | --- | --- |
| React frontend / build / Chromium | SUCCESS, 19 public Chromium checks, typecheck and production dependency audit | [43834927446](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43834927446) |
| Node contracts | SUCCESS, **505 tests** | [43834927534](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43834927534) |
| Isolated Supabase/Postgres | SUCCESS, **511 pgTAP assertions across 28 files** | [43834927534](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43834927534) |
| Authenticated Chromium, GoTrue, PostgREST and Storage | SUCCESS, **4 isolated scenarios** including typed section move/Undo, private source guard reflow and no phone editor | [43834927534](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43834927534) |
| Production dependency audit | No vulnerabilities reported by the audited production installation in either CI job | Same two CI runs |

## Visual check (diagnostic, not approval)

The current editor runtime shows the corrected 44px modebar above the three-pane workspace with larger controls; canvas can scroll as the authored page grows. The verified source screenshot hashes and Chromium captures permit full side-by-side review. A simple same-size mean absolute RGB difference, on the 0–255 channel scale, is **not an acceptance gate** after the owner's visual-reference supersession:

| Screen | Pre-F3 | F3 after |
| --- | ---: | ---: |
| 18 workbench | 24.94 | 24.69 |
| 19 content | 24.68 | 25.40 |
| 20 sections | 27.40 | 27.81 |
| 21 My Components | 23.24 | 23.91 |
| 22 theme | 24.03 | 24.88 |
| 23 assets | 23.03 | 23.73 |
| 24 source | 23.58 | 31.13 |
| 25 history | 22.90 | 22.79 |
| 26 corrected fullscreen | 18.13 | 18.13 |

The approved original and runtime may have different selected content/state (particularly editor tool and scroll). Screen 24's numeric drift increased because an accessible shared tool bar moved the source workbench vertically; do not falsely call this pixel parity or regress the usable navigation solely to lower one metric. Screen 26 remains a standalone portfolio surface without workspace controls.

## Known open acceptance and functionality

1. No signed-off full accessibility audit with real NVDA/VoiceOver, contrast and zoom; WCAG 2.2 AA remains an objective.
2. Owner visual signoff on contextual branding/layout across 18–26 and independently judged runtime dark contrasts remains outstanding.
3. True S0-to-S1 owned-source customization still needs a **trusted pinned-library byte catalogue**; the private My Components UI can reuse/save genuinely owned versions but must not fabricate verified provenance. Do not silently claim the full specialized editor source workflow finished.
4. Real public CDN/reviewer/grant expiry/rollback, Brevo and hosted Google OAuth require separate hosted/manual proofs and owner authorization. No public custom JavaScript on privileged origin.
5. Current feature branch exceeds historical 200-file budget with documented exceptions, not owner-approved scope relaxation. Keep code and rollout gates distinct.

**Next exact phase:** F4 screens 27–34: reviewer staging/preview, preflight, releases/rollback, consented public identity, case studies, published independent portfolios and share controls. Start with current verified feature head, source PNG/decision review, then private-owner/browser and hosted-proof gates. Keep **₹0 recurring cost**, no main merge or production promotion without explicit approval. 
