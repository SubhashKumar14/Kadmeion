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
