-- Structural pgTAP B2 checks; separate remote transaction rollback tests verify cross-user outcomes.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;
select plan(17);
select has_table('public','projects','private projects table');
select has_table('public','project_exposure_intents','exposure intent table');
select has_table('public','project_assets','project assets table');
select ok((select relrowsecurity from pg_class where oid='public.projects'::regclass),'projects RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.project_exposure_intents'::regclass),'exposure intents RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.project_assets'::regclass),'assets metadata RLS enabled');
select ok(not has_table_privilege('anon','public.projects','SELECT'),'anonymous cannot list private projects');
select ok((select not public from storage.buckets where id='kadmeion-private-assets'),'asset bucket is private');
select is((select count(*)::integer from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'kd_storage_private_%'),2,'private bucket has owner read/create policies without overwrite');
-- Candidate-only permission checks; absence is an explicit skip, never a pass.
select case when to_regprocedure('public.read_private_project_thumbnail(uuid)') is null
  then skip('thumbnail migration not present',1)
  else ok(has_function_privilege('authenticated',to_regprocedure('public.read_private_project_thumbnail(uuid)'),'EXECUTE'),'owner thumbnail read RPC granted') end;
select case when to_regprocedure('public.read_private_project_thumbnail(uuid)') is null
  then skip('thumbnail migration not present',1)
  else ok(not has_function_privilege('anon',to_regprocedure('public.read_private_project_thumbnail(uuid)'),'EXECUTE'),'anonymous thumbnail read denied') end;
select case when to_regprocedure('public.set_private_project_thumbnail(uuid,bigint,uuid,uuid)') is null
  then skip('thumbnail migration not present',1)
  else ok(has_function_privilege('authenticated',to_regprocedure('public.set_private_project_thumbnail(uuid,bigint,uuid,uuid)'),'EXECUTE'),'owner CAS RPC granted') end;
select case when to_regprocedure('public.set_private_project_thumbnail(uuid,bigint,uuid,uuid)') is null
  then skip('thumbnail migration not present',1)
  else ok(not has_function_privilege('anon',to_regprocedure('public.set_private_project_thumbnail(uuid,bigint,uuid,uuid)'),'EXECUTE'),'anonymous CAS denied') end;
select case when to_regprocedure('public.set_private_project_thumbnail(uuid,bigint,uuid,uuid)') is null
  then skip('thumbnail migration not present',1)
  else ok(not has_function_privilege('service_role',to_regprocedure('public.set_private_project_thumbnail(uuid,bigint,uuid,uuid)'),'EXECUTE'),'service role cannot masquerade as owner CAS caller') end;
select case when not exists(select 1 from information_schema.columns where table_schema='public' and table_name='projects' and column_name='thumbnail_asset_id')
  then skip('thumbnail migration not present',1)
  else ok(not has_column_privilege('authenticated','public.projects','thumbnail_asset_id','UPDATE'),'owner cannot bypass thumbnail CAS with direct update') end;
select case when not exists(select 1 from information_schema.columns where table_schema='public' and table_name='projects' and column_name='thumbnail_operation_id')
  then skip('thumbnail migration not present',1)
  else ok(not has_column_privilege('authenticated','public.projects','thumbnail_operation_id','INSERT'),'owner cannot forge thumbnail operation at insert') end;
select case when not exists(select 1 from information_schema.columns where table_schema='public' and table_name='projects' and column_name='thumbnail_operation_base_revision')
  then skip('thumbnail migration not present',1)
  else ok(not has_column_privilege('authenticated','public.projects','thumbnail_operation_base_revision','UPDATE'),'owner cannot forge thumbnail base revision') end;
select * from finish();
rollback;
