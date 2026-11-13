import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const target = resolve('apps/auth-web/vercel-dist');
const url = process.env.VITE_SUPABASE_URL ?? '';
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
let parsed;
try { parsed = new URL(url); }
catch { throw new Error('VITE_SUPABASE_URL must be the HTTPS API origin for Kadmeion.'); }
if (parsed.origin !== 'https://scyooqjitjzjdxgtanso.supabase.co' || url !== parsed.origin)
  throw new Error('VITE_SUPABASE_URL is not the approved Kadmeion Supabase project.');
if (!key || !/^(sb_publishable_|eyJ)[A-Za-z0-9._-]{8,}$/.test(key) || key.includes('service_role'))
  throw new Error('Missing or invalid PUBLIC Supabase publishable/anon key. Never provide a secret or service-role key.');
await rm(target, { recursive: true, force: true });
await mkdir(resolve(target, 'compiled'), { recursive: true });
await cp(resolve('apps/auth-web/index.html'), resolve(target, 'index.html'));
await cp(resolve('apps/auth-web/styles.css'), resolve(target, 'styles.css'));
await cp(resolve('.auth-build/apps'), resolve(target, 'compiled/apps'), { recursive: true });
await cp(resolve('.auth-build/packages'), resolve(target, 'compiled/packages'), { recursive: true });
await writeFile(resolve(target, 'config.json'), JSON.stringify({
  supabaseUrl: parsed.origin, publishableKey: key
}) + '\n');
await writeFile(resolve(target, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
console.log('Built B1 authentication-only Vercel static preview bundle.');
