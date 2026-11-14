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
  ['private_release_requests','owner_user_id'],['private_trash_items','owner_user_id']
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
  if(length!==null){
    const n=Number(length);
    requireCondition(Number.isSafeInteger(n)&&n>=0&&n<=max,'LIMIT_EXCEEDED',
      'Provider response exceeds export limits.');
  }
  requireCondition(response.body!==null,'PROVIDER_UNAVAILABLE','Missing provider response body.');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];
  let total=0;
  try {
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      requireCondition(total<=max,'LIMIT_EXCEEDED','Provider response exceeds export limits.');
      parts.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  if(length!==null)requireCondition(total===Number(length),'INTEGRITY',
    'Provider response length changed.');
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
        credentials:'omit',cache:'no-store',redirect:'error'
      });
    }catch{throw new PrivateAccountExportError('PROVIDER_UNAVAILABLE','Private export source unavailable.');}
    if(!response.ok)throw new PrivateAccountExportError(
      response.status===401||response.status===403?'AUTH_EXPIRED':'PROVIDER_UNAVAILABLE',
      'Private export read was denied or unavailable.');
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
   * NOT immutable versioned download or an expected provider content hash.
   * Private object GETs are not version-addressable in this API.
   */
  private async objectInfo(path:string,ownerId:string,mime:string,size:number):
    Promise<{id:string;version:string;updatedAt:string}> {
    const objectPath=path.split('/').map(encodeURIComponent).join('/');
    const raw=await this.json('/storage/v1/object/info/authenticated/kadmeion-private-assets/'+
      objectPath,65536);
    requireCondition(object(raw)&&isUuid(raw.id)&&
      raw.name===path&&raw.bucket_id==='kadmeion-private-assets'&&
      raw.owner_id===ownerId&&typeof raw.version==='string'&&
      raw.version.length>0&&raw.version.length<=128&&
      typeof raw.updated_at==='string'&&
      !Number.isNaN(Date.parse(raw.updated_at))&&object(raw.metadata)&&
      Number.isSafeInteger(Number(raw.metadata.size))&&Number(raw.metadata.size)===size&&
      typeof raw.metadata.mimetype==='string'&&
      raw.metadata.mimetype.toLowerCase()===mime,
      'INTEGRITY','Storage object identity or version is missing or mismatched.');
    return {id:raw.id as string,version:raw.version as string,
      updatedAt:raw.updated_at as string};
  }
  private async rows(table:typeof TABLES[number][0],column:string,ownerId:string):
    Promise<JsonObject[]> {
    const raw=await this.json('/rest/v1/'+table+'?select=*&'+column+'=eq.'+
      encodeURIComponent(ownerId)+'&limit=101',MAX_TABLE_BYTES);
    requireCondition(Array.isArray(raw),'INTEGRITY','Invalid private table response.');
    requireCondition(raw.length<=MAX_ROWS,'LIMIT_EXCEEDED','Owner records exceed bounded export limit.');
    for(const row of raw)
      requireCondition(object(row)&&row[column]===ownerId,'INTEGRITY',
        'Export source returned a foreign or malformed owner record.');
    return raw as JsonObject[];
  }
  /** Returns JSON bytes for a user-triggered local Blob download. Never uploads them. */
  async export(snapshotId:string):Promise<PrivateAccountExportArtifact> {
    requireCondition(isUuid(snapshotId),'VALIDATION','Valid owner inventory snapshot ID required.');
    const owner=await this.owner();
    const before=await this.reconcile(snapshotId);
    const records:Record<string,JsonObject[]>={};
    for(const [table,column] of TABLES)records[table]=await this.rows(table,column,owner.id);
    const assets=records.project_assets;
    requireCondition(assets.length===before,'UNVERIFIED','Asset inventory changed during export.');
    requireCondition(assets.length<=MAX_ASSETS,'LIMIT_EXCEEDED','Too many assets for bounded byte export.');
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
      pins.set(path,await this.objectInfo(path,owner.id,mime,size));
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
      verifiedAssets.push({path,mimeType:mime,byteSize:size,
        storageObjectId:pin.id,storageVersionAtRead:pin.version,
        downloadedSha256:await sha256(response.bytes),base64:base64(response.bytes)});
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
    const finalOwner=await this.owner();
    requireCondition(finalOwner.id===owner.id,'AUTH_EXPIRED','Owner session changed during export.');
    const envelope={
      kind:'kadmeion-bounded-private-account-export',schemaVersion:1,
      exportedAt:new Date().toISOString(),owner:{id:owner.id,email:owner.email},
      inventorySnapshotId:snapshotId,records,assets:verifiedAssets,
      evidence:{registeredAssets:before,downloadedAssets:verifiedAssets.length,
        downloadedByteCount:total,downloadedByteHashes:'SHA-256',
        providerExpectedHashesVerified:false,providerObjectVersionPinned:false,
        storageObjectVersionCheckedBeforeAndAfter:true,
        crossTableAtomicSnapshot:false,storageReconciliationBeforeAndAfter:true},
      limitations:{completeAccountExport:false,
        omittedCategories:['case-study revision history','reviewer grants',
          'moderation and appeals','account erasure history',
          'inventory snapshots','provider integrations and backups'],
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
