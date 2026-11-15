import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SupabaseMyComponentsService,MyComponentError,type MyComponentInput} from
  '../../packages/contracts/src/private-my-components-service.ts';

const owner='51000000-0000-4000-8000-000000000001';
const stranger='52000000-0000-4000-8000-000000000002';
const operation='53000000-0000-4000-8000-000000000003';
const endpoint='https://test-project.supabase.co';
const input:MyComponentInput={
  operationId:operation,componentKey:'my-title',displayName:'My Heading',
  baseComponentPin:'title-stacked@1',pristineSource:'export const title=1;',
  sourceCode:'export const title=2;',compatibleSlotKinds:['title','text']
};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function version(overrides:Record<string,unknown>={}){
  return {
    id:operation,owner_user_id:owner,component_key:'my-title',version:1,
    display_name:'My Heading',base_component_pin:'title-stacked@1',
    pristine_source:'export const title=1;',source_code:'export const title=2;',
    compatible_slot_kinds:['text','title'],source_sha256:hash('export const title=2;'),
    created_at:'2026-11-15T11:00:00.000Z',...overrides
  };
}
function example(response:(url:string,init:RequestInit)=>Response|Promise<Response>,
  token:()=>Promise<string|null>=async()=> 'owner-token'.repeat(4)){
  const calls:string[]=[];
  const fetcher=async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input),params=init??{};
    calls.push(url);
    assert.ok(url.startsWith(endpoint+'/'));
    assert.equal(params.redirect,'error');assert.equal(params.cache,'no-store');
    assert.equal(params.credentials,'omit');
    assert.equal((params.headers as Record<string,string>).apikey,'sb_publishable_ci_public');
    assert.match((params.headers as Record<string,string>).Authorization,/^Bearer owner-token/);
    return response(url,params);
  };
  return {client:new SupabaseMyComponentsService(endpoint,'sb_publishable_ci_public',
    token,fetcher as typeof fetch),calls};
}
const identity=(url:string)=>url.endsWith('/auth/v1/user');
const receipt=(url:string)=>url.endsWith('/rpc/owner_save_my_component');
const get=(url:string)=>url.endsWith('/rpc/owner_get_my_component_version');
const list=(url:string)=>url.endsWith('/rpc/owner_list_my_component_versions');

test('WF-025 saves immutable owner-owned version using only server-side RPC',async()=>{
  const {client,calls}=example((url,init)=>{
    if(identity(url))return Response.json({id:owner});
    if(receipt(url)){
      assert.equal(init.method,'POST');
      const sent=JSON.parse(String(init.body));
      assert.deepEqual(sent,{
        p_operation_id:operation,p_component_key:'my-title',
        p_display_name:'My Heading',p_base_component_pin:'title-stacked@1',
        p_pristine_source:'export const title=1;',p_source_code:'export const title=2;',
        p_slot_kinds:['text','title']
      });
      assert.ok(!String(init.body).includes('publicExecutionTrusted'));
      return Response.json(version());
    }
    throw Error('Unexpected endpoint');
  });
  const result=await client.saveVersion(input);
  assert.deepEqual(result,version());
  assert.equal(calls.length,2);
  assert.ok(!calls.some(url=>url.includes('/rest/v1/private_my_component_versions?')));
});

test('WF-025 list and get require same verified owner, digest and sorted version history',async()=>{
  const old=version({id:'54000000-0000-4000-8000-000000000004',
    version:2,created_at:'2026-11-15T11:01:00Z'});
  const {client}=example(url=>{
    if(identity(url))return Response.json({id:owner});
    if(list(url))return Response.json({
      status:'OWNER_PRIVATE_COMPONENTS',ownerUserId:owner,
      items:[old,version()],publicExecutionTrusted:false
    });
    if(get(url))return Response.json(version());
    throw Error('Unexpected endpoint');
  });
  assert.deepEqual(await client.listVersions(),[old,version()]);
  assert.deepEqual(await client.getVersion(operation),version());
});

test('WF-025 foreign owner, source hash forgery, extra keys and hidden public trust fail closed',async()=>{
  for(const bad of [
    version({owner_user_id:stranger}),
    version({source_code:'modified'}),
    version({source_sha256:'f'.repeat(64)}),
    version({public_executable:true}),
    version({compatible_slot_kinds:['title','text']}),
    version({version:999})
  ]){
    const {client}=example(url=>{
      if(identity(url))return Response.json({id:owner});
      if(receipt(url))return Response.json(bad);
      throw Error('Unexpected endpoint');
    });
    await assert.rejects(client.saveVersion(input),{code:'INVALID_ACK'});
  }
});

test('WF-025 owner boundary applies to list/get and response ordering',async()=>{
  const forgedList=[
    [version({owner_user_id:stranger})],
    [version(),version()],
    [version({version:1}),version({id:'55000000-0000-4000-8000-000000000005',version:2})]
  ];
  for(const items of forgedList){
    const {client}=example(url=>{
      if(identity(url))return Response.json({id:owner});
      if(list(url))return Response.json({status:'OWNER_PRIVATE_COMPONENTS',
        ownerUserId:owner,items,publicExecutionTrusted:false});
      throw Error('Unexpected endpoint');
    });
    await assert.rejects(client.listVersions(),{code:'INVALID_ACK'});
  }
  const {client}=example(url=>{
    if(identity(url))return Response.json({id:owner});
    if(get(url))return Response.json(null);
    throw Error('Unexpected endpoint');
  });
  assert.equal(await client.getVersion(operation),null,'Foreign component IDs yield no data');
});

test('WF-025 rejects path-injection, unsafe pins, huge or duplicate slot manifest before network',async()=>{
  const {client,calls}=example(()=>{throw Error('No request expected');});
  for(const change of [
    {componentKey:'../other'}, {baseComponentPin:'<script>@1'},
    {compatibleSlotKinds:['title','title']},
    {compatibleSlotKinds:['__proto__']},
    {sourceCode:'x'.repeat(32769)},
    {pristineSource:''},
    {operationId:'bad-id'},
    {displayName:''}
  ]){
    await assert.rejects(client.saveVersion({...input,...change}),{code:'VALIDATION'});
  }
  assert.deepEqual(calls,[]);
});

test('WF-025 a replaced account or invalid Auth response cannot save owned code',async()=>{
  const {client,calls}=example(url=>{
    if(identity(url))return Response.json({id:null});
    throw Error('Unexpected endpoint');
  });
  await assert.rejects(client.saveVersion(input),{code:'AUTH_EXPIRED'});
  assert.deepEqual(calls,[endpoint+'/auth/v1/user']);
  const missing=example(()=>{throw Error('No request expected')},async()=>null);
  await assert.rejects(missing.client.saveVersion(input),{code:'AUTH_EXPIRED'});
  assert.deepEqual(missing.calls,[]);
});

test('WF-025 database uniqueness conflict, quota and fake successful payload are not accepted',async()=>{
  for(const [httpCode,code,expected] of [
    [409,'23505','CONFLICT'],[400,'22023','VALIDATION'],
    [500,'54000','QUOTA'],[403,'42501','FORBIDDEN']
  ] as const){
    const {client}=example(url=>{
      if(identity(url))return Response.json({id:owner});
      if(receipt(url))return Response.json({code},{status:httpCode});
      throw Error('Unexpected endpoint');
    });
    await assert.rejects(client.saveVersion(input),{code:expected});
  }
  const {client}=example(url=>{
    if(identity(url))return Response.json({id:owner});
    if(receipt(url))return Response.json(version({display_name:'Changed name'}));
    throw Error('Unexpected endpoint');
  });
  await assert.rejects(client.saveVersion(input),{code:'INVALID_ACK'});
});

test('WF-025 delayed data response cannot succeed when the browser auth token changes',async()=>{
  let tokenCalls=0;
  const token=async()=>++tokenCalls<3?'owner-token'.repeat(4):'next-token'.repeat(4);
  const {client}=example(url=>{
    if(identity(url))return Response.json({id:owner});
    if(receipt(url))return Response.json(version());
    throw Error('Unexpected endpoint');
  },token);
  await assert.rejects(client.saveVersion(input),{code:'AUTH_EXPIRED'});
});

test('WF-025 malformed or over-limit provider JSON fails without granting access',async()=>{
  const {client}=example(url=>{
    if(identity(url))return Response.json({id:owner});
    if(receipt(url))return new Response(JSON.stringify(version()),{
      headers:{'content-type':'application/json','content-length':'3'}
    });
    throw Error('Unexpected endpoint');
  });
  await assert.rejects(client.saveVersion(input),{code:'INVALID_ACK'});
  const bad=new SupabaseMyComponentsService(endpoint,'sb_publishable_ci_public',
    async()=> 'owner-token'.repeat(4),async()=>new Response('not json',{
      headers:{'content-type':'text/plain'}
    }));
  await assert.rejects(bad.listVersions(),{code:'INVALID_ACK'});
});

test('WF-025 service never accepts service role or secret API keys',()=>{
  for(const key of ['sb_secret_dangerous','replace-with-real-key','']){
    assert.throws(()=>new SupabaseMyComponentsService(endpoint,key,
      async()=> 'owner-token'.repeat(4)),MyComponentError);
  }
});
