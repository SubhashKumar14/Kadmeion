-- WF-013 / WORK-04, WORK-06: owner-private manual thumbnail selection only.
-- Forward source migration; no remote capture, public URL, or provider change.
-- Existing owner-private immutable project_assets are the only attachable source.
alter table public.project_assets add constraint project_assets_thumbnail_owner_key
  unique (id,project_id,owner_user_id);
alter table public.projects
  add column thumbnail_asset_id uuid,
  add column thumbnail_operation_id uuid,
  add column thumbnail_operation_base_revision bigint,
  add constraint projects_thumbnail_owner_fk
    foreign key (thumbnail_asset_id,id,owner_user_id)
    references public.project_assets(id,project_id,owner_user_id)
    on delete set null (thumbnail_asset_id),
  add constraint projects_thumbnail_operation_check check (
    (thumbnail_operation_id is null and thumbnail_operation_base_revision is null)
    or (thumbnail_operation_id is not null and thumbnail_operation_base_revision is not null
      and thumbnail_operation_base_revision >= 0)
  );
-- The earlier column-specific INSERT grant deliberately does not include
-- these columns. Explicit revoke keeps the attachment CAS RPC the only writer.
revoke insert (thumbnail_asset_id,thumbnail_operation_id,thumbnail_operation_base_revision),
  update (thumbnail_asset_id,thumbnail_operation_id,thumbnail_operation_base_revision)
  on public.projects from authenticated,anon,public;

create function public.read_private_project_thumbnail(p_project_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_owner uuid := (select auth.uid());
  v_project public.projects%rowtype;
  v_asset public.project_assets%rowtype;
  v_object storage.objects%rowtype;
  v_asset_json jsonb := 'null'::jsonb;
begin
  if v_owner is null or p_project_id is null then
    raise exception using errcode='42501',message='PRIVATE_PROJECT_NOT_FOUND';
  end if;
  select * into v_project from public.projects
    where id=p_project_id and owner_user_id=v_owner and trashed_at is null;
  if not found then raise exception using errcode='42501',message='PRIVATE_PROJECT_NOT_FOUND';end if;
  if v_project.thumbnail_asset_id is not null then
    select * into v_asset from public.project_assets
      where id=v_project.thumbnail_asset_id and project_id=p_project_id and owner_user_id=v_owner;
    if not found or v_asset.mime_type not in ('image/png','image/jpeg','image/webp')
       or v_asset.byte_size not between 12 and 5242880
       or char_length(btrim(v_asset.alt_text)) not between 1 and 500
       or v_asset.object_path !~ ('^'||v_owner::text||'/'||p_project_id::text||
         '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.'||
         '(img|'||(case v_asset.mime_type when 'image/png' then 'png' when 'image/jpeg' then 'jpg' else 'webp' end)||')
      then raise exception using errcode='22023',message='PRIVATE_THUMBNAIL_UNAVAILABLE';end if;
    select * into v_object from storage.objects where bucket_id='kadmeion-private-assets'
      and name=v_asset.object_path and owner_id=v_owner::text;
    if not found or lower(coalesce(v_object.metadata->>'mimetype',''))<>v_asset.mime_type
      or coalesce(v_object.metadata->>'size','') !~ '^[0-9]{1,10}$'
      then raise exception using errcode='22023',message='PRIVATE_THUMBNAIL_UNAVAILABLE';end if;
    if (v_object.metadata->>'size')::bigint<>v_asset.byte_size
      then raise exception using errcode='22023',message='PRIVATE_THUMBNAIL_UNAVAILABLE';end if;
    v_asset_json:=jsonb_build_object('id',v_asset.id,'projectId',v_asset.project_id,
      'mime',v_asset.mime_type,'size',v_asset.byte_size,'altText',v_asset.alt_text,
      'createdAt',v_asset.created_at,'objectPath',v_asset.object_path);
  end if;
  return jsonb_build_object('projectId',p_project_id,'ownerUserId',v_owner,
    'revision',v_project.revision,'asset',v_asset_json,'publicDeliveryAllowed',false);
end;
$$;
revoke all on function public.read_private_project_thumbnail(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_private_project_thumbnail(uuid) to authenticated;

create function public.set_private_project_thumbnail(
  p_project_id uuid,p_base_revision bigint,p_asset_id uuid,p_operation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid := (select auth.uid());
  v_project public.projects%rowtype;
begin
  if v_owner is null then raise exception using errcode='42501',message='OWNER_REQUIRED';end if;
  if p_project_id is null or p_operation_id is null or p_base_revision is null
    or p_base_revision<0 or p_base_revision>=9007199254740991
    then raise exception using errcode='22023',message='INVALID_THUMBNAIL_CHANGE';end if;
  select * into v_project from public.projects where id=p_project_id
    and owner_user_id=v_owner and trashed_at is null for update;
  if not found then raise exception using errcode='42501',message='PRIVATE_PROJECT_NOT_FOUND';end if;
  -- Only identical replay of the latest operation, while its resulting revision
  -- is current, is acknowledged. Earlier/superseded operations conflict via CAS.
  if v_project.thumbnail_operation_id=p_operation_id then
    if v_project.thumbnail_operation_base_revision is distinct from p_base_revision
      or v_project.thumbnail_asset_id is distinct from p_asset_id
      or v_project.revision<>p_base_revision+1
      then raise exception using errcode='40001',message='THUMBNAIL_OPERATION_CONFLICT';end if;
    return public.read_private_project_thumbnail(p_project_id);
  end if;
  if v_project.revision<>p_base_revision then
    raise exception using errcode='40001',message='REVISION_CONFLICT';end if;
  if p_asset_id is not null and not exists(
    select 1 from public.project_assets where id=p_asset_id and project_id=p_project_id
      and owner_user_id=v_owner
  ) then raise exception using errcode='42501',message='PRIVATE_ASSET_NOT_FOUND';end if;
  update public.projects set thumbnail_asset_id=p_asset_id,thumbnail_operation_id=p_operation_id,
    thumbnail_operation_base_revision=p_base_revision,revision=revision+1,updated_at=now()
    where id=p_project_id and owner_user_id=v_owner;
  -- Raises and rolls back the change on missing/mismatched Storage metadata.
  return public.read_private_project_thumbnail(p_project_id);
end;
$$;
revoke all on function public.set_private_project_thumbnail(uuid,bigint,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.set_private_project_thumbnail(uuid,bigint,uuid,uuid) to authenticated;
comment on function public.set_private_project_thumbnail(uuid,bigint,uuid,uuid) is
  'Owner-only CAS manual thumbnail selection, exact latest-operation replay; never publishes or deletes bytes.';
comment on column public.projects.thumbnail_asset_id is
  'Owner-private manual thumbnail reference; not a published media pin, and not remote capture.';
)
      then raise exception using errcode='22023',message='PRIVATE_THUMBNAIL_UNAVAILABLE';end if;
    select * into v_object from storage.objects where bucket_id='kadmeion-private-assets'
      and name=v_asset.object_path and owner_id=v_owner::text;
    if not found or lower(coalesce(v_object.metadata->>'mimetype',''))<>v_asset.mime_type
      or case when coalesce(v_object.metadata->>'size','') ~ '^[0-9]{1,10}$'
         then (v_object.metadata->>'size')::bigint<>v_asset.byte_size else true end
      then raise exception using errcode='22023',message='PRIVATE_THUMBNAIL_UNAVAILABLE';end if;
    v_asset_json:=jsonb_build_object('id',v_asset.id,'projectId',v_asset.project_id,
      'mime',v_asset.mime_type,'size',v_asset.byte_size,'altText',v_asset.alt_text,
      'createdAt',v_asset.created_at,'objectPath',v_asset.object_path);
  end if;
  return jsonb_build_object('projectId',p_project_id,'ownerUserId',v_owner,
    'revision',v_project.revision,'asset',v_asset_json,'publicDeliveryAllowed',false);
end;
$$;
revoke all on function public.read_private_project_thumbnail(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_private_project_thumbnail(uuid) to authenticated;

create function public.set_private_project_thumbnail(
  p_project_id uuid,p_base_revision bigint,p_asset_id uuid,p_operation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid := (select auth.uid());
  v_project public.projects%rowtype;
begin
  if v_owner is null then raise exception using errcode='42501',message='OWNER_REQUIRED';end if;
  if p_project_id is null or p_operation_id is null or p_base_revision is null
    or p_base_revision<0 or p_base_revision>=9007199254740991
    then raise exception using errcode='22023',message='INVALID_THUMBNAIL_CHANGE';end if;
  select * into v_project from public.projects where id=p_project_id
    and owner_user_id=v_owner and trashed_at is null for update;
  if not found then raise exception using errcode='42501',message='PRIVATE_PROJECT_NOT_FOUND';end if;
  -- Only identical replay of the latest operation, while its resulting revision
  -- is current, is acknowledged. Earlier/superseded operations conflict via CAS.
  if v_project.thumbnail_operation_id=p_operation_id then
    if v_project.thumbnail_operation_base_revision is distinct from p_base_revision
      or v_project.thumbnail_asset_id is distinct from p_asset_id
      or v_project.revision<>p_base_revision+1
      then raise exception using errcode='40001',message='THUMBNAIL_OPERATION_CONFLICT';end if;
    return public.read_private_project_thumbnail(p_project_id);
  end if;
  if v_project.revision<>p_base_revision then
    raise exception using errcode='40001',message='REVISION_CONFLICT';end if;
  if p_asset_id is not null and not exists(
    select 1 from public.project_assets where id=p_asset_id and project_id=p_project_id
      and owner_user_id=v_owner
  ) then raise exception using errcode='42501',message='PRIVATE_ASSET_NOT_FOUND';end if;
  update public.projects set thumbnail_asset_id=p_asset_id,thumbnail_operation_id=p_operation_id,
    thumbnail_operation_base_revision=p_base_revision,revision=revision+1,updated_at=now()
    where id=p_project_id and owner_user_id=v_owner;
  -- Raises and rolls back the change on missing/mismatched Storage metadata.
  return public.read_private_project_thumbnail(p_project_id);
end;
$$;
revoke all on function public.set_private_project_thumbnail(uuid,bigint,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.set_private_project_thumbnail(uuid,bigint,uuid,uuid) to authenticated;
comment on function public.set_private_project_thumbnail(uuid,bigint,uuid,uuid) is
  'Owner-only CAS manual thumbnail selection, exact latest-operation replay; never publishes or deletes bytes.';
comment on column public.projects.thumbnail_asset_id is
  'Owner-private manual thumbnail reference; not a published media pin, and not remote capture.';
