import { isSafeSupabaseClientKey } from './project.ts';

/**
 * Owner-scoped immutable My Component versions (WF-025).
 * Saved TSX is untrusted private DATA, not approved JS or an executable
 * public library. Live Auth session is verified again inside every RPC.
 */
export interface MyComponentVersion {
  id:string;
  owner_user_id:string;
  component_key:string;
  version:number;
  display_name:string;
  base_component_pin:string;
  pristine_source:string;
  source_code:string;
  compatible_slot_kinds:string[];
  source_sha256:string;
  created_at:string;
}
export interface MyComponentInput {
  operationId:string;componentKey:string;displayName:string;
  baseComponentPin:string;pristineSource:string;sourceCode:string;
  compatibleSlotKinds:string[];
}
export class MyComponentError extends Error {
  readonly code:'VALIDATION'|'AUTH_EXPIRED'|'FORBIDDEN'|'CONFLICT'|
    'QUOTA'|'PROVIDER_UNAVAILABLE'|'INVALID_ACK';
  constructor(code:MyComponentError['code']){
    super('Private component operation was not completed: '+code);
    this.name='MyComponentError';this.code=code;
  }
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PIN=/^[a-z][a-z0-9-]*@[0-9]+(?:\.[0-9]+){0,2}$/;
const KEY=/^[a-z][a-z0-9-]{2,63}$/;
const SHA=/^[a-f0-9]{64}$/;
const MAX_BYTES=8*1024*1024;
const SLOTS=new Set(['title','text','cta1','cta2','note','avatar','btn1','btn2',
  'imagea','imageb','project','thumbs','media','image','badge','meta','cta',
  'text1','card','text2','items','entries']);
const encoder=new TextEncoder();
const obj=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v);
function validInput(input:MyComponentInput):boolean {
  return obj(input)&&Object.keys(input).sort().join(',')===
    'baseComponentPin,compatibleSlotKinds,componentKey,displayName,operationId,pristineSource,sourceCode'&&
    uuid(input.operationId)&&typeof input.componentKey==='string'&&KEY.test(input.componentKey)&&
    typeof input.displayName==='string'&&input.displayName.trim().length>0&&
    input.displayName.length<=80&&typeof input.baseComponentPin==='string'&&
    PIN.test(input.baseComponentPin)&&
    typeof input.sourceCode==='string'&&encoder.encode(input.sourceCode).byteLength>=1&&
    encoder.encode(input.sourceCode).byteLength<=32768&&
    typeof input.pristineSource==='string'&&encoder.encode(input.pristineSource).byteLength>=1&&
    encoder.encode(input.pristineSource).byteLength<=32768&&
    Array.isArray(input.compatibleSlotKinds)&&
    input.compatibleSlotKinds.length>=1&&input.compatibleSlotKinds.length<=20&&
    input.compatibleSlotKinds.every((k:unknown)=>typeof k==='string'&&SLOTS.has(k))&&
    new Set(input.compatibleSlotKinds).size===input.compatibleSlotKinds.length;
}
function validRow(raw:unknown):raw is MyComponentVersion {
  if(!obj(raw)||Object.keys(raw).sort().join(',')!==
     'base_component_pin,compatible_slot_kinds,component_key,created_at,display_name,id,owner_user_id,pristine_source,source_code,source_sha256,version')
    return false;
  return uuid(raw.id)&&uuid(raw.owner_user_id)&&
    typeof raw.component_key==='string'&&KEY.test(raw.component_key)&&
    typeof raw.version==='number'&&Number.isInteger(raw.version)&&
    raw.version>=1&&raw.version<=40&&
    typeof raw.display_name==='string'&&raw.display_name.trim().length>0&&
    raw.display_name.length<=80&&
    typeof raw.base_component_pin==='string'&&PIN.test(raw.base_component_pin)&&
    typeof raw.pristine_source==='string'&&encoder.encode(raw.pristine_source).byteLength>=1&&
    encoder.encode(raw.pristine_source).byteLength<=32768&&
    typeof raw.source_code==='string'&&encoder.encode(raw.source_code).byteLength>=1&&
    encoder.encode(raw.source_code).byteLength<=32768&&
    typeof raw.source_sha256==='string'&&SHA.test(raw.source_sha256)&&
    Array.isArray(raw.compatible_slot_kinds)&&raw.compatible_slot_kinds.length>=1&&
    raw.compatible_slot_kinds.length<=20&&
    raw.compatible_slot_kinds.every((k:unknown)=>typeof k==='string'&&SLOTS.has(k))&&
    raw.compatible_slot_kinds.every((k:string,i:number,a:string[])=>i===0||(a[i-1]??'')<k)&&
    typeof raw.created_at==='string'&&raw.created_at.length<=60&&
    !Number.isNaN(Date.parse(raw.created_at));
}
async function hashSource(text:string):Promise<string> {
  const value=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)));
  return Array.from(value,b=>b.toString(16).padStart(2,'0')).join('');
}
async function parseBounded(response:Response):Promise<unknown> {
  const type=response.headers.get('content-type');
  if(!type||!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(type))
    throw new MyComponentError('INVALID_ACK');
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BYTES))
    throw new MyComponentError('INVALID_ACK');
  if(!response.body)throw new MyComponentError('INVALID_ACK');
  const reader=response.body.getReader();const parts:Uint8Array[]=[];let total=0;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      if(!(value instanceof Uint8Array))throw new MyComponentError('INVALID_ACK');
      total+=value.byteLength;
      if(total>MAX_BYTES){await reader.cancel();throw new MyComponentError('INVALID_ACK');}
      parts.push(value);
    }
  }finally{reader.releaseLock();}
  const encoding=response.headers.get('content-encoding');
  if(length!==null&&(!encoding||encoding.toLowerCase()==='identity')&&Number(length)!==total)
    throw new MyComponentError('INVALID_ACK');
  const bytes=new Uint8Array(total);let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}
  catch{throw new MyComponentError('INVALID_ACK');}
}
export class SupabaseMyComponentsService {
  private readonly origin:string;private readonly key:string;
  private readonly token:()=>Promise<string|null>;
  private readonly http:typeof fetch;
  constructor(endpoint:string,publishableKey:string,token:()=>Promise<string|null>,
    http:typeof fetch=fetch){
    let url:URL;
    try{url=new URL(endpoint);}catch{throw new MyComponentError('VALIDATION');}
    if((url.protocol!=='https:'&&!(url.protocol==='http:'&&
        ['127.0.0.1','localhost'].includes(url.hostname)))||
      url.username||url.password||url.pathname!=='/'||url.search||url.hash||
      !isSafeSupabaseClientKey(publishableKey))
      throw new MyComponentError('VALIDATION');
    this.origin=url.origin;this.key=publishableKey;this.token=token;this.http=http;
  }
  private async send(url:string,method:'GET'|'POST',jwt:string,body?:object):Promise<unknown>{
    let result:Response;
    try{
      result=await this.http(this.origin+url,{
        method,headers:{apikey:this.key,Authorization:'Bearer '+jwt,
          Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
        body:body?JSON.stringify(body):undefined,redirect:'error',
        credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000)
      });
    }catch{throw new MyComponentError('PROVIDER_UNAVAILABLE');}
    if(!result.ok){
      let code:string|undefined;
      try{const v=await parseBounded(result);if(obj(v)&&typeof v.code==='string')code=v.code;}
      catch{/* Error message is never sent to the caller. */}
      if(result.status===401)throw new MyComponentError('AUTH_EXPIRED');
      if(result.status===403||code==='42501')throw new MyComponentError('FORBIDDEN');
      if(result.status===409||code==='23505')throw new MyComponentError('CONFLICT');
      if(code==='54000')throw new MyComponentError('QUOTA');
      if(code==='22023'||result.status===400)throw new MyComponentError('VALIDATION');
      throw new MyComponentError('PROVIDER_UNAVAILABLE');
    }
    return parseBounded(result);
  }
  private async auth():Promise<{jwt:string;owner:string}>{
    const jwt=await this.token();
    if(typeof jwt!=='string'||jwt.length<20)throw new MyComponentError('AUTH_EXPIRED');
    const current=await this.send('/auth/v1/user','GET',jwt);
    if(!obj(current)||!uuid(current.id))throw new MyComponentError('AUTH_EXPIRED');
    return {jwt,owner:current.id.toLowerCase()};
  }
  private async stable(jwt:string):Promise<void>{
    if(await this.token()!==jwt)throw new MyComponentError('AUTH_EXPIRED');
  }
  private async verify(raw:unknown,owner:string):Promise<MyComponentVersion>{
    if(!validRow(raw)||raw.owner_user_id!==owner||
       await hashSource(raw.source_code)!==raw.source_sha256)
      throw new MyComponentError('INVALID_ACK');
    return raw;
  }
  async saveVersion(input:MyComponentInput):Promise<MyComponentVersion>{
    if(!validInput(input))throw new MyComponentError('VALIDATION');
    const {jwt,owner}=await this.auth();
    const kinds=[...input.compatibleSlotKinds].sort();
    const row=await this.verify(await this.send('/rest/v1/rpc/owner_save_my_component',
      'POST',jwt,{
        p_operation_id:input.operationId.toLowerCase(),p_component_key:input.componentKey,
        p_display_name:input.displayName,p_base_component_pin:input.baseComponentPin,
        p_pristine_source:input.pristineSource,p_source_code:input.sourceCode,
        p_slot_kinds:kinds
      }),owner);
    if(row.id!==input.operationId.toLowerCase()||
       row.component_key!==input.componentKey||row.display_name!==input.displayName||
       row.base_component_pin!==input.baseComponentPin||
       row.pristine_source!==input.pristineSource||
       row.source_code!==input.sourceCode||
       JSON.stringify(row.compatible_slot_kinds)!==JSON.stringify(kinds))
      throw new MyComponentError('INVALID_ACK');
    await this.stable(jwt);
    return row;
  }
  async listVersions():Promise<MyComponentVersion[]>{
    const {jwt,owner}=await this.auth();
    const payload=await this.send('/rest/v1/rpc/owner_list_my_component_versions','POST',jwt,{});
    if(!obj(payload)||Object.keys(payload).sort().join(',')!==
        'items,ownerUserId,publicExecutionTrusted,status'||
       payload.status!=='OWNER_PRIVATE_COMPONENTS'||
       payload.ownerUserId!==owner||payload.publicExecutionTrusted!==false||
       !Array.isArray(payload.items)||payload.items.length>40)
      throw new MyComponentError('INVALID_ACK');
    const rows:MyComponentVersion[]=[];const seen=new Set<string>();
    for(const raw of payload.items){
      const row=await this.verify(raw,owner);
      if(seen.has(row.id))throw new MyComponentError('INVALID_ACK');
      seen.add(row.id);
      const previous=rows.at(-1);
      if(previous&&(previous.component_key>row.component_key||
         (previous.component_key===row.component_key&&previous.version<=row.version)))
        throw new MyComponentError('INVALID_ACK');
      rows.push(row);
    }
    await this.stable(jwt);
    return rows;
  }
  async getVersion(id:string):Promise<MyComponentVersion|null>{
    if(!uuid(id))throw new MyComponentError('VALIDATION');
    const {jwt,owner}=await this.auth();
    const raw=await this.send('/rest/v1/rpc/owner_get_my_component_version',
      'POST',jwt,{p_id:id.toLowerCase()});
    const item=raw===null?null:await this.verify(raw,owner);
    if(item!==null&&item.id!==id.toLowerCase())throw new MyComponentError('INVALID_ACK');
    await this.stable(jwt);
    return item;
  }
}

