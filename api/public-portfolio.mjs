import {createHash, randomUUID} from 'node:crypto';
import {cancelRpcBody, withDeliveryRpc, parseDeliveryTarget, readBoundedRpcJson, mediaQuery, renderReleaseHtml, readFrozenPng, hasPrivateNoindexMeta} from './_bounded-rpc-json.mjs';

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
const encodedReportBytes = 8192;

async function readReportStream(req,timeoutMs=5000,limit=reportBytes) {
  const iterator=req[Symbol.asyncIterator]();
  let timer,finished=false,expired=false;
  const chunks=[];
  let total=0,count=0;
  const deadline=new Promise((_,reject)=>{
    timer=setTimeout(()=>{expired=true;reject(Error('Report body timed out'));},timeoutMs);
  });
  try {
    const drain=(async()=>{
      for(;;){
        const part=await iterator.next();
        if(expired)throw Error('Report body expired');
        if(part.done){finished=true;break;}
        if(++count>1024||
           !(typeof part.value==='string'||part.value instanceof Uint8Array))
          throw Error('Invalid report stream');
        const chunk=Buffer.from(part.value);
        total+=chunk.length;
        if(total>limit)throw Error('Report body too large');
        if(chunk.length)chunks.push(chunk);
      }
      return Buffer.concat(chunks,total);
    })();
    return await Promise.race([drain,deadline]);
  } finally {
    clearTimeout(timer);
    if(!finished){
      expired=true;
      // A disconnected or stalled sender must not keep a report handler alive.
      try{void Promise.resolve(iterator.return?.()).catch(()=>{});}catch{}
    }
  }
}

// The reporting page is a separate server-owned document, not part of the
// immutable portfolio. Only its form may POST to the same application origin.
function reportOrigin(env) {
  try {
    const u=new URL(env.KADMEION_RELEASE_HOST_ORIGIN);
    const local=env.KADMEION_LOCAL_INTEGRATION==='1'&&u.protocol==='http:'&&
      ['127.0.0.1','localhost'].includes(u.hostname);
    const secure=u.protocol==='https:'&&u.hostname.includes('.')&&
      !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(u.hostname)&&
      !/(?:\.local|\.internal|\.localhost|\.test|\.invalid)$/.test(u.hostname);
    return (local||secure)&&u.hostname===env.KADMEION_RELEASE_HOSTNAME&&
      !u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash ? u.origin : null;
  }catch{return null;}
}

function decodeReportForm(raw) {
  const entries=raw.split('&');
  if(entries.length!==3)return null;
  const result=Object.create(null);
  for(const entry of entries){
    const equal=entry.indexOf('=');
    if(equal<1)return null;
    const decode=value=>decodeURIComponent(value.replaceAll('+',' '));
    const key=decode(entry.slice(0,equal));
    if(!['operationId','reason','evidence'].includes(key)||Object.hasOwn(result,key))return null;
    result[key]=decode(entry.slice(equal+1));
  }
  return result;
}

function reportPath(handle,slug) {
  return '/api/public-portfolio?'+new URLSearchParams({handle,slug,report:'1'}).toString();
}

function reportDocument(title,main) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>'+title+' | Kadmeion</title><style>body{margin:0;background:#f7f8fa;color:#172331;font:16px/1.6 system-ui,sans-serif}main{max-width:36rem;margin:3rem auto;padding:1.5rem}h1{font-size:1.8rem;line-height:1.2}label{display:block;font-weight:600;margin-top:1.2rem}input,select,button{box-sizing:border-box;font:inherit;padding:.75rem;width:100%;border:1px solid #64748b;border-radius:.4rem;background:#fff;color:#172331}button{margin-top:1.5rem;background:#172331;color:white;cursor:pointer}a{color:#184f8f}small{display:block;margin:.5rem 0}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #2563eb;outline-offset:3px}@media(max-width:480px){main{margin:1rem auto;padding:1rem}}</style></head><body><main><p>Kadmeion · Visitor safety</p>'+main+'</main></body></html>';
}

function reportFormDocument(handle,slug) {
  const action=reportPath(handle,slug).replaceAll('&','&amp;');
  const canonical='/'+handle+'/'+slug;
  return reportDocument('Report a portfolio','<h1>Report a public portfolio</h1><p>Target: <strong>'+canonical+'</strong></p><p>Reports are reviewed by authorized moderators. Submitting a report does not automatically remove content. Do not include passwords, contact details or other unnecessary personal information.</p><form method="post" action="'+action+'" accept-charset="UTF-8"><input type="hidden" name="operationId" value="'+randomUUID()+'"><label for="reason">Reason</label><select id="reason" name="reason" required><option value="">Select a reason</option><option value="ABUSE">Serious abuse</option><option value="SECURITY">Phishing or security concern</option><option value="LEGAL">Legal concern</option><option value="SPAM">Spam</option></select><label for="evidence">Describe the concern</label><input type="text" id="evidence" name="evidence" required minlength="20" maxlength="500" aria-describedby="guidance" autocomplete="off"><small id="guidance">20–500 characters. Reports concern the current verified public route at submission.</small><button type="submit">Submit report</button></form><p><a href="'+canonical+'">Return to portfolio</a></p>');
}

function reportResultDocument(status) {
  const accepted=status===202;
  const message=accepted?'Your report was received for review. No removal or other moderation outcome has been promised.':
    status===400?'The report was invalid. Go back and correct the category and description.':
    status===403?'The form must be submitted from this application. Open the report page again.':
    status===404?'This public portfolio is no longer available for reporting.':
    status===429?'The report limit has been reached. Please try again later.':
    status===409?'The report conflicts with a previous submission. Open a new form only if you need to submit a different report.':
    'Receipt not confirmed. Use your browser Back button and retry the unchanged report if needed; do not assume it was received.';
  return reportDocument(accepted?'Report received':'Report not confirmed','<h1>'+(accepted?'Report received':'Report not confirmed')+'</h1><p role="status">'+message+'</p>');
}

async function reportBody(req,form=false) {
  const type = req.headers?.['content-type'];
  const size = req.headers?.['content-length'];
  const encoding = req.headers?.['content-encoding'];
  const limit=form?encodedReportBytes:reportBytes;
  const mime=form?/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i:/^application\/json(?:;\s*charset=utf-8)?$/i;
  if (typeof type !== 'string' || !mime.test(type) ||
      (size !== undefined && (typeof size !== 'string' || !/^\d+$/.test(size) || Number(size)>limit)) ||
      (encoding !== undefined && encoding !== 'identity')) return null;
  let candidate = req.body;
  if (candidate === undefined && req[Symbol.asyncIterator]) {
    candidate = await readReportStream(req,5000,limit);
  }
  if (typeof candidate === 'string' || Buffer.isBuffer(candidate)) {
    const bytes=Buffer.from(candidate);
    if (bytes.length > limit || (size !== undefined && Number(size)!==bytes.length)) return null;
    const decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    candidate=form?decodeReportForm(decoded):JSON.parse(decoded);
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

export function canonicalPublicLink(handle,slug,env) {
  const path='/'+handle+'/'+slug;
  // Only deployment-owned configuration may select an absolute canonical.
  // Never derive it from Host, forwarded headers, or the request target.
  try {
    const origin=new URL(env.KADMEION_RELEASE_HOST_ORIGIN);
    if(origin.protocol==='https:'&&origin.hostname===env.KADMEION_RELEASE_HOSTNAME&&
       origin.hostname.includes('.')&&!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(origin.hostname)&&
       !/(?:\.local|\.internal|\.localhost|\.test|\.invalid)$/.test(origin.hostname)&&
       !origin.username&&!origin.password&&origin.pathname==='/'&&!origin.search&&!origin.hash)
      return '<'+new URL(path,origin).href+'>; rel="canonical"';
  }catch{}
  // A relative same-origin link is valid metadata without inventing a host.
  return '<'+path+'>; rel="canonical"';
}

export async function handlePublicPortfolio(req, res, {env = process.env, http = fetch} = {}) {
  function reply(status, body, type, indexable = false, media = false, reportUi = false) {
    res.statusCode = status;
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src " + (media ? "'self'" : "'none'") + "; frame-ancestors 'none'; base-uri 'none'" + (reportUi ? "; form-action 'self'" : ''));
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
    const target = parseDeliveryTarget(req.url);
    if (!target) return reply(404, 'Not found');
    const path = target.pathname.match(/^\/([^/]+)\/([^/]+)$/);
    const rewritten = target.pathname === '/api/public-portfolio';
    const assetRequest = target.searchParams.has('asset') || target.searchParams.has('manifest');
    const reportUi=rewritten&&target.searchParams.getAll('report').length===1&&target.searchParams.get('report')==='1';
    const media = rewritten && assetRequest ? mediaQuery(target.searchParams) : null;
    if (assetRequest && (!media || reporting || reportUi)) return reply(404, 'Not found');
    const handle = rewritten ? target.searchParams.get('handle') : path?.[1];
    const slug = rewritten ? target.searchParams.get('slug') : path?.[2];
    // Reject ambiguous duplicate route parameters and shadow query strings.
    // A host/CDN may parse repeated keys differently from URLSearchParams.get().
    const uniqueRoute = rewritten
      ? target.searchParams.size === (media ? 4 : reportUi ? 3 : 2) &&
        target.searchParams.getAll('handle').length === 1 &&
        target.searchParams.getAll('slug').length === 1
      : Boolean(path) && target.search === '';
    if (!uniqueRoute || !handlePattern.test(handle ?? '') || reservedHandles.has(handle) ||
        !slugPattern.test(slug ?? '')) return reply(404, 'Not found');
    const reportResponse=(status,body,type)=>reportUi?
      reply(status,reportResultDocument(status),'text/html; charset=utf-8',false,false,true):reply(status,body,type);
    if(reportUi){
      const trusted=reportOrigin(env);
      if(!trusted)return reportResponse(503,'Temporarily unavailable');
      if(reporting&&(req.headers?.origin!==trusted||
         (req.headers?.['sec-fetch-site']!==undefined&&req.headers['sec-fetch-site']!=='same-origin')))
        return reportResponse(403,'Forbidden');
    }
    let report;
    if (reporting) {
      try { report = await reportBody(req,reportUi); }
      catch { return reportResponse(400, 'Invalid report'); }
      if (!report) return reportResponse(400, 'Invalid report');
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
    const upstream = await withDeliveryRpc(http,new URL('/rest/v1/rpc/' + rpc, origin), {
      method: 'POST', redirect: 'error', cache: 'no-store', credentials: 'omit',
      headers: {apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'},
      body: JSON.stringify({p_handle: handle, p_slug: slug, ...report, ...media})
    }, async response=>{
      if(reporting)return {ok:response.ok,body:await readBoundedRpcJson(response,4096)};
      if(!response.ok){cancelRpcBody(response.body);return {ok:false,body:null};}
      return {ok:true,body:media?await readFrozenPng(response,media.p_sha):await readBoundedRpcJson(response)};
    });
    if (reporting) {
      const receipt = upstream.body;
      if (upstream.ok && receipt?.status === 'RECEIVED_FOR_REVIEW' && Object.keys(receipt).length === 1)
        return reportResponse(202, JSON.stringify(receipt), 'application/json; charset=utf-8');
      if (!upstream.ok && receipt?.message === 'PUBLIC_PORTFOLIO_NOT_FOUND') return reportResponse(404, 'Not found');
      if (!upstream.ok && receipt?.message === 'ABUSE_REPORT_RATE_LIMIT') return reportResponse(429, 'Please try again later');
      if (!upstream.ok && receipt?.message === 'ABUSE_REPORT_OPERATION_CONFLICT') return reportResponse(409, 'Report conflicts with a previous submission');
      return reportResponse(503, 'Temporarily unavailable');
    }
    if (!upstream.ok) {
      return reply(503, 'Temporarily unavailable');
    }

    if (media) {
      const png = upstream.body;
      return png ? reply(200, png, 'image/png') : reply(404, 'Not found');
    }
    const release = upstream.body;
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
    if(reportUi){
      if(!release.indexable)return reply(404,'Not found');
      return reply(200,reportFormDocument(handle,slug),'text/html; charset=utf-8',false,false,true);
    }
    const published = release.indexable ? rendered.html.replace(stagedRobots, publicRobots) : rendered.html;
    res.setHeader('X-Kadmeion-Served-SHA256',
      createHash('sha256').update(published).digest('hex'));
    if(release.indexable)res.setHeader('Link',canonicalPublicLink(handle,slug,env));
    return reply(200, published, undefined, release.indexable, rendered.media);
  } catch {
    return reply(503, 'Temporarily unavailable');
  }
}

export default handlePublicPortfolio;
