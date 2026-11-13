import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanHandleInput, checkHandleInput, validatePasswordPair } from '../../apps/auth-web/src/form-helpers.ts';

test('handle field accepts a pasted @username and normalizes it without publishing', () => {
  assert.equal(cleanHandleInput(' @SubhashKumar14 '), 'subhashkumar14');
  assert.equal(checkHandleInput(' @SubhashKumar14 '), null);
  assert.equal(checkHandleInput('subhash_kumar14'), null);
  assert.equal(checkHandleInput('invalid-handle'), 'Use 3–30 letters, numbers or underscores, beginning with a letter.');
});
test('handle errors are relevant and reserved names remain rejected', () => {
  assert.match(checkHandleInput('@admin') ?? '', /reserved/);
  assert.match(checkHandleInput('@ab') ?? '', /3–30/);
  assert.equal(checkHandleInput('frontenddev'), null);
});
test('password confirmation uses an 8-character minimum and does not enforce arbitrary symbol rules', () => {
  assert.equal(validatePasswordPair('12345678','12345678'), null);
  assert.match(validatePasswordPair('1234567','1234567') ?? '', /8 and 128/);
  assert.match(validatePasswordPair('abcdefgh','abcdefgi') ?? '', /do not match/);
});
