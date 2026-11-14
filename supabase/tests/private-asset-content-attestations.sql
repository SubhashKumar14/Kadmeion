-- B5 server-attested hashes must not be writable/readable by browser JWTs.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select plan(9);
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
reset role;
select * from finish();
rollback;
