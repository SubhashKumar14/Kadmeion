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
  const methods:string[]=[];
  let responseBytes:Promise<ArrayBuffer>|undefined;
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
    const method=options?.method;
    assert.ok(method==='GET'||method==='HEAD');
    methods.push(method);
    if(method==='GET')visits.push(String(input));
    assert.equal(options?.credentials,'omit');
    assert.equal(options?.redirect,'error');
    // Ordinary fixtures never tee a stream into an unread original branch.
    if(response)return new Response(method==='HEAD'?null:await (responseBytes??=response.arrayBuffer()),
      {status:response.status,headers:response.headers});
    return new Response(method==='HEAD'?null:unlisted||!acknowledged?html:publicHtml,{
      status:200,headers:{
        ...releaseHeaders,
        'X-Robots-Tag':unlisted||!acknowledged?'noindex, nofollow, noarchive':'index, follow'
      }
    });
  };
  return {
    ports:{origin:'https://kadmeion.vercel.app',rpc,http},
    calls,visits,methods
  };
}
test('acknowledged public release must re-fetch the same exact HTTP bytes',async()=>{
  const f=fixture('ACKNOWLEDGED');
  const result=await publishConsentedUnlistedRelease(id,f.ports);
  assert.deepEqual(result,{status:'DELIVERY_ACKNOWLEDGED',htmlSha256:sha});
  assert.deepEqual(f.methods,['GET','HEAD']);
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
  assert.deepEqual(f.methods,['GET','HEAD','GET','HEAD']);
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
  const http=async(_input:RequestInfo|URL,options?:RequestInit):Promise<Response>=>new Response(options?.method==='HEAD'?null:html,{
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
    const assetMethods:string[]=[];
    const result=await publishConsentedUnlistedRelease(id,{origin:'https://release.example',
      rpc:async operation=>{
        if(operation==='service_prepare_unlisted_release')
          return {...base,htmlSha256:frozenSha,status:'AWAITING_VERIFICATION'};
        if(operation==='service_acknowledge_unlisted_release'){ack=true;return true;}
        if(operation==='service_recover_failed_unlisted_release')
          return {portfolioId,status:'REVOKED',releaseGeneration:null};
        assert.fail(operation);
      },
      http:async (input,options)=>{
        const target=new URL(String(input));
        if(target.pathname==='/api/public-portfolio'){
          assert.equal(target.pathname+target.search,asset);
          assetMethods.push(options?.method??'');
          if(options?.method==='GET')visits++;
          return new Response(options?.method==='HEAD'?null:valid?png:Buffer.from('wrong'),{
            headers:{'cache-control':'private, no-store','content-type':'image/png'}});
        }
        const body=frozen.replace('./assets/'+imageSha+'.png',asset.replaceAll('&','&amp;'));
        return new Response(options?.method==='HEAD'?null:ack?body.replace(marker,'<meta name="robots" content="index,follow">'):body,
          {headers:{...releaseHeaders,'X-Robots-Tag':ack?'index, follow':'noindex, nofollow, noarchive'}});
      }
    });
    assert.equal(result.status,valid?'DELIVERY_ACKNOWLEDGED':'DELIVERY_REVOKED');
    assert.equal(ack,valid);
    assert.equal(visits,valid?2:1);
    assert.deepEqual(assetMethods,valid?['GET','HEAD','GET','HEAD']:['GET']);
  }
});

test('method-aware canonical HEAD fails closed on inconsistent delivery policy',async()=>{
  // These assertions require the S4 method-aware candidate, not the older GET-only baseline.
  for(const variant of ['status','redirect','location','age','body','digest','cache','robots'] as const){
    const f=fixture('AWAITING_VERIFICATION');
    let heads=0;
    const http:typeof fetch=async(input,options)=>{
      if(options?.method!=='HEAD')return f.ports.http(input,options);
      heads++;
      const headers=new Headers({...releaseHeaders,'X-Robots-Tag':'noindex, nofollow, noarchive'});
      if(variant==='location')headers.set('Location','/other');
      if(variant==='age')headers.set('Age','1');
      if(variant==='digest')headers.set('x-kadmeion-served-sha256','0'.repeat(64));
      if(variant==='cache')headers.set('Cache-Control','no-store, max-age=0');
      if(variant==='robots')headers.set('X-Robots-Tag','index, follow');
      if(variant==='redirect')return Response.redirect('https://release.example/elsewhere',302);
      return new Response(variant==='body'?'unexpected':null,{status:variant==='status'?503:200,headers});
    };
    const result=await publishConsentedUnlistedRelease(id,{...f.ports,http});
    assert.equal(heads,1,variant+' must independently probe HEAD');
    assert.deepEqual(result,{status:'DELIVERY_REVOKED'},variant);
    assert.equal(f.calls.some(x=>x.op==='service_acknowledge_unlisted_release'),false);
  }
});

/** Test-side watchdog only: never mistake an unresolved promise for a denial. */
async function within<T>(promise:Promise<T>,milliseconds=7000):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    return await Promise.race([promise,new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>reject(new Error('Delivery verifier did not settle within the probe budget')),milliseconds);
    })]);
  }finally{if(timer!==undefined)clearTimeout(timer);}
}
function assertRevokedWithoutAck(f:ReturnType<typeof fixture>,result:unknown){
  assert.deepEqual(result,{status:'DELIVERY_REVOKED'});
  assert.deepEqual(f.calls.map(x=>x.op),[
    'service_prepare_unlisted_release','service_recover_failed_unlisted_release'
  ]);
}
test('C03 unread sibling cannot hold invalid GET or HEAD recovery hostage',{timeout:22000},async()=>{
  for(const method of ['GET','HEAD'] as const){
    const f=fixture('AWAITING_VERIFICATION');
    const original=new Response('unread fixture sibling',{status:503});
    const returned=original.clone();
    try{
      const http:typeof fetch=async(input,options)=>{
        if(options?.method===method)return returned;
        return f.ports.http(input,options);
      };
      assertRevokedWithoutAck(f,await within(publishConsentedUnlistedRelease(id,{...f.ports,http})));
      assert.equal(original.bodyUsed,false,'Verifier must not rely on consuming the sibling');
    }finally{
      // The verifier must settle BEFORE this cleanup; cleanup must not mask the regression.
      void original.body?.cancel().catch(()=>{});
      if(!returned.bodyUsed)void returned.body?.cancel().catch(()=>{});
    }
  }
});
test('C03 stalled GET, HEAD and uncancellable cleanup fail closed within one probe budget',{timeout:29000},async()=>{
  for(const variant of ['GET-stalls','HEAD-stalls','cancel-stalls'] as const){
    const f=fixture('AWAITING_VERIFICATION');
    let controller:ReadableStreamDefaultController<Uint8Array>|undefined;
    let cancelAttempted=false;
    let signal:AbortSignal|null|undefined;
    let resolveCancel:(()=>void)|undefined;
    try{
      const http:typeof fetch=async(input,options)=>{
        const target=variant==='HEAD-stalls'?'HEAD':'GET';
        if(options?.method!==target)return f.ports.http(input,options);
        signal=options?.signal;
        const stream=new ReadableStream<Uint8Array>({
          start(c){controller=c; if(variant==='HEAD-stalls')c.enqueue(new Uint8Array(0));},
          cancel(){cancelAttempted=true;if(variant==='cancel-stalls')return new Promise<void>(r=>{resolveCancel=r;});}
        });
        return new Response(stream,{status:variant==='cancel-stalls'?503:200,
          headers:{...releaseHeaders,'X-Robots-Tag':'noindex, nofollow, noarchive'}});
      };
      assertRevokedWithoutAck(f,await within(publishConsentedUnlistedRelease(id,{...f.ports,http})));
      assert.ok(cancelAttempted||signal?.aborted,'Rejected or timed out body must be cancelled or aborted');
    }finally{
      resolveCancel?.();
      try{controller?.close();}catch{/* already cancelled */}
    }
  }
});
test('C03 bodyless HEAD distinguishes empty chunks from a later nonempty chunk',async()=>{
  for(const nonempty of [false,true]){
    const f=fixture('AWAITING_VERIFICATION',{unlisted:true});
    const http:typeof fetch=async(input,options)=>{
      if(options?.method!=='HEAD')return f.ports.http(input,options);
      const stream=new ReadableStream<Uint8Array>({start(c){
        c.enqueue(new Uint8Array(0));c.enqueue(new Uint8Array(0));
        if(nonempty)c.enqueue(Uint8Array.of(1));c.close();
      }});
      return new Response(stream,{headers:{...releaseHeaders,'X-Robots-Tag':'noindex, nofollow, noarchive'}});
    };
    const result=await within(publishConsentedUnlistedRelease(id,{...f.ports,http}));
    if(nonempty)assertRevokedWithoutAck(f,result);
    else assert.deepEqual(result,{status:'DELIVERY_ACKNOWLEDGED',htmlSha256:sha});
  }
});
test('C03 canonical optional digest must match actual GET bytes, independent HEAD MIME/CSP must match',async()=>{
  for(const variant of ['missing','matching','GET-forged','HEAD-forged','HEAD-mime','HEAD-csp'] as const){
    const f=fixture('AWAITING_VERIFICATION',{unlisted:true});
    const http:typeof fetch=async(input,options)=>{
      const response=await f.ports.http(input,options);
      const headers=new Headers(response.headers);
      const isHead=options?.method==='HEAD';
      if(variant==='matching'||(variant==='GET-forged'&&!isHead)||(variant==='HEAD-forged'&&isHead))
        headers.set('x-kadmeion-served-sha256',variant==='matching'?sha:'0'.repeat(64));
      if(isHead&&variant==='HEAD-mime')headers.set('Content-Type','text/plain');
      if(isHead&&variant==='HEAD-csp')headers.set('Content-Security-Policy',"default-src 'none'; script-src 'self'");
      return new Response(isHead?null:await response.arrayBuffer(),{status:response.status,headers});
    };
    const result=await within(publishConsentedUnlistedRelease(id,{...f.ports,http}));
    if(variant==='missing'||variant==='matching')assert.deepEqual(result,{status:'DELIVERY_ACKNOWLEDGED',htmlSha256:sha});
    else assertRevokedWithoutAck(f,result);
  }
});
test('C03 direct media must independently pass HEAD before acknowledgement',async()=>{
  const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64'));
  const imageSha=createHash('sha256').update(png).digest('hex');
  const frozen=html.replace('</main>','<img loading="lazy" decoding="async" src="./assets/'+imageSha+'.png" alt="Evidence" width="1" height="1"></main>');
  const frozenSha=createHash('sha256').update(frozen).digest('hex');
  const route='/api/unlisted?portfolioId='+portfolioId+'&manifest='+'a'.repeat(64)+'&asset='+imageSha;
  const rendered=frozen.replace('./assets/'+imageSha+'.png',route.replaceAll('&','&amp;'));
  for(const variant of ['valid','digest','mime','cache','location','body','status'] as const){
    const f=fixture('AWAITING_VERIFICATION',{unlisted:true,prepare:{htmlSha256:frozenSha}});
    const order:string[]=[];
    const http:typeof fetch=async(input,options)=>{
      const target=new URL(String(input));
      const asset=target.searchParams.has('asset');
      const isHead=options?.method==='HEAD';
      order.push((asset?'media':'document')+':'+options?.method);
      if(!asset)return new Response(isHead?null:rendered,{headers:{
        ...releaseHeaders,'X-Robots-Tag':'noindex, nofollow, noarchive'
      }});
      assert.equal(target.pathname+target.search,route);
      const headers=new Headers({'Cache-Control':'private, no-store','Content-Type':'image/png'});
      if(isHead&&variant==='digest')headers.set('x-kadmeion-served-sha256','0'.repeat(64));
      if(isHead&&variant==='mime')headers.set('Content-Type','text/html');
      if(isHead&&variant==='cache')headers.set('Cache-Control','public, max-age=60');
      if(isHead&&variant==='location')headers.set('Location','/other');
      return new Response(isHead?(variant==='body'?Uint8Array.of(1):null):png,{
        status:isHead&&variant==='status'?503:200,headers
      });
    };
    const result=await within(publishConsentedUnlistedRelease(id,{...f.ports,http}));
    assert.deepEqual(order,['document:GET','document:HEAD','media:GET','media:HEAD']);
    if(variant==='valid')assert.deepEqual(result,{status:'DELIVERY_ACKNOWLEDGED',htmlSha256:frozenSha});
    else assertRevokedWithoutAck(f,result);
  }
});

test('C03 late response from abort-ignoring fetch is discarded and never acknowledges',{timeout:19000},async()=>{
  for(const method of ['GET','HEAD'] as const){
    const f=fixture('AWAITING_VERIFICATION',{unlisted:true});
    let resolveLate:((response:Response)=>void)|undefined;
    let signal:AbortSignal|null|undefined;
    let cancelled=false;
    try{
      const http:typeof fetch=async(input,options)=>{
        if(options?.method!==method)return f.ports.http(input,options);
        signal=options?.signal;
        return new Promise<Response>(r=>{resolveLate=r;});
      };
      assertRevokedWithoutAck(f,await within(publishConsentedUnlistedRelease(id,{...f.ports,http})));
      assert.equal(signal?.aborted,true);
      resolveLate?.(new Response(new ReadableStream<Uint8Array>({
        cancel(){cancelled=true;}
      }),{headers:{...releaseHeaders,'X-Robots-Tag':'noindex, nofollow, noarchive'}}));
      // Allow the late promise and its best-effort stream cleanup to run.
      await new Promise<void>(r=>setImmediate(r));
      assert.equal(cancelled,true);
      assert.deepEqual(f.calls.map(x=>x.op),[
        'service_prepare_unlisted_release','service_recover_failed_unlisted_release'
      ]);
    }finally{resolveLate?.(new Response(null,{status:503}));}
  }
});
test('C03 oversized GET with nonsettling cancellation cannot block recovery',async()=>{
  const f=fixture('AWAITING_VERIFICATION');
  let cancelAttempted=false;
  let resolveCancel:(()=>void)|undefined;
  try{
    const http:typeof fetch=async()=>new Response(new ReadableStream<Uint8Array>({
      start(c){c.enqueue(new Uint8Array(750001));},
      cancel(){cancelAttempted=true;return new Promise<void>(r=>{resolveCancel=r;});}
    }),{headers:{...releaseHeaders,'X-Robots-Tag':'noindex, nofollow, noarchive'}});
    assertRevokedWithoutAck(f,await within(publishConsentedUnlistedRelease(id,{...f.ports,http})));
    assert.equal(cancelAttempted,true);
  }finally{resolveCancel?.();}
});
