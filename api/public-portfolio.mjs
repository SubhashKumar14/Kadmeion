import {createHash} from 'node:crypto';
import {readBoundedRpcJson} from './_bounded-rpc-json.mjs';

const handlePattern = /^[a-z][a-z0-9_]{2,29}$/;
const slugPattern = /^(?=.{3,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const reservedHandles = new Set([
  'admin','api','auth','dashboard','edit','explore','help','login',
  'logout','new','profile','projects','settings','signup','signin',
  'register','workspace','status','r','app','support','templates','u'
]);
const stagedRobots = '<meta name="robots" content="noindex,nofollow,noarchive">';
const publicRobots = '<meta name="robots" content="index,follow">';

export async function handlePublicPortfolio(req, res, {env = process.env, http = fetch} = {}) {
  function reply(status, body) {
    res.statusCode = status;
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Content-Type', status === 200 ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8');
    res.setHeader('X-Robots-Tag', status === 200 ? 'index, follow' : 'noindex');
    res.end(req.method === 'HEAD' ? '' : body);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return reply(405, 'Method not allowed');
  }
  if (env.KADMEION_PUBLIC_PORTFOLIO_ENABLED !== 'true') return reply(404, 'Not found');
  try {
    const target = new URL(req.url, 'https://kadmeion.invalid');
    const path = target.pathname.match(/^\/([^/]+)\/([^/]+)$/);
    const rewritten = target.pathname === '/api/public-portfolio';
    const handle = rewritten ? target.searchParams.get('handle') : path?.[1];
    const slug = rewritten ? target.searchParams.get('slug') : path?.[2];
    if (!handlePattern.test(handle ?? '') || reservedHandles.has(handle) ||
        !slugPattern.test(slug ?? '')) return reply(404, 'Not found');

    const origin = new URL(env.KADMEION_SUPABASE_URL);
    const local = env.KADMEION_LOCAL_INTEGRATION === '1' && origin.origin === 'http://127.0.0.1:54321';
    const key = env.KADMEION_SUPABASE_SERVICE_ROLE_KEY;
    if ((!local && origin.origin !== 'https://scyooqjitjzjdxgtanso.supabase.co') ||
        origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
        typeof key !== 'string' || !key.startsWith('eyJ') || key.length < 70) {
      return reply(503, 'Temporarily unavailable');
    }
    const upstream = await http(new URL('/rest/v1/rpc/service_read_public_portfolio', origin), {
      method: 'POST', redirect: 'error', cache: 'no-store', credentials: 'omit',
      headers: {apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'},
      body: JSON.stringify({p_handle: handle, p_slug: slug}), signal: AbortSignal.timeout(5000)
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return reply(503, 'Temporarily unavailable');
    }

    const release = await readBoundedRpcJson(upstream);
    if (release === null) return reply(404, 'Not found');
    if (!release || typeof release !== 'object' || Array.isArray(release) ||
        Object.keys(release).sort().join(',') !== 'html,htmlSha256')
      return reply(503, 'Temporarily unavailable');
    const html = release.html;
    if (typeof html !== 'string' || Buffer.byteLength(html) > 750000 ||
        !html.startsWith('<!doctype html>') || html.split(stagedRobots).length !== 2 ||
        !/^[0-9a-f]{64}$/.test(release.htmlSha256) ||
        /<[^>]+\bon[a-z]+\s*=/i.test(html) ||
        /<[^>]+\b(?:src|srcset|action|formaction)\s*=/i.test(html) ||
        /<\s*meta\b[^>]*http-equiv\s*=\s*(?:"(?!Content-Security-Policy")|'(?!Content-Security-Policy')|[^"'])/i.test(html) ||
        /\bhref\s*=\s*(?:"(?!https:\/\/)|'(?!https:\/\/)|[^"'])/i.test(html) ||
        /<\s*(script|iframe|object|embed|svg|form|input|link|base|img)([\s/>])/i.test(html) ||
        createHash('sha256').update(html).digest('hex') !== release.htmlSha256) {
      return reply(503, 'Temporarily unavailable');
    }
    const published = html.replace(stagedRobots, publicRobots);
    res.setHeader('X-Kadmeion-Served-SHA256',
      createHash('sha256').update(published).digest('hex'));
    return reply(200, published);
  } catch {
    return reply(503, 'Temporarily unavailable');
  }
}

export default handlePublicPortfolio;
