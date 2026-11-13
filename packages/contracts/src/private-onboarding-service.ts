import type { TokenSupplier } from './project-data-service.ts';

export type OnboardingStep = 'profile' | 'portfolio' | 'connections';
export type OnboardingStatus = 'pending' | 'completed' | 'skipped';
export interface OnboardingState {
  step: OnboardingStep;
  status: OnboardingStatus;
  revision: number;
  updatedAt: string | null;
}

const steps: OnboardingStep[] = ['profile','portfolio','connections'];
const statuses: OnboardingStatus[] = ['pending','completed','skipped'];

export class OnboardingServiceError extends Error {
  readonly code: 'AUTH_REQUIRED' | 'VALIDATION' | 'PROVIDER_UNAVAILABLE';
  constructor(code: OnboardingServiceError['code'], message: string) {
    super(message);
    this.name = 'OnboardingServiceError';
    this.code = code;
  }
}

function validStep(value: unknown): value is OnboardingStep {
  return typeof value === 'string' && steps.includes(value as OnboardingStep);
}
function validStatus(value: unknown): value is OnboardingStatus {
  return typeof value === 'string' && statuses.includes(value as OnboardingStatus);
}

function parseState(value: unknown): OnboardingState {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new OnboardingServiceError('PROVIDER_UNAVAILABLE','Invalid onboarding response.');
  const data = value as Record<string, unknown>;
  if (!validStep(data.step) || !validStatus(data.status) ||
      !Number.isSafeInteger(data.revision) || (data.revision as number) < 0 ||
      !(typeof data.updated_at === 'string' || data.updated_at === null))
    throw new OnboardingServiceError('PROVIDER_UNAVAILABLE','Invalid onboarding state from provider.');
  return {step:data.step,status:data.status,revision:data.revision as number,updatedAt:data.updated_at as string | null};
}

/** No client-side privilege for direct onboarding writes. RLS covers reads; one narrow RPC covers transitions. */
export class SupabasePrivateOnboardingService {
  private readonly origin: string;
  private readonly publishableKey: string;
  private readonly token: TokenSupplier;
  private readonly fetcher: typeof fetch;

  constructor(input: {supabaseUrl: string; publishableKey: string; token: TokenSupplier; fetcher?: typeof fetch}) {
    let parsed: URL;
    try { parsed = new URL(input.supabaseUrl); }
    catch { throw new OnboardingServiceError('VALIDATION','Invalid Supabase URL.'); }
    if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost','127.0.0.1'].includes(parsed.hostname))) ||
        parsed.search || parsed.hash || parsed.pathname !== '/')
      throw new OnboardingServiceError('VALIDATION','Invalid Supabase API origin.');
    if (!input.publishableKey) throw new OnboardingServiceError('VALIDATION','Missing publishable key.');
    this.origin = parsed.origin;
    this.publishableKey = input.publishableKey;
    this.token = input.token;
    this.fetcher = input.fetcher ?? fetch;
  }

  private async request(path: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
    const jwt = await this.token();
    if (!jwt) throw new OnboardingServiceError('AUTH_REQUIRED','Sign in to update onboarding.');
    let response: Response;
    try {
      response = await this.fetcher(this.origin + path, {
        method, headers: {
          apikey:this.publishableKey,
          Authorization:'Bearer ' + jwt,
          ...(body === undefined ? {} : {'Content-Type':'application/json'})
        },
        body:body === undefined ? undefined : JSON.stringify(body),
        cache:'no-store',
        credentials:'omit',
        redirect:'error'
      });
    } catch {
      throw new OnboardingServiceError('PROVIDER_UNAVAILABLE','Onboarding service is unreachable.');
    }
    if (response.status === 401 || response.status === 403)
      throw new OnboardingServiceError('AUTH_REQUIRED','Your session is not authorized.');
    if (!response.ok) throw new OnboardingServiceError('PROVIDER_UNAVAILABLE','Onboarding state was not saved.');
    return response.json().catch(() => { throw new OnboardingServiceError('PROVIDER_UNAVAILABLE','Invalid provider response.'); });
  }

  async list(): Promise<OnboardingState[]> {
    const result = await this.request('/rest/v1/private_onboarding_steps?select=step,status,revision,updated_at&order=step.asc','GET');
    if (!Array.isArray(result)) throw new OnboardingServiceError('PROVIDER_UNAVAILABLE','Invalid onboarding list.');
    const states = result.map(parseState);
    if (new Set(states.map(x=>x.step)).size !== states.length)
      throw new OnboardingServiceError('PROVIDER_UNAVAILABLE','Duplicate onboarding entries.');
    return states;
  }

  async setStep(step: OnboardingStep, status: OnboardingStatus): Promise<OnboardingState> {
    if (!validStep(step) || !validStatus(status))
      throw new OnboardingServiceError('VALIDATION','Invalid onboarding step or status.');
    return parseState(await this.request('/rest/v1/rpc/set_private_onboarding_step','POST',{
      p_step:step,p_status:status
    }));
  }
}
