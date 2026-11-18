import {createHash} from 'node:crypto';
import {readBoundedRpcJson, cancelRpcBody} from './_bounded-rpc-json.mjs';
const handlePattern = /^[a-z][a-z0-9_]{2,29}$/;
const slugPattern = /^(?=.{3,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Static, source-derived public shell tokens; never interpolate owner data into CSS.
// A hash authorizes this one stylesheet without permitting arbitrary inline CSS.
const projectionCss = `:root{color-scheme:light;font-family:Inter,"Helvetica Neue",Arial,system-ui,sans-serif;--surface:#fafaf9;--ink:#0b1a21;--body:#536b7b;--line:#dbe1e4;--accent:#a55229;--focus:#2869b0;background:var(--surface);color:var(--ink)}
*,*::before,*::after{box-sizing:border-box}body{margin:0;line-height:1.65}a{color:var(--accent);text-decoration-thickness:.08em;text-underline-offset:.18em;overflow-wrap:anywhere}a:focus-visible{outline:3px solid var(--focus);outline-offset:4px}.skip{position:absolute;left:1rem;top:-8rem;padding:.7rem 1rem;background:var(--ink);color:#fff}.skip:focus{top:1rem;z-index:10}.shell{border-bottom:1px solid var(--line);padding:.8rem clamp(1rem,5vw,4rem)}.shell nav{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem 1.5rem;max-width:80rem;margin:auto}.shell a{display:inline-flex;align-items:center;min-height:44px;padding:.25rem;color:var(--ink)}.shell .home{font-weight:750;margin-right:auto}main{max-width:72rem;margin:auto;padding:clamp(2rem,7vw,6rem) clamp(1rem,5vw,4rem);overflow-wrap:anywhere}main:focus-visible{outline:3px solid var(--focus);outline-offset:-4px}.eyebrow{display:block;font-size:.78rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--body);margin-bottom:1rem}h1,h2{font-family:Georgia,"Times New Roman",serif;font-weight:500;letter-spacing:-.025em;line-height:1.12}h1{font-size:clamp(2.15rem,6vw,4.7rem);margin:0 0 1.5rem}h2{font-size:clamp(1.45rem,3vw,2.2rem);margin:0 0 1rem}p{max-width:68ch;color:var(--body);font-size:1.05rem;margin:0 0 1.1rem}section{padding:1.6rem 0;border-top:1px solid var(--line);margin-top:1.6rem}.projection-links{display:flex;flex-wrap:wrap;gap:.75rem 1.25rem;margin:1.5rem 0}.projection-links a{display:inline-flex;min-height:44px;align-items:center} @media (max-width:480px){.shell nav{gap:.25rem .7rem}.shell .home{flex-basis:100%;margin-right:0}} @media print{.shell,.skip{display:none}main{padding:0}section{break-inside:avoid}}`;
const projectionStyleHash = createHash('sha256').update(projectionCss,'utf8').digest('base64');
const projectionCsp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; style-src 'sha256-"+projectionStyleHash+"'";
const publicShell = '<a class="skip" href="#published-content">Skip to content</a><header class="shell"><nav aria-label="Kadmeion navigation"><a class="home" href="/">Kadmeion</a><a href="/explore">Explore</a><a href="/templates">Templates</a></nav></header>';
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
  if (typeof value !== 'string' || !value.trim()) return '';
  // Preserve authored paragraphs and line breaks using escaped text only.
  return value.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/)
    .filter(block => block.trim())
    .map(block => '<p>' + escape(block).replace(/\n/g, '<br>') + '</p>').join('');
}

function render(projection, slug) {
  const name = typeof projection.displayName === 'string' && projection.displayName.trim()
    ? projection.displayName : projection.handle;
  const title = escape(slug ? projection.title : name);
  const links = slug ? [link('View live project', projection.liveUrl), link('View repository', projection.repositoryUrl)].filter(Boolean) : [];
  const content = slug
    ? paragraph(projection.summary) + paragraph(projection.description) +
      (links.length ? '<div class="projection-links">' + links.join('') + '</div>' : '') +
      projection.sections.map(section =>
        '<section><h2>' + escape(section.title) + '</h2>' + paragraph(section.body) + '</section>').join('')
    : paragraph(projection.headline) + paragraph(projection.bio);
  // SEO text is taken only from already-consented public projection fields.
  // Do not synthesize an author biography, claim verification or expose raw JSON.
  const visibleDescription = slug ? projection.summary :
    (typeof projection.headline === 'string' && projection.headline.trim() ? projection.headline : projection.bio);
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
    '</title><meta name="robots" content="noindex,nofollow,noarchive">' + description + shareMetadata + '<style>' + projectionCss + '</style></head><body>' +
    publicShell + '<main id="published-content" tabindex="-1"><span class="eyebrow">' + (slug?'Project case study':'Developer profile') + '</span><h1>' + title + '</h1>' +
    content + '</main></body></html>';
}

// Route grammar is evaluated on literal bytes, not a decoded or normalized URL.
// PostgREST scalar RPCs may return an item range even with HTTP 200.
// Accept only a complete singleton row, never a byte range or partial page.
function completeScalarRpcRange(headers) {
  const range=headers.get('content-range');
  const unit=headers.get('range-unit');
  return (unit===null||unit.toLowerCase()==='items')&&
    (range===null||range==='0-0/*'||range==='0-0/1');
}

function parseIdentityRoute(raw) {
  if (typeof raw !== 'string' || raw.length > 2048 ||
      /[\x00-\x20\x7f\\#]/.test(raw)) return null;
  const direct = /^\/u\/([^/?]+)(?:\/projects\/([^/?]+))?$/.exec(raw);
  const alias = /^\/api\/published-identity\?handle=([^&]+)(?:&slug=([^&]+))?$/.exec(raw);
  const reversed = /^\/api\/published-identity\?slug=([^&]+)&handle=([^&]+)$/.exec(raw);
  const handle = direct?.[1] ?? alias?.[1] ?? reversed?.[2];
  const slug = direct?.[2] ?? alias?.[2] ?? reversed?.[1] ?? null;
  if (!handlePattern.test(handle ?? '') || (slug !== null && !slugPattern.test(slug))) return null;
  return {handle, slug};
}

// Negotiate only a bounded, explicit browser HTML preference. API callers
// without it continue to receive the existing generic plain-text status.
function wantsIdentityStatusHtml(req) {
  const accept = req.headers?.accept;
  if (typeof accept !== 'string' || accept.length > 2048) return false;
  return accept.split(',').some(entry => {
    const [type, ...params] = entry.trim().toLowerCase().split(';');
    if (type.trim() !== 'text/html') return false;
    const quality = params.map(value => value.trim()).filter(value => value.startsWith('q='));
    if (quality.length === 0) return true;
    return quality.length === 1 && /^q=(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/.test(quality[0]) && Number(quality[0].slice(2)) > 0;
  });
}

function renderIdentityStatus(status) {
  const unavailable = status === 503;
  const title = unavailable ? 'Public page temporarily unavailable' : 'Public page unavailable';
  const message = unavailable
    ? 'The public delivery service could not confirm this page. Retry this address or explore other work.'
    : 'This address may be private, withdrawn, unpublished or unavailable.';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>' + title +
    ' · Kadmeion</title><meta name="robots" content="noindex,nofollow,noarchive"><style>' + projectionCss +
    '</style></head><body>' + publicShell + '<main id="published-content" tabindex="-1">' +
    '<span class="eyebrow">Public delivery · Content withheld</span><h1>' + title + '</h1><p>' + message + '</p>' +
    '<p>For privacy, this response does not confirm whether an account or project exists.</p>' +
    '<div class="projection-links"><a href="/">Kadmeion home</a><a href="/explore">Explore portfolios</a>' +
    (unavailable ? '<a href="">Retry this address</a>' : '') + '</div></main></body></html>';
}

export async function handlePublishedIdentity(req, res, {env = process.env, http = fetch} = {}) {
  function reply(status, body) {
    const statusHtml = (status === 404 || status === 503) && wantsIdentityStatusHtml(req);
    if (statusHtml) body = renderIdentityStatus(status);
    res.statusCode = status;
    res.setHeader('Vary', 'Accept');
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
    res.setHeader('Content-Security-Policy', (status===200 || statusHtml) ? projectionCsp : "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    res.setHeader('Content-Type', (status === 200 || statusHtml) ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8');
    // GET and HEAD attest the same representation; HEAD never sends its body.
    res.setHeader('Content-Length', String(Buffer.byteLength(body, 'utf8')));
    res.end(req.method === 'HEAD' ? '' : body);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return reply(405, 'Method not allowed');
  }
  if (env.KADMEION_PUBLIC_IDENTITY_ENABLED !== 'true') return reply(404, 'Not found');
  const route = parseIdentityRoute(req.url);
  // An invalid target is always unavailable, even during a configuration outage.
  if (!route) return reply(404, 'Not found');
  const {handle, slug} = route;
  let supabase;
  try { supabase = new URL(env.KADMEION_SUPABASE_URL); }
  catch { return reply(503, 'Temporarily unavailable'); }

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
    const rpcUrl = new URL('/rest/v1/rpc/' + rpc, supabase);
    const signal = AbortSignal.timeout(5000);
    const expiresAt = performance.now() + 5000;
    const expired = () => signal.aborted || performance.now() >= expiresAt;
    let upstream;
    let onAbort;
    const deadline = new Promise((_, reject) => {
      onAbort = () => {
        cancelRpcBody(upstream?.body);
        reject(Error('Public projection request expired'));
      };
      signal.addEventListener('abort', onAbort, {once:true});
    });
    const load = async () => {
      upstream = await http(rpcUrl, {
        method: 'POST', cache: 'no-store', redirect: 'error', credentials: 'omit',
        headers: {apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'},
        body: JSON.stringify(slug ? {p_handle: handle, p_slug: slug} : {p_handle: handle}), signal
      });
      if (expired() || upstream.status !== 200 || !completeScalarRpcRange(upstream.headers) ||
          upstream.redirected || (upstream.url && upstream.url !== rpcUrl.href)) {
        cancelRpcBody(upstream.body);
        throw Error('Public projection not confirmed');
      }
      const projection = await readBoundedRpcJson(upstream, undefined, signal);
      if (expired()) throw Error('Public projection request expired');
      return projection;
    };
    let row;
    try {
      row = await Promise.race([load(), deadline]);
      if (expired()) throw Error('Public projection request expired');
    } finally { signal.removeEventListener('abort', onAbort); }
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
