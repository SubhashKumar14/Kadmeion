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

## B08 media implementation update (15 November 2026)

The private server-only `safe-png-publication.ts` implements bounded PNG validation, metadata stripping, scanline inflation and deterministic recompression, with regression tests and no paid dependencies. **It is not integrated into a public host or released media manifest.** Only non-interlaced 8-bit RGB/RGBA PNG is accepted. JPEG/WebP/AVIF, secure released asset addressing, content-hash verification at the public host, and actual revocation proof remain outstanding. D42 remains PARTIAL.

## 15 November 2026 B08/B09 progress (separate from hosted acceptance)

Source now implements a trusted owner-scoped private PNG read port, frozen HTML+sanitized image preview candidate, content-addressed media paths, immutable digest manifest, and offline static-media ZIP. The private media source `forTrustedFrozenMedia` checks owner RLS and write-once SHA-256 pins. It is NOT an approved public host, final template renderer or live media revocation. The existing 90-row statuses remain conservative.
The B09 partial-account export now has a local self-consistency verifier for stored hashes, asset bytes, owner table scoping and explicit incompleteness. It does NOT attest original provider authenticity and cannot authorize deletion.


## B07–B11 evidence through 15 November 2026

The 90-row register retains 49 partial, 3 missing, 2 externally blocked, 12 deferred and 24 non-applicable decisions. The status fields are for the whole decision. These code checks advance individual acceptance cases while the approved workflow and UAT rows retain their full-scenario status.

| Decisions and workflows | Local implementation and evidence | Remaining acceptance |
| --- | --- | --- |
| D42, D45, D74, D75 · WF-029, WF-031, WF-034, WF-036 · TP-03/04/06/07/08/12 | Frozen-layout PNG rendering and static ZIP, guarded private SQL candidate storage, exact-byte pre-withdrawal and canonical/direct GET/HEAD denial tests. [B08 CI](https://github.com/SubhashKumar14/Kadmeion/actions/runs/43697667628). | Media-aware public/reviewer delivery, production asset and route revocation, rollback, browser parity, and behavior during a Supabase outage. |
| D67, D72, D80 · UI-92/112 · WF-047 · TC-093/094/133 · TP-19 | Account portability remains bounded. Account erasure/Storage cleanup require the same exposure predicate. [B09 source and CI](https://github.com/SubhashKumar14/Kadmeion/commit/13c269a90ff89e9955252338e205c3abcd91600a). | Hosted disposable-owner cleanup/erasure, durable host acknowledgment, scheduler execution, complete export and retention disclosures. |
| D79, D89 · UI-03/07/08/12/13/14 · WF-001/002/004/005/006 · TC-001/003/007/009–012 · TP-01/09 | Local Auth and recovery, ambiguity and account-switch guards, provider errors and GoTrue/Mailpit integration wired into CI. [Auth change](https://github.com/SubhashKumar14/Kadmeion/commit/b05314154a5534f748e1924a68fd40c27bd30e87). | Approved hosted signup/confirmation settings, Google OAuth, authenticated Brevo sender, delivery/resend and production abuse limits. |

The current hosted database has 47 of the 49 branch migration versions, and all three baseline Edge Functions are deployed. The two new migrations stay on the feature branch pending owner authorization. B07 baseline rollout was verified separately. See [hosted baseline evidence](B07_HOSTED_DEPLOYMENT_EVIDENCE.md). The 115 UI decisions, 53 workflows, 138 UAT cases, and 20 proof entries remain distinct requirements. Source findings in the table do not certify 52 approved screens or live production acceptance.
