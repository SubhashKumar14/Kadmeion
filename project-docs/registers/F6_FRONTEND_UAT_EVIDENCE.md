# F06 frontend UAT evidence

This log maps specific observed checks to the original [138-case register](TEST_CASES.csv). `PASS_ISOLATED` applies to the stated test environment and exact scenario below. `PARTIAL` records a tested subset and its remaining requirement. Cases without an entry still need an individually reviewed evidence link. Product-owner sign-off and hosted acceptance remain open.

| Case | Result | Tested evidence | Remaining scope |
|---|---|---|---|
| TC-001 | PASS_ISOLATED | Password authentication in GoTrue returns the owner to their private workspace and opens its saved routes. | — |
| TC-003 | PARTIAL | Browser registers a fresh handle, opens the private workspace without an email confirmation step, then signs out and signs back in. | Inspect initial profile and onboarding state for the new handle. |
| TC-005 | PASS_ISOLATED | Public browser switches between sign-in and sign-up, verifies the active form and returns to the initial form. | — |
| TC-007 | PARTIAL | Browser strips callback credentials and reports a neutral failure without a verified provider. | Real configured Google OAuth round trip. |
| TC-009 | PARTIAL | Isolated GoTrue recovery request and Mailpit message with a local verification link. | Real sender and inbox delivery. |
| TC-010 | PASS_ISOLATED | Unconfigured recovery control is disabled and the unavailable state appears next to it. | — |
| TC-011 | PARTIAL | Isolated GoTrue accepts the one-time link and replaces the password. | Hosted provider verification. |
| TC-016 | PARTIAL | Owner uses arrow keys to change onboarding selection, skips the selected step and verifies persistence after reload. | Repeat with a provider outage. |
| TC-017 | PARTIAL | Owner saves private profile draft edits, reads them back and confirms stale-session protections. | Published identity hub with selected fields. |
| TC-023 | PASS_ISOLATED | Quick-add creates a private project with an editable private slug and opens the saved record. | — |
| TC-027 | PASS_ISOLATED | Owner adds and saves a case-study section and reads back its title and body after reload. | — |
| TC-036 | PASS_ISOLATED | Chromium phone and touch-only landscape block editor and creation controls while offering a private continuation path. | — |
| TC-037 | PARTIAL | Owner edits managed inspector content, applies owned source and verifies saved draft values after reload. | All writer paths and conflict combinations. |
| TC-041 | PARTIAL | Owner selects a slot with the keyboard, filters for compatible components and adds a heading to the slot. | Pointer drag and keyboard reordering parity. |
| TC-057 | PARTIAL | Owner selects a saved revision, freezes it for private staging and reads its pinned state after navigation. | Hosted reviewer link and independent read-only delivery. |
| TC-060 | PASS_ISOLATED | Missing SEO metadata blocks release preflight and links to the owner editor. | — |
| TC-074 | PASS_ISOLATED | Owner persists a public handle as a private link. UI reports that its provider sync and ownership are unavailable. | — |
| TC-080 | PASS_ISOLATED | Growth and DevScore report insufficient evidence without rendering a composite number. | — |
| TC-091 | PARTIAL | Owner confirms move to private Trash and restores the record before expiry. | Independent public-host withdrawal. |
| TC-093 | PARTIAL | Owner downloads recovery data, reauthenticates, records and withdraws the request, and can separately withdraw app-managed content. | End-to-end final erasure and retention proof. |
| TC-096 | PASS_ISOLATED | Touch-only viewport denies authoring, permits the private preview, and offers the correct continuation URL. | — |
| TC-097 | PARTIAL | Verified operator reads the isolated case and records a decision through the scoped UI. | Account restriction and restoration on the hosted application. |
| TC-098 | PARTIAL | Regular owner is blocked from all three restricted operations routes and from the case evidence RPC. | Missing-justification acceptance in the browser. |
| TC-103 | PARTIAL | Owner submits an appeal, non-operator evidence RPC returns 403, operator records a case-scoped decision, and owner reads it back. | Hosted restoration and verified delivery of notices. |
| TC-107 | PARTIAL | Browser verifies a second owner cannot read the private project and portfolio draft under the first owner’s route context. | Hosted direct API and Storage role matrix. |
| TC-120 | PARTIAL | Browser retains the dummy password across auth-mode switches, checks cookies, browser storage and URL, and verifies reload clears it. | Full logging and telemetry audit. |
| TC-121 | PARTIAL | Operator views are scoped to a case and lack owner impersonation and content editing controls. | Unauthorized write and audit acceptance for every operator role. |
| TC-123 | PASS_ISOLATED | A 390-pixel Chromium phone viewport blocks editor access and displays supported-device continuation. | — |
| TC-126 | PARTIAL | Browser asserts manual carousel steps and pause. Behavior tests cover hover, focus, reduced motion and a hidden tab. | A timed browser assertion for the seven-second cadence. |
| TC-127 | PARTIAL | Chromium keyboard navigation verifies skip links, auth focus, history tabs, and scrolling inside the current revision preview. | Manual screen-reader walkthrough of complete auth and editor tasks. |
| TC-128 | PARTIAL | Public and auth shells reflow across the configured desktop-to-320 CSS-pixel width set. | Manual desktop browser zoom and complete public/published states. |
| TC-129 | PARTIAL | Phone public shells start light with fresh preferences. The private author preview reads its author theme independently. | Independent hosted published portfolio rendering. |
| TC-131 | PASS_ISOLATED | Authenticated Growth screen reports insufficient evidence and exposes no invented numeric score. | — |
| TC-132 | PARTIAL | Owner restores before deadline. In a stale open tab, the real RPC denies restore once the isolated fixture expires. The disabled state survives reload. | Verified hosted purge scheduling and independent public delivery checks. |
| TC-136 | PARTIAL | The actor sees scoped case evidence. A regular owner sees no operator navigation and receives an RPC 403. | Review field minimization in every hosted operator view. |
| TC-138 | PARTIAL | Browser checks original vector assets and readable wordmark across both runtime themes. | Full-size visual fidelity comparison of emblem and pattern. |

Test sources are [public Chromium](../../apps/frontend/e2e/public.spec.ts), [authenticated owner/operator Chromium](../../apps/frontend/e2e/owner.spec.ts) and [authenticated settings Chromium](../../apps/frontend/e2e/settings-owner.spec.ts). The [screen evidence](F6_FRONTEND_ACCEPTANCE_EVIDENCE.md) and [implementation handoff](../NEXT_SESSION_HANDOFF.md) identify exact source revisions, workflow runs and the review still open.

## Workflow cross-reference

The [53-workflow register](WORKFLOWS.csv) remains the specification. “Review needed” means this pass assigned no case evidence to the workflow. A linked case provides evidence for its own scope.

| Workflow | Documented journey | Isolated pass | Partial evidence |
|---|---|---|---|
| WF-001 | Email/password sign-in | TC-001 | — |
| WF-002 | Register developer with handle | — | TC-003 |
| WF-003 | Switch sign-in and signup panels | TC-005 | TC-120, TC-127 |
| WF-004 | Google OAuth with safe callback | — | TC-007 |
| WF-005 | Request password recovery | TC-010 | TC-009 |
| WF-006 | Reset password using link | — | TC-011 |
| WF-007 | Manage email verification badges | — | Review needed |
| WF-008 | First-use welcome and skipping | — | TC-016 |
| WF-009 | Edit private profile and publish identity hub | — | TC-017 |
| WF-010 | Rename handle / public URL | — | Review needed |
| WF-011 | Share profile and portfolio | — | TC-126, TC-138 |
| WF-012 | Quick-add project (no repository import) | TC-023 | — |
| WF-013 | Create/replace website preview thumbnail | — | Review needed |
| WF-014 | Edit detailed project case study | TC-027 | — |
| WF-015 | Choose where each project is public | — | Review needed |
| WF-016 | Open public project destinations | — | TC-128 |
| WF-017 | Search, sort and filter project library | — | Review needed |
| WF-018 | Create portfolio from preset or Blank | TC-036, TC-123 | — |
| WF-019 | Edit content with one transactional writer | — | TC-037 |
| WF-020 | Delete component into EMPTY slot and Undo | — | Review needed |
| WF-021 | Add/drag/reorder compatible component | — | TC-041, TC-127 |
| WF-022 | Protected swap of S1/S2 owned source | — | Review needed |
| WF-023 | Change section layout / reorder | — | Review needed |
| WF-024 | Edit tiered theme tokens | — | Review needed |
| WF-025 | Make and reuse My Component | — | Review needed |
| WF-026 | Preview, edit invalid source and recover | — | Review needed |
| WF-027 | Recover conflicting tabs/local-folder changes | — | Review needed |
| WF-028 | Author Preview vs Preview as Published | — | TC-128, TC-129 |
| WF-029 | Create expiring reviewer link | — | TC-057 |
| WF-030 | Run publication preflight | TC-060 | — |
| WF-031 | Build immutable release and verify live route | — | Review needed |
| WF-032 | Edit after publishing and republish | — | Review needed |
| WF-033 | Rollback a release | — | Review needed |
| WF-034 | Unpublish, visibility and delete | — | Review needed |
| WF-035 | Change published URL / SEO metadata | — | Review needed |
| WF-036 | Portable export and provider outage | — | Review needed |
| WF-037 | Connect a public platform handle | TC-074 | — |
| WF-038 | Manually sync/handle stale data | — | Review needed |
| WF-039 | Enable and inspect aggregate analytics | — | Review needed |
| WF-040 | Explain private DevScore | TC-080, TC-131 | — |
| WF-041 | Create and update personal goal | — | Review needed |
| WF-042 | Disconnect platform and delete imported facts | — | Review needed |
| WF-043 | Edit account/profile and privacy | — | Review needed |
| WF-044 | Manage active sessions and login methods | — | Review needed |
| WF-045 | Read actionable notifications | — | Review needed |
| WF-046 | Delete item to Trash then restore | — | TC-091, TC-132 |
| WF-047 | Export and delete account | — | TC-093 |
| WF-048 | Global offline, quota and device fallback | TC-096 | — |
| WF-049 | Review user and restrict/restore access | — | TC-097, TC-098, TC-121 |
| WF-050 | Report abusive public portfolio | — | TC-136 |
| WF-051 | Temporarily unpublish abusive public release | — | Review needed |
| WF-052 | Process appeal and restore permitted content | — | TC-103 |
| WF-053 | Defer advanced administration/AI | — | Review needed |

## Technical proof scope

The [20 technical proof requirements](TECHNICAL_PROOFS.csv) set the acceptance conditions. The [backend evidence](TECHNICAL_PROOFS_BACKEND_EVIDENCE_2026-11-15.csv) records existing contract and integration coverage. The browser run adds the following evidence. Hosted or manual conditions remain open.

| Proof | Isolated frontend evidence | Verification still needed |
|---|---|---|
| TP-01 | GoTrue signup, one-time password reset and Mailpit delivery. | Verified production sender and real recipient domains. |
| TP-02 | Two authenticated owners exercise denied access to each other's project and portfolio. | Hosted negative API and Storage matrix. |
| TP-03 | An eligible owner downloads a scriptless private preview ZIP whose archived HTML digest matches. | Independent anonymous host response during database unavailability. |
| TP-06 | Private uploader rejects a truncated PNG and processes an allowed fixture through isolated Storage. | Complete archive/media fuzz and unsafe-input combinations. |
| TP-07 | Owner creates and revokes a private grant. The public reviewer route fails closed. | Reviewer URL replay, cache and expiry on the actual host. |
| TP-09 | New password account opens private workspace with immediate signup enabled. | Hosted abuse, throttling and truthful badge states. |
| TP-10 | Original identity assets are delivered and the wordmark is readable in both runtime themes. | Full-size comparison and font licensing evidence. |
| TP-11 | Owner saves managed editor content and reads the same stored revision after reload. | Full state corpus and concurrent writer UAT. |
| TP-12 | Browser distinguishes author preview, saved simulation and pinned private release preflight. | Preview-to-hosted output parity with actual assets. |
| TP-13 | Phone and touch-only landscape authoring restrictions offer a private continuation link. | Physical keyboard-capable tablet matrix. |
| TP-15 | Saved developer handle remains link-only when the provider is unavailable. | Each approved provider's current terms, data access and failure cases. |
| TP-17 | Automated accessibility scans across all screen IDs, keyboard smoke checks, reduced motion and sampled CSS viewport reflow. | Human contrast/focus review, native browser zoom, assistive technology and full critical journeys. |
| TP-19 | Trash restores before expiry and denies stale restores after the cutoff. Account exit records a request and displays its scope. | Hosted retention and physical erasure through all provider copies. |
| TP-20 | DevScore suppresses a composite on insufficient fixture evidence. | Complete versioned metric corpus and fairness acceptance. |
