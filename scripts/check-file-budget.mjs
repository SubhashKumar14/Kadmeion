import { execFileSync } from 'node:child_process';

const paths = execFileSync('git', ['ls-files', '--cached'], { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);
const app = paths.filter((path) => path !== 'README.md' && !path.startsWith('project-docs/') &&
  !path.startsWith('node_modules/') && !path.startsWith('dist/') &&
  !path.startsWith('coverage/'));
const planned = 200;
const formerCeiling = 280; // DECISION-B16-002: historical reporting only, not a failure threshold.
// Fail closed if the pinned historical baseline is unavailable.
const baselineRef = '7d03713fbbef4f02215d38b28932ad3952adefad';
const baselinePaths = new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', baselineRef], { encoding: 'utf8' }).trim().split('\n').filter(Boolean));
const authorizedAdditionPaths = [
  // RESERVE-B16-S01-001; WF-009/013/041; S1; exact authorized migration path.
  'supabase/migrations/20261117083520_owner_private_project_thumbnails.sql',
  // EVENT-B16-S00-015 / S15-013; C04/WF-021; S1 PROJECT pin-only reservation.
  'supabase/migrations/20261117155900_owner_private_asset_pin.sql',
  // S15-013 / S00-016: isolated C13 S12/S13 service and test only.
  'packages/contracts/src/private-analytics-service.ts',
  'tests/contracts/private-analytics.test.ts',
];
const reservedAdditions = new Set(authorizedAdditionPaths);
// Exact reservations must not collide with the grandfathered baseline or each other.
const collisions = authorizedAdditionPaths.filter((path, index) => baselinePaths.has(path) || authorizedAdditionPaths.indexOf(path) !== index);
if (collisions.length) {
  console.error('Colliding counted-path authorizations: ' + collisions.join(', '));
  process.exitCode = 1;
}
// RESERVE-B16-S01-002 is conditional, not allowlisted until its gates are recorded.
// Independently reviewed security migrations, owner-notification files and
// a dependency-free server-only PNG sanitization source/test pair remain
// separate so privacy safeguards are not hidden inside unrelated modules.
// They are justified departures from the *proposed* 200-path inventory,
// NOT evidence that the owner has approved a new design/file budget.
const justifiedExtra = [
  // WF-052 case evidence uses a narrow, forward-only operator RPC.
  'supabase/migrations/20261116134114_operator_appeal_evidence.sql',
  'supabase/migrations/20261115043831_portfolio_abuse_intake.sql',
  'supabase/migrations/20261115121000_public_release_indexing_ack_gate.sql',
  'supabase/migrations/20261115122000_public_projection_content_privacy_invalidation.sql',
  'packages/contracts/src/private-notifications-service.ts',
  'tests/contracts/private-notifications-service.test.ts',
  'packages/storage-adapters/src/safe-png-publication.ts',
  'tests/editor/safe-png-publication.test.ts',
  'supabase/migrations/20261115130000_erasure_public_release_revocation_gate.sql',
  'supabase/migrations/20261115130001_private_frozen_media_candidates.sql',
  'supabase/migrations/20261115130002_account_exit_storage_revocation_gate.sql',
  'supabase/migrations/20261115130003_frozen_media_delivery.sql',
  'supabase/migrations/20261115130004_account_exit_withdraw_owned_public_content.sql',
  'supabase/migrations/20261115130005_account_exit_scoped_host_receipts.sql',
  'packages/editor-core/src/isolated-owned-preview.ts',
  'supabase/migrations/20261115130006_guarded_public_portfolio_rollback.sql',
  'supabase/migrations/20261115130007_atomic_account_metadata_export.sql',
  // Account-erasure JWT truthfulness needs an independently replayable
  // forward-only migration and an explicit SQL authorization regression.
  'supabase/migrations/20261115133000_account_erasure_jwt_truthful_receipt.sql',
  'supabase/tests/account-erasure-jwt-receipt.sql',
  // Daily expiry requires a separately gated scheduler without a billable service.
  '.github/workflows/trash-expiry.yml',
  // WF-025 private durable user components need independently audited RLS,
  // client contracts and regression coverage (not a false 200-file claim).
  'supabase/migrations/20261115140000_owner_my_components_library.sql',
  'supabase/tests/private-my-components.sql',
  'packages/contracts/src/private-my-components-service.ts',
  'tests/contracts/private-my-components-service.test.ts',
  // B11 integrity gate ensures all five durable evidence registers remain
  // unique, complete and linked to actual sources without fabricating UAT.
  'scripts/verify-backend-traceability.mjs',
  // F1 auth/theme UX must work even when storage or Supabase config fails;
  // preserve a separately testable, dependency-free theme policy instead of
  // burying recoverability in mutable DOM effects. Extra files are NOT an
  // owner-approved budget increase; this exception remains pending review.
  'apps/auth-web/src/theme-preference.ts',
  'tests/auth-web/theme-preference.test.ts',
  // F0 approved-reference integrity requires a separate offline verifier.
  // Owner review of the resulting >200 source-file variance remains open.
  'scripts/verify-approved-light-references.mjs',
  // F1 standalone latest-stable React 19/Vite 8/TypeScript 7 frontend and
  // separately reproducible Node 26 CI. These are NOT owner-approved cap
  // extensions and remain separately reviewable, not hidden in other files.
  '.github/workflows/frontend.yml',
  'apps/frontend/package.json',
  'apps/frontend/package-lock.json',
  'apps/frontend/index.html',
  'apps/frontend/vite.config.ts',
  'apps/frontend/tsconfig.json',
  'apps/frontend/src/behavior.ts',
  'apps/frontend/src/behavior.test.ts',
  'apps/frontend/src/main.tsx',
  'apps/frontend/src/landing.tsx',
  'apps/frontend/src/styles.css',
  // F1 public template explorer (screen 03): separate searchable, accessible catalog.
  'apps/frontend/src/templates.tsx',
  // F1 public showcase screen 02 (illustrative until secure public projection).
  'apps/frontend/src/explore.tsx',
  // Latest stable Playwright 1.65.1 browser integration tests, using the
  // existing runner Chrome and no third-party cloud browser subscription.
  'apps/frontend/playwright.config.ts',
  'apps/frontend/e2e/public.spec.ts',
  // F1 uses existing secure AuthService/SupabaseBrowserAuthPort in React,
  // preserving provider gates and no separate business auth backend.
  'apps/frontend/src/auth.tsx',
  'apps/frontend/src/auth.css',
  // WORK-01/WORK-02 owner-only guarded React shell; variance is NOT owner approval.
  'apps/frontend/src/workspace.tsx',
  'apps/frontend/src/workspace.css',
  // F2 owner-only project gallery/quick-add; above proposed 200-file cap pending owner review.
  'apps/frontend/src/projects.tsx',
  // Approved vector identity assets shared by public and private shells.
  'apps/frontend/public/brand/kadmeion-mark.svg',
  'apps/frontend/public/brand/kadmeion-wordmark.svg',
  // Explicit 15 Nov owner approval of all 12 Canva identity pages superseded
  // the archived concepts' review-only status. Original pictorial SVG is
  // a distinct contextual empty-state asset; 200-file cap variance remains.
  'apps/frontend/public/brand/kadmeion-open-folio.svg',
  'apps/frontend/e2e/owner.spec.ts',
  // F5 isolated authenticated settings 41–47 responsive/theme acceptance:
  // distinct fixture-driven test to keep owner acceptance auditable.
  // This is a proposed source-file variance, not owner approval of the cap.
  'apps/frontend/e2e/settings-owner.spec.ts',
  // F06 records test-only WCAG-rule evidence for public and owner fixtures.
  'apps/frontend/e2e/accessibility.ts',
  'apps/frontend/src/profile.tsx',
  'apps/frontend/src/portfolios.tsx',
  'apps/frontend/src/portfolio-tools.tsx',
  'apps/frontend/src/release.tsx',
  'apps/frontend/src/settings.tsx',
  // Restricted role-checked operator console for approved OPS-01–03,
  // a proposed file budget variance, not owner-approved expansion.
  'apps/frontend/src/operations.tsx',
  // P2 owner-private link-only provider storage: RLS and exact source claims
  // with separately testable bounded responses, NOT owner-authorized file cap.
  'packages/contracts/src/private-platform-links-service.ts',
  'tests/contracts/private-platform-links-service.test.ts',
  // P2 actual owner Growth screens (35–40) with manual-only data provenance.
  'apps/frontend/src/growth.tsx',
  'supabase/migrations/20261115154500_owner_profile_draft_save.sql'
];
const extras = [...justifiedExtra, ...reservedAdditions].filter(path => app.includes(path));
const nonexceptionCount = app.length - extras.length;
console.log(`Kadmeion authored application/config/test files: ${app.length} / originally planned ${planned}`);
if (app.length > planned) {
  console.warn(`File-budget variance: +${app.length - planned} actual files; ${extras.length} separately justified historical/reserved files; former ceiling ${formerCeiling} (reporting only).`);
}
console.log(`Nonexception files: ${nonexceptionCount}; separately justified/reserved: ${extras.length}; variance vs former 280: ${app.length - formerCeiling}. Numerical thresholds are informational under DECISION-B16-002.`);


const unreserved = app.filter(path => !baselinePaths.has(path) && !reservedAdditions.has(path));
if (unreserved.length) {
  console.error('Unreserved counted additions: ' + unreserved.join(', '));
  process.exitCode = 1;
}
