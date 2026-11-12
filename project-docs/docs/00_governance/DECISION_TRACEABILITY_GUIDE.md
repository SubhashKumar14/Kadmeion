# UI Decision Traceability and Status

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

There are **115 owner selections**, UI-001 to UI-115, with one row per ID in `registers/DECISIONS_UI_001_115.csv`. UI-062 was initially open in D2, **then expressly approved as A in E1**. Repeated G1 selections were verified and not treated as 10 extra decisions.

## Trace paths

`Decision ID` → [`design.md`](../../design.md) rule → `Screen ID` in [`SCREENS.csv`](../../registers/SCREENS.csv) → `Workflow ID` in [`WORKFLOWS.csv`](../../registers/WORKFLOWS.csv) → logical API/data/rights contract → [`TEST_CASES.csv`](../../registers/TEST_CASES.csv). Every generated test starts NOT_RUN; every screen/workflow NOT_IMPLEMENTED.

- Decisions are **design requirements**, not evidence of real app behavior.
- Source-derived details and suggested field names are separately `[PROPOSED]` until validated.
- Approved phase placement does not mean the owner has authorized building or deploying any phase.
- New discovered host impossibilities must be recorded in technical proof register, with a reversible fallback. Only a material product-scope deviation needs another owner approval.

### Governance check for PR/release (future)

For changed code, link relevant UI IDs and workflow(s), describe affect on responsive/accessibility/security and test evidence, and update risk register. If a user-approved decision changes, record the superseding owner message and date before adopting any different behavior.
