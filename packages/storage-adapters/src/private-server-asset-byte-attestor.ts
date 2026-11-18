/**
 * Trusted B5 server-only asset byte attestor. Import this module ONLY from a
 * private worker/Edge runtime with a protected service-role credential.
 * Never bundle it into the browser or expose a user-callable attestation API.
 * The digest is computed from bytes read with the owner's JWT; callers cannot
 * supply their own hash. No public delivery or account erasure is enabled.
 */
import {createHash} from 'node:crypto';
import {isSafeSupabaseClientKey} from '../../contracts/src/project.ts';
import type {TrustedPrivateMediaReader} from './private-immutable-artifact.ts';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME=new Set(['image/png','image/jpeg','image/webp','image/avif']);
const MAX_BYTES=5*1024*1024;
/**
 * Reject disguised executable/HTML objects before giving any server-attested
 * hash. Signature inspection is an ingestion guard, not full image decoding
 * or malware scanning; a safe media re-encode remains a publication gate.
 */
function plausibleRaster(mime:string, bytes:Uint8Array):boolean {
  if(mime==='image/png')return bytes.length>=8&&
    [137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value);
  if(mime==='image/jpeg')return bytes.length>=3&&
    bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
  if(mime==='image/webp')return bytes.length>=12&&
    String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&
    String.fromCharCode(...bytes.subarray(8,12))==='WEBP';
  if(mime==='image/avif')return bytes.length>=16&&
    String.fromCharCode(...bytes.subarray(4,8))==='ftyp'&&
    ['avif','avis'].includes(String.fromCharCode(...bytes.subarray(8,12)));
  return false;
}
type Json=Record<string,unknown>;
const obj=(x:unknown):x is Json=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export class PrivateAssetAttestationError extends Error {
  readonly code:'VALIDATION'|'AUTH'|'INTEGRITY'|'PROVIDER'|'LIMIT';
  constructor(code:PrivateAssetAttestationError['code']) {
    super('Private asset attestation failed: '+code);
    this.name='PrivateAssetAttestationError';this.code=code;
  }
}
function requireValid(v:unknown,code:PrivateAssetAttestationError['code']):
  asserts v {if(!v)throw new PrivateAssetAttestationError(code);}
const ATTEST_TIMEOUT_MS=10_000;
const MAX_STREAM_CHUNKS=65_536;
function cancelAttestationBody(body:{cancel:()=>Promise<void>}|null|undefined):void {
  try{void body?.cancel().catch(()=>{});}catch{}
}
async function bytes(response:Response,signal:AbortSignal):Promise<Uint8Array> {
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  const stop=()=>cancelAttestationBody(reader??response.body);
  signal.addEventListener('abort',stop,{once:true});
  let completed=false;
  try{
    requireValid(!signal.aborted,'PROVIDER');
    const declared=response.headers.get('content-length');
    if(declared!==null)requireValid(/^\d+$/.test(declared)&&Number(declared)<=MAX_BYTES,'LIMIT');
    requireValid(response.body!==null,'PROVIDER');
    reader=response.body.getReader();
    const chunks:Uint8Array[]=[];
    let size=0,count=0;
    for(;;){
      const part=await reader.read();
      requireValid(!signal.aborted,'PROVIDER');
      if(part.done)break;
      requireValid(part.value instanceof Uint8Array,'INTEGRITY');
      requireValid(++count<=MAX_STREAM_CHUNKS,'LIMIT');
      size+=part.value.byteLength;
      requireValid(size<=MAX_BYTES,'LIMIT');
      chunks.push(part.value);
    }
    completed=true;
    requireValid(declared===null||Number(declared)===size,'INTEGRITY');
    const result=new Uint8Array(size);let i=0;
    for(const chunk of chunks){result.set(chunk,i);i+=chunk.length;}
    return result;
  }catch(error){
    if(error instanceof PrivateAssetAttestationError)throw error;
    throw new PrivateAssetAttestationError('PROVIDER');
  }finally{
    signal.removeEventListener('abort',stop);
    if(!completed)stop();
    try{reader?.releaseLock();}catch{}
  }
}
export class PrivateServerAssetByteAttestor {
  private readonly origin:string;
  private readonly publishableKey:string;
  private readonly serviceKey:string;
  private readonly http:typeof fetch;
  constructor(endpoint:string,publishableKey:string,serviceKey:string,http:typeof fetch=fetch){
    let url:URL;
    try{url=new URL(endpoint);}catch{throw new PrivateAssetAttestationError('VALIDATION');}
    const localRuntime=(globalThis as unknown as {
      Deno?:{env?:{get:(name:string)=>string|undefined}}
    }).Deno?.env?.get('KADMEION_LOCAL_INTEGRATION')==='1';
    requireValid((url.protocol==='https:'||
      (url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))||
      (url.origin==='http://kong:8000'&&localRuntime))&&
      url.pathname==='/'&&!url.username&&!url.password&&!url.search&&!url.hash,
      'VALIDATION');
    requireValid(isSafeSupabaseClientKey(publishableKey)&&
      typeof serviceKey==='string'&&serviceKey.length>0&&
      publishableKey!==serviceKey,'VALIDATION');
    this.origin=url.origin;this.publishableKey=publishableKey;
    this.serviceKey=serviceKey;this.http=http;
  }
  private async get(path:string,jwt:string,privileged=false,body?:Json):
    Promise<{data:unknown;headers:Headers;raw?:Uint8Array}> {
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined;
    const deadline=new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>{
        reject(new PrivateAssetAttestationError('PROVIDER'));
        controller.abort();
      },ATTEST_TIMEOUT_MS);
    });
    try{
      const attempt=(async()=>{
        const response=await this.http(this.origin+path,{
          method:body===undefined?'GET':'POST',
          headers:{apikey:privileged?this.serviceKey:this.publishableKey,
            Authorization:'Bearer '+(privileged?this.serviceKey:jwt),
            Accept:body===undefined?'*/*':'application/json',
            ...(body===undefined?{}:{'Content-Type':'application/json'})},
          body:body===undefined?undefined:JSON.stringify(body),
          credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal
        });
        if(controller.signal.aborted){
          cancelAttestationBody(response.body);
          throw new PrivateAssetAttestationError('PROVIDER');
        }
        if(!response.ok||response.redirected){
          cancelAttestationBody(response.body);
          throw new PrivateAssetAttestationError(
            response.status===401||response.status===403?'AUTH':'PROVIDER');
        }
        const content=await bytes(response,controller.signal);
        if(path.startsWith('/storage/v1/object/authenticated/'))
          return {data:null,headers:response.headers,raw:content};
        try{return {data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(content)),
          headers:response.headers};}
        catch{throw new PrivateAssetAttestationError('INTEGRITY');}
      })();
      return await Promise.race([attempt,deadline]);
    }catch(error){
      if(error instanceof PrivateAssetAttestationError)throw error;
      throw new PrivateAssetAttestationError('PROVIDER');
    }finally{clearTimeout(timer);controller.abort();}
  }
  private async info(path:string,jwt:string,ownerId:string,mime:string,size:number){
    const encoded=path.split('/').map(encodeURIComponent).join('/');
    const {data}=await this.get('/storage/v1/object/info/authenticated/kadmeion-private-assets/'+encoded,jwt);
    const m=obj(data)?data.metadata:null;
    const actualSize=obj(data)?(data.size??(obj(m)?m.size:null)):null;
    const actualMime=obj(data)?(data.content_type??(obj(m)?m.mimetype:null)):null;
    const modified=obj(data)?(data.last_modified??data.updated_at):null;
    requireValid(obj(data)&&typeof data.id==='string'&&UUID.test(data.id)&&
      data.name===path&&data.bucket_id==='kadmeion-private-assets'&&
      (data.owner_id===undefined||data.owner_id===ownerId)&&
      typeof data.version==='string'&&data.version.length>0&&data.version.length<=128&&
      typeof modified==='string'&&!Number.isNaN(Date.parse(modified))&&
      Number.isSafeInteger(Number(actualSize))&&Number(actualSize)===size&&
      typeof actualMime==='string'&&actualMime.toLowerCase()===mime,'INTEGRITY');
    return {id:data.id as string,version:data.version as string,modified:modified as string};
  }
  private async attestedBytes(assetId:string,ownerJwt:string):
    Promise<{assetId:string;ownerId:string;hash:string;mime:string;
      version:string;bytes:Uint8Array}> {
    requireValid(UUID.test(assetId)&&typeof ownerJwt==='string'&&ownerJwt.length>0,'VALIDATION');
    const {data:user}=await this.get('/auth/v1/user',ownerJwt);
    requireValid(obj(user)&&typeof user.id==='string'&&UUID.test(user.id)&&user.is_anonymous!==true,'AUTH');
    const ownerId=user.id;
    const {data:rows}=await this.get('/rest/v1/project_assets?select=id,owner_user_id,object_path,mime_type,byte_size&id=eq.'+
      encodeURIComponent(assetId)+'&limit=2',ownerJwt);
    requireValid(Array.isArray(rows)&&rows.length===1&&obj(rows[0]),'AUTH');
    const asset=rows[0] as Json;
    const path=asset.object_path,mime=asset.mime_type,size=asset.byte_size;
    requireValid(asset.id===assetId&&asset.owner_user_id===ownerId&&
      typeof path==='string'&&
      new RegExp('^'+ownerId+'/[A-Za-z0-9_-]{1,64}/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$').test(path)&&
      typeof mime==='string'&&MIME.has(mime)&&
      typeof size==='number'&&Number.isSafeInteger(size)&&size>0&&size<=MAX_BYTES,'INTEGRITY');
    const before=await this.info(path,ownerJwt,ownerId,mime,size);
    const encoded=path.split('/').map(encodeURIComponent).join('/');
    const response=await this.get('/storage/v1/object/authenticated/kadmeion-private-assets/'+
      encoded,ownerJwt);
    const contentType=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
    requireValid(response.raw?.length===size&&contentType===mime&&
      plausibleRaster(mime,response.raw),'INTEGRITY');
    const hash=createHash('sha256').update(response.raw).digest('hex');
    const after=await this.info(path,ownerJwt,ownerId,mime,size);
    requireValid(before.id===after.id&&before.version===after.version&&
      before.modified===after.modified,'INTEGRITY');
    // Only now may the server credential be used. The SQL RPC independently
    // checks registered asset, Storage object/version, owner and write-once pin.
    const {data:receipt}=await this.get('/rest/v1/rpc/record_private_asset_content_attestation',
      ownerJwt,true,{p_asset_id:assetId,p_storage_object_id:before.id,
        p_storage_version:before.version,p_expected_sha256:hash});
    requireValid(obj(receipt)&&receipt.assetId===assetId&&
      receipt.status==='WRITE_ONCE_ATTESTED'&&receipt.providerSigned===false&&
      receipt.deletionAllowed===false,'INTEGRITY');
    return {assetId,ownerId,hash,mime,version:before.version,
      bytes:Uint8Array.from(response.raw)};
  }

  /** PROFILE assets are independently scoped. No fallback to PROJECT, even
   * when the same UUID exists in both registries. A live owner pin read
   * authorizes the exact registered object/version before privileged writes. */
  async attestProfile(assetId:string,ownerJwt:string):Promise<{
    assetId:string;status:'WRITE_ONCE_ATTESTED'
  }>{
    requireValid(typeof assetId==='string'&&UUID.test(assetId)&&typeof ownerJwt==='string'&&ownerJwt.length>0,'VALIDATION');
    const {data:user}=await this.get('/auth/v1/user',ownerJwt);
    requireValid(obj(user)&&typeof user.id==='string'&&UUID.test(user.id)&&user.is_anonymous!==true,'AUTH');
    const ownerId=user.id;
    const {data:rows}=await this.get('/rest/v1/profile_assets?select=id,owner_user_id,operation_id,object_path,mime_type,byte_size,state,storage_object_id,storage_version&id=eq.'+
      encodeURIComponent(assetId)+'&limit=2',ownerJwt);
    requireValid(Array.isArray(rows)&&rows.length===1&&obj(rows[0]),'AUTH');
    const a=rows[0] as Json;
    const path=a.object_path,mime=a.mime_type,size=a.byte_size,objectId=a.storage_object_id,version=a.storage_version;
    requireValid(a.id===assetId&&a.owner_user_id===ownerId&&a.state==='REGISTERED'&&
      typeof a.operation_id==='string'&&UUID.test(a.operation_id)&&
      typeof path==='string'&&path===ownerId+'/profile/'+a.operation_id+'.img'&&
      typeof mime==='string'&&['image/png','image/jpeg','image/webp'].includes(mime)&&
      typeof size==='number'&&Number.isSafeInteger(size)&&size>=12&&size<=MAX_BYTES&&
      typeof objectId==='string'&&UUID.test(objectId)&&typeof version==='string'&&version.length>0&&version.length<=128,'INTEGRITY');
    const readPin=async()=>{
      const {data:p}=await this.get('/rest/v1/rpc/read_owner_private_asset_pin',ownerJwt,false,
        {p_scope:'PROFILE',p_asset_id:assetId,p_project_id:null});
      requireValid(obj(p)&&p.scope==='PROFILE'&&p.assetId===assetId&&p.ownerUserId===ownerId&&p.projectId===null&&
        p.objectId===objectId&&p.version===version&&p.mimeType===mime&&p.byteSize===size&&
        ((p.status==='UNPINNED'&&p.expectedSha256===null)||
         (p.status==='SERVER_HASH_PINNED'&&typeof p.expectedSha256==='string'&&/^[0-9a-f]{64}$/.test(p.expectedSha256))),'INTEGRITY');
      return p;
    };
    const pin=await readPin();
    const before=await this.info(path,ownerJwt,ownerId,mime,size);
    requireValid(before.id===objectId&&before.version===version,'INTEGRITY');
    const response=await this.get('/storage/v1/object/authenticated/kadmeion-private-assets/'+
      path.split('/').map(encodeURIComponent).join('/'),ownerJwt);
    requireValid(response.raw?.length===size&&
      (response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase()===mime&&
      plausibleRaster(mime,response.raw),'INTEGRITY');
    const hash=createHash('sha256').update(response.raw).digest('hex');
    const after=await this.info(path,ownerJwt,ownerId,mime,size);
    requireValid(before.id===after.id&&before.version===after.version&&before.modified===after.modified,'INTEGRITY');
    // Re-read the live-session gated owner pin after bytes; a concurrent
    // identical successful pin is idempotent, a different digest is denied.
    const current=await readPin();
    requireValid((pin.expectedSha256===null||pin.expectedSha256===hash)&&
      (current.expectedSha256===null||current.expectedSha256===hash),'INTEGRITY');
    if(current.status==='UNPINNED'){
      const {data:receipt}=await this.get('/rest/v1/rpc/record_private_profile_asset_content_attestation',
        ownerJwt,true,{p_asset_id:assetId,p_owner_user_id:ownerId,p_storage_object_id:objectId,
          p_storage_version:version,p_expected_sha256:hash});
      requireValid(obj(receipt)&&Object.keys(receipt).length===5&&receipt.assetId===assetId&&
        receipt.scope==='PROFILE'&&receipt.status==='WRITE_ONCE_ATTESTED'&&
        receipt.providerSigned===false&&receipt.deletionAllowed===false,'INTEGRITY');
    }
    const confirmed=await readPin();
    requireValid(confirmed.status==='SERVER_HASH_PINNED'&&confirmed.expectedSha256===hash,'INTEGRITY');
    return {assetId,status:'WRITE_ONCE_ATTESTED'};
  }

  async attest(assetId:string,ownerJwt:string):Promise<{
    assetId:string;status:'WRITE_ONCE_ATTESTED'
  }>{
    const pinned=await this.attestedBytes(assetId,ownerJwt);
    return {assetId:pinned.assetId,status:'WRITE_ONCE_ATTESTED'};
  }

  /**
   * The caller MUST use the same owner JWT for the trusted frozen loader and
   * this private reader. Owner RLS is checked on both portfolio and asset.
   * A server-owned media plan must authorize the asset's inclusion in the
   * selected frozen revision; owning another asset is not publication consent.
   */
  forTrustedFrozenMedia(ownerJwt:string):TrustedPrivateMediaReader {
    requireValid(typeof ownerJwt==='string'&&ownerJwt.length>0,'VALIDATION');
    return {
      readFrozenPinnedImage:async query=>{
        requireValid(!!query&&typeof query==='object'&&
          UUID.test(query.assetId)&&UUID.test(query.portfolioId)&&
          Number.isSafeInteger(query.revision)&&query.revision>=1,'VALIDATION');
        const {data:user}=await this.get('/auth/v1/user',ownerJwt);
        requireValid(obj(user)&&typeof user.id==='string'&&UUID.test(user.id)&&user.is_anonymous!==true,'AUTH');
        // Check target portfolio ownership BEFORE any privileged attestation.
        const {data:portfolios}=await this.get(
          '/rest/v1/portfolios?select=id,owner_user_id&id=eq.'+
          encodeURIComponent(query.portfolioId)+'&limit=2',ownerJwt);
        requireValid(Array.isArray(portfolios)&&portfolios.length===1&&
          obj(portfolios[0])&&portfolios[0].id===query.portfolioId&&
          portfolios[0].owner_user_id===user.id,'AUTH');
        const pinned=await this.attestedBytes(query.assetId,ownerJwt);
        requireValid(pinned.ownerId===user.id&&pinned.mime==='image/png','INTEGRITY');
        return {assetId:pinned.assetId,portfolioId:query.portfolioId,
          revision:query.revision,sourceSha256:pinned.hash,
          mimeType:'image/png' as const,storageVersion:pinned.version,
          bytes:pinned.bytes};
      }
    };
  }
}
