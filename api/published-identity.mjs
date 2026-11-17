import {createHash} from 'node:crypto';
import {readBoundedRpcJson} from './_bounded-rpc-json.mjs';
const handlePattern = /^[a-z][a-z0-9_]{2,29}$/;
const slugPattern = /^(?=.{3,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const entities = {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'};
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
const textWithin = (value, max) => value === undefined ||
  (typeof value === 'string' && value.length <= max &&
   !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
function validProjection(row, handle, slug) {
  if (!isRecord(row) || row.handle !== handle) return false;
  const keys = slug
    ? ['handle','slug','title','summary','description','repositoryUrl','liveUrl','sections']
    : ['handle','displayName','headline','bio'];
  if (Object.keys(row).some(key => !keys.includes(key))) return false;
  if (!slug) return ['displayName','headline','bio'].some(key => Object.hasOwn(row,key)) &&
    textWithin(row.displayName,160) && textWithin(row.headline,320) && textWithin(row.bio,12000);
  if (row.slug !== slug || typeof row.title !== 'string' ||
      !row.title.trim() || !textWithin(row.title,200) ||
      !textWithin(row.summary,1000) || !textWithin(row.description,12000) ||
      !textWithin(row.repositoryUrl,2048) || !textWithin(row.liveUrl,2048) ||
      !Array.isArray(row.sections) || row.sections.length > 24) return false;
  return row.sections.every(section => isRecord(section) &&
    Object.keys(section).every(key => key === 'title' || key === 'body') &&
    typeof section.title === 'string' && textWithin(section.title,200) &&
    typeof section.body === 'string' && textWithin(section.body,12000));
}

function escape(value) {
  return typeof value === 'string' ? value.replace(/[&<>"']/g, char => entities[char]) : '';
}

function link(label, value) {
  if (typeof value !== 'string' || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return '';
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) {
      return '<a rel="noreferrer" href="' + escape(url.href) + '">' + label + '</a>';
    }
  } catch {
    // An absent or invalid external URL has no link.
  }
  return '';
}

function paragraph(value) {
  return typeof value === 'string' && value.length ? '<p>' + escape(value) + '</p>' : '';
}

function render(projection, slug) {
  const title = escape(slug ? projection.title : projection.displayName || projection.handle);
  const content = slug
    ? paragraph(projection.summary) + paragraph(projection.description) +
      link('View live project', projection.liveUrl) + ' ' + link('View repository', projection.repositoryUrl) +
      projection.sections.map(section =>
        '<section><h2>' + escape(section.title) + '</h2>' + paragraph(section.body) + '</section>').join('')
    : paragraph(projection.headline) + paragraph(projection.bio);
  // SEO text is taken only from already-consented public projection fields.
  // Do not synthesize an author biography, claim verification or expose raw JSON.
  const visibleDescription = slug ? projection.summary : (projection.headline || projection.bio);
  const summary = typeof visibleDescription === 'string' && visibleDescription.trim()
    ? escape(visibleDescription.trim().slice(0, 300)) : '';
  const description = summary ? '<meta name="description" content="' + summary + '">' : '';
  // Text-only share metadata from this exact authorized projection. Do not
  // infer an absolute canonical origin from request headers, or claim a public
  // image, delivery receipt, verification or discoverability not in the RPC.
  const shareMetadata = '<meta property="og:type" content="website">' +
    '<meta property="og:title" content="' + title + '">' +
    (summary ? '<meta property="og:description" content="' + summary + '">' : '');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>' + title +
    '</title><meta name="robots" content="noindex,nofollow,noarchive">' + description + shareMetadata + '</head><body><main><h1>' + title + '</h1>' +
    content + '</main></body></html>';
}

export async function handlePublishedIdentity(req, res, {env = process.env, http = fetch} = {}) {
  function reply(status, body) {
    res.statusCode = status;
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    // The current projection RPC only returns explicitly selected DB snapshot
    // fields. It does not attest independently verified canonical delivery.
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Content-Type', status === 200 ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8');
    res.end(req.method === 'HEAD' ? '' : body);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return reply(405, 'Method not allowed');
  }
  if (env.KADMEION_PUBLIC_IDENTITY_ENABLED !== 'true') return reply(404, 'Not found');
  let target;
  let supabase;
  // Keep this B-based patch standalone. Align the S9 shared
  // parseDeliveryTarget helper when the two owned deltas are composed.
  const raw = req.url;
  if (typeof raw !== 'string' || raw.length > 2048 || !raw.startsWith('/') ||
      raw.startsWith('//') || /[\x00-\x20\x7f\\#]/.test(raw)) return reply(404, 'Not found');
  try {
    target = new URL(raw, 'https://kadmeion.invalid');
    if (target.origin !== 'https://kadmeion.invalid' || target.pathname !== raw.split('?')[0])
      return reply(404, 'Not found');
  } catch {
    return reply(404, 'Not found');
  }
  try { supabase = new URL(env.KADMEION_SUPABASE_URL); }
  catch { return reply(503, 'Temporarily unavailable'); }
  const path = target.pathname.match(/^\/u\/([^/]+)(?:\/projects\/([^/]+))?$/);
  const handle = path?.[1] ?? target.searchParams.get('handle');
  const slug = path?.[2] ?? (path ? null : target.searchParams.get('slug'));
  // Never accept a second, untrusted identity in the query string.
  // Rewritten API URLs must carry exactly the named route parameters once.
  const uniqueRoute = path
    ? target.search === ''
    : target.pathname === '/api/published-identity' &&
      target.searchParams.size === (slug === null ? 1 : 2) &&
      target.searchParams.getAll('handle').length === 1 &&
      (slug === null || target.searchParams.getAll('slug').length === 1);
  if (!uniqueRoute || !handlePattern.test(handle ?? '') ||
      (slug !== null && !slugPattern.test(slug))) {
    return reply(404, 'Not found');
  }

  const local = env.KADMEION_LOCAL_INTEGRATION === '1' &&
    ['http://127.0.0.1:54321', 'http://localhost:54321'].includes(supabase.origin);
  const key = env.KADMEION_SUPABASE_SERVICE_ROLE_KEY;
  if ((!local && supabase.origin !== 'https://scyooqjitjzjdxgtanso.supabase.co') ||
      supabase.username || supabase.password || supabase.pathname !== '/' ||
      supabase.search || supabase.hash || typeof key !== 'string' || !key.startsWith('eyJ') || key.length < 70) {
    return reply(503, 'Temporarily unavailable');
  }
  try {
    const rpc = slug ? 'service_read_published_case_study_projection' : 'service_read_published_profile_projection';
    const upstream = await http(new URL('/rest/v1/rpc/' + rpc, supabase), {
      method: 'POST', cache: 'no-store', redirect: 'error', credentials: 'omit',
      headers: {apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'},
      body: JSON.stringify(slug ? {p_handle: handle, p_slug: slug} : {p_handle: handle}),
      signal: AbortSignal.timeout(5000)
    });
    if (!upstream.ok) {
      // Cancellation of one branch of a tee can remain pending. Never let
      // cleanup delay a fail-closed public response or leak upstream details.
      void upstream.body?.cancel().catch(() => {});
      return reply(503, 'Temporarily unavailable');
    }
    const row = await readBoundedRpcJson(upstream);
    if (row === null) return reply(404, 'Not found');
    if (!validProjection(row, handle, slug)) return reply(503, 'Temporarily unavailable');
    const html = render(row, slug);
    // Evidence input only: this digest is of exact served bytes, not a
    // verification receipt or a promise of hosted availability.
    res.setHeader('X-Kadmeion-Served-SHA256', createHash('sha256').update(html,'utf8').digest('hex'));
    return reply(200, html);
  } catch {
    return reply(503, 'Temporarily unavailable');
  }
}

export default handlePublishedIdentity;
