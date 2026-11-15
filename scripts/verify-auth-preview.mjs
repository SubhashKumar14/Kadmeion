import {auditPublicBundle} from './audit-public-bundle.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const target = resolve('apps/auth-web/vercel-dist');
const html = await readFile(resolve(target, 'index.html'), 'utf8');
assert.match(html, /Kadmeion/);
assert.match(html, /\/compiled\/apps\/auth-web\/src\/main\.js/);
assert.doesNotMatch(html, /<script[^>]*src="https:\/\//);
const compiled = await readFile(resolve(target, 'compiled/apps/auth-web/src/main.js'), 'utf8');
assert.match(compiled, /parseAuthRedirect/);
const auth = await readFile(resolve(target, 'compiled/apps/auth-web/src/supabase-auth-port.js'), 'utf8');
assert.match(auth, /SupabaseBrowserAuthPort/);
const contract = await readFile(resolve(target, 'compiled/packages/contracts/src/auth-service.js'), 'utf8');
assert.match(contract, /AuthService/);
const config = JSON.parse(await readFile(resolve(target, 'config.json'), 'utf8'));
assert.equal(config.supabaseUrl, 'https://scyooqjitjzjdxgtanso.supabase.co');
assert.ok(config.publishableKey.startsWith('sb_publishable_') || config.publishableKey.startsWith('eyJ'));
assert.equal(typeof config.emailDeliveryVerified, 'boolean');
assert.equal(typeof config.googleOAuthEnabled, 'boolean');
const vercel = JSON.parse(await readFile(resolve('vercel.json'), 'utf8'));
// The legacy B1 auth proof remains tested locally; Vercel now serves the guarded React screen frontend.
assert.equal(vercel.outputDirectory, 'apps/frontend/dist');
assert.match(vercel.buildCommand, /npm ci --prefix apps\/frontend .*&& npm run build --prefix apps\/frontend/);
for (const route of ['/signin', '/signup', '/login', '/register', '/auth/callback', '/reset-password', '/workspace'])
  assert.ok(vercel.rewrites.some(row => row.source === route && row.destination === '/index.html'));
assert.ok(vercel.headers[0].headers.some(row => row.key === 'Content-Security-Policy'));
assert.ok(vercel.headers[0].headers.some(row => row.key === 'X-Robots-Tag' && row.value.includes('noindex')));
console.log('Isolated B1 auth proof and React Vercel routing assertions passed.');

const audit=await auditPublicBundle(target);
assert.equal(audit.status,'PUBLIC_ARTIFACT_SCANNED');
console.log('Public browser bundle secret-boundary scan: '+audit.filesChecked+' files passed.');
