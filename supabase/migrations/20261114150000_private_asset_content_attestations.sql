-- B5: server-attested SHA-256 for private Storage bytes. This is not a
-- provider-signed digest, historical version retention, or account-erasure proof.
-- Only a trusted server worker holding service_role may pin an attestation.
create table kadmeion_private.private_asset_content_attestations (
  asset_id uuid primary key references public.project_assets(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id),
  storage_object_id uuid not null,
  storage_version text not null check (length(storage_version) between 1 and 128),
  expected_sha256 text not null check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  attested_at timestamptz not null default clock_timestamp()
);
create index private_asset_attestations_owner_idx
  on kadmeion_private.private_asset_content_attestations(owner_user_id);
alter table kadmeion_private.private_asset_content_attestations enable row level security;
revoke all on kadmeion_private.private_asset_content_attestations
  from public,anon,authenticated,service_role;
comment on table kadmeion_private.private_asset_content_attestations is
  'Write-once server-worker SHA-256 pin for owner private asset bytes. Never a provider-signed hash.';

create function kadmeion_private.reject_private_asset_attestation_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception using errcode='42501',message='PRIVATE_ASSET_ATTESTATION_IMMUTABLE';
end;
$$;
create trigger private_asset_attestation_write_once
  before update or delete on kadmeion_private.private_asset_content_attestations
  for each row execute function kadmeion_private.reject_private_asset_attestation_mutation();

-- The worker MUST calculate SHA-256 from downloaded bytes itself, check
-- Storage object info before and after download, and never accept an owner
-- supplied digest. This RPC is service_role-only and independently verifies
-- the currently registered owner/path/object/version/size/MIME.
create function public.record_private_asset_content_attestation(
  p_asset_id uuid,p_storage_object_id uuid,p_storage_version text,p_expected_sha256 text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_asset public.project_assets%rowtype;
  v_object storage.objects%rowtype;
  v_existing kadmeion_private.private_asset_content_attestations%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception using errcode='42501',message='TRUSTED_WORKER_REQUIRED';
  end if;
  if p_asset_id is null or p_storage_object_id is null or
     p_storage_version is null or length(p_storage_version) not between 1 and 128 or
     p_expected_sha256 is null or p_expected_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='INVALID_ASSET_ATTESTATION';
  end if;
  select * into v_asset from public.project_assets where id=p_asset_id for update;
  if not found then
    raise exception using errcode='22023',message='ASSET_NOT_REGISTERED';
  end if;
  select * into v_object from storage.objects
    where bucket_id='kadmeion-private-assets' and name=v_asset.object_path
    for share;
  if not found or v_object.id is distinct from p_storage_object_id or
     v_object.version::text is distinct from p_storage_version or
     v_object.owner_id is distinct from v_asset.owner_user_id::text or
     lower(coalesce(v_object.metadata->>'mimetype',''))<>v_asset.mime_type or
     coalesce(v_object.metadata->>'size','') !~ '^[0-9]{1,10}$' or
     (v_object.metadata->>'size')::bigint<>v_asset.byte_size then
    raise exception using errcode='22023',message='STORAGE_IDENTITY_CHANGED';
  end if;
  insert into kadmeion_private.private_asset_content_attestations(
    asset_id,owner_user_id,storage_object_id,storage_version,expected_sha256
  ) values (
    v_asset.id,v_asset.owner_user_id,p_storage_object_id,
    p_storage_version,p_expected_sha256
  ) on conflict(asset_id) do nothing;
  select * into v_existing from kadmeion_private.private_asset_content_attestations
    where asset_id=p_asset_id;
  if v_existing.owner_user_id is distinct from v_asset.owner_user_id or
     v_existing.storage_object_id is distinct from p_storage_object_id or
     v_existing.storage_version is distinct from p_storage_version or
     v_existing.expected_sha256 is distinct from p_expected_sha256 then
    raise exception using errcode='23505',message='ASSET_ATTESTATION_ALREADY_PINNED';
  end if;
  return jsonb_build_object('assetId',p_asset_id,'status','WRITE_ONCE_ATTESTED',
    'providerSigned',false,'deletionAllowed',false);
end;
$$;
revoke all on function public.record_private_asset_content_attestation(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.record_private_asset_content_attestation(uuid,uuid,text,text)
  to service_role;

-- Only the live owner can read the immutable digest. The snapshot binds the
-- request to the account-exit workflow; this is NOT an atomic export snapshot.
create function public.read_private_asset_content_attestations(p_snapshot_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid := (select auth.uid());
  v_registered integer;
  v_pinned integer;
  v_changed integer;
  v_rows jsonb;
begin
  perform kadmeion_private.require_live_exit_auth_session();
  if p_snapshot_id is null or not exists(
    select 1 from public.private_account_exit_inventory_snapshots
    where id=p_snapshot_id and owner_user_id=v_owner
  ) then
    raise exception using errcode='42501',message='PRIVATE_INVENTORY_NOT_FOUND';
  end if;
  with assets as materialized (
    select id,object_path,mime_type,byte_size from public.project_assets
    where owner_user_id=v_owner order by object_path limit 101
  ), pins as (
    select a.id,a.object_path,t.storage_object_id,t.storage_version,
      t.expected_sha256,
      (o.id is distinct from t.storage_object_id or
       o.version::text is distinct from t.storage_version or
       o.owner_id is distinct from v_owner::text or
       lower(coalesce(o.metadata->>'mimetype',''))<>a.mime_type or
       coalesce(o.metadata->>'size','') !~ '^[0-9]{1,10}$' or
       (o.metadata->>'size')::bigint<>a.byte_size) as changed
    from assets a
    left join kadmeion_private.private_asset_content_attestations t on t.asset_id=a.id
    left join storage.objects o on o.bucket_id='kadmeion-private-assets'
      and o.name=a.object_path
  )
  select count(*)::integer,
    count(expected_sha256)::integer,
    count(*) filter(where changed or expected_sha256 is null)::integer,
    coalesce(jsonb_agg(jsonb_build_object('assetId',id,'path',object_path,
      'objectId',storage_object_id,'version',storage_version,
      'expectedSha256',expected_sha256) order by object_path)
      filter(where expected_sha256 is not null),'[]'::jsonb)
  into v_registered,v_pinned,v_changed,v_rows from pins;
  return jsonb_build_object('snapshotId',p_snapshot_id,
    'status',case when v_registered<=100 and v_registered=v_pinned
      and v_changed=0 then 'SERVER_HASH_PINNED' else 'UNVERIFIED' end,
    'registeredAssets',least(v_registered,100),'attestedAssets',least(v_pinned,100),
    'attestations',v_rows,'providerSigned',false,'deletionAllowed',false);
end;
$$;
revoke all on function public.read_private_asset_content_attestations(uuid)
  from public,anon,authenticated;
grant execute on function public.read_private_asset_content_attestations(uuid)
  to authenticated;
comment on function public.read_private_asset_content_attestations(uuid) is
  'Owner-only read of server-worker byte digests, bound to a live session. Not provider-signed or an atomic export snapshot.';


-- B5 restricted OWNER-SCOPED audit export projection. This does not bypass
-- retention, third-party provider limitations or authorized deletion gates.
-- Never disclose reviewer token digests or GoTrue session identifiers.
create function public.read_private_account_audit_export(p_snapshot_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_owner uuid := (select auth.uid());
  v_live_session uuid;
  v_items jsonb;
  v_result jsonb;
  v_category record;
begin
  v_live_session:=kadmeion_private.require_live_exit_auth_session();
  if p_snapshot_id is null or not exists(
    select 1 from public.private_account_exit_inventory_snapshots
    where id=p_snapshot_id and owner_user_id=v_owner
  ) then
    raise exception using errcode='42501',message='PRIVATE_INVENTORY_NOT_FOUND';
  end if;
  select jsonb_build_object(
    'reviewerGrants',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id,request_id,portfolio_id,expires_at,revoked_at,created_at
        from public.private_reviewer_grants
        where owner_user_id=v_owner order by created_at,id limit 101
      ) t),'[]'::jsonb),
    'moderationCases',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id,reason_code,summary,status,created_at,updated_at
        from public.private_moderation_cases
        where owner_user_id=v_owner order by created_at,id limit 101
      ) t),'[]'::jsonb),
    'moderationEvents',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select e.id,e.case_id,e.actor_user_id,e.event_type,e.detail,e.created_at
        from public.private_moderation_events e
        where e.owner_user_id=v_owner order by e.created_at,e.id limit 101
      ) t),'[]'::jsonb),
    'accountExitRequests',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id,status,created_at,withdrawn_at,
          public_revocation_verified,reauth_verified,access_terminated,
          erasure_executed,retention_verified
        from public.private_account_erasure_requests
        where owner_user_id=v_owner order by created_at,id limit 101
      ) t),'[]'::jsonb),
    'reauthChallenges',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id,created_at,expires_at,verified_at
        from public.private_account_exit_reauth_challenges
        where owner_user_id=v_owner order by created_at,id limit 101
      ) t),'[]'::jsonb),
    'inventorySnapshots',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id,schema_version,captured_at,inventory
        from public.private_account_exit_inventory_snapshots
        where owner_user_id=v_owner order by captured_at,id limit 101
      ) t),'[]'::jsonb),
    'releasePointers',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select portfolio_id,status,generation,revocation_generation,
          candidate_request_id,candidate_manifest_sha256,updated_at
        from public.private_release_visibility_pointers
        where owner_user_id=v_owner order by updated_at,portfolio_id limit 101
      ) t),'[]'::jsonb),
    'releaseEvents',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id,portfolio_id,event_type,expected_generation,
          resulting_generation,created_at
        from public.private_release_visibility_events
        where owner_user_id=v_owner order by created_at,id limit 101
      ) t),'[]'::jsonb)
  ) into v_items;
  for v_category in select key,value from jsonb_each(v_items) loop
    if jsonb_array_length(v_category.value)>100 then
      raise exception using errcode='54000',message='ACCOUNT_AUDIT_EXPORT_LIMIT_EXCEEDED';
    end if;
  end loop;
  if octet_length(v_items::text)>1048576 then
    raise exception using errcode='54000',message='ACCOUNT_AUDIT_EXPORT_LIMIT_EXCEEDED';
  end if;
  v_result:=jsonb_build_object(
    'snapshotId',p_snapshot_id,'ownerUserId',v_owner,
    'status','BOUNDED_OWNER_AUDIT','maxRowsPerCategory',100,
    'categories',v_items,'tokenDigestsIncluded',false,
    'sessionsIncluded',false,'completeAccountExport',false,
    'deletionAllowed',false);
  return v_result;
end;
$function$;
revoke all on function public.read_private_account_audit_export(uuid)
  from public,anon;
grant execute on function public.read_private_account_audit_export(uuid)
  to authenticated;
comment on function public.read_private_account_audit_export(uuid) is
  'Owner-live-session restricted audit export; bounded to 100 per category, omits reviewer secret digests/session IDs, never a full export or deletion authorization.';
