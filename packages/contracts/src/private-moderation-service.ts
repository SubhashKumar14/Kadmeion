import { ContractError } from './project.ts';

export type ModerationReason = 'ABUSE' | 'SECURITY' | 'LEGAL' | 'SPAM';
export type ModerationCaseStatus = 'OPEN' | 'APPEAL_PENDING' | 'CLOSED';
export interface ModerationCaseReceipt {
  caseId: string;
  status: 'OPEN' | 'CLOSED';
  alreadyRecorded: boolean;
  restrictionEnforced: false;
  publicRevocationVerified: false;
}
export interface OperatorPrivatePortfolioBlockReceipt {
  caseId: string;
  portfolioId: string;
  generation: number;
  status: 'BLOCKED';
  stillBlocked: true;
  alreadyRecorded: boolean;
  publicServingEnabled: false;
  publicUrl: null;
  hostRevocationVerified: false;
}
export interface ModerationAppealReceipt {
  caseId: string;
  status: 'APPEAL_RECORDED';
  alreadyRecorded: boolean;
  publicRevocationVerified: false;
}
export interface OperatorModerationCase {
  caseId: string;
  targetUserId: string;
  reasonCode: ModerationReason;
  status: ModerationCaseStatus;
  createdAt: string;
}
export interface OwnerModerationCase {
  id: string;
  reason_code: ModerationReason;
  summary: string;
  status: ModerationCaseStatus;
  created_at: string;
  updated_at: string;
}
export interface OwnerModerationEvent {
  id: string;
  case_id: string;
  actor_user_id: string | null;
  event_type: 'OPENED' | 'OWNER_APPEAL' | 'OPERATOR_DECISION';
  detail: string;
  created_at: string;
}
export class PrivateModerationError extends Error {
  readonly code: 'AUTH_EXPIRED' | 'FORBIDDEN' | 'VALIDATION' | 'CONFLICT' |
    'QUOTA_EXCEEDED' | 'PROVIDER_UNAVAILABLE' | 'INVALID_ACK';
  constructor(code: PrivateModerationError['code'], message: string) {
    super(message);
    this.name = 'PrivateModerationError';
    this.code = code;
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASONS = ['ABUSE','SECURITY','LEGAL','SPAM'] as const;
const STATUSES = ['OPEN','APPEAL_PENDING','CLOSED'] as const;
const EVENTS = ['OPENED','OWNER_APPEAL','OPERATOR_DECISION'] as const;
const isRecord = (value: unknown): value is Record<string,unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isUUID = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const isDate = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
const isEnum = <T extends string>(value: unknown, options: readonly T[]): value is T =>
  typeof value === 'string' && options.includes(value as T);
function boundedText(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string' || value.length > max ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ||
      value.trim().length < min)
    throw new ContractError('VALIDATION','A bounded, nonempty moderation rationale is required.');
  return value.trim();
}
function requireUUID(value: unknown): string {
  if (!isUUID(value)) throw new ContractError('VALIDATION','Invalid moderation identifier.');
  return value;
}
function caseReceipt(raw: unknown, expected: 'OPEN'|'CLOSED'): ModerationCaseReceipt {
  if (!isRecord(raw) || !isUUID(raw.caseId) || raw.status !== expected ||
      typeof raw.alreadyRecorded !== 'boolean' || raw.restrictionEnforced !== false ||
      raw.publicRevocationVerified !== false)
    throw new PrivateModerationError('INVALID_ACK','Moderation case receipt is unverified.');
  return {caseId:raw.caseId,status:expected,alreadyRecorded:raw.alreadyRecorded,
    restrictionEnforced:false,publicRevocationVerified:false};
}
function appealReceipt(raw: unknown, caseId: string): ModerationAppealReceipt {
  if (!isRecord(raw) || raw.caseId !== caseId || raw.status !== 'APPEAL_RECORDED' ||
      typeof raw.alreadyRecorded !== 'boolean' || raw.publicRevocationVerified !== false)
    throw new PrivateModerationError('INVALID_ACK','Moderation appeal receipt is unverified.');
  return {caseId,status:'APPEAL_RECORDED',alreadyRecorded:raw.alreadyRecorded,
    publicRevocationVerified:false};
}

/** Only private, role-checked case/audit APIs; no account or public-route enforcement. */
export class SupabasePrivateModerationService {
  private readonly origin: string;
  private readonly key: string;
  private readonly token: () => Promise<string|null>;
  private readonly http: typeof fetch;
  constructor(endpoint: string, publishableKey: string, accessToken: () => Promise<string|null>,
      http: typeof fetch = fetch) {
    let url: URL;
    try { url = new URL(endpoint); }
    catch { throw new ContractError('VALIDATION','Invalid Supabase API origin.'); }
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' &&
          ['localhost','127.0.0.1'].includes(url.hostname))) ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      throw new ContractError('VALIDATION','A trusted Supabase API origin is required.');
    if (!publishableKey || typeof publishableKey !== 'string')
      throw new ContractError('VALIDATION','Publishable key is required.');
    this.origin = url.origin;
    this.key = publishableKey;
    this.token = accessToken;
    this.http = http;
  }
  private async request(path: string, body?: Record<string,unknown>): Promise<unknown> {
    const jwt = await this.token();
    if (!jwt) throw new PrivateModerationError('AUTH_EXPIRED','Sign in to access private moderation.');
    let response: Response;
    try {
      response = await this.http(this.origin + '/rest/v1/' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {apikey:this.key,Authorization:'Bearer '+jwt,Accept:'application/json',
          ...(body === undefined ? {} : {'Content-Type':'application/json'})},
        body:body === undefined ? undefined : JSON.stringify(body),
        credentials:'omit',cache:'no-store',redirect:'error'
      });
    } catch {
      throw new PrivateModerationError('PROVIDER_UNAVAILABLE','Moderation service is unreachable.');
    }
    if (!response.ok) {
      if (response.status === 401) throw new PrivateModerationError('AUTH_EXPIRED','Session expired.');
      if (response.status === 403) throw new PrivateModerationError('FORBIDDEN','Moderation access denied.');
      const problem: unknown = await response.json().catch(()=>null);
      const message = isRecord(problem) ? problem.message : null;
      if (message === 'MODERATION_CASE_QUOTA_REACHED')
        throw new PrivateModerationError('QUOTA_EXCEEDED','Operator case quota reached.');
      if (typeof message === 'string' &&
          ['INVALID_MODERATION_CASE','INVALID_APPEAL','INVALID_MODERATION_DECISION',
           'INVALID_MODERATION_LIMIT','INVALID_OPERATOR_BLOCK'].includes(message))
        throw new PrivateModerationError('VALIDATION','Moderation request rejected.');
      if (response.status === 409 || (typeof message === 'string' &&
          ['MODERATION_OPERATION_ID_REUSED','APPEAL_OPERATION_ID_REUSED',
           'DECISION_OPERATION_ID_REUSED','CASE_ALREADY_CLOSED',
           'MODERATION_BLOCK_OPERATION_REUSED','MODERATION_HOLD_ALREADY_ACTIVE',
           'MODERATION_CASE_NOT_OPEN','MODERATION_HOLD_STATE_CONFLICT'].includes(message)))
        throw new PrivateModerationError('CONFLICT','Operation ID or case state conflicts.');
      throw new PrivateModerationError('PROVIDER_UNAVAILABLE','Moderation operation was not acknowledged.');
    }
    return response.json().catch(()=>{throw new PrivateModerationError('INVALID_ACK','Invalid moderation response.');});
  }
  async openCase(targetUserId: string, operationId: string, reason: ModerationReason,
      summary: string): Promise<ModerationCaseReceipt> {
    requireUUID(targetUserId); requireUUID(operationId);
    if (!isEnum(reason,REASONS)) throw new ContractError('VALIDATION','Invalid moderation reason.');
    const raw = await this.request('rpc/operator_open_moderation_case',{
      p_target_user_id:targetUserId,p_operation_id:operationId,
      p_reason_code:reason,p_summary:boundedText(summary,20,500)
    });
    return caseReceipt(raw,'OPEN');
  }
  async appeal(caseId: string, operationId: string, statement: string): Promise<ModerationAppealReceipt> {
    requireUUID(caseId); requireUUID(operationId);
    const raw = await this.request('rpc/owner_appeal_moderation_case',{
      p_case_id:caseId,p_operation_id:operationId,p_statement:boundedText(statement,20,2000)
    });
    return appealReceipt(raw,caseId);
  }
  async closeCase(caseId: string, operationId: string, rationale: string): Promise<ModerationCaseReceipt> {
    requireUUID(caseId); requireUUID(operationId);
    const raw = await this.request('rpc/operator_close_moderation_case',{
      p_case_id:caseId,p_operation_id:operationId,p_rationale:boundedText(rationale,20,2000)
    });
    const receipt = caseReceipt(raw,'CLOSED');
    if (receipt.caseId !== caseId)
      throw new PrivateModerationError('INVALID_ACK','Moderation case ID differs from request.');
    return receipt;
  }
  /** Operator-only, case-bound internal hold. Never a public-host revocation receipt. */
  async blockPrivatePortfolio(caseId: string, portfolioId: string,
      operationId: string): Promise<OperatorPrivatePortfolioBlockReceipt> {
    requireUUID(caseId); requireUUID(portfolioId); requireUUID(operationId);
    const raw = await this.request('rpc/operator_block_private_portfolio',{
      p_case_id:caseId,p_portfolio_id:portfolioId,p_operation_id:operationId
    });
    if (!isRecord(raw) || raw.caseId !== caseId || raw.portfolioId !== portfolioId ||
        typeof raw.generation !== 'number' || !Number.isSafeInteger(raw.generation) ||
        raw.generation < 1 ||
        raw.status !== 'BLOCKED' || raw.stillBlocked !== true ||
        typeof raw.alreadyRecorded !== 'boolean' ||
        raw.publicServingEnabled !== false || raw.publicUrl !== null ||
        raw.hostRevocationVerified !== false)
      throw new PrivateModerationError('INVALID_ACK',
        'Operator private block was not confirmed.');
    return {caseId,portfolioId,generation:raw.generation as number,
      status:'BLOCKED',stillBlocked:true,alreadyRecorded:raw.alreadyRecorded,
      publicServingEnabled:false,publicUrl:null,hostRevocationVerified:false};
  }
  async listOperatorCases(max = 25): Promise<OperatorModerationCase[]> {
    if (!Number.isSafeInteger(max) || max < 1 || max > 50)
      throw new ContractError('VALIDATION','Invalid moderation page size.');
    const raw = await this.request('rpc/operator_list_moderation_cases',{p_max:max});
    if (!Array.isArray(raw) || raw.length > max)
      throw new PrivateModerationError('INVALID_ACK','Invalid operator case list.');
    return raw.map((entry: unknown): OperatorModerationCase => {
      if (!isRecord(entry) || !isUUID(entry.caseId) || !isUUID(entry.targetUserId) ||
          !isEnum(entry.reasonCode,REASONS) || !isEnum(entry.status,STATUSES) ||
          !isDate(entry.createdAt))
        throw new PrivateModerationError('INVALID_ACK','Invalid operator case metadata.');
      return {caseId:entry.caseId,targetUserId:entry.targetUserId,
        reasonCode:entry.reasonCode,status:entry.status,createdAt:entry.createdAt};
    });
  }
  async listOwnerCases(): Promise<OwnerModerationCase[]> {
    const raw = await this.request('private_moderation_cases?select=id,reason_code,summary,status,created_at,updated_at&order=created_at.desc&limit=50');
    if (!Array.isArray(raw) || raw.length > 50)
      throw new PrivateModerationError('INVALID_ACK','Invalid private case list.');
    return raw.map((entry: unknown): OwnerModerationCase => {
      if (!isRecord(entry) || !isUUID(entry.id) || !isEnum(entry.reason_code,REASONS) ||
          !isEnum(entry.status,STATUSES) || !isDate(entry.created_at) ||
          !isDate(entry.updated_at) || typeof entry.summary !== 'string' ||
          entry.summary.length > 500 || entry.summary.trim().length < 20)
        throw new PrivateModerationError('INVALID_ACK','Invalid private case metadata.');
      return {id:entry.id,reason_code:entry.reason_code,summary:entry.summary,
        status:entry.status,created_at:entry.created_at,updated_at:entry.updated_at};
    });
  }
  async listOwnerEvents(): Promise<OwnerModerationEvent[]> {
    const raw = await this.request('private_moderation_events?select=id,case_id,actor_user_id,event_type,detail,created_at&order=created_at.desc&limit=100');
    if (!Array.isArray(raw) || raw.length > 100)
      throw new PrivateModerationError('INVALID_ACK','Invalid private event list.');
    return raw.map((entry: unknown): OwnerModerationEvent => {
      if (!isRecord(entry) || !isUUID(entry.id) || !isUUID(entry.case_id) ||
          (entry.actor_user_id !== null && !isUUID(entry.actor_user_id)) ||
          !isEnum(entry.event_type,EVENTS) || !isDate(entry.created_at) ||
          typeof entry.detail !== 'string' || entry.detail.length > 2000 ||
          entry.detail.trim().length < 12)
        throw new PrivateModerationError('INVALID_ACK','Invalid private event metadata.');
      return {id:entry.id,case_id:entry.case_id,actor_user_id:entry.actor_user_id,
        event_type:entry.event_type,detail:entry.detail,created_at:entry.created_at};
    });
  }
}
