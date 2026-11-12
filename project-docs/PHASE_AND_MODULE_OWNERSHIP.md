# Kadmeion — Phase and Module Ownership Matrix

This matrix describes the **proposed future repo**, not files already implemented. Refer to [FULL_REPOSITORY_FILE_MANIFEST.csv](FULL_REPOSITORY_FILE_MANIFEST.csv) for each named file and phase.

| Phase | Workstreams | Exit condition | Excluded until proved |
| --- | --- | --- | --- |
| 1 | Auth/Supabase/Brevo validation; profiles/projects; transactional editor; five presets/eight layouts; public release/export; narrow user/moderation | Auth RLS + error flows; lossless editor transactions; genuine static publication and rollback; accessibility critical journeys | Arbitrary custom JS publication, unsupported snapshotting, paid services |
| 2 | Six optional handle providers, private DevScore/goals, opt-in aggregate analytics | Source provenance, legal/API permission, accurate missing data, privacy and quota tests | Unsupported scraping/captcha bypass, public leaderboard |
| 3 | Optional bounded AI helper and advanced admin activity/analytics dashboard | Explicit owner scope approval plus free-limit/privacy/security testing | Paid API, unapproved admin permissions, automated publication |

**Architecture rules:** Every privileged action is checked at the Supabase RLS/Edge layer. Local editor actions are transactional via one core. The public release is immutable and separately served only after the hosting/cache security proof; UI status reflects actual state. The code budget stays ≤200 files unless owner approves a change. The documentation package is real; named code paths in the tree are proposals.

**Scope warning:** Phase 3 advanced admin UI and a corresponding scoped aggregate endpoint have *conditional, explicitly named* future paths, but are not authorized to implement. Extending audit exploration beyond that initial scope requires independent approval and may require a code-budget revision. The optional AI helper Edge Function is separately enumerated and gated.
