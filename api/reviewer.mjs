/**
 * Candidate Vercel Node function for PRIVATE reviewer staging, NOT publication.
 * Deliberately disabled unless the operator explicitly proves the host, sets
 * server-only keys and enables KADMEION_STAGING_DELIVERY_ENABLED. Do not
 * configure caching, public aliases or service credentials in browser assets.
 *
 * This is a narrow *delivery adapter*; business state and grants remain
 * solely in Supabase. External CDN, platform and cache proof is still required.
 */
import {createHash} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN=/^[0-9a-f]{64}$/;
const SHA=/^[0-9a-f]{64}$/;
const MAX_RPC_BYTES=800000;
const MAX_HTML_BYTES=750000;
const POLICY="default-src 'none'; script-src 'none'; object-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const HEADERS=Object.freeze({
  'Cache-Control':'private, no-store, max-age=0, must-revalidate',
  'CDN-Cache-Control':'no-store',
  'Vercel-CDN-Cache-Control':'no-store',
  'Surrogate-Control':'no-store',
  'X-Robots-Tag':'noindex, nofollow, noarchive',
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'Cross-Origin-Resource-Policy':'same-origin',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':POLICY
});
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);

function respond(res,status,body,contentType='text/plain; charset=utf-8',method='GET'){
  for(const [key,value] of Object.entries(HEADERS))res.setHeader(key,value);
  res.setHeader('Content-Type',contentType);
  res.statusCode=status;
  res.end(method==='HEAD'?'':body);
}
function config(env){
  if(env.KADMEION_STAGING_DELIVERY_ENABLED!=='true')return null;
  let origin;
  try{
    const u=new URL(env.KADMEION_SUPABASE_URL);
    const hosted=u.origin==='https://scyooqjitjzjdxgtanso.supabase.co';
    const local=u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)&&
      u.port==='54321'&&env.KADMEION_LOCAL_INTEGRATION==='1';
    if(!hosted&&!local)return null;
    if(u.username||u.password||u.pathname!=='/'||u.search||u.hash)return null;
    origin=u.origin;
  }catch{return null;}
  // Legacy service JWT remains server-only; newer sb_secret credentials
  // require a separate verified API-key authorization implementation.
  const secret=env.KADMEION_SUPABASE_SERVICE_ROLE_KEY;
  if(typeof secret!=='string'||!secret.startsWith('eyJ')||secret.length<70)return null;
  return {origin,secret};
}
async function boundedJson(response){
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_RPC_BYTES))
    throw new Error('Oversized reviewer response');
  if(!response.body)throw new Error('Empty reviewer response');
  const reader=response.body.getReader();
  const chunks=[];let size=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_RPC_BYTES)throw new Error('Oversized reviewer response');
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
function validHtml(receipt){
  if(!record(receipt)||Object.keys(receipt).length!==5||
     receipt.status!=='REVIEWER_PRIVATE_HTML'||
     receipt.publicServingEnabled!==false||receipt.publicUrl!==null||
     typeof receipt.html!=='string'||typeof receipt.htmlSha256!=='string'||
     !SHA.test(receipt.htmlSha256))return false;
  const html=receipt.html,bytes=Buffer.byteLength(html,'utf8');
  if(bytes<70||bytes>MAX_HTML_BYTES||
     !html.toLowerCase().startsWith('<!doctype html>')||
     !html.toLowerCase().includes('noindex')||
     /<\s*(script|iframe|object|embed|svg|form|input|link|base)([\s/>])/i.test(html))
    return false;
  return createHash('sha256').update(html,'utf8').digest('hex')===receipt.htmlSha256;
}

/** Pure dependency-injected handler for isolated tests and the Vercel adapter. */
export async function handleReviewerRequest(req,res,{
  env=process.env,http=globalThis.fetch
}={}){
  const method=req.method??'GET';
  if(method!=='GET'&&method!=='HEAD'){
    respond(res,405,'Method not allowed','text/plain; charset=utf-8',method);
    return;
  }
  const cfg=config(env);
  if(!cfg){respond(res,404,'Not found','text/plain; charset=utf-8',method);return;}
  let url;
  try{url=new URL(req.url??'/', 'https://kadmeion.internal');}
  catch{respond(res,404,'Not found','text/plain; charset=utf-8',method);return;}
  if(url.pathname!=='/api/reviewer'){
    respond(res,404,'Not found','text/plain; charset=utf-8',method);return;
  }
  const grantId=url.searchParams.get('g');
  const queryToken=url.searchParams.get('t');
  const authorization=req.headers?.authorization;
  const bearerToken=typeof authorization==='string'?
    /^Bearer ([0-9a-f]{64})$/.exec(authorization)?.[1]:undefined;
  // Header transport avoids recording the reviewer token in a URL. Query
  // transport is retained only for link-compatible private staging, with
  // strict no-referrer/no-store and short-lived server validation.
  const validTransport=queryToken===null
    ? url.searchParams.size===1&&bearerToken!==undefined
    : url.searchParams.size===2&&authorization===undefined;
  const token=queryToken??bearerToken;
  if(!validTransport||!grantId||!UUID.test(grantId)||!token||!TOKEN.test(token)){
    respond(res,404,'Not found','text/plain; charset=utf-8',method);return;
  }
  let upstream;
  try{
    upstream=await http(cfg.origin+'/rest/v1/rpc/read_private_reviewer_stage_artifact',{
      method:'POST',headers:{
        'apikey':cfg.secret,'Authorization':'Bearer '+cfg.secret,
        'Content-Type':'application/json','Accept':'application/json',
        'Cache-Control':'no-store'
      },
      body:JSON.stringify({p_grant_id:grantId,p_raw_token:token}),
      cache:'no-store',credentials:'omit',redirect:'error',
      signal:AbortSignal.timeout(5000)
    });
  }catch{
    respond(res,503,'Temporarily unavailable','text/plain; charset=utf-8',method);return;
  }
  if(!upstream.ok){
    respond(res,503,'Temporarily unavailable','text/plain; charset=utf-8',method);
    return;
  }
  let receipt;
  try{receipt=await boundedJson(upstream);}
  catch{respond(res,503,'Temporarily unavailable','text/plain; charset=utf-8',method);return;}
  if(receipt===null){
    respond(res,404,'Not found','text/plain; charset=utf-8',method);return;
  }
  if(!validHtml(receipt)){
    respond(res,503,'Temporarily unavailable','text/plain; charset=utf-8',method);return;
  }
  respond(res,200,receipt.html,'text/html; charset=utf-8',method);
}

export default function handler(req,res){
  return handleReviewerRequest(req,res);
}
