import { execFileSync } from 'node:child_process';

const paths = execFileSync('git', ['ls-files', '--cached'], { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);
const app = paths.filter((path) => path !== 'README.md' && !path.startsWith('project-docs/') &&
  !path.startsWith('node_modules/') && !path.startsWith('dist/') &&
  !path.startsWith('coverage/'));
const planned = 200;
// Independently reviewed security migrations, owner-notification files and
// a dependency-free server-only PNG sanitization source/test pair remain
// separate so privacy safeguards are not hidden inside unrelated modules.
// They are justified departures from the *proposed* 200-path inventory,
// NOT evidence that the owner has approved a new design/file budget.
const justifiedExtra = [
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
  'supabase/migrations/20261115130006_guarded_public_portfolio_rollback.sql'
];
const extras = justifiedExtra.filter(path => app.includes(path));
const nonexceptionCount = app.length - extras.length;
console.log(`Kadmeion authored application/config/test files: ${app.length} / originally planned ${planned}`);
if (app.length > planned) {
  console.warn(`File-budget variance: +${app.length - planned} actual files; ${extras.length} separately justified security/privacy files require owner review.`);
}
if (nonexceptionCount > planned) {
  console.error('Nonexception source/config/test files exceed the original planned count; review modularity.');
  process.exitCode = 1;
}
