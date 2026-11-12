-- Structural pgTAP B2 checks; separate remote transaction rollback tests verify cross-user outcomes.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;
select plan(9);
select has_table('public','projects','private projects table');
select has_table('public','project_exposure_intents','exposure intent table');
select has_table('public','project_assets','project assets table');
select ok((select relrowsecurity from pg_class where oid='public.projects'::regclass),'projects RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.project_exposure_intents'::regclass),'exposure intents RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.project_assets'::regclass),'assets metadata RLS enabled');
select ok(not has_table_privilege('anon','public.projects','SELECT'),'anonymous cannot list private projects');
select ok((select not public from storage.buckets where id='kadmeion-private-assets'),'asset bucket is private');
select is((select count(*)::integer from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'kd_storage_private_%'),3,'private bucket has read/write ownership policies');
select * from finish();
rollback;
