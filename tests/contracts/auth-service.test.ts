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

test('auth recovery and OAuth use only a normalized, trusted application origin',async()=>{
 const redirects:string[]=[];
 const port=mockPort();
 port.resetPasswordForEmail=async(_email,options)=>{
   redirects.push(options.redirectTo);return {data:{},error:null};
 };
 port.signInWithOAuth=async request=>{
   redirects.push(request.options.redirectTo);
   return {data:{url:'https://accounts.google.com/authorize'},error:null};
 };
 const svc=new AuthService(port,{
   siteOrigin:'https://app.example:443/',emailDeliveryVerified:true,googleOAuthConfigured:true
 });
 await svc.requestPasswordReset('dev@example.com');
 await svc.googleLogin();
 assert.deepEqual(redirects,[
   'https://app.example/reset-password','https://app.example/auth/callback'
 ]);
 for(const unsafe of [
   'http://remote.example','https://user:pass@app.example',
   'https://app.example/foreign','https://app.example?next=evil',
   'https://app.example#fragment','https://app.example\\@attacker.example',
   'https://app.example\n'
 ])assert.throws(()=>new AuthService(mockPort(),{
   siteOrigin:unsafe,emailDeliveryVerified:true,googleOAuthConfigured:true
 }),{code:'VALIDATION'});
 const local=new AuthService(mockPort(),{
   siteOrigin:'http://127.0.0.1:5173',emailDeliveryVerified:false,googleOAuthConfigured:false
 });
 assert.ok(local);
});


test('B10 normalizes thrown provider/network failures without revealing backend details',async()=>{
 const failures=[
  {
   action:(s:AuthService)=>s.register({
     email:'dev@example.com',password:'strong-password',
     displayName:'Dev',handle:'developer'
   }),
   method:'signUp'
  },
  {action:(s:AuthService)=>s.login('dev@example.com','password'),method:'signInWithPassword'},
  {action:(s:AuthService)=>s.requestPasswordReset('dev@example.com'),method:'resetPasswordForEmail'},
  {action:(s:AuthService)=>s.updatePassword('strong-password'),method:'updateUser'},
  {action:(s:AuthService)=>s.logout('others'),method:'signOut'},
  {action:(s:AuthService)=>s.googleLogin(),method:'signInWithOAuth'},
  {action:(s:AuthService)=>s.finishOAuth('valid-code-12345'),method:'exchangeCodeForSession'}
 ] as const;
 for(const item of failures){
   const port=mockPort();
   (port as any)[item.method]=async()=>{throw new Error('SMTP private credential from provider');};
   const service=new AuthService(port,{siteOrigin:'https://app.example',
     emailDeliveryVerified:true,googleOAuthConfigured:true});
   await assert.rejects(item.action(service),(error:unknown)=>
     error instanceof AuthFlowError&&error.code==='PROVIDER_UNAVAILABLE'&&
     !error.message.includes('credential'));
 }
});

test('B10 refuses incomplete registration and password-update acknowledgements',async()=>{
 const port=mockPort();
 port.signUp=async()=>({data:{user:null,session:null},error:null});
 port.updateUser=async()=>({data:{user:null},error:null});
 const service=new AuthService(port,{siteOrigin:'https://app.example',
   emailDeliveryVerified:true,googleOAuthConfigured:false});
 await assert.rejects(service.register({
   email:'dev@example.com',password:'strong-password',
   displayName:'Dev',handle:'developer'
 }),{code:'AUTH_FAILED'});
 await assert.rejects(service.updatePassword('strong-password'),
   {code:'AUTH_EXPIRED'});
});


test('B10 accepts real Supabase data-less signOut response without false session claims',async()=>{
 const port=mockPort();
 let selected:string|undefined;
 port.signOut=async options=>{
   selected=options?.scope;
   return {error:null};
 };
 const service=new AuthService(port,{siteOrigin:'https://app.example',
   emailDeliveryVerified:false,googleOAuthConfigured:false});
 await service.logout('others');
 assert.equal(selected,'others');
 await service.logout();
 assert.equal(selected,'local');
});


test('confirmation resend requires verified delivery and submits a neutral provider request',async()=>{
  const config={siteOrigin:'https://app.example',emailDeliveryVerified:false,googleOAuthConfigured:false};
  const port=mockPort();
  let attempts=0;
  port.resend=async input=>{
    attempts++;
    assert.deepEqual(input,{type:'signup',email:'dev@example.com',
      options:{emailRedirectTo:'https://app.example/auth/callback'}});
    return {data:{},error:null};
  };
  await assert.rejects(new AuthService(port,config).resendSignupConfirmation('dev@example.com'),
    {code:'PROVIDER_UNAVAILABLE'});
  assert.equal(attempts,0);
  const service=new AuthService(port,{...config,emailDeliveryVerified:true});
  await assert.rejects(service.resendSignupConfirmation('invalid'),{code:'VALIDATION'});
  await service.resendSignupConfirmation(' DEV@example.com ');
  assert.equal(attempts,1);
  port.resend=async()=>{throw Error('private SMTP credentials');};
  await assert.rejects(service.resendSignupConfirmation('dev@example.com'),
    {code:'PROVIDER_UNAVAILABLE',message:'Unable to submit the confirmation request.'});
});

test('B10 password sign-in refuses concurrent account switch or mismatched provider acknowledgement',async()=>{
  for(const variant of ['session','provider'] as const){
    const port=mockPort();
    port.signInWithPassword=async()=>({
      data:{user:{id:variant==='provider'?'wrong-owner':'original-owner'},
        session:{access_token:'signed-token',user:{id:variant==='session'?'wrong-owner':'verified-owner'}}},
      error:null
    });
    port.getUser=async()=>({data:{user:{id:'verified-owner'}},error:null});
    const service=new AuthService(port,{siteOrigin:'https://app.example',
      emailDeliveryVerified:false,googleOAuthConfigured:false});
    await assert.rejects(service.login('dev@example.com','password'),{
      code:'AUTH_EXPIRED',
      message:'The account changed during sign-in. Sign in again.'
    });
  }
  const port=mockPort();
  port.signInWithPassword=async()=>({
    data:{user:{id:'verified-owner'},session:{access_token:'signed-token',user:{id:'verified-owner'}}},
    error:null
  });
  port.getUser=async()=>({data:{user:{id:'verified-owner'}},error:null});
  const service=new AuthService(port,{siteOrigin:'https://app.example',
    emailDeliveryVerified:false,googleOAuthConfigured:false});
  assert.deepEqual(await service.login('dev@example.com','password'),{id:'verified-owner'});
});

test('B10 immediate registration session must be verified for the same user',async()=>{
  const options={siteOrigin:'https://app.example',emailDeliveryVerified:true,googleOAuthConfigured:false};
  const signup={email:'dev@example.com',password:'strong-password',
    displayName:'Developer',handle:'developer'};
  const port=mockPort();
  port.signUp=async()=>({data:{user:{id:'new-owner'},
    session:{access_token:'signup-token',user:{id:'new-owner'}}},error:null});
  port.getUser=async()=>({data:{user:{id:'new-owner'}},error:null});
  const service=new AuthService(port,options);
  assert.deepEqual(await service.register(signup),{status:'signed_in',handleCandidate:'developer'});
  port.getUser=async()=>({data:{user:{id:'other-owner'}},error:null});
  await assert.rejects(service.register(signup),{code:'AUTH_EXPIRED'});
  port.signUp=async()=>({data:{user:{id:'new-owner'},
    session:{access_token:'signup-token',user:{id:'other-owner'}}},error:null});
  await assert.rejects(service.register(signup),{code:'AUTH_EXPIRED'});
  port.signUp=async()=>({data:{user:{id:'new-owner'},
    session:{access_token:'',user:{id:'new-owner'}}},error:null});
  await assert.rejects(service.register(signup),{code:'AUTH_EXPIRED'});
});
