# Kadmeion — branding specification (approved direction, preproduction)

**Snapshot:** 2026-11-11  
**Status:** approved identity direction with clearly flagged open production details. **Not final export artwork**.

## 1. Core identity

- **Brand:** Kadmeion (exact spelling and wordmark).
- **Descriptor:** Developer Identity Platform.
- **Tagline in uploaded identity:** **Build · Showcase · Evolve**.
- **Promise:** Help developers craft an authentic professional identity, curate meaningful projects, publish distinctive portfolios and evolve through private insights.
- **Positioning:** expressive developer craftsmanship + evidence-led storytelling, rather than generic dashboards or public scoring contests.
- **Personality:** authored, confident, thoughtful, technically credible, accessible, warm but not childish.
- **Voice:** direct verbs, meaningful explanations, concrete UI labels; avoid fake proof/claims/metrics and corporate filler.

## 2. Logo and shapes — protected invariants

1. **Authoritative logo:** first uploaded brand sheet `references/01_original_kadmeion_identity.png` (`image(20261111-120936).png`). Preserve its geometric **K silhouette** and letter-spacing/wordmark intent.
2. Alternate generated optical K or new logo variants **are not approved replacements**. The selected Aether Drift color *preview* may show a recolored logo, but its altered geometry is not authoritative.
3. Approved logo compositions conceptually: primary mark+wordmark, stacked mark, and icon-only favicon; size/clear-space concept approved, **not numeric vector specifications**.
4. Do not invent construction grids, exact angles, logo stroke geometry or minimum pixel sizes without a true vector master. Use design measurements after source is provided.
5. No architectural monuments/buildings in application graphics just because of the name's historical associations; visuals must reflect **developer work, editor, published portfolios, code, and growth**.

## 3. Approved palette — C. Aether Drift

**Authoritative color direction is the user's selected image:** `references/02_aether_drift_selected.png` (`image(20261111-132942).png`). **Do not substitute 'Cobalt Manuscript', 'Terracotta Atelier', or the invented palettes of later boards.**

The source screenshot has low resolution and compression. The following HEX readings are **tentative visual transcriptions**, not verified master values. Recheck from an original editable source or user confirmation before treating as production tokens:

| Swatch (as visually labeled) | Approximate HEX from source | Intended use | Confidence |
|---|---|---|---|
| **Snow** | `#FAFAF9` (approx.) | Light major background | LOW — fuzzy caption |
| **Cloud** | `#E7ECEF` (approx.) | Quiet surfaces, dividers | LOW — fuzzy caption |
| **Mist** | `#C3CDD5` (approx.) | Secondary cool surface, illustrations | LOW — fuzzy caption |
| **Amber** | `#FF9F4A` (approx.) | Highlight/accent | MEDIUM — legible label |
| **Ink** | `#1E293B` (approx.) | Dark base, primary text | MEDIUM — visually matches caption |

**Important:** Pixels sampled from the raster may differ from intended HEX values because of screenshot compression, lighting and color management. Source values from a generated mockup such as `#152534`, `#3D64AC`, `#DB7456` are **not** the selected Aether Drift swatches.

### Light mode (approved direction)

Snow as page field; Cloud/Mist as subtle surfaces and grouping; Ink for primary readable text; Amber selectively for brand actions or highlights. Contrast-testing is required; not all amber-on-white text will meet WCAG AA.

### Dark mode (**explicitly approved**)

Ink-led background; text/surfaces selected to sustain semantic hierarchy and contrast; Cloud/Mist used judiciously for foreground/surface contrasts; Amber retains recognition. Exact dark-mode color derivations are still a token-production task, not something a preview can authorize silently. No arbitrary purple/cyan gradient theme.

### Palette usage rules

- Separate semantic roles: `background`, `surface`, `surface-raised`, `text-primary`, `text-secondary`, `border`, `focus`, `action`, `action-hover`, `success`, `warning`, `danger`, `disabled`.
- Do not invent statuses by reusing arbitrary brand colors: accessible success/error colors may require functional tokens outside primary brand swatches and user approval if they materially change identity.
- Never use color alone to communicate status; add words/icons and accessible focus treatments.
- Maintain accessible contrast, check non-text boundaries and disabled affordances in both themes.

## 4. Typography — approved

Selected C. Aether Drift card visibly references **Manrope** for interface/navigation and **DM Serif Display** for editorial/display. The earlier **Helvetica/Akzidenz** direction belonged to the original brand sheet, before user selected C and approved typography. Treat Aether Drift reference as the current style; if user intends to retain the older grotesk specifically, request clarification before changing typography assets.

- **UI:** clean highly legible sans; Manrope style in selected reference; menu, form, descriptions, controls.
- **Editorial:** DM Serif Display-style display for focused hero headings, pull quotes, brand messaging.
- **Code:** dedicated accessible monospace for source editor only; no excessive monospace in product chrome.
- **Glyph loading:** custom decorative **glyph-shaped geometry**, visually reminiscent of the supplied loader reference; not a real text script or a required language font.
- **Licenses:** verify exact font family weights/files and open licenses before shipping; don't include font files in this package.

## 5. Six primitive grammar — brand identity, not loader text

The source sheet identifies six **invented brand primitives**: Stem, Corner, Split, Enclosure, Link, Notch. Their purpose is decorative structure and symbol vocabulary, not authenticated ancient Greek writing.

- Design a repeatable **K-derived pattern** from these motifs, low contrast and static.
- **Pattern approval: APPROVED explicitly on 2026-11-11.** The approved pattern is the one **inside the uploaded Phase B multi-panel preview** `references/18_brand_pattern_APPROVED_USER_REFERENCE.png`, isolated in `references/19_brand_pattern_APPROVED_DETAIL_CROP.png`. It uses a dark technical drafting grid, vertical/horizontal hairlines, arcs, a sweeping diagonal blue strip and restrained coral geometry and fine lines. Apply it proportionately on brand surfaces, dividers or strategic empty areas, never over critical text/controls. The separate A/B/C comparison was **explicitly rejected** and is not a candidate. Do not claim the preview's textual word “Approved” independently conveyed approval; only the user's current message does.
- Decorative pattern must never cover meaningful text, focus rings, buttons or skeleton content.

## 6. Glyph skeleton language — approved mechanism

Distinct from the six brand primitives. The user supplied a line of dense **script-like characters** and multi-line glyph loading reference. Approved concept: **these glyph-shaped characters are the placeholder substance** while data is pending. They replace standard grey lines/bars, not augment them. Do not use arbitrary Hebrew/ancient letters as a claim of historical Kadmeion script; create original legible-looking **nonlinguistic display glyph shapes** and mark as aria-hidden.

See `design.md` for timing, accessibility, layout stability, fallback, and per-component application. Source: `references/03_glyph_loader_board.png` and `references/04_glyph_detail.png`.

## 7. Applications

| Surface | Approved direction |
|---|---|
| Landing/public portfolios | Editorial asymmetry, meaningful developer/project work; show product, not unrelated architecture. |
| Workspace | Functional rail/navigation, clear content hierarchy, flatter component groups. |
| Editor | Custom compositional layout builder; meaningful side panels and source view. |
| Auth | Reversible side-to-side editorial panel; reduced-motion fallback. |
| Signage | Quiet engraved/dimensional maker's mark direction approved (not a completed file). |
| Stationery | Consistent placement, restrained grid/card/letterhead concept approved. |
| Iconography/3D | Standard legible icons preferred. Optional 3D **not approved / not necessary**. |

## 8. Do not use

- Different K silhouette; unapproved optical changes or generic logo from generated boards.
- Buildings/monuments as product feature visuals.
- Reference mint/purple dashboard palettes, purple gradients, fake data/social proof, meaningless badges, random wordmark glyphs.
- Custom glyphs as controls without clear accessible labels.
- Loading indicators kept running to fill a minimum duration.

## 9. Pending production outputs

Master vector K, icon/wordmark light/dark exports, validated color tokens and accessible states, exact font license check, **vector/CSS recreation of the now-approved pattern**, scalable source assets, favicon sizes, contrast report, mockup-to-implementation mapping, original-source provenance. **These documents are specifications; no final design assets have been produced.**
