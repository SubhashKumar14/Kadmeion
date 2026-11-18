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

type PublicAuthorityOperation = 'service_read_current_public_delivery_receipt' |
  'service_acknowledge_public_delivery' | 'service_recover_failed_public_delivery';
export type PublicAuthorityRpc = (operation:PublicAuthorityOperation,input:Record<string,unknown>)=>Promise<unknown>;
type VerificationPorts = {
  origin: string;
  rpc: (operation: VerificationOperation, input: Record<string, string>) => Promise<unknown>;
  http?: typeof fetch;
  /** Production server requires independent canonical and public API samples. */
  requirePublicAliasProof?: boolean;
  /** Trusted-only paired SQL authority. Do not supply until migration, ACL and legacy PUBLIC cutover are verified. */
  publicAuthority?: PublicAuthorityRpc;
};

type Activation = {
  portfolioId: string;
  intentId: string;
  htmlSha256: string;
  publicPath?: string;
  releaseGeneration?: number;
  requestId?: string;
  operationId?: string;
};

type PublicDeliveryObservation = {
  portfolioId:string; intentId:string; preparedReleaseGeneration:number;
  canonicalPath:string; apiPath:string; servedHtmlSha256:string;
  observedMediaManifest:string|null; observedAssetHashes:readonly string[];
  observedHttpRequests:number;
};
type DeliverySample = {
  htmlSha256:string; servedHtmlSha256:string; apiPath:string|null;
  mediaManifest:string|null; assetHashes:readonly string[]; observedHttpRequests:number;
};
export type DeliveryVerification =
  | {status: 'DELIVERY_ACKNOWLEDGED'; htmlSha256: string;
      observedPublicDelivery?: PublicDeliveryObservation;
      authoritativePublicReceipt?: AuthorityReceipt}
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
      directives.every(part=>!/^(?:max-age|s-maxage|s-max-age|stale-while-revalidate|stale-if-error)\b/.test(part)||
        /^(?:max-age|s-maxage|s-max-age|stale-while-revalidate|stale-if-error)\s*=\s*(?:0+|"0+")$/.test(part));
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
  if(get.get('link')!==head.get('link'))return false;
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

const DELIVERY_TIMEOUT_MS=5_000;

// Cancelling a tee branch or an injected transport can return a promise that
// never settles. Cleanup must never gate a verification or recovery receipt.
function cancelQuietly(body:{cancel:()=>Promise<void>}|null|undefined):void {
  try{void body?.cancel().catch(()=>{});}catch{/* best-effort cleanup only */}
}

// A single deadline covers fetch AND body consumption, including injected
// transports that ignore AbortSignal. Late responses are discarded.
async function sampleDelivery<T>(http:typeof fetch,route:URL,method:'GET'|'HEAD',
  consume:(response:Response,signal:AbortSignal)=>Promise<T>):Promise<T>{
  const controller=new AbortController();
  let response:Response|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>{
      reject(new Error('Release delivery sample timed out.'));
      controller.abort();
    },DELIVERY_TIMEOUT_MS);
  });
  try{
    const sample=(async()=>{
      const received=await http(route,{method,credentials:'omit',cache:'no-store',redirect:'error',
        signal:controller.signal});
      response=received;
      if(controller.signal.aborted){
        cancelQuietly(received.body);
        throw new Error('Release delivery sample expired.');
      }
      return consume(received,controller.signal);
    })();
    return await Promise.race([sample,deadline]);
  }finally{
    if(timer!==undefined)clearTimeout(timer);
    controller.abort();
    if(response?.body&&!response.body.locked)cancelQuietly(response.body);
  }
}

async function bodylessHead(response:Response,signal:AbortSignal):Promise<boolean> {
  if(signal.aborted)return false;
  if(!response.body)return true;
  const reader=response.body.getReader();
  const stop=()=>cancelQuietly(reader);
  signal.addEventListener('abort',stop,{once:true});
  try{
    // Do not confuse an initial empty chunk with end of stream.
    for(let i=0;i<16;i++){
      const part=await reader.read();
      if(signal.aborted)return false;
      if(part.done)return true;
      if(!(part.value instanceof Uint8Array)||part.value.byteLength!==0)return false;
    }
    return false;
  }finally{
    signal.removeEventListener('abort',stop);
    stop();
    reader.releaseLock();
  }
}

async function verifyHead(http:typeof fetch,route:URL,get:Headers,
  sha:string,indexable:boolean,media=false):Promise<boolean>{
  return sampleDelivery(http,route,'HEAD',async(head,signal)=>{
    if(!safeDeliveryResponse(head,route,indexable,media)||
        !sameDeliveryPolicy(get,head.headers)||!optionalServedDigest(head.headers,sha))return false;
    return bodylessHead(head,signal);
  });
}

const DELIVERY_IMAGE=/<img loading="lazy" decoding="async" src="([^"<>]+)" alt="[^"<>]*" width="[1-9][0-9]{0,3}" height="[1-9][0-9]{0,3}">/g;

async function readBounded(response:Response,limit:number,signal:AbortSignal):Promise<Buffer|null> {
  if(signal.aborted)return null;
  const reader=response.body?.getReader();
  if(!reader)return null;
  const stop=()=>cancelQuietly(reader);
  signal.addEventListener('abort',stop,{once:true});
  const chunks:Uint8Array[]=[];
  let size=0,empty=0,count=0;
  try{
    for(;;){
      const chunk=await reader.read();
      if(signal.aborted)return null;
      if(chunk.done)break;
      if(!(chunk.value instanceof Uint8Array)||++count>65_536)return null;
      if(chunk.value.byteLength===0){
        if(++empty>=16)return null;
        continue;
      }
      empty=0;
      size+=chunk.value.byteLength;
      if(size>limit)return null;
      chunks.push(chunk.value);
    }
    return size?Buffer.concat(chunks):null;
  }finally{
    signal.removeEventListener('abort',stop);
    stop();
    reader.releaseLock();
  }
}

async function readGet(http:typeof fetch,route:URL,indexable:boolean,media=false){
  return sampleDelivery(http,route,'GET',async(response,signal)=>{
    if(!safeDeliveryResponse(response,route,indexable,media))return null;
    const bytes=await readBounded(response,media?4_000_000:MAX_HTML_BYTES,signal);
    return bytes?{bytes,headers:new Headers(response.headers)}:null;
  });
}

function matchesFrozenPng(bytes:Uint8Array,sha:string):boolean {
  const signature=[137,80,78,71,13,10,26,10];
  return bytes.byteLength>=signature.length&&signature.every((value,index)=>bytes[index]===value)&&
    createHash('sha256').update(bytes).digest('hex')===sha;
}

export function validCanonicalDeliveryMetadata(value:string|null,host:URL,canonicalPath:string,indexable:boolean,required:boolean):boolean {
  if(!indexable)return value===null;
  if(value===null)return !required;
  return value==='<'+canonicalPath+'>; rel="canonical"'||
    value==='<'+new URL(canonicalPath,host).href+'>; rel="canonical"';
}

async function digestHtml(indexable:boolean,route:URL,
  host:URL,http:typeof fetch,expectedSha:string,requirePublicAliasProof=false,requireCanonicalMetadata=false):Promise<DeliverySample|null> {
  const get=await readGet(http,route,indexable);
  if(!get)return null;
  const {bytes,headers}=get;
  if(!validCanonicalDeliveryMetadata(headers.get('link'),host,route.pathname,indexable,requireCanonicalMetadata))return null;
  const servedSha=createHash('sha256').update(bytes).digest('hex');
  if(!optionalServedDigest(headers,servedSha))return null;
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
  if(!await verifyHead(http,route,headers,servedSha,indexable))return null;
  let apiPath:string|null=null;
  if(requirePublicAliasProof&&!unlisted){
    // The alias is itself a separately reachable HTML resource, not a
    // redirect or a HEAD substitute. Both representations must contain the
    // same final bytes and observable delivery policy.
    apiPath='/api/public-portfolio?'+new URLSearchParams({handle,slug}).toString();
    const alias=new URL(apiPath,host);
    const aliasGet=await readGet(http,alias,indexable);
    if(!aliasGet||!aliasGet.bytes.equals(bytes)||
       !sameDeliveryPolicy(headers,aliasGet.headers)||
       !optionalServedDigest(aliasGet.headers,servedSha)||
       !await verifyHead(http,alias,aliasGet.headers,servedSha,indexable))return null;
  }
  for(const [src,sha] of media){
    const assetRoute=new URL(src.replaceAll('&amp;','&'),host);
    const png=await readGet(http,assetRoute,false,true);
    if(!png||!matchesFrozenPng(png.bytes,sha)||
       !optionalServedDigest(png.headers,sha))return null;
    if(!await verifyHead(http,assetRoute,png.headers,sha,false,true))return null;
  }
  return {htmlSha256:digest,servedHtmlSha256:servedSha,apiPath,
    mediaManifest:manifest??null,assetHashes:[...new Set(media.values())],
    observedHttpRequests:2+(apiPath?2:0)+2*media.size};
}

/** Trusted worker only. The configured origin must come from server configuration. */
export async function verifyActivatedUnlistedRelease(
  activation: Activation,
  {origin, rpc, http = fetch, requirePublicAliasProof=false,publicAuthority}: VerificationPorts,
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
  if(publicPath!==undefined&&publicAuthority!==undefined){
    const releaseGeneration=activation.releaseGeneration;
    if(typeof releaseGeneration!=='number'||!Number.isSafeInteger(releaseGeneration)||releaseGeneration<1)
      throw new Error('Invalid authoritative release generation.');
    // An explicit server authority port is a hard cutover: never fall back to
    // the legacy acknowledgement or recovery functions on missing/failed RPCs.
    const result=await verifyAuthority({portfolioId,intentId,releaseGeneration,publicPath,htmlSha256,requestId:activation.requestId,operationId:activation.operationId}, {
      read:(p,i)=>publicAuthority('service_read_current_public_delivery_receipt',{p_portfolio_id:p,p_intent_id:i}),
      ack:expected=>publicAuthority('service_acknowledge_public_delivery',{p_expected_receipt:expected}),
      recover:expected=>publicAuthority('service_recover_failed_public_delivery',{p_expected_receipt:expected}),
      validRoute:validPortfolioRoute,
      sample:(_path,sha,indexable)=>digestHtml(indexable,route,host,http,sha,true,true)
    },policy==='CHECK_ACKNOWLEDGED_ONLY');
    if(result.status!=='DELIVERY_ACKNOWLEDGED')return result;
    const {sample,receipt}=result;
    if(!sample.apiPath)throw new Error('Incomplete authoritative public alias observation.');
    return {status:'DELIVERY_ACKNOWLEDGED',htmlSha256,authoritativePublicReceipt:receipt,
      observedPublicDelivery:{portfolioId,intentId,preparedReleaseGeneration:releaseGeneration,
        canonicalPath:publicPath,apiPath:sample.apiPath,servedHtmlSha256:sample.servedHtmlSha256,
        observedMediaManifest:sample.mediaManifest,observedAssetHashes:sample.assetHashes,
        observedHttpRequests:sample.observedHttpRequests}};
  }
  const strictPublic=requirePublicAliasProof&&publicPath!==undefined;
  if(strictPublic&&(typeof activation.releaseGeneration!=='number'||
      !Number.isSafeInteger(activation.releaseGeneration)||activation.releaseGeneration<1))
    throw new Error('Invalid trusted release generation.');
  const checkHost = async(indexable:boolean):Promise<DeliverySample|null>=>{
    try {
      return await digestHtml(indexable,route,host,http,htmlSha256,strictPublic);
    }catch{return null;}
  };
  // A newly activated PUBLIC route serves a noindex canary UNTIL the
  // database records a trusted same-byte host acknowledgment. Verify the
  // canary as non-indexable; an already acknowledged PUBLIC route must be
  // indexable and match the same immutable source digest.
  const publicRoute=publicPath!==undefined;
  const initialIndexable=publicRoute&&policy==='CHECK_ACKNOWLEDGED_ONLY';
  const acknowledgment=(sample:DeliverySample):DeliveryVerification=>{
    if(!strictPublic)return {status:'DELIVERY_ACKNOWLEDGED',htmlSha256};
    if(!sample.apiPath||sample.htmlSha256!==htmlSha256||!publicPath||
       activation.releaseGeneration===undefined)
      throw new Error('Incomplete public alias observation.');
    return {status:'DELIVERY_ACKNOWLEDGED',htmlSha256,observedPublicDelivery:{
      portfolioId,intentId,preparedReleaseGeneration:activation.releaseGeneration,
      canonicalPath:publicPath,apiPath:sample.apiPath,servedHtmlSha256:sample.servedHtmlSha256,
      observedMediaManifest:sample.mediaManifest,observedAssetHashes:sample.assetHashes,
      observedHttpRequests:sample.observedHttpRequests
    }};
  };
  const actualDigest=await checkHost(initialIndexable);
  if (actualDigest?.htmlSha256 === htmlSha256) {
    if (policy === 'CHECK_ACKNOWLEDGED_ONLY')
      return acknowledgment(actualDigest);
    const ack = await rpc('service_acknowledge_unlisted_release', {
      p_portfolio_id: portfolioId, p_intent_id: intentId, p_html_sha256: htmlSha256
    });
    if (ack !== true) throw new Error('Release delivery acknowledgment was not confirmed.');
    // Indexing changes the delivered robots marker; prove the AFTER-ack
    // response, not merely the preceding private noindex canary. A failure
    // cannot roll back a now-acknowledged live pointer on this read.
    if(publicRoute){
      const postAck=await checkHost(true);
      if(postAck?.htmlSha256!==htmlSha256||
         (strictPublic&&(postAck.mediaManifest!==actualDigest.mediaManifest||
          postAck.assetHashes.join(',')!==actualDigest.assetHashes.join(','))))
        throw new Error('Acknowledged public release failed its indexable HTTP verification.');
      return acknowledgment(postAck);
    }
    return acknowledgment(actualDigest);
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

/** Owner-RLS frozen request binding for the paired C11 worker cutover. */
export type FrozenPublicationConsent=Readonly<{portfolioId:string;requestId:string;visibility:'PUBLIC'|'UNLISTED';operationId?:string}>;
export function validateFrozenPublicationConsent(consent:FrozenPublicationConsent,hasPublicAuthority:boolean):void{
  if(!consent||typeof consent.portfolioId!=='string'||!UUID.test(consent.portfolioId)||
     typeof consent.requestId!=='string'||!UUID.test(consent.requestId)||
     (consent.visibility!=='PUBLIC'&&consent.visibility!=='UNLISTED')||
     (consent.operationId!==undefined&&!uuid(consent.operationId))||
     (consent.visibility==='PUBLIC'&&(!hasPublicAuthority||!uuid(consent.operationId))))
    throw Error('Frozen publication consent was not verified.');
}
export function matchFrozenPublicationConsent(consent:FrozenPublicationConsent,portfolioId:string,publicPath:string|undefined):void{
  if(consent.portfolioId!==portfolioId||(consent.visibility==='PUBLIC')!==(publicPath!==undefined))
    throw Error('Prepared publication does not match frozen consent.');
}

/**
 * Read-only owner worker verification for a previously used PUBLIC consent.
 * No prepare, activate, acknowledge or compensation can be invoked here.
 * A historical acknowledgement is not current publication authority.
 */
export async function checkCurrentPublicDelivery(intentId:string,ports:{
  origin:string;http?:typeof fetch;expectedConsent:FrozenPublicationConsent;
  publicAuthority:PublicAuthorityRpc;
}):Promise<DeliveryVerification>{
  const consent=Object.freeze({...ports.expectedConsent});
  if(typeof intentId!=='string'||!UUID.test(intentId)||consent.visibility!=='PUBLIC')
    throw Error('Invalid current public delivery request.');
  validateFrozenPublicationConsent(consent,typeof ports.publicAuthority==='function');
  const readOnly:PublicAuthorityRpc=async(operation,payload)=>{
    if(operation!=='service_read_current_public_delivery_receipt')
      throw Error('Read-only public delivery verification.');
    return ports.publicAuthority(operation,payload);
  };
  const raw=await readOnly('service_read_current_public_delivery_receipt',{
    p_portfolio_id:consent.portfolioId,p_intent_id:intentId
  });
  if(!record(raw)||typeof raw.handle!=='string'||typeof raw.slug!=='string'||
     !validPortfolioRoute(raw.handle,raw.slug)||!gen(raw.releaseGeneration)||!digest(raw.storedHtmlSha256))
    throw Error('Current public delivery is not available.');
  const publicPath='/'+raw.handle+'/'+raw.slug;
  const expected={portfolioId:consent.portfolioId,intentId,requestId:consent.requestId,operationId:consent.operationId,
    releaseGeneration:raw.releaseGeneration,htmlSha256:raw.storedHtmlSha256,publicPath};
  const initial=parseAuthority(raw,expected,validPortfolioRoute);
  if(initial.verifiedAt===null)throw Error('Current public delivery is not acknowledged.');
  return verifyActivatedUnlistedRelease(expected,{
    origin:ports.origin,http:ports.http,requirePublicAliasProof:true,
    publicAuthority:readOnly,rpc:async()=>{throw Error('Read-only public delivery verification.');}
  },'CHECK_ACKNOWLEDGED_ONLY');
}

/** Run for an owner consent ID already recorded by Supabase. Retry with the same ID. */
export async function publishConsentedUnlistedRelease(
  intentId: string,
  ports: Omit<VerificationPorts, 'rpc'> & {
    rpc: (operation: PublicationOperation, input: Record<string, string | number>) => Promise<unknown>;
    expectedConsent?:FrozenPublicationConsent;
  }
): Promise<DeliveryVerification> {
  deliveryHost(ports.origin);
  if (typeof intentId !== 'string' || !UUID.test(intentId)) throw new Error('Invalid publication consent.');

  const {rpc} = ports;
  const consent=ports.expectedConsent===undefined?undefined:Object.freeze({...ports.expectedConsent});
  if(consent)validateFrozenPublicationConsent(consent,typeof ports.publicAuthority==='function');
  if(consent?.visibility==='PUBLIC'){
    // Verify the service-only reader exists before any public prepare/activate.
    // A null current receipt is normal for a first activation; this is only a
    // capability probe, never a substitute for the locked SQL/C11 cutover or
    // for exact authority checks after the external delivery samples.
    const authority=await ports.publicAuthority!('service_read_current_public_delivery_receipt',{
      p_portfolio_id:consent.portfolioId,p_intent_id:intentId
    });
    if(authority!==null&&(!record(authority)||
       authority.portfolioId!==consent.portfolioId||authority.intentId!==intentId||
       authority.requestId!==consent.requestId||authority.operationId!==consent.operationId||authority.visibility!=='PUBLIC'))
      throw Error('Public delivery authority is unavailable.');
  }
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
  if(consent)matchFrozenPublicationConsent(consent,portfolioId,publicPath);
  switch (prepared.status) {
    case 'ACKNOWLEDGED':
      return verifyActivatedUnlistedRelease(
        {portfolioId, intentId, htmlSha256, publicPath, releaseGeneration, requestId:consent?.requestId, operationId:consent?.operationId}, ports, 'CHECK_ACKNOWLEDGED_ONLY');
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
  return verifyActivatedUnlistedRelease({portfolioId, intentId, htmlSha256, publicPath, releaseGeneration, requestId:consent?.requestId, operationId:consent?.operationId}, ports);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** C11 server-side authority consumer; production wiring requires the paired SQL cutover. */
const SHA=SHA256;
const MAX=Number.MAX_SAFE_INTEGER;
const keys=['portfolioId','intentId','requestId','operationId','releaseGeneration','stageGeneration','pointerGeneration','revocationGeneration','deliveryEpoch','visibility','handle','slug','storedHtmlSha256','mediaManifest','assetHashes','verifiedAt'] as const;
export type AuthorityReceipt={portfolioId:string;intentId:string;requestId:string;operationId:string;releaseGeneration:number;stageGeneration:number;pointerGeneration:number;revocationGeneration:number;deliveryEpoch:number;visibility:'PUBLIC';handle:string;slug:string;storedHtmlSha256:string;mediaManifest:string|null;assetHashes:readonly string[];verifiedAt:string|null};
export type AuthorityIdentity={portfolioId:string;intentId:string;releaseGeneration:number;publicPath:string;htmlSha256:string;requestId?:string;operationId?:string};
export type AuthoritySample={htmlSha256:string;servedHtmlSha256:string;apiPath:string|null;mediaManifest:string|null;assetHashes:readonly string[];observedHttpRequests:number};
export type AuthorityPorts={read:(portfolioId:string,intentId:string)=>Promise<unknown>;ack:(expected:AuthorityReceipt)=>Promise<unknown>;recover:(expected:AuthorityReceipt)=>Promise<unknown>;sample:(path:string,sha:string,indexable:boolean)=>Promise<AuthoritySample|null>;validRoute:(handle:string,slug:string)=>boolean};
function fail():never{throw Error('Authoritative public delivery was not verified.');}
const obj=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const uuid=(x:unknown):x is string=>typeof x==='string'&&x===x.toLowerCase()&&UUID.test(x);
const digest=(x:unknown):x is string=>typeof x==='string'&&SHA.test(x);
const gen=(x:unknown,min=1):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=min;
function exact(x:Record<string,unknown>,wanted:readonly string[]):boolean{return Object.keys(x).length===wanted.length&&wanted.every(k=>Object.hasOwn(x,k));}
const ts=(x:unknown):x is string=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&Number.isFinite(Date.parse(x));
export function parseAuthority(raw:unknown,expected:AuthorityIdentity,validRoute:AuthorityPorts['validRoute']):AuthorityReceipt{
  if(!obj(raw)||!exact(raw,keys)||!uuid(raw.portfolioId)||!uuid(raw.intentId)||!uuid(raw.requestId)||!uuid(raw.operationId)||raw.visibility!=='PUBLIC'||
     raw.portfolioId!==expected.portfolioId||raw.intentId!==expected.intentId||raw.releaseGeneration!==expected.releaseGeneration||raw.storedHtmlSha256!==expected.htmlSha256||
     (expected.requestId!==undefined&&raw.requestId!==expected.requestId)||
     (expected.operationId!==undefined&&raw.operationId!==expected.operationId)||
     !gen(raw.releaseGeneration)||!gen(raw.stageGeneration)||!gen(raw.pointerGeneration)||!gen(raw.revocationGeneration,0)||!gen(raw.deliveryEpoch)||raw.deliveryEpoch>=MAX||
     raw.stageGeneration>raw.releaseGeneration||raw.releaseGeneration>raw.pointerGeneration||raw.stageGeneration<=raw.revocationGeneration||
     typeof raw.handle!=='string'||typeof raw.slug!=='string'||!validRoute(raw.handle,raw.slug)||'/'+raw.handle+'/'+raw.slug!==expected.publicPath||!digest(raw.storedHtmlSha256)||
     !Array.isArray(raw.assetHashes)||raw.assetHashes.length>8||![...raw.assetHashes].every(digest)||new Set(raw.assetHashes).size!==raw.assetHashes.length||
     (raw.assetHashes.length===0?raw.mediaManifest!==null:!digest(raw.mediaManifest))||(raw.verifiedAt!==null&&!ts(raw.verifiedAt)))fail();
  return Object.freeze({...raw,assetHashes:Object.freeze([...raw.assetHashes])}) as AuthorityReceipt;
}
function same(a:AuthorityReceipt,b:AuthorityReceipt):boolean{return keys.every(k=>k==='assetHashes'?a.assetHashes.length===b.assetHashes.length&&a.assetHashes.every((sha,i)=>sha===b.assetHashes[i]):a[k]===b[k]);}
// Snapshot the observation before the next asynchronous authority read. No
// mutable transport-owned result or sparse asset array may alter the receipt.
function immutableAuthoritySample(raw:unknown):AuthoritySample|null{
  if(!obj(raw)||!exact(raw,['htmlSha256','servedHtmlSha256','apiPath','mediaManifest','assetHashes','observedHttpRequests'])||
     !digest(raw.htmlSha256)||!digest(raw.servedHtmlSha256)||
     typeof raw.apiPath!=='string'||!Array.isArray(raw.assetHashes)||raw.assetHashes.length>8||
     ![...raw.assetHashes].every(digest)||new Set(raw.assetHashes).size!==raw.assetHashes.length||
     (raw.assetHashes.length===0?raw.mediaManifest!==null:!digest(raw.mediaManifest))||
     !gen(raw.observedHttpRequests))return null;
  return Object.freeze({...raw,assetHashes:Object.freeze([...raw.assetHashes])}) as AuthoritySample;
}
function sampleMatches(s:AuthoritySample|null,a:AuthorityReceipt):s is AuthoritySample{
  if(!s)return false;
  const alias='/api/public-portfolio?'+new URLSearchParams({handle:a.handle,slug:a.slug});
  return s.htmlSha256===a.storedHtmlSha256&&digest(s.servedHtmlSha256)&&s.apiPath===alias&&s.mediaManifest===a.mediaManifest&&
    Array.isArray(s.assetHashes)&&s.assetHashes.length===a.assetHashes.length&&new Set(s.assetHashes).size===s.assetHashes.length&&s.assetHashes.every(sha=>a.assetHashes.includes(sha))&&s.observedHttpRequests===4+2*a.assetHashes.length;
}
export async function verifyAuthority(expected:AuthorityIdentity,ports:AuthorityPorts,checkOnly=false){
  const identity=Object.freeze({...expected});
  const read=async()=>parseAuthority(await ports.read(identity.portfolioId,identity.intentId),identity,ports.validRoute);
  const first=await read();
  const acknowledged=first.verifiedAt!==null;
  if(checkOnly&&!acknowledged)fail();
  const probe=async(indexable:boolean)=>{try{return immutableAuthoritySample(await ports.sample(identity.publicPath,identity.htmlSha256,indexable));}catch{return null;}};
  const sampled=await probe(acknowledged);
  // An authority failure is never a compensating-write trigger.
  const after=await read();
  if(!same(first,after))fail();
  if(!sampleMatches(sampled,first)){
    if(acknowledged||checkOnly)fail();
    const raw=await ports.recover(first);
    if(!obj(raw)||!exact(raw,['portfolioId','status','releaseGeneration','deliveryEpoch','hostRevocationVerified','publicUrl'])||raw.portfolioId!==first.portfolioId||!gen(raw.deliveryEpoch)||raw.deliveryEpoch<=first.deliveryEpoch||raw.hostRevocationVerified!==false||raw.publicUrl!==null)fail();
    if(raw.status==='REVOKED'&&raw.releaseGeneration===null)return {status:'DELIVERY_REVOKED' as const};
    if(raw.status==='RESTORED_NEEDS_EXTERNAL_HTTP_VERIFICATION'&&raw.deliveryEpoch<MAX&&gen(raw.releaseGeneration))return {status:'PRIOR_RELEASE_RESTORED' as const,releaseGeneration:raw.releaseGeneration};
    return fail();
  }
  if(acknowledged)return {status:'DELIVERY_ACKNOWLEDGED' as const,receipt:first,sample:sampled};
  if(first.deliveryEpoch>=MAX-1)fail();
  // A lost ACK is an unknown result: propagate, never recover or retry here.
  const ack= parseAuthority(await ports.ack(first),identity,ports.validRoute);
  if(ack.verifiedAt===null||ack.deliveryEpoch!==first.deliveryEpoch+1||!same(first,{...ack,deliveryEpoch:first.deliveryEpoch,verifiedAt:null}))fail();
  const finalSample=await probe(true);
  const finalReceipt=await read();
  if(!same(ack,finalReceipt)||!sampleMatches(finalSample,ack))fail();
  return {status:'DELIVERY_ACKNOWLEDGED' as const,receipt:finalReceipt,sample:finalSample};
}
