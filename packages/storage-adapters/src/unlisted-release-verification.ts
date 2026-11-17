import {createHash} from 'node:crypto';
import {HANDLE_PATTERN,RESERVED_HANDLES} from '../../contracts/src/project.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_HTML_BYTES = 750_000;
const PORTFOLIO_SLUG = /^(?=.{3,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

type VerificationOperation = 'service_acknowledge_unlisted_release' |
  'service_recover_failed_unlisted_release';
type PublicationOperation = VerificationOperation | 'service_prepare_unlisted_release' |
  'service_probe_unlisted_release' | 'service_activate_unlisted_release';

type VerificationPorts = {
  origin: string;
  rpc: (operation: VerificationOperation, input: Record<string, string>) => Promise<unknown>;
  http?: typeof fetch;
};

type Activation = {
  portfolioId: string;
  intentId: string;
  htmlSha256: string;
  publicPath?: string;
};

export type DeliveryVerification =
  | {status: 'DELIVERY_ACKNOWLEDGED'; htmlSha256: string}
  | {status: 'DELIVERY_REVOKED'}
  | {status: 'PRIOR_RELEASE_RESTORED'; releaseGeneration: number};

function validPortfolioRoute(handle:unknown,slug:unknown):boolean {
  return typeof handle==='string'&&HANDLE_PATTERN.test(handle)&&!RESERVED_HANDLES.has(handle)&&
    typeof slug==='string'&&PORTFOLIO_SLUG.test(slug);
}

const CACHE_HEADERS=['cache-control','cdn-cache-control','vercel-cdn-cache-control','surrogate-control'] as const;
const SERVED_SHA='x-kadmeion-served-sha256';
const cacheTokens=(value:string)=>value.toLowerCase().split(',').map(part=>part.trim()).filter(Boolean);

function safeCacheHeaders(headers:Headers):boolean {
  // An explicit positive Age is inconsistent with a fresh no-store sample.
  const age=headers.get('age');
  if(age!==null&&!/^0+$/.test(age.trim()))return false;
  return CACHE_HEADERS.every(name=>{
    const value=headers.get(name);
    if(value===null)return name!=='cache-control';
    const directives=cacheTokens(value);
    return directives.includes('no-store')&&!directives.includes('public')&&
      !directives.includes('immutable')&&
      directives.every(part=>!/^(?:s?max-age|stale-while-revalidate|stale-if-error)\b/.test(part)||
        /^(?:s?max-age|stale-while-revalidate|stale-if-error)\s*=\s*(?:0+|"0+")$/.test(part));
  });
}

function safeRobots(value:string,indexable:boolean):boolean {
  const robots=cacheTokens(value);
  return robots.includes(indexable?'index':'noindex')&&
    !robots.includes(indexable?'noindex':'index')&&!robots.includes('none')&&
    !robots.some(part=>part.includes(':'));
}

function safeCsp(value:string):boolean {
  return value.toLowerCase().split(',').some(policy=>{
    const csp=policy.split(';').map(directive=>directive.trim().split(/\s+/));
    const defaults=csp.filter(([name])=>name==='default-src');
    const overrides=csp.filter(([name])=>
      ['script-src','script-src-elem','script-src-attr','child-src','worker-src'].includes(name));
    return defaults.length===1&&[...defaults,...overrides].every(directive=>
      directive.length===2&&directive[1]==="'none'");
  });
}

function safeDeliveryResponse(response:Response,route:URL,indexable:boolean,media=false):boolean {
  const h=response.headers;
  if(response.status!==200||response.redirected||h.has('location')||
      (response.url!==''&&response.url!==route.href)||!safeCacheHeaders(h))return false;
  const type=h.get('content-type')??'';
  if(media){
    // PNG delivery never inherits the indexability of the surrounding page.
    // Some static origins omit document-only policy headers for binary media.
    return /^image\/png$/i.test(type)&&
      (!h.has('x-robots-tag')||safeRobots(h.get('x-robots-tag')!,false))&&
      (!h.has('content-security-policy')||safeCsp(h.get('content-security-policy')!));
  }
  return /^text\/html(?:;|$)/i.test(type)&&
    safeRobots(h.get('x-robots-tag')??'',indexable)&&
    safeCsp(h.get('content-security-policy')??'');
}

function sameDeliveryPolicy(get:Headers,head:Headers):boolean {
  // Compare observable representation policy, not transport-only headers
  // such as Content-Length, Date, or content encoding.
  for(const name of [...CACHE_HEADERS,'x-robots-tag']){
    const a=get.get(name),b=head.get(name);
    if(a===null||b===null){if(a!==b)return false;continue;}
    if(cacheTokens(a).sort().join(',')!==cacheTokens(b).sort().join(','))return false;
  }
  const mime=(h:Headers)=>(h.get('content-type')??'').toLowerCase().replace(/\s+/g,'');
  const csp=(h:Headers)=>(h.get('content-security-policy')??'').split(';')
    .map(part=>part.trim().replace(/\s+/g,' ')).filter(Boolean).join(';');
  return mime(get)===mime(head)&&csp(get)===csp(head);
}

function optionalServedDigest(headers:Headers,sha:string):boolean {
  const claimed=headers.get(SERVED_SHA);
  // GET establishes the digest from actual bytes. HEAD has no bytes and
  // the served SHA header is not a universal hosting/asset contract.
  return claimed===null||claimed===sha;
}

async function bodylessHead(response:Response):Promise<boolean> {
  if(!response.body)return true;
  const reader=response.body.getReader();
  try{
    // Do not confuse an initial empty chunk with end of stream.
    for(let i=0;i<16;i++){
      const part=await reader.read();
      if(part.done)return true;
      if(!(part.value instanceof Uint8Array)||part.value.byteLength!==0)return false;
    }
    return false;
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

function deliveryFetch(http:typeof fetch,route:URL,method:'GET'|'HEAD'):Promise<Response>{
  return http(route,{method,credentials:'omit',cache:'no-store',redirect:'error',
    signal:AbortSignal.timeout(5000)});
}

async function verifyHead(http:typeof fetch,route:URL,get:Response,
  sha:string,indexable:boolean,media=false):Promise<boolean>{
  const head=await deliveryFetch(http,route,'HEAD');
  if(!safeDeliveryResponse(head,route,indexable,media)||
      !sameDeliveryPolicy(get.headers,head.headers)||!optionalServedDigest(head.headers,sha)){
    await head.body?.cancel();
    return false;
  }
  return bodylessHead(head);
}

const DELIVERY_IMAGE=/<img loading="lazy" decoding="async" src="([^"<>]+)" alt="[^"<>]*" width="[1-9][0-9]{0,3}" height="[1-9][0-9]{0,3}">/g;

async function readBounded(response:Response, limit:number):Promise<Buffer|null> {
  const reader=response.body?.getReader();
  if(!reader) return null;
  const chunks:Uint8Array[]=[];
  let size=0;
  try{
    for(;;){
      const chunk=await reader.read();
      if(chunk.done) break;
      size+=chunk.value.byteLength;
      if(size>limit){await reader.cancel();return null;}
      chunks.push(chunk.value);
    }
    return size ? Buffer.concat(chunks) : null;
  }finally{reader.releaseLock();}
}

async function digestHtml(response:Response, indexable:boolean, route:URL,
  host:URL, http:typeof fetch, expectedSha:string):Promise<string|null> {
  if(!safeDeliveryResponse(response,route,indexable)){
    await response.body?.cancel();
    return null;
  }
  const bytes=await readBounded(response,MAX_HTML_BYTES);
  if(!bytes)return null;
  const servedSha=createHash('sha256').update(bytes).digest('hex');
  if(!optionalServedDigest(response.headers,servedSha))return null;
  let html=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  if(indexable){
    const marker='<meta name="robots" content="index,follow">';
    if(html.split(marker).length!==2)return null;
    html=html.replace(marker,'<meta name="robots" content="noindex,nofollow,noarchive">');
  }
  const media=new Map<string,string>();
  const unlisted=route.pathname==='/api/unlisted';
  const [,handle,slug]=route.pathname.split('/');
  let manifest:string|undefined;
  const images=[...html.matchAll(DELIVERY_IMAGE)];
  if((html.match(/<img\b/gi)??[]).length!==images.length)return null;
  for(const [,src] of images){
    const asset=new URL(src.replaceAll('&amp;','&'),host);
    const sha=asset.searchParams.get('asset');
    const candidate=asset.searchParams.get('manifest');
    if(!sha||!SHA256.test(sha)||!candidate||!SHA256.test(candidate)||
       (manifest!==undefined&&candidate!==manifest)) return null;
    manifest=candidate;
    const scope:Record<string,string>=unlisted ? {portfolioId:route.searchParams.get('portfolioId')!} : {handle,slug};
    const expected=(unlisted?'/api/unlisted':'/api/public-portfolio')+'?'+
      new URLSearchParams({...scope,manifest,asset:sha}).toString().replaceAll('&','&amp;');
    if(src!==expected)return null;
    media.set(src,sha);
    if(media.size>8)return null;
  }
  // Only reverse URLs in the renderer's exact image tags. Text and links
  // containing URL-like user content must retain their original bytes.
  const frozen=html.replace(DELIVERY_IMAGE,(tag,src:string)=>
    tag.replace(src,'./assets/'+media.get(src)+'.png'));
  const digest=createHash('sha256').update(frozen).digest('hex');
  if(digest!==expectedSha)return null;
  // Verify the canonical representation before sampling any direct assets.
  if(!await verifyHead(http,route,response,servedSha,indexable))return null;
  for(const [src,sha] of media){
    const assetRoute=new URL(src.replaceAll('&amp;','&'),host);
    const png=await deliveryFetch(http,assetRoute,'GET');
    if(!safeDeliveryResponse(png,assetRoute,false,true)){
      await png.body?.cancel();
      return null;
    }
    const image=await readBounded(png,4_000_000);
    if(!image||createHash('sha256').update(image).digest('hex')!==sha||
       !optionalServedDigest(png.headers,sha))return null;
    if(!await verifyHead(http,assetRoute,png,sha,false,true))return null;
  }
  return digest;
}

/** Trusted worker only. The configured origin must come from server configuration. */
export async function verifyActivatedUnlistedRelease(
  activation: Activation,
  {origin, rpc, http = fetch}: VerificationPorts,
  policy: 'RECOVER_UNVERIFIED_ACTIVATION' | 'CHECK_ACKNOWLEDGED_ONLY' = 'RECOVER_UNVERIFIED_ACTIVATION'
): Promise<DeliveryVerification> {
  const {portfolioId, intentId, htmlSha256, publicPath} = activation;
  const host = deliveryHost(origin);
  if (!UUID.test(portfolioId) || !UUID.test(intentId) || !SHA256.test(htmlSha256)) {
    throw new Error('Invalid trusted release verification input.');
  }

  if (publicPath !== undefined) {
    const [root,handle,slug,...rest]=publicPath.split('/');
    if(root!==''||rest.length!==0||!validPortfolioRoute(handle,slug))
      throw new Error('Invalid public portfolio path.');
  }
  const route = new URL(publicPath ?? '/api/unlisted', host);
  if (publicPath === undefined) route.searchParams.set('portfolioId', portfolioId);
  const checkHost = async(indexable:boolean):Promise<string|null>=>{
    try {
      return await digestHtml(await deliveryFetch(http,route,'GET'),
        indexable,route,host,http,htmlSha256);
    }catch{return null;}
  };
  // A newly activated PUBLIC route serves a noindex canary UNTIL the
  // database records a trusted same-byte host acknowledgment. Verify the
  // canary as non-indexable; an already acknowledged PUBLIC route must be
  // indexable and match the same immutable source digest.
  const publicRoute=publicPath!==undefined;
  const initialIndexable=publicRoute&&policy==='CHECK_ACKNOWLEDGED_ONLY';
  const actualDigest=await checkHost(initialIndexable);
  if (actualDigest === htmlSha256) {
    if (policy === 'CHECK_ACKNOWLEDGED_ONLY')
      return {status: 'DELIVERY_ACKNOWLEDGED', htmlSha256};
    const ack = await rpc('service_acknowledge_unlisted_release', {
      p_portfolio_id: portfolioId, p_intent_id: intentId, p_html_sha256: htmlSha256
    });
    if (ack !== true) throw new Error('Release delivery acknowledgment was not confirmed.');
    // Indexing changes the delivered robots marker; prove the AFTER-ack
    // response, not merely the preceding private noindex canary. A failure
    // cannot roll back a now-acknowledged live pointer on this read.
    if(publicRoute && await checkHost(true)!==htmlSha256)
      throw new Error('Acknowledged public release failed its indexable HTTP verification.');
    return {status: 'DELIVERY_ACKNOWLEDGED', htmlSha256};
  }

  // A transient outage of an already-acknowledged release must not
  // roll back or mutate a previously verified live pointer on a read.
  if (policy === 'CHECK_ACKNOWLEDGED_ONLY')
    throw new Error('Acknowledged release failed its current external HTTP check.');
  const receipt = await rpc('service_recover_failed_unlisted_release', {
    p_portfolio_id: portfolioId, p_failed_intent_id: intentId
  });
  if (typeof receipt !== 'object' || receipt === null ||
      !('portfolioId' in receipt) || receipt.portfolioId !== portfolioId ||
      !('status' in receipt) || !('releaseGeneration' in receipt)) {
    throw new Error('Release delivery recovery was not confirmed.');
  }
  if (receipt.status === 'REVOKED' && receipt.releaseGeneration === null) {
    return {status: 'DELIVERY_REVOKED'};
  }
  const generation = receipt.releaseGeneration;
  if (receipt.status === 'RESTORED_NEEDS_EXTERNAL_HTTP_VERIFICATION' &&
      typeof generation === 'number' && Number.isSafeInteger(generation) && generation > 0) {
    return {status: 'PRIOR_RELEASE_RESTORED', releaseGeneration: generation};
  }
  throw new Error('Release delivery recovery was not confirmed.');
}

function deliveryHost(origin: string): URL {
  const host = new URL(origin);
  if ((host.protocol !== 'https:' &&
       !(host.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(host.hostname))) ||
      host.username || host.password || host.pathname !== '/' || host.search || host.hash) {
    throw new Error('Invalid trusted release delivery origin.');
  }
  return host;
}

/** Run for an owner consent ID already recorded by Supabase. Retry with the same ID. */
export async function publishConsentedUnlistedRelease(
  intentId: string,
  ports: Omit<VerificationPorts, 'rpc'> & {
    rpc: (operation: PublicationOperation, input: Record<string, string | number>) => Promise<unknown>;
  }
): Promise<DeliveryVerification> {
  deliveryHost(ports.origin);
  if (typeof intentId !== 'string' || !UUID.test(intentId)) throw new Error('Invalid publication consent.');

  const {rpc} = ports;
  const prepared = await rpc('service_prepare_unlisted_release', {p_intent_id: intentId});
  if (!record(prepared) || typeof prepared.portfolioId !== 'string' || !UUID.test(prepared.portfolioId) ||
      typeof prepared.htmlSha256 !== 'string' || !SHA256.test(prepared.htmlSha256) ||
      typeof prepared.releaseGeneration !== 'number' || !Number.isSafeInteger(prepared.releaseGeneration) ||
      prepared.releaseGeneration < 1 || prepared.publicServingEnabled !== false || prepared.publicUrl !== null) {
    throw new Error('Unlisted release preparation was not confirmed.');
  }
  const {portfolioId, htmlSha256, releaseGeneration, publicHandle, publicSlug} = prepared;
  let publicPath: string | undefined;
  if (publicHandle != null || publicSlug != null) {
    if (!validPortfolioRoute(publicHandle,publicSlug)) {
      throw new Error('Invalid public portfolio route.');
    }
    publicPath = '/' + publicHandle + '/' + publicSlug;
  }
  switch (prepared.status) {
    case 'ACKNOWLEDGED':
      return verifyActivatedUnlistedRelease(
        {portfolioId, intentId, htmlSha256, publicPath}, ports, 'CHECK_ACKNOWLEDGED_ONLY');
    case 'AWAITING_VERIFICATION':
      break;
    case 'PROBE_PENDING': {
      const probe = await rpc('service_probe_unlisted_release', {p_portfolio_id: portfolioId});
      if (!record(probe) || probe.status !== 'PROBE_PENDING' ||
          probe.intentId !== intentId || probe.releaseGeneration !== releaseGeneration ||
          probe.htmlSha256 !== htmlSha256 || probe.publicServingEnabled !== false ||
          typeof probe.html !== 'string' || Buffer.byteLength(probe.html) > MAX_HTML_BYTES ||
          createHash('sha256').update(probe.html).digest('hex') !== htmlSha256) {
        throw new Error('The private release changed before activation.');
      }
      const active = await rpc('service_activate_unlisted_release', {
        p_portfolio_id: portfolioId, p_expected_generation: releaseGeneration,
        p_intent_id: intentId, p_html_sha256: htmlSha256
      });
      if (!record(active) || active.status !== 'ACTIVATED_NEEDS_EXTERNAL_HTTP_VERIFICATION' ||
          active.portfolioId !== portfolioId || active.releaseGeneration !== releaseGeneration ||
          active.htmlSha256 !== htmlSha256 || active.publicUrl !== null ||
          active.hostRevocationVerified !== false) {
        throw new Error('Unlisted activation was not confirmed. Retry with the same consent.');
      }
      break;
    }
    default:
      throw new Error('Unexpected unlisted publication status.');
  }
  return verifyActivatedUnlistedRelease({portfolioId, intentId, htmlSha256, publicPath}, ports);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
