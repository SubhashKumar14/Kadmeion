# 01 Authentication — Feature and Workflow Specifications

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

**Scope:** 7 end-to-end workflows. Each flow defines trigger, prerequisites, ordered behavior, failure/recovery and durable outcome; actions and data contracts remain proposed until implementation.

## Workflows in this group

- [WF-001: Email/password sign-in](#wf-001) — Guest
- [WF-002: Register developer with handle](#wf-002) — Guest
- [WF-003: Switch sign-in and signup panels](#wf-003) — Guest
- [WF-004: Google OAuth with safe callback](#wf-004) — Guest
- [WF-005: Request password recovery](#wf-005) — Guest
- [WF-006: Reset password using link](#wf-006) — Guest with one-use reset grant
- [WF-007: Manage email verification badges](#wf-007) — Owner

<a id="wf-001"></a>

## WF-001 — Email/password sign-in

**Actor:** Guest · **Trigger:** Email/password submitted · **Decision refs:** UI-01–05,09–10,15  
**Precondition:** Guest is not already authenticated

### Successful sequence

1. Present labeled fields and optional Google action.
2. Validate required inputs without enumerating an account.
3. Disable repeat submit and use an in-button glyph pending cue.
4. Call Supabase Auth only after selected provider is available.
5. Verify returned session, clear transient passwords on navigation.
6. Restore only allowlisted intended destination or enter workspace.

### Failure, abuse, conflict and recovery

Invalid credentials: contextual form error and recovery link; rate limit: truthful retry; network loss: preserve entered email until exit. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Authenticated user session and safe redirect.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-002"></a>

## WF-002 — Register developer with handle

**Actor:** Guest · **Trigger:** Sign-up submit · **Decision refs:** UI-06,11–12,108  
**Precondition:** Public signup within approved quota

### Successful sequence

1. Collect display name, unique public handle, email, password and confirmation.
2. Debounce handle lookup and show candidate availability.
3. Submit final normalized handle to authoritative uniqueness check.
4. Create Auth identity and owner profile transactionally or recover partial failure.
5. Default public hub, all projects and analytics to Private/disabled.
6. Proceed to three-choice welcome, with no mandatory email verification badge.

### Failure, abuse, conflict and recovery

Handle race: offer alternatives; email exists: privacy-safe message; delivery failure: do not claim sent; duplicate submission: idempotent create. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Private account, initial profile and onboarding.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-003"></a>

## WF-003 — Switch sign-in and signup panels

**Actor:** Guest · **Trigger:** User selects alternate auth mode · **Decision refs:** UI-01–02,04–05,10,15  
**Precondition:** Authentication shell mounted

### Successful sequence

1. Keep both forms and field values in session memory, including passwords until navigation.
2. Move K panel between sides in 280–320ms, fade short content transition.
3. Reverse animation from current position upon rapid reactivation.
4. Remove inactive controls from tab sequence and move focus to active heading/first field.
5. Use mobile directional crossfade or reduced-motion immediate/fade.
6. Use route replacement or local state to avoid extra history entry.

### Failure, abuse, conflict and recovery

Interrupted transition: no focus trap; resize during animation: settle to active form; navigation ends: clear password buffers. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** One accessible active authentication form.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-004"></a>

## WF-004 — Google OAuth with safe callback

**Actor:** Guest · **Trigger:** Google sign-in selected · **Decision refs:** UI-03,08,14  
**Precondition:** Provider enabled and redirect URI allowlisted

### Successful sequence

1. Record intended local return destination without unsanitized open-redirect URL.
2. Leave page for provider consent.
3. On return, verify state/session through supported Auth callback.
4. Check onboarding completeness, not merely identity email.
5. Direct newcomer to welcome or established user to allowlisted destination.
6. Discard temporary transaction state and announce result.

### Failure, abuse, conflict and recovery

Cancel/provider failure/replayed callback: return sign-in with recoverable error; same email identity: Supabase-supported verified identity behavior, no arbitrary custom merge. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Owner session only after confirmed callback.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-005"></a>

## WF-005 — Request password recovery

**Actor:** Guest · **Trigger:** Forgot Password action · **Decision refs:** UI-03,07,13  
**Precondition:** Configured Brevo/Supabase sending proven before public release

### Successful sequence

1. Show dedicated Aether Drift request form.
2. Validate email format; rate-limit requests.
3. Submit Supabase reset request without account existence disclosure.
4. Show neutral confirmation only on accepted request.
5. Provide resend after permitted cooldown and safe return to sign-in.

### Failure, abuse, conflict and recovery

SMTP not configured or failed: report cannot send; quota: no fake confirmation; account enumeration prohibited. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Recovery challenge issued only if service confirms.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-006"></a>

## WF-006 — Reset password using link

**Actor:** Guest with one-use reset grant · **Trigger:** Valid reset link opened · **Decision refs:** UI-07,13,94  
**Precondition:** Reset grant valid and not consumed

### Successful sequence

1. Validate reset grant and route.
2. Collect new password and confirmation with private visibility toggle.
3. Submit supported Auth password update.
4. Invalidate reset privilege according to provider behavior.
5. Show dedicated success screen with Return to Sign In.

### Failure, abuse, conflict and recovery

Expired/reused link: explanatory state and resend; provider outage: do not clear unsent typed data or claim success. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Updated credential and explicit sign-in path.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-007"></a>

## WF-007 — Manage email verification badges

**Actor:** Owner · **Trigger:** Account email verification state changes · **Decision refs:** UI-12,94  
**Precondition:** Trusted Auth verification state query

### Successful sequence

1. Expose email status privately in Security settings.
2. Render public verified badge only upon positive provider confirmation.
3. Never render an unverified badge or imply project/repository verification.
4. Handle stale Auth claims and session refresh correctly.

### Failure, abuse, conflict and recovery

Unknown verification status: no public badge, settings shows status pending/unavailable. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Positive-only badge tied to actual email ownership verification.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.
