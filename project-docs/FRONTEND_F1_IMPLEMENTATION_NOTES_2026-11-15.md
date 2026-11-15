# Frontend F1 implementation notes (15 November 2026)

This isolated React 19.3.1 + Vite 8.3.8 + TypeScript 7.0.2 package is NOT connected to the default Vercel deployment; the existing Vercel auth preview remains unchanged. Node >=26.13.1 and npm 12.2.2 are required. No payment, production promotion, provider setup, public portfolio release, or owner-data read is performed by this page.

## Current scope
- Landing LIGHT reference `01_PUB-01_Landing_LIGHT_APPROVED.png`: coded as responsive, semantic HTML/CSS with a concept demo explicitly labeled as *illustrative*, not real private user data or verified portfolio statistics.
- Light/dark runtime with local preference and storage-denied fallback; published portfolio themes do not inherit this global app theme.
- Manual hero demo navigation, 7-second auto cycle only while visible/idle and not reduced-motion; pause, keyboard and native FAQ controls.
- Links: auth CTA points to `/signin` which is served only by the existing auth preview when correctly routed; `/explore`, `/templates` require subsequent F1 implementations. This standalone build is an unpromoted implementation slice, not a production site.

## Dependencies and reproducibility
Only exact stable npm versions pinned in `apps/frontend/package.json`:
React/React DOM 19.3.1; Vite 8.3.8; `@vitejs/plugin-react` 6.3.0; TypeScript 7.0.2; `@types/react` 19.3.0 and `@types/react-dom` 19.3.0; `@types/node` 26.6.6.
Use GitHub `Frontend React 19 + Vite 8 verification` to resolve a reproducible lockfile in a networked Node 26 CI runner; this environment has no npm-registry DNS. Only commit the lockfile after builds/tests pass; do not forge integrity hashes or label local builds run without execution.

## Acceptance still open
The approved visual image is distinct from browser DOM fidelity. No Playwright screenshot diff, mobile cross-browser, screen reader or full WCAG 2.2 AA acceptance yet. Real public portfolio queries, branding vector masters from Canva, auth routing and independently revocable release host still need integration and authorization.
