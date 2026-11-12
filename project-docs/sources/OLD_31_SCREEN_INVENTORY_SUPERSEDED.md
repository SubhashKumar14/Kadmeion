# Screen inventory, navigation and UI states

**Proposed exhaustive functional screen map from full Phase 2 PRD + editor blueprint.** Some route paths and screen groupings below are *design proposals*, not explicitly approved URLs. Final navigation and route contracts require implementation review. Each screen must have desktop/tablet/mobile, light/dark, loading, empty, success, error, unauthorized and reduced-motion coverage where applicable.

| Screen ID | Route candidate | Access | Main regions and actions | Requirement links | Status |
|---|---|---|---|---|---|
| S01 | `/` | Public | Identity/hero, build/showcase/evolve explanation, example work, Create Portfolio CTA | D01,D03,D30,FR-DESIGN-01 | NOT_BUILT |
| S02 | `/signin` | Guest | Email auth, Google optional, accessible errors, reset link, reversible auth panel | D27,D79,D86 | NOT_BUILT |
| S03 | `/signup` | Guest within quota | Account creation, honest limits, optional Google, errors | D14,D60,D70,D89 | NOT_BUILT |
| S04 | `/auth/callback` | Browser auth callback | Session exchange, invalid/expired state, protected redirection | FR-AUTH-01 | NOT_BUILT |
| S05 | `/app/onboarding` | Developer | Profile setup, optionally connect GitHub, create first project, choose template | D04,D88,R01 | NOT_BUILT |
| S06 | `/app` | Developer | Recent portfolios/projects, draft/published status, quick tasks, genuine counts | D09,D30 | NOT_BUILT |
| S07 | `/app/profile` | Developer | Profile biography, skills, links, avatar, public projection preview | D01,D23 | NOT_BUILT |
| S08 | `/app/projects` | Developer | Search/filter owned projects, create/edit, privacy, case studies | D08,D22,D88 | NOT_BUILT |
| S09 | `/app/projects/new` | Developer | Authored project, tech, role, evidence URLs, media, save incomplete | FR-PROJ-01 | NOT_BUILT |
| S10 | `/app/projects/:id` | Developer | Edit project, evidence claim flags, gallery/case details, delete/restore | FR-PROJ-02 | NOT_BUILT |
| S11 | `/app/portfolios` | Developer | Drafts, published revisions, create/duplicate, publish status | D35,D40 | NOT_BUILT |
| S12 | `/app/portfolios/new` | Developer/local guest where enabled | Five presets/Blank; template descriptions; no coding needed | R01–R03,D41 | NOT_BUILT |
| S13 | `/app/portfolios/:id/edit` | Developer (or local instance) | Editor toolbar, sections/layers/components/assets/theme, responsive canvas, source, problems/history | R01–R47,D82,D90 | NOT_BUILT |
| S14 | editor panel: `Content` | Editor | Editable text/link/media with source separation, commit/recovery status | R05,R17,R18 | NOT_BUILT |
| S15 | editor panel: `Components` | Editor | Trusted library, typed-slot filtering, tap/place, stash/Unplaced | R03,R13–R16 | NOT_BUILT |
| S16 | editor panel: `My Components` | Editor | Save/reuse owned source+manifest; versions and license | D41,D90,R03 | NOT_BUILT |
| S17 | editor panel: `Theme/Assets` | Editor | Versioned tokens, responsive props, upload refs, alt/focal controls | D33,D42,R06,R18 | NOT_BUILT |
| S18 | editor panel: `Source` | Advanced editor | Managed JSONC/JSON with guards; opaque owned code; read-only usage and diff | D38,D52,R04,R05 | NOT_BUILT |
| S19 | editor panel: `History/Problems` | Editor | Linear snapshots, restored revisions, compare, stale/error diagnostics | D35,D54,R22 | NOT_BUILT |
| S20 | `/app/portfolios/:id/preview` | Owner | Preview author vs publish, desktop/tablet/mobile widths, validation | D40,D45 | NOT_BUILT |
| S21 | `/r/:token` | Token reviewer | Read only pinned staging revision, expires/revokes, noindex/no-store | D45,R07 | NOT_BUILT |
| S22 | `/app/portfolios/:id/publish` | Owner | Preflight, release review, version comparison, status and rollback | D40,D54,R08 | NOT_BUILT |
| S23 | `/:username/:portfolioSlug` | Public | SEO indexable static HTML, selected published content, sensible case-study routes | D10,D20,D74 | NOT_BUILT |
| S24 | `/app/analytics` | Developer | Aggregate views/referrer categories/estimated sessions, no visitor identity | D58,D73 | NOT_BUILT |
| S25 | `/app/growth` | Developer | Private explainable DevScore, editable goals, provider freshness | D13,D18 | NOT_BUILT |
| S26 | `/app/integrations` | Developer | Optional provider link, consent/publication, disconnect delete default | D07,D12,D28 | NOT_BUILT |
| S27 | `/app/settings` | Developer | Account, sign-out/session, privacy, appearance, delete/export | D23,D67,D80 | NOT_BUILT |
| S28 | `/app/trash` | Developer | Deleted items, 15-day remaining time, restore, irreversible expiry warning | D67,D72 | NOT_BUILT |
| S29 | `/app/export` | Developer | Project ZIP, static site ZIP, no tokens, independent host guidance | D75,R31 | NOT_BUILT |
| S30 | `/app/operations/moderation` | Restricted internal operator | Abuse case, narrow unpublish, audit, notices/appeals | D65,D71 | NOT_BUILT |
| S31 | status screens (403/404/410/offline/quota) | Applicable | Explicit denied/expired/deleted state, safe retry/export when possible | D70,D72,R37 | NOT_BUILT |

**Scope note:** Screen panels S14–S19 need not be separate routes. The editor is one workbench. Routing may differ according to selected framework and browser capability. Public multi-page portfolios are **not implicitly required** by the editor v1; public case studies can be designed as content/section/links before separate multi-page approval.

## Editor adaptive layout

```text
Desktop: top status / left Sections+Components / center canvas / right Context / bottom Problems/History
Tablet: top status / left rail / center canvas / drawer inspector / collapsible diagnostics
Mobile: top status / single tabbed edit panel / tap-to-place / responsive preview / simple source fallback
```

## Required state inventory per interactive surface

| UI state | Behavior |
|---|---|
| `INITIAL/EMPTY` | Clear first action; no fake template/public proof or invented numbers |
| `LOADING` | Actual glyph-text skeleton in content footprint; async label for assistive technology |
| `EDITING_LOCAL` | Unsaved buffer visibly distinct; no false cloud-sync claim |
| `SAVING` / `SAVED_BROWSER` / `SAVED_FOLDER` / `SYNCED_CLOUD` | Distinct truthful state after relevant acknowledgement |
| `INVALID_BUFFER` | Preserve text, diagnostics, last-good preview stale label |
| `SLOT_EMPTY` | Dashed compatible target with semantic label; draft save allowed |
| `OWNED_CODE_S1/S2` | Protected override, confirmation on replacement |
| `PREVIEW_STAGED` | Visible pinned revision, expiration, read-only share controls |
| `PUBLISHING` | Actual frozen version/status, idempotent retry |
| `PUBLISHED` | Only after public fetch verified; shows URL and release ID |
| `OFFLINE / QUOTA` | Local editing/export continues; cloud publish prevented with truthful status |
| `DELETED / GONE` | 15-day private Trash, public route 404/410 appropriate, no private content |

## Layout assignment check

- L1 Arc Hero: public hero/portfolio first section; L2 Collage Hero: published profile showcase; L3 Project Showcase: case/gallery; L4 Editorial Bento: supporting media/work; L5 Stepped Hero: optional hero/onboarding; L6 Skills; L7 Experience; L8 Contact.
- **Do not** treat the five wireframe layouts as full one-screen portfolio templates. Each of the five presets assembles several section layouts.
- Keep accepted content order under responsive arrangement; no hiding key text on narrow viewports.

## Navigation and interactions acceptance

Keyboard focus and Escape/Enter/Space, accessible tab ordering, touch targets, reduced-motion auth and menus, no surprising history manipulation, manual source edit fallback on phone, correct route auth/guest protection and deep link refresh all need future tests. User-facing controls must have real actions; no inert mockup buttons or fabricated data.
