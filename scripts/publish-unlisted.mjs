import {publishConsentedUnlistedRelease} from '../packages/storage-adapters/src/unlisted-release-verification.ts';

async function run() {
  const [intentId, ...extraArgs] = process.argv.slice(2);
  if (!intentId || extraArgs.length || (process.env.KADMEION_UNLISTED_DELIVERY_ENABLED !== 'true' &&
      process.env.KADMEION_PUBLIC_PORTFOLIO_ENABLED !== 'true')) {
    throw new Error('Enable portfolio delivery and supply exactly one owner consent ID.');
  }
  const {
    KADMEION_SUPABASE_URL: endpoint,
    KADMEION_SUPABASE_SERVICE_ROLE_KEY: key,
    KADMEION_UNLISTED_DELIVERY_ORIGIN: origin
  } = process.env;
  const supabase = new URL(endpoint ?? '');
  const local = process.env.KADMEION_LOCAL_INTEGRATION === '1' &&
    supabase.origin === 'http://127.0.0.1:54321';
  if ((!local && supabase.origin !== 'https://scyooqjitjzjdxgtanso.supabase.co') ||
      supabase.username || supabase.password || supabase.pathname !== '/' ||
      supabase.search || supabase.hash || !key?.startsWith('eyJ') || !origin) {
    throw new Error('Trusted Supabase and delivery configuration are required.');
  }

  const result = await publishConsentedUnlistedRelease(intentId, {
    origin,
    rpc: async (operation, input) => {
      const response = await fetch(new URL('/rest/v1/rpc/' + operation, supabase), {
        method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: {apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'},
        signal: AbortSignal.timeout(10_000), body: JSON.stringify(input)
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(operation + ' failed with HTTP ' + response.status + '.');
      }
      return response.json();
    }
  });
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.status !== 'DELIVERY_ACKNOWLEDGED') process.exitCode = 1;
}

try {
  await run();
} catch (error) {
  process.stderr.write((error instanceof TypeError ? 'Invalid configuration or network failure.' : error.message) + '\n');
  process.exitCode = 1;
}
