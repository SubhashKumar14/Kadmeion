# Accessibility, Responsive and Assistive-Technology Acceptance

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

**WCAG 2.2 AA is an objective, not a conformance claim.** Supported screen specs contain minimal keyboard/screen-reader tests; this document adds explicit techniques.

## Supported device classes

- Public site/profile/project/published portfolios: desktop, large/small tablet and phone; text resize 200%, responsive reflow and orientation changes.
- Auth: desktop reversible slide; phone directional crossfade; all modes must provide active-form-only tab sequence and reduced-motion alternative.
- Editor/code: desktop/laptop and **qualified large tablets only**, with viewport+input+browser+keyboard acceptance. On phones show view/share and Continue on Supported Device; do not offer hidden editing.
- Personal Growth/account: responsive, only limited low-risk phone edits where usability passes. The presence of a phone does not unlock portfolio/code editor.

## Critical criteria checklist

| Requirement | Test method | Expected |
|---|---|---|
| Keyboard complete | Tab, Shift+Tab, Enter, Space, Escape, arrow and explicit Move/Add/Replace | No inaccessible drag-only operation or keyboard trap |
| Focus | Auth toggle, modal/drawer open/close, error summary, deleted slot Undo | Focus moves to active logical control and returns to trigger |
| Screen-reader names/states | NVDA/VoiceOver on selected OS, forms, skeleton, reordering, save-state | Meaningful label, status, current item/slot and errors; glyphs aria-hidden |
| Motion | `prefers-reduced-motion`, rapid auth toggles, carousel pause | No significant spatial motion; focus persists; hero no auto cycle when reduced |
| Zoom/reflow | 200% text resize; 320 CSS-pixel equivalent where applicable | No loss of function/text, no uncontrolled horizontal scroll of main content |
| Color/contrast | Light/dark, positive verified badge, selection/disabled/errors and authored palettes | Meets applicable contrast targets; not color-only status |
| Input/touch | Labels, target sizes, pointer/keyboard paths, error recovery | No hover-only primary action; large visible touch targets |
| Form validation | Auth/signup/reset/handle/project URLs/account deletion | Field-specific error and focus, correct semantic help/alert association |
| Charts | Views/DevScore/goals | Accessible data tables and explanation, not color-only inference |
| Custom portfolios | Every trusted preset + section layout + realistic long texts | Responsive static page, skip/anchor semantics, contrast warnings |

## Evaluation log

For each screen, record viewport, OS/browser, SR, keyboard-only outcome, severity, WCAG criterion, owner decision IDs, reproducible steps, screenshot/video or accessibility tree and retest. Automated lint cannot replace human tests. Source-code editing on qualifying tablet cannot be considered fully accessible until tested on real hardware.
