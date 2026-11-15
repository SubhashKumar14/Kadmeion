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
