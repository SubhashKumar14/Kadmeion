-- B5 Storage reconciliation must be owner-only and non-destructive.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select plan(8);
select has_function('public','reconcile_private_account_exit_storage',
  array['uuid'],'owner Storage metadata reconciliation RPC exists');
select ok(has_function_privilege('authenticated',
  'public.reconcile_private_account_exit_storage(uuid)','EXECUTE'),
  'authenticated owners may request reconciliation');
select ok(not has_function_privilege('anon',
  'public.reconcile_private_account_exit_storage(uuid)','EXECUTE'),
  'anonymous callers cannot request reconciliation');
select ok(not has_column_privilege('authenticated',
  'public.project_assets','object_path','UPDATE'),
  'verified object path cannot be changed by the browser');
select ok(not has_column_privilege('authenticated',
  'public.project_assets','byte_size','UPDATE'),
  'verified byte size cannot be changed by the browser');
select ok(has_column_privilege('authenticated',
  'public.project_assets','alt_text','UPDATE'),
  'owners retain the ability to edit accessibility text');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000e1',true);
do $$
declare denied boolean:=false;
begin
  begin
    perform public.reconcile_private_account_exit_storage(
      '10000000-0000-4000-8000-000000000001'::uuid);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Synthetic JWT bypassed live session'; end if;
end $$;
select pass('forged session cannot reconcile Storage');
do $$
declare denied boolean:=false;
begin
  begin
    perform public.reconcile_private_account_exit_storage(null);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Anonymous synthetic session reached RPC'; end if;
end $$;
select pass('live session is required before argument validation');
select * from finish();
rollback;
