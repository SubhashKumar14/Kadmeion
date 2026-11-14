import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const port = 3000;
const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
const emailDeliveryVerified = process.env.KADMEION_EMAIL_DELIVERY_VERIFIED === 'true';
const googleOAuthEnabled = process.env.KADMEION_GOOGLE_OAUTH_ENABLED === 'true';
let apiOrigin = '';
try {
  const u = new URL(supabaseUrl);
  if (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) apiOrigin = u.origin;
} catch { /* Configuration page will describe the missing setting. */ }
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const routes = new Set(['/', '/login', '/register', '/signin', '/signup', '/forgot-password', '/reset-password', '/set-password', '/auth/callback', '/workspace']);
const security = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' " + apiOrigin + "; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};
createServer(async (req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost:3000').pathname;
  if (!['GET', 'HEAD'].includes(req.method ?? '')) { res.writeHead(405, security); res.end(); return; }
  if (pathname === '/config.json') {
    res.writeHead(200, { ...security, 'Content-Type': 'application/json', 'Content-Security-Policy': security['Content-Security-Policy'] });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ supabaseUrl, publishableKey, emailDeliveryVerified, googleOAuthEnabled }));
    return;
  }
  let file = '';
  if (routes.has(pathname)) file = resolve(root, 'apps/auth-web/index.html');
  else if (pathname === '/styles.css') file = resolve(root, 'apps/auth-web/styles.css');
  else if (/^\/compiled\/(?:apps\/auth-web\/src|packages\/contracts\/src)\/[a-zA-Z0-9/-]+\.js$/.test(pathname)) file = resolve(root, '.auth-build', pathname.slice('/compiled/'.length));
  if (!file || !file.startsWith(root + sep)) { res.writeHead(404, security); res.end('Not found'); return; }
  try {
    const content = await readFile(file);
    const ext = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, { ...security, 'Content-Type': types[ext] ?? 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {
    res.writeHead(404, security); res.end('Not found. Run npm run build:auth first.');
  }
}).listen(port, '127.0.0.1', () => {
  console.log('Kadmeion B1 authentication shell: http://localhost:' + port);
  if (!apiOrigin || !publishableKey) console.log('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY before testing authentication.');
});
