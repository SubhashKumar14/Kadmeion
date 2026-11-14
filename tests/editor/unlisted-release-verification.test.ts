import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {publishConsentedUnlistedRelease} from
  '../../packages/storage-adapters/src/unlisted-release-verification.ts';

const id='10000000-0000-4000-8000-000000000001';
const portfolioId='20000000-0000-4000-8000-000000000002';
const marker='<meta name="robots" content="noindex,nofollow,noarchive">';
const html='<!doctype html><html><head>'+marker+
  '</head><body><main><h1>Trusted static release</h1></main></body></html>';
const publicHtml=html.replace(marker,'<meta name="robots" content="index,follow">');
const sha=createHash('sha256').update(html).digest('hex');
const base={portfolioId,htmlSha256:sha,releaseGeneration:7,
  publicServingEnabled:false,publicUrl:null,
  publicHandle:'release_owner',publicSlug:'release-fixture'};
type State='ACKNOWLEDGED'|'AWAITING_VERIFICATION'|'PROBE_PENDING';
function fixture(state:State,{response,prepare,probe,activation,recovery,unlisted=false}:{
  response?:Response;prepare?:Record<string,unknown>;probe?:Record<string,unknown>;
  activation?:Record<string,unknown>;recovery?:Record<string,unknown>;unlisted?:boolean;
}={}) {
  const calls:{op:string;body:Record<string,string|number>}[]=[];
  const visits:string[]=[];
  const object={...base,status:state,...(unlisted?{
    publicHandle:null,publicSlug:null}:{}),...prepare};
  const rpc=async(op:string,body:Record<string,string|number>):Promise<unknown>=>{
    calls.push({op,body});
    if(op==='service_prepare_unlisted_release')return object;
    if(op==='service_probe_unlisted_release')
      return probe??{status:'PROBE_PENDING',intentId:id,
        releaseGeneration:7,htmlSha256:sha,publicServingEnabled:false,html};
    if(op==='service_activate_unlisted_release')
      return activation??{status:'ACTIVATED_NEEDS_EXTERNAL_HTTP_VERIFICATION',
        portfolioId,releaseGeneration:7,htmlSha256:sha,publicUrl:null,
        hostRevocationVerified:false};
    if(op==='service_acknowledge_unlisted_release')return true;
    if(op==='service_recover_failed_unlisted_release')
      return recovery??{portfolioId,status:'REVOKED',releaseGeneration:null};
    throw Error('Unsupported trusted RPC');
  };
  const http:typeof fetch=async(input,options)=>{
    visits.push(String(input));
    assert.equal(options?.method,'GET');
    assert.equal(options?.credentials,'omit');
    assert.equal(options?.redirect,'error');
    return response??new Response(unlisted?html:publicHtml,{
      status:200,headers:{
        'Content-Type':'text/html; charset=utf-8',
        'Cache-Control':'private, no-store',
        'X-Robots-Tag':unlisted?'noindex, nofollow':'index, follow'
      }
    });
  };
  return {
    ports:{origin:'https://kadmeion.vercel.app',rpc,http},
    calls,visits
  };
}
test('acknowledged public release must re-fetch the same exact HTTP bytes',async()=>{
  const f=fixture('ACKNOWLEDGED');
  const result=await publishConsentedUnlistedRelease(id,f.ports);
  assert.deepEqual(result,{status:'DELIVERY_ACKNOWLEDGED',htmlSha256:sha});
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].op,'service_prepare_unlisted_release');
  assert.deepEqual(f.visits,['https://kadmeion.vercel.app/release_owner/release-fixture']);
});
test('acknowledged release replay fails on stale or corrupted host without rollback',async()=>{
  for(const response of [
    new Response(publicHtml+'tampered',{status:200,headers:{
      'Content-Type':'text/html','Cache-Control':'no-store',
      'X-Robots-Tag':'index, follow'}}),
    new Response('Unavailable',{status:503,headers:{'Content-Type':'text/html'}}),
    new Response(publicHtml,{status:200,headers:{
      'Content-Type':'text/html','Cache-Control':'public, max-age=3600',
      'X-Robots-Tag':'index, follow'}})
  ]) {
    const f=fixture('ACKNOWLEDGED',{response});
    await assert.rejects(publishConsentedUnlistedRelease(id,f.ports),
      /Acknowledged release failed/);
    assert.deepEqual(f.calls.map(x=>x.op),['service_prepare_unlisted_release'],
      'An already-verified live release must not auto-roll back due to transient HTTP failure');
  }
});
test('newly activated publication must get a fresh host digest then database ack',async()=>{
  const f=fixture('AWAITING_VERIFICATION');
  const value=await publishConsentedUnlistedRelease(id,f.ports);
  assert.deepEqual(value,{status:'DELIVERY_ACKNOWLEDGED',htmlSha256:sha});
  assert.deepEqual(f.calls.map(x=>x.op),[
    'service_prepare_unlisted_release','service_acknowledge_unlisted_release'
  ]);
});
test('unverified new host delivery is revoked, not acknowledged',async()=>{
  const bad=new Response('fail',{status:503});
  const f=fixture('AWAITING_VERIFICATION',{response:bad});
  assert.deepEqual(await publishConsentedUnlistedRelease(id,f.ports),
    {status:'DELIVERY_REVOKED'});
  assert.deepEqual(f.calls.map(x=>x.op),[
    'service_prepare_unlisted_release','service_recover_failed_unlisted_release'
  ]);
});
test('private probe requires pinned HTML digest before activation and visitor fetch',async()=>{
  const f=fixture('PROBE_PENDING');
  assert.deepEqual(await publishConsentedUnlistedRelease(id,f.ports),
    {status:'DELIVERY_ACKNOWLEDGED',htmlSha256:sha});
  assert.deepEqual(f.calls.map(x=>x.op),[
    'service_prepare_unlisted_release','service_probe_unlisted_release',
    'service_activate_unlisted_release','service_acknowledge_unlisted_release'
  ]);
  assert.equal(f.visits.length,1);
});
test('probe byte tampering fails before activation or visitor exposure',async()=>{
  const f=fixture('PROBE_PENDING',{probe:{status:'PROBE_PENDING',
    intentId:id,releaseGeneration:7,htmlSha256:sha,publicServingEnabled:false,
    html:html+'modified'}});
  await assert.rejects(publishConsentedUnlistedRelease(id,f.ports),
    /private release changed/);
  assert.deepEqual(f.calls.map(x=>x.op),[
    'service_prepare_unlisted_release','service_probe_unlisted_release'
  ]);
  assert.deepEqual(f.visits,[]);
});
test('unlisted delivery verifies private robots and refuses indexable content',async()=>{
  const f=fixture('AWAITING_VERIFICATION',{unlisted:true});
  assert.deepEqual(await publishConsentedUnlistedRelease(id,f.ports),
    {status:'DELIVERY_ACKNOWLEDGED',htmlSha256:sha});
  assert.deepEqual(f.visits,['https://kadmeion.vercel.app/api/unlisted?portfolioId='+portfolioId]);
  const wrong=fixture('ACKNOWLEDGED',{unlisted:true,response:new Response(html,{
    status:200,headers:{'Content-Type':'text/html','Cache-Control':'no-store',
      'X-Robots-Tag':'index, follow'}})});
  await assert.rejects(publishConsentedUnlistedRelease(id,wrong.ports));
  assert.equal(wrong.calls.length,1);
});
test('invalid owner-consent routes and invalid transport origin never activate',async()=>{
  for(const prepare of [{publicHandle:'BAD'},{publicSlug:'../admin'}]){
    const f=fixture('PROBE_PENDING',{prepare});
    await assert.rejects(publishConsentedUnlistedRelease(id,f.ports));
    assert.equal(f.calls.length,1);
    assert.deepEqual(f.visits,[]);
  }
  const f=fixture('ACKNOWLEDGED');
  await assert.rejects(publishConsentedUnlistedRelease(id,{...f.ports,
    origin:'http://169.254.169.254/'}));
  assert.equal(f.calls.length,0);
});
