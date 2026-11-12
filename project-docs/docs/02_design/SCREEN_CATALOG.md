# Kadmeion — Complete Screen and Route Inventory

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

**Source reconciliation:** supersedes the earlier 31-item inventory. This register contains separate pages, reusable editor panels, dialog/sheet flows, read-only share routes, and system exceptions. Route paths except the owner-selected public identity/case-study patterns are **candidates**, not granted URL reservations.

| ID | Screen | Route / surface | Actor | Planned phase | Spec |
|---|---|---|---|---|---|
| PUB-01 | Landing | `/` | Public | P1 | [PUB-01](screens/pub_01_landing.md) |
| PUB-02 | Explore portfolios | `/explore` | Public | P1 | [PUB-02](screens/pub_02_explore_portfolios.md) |
| PUB-03 | Public template explorer | `/templates` | Public | P1 | [PUB-03](screens/pub_03_public_template_explorer.md) |
| AUTH-01 | Sign in | `/signin` | Guest | P1 | [AUTH-01](screens/auth_01_sign_in.md) |
| AUTH-02 | Sign up | `/signup` | Guest | P1 | [AUTH-02](screens/auth_02_sign_up.md) |
| AUTH-03 | OAuth callback | `/auth/callback` | Auth return | P1 | [AUTH-03](screens/auth_03_oauth_callback.md) |
| AUTH-04 | Password recovery request | `/forgot-password` | Guest | P1 | [AUTH-04](screens/auth_04_password_recovery_request.md) |
| AUTH-05 | Password reset | `/reset-password` | Reset-session | P1 | [AUTH-05](screens/auth_05_password_reset.md) |
| AUTH-06 | Recovery outcome | `/auth/recovery-status` | Guest | P1 | [AUTH-06](screens/auth_06_recovery_outcome.md) |
| WORK-01 | Welcome and onboarding | `/app/onboarding` | Owner | P1 | [WORK-01](screens/work_01_welcome_and_onboarding.md) |
| WORK-02 | Workspace home | `/app` | Owner | P1 | [WORK-02](screens/work_02_workspace_home.md) |
| WORK-03 | Developer profile editor | `/app/profile` | Owner | P1 | [WORK-03](screens/work_03_developer_profile_editor.md) |
| WORK-04 | Project library | `/app/projects` | Owner | P1 | [WORK-04](screens/work_04_project_library.md) |
| WORK-05 | Project quick add drawer | `/app/projects (drawer)` | Owner | P1 | [WORK-05](screens/work_05_project_quick_add_drawer.md) |
| WORK-06 | Project detailed editor | `/app/projects/:id` | Owner | P1 | [WORK-06](screens/work_06_project_detailed_editor.md) |
| WORK-07 | Owned portfolio library | `/app/portfolios` | Owner | P1 | [WORK-07](screens/work_07_owned_portfolio_library.md) |
| WORK-08 | Template choice/new portfolio | `/app/portfolios/new` | Owner | P1 | [WORK-08](screens/work_08_template_choice_new_portfolio.md) |
| EDIT-01 | Portfolio editor workbench | `/app/portfolios/:id/edit` | Qualified owner device | P1 | [EDIT-01](screens/edit_01_portfolio_editor_workbench.md) |
| EDIT-02 | Content inspector | `Editor panel Content` | Qualified owner device | P1 | [EDIT-02](screens/edit_02_content_inspector.md) |
| EDIT-03 | Components and sections | `Editor panel Components` | Qualified owner device | P1 | [EDIT-03](screens/edit_03_components_and_sections.md) |
| EDIT-04 | My Components | `Editor panel My Components` | Qualified owner device | P1 | [EDIT-04](screens/edit_04_my_components.md) |
| EDIT-05 | Theme and responsive inspector | `Editor panel Theme` | Qualified owner device | P1 | [EDIT-05](screens/edit_05_theme_and_responsive_inspector.md) |
| EDIT-06 | Asset manager | `Editor panel Assets` | Qualified owner device | P1 | [EDIT-06](screens/edit_06_asset_manager.md) |
| EDIT-07 | Advanced source | `Editor panel Source` | Qualified owner device | P1 | [EDIT-07](screens/edit_07_advanced_source.md) |
| EDIT-08 | Revision history and Problems | `Editor bottom drawer` | Qualified owner device | P1 | [EDIT-08](screens/edit_08_revision_history_and_problems.md) |
| EDIT-09 | Preview modes | `/app/portfolios/:id/preview` | Owner | P1 | [EDIT-09](screens/edit_09_preview_modes.md) |
| PUBLISH-01 | Reviewer staging | `/app/portfolios/:id/staging` | Owner | P1 | [PUBLISH-01](screens/publish_01_reviewer_staging.md) |
| PUBLISH-02 | Reviewer-only preview | `/r/:token` | Token viewer | P1 | [PUBLISH-02](screens/publish_02_reviewer_only_preview.md) |
| PUBLISH-03 | Publish preflight | `/app/portfolios/:id/publish` | Owner | P1 | [PUBLISH-03](screens/publish_03_publish_preflight.md) |
| PUBLISH-04 | Releases and rollback | `/app/portfolios/:id/releases` | Owner | P1 | [PUBLISH-04](screens/publish_04_releases_and_rollback.md) |
| PUBLIC-01 | Developer identity hub | `/u/:handle` | Public if explicitly enabled | P1 | [PUBLIC-01](screens/public_01_developer_identity_hub.md) |
| PUBLIC-02 | Published case study | `/u/:handle/projects/:projectSlug` | Public if enabled | P1 | [PUBLIC-02](screens/public_02_published_case_study.md) |
| PUBLIC-03 | Published portfolio | `/:username/:portfolioSlug (conditional)` | Public/Unlisted/Private by delivery rule | P1 | [PUBLIC-03](screens/public_03_published_portfolio.md) |
| PUBLIC-04 | Public share controls | `Portfolio/profile share UI` | Author/visitor | P1 | [PUBLIC-04](screens/public_04_public_share_controls.md) |
| GROWTH-01 | Personal Growth hub | `/app/growth` | Owner | P2 | [GROWTH-01](screens/growth_01_personal_growth_hub.md) |
| GROWTH-02 | Developer Activity | `/app/growth/activity` | Owner | P2 | [GROWTH-02](screens/growth_02_developer_activity.md) |
| GROWTH-03 | Private DevScore | `/app/growth/devscore` | Owner | P2 | [GROWTH-03](screens/growth_03_private_devscore.md) |
| GROWTH-04 | Goals | `/app/growth/goals` | Owner | P2 | [GROWTH-04](screens/growth_04_goals.md) |
| GROWTH-05 | Portfolio analytics | `/app/analytics` | Owner, opted-in portfolio | P2 | [GROWTH-05](screens/growth_05_portfolio_analytics.md) |
| GROWTH-06 | Platform connections | `/app/integrations` | Owner | P2 | [GROWTH-06](screens/growth_06_platform_connections.md) |
| SET-01 | Settings hub | `/app/settings` | Owner | P1 | [SET-01](screens/set_01_settings_hub.md) |
| SET-02 | Privacy & sharing | `/app/settings/privacy` | Owner | P1 | [SET-02](screens/set_02_privacy_sharing.md) |
| SET-03 | Notifications | `/app/notifications` | Owner | P1 core / P2 expansion | [SET-03](screens/set_03_notifications.md) |
| SET-04 | Account security | `/app/settings/security` | Owner | P1 | [SET-04](screens/set_04_account_security.md) |
| SET-05 | Trash | `/app/trash` | Owner | P1 | [SET-05](screens/set_05_trash.md) |
| SET-06 | Export center | `/app/export` | Owner | P1 | [SET-06](screens/set_06_export_center.md) |
| SET-07 | Account exit | `/app/settings/account/delete` | Owner | P1 | [SET-07](screens/set_07_account_exit.md) |
| OPS-01 | Admin users | `/app/operations/users` | Authorized restricted admin | P1 | [OPS-01](screens/ops_01_admin_users.md) |
| OPS-02 | Portfolio moderation | `/app/operations/moderation` | Authorized restricted admin | P1 | [OPS-02](screens/ops_02_portfolio_moderation.md) |
| OPS-03 | Appeals and case history | `/app/operations/appeals` | Authorized restricted admin | P1 | [OPS-03](screens/ops_03_appeals_and_case_history.md) |
| SYS-01 | Not found/private/expired/offline | `Status and error screens` | All relevant actors | P1 | [SYS-01](screens/sys_01_not_found_private_expired_offline.md) |
| SYS-02 | Unsupported authoring device | `/app/unsupported-editor (candidate)` | Signed-in phone or ineligible device | P1 | [SYS-02](screens/sys_02_unsupported_authoring_device.md) |

## Route collision rules

- Owner-selected profile routes: `/u/:handle`, `/u/:handle/projects/:projectSlug` (UI-107). The `u` namespace and all app/auth/status prefixes are reserved.
- Proposed portfolio path `/:username/:portfolioSlug` remains hostname/host-feasibility-gated; prevent collisions with `app`, `signin`, `signup`, `auth`, `u`, `r`, `templates`, etc. Never assume domain availability.
- Private page returns a privacy-preserving 404 or appropriate denial; unpublish/delete revocation requires host-level direct-route and immutable-asset tests.
- `/app/projects/new` from old screens is superseded as default by Quick Add drawer (UI-40); a deep-linkable full editor is still proposed.
- Earlier mobile editor route is superseded by a view-only/continue-on-supported-device state (UI-44/55/103).
- Published portfolios are independent of the public developer hub and can have author-selected theme (UI-27/35).

## Coverage contract

Each per-screen file includes actors, sections, primary action, data/privacy, full state matrix, responsive/accessibility behavior and six acceptance checks. They are **test plans**, not passing tests.
