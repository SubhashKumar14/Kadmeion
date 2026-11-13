-- B2: prohibit fake asset associations. Every metadata registration must match
-- a real object uploaded to the private owner bucket; no public exposure.
revoke insert on public.project_assets from authenticated;
revoke insert (project_id,owner_user_id,object_path,mime_type,byte_size,alt_text)
  on public.project_assets from authenticated;

create function public.register_private_project_image(
  p_project_id uuid,p_object_path text,p_mime_type text,p_byte_size bigint,p_alt_text text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_metadata jsonb;
  v_id uuid;
  v_existing public.project_assets%rowtype;
begin
  if v_owner is null then
    raise exception using errcode='42501',message='AUTH_REQUIRED';
  end if;
  if p_project_id is null or
     not exists(select 1 from public.projects where id=p_project_id and owner_user_id=v_owner) then
    raise exception using errcode='42501',message='PRIVATE_PROJECT_NOT_FOUND';
  end if;
  if p_object_path is null or
     char_length(p_object_path) > 255 or
     p_object_path !~ ('^' || v_owner::text || '/[A-Za-z0-9_-]{1,64}/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$') or
     position('..' in p_object_path)>0 or
     p_mime_type is null or p_mime_type not in ('image/png','image/jpeg','image/webp','image/avif') or
     p_byte_size is null or p_byte_size < 1 or p_byte_size > 5242880 or
     p_alt_text is null or char_length(p_alt_text)>500 then
    raise exception using errcode='22023',message='INVALID_PRIVATE_ASSET';
  end if;

  select metadata into v_metadata
  from storage.objects
  where bucket_id='kadmeion-private-assets'
    and name=p_object_path and owner_id=v_owner::text;
  if not found or v_metadata is null or
     coalesce(v_metadata->>'size','') !~ '^[0-9]{1,10}$' or
     (v_metadata->>'size')::bigint <> p_byte_size or
     lower(coalesce(v_metadata->>'mimetype','')) <> p_mime_type then
    raise exception using errcode='22023',message='PRIVATE_STORAGE_OBJECT_NOT_VERIFIED';
  end if;

  insert into public.project_assets(
    project_id,owner_user_id,object_path,mime_type,byte_size,alt_text
  ) values (
    p_project_id,v_owner,p_object_path,p_mime_type,p_byte_size,p_alt_text
  ) on conflict(object_path) do nothing returning id into v_id;

  if v_id is null then
    select * into v_existing from public.project_assets
    where object_path=p_object_path and owner_user_id=v_owner
      and project_id=p_project_id and mime_type=p_mime_type and byte_size=p_byte_size;
    if not found then
      raise exception using errcode='23505',message='ASSET_ALREADY_LINKED_TO_DIFFERENT_PROJECT';
    end if;
    v_id:=v_existing.id;
  end if;

  return jsonb_build_object('id',v_id,'object_path',p_object_path,'storage_metadata_matched',true);
end;
$$;
revoke all on function public.register_private_project_image(uuid,text,text,bigint,text)
  from public,anon;
grant execute on function public.register_private_project_image(uuid,text,text,bigint,text)
  to authenticated;
comment on function public.register_private_project_image(uuid,text,text,bigint,text) is
  'Signed-in owner image metadata registration only after verifying private Storage object and MIME/byte size. Does not publish.';
