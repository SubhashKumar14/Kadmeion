# Kadmeion — All Feature Workflows (Sign-in → Restricted Admin)

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

The source-of-truth workflow inventory is [`registers/WORKFLOWS.csv`](../../registers/WORKFLOWS.csv). The order is intentional: every major user task from authentication through restricted administration is represented. Each domain file includes ordered actions, error paths and acceptance checks.

| Domain | Workflows | File |
|---|---:|---|
| Auth | 7 | [01_AUTHENTICATION](./01_AUTHENTICATION.md) |
| Identity | 4 | [02_ONBOARDING_AND_IDENTITY](./02_ONBOARDING_AND_IDENTITY.md) |
| Project | 6 | [03_PROJECTS_AND_CASE_STUDIES](./03_PROJECTS_AND_CASE_STUDIES.md) |
| Editor | 10 | [04_EDITOR_AND_COMPONENTS](./04_EDITOR_AND_COMPONENTS.md) |
| Publish | 9 | [05_STAGING_PUBLISH_AND_EXPORT](./05_STAGING_PUBLISH_AND_EXPORT.md) |
| Growth | 6 | [06_INTEGRATIONS_ANALYTICS_AND_GOALS](./06_INTEGRATIONS_ANALYTICS_AND_GOALS.md) |
| Settings | 6 | [07_SETTINGS_RECOVERY_AND_DELETION](./07_SETTINGS_RECOVERY_AND_DELETION.md) |
| Admin | 5 | [08_ADMINISTRATION_AND_MODERATION](./08_ADMINISTRATION_AND_MODERATION.md) |

**Important:** “Documented” does not mean implemented. Phase 2/3 features remain requirements with deferred delivery; all security-critical checks are gates. This catalogue contains both simple owner tasks and administrative exception flows.
