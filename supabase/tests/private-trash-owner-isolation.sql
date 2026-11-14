-- B5 owner isolation and recovery. Safe transaction rollback in ephemeral test DB.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select plan(18);
insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values
('00000000-0000-4000-8000-0000000000d1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','trash-owner-a@invalid.example',now(),now()),
('00000000-0000-4000-8000-0000000000d2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','trash-owner-b@invalid.example',now(),now());
insert into public.projects(id,owner_user_id,slug,title) values
('10000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000d1','trash-sample','Trashed Project');
insert into public.portfolios(id,owner_user_id,slug,title,template_id) values
('20000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000d1','trash-portfolio','Private Portfolio','starter');
-- Trigger requires the same owner JWT as ordinary authenticated writes.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000d1',true);
insert into public.project_exposure_intents(project_id,owner_user_id,show_on_profile,show_case_study)
values ('10000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000d1',true,true);

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000d1',true);
select is(public.trash_private_item('project','10000000-0000-4000-8000-0000000000d1'::uuid)->>'status',
  'trashed','owner can Trash project');
select is(public.trash_private_item('project','10000000-0000-4000-8000-0000000000d1'::uuid)->>'status',
  'already_trashed','repeat Trash is idempotent');
select ok((select trashed_at is not null from public.projects where id='10000000-0000-4000-8000-0000000000d1'),
  'project is marked trashed');
select ok((select not show_on_profile and not show_case_study from public.project_exposure_intents
  where project_id='10000000-0000-4000-8000-0000000000d1'),
  'Trash clears prior private exposure intent');
select is(public.trash_private_item('portfolio','20000000-0000-4000-8000-0000000000d1'::uuid)->>'status',
  'trashed','owner can Trash portfolio');
do $$
declare v_rejected boolean:=false;
begin
  begin
    update public.project_exposure_intents set show_on_profile=true
    where project_id='10000000-0000-4000-8000-0000000000d1';
  exception when object_not_in_prerequisite_state then v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Trashed project was exposed'; end if;
end $$;
select pass('Cannot reactivate exposure for a trashed project');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000d2',true);
select is((select count(*) from public.private_trash_items),0::bigint,
  'other owner cannot see private Trash');
do $$
declare v_rejected boolean:=false;
begin
  begin
    perform public.restore_private_item('project','10000000-0000-4000-8000-0000000000d1'::uuid);
  exception when insufficient_privilege then v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Cross-tenant restore was allowed'; end if;
end $$;
select pass('Cross-tenant restoration is rejected');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000d1',true);
select is(public.restore_private_item('project','10000000-0000-4000-8000-0000000000d1'::uuid)->>'public_visibility',
  'private','restore never republishes project');
select ok((select trashed_at is null from public.projects where id='10000000-0000-4000-8000-0000000000d1'),
  'restored project is active');
reset role;
select ok(not has_function_privilege('authenticated','public.service_list_expired_trash(integer)','EXECUTE'),
  'owner cannot invoke the retention sweep');
select ok(not has_function_privilege('authenticated','public.service_purge_expired_trash(uuid)','EXECUTE'),
  'owner cannot permanently purge item data');
select is((select count(*) from public.service_list_expired_trash(10)),0::bigint,
  'restorable and restored items are excluded');
select is(public.service_purge_expired_trash(
  (select id from public.private_trash_items where item_type='portfolio')),
  'NOT_DUE','purge refuses an unexpired item');
update public.portfolios set trashed_at=now()-interval '16 days'
  where id='20000000-0000-4000-8000-0000000000d1';
update public.private_trash_items set trashed_at=now()-interval '16 days',
  restore_until=now()-interval '1 day' where item_type='portfolio';
select is((select count(*) from public.service_list_expired_trash(10)),1::bigint,
  'expired item is eligible');
select is(public.service_purge_expired_trash(
  (select id from public.private_trash_items where item_type='portfolio')),
  'PURGED','worker purges an expired portfolio');
select is((select count(*) from public.portfolios),0::bigint,'portfolio row removed');
select is((select count(*) from public.service_list_expired_trash(10)),0::bigint,
  'repeat sweep does not rediscover a deleted item');
select * from finish();
rollback;
