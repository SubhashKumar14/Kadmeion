-- B5 audit-only case and appeal flows; no account or hosting enforcement is asserted.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select plan(23);
select has_table('public','private_moderation_cases','scoped moderation case registry exists');
select has_table('public','private_moderation_events','immutable moderation event journal exists');
select ok((select relrowsecurity from pg_class where oid='public.private_moderation_cases'::regclass),
  'moderation cases protected by RLS');
select ok((select relrowsecurity from pg_class where oid='public.private_moderation_events'::regclass),
  'moderation events protected by RLS');
select ok(not has_table_privilege('anon','public.private_moderation_cases','SELECT'),
  'unauthenticated visitors cannot inspect moderation cases');
select ok(not has_table_privilege('authenticated','public.private_moderation_cases','INSERT'),
  'client cannot create cases except via operator-checked RPC');
select ok(not has_table_privilege('authenticated','public.private_moderation_events','INSERT'),
  'client cannot forge audit events');
select ok(not has_function_privilege('anon','public.operator_open_moderation_case(uuid,uuid,text,text)','EXECUTE'),
  'anon cannot open operator cases');
select ok(has_function_privilege('authenticated','public.owner_appeal_moderation_case(uuid,uuid,text)','EXECUTE'),
  'owner can submit appeal via checked RPC');
select ok(not has_schema_privilege('authenticated','kadmeion_private','USAGE'),
  'operator role table remains outside authenticated REST scope');

insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-0000000000b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mod-operator@testing.invalid',now(),now()),
 ('00000000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mod-owner@testing.invalid',now(),now()),
 ('00000000-0000-4000-8000-0000000000b3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mod-other@testing.invalid',now(),now());
insert into kadmeion_private.operator_roles(user_id,role)
values('00000000-0000-4000-8000-0000000000b1','moderator');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000b3',true);
do $$
declare denied boolean:=false;
begin
  begin
    perform public.operator_open_moderation_case(
      '00000000-0000-4000-8000-0000000000b2',
      '10000000-0000-4000-8000-0000000000b3','ABUSE',
      'Specific reported policy violation involving a portfolio');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Regular user opened operator case';end if;
end $$;
select pass('Regular signed-in user denied operator mutation');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000b1',true);
do $$
declare x jsonb;y jsonb;
begin
  x:=public.operator_open_moderation_case(
    '00000000-0000-4000-8000-0000000000b2',
    '10000000-0000-4000-8000-0000000000b1','ABUSE',
    'Specific reported policy violation involving a portfolio');
  if x->>'status'<>'OPEN' or x->>'restrictionEnforced'<>'false' or
     x->>'publicRevocationVerified'<>'false' then
    raise exception 'Operator case falsely claimed enforcement';end if;
  perform set_config('kadmeion.test_mod_case',x->>'caseId',true);
  y:=public.operator_open_moderation_case(
    '00000000-0000-4000-8000-0000000000b2',
    '10000000-0000-4000-8000-0000000000b1','ABUSE',
    'Specific reported policy violation involving a portfolio');
  if y->>'caseId'<>x->>'caseId' or y->>'alreadyRecorded'<>'true' then
    raise exception 'Operation replay duplicated moderation case';end if;
  if jsonb_array_length(public.operator_list_moderation_cases(25))<>1 then
    raise exception 'Operator case listing invalid';end if;
end $$;
select pass('Role-gated operator case, idempotent replay and minimal list are valid');
select is((select count(*) from public.private_moderation_cases),0::bigint,
  'Operator does not get client RLS access to target case list');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000b2',true);
select is((select count(*) from public.private_moderation_cases),1::bigint,
  'Target user can inspect their scoped case');
select is((select count(*) from public.private_moderation_events),1::bigint,
  'Owner sees one operator notice event');
do $$
declare x jsonb;y jsonb;
begin
  x:=public.owner_appeal_moderation_case(
    current_setting('kadmeion.test_mod_case')::uuid,
    '20000000-0000-4000-8000-0000000000b2',
    'I request a review; the content was a legitimate technical demonstration');
  y:=public.owner_appeal_moderation_case(
    current_setting('kadmeion.test_mod_case')::uuid,
    '20000000-0000-4000-8000-0000000000b2',
    'I request a review; the content was a legitimate technical demonstration');
  if x->>'status'<>'APPEAL_RECORDED' or y->>'alreadyRecorded'<>'true' then
    raise exception 'Owner appeal idempotency failed';end if;
end $$;
select pass('Owner appeal creates an immutable journal event once');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000b3',true);
select is((select count(*) from public.private_moderation_cases),0::bigint,
  'Unrelated user cannot read moderation cases');
do $$
declare denied boolean:=false;
begin
  begin
    perform public.owner_appeal_moderation_case(
      current_setting('kadmeion.test_mod_case')::uuid,
      '20000000-0000-4000-8000-0000000000b3',
      'Trying to submit an appeal on a different account');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Cross-account appeal succeeded';end if;
end $$;
select pass('Cross-account appeal denied');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000b1',true);
select is(public.operator_close_moderation_case(
  current_setting('kadmeion.test_mod_case')::uuid,
  '30000000-0000-4000-8000-0000000000b1',
  'Reviewed owner appeal and recorded the decision without enforcement'
)->>'status','CLOSED','Operator can close a case with auditable rationale');
reset role;
delete from auth.users where id='00000000-0000-4000-8000-0000000000b1';
select is((select count(*) from public.private_moderation_cases),1::bigint,
  'Operator erasure does not block target moderation case lifecycle');
select ok((select opened_by is null from public.private_moderation_cases
  where id=current_setting('kadmeion.test_mod_case')::uuid),
  'Erased operator identifier is removed from retained case');
select is((select count(*) from public.private_moderation_events where actor_user_id is null),
  2::bigint,'Erased operator identity is removed without losing review rationale');
delete from auth.users where id='00000000-0000-4000-8000-0000000000b2';
select ok((select count(*)=0 from public.private_moderation_cases) and
  (select count(*)=0 from public.private_moderation_events),
  'Target account erasure cascades moderation case and appeal data');
select * from finish();
rollback;
