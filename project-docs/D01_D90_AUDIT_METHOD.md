# Kadmeion D01–D90 backend traceability — initial evidence ledger

**Recorded:** 15 November 2026. **Source:** private Library `DECISION_REGISTER.md` (normalized user-selected decisions, 11 Nov 2026), cross-referenced with the [D01–D90 Notion handoff](https://app.notion.com/p/416b082297c781b2b6b1ec116ab4bb9e) and current repository tree.

This ledger carries **exactly 90 individual normalized decision summaries**, not an invented verbatim original interview. The historical source itself says older answers may be superseded. Later owner amendments and `project-docs` Phase 1/2/3 boundaries control active requirements.

It does **not** certify 90/90 feature completion. A path means only that the file exists; a test path means only that a matching suite exists, **not** that the full decision was proved, nor that hosted/visual/public behavior passed. Every non-superseded Phase 1 item is conservatively marked PARTIAL, MISSING, or BLOCKED_EXTERNAL until atomic negative and end-to-end acceptance evidence is reconciled.

| Initial status | Decisions |
|---|---:|
| PARTIAL | 49 |
| NOT_APPLICABLE | 24 |
| BLOCKED_EXTERNAL | 2 |
| DEFERRED_APPROVED | 12 |
| MISSING | 3 |
| **Total** | **90** |

**Needed for closure:** review each row against specific source lines, tests and 53 workflows; change to `IMPLEMENTED_AND_TESTED` only with real per-decision checks and live proofs where required. The 115 later UI decisions are separate. The 138 planned UAT cases and 20 proof gates remain independent. Do not infer any requirement is complete merely because it is covered by the 392 Node tests and database CI.

**Dominant pending mechanisms:** final public media and revocation (D10,D20,D42,D72,D74,D75), safe code sandbox (D11,D16,D34,D39), full export/retention (D67,D80), Brevo SMTP (D79), quotas/hosted signup (D89), and reusable source/editor parity (D90). These are requirements to implement/prove, not deferrals.

The included source and test paths were checked against the feature branch tree on 15 Nov 2026. For the current execution checkpoint, see [Notion B07–B11 execution record](https://app.notion.com/p/419b082297c781db810cd756ec0343eb).
