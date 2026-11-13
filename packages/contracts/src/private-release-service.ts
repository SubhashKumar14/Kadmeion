import { ContractError } from './project.ts';

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

export class SupabasePrivateReleaseService {
  private readonly endpoint: string;
  private readonly key: string;
  private readonly token: () => Promise<string | null>;
  private readonly fetcher: typeof fetch;

  constructor(endpoint: string, publishableKey: string,
      accessToken: () => Promise<string | null>, fetcher: typeof fetch = fetch) {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' &&
        ['localhost','127.0.0.1'].includes(parsed.hostname)))
      throw new ContractError('VALIDATION', 'Use a trusted HTTPS Supabase endpoint.');
    if (!publishableKey) throw new ContractError('VALIDATION', 'Publishable key is missing.');
    this.endpoint = endpoint.replace(/\/$/, '');
    this.key = publishableKey;
    this.token = accessToken;
    this.fetcher = fetcher;
  }

  async freeze(portfolioId: string, operationId: string, revision: number,
      visibilityIntent: FrozenVisibilityIntent): Promise<PrivateFrozenRequest> {
    if (!UUID.test(portfolioId) || !UUID.test(operationId) ||
        !Number.isSafeInteger(revision) || revision < 1 ||
        (visibilityIntent !== 'PUBLIC' && visibilityIntent !== 'UNLISTED'))
      throw new ContractError('VALIDATION', 'Invalid pinned release request.');
    const jwt = await this.token();
    if (!jwt) throw new PrivateReleaseError('AUTH_EXPIRED', 'Sign in to freeze your private revision.');
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint + '/rest/v1/rpc/freeze_private_release_request',{
        method:'POST',
        headers:{
          apikey:this.key,
          Authorization:'Bearer '+jwt,
          'Content-Type':'application/json'
        },
        body:JSON.stringify({
          p_portfolio_id:portfolioId,
          p_operation_id:operationId,
          p_revision:revision,
          p_visibility_intent:visibilityIntent
        })
      });
    } catch {
      throw new PrivateReleaseError('PROVIDER_UNAVAILABLE', 'Freeze was not acknowledged; retry the same operation ID.');
    }
    if (!response.ok) {
      const problem=await response.json().catch(()=>null) as {message?:string}|null;
      if (problem?.message==='PRIVATE_REVISION_UNAVAILABLE')
        throw new PrivateReleaseError('REVISION_UNAVAILABLE','That immutable revision does not exist.');
      if (problem?.message==='PRIVATE_FREEZE_QUOTA_REACHED')
        throw new PrivateReleaseError('QUOTA_EXCEEDED','The portfolio has reached the private freeze limit.');
      if (response.status===401) throw new PrivateReleaseError('AUTH_EXPIRED','Session expired.');
      if (response.status===403) throw new PrivateReleaseError('FORBIDDEN','Portfolio is not accessible.');
      throw new PrivateReleaseError('PROVIDER_UNAVAILABLE','Freeze could not be confirmed.');
    }
    const ack=await response.json().catch(()=>null) as PrivateFrozenRequest|null;
    if (!ack || !UUID.test(ack.requestId) || ack.portfolioId!==portfolioId ||
        ack.revision!==revision || !SHA256.test(ack.snapshotSha256) ||
        ack.visibilityIntent!==visibilityIntent || ack.status!=='FROZEN' ||
        ack.publicUrl!==null || typeof ack.alreadyFrozen!=='boolean')
      throw new PrivateReleaseError('INVALID_ACK','Freeze receipt is unverified; do not publish.');
    return ack;
  }
}
