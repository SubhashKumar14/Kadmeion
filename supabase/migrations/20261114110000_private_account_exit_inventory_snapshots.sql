-- B5: non-destructive, versioned account-exit inventory snapshot (not a data export).
-- This migration is for the ephemeral/local backend branch; no production rollout.
-- One SQL statement captures owner-scoped bounded counts under one MVCC statement
-- snapshot. External provider assets, caches, backups and actual export remain UNVERIFIED.
create table public.private_account_exit_inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  request_id uuid references public.private_account_erasure_requests(id),
  schema_version integer not null default 1 check (schema_version=1),
  captured_at timestamptz not null default transaction_timestamp(),
  inventory jsonb not null,
  unique(owner_user_id,operation_id),
  check (jsonb_typeof(inventory)='object')
);
create index kd_exit_inventory_owner_created on
  public.private_account_exit_inventory_snapshots(owner_user_id,captured_at desc);
alter table public.private_account_exit_inventory_snapshots enable row level security;
revoke all on public.private_account_exit_inventory_snapshots
  from public,anon,authenticated;
comment on table public.private_account_exit_inventory_snapshots is
  'Owner-private, immutable metadata-only inventory snapshots. Not a purge manifest, full export, revocation proof or deletion authorization.';

create function public.create_private_account_exit_inventory(
  p_operation_id uuid,p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_session uuid;
  v_existing public.private_account_exit_inventory_snapshots%rowtype;
  v_counts jsonb;
  v_capped boolean;
  v_inventory jsonb;
  v_id uuid;
  v_captured timestamptz;
begin
  v_session:=kadmeion_private.require_live_exit_auth_session();
  if p_operation_id is null then
    raise exception using errcode='22023',message='INVALID_INVENTORY_OPERATION';
  end if;
  -- Serialize owner idempotency/quota against concurrent calls.
  perform 1 from public.profiles where user_id=v_owner for update;
  if not found then
    raise exception using errcode='42501',message='OWNER_PROFILE_NOT_FOUND';
  end if;
  select * into v_existing from public.private_account_exit_inventory_snapshots
    where owner_user_id=v_owner and operation_id=p_operation_id for update;
  if found then
    if v_existing.request_id is distinct from p_request_id then
      raise exception using errcode='23505',message='INVENTORY_OPERATION_REUSED';
    end if;
    return jsonb_build_object('snapshotId',v_existing.id,'schemaVersion',1,
      'capturedAt',v_existing.captured_at,'alreadyCaptured',true,
      'inventory',v_existing.inventory,'deletionAllowed',false);
  end if;
  if p_request_id is not null and not exists(
    select 1 from public.private_account_erasure_requests
    where id=p_request_id and owner_user_id=v_owner and status='REQUESTED_BLOCKED'
  ) then
    raise exception using errcode='42501',message='ACTIVE_OWNER_REQUEST_REQUIRED';
  end if;
  if (select count(*) from public.private_account_exit_inventory_snapshots
      where owner_user_id=v_owner)>=10 then
    raise exception using errcode='54000',message='INVENTORY_SNAPSHOT_QUOTA_REACHED';
  end if;

  -- All nine bounded counts are evaluated in ONE statement, not nine
  -- separate READ COMMITTED statements that could observe different commits.
  select jsonb_build_object(
    'projects', (select count(*) from (select 1 from public.projects
      where owner_user_id=v_owner limit 1001) as bounded_projects),
    'portfolios', (select count(*) from (select 1 from public.portfolios
      where owner_user_id=v_owner limit 1001) as bounded_portfolios),
    'portfolioRevisions', (select count(*) from (select 1 from public.portfolio_revisions
      where owner_user_id=v_owner limit 1001) as bounded_portfolio_revisions),
    'projectExposureIntents', (select count(*) from (select 1 from public.project_exposure_intents
      where owner_user_id=v_owner limit 1001) as bounded_project_exposure_intents),
    'projectAssetMetadata', (select count(*) from (select 1 from public.project_assets
      where owner_user_id=v_owner limit 1001) as bounded_project_assets),
    'frozenReleaseRequests', (select count(*) from (select 1 from public.private_release_requests
      where owner_user_id=v_owner limit 1001) as bounded_private_release_requests),
    'reviewerGrants', (select count(*) from (select 1 from public.private_reviewer_grants
      where owner_user_id=v_owner limit 1001) as bounded_private_reviewer_grants),
    'trashRecords', (select count(*) from (select 1 from public.private_trash_items
      where owner_user_id=v_owner limit 1001) as bounded_private_trash_items),
    'accountExitRequests', (select count(*) from (select 1 from public.private_account_erasure_requests
      where owner_user_id=v_owner limit 1001) as bounded_private_account_erasure_requests)
  ) into v_counts;
  select exists(
    select 1 from jsonb_each_text(v_counts) as entry(k,v)
    where entry.v::integer>1000
  ) into v_capped;
  select jsonb_object_agg(k,least(v::integer,1000))
    into v_counts from jsonb_each_text(v_counts) as entry(k,v);

  v_inventory:=jsonb_build_object(
    'status','METADATA_SNAPSHOT_ONLY','maxCountPerCategory',1000,
    'countsCapped',v_capped,'counts',v_counts,
    'consistency','SINGLE_STATEMENT_MVCC',
    'publicRoutes','UNVERIFIED','objectStorage','METADATA_ONLY',
    'exports','NOT_READY','integrations','NOT_TRACKED',
    'backupRetention','UNVERIFIED','recentReauthVerified',false,
    'publicRevocationVerified',false,'deletionAllowed',false
  );
  insert into public.private_account_exit_inventory_snapshots(
    owner_user_id,operation_id,request_id,inventory
  ) values(v_owner,p_operation_id,p_request_id,v_inventory)
    returning id,captured_at into v_id,v_captured;
  return jsonb_build_object('snapshotId',v_id,'schemaVersion',1,
    'capturedAt',v_captured,'alreadyCaptured',false,
    'inventory',v_inventory,'deletionAllowed',false);
end;
$$;
revoke all on function public.create_private_account_exit_inventory(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.create_private_account_exit_inventory(uuid,uuid)
  to authenticated;
comment on function public.create_private_account_exit_inventory(uuid,uuid) is
  'Creates bounded metadata-only owner snapshot with live GoTrue session. Never exports bytes, authorizes erasure or verifies external storage/host/cache retention.';

create function public.get_private_account_exit_inventory(p_snapshot_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_session uuid;
  v_record public.private_account_exit_inventory_snapshots%rowtype;
begin
  v_session:=kadmeion_private.require_live_exit_auth_session();
  if p_snapshot_id is null then
    raise exception using errcode='22023',message='INVALID_INVENTORY_SNAPSHOT';
  end if;
  select * into v_record from public.private_account_exit_inventory_snapshots
    where id=p_snapshot_id and owner_user_id=v_owner;
  if not found then
    raise exception using errcode='42501',message='PRIVATE_INVENTORY_NOT_FOUND';
  end if;
  return jsonb_build_object('snapshotId',v_record.id,'schemaVersion',1,
    'capturedAt',v_record.captured_at,'alreadyCaptured',true,
    'inventory',v_record.inventory,'deletionAllowed',false);
end;
$$;
revoke all on function public.get_private_account_exit_inventory(uuid)
  from public,anon,authenticated;
grant execute on function public.get_private_account_exit_inventory(uuid)
  to authenticated;
comment on function public.get_private_account_exit_inventory(uuid) is
  'Read immutable owner-only metadata snapshot; never a complete export or deletion authorization.';
