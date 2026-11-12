-- Structural pgTAP checks. Run with supabase test db in disposable local DB.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;
select plan(13);
select has_table('public', 'profiles', 'owner profiles exist');
select has_table('public', 'profile_sharing_preferences', 'private sharing intent exists');
select has_table('kadmeion_private', 'operator_roles', 'operator grants live outside public API');
select has_column('public', 'profiles', 'user_id', 'profiles are keyed by auth user');
select ok((select relrowsecurity from pg_class where oid='public.profiles'::regclass), 'profiles RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.profile_sharing_preferences'::regclass), 'sharing RLS enabled');
select ok((select relrowsecurity from pg_class where oid='kadmeion_private.operator_roles'::regclass), 'operator table RLS enabled');
select is((select count(*)::integer from pg_policies where schemaname='public' and tablename='profiles'), 3, 'three owner policies on profiles');
select is((select count(*)::integer from pg_policies where schemaname='public' and tablename='profile_sharing_preferences'), 3, 'three owner policies on sharing');
select ok(not has_table_privilege('anon','public.profiles','SELECT'), 'anon cannot read private profiles');
select ok(not has_table_privilege('anon','public.profile_sharing_preferences','SELECT'), 'anon cannot read sharing intents');
select ok(not has_schema_privilege('authenticated','kadmeion_private','USAGE'), 'client has no operator schema usage');
select ok(
  case when to_regprocedure('public.rls_auto_enable()') is null then true
       else not has_function_privilege('anon','public.rls_auto_enable()','EXECUTE')
  end,
  'Optional RLS event helper is absent or inaccessible to anonymous clients'
);
select * from finish();
rollback;
