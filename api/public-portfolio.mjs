import {createHash} from 'node:crypto';
import {readBoundedRpcJson, mediaQuery, renderReleaseHtml, readFrozenPng, hasPrivateNoindexMeta} from './_bounded-rpc-json.mjs';

const handlePattern = /^[a-z][a-z0-9_]{2,29}$/;
const slugPattern = /^(?=.{3,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const reservedHandles = new Set([
  'admin','api','auth','dashboard','edit','explore','help','login',
  'logout','new','profile','projects','settings','signup','signin',
  'register','workspace','status','r','app','support','templates','u'
]);
const stagedRobots = '<meta name="robots" content="noindex,nofollow,noarchive">';
const publicRobots = '<meta name="robots" content="index,follow">';
const reportIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reportReasons = new Set(['ABUSE', 'SECURITY', 'LEGAL', 'SPAM']);
const reportBytes = 4096;

async function reportBody(req) {
  const type = req.headers?.['content-type'];
  const size = req.headers?.['content-length'];
  const encoding = req.headers?.['content-encoding'];
  if (typeof type !== 'string' || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(type) ||
      (size !== undefined && (typeof size !== 'string' || !/^\d+$/.test(size) || Number(size)>reportBytes)) ||
      (encoding !== undefined && encoding !== 'identity')) return null;
  let candidate = req.body;
  if (candidate === undefined && req[Symbol.asyncIterator]) {
    const chunks = [];
    let total = 0;
    for await (const part of req) {
      const chunk = Buffer.from(part);
      total += chunk.length;
      if (total > reportBytes) return null;
      chunks.push(chunk);
    }
    candidate = Buffer.concat(chunks, total);
  }
  if (typeof candidate === 'string' || Buffer.isBuffer(candidate)) {
    if (Buffer.byteLength(candidate) > reportBytes) return null;
    candidate = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Buffer.from(candidate)));
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
      Object.keys(candidate).sort().join(',') !== 'evidence,operationId,reason' ||
      typeof candidate.operationId !== 'string' || !reportIdPattern.test(candidate.operationId) ||
      !reportReasons.has(candidate.reason) || typeof candidate.evidence !== 'string' ||
      Buffer.byteLength(candidate.evidence) > 2000 || /[\x00-\x1f\x7f]/.test(candidate.evidence)) return null;
  const evidence = candidate.evidence.trim();
  if ([...evidence].length < 20 || [...evidence].length > 500) return null;
  return {p_operation_id:candidate.operationId,p_reason_code:candidate.reason,p_evidence:evidence};
}

export async function handlePublicPortfolio(req, res, {env = process.env, http = fetch} = {}) {
  function reply(status, body, type, indexable = false, media = false) {
    res.statusCode = status;
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src " + (media ? "'self'" : "'none'") + "; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Content-Type', type ?? (status === 200 ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8'));
    res.setHeader('X-Robots-Tag', status === 200 && indexable ? 'index, follow' : 'noindex, nofollow, noarchive');
    res.end(req.method === 'HEAD' ? '' : body);
  }
  const reporting = req.method === 'POST';
  if (req.method !== 'GET' && req.method !== 'HEAD' && !reporting) {
    res.setHeader('Allow', 'GET, HEAD, POST');
    return reply(405, 'Method not allowed');
  }
  if (env.KADMEION_PUBLIC_PORTFOLIO_ENABLED !== 'true') return reply(404, 'Not found');
  try {
    const target = new URL(req.url, 'https://kadmeion.invalid');
    const path = target.pathname.match(/^\/([^/]+)\/([^/]+)$/);
    const rewritten = target.pathname === '/api/public-portfolio';
    const assetRequest = target.searchParams.has('asset') || target.searchParams.has('manifest');
    const media = rewritten && assetRequest ? mediaQuery(target.searchParams) : null;
    if (assetRequest && (!media || reporting)) return reply(404, 'Not found');
    const handle = rewritten ? target.searchParams.get('handle') : path?.[1];
    const slug = rewritten ? target.searchParams.get('slug') : path?.[2];
    // Reject ambiguous duplicate route parameters and shadow query strings.
    // A host/CDN may parse repeated keys differently from URLSearchParams.get().
    const uniqueRoute = rewritten
      ? target.searchParams.size === (media ? 4 : 2) &&
        target.searchParams.getAll('handle').length === 1 &&
        target.searchParams.getAll('slug').length === 1
      : Boolean(path) && target.search === '';
    if (!uniqueRoute || !handlePattern.test(handle ?? '') || reservedHandles.has(handle) ||
        !slugPattern.test(slug ?? '')) return reply(404, 'Not found');
    let report;
    if (reporting) {
      try { report = await reportBody(req); }
      catch { return reply(400, 'Invalid report'); }
      if (!report) return reply(400, 'Invalid report');
    }

    const origin = new URL(env.KADMEION_SUPABASE_URL);
    const local = env.KADMEION_LOCAL_INTEGRATION === '1' && origin.origin === 'http://127.0.0.1:54321';
    const key = env.KADMEION_SUPABASE_SERVICE_ROLE_KEY;
    if ((!local && origin.origin !== 'https://scyooqjitjzjdxgtanso.supabase.co') ||
        origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
        typeof key !== 'string' || !key.startsWith('eyJ') || key.length < 70) {
      return reply(503, 'Temporarily unavailable');
    }
    const rpc = reporting ? 'service_submit_portfolio_abuse_report' :
      media ? 'service_read_frozen_release_png' : 'service_read_public_portfolio';
    const upstream = await http(new URL('/rest/v1/rpc/' + rpc, origin), {
      method: 'POST', redirect: 'error', cache: 'no-store', credentials: 'omit',
      headers: {apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'},
      body: JSON.stringify({p_handle: handle, p_slug: slug, ...report, ...media}), signal: AbortSignal.timeout(5000)
    });
    if (reporting) {
      const receipt = await readBoundedRpcJson(upstream, 4096);
      if (upstream.ok && receipt?.status === 'RECEIVED_FOR_REVIEW' && Object.keys(receipt).length === 1)
        return reply(202, JSON.stringify(receipt), 'application/json; charset=utf-8');
      if (!upstream.ok && receipt?.message === 'PUBLIC_PORTFOLIO_NOT_FOUND') return reply(404, 'Not found');
      if (!upstream.ok && receipt?.message === 'ABUSE_REPORT_RATE_LIMIT') return reply(429, 'Please try again later');
      if (!upstream.ok && receipt?.message === 'ABUSE_REPORT_OPERATION_CONFLICT') return reply(409, 'Report conflicts with a previous submission');
      return reply(503, 'Temporarily unavailable');
    }
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return reply(503, 'Temporarily unavailable');
    }

    if (media) {
      const png = await readFrozenPng(upstream, media.p_sha);
      return png ? reply(200, png, 'image/png') : reply(404, 'Not found');
    }
    const release = await readBoundedRpcJson(upstream);
    if (release === null) return reply(404, 'Not found');
    if (!release || typeof release !== 'object' || Array.isArray(release) ||
        typeof release.indexable !== 'boolean')
      return reply(503, 'Temporarily unavailable');
    const html = release.html;
    if (typeof html !== 'string' || Buffer.byteLength(html) > 750000 ||
        !html.startsWith('<!doctype html>') || !hasPrivateNoindexMeta(html, stagedRobots) ||
        html.split(stagedRobots).length !== 2) {
      return reply(503, 'Temporarily unavailable');
    }
    // Before the host acknowledges the exact release, allow only a noindex canary.
    // A successful database read is not independently verified publication.
    const rendered=renderReleaseHtml(release,['html','htmlSha256','indexable'],
      '/api/public-portfolio',{handle,slug});
    if(!rendered) return reply(503,'Temporarily unavailable');
    const published = release.indexable ? rendered.html.replace(stagedRobots, publicRobots) : rendered.html;
    res.setHeader('X-Kadmeion-Served-SHA256',
      createHash('sha256').update(published).digest('hex'));
    return reply(200, published, undefined, release.indexable, rendered.media);
  } catch {
    return reply(503, 'Temporarily unavailable');
  }
}

export default handlePublicPortfolio;
