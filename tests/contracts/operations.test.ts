import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEditorOperation, assertBaseRevision, isPublishEligible, ContractError } from '../../packages/contracts/src/index.ts';

const operation = {
  opId: '68e6a10d-64ca-47c9-89fe-2244b9397e58',
  portfolioId: 'bb68efc5-d05c-42ad-8e68-5b04f956d0f9',
  baseRevision: 5, intent: 'CLEAR_SLOT',
  target: { sectionId: 'hero_01', slotId: 'title' }
};

test('typed operations reject stale revisions, invalid slots and incomplete component assignment', () => {
  assert.deepEqual(validateEditorOperation(operation), operation);
  assert.throws(() => validateEditorOperation({ ...operation, baseRevision: -1 }), ContractError);
  assert.throws(() => validateEditorOperation({ ...operation, target: { ...operation.target, slotId: '../secret' } }), ContractError);
  assert.throws(() => validateEditorOperation({ ...operation, intent: 'ASSIGN_COMPONENT' }), ContractError);
  assertBaseRevision(5, 5);
  assert.throws(() => assertBaseRevision(5, 6), { code: 'REVISION_CONFLICT' });
});

test('publishing stays disabled without verified host and trusted release', () => {
  const preflight = { revision: 0, blockers: [], warnings: [], verifiedHost: false, containsUntrustedJavaScript: false };
  assert.equal(isPublishEligible(preflight), false);
  assert.equal(isPublishEligible({ ...preflight, verifiedHost: true, blockers: ['Missing title'] }), false);
  assert.equal(isPublishEligible({ ...preflight, verifiedHost: true, containsUntrustedJavaScript: true }), false);
  assert.equal(isPublishEligible({ ...preflight, verifiedHost: true }), true);
});
