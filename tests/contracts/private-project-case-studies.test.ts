import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrivateCaseStudy, ContractError, SupabasePrivateProjectService } from '../../packages/contracts/src/index.ts';

test('case study modules preserve hidden content and ordered explicit visibility',()=>{
  const result=normalizePrivateCaseStudy({sections:[
    {id:'challenge',kind:'challenge',title:'Challenge',body:'Still stored when hidden',visible:false},
    {id:'results',kind:'results',title:'Results',body:'Measured',visible:true}
  ]});
  assert.equal(result.sections[0].visible,false);
  assert.equal(result.sections[0].body,'Still stored when hidden');
  assert.equal(result.sections[1].id,'results');
});

test('duplicate, malformed and excessively large case-study sections are rejected',()=>{
  for(const sections of [
    [{id:'x',kind:'challenge',title:'a',body:'b',visible:true},{id:'x',kind:'results',title:'b',body:'c',visible:false}],
    [{id:'../path',kind:'challenge',title:'x',body:'',visible:true}],
    [{id:'valid',kind:'unknown',title:'x',body:'',visible:true}],
    [{id:'valid',kind:'results',title:'x',body:'z'.repeat(12001),visible:true}]
  ])assert.throws(()=>normalizePrivateCaseStudy({sections}),ContractError);
});

test('project case-study edits use server-side revision RPC, not direct table update',async()=>{
  const calls:string[]=[];
  const fetcher=async(input:RequestInfo|URL,init?:RequestInit)=>{
    calls.push(String(input));
    assert.equal(init?.method,'POST');
    return new Response(JSON.stringify({id:'project',revision:2}),{status:200});
  };
  const service=new SupabasePrivateProjectService('https://test.supabase.co','pub',async()=> 'jwt',fetcher as typeof fetch);
  const v=await service.updateCaseStudyWithRevision('project',1,{sections:[]});
  assert.deepEqual(v,{id:'project',revision:2});
  assert.equal(calls[0].endsWith('/rest/v1/rpc/update_private_project_case_study'),true);
});
