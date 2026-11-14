import test from 'node:test';
import assert from 'node:assert/strict';
import {completePrivateAssetRegistration} from '../../packages/storage-adapters/src/private-asset-registration-completion.ts';

const assetId='123e4567-e89b-42d3-a456-426614174000';
test('completion invokes trusted attestor and keeps release and deletion disabled',async()=>{
  let called=0;
  const receipt=await completePrivateAssetRegistration({
    attest:async(id:string,jwt:string)=>{called++;assert.equal(id,assetId);assert.equal(jwt,'owner-token');return {assetId:id,status:'WRITE_ONCE_ATTESTED' as const};}
  },{assetId,ownerJwt:'owner-token',registrationCommitted:true});
  assert.equal(called,1);
  assert.equal(receipt.publicPublishingAllowed,false);
  assert.equal(receipt.accountDeletionAllowed,false);
  assert.equal(Object.isFrozen(receipt),true);
});
test('uncommitted registration fails before privileged work',async()=>{
  let called=false;
  await assert.rejects(completePrivateAssetRegistration({
    attest:async()=>{called=true;return {assetId,status:'WRITE_ONCE_ATTESTED' as const};}
  },{assetId,ownerJwt:'owner-token',registrationCommitted:false as true}),{code:'VALIDATION'});
  assert.equal(called,false);
});
test('forged completion receipt fails closed',async()=>{
  await assert.rejects(completePrivateAssetRegistration({
    attest:async()=>({assetId:'123e4567-e89b-42d3-a456-426614174001',status:'WRITE_ONCE_ATTESTED' as const})
  },{assetId,ownerJwt:'owner-token',registrationCommitted:true}),{code:'INTEGRITY'});
});
test('attestation failure propagates without success',async()=>{
  await assert.rejects(completePrivateAssetRegistration({
    attest:async()=>{throw new Error('provider failed');}
  },{assetId,ownerJwt:'owner-token',registrationCommitted:true}),/provider failed/);
});
