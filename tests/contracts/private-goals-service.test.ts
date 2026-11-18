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


test('identical network retries recover existing owner-scoped records; changed intents conflict',async()=>{
  let calls:string[]=[];
  const client=make(async(url,init)=>{
    const path=String(url).replace(origin+'/rest/v1/','');
    calls.push(path+':'+init?.method);
    if(init?.method==='POST')return Response.json({code:'23505'},{status:409});
    if(path.startsWith('private_goals?'))return Response.json([{...goal,status:'PAUSED'}]);
    if(path.startsWith('private_goal_progress_events?'))return Response.json([progress]);
    return Response.json([{...milestone,completed_at:now}]);
  });
  assert.equal((await client.createGoal(operation,goal.title,'',25,'sessions','2027-03-01')).status,'PAUSED');
  assert.equal((await client.addProgress(goalId,operation,4,'Completed sessions')).source,'MANUAL');
  assert.equal((await client.addMilestone(goalId,operation,'Finish joins')).completed_at,now);
  assert.equal(calls.length,6);
  assert.ok(calls.every((v,i)=>i%2===0?v.endsWith(':POST'):v.endsWith(':GET')));
  await assert.rejects(client.addProgress(goalId,operation,5,'Completed sessions'),{code:'CONFLICT'});
  await assert.rejects(client.createGoal(operation,'Different title','',25,'sessions','2027-03-01'),
    {code:'CONFLICT'});
});
test('UUID case is canonicalized before owner-bound writes and acknowledgments',async()=>{
  const upper='A0000000-0000-4000-8000-000000000004';
  const lower=upper.toLowerCase();
  const client=make(async(_url,init)=>{
    const body=JSON.parse(String(init?.body));
    assert.equal(body.operation_id,lower);
    return Response.json([{...goal,operation_id:lower}]);
  });
  assert.equal((await client.createGoal(upper,goal.title,'',25,'sessions',
    '2027-03-01')).operation_id,lower);
});


test('complete private goal histories can be read in bounded keyset pages',async()=>{
  const second={...goal,id:eventId,operation_id:'90000000-0000-4000-8000-000000000005'};
  const urls:string[]=[];
  const client=make(async(url)=>{
    urls.push(String(url));
    if(urls.length===1)return Response.json([goal,second]);
    return Response.json([second]);
  });
  const first=await client.listGoalsPage(1);
  assert.deepEqual(first.items,[goal]);
  assert.equal(first.nextCursor,goal.id);
  const next=await client.listGoalsPage(1,first.nextCursor);
  assert.deepEqual(next.items,[second]);
  assert.equal(next.nextCursor,null);
  assert.match(urls[0],/limit=2/);
  assert.match(urls[1],/id=gt\./);
});

test('pagination rejects duplicate, unordered, wrong-goal and oversized replies',async()=>{
  const repeated=make(async()=>Response.json([goal,goal]));
  await assert.rejects(repeated.listGoalsPage(1),{code:'INVALID_ACK'});
  const foreign=make(async()=>Response.json([{...progress,
    goal_id:'80000000-0000-4000-8000-000000000008'}]));
  await assert.rejects(foreign.listProgressPage(goalId),{code:'INVALID_ACK'});
  const oversize=make(async()=>Response.json(Array(3).fill(goal)));
  await assert.rejects(oversize.listGoalsPage(1),{code:'INVALID_ACK'});
  await assert.rejects(repeated.listGoalsPage(101),{code:'VALIDATION'});
  await assert.rejects(repeated.listGoalsPage(1,'/bad'),{code:'VALIDATION'});
});

test('manual milestone completion accepts canonicalized provider timestamp response',async()=>{
  const input='2026-11-15T12:20:00.000Z';
  const canonical='2026-11-15T12:20:00+00:00';
  const client=make(async()=>Response.json([{...milestone,completed_at:canonical}]));
  const response=await client.updateMilestone(eventId,{completed_at:input});
  assert.equal(response.completed_at,canonical);
});

/** B16 C07 WF-041: conditional writes and raw microsecond history. No candidate skip. */
const expectedRaw='2026-11-17T12:00:00.123456+05:30';
const nextRaw='2026-11-17T06:30:00.123457Z';
const conditionalGoal={...goal,updated_at:expectedRaw};
const c07=(http:typeof fetch)=>new SupabasePrivateGoalsService(origin,'sb_publishable_key',async()=> 'owner.jwt',http,id);
test('C07 conditional goal PATCH and DELETE keep raw timestamp and require exact, advancing receipt',async()=>{
  for(const variant of ['valid','zero','same','older','wrong-owner','wrong-payload'] as const){
    let writes=0;
    const client=c07(async(url,init)=>{
      writes++;
      assert.equal(new URL(String(url)).searchParams.get('updated_at'),'eq.'+expectedRaw);
      assert.equal(new URL(String(url)).searchParams.get('id'),'eq.'+goalId);
      assert.equal(init?.method,'PATCH');
      assert.deepEqual(JSON.parse(String(init?.body)),{title:'Revised title'});
      const changed={...conditionalGoal,title:'Revised title',updated_at:nextRaw};
      if(variant==='zero')return Response.json([]);
      return Response.json([{...changed,...(variant==='same'?{updated_at:'2026-11-17T06:30:00.123456Z'}:
        variant==='older'?{updated_at:'2026-11-17T06:30:00.123455Z'}:
        variant==='wrong-owner'?{owner_user_id:eventId}:variant==='wrong-payload'?{title:'Other'}:{})}]);
    });
    const result=client.updateGoalIfUnchanged(goalId,expectedRaw,{title:'Revised title'});
    if(variant==='valid')assert.equal((await result).updated_at,nextRaw);
    else await assert.rejects(result,{code:variant==='zero'?'CONFLICT':'INVALID_ACK'});
    assert.equal(writes,1,'no blind retry of conditional write');
  }
  for(const variant of ['valid','zero','wrong-version','wrong-owner'] as const){
    const client=c07(async(url,init)=>{
      assert.equal(init?.method,'DELETE');
      assert.equal(new URL(String(url)).searchParams.get('updated_at'),'eq.'+expectedRaw);
      return Response.json(variant==='zero'?[]:[{...conditionalGoal,
        updated_at:variant==='wrong-version'?nextRaw:'2026-11-17T06:30:00.123456Z',
        owner_user_id:variant==='wrong-owner'?eventId:id}]);
    });
    const result=client.deleteGoalIfUnchanged(goalId,expectedRaw);
    if(variant==='valid')assert.equal(await result,goalId);
    else await assert.rejects(result,{code:variant==='zero'?'CONFLICT':'INVALID_ACK'});
  }
  let calls=0;
  const client=c07(async()=>{calls++;return Response.json([]);});
  await assert.rejects(client.updateGoalIfUnchanged(goalId,'not-a-date',{title:'Bad'}),{code:'VALIDATION'});
  await assert.rejects(client.deleteGoalIfUnchanged(goalId,'2026-02-30T00:00:00Z'),{code:'VALIDATION'});
  assert.equal(calls,0);
});
test('C07 newest-first history spans more than 100 rows, preserving microsecond cursor and UUID ties',async()=>{
  const rowId=(n:number)=>'91000000-0000-4000-8000-'+String(n).padStart(12,'0');
  // Two equal timestamps share the page boundary; differing offsets
  // express the same instant, so neither string nor JS millisecond sorting is valid.
  const rows=Array.from({length:105},(_,i)=>({...progress,id:rowId(105-i),
    created_at:i===100?'2026-11-17T12:00:00.123401+05:30':
      '2026-11-17T06:30:00.'+String(123500-(i===100?99:i)).padStart(6,'0')+'Z'}));
  // Force equal timestamps at indices 99/100 in different representations.
  rows[99].created_at='2026-11-17T06:30:00.123401Z';
  let calls=0;
  const client=c07(async(url)=>{
    const q=new URL(String(url)).searchParams;
    assert.equal(q.get('order'),'created_at.desc,id.desc');
    assert.equal(q.get('goal_id'),'eq.'+goalId);
    assert.equal(q.get('limit'),'101');
    calls++;
    if(calls===1){assert.equal(q.has('or'),false);return Response.json(rows.slice(0,101));}
    const last=rows[99];
    assert.equal(q.get('or'),'(created_at.lt.'+last.created_at+',and(created_at.eq.'+
      last.created_at+',id.lt.'+last.id+'))');
    return Response.json(rows.slice(100));
  });
  const first=await client.listProgressChronologicalPage(goalId,100);
  assert.equal(first.items.length,100);
  assert.deepEqual(first.nextCursor,{version:1,goalId,ownerUserId:id,createdAt:rows[99].created_at,id:rows[99].id});
  const second=await client.listProgressChronologicalPage(goalId,100,first.nextCursor);
  assert.deepEqual([...first.items,...second.items],rows);
  assert.equal(second.nextCursor,null);assert.equal(calls,2);
  assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,105);
});
test('C07 chronology rejects wrong owner/goal, duplicate or increasing exact instant across cursor',async()=>{
  const cursor={version:1 as const,goalId,ownerUserId:id,createdAt:expectedRaw,id:eventId};
  const before={...progress,id:operation,created_at:'2026-11-17T06:30:00.123455Z'};
  for(const rows of [
    [{...before,owner_user_id:operation}],
    [{...before,goal_id:operation}],
    [before,before],
    [{...before,created_at:nextRaw}],
    [{...before,created_at:'2026-11-17T06:30:00.123456Z',id:eventId}]
  ]){
    await assert.rejects(c07(async()=>Response.json(rows)).listProgressChronologicalPage(goalId,50,cursor),{code:'INVALID_ACK'});
  }
  let calls=0;
  const client=c07(async()=>{calls++;return Response.json([]);});
  await assert.rejects(client.listProgressChronologicalPage(goalId,50,{...cursor,ownerUserId:operation}),{code:'VALIDATION'});
  await assert.rejects(client.listProgressChronologicalPage(goalId,50,{...cursor,goalId:operation}),{code:'VALIDATION'});
  assert.equal(calls,0);
});
