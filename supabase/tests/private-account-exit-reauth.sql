-- B5 reauth challenge is server-private and never directly writable by owners.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select plan(7);
select has_table('public','private_account_exit_reauth_challenges',
  'server-private account exit reauthentication registry exists');
select ok((select relrowsecurity from pg_class
  where oid='public.private_account_exit_reauth_challenges'::regclass),
  'challenge registry has RLS');
select ok(not has_table_privilege('authenticated','public.private_account_exit_reauth_challenges','SELECT'),
  'authenticated user cannot read challenge table');
select ok(not has_function_privilege('anon','public.begin_private_account_exit_reauth(uuid)','EXECUTE'),
  'anonymous cannot start challenge');
select ok(not has_function_privilege('anon','public.complete_private_account_exit_reauth(uuid)','EXECUTE'),
  'anonymous cannot finish challenge');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000e1',true);
do $$
declare denied boolean:=false;
begin
  begin
    perform public.begin_private_account_exit_reauth('10000000-0000-4000-8000-000000000001'::uuid);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'No live session accepted for start'; end if;
end $$;
select pass('begin requires a real live GoTrue session');
do $$
declare denied boolean:=false;
begin
  begin
    perform public.complete_private_account_exit_reauth('10000000-0000-4000-8000-000000000001'::uuid);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'No live session accepted for completion'; end if;
end $$;
select pass('completion cannot use a subject claim without a real session');
select * from finish();
rollback;
