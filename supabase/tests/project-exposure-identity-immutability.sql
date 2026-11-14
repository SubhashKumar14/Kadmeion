-- P0 project exposure key/owner cannot be changed after initial creation.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select plan(8);
select ok(not has_column_privilege('authenticated',
  'public.project_exposure_intents','project_id','UPDATE'),
  'owner cannot mutate the project key of a sharing record');
select ok(not has_column_privilege('authenticated',
  'public.project_exposure_intents','owner_user_id','UPDATE'),
  'owner cannot mutate the tenant key of a sharing record');
select ok(has_column_privilege('authenticated',
  'public.project_exposure_intents','show_case_study','UPDATE'),
  'owners can still withdraw case-study exposure');
select ok(has_column_privilege('authenticated',
  'public.project_exposure_intents','show_on_profile','UPDATE'),
  'owners can still withdraw profile exposure');
insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values
('00000000-0000-4000-8000-0000000000f1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','exposure-a@testing.invalid',now(),now()),
('00000000-0000-4000-8000-0000000000f2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','exposure-b@testing.invalid',now(),now());
insert into public.projects(id,owner_user_id,slug,title) values
('10000000-0000-4000-8000-0000000000f1','00000000-0000-4000-8000-0000000000f1','exposure-first','First'),
('10000000-0000-4000-8000-0000000000f2','00000000-0000-4000-8000-0000000000f1','exposure-second','Second');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000f1',true);
insert into public.project_exposure_intents(
  project_id,owner_user_id,show_on_profile,show_case_study)
values('10000000-0000-4000-8000-0000000000f1',
  '00000000-0000-4000-8000-0000000000f1',true,true);
update public.project_exposure_intents set show_case_study=false
where project_id='10000000-0000-4000-8000-0000000000f1';
select is((select show_case_study from public.project_exposure_intents
  where project_id='10000000-0000-4000-8000-0000000000f1'),
  false,'normal owner privacy withdrawal still works');
do $body$
declare denied boolean:=false;
begin
  begin
    update public.project_exposure_intents
      set project_id='10000000-0000-4000-8000-0000000000f2'
      where project_id='10000000-0000-4000-8000-0000000000f1';
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Owner reassigned sharing record to second project';end if;
end $body$;
select pass('owner cannot rebind a sharing record to another project');

reset role;
set local role service_role;
do $body$
declare denied boolean:=false;
begin
  begin
    update public.project_exposure_intents
      set owner_user_id='00000000-0000-4000-8000-0000000000f2'
      where project_id='10000000-0000-4000-8000-0000000000f1';
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Privileged writer changed exposure owner';end if;
end $body$;
select pass('privileged update cannot bypass immutable owner trigger');

reset role;
select is((select count(*) from public.project_exposure_intents
  where project_id='10000000-0000-4000-8000-0000000000f1'),
  1::bigint,'original exposure record survives rejected reassignment');
select * from finish();
rollback;
