# Kadmeion — Master UI/UX Design Specification

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

**Product:** Kadmeion · *Build · Showcase · Evolve* · **Version:** 1.0 documentation baseline · **Date:** 2026-11-12  
**Decision authority:** [private Notion decision record — not publicly linked] · **Approved UI decisions:** UI-001–UI-115 · **Implementation:** NOT STARTED.  
**Source precedence:** latest owner selections → approved visual references → final editor blueprint (unsuperseded contracts) → older Phase 2 documentation → architect-labelled proposals.

## 1. Product experience and success criteria

Kadmeion helps a developer **build** a distinctive, evidence-conscious public identity, **showcase** projects and independently themed portfolios, and **evolve** through private goals and verified-where-available public platform facts. It must not look or behave like a generic AI admin dashboard. Real evidence, truthful status and safe author ownership outrank decoration.

The end-to-end approved experience is: land → sign in/create account → welcome choices → privately create identity/project(s) → select preset or Blank → author slot-based pages → edit tokenized style / user-owned code → preview Author vs Published → optional expiring stage → validate → explicitly publish verified immutable static release → share → revise/compare/rollback/export → optionally enable private analytics & growth → manage settings/trash → restricted exceptional admin workflows.

### Non-negotiable accepted behaviors

1. Original **angular layered K**, selected **Aether Drift C** identity and approved sparse K-derived geometric pattern remain authoritative; never fabricate a replacement logo, monument or architecture imagery.
2. Public Kadmeion landing starts **light** and retains a manual theme choice; each published portfolio uses its **author's independent theme**.
3. Editorial, productivity and code typography roles are accepted; actual font families are **NOT locked** until original masters and licensing verified (UI-106).
4. Real glyph-language text silhouettes **are the skeletons** during true content fetch; they are not overlays on normal bars and never impose delay.
5. Desktop sign-in ↔ sign-up brand panel slides reversibly in **280–320ms**; mobile uses directional crossfade, reduced motion removes significant travel.
6. Email/password + optional Google, recovery, registration with display name/unique handle/email/password/confirmation; fields retained when toggling until navigation; passwords remain transient memory-only.
7. Sign-in is **required before authoring**; public visitors may preview templates/demos but not edit portfolios (UI-110).
8. **No phone portfolio or code authoring.** Desktop/laptop and capability-qualified large tablets only. Public content remains responsive to phones.
9. Content/code editing converges on **one versioned file-set + one guarded typed transaction engine**. No separate canvas/code sources of truth.
10. Component deletion leaves `EMPTY`, retains stash/Undo; S0 trusted, S1 owned-identical, S2 owned-modified code preserved and protected.
11. Public identity `/u/:handle`, case study `/u/:handle/projects/:projectSlug`; portfolio `/:username/:portfolioSlug` remains **host/routing conditional**.
12. Profile, project, portfolio publication and visitor analytics are **private/off by default**, enabled only through explicit appropriate controls.
13. Projects are link-based user-authored records. Do **not** clone a GitHub repository to add a project; optional safe website capture is only conditional.
14. Author-owned JavaScript may not execute with Kadmeion privileges, nor be promised to run publicly absent a successful separate-origin sandbox proof. Static release or complete independent export is the approved fallback.
15. Every save, sync, stage, publication, email and rollback state must reflect observed authoritative acknowledgement, not spinner duration or optimistic assumption.
16. WCAG 2.2 AA is a **design/test target**; zero verified conformance claims exist yet. Critical inaccessible journeys must not be released.
17. Strict **₹0 recurring cost**, no silently billable features; Supabase Auth/Postgres/RLS/Storage/Edge Functions for application backend, no MongoDB/Mongoose/persistent Express backend.

## 2. Screen hierarchy and navigation shells

| Shell | Intended surfaces | Persistent navigation | Focus/history model |
|---|---|---|---|
| Public | Landing, gallery, public identity, public case study, static portfolio | Compact public nav, explicit Create Portfolio and Explore, published portfolio template header independent | Deep links work without a JS-only bootstrap. Browser Back respects route history. |
| Auth | Sign in/up, callback, recovery, reset | Two-panel K brand shell on desktop; compact mobile crossfade | Focus moves to active form; switching modes does **not** push browser history. |
| Workspace | Welcome, dashboard, projects, portfolios, growth, settings | Labeled left sidebar → compact rail; phone drawer | Breadcrumb/active indicator; unsaved work guarded; privacy states visible. |
| Editor | Portfolio slot canvas, library, inspector, source, history/problems | Three-pane workstation + top revision/actions + bottom problems/history | No phone editing; keyboard-accessible tree/Move/Add/Replace; Undo/Redo always available. |
| Operations | Users, reports/moderation, appeals | Role-scoped area within operations workspace | Privileged actions confirm reason, notice and audit event; no impersonation. |

See [all 52 screen surfaces](docs/02_design/SCREEN_CATALOG.md) and [53 feature workflows](docs/03_workflows/README.md). Routes other than the owner-approved `/u/` patterns are labelled proposals.

## 3. Visual expression, layout and content strategy

**Expressive brand mode:** public landing, sign-in/up, empty states and milestone panels. Use approved K source geometry and **sparse** geometric crop/arc/diagonal pattern; large editorial hierarchy. Do not transplant unrelated SaaS palette/screens or overuse random glassmorphism. All hero artwork must correspond to Kadmeion's real tools/portfolios, with illustrative data explicitly labeled.

**Restrained productivity mode:** sidebar/workspace/editor/settings, where legibility and task completion outweigh decorative motion. Controls are flat enough to identify affordances and information groups. Avoid nested decorative cards, vague primary buttons, empty charts and generic motivational numbers.

**Page composition mapping:**
- Landing: curved hero → problem → solution/value → asymmetric interlocking project showcase → templates → how it works → account/creation or analytics introduction → FAQ → final CTA. The three-view product preview rotates about **7 seconds** with manual controls and pause (UI-18/20/26).
- Developer identity: large asymmetric editorial portrait/identity, supporting skills and approved work; serves as hub for multiple independently designed portfolios (UI-27/28/108).
- Projects: distinct folder-inspired covers with live-site image when safe, author role, year/type, stack, verified-if-proven links. Details are **product-style hero + modular optional expandable sections** (UI-29–32/42).
- Builder: **five initial complete presets (not ceiling)** built from eight initial section layouts L1–L8, plus Blank. Template chooser large preview + details (UI-46).
- Workspace home: three focused areas Portfolio Studio, Projects, Personal Growth; first-use empty CTA choices not fake metrics (UI-37/38).

### Template/section distinction

A **complete preset** is a composition of several ordered sections and a theme. A **section layout** is a local slot schema (Arc Hero, Collage Hero, Project Showcase, Editorial Bento, Stepped Hero, Skills, Experience, Contact). Blank starts with no required fabricated section. Named slots accept declared component types, pin versions and retain unique stable section IDs. Initial counts are *planned catalogue*, never claims of implemented templates.

## 4. Typography and semantic design-token hierarchy

**Exact fonts and numerics are intentionally pending original-master/license validation.** Roles are approved (UI-101/106), not arbitrary font-family names: `font.display.editorial`, `font.body.productivity`, `font.mono.code`. Accessible fallbacks must be separately tested.

**Approved token architecture (UI-57):** base semantic theme → portfolio/template theme → section/layout overrides → per-component overrides → supported breakpoint-specific overrides. For managed components, typed editor values compile into CSS custom properties and approved variants. A custom user source file inherits a token **only when its CSS voluntarily refers to that documented variable**; never regex-patch arbitrary TSX/JS/CSS.

```css
/* Proposed token interface example, NOT existing implementation or approved numeric palette */
:root {
  --k-color-surface: var(--selected-aether-surface);
  --k-color-text: var(--selected-aether-foreground);
  --k-font-editorial: var(--verified-editorial-font, Georgia, serif);
  --k-font-productivity: var(--verified-ui-font, system-ui, sans-serif);
  --k-font-code: ui-monospace, monospace;
}
[data-section-id="section-example"] {
  --k-color-accent: var(--author-selected-accent);
}
[data-component-id="card-example"] {
  --k-font-editorial: var(--approved-card-font);
}
```

The placeholder `--selected-*` values above are **interfaces**, not real CSS declarations ready to ship; exact approved palette samples belong to image source verification. Color controls issue WCAG contrast warnings and high-risk failures are release blockers as specified by quality policy; do not pretend the slider automatically fixes inaccessible contrast.

## 5. Animation and microinteraction contract

| Event | Approved duration/behavior | Reduced-motion |
|---|---|---|
| Button press | Immediate; subtle active-state feedback | Immediate static state |
| Routine hover/focus/checkbox | 120–180ms ease-out | Instant state/focus persists |
| Menu, drawer, inspector | 180–250ms ease-out and trigger-origin placement | Instant/fade |
| Sign-in ↔ sign-up brand panel | 280–320ms reversible travel, short form fade, no bounce | Immediate or gentle fade; mobile crossfade |
| Insert/move/swap in editor | Short spatial transition, never blocks next operation | Non-spatial indication and focus |
| Hero product demo | Approximately **7 seconds per view**, manual previous/next, pause hover/focus | Static frame/manual navigation; no auto-cycling |
| Pending data | Text-glyph luminance shimmer with real request status | Static text-glyph silhouettes; no fake progress |

No perpetual background swooshes, unnecessary on-load delays, hover-only content or destructive transition lockouts. Motion and focus must survive rapid toggles, resizing, keyboard navigation and browser Back.

## 6. Glyph skeleton-loading system (exact meaning)

- A glyph is a **shape of pseudo-text**, not an actual meaningful or historical language. Form heading rows, sentence-like wrapped lines, metadata widths and list item groups with glyph silhouettes matched to final content footprint.
- Render only while unknown data is actually pending. Never use an ordinary gray bar with glyph decoration. Do not add an artificial 300ms, 1s or 3s wait to showcase loader effects.
- Keep stable heights and line-wrap density, maintain aria-hidden glyph internals, and provide one concise accessible loading status per region.
- On success replace content immediately; on empty show true empty; on failure show a local actionable error/retry, not an infinite glyph animation.
- In-button glyphs represent a real pending auth/save action with preserved accessible label and duplicate-submit protection (UI-09).
- The provided glyph reference image illustrates design direction; the precise correct mechanism is defined by the accepted behavioral specification, not incidental generated art.

## 7. Editor composition and safety model

```
Top: breadcrumb / project title / draft vs live / local-folder-cloud status / undo-redo / Preview / Publish
Left: Sections + searchable compatible Components + Favorites + My Components
Center: selected responsive canvas showing typed slots with useful EMPTY targets
Right: Content-first Inspector → Style | Layout | Responsive | Accessibility | Advanced
Bottom drawer: Problems / History / Comparison / recovery actions
Advanced Source: dedicated file tree, explicit file ownership badges and diagnostics
```

**One truth:** Committed versioned readable project file set → validated project graph → all panels share the same revision → UI submits typed operations → guarded atomic/recoverable commit → all lenses refresh from one commit. Separate cloud/browser/folder save location indicators.

| Slot state | Source and data consequence | Allowed next actions |
|---|---|---|
| `EMPTY` | No component; outgoing content/asset/override in protected stash/history | Add compatible, restore, Undo; required slot may block *publish* but not draft save |
| `S0` | Pinned trusted library component usage, implementation read-only | Content/style edit, swap, Customize |
| `S1` | Owned override identical to pinned upstream source | Edit owned file, keep/stash/cancel swap |
| `S2` | Modified owned override; protected opaque source | Explicit impact dialog Keep as My Component / Replace and Stash / Cancel |
| Error (orthogonal) | Invalid buffer or compile/runtime diagnostic; last-good preview clearly stale | Fix, compare, restore, export; block invalid publication |

Compatible maps copy matching typed content and declared aliases, preserve unmatched fields in **Unplaced**; never delete content, truncate input, or infer arbitrary JS structure. Managed JSONC is permitted only with proven lossless patching; otherwise use guarded plain JSON and preserve opaque originals. Code compilation/preview requires isolation and may not share app secrets.

## 8. Authoring, preview, staging and public release

| Experience | Approved access and promises |
|---|---|
| Private draft | Saveable when incomplete; does **not** affect live site. No phone authoring. |
| Author Preview | Current selected draft with editing instrumentation and diagnostics as safely supported. |
| Preview as Published | Visitor-facing **simulation** of pinned draft using actual static/trust restrictions; no live URL/pointer change. |
| Reviewer staging | Pinned read-only revision, short chosen expiry, hashed token, server-side revoke, noindex/no-store. |
| Publication preflight | Blockers/Warnings/Passed and exact fixes; default Private. Public/Unlisted is explicit. |
| Live release | Immutable versioned static output + controlled pointer. Acknowledge only after actual visitor-fetch validation. |
| Rollback/unpublish | Dedicated Releases timeline, verify pointer/404-410 including direct release URL and caches; protect earlier drafts. |
| Static export | Reproducible static ZIP independent of Kadmeion's live host; project ZIP separately preserves editability/owned source. |

A developer's published portfolio owns its light/dark/tokens independently of app landing theme. Public profile and individual project visibility are distinct deliberate exposure choices. Analytics are **OFF** until enabled per published portfolio (UI-115). Unlisted links are accessible to anyone holding a valid link and are **not** secure private preview tokens.

## 9. Mobile, tablet and accessibility constraints

**All published portfolio/profile/project views** must adapt to narrow phones and accessible zoom/reflow. **Only supported large tablets and desktop/laptops** may open component layout editing or source code. Qualification checks consider viewport, input capabilities, keyboard accessibility, browser behavior and actual tests; a phone is never granted edit mode just by requesting a desktop viewport. Small-device editing requests show explicit Continue on Supported Device with view/share fallback. Mobile may safely access settings and simple goal updates as separately appropriate.

Target **WCAG 2.2 AA**. All 52 surfaces have keyboard and screen-reader acceptance criteria; source editor requires an accessible layer tree and non-drag Move/Add/Replace. Avoid hover-only controls, form errors without field references, focus traps, decorative announcements, excessive motion, insufficient text contrast or illegible 200%-zoom layouts.

## 10. System feedback and genuine error states

**Feedback hierarchy (UI-99):** quiet inline Save state → contextual recoverable issue/Undo → explicit dangerous/public confirmation. Render real states `LOADING`, `EMPTY`, `DRAFT_BUFFER`, `SAVED_BROWSER`, `SAVED_FOLDER`, `SYNCED_CLOUD`, `CONFLICT`, `STALE_PREVIEW`, `STAGED`, `PUBLISHING`, `LIVE_VERIFIED`, `UNPUBLISHED`, `OFFLINE`, `RATE_LIMITED`, `PERMISSION_DENIED`, `TRASH`, `PURGED`. Do not combine unrelated progress signals into one generic “Saved” or “Published”.

## 11. Page-to-specification index

| Domain | Full screen specifications | Workflow coverage |
|---|---|---|
| Public/visitor | [Landing, templates, profiles, projects, portfolios](docs/02_design/SCREEN_CATALOG.md) | [Identity](docs/03_workflows/02_ONBOARDING_AND_IDENTITY.md), [Projects](docs/03_workflows/03_PROJECTS_AND_CASE_STUDIES.md) |
| Authentication | Sign-in/up, callback, forgot/reset and outcome | [Auth workflow](docs/03_workflows/01_AUTHENTICATION.md) |
| Workspace | Welcome, dashboard, project and owned portfolio lists | [Project workflows](docs/03_workflows/03_PROJECTS_AND_CASE_STUDIES.md) |
| Portfolio editor | Eight dedicated editor surfaces and preview | [Editor workflow](docs/03_workflows/04_EDITOR_AND_COMPONENTS.md) |
| Publishing | Stage, preflight, release, rollback, sharing | [Publishing workflow](docs/03_workflows/05_STAGING_PUBLISH_AND_EXPORT.md) |
| Growth | Activity, private DevScore, goals, analytics and handles | [Growth workflow](docs/03_workflows/06_INTEGRATIONS_ANALYTICS_AND_GOALS.md) |
| Account | Settings, privacy, security, notifications, Trash, export, erasure | [Settings workflow](docs/03_workflows/07_SETTINGS_RECOVERY_AND_DELETION.md) |
| Admin | Users, portfolio moderation and appeals | [Admin workflow](docs/03_workflows/08_ADMINISTRATION_AND_MODERATION.md) |

## 12. Source ownership, implementation boundaries and document acceptance

- Initial planned codebase is **greenfield Kadmeion**, old DevFolio repo reference-only. No migrations by default.
- User's requirements override source text where explicit newer decisions conflict. **All 115 decisions** are enumerated in [`registers/DECISIONS_UI_001_115.csv`](registers/DECISIONS_UI_001_115.csv).
- Unverified tech (Brevo delivery, Supabase RLS, hosting/public revocation, website capture, public API facts, cross-origin sandbox) remains `[PROOF]` in the [technical proof register](registers/TECHNICAL_PROOFS.csv), never presented as operational.
- Source authority and supersession detail: [Source policy](docs/00_governance/AUTHORITY_AND_SUPERSESSION.md), [Conflict matrix](docs/00_governance/CONFLICT_REGISTER.md), [QA matrix](docs/05_quality/DESIGN_REVIEW_CHECKLIST.md).
- Handoff requirements: **master design + every screen's section/actions/states + all 53 workflows + tests + proposed folder tree + capstone report material**, all internally linked and explicit about `NOT_IMPLEMENTED`/`NOT_RUN`. Never claim generated Markdown is a deployed application or an audited test result.
