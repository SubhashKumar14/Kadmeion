import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHandle, normalizeExternalHttpsUrl, ContractError, isSafeSupabaseClientKey } from '../../packages/contracts/src/index.ts';

test('handles normalize and reject reserved, malformed and overlong names', () => {
  assert.equal(normalizeHandle('  Dev_123  '), 'dev_123');
  for (const value of ['admin', 'API', 'app', 'r', 'signin', 'register', 'status',
    'workspace', 'ab', '2start', 'with-dash', 'a'.repeat(31), '', null]) {
    assert.throws(() => normalizeHandle(value), ContractError);
  }
});

test('external links accept HTTPS and reject credentials or private destinations', () => {
  assert.equal(normalizeExternalHttpsUrl('https://example.com/project'), 'https://example.com/project');
  for (const value of ['http://example.com', 'javascript:alert(1)', 'https://me:pw@example.com',
    'https://127.0.0.1', 'https://192.168.1.1', 'https://localhost', 'https://internal.local',
    'https://example.com/\nsecret', 'not a url', 1]) {
    assert.throws(() => normalizeExternalHttpsUrl(value), ContractError);
  }
});

test('public key guard rejects legacy privileged JWT and modern secret keys',()=>{
 const jwt=(role:string)=>['eyJhbGciOiJIUzI1NiJ9',
   Buffer.from(JSON.stringify({role})).toString('base64url'),
   'c2lnbmF0dXJl'].join('.');
 for(const good of ['sb_publishable_test',jwt('anon')])
   assert.equal(isSafeSupabaseClientKey(good),true);
 for(const bad of [
   jwt('service_role'),jwt('supabase_admin'),'sb_secret_private',
   'sb_service_role_private','eyJmalformed',' sb_publishable_spaced ',''
 ])assert.equal(isSafeSupabaseClientKey(bad),false);
});
