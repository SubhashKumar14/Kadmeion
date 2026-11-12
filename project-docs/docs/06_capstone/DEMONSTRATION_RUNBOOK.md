# Capstone Demonstration Runbook (Pre-Implementation)

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

The following is a **future demonstration script**, not a description of a working build.

## Prepare safe demo fixtures

Set up two disposable developer accounts, one reviewer token, one restricted operator account, one trusted preset, one Blank portfolio, two synthetic projects (one without a repository), media with checked license and a static ZIP that can be opened independently. No real personal secrets or fake testimonials. Verify active free plan and no billing settings.

## Script when implementation actually passes gates

1. Open Kadmeion public landing on desktop; switch light/dark and demonstrate the three product panels (7-second progression, manual pause).
2. Create an account with unique handle; show two-panel auth motion and email/password recovery only if real Brevo delivery test passed.
3. Choose Create Portfolio from the three-action welcome screen. Show first-use Empty dashboard and private profile.
4. Quick-add private project with live link, optional repo and manual screenshot. Demonstrate folder card and case-study modules; no imported repository contents.
5. Choose Blank, add a section, add a compatible component, change text, delete into EMPTY and Undo; show saved revision and protected owned source on S2 swap.
6. Change global font roles and scoped card color via CSS variables; compare phone preview while editor remains enabled only on supported device.
7. Author Preview vs Preview as Published. Show static behavior for unsupported user JavaScript and explain the trust boundary.
8. Create short-lived staging link; demonstrate expiry/revocation at direct URL, not just hidden UI, if host token proof passed.
9. Preflight and publish a safe static release; show visitor HTTP + JS-off page and confirm release hash and public route. Rollback and unpublish only if real host revocation tests passed.
10. Open public `/u/:handle` and one public case-study route, verify only selected projects visible. Show private profile/project controls.
11. Open Trash with 15-day deletion countdown, Restore without auto-republish; show guided account-exit without actually deleting a student account unless explicitly desired.
12. Demonstrate restricted admin user report/temporary takedown and appeal only in disposable fixture, with audit and no editing of user's content.
13. Phase 2 if built: show permitted link-based platform card, valid/stale source, optional private DevScore/goals and per-portfolio aggregate analytics opt-in.
14. End with independently opening the static export ZIP, showing project file tree and `NOT_SUPPORTED` feature disclaimers rather than pretending real functions.

## Failure simulation (valuable for technical review)

Intentional second-tab conflict, invalid custom source preserving stale preview, denied third-party URL screenshot, quota limit, expired reviewer token and network disconnection should each result in a truthful recovery or export action. Document which simulations are truly implemented and which remain planned.
