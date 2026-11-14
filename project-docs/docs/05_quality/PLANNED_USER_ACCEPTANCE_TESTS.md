# Planned User Acceptance Test Scenarios

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

These scenarios provide a capstone demonstration **plan**, not actual participant/test results.

| UAT | Real user objective | Acceptance observation |
|---|---|---|
| UAT-01 | Register with name and unique handle, toggle forms, sign in | Preserved inputs/focus, correct errors and new account private |
| UAT-02 | Add a non-GitHub project with live link and uploaded thumbnail | Private project appears immediately; folder card opens Live link and optional Repo link |
| UAT-03 | Create Blank portfolio and add sections with keyboard-only navigation | Slots compatible, draggable+keyboard equivalents, Undo restores exact content |
| UAT-04 | Customize component code and attempt protected replacement | Impact list, Keep/Stash/Cancel, owned source preserved |
| UAT-05 | Change one component's color and typography without changing whole theme | Scoped CSS token override reflected in preview/static output |
| UAT-06 | Produce static export and open offline | HTML/assets valid without live Kadmeion or client JS dependency |
| UAT-07 | Stage private revision, expire/revoke reviewer link | Pinned view available before expiry and inaccessible afterward |
| UAT-08 | Publish and later roll back a portfolio | Draft/live distinction, verified public version and revision history preserved |
| UAT-09 | Revoke project and developer public profile visibility | Private fields absent, old public routes do not leak selected content |
| UAT-10 | Delete project and restore before 15 days | Public access does not automatically resume; recovered private project remains intact |
| UAT-11 | Open portfolio on phone and attempt editing | Visitor page responsive; authoring blocked with supported-device explanation |
| UAT-12 | Try restricted operator abuse takedown and appeal | Only authorized role can act, notice/audit created, no impersonation/edit |
| UAT-13 | Optionally sync a public handle and inspect DevScore (P2) | Source/freshness/caveats shown, no invented score when insufficient evidence |
| UAT-14 | Disable/enable portfolio analytics (P2) | No collection until explicit opt-in, accurate aggregated view afterward |

Record participant consent, environment, observed difficulty, task outcome and improvement action only after actual human testing. Do not insert fictional satisfaction scores.
