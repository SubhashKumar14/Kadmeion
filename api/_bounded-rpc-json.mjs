/**
 * Fail-closed bounded JSON reader for private service-key RPC calls.
 * Transport JSON can be roughly twice the served HTML size when quotes and
 * backslashes are escaped. The HTML envelope retains its own 750 KB cap.
 */
export async function readBoundedRpcJson(response, limit=2 * 1024 * 1024) {
  if(!Number.isSafeInteger(limit)||limit<1||limit>2 * 1024 * 1024)throw Error('Invalid RPC limit');
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
