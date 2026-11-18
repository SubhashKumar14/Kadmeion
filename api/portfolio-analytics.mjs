/** C13 internal collector for the disposable local integration stack.
 * canonicalIngressVerified and frozenHtmlSha256 must come from trusted server
 * render validation, never HTTP headers, query parameters or browser input.
 * The default HTTP route is deny-only. No hosted collection.
 */
const MAX=Number.MAX_SAFE_INTEGER;
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const hex=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const positive=(v,max=MAX)=>Number.isSafeInteger(v)&&v>0&&v<=max;
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const receiptKeys=['portfolioId','intentId','releaseGeneration','stageGeneration','deliveryEpoch','htmlSha256','consentVersion'];
const search=new Set(['google.com','www.google.com','bing.com','www.bing.com','duckduckgo.com','www.duckduckgo.com','search.yahoo.com']);
const social=new Set(['facebook.com','www.facebook.com','m.facebook.com','instagram.com','www.instagram.com','linkedin.com','www.linkedin.com','x.com','www.x.com','twitter.com','www.twitter.com','reddit.com','www.reddit.com']);
const ignored=()=>({status:'IGNORED'});
function header(headers,name,max){
  const matches=Object.keys(headers).filter(k=>k.toLowerCase()===name);
  if(matches.length===0)return undefined;
  if(matches.length!==1)return null;
  const v=headers[matches[0]];
  return typeof v==='string'&&v.length<=max&&!/[\r\n\0]/.test(v)?v:null;
}
function classify(ref,origin){
  if(!ref)return 'DIRECT_OR_UNKNOWN';
  try{
    const u=new URL(ref);
    if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return 'DIRECT_OR_UNKNOWN';
    if(u.origin===origin)return 'INTERNAL';
    if(search.has(u.hostname))return 'SEARCH';
    if(social.has(u.hostname))return 'SOCIAL';
    return 'OTHER_EXTERNAL';
  }catch{return 'DIRECT_OR_UNKNOWN'}
}
export async function collectEligiblePublicView(context,dependencies){
  let timer,controller;
  try{
    if(!context||context.canonicalIngressVerified!==true||context.localIntegration!==true||context.enabled!==true||context.renderedSuccessfully!==true||context.method!=='GET')return ignored();
    const {receipt,headers,canonicalOrigin,frozenHtmlSha256}=context;
    // Only the known Node header dictionary is supported; a missing/opaque
    // container must not silently erase a visitor's opt-out signals.
    if(!headers||typeof headers!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(headers)))return ignored();
    if(!exact(receipt,receiptKeys)||!uuid(receipt.portfolioId)||!uuid(receipt.intentId)||!positive(receipt.releaseGeneration)||!positive(receipt.stageGeneration)||receipt.stageGeneration>receipt.releaseGeneration||!positive(receipt.deliveryEpoch,MAX-1)||!positive(receipt.consentVersion,MAX-1)||!hex(receipt.htmlSha256)||receipt.htmlSha256!==frozenHtmlSha256)return ignored();
    if(typeof canonicalOrigin!=='string'||canonicalOrigin.length>256)return ignored();
    const canonical=new URL(canonicalOrigin);
    if(!(canonical.protocol==='https:'||(canonical.protocol==='http:'&&['127.0.0.1','localhost'].includes(canonical.hostname)))||canonical.origin!==canonicalOrigin||canonical.username||canonical.password)return ignored();
    const gpc=header(headers,'sec-gpc',32),dnt=header(headers,'dnt',32),purpose=header(headers,'purpose',128),secPurpose=header(headers,'sec-purpose',128),ua=header(headers,'user-agent',1024),ref=header(headers,'referer',2048);
    if([gpc,dnt,purpose,secPurpose,ua,ref].some(v=>v===null)||gpc!==undefined||(dnt!==undefined&&dnt.trim()!=='0')||/prefetch|prerender/i.test((purpose??'')+' '+(secPurpose??''))||/bot|crawler|spider|slurp|headless|preview/i.test(ua??''))return ignored();
    const collect=dependencies?.collect,timeoutMs=dependencies?.timeoutMs??250;
    if(typeof collect!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>250)return ignored();
    const args={p_portfolio_id:receipt.portfolioId,p_intent_id:receipt.intentId,p_release_generation:receipt.releaseGeneration,p_stage_generation:receipt.stageGeneration,p_delivery_epoch:receipt.deliveryEpoch,p_html_sha256:receipt.htmlSha256,p_consent_version:receipt.consentVersion,p_bucket:classify(ref,canonical.origin)};
    controller=new AbortController();
    const started=performance.now();
    const deadline=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(ignored())},timeoutMs)});
    const attempt=Promise.resolve().then(()=>collect(args,controller.signal)).then(result=>exact(result,['status'])&&['COUNTED','IGNORED','LIMITED'].includes(result.status)?{status:result.status}:ignored(),ignored);
    const result=await Promise.race([attempt,deadline]);
    return performance.now()-started>=timeoutMs?ignored():result;
  }catch{return ignored()}finally{if(timer!==undefined)clearTimeout(timer);if(controller&&!controller.signal.aborted)controller.abort()}
}
// If accidentally exposed as an API route, always deny before any other access.
export default function denyDirectAnalytics(_req,res){
  res.statusCode=404;res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type','text/plain; charset=utf-8');res.end('Not found');
}

/** Actual PostgREST collector transport for the disposable local stack only.
 * A server composition root supplies the verified local context and service
 * credential. Never export this configuration to the browser or accept it from
 * a request. The public handler remains deny-only and no hosted origin is valid.
 */
export function createLocalAnalyticsRpcCollector({localIntegration,endpoint,serviceRoleKey,http=fetch}={}){
  if(localIntegration!==true||typeof endpoint!=='string'||typeof serviceRoleKey!=='string'||
    !/^[A-Za-z0-9._-]{16,4096}$/.test(serviceRoleKey)||typeof http!=='function')throw Error('Analytics collector unavailable');
  const origin=new URL(endpoint);
  if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||origin.origin!==endpoint||!origin.port||origin.username||origin.password)throw Error('Analytics collector unavailable');
  const url=origin.origin+'/rest/v1/rpc/collect_portfolio_analytics_view';
  const fields=['p_portfolio_id','p_intent_id','p_release_generation','p_stage_generation','p_delivery_epoch','p_html_sha256','p_consent_version','p_bucket'];
  return async function collect(args,signal){
    let reader,response,done=false;
    const cancel=()=>{try{void (reader??response?.body)?.cancel().catch(()=>{})}catch{}};
    const started=performance.now();
    try{
      if(!signal||signal.aborted||!exact(args,fields)||!uuid(args.p_portfolio_id)||!uuid(args.p_intent_id)||
        !positive(args.p_release_generation)||!positive(args.p_stage_generation)||args.p_stage_generation>args.p_release_generation||!positive(args.p_delivery_epoch,MAX-1)||!hex(args.p_html_sha256)||!positive(args.p_consent_version,MAX-1)||
        !['DIRECT_OR_UNKNOWN','SEARCH','SOCIAL','OTHER_EXTERNAL','INTERNAL'].includes(args.p_bucket))return ignored();
      response=await http(url,{method:'POST',headers:{apikey:serviceRoleKey,Authorization:'Bearer '+serviceRoleKey,Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(args),redirect:'error',cache:'no-store',credentials:'omit',signal});
      if(signal.aborted||performance.now()-started>=250||!response.ok||response.redirected||response.url!==url)return ignored();
      const type=response.headers.get('content-type')??'',declared=response.headers.get('content-length'),encoding=response.headers.get('content-encoding');
      if(!/^application\/json(?:\s*;|$)/i.test(type)||declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>256)||!response.body)return ignored();
      reader=response.body.getReader();const bytes=new Uint8Array(256);let size=0;
      signal.addEventListener('abort',cancel,{once:true});
      for(;;){
        if(signal.aborted||performance.now()-started>=250)return ignored();
        const part=await reader.read();
        if(signal.aborted||performance.now()-started>=250)return ignored();
        if(part.done){done=true;break}
        if(!(part.value instanceof Uint8Array)||part.value.byteLength===0||part.value.byteLength>bytes.length-size)return ignored();
        bytes.set(part.value,size);size+=part.value.byteLength;
      }
      if(declared!==null&&(!encoding||encoding.toLowerCase()==='identity')&&Number(declared)!==size)return ignored();
      const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size));
      // This response has one enum field. Exact lexical match disallows duplicate
      // keys, extra properties and ambiguous or unbounded JSON without parsing.
      const match=/^[ \t\r\n]*\{[ \t\r\n]*"status"[ \t\r\n]*:[ \t\r\n]*"(COUNTED|IGNORED|LIMITED)"[ \t\r\n]*\}[ \t\r\n]*$/.exec(raw);
      return match&&!signal.aborted&&performance.now()-started<250?{status:match[1]}:ignored();
    }catch{return ignored()}finally{signal?.removeEventListener?.('abort',cancel);if(!done)cancel();try{reader?.releaseLock()}catch{}}
  };
}
