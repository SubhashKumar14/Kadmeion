import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';

const server = spawn(process.execPath, ['apps/auth-web/dev-server.mjs'], {
  env: {
    ...process.env,
    VITE_SUPABASE_URL: 'https://auth-smoke.supabase.co',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_smoke_test'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let exited = false;
server.on('exit', () => { exited = true; });

try {
  let response;
  for (let i = 0; i < 50; i++) {
    if (exited) throw new Error('Authentication test server exited unexpectedly.');
    try {
      response = await fetch('http://127.0.0.1:3000/login');
      break;
    } catch { await pause(100); }
  }
  assert.ok(response, 'Test server did not start.');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /id="login-form"/);
  assert.match(response.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');

  for (const path of ['/signup', '/signin', '/register', '/forgot-password', '/auth/callback', '/reset-password', '/workspace']) {
    const page = await fetch('http://127.0.0.1:3000' + path);
    assert.equal(page.status, 200, path);
    assert.match(await page.text(), /KADMEION/);
  }
  const config = await fetch('http://127.0.0.1:3000/config.json');
  assert.equal(config.status, 200);
  const data = await config.json();
  assert.equal(data.publishableKey, 'sb_publishable_smoke_test');
  assert.equal(data.supabaseUrl, 'https://auth-smoke.supabase.co');

  for (const path of [
    '/compiled/apps/auth-web/src/main.js',
    '/compiled/apps/auth-web/src/supabase-auth-port.js',
    '/compiled/packages/contracts/src/auth-service.js',
    '/styles.css'
  ]) {
    const asset = await fetch('http://127.0.0.1:3000' + path);
    assert.equal(asset.status, 200, path);
    assert.ok((await asset.text()).length > 50);
  }
  assert.equal((await fetch('http://127.0.0.1:3000/private-file')).status, 404);
  console.log('Auth frontend smoke: 12 route/asset and security checks passed.');
} finally {
  server.kill('SIGTERM');
}
