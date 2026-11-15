import assert from 'node:assert/strict';
import test from 'node:test';
import {SupabasePrivatePlatformLinksService} from '../../packages/contracts/src/private-platform-links-service.ts';

const base='https://unit.supabase.co';
const owner='90000000-0000-4000-8000-000000000001';
const id='90000000-0000-4000-8000-000000000002';
const now='2026-11-15T12:00:00Z';
const link={id,owner_user_id:owner,provider:'GITHUB',handle:'developer-name',
  profile_url:'https://github.com/developer-name',provenance:'USER_SUPPLIED',
  connection_mode:'LINK_ONLY',sync_status:'NOT_SYNCED',ownership_verified:false,
  created_at:now,updated_at:now} as const;
const client=(http:typeof fetch,token:()=>Promise<string|null>=async()=> 'signed-in-owner')=>
  new SupabasePrivatePlatformLinksService(base,'sb_publishable_key',owner,token,http);
test('server-derived LINK_ONLY profile is read without an OAuth or provider request',async()=>{
  const port=client(async(url,init)=>{
    assert.match(String(url),/private_platform_links\?select=/);
    assert.match(String(url),/owner_user_id=eq\.90000000/);
    assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer signed-in-owner');
    assert.equal(init?.cache,'no-store');
    assert.equal(init?.credentials,'omit');
    return Response.json([link]);
  });
  assert.deepEqual(await port.list(),[link]);
});
test('creation stores only the provider and manual handle, never a claimed verification status',async()=>{
  const port=client(async(_url,init)=>{
    assert.equal(init?.method,'POST');
    assert.deepEqual(JSON.parse(String(init?.body)),{provider:'GITHUB',handle:'developer-name'});
    return Response.json([link],{status:201});
  });
  assert.equal((await port.save('GITHUB','developer-name')).ownership_verified,false);
});
test('editing and removing use owner and row filters and require exact receipts',async()=>{
  let step=0;
  const port=client(async(url,init)=>{
    assert.match(String(url),/id=eq\.90000000/);
    assert.match(String(url),/owner_user_id=eq\.90000000/);
    if(step++===0){assert.equal(init?.method,'PATCH');return Response.json([{...link,handle:'new-name',profile_url:'https://github.com/new-name'}]);}
    assert.equal(init?.method,'DELETE');
    return Response.json([link]);
  });
  assert.equal((await port.save('GITHUB','new-name',link)).handle,'new-name');
  assert.equal(await port.remove(link),id);
});
test('owner, provider, origin, URL and forged verification data always reject',async()=>{
  for(const forged of [
    {...link,owner_user_id:'80000000-0000-4000-8000-000000000008'},
    {...link,profile_url:'https://evil.invalid/developer-name'},
    {...link,ownership_verified:true},
    {...link,sync_status:'SYNCED'},
    {...link,private_email:'private@testing.invalid'}
  ])await assert.rejects(client(async()=>Response.json([forged])).list(),{code:'INVALID_ACK'});
  await assert.rejects(client(async()=>Response.json([link,link])).list(),{code:'INVALID_ACK'});
  await assert.rejects(client(async()=>Response.json([link])).save('GITHUB','../unsafe'),{code:'VALIDATION'});
  await assert.rejects(client(async()=>Response.json([link])).save('GITHUB','invalid--handle'),{code:'VALIDATION'});
  assert.throws(()=>new SupabasePrivatePlatformLinksService('http://untrusted.invalid','sb_publishable_key',owner,async()=>null),
    {code:'VALIDATION'});
});
test('service denies absent owner JWT and insecure provider responses',async()=>{
  await assert.rejects(client(async()=>{throw new Error('No provider request');},async()=>null).list(),
    {code:'AUTH_EXPIRED'});
  await assert.rejects(client(async()=>Response.json([], {status:403})).list(),{code:'FORBIDDEN'});
  await assert.rejects(client(async()=>new Response('<html>deny</html>', {headers:{'content-type':'text/html'}})).list(),
    {code:'INVALID_ACK'});
  await assert.rejects(client(async()=>{throw new Error('network');}).list(),{code:'PROVIDER_UNAVAILABLE'});
});
