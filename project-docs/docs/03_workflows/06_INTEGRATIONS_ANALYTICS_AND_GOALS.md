# 06 Integrations Analytics And Goals — Feature and Workflow Specifications

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

**Scope:** 6 end-to-end workflows. Each flow defines trigger, prerequisites, ordered behavior, failure/recovery and durable outcome; actions and data contracts remain proposed until implementation.

## Workflows in this group

- [WF-037: Connect a public platform handle](#wf-037) — Owner
- [WF-038: Manually sync/handle stale data](#wf-038) — Owner
- [WF-039: Enable and inspect aggregate analytics](#wf-039) — Owner
- [WF-040: Explain private DevScore](#wf-040) — Owner
- [WF-041: Create and update personal goal](#wf-041) — Owner
- [WF-042: Disconnect platform and delete imported facts](#wf-042) — Owner

<a id="wf-037"></a>

## WF-037 — Connect a public platform handle

**Actor:** Owner · **Trigger:** Enter GitHub/other public handle · **Decision refs:** UI-77–79,89  
**Precondition:** P2 provider independently verified as permitted

### Successful sequence

1. Choose GitHub/LeetCode/Codeforces/HackerRank/Kaggle/Hugging Face.
2. Validate handle text and lookup public profile through approved documented free endpoint.
3. Show candidate identity/source, user confirms correct profile.
4. Store handle/link private and retrieve available metrics on explicit Sync.
5. Display sync time/provenance/limits and per-provider visibility choices.

### Failure, abuse, conflict and recovery

Unverified API/terms: link-only; provider match is not ownership proof; no scraping circumvention or invented data. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Optional public handle plus truthful supported metrics.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-038"></a>

## WF-038 — Manually sync/handle stale data

**Actor:** Owner · **Trigger:** Sync Now · **Decision refs:** UI-77–79,85,89  
**Precondition:** P2 connection exists and provider free allowance available

### Successful sequence

1. Check per-provider allowed rate/fields.
2. Request public data and retain raw-source provenance/refresh timestamp.
3. Update provider card and optional unified timeline only after success.
4. Mark stale/partial with last known timestamp and offer retry cooldown.
5. Notify if meaningful failure, not spam.

### Failure, abuse, conflict and recovery

429/captcha/blocked: stop retry, no evasion, keep link-only; never fake metrics or hidden OAuth. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Traceable current/last-good provider facts.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-039"></a>

## WF-039 — Enable and inspect aggregate analytics

**Actor:** Owner · **Trigger:** Enable portfolio analytics · **Decision refs:** UI-80–81,115  
**Precondition:** P2 portfolio successfully published; analytics OFF initially

### Successful sequence

1. Show consent/privacy summary and portfolio-specific Enable action.
2. Start collecting allowed aggregate views/referrer buckets from that point forward, no persistent visitor ID.
3. Render accessible charts and companion tables with date filter.
4. Allow disable with disclosed handling of existing aggregates and retention.

### Failure, abuse, conflict and recovery

Disabled: no collection; bot/low sample: label uncertainty; disconnected delivery: stale status. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Opt-in portfolio aggregate statistics only.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-040"></a>

## WF-040 — Explain private DevScore

**Actor:** Owner · **Trigger:** Open DevScore · **Decision refs:** UI-82–83  
**Precondition:** P2 sufficient source/categorical evidence

### Successful sequence

1. Show category score, data source, last updated and algorithm version.
2. Compute composite only where comparable coverage threshold is satisfied.
3. Explain quality/missingness and improvement suggestions without ranking people.
4. Let user review source categories and report corrections.

### Failure, abuse, conflict and recovery

Insufficient coverage: no invented composite; unsupported source: exclude, do not penalize as zero. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Private explainable, noncompetitive growth aid.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-041"></a>

## WF-041 — Create and update personal goal

**Actor:** Owner · **Trigger:** Create Goal · **Decision refs:** UI-24,84–85  
**Precondition:** P2 signed-in owner

### Successful sequence

1. Choose free-form target or template with owner-edited milestones/dates.
2. Save as private goal and show progress history.
3. Allow manual updates distinctly labeled from verified provider-derived progress.
4. Use safe mobile editing where suitable; no leaderboard.
5. Support Undo/correction and delete.

### Failure, abuse, conflict and recovery

Offline: preserve draft; source disconnected: mark dependent milestone stale, never overwrite manual progress. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** User-owned private goal with provenance.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.

<a id="wf-042"></a>

## WF-042 — Disconnect platform and delete imported facts

**Actor:** Owner · **Trigger:** Disconnect · **Decision refs:** UI-79,89  
**Precondition:** P2 connection belongs to owner

### Successful sequence

1. Show linked handle and imported-data count/retention consequences.
2. Select delete imported data as default; explicit alternative only if permitted.
3. Revoke actual authorization if any exists; remove sync scheduling.
4. Update private/public projections to avoid leaked stale metrics.
5. Confirm completed only after store acknowledgement.

### Failure, abuse, conflict and recovery

External token revoke failure: report partial; historical published static fact revocation needs separate release handling. If an operation has not been durably acknowledged, show pending/failed rather than success; prevent duplicated destructive writes with validated operation IDs where necessary.

### Postcondition and acceptance

- **Required durable outcome:** Disconnected provider and disclosed data state.
- Test authenticated ownership and direct route/API access, not just button visibility.
- Test empty/loading/invalid/expired/quota/offline conditions and ensure user data remains recoverable.
- Test keyboard flow, visible focus and screen-reader announcement; reduced motion must preserve usability.
