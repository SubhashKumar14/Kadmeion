-- Structural pgTAP checks. Run with supabase test db in disposable local DB.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;
select plan(25);
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

select has_table('public','private_platform_links','owner private platform connections exist');
select ok((select relrowsecurity from pg_class
  where oid='public.private_platform_links'::regclass),
  'platform connections enforce row-level security');
select ok(not has_table_privilege('anon','public.private_platform_links','SELECT'),
  'anonymous cannot enumerate platform handles');
select ok(has_column_privilege('authenticated','public.private_platform_links',
  'handle','INSERT'),'owner may insert a handle');
select ok(has_column_privilege('authenticated','public.private_platform_links',
  'handle','UPDATE'),'owner may update handle');
select ok(not has_column_privilege('authenticated','public.private_platform_links',
  'owner_user_id','UPDATE'),'owner cannot forge ownership');
select ok(not has_column_privilege('authenticated','public.private_platform_links',
  'provider','UPDATE'),'provider identity requires explicit disconnect and reconnect');
select ok(not has_column_privilege('authenticated','public.private_platform_links',
  'profile_url','INSERT'),'user cannot inject an arbitrary URL');
select ok(not has_column_privilege('authenticated','public.private_platform_links',
  'ownership_verified','INSERT'),'owner cannot forge verification');
select ok(not has_column_privilege('authenticated','public.private_platform_links',
  'sync_status','UPDATE'),'owner cannot claim imported metrics were synced');
select ok(not has_column_privilege('authenticated','public.private_platform_links',
  'connection_mode','UPDATE'),'owner cannot claim a non-link-only integration');
select ok((select count(*)=4 from pg_policies where schemaname='public'
  and tablename='private_platform_links'),
  'links have separate owner select/insert/update/delete policies');
select * from finish();
rollback;
