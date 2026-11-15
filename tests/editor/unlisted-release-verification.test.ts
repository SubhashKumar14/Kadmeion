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
const releaseHeaders={
  'Content-Type':'text/html; charset=utf-8',
  'Cache-Control':'private, no-store',
  'X-Robots-Tag':'index, follow',
  'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"
};
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
  let acknowledged=state==='ACKNOWLEDGED';
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
    if(op==='service_acknowledge_unlisted_release'){acknowledged=true;return true;}
    if(op==='service_recover_failed_unlisted_release')
      return recovery??{portfolioId,status:'REVOKED',releaseGeneration:null};
    throw Error('Unsupported trusted RPC');
  };
  const http:typeof fetch=async(input,options)=>{
    visits.push(String(input));
    assert.equal(options?.method,'GET');
    assert.equal(options?.credentials,'omit');
    assert.equal(options?.redirect,'error');
    return response??new Response(unlisted||!acknowledged?html:publicHtml,{
      status:200,headers:{
        ...releaseHeaders,
        'X-Robots-Tag':unlisted||!acknowledged?'noindex, nofollow, noarchive':'index, follow'
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
  assert.equal(f.visits.length,2,'Verify private canary and post-ack indexable delivery');
});
test('a matching digest cannot acknowledge unsafe cache, search or script headers',async()=>{
  for(const extra of [
    {'CDN-Cache-Control':'public, s-maxage=60'},
    {'Cache-Control':'no-store, max-age=30'},
    {'X-Robots-Tag':'index, noindex'},
    {'Content-Security-Policy':"default-src 'none'; script-src 'self'"},
    {'Content-Security-Policy':"default-src 'none'; worker-src 'self'"},
    {'Content-Security-Policy':''},
    {'Location':'/other'}
  ] as Record<string,string>[]){
    const response=new Response(html,{headers:{
      ...releaseHeaders,'X-Robots-Tag':'noindex, nofollow, noarchive',...extra
    }});
    const f=fixture('AWAITING_VERIFICATION',{response});
    assert.deepEqual(await publishConsentedUnlistedRelease(id,f.ports),{status:'DELIVERY_REVOKED'});
    assert.equal(f.calls.at(-1)?.op,'service_recover_failed_unlisted_release');
  }
});
test('public release cannot claim success if the host stays noindex after the DB acknowledgment',async()=>{
  const calls:string[]=[];
  const initial=fixture('AWAITING_VERIFICATION');
  const http=async(_input:RequestInfo|URL):Promise<Response>=>new Response(html,{
    status:200,headers:{...releaseHeaders,'X-Robots-Tag':'noindex, nofollow, noarchive'}
  });
  const rpc=async(op:Parameters<typeof initial.ports.rpc>[0],body:Record<string,string|number>)=>{
    calls.push(op);
    return initial.ports.rpc(op,body);
  };
  await assert.rejects(publishConsentedUnlistedRelease(id,{
    ...initial.ports,http:http as typeof fetch,rpc
  }),/indexable HTTP verification/);
  assert.deepEqual(calls,[
    'service_prepare_unlisted_release','service_acknowledge_unlisted_release'
  ],'Do not report success or issue a destructive rollback after the DB acknowledgment');
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
  assert.equal(f.visits.length,2);
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
  for(const prepare of [{publicHandle:'BAD'},{publicHandle:'workspace'},{publicSlug:'../admin'},{publicSlug:'a'}]){
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

test('image-backed release requires exact scoped PNG bytes before acknowledgement',async()=>{
  const png=Buffer.from('89504e470d0a1a0a','hex');
  const imageSha=createHash('sha256').update(png).digest('hex');
  const frozen=html.replace('</main>',
    '<img loading="lazy" decoding="async" src="./assets/'+imageSha+
    '.png" alt="Evidence" width="1" height="1"></main>');
  const frozenSha=createHash('sha256').update(frozen).digest('hex');
  const asset='/api/public-portfolio?handle=release_owner&slug=release-fixture&manifest='+
    'a'.repeat(64)+'&asset='+imageSha;
  for(const valid of [false,true]){
    let ack=false, visits=0;
    const result=await publishConsentedUnlistedRelease(id,{origin:'https://release.example',
      rpc:async operation=>{
        if(operation==='service_prepare_unlisted_release')
          return {...base,htmlSha256:frozenSha,status:'AWAITING_VERIFICATION'};
        if(operation==='service_acknowledge_unlisted_release'){ack=true;return true;}
        if(operation==='service_recover_failed_unlisted_release')
          return {portfolioId,status:'REVOKED',releaseGeneration:null};
        assert.fail(operation);
      },
      http:async input=>{
        const target=new URL(String(input));
        if(target.pathname==='/api/public-portfolio'){
          assert.equal(target.pathname+target.search,asset);
          visits++;
          return new Response(valid?png:Buffer.from('wrong'),{
            headers:{'cache-control':'private, no-store','content-type':'image/png'}});
        }
        const body=frozen.replace('./assets/'+imageSha+'.png',asset.replaceAll('&','&amp;'));
        return new Response(ack?body.replace(marker,'<meta name="robots" content="index,follow">'):body,
          {headers:{...releaseHeaders,'X-Robots-Tag':ack?'index, follow':'noindex, nofollow, noarchive'}});
      }
    });
    assert.equal(result.status,valid?'DELIVERY_ACKNOWLEDGED':'DELIVERY_REVOKED');
    assert.equal(ack,valid);
    assert.equal(visits,valid?2:1);
  }
});
