import { execFileSync } from 'node:child_process';

const paths = execFileSync('git', ['ls-files', '--cached'], { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);
const app = paths.filter((path) => path !== 'README.md' && !path.startsWith('project-docs/') &&
  !path.startsWith('node_modules/') && !path.startsWith('dist/') &&
  !path.startsWith('coverage/'));
const planned = 200;
// Three forward-only migrations retain separately auditable security boundaries.
// They are justified departures from the *proposed* 200-path inventory,
// NOT evidence that the owner has approved a new design/file budget.
const justifiedExtra = [
  'supabase/migrations/20261115043831_portfolio_abuse_intake.sql',
  'supabase/migrations/20261115121000_public_release_indexing_ack_gate.sql',
  'supabase/migrations/20261115122000_public_projection_content_privacy_invalidation.sql'
];
const extras = justifiedExtra.filter(path => app.includes(path));
const nonexceptionCount = app.length - extras.length;
console.log(`Kadmeion authored application/config/test files: ${app.length} / originally planned ${planned}`);
if (app.length > planned) {
  console.warn(`File-budget variance: +${app.length - planned} actual files; ${extras.length} separately justified security migrations require owner review.`);
}
if (nonexceptionCount > planned) {
  console.error('Nonexception source/config/test files exceed the original planned count; review modularity.');
  process.exitCode = 1;
}
