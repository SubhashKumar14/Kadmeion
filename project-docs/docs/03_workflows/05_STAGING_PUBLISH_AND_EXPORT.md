# 05 Staging Publish And Export — Feature and Workflow Specifications

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

**Scope:** 9 end-to-end workflows. Each flow defines trigger, prerequisites, ordered behavior, failure/recovery and durable outcome; actions and data contracts remain proposed until implementation.

## Workflows in this group

- [WF-028: Author Preview vs Preview as Published](#wf-028) — Owner
- [WF-029: Create expiring reviewer link](#wf-029) — Owner
- [WF-030: Run publication preflight](#wf-030) — Owner
- [WF-031: Build immutable release and verify live route](#wf-031) — Owner
- [WF-032: Edit after publishing and republish](#wf-032) — Owner
- [WF-033: Rollback a release](#wf-033) — Owner
- [WF-034: Unpublish, visibility and delete](#wf-034) — Owner
- [WF-035: Change published URL / SEO metadata](#wf-035) — Owner
- [WF-036: Portable export and provider outage](#wf-036) — Owner

<a id="wf-028"></a>

## WF-028 — Author Preview vs Preview as Published

**Actor:** Owner · **Trigger:** Preview selected revision · **Decision refs:** UI-58,62,66,73  
**Precondition:** Revision pinned and build possible

### Successful sequence

1. Expose two labeled modes with revision ID and viewport presets.
2. Author mode shows permitted editing/diagnostic instrumentation.
3. Published mode strips editor controls and simulates actual static JS/CSP/security constraints.
4. Compare discrepancy and show unsafe/unsupported behavior.
5. Never change live pointer from Preview action.

### Failure, abuse, conflict and recovery

Build invalid: stale labeled preview; custom JS unsupported: static result and warning; phone editor not required for phone preview. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Truthful preview difference and no inadvertent publication.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-029"></a>

## WF-029 — Create expiring reviewer link

**Actor:** Owner · **Trigger:** Stage revision · **Decision refs:** UI-62,67  
**Precondition:** Private pinned snapshot and selected expiry

### Successful sequence

1. Freeze exact revision and create hashed random reviewer token.
2. Store expiry/revocation metadata server-side, send only scoped link.
3. Show Copy/Share/Revoke controls and expiry clearly.
4. Verify staging route read-only/no-store/noindex.
5. Revoke on command or after expiry, blocking direct access.

### Failure, abuse, conflict and recovery

Expired/revoked replay: 410/404; raw asset bypass: failure gate; do not expose draft source. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Short-lived revocable read-only preview.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-030"></a>

## WF-030 — Run publication preflight

**Actor:** Owner · **Trigger:** Request Publish · **Decision refs:** UI-66,68,71,73  
**Precondition:** Frozen project revision and owner session

### Successful sequence

1. Check required slots/content, metadata, asset rights, accessibility structural gates and release trust model.
2. Group Blockers, Warnings and Passed with deep links.
3. Generate public HTML/static preview from pinned inputs.
4. Require manual explicit Public/Unlisted activation from Private.
5. Reject unsafe custom JavaScript release and offer safe static/export comparison.

### Failure, abuse, conflict and recovery

Missing fields/security isolation: Blocker; contrast warning policy documented; if host unavailable keep private draft. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Structured preflight report for frozen revision.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-031"></a>

## WF-031 — Build immutable release and verify live route

**Actor:** Owner · **Trigger:** Confirm Publish · **Decision refs:** UI-68–72,75,107  
**Precondition:** Preflight passes, destination host verified, visibility intentional

### Successful sequence

1. Submit idempotency key and expected live pointer.
2. Produce immutable static HTML/CSS/media and hash manifest.
3. Upload to vetted release store, verify checksums and output policy.
4. Switch authoritative visibility pointer atomically where possible.
5. Fetch public URL as visitor with JS off and verify correct content/status.
6. Only then label PUBLISHED and show canonical URL.

### Failure, abuse, conflict and recovery

Failure before switch: prior release stays live; after switch: conditional rollback/incident; host paused: export option. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** A verified public release, never unvalidated success.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-032"></a>

## WF-032 — Edit after publishing and republish

**Actor:** Owner · **Trigger:** Modify live portfolio in editor · **Decision refs:** UI-54,69,72  
**Precondition:** Existing live release and separate private draft

### Successful sequence

1. Keep Draft vs Live indicator visible.
2. Save new draft revisions without changing live bytes.
3. Open Review Changes and compare against active release.
4. Re-run preflight on selected new revision.
5. Explicitly publish new immutable release, record revision/link.

### Failure, abuse, conflict and recovery

Cloud sync failure: draft stays local; publish reject: prior release untouched. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** No silent modifications of public pages.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-033"></a>

## WF-033 — Rollback a release

**Actor:** Owner · **Trigger:** Select historic release · **Decision refs:** UI-69,75  
**Precondition:** Retained, verified release and owner authorization

### Successful sequence

1. Show release timeline and preview/compare older release against live.
2. Confirm public rollback and visibility implications.
3. Conditionally switch live pointer to retained immutable release.
4. Verify public URL direct access, robots and assets.
5. Record change without deleting newer draft/history.

### Failure, abuse, conflict and recovery

Cache mismatch/host failure: declare incident, preserve last verified state, expose export. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Versioned rollback without draft erasure.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-034"></a>

## WF-034 — Unpublish, visibility and delete

**Actor:** Owner · **Trigger:** Unpublish or delete selected portfolio · **Decision refs:** UI-68,74,91,112  
**Precondition:** Owner session and public release route

### Successful sequence

1. Explain difference Private, Unlisted, Public, Unpublish and Delete.
2. Request explicit confirmation, target active public route and directly reachable assets.
3. Revoke authority, verify 404/410 route and no bypass by stale release URL.
4. Move item to 15-day Trash when deleted, not when merely unpublished.
5. Explain search engines and third-party archives may retain cached copies.

### Failure, abuse, conflict and recovery

Revocation impossible: show pending/incident, do not claim removed; restore never auto-republishes. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Verified public route disabled and recoverable private item if deleted.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-035"></a>

## WF-035 — Change published URL / SEO metadata

**Actor:** Owner · **Trigger:** Rename slug or edit social preview · **Decision refs:** UI-70–71,107  
**Precondition:** Owned published or pending portfolio

### Successful sequence

1. Check reserved prefixes, slug availability and public route collision.
2. Build metadata from real draft content with editable overrides.
3. Compare old/new canonical URLs and disclose link breakage.
4. Reissue/verify release and safe redirect if host supports it.
5. Do not send crawlers private/unlisted content.

### Failure, abuse, conflict and recovery

Host redirect unproven: refuse automatic promise; wrong metadata: rollback/retry. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Correct public identity, real share metadata.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-036"></a>

## WF-036 — Portable export and provider outage

**Actor:** Owner · **Trigger:** Export or host publishing failure · **Decision refs:** UI-65,73,75,110  
**Precondition:** Owned project exists locally or in cloud

### Successful sequence

1. Distinguish editable project ZIP from static site ZIP and optional private revision history.
2. Resolve references, redact credentials/refresh tokens/private third-party data.
3. Validate built files and manifest hashes.
4. Provide local downloadable package and hosting instructions without pretending deployment.
5. Keep prior live release if hosting failed.

### Failure, abuse, conflict and recovery

Cloud/Auth down: existing owned local project export allowed within safe identity/cache boundary; missing asset: report incomplete, do not fake complete ZIP. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Portable reproducible data under free-tier loss.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.
