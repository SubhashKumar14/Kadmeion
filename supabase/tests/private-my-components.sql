-- WF-025 owner-owned immutable component versions must not escape RLS/RPC boundaries.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select plan(14);
select has_table('public','private_my_component_versions','owner library exists');
select ok((select relrowsecurity from pg_class
  where oid='public.private_my_component_versions'::regclass),'RLS enabled');
select ok(not has_table_privilege('anon','public.private_my_component_versions','SELECT'),
  'anonymous cannot inspect code');
select ok(not has_table_privilege('authenticated',
  'public.private_my_component_versions','SELECT'),'JWT alone cannot select code');
select ok(not has_table_privilege('authenticated',
  'public.private_my_component_versions','INSERT'),'must use verified session save RPC');
select ok(not has_table_privilege('authenticated',
  'public.private_my_component_versions','UPDATE'),'versions immutable');
select ok(not has_table_privilege('authenticated',
  'public.private_my_component_versions','DELETE'),'no untracked component deletion');
select ok(not has_function_privilege('anon',
  'public.owner_save_my_component(uuid,text,text,text,text,text,text[])','EXECUTE'),
  'anonymous cannot save code');
select ok(not has_function_privilege('anon',
  'public.owner_list_my_component_versions()','EXECUTE'),
  'anonymous cannot list code');
select ok(not has_function_privilege('anon',
  'public.owner_get_my_component_version(uuid)','EXECUTE'),
  'anonymous cannot get code');
select ok(has_function_privilege('authenticated',
  'public.owner_save_my_component(uuid,text,text,text,text,text,text[])','EXECUTE'),
  'owner can reach guarded version saver');
select ok(position('require_live_exit_auth_session' in
  pg_get_functiondef('public.owner_save_my_component(uuid,text,text,text,text,text,text[])'::regprocedure))>0,
  'save validates active Auth session');
select ok(position('private_my_component_versions' in
  pg_get_functiondef('public.owner_export_account_metadata(uuid)'::regprocedure))>0,
  'atomic account metadata export includes owned versions');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$
declare denied boolean:=false;
begin
  begin
    perform public.owner_save_my_component(
      '31000000-0000-4000-8000-000000000001','portfolio-title','Title',
      'title-stacked@1','const a = 1','const a = 2',array['title']);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Forged JWT without live GoTrue session accepted'; end if;
end $$;
select pass('unverified JWT cannot save a version');
reset role;
select * from finish();
rollback;
