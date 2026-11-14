const handlePattern = /^[a-z][a-z0-9_]{2,29}$/;
const slugPattern = /^(?=.{3,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const entities = {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'};

function escape(value) {
  return typeof value === 'string' ? value.replace(/[&<>"']/g, char => entities[char]) : '';
}

function link(label, value) {
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
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>' + title +
    '</title></head><body><main><h1>' + title + '</h1>' + content + '</main></body></html>';
}

export async function handlePublishedIdentity(req, res, {env = process.env, http = fetch} = {}) {
  function reply(status, body) {
    res.statusCode = status;
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
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
  try {
    target = new URL(req.url, 'https://kadmeion.invalid');
    supabase = new URL(env.KADMEION_SUPABASE_URL);
  } catch {
    return reply(404, 'Not found');
  }
  const path = target.pathname.match(/^\/u\/([^/]+)(?:\/projects\/([^/]+))?$/);
  const handle = path?.[1] ?? target.searchParams.get('handle');
  const slug = path?.[2] ?? (path ? null : target.searchParams.get('slug'));
  if ((!path && target.pathname !== '/api/published-identity') ||
      !handlePattern.test(handle ?? '') || (slug !== null && !slugPattern.test(slug))) {
    return reply(404, 'Not found');
  }

  const local = env.KADMEION_LOCAL_INTEGRATION === '1' &&
    ['http://127.0.0.1:54321', 'http://localhost:54321'].includes(supabase.origin);
  const key = env.KADMEION_SUPABASE_SERVICE_ROLE_KEY;
  if ((!local && supabase.origin !== 'https://scyooqjitjzjdxgtanso.supabase.co') ||
      supabase.username || supabase.password || supabase.pathname !== '/' ||
      supabase.search || supabase.hash || typeof key !== 'string' || !key.startsWith('eyJ')) {
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
      await upstream.body?.cancel();
      return reply(503, 'Temporarily unavailable');
    }
    const row = await upstream.json();
    if (row === null) return reply(404, 'Not found');
    if (row?.handle !== handle || (slug && (row.slug !== slug || typeof row.title !== 'string' ||
        !Array.isArray(row.sections) || row.sections.length > 24 ||
        row.sections.some(section => !section || typeof section.title !== 'string' || typeof section.body !== 'string')))) {
      return reply(503, 'Temporarily unavailable');
    }
    return reply(200, render(row, slug));
  } catch {
    return reply(503, 'Temporarily unavailable');
  }
}

export default handlePublishedIdentity;
