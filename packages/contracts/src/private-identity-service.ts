import { normalizeHandle, ContractError } from './project.ts';
import { normalizeIdentityDraft, type SharingPreferences } from './identity.ts';
import type { TokenSupplier } from './project-data-service.ts';

export interface CurrentIdentity {
  userId: string;
  emailVerified: boolean;
}

export class PrivateIdentityError extends Error {
  readonly code: 'AUTH_EXPIRED'|'HANDLE_CONFLICT'|'VALIDATION'|'PROVIDER_UNAVAILABLE';
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

  constructor(baseUrl:string,publishableKey:string,tokenSupplier:TokenSupplier,fetcher:typeof fetch=fetch) {
    const u=new URL(baseUrl);
    if (u.protocol!=='https:' && !(u.protocol==='http:' && ['localhost','127.0.0.1'].includes(u.hostname)))
      throw new PrivateIdentityError('VALIDATION','Invalid Supabase API origin.');
    if (!publishableKey) throw new PrivateIdentityError('VALIDATION','Publishable key is missing.');
    this.baseUrl=baseUrl.replace(/\/$/,'');
    this.publishableKey=publishableKey;
    this.tokenSupplier=tokenSupplier;
    this.fetcher=fetcher;
  }

  private async request(path:string,method:string,body?:unknown,upsert=false):Promise<unknown> {
    const token=await this.tokenSupplier();
    if (!token) throw new PrivateIdentityError('AUTH_EXPIRED','Sign in first.');
    const headers:Record<string,string>={apikey:this.publishableKey,Authorization:'Bearer '+token};
    if (body!==undefined) {
      headers['Content-Type']='application/json';
      headers.Prefer=upsert?'resolution=merge-duplicates,return=representation':'return=representation';
    }
    const result=await this.fetcher(this.baseUrl+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    if (!result.ok) {
      if ([401,403].includes(result.status)) throw new PrivateIdentityError('AUTH_EXPIRED','Identity access denied.');
      if (result.status===409) throw new PrivateIdentityError('HANDLE_CONFLICT','Handle is unavailable.');
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

  async requestPublicIdentity(preferences:SharingPreferences):Promise<'saved_private_intent'> {
    const {userId}=await this.verifiedCurrentUser();
    if (!preferences || Object.values(preferences).some(v=>typeof v!=='boolean') ||
        (preferences.publicationRequested &&
         !preferences.shareDisplayName && !preferences.shareHeadline && !preferences.shareBio))
      throw new ContractError('VALIDATION','Choose eligible visible fields first.');
    const rows=await this.request('/rest/v1/profile_sharing_preferences?on_conflict=user_id','POST',{
      user_id:userId,
      share_display_name:preferences.shareDisplayName,
      share_headline:preferences.shareHeadline,
      share_bio:preferences.shareBio,
      publication_requested:preferences.publicationRequested,
      requested_at:preferences.publicationRequested?new Date().toISOString():null
    },true) as Array<{user_id:string}>;
    if (!Array.isArray(rows) || rows.length!==1 || rows[0]?.user_id!==userId)
      throw new PrivateIdentityError('PROVIDER_UNAVAILABLE','Sharing request was not acknowledged.');
    // NEVER imply the public route is active; publication has a separate B4 gate.
    return 'saved_private_intent';
  }
}
