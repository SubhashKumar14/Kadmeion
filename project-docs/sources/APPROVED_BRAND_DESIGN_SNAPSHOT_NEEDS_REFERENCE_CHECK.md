# Kadmeion approved brand and UI/UX implementation contract

**Approved direction, not final production tokens.** Use `references/01_original_kadmeion_identity.png`, `02_aether_drift_selected.png`, `18_brand_pattern_APPROVED_USER_REFERENCE.png`, `19_brand_pattern_APPROVED_DETAIL_CROP.png`, `03_glyph_loader_board.png`, `04_glyph_detail.png`. The original approvals are the authority; later generated concept boards contain misleading text, bars and palettes.

## Immutable brand rules

- Name: **Kadmeion**; descriptor **Developer Identity Platform**; tagline **Build · Showcase · Evolve**.
- Mark: exact silhouette of the **original K** with layered angular/curved construction. No optical re-design, substitute K, new symmetry or decorative fake historical lettering without separate approval. A production-grade SVG/vector must be traced/obtained and manually reviewed; raster cannot establish exact grid/angles/min sizes.
- Palette direction: **C — Aether Drift** from the *small original selected preview*, not “Cobalt Manuscript” or later AI-generated dark-blue/coral board. Do not encode `#152534` etc as authoritative solely because they appeared in an illustration.
- Light and dark themes are **approved**. Color exact HEX/tokens and WCAG-semantic states are **not verified** due to low-resolution screenshot.
- Pattern: **exact Phase B pattern** showing dark drafting grid, fine rules/arcs, diagonal blue strip and restrained coral geometry, approved by the user. Separate proposals `A Cut-line`, `B Primitive rhythm`, `C Margin signature` were explicitly rejected. Use proportionate CSS/SVG, but retain the pattern's recognizable composition.
- No buildings, monuments, historical architecture galleries, fake project metrics, purple SaaS gradients, irrelevant product prices or meaningless decorative badges.
- Six brand primitives (**Stem, Corner, Split, Enclosure, Link, Notch**) are decorative geometry, **not** the custom glyph skeleton's linguistic alphabet. No claim of historical authentic script.

## Color semantics — tentative readings, not build tokens

| Swatch label in selected reference | Tentative transcription | Role | Release status |
|---|---|---|---|
| Snow | `#FAFAF9` | Light page base | **LOW confidence**, source-master validation required |
| Cloud | `#E7ECEF` | Light secondary surfaces | **LOW confidence**, validation required |
| Mist | `#C3CDD5` | Muted surface/borders | **LOW confidence**, validation required |
| Amber | `#FF9F4A` | Select accent/brand focus | **MEDIUM confidence**, validation + contrast required |
| Ink | `#1E293B` | Light primary text and dark base | **MEDIUM confidence**, validation required |

The above are **transcriptions from `sources/PHASE2_BRANDING.md`, not newly measured values**. Publish final design tokens only when the color master is confirmed. Semantic token requirements: `bg`, `surface`, `surface-raised`, `text`, `text-muted`, `border`, `focus`, `action`, `action-hover`, `success`, `warning`, `error`, `disabled`, `link`. Dark values derived from verified tokens with contrast checks; don't simply invert screenshots.

## Typography and assets

- **Typography decision needs a final clarification:** The initial design approval selected the Helvetica/Akzidenz-led UI with a contrasting editorial serif. The later Aether Drift **color-system** preview labels Manrope/DM Serif Display, but approving that palette does not unambiguously approve replacing previously chosen typefaces. Both sources are preserved. Do not silently change the approved type system; confirm the final UI/display fonts and licensing before producing tokens/assets. Font files must not be redistributed without rights.
- Use a monospace font **inside source editor only**; no decorative monospace throughout the app.
- Original, accessible, legible text/labels replace any gibberish generated in UI mockups. User-owned portfolio may select its own theme; Kadmeion app branding must not be forcibly injected into published personal portfolios.
- Images used in product screens should show developer projects, repos, code, portfolio case studies and creator growth. No false testimonials, “12 projects” fake statistics or unearned verification marks.

## Page composition mapping (reference composition only)

| Reference | Appropriate screen(s) | Application notes |
|---|---|---|
| `05_layout_centered_curved_hero.jpg` | Marketing landing / select intro | Centered curved field, one CTA, preserve readable content order |
| `06_layout_asymmetric_blocks.jpg` | Public developer profile / portfolio feature section | Irregular media/text relationships; avoid masking readable mobile content |
| `07_layout_project_gallery.jpg` | Project showcase and detailed case study | Hero media, project screenshot, role/outcome metadata, links rather than prices |
| `08_layout_editorial_grid.jpg` | Dashboard/projects/analytics overview | Mixed content density, no gratuitous nested cards |
| `09_layout_stepped_hero.jpg` | Onboarding/selected preset / hero section | Semantic heading, primary CTA and responsive stepped decoration |
| `10`–`12` dashboard references | Functional nav rail and layout rhythm | **Do not copy** mint/dark-green palette, team features or text |
| `13_auth_sliding_transition.jpg` | Sign-in ↔ sign-up | Reversible panel slide, interrupted transitions, keyboard and reduced-motion fallback |

## Glyph skeleton loader — precise approved mechanism

Glyph-shaped **text-like silhouettes themselves** replace ordinary horizontal skeleton bars. A heading uses a varying dense glyph line; paragraph uses multiple line lengths; lists/cards/editor/buttons/forms use contextual glyph-length footprints. Do **not** add diagonal bars/K icons above ordinary grey loading bars. The six brand primitives remain separate.

- Show only when content is actually pending; user requested wherever a delay occurs `>0ms`. Do not introduce fake delay; suppress distracting imperceptibly short flashes by a carefully reviewed implementation strategy rather than claiming zero-latency visuals.
- Preserve final content dimensions and layout, avoid CLS, replace immediately on success, and transition to honest error/empty states on failure.
- Motion across glyph silhouettes: subtle pulse/wave/shimmer; reduced motion static; `aria-hidden` glyphs and an appropriate surrounding screen-reader loading status.
- **Three seconds** is a target for meaningful resolution under measured conditions, not a guaranteed network completion or an artificial skeleton timeout.
- Use lightweight SVG/masks/appropriate licensed glyph sources; do not claim invented glyphs are actual readable Hebrew, Greek or the brand's historic language.

## Interaction/motion baseline

| Interaction | Approved direction | Reduced-motion/input alternative |
|---|---|---|
| Auth | reversible left/right sliding panels | instant/fade-only; focus retained; valid fields not lost |
| Dropdowns | 150–250 ms typical ease-out | immediate open; keyboard escape and focus return |
| List reveal | up to ~30 ms restrained stagger | no stagger |
| Button press | immediate state and honest result | none; active focus visible |
| Drag component | visible typed-slot fit/rejection | keyboard/tap select/place |
| Autosave/publish | separate editing/saved-local/syncing/published indicators | no decorative success before confirmed commit |
| Navigation/theme | layout stability, no unnecessary loop | instant preference |

## Responsive and accessibility contract

Use tested desktop three-pane editor, tablet collapsible inspector, mobile one active panel. Support semantic DOM order independent of visual grid, touch targets, color contrast, screen readers, keyboard/drop alternatives, safe areas and reduced motion. Target WCAG 2.2 AA for application and trusted portfolio templates. A screenshot match is not proof of accessibility.

## Design-to-code fidelity acceptance

1. Preserve approved **content hierarchy, spacing relationships, icon meaning, K silhouette, Aether palette direction and pattern** at defined viewports.
2. Prefer semantic React/CSS/SVG for functional UI, use image assets only for noninteractive art where vector reconstruction is infeasible; **do not use a screenshot as the UI**.
3. UI must use actual data and functioning flows, not mock dashboards where the controls are dead or metrics invented.
4. Compare screenshot crops at agreed widths, then manually inspect accessibility, responsiveness, interactions and glyph behavior.
5. The approved dark theme requires contrast-tested production tokens; source screenshots are a reference, not exact CSS values.
6. **Optional 3D icons remain unapproved**. Default to accessible 2D icons until explicit permission.

## Outstanding production design inputs

Exact original logo vector and numeric clear space, high-fidelity palette swatches and font weights/licenses, precise safe area/focal positions for masks, 3D (optional). See `14_OPEN_DECISIONS_AND_RISKS.md`; none is silently invented here.
