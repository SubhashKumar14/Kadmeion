import test from 'node:test';
import assert from 'node:assert/strict';
import {SupabasePrivateProviderFactsService,PrivateProviderFactsError,parseProviderState,
  type ProviderState,type ProviderSnapshot,type ProviderOperation} from '../../packages/contracts/src/private-provider-facts-service.ts';

const owner='10000000-0000-4000-8000-000000000001',link='20000000-0000-4000-8000-000000000002';
const op='30000000-0000-4000-8000-000000000003',other='40000000-0000-4000-8000-000000000004';
const instant='2026-11-18T12:00:00.000001Z',expires='2026-11-18T12:10:00.000001Z';
const facts:ProviderSnapshot={login:'Dev-Owner',id:42,htmlUrl:'https://github.com/Dev-Owner',
  publicRepos:0,publicGists:2,sourceUrl:'https://api.github.com/users/Dev-Owner',fetchedAt:instant,observedAt:null};
const off:ProviderState={schemaVersion:1,ownerId:owner,linkId:link,provider:'GITHUB',handle:'Dev-Owner',
  version:0,consent:false,status:'OFF',facts:null,candidate:null,candidateExpiresAt:null,
  lastAttemptAt:null,cooldownUntil:null,lastError:null,freshness:'NONE',ownershipVerified:false};
const ready:ProviderState={...off,version:1,consent:true,status:'READY'};
const candidate:ProviderState={...ready,version:3,status:'AWAITING_CONFIRMATION',candidate:facts,
  candidateExpiresAt:expires,lastAttemptAt:instant};
const synced:ProviderState={...ready,version:4,status:'SYNCED',facts,freshness:'FRESH',lastAttemptAt:instant};
const input:ProviderOperation={linkId:link,expectedVersion:0,operationId:op,policyVersion:1};
const endpoint='http://127.0.0.1:54321',key='sb_publishable_fixture_01';
const json=(v:unknown,status=200)=>Response.json(v,{status});
function fixture(http:typeof fetch,guard=()=>true,token:()=>Promise<string|null>=async()=> 'synthetic-token'){
  return new SupabasePrivateProviderFactsService(endpoint,key,owner,token,guard,http);
}
test('C12 isolated transport is explicit, loopback only, nonprivileged and current-owner scoped',async()=>{
  let calls=0,tokens=0;
  const http:typeof fetch=async()=>{calls++;return json(off)};
  const token=async()=>{tokens++;return 'synthetic-token'};
  assert.throws(()=>new SupabasePrivateProviderFactsService(endpoint,key,owner,token,()=>true),{code:'UNAVAILABLE'});
  assert.throws(()=>new SupabasePrivateProviderFactsService(endpoint,key,owner,token,()=>true,globalThis.fetch),{code:'UNAVAILABLE'});
  for(const url of ['https://api.github.com','https://project.supabase.co','http://user@localhost:54321','http://localhost:54321/rpc'])
    assert.throws(()=>new SupabasePrivateProviderFactsService(url,key,owner,token,()=>true,http),{code:'INVALID'});
  assert.throws(()=>new SupabasePrivateProviderFactsService(endpoint,'sb_secret_not_for_client',owner,token,()=>true,http),{code:'INVALID'});
  await assert.rejects(fixture(http,()=>false,token).readState(link),{code:'AUTH_EXPIRED'});
  await assert.rejects(fixture(http,()=>true,token).readState('../invalid'),{code:'INVALID'});
  assert.equal(tokens,0);assert.equal(calls,0);
});
test('C12 exact request and state receipt acknowledge no verification or provider ownership',async()=>{
  let calls=0;
  const service=fixture(async(url,init)=>{
    calls++;assert.equal(String(url),endpoint+'/rest/v1/rpc/read_owner_github_provider_state');
    assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');assert.equal(init?.credentials,'omit');
    const headers=new Headers(init?.headers);
    assert.equal(headers.get('authorization'),'Bearer synthetic-token');assert.equal(headers.get('apikey'),key);
    assert.deepEqual(JSON.parse(String(init?.body)),{p_link_id:link});
    return json(off);
  });
  assert.deepEqual(await service.readState(link),off);assert.equal(calls,1);
  assert.equal(parseProviderState(synced,owner,link).facts!.publicRepos,0);
  for(const bad of [{...synced,ownerId:other},{...synced,linkId:other},{...synced,ownershipVerified:true},
    {...synced,privateProviderToken:'never expose'},{...synced,facts:{...facts,publicRepos:null}},
    {...synced,facts:{...facts,sourceUrl:'https://evil.invalid'}},{...synced,facts:{...facts,login:'Other'}},
    {...synced,facts:{...facts,id:0}},{...synced,facts:{...facts,observedAt:instant}},
    {...synced,consent:false},{...synced,freshness:'NONE'}])
    assert.throws(()=>parseProviderState(bad,owner,link),{code:'INVALID_RESPONSE'});
});
test('C12 exact consent, lookup, confirm, sync and privacy reduction receipts; no automatic provider calls',async()=>{
  const responses=[
    {status:'APPLIED',state:ready},{status:'APPLIED',state:candidate},
    {status:'APPLIED',state:synced},{status:'APPLIED',state:{...synced,version:6}},
    {status:'APPLIED',state:{...off,version:7}},{status:'NO_CHANGE',state:{...off,version:7}}
  ];
  const records:Array<{path:string;body:unknown}>=[];
  const service=fixture(async(url,init)=>{
    records.push({path:new URL(String(url)).pathname,body:JSON.parse(String(init?.body))});
    return json(responses[records.length-1]);
  });
  assert.deepEqual(await service.changeConsent({...input,action:'ENABLE'}),responses[0]);
  assert.deepEqual(await service.sync({...input,expectedVersion:1,action:'LOOKUP'}),responses[1]);
  assert.deepEqual(await service.confirmCandidate({...input,expectedVersion:3}),responses[2]);
  assert.deepEqual(await service.sync({...input,expectedVersion:4,action:'SYNC'}),responses[3]);
  assert.deepEqual(await service.changeConsent({...input,expectedVersion:6,action:'DISABLE'}),responses[4]);
  assert.deepEqual(await service.changeConsent({...input,expectedVersion:7,action:'DISABLE'}),responses[5]);
  assert.deepEqual(records.map(x=>x.path),['/rest/v1/rpc/change_owner_github_provider_consent','/functions/v1/sync-provider-facts',
    '/rest/v1/rpc/confirm_owner_github_provider_candidate','/functions/v1/sync-provider-facts',
    '/rest/v1/rpc/change_owner_github_provider_consent','/rest/v1/rpc/change_owner_github_provider_consent']);
  assert.deepEqual(records[0].body,{p_link_id:link,p_expected_version:0,p_operation_id:op,p_policy_version:1,p_action:'ENABLE'});
  assert.deepEqual(records[1].body,{...input,expectedVersion:1,action:'LOOKUP'});
  assert.deepEqual(records[2].body,{p_link_id:link,p_expected_version:3,p_operation_id:op,p_policy_version:1});
});
test('C12 candidate microsecond expiry and unsafe versions/operation inputs fail closed',async()=>{
  assert.deepEqual(parseProviderState(candidate,owner,link),candidate);
  for(const time of [instant,'2026-11-18T12:10:00.000002Z','2026-02-30T12:00:00Z',null])
    assert.throws(()=>parseProviderState({...candidate,candidateExpiresAt:time},owner,link),{code:'INVALID_RESPONSE'});
  let calls=0;
  const service=fixture(async()=>{calls++;return json(off)});
  const max=Number.MAX_SAFE_INTEGER;
  await assert.rejects(service.changeConsent({...input,expectedVersion:max-1,action:'ENABLE'}),{code:'INVALID'});
  await assert.rejects(service.confirmCandidate({...input,expectedVersion:max-1}),{code:'INVALID'});
  await assert.rejects(service.sync({...input,expectedVersion:max-2,action:'LOOKUP'}),{code:'INVALID'});
  await assert.rejects(service.sync({...input,action:'SYNC',provider:'OTHER'} as never),{code:'INVALID'});
  assert.equal(calls,0);
  const terminal={...off,version:max};
  assert.deepEqual(await fixture(async()=>json({status:'NO_CHANGE',state:terminal})).changeConsent({...input,expectedVersion:max,action:'DISABLE'}),
    {status:'NO_CHANGE',state:terminal});
});
test('C12 rejects forged or inconsistent acknowledgements and never retries on denial',async()=>{
  for(const r of [{status:'APPLIED',state:{...ready,version:2}},{status:'PENDING',state:ready},
    {status:'NO_CHANGE',state:off},{status:'APPLIED',state:{...ready,consent:false}},
    {status:'APPLIED',state:ready,providerVerified:true}]){
    let calls=0;await assert.rejects(fixture(async()=>{calls++;return json(r)}).changeConsent({...input,action:'ENABLE'}),{code:'INVALID_RESPONSE'});
    assert.equal(calls,1);
  }
  for(const [status,code] of [[401,'AUTH_EXPIRED'],[403,'FORBIDDEN'],[409,'CONFLICT'],[413,'LIMIT'],[429,'RATE_LIMITED'],[500,'UNAVAILABLE']] as const){
    let calls=0;await assert.rejects(fixture(async()=>{calls++;return json({message:'secret'},status)}).readState(link),
      {code,message:'Private provider facts: '+code});assert.equal(calls,1);
  }
  await assert.rejects(fixture(async()=>{throw new PrivateProviderFactsError('CONFLICT')}).readState(link),{code:'UNAVAILABLE'});
});
test('C12 decoded duplicate keys, fraction/exponent integers and oversized bodies fail closed',async()=>{
  const wire=JSON.stringify(off);
  for(const body of [wire.replace('"version":0','"version":1,"version":0'),
    wire.replace('"version":0','"ver\\u0073ion":1,"version":0'),
    wire.replace('"version":0','"version":0.00000000000000000000000000000000001'),
    wire.replace('"version":0','"version":0e0')]){
    await assert.rejects(fixture(async()=>new Response(body,{headers:{'content-type':'application/json'}})).readState(link),{code:'INVALID_RESPONSE'});
  }
  for(const bytes of [new Uint8Array(16385),Uint8Array.of(0xff)]){
    await assert.rejects(fixture(async()=>new Response(bytes,{headers:{'content-type':'application/json'}})).readState(link),{code:'INVALID_RESPONSE'});
  }
});
test('C12 owner epoch retirement is permanent after delayed response and denies subsequent requests',async()=>{
  let active=true,calls=0,release!:()=>void,started!:()=>void;
  const began=new Promise<void>(resolve=>{started=resolve});
  const hold=new Promise<void>(resolve=>{release=resolve});
  const service=fixture(async()=>{calls++;started();await hold;return json(off)},()=>active);
  const request=service.readState(link);await began;active=false;release();
  await assert.rejects(request,{code:'AUTH_EXPIRED'});active=true;
  await assert.rejects(service.readState(link),{code:'AUTH_EXPIRED'});assert.equal(calls,1);
});
test('C12 stalled token is bounded and never starts a transport',{timeout:8500},async()=>{
  let calls=0;
  const service=fixture(async()=>{calls++;return json(off)},()=>true,()=>new Promise<string|null>(()=>{}));
  const start=Date.now();
  await assert.rejects(service.readState(link),{code:'UNAVAILABLE'});
  assert.ok(Date.now()-start<7500);assert.equal(calls,0);
});

test('C12 transport rejects wrong final URL and redirected success without projecting facts',async()=>{
  const expected=endpoint+'/rest/v1/rpc/read_owner_github_provider_state';
  for(const patch of [{url:'https://foreign.invalid/rest/v1/rpc/read_owner_github_provider_state'},{redirected:true,url:expected},{url:expected+'?unexpected=1'}]){
    let calls=0;
    const response=json(synced);
    for(const [name,value] of Object.entries(patch))Object.defineProperty(response,name,{value});
    await assert.rejects(fixture(async()=>{calls++;return response}).readState(link),
      (e:unknown)=>e instanceof PrivateProviderFactsError&&['INVALID_RESPONSE','UNAVAILABLE'].includes(e.code));
    assert.equal(calls,1);
  }
  const valid=json(synced);
  Object.defineProperty(valid,'url',{value:expected});
  assert.deepEqual(await fixture(async()=>valid).readState(link),synced);
});
test('C12 identity Content-Length must equal consumed UTF8 bytes, not JS characters',async()=>{
  const body=JSON.stringify(off),size=new TextEncoder().encode(body).length;
  for(const len of [String(size-1),String(size+1),'16385','-1','1.0','1e3']){
    const response=new Response(body,{headers:{'content-type':'application/json','content-length':len}});
    await assert.rejects(fixture(async()=>response).readState(link),{code:'INVALID_RESPONSE'});
  }
  const exact=new Response(body,{headers:{'content-type':'application/json','content-length':String(size),'content-encoding':'identity'}});
  assert.deepEqual(await fixture(async()=>exact).readState(link),off);
});
test('C12 empty-chunk flood must fail before parsing a valid trailing receipt',{timeout:8500},async()=>{
  let pulls=0,cancelled=false,calls=0;
  const encoded=new TextEncoder().encode(JSON.stringify(off));
  // Finite fixture: old unbounded implementation resolves successfully, not a CI hang.
  const body=new ReadableStream<Uint8Array>({pull(c){
    if(++pulls<=8193)c.enqueue(new Uint8Array(0));
    else {c.enqueue(encoded);c.close();}
  },cancel(){cancelled=true;}});
  await assert.rejects(fixture(async()=>{calls++;return new Response(body,{headers:{'content-type':'application/json'}})}).readState(link),
    (e:unknown)=>e instanceof PrivateProviderFactsError&&['INVALID_RESPONSE','UNAVAILABLE'].includes(e.code));
  assert.equal(calls,1);assert.ok(pulls<8193,'Empty chunks cannot consume the entire flood');assert.equal(cancelled,true);
});
test('C12 locked stream and nonsettling cancellation cannot exceed entire RPC deadline',{timeout:8500},async()=>{
  let calls=0,cancels=0;
  const body=new ReadableStream<Uint8Array>({pull(){return new Promise<void>(()=>{})},
    cancel(){cancels++;return new Promise<void>(()=>{})}});
  const start=performance.now();
  await assert.rejects(fixture(async()=>{calls++;return new Response(body,{headers:{'content-type':'application/json'}})}).readState(link),{code:'UNAVAILABLE'});
  assert.ok(performance.now()-start<7500);assert.equal(calls,1);assert.equal(cancels,1);
});

test('C12 persisted provider failures are distinct from private transport errors',async()=>{
  for(const lastError of ['NOT_FOUND','RATE_LIMITED','PROVIDER_UNAVAILABLE','INVALID_SOURCE','IDENTITY_CHANGED'] as const){
    const state:ProviderState={...ready,status:'UNAVAILABLE',lastAttemptAt:instant,lastError};
    assert.deepEqual(parseProviderState(state,owner,link),state);
    assert.deepEqual(await fixture(async()=>json(state)).readState(link),state);
  }
  for(const lastError of ['UNAVAILABLE','AUTH_EXPIRED','FORBIDDEN','CONFLICT','LIMIT','INVALID_RESPONSE','INVALID', '', {code:'PROVIDER_UNAVAILABLE'}]){
    const state={...ready,status:'UNAVAILABLE',lastAttemptAt:instant,lastError};
    assert.throws(()=>parseProviderState(state,owner,link),{code:'INVALID_RESPONSE'});
    await assert.rejects(fixture(async()=>json(state)).readState(link),{code:'INVALID_RESPONSE'});
  }
  let calls=0;
  await assert.rejects(fixture(async()=>{calls++;return json({message:'PROVIDER_UNAVAILABLE'},503)}).readState(link),{code:'UNAVAILABLE'});
  assert.equal(calls,1);
});

test('C12 lookup candidates are valid only in the explicit confirmation state',async()=>{
  assert.deepEqual(parseProviderState(candidate,owner,link),candidate);
  for(const status of ['PENDING','UNAVAILABLE','READY','SYNCED','OFF'] as const){
    const malformed={...candidate,status};
    assert.throws(()=>parseProviderState(malformed,owner,link),{code:'INVALID_RESPONSE'});
    await assert.rejects(fixture(async()=>json(malformed)).readState(link),{code:'INVALID_RESPONSE'});
  }
});

test('C12 completed lookup and confirmation acknowledgements must match actual state transitions',async()=>{
  const lookup={...input,expectedVersion:1,action:'LOOKUP'} as const;
  const confirm={...input,expectedVersion:3};
  const unavailable={...ready,version:3,status:'UNAVAILABLE',lastError:'PROVIDER_UNAVAILABLE'} as const;
  for(const state of [candidate, unavailable]){
    const receipt={status:'APPLIED',state};
    assert.deepEqual(await fixture(async()=>json(receipt)).sync(lookup),receipt);
  }
  for(const state of [{...ready,version:3},{...candidate,status:'PENDING',version:2}]){
    let calls=0;
    await assert.rejects(fixture(async()=>{calls++;return json({status:'APPLIED',state})}).sync(lookup),{code:'INVALID_RESPONSE'});
    assert.equal(calls,1);
  }
  const confirmed={status:'APPLIED',state:synced};
  assert.deepEqual(await fixture(async()=>json(confirmed)).confirmCandidate(confirm),confirmed);
  for(const status of ['PENDING','UNAVAILABLE'] as const){
    let calls=0;
    await assert.rejects(fixture(async()=>{calls++;return json({status:'APPLIED',state:{...synced,status}})}).confirmCandidate(confirm),{code:'INVALID_RESPONSE'});
    assert.equal(calls,1);
  }
});

test('C12 failed refresh retains only stale facts and OFF cannot retain provider failure or facts',async()=>{
  const stale:ProviderState={...synced,status:'UNAVAILABLE',freshness:'STALE',lastError:'PROVIDER_UNAVAILABLE'};
  assert.deepEqual(await fixture(async()=>json(stale)).readState(link),stale);
  const disabled:ProviderState={...off,version:5,cooldownUntil:expires};
  assert.deepEqual(await fixture(async()=>json(disabled)).readState(link),disabled);
  for(const invalid of [{...stale,freshness:'FRESH'},{...stale,lastError:null},
    {...synced,lastError:'RATE_LIMITED'},{...ready,lastError:'NOT_FOUND'},
    {...disabled,lastError:'PROVIDER_UNAVAILABLE'},{...disabled,facts,freshness:'STALE'}]){
    let calls=0;
    await assert.rejects(fixture(async()=>{calls++;return json(invalid)}).readState(link),{code:'INVALID_RESPONSE'});
    assert.equal(calls,1);
  }
});

test('C12 exact PostgREST SQLSTATE conflict is actionable only on an owner RPC without retries',async()=>{
  const envelope={code:'40001',message:'CONFLICT',details:null,hint:null};
  let calls=0;
  await assert.rejects(fixture(async(url)=>{calls++;assert.ok(String(url).endsWith('/rest/v1/rpc/change_owner_github_provider_consent'));return json(envelope,500)}).changeConsent({...input,action:'ENABLE'}),{code:'CONFLICT'});
  assert.equal(calls,1);
  for(const bad of [{...envelope,message:'OTHER'},{...envelope,code:'23505'},
    {...envelope,unexpected:true},{code:'40001',message:'CONFLICT'}]){
    calls=0;
    await assert.rejects(fixture(async()=>{calls++;return json(bad,500)}).changeConsent({...input,action:'ENABLE'}),{code:'UNAVAILABLE'});
    assert.equal(calls,1);
  }
  calls=0;
  await assert.rejects(fixture(async(url)=>{calls++;assert.ok(String(url).endsWith('/functions/v1/sync-provider-facts'));return json(envelope,500)}).sync({...input,expectedVersion:1,action:'LOOKUP'}),{code:'UNAVAILABLE'});
  assert.equal(calls,1);
});

test('C12 malformed duplicate conflict JSON cannot convert an uncertain failure into a safe conflict',async()=>{
  const raw='{"code":"23505","code":"40001","message":"CONFLICT","details":null,"hint":null}';
  let calls=0;
  await assert.rejects(fixture(async()=>{calls++;return new Response(raw,{status:500,headers:{'content-type':'application/json'}})}).changeConsent({...input,action:'ENABLE'}),{code:'UNAVAILABLE'});
  assert.equal(calls,1);
});
