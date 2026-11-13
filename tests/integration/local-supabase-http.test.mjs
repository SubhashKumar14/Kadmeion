/**
 * Real JWT/Storage API isolation smoke test.
 *
 * Runs ONLY against an ephemeral Supabase CLI stack. It refuses non-local hosts,
 * requires an explicit CI opt-in, and uses service_role only to provision test
 * users (never for the actual owner/cross-owner access checks).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

function localSupabaseCredentials() {
  assert.equal(process.env.KADMEION_LOCAL_INTEGRATION, '1',
    'Do not run privileged fixture setup without explicit local-test opt-in.');
  const raw=execFileSync('supabase',['status','-o','env'],{encoding:'utf8',timeout:20_000});
  const variables=new Map();
  for (const line of raw.split(/\r?\n/)) {
    const match=line.trim().match(/^(?:export )?([A-Z_]+)=(.*)$/);
    if (match) variables.set(match[1],match[2].trim().replace(/^["']|["']$/g,''));
  }
  const origin=variables.get('API_URL')||'http://127.0.0.1:54321';
  const url=new URL(origin);
  assert.equal(url.protocol,'http:');
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
  assert.equal(url.port,'54321');
  assert.equal(url.pathname,'/');
  const anon=variables.get('ANON_KEY'),service=variables.get('SERVICE_ROLE_KEY');
  assert.ok(anon?.length>50,'Local Supabase anon JWT unavailable.');
  assert.ok(service?.length>50,'Local Supabase service JWT unavailable.');
  return {origin:url.origin,anon,service};
}
const cfg=localSupabaseCredentials();

async function send(path,{method='GET',key=cfg.anon,bearer=key,body,headers={}}={}) {
  const response=await fetch(cfg.origin+path,{
    method,
    headers:{apikey:key,Authorization:'Bearer '+bearer,...headers},
    body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body),
    redirect:'manual',
    signal:AbortSignal.timeout(15_000)
  });
  const contentType=response.headers.get('content-type')??'';
  const bytes=new Uint8Array(await response.arrayBuffer());
  let data=null;
  if(contentType.includes('json')) {
    try {data=JSON.parse(new TextDecoder().decode(bytes));}
    catch {data=null;}
  }
  return {status:response.status,ok:response.ok,bytes,data,headers:response.headers};
}
function successful(result,label) {
  // Never include response bodies, session tokens, emails or API keys in CI logs.
  assert.ok(result.ok,label+' failed (HTTP '+result.status+')');
  return result.data;
}
async function adminUser(label) {
  const email='ci-'+label+'-'+randomUUID()+'@testing.invalid';
  const password='LocalTest!'+randomUUID()+'x';
  const created=await send('/auth/v1/admin/users',{
    method:'POST',key:cfg.service,bearer:cfg.service,
    headers:{'Content-Type':'application/json'},
    body:{email,password,email_confirm:true,user_metadata:{display_name:'CI '+label}}
  });
  const user=successful(created,'Local GoTrue fixture '+label);
  assert.match(user.id,/^[0-9a-f-]{36}$/i);
  const auth=await send('/auth/v1/token?grant_type=password',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:{email,password}
  });
  const session=successful(auth,'Real JWT sign-in '+label);
  assert.ok(typeof session.access_token==='string'&&session.access_token.length>50);
  assert.equal(session.user.id,user.id);
  return {id:user.id,token:session.access_token};
}
function bearer(user){return {bearer:user.token};}
function json(user){return {...bearer(user),headers:{'Content-Type':'application/json'}};}
const png=Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64'
));
const bucket='kadmeion-private-assets';

test('B1/B2: real local Auth JWTs enforce API and Storage tenancy (no hosted writes)',{timeout:120_000},async t=>{
  const owner=await adminUser('owner');
  const stranger=await adminUser('stranger');
  await t.test('real confirmed Auth accounts get private identity rows and no cross-owner profiles',async()=>{
    const readA=await send('/rest/v1/profiles?select=user_id,display_name',{...bearer(owner)});
    const readB=await send('/rest/v1/profiles?select=user_id,display_name',{...bearer(stranger)});
    assert.equal(successful(readA,'Owner profile read').length,1);
    assert.equal(readA.data[0].user_id,owner.id);
    assert.equal(successful(readB,'Stranger profile read').length,1);
    assert.equal(readB.data[0].user_id,stranger.id);
    assert.ok(!readB.data.some(x=>x.user_id===owner.id));
    const anonymous=await send('/rest/v1/profiles?select=user_id');
    assert.ok(!anonymous.ok || (Array.isArray(anonymous.data)&&anonymous.data.length===0),
      'Anonymous profile listing disclosed an identity');
  });
  let projectId;
  await t.test('owner can create a private project, stranger cannot list it or write as owner',async()=>{
    const created=await send('/rest/v1/projects?select=id,owner_user_id,slug',{
      ...json(owner),method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},
      body:{owner_user_id:owner.id,slug:'private-image-'+randomUUID().slice(0,8),title:'CI private project'}
    });
    const rows=successful(created,'Owner project creation');
    assert.equal(rows.length,1);projectId=rows[0].id;
    assert.equal(rows[0].owner_user_id,owner.id);
    const list=await send('/rest/v1/projects?select=id,owner_user_id',{...bearer(stranger)});
    assert.deepEqual(successful(list,'Cross-user project listing'),[]);
    const forged=await send('/rest/v1/projects',{
      ...json(stranger),method:'POST',
      body:{owner_user_id:owner.id,slug:'forged-'+randomUUID().slice(0,8),title:'Forgery'}
    });
    assert.ok(!forged.ok,'Cross-owner project creation was accepted');
  });
  const ownerPath=owner.id+'/ci-'+randomUUID().slice(0,8)+'/cover.png';
  const object='/storage/v1/object/'+bucket+'/'+ownerPath;
  await t.test('private bucket rejects cross-user upload while allowing owner upload',async()=>{
    const denied=await send(object,{
      method:'POST',...bearer(stranger),
      headers:{'Content-Type':'image/png'},body:png
    });
    assert.ok(!denied.ok,'Cross-user uploaded into someone else private prefix');
    const upload=await send(object,{
      method:'POST',...bearer(owner),
      headers:{'Content-Type':'image/png'},body:png
    });
    successful(upload,'Owner private PNG upload');
  });
  await t.test('authenticated direct bytes work only for owner; anonymous public link fails',async()=>{
    const own=await send('/storage/v1/object/authenticated/'+bucket+'/'+ownerPath,bearer(owner));
    assert.equal(own.ok,true,'Owner cannot download their own private image');
    assert.deepEqual(own.bytes,png);
    const other=await send('/storage/v1/object/authenticated/'+bucket+'/'+ownerPath,bearer(stranger));
    assert.ok(!other.ok,'Cross-user downloaded private image bytes');
    const anon=await send('/storage/v1/object/public/'+bucket+'/'+ownerPath);
    assert.ok(!anon.ok,'Private image publicly available');
    const fakeOwner=await send('/storage/v1/object/authenticated/'+bucket+'/'+ownerPath);
    assert.ok(!fakeOwner.ok,'Anonymous JWT unexpectedly downloaded private image');
  });
  await t.test('RPC verifies uploaded object metadata; forged, unuploaded and cross-user records fail',async()=>{
    const direct=await send('/rest/v1/project_assets',{
      ...json(owner),method:'POST',
      body:{project_id:projectId,owner_user_id:owner.id,object_path:ownerPath,
        mime_type:'image/png',byte_size:png.length,alt_text:'CI test'}
    });
    assert.ok(!direct.ok,'Client directly inserted unverified asset metadata');
    const rpc='/rest/v1/rpc/register_private_project_image';
    const input={p_project_id:projectId,p_object_path:ownerPath,p_mime_type:'image/png',
      p_byte_size:png.length,p_alt_text:'Transparent test pixel'};
    const missing=await send(rpc,{...json(owner),method:'POST',
      body:{...input,p_object_path:owner.id+'/other/missing.png'}});
    assert.ok(!missing.ok,'Missing object was associated with project');
    const wrongMime=await send(rpc,{...json(owner),method:'POST',
      body:{...input,p_mime_type:'image/jpeg'}});
    assert.ok(!wrongMime.ok,'Spoofed MIME metadata was accepted');
    const outsider=await send(rpc,{...json(stranger),method:'POST',body:input});
    assert.ok(!outsider.ok,'Cross-user registered another private image');
    const verified=await send(rpc,{...json(owner),method:'POST',body:input});
    const receipt=successful(verified,'Verified project image registration');
    assert.equal(receipt.storage_metadata_matched,true);
    assert.equal(receipt.object_path,ownerPath);
    const repeat=await send(rpc,{...json(owner),method:'POST',body:input});
    assert.equal(successful(repeat,'Idempotent asset registration').id,receipt.id);
    const unseen=await send('/rest/v1/project_assets?select=id',{...bearer(stranger)});
    assert.deepEqual(successful(unseen,'Cross-user asset metadata list'),[]);
  });
});
