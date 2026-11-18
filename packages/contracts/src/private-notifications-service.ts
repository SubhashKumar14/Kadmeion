import { isSafeSupabaseClientKey } from './project.ts';
/**
 * WF-045 owner notifications. The authoritative event source is the committed
 * PostgreSQL trigger, not fabricated client-side activity. All reads use
 * owner-JWT RLS and only the two narrowly granted owner RPCs mutate state.
 * Email transport is intentionally NOT implied by an in-app event.
 */
export type PrivateNotificationCategory='SECURITY'|'MODERATION'|'REVIEWER'|'PUBLISH'|'SYNC';
export type PrivateNotificationPriority='HIGH'|'NORMAL';
export type PrivateNotificationEvent=
  'ACCOUNT_EXIT_REQUESTED'|'MODERATION_OPENED'|'MODERATION_DECIDED'|
  'MODERATION_HOLD_LIFTED'|'PORTFOLIO_MODERATION_BLOCKED'|
  'REVIEWER_GRANT_ISSUED'|'REVIEWER_GRANT_REVOKED'|
  'RELEASE_VERIFIED'|'CLOUD_REVISION_SAVED';
export interface PrivateNotification {
  id:string;
  owner_user_id:string;
  event_type:PrivateNotificationEvent;
  category:PrivateNotificationCategory;
  priority:PrivateNotificationPriority;
  target_id:string;
  created_at:string;
  read_at:string|null;
  dismissed_at:string|null;
}
export interface PrivateNotificationPreferences {
  owner_user_id:string;
  reviewer_enabled:boolean;
  publish_enabled:boolean;
  sync_enabled:boolean;
}
export interface PrivateNotificationReceipt {
  id:string;read_at:string;dismissed_at:string|null;
}
export interface PrivateNotificationPage {
  items:PrivateNotification[];
  nextCursor:string|null;
}
export type NotificationErrorCode='VALIDATION'|'AUTH_EXPIRED'|'FORBIDDEN'|
  'PROVIDER_UNAVAILABLE'|'INVALID_ACK'|'LIMIT_EXCEEDED';
export class PrivateNotificationsError extends Error {
  readonly code:NotificationErrorCode;
  constructor(code:NotificationErrorCode){
    super('Owner notifications unavailable: '+code);
    this.name='PrivateNotificationsError';
    this.code=code;
  }
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_RESPONSE=256*1024;
const categoryByEvent:Readonly<Record<PrivateNotificationEvent,PrivateNotificationCategory>>={
  ACCOUNT_EXIT_REQUESTED:'SECURITY',
  MODERATION_OPENED:'MODERATION',MODERATION_DECIDED:'MODERATION',
  MODERATION_HOLD_LIFTED:'MODERATION',PORTFOLIO_MODERATION_BLOCKED:'MODERATION',
  REVIEWER_GRANT_ISSUED:'REVIEWER',REVIEWER_GRANT_REVOKED:'REVIEWER',
  RELEASE_VERIFIED:'PUBLISH',CLOUD_REVISION_SAVED:'SYNC'
};
const exact=(value:Record<string,unknown>,keys:readonly string[]):boolean=>
  Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const object=(value:unknown):value is Record<string,unknown>=>
  value!==null&&typeof value==='object'&&!Array.isArray(value);
const id=(value:unknown):value is string=>typeof value==='string'&&UUID.test(value);
const instant=(value:unknown):value is string=>
  typeof value==='string'&&DATE.test(value)&&!Number.isNaN(Date.parse(value));
function validNotice(value:unknown):value is PrivateNotification {
  if(!object(value)||!exact(value,[
    'id','owner_user_id','event_type','category','priority','target_id',
    'created_at','read_at','dismissed_at'
  ])||!id(value.id)||!id(value.owner_user_id)||!id(value.target_id)||
    !instant(value.created_at)||
    (value.read_at!==null&&!instant(value.read_at))||
    (value.dismissed_at!==null&&!instant(value.dismissed_at))||
    (value.dismissed_at!==null&&value.read_at===null)||
    typeof value.event_type!=='string'||
    !Object.hasOwn(categoryByEvent,value.event_type))
    return false;
  const expected=categoryByEvent[value.event_type as PrivateNotificationEvent];
  if(value.category!==expected||value.priority!==
    (expected==='SECURITY'||expected==='MODERATION'?'HIGH':'NORMAL'))return false;
  const created=Date.parse(value.created_at as string);
  if(value.read_at!==null&&Date.parse(value.read_at as string)<created)return false;
  if(value.dismissed_at!==null&&
     Date.parse(value.dismissed_at as string)<Date.parse(value.read_at as string))return false;
  return true;
}
function validPrefs(value:unknown):value is PrivateNotificationPreferences {
  return object(value)&&exact(value,[
    'owner_user_id','reviewer_enabled','publish_enabled','sync_enabled'
  ])&&id(value.owner_user_id)&&
  typeof value.reviewer_enabled==='boolean'&&
  typeof value.publish_enabled==='boolean'&&
  typeof value.sync_enabled==='boolean';
}
function validReceipt(value:unknown):value is PrivateNotificationReceipt {
  return object(value)&&exact(value,['id','read_at','dismissed_at'])&&
    id(value.id)&&instant(value.read_at)&&
    (value.dismissed_at===null||
      (instant(value.dismissed_at)&&Date.parse(value.dismissed_at)>=Date.parse(value.read_at)));
}
function parseCursor(value:string|null):{createdAt:string;id:string}|null {
  if(value===null)return null;
  if(typeof value!=='string'||value.length>120)
    throw new PrivateNotificationsError('VALIDATION');
  const parts=value.split('|');
  if(parts.length!==2||!instant(parts[0])||!id(parts[1]))
    throw new PrivateNotificationsError('VALIDATION');
  return {createdAt:parts[0],id:parts[1].toLowerCase()};
}
// PostgreSQL timestamps carry up to six fractional digits; Date.parse only
// preserves three. Compare the remaining digits before the UUID tie-break.
function compareNoticeKey(aTime:string,aId:string,bTime:string,bId:string):number {
  const millis=Date.parse(aTime)-Date.parse(bTime);
  if(millis!==0)return Math.sign(millis);
  const submillis=(time:string)=>Number((/\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/.exec(time)?.[1]??'').padEnd(6,'0').slice(3));
  const micros=submillis(aTime)-submillis(bTime);
  if(micros!==0)return Math.sign(micros);
  const a=aId.toLowerCase(),b=bId.toLowerCase();
  return a===b?0:a<b?-1:1;
}
function ensureNotificationDeadline(signal:AbortSignal,deadlineAt:number):void {
  if(signal.aborted||!Number.isFinite(deadlineAt)||performance.now()>=deadlineAt)
    throw new PrivateNotificationsError('PROVIDER_UNAVAILABLE');
}
async function boundedJson(response:Response,signal:AbortSignal,deadlineAt:number):Promise<unknown> {
  const type=response.headers.get('content-type');
  if(!type||!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(type))
    {void response.body?.cancel().catch(()=>{});throw new PrivateNotificationsError('INVALID_ACK');}
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_RESPONSE))
    {void response.body?.cancel().catch(()=>{});throw new PrivateNotificationsError('LIMIT_EXCEEDED');}
  if(!response.body)throw new PrivateNotificationsError('INVALID_ACK');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];
  let count=0,chunks=0;
  try{
    for(;;){
      ensureNotificationDeadline(signal,deadlineAt);
      let onAbort:()=>void=()=>{};
      const aborted=new Promise<never>((_,reject)=>{
        onAbort=()=>reject(signal.reason);signal.addEventListener('abort',onAbort,{once:true});
      });
      let chunk:ReadableStreamReadResult<Uint8Array>;
      try{chunk=await Promise.race([reader.read(),aborted]);}
      finally{signal.removeEventListener('abort',onAbort);}
      ensureNotificationDeadline(signal,deadlineAt);const {done,value}=chunk;
      if(done)break;
      if(++chunks>65_536)throw new PrivateNotificationsError('LIMIT_EXCEEDED');
      if(!(value instanceof Uint8Array))throw new PrivateNotificationsError('INVALID_ACK');
      if(value.byteLength===0)continue;
      count+=value.byteLength;
      if(count>MAX_RESPONSE)throw new PrivateNotificationsError('LIMIT_EXCEEDED');
      parts.push(value);
    }
  }catch(error){
    void reader.cancel().catch(()=>{});
    if(error instanceof PrivateNotificationsError)throw error;
    throw new PrivateNotificationsError('PROVIDER_UNAVAILABLE');
  }finally{reader.releaseLock();}
  const encoding=response.headers.get('content-encoding');
  if(length!==null&&(!encoding||encoding.toLowerCase()==='identity')&&
    count!==Number(length))throw new PrivateNotificationsError('INVALID_ACK');
  const bytes=new Uint8Array(count);let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  let result:unknown;
  try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}
  catch{throw new PrivateNotificationsError('INVALID_ACK');}
  ensureNotificationDeadline(signal,deadlineAt);
  return result;
}

/** Never accept an owner ID in a query or mutation; Postgres derives it from JWT. */
export class SupabasePrivateNotificationsService {
  private readonly origin:string;
  private readonly key:string;
  private readonly owner:string;
  private readonly token:()=>Promise<string|null>;
  private readonly http:typeof fetch;
  constructor(endpoint:string,publishableKey:string,ownerUserId:string,
    accessToken:()=>Promise<string|null>,http:typeof fetch=fetch){
    let u:URL;
    try{u=new URL(endpoint);}catch{throw new PrivateNotificationsError('VALIDATION');}
    if((u.protocol!=='https:'&&!(u.protocol==='http:'&&
      ['localhost','127.0.0.1'].includes(u.hostname)))||
      u.username||u.password||u.pathname!=='/'||u.search||u.hash||
      typeof publishableKey!=='string'||!publishableKey.trim()||
      publishableKey.startsWith('sb_secret_')||!id(ownerUserId)||
      typeof accessToken!=='function')
      throw new PrivateNotificationsError('VALIDATION');
    if(!isSafeSupabaseClientKey(publishableKey))
      throw new PrivateNotificationsError('VALIDATION');
    this.origin=u.origin;this.key=publishableKey;
    this.owner=ownerUserId.toLowerCase();this.token=accessToken;this.http=http;
  }
  private async request(path:string,method:'GET'|'POST',
    body?:Record<string,unknown>):Promise<unknown>{
    const deadlineAt=performance.now()+10_000;
    const signal=AbortSignal.timeout(10000);
    let abort:()=>void=()=>{};
    const deadline=new Promise<never>((_,reject)=>{
      abort=()=>reject(new PrivateNotificationsError('PROVIDER_UNAVAILABLE'));
      signal.addEventListener('abort',abort,{once:true});
    });
    const work=async()=>{
      const jwt=await this.token();
      if(typeof jwt!=='string'||!jwt.trim())throw new PrivateNotificationsError('AUTH_EXPIRED');
      ensureNotificationDeadline(signal,deadlineAt);
      const requestUrl=this.origin+'/rest/v1/'+path;
      const response=await this.http(requestUrl,{
        method,headers:{apikey:this.key,Authorization:'Bearer '+jwt,
          Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},
        body:body===undefined?undefined:JSON.stringify(body),
        credentials:'omit',cache:'no-store',redirect:'error',signal
      });
      try{
        ensureNotificationDeadline(signal,deadlineAt);
        if(response.redirected||(response.url&&response.url!==new URL(requestUrl).href))
          throw new PrivateNotificationsError('INVALID_ACK');
        if(!response.ok){
          if(response.status===401)throw new PrivateNotificationsError('AUTH_EXPIRED');
          if(response.status===403)throw new PrivateNotificationsError('FORBIDDEN');
          if(response.status===429)throw new PrivateNotificationsError('LIMIT_EXCEEDED');
          throw new PrivateNotificationsError('PROVIDER_UNAVAILABLE');
        }
        const data=await boundedJson(response,signal,deadlineAt);
        if(await this.token()!==jwt)throw new PrivateNotificationsError('AUTH_EXPIRED');
        ensureNotificationDeadline(signal,deadlineAt);
        return data;
      }finally{if(!response.bodyUsed)void response.body?.cancel().catch(()=>{});}
    };
    try{
      const data=await Promise.race([deadline,work()]);ensureNotificationDeadline(signal,deadlineAt);return data;
    }catch(error){
      if(error instanceof PrivateNotificationsError)throw error;
      throw new PrivateNotificationsError('PROVIDER_UNAVAILABLE');
    }finally{signal.removeEventListener('abort',abort);}
  }
  /**
   * Stable timestamp+UUID keyset ordering. Neither an empty page nor a
   * truncated response asserts that all historic notices were downloaded.
   */
  async listPage(limit=50,after:string|null=null):Promise<PrivateNotificationPage>{
    if(!Number.isSafeInteger(limit)||limit<1||limit>50)
      throw new PrivateNotificationsError('VALIDATION');
    const cursor=parseCursor(after);
    const qs=new URLSearchParams();
    qs.set('select','id,owner_user_id,event_type,category,priority,target_id,created_at,read_at,dismissed_at');
    qs.set('dismissed_at','is.null');
    if(cursor)qs.set('or','(created_at.lt.'+cursor.createdAt+
      ',and(created_at.eq.'+cursor.createdAt+',id.lt.'+cursor.id+'))');
    qs.set('order','created_at.desc,id.desc');
    qs.set('limit',String(limit+1));
    const raw=await this.request('private_notifications?'+qs.toString(),'GET');
    if(!Array.isArray(raw)||raw.length>limit+1||
      raw.some(row=>!validNotice(row)||row.owner_user_id.toLowerCase()!==this.owner||
        row.dismissed_at!==null))
      throw new PrivateNotificationsError('INVALID_ACK');
    const rows=raw as PrivateNotification[],seen=new Set<string>();
    for(let i=0;i<rows.length;i++){
      const row=rows[i];
      if(!row||seen.has(row.id.toLowerCase()))throw new PrivateNotificationsError('INVALID_ACK');
      seen.add(row.id.toLowerCase());
      const previous=i?rows[i-1]:null;
      if(previous&&compareNoticeKey(row.created_at,row.id,previous.created_at,previous.id)>=0)
        throw new PrivateNotificationsError('INVALID_ACK');
      if(cursor&&compareNoticeKey(row.created_at,row.id,cursor.createdAt,cursor.id)>=0)
        throw new PrivateNotificationsError('INVALID_ACK');
    }
    const items=rows.slice(0,limit);
    const last=items.at(-1);
    return {items,nextCursor:rows.length>limit&&last?last.created_at+'|'+last.id:null};
  }
  /** null is a genuinely absent server row, not a fabricated saved preference. */
  async getPreferences():Promise<PrivateNotificationPreferences|null>{
    const raw=await this.request(
      'private_notification_preferences?select=owner_user_id,reviewer_enabled,publish_enabled,sync_enabled&limit=2','GET');
    if(!Array.isArray(raw)||raw.length>1||
      (raw.length===1&&(!validPrefs(raw[0])||raw[0].owner_user_id.toLowerCase()!==this.owner)))
      throw new PrivateNotificationsError('INVALID_ACK');
    return (raw[0] as PrivateNotificationPreferences|undefined)??null;
  }
  /** Security and moderation notices cannot be muted via these preferences. */
  async setPreferences(input:{reviewerEnabled:boolean;publishEnabled:boolean;syncEnabled:boolean}):
    Promise<PrivateNotificationPreferences>{
    if(!object(input)||!exact(input,['reviewerEnabled','publishEnabled','syncEnabled'])||
      typeof input.reviewerEnabled!=='boolean'||typeof input.publishEnabled!=='boolean'||
      typeof input.syncEnabled!=='boolean')
      throw new PrivateNotificationsError('VALIDATION');
    const raw=await this.request('rpc/owner_set_notification_preferences','POST',{
      p_reviewer_enabled:input.reviewerEnabled,
      p_publish_enabled:input.publishEnabled,
      p_sync_enabled:input.syncEnabled
    });
    if(!validPrefs(raw)||raw.owner_user_id.toLowerCase()!==this.owner||
      raw.reviewer_enabled!==input.reviewerEnabled||
      raw.publish_enabled!==input.publishEnabled||
      raw.sync_enabled!==input.syncEnabled)
      throw new PrivateNotificationsError('INVALID_ACK');
    return raw;
  }
  async acknowledge(notificationId:string,dismiss=false):Promise<PrivateNotificationReceipt>{
    if(!id(notificationId)||typeof dismiss!=='boolean')
      throw new PrivateNotificationsError('VALIDATION');
    const normalized=notificationId.toLowerCase();
    const raw=await this.request('rpc/owner_acknowledge_notification','POST',{
      p_id:normalized,p_dismiss:dismiss
    });
    if(!validReceipt(raw)||raw.id.toLowerCase()!==normalized||
      (dismiss&&raw.dismissed_at===null))
      throw new PrivateNotificationsError('INVALID_ACK');
    return raw;
  }
}

