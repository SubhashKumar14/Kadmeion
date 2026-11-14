-- B5: operator case-bound private BLOCK; no public revocation claims.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select * from no_plan();
select has_table('kadmeion_private','moderation_portfolio_holds','private hold exists');
select ok((select relrowsecurity from pg_class
  where oid='kadmeion_private.moderation_portfolio_holds'::regclass),
  'hold uses RLS');
select ok(not has_schema_privilege('authenticated','kadmeion_private','USAGE'),
  'signed-in clients cannot query private hold schema');
select ok(not has_table_privilege('authenticated',
  'kadmeion_private.moderation_portfolio_holds','SELECT'),
  'signed-in clients cannot inspect holds');
select ok(not has_function_privilege('anon',
  'public.operator_block_private_portfolio(uuid,uuid,uuid)','EXECUTE'),
  'anonymous cannot block');
select ok(has_function_privilege('authenticated',
  'public.operator_block_private_portfolio(uuid,uuid,uuid)','EXECUTE'),
  'authenticated caller must pass operator and case checks');
insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-0000000000c1','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','hold-mod@testing.invalid',now(),now()),
 ('00000000-0000-4000-8000-0000000000c2','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','hold-owner@testing.invalid',now(),now()),
 ('00000000-0000-4000-8000-0000000000c3','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','hold-other@testing.invalid',now(),now());
insert into kadmeion_private.operator_roles(user_id,role)
values('00000000-0000-4000-8000-0000000000c1','moderator');
insert into public.portfolios(id,owner_user_id,slug,title,template_id,head_revision) values
 ('10000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000c2',
  'hold-fixture','Moderation Hold Fixture','starter',1);
insert into public.portfolio_revisions(
  portfolio_id,owner_user_id,revision,base_revision,operation_id,snapshot,snapshot_sha256
) values (
  '10000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000c2',1,0,
  '20000000-0000-4000-8000-0000000000c2',
  '{"formatVersion":1,"files":{},"slots":{},"stashes":{}}'::jsonb,
  encode(sha256(convert_to('{"formatVersion":1,"files":{},"slots":{},"stashes":{}}'::jsonb::text,'UTF8')),'hex')
);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000c2',true);
select is(public.freeze_private_release_request(
  '10000000-0000-4000-8000-0000000000c2',
  '30000000-0000-4000-8000-0000000000c2',1,'PUBLIC')->>'status',
  'FROZEN','owner can freeze private revision before hold');
select set_config('kd.hold.request',(select id::text from public.private_release_requests
  where portfolio_id='10000000-0000-4000-8000-0000000000c2'),true);
select is(public.owner_prepare_private_release_pointer(
  '10000000-0000-4000-8000-0000000000c2',
  current_setting('kd.hold.request')::uuid,repeat('a',64),0,
  '40000000-0000-4000-8000-0000000000c2')->>'status',
  'PREPARED_PRIVATE','owner can prepare before operator hold');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000c3',true);
do $$
declare denied boolean:=false;
begin
  begin
    perform public.operator_block_private_portfolio(
      '50000000-0000-4000-8000-0000000000c2',
      '10000000-0000-4000-8000-0000000000c2',
      '60000000-0000-4000-8000-0000000000c3');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Nonoperator blocked a portfolio';end if;
end $$;
select pass('nonoperator cannot block any portfolio');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000c1',true);
select set_config('kd.hold.case',
  public.operator_open_moderation_case(
    '00000000-0000-4000-8000-0000000000c2',
    '70000000-0000-4000-8000-0000000000c2','SECURITY',
    'Reported credential-phishing link on the selected portfolio')->>'caseId',true);
select set_config('kd.hold.other_case',
  public.operator_open_moderation_case(
    '00000000-0000-4000-8000-0000000000c3',
    '70000000-0000-4000-8000-0000000000c3','ABUSE',
    'Unrelated reported abuse in a separate developer account')->>'caseId',true);
do $$
declare denied boolean:=false;
begin
  begin
    perform public.operator_block_private_portfolio(
      current_setting('kd.hold.other_case')::uuid,
      '10000000-0000-4000-8000-0000000000c2',
      '60000000-0000-4000-8000-0000000000c3');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Cross-owner moderation case authorized hold';end if;
end $$;
select pass('case and portfolio must belong to same owner');

select is(public.operator_block_private_portfolio(
  current_setting('kd.hold.case')::uuid,
  '10000000-0000-4000-8000-0000000000c2',
  '60000000-0000-4000-8000-0000000000c2')->>'status',
  'BLOCKED','operator blocks private candidate using scoped open case');
select is(public.operator_block_private_portfolio(
  current_setting('kd.hold.case')::uuid,
  '10000000-0000-4000-8000-0000000000c2',
  '60000000-0000-4000-8000-0000000000c2')->>'alreadyRecorded',
  'true','same operation idempotent');
do $$
declare denied boolean:=false;
begin
  begin
    perform public.operator_block_private_portfolio(
      current_setting('kd.hold.case')::uuid,
      '10000000-0000-4000-8000-0000000000c2',
      '60000000-0000-4000-8000-0000000000c3');
  exception when unique_violation then denied:=true;end;
  if not denied then raise exception 'Second block bypassed existing hold';end if;
end $$;
select pass('different operation cannot bypass existing hold');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000c2',true);
select is(public.owner_read_private_release_pointer(
  '10000000-0000-4000-8000-0000000000c2')->>'status',
  'BLOCKED','owner sees candidate blocked');
select is((public.owner_read_private_release_pointer(
  '10000000-0000-4000-8000-0000000000c2')->>'revocationGeneration')::bigint,
  2::bigint,'operator block advances revocation generation');
do $$
declare denied boolean:=false;
begin
  begin
    perform public.owner_prepare_private_release_pointer(
      '10000000-0000-4000-8000-0000000000c2',
      current_setting('kd.hold.request')::uuid,repeat('a',64),2,
      '40000000-0000-4000-8000-0000000000c3');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Owner re-prepared a held candidate';end if;
end $$;
select pass('owner cannot reprepare while moderation hold persists');
select is((select count(*) from public.private_release_visibility_events
  where portfolio_id='10000000-0000-4000-8000-0000000000c2'
    and event_type='OPERATOR_BLOCK'),1::bigint,
  'owner-visible immutable pointer audit contains operator block');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000c1',true);
select is(public.operator_close_moderation_case(
  current_setting('kd.hold.case')::uuid,
  '80000000-0000-4000-8000-0000000000c2',
  'Appeal reviewed; internal hold remains pending independent restoration proof')->>'status',
  'CLOSED','closing case does not silently remove hold');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000c2',true);
do $$
declare denied boolean:=false;
begin
  begin
    perform public.owner_prepare_private_release_pointer(
      '10000000-0000-4000-8000-0000000000c2',
      current_setting('kd.hold.request')::uuid,repeat('a',64),2,
      '40000000-0000-4000-8000-0000000000c4');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Closing case removed hold without authorization';end if;
end $$;
select pass('case closure does not reactivate private candidate');
reset role;
select is((select count(*) from kadmeion_private.moderation_portfolio_holds
  where portfolio_id='10000000-0000-4000-8000-0000000000c2'),1::bigint,
  'case-bound hold persists as private record');
select is((select count(*) from public.private_release_visibility_events
  where portfolio_id='10000000-0000-4000-8000-0000000000c2'
    and event_type='OPERATOR_BLOCK'),1::bigint,
  'exactly one operator block event recorded');

select ok(not has_function_privilege('anon',
  'public.operator_lift_private_moderation_hold(uuid,uuid,uuid,text)','EXECUTE'),
  'anonymous cannot invoke admin hold release');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000c1',true);
do $
declare denied boolean:=false;
begin
  begin
    perform public.operator_lift_private_moderation_hold(
      current_setting('kd.hold.case')::uuid,
      '10000000-0000-4000-8000-0000000000c2',
      '90000000-0000-4000-8000-0000000000c2',
      'Case was resolved; restore the owner ability to prepare privately');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Moderator escalated into administrator-only hold lift';end if;
end $;
select pass('moderator role cannot lift a resolved case hold');
reset role;
update kadmeion_private.operator_roles set role='administrator'
  where user_id='00000000-0000-4000-8000-0000000000c1';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000c1',true);
select is(public.operator_lift_private_moderation_hold(
  current_setting('kd.hold.case')::uuid,
  '10000000-0000-4000-8000-0000000000c2',
  '90000000-0000-4000-8000-0000000000c2',
  'Case was resolved; restore the owner ability to prepare privately')->>'status',
  'RELEASED_PRIVATE','administrator lifts hold without public activation');
select is(public.operator_lift_private_moderation_hold(
  current_setting('kd.hold.case')::uuid,
  '10000000-0000-4000-8000-0000000000c2',
  '90000000-0000-4000-8000-0000000000c2',
  'Case was resolved; restore the owner ability to prepare privately')->>'alreadyRecorded',
  'true','duplicate hold lift is idempotent');
reset role;
select is((select count(*) from kadmeion_private.moderation_portfolio_holds
  where portfolio_id='10000000-0000-4000-8000-0000000000c2'),0::bigint,
  'lift clears only the exact case-bound hold');
select is((select status from public.private_release_visibility_pointers
  where portfolio_id='10000000-0000-4000-8000-0000000000c2'),'BLOCKED',
  'lift leaves release pointer blocked');
select is((select revocation_generation from public.private_release_visibility_pointers
  where portfolio_id='10000000-0000-4000-8000-0000000000c2'),3::bigint,
  'lift advances revocation generation instead of reviving old bytes');
select is((select count(*) from public.private_moderation_events
  where case_id=current_setting('kd.hold.case')::uuid and
  event_type='OPERATOR_HOLD_LIFT'),1::bigint,
  'reasoned internal release has exactly one immutable case audit event');
select is((select count(*) from public.private_release_visibility_events
  where portfolio_id='10000000-0000-4000-8000-0000000000c2' and
  event_type='OPERATOR_HOLD_LIFT'),1::bigint,
  'internal lift is recorded in private pointer history');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000c2',true);
select is(public.owner_prepare_private_release_pointer(
  '10000000-0000-4000-8000-0000000000c2',
  current_setting('kd.hold.request')::uuid,repeat('a',64),3,
  '40000000-0000-4000-8000-0000000000c5')->>'status',
  'PREPARED_PRIVATE','owner can explicitly prepare a new private generation after lift');
select is(public.owner_read_private_release_pointer(
  '10000000-0000-4000-8000-0000000000c2')->>'publicServingEnabled',
  'false','hold release and owner reprepare never enable public serving');

select * from finish();
rollback;
