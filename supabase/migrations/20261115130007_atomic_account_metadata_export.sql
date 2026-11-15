-- A single statement's snapshot for application-owned data and release history.
-- Provider messages, backups, session material, and Storage bytes remain separate.
create function public.owner_export_account_metadata(p_snapshot_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_table text;
  v_key text;
  v_rows jsonb;
  v_records jsonb := '{}'::jsonb;
  v_releases jsonb;
  v_audit jsonb;
  v_result jsonb;
begin
  perform kadmeion_private.require_live_exit_auth_session();
  if p_snapshot_id is null or not exists(select 1 from public.private_account_exit_inventory_snapshots
      where id=p_snapshot_id and owner_user_id=v_owner) then
    raise exception using errcode='42501',message='PRIVATE_INVENTORY_NOT_FOUND';
  end if;
  for v_table,v_key in select * from (values
    ('profiles','user_id'),('profile_sharing_preferences','user_id'),
    ('private_onboarding_steps','user_id'),('projects','owner_user_id'),
    ('project_exposure_intents','owner_user_id'),('portfolios','owner_user_id'),
    ('portfolio_revisions','owner_user_id'),('project_assets','owner_user_id'),
    ('private_release_requests','owner_user_id'),('private_trash_items','owner_user_id'),
    ('private_platform_links','owner_user_id'),('private_goals','owner_user_id'),
    ('private_goal_progress_events','owner_user_id'),('private_goal_milestones','owner_user_id'),
    ('private_notification_preferences','owner_user_id')
  ) as allowed(table_name,owner_column)
  loop
    -- Neither the table nor identifiers come from request parameters.
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(item)), ''[]''::jsonb) from
         (select * from public.%I where %I=$1 limit 101) item',v_table,v_key)
      into v_rows using v_owner;
    if jsonb_array_length(v_rows)>100 or octet_length(v_rows::text)>8388608 then
      raise exception using errcode='54000',message='ACCOUNT_METADATA_EXPORT_LIMIT_EXCEEDED';
    end if;
    v_records:=v_records||jsonb_build_object(v_table,v_rows);
    if octet_length(v_records::text)>10485760 then
      raise exception using errcode='54000',message='ACCOUNT_METADATA_EXPORT_LIMIT_EXCEEDED';
    end if;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb) into v_rows from (
    select id,owner_user_id,event_type,category,priority,target_id,created_at,read_at,dismissed_at
    from public.private_notifications where owner_user_id=v_owner limit 101
  ) n;
  if jsonb_array_length(v_rows)>100 then
    raise exception using errcode='54000',message='ACCOUNT_METADATA_EXPORT_LIMIT_EXCEEDED';
  end if;
  v_records:=v_records||jsonb_build_object('private_notifications',v_rows);
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_releases from (
    select verified.intent_id,verified.portfolio_id,verified.request_id,verified.stage_generation,
      verified.html_sha256,verified.verified_at,consent.public_handle,consent.public_slug,
      consent.rollback_target_id
    from public.verified_unlisted_releases verified
    join public.private_unlisted_publication_intents consent on consent.id=verified.intent_id
      and consent.owner_user_id=verified.owner_user_id
    where verified.owner_user_id=v_owner order by verified.verified_at,verified.intent_id limit 101
  ) r;
  if jsonb_array_length(v_releases)>100 then
    raise exception using errcode='54000',message='ACCOUNT_METADATA_EXPORT_LIMIT_EXCEEDED';
  end if;
  v_audit:=public.read_private_account_audit_export(p_snapshot_id);
  v_result:=jsonb_build_object('status','APPLICATION_METADATA_SNAPSHOT','schemaVersion',1,
    'snapshotId',p_snapshot_id,'ownerUserId',v_owner,'capturedAt',statement_timestamp(),
    'records',v_records,'restrictedAudit',v_audit->'categories','verifiedReleaseHistory',v_releases,
    'storageBytesIncluded',false,'providerDataIncluded',false,'deletionAllowed',false);
  if octet_length(v_result::text)>12582912 then
    raise exception using errcode='54000',message='ACCOUNT_METADATA_EXPORT_LIMIT_EXCEEDED';
  end if;
  return v_result;
end;
$$;
-- The existing audit RPC is read-only, so pin its reads to the same statement
-- when it is called by the metadata snapshot.
alter function public.read_private_account_audit_export(uuid) stable;
revoke all on function public.owner_export_account_metadata(uuid) from public,anon,service_role;
grant execute on function public.owner_export_account_metadata(uuid) to authenticated;
