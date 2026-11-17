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

-- WF-009 / WORK-03: private authored profile links. Not connections,
-- public sharing preferences, remote URL fetches, or ownership proof.
alter table public.profiles add column private_links jsonb not null default '[]'::jsonb,
  add constraint profiles_private_links_shape check (
    jsonb_typeof(private_links)='array' and jsonb_array_length(private_links)<=12
    and octet_length(private_links::text)<=32768
  );
-- Historical table-wide INSERT implicitly includes new columns. Preserve
-- existing column permissions except the newly managed private links.
revoke insert on public.profiles from authenticated;
grant insert(user_id,handle,display_name,headline,bio,onboarding_complete,created_at,updated_at,private_skills)
  on public.profiles to authenticated;
revoke insert(private_links),update(private_links) on public.profiles from public,anon,authenticated;

create function public.owner_save_private_profile_links(p_expected jsonb,p_links jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid := (select auth.uid());
  v_current jsonb;
  v_link jsonb;
  v_url text;
  v_label text;
  v_seen text[] := '{}';
begin
  if v_owner is null then raise exception using errcode='42501',message='OWNER_REQUIRED';end if;
  if jsonb_typeof(p_expected) is distinct from 'array' or jsonb_typeof(p_links) is distinct from 'array'
    then raise exception using errcode='22023',message='INVALID_PROFILE_LINKS';end if;
  if jsonb_array_length(p_links)>12 or jsonb_array_length(p_expected)>12
    or octet_length(p_links::text)>32768 or octet_length(p_expected::text)>32768
    then raise exception using errcode='22023',message='INVALID_PROFILE_LINKS';end if;
  for v_link in select value from jsonb_array_elements(p_links) loop
    if jsonb_typeof(v_link) is distinct from 'object'
      then raise exception using errcode='22023',message='INVALID_PROFILE_LINK';end if;
    if jsonb_typeof(v_link->'label') is distinct from 'string'
       or jsonb_typeof(v_link->'url') is distinct from 'string'
       or (select count(*) from jsonb_object_keys(v_link))<>2
      then raise exception using errcode='22023',message='INVALID_PROFILE_LINK';end if;
    v_label:=v_link->>'label'; v_url:=v_link->>'url';
    if v_label is distinct from btrim(v_label) or char_length(v_label) not between 1 and 80
       or v_label ~ '[[:cntrl:]]' or char_length(v_url)>2048
       or v_url !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+/[^[:space:][:cntrl:]]*$'
       or v_url=any(v_seen)
      then raise exception using errcode='22023',message='INVALID_PROFILE_LINK';end if;
    v_seen:=array_append(v_seen,v_url);
  end loop;
  select private_links into v_current from public.profiles where user_id=v_owner for update;
  if not found then raise exception using errcode='42501',message='OWNER_REQUIRED';end if;
  -- Same desired state is safe to acknowledge after an ambiguous save;
  -- stale different desired state cannot overwrite another edit.
  if v_current is distinct from p_links then
    if v_current is distinct from p_expected then
      raise exception using errcode='40001',message='PROFILE_LINKS_CONFLICT';end if;
    update public.profiles set private_links=p_links,updated_at=now() where user_id=v_owner;
  end if;
  return jsonb_build_object('user_id',v_owner,'private_links',p_links);
end;
$$;
revoke all on function public.owner_save_private_profile_links(jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.owner_save_private_profile_links(jsonb,jsonb) to authenticated;
comment on column public.profiles.private_links is
  'Owner-private authored links, excluded from explicit public projection and never fetched.';
