import test from 'node:test';
import assert from 'node:assert/strict';
import {SupabasePrivateNotificationsService,PrivateNotificationsError}
  from '../../packages/contracts/src/private-notifications-service.ts';

const owner='10000000-0000-4000-8000-000000000001';
const foreign='10000000-0000-4000-8000-000000000099';
const noticeA='20000000-0000-4000-8000-000000000011';
const noticeB='20000000-0000-4000-8000-000000000012';
const target='30000000-0000-4000-8000-000000000001';
const latest='2026-11-15T06:00:00+00:00';
const previous='2026-11-15T05:00:00+00:00';
const receiptTime='2026-11-15T06:05:00+00:00';
const row=(fields:Record<string,unknown>={})=>({
  id:noticeB,owner_user_id:owner,event_type:'RELEASE_VERIFIED',
  category:'PUBLISH',priority:'NORMAL',target_id:target,
  created_at:latest,read_at:null,dismissed_at:null,...fields
});
const prefs={
  owner_user_id:owner,reviewer_enabled:true,publish_enabled:false,sync_enabled:false
};
const create=(http:typeof fetch,token:()=>Promise<string|null>=async()=> 'owner-jwt',
  user=owner)=>new SupabasePrivateNotificationsService(
  'https://unit.supabase.co','sb_publishable_test',user,token,http);
const json=(body:unknown,status=200)=>Response.json(body,{status});

test('owner-JWT-only inbox uses RLS, exact selected fields and no service key',async()=>{
  const calls:Array<{url:URL;options:RequestInit}>=[];
  const client=create(async(input,init)=>{
    calls.push({url:new URL(String(input)),options:init!});
    return json([row()]);
  });
  const page=await client.listPage();
  assert.deepEqual(page,{items:[row()],nextCursor:null});
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.method,'GET');
  assert.equal((calls[0].options.headers as Record<string,string>).Authorization,'Bearer owner-jwt');
  assert.equal((calls[0].options.headers as Record<string,string>).apikey,'sb_publishable_test');
  assert.equal(calls[0].options.credentials,'omit');
  assert.equal(calls[0].options.redirect,'error');
  assert.equal(calls[0].options.cache,'no-store');
  assert.equal(calls[0].url.searchParams.get('dismissed_at'),'is.null');
  assert.equal(calls[0].url.searchParams.get('limit'),'51');
  assert.equal(calls[0].url.searchParams.get('order'),'created_at.desc,id.desc');
  assert.equal(calls[0].url.searchParams.has('owner_user_id'),false,
    'owner identity must come only from the JWT');
});
test('inbox uses timestamp+UUID keyset cursor without re-reading dismissed rows',async()=>{
  const seen:URL[]=[];
  const client=create(async(input)=>{
    const url=new URL(String(input));seen.push(url);
    return seen.length===1?json([
      row(),row({id:noticeA,created_at:previous})
    ]):json([row({id:noticeA,created_at:previous})]);
  });
  const a=await client.listPage(1);
  assert.deepEqual(a.items,[row()]);
  assert.equal(a.nextCursor,latest+'|'+noticeB);
  const b=await client.listPage(1,a.nextCursor);
  assert.deepEqual(b.items,[row({id:noticeA,created_at:previous})]);
  assert.equal(b.nextCursor,null);
  assert.match(seen[1].searchParams.get('or')??'',/created_at\.lt/);
  assert.match(seen[1].searchParams.get('or')??'',new RegExp(noticeB+'\\)'));
});
test('inbox refuses forged tenant, categories, priorities, hidden fields and bad order',async()=>{
  const bad=[
    row({owner_user_id:foreign}),
    row({event_type:'INVENTED'}),
    row({category:'MODERATION'}),
    row({priority:'HIGH'}),
    row({private_note:'secret'}),
    row({dismissed_at:receiptTime}),
    row({read_at:receiptTime,dismissed_at:previous}),
    row({target_id:'../../etc'}),
    row({created_at:'tomorrow'})
  ];
  for(const item of bad){
    await assert.rejects(create(async()=>json([item])).listPage(),{code:'INVALID_ACK'});
  }
  const duplicate=create(async()=>json([row(),row()]));
  await assert.rejects(duplicate.listPage(2),{code:'INVALID_ACK'});
  const unsorted=create(async()=>json([
    row({id:noticeA,created_at:previous}),row({id:noticeB,created_at:latest})
  ]));
  await assert.rejects(unsorted.listPage(2),{code:'INVALID_ACK'});
});
test('inbox rejects invalid limits, forged cursors and requests without auth before network',async()=>{
  let called=0;
  const mock=async()=>{called++;return json([]);};
  const service=create(mock);
  for(const invalid of [0,51,1.5,NaN,Infinity])
    await assert.rejects(service.listPage(invalid),{code:'VALIDATION'});
  for(const invalid of ['x','2026-11-15|bad','2026-11-15T06:00:00+00:00|../../',
    latest+'|'+noticeA+'|extra','x'.repeat(121)])
    await assert.rejects(service.listPage(50,invalid),{code:'VALIDATION'});
  assert.equal(called,0);
  await assert.rejects(create(mock,async()=>null).listPage(),{code:'AUTH_EXPIRED'});
  assert.equal(called,0);
  assert.throws(()=>new SupabasePrivateNotificationsService(
    'https://unit.supabase.co','sb_secret_do_not_use',owner,async()=> 'owner-jwt'),{
    code:'VALIDATION'
  });
  assert.throws(()=>new SupabasePrivateNotificationsService(
    'http://remote.example','publishable',owner,async()=> 'owner-jwt'),{
    code:'VALIDATION'
  });
});
test('preferences return null for absent row, reject extra owner fields and only allow optional categories',async()=>{
  assert.equal(await create(async()=>json([])).getPreferences(),null);
  assert.deepEqual(await create(async()=>json([prefs])).getPreferences(),prefs);
  for(const wrong of [[{...prefs,owner_user_id:foreign}],[{...prefs,security_enabled:false}],
    [prefs,prefs],[{...prefs,reviewer_enabled:'yes'}]]){
    await assert.rejects(create(async()=>json(wrong)).getPreferences(),{code:'INVALID_ACK'});
  }
  let calls=0;
  const service=create(async(input,options)=>{
    calls++;
    assert.match(String(input),/\/rpc\/owner_set_notification_preferences$/);
    assert.equal(options?.method,'POST');
    assert.deepEqual(JSON.parse(options?.body as string),{
      p_reviewer_enabled:true,p_publish_enabled:false,p_sync_enabled:false
    });
    return json(prefs);
  });
  assert.deepEqual(await service.setPreferences({
    reviewerEnabled:true,publishEnabled:false,syncEnabled:false
  }),prefs);
  assert.equal(calls,1);
  await assert.rejects(service.setPreferences({
    reviewerEnabled:true,publishEnabled:false,syncEnabled:false,
    securityEnabled:false
  } as never),{code:'VALIDATION'});
  assert.equal(calls,1);
  await assert.rejects(create(async()=>json({...prefs,publish_enabled:true}))
    .setPreferences({reviewerEnabled:true,publishEnabled:false,syncEnabled:false}),
    {code:'INVALID_ACK'});
});
test('mark-read and dismiss validate authoritative receipt, owner action and replay',async()=>{
  let calls=0;
  const service=create(async(input,init)=>{
    calls++;
    assert.match(String(input),/\/rpc\/owner_acknowledge_notification$/);
    const body=JSON.parse(init?.body as string);
    assert.equal(body.p_id,noticeA);
    assert.equal(body.p_dismiss,calls===2);
    return json({id:noticeA,read_at:receiptTime,
      dismissed_at:calls===2?receiptTime:null});
  });
  assert.deepEqual(await service.acknowledge(noticeA),{
    id:noticeA,read_at:receiptTime,dismissed_at:null
  });
  assert.deepEqual(await service.acknowledge(noticeA,true),{
    id:noticeA,read_at:receiptTime,dismissed_at:receiptTime
  });
  for(const bad of [
    {id:noticeB,read_at:receiptTime,dismissed_at:null},
    {id:noticeA,read_at:null,dismissed_at:null},
    {id:noticeA,read_at:receiptTime,dismissed_at:null,owner_user_id:owner}
  ]){
    await assert.rejects(create(async()=>json(bad)).acknowledge(noticeA),{code:'INVALID_ACK'});
  }
  await assert.rejects(create(async()=>json({
    id:noticeA,read_at:receiptTime,dismissed_at:null
  })).acknowledge(noticeA,true),{code:'INVALID_ACK'});
  assert.equal(calls,2);
});
test('transport handles denial, oversized payload, wrong content-type and provider outages',async()=>{
  for(const [status,expected] of [[401,'AUTH_EXPIRED'],[403,'FORBIDDEN'],
    [429,'LIMIT_EXCEEDED'],[500,'PROVIDER_UNAVAILABLE']] as const){
    await assert.rejects(create(async()=>json({message:'sensitive'},status)).listPage(),{code:expected});
  }
  await assert.rejects(create(async()=>{throw Error('network');}).listPage(),{
    code:'PROVIDER_UNAVAILABLE'
  });
  for(const res of [
    new Response('[]',{headers:{'content-type':'text/html'}}),
    new Response('[]',{headers:{'content-type':'application/json','content-length':'262145'}}),
    new Response('[]',{headers:{'content-type':'application/json','content-length':'99'}}),
    new Response('invalid',{headers:{'content-type':'application/json'}})
  ]){
    await assert.rejects(create(async()=>res).listPage(),PrivateNotificationsError);
  }
});
