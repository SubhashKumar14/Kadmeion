import {createHash} from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_HTML_BYTES = 750_000;

type VerificationOperation = 'service_acknowledge_unlisted_release' |
  'service_recover_failed_unlisted_release';
type PublicationOperation = VerificationOperation | 'service_prepare_unlisted_release' |
  'service_probe_unlisted_release' | 'service_activate_unlisted_release';

type VerificationPorts = {
  origin: string;
  rpc: (operation: VerificationOperation, input: Record<string, string>) => Promise<unknown>;
  http?: typeof fetch;
};

type Activation = {
  portfolioId: string;
  intentId: string;
  htmlSha256: string;
};

export type DeliveryVerification =
  | {status: 'DELIVERY_ACKNOWLEDGED'; htmlSha256: string}
  | {status: 'DELIVERY_REVOKED'}
  | {status: 'PRIOR_RELEASE_RESTORED'; releaseGeneration: number};

async function digestHtml(response: Response): Promise<string | null> {
  if (response.status !== 200 || !response.body ||
      !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') ?? '') ||
      !/(?:^|,)\s*no-store\s*(?:,|$)/i.test(response.headers.get('cache-control') ?? '') ||
      !/(?:^|,)\s*noindex\s*(?:,|$)/i.test(response.headers.get('x-robots-tag') ?? '')) {
    await response.body?.cancel();
    return null;
  }

  const hash = createHash('sha256');
  const reader = response.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_HTML_BYTES) {
        await reader.cancel();
        return null;
      }
      hash.update(chunk.value);
    }
    return size > 0 ? hash.digest('hex') : null;
  } finally {
    reader.releaseLock();
  }
}

/** Trusted worker only. The configured origin must come from server configuration. */
export async function verifyActivatedUnlistedRelease(
  activation: Activation,
  {origin, rpc, http = fetch}: VerificationPorts
): Promise<DeliveryVerification> {
  const {portfolioId, intentId, htmlSha256} = activation;
  const host = deliveryHost(origin);
  if (!UUID.test(portfolioId) || !UUID.test(intentId) || !SHA256.test(htmlSha256)) {
    throw new Error('Invalid trusted release verification input.');
  }

  const route = new URL('/api/unlisted', host);
  route.searchParams.set('portfolioId', portfolioId);
  let actualDigest: string | null;
  try {
    actualDigest = await digestHtml(await http(route, {
      method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(5_000)
    }));
  } catch {
    actualDigest = null;
  }

  if (actualDigest === htmlSha256) {
    const ack = await rpc('service_acknowledge_unlisted_release', {
      p_portfolio_id: portfolioId, p_intent_id: intentId, p_html_sha256: htmlSha256
    });
    if (ack !== true) throw new Error('Release delivery acknowledgment was not confirmed.');
    return {status: 'DELIVERY_ACKNOWLEDGED', htmlSha256};
  }

  const receipt = await rpc('service_recover_failed_unlisted_release', {
    p_portfolio_id: portfolioId, p_failed_intent_id: intentId
  });
  if (typeof receipt !== 'object' || receipt === null ||
      !('portfolioId' in receipt) || receipt.portfolioId !== portfolioId ||
      !('status' in receipt) || !('releaseGeneration' in receipt)) {
    throw new Error('Release delivery recovery was not confirmed.');
  }
  if (receipt.status === 'REVOKED' && receipt.releaseGeneration === null) {
    return {status: 'DELIVERY_REVOKED'};
  }
  const generation = receipt.releaseGeneration;
  if (receipt.status === 'RESTORED_NEEDS_EXTERNAL_HTTP_VERIFICATION' &&
      typeof generation === 'number' && Number.isSafeInteger(generation) && generation > 0) {
    return {status: 'PRIOR_RELEASE_RESTORED', releaseGeneration: generation};
  }
  throw new Error('Release delivery recovery was not confirmed.');
}

function deliveryHost(origin: string): URL {
  const host = new URL(origin);
  if ((host.protocol !== 'https:' &&
       !(host.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(host.hostname))) ||
      host.username || host.password || host.pathname !== '/' || host.search || host.hash) {
    throw new Error('Invalid trusted release delivery origin.');
  }
  return host;
}

/** Run for an owner consent ID already recorded by Supabase. Retry with the same ID. */
export async function publishConsentedUnlistedRelease(
  intentId: string,
  ports: Omit<VerificationPorts, 'rpc'> & {
    rpc: (operation: PublicationOperation, input: Record<string, string | number>) => Promise<unknown>;
  }
): Promise<DeliveryVerification> {
  deliveryHost(ports.origin);
  if (typeof intentId !== 'string' || !UUID.test(intentId)) throw new Error('Invalid publication consent.');

  const {rpc} = ports;
  const prepared = await rpc('service_prepare_unlisted_release', {p_intent_id: intentId});
  if (!record(prepared) || typeof prepared.portfolioId !== 'string' || !UUID.test(prepared.portfolioId) ||
      typeof prepared.htmlSha256 !== 'string' || !SHA256.test(prepared.htmlSha256) ||
      typeof prepared.releaseGeneration !== 'number' || !Number.isSafeInteger(prepared.releaseGeneration) ||
      prepared.releaseGeneration < 1 || prepared.publicServingEnabled !== false || prepared.publicUrl !== null) {
    throw new Error('Unlisted release preparation was not confirmed.');
  }
  const {portfolioId, htmlSha256, releaseGeneration} = prepared;
  switch (prepared.status) {
    case 'ACKNOWLEDGED':
      return {status: 'DELIVERY_ACKNOWLEDGED', htmlSha256};
    case 'AWAITING_VERIFICATION':
      break;
    case 'PROBE_PENDING': {
      const probe = await rpc('service_probe_unlisted_release', {p_portfolio_id: portfolioId});
      if (!record(probe) || probe.status !== 'PROBE_PENDING' ||
          probe.intentId !== intentId || probe.releaseGeneration !== releaseGeneration ||
          probe.htmlSha256 !== htmlSha256 || probe.publicServingEnabled !== false ||
          typeof probe.html !== 'string' || Buffer.byteLength(probe.html) > MAX_HTML_BYTES ||
          createHash('sha256').update(probe.html).digest('hex') !== htmlSha256) {
        throw new Error('The private release changed before activation.');
      }
      const active = await rpc('service_activate_unlisted_release', {
        p_portfolio_id: portfolioId, p_expected_generation: releaseGeneration,
        p_intent_id: intentId, p_html_sha256: htmlSha256
      });
      if (!record(active) || active.status !== 'ACTIVATED_NEEDS_EXTERNAL_HTTP_VERIFICATION' ||
          active.portfolioId !== portfolioId || active.releaseGeneration !== releaseGeneration ||
          active.htmlSha256 !== htmlSha256 || active.publicUrl !== null ||
          active.hostRevocationVerified !== false) {
        throw new Error('Unlisted activation was not confirmed. Retry with the same consent.');
      }
      break;
    }
    default:
      throw new Error('Unexpected unlisted publication status.');
  }
  return verifyActivatedUnlistedRelease({portfolioId, intentId, htmlSha256}, ports);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
