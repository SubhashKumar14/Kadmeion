# Kadmeion — Exact Proposed Repository File Count

**All files in the future repository are individually named in** [`FULL_REPOSITORY_FILE_TREE.txt`](FULL_REPOSITORY_FILE_TREE.txt) **and** [`FULL_REPOSITORY_FILE_MANIFEST.csv`](FULL_REPOSITORY_FILE_MANIFEST.csv). No wildcards, omitted files, or unexpanded source folders.

**CRITICAL:** This is a proposed future repository—not a claim that these code files exist or that these features are tested.

## Verified counts from the enumerated manifest

- **200 proposed source/configuration/test files** across Phase 1, Phase 2 and Phase 3, counted against the historical **≤200** source/config cap.
- **132 documentation and reference files in this created v2 documentation package**, including text files, CSV registers, source copies, reference images, and this report. These are **not executable application source**.
- **1 planned policy/legal file**: `LICENSE` is deliberately NOT created or populated pending owner rights/licensing approval.
- **333 total planned repository file paths** = 200 + 132 + 1.
- **52 exact screen/panel spec → future `.tsx` source mappings**.
- **200 unique code/config/test file paths** and **333 unique future repo paths**, zero duplicates.
- **0 remaining source/config/test-file budget headroom** under the historical cap (any expansion requires a budget review; do not merge security-sensitive modules merely to game the number).

## Source/config/test breakdown by layer

| Layer | Planned files |
| --- | --- |
| BUILDER_UI | 6 |
| CONTRACTS | 7 |
| DELIVERY | 6 |
| EDITOR_CORE | 13 |
| PORTFOLIO_KIT | 16 |
| PUBLISHER | 7 |
| ROOT_CONFIG | 12 |
| SCRIPTS | 3 |
| SHARED_UI | 2 |
| STORAGE_ADAPTERS | 6 |
| SUPABASE_BACKEND | 13 |
| SUPABASE_CONFIG | 1 |
| SUPABASE_DB | 8 |
| SUPABASE_TESTS | 2 |
| TESTS | 12 |
| WEB_APP_SETUP | 9 |
| WEB_CLIENT | 3 |
| WEB_DESIGN_SYSTEM | 7 |
| WEB_DOMAIN_ACTIONS | 9 |
| WEB_SCREENS | 53 |
| WEB_SHELLS | 5 |


## Source/config/test breakdown by planned phase

| Phase | Planned files |
| --- | --- |
| P1 | 183 |
| P2 | 14 |
| P3 | 3 |


**Counting policy:** Source budget includes `.tsx`, `.ts`, `.js/.mjs`, package and tool configurations, SQL migrations/tests, Edge Functions, CI YAML, lockfiles, HTML and CSS. Test files **do count**. User-generated project files, transient build outputs, caches, `node_modules`, screenshots and vendor dependencies are **excluded** because they are not authored repository source. The 3 existing reference images are documentation assets and are counted under the documentary package. The standalone future `LICENSE` is included in the total proposed tree but not in the source cap, because it requires separate approval.

**Scope caveat:** The count is exact for this **enumerated proposed design**, not a promise that a real implementation will need precisely the same filenames. New code files must update the manifest and pass the cap gate; if security or maintainability requires >200, obtain owner approval before changing the target rather than packing unsafe monoliths.

**Actual implemented application code files created by this task: 0.** The documentation bundle consists of real files, but the `apps/`, `packages/`, `supabase/`, `delivery/`, `tests/`, `scripts/` and root configuration paths shown in the future tree are manifest entries, not created code files.
