-- B5 server-attested hashes must not be writable/readable by browser JWTs.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select plan(31);
select has_table('kadmeion_private','private_asset_content_attestations',
  'write-once server attestation table exists');
select ok((select relrowsecurity from pg_class where
  oid='kadmeion_private.private_asset_content_attestations'::regclass),
  'attestation table has RLS enabled');
select ok(not has_table_privilege('authenticated',
  'kadmeion_private.private_asset_content_attestations','SELECT'),
  'owner JWT cannot list trusted hashes directly');
select ok(not has_table_privilege('authenticated',
  'kadmeion_private.private_asset_content_attestations','INSERT'),
  'owner JWT cannot forge a digest');
select ok(not has_function_privilege('authenticated',
  'public.record_private_asset_content_attestation(uuid,uuid,text,text)','EXECUTE'),
  'owner cannot invoke the trusted worker writer');
select ok(has_function_privilege('service_role',
  'public.record_private_asset_content_attestation(uuid,uuid,text,text)','EXECUTE'),
  'trusted service role can invoke writer');
select ok(has_function_privilege('authenticated',
  'public.read_private_asset_content_attestations(uuid)','EXECUTE'),
  'owner can request a live-session-bound digest read');
select ok(not has_function_privilege('anon',
  'public.read_private_asset_content_attestations(uuid)','EXECUTE'),
  'anonymous digest reads are forbidden');
select ok(has_function_privilege('authenticated','public.read_owner_private_asset_pin(text,uuid,uuid)','EXECUTE'),'C04 authenticated pin RPC');
select ok(not has_function_privilege('anon','public.read_owner_private_asset_pin(text,uuid,uuid)','EXECUTE'),'C04 anonymous pin RPC denied');
select ok(not has_function_privilege('service_role','public.read_owner_private_asset_pin(text,uuid,uuid)','EXECUTE'),'C04 service role owner pin RPC denied');
select ok(not has_table_privilege('authenticated','kadmeion_private.private_asset_content_attestations','UPDATE'),'C04 direct digest update denied');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000e1',true);
do $$
declare refused boolean:=false;
begin
  begin
    perform public.read_private_asset_content_attestations(
      '10000000-0000-4000-8000-000000000001'::uuid);
  exception when insufficient_privilege then refused:=true; end;
  if not refused then raise exception 'Forged session read server digests'; end if;
end $$;
select pass('synthetic owner JWT cannot bypass live-session digest read');
select throws_ok($q$select public.read_owner_private_asset_pin('PROJECT','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002')$q$,'42501','PRIVATE_ASSET_NOT_FOUND','C04 forged JWT denied before reading private pin');
reset role;
-- C05 physical ACL: do not infer column-level denial from table RLS.
select has_table('public','profile_assets','C05 owner profile registry exists independently of projects');
select has_table('kadmeion_private','private_profile_asset_content_attestations','C05 profile hash pins live in private schema');
select ok((select relrowsecurity from pg_class where oid='public.profile_assets'::regclass),'C05 registry has RLS');
select ok((select relrowsecurity from pg_class where oid='kadmeion_private.private_profile_asset_content_attestations'::regclass),'C05 trusted pins have RLS');
select ok(has_table_privilege('authenticated','public.profile_assets','SELECT') and not has_table_privilege('anon','public.profile_assets','SELECT'),'C05 only authenticated owner registry read');
select ok(not has_any_column_privilege('authenticated','public.profile_assets','INSERT,UPDATE,REFERENCES') and not has_table_privilege('authenticated','public.profile_assets','DELETE,TRUNCATE,TRIGGER'),'C05 browser cannot mutate registry directly');
select ok(not has_any_column_privilege('authenticated','kadmeion_private.private_profile_asset_content_attestations','SELECT,INSERT,UPDATE,REFERENCES') and not has_table_privilege('authenticated','kadmeion_private.private_profile_asset_content_attestations','DELETE,TRUNCATE,TRIGGER'),'C05 browser cannot inspect or mutate trusted private pins');
select ok(not exists(select 1 from unnest(array['avatar_asset_id','avatar_revision','avatar_last_operation_id','avatar_last_base_revision']) c
 where has_column_privilege('authenticated','public.profiles',c,'INSERT,UPDATE')),'C05 owner INSERT/UPDATE cannot forge avatar pointer, revision or replay binding');
select ok(has_column_privilege('authenticated','public.profiles','user_id','INSERT') and has_column_privilege('authenticated','public.profiles','display_name','INSERT'),'C05 ordinary owner bootstrap remains possible');
select ok(has_function_privilege('authenticated','public.set_private_profile_avatar(bigint,uuid,uuid)','EXECUTE') and not has_function_privilege('anon','public.set_private_profile_avatar(bigint,uuid,uuid)','EXECUTE') and not has_function_privilege('service_role','public.set_private_profile_avatar(bigint,uuid,uuid)','EXECUTE'),'C05 avatar CAS owner only');
select ok(has_function_privilege('service_role','public.record_private_profile_asset_content_attestation(uuid,uuid,uuid,text,text)','EXECUTE') and not has_function_privilege('authenticated','public.record_private_profile_asset_content_attestation(uuid,uuid,uuid,text,text)','EXECUTE') and not has_function_privilege('anon','public.record_private_profile_asset_content_attestation(uuid,uuid,uuid,text,text)','EXECUTE'),'C05 only trusted worker may write profile digest');
select ok(not exists(select 1 from unnest(array['get_private_account_exit_inventory_v2(uuid,uuid)','reconcile_private_account_exit_storage_v2(uuid,uuid)','read_private_asset_content_attestations_v2(uuid,uuid)','owner_export_account_metadata_v2(uuid,uuid)']) p
 where not has_function_privilege('authenticated','public.'||p,'EXECUTE') or has_function_privilege('anon','public.'||p,'EXECUTE') or has_function_privilege('service_role','public.'||p,'EXECUTE')),'C05 exact v2 read endpoints owner-only and request bound');
-- C05: verify the complete public mutation/read surface and internal helper boundary.
select ok(not exists(select 1 from unnest(array['reserve_private_profile_asset(uuid,text,bigint,text)',
  'register_private_profile_asset(uuid)','read_private_profile_avatar()',
  'create_private_account_exit_inventory_v2(uuid,uuid)']) p
  where not has_function_privilege('authenticated','public.'||p,'EXECUTE')
     or has_function_privilege('anon','public.'||p,'EXECUTE')
     or has_function_privilege('service_role','public.'||p,'EXECUTE')),
  'C05 reserve/register/avatar/inventory endpoints require authenticated owner role');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) r
  cross join unnest(array['lock_profile_asset_owner()','require_live_asset_export_owner()',
    'require_v1_asset_scope(uuid)','require_inventory_v2(uuid,uuid)',
    'read_profile_avatar_receipt(uuid)','read_private_account_audit_export_v2(uuid,uuid)']) p
  where has_function_privilege(r,'kadmeion_private.'||p,'EXECUTE')),
  'C05 internal owner/session/export helpers cannot be invoked by any API role');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) r
  where has_any_column_privilege(r,'public.profile_assets','INSERT,UPDATE,REFERENCES')
     or has_table_privilege(r,'public.profile_assets','DELETE,TRUNCATE,TRIGGER')),
  'C05 registry mutations cannot escape the RPC by direct table or column grants');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) r
  where has_any_column_privilege(r,'kadmeion_private.private_profile_asset_content_attestations','SELECT,INSERT,UPDATE,REFERENCES')
     or has_table_privilege(r,'kadmeion_private.private_profile_asset_content_attestations','DELETE,TRUNCATE,TRIGGER')),
  'C05 trusted-worker EXECUTE is not a direct pin-table privilege');
select ok((select count(*)=1 and bool_and(cmd='SELECT' and roles=array['authenticated']::name[])
  from pg_policies where schemaname='public' and tablename='profile_assets'),
  'C05 registry has exactly the authenticated SELECT policy, not permissive writes');
select * from finish();
rollback;
