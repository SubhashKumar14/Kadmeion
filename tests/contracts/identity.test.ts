import test from 'node:test';
import assert from 'node:assert/strict';
import { ContractError, identityPreview, normalizeIdentityDraft } from '../../packages/contracts/src/index.ts';

const profile = {
  userId: 'owner-private-uuid', handle: 'dev_001', displayName: 'A Developer',
  headline: 'Builds accessible apps', bio: 'Private project details', onboardingComplete: false
};

test('identity drafts are normalized and constrained', () => {
  assert.deepEqual(normalizeIdentityDraft({ handle: ' Dev_001 ', displayName: ' Dev ', headline: ' Hi ', bio: '' }), {
    handle: 'dev_001', displayName: 'Dev', headline: 'Hi', bio: ''
  });
  assert.throws(() => normalizeIdentityDraft({ handle: 'admin', displayName: 'Dev' }), ContractError);
  assert.throws(() => normalizeIdentityDraft({ handle: 'dev_001', displayName: 'x'.repeat(81) }), ContractError);
  assert.throws(() => normalizeIdentityDraft({ handle: 'dev_001', displayName: 'Bad\u0000' }), ContractError);
});

test('identity stays private without explicit sharing intent', () => {
  const prefs = { shareDisplayName: true, shareHeadline: true, shareBio: true, publicationRequested: false };
  assert.equal(identityPreview(profile, prefs), null);
  assert.equal(identityPreview({ ...profile, handle: null }, { ...prefs, publicationRequested: true }), null);
});

test('public preview strictly projects opted-in fields without private identifiers', () => {
  const result = identityPreview(profile, {
    shareDisplayName: true, shareHeadline: false, shareBio: false, publicationRequested: true
  });
  assert.deepEqual(result, { handle: 'dev_001', displayName: 'A Developer' });
  assert.equal(JSON.stringify(result).includes('userId'), false);
  assert.equal(JSON.stringify(result).includes('Private project'), false);
});
