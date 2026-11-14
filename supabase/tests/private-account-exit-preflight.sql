-- Owner-only advisory preflight: synthetic JWT without a live GoTrue session must fail.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select plan(5);
select has_function('public','private_account_exit_preflight',array[]::text[],
  'bounded account-exit preflight RPC exists');
select ok(not has_function_privilege('anon','public.private_account_exit_preflight()','EXECUTE'),
  'anonymous users cannot call the private preflight RPC');
select ok(has_function_privilege('authenticated','public.private_account_exit_preflight()','EXECUTE'),
  'authenticated callers may request their own preflight');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000e1',true);
do $$
declare denied boolean:=false;
begin
  begin
    perform public.private_account_exit_preflight();
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Synthetic JWT without GoTrue session passed preflight'; end if;
end $$;
select pass('sub claim alone is not sufficient for live-session proof');
select set_config('request.jwt.claim.sub','',true);
do $$
declare denied boolean:=false;
begin
  begin
    perform public.private_account_exit_preflight();
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Anonymous JWT passed preflight'; end if;
end $$;
select pass('missing owner identity fails closed');
select * from finish();
rollback;
