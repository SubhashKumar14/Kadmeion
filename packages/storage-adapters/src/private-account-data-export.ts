import { isSafeSupabaseClientKey } from '../../contracts/src/project.ts';
/**
 * B5 bounded owner data export. V2 may request a trusted, write-once
 * registered private asset hash before reading bytes; no public or deletion writes. This is deliberately NOT a complete
 * account export, atomic snapshot, erasure manifest, or public release.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Only owner-readable tables with SELECT privileges on their ownership column.
// Reviewer grants, moderation events, erasure requests and inventory snapshots
// have deliberately restricted column grants; never use SELECT * on them here.
const TABLES=[
  ['profiles','user_id'],['profile_sharing_preferences','user_id'],
  ['private_onboarding_steps','user_id'],['projects','owner_user_id'],
  ['project_exposure_intents','owner_user_id'],['portfolios','owner_user_id'],
  ['portfolio_revisions','owner_user_id'],['project_assets','owner_user_id'],
  ['private_release_requests','owner_user_id'],['private_trash_items','owner_user_id'],
  ['private_platform_links','owner_user_id'],['private_goals','owner_user_id'],
  ['private_goal_progress_events','owner_user_id'],['private_goal_milestones','owner_user_id'],
  ['private_notifications','owner_user_id','id,owner_user_id,event_type,category,priority,target_id,created_at,read_at,dismissed_at'],
  ['private_notification_preferences','owner_user_id'],
  ['private_my_component_versions','owner_user_id']
] as const;
const MAX_ROWS=100,MAX_TABLE_BYTES=6*1024*1024,MAX_ASSETS=8;
const MAX_ASSET_BYTES=5*1024*1024,MAX_TOTAL_ASSET_BYTES=8*1024*1024;
const MAX_EXPORT_BYTES=16*1024*1024;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
type JsonObject=Record<string,unknown>;
const object=(v:unknown):v is JsonObject=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const isUuid=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v);
// Audit projections are privileged server responses, not general user-authored
// content. Reject secrets even when a provider accidentally nests them in a
// JSON payload. Never scan project/source files: author data must be preserved.
const PRIVATE_AUDIT_FIELD=/^(?:token_sha256|rawToken|access_token|refresh_token|initial_session_id|verified_session_id|session_id|authorization|cookie|password|client_secret|recovery_token)$/i;
function safeRestrictedAudit(value:unknown):boolean {
  const pending=[value];let visited=0;
  while(pending.length){
    if(++visited>10000)return false;
    const node=pending.pop();
    if(Array.isArray(node)){
      if(node.length>MAX_ROWS)return false;
      pending.push(...node);
    }else if(object(node)){
      const entries=Object.entries(node);
      if(entries.length>200)return false;
      for(const [key,child] of entries){
        if(PRIVATE_AUDIT_FIELD.test(key))return false;
        if(object(child)||Array.isArray(child))pending.push(child);
      }
    }
  }
  return true;
}
export class PrivateAccountExportError extends Error {
  readonly code:'VALIDATION'|'AUTH_EXPIRED'|'PROVIDER_UNAVAILABLE'|
    'INTEGRITY'|'LIMIT_EXCEEDED'|'RATE_LIMITED'|'UNVERIFIED'|'VERSION_REQUIRED';
  constructor(code:PrivateAccountExportError['code'],message:string){
    super(message);this.name='PrivateAccountExportError';this.code=code;
  }
}
export interface PrivateAccountExportArtifact {
  filename:string;
  mime:'application/json';
  bytes:Uint8Array;
  status:'BOUNDED_PARTIAL_EXPORT';
  completeAccountExport:false;
  deletionAllowed:false;
}
function requireCondition(condition:unknown,code:PrivateAccountExportError['code'],message:string):
  asserts condition {
  if(!condition)throw new PrivateAccountExportError(code,message);
}
// Each serialized table/audit and encoded asset is a disjoint part of the
// final JSON envelope. Refuse a proven overflow before retaining more data.
function enforceExportBudget(used:number,additional:number,maximum=MAX_EXPORT_BYTES):number {
  const next=used+additional;
  requireCondition(Number.isSafeInteger(next)&&next<=maximum,'LIMIT_EXCEEDED',
    'Export document exceeds maximum size.');
  return next;
}
function hex(bytes:Uint8Array):string {
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
async function sha256(bytes:Uint8Array):Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))));
}
/**
 * Owner-saved TSX is untrusted source even in a portable account download.
 * Verify every server-computed digest independently; an edited JSON backup
 * must never pass as a locally consistent source archive.
 */
async function verifyOwnerComponentRows(value:unknown,ownerId:string):Promise<void>{
  requireCondition(Array.isArray(value)&&value.length<=40,'INTEGRITY',
    'Private components quota or data structure is invalid.');
  const seen=new Set<string>();
  for(const item of value){
    requireCondition(object(item)&&Object.keys(item).sort().join(',')===
      'base_component_pin,compatible_slot_kinds,component_key,created_at,display_name,id,owner_user_id,pristine_source,source_code,source_sha256,version'&&
      isUuid(item.id)&&item.owner_user_id===ownerId&&
      typeof item.component_key==='string'&&
      /^[a-z][a-z0-9-]{2,63}$/.test(item.component_key)&&
      typeof item.version==='number'&&Number.isInteger(item.version)&&item.version>=1&&item.version<=40&&
      typeof item.display_name==='string'&&item.display_name.trim().length>0&&
      item.display_name.length<=80&&
      typeof item.base_component_pin==='string'&&
      /^[a-z][a-z0-9-]*@[0-9]+(?:\.[0-9]+){0,2}$/.test(item.base_component_pin)&&
      typeof item.pristine_source==='string'&&
      encoder.encode(item.pristine_source).byteLength>=1&&
      encoder.encode(item.pristine_source).byteLength<=32768&&
      typeof item.source_code==='string'&&
      encoder.encode(item.source_code).byteLength>=1&&
      encoder.encode(item.source_code).byteLength<=32768&&
      typeof item.source_sha256==='string'&&
      /^[a-f0-9]{64}$/.test(item.source_sha256)&&
      Array.isArray(item.compatible_slot_kinds)&&
      item.compatible_slot_kinds.length>=1&&
      item.compatible_slot_kinds.length<=20&&
      item.compatible_slot_kinds.every((s:unknown)=>typeof s==='string'&&
        /^[a-z][a-z0-9]*$/.test(s))&&
      typeof item.created_at==='string'&&
      !Number.isNaN(Date.parse(item.created_at))&&
      !seen.has(item.id),
    'INTEGRITY','Invalid, duplicate or foreign owned component version.');
    seen.add(item.id as string);
    requireCondition(await sha256(encoder.encode(item.source_code as string))===
      item.source_sha256,'INTEGRITY','Saved component source digest differs from its bytes.');
  }
}

const V2_TABLES=[...TABLES,['profile_assets','owner_user_id']] as const;
const exactFields=(row:JsonObject,fields:readonly string[])=>
  Object.keys(row).length===fields.length&&fields.every(field=>Object.hasOwn(row,field));
const validDate=(value:unknown):value is string=>
  typeof value==='string'&&value.length<=64&&Number.isFinite(Date.parse(value));
function verifyV2ProfileAssets(records:JsonObject,ownerId:string):void {
  const assets=records.profile_assets,profiles=records.profiles;
  requireCondition(Array.isArray(assets)&&assets.length<=20&&Array.isArray(profiles)&&profiles.length<=1,
    'INTEGRITY','Invalid private profile asset inventory.');
  const ids=new Set<string>(),paths=new Set<string>(),operations=new Set<string>(),objects=new Set<string>();
  const registered=new Set<string>();
  for(const item of assets){
    requireCondition(object(item)&&exactFields(item,['id','owner_user_id','operation_id','object_path','mime_type',
      'byte_size','alt_text','state','storage_object_id','storage_version','created_at','registered_at'])&&
      isUuid(item.id)&&item.owner_user_id===ownerId&&isUuid(item.operation_id)&&
      item.object_path===ownerId+'/profile/'+item.operation_id+'.img'&&
      typeof item.mime_type==='string'&&['image/png','image/jpeg','image/webp'].includes(item.mime_type)&&
      typeof item.byte_size==='number'&&Number.isSafeInteger(item.byte_size)&&item.byte_size>=12&&item.byte_size<=MAX_ASSET_BYTES&&
      typeof item.alt_text==='string'&&item.alt_text===item.alt_text.trim()&&
      Array.from(item.alt_text).length>=1&&Array.from(item.alt_text).length<=500&&validDate(item.created_at)&&
      !ids.has(item.id)&&!paths.has(item.object_path as string)&&!operations.has(item.operation_id),
      'INTEGRITY','Invalid, duplicate or foreign private profile asset metadata.');
    ids.add(item.id);paths.add(item.object_path as string);operations.add(item.operation_id);
    if(item.state==='PENDING_UPLOAD'){
      requireCondition(item.storage_object_id===null&&item.storage_version===null&&item.registered_at===null,
        'INTEGRITY','Pending profile upload has unexpected registration evidence.');
    }else{
      requireCondition(item.state==='REGISTERED'&&isUuid(item.storage_object_id)&&
        typeof item.storage_version==='string'&&item.storage_version.length>=1&&item.storage_version.length<=128&&
        validDate(item.registered_at)&&!objects.has(item.storage_object_id),
        'INTEGRITY','Invalid registered profile asset identity.');
      objects.add(item.storage_object_id);registered.add(item.id);
    }
  }
  for(const profile of profiles)
    requireCondition(object(profile)&&profile.user_id===ownerId&&
      !Object.hasOwn(profile,'avatar_last_operation_id')&&!Object.hasOwn(profile,'avatar_last_base_revision')&&
      typeof profile.avatar_revision==='number'&&Number.isSafeInteger(profile.avatar_revision)&&profile.avatar_revision>=0&&
      (profile.avatar_asset_id===null||(isUuid(profile.avatar_asset_id)&&registered.has(profile.avatar_asset_id))),
      'INTEGRITY','Private avatar selection does not match registered owner metadata.');
}
async function verifyMetadataV2(envelope:unknown,ownerId:string,snapshotId:string,requestId:string|null):Promise<JsonObject>{
  requireCondition(object(envelope)&&exactFields(envelope,['status','schemaVersion','requestId','snapshotId',
    'ownerUserId','capturedAt','records','restrictedAudit','verifiedReleaseHistory','storageBytesIncluded',
    'providerDataIncluded','deletionAllowed'])&&envelope.status==='APPLICATION_METADATA_SNAPSHOT'&&
    envelope.schemaVersion===2&&envelope.snapshotId===snapshotId&&envelope.requestId===requestId&&
    envelope.ownerUserId===ownerId&&validDate(envelope.capturedAt)&&envelope.storageBytesIncluded===false&&
    envelope.providerDataIncluded===false&&envelope.deletionAllowed===false&&object(envelope.records)&&
    exactFields(envelope.records,V2_TABLES.map(([table])=>table))&&object(envelope.restrictedAudit)&&
    Array.isArray(envelope.verifiedReleaseHistory)&&envelope.verifiedReleaseHistory.length<=MAX_ROWS,
    'INTEGRITY','Invalid request-bound version 2 metadata export receipt.');
  for(const [table,column] of V2_TABLES){
    const rows=envelope.records[table];
    requireCondition(Array.isArray(rows)&&rows.length<=MAX_ROWS&&rows.every(row=>object(row)&&row[column]===ownerId),
      'INTEGRITY','Version 2 metadata has an invalid or foreign record.');
    requireCondition(encoder.encode(JSON.stringify(rows)).byteLength<=MAX_TABLE_BYTES,
      'LIMIT_EXCEEDED','A metadata category exceeds the supported byte limit.');
    if(table==='private_my_component_versions')await verifyOwnerComponentRows(rows,ownerId);
  }
  verifyV2ProfileAssets(envelope.records,ownerId);
  for(const row of envelope.verifiedReleaseHistory)
    requireCondition(object(row)&&isUuid(row.intent_id)&&isUuid(row.portfolio_id)&&isUuid(row.request_id)&&
      typeof row.html_sha256==='string'&&/^[a-f0-9]{64}$/.test(row.html_sha256)&&safeRestrictedAudit(row),
      'INTEGRITY','Invalid verified release history.');
  const auditKeys=['reviewerGrants','moderationCases','moderationEvents','accountExitRequests','reauthChallenges',
    'inventorySnapshots','releasePointers','releaseEvents'];
  requireCondition(exactFields(envelope.restrictedAudit,auditKeys),'INTEGRITY','Incomplete restricted audit projection.');
  for(const rows of Object.values(envelope.restrictedAudit))
    requireCondition(Array.isArray(rows)&&rows.length<=MAX_ROWS&&rows.every(row=>object(row)&&safeRestrictedAudit(row)),
      'INTEGRITY','Version 2 audit has an invalid or forbidden record.');
  return envelope;
}
type V2RegistryAsset={scope:'PROJECT'|'PROFILE';assetId:string;projectId:string|null;
  path:string;mimeType:string;byteSize:number;objectId:string|null;version:string|null};
type V2HashPin={scope:'PROJECT'|'PROFILE';assetId:string;projectId:string|null;
  path:string;objectId:string;version:string;mimeType:string;byteSize:number;expectedSha256:string};
function v2Registry(records:JsonObject,ownerId:string):Map<string,V2RegistryAsset>{
  requireCondition(Array.isArray(records.project_assets)&&Array.isArray(records.profile_assets)&&
    records.project_assets.length+records.profile_assets.length<=MAX_ASSETS,
    'LIMIT_EXCEEDED','Too many private assets for bounded recovery.');
  const result=new Map<string,V2RegistryAsset>(),ids=new Set<string>();
  const add=(asset:V2RegistryAsset)=>{
    requireCondition(!result.has(asset.path)&&!ids.has(asset.assetId),
      'INTEGRITY','Duplicate private asset across the registered scopes.');
    result.set(asset.path,asset);ids.add(asset.assetId);
  };
  const suffix:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};
  for(const row of records.project_assets){
    requireCondition(object(row)&&row.owner_user_id===ownerId&&isUuid(row.id)&&isUuid(row.project_id)&&
      typeof row.object_path==='string'&&typeof row.mime_type==='string'&&Object.hasOwn(suffix,row.mime_type)&&
      typeof row.byte_size==='number'&&Number.isSafeInteger(row.byte_size)&&row.byte_size>=12&&row.byte_size<=MAX_ASSET_BYTES,
      'INTEGRITY','Invalid project asset metadata for version 2 recovery.');
    const parts=row.object_path.split('/');
    const filename=parts[2]??'',dot=filename.lastIndexOf('.');
    requireCondition(parts.length===3&&parts[0]===ownerId&&parts[1]===row.project_id&&dot>0&&
      isUuid(filename.slice(0,dot))&&['img',suffix[row.mime_type]].includes(filename.slice(dot+1)),
      'INTEGRITY','Project asset is outside its canonical private path.');
    add({scope:'PROJECT',assetId:row.id,projectId:row.project_id,path:row.object_path,
      mimeType:row.mime_type,byteSize:row.byte_size,objectId:null,version:null});
  }
  verifyV2ProfileAssets(records,ownerId);
  for(const row of records.profile_assets){
    requireCondition(object(row)&&row.state==='REGISTERED'&&isUuid(row.id)&&
      typeof row.object_path==='string'&&typeof row.mime_type==='string'&&typeof row.byte_size==='number'&&
      isUuid(row.storage_object_id)&&typeof row.storage_version==='string',
      'UNVERIFIED','Pending profile uploads prevent verified byte recovery.');
    add({scope:'PROFILE',assetId:row.id,projectId:null,path:row.object_path,mimeType:row.mime_type,
      byteSize:row.byte_size,objectId:row.storage_object_id,version:row.storage_version});
  }
  return result;
}
function sameV2Asset(entry:JsonObject,asset:V2RegistryAsset):boolean{
  return entry.scope===asset.scope&&entry.assetId===asset.assetId&&entry.projectId===asset.projectId&&
    entry.path===asset.path&&entry.mimeType===asset.mimeType&&entry.byteSize===asset.byteSize;
}
function parseV2Pins(raw:unknown,ownerId:string,snapshotId:string,requestId:string|null,
  registry:Map<string,V2RegistryAsset>):Map<string,V2HashPin>{
  requireCondition(object(raw)&&exactFields(raw,['snapshotId','schemaVersion','requestId','ownerUserId','status',
    'registeredAssets','attestedAssets','attestations','providerSigned','deletionAllowed'])&&
    raw.schemaVersion===2&&raw.snapshotId===snapshotId&&raw.requestId===requestId&&raw.ownerUserId===ownerId&&
    raw.status==='SERVER_HASH_PINNED'&&raw.providerSigned===false&&raw.deletionAllowed===false&&
    raw.registeredAssets===registry.size&&raw.attestedAssets===registry.size&&
    Array.isArray(raw.attestations)&&raw.attestations.length===registry.size,
    'UNVERIFIED','Request-bound trusted hash pin coverage is incomplete.');
  const pins=new Map<string,V2HashPin>(),objects=new Set<string>();
  for(const pin of raw.attestations){
    requireCondition(object(pin)&&exactFields(pin,['scope','assetId','projectId','path','objectId','version',
      'mimeType','byteSize','expectedSha256'])&&typeof pin.path==='string'&&isUuid(pin.objectId)&&
      typeof pin.version==='string'&&pin.version.length>=1&&pin.version.length<=128&&
      typeof pin.expectedSha256==='string'&&/^[a-f0-9]{64}$/.test(pin.expectedSha256)&&
      !pins.has(pin.path)&&!objects.has(pin.objectId),
      'INTEGRITY','Malformed or duplicate scoped trusted asset pin.');
    const asset=registry.get(pin.path);
    requireCondition(asset!==undefined&&sameV2Asset(pin,asset)&&
      (asset.scope!=='PROFILE'||(pin.objectId===asset.objectId&&pin.version===asset.version)),
      'INTEGRITY','Scoped trusted hash pin does not match owner registry metadata.');
    pins.set(pin.path,pin as unknown as V2HashPin);objects.add(pin.objectId);
  }
  return pins;
}
// The aggregate RPC withholds the entire pin set when coverage is incomplete.
// Only this exact owner/snapshot receipt permits a bounded attestation attempt.
function missingV2PinCoverage(raw:unknown,ownerId:string,snapshotId:string,requestId:string|null,count:number):boolean {
  return object(raw)&&exactFields(raw,['snapshotId','schemaVersion','requestId','ownerUserId','status',
    'registeredAssets','attestedAssets','attestations','providerSigned','deletionAllowed'])&&
    raw.schemaVersion===2&&raw.snapshotId===snapshotId&&raw.requestId===requestId&&raw.ownerUserId===ownerId&&
    raw.status==='UNVERIFIED'&&raw.providerSigned===false&&raw.deletionAllowed===false&&count>0&&
    raw.registeredAssets===count&&raw.attestedAssets===0&&Array.isArray(raw.attestations)&&raw.attestations.length===0;
}
type OwnerV2PinReadback={objectId:string;version:string;status:'UNPINNED'|'SERVER_HASH_PINNED';expectedSha256:string|null};
function verifyOwnerV2Pin(raw:unknown,ownerId:string,asset:V2RegistryAsset):OwnerV2PinReadback {
  requireCondition(object(raw)&&exactFields(raw,['scope','assetId','ownerUserId','projectId','objectId','version',
    'mimeType','byteSize','status','expectedSha256','publicDeliveryAllowed'])&&
    raw.ownerUserId===ownerId&&raw.scope===asset.scope&&raw.assetId===asset.assetId&&raw.projectId===asset.projectId&&
    raw.mimeType===asset.mimeType&&raw.byteSize===asset.byteSize&&raw.publicDeliveryAllowed===false&&
    isUuid(raw.objectId)&&typeof raw.version==='string'&&raw.version.length>=1&&raw.version.length<=128&&
    (asset.scope!=='PROFILE'||(raw.objectId===asset.objectId&&raw.version===asset.version))&&
    ((raw.status==='UNPINNED'&&raw.expectedSha256===null)||
      (raw.status==='SERVER_HASH_PINNED'&&typeof raw.expectedSha256==='string'&&/^[0-9a-f]{64}$/.test(raw.expectedSha256))),
    'INTEGRITY','Private media pin is not bound to the current owner registry and object.');
  return {objectId:raw.objectId as string,version:raw.version as string,
    status:raw.status as OwnerV2PinReadback['status'],expectedSha256:raw.expectedSha256 as string|null};
}

function base64(bytes:Uint8Array):string {
  let binary='';
  for(let i=0;i<bytes.length;i+=8192)
    binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
}
// An injected transport can return a stream which ignores fetch abort. Bound
// the body read as well as the request; never await tee cancellation.
function checkStreamDeadline(signal:AbortSignal,deadline:number):void {
  signal.throwIfAborted();
  if(performance.now()>=deadline)throw new DOMException('Response deadline exceeded','TimeoutError');
}
async function readExportChunk(reader:ReadableStreamDefaultReader<Uint8Array>,
  signal:AbortSignal,deadline:number):Promise<ReadableStreamReadResult<Uint8Array>>{
  checkStreamDeadline(signal,deadline);
  let onAbort:()=>void=()=>{};
  const aborted=new Promise<never>((_,reject)=>{
    onAbort=()=>reject(signal.reason);
    signal.addEventListener('abort',onAbort,{once:true});
  });
  try{const chunk=await Promise.race([reader.read(),aborted]);checkStreamDeadline(signal,deadline);return chunk;}
  finally{signal.removeEventListener('abort',onAbort);}
}
async function boundedBytes(response:Response,max:number,signal:AbortSignal,deadline=performance.now()+15_000):Promise<Uint8Array> {
  const length=response.headers.get('content-length');
  requireCondition(response.body!==null,'PROVIDER_UNAVAILABLE','Missing provider response body.');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];
  let total=0,chunks=0;
  try {
    requireCondition(length===null||/^\d+$/.test(length),'INTEGRITY',
      'Invalid provider response length.');
    requireCondition(length===null||Number(length)<=max,'LIMIT_EXCEEDED',
      'Provider response exceeds export limits.');
    while(true){
      const {done,value}=await readExportChunk(reader,signal,deadline);
      if(done)break;
      requireCondition(++chunks<=65_536,'LIMIT_EXCEEDED','Provider response exceeds export chunk limit.');
      requireCondition(value instanceof Uint8Array,'INTEGRITY','Invalid provider response bytes.');
      if(value.byteLength===0)continue;
      total+=value.byteLength;
      requireCondition(total<=max,'LIMIT_EXCEEDED','Provider response exceeds export limits.');
      parts.push(value);
    }
  }catch(error){
    void reader.cancel().catch(()=>{});
    if(error instanceof PrivateAccountExportError)throw error;
    throw new PrivateAccountExportError('PROVIDER_UNAVAILABLE','Private export response was interrupted.');
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  // Fetch decodes compressed bodies while keeping the wire Content-Length.
  const encoding=response.headers.get('content-encoding');
  if(length!==null&&(!encoding||encoding.toLowerCase()==='identity'))
    requireCondition(total===Number(length),'INTEGRITY','Provider response length changed.');
  return bytes;
}
function assertExportResponseScope(response:Response,requestUrl:string):void {
  requireCondition(!response.redirected&&(!response.url||response.url===new URL(requestUrl).href),
    'INTEGRITY','Private export response did not match the trusted endpoint.');
}
function exportJsonContentType(headers:Headers):boolean {
  return /^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(headers.get('content-type')??'');
}
export class SupabasePrivateAccountDataExporter {
  private readonly origin:string;
  private readonly publishableKey:string;
  private readonly accessToken:()=>Promise<string|null>;
  private readonly http:typeof fetch;
  constructor(endpoint:string,publishableKey:string,
    accessToken:()=>Promise<string|null>,http:typeof fetch=fetch){
    let url:URL;
    try{url=new URL(endpoint);}catch{throw new PrivateAccountExportError('VALIDATION','Invalid API origin.');}
    requireCondition((url.protocol==='https:'||
      (url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))&&
      !url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash,
      'VALIDATION','Trusted Supabase API origin required.');
    requireCondition(typeof publishableKey==='string'&&publishableKey.trim().length>0,
      'VALIDATION','Publishable key required.');
    if(!isSafeSupabaseClientKey(publishableKey))
      throw new PrivateAccountExportError('VALIDATION','A public Supabase API key is required.');
    this.origin=url.origin;this.publishableKey=publishableKey;
    this.accessToken=accessToken;this.http=http;
  }
  private async request(path:string,max:number,body?:Record<string,unknown>):Promise<{bytes:Uint8Array;headers:Headers}> {
    const deadline=performance.now()+15_000;
    const signal=AbortSignal.timeout(15_000);
    let onAbort:()=>void=()=>{};
    const timedOut=new Promise<never>((_,reject)=>{
      onAbort=()=>reject(new PrivateAccountExportError('PROVIDER_UNAVAILABLE','Private export request exceeded its deadline.'));
      signal.addEventListener('abort',onAbort,{once:true});
    });
    const work=async()=>{
      const jwt=await this.accessToken();
      requireCondition(typeof jwt==='string'&&jwt.length>0,'AUTH_EXPIRED','Sign in to export data.');
      checkStreamDeadline(signal,deadline);
      const requestUrl=this.origin+path;
      const response=await this.http(requestUrl,{
        method:body===undefined?'GET':'POST',headers:{apikey:this.publishableKey,Authorization:'Bearer '+jwt,
          Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},
        body:body===undefined?undefined:JSON.stringify(body),
        credentials:'omit',cache:'no-store',redirect:'error',signal
      });
      try{
        checkStreamDeadline(signal,deadline);
        assertExportResponseScope(response,requestUrl);
        if(!response.ok){
          let code:PrivateAccountExportError['code']='PROVIDER_UNAVAILABLE';
          let message='Private export read was denied or unavailable.';
          if(response.status===401||response.status===403)code='AUTH_EXPIRED';
          else if(response.status===429){code='RATE_LIMITED';message='Too many export requests. Try again later.';}
          else if(response.status===413){code='LIMIT_EXCEEDED';message='The export exceeds the bounded response limit.';}
          else if(path.startsWith('/rest/v1/rpc/')&&exportJsonContentType(response.headers)){
            try{
              const raw:unknown=JSON.parse(decoder.decode(await boundedBytes(response,8192,signal,deadline)));
              if(object(raw)&&raw.code==='55000'&&raw.message==='PROFILE_ASSET_EXPORT_VERSION_REQUIRED'){
                code='VERSION_REQUIRED';message='Use the profile-inclusive version 2 export; this legacy scope cannot cover the account.';
              }else if(object(raw)&&raw.code==='54000'&&
                ['ACCOUNT_METADATA_EXPORT_LIMIT_EXCEEDED','ACCOUNT_AUDIT_EXPORT_LIMIT_EXCEEDED'].includes(String(raw.message))){
                code='LIMIT_EXCEEDED';message='The account exceeds the supported export limits.';
              }
            }catch{ /* Unrecognized or invalid error remains unavailable. */ }
          }
          checkStreamDeadline(signal,deadline);
          throw new PrivateAccountExportError(code,message);
        }
        const bytes=await boundedBytes(response,max,signal,deadline);
        requireCondition(await this.accessToken()===jwt,'AUTH_EXPIRED','The account session changed. Start a new export.');
        checkStreamDeadline(signal,deadline);
        return {bytes,headers:response.headers};
      }finally{if(!response.bodyUsed)void response.body?.cancel().catch(()=>{});}
    };
    try{
      const result=await Promise.race([timedOut,work()]);
      checkStreamDeadline(signal,deadline);
      return result;
    }catch(error){
      if(error instanceof PrivateAccountExportError)throw error;
      throw new PrivateAccountExportError('PROVIDER_UNAVAILABLE','Private export source unavailable.');
    }finally{signal.removeEventListener('abort',onAbort);}
  }
  private async json(path:string,max:number,body?:Record<string,unknown>):Promise<unknown> {
    const {bytes,headers}=await this.request(path,max,body);
    requireCondition(exportJsonContentType(headers),'INTEGRITY','Private export JSON media type was not confirmed.');
    try{return JSON.parse(decoder.decode(bytes)) as unknown;}
    catch{throw new PrivateAccountExportError('INTEGRITY','Invalid private export response.');}
  }
  private async owner():Promise<{id:string;email:string|null}> {
    const raw=await this.json('/auth/v1/user',65536);
    requireCondition(object(raw)&&isUuid(raw.id),'UNVERIFIED','Owner identity was not verified.');
    return {id:raw.id,email:typeof raw.email==='string'?raw.email:null};
  }
  private async reconcile(snapshotId:string):Promise<number> {
    const raw=await this.json('/rest/v1/rpc/reconcile_private_account_exit_storage',
      65536,{p_snapshot_id:snapshotId});
    if(object(raw)&&raw.snapshotId===snapshotId&&raw.status==='LIMIT_EXCEEDED'&&raw.limitExceeded===true)
      throw new PrivateAccountExportError('LIMIT_EXCEEDED','The private storage inventory exceeds the bounded reconciliation limit.');
    requireCondition(object(raw)&&raw.snapshotId===snapshotId&&
      raw.status==='METADATA_MATCH_ONLY'&&raw.limitExceeded===false&&
      raw.inventoryDrift===false&&raw.missingObjects===0&&raw.orphanObjects===0&&
      raw.metadataMismatches===0&&raw.storageBytesVerified===false&&
      raw.downloadableExportReady===false&&raw.deletionAllowed===false&&
      Number.isSafeInteger(raw.registeredAssets)&&
      (raw.registeredAssets as number)>=0&&(raw.registeredAssets as number)<=100&&
      raw.registeredAssets===raw.storageObjects,
      'UNVERIFIED','Storage metadata is not reconciled with the owner inventory.');
    return raw.registeredAssets as number;
  }
  /**
   * Read Storage's owner-authorized object identity. This is a change detector,
   * NOT a provider-signed content hash or proof of an immutable historical
   * download. Version identifiers alone do not guarantee retention of bytes.
   */
  private async objectInfo(path:string,ownerId:string,mime:string,size:number):
    Promise<{id:string;version:string;updatedAt:string}> {
    const objectPath=path.split('/').map(encodeURIComponent).join('/');
    const raw=await this.json('/storage/v1/object/info/authenticated/kadmeion-private-assets/'+
      objectPath,65536);
    // Supabase Storage's info renderer returns normalized size/content_type/
    // last_modified fields, not necessarily raw storage.objects metadata.
    const infoSize=object(raw)?(raw.size??(object(raw.metadata)?raw.metadata.size:null)):null;
    const infoMime=object(raw)?(raw.content_type??
      (object(raw.metadata)?raw.metadata.mimetype:null)):null;
    const modified=object(raw)?(raw.last_modified??raw.updated_at):null;
    requireCondition(object(raw)&&isUuid(raw.id)&&
      raw.name===path&&raw.bucket_id==='kadmeion-private-assets'&&
      (raw.owner_id===undefined||raw.owner_id===ownerId)&&
      typeof raw.version==='string'&&raw.version.length>0&&
      raw.version.length<=128&&typeof modified==='string'&&
      !Number.isNaN(Date.parse(modified))&&
      Number.isSafeInteger(Number(infoSize))&&Number(infoSize)===size&&
      typeof infoMime==='string'&&infoMime.toLowerCase()===mime,
      'INTEGRITY','Storage object identity or version is missing or mismatched.');
    // Owner authorization is enforced by the private Storage route's RLS;
    // this normalized info response intentionally omits owner_id.
    return {id:raw.id as string,version:raw.version as string,
      updatedAt:modified as string};
  }
  /**
   * Server-worker SHA-256 pins are immutable and readable only through an
   * owner/live-session RPC. They are NOT provider-signed content digests.
   */
  private async trustedPins(snapshotId:string,assets:JsonObject[]):
    Promise<Map<string,{objectId:string;version:string;expectedSha256:string}>> {
    const raw=await this.json('/rest/v1/rpc/read_private_asset_content_attestations',
      65536,{p_snapshot_id:snapshotId});
    requireCondition(object(raw)&&raw.snapshotId===snapshotId&&
      raw.status==='SERVER_HASH_PINNED'&&raw.providerSigned===false&&
      raw.deletionAllowed===false&&raw.registeredAssets===assets.length&&
      raw.attestedAssets===assets.length&&Array.isArray(raw.attestations)&&
      raw.attestations.length===assets.length,
      'UNVERIFIED','Trusted private asset content hashes are not complete.');
    const pins=new Map<string,{objectId:string;version:string;expectedSha256:string}>();
    for(const entry of raw.attestations){
      requireCondition(object(entry)&&isUuid(entry.assetId)&&
        typeof entry.path==='string'&&isUuid(entry.objectId)&&
        typeof entry.version==='string'&&entry.version.length>0&&
        entry.version.length<=128&&typeof entry.expectedSha256==='string'&&
        /^[0-9a-f]{64}$/.test(entry.expectedSha256)&&
        !pins.has(entry.path),'INTEGRITY','Malformed or duplicate trusted hash pin.');
      const asset=assets.find(a=>a.id===entry.assetId&&a.object_path===entry.path);
      requireCondition(asset!==undefined,'INTEGRITY','Trusted hash does not belong to an exported asset.');
      pins.set(entry.path,{objectId:entry.objectId,version:entry.version,
        expectedSha256:entry.expectedSha256});
    }
    requireCondition(pins.size===assets.length,'UNVERIFIED','Asset hash pin coverage incomplete.');
    return pins;
  }
  /**
   * Owner-live-session, read-only projection of otherwise restricted audit
   * categories. Every category is bounded, and token hashes/session IDs are
   * excluded by the server RPC. Cannot be used as an erasure manifest.
   */
  private async audit(snapshotId:string,ownerId:string):Promise<JsonObject>{
    const categories=['reviewerGrants','moderationCases','moderationEvents',
      'accountExitRequests','reauthChallenges','inventorySnapshots',
      'releasePointers','releaseEvents'] as const;
    const raw=await this.json('/rest/v1/rpc/read_private_account_audit_export',
      MAX_TABLE_BYTES,{p_snapshot_id:snapshotId});
    requireCondition(object(raw)&&raw.status==='BOUNDED_OWNER_AUDIT'&&
      raw.snapshotId===snapshotId&&raw.ownerUserId===ownerId&&
      raw.maxRowsPerCategory===100&&raw.tokenDigestsIncluded===false&&
      raw.sessionsIncluded===false&&raw.completeAccountExport===false&&
      raw.deletionAllowed===false&&object(raw.categories)&&
      Object.keys(raw.categories).length===categories.length&&
      categories.every(key=>Array.isArray((raw.categories as JsonObject)[key])&&
        ((raw.categories as JsonObject)[key] as unknown[]).length<=100),
      'UNVERIFIED','Restricted audit export receipt is incomplete or foreign.');
    const data=raw.categories as JsonObject;
    for(const name of categories)for(const entry of data[name] as unknown[])
      requireCondition(object(entry)&&safeRestrictedAudit(entry),'INTEGRITY',
        'Restricted audit data contained forbidden credentials.');
    return data;
  }
  private async rows(table:typeof TABLES[number][0],column:string,ownerId:string,projection='*'):
    Promise<JsonObject[]> {
    // My Component source is never SELECT-granted to browser JWTs.
    // The list RPC proves a live auth.sessions row, not merely a signed JWT.
    const response=table==='private_my_component_versions'
      ?await this.json('/rest/v1/rpc/owner_list_my_component_versions',MAX_TABLE_BYTES,{})
      :await this.json('/rest/v1/'+table+'?select='+projection+'&'+column+'=eq.'+
        encodeURIComponent(ownerId)+'&limit=101',MAX_TABLE_BYTES);
    const raw=table==='private_my_component_versions'
      ?(object(response)&&response.status==='OWNER_PRIVATE_COMPONENTS'&&
        response.ownerUserId===ownerId&&response.publicExecutionTrusted===false&&
        Object.keys(response).sort().join(',')===
          'items,ownerUserId,publicExecutionTrusted,status'?response.items:null)
      :response;
    requireCondition(Array.isArray(raw),'INTEGRITY','Invalid private table response.');
    requireCondition(raw.length<=MAX_ROWS,'LIMIT_EXCEEDED','Owner records exceed bounded export limit.');
    for(const row of raw)
      requireCondition(object(row)&&row[column]===ownerId,'INTEGRITY',
        'Export source returned a foreign or malformed owner record.');
    if(table==='private_my_component_versions')
      await verifyOwnerComponentRows(raw,ownerId);
    return raw as JsonObject[];
  }
  /** Atomic application data and release history; download separately from Storage evidence. */
  async exportApplicationMetadata(snapshotId:string):Promise<{
    filename:'kadmeion-account-metadata.json'; mime:'application/json'; bytes:Uint8Array;
    status:'APPLICATION_METADATA_SNAPSHOT';storageBytesIncluded:false;providerDataIncluded:false;
  }>{
    requireCondition(isUuid(snapshotId),'VALIDATION','Valid owner inventory snapshot ID required.');
    const token=await this.accessToken();
    requireCondition(typeof token==='string'&&token.length>0,'AUTH_EXPIRED','Sign in to export data.');
    const sameSession=async()=>{
      requireCondition(await this.accessToken()===token,'AUTH_EXPIRED','The account session changed. Start a new export.');
      return token;
    };
    const scoped=new SupabasePrivateAccountDataExporter(this.origin,this.publishableKey,sameSession,this.http);
    const owner=await scoped.owner();
    const envelope=await scoped.json('/rest/v1/rpc/owner_export_account_metadata',
      12*1024*1024,{p_snapshot_id:snapshotId});
    requireCondition(object(envelope)&&envelope.status==='APPLICATION_METADATA_SNAPSHOT'&&
      envelope.schemaVersion===1&&envelope.snapshotId===snapshotId&&envelope.ownerUserId===owner.id&&
      typeof envelope.capturedAt==='string'&&!Number.isNaN(Date.parse(envelope.capturedAt))&&
      envelope.storageBytesIncluded===false&&envelope.providerDataIncluded===false&&
      envelope.deletionAllowed===false&&object(envelope.records)&&object(envelope.restrictedAudit)&&
      Array.isArray(envelope.verifiedReleaseHistory)&&envelope.verifiedReleaseHistory.length<=MAX_ROWS&&
      Object.keys(envelope.records).length===TABLES.length,
    'INTEGRITY','Invalid application metadata export receipt.');
    for(const [table,ownerColumn] of TABLES){
      const rows=envelope.records[table];
      requireCondition(Array.isArray(rows)&&rows.length<=MAX_ROWS&&
        rows.every(row=>object(row)&&row[ownerColumn]===owner.id),
      'INTEGRITY','Application metadata returned a foreign owner record.');
      if(table==='private_my_component_versions')
        await verifyOwnerComponentRows(rows,owner.id);
    }
    for(const row of envelope.verifiedReleaseHistory){
      requireCondition(object(row)&&isUuid(row.intent_id)&&isUuid(row.portfolio_id)&&isUuid(row.request_id)&&
        typeof row.html_sha256==='string'&&/^[a-f0-9]{64}$/.test(row.html_sha256)&&
        safeRestrictedAudit(row),
      'INTEGRITY','Invalid verified release history.');
    }
    const requiredAudit=['reviewerGrants','moderationCases','moderationEvents',
      'accountExitRequests','reauthChallenges','inventorySnapshots',
      'releasePointers','releaseEvents'];
    requireCondition(Object.keys(envelope.restrictedAudit).sort().join(',')===
      requiredAudit.sort().join(','),'INTEGRITY',
      'Application metadata audit inventory omitted a required category.');
    for(const rows of Object.values(envelope.restrictedAudit)){
      requireCondition(Array.isArray(rows)&&rows.length<=MAX_ROWS&&
        rows.every(row=>object(row)&&safeRestrictedAudit(row)),
      'INTEGRITY','Application metadata contains invalid restricted audit records.');
    }
    const bytes=encoder.encode(JSON.stringify(envelope));
    enforceExportBudget(0,bytes.byteLength,12*1024*1024);
    await sameSession();
    return {filename:'kadmeion-account-metadata.json',mime:'application/json',
      bytes,status:'APPLICATION_METADATA_SNAPSHOT',
      storageBytesIncluded:false,providerDataIncluded:false};
  }
  /** Profile-inclusive metadata using the mandatory exact snapshot/request scope. */
  async exportApplicationMetadataV2(snapshotId:string,expectedRequestId:string|null):Promise<{
    filename:'kadmeion-account-metadata-v2.json';mime:'application/json';bytes:Uint8Array;
    status:'APPLICATION_METADATA_SNAPSHOT';storageBytesIncluded:false;providerDataIncluded:false;
  }>{
    requireCondition(isUuid(snapshotId)&&(expectedRequestId===null||isUuid(expectedRequestId)),
      'VALIDATION','Explicit version 2 inventory snapshot and request scope required.');
    const token=await this.accessToken();
    requireCondition(typeof token==='string'&&token.length>0,'AUTH_EXPIRED','Sign in to export data.');
    const sameSession=async()=>{
      requireCondition(await this.accessToken()===token,'AUTH_EXPIRED','The account session changed. Start a new export.');
      return token;
    };
    const scoped=new SupabasePrivateAccountDataExporter(this.origin,this.publishableKey,sameSession,this.http);
    const owner=await scoped.owner();
    const raw=await scoped.json('/rest/v1/rpc/owner_export_account_metadata_v2',
      12*1024*1024,{p_snapshot_id:snapshotId,p_expected_request_id:expectedRequestId});
    const envelope=await verifyMetadataV2(raw,owner.id,snapshotId,expectedRequestId);
    const bytes=encoder.encode(JSON.stringify(envelope));
    enforceExportBudget(0,bytes.byteLength,12*1024*1024);
    await sameSession();
    return {filename:'kadmeion-account-metadata-v2.json',mime:'application/json',bytes,
      status:'APPLICATION_METADATA_SNAPSHOT',storageBytesIncluded:false,providerDataIncluded:false};
  }
  /** Explicit request-bound version 2 recovery; legacy exports are never retried. */
  async exportV2(snapshotId:string,expectedRequestId:string|null):Promise<PrivateAccountExportArtifact>{
    requireCondition(isUuid(snapshotId)&&(expectedRequestId===null||isUuid(expectedRequestId)),
      'VALIDATION','Explicit version 2 inventory snapshot and request scope required.');
    const token=await this.accessToken();
    requireCondition(typeof token==='string'&&token.length>0,'AUTH_EXPIRED','Sign in to export data.');
    const sameSession=async()=>{
      requireCondition(await this.accessToken()===token,'AUTH_EXPIRED','The account session changed. Start a new export.');
      return token;
    };
    const scoped=new SupabasePrivateAccountDataExporter(this.origin,this.publishableKey,sameSession,this.http);
    const artifact=await scoped.exportForSessionV2(snapshotId,expectedRequestId);
    await sameSession();
    return artifact;
  }
  // Called only after a verified owner V2 inventory and exact aggregate
  // UNVERIFIED receipt. The worker, not the browser, computes and records
  // the digest. A missing worker or ambiguous receipt cannot grant export.
  private async prepareV2PinCoverage(ownerId:string,registry:Map<string,V2RegistryAsset>):Promise<void>{
    const read=async(asset:V2RegistryAsset)=>verifyOwnerV2Pin(
      await this.json('/rest/v1/rpc/read_owner_private_asset_pin',65536,
        {p_scope:asset.scope,p_asset_id:asset.assetId,p_project_id:asset.projectId}),ownerId,asset);
    // Verify all registered targets before making any worker request.
    const missing:{asset:V2RegistryAsset;before:OwnerV2PinReadback}[]=[];
    for(const asset of registry.values()){
      const pin=await read(asset);
      if(pin.status==='UNPINNED')missing.push({asset,before:pin});
    }
    for(const {asset,before} of missing){
      // A concurrent attestation or object change must be reconciled first.
      const current=await read(asset);
      requireCondition(current.objectId===before.objectId&&current.version===before.version,
        'INTEGRITY','Private object identity changed before trusted attestation.');
      if(current.status==='SERVER_HASH_PINNED')continue;
      let receipt:unknown;
      try{
        // PROJECT retains the established legacy request. PROFILE requires
        // the explicitly scoped companion Edge handler; no project fallback.
        receipt=await this.json('/functions/v1/complete-private-asset',65536,
          asset.scope==='PROFILE'?{assetId:asset.assetId,scope:'PROFILE'}:{assetId:asset.assetId});
      }catch(error){
        if(error instanceof PrivateAccountExportError&&error.code!=='PROVIDER_UNAVAILABLE')throw error;
        throw new PrivateAccountExportError('UNVERIFIED','Trusted private media attestation is unavailable; no recovery file was produced.');
      }
      requireCondition(object(receipt)&&exactFields(receipt,asset.scope==='PROFILE'?
        ['assetId','scope','status','publicPublishingAllowed','accountDeletionAllowed']:
        ['assetId','status','publicPublishingAllowed','accountDeletionAllowed'])&&
        receipt.assetId===asset.assetId&&(asset.scope!=='PROFILE'||receipt.scope==='PROFILE')&&
        receipt.status==='WRITE_ONCE_ATTESTED'&&receipt.publicPublishingAllowed===false&&receipt.accountDeletionAllowed===false,
        'INTEGRITY','Trusted private media attestation was not confirmed.');
      const after=await read(asset);
      requireCondition(after.status==='SERVER_HASH_PINNED'&&after.objectId===before.objectId&&after.version===before.version,
        'UNVERIFIED','Trusted private media hash was not confirmed for the registered object.');
    }
  }
  private async exportForSessionV2(snapshotId:string,requestId:string|null):Promise<PrivateAccountExportArtifact>{
    const owner=await this.owner();
    const args={p_snapshot_id:snapshotId,p_expected_request_id:requestId};
    const {SupabasePrivateAccountErasureService}=await import('../../contracts/src/private-account-erasure-service.ts');
    const account=new SupabasePrivateAccountErasureService(this.origin,this.publishableKey,this.accessToken,this.http);
    const reconcile=async()=>{
      try{
        const receipt=await account.reconcileStorageV2(snapshotId,requestId);
        if(receipt.status==='LIMIT_EXCEEDED')throw new PrivateAccountExportError('LIMIT_EXCEEDED','Storage inventory exceeds the version 2 limit.');
        requireCondition(receipt.status==='METADATA_MATCH_ONLY'&&receipt.profilePending===0&&receipt.inventoryDrift===false,
          'UNVERIFIED','Version 2 storage metadata is not reconciled.');
        return receipt;
      }catch(error){
        if(error instanceof PrivateAccountExportError)throw error;
        const code=object(error)?error.code:null;
        throw new PrivateAccountExportError(code==='AUTH_EXPIRED'||code==='FORBIDDEN'?'AUTH_EXPIRED':
          code==='RATE_LIMITED'?'RATE_LIMITED':code==='INVALID_ACK'?'INTEGRITY':'PROVIDER_UNAVAILABLE',
          'Could not verify scoped storage metadata.');
      }
    };
    const readMetadata=async()=>verifyMetadataV2(await this.json('/rest/v1/rpc/owner_export_account_metadata_v2',
      12*1024*1024,args),owner.id,snapshotId,requestId);
    const before=await reconcile();
    const metadata=await readMetadata();
    const registry=v2Registry(metadata.records as JsonObject,owner.id);
    requireCondition(before.registeredAssets===registry.size&&
      before.projectRegistered===[...registry.values()].filter(a=>a.scope==='PROJECT').length&&
      before.profileRegistered===[...registry.values()].filter(a=>a.scope==='PROFILE').length,
      'UNVERIFIED','Version 2 registered inventory changed.');
    let total=0,minimum=enforceExportBudget(0,encoder.encode(JSON.stringify([
      metadata.records,metadata.restrictedAudit,metadata.verifiedReleaseHistory])).byteLength);
    for(const asset of registry.values()){
      total+=asset.byteSize;
      requireCondition(total<=MAX_TOTAL_ASSET_BYTES,'LIMIT_EXCEEDED','Private asset bytes exceed recovery limits.');
      minimum=enforceExportBudget(minimum,4*Math.ceil(asset.byteSize/3));
    }
    const readRawPins=()=>this.json('/rest/v1/rpc/read_private_asset_content_attestations_v2',65536,args);
    const readPins=async()=>parseV2Pins(await readRawPins(),owner.id,snapshotId,requestId,registry);
    let initialPins=await readRawPins();
    if(missingV2PinCoverage(initialPins,owner.id,snapshotId,requestId,registry.size)){
      await this.prepareV2PinCoverage(owner.id,registry);
      // Reconcile the same durable snapshot; do not recapture, skip media or
      // substitute a client hash for the authoritative aggregate.
      const ready=await reconcile();
      requireCondition(ready.inventoryCapturedAt===before.inventoryCapturedAt&&ready.registeredAssets===before.registeredAssets&&
        ready.projectRegistered===before.projectRegistered&&ready.profileRegistered===before.profileRegistered,
        'UNVERIFIED','Private asset inventory changed while preparing recovery.');
      initialPins=await readRawPins();
    }
    const pins=parseV2Pins(initialPins,owner.id,snapshotId,requestId,registry);
    const infos=new Map<string,{id:string;version:string;updatedAt:string}>();
    for(const asset of registry.values()){
      const pin=pins.get(asset.path)!;
      const info=await this.objectInfo(asset.path,owner.id,asset.mimeType,asset.byteSize);
      requireCondition(info.id===pin.objectId&&info.version===pin.version,
        'INTEGRITY','Private object identity changed before version 2 recovery.');
      infos.set(asset.path,info);
    }
    const assets:JsonObject[]=[];
    for(const asset of registry.values()){
      const pin=pins.get(asset.path)!;
      const response=await this.request('/storage/v1/object/authenticated/kadmeion-private-assets/'+
        asset.path.split('/').map(encodeURIComponent).join('/'),asset.byteSize);
      const mime=(response.headers.get('content-type')??'').split(';',1)[0]?.trim().toLowerCase();
      requireCondition(response.bytes.byteLength===asset.byteSize&&mime===asset.mimeType&&
        await sha256(response.bytes)===pin.expectedSha256,'INTEGRITY','Scoped asset bytes differ from trusted content pin.');
      assets.push({scope:asset.scope,assetId:asset.assetId,projectId:asset.projectId,path:asset.path,
        mimeType:asset.mimeType,byteSize:asset.byteSize,storageObjectId:pin.objectId,storageVersionAtRead:pin.version,
        expectedSha256:pin.expectedSha256,downloadedSha256:pin.expectedSha256,base64:base64(response.bytes)});
    }
    for(const asset of registry.values()){
      const old=infos.get(asset.path)!;
      const info=await this.objectInfo(asset.path,owner.id,asset.mimeType,asset.byteSize);
      requireCondition(info.id===old.id&&info.version===old.version&&info.updatedAt===old.updatedAt,
        'INTEGRITY','Scoped private object changed during recovery.');
    }
    const after=await reconcile(),lastPins=await readPins(),lastMetadata=await readMetadata();
    requireCondition(after.inventoryCapturedAt===before.inventoryCapturedAt&&after.registeredAssets===before.registeredAssets&&
      after.projectRegistered===before.projectRegistered&&after.profileRegistered===before.profileRegistered&&
      [...pins].every(([key,pin])=>{
        const next=lastPins.get(key);return next!==undefined&&sameV2Asset(next as unknown as JsonObject,registry.get(key)!)&&
          next.objectId===pin.objectId&&next.version===pin.version&&next.expectedSha256===pin.expectedSha256;
      })&&JSON.stringify(lastMetadata.records)===JSON.stringify(metadata.records)&&
      JSON.stringify(lastMetadata.restrictedAudit)===JSON.stringify(metadata.restrictedAudit)&&
      JSON.stringify(lastMetadata.verifiedReleaseHistory)===JSON.stringify(metadata.verifiedReleaseHistory),
      'UNVERIFIED','Scoped metadata or trusted asset evidence changed during recovery.');
    const finalOwner=await this.owner();
    requireCondition(finalOwner.id===owner.id,'AUTH_EXPIRED','Owner session changed during recovery.');
    const envelope={kind:'kadmeion-bounded-private-account-export',schemaVersion:2,
      exportedAt:new Date().toISOString(),metadataCapturedAt:metadata.capturedAt,
      owner:{id:owner.id,email:owner.email},inventorySnapshotId:snapshotId,requestId,
      records:metadata.records,restrictedAudit:metadata.restrictedAudit,verifiedReleaseHistory:metadata.verifiedReleaseHistory,
      assets,evidence:{registeredAssets:registry.size,downloadedAssets:assets.length,downloadedByteCount:total,
        downloadedByteHashes:'SHA-256',providerExpectedHashesVerified:false,providerObjectVersionPinned:false,
        trustedServerWorkerHashesVerified:true,storageObjectVersionCheckedBeforeAndAfter:true,
        crossTableAtomicSnapshot:false,storageReconciliationBeforeAndAfter:true},
      limitations:{completeAccountExport:false,omittedCategories:['case-study revision history','reviewer grant credentials',
        'provider integrations and backups','non-atomic provider-side histories'],
        providerRetentionVerified:false,publicRouteRevocationVerified:false,deletionAllowed:false}};
    const bytes=encoder.encode(JSON.stringify(envelope));
    enforceExportBudget(0,bytes.byteLength);
    await verifyBoundedPrivateAccountExport(bytes);
    return {filename:'kadmeion-private-account-partial-v2.json',mime:'application/json',bytes,
      status:'BOUNDED_PARTIAL_EXPORT',completeAccountExport:false,deletionAllowed:false};
  }
  /** Returns JSON bytes for a user-triggered local Blob download. Never uploads them. */
  async export(snapshotId:string):Promise<PrivateAccountExportArtifact> {
    requireCondition(isUuid(snapshotId),'VALIDATION','Valid owner inventory snapshot ID required.');
    const token=await this.accessToken();
    requireCondition(typeof token==='string'&&token.length>0,'AUTH_EXPIRED','Sign in to export data.');
    const sameSession=async()=>{
      requireCondition(await this.accessToken()===token,'AUTH_EXPIRED',
        'The account session changed. Start a new export.');
      return token;
    };
    const scoped=new SupabasePrivateAccountDataExporter(this.origin,this.publishableKey,sameSession,this.http);
    const artifact=await scoped.exportForSession(snapshotId);
    await sameSession();
    return artifact;
  }

  private async exportForSession(snapshotId:string):Promise<PrivateAccountExportArtifact> {
    const owner=await this.owner();
    const before=await this.reconcile(snapshotId);
    const auditBefore=await this.audit(snapshotId,owner.id);
    const records:Record<string,JsonObject[]>={};
    let minimumBytes=enforceExportBudget(0,encoder.encode(JSON.stringify(auditBefore)).byteLength);
    for(const [table,column,projection] of TABLES){
      const rows=await this.rows(table,column,owner.id,projection);
      minimumBytes=enforceExportBudget(minimumBytes,encoder.encode(JSON.stringify(rows)).byteLength);
      records[table]=rows;
    }
    const assets=records.project_assets;
    requireCondition(Array.isArray(assets),'INTEGRITY','Required private asset projection is missing.');
    requireCondition(assets.length===before,'UNVERIFIED','Asset inventory changed during export.');
    requireCondition(assets.length<=MAX_ASSETS,'LIMIT_EXCEEDED','Too many assets for bounded byte export.');
    const expected=await this.trustedPins(snapshotId,assets);
    // Pin every registered object BEFORE any byte download. This prevents
    // an ordinary same-path replacement from silently crossing the export.
    const pins=new Map<string,{id:string;version:string;updatedAt:string}>();
    for(const asset of assets){
      const path=asset.object_path,mime=asset.mime_type,size=asset.byte_size;
      requireCondition(typeof path==='string'&&
        new RegExp('^'+owner.id+'/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+$').test(path)&&
        typeof mime==='string'&&['image/png','image/jpeg','image/webp','image/avif'].includes(mime)&&
        typeof size==='number'&&Number.isSafeInteger(size)&&size>0&&size<=MAX_ASSET_BYTES,
        'INTEGRITY','Invalid verified asset metadata.');
      requireCondition(!pins.has(path),'INTEGRITY','Duplicate registered asset path.');
      const current=await this.objectInfo(path,owner.id,mime,size);
      const attested=expected.get(path);
      requireCondition(attested!==undefined&&current.id===attested.objectId&&
        current.version===attested.version,'INTEGRITY',
        'Private Storage object no longer matches its trusted hash pin.');
      pins.set(path,current);
    }
    // Base64 alone is a necessary lower bound; verify the registered sizes
    // before downloads so oversized archives do not consume transfer/memory.
    for(const asset of assets)
      minimumBytes=enforceExportBudget(minimumBytes,4*Math.ceil((asset.byte_size as number)/3));
    let total=0;
    const verifiedAssets:JsonObject[]=[];
    for(const asset of assets){
      const path=asset.object_path,mime=asset.mime_type,size=asset.byte_size;
      requireCondition(typeof path==='string'&&
        new RegExp('^'+owner.id+'/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+$').test(path)&&
        typeof mime==='string'&&['image/png','image/jpeg','image/webp','image/avif'].includes(mime)&&
        typeof size==='number'&&Number.isSafeInteger(size)&&size>0&&size<=MAX_ASSET_BYTES,
        'INTEGRITY','Invalid verified asset metadata.');
      requireCondition(total+size<=MAX_TOTAL_ASSET_BYTES,'LIMIT_EXCEEDED',
        'Private asset bytes exceed export limit.');
      const objectPath=path.split('/').map(encodeURIComponent).join('/');
      const response=await this.request('/storage/v1/object/authenticated/kadmeion-private-assets/'+
        objectPath,MAX_ASSET_BYTES);
      const actualMime=(response.headers.get('content-type')??'').split(';',1)[0]?.trim().toLowerCase()??'';
      requireCondition(response.bytes.length===size&&actualMime===mime,'INTEGRITY',
        'Private asset bytes do not match registered size or MIME.');
      total+=response.bytes.length;
      const pin=pins.get(path)!;
      const digest=await sha256(response.bytes);
      requireCondition(digest===expected.get(path)?.expectedSha256,'INTEGRITY',
        'Private asset bytes differ from server-attested SHA-256.');
      verifiedAssets.push({path,mimeType:mime,byteSize:size,
        storageObjectId:pin.id,storageVersionAtRead:pin.version,
        expectedSha256:digest,downloadedSha256:digest,base64:base64(response.bytes)});
    }
    // Re-read ALL object versions after ALL downloads, not merely immediately
    // after each one; a late overwrite of an earlier asset must also fail.
    for(const asset of assets){
      const path=asset.object_path as string;
      const pin=pins.get(path)!;
      const current=await this.objectInfo(path,owner.id,
        asset.mime_type as string,asset.byte_size as number);
      requireCondition(current.id===pin.id&&current.version===pin.version&&
        current.updatedAt===pin.updatedAt,'INTEGRITY',
        'Private Storage object changed while exporting.');
    }
    const after=await this.reconcile(snapshotId);
    requireCondition(after===before,'UNVERIFIED','Storage inventory changed during export.');
    const auditAfter=await this.audit(snapshotId,owner.id);
    requireCondition(JSON.stringify(auditAfter)===JSON.stringify(auditBefore),
      'UNVERIFIED','Restricted audit history changed during export.');
    const finalOwner=await this.owner();
    requireCondition(finalOwner.id===owner.id,'AUTH_EXPIRED','Owner session changed during export.');
    const envelope={
      kind:'kadmeion-bounded-private-account-export',schemaVersion:1,
      exportedAt:new Date().toISOString(),owner:{id:owner.id,email:owner.email},
      inventorySnapshotId:snapshotId,records,restrictedAudit:auditBefore,
      assets:verifiedAssets,
      evidence:{registeredAssets:before,downloadedAssets:verifiedAssets.length,
        downloadedByteCount:total,downloadedByteHashes:'SHA-256',
        providerExpectedHashesVerified:false,providerObjectVersionPinned:false,
        trustedServerWorkerHashesVerified:true,
        storageObjectVersionCheckedBeforeAndAfter:true,
        crossTableAtomicSnapshot:false,storageReconciliationBeforeAndAfter:true},
      limitations:{completeAccountExport:false,
        omittedCategories:['case-study revision history','reviewer grant credentials',
          'provider integrations and backups',
          'non-atomic provider-side histories'],
        providerRetentionVerified:false,publicRouteRevocationVerified:false,
        deletionAllowed:false}
    };
    const bytes=encoder.encode(JSON.stringify(envelope));
    requireCondition(bytes.byteLength<=MAX_EXPORT_BYTES,'LIMIT_EXCEEDED',
      'Export document exceeds maximum size.');
    return {filename:'kadmeion-private-account-partial-export.json',
      mime:'application/json',bytes,status:'BOUNDED_PARTIAL_EXPORT',
      completeAccountExport:false,deletionAllowed:false};
  }
}


/**
 * B09 OFFLINE CHECK ONLY. Rechecks a downloaded bounded partial account export
 * for internal consistency and exact embedded asset digests. It cannot prove
 * document provenance, current provider state, completeness or erasure rights:
 * anyone can forge a new JSON document with internally matching hashes.
 */
export interface VerifiedPartialAccountExport {
  status:'LOCALLY_CONSISTENT_PARTIAL_EXPORT';
  sha256:string;
  ownerId:string;
  inventorySnapshotId:string;
  schemaVersion?:2;
  requestId?:string|null;
  tablesChecked:number;
  assetsChecked:number;
  assetBytesChecked:number;
  documentAuthenticityVerified:false;
  completeAccountExport:false;
  deletionAllowed:false;
}
async function verifyV2Recovery(raw:JsonObject,bytes:Uint8Array):Promise<VerifiedPartialAccountExport>{
  requireCondition(exactFields(raw,['kind','schemaVersion','exportedAt','metadataCapturedAt','owner',
    'inventorySnapshotId','requestId','records','restrictedAudit','verifiedReleaseHistory','assets','evidence','limitations'])&&
    raw.kind==='kadmeion-bounded-private-account-export'&&raw.schemaVersion===2&&validDate(raw.exportedAt)&&
    validDate(raw.metadataCapturedAt)&&isUuid(raw.inventorySnapshotId)&&(raw.requestId===null||isUuid(raw.requestId))&&
    object(raw.owner)&&exactFields(raw.owner,['id','email'])&&isUuid(raw.owner.id)&&
    (raw.owner.email===null||typeof raw.owner.email==='string')&&object(raw.records)&&object(raw.evidence)&&
    object(raw.limitations)&&Array.isArray(raw.assets),
    'INTEGRITY','Invalid version 2 private recovery structure.');
  const ownerId=raw.owner.id;
  await verifyMetadataV2({status:'APPLICATION_METADATA_SNAPSHOT',schemaVersion:2,requestId:raw.requestId,
    snapshotId:raw.inventorySnapshotId,ownerUserId:ownerId,capturedAt:raw.metadataCapturedAt,
    records:raw.records,restrictedAudit:raw.restrictedAudit,verifiedReleaseHistory:raw.verifiedReleaseHistory,
    storageBytesIncluded:false,providerDataIncluded:false,deletionAllowed:false},
    ownerId,raw.inventorySnapshotId,raw.requestId);
  const registry=v2Registry(raw.records,ownerId),evidence=raw.evidence,limitations=raw.limitations;
  requireCondition(exactFields(limitations,['completeAccountExport','deletionAllowed','omittedCategories',
    'providerRetentionVerified','publicRouteRevocationVerified'])&&limitations.completeAccountExport===false&&
    limitations.deletionAllowed===false&&limitations.providerRetentionVerified===false&&limitations.publicRouteRevocationVerified===false&&
    Array.isArray(limitations.omittedCategories)&&limitations.omittedCategories.length>=1&&limitations.omittedCategories.length<=16&&
    limitations.omittedCategories.every(v=>typeof v==='string'&&v.length>=1&&v.length<=120)&&
    exactFields(evidence,['registeredAssets','downloadedAssets','downloadedByteCount','downloadedByteHashes',
      'providerExpectedHashesVerified','providerObjectVersionPinned','trustedServerWorkerHashesVerified',
      'storageObjectVersionCheckedBeforeAndAfter','crossTableAtomicSnapshot','storageReconciliationBeforeAndAfter'])&&
    evidence.registeredAssets===registry.size&&evidence.downloadedAssets===registry.size&&
    evidence.downloadedByteHashes==='SHA-256'&&evidence.providerExpectedHashesVerified===false&&
    evidence.providerObjectVersionPinned===false&&evidence.trustedServerWorkerHashesVerified===true&&
    evidence.storageObjectVersionCheckedBeforeAndAfter===true&&evidence.crossTableAtomicSnapshot===false&&
    evidence.storageReconciliationBeforeAndAfter===true&&raw.assets.length===registry.size,
    'INTEGRITY','Version 2 recovery evidence or limitations are invalid.');
  const seen=new Set<string>(),objects=new Set<string>();let total=0;
  for(const entry of raw.assets){
    requireCondition(object(entry)&&exactFields(entry,['scope','assetId','projectId','path','mimeType','byteSize','storageObjectId',
      'storageVersionAtRead','expectedSha256','downloadedSha256','base64'])&&typeof entry.path==='string'&&
      !seen.has(entry.path)&&isUuid(entry.storageObjectId)&&!objects.has(entry.storageObjectId)&&
      typeof entry.storageVersionAtRead==='string'&&entry.storageVersionAtRead.length>=1&&entry.storageVersionAtRead.length<=128&&
      typeof entry.expectedSha256==='string'&&/^[a-f0-9]{64}$/.test(entry.expectedSha256)&&
      entry.downloadedSha256===entry.expectedSha256&&typeof entry.base64==='string'&&
      entry.base64.length<=4*Math.ceil(MAX_ASSET_BYTES/3),
      'INTEGRITY','Invalid version 2 recovery media entry.');
    const asset=registry.get(entry.path);
    requireCondition(asset!==undefined&&sameV2Asset(entry,asset)&&
      (asset.scope!=='PROFILE'||(entry.storageObjectId===asset.objectId&&entry.storageVersionAtRead===asset.version)),
      'INTEGRITY','Version 2 recovery media is not bound to owner registry scope.');
    let media:Uint8Array;
    try{media=Uint8Array.from(atob(entry.base64),ch=>ch.charCodeAt(0));}
    catch{throw new PrivateAccountExportError('INTEGRITY','Invalid version 2 recovery media encoding.');}
    total+=media.byteLength;
    requireCondition(media.byteLength===asset.byteSize&&total<=MAX_TOTAL_ASSET_BYTES&&
      base64(media)===entry.base64&&await sha256(media)===entry.expectedSha256,
      'INTEGRITY','Version 2 recovery media bytes differ from recorded pins.');
    seen.add(entry.path);objects.add(entry.storageObjectId);
  }
  requireCondition(evidence.downloadedByteCount===total&&seen.size===registry.size,
    'INTEGRITY','Version 2 recovery media totals do not match.');
  return {status:'LOCALLY_CONSISTENT_PARTIAL_EXPORT',sha256:await sha256(bytes),ownerId,
    inventorySnapshotId:raw.inventorySnapshotId,schemaVersion:2,requestId:raw.requestId,
    tablesChecked:V2_TABLES.length,assetsChecked:seen.size,assetBytesChecked:total,
    documentAuthenticityVerified:false,completeAccountExport:false,deletionAllowed:false};
}
export async function verifyBoundedPrivateAccountExport(
  bytes:Uint8Array
):Promise<VerifiedPartialAccountExport>{
  requireCondition(bytes instanceof Uint8Array&&bytes.byteLength>0&&
    bytes.byteLength<=MAX_EXPORT_BYTES,'VALIDATION',
    'Invalid or oversized private export file.');
  let raw:unknown;
  try{raw=JSON.parse(decoder.decode(bytes));}
  catch{throw new PrivateAccountExportError('INTEGRITY','Private export is not valid UTF-8 JSON.');}
  if(object(raw)&&raw.schemaVersion===2)return verifyV2Recovery(raw,bytes);
  const top=['assets','evidence','exportedAt','inventorySnapshotId','kind',
    'limitations','owner','records','restrictedAudit','schemaVersion'];
  requireCondition(object(raw)&&Object.keys(raw).sort().join(',')===top.join(',')&&
    raw.kind==='kadmeion-bounded-private-account-export'&&raw.schemaVersion===1&&
    typeof raw.exportedAt==='string'&&!Number.isNaN(Date.parse(raw.exportedAt))&&
    isUuid(raw.inventorySnapshotId)&&object(raw.owner)&&
    Object.keys(raw.owner).sort().join(',')==='email,id'&&isUuid(raw.owner.id)&&
    (raw.owner.email===null||typeof raw.owner.email==='string')&&
    object(raw.records)&&object(raw.restrictedAudit)&&
    object(raw.evidence)&&object(raw.limitations)&&Array.isArray(raw.assets),
    'INTEGRITY','Partial export structure or owner identity is invalid.');
  const ownerId=raw.owner.id as string;
  const tableNames=TABLES.map(row=>row[0]).sort();
  const records=raw.records as JsonObject;
  requireCondition(Object.keys(records).sort().join(',')===tableNames.join(','),
    'INTEGRITY','Partial export has missing or unknown record categories.');
  for(const [table,column] of TABLES){
    const rows=records[table];
    requireCondition(Array.isArray(rows)&&rows.length<=MAX_ROWS,
      'INTEGRITY','Partial export record category is invalid.');
    for(const row of rows)
      requireCondition(object(row)&&row[column]===ownerId,
        'INTEGRITY','Partial export contains a foreign account row.');
    if(table==='private_my_component_versions')
      await verifyOwnerComponentRows(rows,ownerId);
  }
  const categories=['reviewerGrants','moderationCases','moderationEvents',
    'accountExitRequests','reauthChallenges','inventorySnapshots',
    'releasePointers','releaseEvents'];
  const audit=raw.restrictedAudit as JsonObject;
  requireCondition(Object.keys(audit).sort().join(',')===
    [...categories].sort().join(','),'INTEGRITY',
    'Private audit categories are missing or unexpected.');

  for(const category of categories){
    const entries=audit[category];
    requireCondition(Array.isArray(entries)&&entries.length<=MAX_ROWS,
      'INTEGRITY','Partial audit category is invalid.');
    for(const entry of entries)
      requireCondition(object(entry)&&safeRestrictedAudit(entry),
        'INTEGRITY','Private audit contains an excluded secret field.');
  }
  const limitations=raw.limitations as JsonObject;
  requireCondition(Object.keys(limitations).sort().join(',')===
    'completeAccountExport,deletionAllowed,omittedCategories,providerRetentionVerified,publicRouteRevocationVerified'&&
    limitations.completeAccountExport===false&&
    limitations.deletionAllowed===false&&
    limitations.providerRetentionVerified===false&&
    limitations.publicRouteRevocationVerified===false&&
    Array.isArray(limitations.omittedCategories)&&
    limitations.omittedCategories.length>0&&limitations.omittedCategories.length<=16&&
    limitations.omittedCategories.every(value=>typeof value==='string'&&
      value.length>0&&value.length<=120),
    'INTEGRITY','Export limitations must not claim unsupported guarantees.');
  const evidence=raw.evidence as JsonObject;
  const keys=['registeredAssets','downloadedAssets','downloadedByteCount',
    'downloadedByteHashes','providerExpectedHashesVerified',
    'providerObjectVersionPinned','trustedServerWorkerHashesVerified',
    'storageObjectVersionCheckedBeforeAndAfter','crossTableAtomicSnapshot',
    'storageReconciliationBeforeAndAfter'];
  requireCondition(Object.keys(evidence).sort().join(',')===
    keys.sort().join(',')&&
    evidence.downloadedByteHashes==='SHA-256'&&
    evidence.providerExpectedHashesVerified===false&&
    evidence.providerObjectVersionPinned===false&&
    evidence.trustedServerWorkerHashesVerified===true&&
    evidence.storageObjectVersionCheckedBeforeAndAfter===true&&
    evidence.crossTableAtomicSnapshot===false&&
    evidence.storageReconciliationBeforeAndAfter===true,
    'INTEGRITY','Private export evidence has unsupported assurances.');
  const assets=raw.assets as unknown[];
  const registered=records.project_assets as JsonObject[];
  requireCondition(assets.length<=MAX_ASSETS&&registered.length===assets.length&&
    evidence.registeredAssets===assets.length&&
    evidence.downloadedAssets===assets.length,
    'INTEGRITY','Private export asset coverage is incomplete.');
  const seen=new Set<string>();
  let byteCount=0;
  for(const entry of assets){
    requireCondition(object(entry)&&
      Object.keys(entry).sort().join(',')===
      'base64,byteSize,downloadedSha256,expectedSha256,mimeType,path,storageObjectId,storageVersionAtRead'&&
      typeof entry.path==='string'&&
      new RegExp('^'+ownerId+'/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+$').test(entry.path)&&
      !seen.has(entry.path)&&
      isUuid(entry.storageObjectId)&&
      typeof entry.storageVersionAtRead==='string'&&
      entry.storageVersionAtRead.length>0&&entry.storageVersionAtRead.length<=128&&
      typeof entry.mimeType==='string'&&
      ['image/png','image/jpeg','image/webp','image/avif'].includes(entry.mimeType)&&
      typeof entry.byteSize==='number'&&Number.isSafeInteger(entry.byteSize)&&
      entry.byteSize>0&&entry.byteSize<=MAX_ASSET_BYTES&&
      typeof entry.expectedSha256==='string'&&
      /^[0-9a-f]{64}$/.test(entry.expectedSha256)&&
      entry.downloadedSha256===entry.expectedSha256&&
      typeof entry.base64==='string'&&
      entry.base64.length<=Math.ceil(MAX_ASSET_BYTES/3)*4&&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.base64),
      'INTEGRITY','Private export asset metadata is invalid.');
    seen.add(entry.path);
    requireCondition(registered.some(row=>row.object_path===entry.path&&
      row.mime_type===entry.mimeType&&row.byte_size===entry.byteSize),
      'INTEGRITY','Private exported bytes lack an owner asset row.');
    let rawBytes:Uint8Array;
    try{
      const binary=atob(entry.base64 as string);
      rawBytes=Uint8Array.from(binary,char=>char.charCodeAt(0));
    }catch{throw new PrivateAccountExportError('INTEGRITY','Asset base64 cannot be decoded.');}
    requireCondition(rawBytes.byteLength===entry.byteSize,
      'INTEGRITY','Private asset byte count is inconsistent.');
    byteCount+=rawBytes.length;
    requireCondition(byteCount<=MAX_TOTAL_ASSET_BYTES&&
      await sha256(rawBytes)===entry.expectedSha256,
      'INTEGRITY','Private asset SHA-256 does not match its archive bytes.');
  }
  requireCondition(evidence.downloadedByteCount===byteCount,
    'INTEGRITY','Private export byte total does not match its evidence.');
  return {
    status:'LOCALLY_CONSISTENT_PARTIAL_EXPORT',
    sha256:await sha256(bytes),
    ownerId,inventorySnapshotId:raw.inventorySnapshotId as string,
    tablesChecked:TABLES.length,assetsChecked:assets.length,
    assetBytesChecked:byteCount,
    documentAuthenticityVerified:false,completeAccountExport:false,
    deletionAllowed:false
  };
}


/**
 * B09 user-controlled source recovery from an already-downloaded partial
 * account export. Produces the existing portable editor-source ZIP for one
 * exact portfolio and revision. This DOES NOT include private Storage media,
 * provider histories, or proof that the JSON originated at Supabase; the user
 * must retain the original partial account export separately for its assets.
 * No network calls, release pointer changes or deletion authorization occur.
 */
export interface RecoveredPortfolioSourceArchive {
  filename:string;
  zip:Uint8Array;
  sha256:string;
  portfolioId:string;
  revision:number;
  status:'SOURCE_RECOVERED_FROM_PARTIAL_ACCOUNT_EXPORT';
  sourceAuthenticityVerified:false;
  privateMediaIncluded:false;
  completeAccountExport:false;
  deletionAllowed:false;
}
export async function recoverPortfolioSourceZipFromPartialAccountExport(
  exportBytes:Uint8Array,portfolioId:string,revision:number
):Promise<RecoveredPortfolioSourceArchive>{
  requireCondition(isUuid(portfolioId)&&Number.isSafeInteger(revision)&&revision>=1,
    'VALIDATION','A valid portfolio and positive revision are required.');
  // This includes bounded owner-category checks, restricted audit exclusions,
  // asset coverage and SHA-256 verification of embedded private image bytes.
  const inspected=await verifyBoundedPrivateAccountExport(exportBytes);
  let raw:JsonObject;
  try{raw=JSON.parse(decoder.decode(exportBytes)) as JsonObject;}
  catch{throw new PrivateAccountExportError('INTEGRITY','Unreadable private export.');}
  const records=raw.records;
  requireCondition(object(records),'INTEGRITY','Private source categories are missing.');
  const portfolios=records.portfolios,history=records.portfolio_revisions;
  requireCondition(Array.isArray(portfolios)&&Array.isArray(history)&&
    portfolios.some(item=>object(item)&&item.id===portfolioId&&
      item.owner_user_id===inspected.ownerId),
    'INTEGRITY','Selected portfolio is not present in this owner export.');
  const matches=history.filter(row=>object(row)&&row.portfolio_id===portfolioId&&
    row.revision===revision&&row.owner_user_id===inspected.ownerId);
  requireCondition(matches.length===1&&object(matches[0])&&
    object(matches[0].snapshot),
    'INTEGRITY','Selected source revision is missing, ambiguous or invalid.');
  let zip:Uint8Array;
  try{
    const {exportPortfolioSourceZip}=await import('./portable-source-archive.ts');
    zip=exportPortfolioSourceZip(matches[0].snapshot as unknown as
      import('../../editor-core/src/portfolio-revision-transactions.ts').PortfolioSnapshot);
  }catch{
    throw new PrivateAccountExportError('INTEGRITY',
      'Selected portfolio source is not portable under the current format.');
  }
  return {
    filename:'kadmeion-portfolio-'+portfolioId+'-revision-'+revision+'.zip',
    zip,sha256:await sha256(zip),portfolioId,revision,
    status:'SOURCE_RECOVERED_FROM_PARTIAL_ACCOUNT_EXPORT',
    sourceAuthenticityVerified:false,privateMediaIncluded:false,
    completeAccountExport:false,deletionAllowed:false
  };
}


/**
 * B09: Convert one already-verified bounded partial account JSON export into a
 * human-inspectable offline ZIP. Media is stored separately under content-hash
 * filenames, rather than repeating base64 in the records. Unlike a complete
 * archive, this is limited by the existing 10 MiB safe ZIP writer and may fail
 * for owners whose verified partial export exceeds that budget. Never silently
 * truncate or claim that unexported provider/account data is present.
 *
 * This is USER-OWNED PRIVATE DATA, not an artifact suitable for public hosting.
 * A local digest proves only internal consistency, NOT Supabase authenticity,
 * backup erasure, current server state or permission to delete the account.
 */
export interface BoundedPrivateAccountRecoveryBundle {
  filename:'kadmeion-private-account-partial.zip'|'kadmeion-private-account-partial-v2.zip';
  zip:Uint8Array;
  sha256:string;
  originalExportSha256:string;
  status:'BOUNDED_PARTIAL_ACCOUNT_BUNDLE';
  assetFiles:number;
  assetsReferenced:number;
  privateData:true;
  completeAccountExport:false;
  providerAuthenticityVerified:false;
  deletionAllowed:false;
}
export async function createBoundedPrivateAccountRecoveryBundle(
  exportBytes:Uint8Array
):Promise<BoundedPrivateAccountRecoveryBundle>{
  const verified=await verifyBoundedPrivateAccountExport(exportBytes);
  const isV2=verified.schemaVersion===2;
  // The verification above checks all embedded bytes and scoped owner records.
  let raw:JsonObject;
  try{raw=JSON.parse(decoder.decode(exportBytes)) as JsonObject;}
  catch{throw new PrivateAccountExportError('INTEGRITY','Unreadable partial export.');}
  requireCondition(Array.isArray(raw.assets),'INTEGRITY','Missing private media entries.');
  const parts:{name:string;bytes:Uint8Array}[]=[];
  const stripped:JsonObject[]=[];
  const files=new Map<string,{sha256:string;byteLength:number}>();
  const references:JsonObject[]=[];
  const suffix:Record<string,string>={
    'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/avif':'avif'
  };
  for(const item of raw.assets as unknown[]){
    requireCondition(object(item),'INTEGRITY','Invalid private media entry.');
    const mediaType=item.mimeType as string;
    const digest=item.expectedSha256 as string;
    const name='assets/'+digest+'.'+suffix[mediaType];
    requireCondition(/^[a-z0-9/.-]{1,160}$/.test(name)&&!name.includes('..'),
      'INTEGRITY','Unsafe portable media filename.');
    let media:Uint8Array;
    try{
      const binary=atob(item.base64 as string);
      media=Uint8Array.from(binary,ch=>ch.charCodeAt(0));
    }catch{
      throw new PrivateAccountExportError('INTEGRITY','Invalid portable media encoding.');
    }
    requireCondition(media.length===item.byteSize&&await sha256(media)===digest,
      'INTEGRITY','Private media bytes differ from the verified content pin.');
    if(!files.has(name)){
      parts.push({name,bytes:media});
      files.set(name,{sha256:digest,byteLength:media.byteLength});
    }
    const {base64:discarded,...metadata}=item;
    // The field points at the extracted file; never discard the original
    // object identity or Storage version documented in metadata.
    stripped.push({...metadata,archivePath:name});
    references.push({
      originalPath:item.path as string,archivePath:name,sha256:digest,
      ...(isV2?{scope:item.scope,assetId:item.assetId,projectId:item.projectId}:{})
    });
    void discarded;
  }
  const records={
    ...raw,kind:'kadmeion-bounded-account-bundle-records',
    assets:stripped
  };
  const recordsBytes=encoder.encode(JSON.stringify(records));
  const manifest={
    kind:'kadmeion-private-account-recovery-bundle',formatVersion:isV2?2:1,
    ...(isV2?{schemaVersion:2,requestId:verified.requestId}:{}),
    privateData:true,completeAccountExport:false,
    providerAuthenticityVerified:false,deletionAllowed:false,
    sourceExportSha256:verified.sha256,ownerId:verified.ownerId,
    inventorySnapshotId:verified.inventorySnapshotId,
    recordsPath:'account/records.json',
    recordsSha256:await sha256(recordsBytes),
    files:[...files.entries()].map(([path,info])=>({path,...info})),
    assetReferences:references
  };
  const warning=encoder.encode(
    'KADMEION PRIVATE PARTIAL ACCOUNT RECOVERY\n'+
    'This ZIP contains personally identifying information and private project data.\n'+
    'It is a bounded backup, NOT a full account/provider export or erasure receipt.\n'+
    'Assets are stored in assets/ and referenced from account/records.json.\n'+
    'No server or sender authenticity, current-state or retention guarantees apply.\n'+
    'Keep this archive private. Never publish its contents as a website.\n');
  const {writeStoredZip}=await import('./portable-source-archive.ts');
  let zip:Uint8Array;
  try{
    zip=writeStoredZip([
      {name:'account/records.json',bytes:recordsBytes},
      ...parts,
      {name:'kadmeion-partial-bundle.json',bytes:encoder.encode(JSON.stringify(manifest))},
      {name:'README.txt',bytes:warning}
    ],{maxEntries:12,maxBytes:10*1024*1024,maxEntryBytes:5*1024*1024});
  }catch{
    throw new PrivateAccountExportError('LIMIT_EXCEEDED',
      'The verified partial export exceeds the safe offline ZIP capacity. Keep the original JSON instead.');
  }
  return {
    filename:isV2?'kadmeion-private-account-partial-v2.zip':'kadmeion-private-account-partial.zip',zip,
    sha256:await sha256(zip),originalExportSha256:verified.sha256,
    status:'BOUNDED_PARTIAL_ACCOUNT_BUNDLE',
    assetFiles:files.size,assetsReferenced:references.length,
    privateData:true,completeAccountExport:false,
    providerAuthenticityVerified:false,deletionAllowed:false
  };
}


/**
 * Reconstruct the original bounded private-account JSON from an inspected
 * recovery ZIP. This works offline and never confers a provider-authenticated
 * identity. It rejects any extra/archive-only file, checksum drift, media
 * path substitution, untruthful completeness flags or broken owner scope.
 */
export async function restoreBoundedPrivateAccountJsonFromRecoveryBundle(
  bundle:Uint8Array
):Promise<{bytes:Uint8Array;sha256:string;status:'VERIFIED_OFFLINE_PARTIAL_RECOVERY';
  providerAuthenticityVerified:false;completeAccountExport:false;
  deletionAllowed:false}>{
  const {readStrictStoredZip}=await import('./portable-source-archive.ts');
  let archive:Map<string,Uint8Array>;
  try{
    archive=readStrictStoredZip(bundle,{
      maxEntries:12,maxBytes:10*1024*1024,maxEntryBytes:5*1024*1024
    });
  }catch{
    throw new PrivateAccountExportError('INTEGRITY','Malformed or oversized private recovery ZIP.');
  }
  const recordsBytes=archive.get('account/records.json'),
    manifestBytes=archive.get('kadmeion-partial-bundle.json'),
    readme=archive.get('README.txt');
  requireCondition(recordsBytes&&manifestBytes&&readme&&
    new TextDecoder().decode(readme).startsWith('KADMEION PRIVATE PARTIAL'),
    'INTEGRITY','The recovery archive is incomplete.');
  let records:unknown,manifest:unknown;
  try{
    records=JSON.parse(decoder.decode(recordsBytes));
    manifest=JSON.parse(decoder.decode(manifestBytes));
  }catch{throw new PrivateAccountExportError('INTEGRITY','Invalid private recovery metadata.');}
  requireCondition(object(records)&&object(manifest)&&
    manifest.kind==='kadmeion-private-account-recovery-bundle'&&
    (manifest.formatVersion===1||manifest.formatVersion===2)&&
    manifest.privateData===true&&manifest.completeAccountExport===false&&
    manifest.providerAuthenticityVerified===false&&
    manifest.deletionAllowed===false&&
    isUuid(manifest.ownerId)&&isUuid(manifest.inventorySnapshotId)&&
    manifest.recordsPath==='account/records.json'&&
    typeof manifest.recordsSha256==='string'&&
    manifest.recordsSha256===await sha256(recordsBytes)&&
    typeof manifest.sourceExportSha256==='string'&&
    /^[0-9a-f]{64}$/.test(manifest.sourceExportSha256)&&
    records.kind==='kadmeion-bounded-account-bundle-records'&&
    Array.isArray(records.assets)&&records.assets.length<=MAX_ASSETS&&
    Array.isArray(manifest.files)&&
    Array.isArray(manifest.assetReferences)&&
    manifest.assetReferences.length===records.assets.length,
    'INTEGRITY','Invalid private recovery metadata or completeness claims.');
  const isV2=manifest.formatVersion===2;
  requireCondition(isV2?(
    exactFields(manifest,['kind','formatVersion','schemaVersion','requestId','privateData','completeAccountExport',
      'providerAuthenticityVerified','deletionAllowed','sourceExportSha256','ownerId','inventorySnapshotId','recordsPath',
      'recordsSha256','files','assetReferences'])&&manifest.schemaVersion===2&&records.schemaVersion===2&&
    (manifest.requestId===null||isUuid(manifest.requestId))&&manifest.requestId===records.requestId
  ):(records.schemaVersion===1&&!Object.hasOwn(manifest,'schemaVersion')&&!Object.hasOwn(manifest,'requestId')),
    'INTEGRITY','Recovery manifest version or request scope does not match its records.');
  const suffix:Record<string,string>={
    'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/avif':'avif'
  };
  const actualFiles=new Map<string,{sha256:string;byteLength:number}>();
  const embedded:JsonObject[]=[];
  for(let i=0;i<records.assets.length;i++){
    const entry:unknown=records.assets[i];
    const ref:unknown=manifest.assetReferences[i];
    requireCondition(object(entry)&&object(ref)&&
      typeof entry.expectedSha256==='string'&&
      /^[0-9a-f]{64}$/.test(entry.expectedSha256)&&
      typeof entry.mimeType==='string'&&
      typeof entry.path==='string'&&
      typeof entry.archivePath==='string'&&
      entry.archivePath==='assets/'+entry.expectedSha256+'.'+suffix[entry.mimeType]&&
      ref.archivePath===entry.archivePath&&
      ref.sha256===entry.expectedSha256&&
      ref.originalPath===entry.path&&
      (isV2?exactFields(ref,['originalPath','archivePath','sha256','scope','assetId','projectId'])&&
        ref.scope===entry.scope&&ref.assetId===entry.assetId&&ref.projectId===entry.projectId:
        exactFields(ref,['originalPath','archivePath','sha256']))&&
      !Object.hasOwn(entry,'base64'),
      'INTEGRITY','Private recovery media reference is ambiguous.');
    const blob=archive.get(entry.archivePath as string);
    requireCondition(blob!==undefined&&blob.byteLength===entry.byteSize&&
      await sha256(blob)===entry.expectedSha256,
      'INTEGRITY','Private recovery media bytes failed digest verification.');
    actualFiles.set(entry.archivePath as string,{
      sha256:entry.expectedSha256 as string,byteLength:blob.byteLength
    });
    const {archivePath:unused,...rest}=entry;
    void unused;
    // Original account exporter writes base64 as the final media field,
    // so reconstructing with it at the end preserves JSON source order.
    embedded.push({...rest,base64:base64(blob)});
  }
  requireCondition(manifest.files.length===actualFiles.size&&
    archive.size===actualFiles.size+3,
    'INTEGRITY','Recovery archive has unexpected, omitted or duplicate files.');
  const manifestPaths=new Set<string>();
  for(const f of manifest.files){
    requireCondition(object(f)&&Object.keys(f).sort().join(',')===
      'byteLength,path,sha256'&&typeof f.path==='string'&&
      actualFiles.has(f.path)&&!manifestPaths.has(f.path)&&
      f.sha256===actualFiles.get(f.path)?.sha256&&
      f.byteLength===actualFiles.get(f.path)?.byteLength,
      'INTEGRITY','Recovery manifest differs from stored media.');
    manifestPaths.add(f.path);
  }
  const restored={
    ...records,kind:'kadmeion-bounded-private-account-export',
    assets:embedded
  };
  const bytes=encoder.encode(JSON.stringify(restored));
  const inspection=await verifyBoundedPrivateAccountExport(bytes);
  requireCondition(inspection.sha256===manifest.sourceExportSha256&&
    inspection.ownerId===manifest.ownerId&&
    inspection.inventorySnapshotId===manifest.inventorySnapshotId&&
    (isV2?(inspection.schemaVersion===2&&inspection.requestId===manifest.requestId):inspection.schemaVersion===undefined),
    'INTEGRITY','Reconstructed export does not match its original digest.');
  return {
    bytes,sha256:inspection.sha256,
    status:'VERIFIED_OFFLINE_PARTIAL_RECOVERY',
    providerAuthenticityVerified:false,completeAccountExport:false,
    deletionAllowed:false
  };
}

