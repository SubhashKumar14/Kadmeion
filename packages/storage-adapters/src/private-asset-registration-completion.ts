/**
 * Server-only completion boundary for a previously committed private asset
 * registration. The attestor independently verifies the committed row and
 * current owner session before any privileged pin. Never import into UI.
 */
import {PrivateServerAssetByteAttestor, PrivateAssetAttestationError} from './private-server-asset-byte-attestor.ts';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type AssetRegistrationCompletion = Readonly<{
  assetId:string;
  ownerJwt:string;
}>;
export type AssetRegistrationCompletionReceipt = Readonly<{
  assetId:string;
  status:'WRITE_ONCE_ATTESTED';
  publicPublishingAllowed:false;
  accountDeletionAllowed:false;
}>;

/**
 * Fail closed: a missing registration commit or attestation error never
 * produces a completion receipt. The attestor independently checks the
 * live owner JWT, registered row, private Storage bytes and immutable pin.
 */
export async function completePrivateAssetRegistration(
  attestor:Pick<PrivateServerAssetByteAttestor,'attest'>,
  input:AssetRegistrationCompletion
):Promise<AssetRegistrationCompletionReceipt> {
  if (!input || typeof input.assetId!=='string'||!UUID.test(input.assetId)||
      typeof input.ownerJwt!=='string'||!input.ownerJwt.trim()) {
    throw new PrivateAssetAttestationError('VALIDATION');
  }
  const result=await attestor.attest(input.assetId,input.ownerJwt);
  if(result.assetId!==input.assetId||result.status!=='WRITE_ONCE_ATTESTED')
    throw new PrivateAssetAttestationError('INTEGRITY');
  return Object.freeze({
    assetId:input.assetId,status:'WRITE_ONCE_ATTESTED',
    publicPublishingAllowed:false,accountDeletionAllowed:false
  });
}
