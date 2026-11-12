# Kadmeion — Application File-Count Policy (Revised Handoff v3)

**Governing owner instruction (12 November 2026): documentation files are not project source files and MUST NOT be included in the application tree or source-file count.**

- **200 proposed authored application source/configuration/test files** are explicitly named in `FULL_REPOSITORY_FILE_MANIFEST.csv` and `FULL_REPOSITORY_FILE_TREE.txt`. No source is implemented yet in this documentation-only handoff.
- **0 documentation files** count toward the 200-file application baseline, even when a `project-docs/` folder exists in the GitHub repository for AI continuity.
- **0 generated assets, node_modules, build caches, ZIPs, screenshots, database-generated types, vendor binaries, or lockfile changes not authored by project developers** count as application source, unless specifically tracked as authored configuration; planned authored lockfiles/config do count where included in the enumerated 200.
- An eventual `LICENSE` is **not included in the 200-file plan**. Its contents require actual owner rights review; do not auto-pick a license for third-party assets.
- **The old `333` number is obsolete**. It was a mixed documentation + source + proposed legal-file count and must not appear as a count of project code files. The original v2 report remains under `sources/HISTORICAL_V2_333_PATH_COUNT_SUPERSEDED.md` for provenance only.
- This is a **planned limit, not an assertion about the live Git tree**. Count actual authored application files with `git ls-files` and a documented inclusion/exclusion rule each milestone. Never combine security-sensitive or unrelated modules to game the limit; request an owner budget change if genuinely necessary.

## Source plan by layer

- **BUILDER_UI: 6**
- **CONTRACTS: 7**
- **DELIVERY: 6**
- **EDITOR_CORE: 13**
- **PORTFOLIO_KIT: 16**
- **PUBLISHER: 7**
- **ROOT_CONFIG: 12**
- **SCRIPTS: 3**
- **SHARED_UI: 2**
- **STORAGE_ADAPTERS: 6**
- **SUPABASE_BACKEND: 13**
- **SUPABASE_CONFIG: 1**
- **SUPABASE_DB: 8**
- **SUPABASE_TESTS: 2**
- **TESTS: 12**
- **WEB_APP_SETUP: 9**
- **WEB_CLIENT: 3**
- **WEB_DESIGN_SYSTEM: 7**
- **WEB_DOMAIN_ACTIONS: 9**
- **WEB_SCREENS: 53**
- **WEB_SHELLS: 5**

## Source plan by phase

- **P1: 183**
- **P2: 14**
- **P3: 3**
