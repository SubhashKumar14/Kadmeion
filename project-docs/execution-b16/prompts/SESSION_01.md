# Session 1 — Backend contracts and private media

Paste MASTER_PROMPT.md first (or attach the complete kit), then this assignment. Do not operate from this assignment alone without current authority/ownership.

Run: 20261117-7232a31 / B16-v1. Shared plan: https://app.notion.com/p/41bb082297c781948335e8728d512fa9
Branch: work/20261117-7232a31/s1-private-assets
Log: https://app.notion.com/p/41ab082297c781048ae8e1aed99469a1
Primary workflow leads: Cross-cutting acceptance/integration; exact scope in requirements ledger.
Mission: Finish and verify #28; general owner-private editor media and standalone profile-avatar lifecycle; typed API composition.

## First actions

Preserve #28 d3fcc31. Corrected thumbnail migration already passed isolated SQL; current contracts fail budget, and logged publish heading failure remains distinct. Do not recreate existing thumbnail APIs, typed export limits or goal CAS/cursor. Give S2/S5/S10 exact contracts and compose with their consumers under S15.

## Implementation / work sequence

Implement general editor private asset byte-read/attestation interfaces, not project-thumbnail-only API reuse. Complete standalone avatar storage registration/owner binding/validation/limits/replacement and export/erasure reconciliation without a dummy project. Maintain auth epoch guards, shared supabase-auth-port.ts composition and distinct typed denial/transient/quota errors. Review domain workers’ additive contracts; reserve unique new migration paths through S0. Preserve backwards compatibility and verify existing endpoints before adding new ones.

## Exit evidence

S13 proves owner/anon/foreign/project/byte/CAS/idempotency/permission negatives; S6 proves actual S2/S3 consumer readback. No source-only media/public claims. Transfer private-goals-service.ts to S10 and private-account-data-export.ts to S5 only after the #28 checkpoint is integrated or explicitly preserved in the new base.

## Required reads and dependencies

Read MASTER_PROMPT.md, LATEST_STATE.md, EXECUTION_PLAN.md, FILE_OWNERSHIP.csv, WORKFLOW_BACKLOG.csv, REQUIREMENT_LEDGER.csv, CONTRACT_QUEUE.csv and COORDINATION_PROTOCOL.md. Read every named source file you edit, its direct contracts/tests, the workflow/screen specification linked by the reference index and the relevant engineering/quality docs. Read S0/S15 and dependency logs before each handoff. Do not reread all 165 documents each cycle; verify updated applicable sources.

The following complete proposed path list is an ownership index, not an instruction to rewrite every file. Transfers need the three-way RELEASED/GRANT/ACK. Historical reference bytes are read-only. Unlisted future files require exact reservation. New shared exports/manifest changes go to S15, router/CSS changes to S14.

- `apps/auth-web/dev-server.mjs`
- `apps/auth-web/index.html`
- `apps/auth-web/src/auth-redirect.ts`
- `apps/auth-web/src/form-helpers.ts`
- `apps/auth-web/src/main.ts`
- `apps/auth-web/src/supabase-auth-port.ts`
- `apps/auth-web/src/theme-preference.ts`
- `apps/auth-web/styles.css`
- `apps/auth-web/tsconfig.json`
- `packages/contracts/src/private-my-components-service.ts`
- `packages/contracts/src/private-onboarding-service.ts`
- `packages/contracts/src/private-project-case-studies.ts`
- `packages/contracts/src/project-data-service.ts`
- `packages/contracts/src/project.ts`
- `packages/contracts/src/projects.ts`
- `supabase/migrations/20261112181522_private_profiles_and_rls.sql`
- `supabase/migrations/20261112182015_identity_sharing_and_operator_roles.sql`
- `supabase/migrations/20261112182855_private_projects_and_assets.sql`
- `supabase/migrations/20261112184701_project_optimistic_concurrency_and_profile_permissions.sql`
- `supabase/migrations/20261112184732_portfolio_revision_journal_and_atomic_transactions.sql`
- `supabase/migrations/20261112184818_portfolio_snapshot_file_count_compatibility.sql`
- `supabase/migrations/20261112190817_portfolio_snapshot_managed_and_owned_path_allowlist.sql`
- `supabase/migrations/20261112190910_portfolio_snapshot_required_field_validation.sql`
- `supabase/migrations/20261112191349_private_project_case_study_revision_control.sql`
- `supabase/migrations/20261112191527_least_privilege_authenticated_table_grants.sql`
- `supabase/migrations/20261112194519_restrict_project_and_portfolio_creation_columns.sql`
- `supabase/migrations/20261112195717_allow_versioned_custom_component_source_paths.sql`
- `supabase/migrations/20261113081140_private_onboarding_progress_and_owner_rpc.sql`
- `supabase/migrations/20261113082110_verified_private_asset_registration.sql`
- `supabase/migrations/20261113163000_private_item_trash_and_restore.sql`
- `supabase/migrations/20261113170000_private_frozen_release_requests.sql`
- `supabase/migrations/20261114000500_private_reviewer_grants.sql`
- `supabase/migrations/20261114003000_private_moderation_case_appeals.sql`
- `supabase/migrations/20261114010000_private_frozen_revision_atomic_read.sql`
- `supabase/migrations/20261114021500_frozen_snapshot_canonical_attestation.sql`
- `supabase/migrations/20261114033000_private_account_erasure_request_journal.sql`
- `supabase/migrations/20261114063500_private_account_exit_preflight.sql`
- `supabase/migrations/20261114064500_private_exit_reauth_challenge.sql`
- `supabase/migrations/20261114080000_private_release_visibility_pointer.sql`
- `supabase/migrations/20261114084000_private_delivery_denial_gate.sql`
- `supabase/migrations/20261114091000_private_artifact_pointer_binding.sql`
- `supabase/migrations/20261114095000_case_bound_operator_private_block.sql`
- `supabase/migrations/20261114110000_private_account_exit_inventory_snapshots.sql`
- `supabase/migrations/20261114123000_private_account_exit_storage_reconciliation.sql`
- `supabase/migrations/20261114140000_private_storage_immutable_uploads.sql`
- `supabase/migrations/20261114150000_private_asset_content_attestations.sql`
- `supabase/migrations/20261114161539_verified_profile_projection.sql`
- `supabase/migrations/20261114162101_published_case_study_projection.sql`
- `supabase/migrations/20261114162436_account_erasure_execution.sql`
- `supabase/migrations/20261114163228_expired_trash_purge.sql`
- `supabase/migrations/20261114170000_private_unlisted_release_delivery.sql`
- `supabase/migrations/20261114235500_project_privacy_release_invalidation.sql`
- `supabase/migrations/20261114235910_private_trigger_execute_acl.sql`
- `supabase/migrations/20261115001000_reserved_portfolio_route_handles.sql`
- `supabase/migrations/20261115002000_project_exposure_immutable_identity.sql`
- `supabase/migrations/20261115041204_private_notification_inbox.sql`
- `supabase/migrations/20261115043831_portfolio_abuse_intake.sql`
- `supabase/migrations/20261115100000_private_goals_and_manual_history.sql`
- `supabase/migrations/20261115110000_private_platform_links.sql`
- `supabase/migrations/20261115121000_public_release_indexing_ack_gate.sql`
- `supabase/migrations/20261115122000_public_projection_content_privacy_invalidation.sql`
- `supabase/migrations/20261115130000_erasure_public_release_revocation_gate.sql`
- `supabase/migrations/20261115130001_private_frozen_media_candidates.sql`
- `supabase/migrations/20261115130002_account_exit_storage_revocation_gate.sql`
- `supabase/migrations/20261115130003_frozen_media_delivery.sql`
- `supabase/migrations/20261115130004_account_exit_withdraw_owned_public_content.sql`
- `supabase/migrations/20261115130005_account_exit_scoped_host_receipts.sql`
- `supabase/migrations/20261115130006_guarded_public_portfolio_rollback.sql`
- `supabase/migrations/20261115130007_atomic_account_metadata_export.sql`
- `supabase/migrations/20261115133000_account_erasure_jwt_truthful_receipt.sql`
- `supabase/migrations/20261115140000_owner_my_components_library.sql`
- `supabase/migrations/20261115154500_owner_profile_draft_save.sql`
- `supabase/migrations/20261116134114_operator_appeal_evidence.sql`
- `supabase/migrations/20261117083520_owner_private_project_thumbnails.sql`

## Continue until the assigned capability is delivered

Implement and commit reviewable functionality, request independent tests, and report exact F/R/V evidence. While blocked on a contract or CI, take the next independent assigned capability. Do not repeatedly run unchanged full suites, wait silently for another chat, merge your own PR into integration/main, or change a leased foreign file. End with the exact resume/handoff status in COORDINATION_PROTOCOL.md.
