import { ContractError, isSafeSupabaseClientKey } from './project.ts';

export type FrozenVisibilityIntent = 'PUBLIC' | 'UNLISTED';
export interface PrivateFrozenRequest {
  requestId: string;
  portfolioId: string;
  revision: number;
  snapshotSha256: string;
  visibilityIntent: FrozenVisibilityIntent;
  status: 'FROZEN';
  publicUrl: null;
  alreadyFrozen: boolean;
}

export class PrivateReleaseError extends Error {
  readonly code: 'AUTH_EXPIRED' | 'FORBIDDEN' | 'PROVIDER_UNAVAILABLE' |
    'INVALID_ACK' | 'QUOTA_EXCEEDED' | 'REVISION_UNAVAILABLE';
  constructor(code: PrivateReleaseError['code'], message: string) {
    super(message);
    this.name = 'PrivateReleaseError';
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

/** Historical database acknowledgement only. Not current delivery or rollback authority. */
export interface PrivateReleaseAcknowledgement {
  intentId:string;
  portfolioId:string;
  requestId:string;
  verifiedAt:string;
}
export interface PrivateReleaseAcknowledgementCursor {
  version:1;
  portfolioId:string;
  verifiedAt:string;
  intentId:string;
}
export interface PrivateReleaseAcknowledgementPage {
  items:PrivateReleaseAcknowledgement[];
  nextCursor:PrivateReleaseAcknowledgementCursor|null;
}
const HISTORY_BYTES=32*1024;
const HISTORY_TIMEOUT_MS=8_000;
const record=(value:unknown):value is Record<string,unknown>=>
  value!==null&&typeof value==='object'&&!Array.isArray(value);
const uuid=(value:unknown):value is string=>typeof value==='string'&&UUID.test(value);
const canonicalUuid=(value:unknown):value is string=>uuid(value)&&value===value.toLowerCase();
const exactKeys=(value:Record<string,unknown>,keys:readonly string[])=>
  Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

/** Preserve PostgreSQL microseconds instead of truncating to Date milliseconds. */
function historyInstant(value:unknown):bigint|null{
  if(typeof value!=='string'||value.length>35)return null;
  const m=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if(!m||!m[1]||!m[3])return null;
  const wall=Date.parse(m[1]+'.000Z');
  if(!Number.isFinite(wall)||new Date(wall).toISOString().slice(0,19)!==m[1]||
     m[1].startsWith('0000'))return null;
  let offset=0;
  if(m[3]!=='Z'){
    const hours=Number(m[5]),minutes=Number(m[6]);
    if(hours>23||minutes>59)return null;
    offset=(hours*60+minutes)*(m[4]==='-'?-1:1);
  }
  return BigInt(wall-offset*60_000)*1000n+BigInt((m[2]??'').padEnd(6,'0'));
}
/** PostgreSQL timestamp syntax without Date.parse calendar normalization. */
export function isPrivateReleaseTimestamp(value:unknown):value is string{
  return historyInstant(value)!==null;
}
function comesAfter(at:bigint,id:string,previousAt:bigint,previousId:string):boolean{
  return at<previousAt||(at===previousAt&&id>previousId);
}
function invalidHistory():never{
  throw new PrivateReleaseError('INVALID_ACK','Release acknowledgement history could not be verified.');
}
function cancelHistory(body:{cancel:()=>Promise<void>}|null|undefined):void{
  try{void body?.cancel().catch(()=>{});}catch{/* best effort */}
}
async function historyJson(response:Response,signal:AbortSignal,deadline:number):Promise<unknown>{
  const length=response.headers.get('content-length');
  const encoding=response.headers.get('content-encoding');
  const expired=()=>signal.aborted||performance.now()>=deadline;
  if(expired()||(length!==null&&(!/^\d+$/.test(length)||Number(length)>HISTORY_BYTES))||!response.body||
     !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))invalidHistory();
  const reader=response.body.getReader();
  const stop=()=>cancelHistory(reader);
  signal.addEventListener('abort',stop,{once:true});
  const buffer=new Uint8Array(HISTORY_BYTES);
  let size=0,empty=0,chunks=0;
  try{
    for(;;){
      if(expired())invalidHistory();
      const chunk=await reader.read();
      if(expired())invalidHistory();
      if(chunk.done)break;
      if(!(chunk.value instanceof Uint8Array)||++chunks>4096||size+chunk.value.byteLength>buffer.byteLength)invalidHistory();
      if(!chunk.value.byteLength){if(++empty>=16)invalidHistory();continue;}
      empty=0;
      buffer.set(chunk.value,size);
      size+=chunk.value.byteLength;
    }
    if(length!==null&&(!encoding||encoding.toLowerCase()==='identity')&&Number(length)!==size)invalidHistory();
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer.subarray(0,size)));}
    catch{invalidHistory();}
  }finally{
    signal.removeEventListener('abort',stop);
    stop();reader.releaseLock();
  }
}
async function fetchHistory(fetcher:typeof fetch,url:string,headers:Record<string,string>):Promise<unknown>{
  const controller=new AbortController();
  const expiresAt=performance.now()+HISTORY_TIMEOUT_MS;
  let response:Response|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{
      reject(new PrivateReleaseError('PROVIDER_UNAVAILABLE','Release acknowledgement history timed out.'));
      controller.abort();
    },HISTORY_TIMEOUT_MS);
  });
  try{
    const work=(async()=>{
      const received=await fetcher(url,{method:'GET',headers,credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
      response=received;
      if(controller.signal.aborted||performance.now()>=expiresAt){cancelHistory(received.body);invalidHistory();}
      if(received.redirected||received.headers.has('location')||(received.url&&received.url!==url))invalidHistory();
      if(received.status===401)throw new PrivateReleaseError('AUTH_EXPIRED','Session expired.');
      if(received.status===403)throw new PrivateReleaseError('FORBIDDEN','Release acknowledgement history is unavailable.');
      if(received.status!==200)throw new PrivateReleaseError('PROVIDER_UNAVAILABLE','Release acknowledgement history could not be loaded.');
      return historyJson(received,controller.signal,expiresAt);
    })();
    return await Promise.race([work,timeout]);
  }catch(error){
    if(error instanceof PrivateReleaseError)throw error;
    throw new PrivateReleaseError('PROVIDER_UNAVAILABLE','Release acknowledgement history could not be loaded.');
  }finally{
    if(timer!==undefined)clearTimeout(timer);
    controller.abort();
    if(response?.body&&!response.body.locked)cancelHistory(response.body);
  }
}

/**
 * Shared bounded owner RPC transport for private release/reviewer receipts.
 * Only parse bounded JSON, including error bodies; never expose provider text.
 * A timeout is an unknown outcome, not permission to create another operation.
 */
export async function fetchBoundedPrivateReleaseRpc(fetcher:typeof fetch,url:string,
    headers:Record<string,string>,payload:Record<string,unknown>):
    Promise<{ok:boolean;status:number;body:unknown}> {
  const controller=new AbortController();
  const expiresAt=performance.now()+HISTORY_TIMEOUT_MS;
  let response:Response|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const unavailable=()=>new Error('Private release RPC was not acknowledged.');
  const deadline=new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{reject(unavailable());controller.abort();},HISTORY_TIMEOUT_MS);
  });
  try{
    const work=(async()=>{
      const received=await fetcher(url,{method:'POST',headers,credentials:'omit',
        cache:'no-store',redirect:'error',signal:controller.signal,body:JSON.stringify(payload)});
      response=received;
      if(controller.signal.aborted||performance.now()>=expiresAt||received.redirected||received.headers.has('location')||
         (received.url&&received.url!==url)){cancelHistory(received.body);throw unavailable();}
      // PostgREST JSON RPCs return 200 for a complete receipt. Do not
      // treat a partial (206) or asynchronous (202) response as a commit.
      if(received.ok&&received.status!==200){cancelHistory(received.body);throw unavailable();}
      const body=await historyJson(received,controller.signal,expiresAt).catch(()=>null);
      if(controller.signal.aborted||performance.now()>=expiresAt)throw unavailable();
      return {ok:received.ok,status:received.status,body};
    })();
    return await Promise.race([work,deadline]);
  }finally{
    if(timer!==undefined)clearTimeout(timer);
    controller.abort();
    if(response?.body&&!response.body.locked)cancelHistory(response.body);
  }
}

export class SupabasePrivateReleaseService {
  private readonly endpoint: string;
  private readonly key: string;
  private readonly token: () => Promise<string | null>;
  private readonly fetcher: typeof fetch;

  constructor(endpoint: string, publishableKey: string,
      accessToken: () => Promise<string | null>, fetcher: typeof fetch = fetch) {
    let parsed: URL;
    try { parsed = new URL(endpoint); }
    catch { throw new ContractError('VALIDATION', 'Use a trusted Supabase API origin.'); }
    if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' &&
          ['localhost','127.0.0.1'].includes(parsed.hostname))) ||
        parsed.username || parsed.password || parsed.pathname !== '/' ||
        parsed.search || parsed.hash)
      throw new ContractError('VALIDATION', 'Use a trusted Supabase API origin.');
    if (typeof publishableKey !== 'string' || !publishableKey.trim())
      throw new ContractError('VALIDATION', 'Publishable key is missing.');
    if(!isSafeSupabaseClientKey(publishableKey))
      throw new ContractError('VALIDATION','A public Supabase API key is required.');
    this.endpoint = parsed.origin;
    this.key = publishableKey;
    this.token = accessToken;
    this.fetcher = fetcher;
  }

  async freeze(portfolioId: string, operationId: string, revision: number,
      visibilityIntent: FrozenVisibilityIntent): Promise<PrivateFrozenRequest> {
    if (!uuid(portfolioId) || !uuid(operationId) ||
        !Number.isSafeInteger(revision) || revision < 1 ||
        (visibilityIntent !== 'PUBLIC' && visibilityIntent !== 'UNLISTED'))
      throw new ContractError('VALIDATION', 'Invalid pinned release request.');
    const jwt = await this.token();
    if (!jwt) throw new PrivateReleaseError('AUTH_EXPIRED', 'Sign in to freeze your private revision.');
    let response:Awaited<ReturnType<typeof fetchBoundedPrivateReleaseRpc>>;
    try {
      response=await fetchBoundedPrivateReleaseRpc(this.fetcher,
        this.endpoint+'/rest/v1/rpc/freeze_private_release_request',
        {apikey:this.key,Authorization:'Bearer '+jwt,'Content-Type':'application/json',Accept:'application/json'},
        {p_portfolio_id:portfolioId,p_operation_id:operationId,p_revision:revision,p_visibility_intent:visibilityIntent});
    } catch {
      throw new PrivateReleaseError('PROVIDER_UNAVAILABLE', 'Freeze was not acknowledged; retry the same operation ID.');
    }
    if(await this.token()!==jwt)
      throw new PrivateReleaseError('AUTH_EXPIRED','Session changed while freezing the private revision.');
    if (!response.ok) {
      const problem=record(response.body)?response.body:null;
      if (problem?.message==='PRIVATE_REVISION_UNAVAILABLE')
        throw new PrivateReleaseError('REVISION_UNAVAILABLE','That immutable revision does not exist.');
      if (problem?.message==='PRIVATE_FREEZE_QUOTA_REACHED')
        throw new PrivateReleaseError('QUOTA_EXCEEDED','The portfolio has reached the private freeze limit.');
      if (response.status===401) throw new PrivateReleaseError('AUTH_EXPIRED','Session expired.');
      if (response.status===403) throw new PrivateReleaseError('FORBIDDEN','Portfolio is not accessible.');
      throw new PrivateReleaseError('PROVIDER_UNAVAILABLE','Freeze could not be confirmed.');
    }
    const ack=response.body;
    if (!record(ack) || !exactKeys(ack,['requestId','portfolioId','revision','snapshotSha256',
        'visibilityIntent','status','publicUrl','alreadyFrozen']) ||
        !canonicalUuid(ack.requestId) || ack.portfolioId!==portfolioId ||
        ack.revision!==revision || typeof ack.snapshotSha256!=='string' || !SHA256.test(ack.snapshotSha256) ||
        ack.visibilityIntent!==visibilityIntent || ack.status!=='FROZEN' ||
        ack.publicUrl!==null || typeof ack.alreadyFrozen!=='boolean')
      throw new PrivateReleaseError('INVALID_ACK','Freeze receipt is unverified; do not publish.');
    return {requestId:ack.requestId,portfolioId,revision,snapshotSha256:ack.snapshotSha256,
      visibilityIntent,status:'FROZEN',publicUrl:null,alreadyFrozen:ack.alreadyFrozen};
  }
  /**
   * Metadata-only read of the four existing owner-RLS granted columns.
   * Callers must first verify the current owner session and portfolio access,
   * and recheck the owner epoch before displaying the page. Empty RLS results
   * alone do not establish ownership. Never infer current live state here.
   */
  async listAcknowledgements(portfolioId:string,limit=25,
      after:PrivateReleaseAcknowledgementCursor|null=null):Promise<PrivateReleaseAcknowledgementPage>{
    if(!uuid(portfolioId)||!Number.isSafeInteger(limit)||limit<1||limit>50)
      throw new ContractError('VALIDATION','Invalid release history page.');
    const id=portfolioId.toLowerCase();
    const cursor=after===null?null:record(after)?{...after}:undefined;
    if(cursor===undefined||(cursor!==null&&(!exactKeys(cursor,['version','portfolioId','verifiedAt','intentId'])||
       cursor.version!==1||cursor.portfolioId!==id||!canonicalUuid(cursor.intentId)||historyInstant(cursor.verifiedAt)===null)))
      throw new ContractError('VALIDATION','Invalid release history cursor.');
    const jwt=await this.token();
    if(!jwt)throw new PrivateReleaseError('AUTH_EXPIRED','Sign in to review release acknowledgements.');
    const params=new URLSearchParams({select:'intent_id,portfolio_id,request_id,verified_at',
      portfolio_id:'eq.'+id,order:'verified_at.desc,intent_id.asc',limit:String(limit+1)});
    if(cursor)params.set('or','(verified_at.lt.'+cursor.verifiedAt+',and(verified_at.eq.'+
      cursor.verifiedAt+',intent_id.gt.'+cursor.intentId+'))');
    const raw=await fetchHistory(this.fetcher,this.endpoint+'/rest/v1/verified_unlisted_releases?'+params.toString(),
      {apikey:this.key,Authorization:'Bearer '+jwt,Accept:'application/json'});
    // A changed credential requires a fresh scoped read; do not disclose the old page.
    if(await this.token()!==jwt)throw new PrivateReleaseError('AUTH_EXPIRED','Session changed while reading release acknowledgements.');
    if(!Array.isArray(raw)||raw.length>limit+1)invalidHistory();
    let previous=cursor?{time:historyInstant(cursor.verifiedAt)!,id:cursor.intentId}:null;
    const seen=new Set<string>();
    const rows:PrivateReleaseAcknowledgement[]=[];
    for(const row of raw){
      if(!record(row)||!exactKeys(row,['intent_id','portfolio_id','request_id','verified_at'])||
         !canonicalUuid(row.intent_id)||row.portfolio_id!==id||!canonicalUuid(row.request_id)||
         typeof row.verified_at!=='string'||seen.has(row.intent_id))invalidHistory();
      const time=historyInstant(row.verified_at);
      if(time===null||(previous&&!comesAfter(time,row.intent_id,previous.time,previous.id)))invalidHistory();
      seen.add(row.intent_id);
      previous={time,id:row.intent_id};
      rows.push({intentId:row.intent_id,portfolioId:id,requestId:row.request_id,verifiedAt:row.verified_at});
    }
    const items=rows.slice(0,limit),last=items[items.length-1];
    return {items,nextCursor:rows.length>limit&&last?{version:1,portfolioId:id,
      verifiedAt:last.verifiedAt,intentId:last.intentId}:null};
  }

}
