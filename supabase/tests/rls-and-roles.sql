-- Structural pgTAP checks. Run with supabase test db in disposable local DB.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;
select plan(56);
select has_table('public', 'profiles', 'owner profiles exist');
select has_table('public', 'profile_sharing_preferences', 'private sharing intent exists');
select has_table('kadmeion_private', 'operator_roles', 'operator grants live outside public API');
select has_column('public', 'profiles', 'user_id', 'profiles are keyed by auth user');
select ok((select relrowsecurity from pg_class where oid='public.profiles'::regclass), 'profiles RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.profile_sharing_preferences'::regclass), 'sharing RLS enabled');
select ok((select relrowsecurity from pg_class where oid='kadmeion_private.operator_roles'::regclass), 'operator table RLS enabled');
select is((select count(*)::integer from pg_policies where schemaname='public' and tablename='profiles'), 3, 'three owner policies on profiles');
select is((select count(*)::integer from pg_policies where schemaname='public' and tablename='profile_sharing_preferences'), 1, 'one read-only owner policy on sharing');
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
select has_table('public','private_notifications','persistent owner inbox exists');
select ok(not has_any_column_privilege('anon','public.private_notifications','SELECT'),
  'anonymous cannot read any notification field');
select ok(not has_any_column_privilege('authenticated','public.private_notifications','INSERT'),
  'authenticated callers cannot forge notification inserts');
select ok(not has_any_column_privilege('authenticated','public.private_notifications','UPDATE'),
  'notification updates are limited to the owner acknowledgement RPC');
select ok(not has_column_privilege('authenticated','public.private_notifications','source_key','SELECT'),
  'internal deduplication keys are excluded from owner API output');
select ok(not has_function_privilege('anon','public.owner_acknowledge_notification(uuid,boolean)','EXECUTE'),
  'anonymous cannot acknowledge alerts');
select ok(not has_any_column_privilege('authenticated','public.private_notification_preferences','UPDATE'),
  'notification preference changes require the scoped RPC');
-- C08: real privileges, including column-level grants; no legacy writer escape.
select has_table('kadmeion_private','owner_preference_cas_state','private CAS ledger exists');
select ok((select relrowsecurity from pg_class where oid='kadmeion_private.owner_preference_cas_state'::regclass),'CAS ledger has RLS');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) r
  where has_any_column_privilege(r,'kadmeion_private.owner_preference_cas_state','SELECT,INSERT,UPDATE,REFERENCES')
     or has_table_privilege(r,'kadmeion_private.owner_preference_cas_state','DELETE,TRUNCATE,TRIGGER')),'no API role can read or mutate the ledger');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) r
  where has_any_column_privilege(r,'public.profile_sharing_preferences','INSERT,UPDATE,REFERENCES')
     or has_table_privilege(r,'public.profile_sharing_preferences','DELETE,TRUNCATE,TRIGGER')),'sharing direct writes including column grants revoked');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) r
  where has_any_column_privilege(r,'public.private_notification_preferences','INSERT,UPDATE,REFERENCES')
     or has_table_privilege(r,'public.private_notification_preferences','DELETE,TRUNCATE,TRIGGER')),'notification direct writes revoked');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) r
  where has_function_privilege(r,'public.owner_set_notification_preferences(boolean,boolean,boolean)','EXECUTE')),'legacy notification setter denied to every API role');
select ok(has_function_privilege('authenticated','public.read_owner_profile_sharing_state()','EXECUTE'),'authenticated may read own sharing CAS');
select ok(has_function_privilege('authenticated','public.change_owner_profile_sharing(bigint,jsonb,jsonb,uuid)','EXECUTE'),'authenticated may change own sharing CAS');
select ok(has_function_privilege('authenticated','public.read_owner_notification_preferences_state()','EXECUTE'),'authenticated may read own notification CAS');
select ok(has_function_privilege('authenticated','public.change_owner_notification_preferences(bigint,jsonb,jsonb,uuid)','EXECUTE'),'authenticated may change own notification CAS');
select ok(not exists(select 1 from unnest(array['anon','service_role']) r
  cross join unnest(array['public.read_owner_profile_sharing_state()','public.change_owner_profile_sharing(bigint,jsonb,jsonb,uuid)',
    'public.read_owner_notification_preferences_state()','public.change_owner_notification_preferences(bigint,jsonb,jsonb,uuid)']) p
  where has_function_privilege(r,p,'EXECUTE')),'CAS endpoints unavailable to anonymous or service role');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) r
  where has_function_privilege(r,'kadmeion_private.change_owner_preference(text,bigint,jsonb,jsonb,uuid)','EXECUTE')),'private CAS helper cannot be invoked by API roles');
-- C14 R7: physical database ACL and outward guard acceptance.
-- Must be composed only WITH 20261117160600_case_bound_account_sharing_restriction.sql.
select has_table('kadmeion_private','account_sharing_restrictions','C14 owner restriction ledger exists');
select has_table('kadmeion_private','account_sharing_restriction_events','C14 immutable restriction journal exists');
select ok((select bool_and(c.relrowsecurity) from pg_class c
  where c.oid in ('kadmeion_private.account_sharing_restrictions'::regclass,
                 'kadmeion_private.account_sharing_restriction_events'::regclass)),
  'C14 both restriction tables enforce RLS');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) r
  cross join unnest(array['kadmeion_private.account_sharing_restrictions',
    'kadmeion_private.account_sharing_restriction_events']) t
  where has_any_column_privilege(r,t,'SELECT,INSERT,UPDATE,REFERENCES')
    or has_table_privilege(r,t,'DELETE,TRUNCATE,TRIGGER')),
  'C14 no browser or service-role direct table or column privilege');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) r
  cross join unnest(array['account_public_sharing_allowed(uuid)',
    'require_account_public_sharing_write(uuid)','guard_account_outward_row()',
    'account_restriction_live_actor()','account_sharing_is_withdrawn(uuid)']) f
  where has_function_privilege(r,'kadmeion_private.'||f,'EXECUTE')),
  'C14 private lock, admission, trigger and session helpers are not direct API RPCs');
select ok(has_function_privilege('authenticated',
    'public.owner_read_account_sharing_restriction()','EXECUTE')
  and not has_function_privilege('anon',
    'public.owner_read_account_sharing_restriction()','EXECUTE')
  and not has_function_privilege('service_role',
    'public.owner_read_account_sharing_restriction()','EXECUTE'),
  'C14 authenticated-only owner restriction read');
select ok(has_function_privilege('authenticated',
    'public.operator_read_account_sharing_restriction(uuid)','EXECUTE')
  and not has_function_privilege('anon',
    'public.operator_read_account_sharing_restriction(uuid)','EXECUTE')
  and not has_function_privilege('service_role',
    'public.operator_read_account_sharing_restriction(uuid)','EXECUTE'),
  'C14 authenticated-only case-bound operator read');
select ok(has_function_privilege('authenticated',
    'public.operator_change_account_sharing_restriction(uuid,text,bigint,uuid,text,text)','EXECUTE')
  and not has_function_privilege('anon',
    'public.operator_change_account_sharing_restriction(uuid,text,bigint,uuid,text,text)','EXECUTE')
  and not has_function_privilege('service_role',
    'public.operator_change_account_sharing_restriction(uuid,text,bigint,uuid,text,text)','EXECUTE'),
  'C14 authenticated operator mutation RPC; SQL function enforces administrator role');
select is((select count(*)::integer from pg_trigger where not tgisinternal and tgname in
  ('kd_account_sharing_profile_pref','kd_account_sharing_project_exposure',
   'kd_account_sharing_reviewer','kd_account_sharing_route',
   'kd_account_sharing_intent','kd_account_sharing_pending',
   'kd_account_sharing_profile_projection','kd_account_sharing_case_projection')),
  8,'C14 all eight outward-write gates are physically installed');
select ok((select count(*)=8 from pg_trigger
  where not tgisinternal and tgenabled='O' and tgname in
  ('kd_account_sharing_profile_pref','kd_account_sharing_project_exposure',
   'kd_account_sharing_reviewer','kd_account_sharing_route',
   'kd_account_sharing_intent','kd_account_sharing_pending',
   'kd_account_sharing_profile_projection','kd_account_sharing_case_projection')),
  'C14 all eight outward guards are enabled, not disabled for a shortcut');
select ok((select count(*)=8 from pg_trigger t
  join pg_proc f on f.oid=t.tgfoid
  join pg_namespace n on n.oid=f.pronamespace
  where not t.tgisinternal and t.tgname in
  ('kd_account_sharing_profile_pref','kd_account_sharing_project_exposure',
   'kd_account_sharing_reviewer','kd_account_sharing_route',
   'kd_account_sharing_intent','kd_account_sharing_pending',
   'kd_account_sharing_profile_projection','kd_account_sharing_case_projection')
    and n.nspname='kadmeion_private' and f.proname='guard_account_outward_row'),
  'C14 all outward-write triggers call the private fail-closed guard');
select ok((select count(*)=2 from pg_class
  where oid in ('kadmeion_private.account_sharing_restrictions'::regclass,
                'kadmeion_private.account_sharing_restriction_events'::regclass)
    and relkind='r'),
  'C14 restriction and journal are ordinary physical tables, not shadow views');
select * from finish();
rollback;
