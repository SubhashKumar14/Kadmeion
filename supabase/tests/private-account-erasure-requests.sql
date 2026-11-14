-- B5: account exit is request-only, owner-private, reversible and NEVER erases.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select plan(19);
select has_table('public','private_account_erasure_requests','private erasure request registry exists');
select ok((select relrowsecurity from pg_class
  where oid='public.private_account_erasure_requests'::regclass),'request history has RLS');
select ok(not has_function_privilege('anon','public.request_private_account_erasure(uuid,text)','EXECUTE'),
  'anonymous cannot request account erasure');
select ok(not has_function_privilege('anon','public.withdraw_private_account_erasure(uuid,uuid)','EXECUTE'),
  'anonymous cannot withdraw requests');
insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values
('00000000-0000-4000-8000-0000000000e1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','exit-a@invalid.example',now(),now()),
('00000000-0000-4000-8000-0000000000e2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','exit-b@invalid.example',now(),now());
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000e1',true);
select is(public.request_private_account_erasure(
  '10000000-0000-4000-8000-0000000000e1'::uuid,'DELETE MY ACCOUNT')->>'status',
  'REQUESTED_BLOCKED','owner can register a blocked, non-destructive request');
select is(public.request_private_account_erasure(
  '10000000-0000-4000-8000-0000000000e1'::uuid,'DELETE MY ACCOUNT')->>'alreadyRequested',
  'true','same operation is idempotent');
select is((select count(*) from public.private_account_erasure_requests),1::bigint,
  'owner sees exactly one private request');
select ok((select not public_revocation_verified and not reauth_verified and
  not access_terminated and not erasure_executed and not retention_verified
  from public.private_account_erasure_requests),
  'all destructive and external proof flags remain false');
do $$
declare denied boolean:=false;
begin
  begin
    perform public.request_private_account_erasure(
      '10000000-0000-4000-8000-0000000000e3'::uuid,'wrong');
  exception when invalid_parameter_value then denied:=true;
  end;
  if not denied then raise exception 'Typed confirmation bypass'; end if;
end $$;
select pass('invalid typed confirmation is rejected');
do $$
declare denied boolean:=false;
begin
  begin
    perform public.request_private_account_erasure(
      '10000000-0000-4000-8000-0000000000e3'::uuid,'DELETE MY ACCOUNT');
  exception when unique_violation then denied:=true;
  end;
  if not denied then raise exception 'Duplicate active request accepted'; end if;
end $$;
select pass('different operation cannot create second active request');
do $$
declare denied boolean:=false;
begin
  begin
    update public.private_account_erasure_requests set erasure_executed=true;
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Direct erasure proof forged'; end if;
end $$;
select pass('authenticated owner cannot directly forge erasure state');
do $$
declare denied boolean:=false;
begin
  begin
    delete from public.private_account_erasure_requests;
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Direct delete accepted'; end if;
end $$;
select pass('authenticated owner cannot delete request journal');
select set_config('kd.test.erasure_id',
  (select id::text from public.private_account_erasure_requests where status='REQUESTED_BLOCKED'),true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000e2',true);
select is((select count(*) from public.private_account_erasure_requests),0::bigint,
  'other tenant cannot list request history');
do $$
declare denied boolean:=false;
begin
  begin
    perform public.withdraw_private_account_erasure(
      current_setting('kd.test.erasure_id')::uuid,
      '20000000-0000-4000-8000-0000000000e2'::uuid);
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Cross-tenant withdrawal accepted'; end if;
end $$;
select pass('cross-tenant withdrawal is rejected');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000e1',true);
select is(public.withdraw_private_account_erasure(
  (select id from public.private_account_erasure_requests where status='REQUESTED_BLOCKED'),
  '20000000-0000-4000-8000-0000000000e1'::uuid)->>'status',
  'WITHDRAWN','owner can withdraw request without erasing account');
select is(public.withdraw_private_account_erasure(
  (select id from public.private_account_erasure_requests where status='WITHDRAWN'),
  '20000000-0000-4000-8000-0000000000e1'::uuid)->>'alreadyWithdrawn',
  'true','withdrawal replay is idempotent');
select ok((select not erasure_executed and not access_terminated and
  not public_revocation_verified from public.private_account_erasure_requests),
  'withdrawal cannot imply access termination or public revocation');
select is(public.request_private_account_erasure(
  '10000000-0000-4000-8000-0000000000e4'::uuid,'DELETE MY ACCOUNT')->>'status',
  'REQUESTED_BLOCKED','owner can make a new request after withdrawal');
select is((select count(*) from public.private_account_erasure_requests),2::bigint,
  'withdrawn history retained separately from new active request');
select * from finish();
rollback;
