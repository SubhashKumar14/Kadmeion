-- P2 Goal ownership / append-only provenance / milestone isolation.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select * from no_plan();

select has_table('public','private_goals','owner-private goals exist');
select has_table('public','private_goal_progress_events','append-only progress exists');
select has_table('public','private_goal_milestones','owner-private milestones exist');
select ok((select relrowsecurity from pg_class where oid='public.private_goals'::regclass),
  'goals enable RLS');
select ok((select relrowsecurity from pg_class where oid='public.private_goal_progress_events'::regclass),
  'manual event journal enables RLS');
select ok((select relrowsecurity from pg_class where oid='public.private_goal_milestones'::regclass),
  'milestones enable RLS');
select ok(not has_table_privilege('anon','public.private_goals','SELECT'),
  'anonymous cannot read private goals');
select ok(not has_table_privilege('anon','public.private_goal_progress_events','SELECT'),
  'anonymous cannot inspect progress');
select ok(not has_table_privilege('anon','public.private_goal_milestones','SELECT'),
  'anonymous cannot read milestones');
select ok(not has_table_privilege('authenticated','public.private_goal_progress_events','UPDATE'),
  'owner cannot rewrite manual event history');
select ok(not has_table_privilege('authenticated','public.private_goal_progress_events','DELETE'),
  'owner cannot silently remove event history except deleting the goal');
select ok(not has_column_privilege('authenticated','public.private_goal_progress_events',
  'source','INSERT'),'user cannot claim provider-verified provenance');
select ok(not has_column_privilege('authenticated','public.private_goals',
  'owner_user_id','UPDATE'),'owner identity is immutable');

insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at)
values
('90000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','goal-owner@testing.invalid',now(),now()),
('90000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','goal-other@testing.invalid',now(),now());
set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001',true);

insert into public.private_goals(operation_id,title,description,target_value,unit,due_on)
values('91000000-0000-4000-8000-000000000001','Learn PostgreSQL',
  'Read and practice each week',25,'sessions','2027-03-01');
select is((select count(*)::integer from public.private_goals),1,
  'owner sees own created private goal');
select is((select owner_user_id from public.private_goals where title='Learn PostgreSQL'),
  '90000000-0000-4000-8000-000000000001'::uuid,
  'owner ID is derived from JWT rather than owner-supplied content');
insert into public.private_goal_progress_events(
  goal_id,operation_id,value,note
) select id,'92000000-0000-4000-8000-000000000001',4,'Four sessions'
  from public.private_goals where title='Learn PostgreSQL';
insert into public.private_goal_progress_events(
  goal_id,operation_id,value,note
) select id,'92000000-0000-4000-8000-000000000002',3,'Correction to prior count'
  from public.private_goals where title='Learn PostgreSQL';
select is((select count(*)::integer from public.private_goal_progress_events),2,
  'manual correction is appended without replacing previous event');
select is((select source from public.private_goal_progress_events
    order by created_at,id limit 1),'MANUAL',
  'manual provenance cannot masquerade as verified provider data');
insert into public.private_goal_milestones(goal_id,operation_id,title,due_on)
select id,'93000000-0000-4000-8000-000000000001','Finish joins','2027-01-01'
  from public.private_goals where title='Learn PostgreSQL';
update public.private_goal_milestones set completed_at=transaction_timestamp()
  where title='Finish joins';
select is((select count(*)::integer from public.private_goal_milestones
  where completed_at is not null),1,'owner manually completes a milestone');

select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000002',true);
select is((select count(*)::integer from public.private_goals),0,
  'second account cannot enumerate first owner goals');
select is((select count(*)::integer from public.private_goal_progress_events),0,
  'second account cannot read another owners progress history');
select is((select count(*)::integer from public.private_goal_milestones),0,
  'second account cannot read milestones');
update public.private_goals set title='Stolen' where operation_id=
  '91000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.private_goals),0,
  'foreign update cannot make a hidden goal visible');
reset role;
select is((select title from public.private_goals where operation_id=
  '91000000-0000-4000-8000-000000000001'),'Learn PostgreSQL',
  'cross-account write did not alter the owned goal');
select * from finish();
rollback;
