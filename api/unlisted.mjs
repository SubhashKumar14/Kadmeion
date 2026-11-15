import {readBoundedRpcJson, mediaQuery, renderReleaseHtml, readFrozenPng} from './_bounded-rpc-json.mjs';
/**
 * Disabled-by-default UNLISTED scriptless text-only release HTTP candidate.
 * Business state remains in Supabase; this Vercel/Node adapter only serves
 * authoritative live bytes. NOT the final 5-template visual renderer or
 * approved canonical username/slug route; never mark hosted delivery verified
 * without an independent external HTTP + no-cache + direct-asset test.
 */

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const CSP="default-src 'none'; script-src 'none'; object-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const RESP_HEADERS={
  'Cache-Control':'private, no-store, max-age=0, must-revalidate',
  'CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store',
  'Surrogate-Control':'no-store','X-Robots-Tag':'noindex, nofollow, noarchive',
  'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY','Cross-Origin-Resource-Policy':'same-origin',
  'Content-Security-Policy':CSP
};
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function reply(res,status,body,mime='text/plain; charset=utf-8',method='GET',media=false){
  for(const [k,v] of Object.entries(RESP_HEADERS))res.setHeader(k,v);
  if(media)res.setHeader('Content-Security-Policy',RESP_HEADERS['Content-Security-Policy'].replace("img-src 'none'","img-src 'self'"));
  res.setHeader('Content-Type',mime);res.statusCode=status;
  res.end(method==='HEAD'?'':body);
}
function configuration(env){
  if(env.KADMEION_UNLISTED_DELIVERY_ENABLED!=='true')return null;
  let api;
  try{
    const u=new URL(env.KADMEION_SUPABASE_URL);
    if(u.username||u.password||u.pathname!=='/'||u.search||u.hash)return null;
    if(u.origin!=='https://scyooqjitjzjdxgtanso.supabase.co'&&
       !(u.protocol==='http:'&&u.port==='54321'&&
         ['localhost','127.0.0.1'].includes(u.hostname)&&
         env.KADMEION_LOCAL_INTEGRATION==='1'))return null;
    api=u.origin;
  }catch{return null;}
  const key=env.KADMEION_SUPABASE_SERVICE_ROLE_KEY;
  if(typeof key!=='string'||!key.startsWith('eyJ')||key.length<70)return null;
  return {api,key};
}
function verified(raw){
  if(!obj(raw)||
     raw.status!=='UNLISTED_SCRIPTLESS_HTML'||
     raw.indexable!==false||raw.publicPublishingProven!==false||
     typeof raw.html!=='string'||typeof raw.htmlSha256!=='string'||
     !SHA.test(raw.htmlSha256))return false;
  const html=raw.html;
  if(Buffer.byteLength(html,'utf8')<70||Buffer.byteLength(html,'utf8')>750000||
     !html.toLowerCase().startsWith('<!doctype html>')||
     !html.toLowerCase().includes('noindex'))
    return false;
  return true;
}
export async function handleUnlistedRequest(req,res,{env=process.env,http=globalThis.fetch}={}){
  const method=req.method??'GET';
  if(!['GET','HEAD'].includes(method)){
    reply(res,405,'Method not allowed','text/plain; charset=utf-8',method);return;
  }
  const cfg=configuration(env);
  if(!cfg){reply(res,404,'Not found','text/plain; charset=utf-8',method);return;}
  let url;
  try{url=new URL(req.url??'/', 'https://kadmeion.internal');}
  catch{reply(res,404,'Not found','text/plain; charset=utf-8',method);return;}
  const assetRequest=url.searchParams.has('asset')||url.searchParams.has('manifest');
  const media=assetRequest?mediaQuery(url.searchParams):null;
  if(assetRequest&&(!media||url.pathname!=='/api/unlisted')){
    reply(res,404,'Not found','text/plain; charset=utf-8',method);return;
  }
  if(media){
    url.searchParams.delete('manifest');
    url.searchParams.delete('asset');
  }
  const id=url.searchParams.get('portfolioId');
  if(url.pathname!=='/api/unlisted'||url.searchParams.size!==1||!id||!UUID.test(id)){
    reply(res,404,'Not found','text/plain; charset=utf-8',method);return;
  }
  let upstream;
  try{
    upstream=await http(cfg.api+'/rest/v1/rpc/'+(media?'service_read_frozen_release_png':'service_read_unlisted_release'),{
      method:'POST',headers:{apikey:cfg.key,Authorization:'Bearer '+cfg.key,
        Accept:'application/json','Content-Type':'application/json',
        'Cache-Control':'no-store'},
      body:JSON.stringify({p_portfolio_id:id,...media}),
      credentials:'omit',cache:'no-store',redirect:'error',
      signal:AbortSignal.timeout(5000)
    });
  }catch{reply(res,503,'Temporarily unavailable','text/plain; charset=utf-8',method);return;}
  if(!upstream.ok){
    await upstream.body?.cancel().catch(()=>{});
    reply(res,503,'Temporarily unavailable','text/plain; charset=utf-8',method);return;
  }
  let raw;
  try{raw=media?await readFrozenPng(upstream,media.p_sha):await readBoundedRpcJson(upstream);}
  catch{reply(res,503,'Temporarily unavailable','text/plain; charset=utf-8',method);return;}
  if(raw===null){reply(res,404,'Not found','text/plain; charset=utf-8',method);return;}
  if(media){
    reply(res,200,raw,'image/png',method);return;
  }
  if(!verified(raw)){
    reply(res,503,'Temporarily unavailable','text/plain; charset=utf-8',method);return;
  }
  const rendered=renderReleaseHtml(raw,['status', 'html', 'htmlSha256', 'indexable', 'publicPublishingProven'],'/api/unlisted',{portfolioId:id});
  if(!rendered){reply(res,503,'Temporarily unavailable','text/plain; charset=utf-8',method);return;}
  reply(res,200,rendered.html,'text/html; charset=utf-8',method,rendered.media);
}
export default function handler(req,res){return handleUnlistedRequest(req,res);}
