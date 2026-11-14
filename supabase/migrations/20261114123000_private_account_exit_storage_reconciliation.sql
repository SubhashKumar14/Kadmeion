-- B5: read-only, bounded Storage metadata reconciliation for an existing owner
-- account-exit inventory. NOT a byte export, deletion manifest or revocation proof.
-- Evaluated against current database metadata; may differ from prior inventory time.
create function public.reconcile_private_account_exit_storage(p_snapshot_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_session uuid;
  v_inventory jsonb;
  v_captured timestamptz;
  v_registered bigint;
  v_objects bigint;
  v_missing bigint;
  v_orphans bigint;
  v_mismatch bigint;
  v_limited boolean;
  v_drift boolean;
  v_state text;
begin
  v_session:=kadmeion_private.require_live_exit_auth_session();
  if p_snapshot_id is null then
    raise exception using errcode='22023',message='INVALID_INVENTORY_SNAPSHOT';
  end if;
  select inventory,captured_at into v_inventory,v_captured
  from public.private_account_exit_inventory_snapshots
  where id=p_snapshot_id and owner_user_id=v_owner;
  if not found then
    raise exception using errcode='42501',message='PRIVATE_INVENTORY_NOT_FOUND';
  end if;

  -- The prefix and bucket constrain Storage reads to the caller's namespace.
  -- Compare both sides, including unregistered/orphan Storage objects. Return
  -- counts only: no foreign paths, provider credentials or object bytes.
  -- 101 entries per side allow safe detection of a 100-item result cap.
  with registered as materialized (
    select id,object_path,mime_type,byte_size
    from public.project_assets
    where owner_user_id=v_owner
    order by object_path limit 101
  ), objects as materialized (
    select name,owner_id,metadata
    from storage.objects
    where bucket_id='kadmeion-private-assets'
      and name like (v_owner::text || '/%')
    order by name limit 101
  ), paired as (
    select a.id as asset_id,o.name as object_name,
      case when a.id is not null and o.name is not null then
        o.owner_id is distinct from v_owner::text or
        lower(coalesce(o.metadata->>'mimetype',''))<>a.mime_type or
        (case when coalesce(o.metadata->>'size','') ~ '^[0-9]{1,10}$'
          then (o.metadata->>'size')::bigint else -1 end)<>a.byte_size
      else false end as metadata_mismatch
    from registered a full outer join objects o on a.object_path=o.name
  )
  select
    (select count(*) from registered),
    (select count(*) from objects),
    (select count(*) from paired where asset_id is not null and object_name is null),
    (select count(*) from paired where asset_id is null and object_name is not null),
    (select count(*) from paired where metadata_mismatch)
  into v_registered,v_objects,v_missing,v_orphans,v_mismatch;

  v_limited:=v_registered>100 or v_objects>100;
  v_drift:=v_limited or
    coalesce((v_inventory->'counts'->>'projectAssetMetadata')::integer,-1)
      <>v_registered;
  v_state:=case
    when v_limited then 'LIMIT_EXCEEDED'
    when v_missing>0 or v_orphans>0 or v_mismatch>0 then 'DISCREPANCY'
    else 'METADATA_MATCH_ONLY' end;

  return jsonb_build_object(
    'snapshotId',p_snapshot_id,'inventoryCapturedAt',v_captured,
    'status',v_state,'maxObjectsPerSide',100,'limitExceeded',v_limited,
    'registeredAssets',least(v_registered,100),
    'storageObjects',least(v_objects,100),
    'missingObjects',least(v_missing,100),
    'orphanObjects',least(v_orphans,100),
    'metadataMismatches',least(v_mismatch,100),
    'inventoryDrift',v_drift,
    'consistency','LIVE_METADATA_NOT_ATOMIC_WITH_INVENTORY',
    'storageBytesVerified',false,'downloadableExportReady',false,
    'externalProviders','UNVERIFIED','backupRetention','UNVERIFIED',
    'publicRevocationVerified',false,'deletionAllowed',false
  );
end;
$$;
revoke all on function public.reconcile_private_account_exit_storage(uuid)
  from public,anon,authenticated;
grant execute on function public.reconcile_private_account_exit_storage(uuid)
  to authenticated;
comment on function public.reconcile_private_account_exit_storage(uuid) is
  'Live bounded owner-only Storage metadata comparison. Matching rows do not verify bytes, backup retention, complete export, public route revocation or erasure.';
