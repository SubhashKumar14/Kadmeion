import {createHash} from 'node:crypto';

/**
 * Fail-closed bounded JSON reader for private service-key RPC calls.
 * Transport JSON can be roughly twice the served HTML size when quotes and
 * backslashes are escaped. The HTML envelope retains its own 750 KB cap.
 */
export async function readBoundedRpcJson(response, limit=2 * 1024 * 1024) {
  if(!Number.isSafeInteger(limit)||limit<1||limit>5_350_000)throw Error('Invalid RPC limit');
  const type=response?.headers?.get('content-type');
  if(typeof type!=='string'||!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(type))
    throw Error('Invalid RPC content type');
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>limit))
    throw Error('RPC length limit');
  if(!response.body?.getReader)throw Error('Missing RPC body');
  const reader=response.body.getReader(), chunks=[];
  let size=0;
  try {
    for(;;) {
      const {done,value}=await reader.read();
      if(done)break;
      if(!(value instanceof Uint8Array))throw Error('Invalid RPC chunk');
      size+=value.byteLength;
      if(size>limit){await reader.cancel();throw Error('RPC size limit');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  // Fetch may transparently decompress gzip/brotli responses while retaining
  // the wire Content-Length. Compare byte counts only for identity encoding;
  // a fabricated or truncated uncompressed response must fail closed.
  const encoding=response.headers.get('content-encoding');
  if(length!==null&&(!encoding||encoding.toLowerCase()==='identity')&&Number(length)!==size)
    throw Error('RPC response length mismatch');
  const bytes=new Uint8Array(size);
  let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}

/**
 * Defense in depth for trusted, scriptless server-rendered previews.
 * SHA-256 attests bytes, not whether markup is safe: reject executable
 * attributes, navigation escapes, resource elements, and redirect meta tags.
 * All public output must ALSO carry an enforced restrictive CSP.
 */
export function containsUnsafeStaticMarkup(html) {
  if (typeof html !== 'string') return true;
  if (/<\s*(?:script|iframe|object|embed|svg|form|input|link|base|img|video|audio|source|picture|track|math|frame|frameset|portal)\b/i.test(html) ||
      /<[^>]*\s+on[a-z]{2,32}\s*=/i.test(html) ||
      /<[^>]*\s+(?:src|srcset|action|formaction)\s*=/i.test(html))
    return true;
  for (const tag of html.match(/<\s*meta\b[^>]*>/gi) ?? []) {
    const match = /\bhttp-equiv\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (match && (match[1] ?? match[2] ?? match[3]).toLowerCase() !== 'content-security-policy')
      return true;
  }
  for (const match of html.matchAll(/(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    try {
      const url = new URL(match[1] ?? match[2] ?? match[3]);
      if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return true;
    } catch { return true; }
  }
  return false;
}


const SHA=/^[a-f0-9]{64}$/;
const PNG_TAG=/<img loading="lazy" decoding="async" src="\.\/assets\/([a-f0-9]{64})\.png" alt="[^"<>]*" width="[1-9][0-9]{0,3}" height="[1-9][0-9]{0,3}">/g;

export function mediaQuery(params) {
  const manifest=params.get('manifest');
  const asset=params.get('asset');
  return manifest && asset && SHA.test(manifest) && SHA.test(asset) &&
    params.getAll('manifest').length===1 && params.getAll('asset').length===1
    ? {p_manifest:manifest,p_sha:asset} : null;
}

export function renderReleaseHtml(receipt, keys, endpoint, scope) {
  const media=Object.hasOwn(receipt,'mediaManifest') || Object.hasOwn(receipt,'assetHashes');
  const expected=media ? [...keys,'mediaManifest','assetHashes'] : keys;
  if(Object.keys(receipt).sort().join(',')!==[...expected].sort().join(',')) return null;
  const {html,htmlSha256,mediaManifest,assetHashes}=receipt;
  if(typeof html!=='string'||typeof htmlSha256!=='string'||!SHA.test(htmlSha256)||
     createHash('sha256').update(html,'utf8').digest('hex')!==htmlSha256) return null;
  if(!media) return containsUnsafeStaticMarkup(html) ? null : {html,media:false};
  if(typeof mediaManifest!=='string'||!SHA.test(mediaManifest)||
     !Array.isArray(assetHashes)||assetHashes.length<1||assetHashes.length>8||
     assetHashes.some(sha=>typeof sha!=='string'||!SHA.test(sha))||
     new Set(assetHashes).size!==assetHashes.length) return null;
  const images=[...html.matchAll(PNG_TAG)];
  const used=new Set(images.map(([,sha])=>sha));
  if(used.size!==assetHashes.length||assetHashes.some(sha=>!used.has(sha))||
     containsUnsafeStaticMarkup(html.replace(PNG_TAG,''))) return null;
  const rendered=html.replace(PNG_TAG,(tag,sha)=>{
    const query=new URLSearchParams({...scope,manifest:mediaManifest,asset:sha});
    return tag.replace('./assets/'+sha+'.png',endpoint+'?'+query.toString().replaceAll('&','&amp;'));
  });
  return Buffer.byteLength(rendered)<=750000 ? {html:rendered,media:true} : null;
}

/** Only call with a service-key RPC response and a validated requested digest. */
export async function readFrozenPng(response, expectedSha) {
  const value=await readBoundedRpcJson(response,5_350_000);
  if(value===null) return null;
  if(!value||Object.keys(value).length!==1||typeof value.png!=='string'||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(value.png)) throw Error('Invalid PNG receipt');
  const png=Buffer.from(value.png,'base64');
  if(png.length<8||png.length>4_000_000||
     png.toString('base64')!==value.png||
     !png.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||
     createHash('sha256').update(png).digest('hex')!==expectedSha) throw Error('Invalid PNG receipt');
  return png;
}
