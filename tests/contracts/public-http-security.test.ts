import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handlePublicPortfolio} from '../../api/public-portfolio.mjs';
import {handlePublishedIdentity} from '../../api/published-identity.mjs';
import {readBoundedRpcJson} from '../../api/_bounded-rpc-json.mjs';
const env={KADMEION_LOCAL_INTEGRATION:'1',KADMEION_SUPABASE_URL:'http://127.0.0.1:54321',
  KADMEION_SUPABASE_SERVICE_ROLE_KEY:'eyJ'+'a'.repeat(100),
  KADMEION_PUBLIC_PORTFOLIO_ENABLED:'true',KADMEION_PUBLIC_IDENTITY_ENABLED:'true'};
const path='/api/public-portfolio?handle=sample_user&slug=sample-site';
const identityPath='/api/published-identity?handle=sample_user';
const marker='<meta name="robots" content="noindex,nofollow,noarchive">';
const html='<!doctype html><html lang="en"><head>'+marker+
  '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;">'+
  '</head><body><h1>Safe</h1></body></html>';
const digest=html=>createHash('sha256').update(html).digest('hex');
const payload=html=>({html,htmlSha256:digest(html)});
async function invoke(handler,{url=path,data=payload(html),httpResponse,method='GET',config=env}={}) {
  const headers=new Map(), calls=[];
  const res={statusCode:0,body:null,headers,setHeader(k,v){headers.set(k.toLowerCase(),v);},
    end(value){this.body=value;}};
  await handler({url,method},res,{env:config,http:async(url,options)=>{
    calls.push({url:String(url),options});
    return httpResponse??Response.json(data);
  }});
  return {res,calls};
}
test('RPC reader enforces JSON media type, declared and streamed byte limits',async()=>{
  assert.deepEqual(await readBoundedRpcJson(Response.json({ok:true})),{ok:true});
  for(const input of [
    new Response('{}',{headers:{'content-type':'text/html'}}),
    new Response('{}',{headers:{'content-type':'application/json','content-length':'2097153'}}),
    new Response('{}',{headers:{'content-type':'application/json','content-length':'3'}}),
    new Response('a'.repeat(2097153),{headers:{'content-type':'application/json'}})
  ])await assert.rejects(readBoundedRpcJson(input));
});
test('RPC JSON escaping may expand valid bounded HTML without dropping the release',async()=>{
  const largeHtml=html.replace('</body>','<p>'+('\\'.repeat(710000))+'</p></body>');
  assert.ok(Buffer.byteLength(largeHtml)<750000);
  const envelope=JSON.stringify(payload(largeHtml));
  assert.ok(Buffer.byteLength(envelope)>800000,
    'Fixture must exceed prior transport cap despite a valid HTML artifact');
  const decoded=await readBoundedRpcJson(Response.json(payload(largeHtml)));
  assert.equal(decoded.html,largeHtml);
  const {res}=await invoke(handlePublicPortfolio,{data:payload(largeHtml)});
  assert.equal(res.statusCode,200);
  assert.equal(res.headers.get('x-kadmeion-served-sha256'),digest(res.body));
});
test('public route is denied unless deliberately enabled',async()=>{
  const {res,calls}=await invoke(handlePublicPortfolio,{config:{...env,KADMEION_PUBLIC_PORTFOLIO_ENABLED:'false'}});
  assert.equal(res.statusCode,404);assert.equal(calls.length,0);
});
test('public route serves only verified, indexable bytes with actual served hash',async()=>{
  const {res,calls}=await invoke(handlePublicPortfolio);
  assert.equal(res.statusCode,200);assert.equal(calls.length,1);
  assert.match(res.body,/content="index,follow"/);
  assert.equal(res.headers.get('x-kadmeion-served-sha256'),digest(res.body));
  assert.equal(res.headers.get('x-robots-tag'),'index, follow');
  assert.equal(res.headers.get('cache-control'),'private, no-store');
  assert.equal(calls[0].options.redirect,'error');
  assert.equal(calls[0].options.credentials,'omit');
});
test('public HEAD produces no content and still checks publication',async()=>{
  const {res,calls}=await invoke(handlePublicPortfolio,{method:'HEAD'});
  assert.equal(res.statusCode,200);assert.equal(res.body,'');assert.equal(calls.length,1);
});
test('public route rejects malformed paths and methods without privileged calls',async()=>{
  for(const url of ['/api/public-portfolio?handle=INVALID&slug=sample-site',
    '/api/public-portfolio?handle=sample_user&slug=Not-Valid']){
    const {res,calls}=await invoke(handlePublicPortfolio,{url});
    assert.equal(res.statusCode,404);assert.equal(calls.length,0);
  }
  for(const reserved of ['app','auth','api','signin','register','workspace','status',
    'templates','explore','admin','r']){
    for(const url of ['/api/public-portfolio?handle='+reserved+'&slug=sample-site',
      '/'+reserved+'/sample-site']){
      const denied=await invoke(handlePublicPortfolio,{url});
      assert.equal(denied.res.statusCode,404);
      assert.equal(denied.calls.length,0,'Reserved handle reached privileged delivery');
    }
  }
  const {res,calls}=await invoke(handlePublicPortfolio,{method:'POST'});
  assert.equal(res.statusCode,405);assert.equal(calls.length,0);
});
test('public release rejects tampered, executable or unexpected response fields',async()=>{
  const cases=[
    {...payload(html),htmlSha256:'0'.repeat(64)},
    payload(html.replace('<h1>','<h1 onclick="run()">')),
    payload(html.replace('</body>','<img src=x onerror="run()"></body>')),
    payload(html.replace('</body>','<a href="javascript:alert(1)">bad</a></body>')),
    payload(html.replace('</head>','<meta http-equiv="refresh" content="0;url=https://example.org"></head>')),
    payload(html.replace('</body>','<video controls></video></body>')),
    payload(html.replace('</body>','<picture></picture></body>')),
    payload(html.replace('</body>','<a href="&#106;avascript:alert(1)">No</a></body>')),
    {...payload(html),privateEmail:'do-not-leak'}
  ];
  for(const data of cases){
    const {res}=await invoke(handlePublicPortfolio,{data});
    assert.equal(res.statusCode,503);assert.equal(res.body,'Temporarily unavailable');
    assert.equal(res.headers.get('x-robots-tag'),'noindex');
  }
});
test('both public adapters reject oversized or non-JSON upstream bodies',async()=>{
  for(const handler of [handlePublicPortfolio,handlePublishedIdentity])
    for(const response of [
      new Response('{}',{headers:{'content-type':'application/json','content-length':'2097153'}}),
      new Response('null',{headers:{'content-type':'text/html'}}),
      Response.json({message:'unavailable'},{status:500})
    ]){
      const {res}=await invoke(handler,{url:handler===handlePublicPortfolio?path:identityPath,
        httpResponse:response});
      assert.equal(res.statusCode,503);
    }
});
test('published profile escapes text and rejects private leaked fields',async()=>{
  const profile={handle:'sample_user',displayName:'<unsafe>',bio:'A & B'};
  const good=await invoke(handlePublishedIdentity,{url:identityPath,data:profile});
  assert.equal(good.res.statusCode,200);
  assert.match(good.res.body,/&lt;unsafe&gt;/);
  assert.match(good.res.body,/A &amp; B/);
  for(const data of [{...profile,privateEmail:'no'},{...profile,handle:'foreign'},
    {...profile,bio:'a'.repeat(12001)}]){
    const {res}=await invoke(handlePublishedIdentity,{url:identityPath,data});
    assert.equal(res.statusCode,503);
  }
});
test('published case study validates each section and escapes HTML',async()=>{
  const url=identityPath+'&slug=case-study';
  const source={handle:'sample_user',slug:'case-study',title:'<Case>',
    sections:[{title:'Demo',body:'A & B'}]};
  const good=await invoke(handlePublishedIdentity,{url,data:source});
  assert.equal(good.res.statusCode,200);
  assert.match(good.res.body,/&lt;Case&gt;/);
  assert.match(good.res.body,/A &amp; B/);
  for(const bad of [
    {...source,sections:[{title:'Demo',body:'A',privateField:'no'}]},
    {...source,sections:[{title:'Demo',body:'a'.repeat(12001)}]}
  ]){
    const {res}=await invoke(handlePublishedIdentity,{url,data:bad});
    assert.equal(res.statusCode,503);
  }
});

test('Vercel reserves all frontend system paths before generic published portfolio routing',()=>{
  const config=JSON.parse(readFileSync(new URL('../../vercel.json',import.meta.url),'utf8'));
  const routes=config.rewrites;
  const publicIndex=routes.findIndex((route:{source:string})=>route.source.startsWith('/:handle('));
  assert.ok(publicIndex>0);
  for(const prefix of ['app','auth','r','templates','status','explore','settings','dashboard','workspace']){
    const index=routes.findIndex((route:{source:string;destination:string})=>
      route.source==='/'+prefix+'/:path*'&&route.destination==='/index.html');
    assert.ok(index>=0&&index<publicIndex,prefix+' must not fall through to public portfolio API');
  }
  for(const path of ['/app','/templates','/explore','/status']){
    const index=routes.findIndex((route:{source:string;destination:string})=>
      route.source===path&&route.destination==='/index.html');
    assert.ok(index>=0&&index<publicIndex,path+' must have safe SPA handling');
  }
  assert.ok(routes.some((route:{source:string;destination:string})=>
    route.source==='/u/:handle/projects/:slug'&&
    route.destination.startsWith('/api/published-identity')));
});
