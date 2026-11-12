# 03 Projects And Case Studies — Feature and Workflow Specifications

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

**Scope:** 6 end-to-end workflows. Each flow defines trigger, prerequisites, ordered behavior, failure/recovery and durable outcome; actions and data contracts remain proposed until implementation.

## Workflows in this group

- [WF-012: Quick-add project (no repository import)](#wf-012) — Owner
- [WF-013: Create/replace website preview thumbnail](#wf-013) — Owner
- [WF-014: Edit detailed project case study](#wf-014) — Owner
- [WF-015: Choose where each project is public](#wf-015) — Owner
- [WF-016: Open public project destinations](#wf-016) — Public visitor
- [WF-017: Search, sort and filter project library](#wf-017) — Owner

<a id="wf-012"></a>

## WF-012 — Quick-add project (no repository import)

**Actor:** Owner · **Trigger:** Add Project action · **Decision refs:** UI-25,40,43,109  
**Precondition:** Account owns workspace

### Successful sequence

1. Open keyboard-trapped quick-add drawer.
2. Collect title, short description and optional repo/demo URLs.
3. Validate URL schemes and normalize link strings.
4. Save private project immediately and return stable project ID.
5. Offer Continue Editing detail editor.

### Failure, abuse, conflict and recovery

Invalid URL: localized validation; offline: local draft preservation with honest cloud status; no GitHub: still allowed. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Private project record referencing URLs, not source archive.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-013"></a>

## WF-013 — Create/replace website preview thumbnail

**Actor:** Owner · **Trigger:** Live URL saved/changed · **Decision refs:** UI-29–30,41,51  
**Precondition:** Safe capture capability and quota separately proven

### Successful sequence

1. Preserve project record and display folder cover immediately.
2. If a capture service is approved, enqueue URL through SSRF-safe restricted server flow.
3. Render capture-pending state without blocking edit.
4. On success persist safe raster screenshot, alt/focal metadata and source timestamp.
5. Allow Replace/Upload/Retry and fall back to authored cover on denial/failure.

### Failure, abuse, conflict and recovery

No approved free capture: do not attempt; private/local IP/cookie/auth URL blocked; capture failure: manual upload. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Reliable project thumbnail or explicit fallback.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-014"></a>

## WF-014 — Edit detailed project case study

**Actor:** Owner · **Trigger:** Open project detail · **Decision refs:** UI-31–32,42–43,109  
**Precondition:** Owner of project

### Successful sequence

1. Render product-style hero and technical overview.
2. Choose optional modules such as challenge/approach/implementation/results/media.
3. Enable, hide, reorder and edit modules without deleting hidden content.
4. Save private revision.
5. Explicitly confirm changed external links and any public visibility updates.

### Failure, abuse, conflict and recovery

Invalid media/link: keep draft; external demo dead: identify unavailable link; stale save: compare and retry. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Owner project case study ready for selected publication context.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-015"></a>

## WF-015 — Choose where each project is public

**Actor:** Owner · **Trigger:** Project exposure toggle · **Decision refs:** UI-43,88,109  
**Precondition:** Owned valid project and selected public surface

### Successful sequence

1. Separate switches for profile visibility, selected portfolio references and public standalone case-study route.
2. Show public projection preview.
3. Perform confirmation for new exposures or changed link targets.
4. Publish/revoke through surface-specific release rules and cache verification.

### Failure, abuse, conflict and recovery

Prior immutable release may retain content: show pending revocation until delivery verifies; host cannot revoke: incident rather than false success. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Explicit per-surface project exposure state.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-016"></a>

## WF-016 — Open public project destinations

**Actor:** Public visitor · **Trigger:** Case-study/project-card click · **Decision refs:** UI-29–32,107,109  
**Precondition:** Public exposure active

### Successful sequence

1. Open Kadmeion details when clicking card body.
2. Offer separate clearly labeled View Live and View Repository actions.
3. Use safe external-link schemes and destination cues.
4. Show author-provided outcome as self-reported.
5. Handle missing source/live link by omitting that action.

### Failure, abuse, conflict and recovery

External site unavailable: offer copy/link and back; unlisted/private project: no discovery through search. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** No repository import and no misleading ownership badge.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-017"></a>

## WF-017 — Search, sort and filter project library

**Actor:** Owner · **Trigger:** Project browsing · **Decision refs:** UI-39,44  
**Precondition:** Signed-in account

### Successful sequence

1. Query owner-scoped records only.
2. Apply search, technology/visibility/type filters, date/title sorting.
3. Switch grid/list without losing selection/filters.
4. Represent real zero results and clear-filter action.
5. Operate in mobile view-only or permitted simple tasks as tested.

### Failure, abuse, conflict and recovery

Offline index stale: identify timestamp; server quota: show retry, local drafts not fake synced. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Deterministic owned-project browsing.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.
