/**
 * Disposable, real GoTrue instant signup and Mailpit recovery proof.
 * No Brevo/API-domain proof is inferred. Never logs addresses, passwords,
 * links, OAuth codes or access/refresh tokens.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

assert.equal(process.env.KADMEION_LOCAL_INTEGRATION,'1',
  'Email integration may only run with explicit isolated-local opt-in.');
const raw=execFileSync('supabase',['status','-o','env'],{encoding:'utf8',timeout:20_000});
const env=new Map([...raw.matchAll(/^(?:export )?([A-Z_]+)=["']?([^"'\n\r]+)["']?$/gm)]
  .map(m=>[m[1],m[2]]));
const api=new URL(env.get('API_URL')??'http://127.0.0.1:54321');
assert.equal(api.protocol,'http:');
assert.ok(['localhost','127.0.0.1'].includes(api.hostname));
assert.equal(api.port,'54321');
const key=env.get('ANON_KEY');
assert.ok(key&&key.length>50);
const mailpit='http://127.0.0.1:54324';

async function go(path,body,accessToken) {
  const response=await fetch(api.origin+path,{
    method:body===undefined?'GET':'POST',
    headers:{apikey:key,Authorization:'Bearer '+(accessToken??key),
      'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),
    redirect:'manual',signal:AbortSignal.timeout(15_000)
  });
  const contentType=response.headers.get('content-type')??'';
  return {status:response.status,ok:response.ok,
    data:contentType.includes('json')?await response.json().catch(()=>null):null,
    location:response.headers.get('location')};
}
async function mailbox(path) {
  const response=await fetch(mailpit+path,{signal:AbortSignal.timeout(6_000),
    redirect:'error',cache:'no-store'});
  assert.equal(response.ok,true,'Local Mailpit capture service unavailable');
  return response.json();
}
const pause=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
async function messageFor(email) {
  for(let attempt=0;attempt<40;attempt++){
    const list=await mailbox('/api/v1/messages?limit=100');
    const match=(list.messages??[]).find(m=>
      m.To?.some(to=>to.Address?.toLowerCase()===email.toLowerCase()));
    if(match)return mailbox('/api/v1/message/'+encodeURIComponent(match.ID));
    await pause(150);
  }
  throw new Error('Expected local Auth email was not captured by Mailpit.');
}
function verifyLink(mail) {
  const body=String(mail.Text??'')+'\n'+String(mail.HTML??'');
  const urls=body.match(/https?:\/\/[^\s"'<>]+/g)??[];
  for(const raw of urls){
    let url;
    try{url=new URL(raw.replaceAll('&amp;','&').replace(/[).,;]+$/,''));}
    catch{continue;}
    // Never follow arbitrary email content (SSRF/open redirect).
    if(url.protocol==='http:'&&url.host===api.host&&
      url.pathname==='/auth/v1/verify'&&url.searchParams.has('token')&&
      ['signup','recovery'].includes(url.searchParams.get('type')??''))return url;
  }
  throw new Error('Captured local Auth email did not contain an allowlisted verification link.');
}

test('local Auth signs up without an email challenge and recovers through Mailpit',
  {timeout:60_000},async t=>{
    const email='kadmeion-ci-'+randomUUID()+'@testing.invalid';
    const firstPassword='LocalOnly-Alpha-'+randomUUID();
    const nextPassword='LocalOnly-Beta-'+randomUUID();
    await t.test('signup issues an immediate owner session',async()=>{
      const signup=await go('/auth/v1/signup',{email,password:firstPassword,
        data:{display_name:'Local Auth Email CI'}});
      assert.equal(signup.ok,true,'Local signup API unavailable');
      assert.ok(typeof signup.data?.access_token==='string','Signup did not issue an immediate session');
      const user=await go('/auth/v1/user',undefined,signup.data.access_token);
      assert.equal(user.ok,true,'New session could not be verified');
      assert.ok(user.data?.id);
      assert.equal(user.data.id,signup.data.user?.id);
      const signed=await go('/auth/v1/token?grant_type=password',{
        email,password:firstPassword});
      assert.equal(signed.ok,true,'The new account could not sign in');
      assert.equal(signed.data?.user?.id,user.data.id);
      const inbox=await mailbox('/api/v1/messages?limit=100');
      assert.equal((inbox.messages??[]).some(m=>m.To?.some(to=>to.Address===email)),false,
        'Instant signup sent unexpected confirmation email');
    });
    await t.test('recovery mail is separate and permits password rotation',async()=>{
      // Local test deliberately sends no email to an external inbox.
      const recovery=await go('/auth/v1/recover?redirect_to='+
        encodeURIComponent('http://localhost:3000/reset-password'),{email});
      assert.equal(recovery.ok,true,'Local password-recovery request failed');
      const mail=await messageFor(email);
      const link=verifyLink(mail);
      assert.equal(link.searchParams.get('type'),'recovery');
      const response=await fetch(link.toString(),{
        redirect:'manual',signal:AbortSignal.timeout(15_000)});
      assert.ok([302,303].includes(response.status),'Recovery token was rejected');
      const next=new URL(response.headers.get('location')??'/',api.origin);
      const session=new URLSearchParams(next.hash.replace(/^#/,''));
      const token=session.get('access_token');
      assert.ok(token?.length>50,'Recovery redirect omitted a usable one-time session');
      const replay=await fetch(link.toString(),{
        redirect:'manual',signal:AbortSignal.timeout(15_000)});
      const replayLocation=replay.headers.get('location');
      if(replayLocation){
        const replayUrl=new URL(replayLocation,api.origin);
        const replayFragment=new URLSearchParams(replayUrl.hash.slice(1));
        assert.equal(replayFragment.has('access_token'),false,'Reused recovery link minted a second session');
        assert.equal(replayUrl.searchParams.has('code'),false,'Reused recovery link issued a second code');
        assert.ok(replay.status>=400||replayFragment.has('error')||replayFragment.has('error_code')||
          replayUrl.searchParams.has('error')||replayUrl.searchParams.has('error_code'),
          'GoTrue did not indicate reuse of an already consumed recovery link');
      }else{
        assert.ok(replay.status>=400,'GoTrue reused an already consumed recovery link');
      }

      const update=await fetch(api.origin+'/auth/v1/user',{
        method:'PUT',headers:{apikey:key,Authorization:'Bearer '+token,
          'Content-Type':'application/json'},
        body:JSON.stringify({password:nextPassword}),
        redirect:'manual',signal:AbortSignal.timeout(15_000)
      });
      assert.equal(update.ok,true,'Verified recovery session could not change password');
      const signed=await go('/auth/v1/token?grant_type=password',{
        email,password:nextPassword});
      assert.equal(signed.ok,true,'Updated password did not authenticate');
      const old=await go('/auth/v1/token?grant_type=password',{
        email,password:firstPassword});
      assert.ok(!old.ok,'Old password still grants authentication after reset');
    });
  }
);
