# 02 Onboarding And Identity — Feature and Workflow Specifications

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

**Scope:** 4 end-to-end workflows. Each flow defines trigger, prerequisites, ordered behavior, failure/recovery and durable outcome; actions and data contracts remain proposed until implementation.

## Workflows in this group

- [WF-008: First-use welcome and skipping](#wf-008) — New owner
- [WF-009: Edit private profile and publish identity hub](#wf-009) — Owner
- [WF-010: Rename handle / public URL](#wf-010) — Owner
- [WF-011: Share profile and portfolio](#wf-011) — Author or visitor

<a id="wf-008"></a>

## WF-008 — First-use welcome and skipping

**Actor:** New owner · **Trigger:** First authenticated login · **Decision refs:** UI-23–25  
**Precondition:** Private account created

### Successful sequence

1. Render three clear choices Complete Profile, Create Portfolio, Connect Accounts.
2. Preserve signup name/handle without re-asking.
3. Allow Skip and resume later.
4. Maintain independently editable onboarding progress.
5. Enter dashboard without forcing GitHub or first project.

### Failure, abuse, conflict and recovery

Connection unavailable: skip works; partial setup: resume state; account suspended: block writes. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Onboarding state with no forced public exposure.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-009"></a>

## WF-009 — Edit private profile and publish identity hub

**Actor:** Owner · **Trigger:** Edit profile / Publish Profile · **Decision refs:** UI-24,27–28,87–88,108  
**Precondition:** Owner session and valid handle

### Successful sequence

1. Edit avatar/headline/bio/skills/links with private/public labels.
2. Autosave private fields with correct save-state.
3. Preview the public projection, excluding private data.
4. Select eligible fields and projects.
5. Explicitly confirm Publish Profile.
6. Validate public /u/:handle route and metadata before announcing visibility.

### Failure, abuse, conflict and recovery

Missing fields: do not invent; public route unavailable: keep Private; handle conflict: advise alternatives. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Published identity hub with selected fields only.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-010"></a>

## WF-010 — Rename handle / public URL

**Actor:** Owner · **Trigger:** Handle or slug update · **Decision refs:** UI-11,70,107  
**Precondition:** Identity handle/route ownership verified

### Successful sequence

1. Preview URL changes and check normalized reserved names.
2. Check uniqueness server-side and collect explicit impact acknowledgement.
3. Update canonical handle and route mapping with safe redirect plan.
4. Verify old/new URLs and private/tombstone semantics.
5. Update share metadata and show final results.

### Failure, abuse, conflict and recovery

Redirect host unsupported: block or require documented migration; collisions: no partial change. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** New verified canonical identity and nonleaking redirect behavior.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-011"></a>

## WF-011 — Share profile and portfolio

**Actor:** Author or visitor · **Trigger:** Share/Copy action · **Decision refs:** UI-35,71,108  
**Precondition:** Target release explicitly public/link accessible

### Successful sequence

1. Copy canonical URL or invoke native Share API where available.
2. Show actual title/description/author-approved preview image.
3. Preserve independent portfolio theme.
4. Never attach private account/email, DevScore or visitor identifiers.

### Failure, abuse, conflict and recovery

Clipboard/native share unsupported: offer text-copy; not-public: deny and explain without leaking draft. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Share action with true public destination.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.
