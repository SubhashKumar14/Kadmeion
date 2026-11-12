import { execFileSync } from 'node:child_process';
const paths = execFileSync('git', ['ls-files', '--cached'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const app = paths.filter((path) => path !== 'README.md' && !path.startsWith('project-docs/') &&
  !path.startsWith('node_modules/') && !path.startsWith('dist/') &&
  !path.startsWith('coverage/'));
console.log(`Kadmeion authored application/config/test files: ${app.length} / planned 200`);
if (app.length > 200) {
  console.error('Proposed 200-file budget exceeded; review modularity and obtain owner decision.');
  process.exitCode = 1;
}
