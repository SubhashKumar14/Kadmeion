import { ContractError } from './project.ts';

export type PrivateTrashKind = 'project' | 'portfolio';
export type PrivateTrashResponse = {
  item_type: PrivateTrashKind;
  item_id: string;
  status: 'trashed' | 'already_trashed' | 'restored';
  restore_until?: string;
  public_visibility?: 'private';
};
export type PrivateTrashEntry = {
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
  constructor(
    endpoint: string,
    publishableKey: string,
    accessToken: () => Promise<string | null>,
    fetcher: typeof fetch = fetch
  ) {
    this.publishableKey = publishableKey;
    this.accessToken = accessToken;
    this.fetcher = fetcher;
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1')))
      throw new ContractError('VALIDATION', 'Supabase endpoint must use HTTPS.');
    if (!publishableKey) throw new ContractError('VALIDATION', 'Publishable key is required.');
    this.base = endpoint.replace(/\/$/, '');
  }

  private async send(path: string, method: 'GET' | 'POST', input?: unknown): Promise<unknown> {
    const token = await this.accessToken();
    if (!token) throw new PrivateTrashError('AUTH_EXPIRED', 'Sign in to access private Trash.');
    let res: Response;
    try {
      res = await this.fetcher(this.base + path, {
        method,
        headers: {
          apikey: this.publishableKey,
          Authorization: 'Bearer ' + token,
          ...(input === undefined ? {} : {'Content-Type':'application/json'})
        },
        body: input === undefined ? undefined : JSON.stringify(input)
      });
    } catch {
      throw new PrivateTrashError('PROVIDER_UNAVAILABLE', 'Private Trash could not be reached.');
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403)
        throw new PrivateTrashError('AUTH_EXPIRED', 'You cannot access that private item.');
      const err = await res.json().catch(() => null) as {message?:string} | null;
      if (err?.message === 'PRIVATE_TRASH_EXPIRED')
        throw new PrivateTrashError('TRASH_EXPIRED', 'The 15-day restoration window has ended.');
      if (err?.message === 'PRIVATE_TRASH_STATE_CONFLICT' || err?.message === 'PRIVATE_TRASH_JOURNAL_MISSING')
        throw new PrivateTrashError('INVALID_STATE', 'Trash state requires recovery; no data was deleted.');
      throw new PrivateTrashError('PROVIDER_UNAVAILABLE', 'Private Trash request was rejected.');
    }
    return res.json().catch(() => { throw new PrivateTrashError('INVALID_STATE', 'Invalid Trash response.'); });
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

  async list(): Promise<PrivateTrashEntry[]> {
    const raw = await this.send('/rest/v1/private_trash_items?select=item_type,item_id,trashed_at,restore_until&restored_at=is.null&order=trashed_at.desc&limit=100','GET');
    if (!Array.isArray(raw)) throw new PrivateTrashError('INVALID_STATE', 'Invalid Trash list.');
    return raw.map((entry: unknown) => {
      if (!entry || typeof entry !== 'object') throw new PrivateTrashError('INVALID_STATE', 'Invalid Trash entry.');
      const e = entry as PrivateTrashEntry;
      checkTarget(e.item_type,e.item_id);
      if (!Number.isFinite(Date.parse(e.trashed_at)) || !Number.isFinite(Date.parse(e.restore_until)))
        throw new PrivateTrashError('INVALID_STATE', 'Invalid Trash deadline.');
      return e;
    });
  }
}
