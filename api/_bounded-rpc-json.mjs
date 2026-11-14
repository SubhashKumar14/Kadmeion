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
