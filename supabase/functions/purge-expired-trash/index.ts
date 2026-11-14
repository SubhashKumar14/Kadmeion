/**
 * Internal, opt-in expired-Trash sweep. Never configure as a public browser
 * endpoint. A 32+ byte random secret is required in the Authorization header;
 * verify_jwt=false at the gateway is intentional for the trusted scheduler.
 *
 * The database performs the final due-state/ownership checks under locks.
 * Storage deletion is attempted first; no database record is removed while
 * its registered Storage objects still exist.
 */
import {timingSafeEqual} from 'node:crypto';

type Env=Readonly<Record<string,string|undefined>>;
type Dependencies={env?:Env;http?:typeof fetch};
type TrashRow={trash_id:string;object_paths:string[]};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_PATH=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/i;
const MAX_RESPONSE=256*1024;
const respond=(status:number,body:unknown):Response=>Response.json(body,{
  status,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex',
    'X-Content-Type-Options':'nosniff'}
});
function runtimeEnv():Env {
  const deno=(globalThis as unknown as {Deno?:{env?:{get:(name:string)=>string|undefined}}}).Deno;
  const keys=['KADMEION_TRASH_SWEEP_SECRET','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY',
    'KADMEION_LOCAL_INTEGRATION','KADMEION_TRASH_SWEEP_ENABLED'];
  return Object.fromEntries(keys.map(key=>[key,deno?.env?.get(key)]));
}
function configured(env:Env):{origin:string;key:string;secret:string}|null {
  try {
    if(env.KADMEION_TRASH_SWEEP_ENABLED!=='true')return null;
    const url=new URL(env.SUPABASE_URL??'');
    const local=env.KADMEION_LOCAL_INTEGRATION==='1'&&
      ['http://127.0.0.1:54321','http://localhost:54321'].includes(url.origin);
    if(!local&&url.origin!=='https://scyooqjitjzjdxgtanso.supabase.co')return null;
    if(url.pathname!=='/'||url.username||url.password||url.search||url.hash)return null;
    const key=env.SUPABASE_SERVICE_ROLE_KEY,secret=env.KADMEION_TRASH_SWEEP_SECRET;
    if(typeof key!=='string'||!key.startsWith('eyJ')||key.length<70||
      typeof secret!=='string'||secret.length<32||secret.length>256||
      !/^[A-Za-z0-9_-]+$/.test(secret))return null;
    return {origin:url.origin,key,secret};
  }catch{return null;}
}
function matchesSecret(authorization:string,secret:string):boolean {
  const a=new TextEncoder().encode(authorization),b=new TextEncoder().encode('Bearer '+secret);
  return a.byteLength===b.byteLength&&timingSafeEqual(a,b);
}
async function boundedJson(response:Response):Promise<unknown> {
  if(!response.ok){
    await response.body?.cancel();
    throw Error('Provider rejected internal sweep operation');
  }
  if(!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(
    response.headers.get('content-type')??''))throw Error('Invalid provider response');
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_RESPONSE))
    throw Error('Oversized provider response');
  if(!response.body)throw Error('Missing provider response');
  const reader=response.body.getReader();
  const chunks:Uint8Array[]=[];let size=0;
  try {
    for(;;){
      const item=await reader.read();
      if(item.done)break;
      size+=item.value.byteLength;
      if(size>MAX_RESPONSE){await reader.cancel();throw Error('Oversized provider response');}
      chunks.push(item.value);
    }
  }finally{reader.releaseLock();}
  if(length!==null&&Number(length)!==size)throw Error('Provider length mismatch');
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
function validRow(row:unknown):row is TrashRow {
  if(row===null||typeof row!=='object'||Array.isArray(row))return false;
  const value=row as Record<string,unknown>;
  return Object.keys(value).sort().join(',')==='item_type,object_paths,trash_id'&&
    (value.item_type==='project'||value.item_type==='portfolio')&&
    typeof value.trash_id==='string'&&UUID.test(value.trash_id)&&
    Array.isArray(value.object_paths)&&value.object_paths.length<=100&&
    value.object_paths.every(p=>typeof p==='string'&&OBJECT_PATH.test(p)&&!p.includes('..'))&&
    new Set(value.object_paths).size===value.object_paths.length&&
    (value.item_type==='project'||value.object_paths.length===0);
}

export async function handlePurgeExpiredTrash(request:Request,deps:Dependencies={}):Promise<Response> {
  if(request.method!=='POST')return respond(405,{error:'Method not allowed'});
  const config=configured(deps.env??runtimeEnv());
  if(!config)return respond(404,{error:'Not found'});
  if(!matchesSecret(request.headers.get('authorization')??'',config.secret))
    return respond(401,{error:'Unauthorized'});
  const http=deps.http??fetch;
  const call=async(path:string,method:'POST'|'DELETE',payload:unknown):Promise<unknown>=>{
    const response=await http(config.origin+path,{
      method,credentials:'omit',cache:'no-store',redirect:'error',
      signal:AbortSignal.timeout(10_000),
      headers:{apikey:config.key,Authorization:'Bearer '+config.key,
        'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify(payload)
    });
    return boundedJson(response);
  };
  let rows:unknown;
  try{rows=await call('/rest/v1/rpc/service_list_expired_trash','POST',{p_limit:10});}
  catch{return respond(503,{error:'Trash sweep unavailable'});}
  if(!Array.isArray(rows)||rows.length>10||rows.some(row=>!validRow(row))||
     new Set(rows.map(row=>(row as TrashRow).trash_id)).size!==rows.length)
    return respond(503,{error:'Trash inventory rejected'});
  let purged=0,pending=0;
  for(const row of rows as TrashRow[]){
    try {
      if(row.object_paths.length){
        await call('/storage/v1/object/kadmeion-private-assets','DELETE',
          {prefixes:row.object_paths});
      }
      const result=await call('/rest/v1/rpc/service_purge_expired_trash',
        'POST',{p_trash_id:row.trash_id});
      if(result==='PURGED')purged++;
      else pending++;
    }catch{pending++;}
  }
  return respond(pending?207:200,{purged,pending});
}
// Edge runtime entrypoint; does not start an HTTP listener when imported in Node.
const deno=(globalThis as unknown as {Deno?:{serve?:(handler:(r:Request)=>Promise<Response>)=>unknown}}).Deno;
if(deno?.serve)deno.serve(handlePurgeExpiredTrash);
