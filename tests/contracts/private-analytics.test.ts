import test from 'node:test';
import assert from 'node:assert/strict';
import {SupabasePrivateAnalyticsService} from '../../packages/contracts/src/private-analytics-service.ts';

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
