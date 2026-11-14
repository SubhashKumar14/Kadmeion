import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handleReviewerRequest} from '../../api/reviewer.mjs';

const grant='30000000-0000-4000-8000-000000000005';
const token='a'.repeat(64);
const html='<!doctype html><html lang="en"><head><meta name="robots" content="noindex"></head><body><main>Private preview</main></body></html>';
const digest=createHash('sha256').update(html).digest('hex');
const receipt={status:'REVIEWER_PRIVATE_HTML',html,htmlSha256:digest,
  publicServingEnabled:false,publicUrl:null};
const env={KADMEION_STAGING_DELIVERY_ENABLED:'true',
  KADMEION_SUPABASE_URL:'http://127.0.0.1:54321',
  KADMEION_SUPABASE_SERVICE_ROLE_KEY:'eyJ'+ 'a'.repeat(128),
  KADMEION_LOCAL_INTEGRATION:'1'};
function response(){
  const headers=new Map();
  return {headers,statusCode:0,body:null,
    setHeader(k,v){headers.set(k.toLowerCase(),v);},
    end(s){this.body=s;}
  };
}
function run(options={}){
  const req={method:options.method??'GET',
    url:options.url??'/api/reviewer?g='+grant+'&t='+token,
    headers:options.headers??{}};
  const res=response();const sent=[];
  const http=(async(url,init)=>{
    sent.push({url:String(url),init});
    if(options.throw)throw new Error('private upstream');
    return new Response(JSON.stringify(options.data===undefined?receipt:options.data),
      {status:options.status??200,headers:{'content-type':'application/json'}});
  });
  return handleReviewerRequest(req,res,{env:options.env??env,http}).then(()=>({res,sent}));
}
test('reviewer delivery accepts valid HTML with escaped JSON transport expansion',async()=>{
  const dense=html.replace('</body>','<p>'+String.fromCharCode(92).repeat(710000)+'</p></body>');
  assert.ok(Buffer.byteLength(dense)<750000);
  const data={...receipt,html:dense,htmlSha256:createHash('sha256').update(dense).digest('hex')};
  assert.ok(Buffer.byteLength(JSON.stringify(data))>800000);
  const {res}=await run({data});
  assert.equal(res.statusCode,200);
  assert.equal(res.body,dense);
});
test('reviewer service defaults to disabled, never contacts private DB',async()=>{
  const result=await run({env:{...env,KADMEION_STAGING_DELIVERY_ENABLED:'false'}});
  assert.equal(result.res.statusCode,404);
  assert.equal(result.sent.length,0);
  assert.match(result.res.headers.get('cache-control'),/no-store/);
});
test('valid review token gets only verified text HTML and no-cache/strict CSP',async()=>{
  const {res,sent}=await run();
  assert.equal(res.statusCode,200);
  assert.equal(res.body,html);
  assert.equal(res.headers.get('content-type'),'text/html; charset=utf-8');
  assert.equal(res.headers.get('x-robots-tag'),'noindex, nofollow, noarchive');
  assert.equal(res.headers.get('referrer-policy'),'no-referrer');
  assert.equal(res.headers.get('vercel-cdn-cache-control'),'no-store');
  assert.match(res.headers.get('content-security-policy'),/script-src 'none'/);
  assert.match(res.headers.get('content-security-policy'),/connect-src 'none'/);
  assert.equal(sent.length,1);
  assert.equal(sent[0].url,'http://127.0.0.1:54321/rest/v1/rpc/read_private_reviewer_stage_artifact');
  assert.equal(sent[0].init.credentials,'omit');
  assert.equal(sent[0].init.redirect,'error');
  assert.equal(sent[0].init.cache,'no-store');
  assert.equal(JSON.parse(sent[0].init.body).p_raw_token,token);
  assert.equal(sent[0].init.headers.apikey,env.KADMEION_SUPABASE_SERVICE_ROLE_KEY);
  assert.ok(!JSON.stringify([...res.headers]).includes(token));
  assert.ok(!res.body.includes(token));
});
test('HEAD verifies reviewer token without leaking HTML',async()=>{
  const {res,sent}=await run({method:'HEAD'});
  assert.equal(res.statusCode,200);
  assert.equal(res.body,'');
  assert.equal(sent.length,1);
});
test('invalid routes, parameters, method and unapproved origin are fail-closed',async()=>{
  const variants=[
    {url:'/api/reviewer?g=not-uuid&t='+token},
    {url:'/api/reviewer?g='+grant+'&t=not-token'},
    {url:'/api/reviewer?g='+grant+'&t='+token+'&debug=1'},
    {url:'/api/reviewer?g='+grant+'&g='+grant+'&t='+token},
    {url:'/api/reviewer/other?g='+grant+'&t='+token},
    {env:{...env,KADMEION_SUPABASE_URL:'https://attacker.example'}},
    {env:{...env,KADMEION_LOCAL_INTEGRATION:'0'}},
    {env:{...env,KADMEION_SUPABASE_SERVICE_ROLE_KEY:'not-a-key'}}
  ];
  for(const v of variants){
    const result=await run(v);
    assert.equal(result.res.statusCode,404);
    assert.equal(result.sent.length,0);
  }
  const other=await run({method:'PUT'});
  assert.equal(other.res.statusCode,405);
  assert.equal(other.sent.length,0);
});
test('missing or revoked grant yields 404; provider loss never serves cached HTML',async()=>{
  assert.equal((await run({data:null})).res.statusCode,404);
  assert.equal((await run({status:500})).res.statusCode,503);
  assert.equal((await run({throw:true})).res.statusCode,503);
});
test('forged digest, changed HTML, surplus fields, script and fake public acknowledgement fail',async()=>{
  const malformed=[
    {...receipt,htmlSha256:'b'.repeat(64)},
    {...receipt,html:html+'surplus'},
    {...receipt,debug:1},
    {...receipt,html:html.replace('Private preview','<script>alert(1)</script>')},
    {...receipt,publicServingEnabled:true},
    {...receipt,publicUrl:'https://kadmeion.vercel.app/u/person'},
    {...receipt,status:'LIVE'}
  ];
  for(const data of malformed){
    const result=await run({data});
    assert.equal(result.res.statusCode,503);
    assert.notEqual(result.res.body,html);
  }
});


test('header-only reviewer token validates without putting secrets into request URL',async()=>{
  const {res,sent}=await run({
    url:'/api/reviewer?g='+grant,
    headers:{authorization:'Bearer '+token}
  });
  assert.equal(res.statusCode,200);
  assert.equal(sent.length,1);
  assert.ok(!sent[0].url.includes(token));
  const both=await run({headers:{authorization:'Bearer '+token}});
  assert.equal(both.res.statusCode,404);
  assert.equal(both.sent.length,0);
});

test('reviewer refuses executable markup even when attacker supplies a matching digest',async()=>{
  for(const unsafe of [
    '<div onmouseover="alert(1)">Unsafe</div>',
    '<a href="javascript:alert(1)">Click</a>',
    '<img src="https://example.org/tracker.png">',
    '<video></video>',
    '<meta http-equiv="refresh" content="0;url=https://example.org">',
    '<a href="&#106;avascript:alert(1)">Encoded</a>'
  ]){
    const candidate=html.replace('</body>',unsafe+'</body>');
    const data={...receipt,html:candidate,htmlSha256:createHash('sha256').update(candidate).digest('hex')};
    const {res}=await run({data});
    assert.equal(res.statusCode,503,unsafe);
    assert.equal(res.body,'Temporarily unavailable');
  }
});
