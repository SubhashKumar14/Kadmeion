import { isSafeSupabaseClientKey } from '../../contracts/src/project.ts';
/**
 * B5 bounded, read-only owner data export. This is deliberately NOT a complete
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
  ['private_notification_preferences','owner_user_id']
] as const;
const MAX_ROWS=100,MAX_TABLE_BYTES=1024*1024,MAX_ASSETS=8;
const MAX_ASSET_BYTES=5*1024*1024,MAX_TOTAL_ASSET_BYTES=8*1024*1024;
const MAX_EXPORT_BYTES=16*1024*1024;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
type JsonObject=Record<string,unknown>;
const object=(v:unknown):v is JsonObject=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const isUuid=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v);
export class PrivateAccountExportError extends Error {
  readonly code:'VALIDATION'|'AUTH_EXPIRED'|'PROVIDER_UNAVAILABLE'|
    'INTEGRITY'|'LIMIT_EXCEEDED'|'UNVERIFIED';
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
function hex(bytes:Uint8Array):string {
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
async function sha256(bytes:Uint8Array):Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))));
}
function base64(bytes:Uint8Array):string {
  let binary='';
  for(let i=0;i<bytes.length;i+=8192)
    binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
}
async function boundedBytes(response:Response,max:number):Promise<Uint8Array> {
  const length=response.headers.get('content-length');
  requireCondition(response.body!==null,'PROVIDER_UNAVAILABLE','Missing provider response body.');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];
  let total=0;
  try {
    requireCondition(length===null||/^\d+$/.test(length),'INTEGRITY',
      'Invalid provider response length.');
    requireCondition(length===null||Number(length)<=max,'LIMIT_EXCEEDED',
      'Provider response exceeds export limits.');
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      requireCondition(total<=max,'LIMIT_EXCEEDED','Provider response exceeds export limits.');
      parts.push(value);
    }
  }catch(error){
    await reader.cancel().catch(()=>{});
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
    const jwt=await this.accessToken();
    requireCondition(typeof jwt==='string'&&jwt.length>0,'AUTH_EXPIRED','Sign in to export data.');
    let response:Response;
    try {
      response=await this.http(this.origin+path,{
        method:body===undefined?'GET':'POST',headers:{apikey:this.publishableKey,Authorization:'Bearer '+jwt,
          Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},
        body:body===undefined?undefined:JSON.stringify(body),
        credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15_000)
      });
    }catch{throw new PrivateAccountExportError('PROVIDER_UNAVAILABLE','Private export source unavailable.');}
    if(!response.ok){
      await response.body?.cancel().catch(()=>{});
      throw new PrivateAccountExportError(
        response.status===401||response.status===403?'AUTH_EXPIRED':'PROVIDER_UNAVAILABLE',
        'Private export read was denied or unavailable.');
    }
    return {bytes:await boundedBytes(response,max),headers:response.headers};
  }
  private async json(path:string,max:number,body?:Record<string,unknown>):Promise<unknown> {
    const {bytes}=await this.request(path,max,body);
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
    for(const name of categories)for(const entry of data[name] as unknown[]){
      requireCondition(object(entry)&&
        !Object.keys(entry).some(key=>[
          'token_sha256','rawToken','refresh_token','access_token',
          'initial_session_id','verified_session_id'
        ].includes(key)),'INTEGRITY','Restricted audit data contained forbidden credentials.');
    }
    return data;
  }
  private async rows(table:typeof TABLES[number][0],column:string,ownerId:string,projection='*'):
    Promise<JsonObject[]> {
    const raw=await this.json('/rest/v1/'+table+'?select='+projection+'&'+column+'=eq.'+
      encodeURIComponent(ownerId)+'&limit=101',MAX_TABLE_BYTES);
    requireCondition(Array.isArray(raw),'INTEGRITY','Invalid private table response.');
    requireCondition(raw.length<=MAX_ROWS,'LIMIT_EXCEEDED','Owner records exceed bounded export limit.');
    for(const row of raw)
      requireCondition(object(row)&&row[column]===ownerId,'INTEGRITY',
        'Export source returned a foreign or malformed owner record.');
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
    }
    for(const row of envelope.verifiedReleaseHistory){
      requireCondition(object(row)&&isUuid(row.intent_id)&&isUuid(row.portfolio_id)&&isUuid(row.request_id)&&
        typeof row.html_sha256==='string'&&/^[a-f0-9]{64}$/.test(row.html_sha256),
      'INTEGRITY','Invalid verified release history.');
    }
    for(const rows of Object.values(envelope.restrictedAudit)){
      requireCondition(Array.isArray(rows)&&rows.length<=MAX_ROWS&&
        rows.every(row=>object(row)&&!Object.keys(row).some(key=>
          /(?:session_id|access_token|refresh_token|token_sha256|rawToken)/i.test(key))),
      'INTEGRITY','Application metadata contains invalid restricted audit records.');
    }
    await sameSession();
    return {filename:'kadmeion-account-metadata.json',mime:'application/json',
      bytes:encoder.encode(JSON.stringify(envelope)),status:'APPLICATION_METADATA_SNAPSHOT',
      storageBytesIncluded:false,providerDataIncluded:false};
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
    for(const [table,column,projection] of TABLES)records[table]=await this.rows(table,column,owner.id,projection);
    const assets=records.project_assets;
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
      const actualMime=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
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
  tablesChecked:number;
  assetsChecked:number;
  assetBytesChecked:number;
  documentAuthenticityVerified:false;
  completeAccountExport:false;
  deletionAllowed:false;
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
  }
  const categories=['reviewerGrants','moderationCases','moderationEvents',
    'accountExitRequests','reauthChallenges','inventorySnapshots',
    'releasePointers','releaseEvents'];
  const audit=raw.restrictedAudit as JsonObject;
  requireCondition(Object.keys(audit).sort().join(',')===
    [...categories].sort().join(','),'INTEGRITY',
    'Private audit categories are missing or unexpected.');
  const credentials=new Set(['token_sha256','rawToken','refresh_token',
    'access_token','initial_session_id','verified_session_id']);
  for(const category of categories){
    const entries=audit[category];
    requireCondition(Array.isArray(entries)&&entries.length<=MAX_ROWS,
      'INTEGRITY','Partial audit category is invalid.');
    for(const entry of entries)
      requireCondition(object(entry)&&
        !Object.keys(entry).some(key=>credentials.has(key)),
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
  filename:'kadmeion-private-account-partial.zip';
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
  // The verification above checks all embedded bytes and scoped owner records.
  let raw:JsonObject;
  try{raw=JSON.parse(decoder.decode(exportBytes)) as JsonObject;}
  catch{throw new PrivateAccountExportError('INTEGRITY','Unreadable partial export.');}
  requireCondition(Array.isArray(raw.assets),'INTEGRITY','Missing private media entries.');
  const parts:{name:string;bytes:Uint8Array}[]=[];
  const stripped:JsonObject[]=[];
  const files=new Map<string,{sha256:string;byteLength:number}>();
  const references:{originalPath:string;archivePath:string;sha256:string}[]=[];
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
      originalPath:item.path as string,archivePath:name,sha256:digest
    });
    void discarded;
  }
  const records={
    ...raw,kind:'kadmeion-bounded-account-bundle-records',
    assets:stripped
  };
  const recordsBytes=encoder.encode(JSON.stringify(records));
  const manifest={
    kind:'kadmeion-private-account-recovery-bundle',formatVersion:1,
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
    filename:'kadmeion-private-account-partial.zip',zip,
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
    manifest.formatVersion===1&&
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
  for(const f of manifest.files){
    requireCondition(object(f)&&Object.keys(f).sort().join(',')===
      'byteLength,path,sha256'&&typeof f.path==='string'&&
      actualFiles.has(f.path)&&
      f.sha256===actualFiles.get(f.path)?.sha256&&
      f.byteLength===actualFiles.get(f.path)?.byteLength,
      'INTEGRITY','Recovery manifest differs from stored media.');
  }
  const restored={
    ...records,kind:'kadmeion-bounded-private-account-export',
    assets:embedded
  };
  const bytes=encoder.encode(JSON.stringify(restored));
  const inspection=await verifyBoundedPrivateAccountExport(bytes);
  requireCondition(inspection.sha256===manifest.sourceExportSha256&&
    inspection.ownerId===manifest.ownerId&&
    inspection.inventorySnapshotId===manifest.inventorySnapshotId,
    'INTEGRITY','Reconstructed export does not match its original digest.');
  return {
    bytes,sha256:inspection.sha256,
    status:'VERIFIED_OFFLINE_PARTIAL_RECOVERY',
    providerAuthenticityVerified:false,completeAccountExport:false,
    deletionAllowed:false
  };
}
