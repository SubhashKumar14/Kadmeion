import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService, AuthFlowError, safeAfterAuthPath, type AuthPort } from '../../packages/contracts/src/index.ts';

function mockPort(): AuthPort {
  return {
    signUp: async () => ({data:{user:{id:'one'},session:null},error:null}),
    signInWithPassword: async () => ({data:{user:{id:'one'},session:{access_token:'token',user:{id:'one'}}},error:null}),
    getUser: async () => ({data:{user:{id:'one'}},error:null}),
    resetPasswordForEmail: async () => ({data:{},error:null}),
    updateUser: async () => ({data:{user:{id:'one'}},error:null}),
    signOut: async () => ({data:{},error:null}),
    signInWithOAuth: async () => ({data:{url:'https://accounts.google.com/authorize'},error:null}),
    exchangeCodeForSession: async () => ({data:{},error:null})
  };
}

test('registration is fail-closed until email delivery is proven', async () => {
  const service = new AuthService(mockPort(),{siteOrigin:'https://app.example',emailDeliveryVerified:false,googleOAuthConfigured:false});
  await assert.rejects(service.register({email:'user@example.com',password:'strong-password-123',displayName:'Dev',handle:'developer'}),AuthFlowError);
  await assert.rejects(service.requestPasswordReset('user@example.com'),AuthFlowError);
  await assert.rejects(service.googleLogin(),AuthFlowError);
});

test('registration carries untrusted candidate while preserving confirmation semantics', async () => {
  const service = new AuthService(mockPort(),{siteOrigin:'https://app.example',emailDeliveryVerified:true,googleOAuthConfigured:true});
  assert.deepEqual(await service.register({email:'user@example.com',password:'strong-password-123',displayName:'Dev',handle:'DeV_123'}),{
    status:'confirmation_required',handleCandidate:'dev_123'
  });
  assert.deepEqual(await service.login('user@example.com','password'),{id:'one'});
  await service.requestPasswordReset('user@example.com');
  await service.updatePassword('strong-password-456');
  await service.logout('local');
});

test('post-auth redirect returns only internal allowlisted routes', () => {
  assert.equal(safeAfterAuthPath('/workspace/projects?tab=saved'),'/workspace/projects?tab=saved');
  for (const input of ['https://evil.example','//evil.example','/admin','/workspace\\evil','/workspace%2f%2fevil'])
    assert.equal(safeAfterAuthPath(input),'/workspace');
});
