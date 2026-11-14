# Cross-Screen Design QA and Final Sign-off Checklist

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

## Visual/source integrity

- [ ] Original angular K silhouette correctly reproduced from authorized master asset, not a generic new logo.
- [ ] Approved Aether Drift C palette and sparse Phase B pattern compared to original image references; exact swatches measured before encoding.
- [ ] Editorial/productivity/code typography hierarchy verified against original references and licensing; no unsupported font selection.
- [ ] Public landing appears Aether Drift light initially and theme manual persistence works; user published portfolio theme stays independent.
- [ ] Icons share known stroke/size/meaning; bespoke icons limited to Kadmeion concepts and glyph-loader language.
- [ ] Hero sections use approved compositions; real software/project imagery or clearly identified illustrative previews, not fake social proof.

## UI states and behavior

- [ ] Auth 280–320 ms reversible panel slide, instant press, focus and in-memory password retention; phone crossfade, reduced motion.
- [ ] Hero demo rotates about 7s with manual controls, pause and reduced-motion non-cycling alternative.
- [ ] True glyph-shaped text skeletons match pending final content footprint; no fake progress or unneeded waits.
- [ ] Every screen and reusable panel has loading, empty, failed, success, unauthorized, offline and quota behavior where applicable.
- [ ] Status label explicitly differentiates draft/local folder/cloud/staged/live and stale preview.
- [ ] Component slots and owned code protect user content, allow Undo and keyboard placement.
- [ ] Profile/project/private/public exposure and analytics default OFF/Private are clear and independently confirmed.
- [ ] Project cards offer separate Live/Repository links and optional capture fallback, not code import.
- [ ] Publish preflight blockers/warnings/pass, staging expiry/revoke, live verification, rollback and Trash logic clearly distinct.
- [ ] Narrow admin controls cannot impersonate, browse private source by default or edit users' portfolio content.

## Accessibility and device constraints

- [ ] Every critical screen has keyboard/SR acceptance including shortcuts, error focus, Escape/return and 200% zoom.
- [ ] Phone portfolio/code editing blocked with an actionable supported-device alternative; mobile view/share remain.
- [ ] Qualified large-tablet full editor proven before enabling feature flag.
- [ ] Loading/reduced-motion and hero auto-cycling honor accessibility preferences without trapping input.

## Documentation/technical gate integrity

- [ ] Every UI-001–115 decision appears once in authority registry; newer overrides supersede older sources.
- [ ] Every 52 screen specs and 53 workflows links to a route/API/data/test family; new routes not passed off as explicitly owner approved.
- [ ] Required technical proof P0 gates and ₹0 limits are recorded honestly; no fabricated browser/email/live-host results.
- [ ] All proposed code paths in repository tree remain proposed; no application source was created by this documentation package.
- [ ] Capstone diagrams/references/report draft are labeled proposed, with no fabricated study results or test passing.

**QA status of this document package:** formatting/index/link checks are run by generated-package validator. **No application UX or code tests were run.**
