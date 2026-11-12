# Kadmeion — UI/UX design specification (approved direction, preproduction)

**Version:** 2026-11-11 Phase 2 snapshot. **Gate A CLOSED.**

## 1. Design principles and invariants

- Kadmeion = developer identity, portfolio authoring, project case studies and measured personal growth—not architecture galleries or generic AI dashboards.
- Approved **Aether Drift C** palette and original K silhouette. Light and dark themes approved; exact tokens are reference-derived and must be checked (`branding.md`).
- Apply reference layouts for **composition** only; do not copy fonts/colors/text/unrelated product features from sample dashboards.
- Prioritize hierarchy, spatial consistency, limited simultaneous choices, inclusive controls, meaningful states, and one major CTA per context.
- Avoid gratuitous nested cards, fake workflows, fake social proof, exaggerated 3D, gradients unrelated to approved palette, continuous loops.
- Designs are conceptual and not claimed as pixel-perfect implementation layouts; require validated responsive specs and accessibility review.

## 2. Page-to-layout mapping

| Page/flow | Composition reference | Information hierarchy | Priority actions |
|---|---|---|---|
| Public landing | Centered curved hero + disciplined editorial sections | Value proposition, product demonstration, how it works, examples, FAQ | Create portfolio; secondary view showcase |
| Public developer profile | Asymmetric interlocking blocks | Identity story, selected skills, featured evidence, collaborations, contacts | View work / contact |
| Project case study | Product/gallery composition, reframed for software projects | Problem, developer contribution, screenshots, implementation approach, measurable outcome, source links | Open demo / view repository (if present) |
| Project management | Modular editorial grid | Draft/published/private projects and author-chosen work; filters | New project, continue edit |
| Analytics / goals | Calm modular grid; no unrelated team dashboards | Private DevScore, editable goals, aggregate views, broad sources | Set/update goal |
| Onboarding | Stepped hero flow | Choose template, enter basic profile, select project, preview | Continue, save draft |
| Portfolio editor | Functional left rail + canvas + contextual editing inspector | Layout blocks/components; selected element settings; source/code mode; preview controls | Save, preview, publish |
| Auth | Original user-provided sliding card example | Plain email login, optional Google login, contextual intro | Sign in / sign up |
| Settings/Trash | Flatter groups | Account, integrations, privacy, exports, 15-day Trash | Save, restore, delete |

### Responsive behavior

- Desktop: persistent functional sidebar where useful, single clear editing canvas and responsive preview, visible state/history controls.
- Tablet: condensed navigation; component inspector can slide over canvas without obscuring main editor content.
- Mobile: keyboard-safe forms, generous touch controls, one active editor panel at a time; avoid shipping a Monaco-based editing claim without mobile-compatible source editor assessment.
- Safe-area insets, zoom, focus, reduced motion, high contrast, layout overflow and legible text at 320px-class widths must be validated—not assumed to pass.

## 3. Visual builder (revised user requirement)

- **Two starts:** curated templates (~5–10), or **Custom** builder.
- Template workflow: choose, fill content/brand/media, adjust sections and layout, preview.
- Custom workflow: select from prebuilt code-backed components, place/reorder/reconfigure, edit content/styling/responsive options; save user-composed reusable components and templates.
- Source mode: HTML/CSS/JS (multi-file, modules, approved bundled libraries), advanced code modifications, source history/diff/recovery, accurate warnings when code overrides exceed structured visual editability.
- **Not required:** automatically reconstruct arbitrary external program DOM/JS back into editable components.
- Unsupported user source remains intact. Never silently strip or rewrite code just to make it fit the canvas.
- Preview/runtime: restrictive cross-origin isolation, controlled capabilities, no privileged host access; safe review before publish. Exact technology/architecture to be selected later.
- Drafts/version history, staged private/expiring preview links, deliberate publish and rollback retained from user decisions.

## 4. The approved glyph skeleton-loading mechanism

### What it IS

The actual placeholder for a text line is **a sequence of custom script-like glyph shapes**, matched to text density and bounding box. Multiple lines form realistic paragraphs; glyph text is the loading surface itself. Similar density-aware components apply in lists, cards, project title/description, editor content, banners and form fields.

### What it IS NOT

- Not grey horizontal skeleton bars with decorative diagonal bars or K icons pasted above/beside them.
- Not actual content, a fake language translation, meaningful words, or historical Greek/Hebrew writing.
- Not placeholder data persisting after network completion.
- Not a blocking full-screen animated brand reveal on every tiny action.

### Behavioral contract

1. As soon as a relevant content region enters the **pending** state, the UI may prepare/render glyph skeletons **in place**. User explicitly requests loaders whenever loading occurs, including delays greater than 0 seconds. Avoid adding arbitrary artificial wait; immediate imperceptible responses should not create a visually distracting flash (implementation handling to be reviewed, not an approved timing override).
2. Glyph rows occupy the estimated final content dimensions and typography rhythm, so the actual content replaces them without large layout shifts.
3. Use light, unobtrusive shimmer/pulse/wave across the *glyph silhouettes* (e.g., CSS mask/gradient, transform/opacity where feasible), not looping spinners inside every component. Reduced-motion: static silhouette or very gentle opacity-free placeholder.
4. On success, replace glyph skeletons with actual content immediately. On error, show explicit actionable error + retry, not an infinite skeleton. On empty result, show a genuine empty state.
5. Assistive technology: mark glyphs `aria-hidden="true"`, give surrounding status `role="status"`/screen-reader loading label as appropriate, avoid repeated announcements; real loaded content should remain navigable.
6. **Three seconds is a responsiveness target** for meaningful resolution under defined service/network conditions, not a guaranteed hard timeout, enforced artificial animation duration, or license to invent progress.
7. Use minimal overhead; avoid large external font payload. Shape generation can be SVG symbols, controlled web font, or CSS mask; production approach not selected or implemented.

### Applications

| Component | Shape |
|---|---|
| Single title | One varying-glyph text row sized like future heading |
| Paragraph | 2–5 visually varied glyph rows with matching wrap lengths |
| List item | Icon/avatar mask + one or two glyph lines; no decorative K placeholders if user wants actual script |
| Project card | Thumbnail/image footprint + glyph title/description and metadata group; actual text placeholders are glyphs |
| Grid of projects | Repeated realistic project-card footprints, not fake content |
| Editor | Tab/toolbar frames and dense glyph lines in source/canvas regions during true loading |
| Form field | Glyph-style line only while async field information loads; never obstruct typing into an enabled field |
| Button | Glyph shapes only for pending action where final label becomes temporarily unavailable; preserve accessible action name |
| Analytics | Numeric-length masks and label glyphs; never pretend percentages or results are known |

### Source references and status

- User's glyph detail: `references/04_glyph_detail.png`.
- User's full sample board: `references/03_glyph_loader_board.png`.
- The user approved the **mechanism** in the latest message. Generated preview boards are not guaranteed to depict the correct mechanism; earlier image with diagonal bars was explicitly criticized. Keep this definition authoritative over those images.

## 5. Motion

| Event | Approved direction (concept) |
|---|---|
| Auth sign-in ⇄ sign-up | Reversible left/right panel slide with interruptible state; fade-only reduced-motion alternative |
| Menu / dropdown | Ease-out from trigger, ~150–250ms typical; direct closure and keyboard handling |
| Button press | Immediate visual feedback; subtle scale (~0.97) only if appropriate |
| List appearance | Restrained stagger (~30ms) only for meaningful loaded groups; honor reduced motion |
| Toast / publish | Confirm success/error honestly; undo where operation supports it |
| Theme toggle | Stable layout and focus, avoids long cross-app wipes |
| Content loading | Glyph-shaped shimmering skeletons only during pending work, no forced wait |

- Transform/opacity priority. Avoid animating layout size/position repeatedly, bouncy menus, mandatory long hero intros or endless ambient loops.
- Motion must be interruptible; no click delay waiting for current animation to finish.

## 6. Reusable interaction patterns (selective)

- Autosave with truthful saving/saved/error indicator; undo/redo and revision history.
- Optimistic updates **only when safe**, with recovery/failure rollback; idempotency for publish and destructive actions.
- Command menu/keyboard shortcuts if they genuinely improve multi-step editor navigation and remain accessible.
- Pagination or appropriate finite lists for projects; honest empty states; error retry; stale-data disclosure for delayed provider sync.
- Focus trap in modals, focus restoration, touch targets, accessible validation, password visibility when password mode exists.
- Export/delete dialogs explain exact scope and reversible window.
- Real interaction labels; avoid fake buttons, misleading badges, decorative data pretending to be authentic.

## 7. Brand pattern and optional 3D

- **Brand pattern: APPROVED.** Use only the pattern contained in the user-uploaded Phase B approval preview `references/18_brand_pattern_APPROVED_USER_REFERENCE.png` (crop `19_`). Preserve its sparse drafting-grid structure, long arcs, angular diagonal blue band, ink-dark field and restrained coral accent. Scale/crop respectfully on page boundaries or unused surfaces; no building/monument imagery; do not copy the rejected A/B/C pattern study. For light theme, maintain the same underlying geometry with reduced-contrast token-compatible recoloring; color tokens still require exact confirmation. Prefer vector SVG/CSS for the geometric pattern.
- **3D icons: still pending/unapproved.** Strong default is a legible 2D icon system; do not add 3D merely to fill the brief.

## 8. Accessibility, performance and validation

- WCAG 2.2 AA target. Contrast WCAG verified for actual tokens, especially amber-on-light and small serif text; screen-reader semantics for skeletons.
- Focus indicator and logical tab order; keyboard-only usability; touch, orientation, zoom and reduced-motion.
- Honest LCP/interaction performance targets, test on realistic slow networks and constrained devices. **Do not claim guaranteed load <3s for every user.**
- Avoid loading unnecessary WebGL, heavy decorations, large font payloads and high-frequency JS animation.
- Production measurements and browser/device matrices are **unperformed pending testing authorization**.

## 9. Inputs needed for production

True vector logo; verified palette master/typography licenses; **approved pattern reconstructed to production vector/CSS**; actual content/image inventory (avoid fabricated portfolio stats); responsive specifications and cross-theme components; exact source editor/runtime framework and consent safeguards; qualified test plan; separately approved implementation gate.

## 10. Provenance

Concepts derived from user-uploaded logo/palette/layout/auth/glyph reference images and the user-uploaded `20 Ways to Make Beautiful AI A(2)(9).docx`, plus explicit Phase 2 and subsequent visual feedback. The reference DOCX contains ideas, **not a mandate to implement every pattern**; see `ASSET_INDEX.md`.
