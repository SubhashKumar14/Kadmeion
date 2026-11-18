import { ContractError, isSafeSupabaseClientKey } from './project.ts';

export type PrivateTrashKind = 'project' | 'portfolio';
export type PrivateTrashResponse = {
  item_type: PrivateTrashKind;
  item_id: string;
  status: 'trashed' | 'already_trashed' | 'restored';
  restore_until?: string;
  public_visibility?: 'private';
};
export type PrivateTrashGenerationReceipt = {item_type:PrivateTrashKind;item_id:string;status:'restored';public_visibility:'private';trash_id:string};
export type PrivateTrashEntry = {
  id: string;
  item_type: PrivateTrashKind;
  item_id: string;
  trashed_at: string;
  restore_until: string;
};

export class PrivateTrashError extends Error {
  readonly code: 'AUTH_EXPIRED' | 'PROVIDER_UNAVAILABLE' | 'TRASH_EXPIRED' | 'INVALID_STATE';
  constructor(code: 'AUTH_EXPIRED' | 'PROVIDER_UNAVAILABLE' | 'TRASH_EXPIRED' | 'INVALID_STATE', message: string) {
    super(message);
    this.name = 'PrivateTrashError';
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function checkTarget(kind: PrivateTrashKind, id: string): void {
  if ((kind !== 'project' && kind !== 'portfolio') || typeof id !== 'string' || !UUID.test(id))
    throw new ContractError('VALIDATION', 'Invalid private Trash target.');
}

function validateAck(value: unknown, kind: PrivateTrashKind, id: string,
  expected: readonly PrivateTrashResponse['status'][]): PrivateTrashResponse {
  if (!value || typeof value !== 'object') throw new PrivateTrashError('INVALID_STATE', 'Missing Trash acknowledgement.');
  const ack = value as PrivateTrashResponse;
  if (ack.item_type !== kind || ack.item_id !== id || !expected.includes(ack.status))
    throw new PrivateTrashError('INVALID_STATE', 'Invalid Trash acknowledgement.');
  if (ack.status === 'restored') {
    if (ack.public_visibility !== 'private')
      throw new PrivateTrashError('INVALID_STATE', 'Restoration did not confirm private visibility.');
  } else if (!ack.restore_until || !Number.isFinite(Date.parse(ack.restore_until)))
    throw new PrivateTrashError('INVALID_STATE', 'Missing recovery deadline.');
  return ack;
}

/** Owner-only Supabase REST + JWT client. It does not claim assets were purged or public URLs revoked. */
export class SupabasePrivateTrashService {
  private readonly base: string;
  private readonly publishableKey: string;
  private readonly accessToken: () => Promise<string | null>;
  private readonly fetcher: typeof fetch;
  private readonly isCurrentOwner: () => boolean;
  constructor(
    endpoint: string,
    publishableKey: string,
    accessToken: () => Promise<string | null>,
    fetcher: typeof fetch = fetch,
    isCurrentOwner: () => boolean = () => true
  ) {
    if(!isSafeSupabaseClientKey(publishableKey))
      throw new ContractError('VALIDATION','A public Supabase API key is required.');
    this.publishableKey = publishableKey;
    this.accessToken = accessToken;
    this.fetcher = fetcher;
    this.isCurrentOwner = isCurrentOwner;
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1')))
      throw new ContractError('VALIDATION', 'Supabase endpoint must use HTTPS.');
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      throw new ContractError('VALIDATION', 'A trusted Supabase API origin is required.');
    this.base = url.origin;
  }

  private requireCurrentOwner():void {
    if(!this.isCurrentOwner())throw new PrivateTrashError('AUTH_EXPIRED','The private owner session changed.');
  }

  private async send(path: string, method: 'GET' | 'POST', input?: unknown): Promise<unknown> {
    this.requireCurrentOwner();
    const token = await this.accessToken();
    this.requireCurrentOwner();
    if (!token) throw new PrivateTrashError('AUTH_EXPIRED', 'Sign in to access private Trash.');
    let res: Response;
    try {
      res = await this.fetcher(this.base + path, {
        method,
        redirect:'error',
        headers: {
          apikey: this.publishableKey,
          Authorization: 'Bearer ' + token,
          ...(input === undefined ? {} : {'Content-Type':'application/json'})
        },
        body: input === undefined ? undefined : JSON.stringify(input)
      });
    } catch {
      this.requireCurrentOwner();
      throw new PrivateTrashError('PROVIDER_UNAVAILABLE', 'Private Trash could not be reached.');
    }
    this.requireCurrentOwner();
    if (!res.ok) {
      if (res.status === 401 || res.status === 403)
        throw new PrivateTrashError('AUTH_EXPIRED', 'You cannot access that private item.');
      const err = await res.json().catch(() => null) as {message?:string;code?:string} | null;
      this.requireCurrentOwner();
      if (err?.message === 'PRIVATE_TRASH_EXPIRED')
        throw new PrivateTrashError('TRASH_EXPIRED', 'The 15-day restoration window has ended.');
      if (err?.code === '40001' || err?.code === '55P03' || err?.message === 'PRIVATE_TRASH_GENERATION_CONFLICT' || err?.message === 'PRIVATE_TRASH_STATE_CONFLICT' || err?.message === 'PRIVATE_TRASH_JOURNAL_MISSING')
        throw new PrivateTrashError('INVALID_STATE', 'Trash state requires recovery; no data was deleted.');
      throw new PrivateTrashError('PROVIDER_UNAVAILABLE', 'Private Trash request was rejected.');
    }
    const value=await res.json().catch(() => { throw new PrivateTrashError('INVALID_STATE', 'Invalid Trash response.'); });
    this.requireCurrentOwner();
    return value;
  }

  async move(kind: PrivateTrashKind, id: string): Promise<PrivateTrashResponse> {
    checkTarget(kind, id);
    return validateAck(await this.send('/rest/v1/rpc/trash_private_item','POST',
      {p_item_type:kind,p_item_id:id}),kind,id,['trashed','already_trashed']);
  }

  async restore(kind: PrivateTrashKind, id: string): Promise<PrivateTrashResponse> {
    checkTarget(kind, id);
    return validateAck(await this.send('/rest/v1/rpc/restore_private_item','POST',
      {p_item_type:kind,p_item_id:id}),kind,id,['restored']);
  }

  /** Restore exactly the reviewed journal generation; never fall back to item-only restore. */
  async restoreGeneration(kind:PrivateTrashKind,id:string,expectedTrashId:string):Promise<PrivateTrashGenerationReceipt>{
    checkTarget(kind,id);checkTarget(kind,expectedTrashId);
    const raw=await this.send('/rest/v1/rpc/owner_restore_private_item_generation','POST',
      {p_item_type:kind,p_item_id:id,p_expected_trash_id:expectedTrashId});
    const ack=validateAck(raw,kind,id,['restored']) as PrivateTrashResponse & {trash_id?:unknown};
    if(ack.trash_id!==expectedTrashId)throw new PrivateTrashError('INVALID_STATE','The exact Trash generation was not confirmed.');
    return {item_type:kind,item_id:id,status:'restored',public_visibility:'private',trash_id:expectedTrashId};
  }

  async list(): Promise<PrivateTrashEntry[]> {
    const raw = await this.send('/rest/v1/private_trash_items?select=id,item_type,item_id,trashed_at,restore_until&restored_at=is.null&order=trashed_at.desc,id.asc&limit=100','GET');
    if (!Array.isArray(raw) || raw.length>100) throw new PrivateTrashError('INVALID_STATE', 'Invalid Trash list.');
    const generations=new Set<string>(),targets=new Set<string>();
    return raw.map((entry: unknown) => {
      if (!entry || typeof entry !== 'object') throw new PrivateTrashError('INVALID_STATE', 'Invalid Trash entry.');
      const e = entry as PrivateTrashEntry;
      checkTarget(e.item_type,e.item_id);
      const target=e.item_type+':'+e.item_id.toLowerCase();
      if(typeof e.id!=='string'||!UUID.test(e.id)||generations.has(e.id.toLowerCase())||targets.has(target))
        throw new PrivateTrashError('INVALID_STATE','Invalid or ambiguous Trash generation.');
      generations.add(e.id.toLowerCase());targets.add(target);
      if (typeof e.trashed_at!=='string'||typeof e.restore_until!=='string'||!Number.isFinite(Date.parse(e.trashed_at)) || !Number.isFinite(Date.parse(e.restore_until)))
        throw new PrivateTrashError('INVALID_STATE', 'Invalid Trash deadline.');
      return e;
    });
  }
}
