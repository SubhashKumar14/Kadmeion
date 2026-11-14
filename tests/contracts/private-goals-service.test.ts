import test from 'node:test';
import assert from 'node:assert/strict';
import {SupabasePrivateGoalsService} from '../../packages/contracts/src/private-goals-service.ts';

const origin='https://unit.supabase.co';
const id='90000000-0000-4000-8000-000000000001';
const goalId='90000000-0000-4000-8000-000000000002';
const eventId='90000000-0000-4000-8000-000000000003';
const operation='90000000-0000-4000-8000-000000000004';
const now='2026-11-15T12:00:00Z';
const goal={id:goalId,owner_user_id:id,operation_id:operation,title:'Learn PostgreSQL',
  description:'',target_value:25,unit:'sessions',due_on:'2027-03-01',status:'ACTIVE',
  created_at:now,updated_at:now};
const progress={id:eventId,goal_id:goalId,owner_user_id:id,operation_id:operation,
  value:4,note:'Completed sessions',source:'MANUAL',created_at:now};
const milestone={id:eventId,goal_id:goalId,owner_user_id:id,operation_id:operation,
  title:'Finish joins',due_on:null,completed_at:null,created_at:now};
const make=(http:typeof fetch,jwt:string|null='owner.jwt')=>
  new SupabasePrivateGoalsService(origin,'sb_publishable_key',async()=>jwt,http);

test('private goal creation uses only owner JWT, no privileged API key or claimed owner field',async()=>{
  const client=make(async(url,options)=>{
    assert.equal(String(url),origin+'/rest/v1/private_goals?select=*');
    assert.equal(options?.method,'POST');
    assert.equal((options?.headers as Record<string,string>).Authorization,'Bearer owner.jwt');
    assert.equal((options?.headers as Record<string,string>).apikey,'sb_publishable_key');
    assert.equal(options?.credentials,'omit');
    assert.equal(options?.redirect,'error');
    assert.deepEqual(JSON.parse(String(options?.body)),{
      operation_id:operation,title:goal.title,description:'',target_value:25,
      unit:'sessions',due_on:'2027-03-01'});
    return Response.json([goal],{status:201});
  });
  assert.deepEqual(await client.createGoal(operation,goal.title,'',25,'sessions','2027-03-01'),goal);
});
test('goal update and deletion acknowledge the exact owned row',async()=>{
  const edit=make(async(url,init)=>{
    assert.match(String(url),/private_goals\?id=eq\./);
    assert.equal(init?.method,'PATCH');
    return Response.json([{...goal,status:'PAUSED'}]);
  });
  assert.equal((await edit.updateGoal(goalId,{status:'PAUSED'})).status,'PAUSED');
  const remove=make(async(_url,init)=>{
    assert.equal(init?.method,'DELETE');
    return Response.json([goal]);
  });
  assert.equal(await remove.deleteGoal(goalId),goalId);
});
test('manual progress rejects fabricated provider evidence and dishonest response',async()=>{
  const ok=make(async(_url,init)=>{
    assert.equal(init?.method,'POST');
    assert.deepEqual(JSON.parse(String(init?.body)),{
      goal_id:goalId,operation_id:operation,value:4,note:'Completed sessions'});
    return Response.json([progress],{status:201});
  });
  assert.equal((await ok.addProgress(goalId,operation,4,'Completed sessions')).source,'MANUAL');
  const forged=make(async()=>Response.json([{...progress,source:'VERIFIED_EXTERNAL'}]));
  await assert.rejects(forged.addProgress(goalId,operation,4,'Completed sessions'),
    {code:'INVALID_ACK'});
});
test('milestones can be created, manually completed, updated and removed',async()=>{
  const create=make(async()=>Response.json([milestone]));
  assert.equal((await create.addMilestone(goalId,operation,'Finish joins')).title,'Finish joins');
  const completedAt='2026-11-15T12:20:00Z';
  const change=make(async()=>Response.json([{...milestone,completed_at:completedAt}]));
  assert.equal((await change.updateMilestone(eventId,{completed_at:completedAt})).completed_at,completedAt);
  const remove=make(async()=>Response.json([milestone]));
  assert.equal(await remove.deleteMilestone(eventId),eventId);
});
test('tenant-crossing and unexpected acknowledgments never become successes',async()=>{
  const alien=make(async()=>Response.json([{...goal,id:'80000000-0000-4000-8000-000000000008'}]));
  await assert.rejects(alien.updateGoal(goalId,{status:'ACTIVE'}),{code:'INVALID_ACK'});
  const leaky=make(async()=>Response.json([{...goal,private_email:'someone@example.com'}]));
  await assert.rejects(leaky.listGoals(),{code:'INVALID_ACK'});
  const foreign=make(async()=>Response.json([{...progress,goal_id:'80000000-0000-4000-8000-000000000008'}]));
  await assert.rejects(foreign.listProgress(goalId),{code:'INVALID_ACK'});
});
test('read operations use owner-only tables and reject unrelated rows',async()=>{
  const list=make(async(url)=>{
    assert.equal(String(url),origin+'/rest/v1/private_goals?select=*&order=created_at.desc&limit=100');
    return Response.json([goal]);
  });
  assert.deepEqual(await list.listGoals(),[goal]);
  const listEvents=make(async()=>Response.json([progress]));
  assert.equal((await listEvents.listProgress(goalId))[0].source,'MANUAL');
  const listMilestones=make(async()=>Response.json([milestone]));
  assert.equal((await listMilestones.listMilestones(goalId))[0].title,'Finish joins');
});
test('invalid IDs, values, dates and untrusted origins fail before network',async()=>{
  let requests=0;
  const deny=make(async()=>{requests++;throw Error('Unwanted request');});
  await assert.rejects(deny.createGoal('../bad','Name'),{code:'VALIDATION'});
  await assert.rejects(deny.createGoal(operation,' '),{code:'VALIDATION'});
  await assert.rejects(deny.createGoal(operation,'Goal','',-1),{code:'VALIDATION'});
  await assert.rejects(deny.createGoal(operation,'Goal','',1.234),{code:'VALIDATION'});
  await assert.rejects(deny.createGoal(operation,'Goal','',1,'days','2027-02-30'),{code:'VALIDATION'});
  await assert.rejects(deny.addProgress(goalId,operation,-1),{code:'VALIDATION'});
  await assert.rejects(deny.updateGoal(goalId,{owner_user_id:id} as never),{code:'VALIDATION'});
  await assert.rejects(deny.updateMilestone(eventId,{source:'VERIFIED'} as never),{code:'VALIDATION'});
  assert.equal(requests,0);
  assert.throws(()=>new SupabasePrivateGoalsService('https://evil@unit.supabase.co',
    'key',async()=>null),{code:'VALIDATION'});
});
test('private goal transport handles auth expiry, conflict, malformed and oversized receipts',async()=>{
  const absent=make(async()=>{throw Error('Must not reach');},null);
  await assert.rejects(absent.listGoals(),{code:'AUTH_EXPIRED'});
  for(const [status,code] of [[401,'AUTH_EXPIRED'],[403,'FORBIDDEN'],[409,'CONFLICT'],[503,'PROVIDER_UNAVAILABLE']] as const){
    const client=make(async()=>Response.json({message:'redacted'},{status}));
    await assert.rejects(client.listGoals(),{code});
  }
  const oversized=make(async()=>new Response('[]',{headers:{
    'Content-Type':'application/json','Content-Length':'524289'}}));
  await assert.rejects(oversized.listGoals(),{code:'LIMIT_EXCEEDED'});
  const html=make(async()=>new Response('<html></html>',{headers:{'Content-Type':'text/html'}}));
  await assert.rejects(html.listGoals(),{code:'INVALID_ACK'});
});
