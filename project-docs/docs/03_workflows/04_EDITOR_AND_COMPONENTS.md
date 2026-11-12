# 04 Editor And Components — Feature and Workflow Specifications

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

**Scope:** 10 end-to-end workflows. Each flow defines trigger, prerequisites, ordered behavior, failure/recovery and durable outcome; actions and data contracts remain proposed until implementation.

## Workflows in this group

- [WF-018: Create portfolio from preset or Blank](#wf-018) — Owner on qualified device
- [WF-019: Edit content with one transactional writer](#wf-019) — Owner on qualified device
- [WF-020: Delete component into EMPTY slot and Undo](#wf-020) — Owner on qualified device
- [WF-021: Add/drag/reorder compatible component](#wf-021) — Owner on qualified device
- [WF-022: Protected swap of S1/S2 owned source](#wf-022) — Owner on qualified device
- [WF-023: Change section layout / reorder](#wf-023) — Owner on qualified device
- [WF-024: Edit tiered theme tokens](#wf-024) — Owner on qualified device
- [WF-025: Make and reuse My Component](#wf-025) — Owner on qualified device
- [WF-026: Preview, edit invalid source and recover](#wf-026) — Owner on qualified device
- [WF-027: Recover conflicting tabs/local-folder changes](#wf-027) — Owner on qualified device

<a id="wf-018"></a>

## WF-018 — Create portfolio from preset or Blank

**Actor:** Owner on qualified device · **Trigger:** Create Portfolio · **Decision refs:** UI-44,46,55,60,110  
**Precondition:** Signed-in owner and device eligible

### Successful sequence

1. Open editorial gallery with main preview left/info right.
2. Choose one of initial five extensible curated presets or genuine Blank.
3. Show what the template includes without fake author claims.
4. Create typed project manifest, stable sections/slots and initial private draft revision.
5. Open three-pane editor.

### Failure, abuse, conflict and recovery

Phone: show unsupported editor and continuation; unavailable preset: no partial project; quota: offline/export guidance. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Private versioned portfolio project.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-019"></a>

## WF-019 — Edit content with one transactional writer

**Actor:** Owner on qualified device · **Trigger:** Field/inspector edit · **Decision refs:** UI-47,50,54,57,65  
**Precondition:** Valid base revision and owner access

### Successful sequence

1. Buffer text and validate type/length.
2. Create typed operation carrying baseRevision, target slot and intent.
3. Plan minimal managed-file patch, check ownership and schema.
4. Commit as one revision or keep recoverable invalid draft buffer.
5. Refresh canvas/source/inspector from committed revision and display exact save adapter state.

### Failure, abuse, conflict and recovery

Conflict: compare/keep both; invalid grammar: no destructive write; cloud unavailable: remain local only and say so. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Single coherent committed file set, not split canvas and source states.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-020"></a>

## WF-020 — Delete component into EMPTY slot and Undo

**Actor:** Owner on qualified device · **Trigger:** Delete selected component · **Decision refs:** UI-48,53–54,56  
**Precondition:** Slot assignment exists

### Successful sequence

1. Locate typed slot and storable original content/asset/owned overrides.
2. Create stash/history reference and set assignment EMPTY as draft operation.
3. Show compatible labeled Add target and Undo.
4. Update generated usage code without phantom JS/source edits.
5. Keep draft saveable; required-empty slot blocks publication.

### Failure, abuse, conflict and recovery

Stash write fails: abort deletion; Undo after other changes: guard base revision; no content truncation. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Recoverable EMPTY assignment.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-021"></a>

## WF-021 — Add/drag/reorder compatible component

**Actor:** Owner on qualified device · **Trigger:** Add or drag onto slot · **Decision refs:** UI-48–49,56,63–64  
**Precondition:** Target slot contract and component manifest valid

### Successful sequence

1. Filter library components to accepted types and capacities.
2. Highlight compatible targets; supply keyboard Add/Move/Replace equivalent.
3. Validate version/props/dependencies and plan typed operation.
4. Map declared matching fields and aliases only.
5. Send unmatched values to Unplaced tray and show result.
6. Commit one undoable revision with short spatial feedback.

### Failure, abuse, conflict and recovery

Incompatible: no mutation and show fit help; stale: preserve revision; keyboard no drag dependency. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** No silent data loss, predictable accessibility.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-022"></a>

## WF-022 — Protected swap of S1/S2 owned source

**Actor:** Owner on qualified device · **Trigger:** Replace modified component · **Decision refs:** UI-48,52–53,59  
**Precondition:** Owned code in slot, incoming component selected

### Successful sequence

1. Detect S1 identical owned override vs S2 modified override.
2. Present affected files and unmatched mapped content in impact dialog.
3. Offer Keep as My Component, Replace and Stash, Cancel.
4. On explicit choice preserve opaque bytes and lock/provenance, commit transaction.
5. Update revision/history with undo reference.

### Failure, abuse, conflict and recovery

Dialog dismissed: Cancel; storage quota: no replace; unsupported JS: keep code but flag publish gate. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Owned user source never silently overwritten.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-023"></a>

## WF-023 — Change section layout / reorder

**Actor:** Owner on qualified device · **Trigger:** Choose alternate L1–L8 or drag section · **Decision refs:** UI-56,58,63  
**Precondition:** Typed section and compatible proposed layout

### Successful sequence

1. Show side-by-side current/new section composition.
2. Calculate matching slot fields and leftover Unplaced entries.
3. Announce incompatibilities and public/mobile preview changes.
4. Await explicit confirmation.
5. Commit section-level operation in one revision; support Undo and keyboard reorder.

### Failure, abuse, conflict and recovery

Unmatched media/text preserved; incompatible layout: block destructive cast; invalid custom source untouched. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Same content plus deliberate layout revision.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-024"></a>

## WF-024 — Edit tiered theme tokens

**Actor:** Owner on qualified device · **Trigger:** Change typography/color/spacing · **Decision refs:** UI-57–58,101,106  
**Precondition:** Trusted token-consuming component or documented owned component contract

### Successful sequence

1. Select global, template, section, component or breakpoint scope.
2. Edit typed semantic token/variant; surface inheritance and override status.
3. Recompute CSS custom properties without rewriting user TSX files.
4. Preview desktop/tablet/phone widths and contrast warning.
5. Commit token changes into revision and ensure export uses same variables.

### Failure, abuse, conflict and recovery

Unknown custom CSS: show unsupported override rather than mutate it; contrast failure: block critical accessibility release issue. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Reproducible theme tokens shared by editor and static export.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-025"></a>

## WF-025 — Make and reuse My Component

**Actor:** Owner on qualified device · **Trigger:** Customize trusted library block · **Decision refs:** UI-49,52,59  
**Precondition:** Component code is trusted read-only library source

### Successful sequence

1. Create user-owned implementation/manifest file, pin original version and ownership.
2. Open Advanced source with safe diagnostics.
3. Save owned change through controlled code-edit workflow, not visual inverse parsing.
4. Publish in My Components with compatibility manifest and explicit trust flags.
5. Allow reuse only in declared safe slots and gated preview.

### Failure, abuse, conflict and recovery

Invalid manifest/code: preserve buffer and last good preview; unsafe JS: static/export-only public path. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Versioned user-owned component without weakening trust model.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-026"></a>

## WF-026 — Preview, edit invalid source and recover

**Actor:** Owner on qualified device · **Trigger:** Source buffer invalid or preview requested · **Decision refs:** UI-61–62,65,73  
**Precondition:** At least one saved valid revision or empty project

### Successful sequence

1. Validate authored source and managed file grammar.
2. Show diagnostics with affected file/line.
3. Preserve uncommitted text separately from committed state.
4. Keep last-good image distinctly STALE.
5. Allow Fix/Restore/Keep Both/Export Draft actions.
6. Preview as Published uses release security rules, not arbitrary author runtime.

### Failure, abuse, conflict and recovery

Unsafe JavaScript: no privileged execution; failed build: no publish; restore creates new revision. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** No silent source loss or false preview parity.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-027"></a>

## WF-027 — Recover conflicting tabs/local-folder changes

**Actor:** Owner on qualified device · **Trigger:** CAS/hash mismatch · **Decision refs:** UI-54,65,95  
**Precondition:** Editor receives changed external/base revision

### Successful sequence

1. Freeze unsafe commit and retain current local draft buffer.
2. Present precise differing paths/revisions and Compare.
3. Offer Keep Both or intentional Restore/Retry after safe merge.
4. Journal folder changes and detect permission loss.
5. Only mark Saved at correct adapter acknowledgement.

### Failure, abuse, conflict and recovery

No auto last-write-wins, no unreliable multi-file atomicity claims; browser eviction prompts export. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Both revisions remain recoverable.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.
