# Capstone Project Risk Register and Premortem

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

| Risk | Probability / impact (planning estimate) | Early signal | Mitigation / stop condition | Owner |
|---|---|---|---|---|
| Public JS sandbox escape | High consequence / P0 | iframe self-navigation, unexpected egress | Static-only public source; release blocked until hostile origin tests | Technical project lead |
| RLS leak | P0 | another user's foreign ID returns draft | Owner-scoped policies, direct negative API tests | Backend lead |
| Public unpublish fails | P0 | cached original route or raw asset remains reachable | Strong resolver, cache tests; don't claim revocation | Hosting lead |
| Email recovery cannot send free | P0 | Brevo sender/domain rejected | Verify before signup; if no legitimate free sender, demo restriction needs approval | Auth lead |
| Theme/code roundtrip corruption | P0 | layout swap modifies opaque files | One writer, before-image, golden bytes, Unplaced tray | Editor lead |
| Repository ingestion creeps into project model | P1 | source fetched/imported on entering URL | Treat repo/live URLs as links; manual project forms | Product lead |
| Template budget hard-coded | P1 | `maxTemplates=5` in schema/UI | Extensible catalogue, initial five content only | Editor lead |
| Free service quota exhaustion | P1 | HTTP 429, payment prompt, auto usage | Hard fail-closed quota; no automatic billing; ZIP fallback | Operations lead |
| External developer data misrepresented | P1 | provider blocks API, manual handle shown verified | Link-only fallback, data provenance, no public ranking | Growth lead |
| Auto website screenshot SSRF | P0 | private-IP capture, credential leak | No capture until safe renderer proof, upload fallback | Security lead |
| Accessibility fallback missing | P1 | drag-only operation or small-phone edit trap | Keyboard layer controls, WCAG tests, device block | UX lead |
| Immutable public release retains private project | P0 | project visibility off but older release still serves | Suspend affected live route until safe projection verified | Privacy lead |
| Admin role scope expands | P0 | operator can impersonate/edit user portfolio | Least privilege, notice/audit/appeal, 2-person review if warranted | Operations lead |
| Academic report contains invented results | P1 | passed tests/screenshots without code evidence | Report truthfully distinguishes planning and execution | Student author |

**Probability ratings are qualitative planning estimates, not measured forecasts.** Update this register when real engineering evidence arrives; each P0 includes a concrete halt/fallback action.
