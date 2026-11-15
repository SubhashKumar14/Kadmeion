import {isSafeSupabaseClientKey} from './project.ts';

/**
 * LINK_ONLY personal handles. No OAuth, scraping, provider metrics,
 * ownership verification or public profile publication is implied.
 */
export type PlatformProvider = 'GITHUB'|'LEETCODE'|'CODEFORCES'|'HACKERRANK'|'KAGGLE'|'HUGGING_FACE';
export interface PrivatePlatformLink {
  id:string;owner_user_id:string;provider:PlatformProvider;handle:string;
  profile_url:string;provenance:'USER_SUPPLIED';connection_mode:'LINK_ONLY';
  sync_status:'NOT_SYNCED';ownership_verified:false;
  created_at:string;updated_at:string;
}
export class PrivatePlatformLinkError extends Error {
  readonly code:'VALIDATION'|'AUTH_EXPIRED'|'FORBIDDEN'|'CONFLICT'|'PROVIDER_UNAVAILABLE'|'INVALID_ACK';
  constructor(code:PrivatePlatformLinkError['code']){
    super('Private platform link could not be verified: '+code);
    this.name='PrivatePlatformLinkError';this.code=code;
  }
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const providers:Readonly<Record<PlatformProvider,string>>={
  GITHUB:'https://github.com/',
  LEETCODE:'https://leetcode.com/u/',
  CODEFORCES:'https://codeforces.com/profile/',
  HACKERRANK:'https://www.hackerrank.com/profile/',
  KAGGLE:'https://www.kaggle.com/',
  HUGGING_FACE:'https://huggingface.co/'
};
const SELECT='id,owner_user_id,provider,handle,profile_url,provenance,connection_mode,sync_status,ownership_verified,created_at,updated_at';
const isObject=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const isId=(v:unknown):v is string=>typeof v==='string'&&uuid.test(v);
function handleValid(provider:PlatformProvider,handle:string):boolean {
  if(typeof handle!=='string'||handle.length<2||handle.length>64||
    !/^[A-Za-z0-9_][A-Za-z0-9_.-]*[A-Za-z0-9_]$/.test(handle))return false;
  if(provider==='GITHUB')return handle.length<=39&&/^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/.test(handle);
  if(provider==='HUGGING_FACE')return /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/.test(handle);
  return true;
}
function providerValid(p:unknown):p is PlatformProvider {
  return typeof p==='string'&&Object.hasOwn(providers,p);
}
function isLink(v:unknown,owner:string):v is PrivatePlatformLink {
  if(!isObject(v)||Object.keys(v).sort().join(',')!==
    'connection_mode,created_at,handle,id,owner_user_id,ownership_verified,profile_url,provenance,provider,sync_status,updated_at'||
    !isId(v.id)||v.owner_user_id!==owner||!providerValid(v.provider)||
    typeof v.handle!=='string'||!handleValid(v.provider,v.handle)||
    v.profile_url!==providers[v.provider]+v.handle||
    v.provenance!=='USER_SUPPLIED'||v.connection_mode!=='LINK_ONLY'||
    v.sync_status!=='NOT_SYNCED'||v.ownership_verified!==false||
    typeof v.created_at!=='string'||!Number.isFinite(Date.parse(v.created_at))||
    typeof v.updated_at!=='string'||!Number.isFinite(Date.parse(v.updated_at)))return false;
  return true;
}
async function boundedJson(response:Response):Promise<unknown> {
  const type=response.headers.get('content-type');
  if(!type||!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(type))
    throw new PrivatePlatformLinkError('INVALID_ACK');
  const length=response.headers.get('content-length');
  const limit=64*1024;
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>limit))
    throw new PrivatePlatformLinkError('INVALID_ACK');
  if(!response.body)throw new PrivatePlatformLinkError('INVALID_ACK');
  const reader=response.body.getReader();let size=0;const parts:Uint8Array[]=[];
  try{
    for(;;){
      const chunk=await reader.read();
      if(chunk.done)break;
      if(!(chunk.value instanceof Uint8Array)||((size+=chunk.value.length)>limit))
        throw new PrivatePlatformLinkError('INVALID_ACK');
      parts.push(chunk.value);
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}
  catch{throw new PrivatePlatformLinkError('INVALID_ACK');}
}
export class SupabasePrivatePlatformLinksService {
  private readonly origin:string;
  private readonly key:string;
  private readonly ownerId:string;
  private readonly token:()=>Promise<string|null>;
  private readonly http:typeof fetch;
  constructor(
    endpoint:string,key:string,ownerId:string,token:()=>Promise<string|null>,
    http:typeof fetch=fetch
  ){
    let url:URL;
    try{url=new URL(endpoint);}catch{throw new PrivatePlatformLinkError('VALIDATION');}
    if((url.protocol!=='https:'&&!(url.protocol==='http:'&&
      ['localhost','127.0.0.1'].includes(url.hostname)))||
      url.username||url.password||url.pathname!=='/'||url.search||url.hash||
      !isSafeSupabaseClientKey(key)||!isId(ownerId))
      throw new PrivatePlatformLinkError('VALIDATION');
    this.origin=url.origin;this.key=key;this.ownerId=ownerId;this.token=token;this.http=http;
  }
  private async request(method:'GET'|'POST'|'PATCH'|'DELETE',query:string,body?:Record<string,unknown>) {
    const jwt=await this.token();
    if(!jwt)throw new PrivatePlatformLinkError('AUTH_EXPIRED');
    let response:Response;
    try{
      response=await this.http(this.origin+'/rest/v1/private_platform_links?'+query,{
        method,headers:{apikey:this.key,Authorization:'Bearer '+jwt,Accept:'application/json',
          ...(body===undefined?{}:{'Content-Type':'application/json'}),
          ...(method==='GET'?{}:{Prefer:'return=representation'})},
        body:body===undefined?undefined:JSON.stringify(body),
        credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)
      });
    }catch{throw new PrivatePlatformLinkError('PROVIDER_UNAVAILABLE');}
    if(!response.ok){
      await response.body?.cancel().catch(()=>{});
      if(response.status===401)throw new PrivatePlatformLinkError('AUTH_EXPIRED');
      if(response.status===403)throw new PrivatePlatformLinkError('FORBIDDEN');
      if(response.status===409)throw new PrivatePlatformLinkError('CONFLICT');
      throw new PrivatePlatformLinkError('PROVIDER_UNAVAILABLE');
    }
    const raw=await boundedJson(response);
    if(!Array.isArray(raw)||raw.length>6||raw.some(v=>!isLink(v,this.ownerId))||
      new Set(raw.map(v=>v.provider)).size!==raw.length)
      throw new PrivatePlatformLinkError('INVALID_ACK');
    return raw as PrivatePlatformLink[];
  }
  async list():Promise<PrivatePlatformLink[]> {
    const query='select='+SELECT+'&owner_user_id=eq.'+this.ownerId+'&order=created_at.desc&limit=6';
    return this.request('GET',query);
  }
  async save(provider:PlatformProvider,handle:string,existing?:PrivatePlatformLink):Promise<PrivatePlatformLink> {
    if(!providerValid(provider)||!handleValid(provider,handle)||
      (existing!==undefined&&(!isLink(existing,this.ownerId)||existing.provider!==provider)))
      throw new PrivatePlatformLinkError('VALIDATION');
    const method=existing?'PATCH':'POST';
    const query=existing
      ? 'select='+SELECT+'&id=eq.'+existing.id+'&owner_user_id=eq.'+this.ownerId
      : 'select='+SELECT;
    const rows=await this.request(method,query,existing?{handle}:{provider,handle});
    const row=rows[0];
    if(rows.length!==1||!row||row.provider!==provider||row.handle!==handle||
      (existing&&row.id!==existing.id))
      throw new PrivatePlatformLinkError('INVALID_ACK');
    return row;
  }
  async remove(existing:PrivatePlatformLink):Promise<string> {
    if(!isLink(existing,this.ownerId))throw new PrivatePlatformLinkError('VALIDATION');
    const rows=await this.request('DELETE',
      'select='+SELECT+'&id=eq.'+existing.id+'&owner_user_id=eq.'+this.ownerId);
    if(rows.length!==1||rows[0]?.id!==existing.id)
      throw new PrivatePlatformLinkError('INVALID_ACK');
    return existing.id;
  }
}
