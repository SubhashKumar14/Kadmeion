import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthRedirect } from '../../apps/auth-web/src/auth-redirect.ts';

test('detects invite and recovery implicit fragment with no URL validation bypass', () => {
  const invite = parseAuthRedirect('http://localhost:3000/#access_token=secret&refresh_token=refresh&type=invite');
  assert.equal(invite.kind, 'tokens');
  if (invite.kind === 'tokens') {
    assert.equal(invite.parameters.get('type'), 'invite');
    assert.equal(invite.parameters.get('access_token'), 'secret');
  }
  const recovery = parseAuthRedirect('http://localhost:3000/reset-password#access_token=token&refresh_token=refresh&type=recovery');
  assert.equal(recovery.kind, 'tokens');
});

test('recognizes token-hash email templates and malformed OAuth callback safely', () => {
  assert.deepEqual(parseAuthRedirect('http://localhost:3000/auth/callback?token_hash=xyz&type=invite'), {
    kind: 'token_hash', tokenHash: 'xyz', type: 'invite'
  });
  assert.deepEqual(parseAuthRedirect('http://localhost:3000/auth/callback?code=secret'), { kind: 'oauth_code', code: 'secret' });
  assert.equal(parseAuthRedirect('http://localhost:3000/login?code=secret').kind, 'error');
});

test('never surfaces provider error descriptions or secret values in a message', () => {
  const result = parseAuthRedirect('http://localhost:3000/auth/callback?error=access_denied&error_description=private_secret');
  assert.equal(result.kind, 'error');
  if (result.kind === 'error') assert.equal(result.message.includes('private_secret'), false);
  assert.deepEqual(parseAuthRedirect('http://localhost:3000/login'), { kind: 'none' });
});
