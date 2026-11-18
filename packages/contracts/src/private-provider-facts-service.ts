/** Isolated owner-wire adapter. Explicit transport only, no provider or ambient fetch. */
export type ProviderErrorCode='INVALID'|'AUTH_EXPIRED'|'FORBIDDEN'|'CONFLICT'|'LIMIT'|'RATE_LIMITED'|'UNAVAILABLE'|'INVALID_RESPONSE'|'INVALID_SOURCE'|'NOT_FOUND'|'IDENTITY_CHANGED';
export class PrivateProviderFactsError extends Error {
  readonly code:ProviderErrorCode;
  constructor(code:ProviderErrorCode){super('Private provider facts: '+code);this.name='PrivateProviderFactsError';this.code=code;}
}
export type ProviderSnapshot={login:string;id:number;htmlUrl:string;publicRepos:number;publicGists:number;sourceUrl:string;fetchedAt:string;observedAt:null};
export type ProviderFactFailure='NOT_FOUND'|'RATE_LIMITED'|'PROVIDER_UNAVAILABLE'|'INVALID_SOURCE'|'IDENTITY_CHANGED';
export type ProviderState={schemaVersion:1;ownerId:string;linkId:string;provider:'GITHUB';handle:string;version:number;consent:boolean;status:'OFF'|'READY'|'PENDING'|'AWAITING_CONFIRMATION'|'SYNCED'|'UNAVAILABLE';facts:ProviderSnapshot|null;candidate:ProviderSnapshot|null;candidateExpiresAt:string|null;lastAttemptAt:string|null;cooldownUntil:string|null;lastError:ProviderFactFailure|null;freshness:'NONE'|'FRESH'|'STALE';ownershipVerified:false};
export type ProviderOperation={linkId:string;expectedVersion:number;operationId:string;policyVersion:1};
export type ProviderConsentInput=ProviderOperation&{action:'ENABLE'|'DISABLE'};
export type ProviderSyncInput=ProviderOperation&{action:'LOOKUP'|'SYNC'};
export type ProviderReceipt={status:'APPLIED'|'REPLAYED'|'PENDING'|'NO_CHANGE';state:ProviderState};
const MAX=Number.MAX_SAFE_INTEGER, LIMIT=16*1024;
const sourceErrors:readonly ProviderFactFailure[]=['NOT_FOUND','RATE_LIMITED','PROVIDER_UNAVAILABLE','INVALID_SOURCE','IDENTITY_CHANGED'];
const fail=(code:ProviderErrorCode):never=>{throw new PrivateProviderFactsError(code)};
const obj=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>obj(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const handle=(v:unknown):v is string=>typeof v==='string'&&v.length>=2&&v.length<=39&&/^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/.test(v);
function instant(v:unknown):bigint|null{
  if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(v))return null;
  const date=v.slice(0,10),d=Date.parse(date);
  const fraction=/\.(\d{1,6})(?=Z|[+-])/.exec(v)?.[1]??'';
  const t=Date.parse(v.replace(/\.\d{1,6}(?=Z|[+-])/,'').replace(/\s/g,''));
  return Number.isFinite(d)&&new Date(d).toISOString().slice(0,10)===date&&Number.isFinite(t)?BigInt(t)*1000n+BigInt(fraction.padEnd(6,'0')||'0'):null;
}
/** Reject duplicate decoded object keys and excess nesting before JSON.parse. */
function parse(text:string):unknown{
  let i=0;
  const ws=()=>{while(i<text.length&&/\s/.test(text.charAt(i)))i++};
  function string():string {const start=i++;while(i<text.length){const c=text[i++];if(c==='\\'){i++;continue}if(c==='"')return JSON.parse(text.slice(start,i));}return fail('INVALID_RESPONSE')}
  function value(depth:number):void {if(depth>24)fail('INVALID_RESPONSE');ws();const c=text[i];
    if(c==='"'){string();return}
    if(c==='{'||c==='['){i++;ws();const end=c==='{'?'}':']',seen=new Set<string>();if(text[i]===end){i++;return}
      for(;;){ws();if(c==='{'){if(text[i]!=='"')fail('INVALID_RESPONSE');const k=string();if(seen.has(k))fail('INVALID_RESPONSE');seen.add(k);ws();if(text[i++]!==':')fail('INVALID_RESPONSE')}value(depth+1);ws();const sep=text[i++];if(sep===end)return;if(sep!==',')fail('INVALID_RESPONSE')}
    }
    const start=i;while(i<text.length&&!/[\s,}\]]/.test(text.charAt(i)))i++;if(start===i)fail('INVALID_RESPONSE');const lexeme=text.slice(start,i);
    if(!['true','false','null'].includes(lexeme)&&(!/^(?:0|[1-9]\d*)$/.test(lexeme)||!Number.isSafeInteger(Number(lexeme))))fail('INVALID_RESPONSE');
  }
  try{value(0);ws();if(i!==text.length)fail('INVALID_RESPONSE');return JSON.parse(text)}catch{return fail('INVALID_RESPONSE')}
}
function snapshot(v:unknown,saved:string):v is ProviderSnapshot{
  return exact(v,['login','id','htmlUrl','publicRepos','publicGists','sourceUrl','fetchedAt','observedAt'])&&handle(v.login)&&v.login.toLowerCase()===saved.toLowerCase()&&integer(v.id)&&v.id>0&&integer(v.publicRepos)&&integer(v.publicGists)&&v.htmlUrl==='https://github.com/'+v.login&&v.sourceUrl==='https://api.github.com/users/'+encodeURIComponent(saved)&&instant(v.fetchedAt)!==null&&v.observedAt===null;
}
export function parseProviderState(raw:unknown,owner:string,link:string):ProviderState{
  if(!exact(raw,['schemaVersion','ownerId','linkId','provider','handle','version','consent','status','facts','candidate','candidateExpiresAt','lastAttemptAt','cooldownUntil','lastError','freshness','ownershipVerified'])||raw.schemaVersion!==1||raw.ownerId!==owner||raw.linkId!==link||raw.provider!=='GITHUB'||!handle(raw.handle)||!integer(raw.version)||typeof raw.consent!=='boolean'||raw.ownershipVerified!==false)return fail('INVALID_RESPONSE');
  if(!['OFF','READY','PENDING','AWAITING_CONFIRMATION','SYNCED','UNAVAILABLE'].includes(String(raw.status))||!['NONE','FRESH','STALE'].includes(String(raw.freshness))||typeof raw.status!=='string'||typeof raw.freshness!=='string')return fail('INVALID_RESPONSE');
  for(const k of ['candidateExpiresAt','lastAttemptAt','cooldownUntil'])if(raw[k]!==null&&instant(raw[k])===null)return fail('INVALID_RESPONSE');
  if(raw.lastError!==null&&!sourceErrors.includes(raw.lastError as ProviderFactFailure))return fail('INVALID_RESPONSE');
  if(raw.facts!==null&&!snapshot(raw.facts,raw.handle)||raw.candidate!==null&&!snapshot(raw.candidate,raw.handle))return fail('INVALID_RESPONSE');
  const state=raw as unknown as ProviderState;
  if(state.candidate!==null){if(state.status!=='AWAITING_CONFIRMATION'||state.facts!==null||state.candidateExpiresAt===null||instant(state.candidateExpiresAt)!<=instant(state.candidate.fetchedAt)!||instant(state.candidateExpiresAt)!-instant(state.candidate.fetchedAt)!>600000000n)return fail('INVALID_RESPONSE')}
  else if(state.candidateExpiresAt!==null)return fail('INVALID_RESPONSE');
  if(state.facts===null?state.freshness!=='NONE':state.freshness==='NONE')return fail('INVALID_RESPONSE');
  // A failed refresh can retain last-good facts, never describe them as fresh.
  // Server cooldown survives OFF/relink; a source failure belongs only to UNAVAILABLE.
  if((state.status==='UNAVAILABLE')!==(state.lastError!==null)||
    state.status==='UNAVAILABLE'&&state.facts!==null&&state.freshness!=='STALE')return fail('INVALID_RESPONSE');
  if(!state.consent){if(state.status!=='OFF'||state.facts!==null||state.candidate!==null)return fail('INVALID_RESPONSE')}
  else if(state.version===0||state.version===MAX||state.status==='OFF')return fail('INVALID_RESPONSE');
  if(state.status==='READY'&&(state.facts!==null||state.candidate!==null)||state.status==='SYNCED'&&(state.facts===null||state.candidate!==null)||state.status==='AWAITING_CONFIRMATION'&&state.candidate===null)return fail('INVALID_RESPONSE');
  return state;
}
function validateOperation(input:unknown,action?:readonly string[]):ProviderOperation{
  if(!exact(input,['linkId','expectedVersion','operationId','policyVersion',...(action?['action']:[])])||!uuid(input.linkId)||!uuid(input.operationId)||!integer(input.expectedVersion)||input.policyVersion!==1||action&&(typeof input.action!=='string'||!action.includes(input.action)))return fail('INVALID');
  return input as unknown as ProviderOperation;
}
/** Local Supabase CLI commonly exposes a legacy anon JWT. Accept only a
 * structurally bounded anon key (never an owner/service JWT or opaque secret).
 * Signature/authentication remain the local Supabase gateway's responsibility. */
function localClientKey(key:unknown):key is string{
  if(typeof key!=='string'||key.length>4096)return false;
  if(/^sb_publishable_[A-Za-z0-9_-]{8,200}$/.test(key))return true;
  if(!/^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key))return false;
  const payload=key.split('.')[1];if(!payload)return false;
  try{const decoded:unknown=JSON.parse(atob(payload.replace(/-/g,'+').replace(/_/g,'/')));
    return obj(decoded)&&decoded.role==='anon';
  }catch{return false;}
}
export class SupabasePrivateProviderFactsService {
  private readonly origin:string;private readonly owner:string;private readonly key:string;private readonly token:()=>Promise<string|null>;private readonly guard:()=>boolean;private readonly http:typeof fetch;private retired=false;
  constructor(endpoint:string,key:string,ownerId:string,token:()=>Promise<string|null>,isCurrentOwner:()=>boolean,http?:typeof fetch){
    if(!http||http===globalThis.fetch)throw new PrivateProviderFactsError('UNAVAILABLE');
    let url:URL;try{url=new URL(endpoint)}catch{throw new PrivateProviderFactsError('INVALID')}
    // Isolated fixture only: cannot construct a hosted/live adapter.
    if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!['https:','http:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!uuid(ownerId)||!localClientKey(key)||typeof token!=='function'||typeof isCurrentOwner!=='function')throw new PrivateProviderFactsError('INVALID');
    this.origin=url.origin;this.owner=ownerId;this.key=key;this.token=token;this.guard=isCurrentOwner;this.http=http;
  }
  private current(){let ok=false;try{ok=this.guard()===true}catch{}if(this.retired||!ok){this.retired=true;fail('AUTH_EXPIRED')}}
  private async request(path:string,body:Record<string,unknown>):Promise<unknown>{
    this.current();const serialized=JSON.stringify(body);if(new TextEncoder().encode(serialized).length>1024)fail('LIMIT');
    const url=this.origin+path,timeout=path==='/functions/v1/sync-provider-facts'?15000:5000;
    const deadline=performance.now()+timeout,controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    const cancelBody=(r:Response)=>{try{void r.body?.cancel().catch(()=>{})}catch{}};
    const cancelReader=()=>{const held=reader;reader=undefined;if(held){try{void held.cancel().catch(()=>{})}catch{}try{held.releaseLock()}catch{}}};
    const check=()=>{this.current();if(controller.signal.aborted||performance.now()>=deadline)fail('UNAVAILABLE')};
    const timed=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new PrivateProviderFactsError('UNAVAILABLE'))},timeout)});
    const work=async()=>{
      let jwt:string|null;try{jwt=await this.token()}catch{return fail('UNAVAILABLE')}
      check();if(typeof jwt!=='string'||!jwt||jwt.length>8192||/\s/.test(jwt))return fail('AUTH_EXPIRED');
      let r:Response;try{r=await this.http(url,{method:'POST',headers:{apikey:this.key,Authorization:'Bearer '+jwt,'Content-Type':'application/json',Accept:'application/json'},body:serialized,cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal})}catch{return fail('UNAVAILABLE')}
      if(!(r instanceof Response))return fail('INVALID_RESPONSE');
      try{check()}catch(e){cancelBody(r);throw e}
      // Constructed fixture Responses have no URL (type default). Real responses must match the exact request.
      if(r.redirected||(r.url!==url&&!(r.url===''&&r.type==='default'))){cancelBody(r);return fail('INVALID_RESPONSE')}
      // PostgREST maps SQLSTATE 40001 to HTTP 500. Only the exact bounded
      // owner-RPC conflict envelope is actionable; never retry a write.
      const conflictProbe=!r.ok&&r.status===500&&path.startsWith('/rest/v1/rpc/');
      if(!r.ok&&!conflictProbe){cancelBody(r);if(r.status===401)this.retired=true;return fail(({401:'AUTH_EXPIRED',403:'FORBIDDEN',409:'CONFLICT',413:'LIMIT',429:'RATE_LIMITED'} as Record<number,ProviderErrorCode>)[r.status]??'UNAVAILABLE')}
      const malformed=()=>fail(conflictProbe?'UNAVAILABLE':'INVALID_RESPONSE');
      const len=r.headers.get('content-length'),encoding=r.headers.get('content-encoding');
      if(!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(r.headers.get('content-type')??'')||len!==null&&(!/^(?:0|[1-9]\d*)$/.test(len)||Number(len)>LIMIT)||!r.body){cancelBody(r);return malformed()}
      const identity=encoding===null||encoding.trim().toLowerCase()==='identity';
      const bytes=new Uint8Array(LIMIT);let size=0;
      let held:ReadableStreamDefaultReader<Uint8Array>;try{held=r.body.getReader()}catch{cancelBody(r);return malformed()}
      reader=held;
      try{for(;;){check();let part:ReadableStreamReadResult<Uint8Array>;try{part=await held.read()}catch{return fail('UNAVAILABLE')}check();if(part.done)break;
        // Each successful iteration consumes at least one byte; fixed buffer bounds allocations and iteration count.
        if(!(part.value instanceof Uint8Array)||part.value.length===0||part.value.length>LIMIT-size)return malformed();
        bytes.set(part.value,size);size+=part.value.length;
      }
        if(identity&&len!==null&&size!==Number(len))return malformed();
        let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size))}catch{return malformed()}
        check();let raw:unknown;try{raw=parse(text)}catch{return malformed()}
        if(conflictProbe)return fail(exact(raw,['code','message','details','hint'])&&raw.code==='40001'&&raw.message==='CONFLICT'?'CONFLICT':'UNAVAILABLE');
        return raw;
      }finally{cancelReader()}
    };
    try{const result=await Promise.race([work(),timed]);check();return result}finally{clearTimeout(timer);controller.abort();cancelReader()}
  }
  async readState(linkId:string):Promise<ProviderState>{if(!uuid(linkId))return fail('INVALID');return parseProviderState(await this.request('/rest/v1/rpc/read_owner_github_provider_state',{p_link_id:linkId}),this.owner,linkId)}
  private receipt(raw:unknown,input:ProviderOperation,action:'ENABLE'|'DISABLE'|'CONFIRM'|'LOOKUP'|'SYNC'):ProviderReceipt{
    if(!exact(raw,['status','state'])||typeof raw.status!=='string'||!['APPLIED','REPLAYED','PENDING','NO_CHANGE'].includes(raw.status))return fail('INVALID_RESPONSE');
    const s=parseProviderState(raw.state,this.owner,input.linkId);const status=raw.status as ProviderReceipt['status'];const sync=action==='LOOKUP'||action==='SYNC';
    if(status==='NO_CHANGE'){if(action!=='DISABLE'||s.consent||s.version!==input.expectedVersion)return fail('INVALID_RESPONSE')}
    else if(sync){if(!s.consent||s.version!==(input.expectedVersion+(s.status==='PENDING'?1:2))||status==='PENDING'&&s.status!=='PENDING'||status==='APPLIED'&&s.status==='PENDING'||action==='LOOKUP'&&(s.facts!==null||status==='APPLIED'&&s.status!=='AWAITING_CONFIRMATION'&&s.status!=='UNAVAILABLE')||action==='SYNC'&&(s.facts===null||s.candidate!==null))return fail('INVALID_RESPONSE')}
    else if(status==='PENDING'||s.version!==input.expectedVersion+1||s.consent!==(action!=='DISABLE')||action==='CONFIRM'&&(s.status!=='SYNCED'||s.facts===null)||action==='ENABLE'&&s.status!=='READY')return fail('INVALID_RESPONSE');
    return {status,state:s};
  }
  private args(input:ProviderOperation){return {p_link_id:input.linkId,p_expected_version:input.expectedVersion,p_operation_id:input.operationId,p_policy_version:1}}
  async changeConsent(input:ProviderConsentInput):Promise<ProviderReceipt>{validateOperation(input,['ENABLE','DISABLE']);const frozen={...input};if(frozen.action==='ENABLE'&&frozen.expectedVersion>=MAX-1)return fail('INVALID');return this.receipt(await this.request('/rest/v1/rpc/change_owner_github_provider_consent',{...this.args(frozen),p_action:frozen.action}),frozen,frozen.action)}
  async confirmCandidate(input:ProviderOperation):Promise<ProviderReceipt>{validateOperation(input);const frozen={...input};if(frozen.expectedVersion>=MAX-1)return fail('INVALID');return this.receipt(await this.request('/rest/v1/rpc/confirm_owner_github_provider_candidate',this.args(frozen)),frozen,'CONFIRM')}
  async sync(input:ProviderSyncInput):Promise<ProviderReceipt>{validateOperation(input,['LOOKUP','SYNC']);const frozen={...input};if(frozen.expectedVersion>MAX-3)return fail('INVALID');return this.receipt(await this.request('/functions/v1/sync-provider-facts',frozen),frozen,frozen.action)}
}

/** UI affordances only. The database remains authoritative for consent, version,
 * candidate expiry, quota and cooldown. No request or timer is started here. */
export type ProviderUserAction='ENABLE'|'DISABLE'|'CONFIRM'|'LOOKUP'|'SYNC';
export function availableProviderActions(state:ProviderState,now:number):readonly ProviderUserAction[]{
  if(!Number.isFinite(now))return [];
  if(!state.consent)return state.version<MAX-1?['ENABLE']:[];
  const actions:ProviderUserAction[]=['DISABLE'];
  if(state.status==='PENDING'||state.version>=MAX-1)return actions;
  if(state.status==='AWAITING_CONFIRMATION'&&state.candidateExpiresAt!==null&&Date.parse(state.candidateExpiresAt)>now){actions.push('CONFIRM');return actions;}
  if(state.version>MAX-3||state.cooldownUntil!==null&&Date.parse(state.cooldownUntil)>now)return actions;
  actions.push(state.facts===null?'LOOKUP':'SYNC');return actions;
}
