# F0 — Verified source and readiness audit (16 November 2026)

**F0 gate: source/readiness audit and reproducible checks.** This is not a claim that F1–F6 screens, production, accessibility or user acceptance are complete.

## Verified inputs

- Starting feature branch: `feat/b0-backend-foundation` at `3336ce251b8e78783574df9a20ce2580e7455f2b`; open PR #3. Earlier PR #1 was already merged; no current feature-branch merge authorization implied.
- Live read-only Supabase: **57/57 hosted migration versions equal 57 repository migration SQL version identifiers**. Three hosted Edge Functions `publish`, `complete-private-asset`, `purge-expired-trash` report ACTIVE. Data/policy functionality and public revocation remain separate proof requirements.
- Original owner-approved ChatGPT Library screen sets: **6/6 ZIP CRC checks PASS** and actual byte-level SHA-256 prefix check **52/52 canonical LIGHT PNGs PASS**. Three supplemental PNGs are excluded. The revised fullscreen screen #26 is the one selected in the register.
- Inspected all 52 original screen compositions using four contact sheets and checked **52/52 linked Markdown spec files** in the GitHub tree. The new CI verifier checks each actual spec file headings, authorization/state/action and planning trace.
- Canva design `DAHazlXd9Vs`: fetched all 12 pages' textual contents and design metadata. All seven design families are owner-approved for appropriate use; the original K/wordmark remain primary. Repo holds mark, wordmark, and open-folio SVGs. Other exact Canva vector family exports cannot be confirmed through this read-only connector and must not be fabricated.
- `SCREENS.csv` retains historic SPECIFICATION_ONLY values, while newer implementation/visual evidence is in `APPROVED_LIGHT_52_SCREENS_2026-11-15.csv`. The new matrix avoids conflating either with completed UAT.
- Last source budget record: **261/200** authored app/config/test files. Not a passed file-budget limit.

## Implemented and enforced

- `scripts/verify-f0-source-contract.mjs` checks the 52-source index, route/actor/primary-action catalog, each spec body and owner-decision headings, source-code trace paths, original logo masters and 52-row [F0 screen source mapping](registers/F0_SCREEN_SOURCE_MATRIX_2026-11-16.md). It fails on unsynced acceptance statuses, screenshots or authority collisions.
- `npm run verify:f0` is an actual root npm command; GitHub Application/Database CI now runs it after the existing approved-LIGHT checksum-register verifier.
- Exact PNG bytes are **not** committed to GitHub: a separate local SHA check was run against the six actual Library archives. CI's register check does not claim to have rehashed those unavailable originals.

## Open gates, not blockers to a completed source audit

F1 public/auth/workspace source implementation, F2 owner CRUD isolation, F3 editor full source coverage, F4 authenticated publish/revocation, F5 settings and operations, and F6 52-screen visual + accessibility + 53 workflow + 138 UAT + 20 proof acceptance remain **unaccepted**. Public/CDN GET/HEAD revocation, hosted provider erasure, Brevo manual tests, the 46 historical authenticated-definer warnings, and source-budget variance require separate resolutions. No paid dependency, migration replay, hosted mutation, main merge or production promotion performed.

**Next phase:** F1 foundation and approved screens 01–11, with real screenshot comparison at reference viewport, mobile/light-dark and keyboard/auth failure tests. Do not invent example owner data, developer ratings or released public URLs.
