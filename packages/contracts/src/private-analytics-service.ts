import { isSafeSupabaseClientKey } from './project.ts';

export type AnalyticsErrorCode = 'INVALID'|'NOT_FOUND_OR_FORBIDDEN'|'CONFLICT'|'INELIGIBLE'|'RATE_LIMITED'|'UNAVAILABLE'|'TRANSPORT'|'INVALID_RESPONSE';
export class PrivateAnalyticsError extends Error {
  readonly code: AnalyticsErrorCode;
  constructor(code: AnalyticsErrorCode) {
    super('Private analytics: '+code); this.name='PrivateAnalyticsError'; this.code=code;
  }
}
export type AnalyticsAction='ENABLE'|'CLEAR'|'DISABLE';
export type AnalyticsQuality='PARTIAL'|'UNAVAILABLE';
export type AnalyticsBucket='DIRECT_OR_UNKNOWN'|'SEARCH'|'SOCIAL'|'OTHER_EXTERNAL'|'INTERNAL';
export interface OwnerAnalyticsState {
  portfolioId:string; enabled:boolean; eligible:boolean; version:number; policyVersion:1;
  enabledAt:string|null; coverageStartedAt:string|null; updatedAt:string|null; retentionDays:30;
}
export interface ChangeOwnerAnalyticsInput {
  portfolioId:string; action:AnalyticsAction; expectedVersion:number; operationId:string; policyVersion:1;
}
export interface OwnerAnalyticsChange extends Omit<OwnerAnalyticsState,'eligible'|'retentionDays'> {
  status:'APPLIED'|'REPLAYED'|'NO_CHANGE';
}
export interface ReadOwnerAnalyticsInput { portfolioIds:readonly string[]; windowDays:7|30 }
export interface AnalyticsDay { day:string; views:number|null; buckets:Record<AnalyticsBucket,number>|null; quality:AnalyticsQuality }
export interface AnalyticsPortfolio { portfolioId:string; version:number; coverageStartedAt:string; eligible:boolean; days:AnalyticsDay[]; quality:AnalyticsQuality }
export interface OwnerAnalytics { asOfUtc:string; fromDay:string; toDay:string; retentionDays:30; portfolios:AnalyticsPortfolio[] }

const MAX=Number.MAX_SAFE_INTEGER;
const SMALL=8192, LARGE=131072, DEADLINE=5000;
const BUCKETS=['DIRECT_OR_UNKNOWN','SEARCH','SOCIAL','OTHER_EXTERNAL','INTERNAL'] as const;
const fail=(code:AnalyticsErrorCode):never=>{throw new PrivateAnalyticsError(code)};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const integer=(v:unknown,max=MAX):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max;
const obj=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function exact(v:unknown,keys:readonly string[]):v is Record<string,unknown>{
  return obj(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(v,k));
}
function day(v:unknown):v is string {
  return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!v.startsWith('0000')&&
    Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
}
function instant(v:unknown):bigint|null {
  if(typeof v!=='string')return null;
  const m=/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,6}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(v);
  if(!m||!day(m[1]))return null;
  const ms=Date.parse(m[1]+'T'+m[2]+':'+m[3]+':'+m[4]+m[6]);
  return Number.isFinite(ms)?BigInt(ms)*1000n+BigInt((m[5]??'').padEnd(6,'0')):null;
}
function utcDay(v:string):string {return new Date(v).toISOString().slice(0,10)}
function plusDay(v:string,n:number):string {return new Date(Date.parse(v)+n*86400000).toISOString().slice(0,10)}
const common=['portfolioId','enabled','version','policyVersion','enabledAt','coverageStartedAt','updatedAt'] as const;
function consent(v:Record<string,unknown>,id:string):boolean{
  if(v.portfolioId!==id||typeof v.enabled!=='boolean'||!integer(v.version)||v.policyVersion!==1)return false;
  const updated=instant(v.updatedAt);
  if(v.enabled){
    const enabled=instant(v.enabledAt),coverage=instant(v.coverageStartedAt);
    return v.version>0&&v.version<MAX&&enabled!==null&&coverage!==null&&updated!==null&&enabled<=coverage&&coverage<=updated;
  }
  return v.enabledAt===null&&v.coverageStartedAt===null&&
    (v.version===0?v.updatedAt===null:updated!==null);
}
function state(v:unknown,id:string):OwnerAnalyticsState{
  if(!exact(v,[...common,'eligible','retentionDays'])||!consent(v,id)||typeof v.eligible!=='boolean'||v.retentionDays!==30) return fail('INVALID_RESPONSE');
  return v as unknown as OwnerAnalyticsState;
}
function change(v:unknown,input:ChangeOwnerAnalyticsInput):OwnerAnalyticsChange{
  if(!exact(v,[...common,'status'])||!consent(v,input.portfolioId))return fail('INVALID_RESPONSE');
  if(v.status==='NO_CHANGE'){
    if(input.action!=='DISABLE'||v.enabled!==false||v.version!==input.expectedVersion)return fail('INVALID_RESPONSE');
  } else if(v.status==='APPLIED'||v.status==='REPLAYED'){
    if(input.expectedVersion>=MAX||v.version!==input.expectedVersion+1||v.enabled!==(input.action!=='DISABLE')||v.updatedAt===null)return fail('INVALID_RESPONSE');
  }else return fail('INVALID_RESPONSE');
  return v as unknown as OwnerAnalyticsChange;
}
function comparison(v:unknown,ids:readonly string[],window:7|30):OwnerAnalytics{
  if(!exact(v,['asOfUtc','fromDay','toDay','retentionDays','portfolios'])||
     typeof v.asOfUtc!=='string'||instant(v.asOfUtc)===null||!day(v.fromDay)||!day(v.toDay)||
     v.toDay!==utcDay(v.asOfUtc)||v.fromDay!==plusDay(v.toDay,1-window)||v.retentionDays!==30||
     !Array.isArray(v.portfolios)||v.portfolios.length!==ids.length)return fail('INVALID_RESPONSE');
  for(let i=0;i<ids.length;i++){
    const p:unknown=v.portfolios[i];
    if(!exact(p,['portfolioId','version','coverageStartedAt','eligible','days','quality'])||
      p.portfolioId!==ids[i]||!integer(p.version)||p.version===0||p.version===MAX||
      typeof p.coverageStartedAt!=='string'||instant(p.coverageStartedAt)===null||
      instant(p.coverageStartedAt)!>instant(v.asOfUtc)!||typeof p.eligible!=='boolean'||
      !Array.isArray(p.days)||p.days.length!==window)return fail('INVALID_RESPONSE');
    let positive=false;
    for(let j=0;j<window;j++){
      const d:unknown=p.days[j];
      if(!exact(d,['day','views','buckets','quality'])||d.day!==plusDay(v.fromDay,j))return fail('INVALID_RESPONSE');
      if(d.quality==='UNAVAILABLE'){
        if(d.views!==null||d.buckets!==null)return fail('INVALID_RESPONSE');
      }else if(d.quality==='PARTIAL'){
        if(typeof d.day!=='string'||d.day<utcDay(p.coverageStartedAt)||!integer(d.views,250)||d.views===0||
           !exact(d.buckets,BUCKETS))return fail('INVALID_RESPONSE');
        let sum=0;
        for(const k of BUCKETS){const n=d.buckets[k];if(!integer(n,250))return fail('INVALID_RESPONSE');sum+=n}
        if(sum!==d.views)return fail('INVALID_RESPONSE');
        positive=true;
      }else return fail('INVALID_RESPONSE');
    }
    if(p.quality!==(positive?'PARTIAL':'UNAVAILABLE'))return fail('INVALID_RESPONSE');
  }
  return v as unknown as OwnerAnalytics;
}
function discard(body:ReadableStream<Uint8Array>|null):void {
  try{void body?.cancel().catch(()=>{})}catch{/* already locked */}
}
/** JSON.parse is last-key-wins; reject ambiguous wire receipts before use.
 * The first parse validates grammar, then a bounded lexical walk detects
 * duplicate decoded object keys without recursively traversing untrusted data.
 */
function parseReceipt(text:string,strictNumbers:boolean):unknown {
  const value:unknown=JSON.parse(text);
  const tokens=/"(?:[^"\\]|\\[\s\S])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]:]/g;
  const stack:Array<Set<string>|null>=[];
  for(let match=tokens.exec(text);match;match=tokens.exec(text)){
    const token=match[0];
    if(token==='{')stack.push(new Set<string>());
    else if(token==='[')stack.push(null);
    else if(token==='}'||token===']')stack.pop();
    else if(strictNumbers&&/^[0-9-]/.test(token)){
      // All success DTO numbers are nonnegative safe SQL integers, not rounded decimals.
      if(!/^(?:0|[1-9]\d*)$/.test(token)||!Number.isSafeInteger(Number(token)))return fail('INVALID_RESPONSE');
    }else if(token[0]==='"'){
      let next=tokens.lastIndex;
      while(next<text.length&&/[\x20\t\r\n]/.test(text.charAt(next)))next++;
      if(text[next]!==':')continue;
      const keys=stack[stack.length-1],key=JSON.parse(token) as string;
      if(!keys||keys.has(key))return fail('INVALID_RESPONSE');
      keys.add(key);
    }
  }
  return value;
}
async function boundedJson(response:Response,limit:number,signal:AbortSignal,deadline:number):Promise<unknown>{
  const type=response.headers.get('content-type')??'',length=response.headers.get('content-length');
  if(!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(type)||
    (length!==null&&(!/^\d+$/.test(length)||Number(length)>limit))||!response.body){
    discard(response.body);return fail('INVALID_RESPONSE');
  }
  const reader=response.body.getReader(),bytes=new Uint8Array(limit);let size=0,complete=false;
  const cancel=()=>{try{void reader.cancel().catch(()=>{})}catch{/* best effort */}};
  signal.addEventListener('abort',cancel,{once:true});
  try{
    if(signal.aborted||performance.now()>=deadline){cancel();return fail('TRANSPORT')}
    for(;;){
      let item:ReadableStreamReadResult<Uint8Array>;
      try{item=await reader.read()}catch{return fail('TRANSPORT')}
      if(signal.aborted||performance.now()>=deadline)return fail('TRANSPORT');
      if(item.done){complete=true;break}
      if(!(item.value instanceof Uint8Array)||item.value.byteLength===0||item.value.byteLength>limit-size)return fail('INVALID_RESPONSE');
      bytes.set(item.value,size);size+=item.value.byteLength;
    }
    const encoding=response.headers.get('content-encoding');
    if(length!==null&&(!encoding||encoding.toLowerCase()==='identity')&&size!==Number(length))return fail('INVALID_RESPONSE');
    try{return parseReceipt(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size)),response.ok)}
    catch{return fail('INVALID_RESPONSE')}
  }finally{
    signal.removeEventListener('abort',cancel);
    if(!complete)cancel();
    reader.releaseLock();
  }
}
function remoteError(status:number,raw:unknown):AnalyticsErrorCode{
  if(status===401||status===403)return 'NOT_FOUND_OR_FORBIDDEN';
  if(status===429)return 'RATE_LIMITED';
  if(!obj(raw))return 'UNAVAILABLE';
  switch(raw.code){
    case '22023':return 'INVALID';
    case '42501':return 'NOT_FOUND_OR_FORBIDDEN';
    case '40001':case '23505':case '55P03':return 'CONFLICT';
    case '54000':return 'RATE_LIMITED';
    case '55000':return raw.message==='ANALYTICS_INELIGIBLE'||raw.message==='ANALYTICS_TERMINAL'?'INELIGIBLE':'UNAVAILABLE';
    default:return 'UNAVAILABLE';
  }
}

/** Fixture-only owner adapter. No ambient fetch, collection, retries or cached auth.
 * The optional transport slot preserves factory signature compatibility but
 * missing explicit injection fails closed. Live wiring is a separate gate.
 */
export class SupabasePrivateAnalyticsService {
  private readonly origin:string;
  private readonly publishableKey:string;
  private readonly token:()=>Promise<string|null>;
  private readonly isCurrentOwner:()=>boolean;
  private readonly http:typeof fetch|undefined;
  private retired=false;
  constructor(endpoint:string,publishableKey:string,ownerId:string,
    token:()=>Promise<string|null>,isCurrentOwner:()=>boolean,http?:typeof fetch){
    let url:URL;
    try{url=new URL(endpoint)}catch{throw new PrivateAnalyticsError('INVALID')}
    if((url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))||
       url.username||url.password||url.pathname!=='/'||url.search||url.hash||
       !uuid(ownerId)||typeof publishableKey!=='string'||!isSafeSupabaseClientKey(publishableKey)||
       typeof token!=='function'||typeof isCurrentOwner!=='function')throw new PrivateAnalyticsError('INVALID');
    this.origin=url.origin; this.publishableKey=publishableKey; this.token=token;
    this.isCurrentOwner=isCurrentOwner; this.http=http;
  }
  private current():void{
    if(!this.retired){try{if(this.isCurrentOwner()===true)return}catch{/* fail closed */}}
    this.retired=true;fail('NOT_FOUND_OR_FORBIDDEN');
  }
  private async send(rpc:'read_owner_analytics_state'|'change_owner_analytics'|'read_owner_analytics',
    body:Record<string,unknown>,limit:number):Promise<unknown>{
    this.current();
    const http=this.http;
    if(!http)return fail('UNAVAILABLE');
    const controller=new AbortController();
    const endpoint=this.origin+'/rest/v1/rpc/'+rpc,deadline=performance.now()+DEADLINE;
    let timer:ReturnType<typeof setTimeout>|undefined;
    let response:Response|undefined;
    let expired=false;
    const timeout=new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>{expired=true;controller.abort();discard(response?.body??null);reject(new PrivateAnalyticsError('TRANSPORT'))},DEADLINE);
    });
    const work=async():Promise<unknown>=>{
      let jwt:string|null;
      try{jwt=await this.token()}catch{return fail('TRANSPORT')}
      this.current();
      if(expired||performance.now()>=deadline)return fail('TRANSPORT');
      if(typeof jwt!=='string'||!jwt.trim()||/[\r\n]/.test(jwt))return fail('NOT_FOUND_OR_FORBIDDEN');
      try{response=await http(endpoint,{
        method:'POST',headers:{apikey:this.publishableKey,Authorization:'Bearer '+jwt,Accept:'application/json','Content-Type':'application/json'},
        body:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal
      })}catch{return fail('TRANSPORT')}
      if(expired||performance.now()>=deadline){discard(response.body);return fail('TRANSPORT')}
      // Injected Response fixtures have no URL; real fetch responses must bind to this RPC.
      if(response.redirected||(response.url!==''&&response.url!==endpoint)){discard(response.body);return fail('INVALID_RESPONSE')}
      try{this.current()}catch(e){discard(response.body);throw e}
      if(!response.ok){
        const status=response.status;
        if(status===401||status===403||status===429){discard(response.body);return fail(remoteError(status,null))}
        let raw:unknown;
        try{raw=await boundedJson(response,SMALL,controller.signal,deadline)}catch(e){
          if(e instanceof PrivateAnalyticsError&&e.code==='TRANSPORT')throw e;
          raw=null;
        }
        this.current();return fail(remoteError(status,raw));
      }
      const raw=await boundedJson(response,limit,controller.signal,deadline);
      this.current();return raw;
    };
    try{const raw=await Promise.race([work(),timeout]);this.current();if(performance.now()>=deadline)return fail('TRANSPORT');return raw}
    catch(e){this.current();if(e instanceof PrivateAnalyticsError)throw e;return fail('TRANSPORT')}
    finally{if(timer!==undefined)clearTimeout(timer);controller.abort()}
  }
  async getOwnerAnalyticsState(portfolioId:string):Promise<OwnerAnalyticsState>{
    this.current();if(!uuid(portfolioId))return fail('INVALID');
    const raw=await this.send('read_owner_analytics_state',{p_portfolio_id:portfolioId},SMALL);
    this.current();return state(raw,portfolioId);
  }
  async changeOwnerAnalytics(input:ChangeOwnerAnalyticsInput):Promise<OwnerAnalyticsChange>{
    this.current();
    if(!exact(input,['portfolioId','action','expectedVersion','operationId','policyVersion'])||
       !uuid(input.portfolioId)||!uuid(input.operationId)||!integer(input.expectedVersion)||
       input.policyVersion!==1||!['ENABLE','CLEAR','DISABLE'].includes(input.action))return fail('INVALID');
    const req={...input};
    if(req.action!=='DISABLE'&&req.expectedVersion>=MAX-1)return fail('INELIGIBLE');
    const raw=await this.send('change_owner_analytics',{p_portfolio_id:req.portfolioId,p_action:req.action,
      p_expected_version:req.expectedVersion,p_operation_id:req.operationId,p_policy_version:req.policyVersion},SMALL);
    this.current();return change(raw,req);
  }
  async getOwnerAnalytics(input:ReadOwnerAnalyticsInput):Promise<OwnerAnalytics>{
    this.current();
    if(!exact(input,['portfolioIds','windowDays'])||!Array.isArray(input.portfolioIds)||
      input.portfolioIds.length<1||input.portfolioIds.length>5||
      (input.windowDays!==7&&input.windowDays!==30))return fail('INVALID');
    const ids=Array.from(input.portfolioIds),window=input.windowDays;
    if(!ids.every(uuid)||new Set(ids).size!==ids.length)return fail('INVALID');
    const raw=await this.send('read_owner_analytics',{p_portfolio_ids:ids,p_window_days:window},LARGE);
    this.current();return comparison(raw,ids,window);
  }
}
