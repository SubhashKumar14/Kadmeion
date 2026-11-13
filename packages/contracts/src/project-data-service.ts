import { normalizePrivateCaseStudy, type PrivateCaseStudy } from './private-project-case-studies.ts';
import { ContractError } from './project.ts';
import { normalizeProjectDraft, type PrivateProjectDraft } from './projects.ts';

type JsonRecord = Record<string, unknown>;
export interface OwnedProjectRow extends JsonRecord {
  id: string; owner_user_id: string; revision: number; slug: string; title: string;
}
export type TokenSupplier = () => Promise<string | null>;

export class ProjectServiceError extends Error {
  readonly code: 'AUTH_EXPIRED' | 'PROVIDER_UNAVAILABLE' | 'REVISION_CONFLICT' | 'INVALID_UPLOAD';
  constructor(code: 'AUTH_EXPIRED' | 'PROVIDER_UNAVAILABLE' | 'REVISION_CONFLICT' | 'INVALID_UPLOAD', message: string) {
    super(message); this.name = 'ProjectServiceError'; this.code=code;
  }
}

/** REST uses only the publishable key and the real user JWT. Never a service key. */
export class SupabasePrivateProjectService {
  private readonly supabaseUrl: string;
  private readonly publishableKey: string;
  private readonly token: TokenSupplier;
  private readonly fetcher: typeof fetch;
  constructor(supabaseUrl: string, publishableKey: string, token: TokenSupplier, fetcher: typeof fetch = fetch) {
    this.supabaseUrl=supabaseUrl; this.publishableKey=publishableKey;
    this.token=token; this.fetcher=fetcher;
    const url = new URL(supabaseUrl);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1')
      throw new ContractError('VALIDATION', 'Supabase endpoint must use HTTPS.');
    if (!publishableKey) throw new ContractError('VALIDATION', 'Publishable key is required.');
  }

  private async send(path: string, method: string, payload?: unknown, contentType = 'application/json', upsert = false) {
    const jwt = await this.token();
    if (!jwt) throw new ProjectServiceError('AUTH_EXPIRED', 'Sign in to access private projects.');
    const headers: Record<string,string> = {
      apikey: this.publishableKey, Authorization: 'Bearer ' + jwt
    };
    if (payload !== undefined) headers['Content-Type'] = contentType;
    if (method === 'POST' && path.startsWith('/rest/v1/'))
      headers.Prefer = upsert ? 'resolution=merge-duplicates,return=representation' : 'return=representation';
    let response: Response;
    try {
      response = await this.fetcher(this.supabaseUrl.replace(/\/$/,'') + path, {
        method, headers,
        body: payload === undefined ? undefined : (contentType === 'application/json' ? JSON.stringify(payload) : payload as BodyInit)
      });
    } catch {
      throw new ProjectServiceError('PROVIDER_UNAVAILABLE','The provider is unreachable; preserve the unsaved draft.');
    }
    if (!response.ok) {
      const cause=await response.json().catch(()=>null) as {code?:string;message?:string}|null;
      if (cause?.code==='40001' || cause?.message==='REVISION_CONFLICT')
        throw new ProjectServiceError('REVISION_CONFLICT','Project was modified elsewhere.');
      if (response.status===401 || response.status===403)
        throw new ProjectServiceError('AUTH_EXPIRED','Access denied.');
      throw new ProjectServiceError('PROVIDER_UNAVAILABLE','Project request was not accepted.');
    }
    return response.status === 204 ? null : response.json() as Promise<unknown>;
  }

  async addPrivateProject(ownerUserId: string, input: unknown): Promise<OwnedProjectRow> {
    // ownerUserId is used for insert shape; DB RLS authenticates JWT subject independently.
    const draft: PrivateProjectDraft = normalizeProjectDraft(input);
    const result = await this.send('/rest/v1/projects?select=id,owner_user_id,revision,slug,title', 'POST', {
      owner_user_id: ownerUserId,
      slug: draft.slug, title: draft.title, summary: draft.summary,
      description: draft.description, repository_url: draft.repositoryUrl, live_url: draft.liveUrl
    });
    const rows = result as OwnedProjectRow[];
    if (!Array.isArray(rows) || !rows[0]?.id) throw new ProjectServiceError('PROVIDER_UNAVAILABLE','No project acknowledgement received.');
    return rows[0];
  }

  async listPrivateProjects(): Promise<OwnedProjectRow[]> {
    const result = await this.send('/rest/v1/projects?select=id,owner_user_id,revision,slug,title&order=created_at.desc&limit=100','GET');
    if (!Array.isArray(result)) throw new ProjectServiceError('PROVIDER_UNAVAILABLE','Invalid projects response.');
    return result as OwnedProjectRow[];
  }

  async updateWithRevision(
    projectId: string, expectedRevision: number, input: unknown
  ): Promise<{id:string;revision:number}> {
    const draft = normalizeProjectDraft(input);
    const result = await this.send('/rest/v1/rpc/update_private_project', 'POST', {
      p_project_id: projectId, p_base_revision: expectedRevision, p_title: draft.title,
      p_summary: draft.summary, p_description: draft.description,
      p_repository_url: draft.repositoryUrl, p_live_url: draft.liveUrl
    }) as {id:string;revision:number} | null;
    if (!result?.id || !Number.isSafeInteger(result.revision))
      throw new ProjectServiceError('PROVIDER_UNAVAILABLE','No revision acknowledgement received.');
    return result;
  }

  async updateCaseStudyWithRevision(projectId:string,revision:number,caseStudy:unknown):
    Promise<{id:string;revision:number}> {
    const sections:PrivateCaseStudy=normalizePrivateCaseStudy(caseStudy);
    if(!Number.isSafeInteger(revision)||revision<0)
      throw new ContractError('VALIDATION','Invalid revision.');
    const result=await this.send('/rest/v1/rpc/update_private_project_case_study','POST',{
      p_project_id:projectId,p_base_revision:revision,p_case_study:sections
    }) as {id:string;revision:number}|null;
    if(!result?.id||!Number.isSafeInteger(result.revision))
      throw new ProjectServiceError('PROVIDER_UNAVAILABLE','Case study was not acknowledged.');
    return result;
  }

  async linkPrivateImageMetadata(
    projectId:string,ownerUserId:string,objectPath:string,
    mime:'image/png'|'image/jpeg'|'image/webp'|'image/avif',
    size:number,altText:string
  ):Promise<string> {
    if(!Number.isSafeInteger(size)||size<1||size>5*1024*1024||
       !objectPath.startsWith(ownerUserId+'/')||typeof altText!=='string'||altText.length>500)
      throw new ProjectServiceError('INVALID_UPLOAD','Invalid owned image metadata.');
    const result=await this.send('/rest/v1/rpc/register_private_project_image','POST',{
      p_project_id:projectId,p_object_path:objectPath,p_mime_type:mime,
      p_byte_size:size,p_alt_text:altText
    }) as {id?:string;object_path?:string;verified?:boolean}|null;
    if(!result?.id||result.object_path!==objectPath||result.verified!==true)
      throw new ProjectServiceError('PROVIDER_UNAVAILABLE','Image metadata was not durably verified.');
    return result.id;
  }

  /**
   * A private owner request only; never reports a live public URL.
   * B4 must build, publish and independently verify every public surface.
   */
  async requestProjectExposureIntent(
    projectId:string,ownerUserId:string,selection:{showOnProfile:boolean;showCaseStudy:boolean}
  ):Promise<'saved_private_intent'> {
    if (!selection || typeof selection.showOnProfile!=='boolean' || typeof selection.showCaseStudy!=='boolean')
      throw new ContractError('VALIDATION','Explicit exposure choices are required.');
    const result=await this.send('/rest/v1/project_exposure_intents?on_conflict=project_id','POST',{
      project_id:projectId,owner_user_id:ownerUserId,
      show_on_profile:selection.showOnProfile,
      show_case_study:selection.showCaseStudy,
      requested_at:selection.showOnProfile||selection.showCaseStudy?new Date().toISOString():null
    },'application/json',true) as Array<{project_id:string;owner_user_id:string}>;
    if (!Array.isArray(result) || result.length!==1 ||
        result[0].project_id!==projectId || result[0].owner_user_id!==ownerUserId)
      throw new ProjectServiceError('PROVIDER_UNAVAILABLE','Exposure preference was not acknowledged.');
    return 'saved_private_intent';
  }

  async readPrivateImage(
    ownerUserId:string,assetId:string,filename:string
  ):Promise<{mime:string;bytes:Uint8Array}> {
    if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(ownerUserId) ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(assetId) ||
        !/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/.test(filename) ||
        filename.includes('..')) {
      throw new ProjectServiceError('INVALID_UPLOAD','Invalid owned asset reference.');
    }
    const jwt=await this.token();
    if (!jwt)throw new ProjectServiceError('AUTH_EXPIRED','Sign in to read private images.');
    let res:Response;
    try {
      res=await this.fetcher(this.supabaseUrl.replace(/\/$/,'')+
        '/storage/v1/object/kadmeion-private-assets/'+ownerUserId+'/'+assetId+'/'+filename,{
          method:'GET',headers:{apikey:this.publishableKey,Authorization:'Bearer '+jwt}
        });
    }catch {
      throw new ProjectServiceError('PROVIDER_UNAVAILABLE','Private image is unreachable.');
    }
    if(!res.ok) {
      if(res.status===401||res.status===403)throw new ProjectServiceError('AUTH_EXPIRED','Private image not authorized.');
      throw new ProjectServiceError('PROVIDER_UNAVAILABLE','Private image unavailable.');
    }
    const mime=(res.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
    if(!['image/png','image/jpeg','image/webp','image/avif'].includes(mime))
      throw new ProjectServiceError('INVALID_UPLOAD','Unexpected image content type.');
    const bytes=new Uint8Array(await res.arrayBuffer());
    if(!bytes.length||bytes.length>5*1024*1024||!matchesImageSignature(mime,bytes))
      throw new ProjectServiceError('INVALID_UPLOAD','Invalid or oversized private image content.');
    return {mime,bytes};
  }

  async uploadPrivateImage(
    ownerId: string, assetId: string, filename: string,
    mime: 'image/png'|'image/jpeg'|'image/webp'|'image/avif', bytes: Uint8Array
  ): Promise<string> {
    if (!/^[0-9a-f-]{36}$/i.test(ownerId) || !/^[A-Za-z0-9_-]{1,64}$/.test(assetId) ||
        (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/.test(filename) || filename.includes('..')) ||
        !(bytes instanceof Uint8Array) || bytes.length===0 || bytes.length>5*1024*1024 ||
        !matchesImageSignature(mime,bytes)) {
      throw new ProjectServiceError('INVALID_UPLOAD','Use a supported image up to 5 MiB.');
    }
    const objectPath = ownerId+'/'+assetId+'/'+filename;
    await this.send('/storage/v1/object/kadmeion-private-assets/'+objectPath,'POST',bytes,mime);
    return objectPath;
  }
}

export function matchesImageSignature(mime: string, bytes: Uint8Array): boolean {
  if (mime==='image/png') return bytes.length>=8 &&
    [137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b);
  if (mime==='image/jpeg') return bytes.length>=3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  if (mime==='image/webp') return bytes.length>=12 &&
    String.fromCharCode(...bytes.slice(0,4))==='RIFF' &&
    String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  if (mime==='image/avif') return bytes.length>=16 &&
    String.fromCharCode(...bytes.slice(4,8))==='ftyp' &&
    ['avif','avis'].includes(String.fromCharCode(...bytes.slice(8,12)));
  return false;
}
