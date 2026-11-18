import test from 'node:test';
import assert from 'node:assert/strict';
import {SupabasePrivateAnalyticsService,PrivateAnalyticsError} from '../../packages/contracts/src/private-analytics-service.ts';

const owner='10000000-0000-4000-8000-000000000001';
const portfolio='10000000-0000-4000-8000-000000000002';
const other='10000000-0000-4000-8000-000000000003';
const operationId='10000000-0000-4000-8000-000000000004';
const stamp='2026-11-18T12:00:00Z';
const max=Number.MAX_SAFE_INTEGER;
const state={portfolioId:portfolio,enabled:false,eligible:true,version:0,policyVersion:1,
  enabledAt:null,coverageStartedAt:null,updatedAt:null,retentionDays:30};
const change={portfolioId:portfolio,action:'DISABLE' as const,expectedVersion:0,operationId,policyVersion:1 as const};
const receipt={status:'NO_CHANGE',portfolioId:portfolio,version:0,enabled:false,policyVersion:1,
  enabledAt:null,coverageStartedAt:null,updatedAt:null};
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
function fixture(handler:(url:string,init?:RequestInit)=>Response|Promise<Response>){
  let active=true,calls=0,tokens=0;
  const http:typeof fetch=async(input,init)=>{
    calls++;
    const headers=new Headers(init?.headers);
    assert.equal(headers.get('authorization'),'Bearer synthetic-owner-token');
    assert.equal(headers.get('apikey'),'synthetic-publishable-key');
    assert.equal(init?.method,'POST');
    return handler(String(input),init);
  };
  const service=new SupabasePrivateAnalyticsService('https://local.example','synthetic-publishable-key',owner,
    async()=>{tokens++;return 'synthetic-owner-token';},()=>active,http);
  return {service,retire:()=>{active=false;},calls:()=>calls,tokens:()=>tokens};
}

test('C13 state exact wire, absent OFF v0 is not evidence of collection',async()=>{
  const f=fixture((url,init)=>{
    assert.equal(url,'https://local.example/rest/v1/rpc/read_owner_analytics_state');
    assert.deepEqual(JSON.parse(String(init?.body)),{p_portfolio_id:portfolio});
    return response(state);
  });
  assert.deepEqual(await f.service.getOwnerAnalyticsState(portfolio),state);
  assert.equal(f.calls(),1);
});
test('C13 state denies wrong identity, unknown keys, impossible versions and invalid timestamps',async()=>{
  for(const bad of [{portfolioId:other},{extra:true},{version:-1},{version:max+1},{retentionDays:31},
    {enabled:true,version:max,enabledAt:stamp,coverageStartedAt:stamp,updatedAt:stamp},
    {updatedAt:'not-a-date'},{version:1,updatedAt:null}]){
    const f=fixture(()=>response({...state,...bad}));
    await assert.rejects(f.service.getOwnerAnalyticsState(portfolio),{code:'INVALID_RESPONSE'});
    assert.equal(f.calls(),1);
  }
});
test('C13 DISABLE absent OFF is NO_CHANGE, stable operation exact wire without retries',async()=>{
  const f=fixture((url,init)=>{
    assert.equal(url,'https://local.example/rest/v1/rpc/change_owner_analytics');
    assert.deepEqual(JSON.parse(String(init?.body)),{p_portfolio_id:portfolio,p_action:'DISABLE',
      p_expected_version:0,p_operation_id:operationId,p_policy_version:1});
    return response(receipt);
  });
  assert.deepEqual(await f.service.changeOwnerAnalytics(change),receipt);
  assert.equal(f.calls(),1);
});
test('C13 malformed change receipts cannot acknowledge an applied or replayed mutation',async()=>{
  for(const bad of [{portfolioId:other},{version:1},{enabled:true},{status:'UNKNOWN'},{extra:true}]){
    const f=fixture(()=>response({...receipt,...bad}));
    await assert.rejects(f.service.changeOwnerAnalytics(change),{code:'INVALID_RESPONSE'});
    assert.equal(f.calls(),1);
  }
});
test('C13 structured errors sanitized, no automatic retry',async()=>{
  for(const [sql,status,code] of [['22023',400,'INVALID'],['42501',403,'NOT_FOUND_OR_FORBIDDEN'],
    ['40001',500,'CONFLICT'],['23505',409,'CONFLICT'],['55P03',500,'CONFLICT'],
    ['54000',500,'RATE_LIMITED'],['unknown',500,'UNAVAILABLE']] as const){
    const f=fixture(()=>response({code:sql,message:'private diagnostic'},status));
    await assert.rejects(f.service.getOwnerAnalyticsState(portfolio),(error:unknown)=>{
      const e=error as {code?:string;message?:string};
      return e.code===code&&!String(e.message).includes('private diagnostic');
    });
    assert.equal(f.calls(),1);
  }
});
test('C13 retired owner cannot acquire token or expose a delayed private response',async()=>{
  const f=fixture(()=>response(state));f.retire();
  await assert.rejects(f.service.getOwnerAnalyticsState(portfolio),{code:'NOT_FOUND_OR_FORBIDDEN'});
  assert.equal(f.tokens(),0);assert.equal(f.calls(),0);
  let release!: (r:Response)=>void,started!:()=>void;
  const ready=new Promise<void>(r=>{started=r;});
  const late=fixture(()=>{started();return new Promise<Response>(r=>{release=r;});});
  const pending=late.service.getOwnerAnalyticsState(portfolio);
  await ready;late.retire();release(response(state));
  await assert.rejects(pending,{code:'NOT_FOUND_OR_FORBIDDEN'});
});
const days=Array.from({length:7},(_,i)=>({day:'2026-11-'+String(12+i),views:null,buckets:null,quality:'UNAVAILABLE'}));
const comparison={asOfUtc:stamp,fromDay:'2026-11-12',toDay:'2026-11-18',retentionDays:30,
  portfolios:[{portfolioId:portfolio,version:1,coverageStartedAt:'2026-11-12T00:00:00Z',eligible:true,days,quality:'UNAVAILABLE'}]};
const query={portfolioIds:[portfolio],windowDays:7 as const};
test('C13 missing days remain unavailable, exact 7-day comparison request',async()=>{
  const f=fixture((url,init)=>{
    assert.equal(url,'https://local.example/rest/v1/rpc/read_owner_analytics');
    assert.deepEqual(JSON.parse(String(init?.body)),{p_portfolio_ids:[portfolio],p_window_days:7});
    return response(comparison);
  });
  assert.deepEqual(await f.service.getOwnerAnalytics(query),comparison);
});
test('C13 rejects fabricated zeros, missing dates, foreign ids, bucket inconsistencies and extra fields',async()=>{
  const buckets={DIRECT_OR_UNKNOWN:1,SEARCH:0,SOCIAL:0,OTHER_EXTERNAL:0,INTERNAL:0};
  const row=comparison.portfolios[0]!;
  for(const bad of [{...row,portfolioId:other},{...row,days:days.slice(1)},
    {...row,days:[{...days[0],views:0},...days.slice(1)]},
    {...row,quality:'PARTIAL',days:[{...days[0],views:2,buckets,quality:'PARTIAL'},...days.slice(1)]},
    {...row,quality:'PARTIAL',days:[{...days[0],views:251,buckets:{...buckets,DIRECT_OR_UNKNOWN:251},quality:'PARTIAL'},...days.slice(1)]},
    {...row,extra:true}]){
    const f=fixture(()=>response({...comparison,portfolios:[bad]}));
    await assert.rejects(f.service.getOwnerAnalytics(query),{code:'INVALID_RESPONSE'});
  }
});
test('C13 rejects duplicate selection before transport',async()=>{
  const f=fixture(()=>response(comparison));
  await assert.rejects(f.service.getOwnerAnalytics({portfolioIds:[portfolio,portfolio],windowDays:7}),{code:'INVALID'});
  assert.equal(f.calls(),0);
});

test('C13 exact replay, terminal OFF and exhaustion reserve privacy reduction',async()=>{
  const enable={...change,action:'ENABLE' as const};
  const enabled={...receipt,status:'APPLIED',version:1,enabled:true,enabledAt:stamp,coverageStartedAt:stamp,updatedAt:stamp};
  const f=fixture(()=>response(enabled));
  assert.deepEqual(await f.service.changeOwnerAnalytics(enable),enabled);
  const replay={...enabled,status:'REPLAYED'};
  assert.deepEqual(await fixture(()=>response(replay)).service.changeOwnerAnalytics(enable),replay);
  const exhausted=fixture(()=>{throw Error('must not contact transport')});
  for(const action of ['ENABLE','CLEAR'] as const)
    await assert.rejects(exhausted.service.changeOwnerAnalytics({...change,action,expectedVersion:max-1}),{code:'INELIGIBLE'});
  assert.equal(exhausted.calls(),0);
  const last={...receipt,status:'APPLIED',version:max,updatedAt:stamp};
  assert.deepEqual(await fixture(()=>response(last)).service.changeOwnerAnalytics({...change,expectedVersion:max-1}),last);
  const terminal={...last,status:'NO_CHANGE'};
  assert.deepEqual(await fixture(()=>response(terminal)).service.changeOwnerAnalytics({...change,expectedVersion:max}),terminal);
});
test('C13 partial real recorded counts with gaps, exact selected order and coverage',async()=>{
  const buckets={DIRECT_OR_UNKNOWN:248,SEARCH:1,SOCIAL:1,OTHER_EXTERNAL:0,INTERNAL:0};
  const p={...comparison.portfolios[0]!,coverageStartedAt:'2026-11-14T12:00:00Z',quality:'PARTIAL',
    days:[...days.slice(0,2),{...days[2],views:250,buckets,quality:'PARTIAL'},...days.slice(3)]};
  const valid={...comparison,portfolios:[p,{...comparison.portfolios[0]!,portfolioId:other}]};
  const input={portfolioIds:[portfolio,other],windowDays:7 as const};
  assert.deepEqual(await fixture(()=>response(valid)).service.getOwnerAnalytics(input),valid);
  for(const bad of [{...valid,portfolios:[...valid.portfolios].reverse()},
    {...valid,portfolios:[{...p,coverageStartedAt:'2026-11-15T00:00:00Z'},valid.portfolios[1]]},
    {...valid,toDay:'2026-11-19'},{...valid,fromDay:'2026-11-13'}])
    await assert.rejects(fixture(()=>response(bad)).service.getOwnerAnalytics(input),{code:'INVALID_RESPONSE'});
});
test('C13 oversized and malformed byte streams fail closed without transport retry',async()=>{
  const over=fixture(()=>new Response(new Uint8Array(8193),{headers:{'content-type':'application/json'}}));
  await assert.rejects(over.service.getOwnerAnalyticsState(portfolio),{code:'INVALID_RESPONSE'});
  assert.equal(over.calls(),1);
  const large=fixture(()=>new Response(new Uint8Array(131073),{headers:{'content-type':'application/json'}}));
  await assert.rejects(large.service.getOwnerAnalytics(query),{code:'INVALID_RESPONSE'});
  assert.equal(large.calls(),1);
  const invalid=fixture(()=>new Response(Uint8Array.of(0xff),{headers:{'content-type':'application/json'}}));
  await assert.rejects(invalid.service.getOwnerAnalyticsState(portfolio),{code:'INVALID_RESPONSE'});
  const badLength=fixture(()=>new Response(JSON.stringify(state),{headers:{'content-type':'application/json','content-length':'1'}}));
  await assert.rejects(badLength.service.getOwnerAnalyticsState(portfolio),{code:'INVALID_RESPONSE'});
});
test('C13 explicit transport only, 55000 allowlist, rate limits and network sanitization',async()=>{
  const inactive=new SupabasePrivateAnalyticsService('https://local.example','synthetic-publishable-key',owner,
    async()=>{throw Error('must not get token');},()=>true);
  await assert.rejects(inactive.getOwnerAnalyticsState(portfolio),{code:'UNAVAILABLE'});
  for(const [status,raw,code] of [
    [500,{code:'55000',message:'ANALYTICS_TERMINAL'},'INELIGIBLE'],
    [500,{code:'55000',message:'ANALYTICS_INELIGIBLE'},'INELIGIBLE'],
    [500,{code:'55000',message:'secret'},'UNAVAILABLE'],
    [429,{message:'secret'},'RATE_LIMITED'],
    [401,{message:'secret'},'NOT_FOUND_OR_FORBIDDEN']] as const){
    const f=fixture(()=>response(raw,status));
    await assert.rejects(f.service.getOwnerAnalyticsState(portfolio),{code});
    assert.equal(f.calls(),1);
  }
  const network=fixture(()=>{throw Error('secret');});
  await assert.rejects(network.service.getOwnerAnalyticsState(portfolio),{code:'TRANSPORT',message:'Private analytics: TRANSPORT'});
  assert.equal(network.calls(),1);
});

test('C13 rejects duplicate decoded receipt keys, including nested and escaped aliases',async()=>{
  const base=JSON.stringify(state);
  for(const raw of [base.replace('"version":0','"version":777,"version":0'),
    base.replace('"version":0','"ver\\u0073ion":777,"version":0')]){
    const f=fixture(()=>new Response(raw,{headers:{'content-type':'application/json'}}));
    await assert.rejects(f.service.getOwnerAnalyticsState(portfolio),{code:'INVALID_RESPONSE'});
    assert.equal(f.calls(),1);
  }
  const counted={...comparison,portfolios:[{...comparison.portfolios[0]!,quality:'PARTIAL',
    days:[{...days[0],views:1,quality:'PARTIAL',buckets:{DIRECT_OR_UNKNOWN:1,SEARCH:0,SOCIAL:0,OTHER_EXTERNAL:0,INTERNAL:0}},...days.slice(1)]}]};
  const nested=JSON.stringify(counted).replace('"SEARCH":0','"SEARCH":200,"SEARCH":0');
  await assert.rejects(fixture(()=>new Response(nested,{headers:{'content-type':'application/json'}})).service.getOwnerAnalytics(query),
    {code:'INVALID_RESPONSE'});
});
test('C13 untrusted transport exceptions cannot manufacture typed analytics outcomes',async()=>{
  const external=fixture(()=>{throw new PrivateAnalyticsError('CONFLICT');});
  await assert.rejects(external.service.getOwnerAnalyticsState(portfolio),{code:'TRANSPORT'});
  const reader=fixture(()=>new Response(new ReadableStream({start(controller){controller.error(new PrivateAnalyticsError('INELIGIBLE'));}}),
    {headers:{'content-type':'application/json'}}));
  await assert.rejects(reader.service.getOwnerAnalyticsState(portfolio),{code:'TRANSPORT'});
  const token=new SupabasePrivateAnalyticsService('https://local.example','synthetic-publishable-key',owner,
    async()=>{throw new PrivateAnalyticsError('CONFLICT');},()=>true,async()=>{throw Error('must not fetch');});
  await assert.rejects(token.getOwnerAnalyticsState(portfolio),{code:'TRANSPORT'});
});
test('C13 deadline covers a stalled token and a stalled response stream without waiting on cancel',{timeout:16000},async()=>{
  let fetches=0;
  const stuckToken=new SupabasePrivateAnalyticsService('https://local.example','synthetic-publishable-key',owner,
    ()=>new Promise<string|null>(()=>{}),()=>true,async()=>{fetches++;return response(state);});
  const tokenStart=Date.now();
  await assert.rejects(stuckToken.getOwnerAnalyticsState(portfolio),{code:'TRANSPORT'});
  assert.ok(Date.now()-tokenStart<7500);assert.equal(fetches,0);
  let canceled=0;
  const stuck=fixture(()=>new Response(new ReadableStream({
    pull(){return new Promise<void>(()=>{});},
    cancel(){canceled++;return new Promise<void>(()=>{});}
  }),{headers:{'content-type':'application/json'}}));
  const readStart=Date.now();
  await assert.rejects(stuck.service.getOwnerAnalyticsState(portfolio),{code:'TRANSPORT'});
  assert.ok(Date.now()-readStart<7500);assert.equal(stuck.calls(),1);
  assert.equal(canceled,1);
});

test('C13 exact response provenance rejects redirects, wrong RPC paths and changed origins',async()=>{
  const expected='https://local.example/rest/v1/rpc/read_owner_analytics_state';
  for(const patch of [{redirected:true,url:expected},{url:'https://foreign.invalid/rest/v1/rpc/read_owner_analytics_state'},
    {url:expected+'?unexpected=true'},{url:'https://local.example/rest/v1/rpc/change_owner_analytics'}]){
    const raw=response(state);
    for(const [name,value] of Object.entries(patch))Object.defineProperty(raw,name,{value});
    const f=fixture(()=>raw);
    await assert.rejects(f.service.getOwnerAnalyticsState(portfolio),{code:'INVALID_RESPONSE'});
    assert.equal(f.calls(),1);
  }
  const raw=response(state);
  Object.defineProperty(raw,'url',{value:expected});
  assert.deepEqual(await fixture(()=>raw).service.getOwnerAnalyticsState(portfolio),state);
});
test('C13 zero-byte flood cannot yield a successful analytics receipt',{timeout:8000},async()=>{
  const payload=new TextEncoder().encode(JSON.stringify(state));let pulls=0,canceled=false;
  const f=fixture(()=>new Response(new ReadableStream<Uint8Array>({pull(c){
    if(++pulls<=8193)c.enqueue(new Uint8Array());
    else{c.enqueue(payload);c.close();}
  },cancel(){canceled=true}}),{headers:{'content-type':'application/json'}}));
  await assert.rejects(f.service.getOwnerAnalyticsState(portfolio),{code:'INVALID_RESPONSE'});
  assert.equal(f.calls(),1);assert.ok(pulls<8193);assert.equal(canceled,true);
});
test('C13 multi-chunk bytes enforce exact declared identity length and preserve legitimate counts',async()=>{
  const raw=JSON.stringify(comparison),payload=new TextEncoder().encode(raw);
  for(const delta of [-1,0,1]){
    const f=fixture(()=>new Response(new ReadableStream<Uint8Array>({start(c){
      c.enqueue(payload.subarray(0,20));c.enqueue(payload.subarray(20));c.close();
    }}),{headers:{'content-type':'application/json','content-encoding':'identity','content-length':String(payload.length+delta)}}));
    if(delta===0)assert.deepEqual(await f.service.getOwnerAnalytics(query),comparison);
    else await assert.rejects(f.service.getOwnerAnalytics(query),{code:'INVALID_RESPONSE'});
    assert.equal(f.calls(),1);
  }
});

test('C13 absent consent version zero cannot claim a persisted update or acknowledge a mutation',async()=>{
  for(const updatedAt of [stamp,'2026-11-18T12:00:00.000001Z']){
    const read=fixture(()=>response({...state,updatedAt}));
    await assert.rejects(read.service.getOwnerAnalyticsState(portfolio),{code:'INVALID_RESPONSE'});
    assert.equal(read.calls(),1);
    const mutation=fixture(()=>response({...receipt,updatedAt}));
    await assert.rejects(mutation.service.changeOwnerAnalytics(change),{code:'INVALID_RESPONSE'});
    assert.equal(mutation.calls(),1);
  }
  const persisted={...state,version:1,updatedAt:stamp};
  assert.deepEqual(await fixture(()=>response(persisted)).service.getOwnerAnalyticsState(portfolio),persisted);
  assert.deepEqual(await fixture(()=>response(state)).service.getOwnerAnalyticsState(portfolio),state);
});
