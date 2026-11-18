import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handleUnlistedRequest} from '../../api/unlisted.mjs';

const id='10000000-0000-4000-8000-000000000001';
const html='<!doctype html><html><head><meta name="robots" content="noindex"></head><body><main>Unlisted preview</main></body></html>';
const sha=createHash('sha256').update(html).digest('hex');
const receipt={status:'UNLISTED_SCRIPTLESS_HTML',html,htmlSha256:sha,
  indexable:false,publicPublishingProven:false};
const env={KADMEION_UNLISTED_DELIVERY_ENABLED:'true',
  KADMEION_LOCAL_INTEGRATION:'1',
  KADMEION_SUPABASE_URL:'http://127.0.0.1:54321',
  KADMEION_SUPABASE_SERVICE_ROLE_KEY:'eyJ'+'a'.repeat(100)};
async function run(opts={}){
  const sent=[];
  const response={statusCode:0,headers:new Map(),body:null,
    setHeader(k,v){this.headers.set(k.toLowerCase(),v);},
    end(v){this.body=v;}
  };
  await handleUnlistedRequest({method:opts.method??'GET',
    url:opts.url??'/api/unlisted?portfolioId='+id},response,{
    env:opts.env??env,
    http:async(url,init)=>{
      sent.push({url:String(url),init});
      if(opts.throw)throw Error('Unavailable');
      return Response.json(opts.body===undefined?receipt:opts.body,
        {status:opts.status??200});
    }
  });
  return {response,sent};
}
test('unlisted delivery accepts valid HTML despite JSON string escaping overhead',async()=>{
  const dense=html.replace('</body>','<p>'+String.fromCharCode(92).repeat(710000)+'</p></body>');
  assert.ok(Buffer.byteLength(dense)<750000);
  const envelope={...receipt,html:dense,htmlSha256:createHash('sha256').update(dense).digest('hex')};
  assert.ok(Buffer.byteLength(JSON.stringify(envelope))>800000);
  const {response}=await run({body:envelope});
  assert.equal(response.statusCode,200);
  assert.equal(response.body,dense);
});
test('unlisted host handler defaults OFF without service/API request',async()=>{
  const x=await run({env:{...env,KADMEION_UNLISTED_DELIVERY_ENABLED:'false'}});
  assert.equal(x.response.statusCode,404);
  assert.equal(x.sent.length,0);
});
test('verified scriptless UNLISTED bytes returned with noindex, no-store, no JS',async()=>{
  const x=await run();
  assert.equal(x.response.statusCode,200);
  assert.equal(x.response.body,html);
  assert.equal(x.response.headers.get('content-type'),'text/html; charset=utf-8');
  assert.equal(x.response.headers.get('cdN-cache-control'.toLowerCase()),'no-store');
  assert.equal(x.response.headers.get('vercel-cdn-cache-control'),'no-store');
  assert.match(x.response.headers.get('content-security-policy'),/script-src 'none'/);
  assert.equal(x.response.headers.get('x-robots-tag'),'noindex, nofollow, noarchive');
  assert.equal(x.sent[0].url,'http://127.0.0.1:54321/rest/v1/rpc/service_read_unlisted_release');
  assert.equal(x.sent[0].init.cache,'no-store');
  assert.equal(x.sent[0].init.redirect,'error');
  assert.deepEqual(JSON.parse(x.sent[0].init.body),{p_portfolio_id:id});
});
test('HEAD checks same authoritative backend but never returns bytes',async()=>{
  const x=await run({method:'HEAD'});
  assert.equal(x.response.statusCode,200);
  assert.equal(x.response.body,'');
  assert.equal(x.sent.length,1);
});
test('invalid route, unsupported asset, method and untrusted Supabase origin are denied',async()=>{
  const variants=[
    {url:'/api/unlisted?portfolioId=../private'},
    {url:'/api/unlisted?portfolioId='+id+'&asset=index.html'},
    {url:'/api/unlisted/assets/'+id+'/secret.png'},
    {env:{...env,KADMEION_SUPABASE_URL:'https://attacker.invalid'}},
    {env:{...env,KADMEION_SUPABASE_SERVICE_ROLE_KEY:'sb_secret_xxx'}},
    {env:{...env,KADMEION_LOCAL_INTEGRATION:'0'}}
  ];
  for(const options of variants){
    const x=await run(options);
    assert.equal(x.response.statusCode,404);
    assert.equal(x.sent.length,0);
  }
  const bad=await run({method:'POST'});
  assert.equal(bad.response.statusCode,405);
});
test('unpublish or provider loss never exposes stale HTML',async()=>{
  assert.equal((await run({body:null})).response.statusCode,404);
  assert.equal((await run({status:503})).response.statusCode,503);
  assert.equal((await run({throw:true})).response.statusCode,503);
});
test('fake indexable flag, script, hash, extra fields or public proof refused',async()=>{
  for(const extra of [
    {indexable:true},{publicPublishingProven:true},{htmlSha256:'b'.repeat(64)},
    {html:html+'tamper'},{x:1},
    {html:html.replace('Unlisted preview','<script>alert(1)</script>')}
  ]){
    const x=await run({body:{...receipt,...extra}});
    assert.equal(x.response.statusCode,503);
  }
});

test('unlisted refuses executable markup even when attacker supplies a matching digest',async()=>{
  for(const unsafe of [
    '<div onclick="alert(1)">Unsafe</div>',
    '<a href="javascript:alert(1)">Click</a>',
    '<img src="https://example.org/tracker.png">',
    '<picture></picture>',
    '<meta http-equiv="refresh" content="0;url=https://example.org">',
    '<a href="&#106;avascript:alert(1)">Encoded</a>'
  ]){
    const candidate=html.replace('</body>',unsafe+'</body>');
    const body={...receipt,html:candidate,htmlSha256:createHash('sha256').update(candidate).digest('hex')};
    const {response}=await run({body});
    assert.equal(response.statusCode,503,unsafe);
    assert.equal(response.body,'Temporarily unavailable');
  }
});

test('unlisted requires actual head robots metadata, not an incidental noindex string',async()=>{
  const forged=html.replace('<meta name="robots" content="noindex">','<title>noindex</title>');
  const data={...receipt,html:forged,htmlSha256:createHash('sha256').update(forged).digest('hex')};
  const {response}=await run({body:data});
  assert.equal(response.statusCode,503);
  assert.equal(response.body,'Temporarily unavailable');
});

test('unlisted rejects multiple robots directives or a commented-only noindex',async()=>{
  for(const forged of [
    html.replace('</head>','<meta name="robots" content="index"></head>'),
    html.replace('</head>','<meta name=robots content=index></head>'),
    html.replace('</head>','<meta name="bingbot" content="index"></head>'),
    html.replace('<meta name="robots" content="noindex">','<!--<meta name="robots" content="noindex">-->')
  ]){
    const body={...receipt,html:forged,htmlSha256:createHash('sha256').update(forged).digest('hex')};
    const {response}=await run({body});
    assert.equal(response.statusCode,503,'Unlisted HTML must retain exactly one noindex policy');
  }
});

test('unlisted PNG requests recheck release visibility on both GET and HEAD',async()=>{
  const png=Buffer.from('89504e470d0a1a0a','hex');
  const asset=createHash('sha256').update(png).digest('hex');
  const manifest='e'.repeat(64);
  const url='/api/unlisted?portfolioId='+id+'&manifest='+manifest+'&asset='+asset;
  for(const method of ['GET','HEAD']){
    const allowed=await run({url,method,body:{png:png.toString('base64')}});
    assert.equal(allowed.response.statusCode,200);
    assert.deepEqual(allowed.response.body,method==='HEAD'?'':png);
    assert.equal(allowed.response.headers.get('content-type'),'image/png');
    assert.equal(allowed.response.headers.get('cache-control'),'private, no-store, max-age=0, must-revalidate');
    assert.equal(allowed.sent.length,1);
    assert.match(allowed.sent[0].url,/\/service_read_frozen_release_png$/);
    assert.deepEqual(JSON.parse(String(allowed.sent[0].init?.body)),{
      p_portfolio_id:id,p_manifest:manifest,p_sha:asset
    });

    const revoked=await run({url,method,body:null});
    assert.equal(revoked.response.statusCode,404);
    assert.equal(revoked.response.body,method==='HEAD'?'':'Not found');
    assert.equal(revoked.sent.length,1);
    assert.equal(revoked.response.headers.get('cache-control'),'private, no-store, max-age=0, must-revalidate');
    const corrupt=await run({url,method,body:{png:Buffer.concat([png,Buffer.from([0])]).toString('base64')}});
    assert.equal(corrupt.response.statusCode,503);
    assert.equal(corrupt.response.body,method==='HEAD'?'':'Temporarily unavailable');
  }
});
