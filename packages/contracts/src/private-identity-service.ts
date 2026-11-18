import { normalizeHandle, isSafeSupabaseClientKey } from './project.ts';
import { normalizeIdentityDraft, type SharingPreferences } from './identity.ts';
import type { TokenSupplier } from './project-data-service.ts';

export interface CurrentIdentity {
  userId: string;
  emailVerified: boolean;
}

export type PrivatePlatformProvider =
  'GITHUB'|'LEETCODE'|'CODEFORCES'|'HACKERRANK'|'KAGGLE'|'HUGGING_FACE';
export interface PrivatePlatformLink {
  id:string;owner_user_id:string;provider:PrivatePlatformProvider;handle:string;
  profile_url:string;provenance:'USER_SUPPLIED';
  connection_mode:'LINK_ONLY';sync_status:'NOT_SYNCED';ownership_verified:false;
  created_at:string;updated_at:string;
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_ORIGINS:Readonly<Record<PrivatePlatformProvider,string>>={
  GITHUB:'https://github.com/',
  LEETCODE:'https://leetcode.com/u/',
  CODEFORCES:'https://codeforces.com/profile/',
  HACKERRANK:'https://www.hackerrank.com/profile/',
  KAGGLE:'https://www.kaggle.com/',
  HUGGING_FACE:'https://huggingface.co/'
};
const record=(x:unknown):x is Record<string,unknown> =>
  !!x&&typeof x==='object'&&!Array.isArray(x);
function providerKey(value:unknown):value is PrivatePlatformProvider {
  return typeof value==='string'&&Object.hasOwn(PROFILE_ORIGINS,value);
}
function platformHandle(provider:PrivatePlatformProvider,raw:unknown):string{
  if(typeof raw!=='string')throw new PrivateIdentityError('VALIDATION','Profile handle must be text.');
  const handle=raw.trim();
  const generic=/^[A-Za-z0-9_][A-Za-z0-9_.-]*[A-Za-z0-9_]$/;
  const compact=/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
  if(!handle||handle.length>64||
     (provider==='GITHUB'
       ?handle.length>39||!compact.test(handle)
       :provider==='HUGGING_FACE'
         ?!compact.test(handle)
         :!generic.test(handle)))
    throw new PrivateIdentityError('VALIDATION','Invalid platform profile handle.');
  return handle;
}
function verifiedPlatformLink(value:unknown,owner:string):value is PrivatePlatformLink{
  const expectedKeys=new Set(['connection_mode','created_at','handle','id',
    'owner_user_id','ownership_verified','profile_url','provenance','provider',
    'sync_status','updated_at']);
  if(!record(value)||Object.keys(value).length!==expectedKeys.size||
     Object.keys(value).some(key=>!expectedKeys.has(key))||
     typeof value.id!=='string'||!UUID.test(value.id)||
     value.owner_user_id!==owner||!providerKey(value.provider)||
     typeof value.handle!=='string'||value.provenance!=='USER_SUPPLIED'||
     value.connection_mode!=='LINK_ONLY'||value.sync_status!=='NOT_SYNCED'||
     value.ownership_verified!==false||
     typeof value.created_at!=='string'||Number.isNaN(Date.parse(value.created_at))||
     typeof value.updated_at!=='string'||Number.isNaN(Date.parse(value.updated_at)))
    return false;
  try{
    const expected=platformHandle(value.provider,value.handle);
    return value.handle===expected&&value.profile_url===PROFILE_ORIGINS[value.provider]+expected;
  }catch{return false;}
}


export interface ProfileSharingState {
  ownerUserId:string;
  version:number;
  preferences:SharingPreferences|null;
}
export interface ProfileSharingChange {
  expected:ProfileSharingState;
  desired:SharingPreferences;
  operationId:string;
}
export interface ProfileSharingReceipt extends ProfileSharingState {
  status:'APPLIED'|'REPLAYED'|'NO_CHANGE';
}
const M=Number.MAX_SAFE_INTEGER;
const sharingKeys=['shareDisplayName','shareHeadline','shareBio','publicationRequested'] as const;
const exact=(value:Record<string,unknown>,keys:readonly string[]) =>
  Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
function validSharing(value:unknown):value is SharingPreferences {
  return record(value)&&exact(value,sharingKeys)&&sharingKeys.every(key=>typeof value[key]==='boolean')&&
    (!value.publicationRequested||!!(value.shareDisplayName||value.shareHeadline||value.shareBio));
}
function sameSharing(a:SharingPreferences|null,b:SharingPreferences|null):boolean {
  return a===null||b===null?a===b:sharingKeys.every(key=>a[key]===b[key]);
}
function validSharingState(value:unknown,owner:string,receipt=false):value is ProfileSharingState {
  if(!record(value)||!exact(value,receipt?['ownerUserId','version','preferences','status']:['ownerUserId','version','preferences'])||
    value.ownerUserId!==owner||typeof value.version!=='number'||!Number.isSafeInteger(value.version)||value.version<0||
    (value.preferences!==null&&!validSharing(value.preferences)))return false;
  if(value.version===M&&value.preferences!==null&&value.preferences.publicationRequested)return false;
  return !receipt||value.status==='APPLIED'||value.status==='REPLAYED'||value.status==='NO_CHANGE';
}
async function readSharingJson(response:Response):Promise<unknown>{
  const reader=response.body?.getReader();
  if(!reader)throw new PrivateIdentityError('INVALID_ACK','Missing sharing response.');
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0,raw='';
  try{
    while(true){
      const next=await reader.read();
      if(next.done)break;
      bytes+=next.value.byteLength;
      if(bytes>16*1024)throw new Error('Response too large');
      raw+=decoder.decode(next.value,{stream:true});
    }
    raw+=decoder.decode();
    return JSON.parse(raw) as unknown;
  }catch{
    void reader.cancel().catch(()=>{});
    throw new PrivateIdentityError('INVALID_ACK','Sharing response could not be verified.');
  }finally{reader.releaseLock();}
}

export class PrivateIdentityError extends Error {
  readonly code: 'AUTH_EXPIRED'|'HANDLE_CONFLICT'|'PLATFORM_CONFLICT'|'VALIDATION'|'PROVIDER_UNAVAILABLE'|'CONFLICT'|'INVALID_ACK';
  constructor(code: PrivateIdentityError['code'], message: string) {
    super(message);
    this.code=code;
    this.name='PrivateIdentityError';
  }
}

export class SupabasePrivateIdentityService {
  private readonly baseUrl: string;
  private readonly publishableKey: string;
  private readonly tokenSupplier: TokenSupplier;
  private readonly fetcher: typeof fetch;

  constructor(baseUrl:string,publishableKey:string,tokenSupplier:TokenSupplier,fetcher:typeof fetch=fetch,
    private readonly sharingOwnerId?:string,private readonly isCurrentOwner?:()=>boolean) {
    const u=new URL(baseUrl);
    if ((u.protocol!=='https:' && !(u.protocol==='http:' &&
         ['localhost','127.0.0.1'].includes(u.hostname)))||
        u.username||u.password||u.pathname!=='/'||u.search||u.hash)
      throw new PrivateIdentityError('VALIDATION','Invalid Supabase API origin.');
    if (typeof publishableKey!=='string'||!publishableKey.trim())
      throw new PrivateIdentityError('VALIDATION','Publishable key is missing.');
    if(!isSafeSupabaseClientKey(publishableKey))
      throw new PrivateIdentityError('VALIDATION','A public Supabase API key is required.');
    this.baseUrl=u.origin;
    this.publishableKey=publishableKey;
    this.tokenSupplier=tokenSupplier;
    this.fetcher=fetcher;
  }

  private async request(path:string,method:string,body?:unknown,upsert=false):Promise<unknown> {
    const token=await this.tokenSupplier();
    if (!token) throw new PrivateIdentityError('AUTH_EXPIRED','Sign in first.');
    const headers:Record<string,string>={apikey:this.publishableKey,Authorization:'Bearer '+token};
    if (body!==undefined)headers['Content-Type']='application/json';
    if (method!=='GET')
      headers.Prefer=upsert?'resolution=merge-duplicates,return=representation':'return=representation';
    const result=await this.fetcher(this.baseUrl+path,{
      method,headers,body:body===undefined?undefined:JSON.stringify(body),
      credentials:'omit',cache:'no-store',redirect:'error',
      signal:AbortSignal.timeout(10000)
    });
    if (!result.ok) {
      if ([401,403].includes(result.status)) throw new PrivateIdentityError('AUTH_EXPIRED','Identity access denied.');
      if (result.status===409)
        throw new PrivateIdentityError(path.includes('/private_platform_links')?
          'PLATFORM_CONFLICT':'HANDLE_CONFLICT','The requested identity is already in use.');
      throw new PrivateIdentityError('PROVIDER_UNAVAILABLE','Identity change could not be saved.');
    }
    return result.status===204?null:result.json();
  }

  async verifiedCurrentUser():Promise<CurrentIdentity> {
    const user=await this.request('/auth/v1/user','GET') as {id?:string;email_confirmed_at?:string|null}|null;
    if (!user?.id || !/^[\da-f-]{36}$/i.test(user.id))
      throw new PrivateIdentityError('AUTH_EXPIRED','No verified user session.');
    return {userId:user.id,emailVerified:!!user.email_confirmed_at};
  }

  async claimHandle(candidate:unknown):Promise<{handle:string}> {
    const {userId}=await this.verifiedCurrentUser();
    const handle=normalizeHandle(candidate);
    const rows=await this.request('/rest/v1/profiles?user_id=eq.'+userId,'PATCH',{handle}) as Array<{handle:string}>;
    if (!Array.isArray(rows) || rows.length!==1 || rows[0]?.handle!==handle)
      throw new PrivateIdentityError('PROVIDER_UNAVAILABLE','Handle was not durably acknowledged.');
    // DB unique constraint is the source of truth for concurrent handle claims.
    return {handle};
  }

  async savePrivateProfile(input:unknown) {
    const {userId}=await this.verifiedCurrentUser();
    const profile=normalizeIdentityDraft(input);
    const rows=await this.request('/rest/v1/profiles?user_id=eq.'+userId,'PATCH',{
      handle:profile.handle,display_name:profile.displayName,
      headline:profile.headline,bio:profile.bio
    }) as Array<{user_id:string;handle:string}>;
    if (!Array.isArray(rows) || rows.length!==1 || rows[0]?.user_id!==userId)
      throw new PrivateIdentityError('PROVIDER_UNAVAILABLE','Profile was not durably saved.');
    return profile;
  }

  private requireSharingOwner():string {
    if(!this.sharingOwnerId||!UUID.test(this.sharingOwnerId)||!this.isCurrentOwner)
      throw new PrivateIdentityError('AUTH_EXPIRED','Verify the current owner first.');
    let current=false;
    try{current=this.isCurrentOwner();}catch{/* fail closed */}
    if(!current)throw new PrivateIdentityError('AUTH_EXPIRED','The owner session changed.');
    return this.sharingOwnerId;
  }

  // Dedicated CAS transport: no REST upsert, no generic handle-conflict mapper.
  private async sharingRpc(name:'read_owner_profile_sharing_state'|'change_owner_profile_sharing',
    body:Record<string,unknown>):Promise<unknown>{
    const owner=this.requireSharingOwner();
    const signal=AbortSignal.timeout(10000);
    let abort:()=>void=()=>{};
    const deadline=new Promise<never>((_,reject)=>{
      abort=()=>reject(new PrivateIdentityError('PROVIDER_UNAVAILABLE','Sharing request was not confirmed.'));
      signal.addEventListener('abort',abort,{once:true});
    });
    const work=async()=>{
      const token=await this.tokenSupplier();
      this.requireSharingOwner();
      if(!token)throw new PrivateIdentityError('AUTH_EXPIRED','Sign in first.');
      if(signal.aborted)throw new PrivateIdentityError('PROVIDER_UNAVAILABLE','Sharing request expired.');
      const response=await this.fetcher(this.baseUrl+'/rest/v1/rpc/'+name,{
        method:'POST',headers:{apikey:this.publishableKey,Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',signal
      });
      this.requireSharingOwner();
      if(response.status===401||response.status===403)
        throw new PrivateIdentityError('AUTH_EXPIRED','Sharing access denied.');
      let raw:unknown;
      try{raw=await readSharingJson(response);}
      catch(error){
        this.requireSharingOwner();
        if(!response.ok)throw new PrivateIdentityError('PROVIDER_UNAVAILABLE','Sharing request was not confirmed.');
        throw error;
      }
      if(this.requireSharingOwner()!==owner||signal.aborted)
        throw new PrivateIdentityError('PROVIDER_UNAVAILABLE','Sharing request was not confirmed.');
      if(!response.ok){
        if(response.status===409&&record(raw)&&raw.code==='40001')
          throw new PrivateIdentityError('CONFLICT','Sharing preferences changed. Reload and confirm again.');
        if(response.status===400&&record(raw)&&raw.code==='22023')
          throw new PrivateIdentityError('VALIDATION','Invalid sharing request.');
        throw new PrivateIdentityError('PROVIDER_UNAVAILABLE','Sharing request was not confirmed.');
      }
      return raw;
    };
    try{
      const raw=await Promise.race([deadline,work()]);
      this.requireSharingOwner();
      return raw;
    }catch(error){
      this.requireSharingOwner();
      if(error instanceof PrivateIdentityError)throw error;
      throw new PrivateIdentityError('PROVIDER_UNAVAILABLE','Sharing request was not confirmed.');
    }finally{signal.removeEventListener('abort',abort);}
  }

  async readProfileSharingState():Promise<ProfileSharingState>{
    const owner=this.requireSharingOwner();
    const raw=await this.sharingRpc('read_owner_profile_sharing_state',{});
    this.requireSharingOwner();
    if(!validSharingState(raw,owner))
      throw new PrivateIdentityError('INVALID_ACK','Sharing state could not be verified.');
    return raw;
  }

  /** Acknowledges only saved private intent, not publication or live delivery. */
  async requestPublicIdentity(change:ProfileSharingChange):Promise<ProfileSharingReceipt>{
    const owner=this.requireSharingOwner();
    if(!record(change)||!exact(change,['expected','desired','operationId'])||
      !validSharingState(change.expected,owner)||!validSharing(change.desired)||
      typeof change.operationId!=='string'||!UUID.test(change.operationId))
      throw new PrivateIdentityError('VALIDATION','Invalid sharing change.');
    const expected={...change.expected,preferences:change.expected.preferences===null?null:{...change.expected.preferences}};
    const desired={...change.desired};
    const operationId=change.operationId;
    const same=sameSharing(expected.preferences,desired);
    if(expected.version===M){
      const previous=expected.preferences;
      if(previous===null||sharingKeys.some(key=>!previous[key]&&desired[key]))
        throw new PrivateIdentityError('VALIDATION','Terminal sharing state cannot be re-enabled.');
    }else if(expected.version===M-1&&!same&&desired.publicationRequested){
      throw new PrivateIdentityError('VALIDATION','Terminal sharing state must remain private.');
    }
    const raw=await this.sharingRpc('change_owner_profile_sharing',{
      p_expected_version:expected.version,p_expected:expected.preferences,p_desired:desired,p_operation_id:operationId
    });
    this.requireSharingOwner();
    if(!validSharingState(raw,owner,true)||!sameSharing(raw.preferences,desired))
      throw new PrivateIdentityError('INVALID_ACK','Sharing change was not confirmed.');
    const receipt=raw as ProfileSharingReceipt;
    if(receipt.status==='NO_CHANGE'&&same&&receipt.version===expected.version)return receipt;
    const next=Math.min(expected.version+1,M);
    if(!same&&receipt.version===next&&
      (receipt.status==='APPLIED'||(receipt.status==='REPLAYED'&&next<M)))return receipt;
    throw new PrivateIdentityError('INVALID_ACK','Sharing change was not confirmed.');
  }

  /**
   * Complete B1's two-stage signup: Auth creates a private profile first,
   * then an authenticated owner claims the untrusted requested handle.
   * An existing persisted handle always wins over editable auth metadata.
   * Never marks the profile, portfolio or projects as published.
   */
  async completeInitialIdentity():Promise<
    {status:'claimed';handle:string;emailVerified:boolean} |
    {status:'needs_handle';emailVerified:boolean} |
    {status:'handle_conflict';requestedHandle:string;emailVerified:boolean}
  > {
    const raw=await this.request('/auth/v1/user','GET') as {
      id?:unknown;email_confirmed_at?:unknown;
      user_metadata?:{handle_candidate?:unknown}|null;
    }|null;
    if (!raw || typeof raw.id!=='string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(raw.id))
      throw new PrivateIdentityError('AUTH_EXPIRED','Unable to verify the current account.');
    const emailVerified=typeof raw.email_confirmed_at==='string' && raw.email_confirmed_at.length>0;
    const rows=await this.request('/rest/v1/profiles?select=user_id,handle&user_id=eq.'+raw.id,'GET') as
      Array<{user_id?:unknown;handle?:unknown}>|null;
    if (!Array.isArray(rows) || rows.length!==1 || rows[0]?.user_id!==raw.id)
      throw new PrivateIdentityError('PROVIDER_UNAVAILABLE','The private identity record is missing.');
    if (typeof rows[0].handle==='string')
      return {status:'claimed',handle:normalizeHandle(rows[0].handle),emailVerified};
    const candidate=raw.user_metadata?.handle_candidate;
    if (typeof candidate!=='string')return {status:'needs_handle',emailVerified};
    let handle:string;
    try { handle=normalizeHandle(candidate); }
    catch { return {status:'needs_handle',emailVerified}; }
    try {
      const confirmed=await this.request('/rest/v1/profiles?user_id=eq.'+raw.id,'PATCH',{handle}) as
        Array<{user_id?:unknown;handle?:unknown}>|null;
      if (!Array.isArray(confirmed)||confirmed.length!==1||
          confirmed[0]?.user_id!==raw.id||confirmed[0]?.handle!==handle)
        throw new PrivateIdentityError('PROVIDER_UNAVAILABLE','Handle was not durably acknowledged.');
      return {status:'claimed',handle,emailVerified};
    } catch(error) {
      if(error instanceof PrivateIdentityError && error.code==='HANDLE_CONFLICT')
        return {status:'handle_conflict',requestedHandle:handle,emailVerified};
      throw error;
    }
  }

  /**
   * A connected public *link* is not account ownership verification or an
   * API integration. This module never sends a request to platform websites.
   */
  async connectPlatform(provider:PrivatePlatformProvider,rawHandle:unknown):
    Promise<PrivatePlatformLink>{
    if(!providerKey(provider))throw new PrivateIdentityError('VALIDATION','Unknown public platform.');
    const handle=platformHandle(provider,rawHandle);
    const {userId}=await this.verifiedCurrentUser();
    const rows=await this.request('/rest/v1/private_platform_links?select=*','POST',{
      provider,handle
    });
    if(!Array.isArray(rows)||rows.length!==1||
       !verifiedPlatformLink(rows[0],userId)||rows[0].provider!==provider||
       rows[0].handle!==handle)
      throw new PrivateIdentityError('PROVIDER_UNAVAILABLE','Private platform link was not acknowledged.');
    return rows[0];
  }

  async listPlatformConnections():Promise<PrivatePlatformLink[]>{
    const {userId}=await this.verifiedCurrentUser();
    const rows=await this.request(
      '/rest/v1/private_platform_links?select=*&order=provider.asc&limit=7','GET');
    if(!Array.isArray(rows)||rows.length>6||
       rows.some(row=>!verifiedPlatformLink(row,userId))||
       new Set(rows.map(row=>row.provider)).size!==rows.length)
      throw new PrivateIdentityError('PROVIDER_UNAVAILABLE','Private platform links could not be verified.');
    return rows;
  }

  async changePlatformHandle(provider:PrivatePlatformProvider,rawHandle:unknown):
    Promise<PrivatePlatformLink>{
    if(!providerKey(provider))throw new PrivateIdentityError('VALIDATION','Unknown public platform.');
    const handle=platformHandle(provider,rawHandle);
    const {userId}=await this.verifiedCurrentUser();
    const rows=await this.request('/rest/v1/private_platform_links?owner_user_id=eq.'+
      userId+'&provider=eq.'+provider+'&select=*','PATCH',{handle});
    if(!Array.isArray(rows)||rows.length!==1||
       !verifiedPlatformLink(rows[0],userId)||rows[0].provider!==provider||
       rows[0].handle!==handle)
      throw new PrivateIdentityError('PROVIDER_UNAVAILABLE','Platform link update not acknowledged.');
    return rows[0];
  }

  async disconnectPlatform(provider:PrivatePlatformProvider):Promise<{provider:PrivatePlatformProvider;deleted:true}>{
    if(!providerKey(provider))throw new PrivateIdentityError('VALIDATION','Unknown public platform.');
    const {userId}=await this.verifiedCurrentUser();
    const rows=await this.request('/rest/v1/private_platform_links?owner_user_id=eq.'+
      userId+'&provider=eq.'+provider+'&select=*','DELETE');
    if(!Array.isArray(rows)||rows.length!==1||
       !verifiedPlatformLink(rows[0],userId)||rows[0].provider!==provider)
      throw new PrivateIdentityError('PROVIDER_UNAVAILABLE','Platform disconnect not acknowledged.');
    return {provider,deleted:true};
  }


}
