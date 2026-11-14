import test from 'node:test';
import assert from 'node:assert/strict';
import {SupabasePrivateIdentityService,PrivateIdentityError} from '../../packages/contracts/src/index.ts';

const userId='10000000-0000-4000-8000-000000000001';
function serviceMock(record:{paths:string[];methods:string[];authorization:string[]}):SupabasePrivateIdentityService {
  const mock=async (resource: RequestInfo|URL,opts?:RequestInit)=>{
    const url=new URL(String(resource));
    record.paths.push(url.pathname+url.search);
    record.methods.push(opts?.method??'GET');
    const headers=opts?.headers as Record<string,string>;
    record.authorization.push(headers.Authorization);
    if(url.pathname==='/auth/v1/user')
      return new Response(JSON.stringify({id:userId,email_confirmed_at:null}),{status:200});
    if(url.pathname==='/rest/v1/profiles'){
      const body=JSON.parse(opts?.body as string);
      return new Response(JSON.stringify([{user_id:userId,handle:body.handle}]),{status:200});
    }
    return new Response(JSON.stringify([{user_id:userId}]),{status:201});
  };
  return new SupabasePrivateIdentityService('https://test.supabase.co','public-key',async()=> 'user-token',mock as typeof fetch);
}

test('claims a normalized handle only after checking user JWT against Auth API',async()=>{
  const record={paths:[] as string[],methods:[] as string[],authorization:[] as string[]};
  const service=serviceMock(record);
  assert.deepEqual(await service.claimHandle('  My_Handle '),{handle:'my_handle'});
  assert.deepEqual(record.paths,['/auth/v1/user','/rest/v1/profiles?user_id=eq.'+userId]);
  assert.equal(record.authorization.every(x=>x==='Bearer user-token'),true);
});

test('public identity request remains an intent, never a publication claim',async()=>{
  const record={paths:[] as string[],methods:[] as string[],authorization:[] as string[]};
  const service=serviceMock(record);
  const status=await service.requestPublicIdentity({
    shareDisplayName:true,shareHeadline:false,shareBio:false,publicationRequested:true
  });
  assert.equal(status,'saved_private_intent');
  assert.equal(record.paths.at(-1)?.startsWith('/rest/v1/profile_sharing_preferences?'),true);
});

test('a missing access token fails closed',async()=>{
  const service=new SupabasePrivateIdentityService('https://test.supabase.co','public-key',async()=>null);
  await assert.rejects(service.claimHandle('sample'),PrivateIdentityError);
});

test('after confirmation a private profile claims its signup handle candidate only once',async()=>{
  const calls:string[]=[];
  const fetcher=(async(resource:RequestInfo|URL,opts?:RequestInit)=>{
    const url=new URL(String(resource));
    calls.push((opts?.method??'GET')+' '+url.pathname);
    if(url.pathname==='/auth/v1/user')
      return new Response(JSON.stringify({id:userId,email_confirmed_at:'2026-11-13T00:00:00Z',
        user_metadata:{handle_candidate:'my_handle'}}),{status:200});
    if(opts?.method==='GET')
      return new Response(JSON.stringify([{user_id:userId,handle:null}]),{status:200});
    const body=JSON.parse(String(opts?.body));
    return new Response(JSON.stringify([{user_id:userId,handle:body.handle}]),{status:200});
  }) as typeof fetch;
  const svc=new SupabasePrivateIdentityService('https://test.supabase.co','public-key',async()=> 'user-token',fetcher);
  assert.deepEqual(await svc.completeInitialIdentity(),{status:'claimed',handle:'my_handle',emailVerified:true});
  assert.deepEqual(calls,['GET /auth/v1/user','GET /rest/v1/profiles','PATCH /rest/v1/profiles']);
});
test('existing persisted handle wins over editable, untrusted metadata',async()=>{
  const calls:string[]=[];
  const svc=new SupabasePrivateIdentityService('https://test.supabase.co','public-key',async()=> 'token',
    (async(resource:RequestInfo|URL,opts?:RequestInit)=>{
      const url=new URL(String(resource));calls.push(opts?.method??'GET');
      if(url.pathname==='/auth/v1/user')
        return new Response(JSON.stringify({id:userId,email_confirmed_at:null,
          user_metadata:{handle_candidate:'attacker'}}),{status:200});
      return new Response(JSON.stringify([{user_id:userId,handle:'real_owner'}]),{status:200});
    }) as typeof fetch);
  assert.deepEqual(await svc.completeInitialIdentity(),{status:'claimed',handle:'real_owner',emailVerified:false});
  assert.deepEqual(calls,['GET','GET']);
});
test('missing or invalid handle candidate requires user choice without fake success',async()=>{
  const svc=new SupabasePrivateIdentityService('https://test.supabase.co','public-key',async()=> 'token',
    (async(resource:RequestInfo|URL)=>{
      return new Response(JSON.stringify(String(resource).includes('/auth/v1/user')
        ?{id:userId,user_metadata:{handle_candidate:'@invalid!!'}}
        :[{user_id:userId,handle:null}]),{status:200});
    }) as typeof fetch);
  assert.deepEqual(await svc.completeInitialIdentity(),{status:'needs_handle',emailVerified:false});
});
test('authoritative duplicate handle conflict is surfaced rather than claiming account completion',async()=>{
  const svc=new SupabasePrivateIdentityService('https://test.supabase.co','public-key',async()=> 'token',
    (async(resource:RequestInfo|URL,opts?:RequestInit)=>{
      const url=new URL(String(resource));
      if(url.pathname==='/auth/v1/user')
        return new Response(JSON.stringify({id:userId,user_metadata:{handle_candidate:'taken'}}),{status:200});
      if(opts?.method==='GET')return new Response(JSON.stringify([{user_id:userId,handle:null}]),{status:200});
      return new Response(JSON.stringify({code:'23505'}),{status:409});
    }) as typeof fetch);
  assert.deepEqual(await svc.completeInitialIdentity(),{status:'handle_conflict',requestedHandle:'taken',emailVerified:false});
});


const platformUrl='https://github.com/Owner-Name';
const platformRow={
  id:'20000000-0000-4000-8000-000000000002',owner_user_id:userId,
  provider:'GITHUB',handle:'Owner-Name',profile_url:platformUrl,
  provenance:'USER_SUPPLIED',connection_mode:'LINK_ONLY',sync_status:'NOT_SYNCED',
  ownership_verified:false,created_at:'2026-11-15T00:00:00Z',updated_at:'2026-11-15T00:00:00Z'
};
function platformMock(handle:(url:URL,options:RequestInit|undefined)=>Response):SupabasePrivateIdentityService {
  const fn=(async(url:RequestInfo|URL,options?:RequestInit)=>{
    const u=new URL(String(url));
    if(u.pathname==='/auth/v1/user')return Response.json({id:userId,email_confirmed_at:null});
    return handle(u,options);
  }) as typeof fetch;
  return new SupabasePrivateIdentityService('https://test.supabase.co',
    'sb_publishable_test',async()=> 'owner-jwt',fn);
}
test('six platform links are owner-JWT-only and create no external provider call',async()=>{
  let posts=0;
  const client=platformMock((url,init)=>{
    posts++;
    assert.equal(url.pathname,'/rest/v1/private_platform_links');
    assert.equal(init?.method,'POST');
    assert.deepEqual(JSON.parse(String(init?.body)),{provider:'GITHUB',handle:'Owner-Name'});
    const headers=init?.headers as Record<string,string>;
    assert.equal(headers.Authorization,'Bearer owner-jwt');
    assert.equal(headers.apikey,'sb_publishable_test');
    assert.equal(init?.credentials,'omit');
    assert.equal(init?.redirect,'error');
    return Response.json([platformRow]);
  });
  assert.deepEqual(await client.connectPlatform('GITHUB',' Owner-Name '),platformRow);
  assert.equal(posts,1);
});
test('list, handle update and disconnect require owner-bound, verified provider receipts',async()=>{
  const paths:string[]=[];
  const client=platformMock((url,init)=>{
    paths.push((init?.method??'GET')+' '+url.pathname+url.search);
    if(init?.method==='GET')return Response.json([platformRow]);
    if(init?.method==='PATCH'){
      assert.deepEqual(JSON.parse(String(init.body)),{handle:'Owner-Name'});
      return Response.json([platformRow]);
    }
    assert.equal(init?.method,'DELETE');
    assert.equal((init.headers as Record<string,string>).Prefer,'return=representation');
    return Response.json([platformRow]);
  });
  assert.deepEqual(await client.listPlatformConnections(),[platformRow]);
  assert.equal((await client.changePlatformHandle('GITHUB','Owner-Name')).handle,'Owner-Name');
  assert.deepEqual(await client.disconnectPlatform('GITHUB'),{provider:'GITHUB',deleted:true});
  assert.ok(paths[1].includes('owner_user_id=eq.'+userId));
  assert.ok(paths[2].includes('owner_user_id=eq.'+userId));
});
test('no false verification, no forged ownership, no URLs outside trusted profiles',async()=>{
  for(const bad of [
    {...platformRow,ownership_verified:true},
    {...platformRow,sync_status:'SYNCED'},
    {...platformRow,connection_mode:'OAUTH'},
    {...platformRow,provenance:'PROVIDER_VERIFIED'},
    {...platformRow,profile_url:'https://attacker.invalid/Owner-Name'},
    {...platformRow,owner_user_id:'30000000-0000-4000-8000-000000000003'},
    {...platformRow,private_access_token:'secret'}
  ]){
    const svc=platformMock(()=>Response.json([bad]));
    await assert.rejects(svc.connectPlatform('GITHUB','Owner-Name'),
      {code:'PROVIDER_UNAVAILABLE'});
  }
});
test('unsafe and unsupported platform handles and origins fail before sending to providers',async()=>{
  let calls=0;
  const svc=platformMock(()=>{calls++;throw Error('should not reach');});
  for(const handle of ['../profile','a/b','http://example.com/a','a#fragment','Owner Name','-bad']){
    await assert.rejects(svc.connectPlatform('GITHUB',handle),{code:'VALIDATION'});
  }
  await assert.rejects(svc.connectPlatform('UNSUPPORTED' as never,'sample'),{code:'VALIDATION'});
  assert.equal(calls,0);
  for(const origin of ['https://user:pw@test.supabase.co','https://test.supabase.co/rpc',
    'https://test.supabase.co/?key=1']){
    assert.throws(()=>new SupabasePrivateIdentityService(origin,'key',async()=>null),
      {code:'VALIDATION'});
  }
});
test('an owner cannot be told a missing provider connection was deleted',async()=>{
  const svc=platformMock(()=>Response.json([]));
  await assert.rejects(svc.disconnectPlatform('KAGGLE'),{code:'PROVIDER_UNAVAILABLE'});
});
