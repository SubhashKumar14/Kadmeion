-- B08 / WF-025: private versioned My Components. Never executable or public.
-- Owner-supplied code is DATA; publication preflight must continue to reject
-- untrusted S2 source even after an owner saves/reuses a library version.
create table public.private_my_component_versions (
  id uuid primary key,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  component_key text not null check (component_key ~ '^[a-z][a-z0-9-]{2,63}$'),
  version integer not null check (version between 1 and 40),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  base_component_pin text not null
    check (base_component_pin ~ '^[a-z][a-z0-9-]*@[0-9]+(\.[0-9]+){0,2}$'),
  pristine_source text not null
    check (octet_length(pristine_source) between 1 and 32768),
  source_code text not null check (octet_length(source_code) between 1 and 32768),
  compatible_slot_kinds text[] not null
    check (coalesce(array_ndims(compatible_slot_kinds),0)=1
      and cardinality(compatible_slot_kinds) between 1 and 20),
  source_sha256 text generated always as
    (encode(extensions.digest(source_code,'sha256'),'hex')) stored,
  created_at timestamptz not null default now(),
  unique (owner_user_id,component_key,version)
);
create index private_my_components_owner_lookup
  on public.private_my_component_versions (owner_user_id,component_key,version desc);
alter table public.private_my_component_versions enable row level security;
revoke all on table public.private_my_component_versions
  from public,anon,authenticated,service_role;
-- No table policies or direct authenticated grants: only RPCs with live
-- auth.sessions proof can read/save source. No client UPDATE/DELETE.
comment on table public.private_my_component_versions is
 'Append-only owner-private component source versions. No public trust flag, public bucket, or direct client table grant. Deletion cascades when Auth user is erased; exported by owner metadata snapshot.';

create function public.owner_save_my_component(
  p_operation_id uuid,p_component_key text,p_display_name text,
  p_base_component_pin text,p_pristine_source text,p_source_code text,
  p_slot_kinds text[]
) returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare
  v_owner uuid := (select auth.uid());
  v_existing public.private_my_component_versions%rowtype;
  v_version int;
  v_kinds text[];
  v_allowed constant text[] := array[
    'title','text','cta1','cta2','note','avatar','btn1','btn2',
    'imagea','imageb','project','thumbs','media','image','badge',
    'meta','cta','text1','card','text2','items','entries'
  ];
begin
  perform kadmeion_private.require_live_exit_auth_session();
  if p_operation_id is null or p_component_key is null or
     p_component_key !~ '^[a-z][a-z0-9-]{2,63}$' or
     p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 80 or
     p_base_component_pin is null or
     p_base_component_pin !~ '^[a-z][a-z0-9-]*@[0-9]+(\.[0-9]+){0,2}$' or
     p_pristine_source is null or octet_length(p_pristine_source) not between 1 and 32768 or
     p_source_code is null or octet_length(p_source_code) not between 1 and 32768 or
     p_slot_kinds is null or coalesce(array_ndims(p_slot_kinds),0)<>1 or
     cardinality(p_slot_kinds) not between 1 and 20 or
     exists(select 1 from unnest(p_slot_kinds) k
       where k is null or not (k=any(v_allowed))) or
     (select count(distinct k) from unnest(p_slot_kinds) k)<>cardinality(p_slot_kinds)
  then
    raise exception using errcode='22023',message='PRIVATE_COMPONENT_INVALID';
  end if;
  -- Same owner serializes concurrent version allocation, cap checks and
  -- operation-id retries. No last-write-wins or unsafe upsert.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_owner::text,5150));
  select * into v_existing from public.private_my_component_versions
    where id=p_operation_id;
  select array_agg(kind order by kind) into v_kinds
    from unnest(p_slot_kinds) kind;
  if found and v_kinds is null then
    raise exception using errcode='22023',message='PRIVATE_COMPONENT_INVALID';
  end if;
  if v_existing.id is not null then
    if v_existing.owner_user_id<>v_owner or
       v_existing.component_key<>p_component_key or
       v_existing.display_name<>p_display_name or
       v_existing.base_component_pin<>p_base_component_pin or
       v_existing.pristine_source<>p_pristine_source or
       v_existing.source_code<>p_source_code or
       v_existing.compatible_slot_kinds<>v_kinds then
      raise exception using errcode='23505',message='PRIVATE_COMPONENT_OPERATION_CONFLICT';
    end if;
    return to_jsonb(v_existing);
  end if;
  if (select count(*) from public.private_my_component_versions
      where owner_user_id=v_owner)>=40 then
    raise exception using errcode='54000',message='PRIVATE_COMPONENT_QUOTA';
  end if;
  select coalesce(max(version),0)+1 into v_version
    from public.private_my_component_versions
    where owner_user_id=v_owner and component_key=p_component_key;
  insert into public.private_my_component_versions
    (id,owner_user_id,component_key,version,display_name,base_component_pin,
      pristine_source,source_code,compatible_slot_kinds)
    values(p_operation_id,v_owner,p_component_key,v_version,p_display_name,
      p_base_component_pin,p_pristine_source,p_source_code,v_kinds)
    returning * into v_existing;
  return to_jsonb(v_existing);
end;
$function$;

create function public.owner_list_my_component_versions()
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare v_owner uuid := (select auth.uid()); v_items jsonb;
begin
  perform kadmeion_private.require_live_exit_auth_session();
  select coalesce(jsonb_agg(to_jsonb(c) order by c.component_key,c.version desc),
    '[]'::jsonb) into v_items from (
      select * from public.private_my_component_versions
       where owner_user_id=v_owner order by component_key,version desc limit 41
  ) c;
  if jsonb_array_length(v_items)>40 then
    raise exception using errcode='54000',message='PRIVATE_COMPONENT_QUOTA';
  end if;
  return jsonb_build_object('status','OWNER_PRIVATE_COMPONENTS',
    'ownerUserId',v_owner,'items',v_items,'publicExecutionTrusted',false);
end;
$function$;

create function public.owner_get_my_component_version(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare v_owner uuid := (select auth.uid()); v_record jsonb;
begin
  perform kadmeion_private.require_live_exit_auth_session();
  if p_id is null then
    raise exception using errcode='22023',message='PRIVATE_COMPONENT_INVALID';
  end if;
  select to_jsonb(c) into v_record
    from public.private_my_component_versions c
    where id=p_id and owner_user_id=v_owner;
  return v_record;
end;
$function$;

revoke all on function public.owner_save_my_component(
 uuid,text,text,text,text,text,text[]) from public,anon,service_role;
revoke all on function public.owner_list_my_component_versions()
 from public,anon,service_role;
revoke all on function public.owner_get_my_component_version(uuid)
 from public,anon,service_role;
grant execute on function public.owner_save_my_component(
 uuid,text,text,text,text,text,text[]) to authenticated;
grant execute on function public.owner_list_my_component_versions()
 to authenticated;
grant execute on function public.owner_get_my_component_version(uuid)
 to authenticated;

-- B09: component source versions are account-owned data, not provider data.
create or replace function public.owner_export_account_metadata(p_snapshot_id uuid)
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
    ('private_notification_preferences','owner_user_id'),
    ('private_my_component_versions','owner_user_id')
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
