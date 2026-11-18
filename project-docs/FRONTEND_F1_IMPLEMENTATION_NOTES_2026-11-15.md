## 16 November 2026 — F1 implementation and browser verification

- **Scope:** One phase per response. F1 screens 01–11 received a full implementation and comparison pass on [PR #3](https://github.com/SubhashKumar14/Kadmeion/pull/3). Verified code SHA [`f78fee91ef99dad330dac05647d6c61a330b6816`](https://github.com/SubhashKumar14/Kadmeion/commit/f78fee91ef99dad330dac05647d6c61a330b6816).
- **Code and decisions:** Use the approved mark and wordmark in the light/dark runtime shells. Improve public composition, reversible auth layout, skip-link focus and reduced-motion behavior. Bind password updates to the active session before the provider call. Preserve mobile sign-out and owner access controls. Use real glyph-text loading, recovery guidance and private recent-work links. Explore stays illustrative pending public delivery proof. Signup takes a candidate handle and does not expose private account presence through guest availability queries.
- **CI at the exact code SHA:** [Frontend #112](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43819836296) success, 16 public Chromium tests. [Application and Database #855](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43819836277) success, 504 root tests, 511 pgTAP assertions and all three isolated Chromium scenarios. Both typechecks, frontend build and production dependency audits passed. Existing Vite ineffective dynamic import warning and 261/200 source-file variance recorded. Hosted inspection matched 57 migration versions and three active Edge Functions.
- **Design review:** 11/11 source PNG hashes and matching viewport captures compared. All references were retained. The 06 capture uses the actual shared recovery-verification screen. Hosted Google OAuth and Brevo inbox proof, visual parity, full accessibility and owner UAT remain open. No production promotion or hosted configuration changes were made.
- **Next phase F2:** Review and hash originals 12–17, starting with WORK-03 profile edit and privacy preview. Exercise the owner draft update and stale revision path before working through project create/edit, quick add, portfolio library and template choice. Keep F1 visual and provider gaps visible in the source register for acceptance.

### Visual comparison

Mean absolute RGB channel error on the 0–255 scale against each approved LIGHT source. Lower is closer. The historical 07–09 captures used a different viewport, and 06, 08 and 09 showed different auth states. These measurements support layout review and do not certify parity.

| Screen | Route surface | F0 capture | F1 capture | Captured state |
| --- | --- | ---: | ---: | --- |
| 01 | Landing | 29.53 | 28.66 | Public browser capture. |
| 02 | Explore portfolios | 30.85 | 25.12 | Public browser capture. |
| 03 | Public template explorer | 20.55 | 19.27 | Public browser capture. |
| 04 | Sign in | 25.06 | 16.45 | Unconfigured capture. Verified owner sign-in tested with isolated GoTrue. |
| 05 | Sign up | 23.45 | 19.69 | Registration shows the delivery gate in the public capture. |
| 06 | OAuth callback | 32.21 | 27.43 | Shared verification UI while a real recovery grant is checked. F0 captured an error. |
| 07 | Password recovery request | 21.89 | 17.85 | Public capture shows the delivery gate. The isolated browser submitted a real recovery request. |
| 08 | Password reset | 23.18 | 20.63 | Verified recovery grant. F0 captured an invalid or absent grant. |
| 09 | Recovery outcome | 24.18 | 24.91 | Real local recovery request outcome. F0 captured direct neutral status. |
| 10 | Welcome & onboarding | 16.06 | 13.45 | Isolated owner. Keyboard choice and persisted skip tested. |
| 11 | Workspace home | 17.14 | 13.83 | Isolated owner. 390 px reflow, mobile sign-out access, and restricted route denials tested. |

### Implementation chronology

- `a3bb334` introduced shared keyboard, responsive, auth and workspace corrections and isolated GoTrue/Mailpit browser coverage.
- `e8bf6ee` waits for React to mount the skip target before the first Tab. Public Chromium passed, and the local recovery flow passed. The authenticated mobile run exposed a horizontal overflow.
- `38f9f95` constrained the mobile account header and owner email and exposed recovery retry. Both CI workflows passed.
- `f78fee9` refined shared callback and recovery composition and grouped authentic recent work with next-step controls. Both same-SHA workflows passed. The isolated browser changed a password and then signed in with the new credential.

---

## 15 November 2026 — Historical implementation notes

# Kadmeion frontend F1 — audited React/Vite implementation (15 Nov 2026)

## Source and approval status
- **Chosen implementation branch:** `feat/b0-backend-foundation` (PR #1), never the older Node26 hardening branch; default `main` unchanged.
- User explicitly approved all **52 original LIGHT reference PNGs** and **12 Canva branding pages** `DAHazlXd9Vs`. Screen #26 MUST be `26_EDIT-09_Fullscreen_Portfolio_Only_REVISION_LIGHT.png`. No dark mockups are approved; runtime light/dark UI themes are allowed.
- Original layered-K/vector outlined-wordmark master is not yet programmatically exportable via available Canva connector tools. **Text-only fallback does not mean branding parity**; no artificial K vector is claimed as approved master.
- These are implemented **code slices, not user-accepted pixels or live public portfolio content**.

## Framework versions
Node **26.13.1**, npm **12.2.2**, React/ReactDOM **19.3.1**, Vite **8.3.8**, `@vitejs/plugin-react` **6.3.0**, TypeScript **7.0.2**, Playwright **1.65.1**, exact versions pinned in `apps/frontend/package.json`, real npm-generated `apps/frontend/package-lock.json`. `.github/workflows/frontend.yml` runs clean install, TS7 typecheck, Node assertions, Vite build, production dependency audit, Chromium E2E and screenshot capture. No remote browser or paid subscription.

## Implemented / tested paths
- `/` LIGHT 01 — public landing, theme persistence, semantic FAQ, accessible 3-view demo with manual pause/next, reduced motion.
- `/explore` LIGHT 02 — illustrative showcase and searchable/faceted sample cards; **not actual published identity records**.
- `/templates` LIGHT 03 — 5 reference-informed preset visuals, filtering, native dialog, keyboard/Escape/focus restoration; neither live portfolio renderer nor a claim of production template equivalence.
- `/signin`, `/signup`, `/auth/callback`, `/forgot-password`, `/reset-password`, `/auth/outcome`, gated `/workspace` — AUTH 01–06 route UX anchored in original tested Supabase AuthService and browser port, not a parallel backend. Provider email/Google flag defaults OFF; code accepts real public Supabase URL and publishable key only. Denies privileged browser keys before Vite public compilation, scrubs callback secrets promptly, retains transient fields on reversible form switch; no fake provider delivery or completed workspace claim.
- No new database migration, hosted mutation or `vercel.json` public deployment.

## Verified evidence
- [Latest fully green frontend CI (code SHA `018b076340ea`)](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43724070706): TypeScript 7 typecheck, Node tests, Vite production build, Playwright **9/9 PASS**, npm audit production **0 vulnerabilities**.
- Last green full backend/contracts/database [CI #43722567250](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43722567250) was at older SHA `b79fac8f`; latest root CI may still be processing and needs independent check.
- Approved originals vs real Chrome 1534×960 screenshots (from #43723733530) SSIM and mean RGB absolute error: 01 0.6238 / 30.66, 02 0.6131 / 34.00, 03 0.6481 / 27.38, 04 0.7464 / 21.25, 05 0.7033 / 36.97. **Visual fidelity FAIL / not accepted**; screen 05 capture predates overlap fix, so remeasure newest code. No end-to-end real sender/Google Auth proof or comprehensive screen-reader acceptance. F0 partial, F1 partial, F2–F6 open.
- File-budget over proposed 200 is explicitly documented, exceptions remain **pending owner approval**.

## Exact next coding objective
Recover high-resolution original K and outlined wordmark masters; compare fresh updated screenshots 01–09 with approved PNGs, repair visual mismatches without replacing owner designs; wire real onboarding/authorized workspace screens 10–11 to private Supabase contracts with negative E2E tests and true empty/loading/error states; continue into F2–F6 in small CI-backed commits. Protect strict ₹0; do not merge `main`, deploy to production or enable public release before separate authorizations.
