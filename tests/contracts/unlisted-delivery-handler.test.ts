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
