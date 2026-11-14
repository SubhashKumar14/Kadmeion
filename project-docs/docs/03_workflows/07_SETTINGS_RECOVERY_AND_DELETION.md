# 07 Settings Recovery And Deletion — Feature and Workflow Specifications

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

**Scope:** 6 end-to-end workflows. Each flow defines trigger, prerequisites, ordered behavior, failure/recovery and durable outcome; actions and data contracts remain proposed until implementation.

## Workflows in this group

- [WF-043: Edit account/profile and privacy](#wf-043) — Owner
- [WF-044: Manage active sessions and login methods](#wf-044) — Owner
- [WF-045: Read actionable notifications](#wf-045) — Owner
- [WF-046: Delete item to Trash then restore](#wf-046) — Owner
- [WF-047: Export and delete account](#wf-047) — Owner
- [WF-048: Global offline, quota and device fallback](#wf-048) — All

<a id="wf-043"></a>

## WF-043 — Edit account/profile and privacy

**Actor:** Owner · **Trigger:** Change profile/privacy · **Decision refs:** UI-86–88,108–109  
**Precondition:** Owner authenticated

### Successful sequence

1. Open Settings sections and contextual visibility controls.
2. Modify private fields with live public projection.
3. Show centralized Privacy & Sharing review before any publish.
4. Require explicit action for new visibility and per-surface project exposure.
5. Verify public projection excludes unselected fields.

### Failure, abuse, conflict and recovery

Stale account: refresh/compare; route unavailable: retain private state. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Explicitly selected public profile fields.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-044"></a>

## WF-044 — Manage active sessions and login methods

**Actor:** Owner · **Trigger:** Open Security · **Decision refs:** UI-03,12–14,94  
**Precondition:** Current strong session

### Successful sequence

1. List verified active sessions if Supabase capabilities proven.
2. Change password and invalidate/reset required sessions according to supported semantics.
3. Offer Sign out other sessions and linked identity methods where real.
4. Explain email verification privately; public badge positive only.
5. Require reauthentication where security-critical.

### Failure, abuse, conflict and recovery

Unsupported feature: hide/label unavailable rather than fake revoke; unknown device: report session evidence level. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Honest account security controls.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-045"></a>

## WF-045 — Read actionable notifications

**Actor:** Owner · **Trigger:** Open inbox · **Decision refs:** UI-90,95  
**Precondition:** Notifications table/event channel available

### Successful sequence

1. Show true publish/security/reviewer/sync events with category/priority.
2. Open relevant in-app location and mark read after interaction.
3. Let user set optional preferences without muting required security notifications.
4. Send essential email only where free Brevo flow validated.

### Failure, abuse, conflict and recovery

Provider failure: in-app remains truthful; quota: no send-success banner. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Actionable in-app delivery with optional email.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-046"></a>

## WF-046 — Delete item to Trash then restore

**Actor:** Owner · **Trigger:** Delete project/portfolio · **Decision refs:** UI-74,91,112  
**Precondition:** Owner and destructive confirmation

### Successful sequence

1. Revoke affected public route and verify result.
2. Move owner entity and referenced assets to private Trash, record deleted_at and purge_after=15 days.
3. List item/deadline/Restore and permanent-delete distinct controls.
4. On Restore recover supported records, preserve privacy flags and require re-publication.
5. On expiry purge primary data with reference-count safety.

### Failure, abuse, conflict and recovery

Route revocation fails: show incident; backup retention limits disclosed; no auto-republication. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** 15-day recoverable owner item, public access revoked.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-047"></a>

## WF-047 — Export and delete account

**Actor:** Owner · **Trigger:** Delete Account confirmation · **Decision refs:** UI-92,112  
**Precondition:** Reauthenticated owner with export option

### Successful sequence

1. List active public links, stored projects, portfolios, integrations and outstanding exports.
2. Offer portable export before irreversibility.
3. Explain account-access termination and independent erasure/backup/cache limitations.
4. Require explicit typed/specific confirmation and authoritative cleanup workflow.
5. Revoke public routes and sessions, record justified retention disclosures.

### Failure, abuse, conflict and recovery

Partial purge: report status/next action; never claim third-party archives erased. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** User access terminated and documented erasure process.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-048"></a>

## WF-048 — Global offline, quota and device fallback

**Actor:** All · **Trigger:** Network/quota/device failure · **Decision refs:** UI-44,55,65,85,95,103  
**Precondition:** Task may have local or server state

### Successful sequence

1. Show global online/degraded status without blocking unrelated work.
2. Show task-local error and last successful state.
3. Offer Retry, Compare, Keep Both, Export or Continue on supported device as valid.
4. Keep real glyph skeleton only while pending; replace error/empty promptly.
5. Announce in accessible status without repeated spam.

### Failure, abuse, conflict and recovery

Phone editor blocked with helpful path; cloud sync unavailable never labeled synced; data losses escalated. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Honest, non-destructive app fallback.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.
