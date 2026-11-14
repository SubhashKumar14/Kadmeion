-- B5 inventory is a bounded owner-private metadata snapshot, never a purge authorization.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select plan(11);
select has_table('public','private_account_exit_inventory_snapshots',
  'owner-private inventory snapshots exist');
select has_function('public','create_private_account_exit_inventory',
  array['uuid','uuid'],'versioned inventory creation RPC exists');
select has_function('public','get_private_account_exit_inventory',
  array['uuid'],'owner-only snapshot lookup RPC exists');
select ok((select relrowsecurity from pg_class where
  oid='public.private_account_exit_inventory_snapshots'::regclass),
  'snapshot table has RLS enabled');
select ok(not has_table_privilege('authenticated',
  'public.private_account_exit_inventory_snapshots','SELECT'),
  'owner cannot read raw snapshot table');
select ok(not has_table_privilege('authenticated',
  'public.private_account_exit_inventory_snapshots','INSERT'),
  'owner cannot fabricate snapshot contents');
select ok(not has_table_privilege('authenticated',
  'public.private_account_exit_inventory_snapshots','UPDATE'),
  'owner cannot modify captured snapshots');
select ok(not has_function_privilege('anon',
  'public.create_private_account_exit_inventory(uuid,uuid)','EXECUTE'),
  'anonymous caller cannot create inventory');
select ok(not has_function_privilege('anon',
  'public.get_private_account_exit_inventory(uuid)','EXECUTE'),
  'anonymous caller cannot retrieve inventory');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000e1',true);
do $$
declare denied boolean:=false;
begin
  begin
    perform public.create_private_account_exit_inventory(
      '10000000-0000-4000-8000-000000000001'::uuid,null);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Synthetic session created inventory'; end if;
end $$;
select pass('forged JWT without live GoTrue session cannot create inventory');
do $$
declare denied boolean:=false;
begin
  begin
    perform public.get_private_account_exit_inventory(
      '20000000-0000-4000-8000-000000000002'::uuid);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Synthetic session retrieved inventory'; end if;
end $$;
select pass('forged JWT without live GoTrue session cannot read inventory');
select * from finish();
rollback;
