-- Private artifact-to-pointer binding: no public privilege or serving transition.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select * from no_plan();
select has_table('kadmeion_private','private_artifact_bindings',
  'server-private binding history exists');
select has_function('kadmeion_private','bind_private_artifact_candidate',
  array['uuid','bigint','text','text'],'trusted binding RPC exists');
select ok((select relrowsecurity from pg_class
  where oid='kadmeion_private.private_artifact_bindings'::regclass),
  'binding registry has RLS');
select ok(not has_table_privilege('anon',
  'kadmeion_private.private_artifact_bindings','SELECT'),
  'anonymous cannot read private binding registry');
select ok(not has_table_privilege('authenticated',
  'kadmeion_private.private_artifact_bindings','INSERT'),
  'owner cannot forge private binding registry');
select ok(not has_function_privilege('anon',
  'kadmeion_private.bind_private_artifact_candidate(uuid,bigint,text,text)','EXECUTE'),
  'anonymous cannot bind private artifacts');
select ok(not has_function_privilege('authenticated',
  'kadmeion_private.bind_private_artifact_candidate(uuid,bigint,text,text)','EXECUTE'),
  'owner cannot bind private artifacts');
select ok(has_function_privilege('service_role',
  'kadmeion_private.bind_private_artifact_candidate(uuid,bigint,text,text)','EXECUTE'),
  'trusted service role can submit checked private artifact bytes');

insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at)
values('00000000-0000-4000-8000-0000000000c1',
  '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'binding@testing.invalid',now(),now());
insert into public.portfolios(id,owner_user_id,slug,title,template_id,head_revision)
 values('10000000-0000-4000-8000-0000000000c1',
  '00000000-0000-4000-8000-0000000000c1','binding-test',
  'Binding Test','starter',1);
insert into public.portfolio_revisions(
  portfolio_id,owner_user_id,revision,base_revision,operation_id,snapshot,snapshot_sha256
) values('10000000-0000-4000-8000-0000000000c1',
 '00000000-0000-4000-8000-0000000000c1',1,0,
 '20000000-0000-4000-8000-0000000000c1',
 '{"formatVersion":1,"files":{},"slots":{},"stashes":{}}'::jsonb,
 encode(sha256(convert_to('{"formatVersion":1,"files":{},"slots":{},"stashes":{}}'::jsonb::text,'UTF8')),'hex'));
insert into public.private_release_requests(
  id,portfolio_id,owner_user_id,operation_id,revision,snapshot_sha256,visibility_intent
) select '30000000-0000-4000-8000-0000000000c1',
 portfolio_id,owner_user_id,
 '40000000-0000-4000-8000-0000000000c1',1,snapshot_sha256,'UNLISTED'
 from public.portfolio_revisions
 where portfolio_id='10000000-0000-4000-8000-0000000000c1';

select set_config('kd.bind.html','<!doctype html><html><head><meta name="robots" content="noindex"></head><body>Private &amp; safe</body></html>',true);
select set_config('kd.bind.manifest',jsonb_build_object(
  'kind','kadmeion-private-immutable-artifact-candidate','formatVersion',1,
  'source',jsonb_build_object('portfolioId','10000000-0000-4000-8000-0000000000c1',
    'revision',1,'snapshotSha256',
    (select snapshot_sha256 from public.portfolio_revisions
      where portfolio_id='10000000-0000-4000-8000-0000000000c1'),
    'visibilityIntent','UNLISTED'),
  'files',jsonb_build_array(jsonb_build_object('path','index.html',
    'byteLength',octet_length(current_setting('kd.bind.html')),
    'sha256',encode(sha256(convert_to(current_setting('kd.bind.html'),'UTF8')),'hex'))),
  'deployable',false,'publicUrl',null)::text,true);
insert into public.private_release_visibility_pointers(
  portfolio_id,owner_user_id,status,candidate_request_id,
  candidate_manifest_sha256,generation,revocation_generation)
values('10000000-0000-4000-8000-0000000000c1',
 '00000000-0000-4000-8000-0000000000c1','PREPARED_PRIVATE',
 '30000000-0000-4000-8000-0000000000c1',
 encode(sha256(convert_to(current_setting('kd.bind.manifest'),'UTF8')),'hex'),
 1,0);

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000c1',true);
do $block$
declare denied boolean:=false;
begin
  begin
    perform kadmeion_private.bind_private_artifact_candidate(
      '30000000-0000-4000-8000-0000000000c1',1,
      current_setting('kd.bind.manifest'),current_setting('kd.bind.html'));
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Owner called trusted binding RPC';end if;
end $block$;
select pass('authenticated owner cannot bypass trusted binding');
reset role;
set local role service_role;
select is(kadmeion_private.bind_private_artifact_candidate(
  '30000000-0000-4000-8000-0000000000c1',1,
  current_setting('kd.bind.manifest'),current_setting('kd.bind.html')
  )->>'status','BOUND_PRIVATE','verified byte/pointer comparison binds privately');
select is(kadmeion_private.bind_private_artifact_candidate(
  '30000000-0000-4000-8000-0000000000c1',1,
  current_setting('kd.bind.manifest'),current_setting('kd.bind.html')
  )->>'alreadyBound','true','exact retry is idempotent');
select is(kadmeion_private.bind_private_artifact_candidate(
  '30000000-0000-4000-8000-0000000000c1',1,
  current_setting('kd.bind.manifest'),current_setting('kd.bind.html')
  )->>'publicServingEnabled','false','trusted binding is not publication');
reset role;
select is((select count(*) from kadmeion_private.private_artifact_bindings)::bigint,
  1::bigint,'one private record per pointer generation');
set local role service_role;

do $block$
declare denied boolean:=false;
begin
  begin
    perform kadmeion_private.bind_private_artifact_candidate(
      '30000000-0000-4000-8000-0000000000c1',1,
      current_setting('kd.bind.manifest'),'tampered bytes');
  exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Altered HTML accepted';end if;
end $block$;
select pass('altered HTML invalidates manifest SHA evidence');
do $block$
declare denied boolean:=false;
begin
  begin
    perform kadmeion_private.bind_private_artifact_candidate(
      '30000000-0000-4000-8000-0000000000c1',1,
      current_setting('kd.bind.manifest')||' ','tampered bytes');
  exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Padded manifest accepted';end if;
end $block$;
select pass('modified manifest with same JSON fields but new raw hash fails CAS');
do $block$
declare denied boolean:=false;
begin
  begin
    perform kadmeion_private.bind_private_artifact_candidate(
      '30000000-0000-4000-8000-0000000000c1',2,
      current_setting('kd.bind.manifest'),current_setting('kd.bind.html'));
  exception when serialization_failure then denied:=true;end;
  if not denied then raise exception 'Future generation accepted';end if;
end $block$;
select pass('wrong pointer generation cannot be bound');
do $block$
declare denied boolean:=false;
begin
  begin
    perform kadmeion_private.bind_private_artifact_candidate(
      '90000000-0000-4000-8000-0000000000c1',1,
      current_setting('kd.bind.manifest'),current_setting('kd.bind.html'));
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unknown request accepted';end if;
end $block$;
select pass('foreign or missing release request never binds');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000c1',true);
select is(public.owner_block_private_release_pointer(
  '10000000-0000-4000-8000-0000000000c1',
  '50000000-0000-4000-8000-0000000000c1')->>'status',
  'BLOCKED','owner can revoke prepared private candidate');
reset role;
set local role service_role;
do $block$
declare denied boolean:=false;
begin
  begin
    perform kadmeion_private.bind_private_artifact_candidate(
      '30000000-0000-4000-8000-0000000000c1',1,
      current_setting('kd.bind.manifest'),current_setting('kd.bind.html'));
  exception when serialization_failure then denied:=true;end;
  if not denied then raise exception 'Revoked private pointer accepted binding';end if;
end $block$;
select pass('replayed bind cannot survive owner block/revocation');
reset role;
select is((select count(*) from kadmeion_private.private_artifact_bindings)::bigint,
  1::bigint,'revocation leaves historical integrity evidence but no live state');
select * from finish();
rollback;
