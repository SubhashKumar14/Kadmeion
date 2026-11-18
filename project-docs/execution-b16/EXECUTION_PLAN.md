# One-day execution plan — 16 sessions, B16-v1

## Recommendation and constraint

Use 16 separate sessions with S0 coordinating and S15 exclusively integrating/releasing. Preserve S1–S6 instead of replacing their current work. Split only ownership that can be transferred safely; sixteen simultaneous writers to a few TSX files would slow the project down.

A guaranteed full P1+P2 implementation, all hosted/manual acceptance and final main merge within one day is not defensible from the remaining scope. This plan targets 24 elapsed hours from a recorded T0 and assigns all requirements; it does not silently shrink scope to fit. External provider/hosting permissions, the source-file budget, manual devices and production authorization can block full acceptance regardless of worker count. The target is aggressive completion; the fallback is an exact unfinished ledger, not a false DONE.

No 16-worker runtime has been started here. These are assignments for 16 user-launched chats/sessions; Notion does not wake them. Existing active sessions must hand off before their files are reassigned. The planning review made no code merge, branch change or hosted mutation.

## Worker allocation

| Session | Responsibility | Boundary |
|---|---|---|
| S0 | Coordinator, scope and dependency control | S0 |
| S1 | Backend contracts and private media | S1 |
| S2 | Profile and project workspace | S2 |
| S3 | Editor transactions and durable recovery | S3 |
| S4 | Release frontend and portable exports | S4 |
| S5 | Settings, notifications and account export | S5 |
| S6 | Independent frontend and journey acceptance | S6 |
| S7 | Editor panels, layout, themes and reuse | S3→S7 |
| S8 | Public identity, discovery and template surfaces | S2/S1→S8 |
| S9 | Public delivery and hosting verification | S4/S1→S9 |
| S10 | Goals, provider integrations and DevScore | S5/S1→S10 |
| S11 | Authentication, moderation and lifecycle | S5/S1→S11 |
| S12 | Consented portfolio analytics | NEW scoped files |
| S13 | Independent backend, security and contract QA | S6→S13 |
| S14 | Shared shell, approved design and accessibility | S0→S14 |
| S15 | Release integrator and main custodian | S0→S15 |

## Time plan (elapsed from T0, not promised durations)

| Window | Implementation and verification work | Exit/checkpoint |
|---|---|---|
| H0–H1 | S0/S15 inventory and lease transfer; S1–S6 checkpoint; S7–S14 read assigned specs and identify exact contracts. S0 creates logs, reserves files/migrations and routes budget/provider decisions. | B16_ACTIVE, no colliding owners, exact base/branch map, all worker startup ACKs. |
| H1–H4 | S15 stages existing feature groups; S1/S2 thumbnail, S3/S14 owner context, S4/S13 GET/HEAD, S5/S6 account tests. S8/S10/S11/S12 build independent agreed contracts/UI. | First combined candidate; no old work lost; contract C01–C03 stable and focused tests actually run. |
| H4–H8 | S1 general media/avatar; S2 profile/project gaps; S3 recovery/import; S7 layout/theme/components; S4/S8/S9 public journey; S5/S11 settings/lifecycle. S10/S12 P2 backend-first development proceeds concurrently. | Real owner-to-preview/media vertical slice; public host feasibility and exact remaining provider decisions resolved or marked blockers. |
| H8–H12 | Complete public identity/release and private editor/account capabilities; P2 provider/score and opt-in analytics implementation. S6/S13 continuously test ready slices; S14 visual/a11y repairs routed to owners. | Must-have success paths demonstrable on combined tree; published-host claims only if actual proof. |
| H12–H16 | Finish remaining scoped functionality and independent negatives; source/static/account import/export coverage; all 468 IDs reconciled, not necessarily accepted. | S0 critical-path review: explicit missing requirements and finish forecast. Reassign finished workers through new path leases, not pile onto monoliths. |
| H16–H20 | Combined regressions, visual/manual review, P2 acceptance, performance/privileged boundaries; S0 capstone/demo evidence. | No admitted feature without evidence; resolve critical failures and document external/manual blockers. |
| H20–H24 | Feature freeze, final fixes, exact prospective-main checks, provenance/requirement audit and concrete final PR/approval readiness. | Full completion only if all mandatory gates pass. Otherwise named incomplete scope and next actions; no deadline-driven weakening. |

## Fast critical path

Existing accepted security → current S1/S2 private media + current S3/S14 owner-context composition → verified editor/public frozen artifacts → S9 real delivery + S4 release UI + S8 visitor projection → independent S6/S13 acceptance → S15 prospective-main tree → concrete approval/merge verification.

In parallel: S5 account/export/notifications; S11 auth/moderation/lifecycle; S7 styling/layout/reuse; S10 provider/score/goals; S12 analytics; S14 shared visual/accessibility. Code against explicitly agreed types while dependencies are pending, but never label it live/complete until actual backend integration is tested.

## Throughput rules

- WIP limit: one primary feature and one independent fallback per worker. Break tasks into visible behavior, not 'audit all contracts again'.
- S15 admits dependency-coherent batches and allows useful CI runs to finish. Use focused tests for tiny follow-ups; rerun broad suites when integration risk changes, not for unchanged files.
- S0 routes questions at active checkpoints. Do not funnel every domain implementation into S1: S8/S9/S10/S11/S12 own their domain services after leases; S1 owns shared auth-port composition and reviews permissions/interfaces.
- Reserve unique new migration/module names before writing. Schema/domain workers can implement independent migrations; they cannot co-edit S1's current unapplied migration or historical migrations.
- When a worker finishes, lease a specific remaining file/test slice. S6/S13 assign independent acceptance work; no author self-signoff. Do not create endless speculative improvements beyond approved requirements.
- Old worker continuation prompts are superseded only for paths explicitly transferred. A new role name alone does not cancel pending original work.

## Decisions that can defeat the one-day target

1. File budget: original cap 200; integration currently 264 counted files, #28 candidate 265, CI justified variance only 64. S0 must present the exact unavoidable file delta and proposed bounded policy; S15 must not disable or disguise the check. Suggested proposal is up to 280 counted files for this completion run, reserving at most 15 above the current candidate (domain modules/migrations/independent tests); NOT approved by this plan. Use existing modules where sound, and itemize every proposed new file before asking. If the owner retains 200, substantial consolidation is a separate prerequisite, incompatible with claiming an effortless one-day finish.
2. Hosted enablement: appeal migration and candidate media migrations, email/OAuth, public host revocation/availability and ₹0 capability require actual approval/evidence. Readiness of a Vercel preview is not successful publication.
3. P2 policy: permitted provider data and approved score/analytics methodology must be specific. Unsupported providers use approved link-only fallback and retain sync limitation; no invented score formula or analytics tracking policy.
4. Manual review: native screen reader/zoom/physical tablet/owner visual acceptance cannot be automated by adding chats. Prepare exact review script and code while scheduling the necessary human review; no unperformed pass.

## Definition of done

Every in-scope required behavior implemented with actual backend/transactions; successful and failure paths accepted against exact IDs; no critical privacy/data-loss/auth bugs; combined tree green with required tests executed; visual/manual/hosted gates satisfied where required; complete migration/flags/operational disclosures; no missing unique worker/main change; one final tested main PR and actual authorized merge readback. P3 remains explicitly deferred. Academic documents describe real results, not planned features as finished.

## Premortem and mitigation

| Failure | Early warning | Mitigation/owner |
|---|---|---|
| More workers create merge collisions | Two agents edit portfolio-tools/growth/router | Exact lease transfer, S0 grants, S15 rejects foreign delta. |
| Existing features get rebuilt | New assignment still says thumbnails/templates absent | LATEST_STATE pinned source, inspect before coding; keep old commit provenance. |
| Test bottleneck hides regressions | Many green standalone PRs, red combined tree | S15 early composition + S6/S13 focused independent cases. |
| Day ends with a falsely complete main | Disabled primary actions counted done | Requirement ledger + S0/S6/S13 independent gates; explicit partial outcome. |
| Chat loss discards work | No branch/log since last long turn | Small capability commits, durable log, recovery prompt; no assumed wakeups. |
| Provider/budget blocks all workers | Everyone waits for S1 or approval | Surface exact decision early; work independent capabilities; do not bypass gate. |
| Wrong branch becomes final | Old candidate merged wholesale | S15 inclusion manifest, patch/ancestry verification, one candidate and one main PR. |
