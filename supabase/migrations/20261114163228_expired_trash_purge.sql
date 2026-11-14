-- Permanent cleanup starts only after the owner's restoration window closes.
create index kd_trash_due_idx on public.private_trash_items(restore_until,id)
  where restored_at is null;

create function public.service_list_expired_trash(p_limit integer default 25)
returns table(trash_id uuid, item_type text, object_paths text[])
language sql stable security definer set search_path=''
as $function$
  select trash.id,trash.item_type,array(
    select asset.object_path from public.project_assets asset
    join storage.objects upload on upload.bucket_id='kadmeion-private-assets'
      and upload.name=asset.object_path and upload.owner_id=asset.owner_user_id::text
    where trash.item_type='project' and asset.project_id=trash.item_id
      and asset.owner_user_id=trash.owner_user_id
    order by asset.object_path limit 100
  )
  from public.private_trash_items trash
  where trash.restored_at is null and trash.restore_until<=statement_timestamp()
    and (case trash.item_type
      when 'project' then exists(select 1 from public.projects item where item.id=trash.item_id
        and item.owner_user_id=trash.owner_user_id and item.trashed_at=trash.trashed_at)
      else exists(select 1 from public.portfolios item where item.id=trash.item_id
        and item.owner_user_id=trash.owner_user_id and item.trashed_at=trash.trashed_at)
    end)
  order by trash.restore_until,trash.id
  limit least(greatest(coalesce(p_limit,25),1),100)
$function$;
revoke all on function public.service_list_expired_trash(integer) from public,anon,authenticated;
grant execute on function public.service_list_expired_trash(integer) to service_role;

create function public.service_purge_expired_trash(p_trash_id uuid)
returns text language plpgsql security definer set search_path=''
as $function$
declare
  v_trash public.private_trash_items%rowtype;
begin
  select * into v_trash from public.private_trash_items
    where id=p_trash_id and restored_at is null and restore_until<=statement_timestamp()
    for update;
  if not found then
    return 'NOT_DUE';
  end if;

  if v_trash.item_type='project' then
    perform 1 from public.projects where id=v_trash.item_id
      and owner_user_id=v_trash.owner_user_id and trashed_at=v_trash.trashed_at for update;
    if not found then
      return 'STATE_CHANGED';
    end if;
    if exists(
      select 1 from public.project_assets asset join storage.objects upload
        on upload.bucket_id='kadmeion-private-assets' and upload.name=asset.object_path
      where asset.project_id=v_trash.item_id and asset.owner_user_id=v_trash.owner_user_id
    ) then
      return 'STORAGE_PENDING';
    end if;
    delete from public.projects where id=v_trash.item_id and owner_user_id=v_trash.owner_user_id;
  else
    delete from public.portfolios where id=v_trash.item_id
      and owner_user_id=v_trash.owner_user_id and trashed_at=v_trash.trashed_at;
    if not found then
      return 'STATE_CHANGED';
    end if;
  end if;
  delete from public.private_trash_items where item_type=v_trash.item_type
    and item_id=v_trash.item_id and owner_user_id=v_trash.owner_user_id;
  return 'PURGED';
end;
$function$;
revoke all on function public.service_purge_expired_trash(uuid) from public,anon,authenticated;
grant execute on function public.service_purge_expired_trash(uuid) to service_role;

-- Owner image registration locks its project. Refuse late registration for
-- trashed projects so a sweep always has a stable set of registered uploads.
create function kadmeion_private.reject_asset_for_trashed_project()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  perform 1 from public.projects where id=new.project_id and owner_user_id=new.owner_user_id
    and trashed_at is null for share;
  if not found then
    raise exception using errcode='55000',message='PRIVATE_ITEM_TRASHED';
  end if;
  return new;
end;
$function$;
revoke all on function kadmeion_private.reject_asset_for_trashed_project()
  from public,anon,authenticated,service_role;
create trigger kd_trash_asset_registration_guard before insert on public.project_assets
  for each row execute function kadmeion_private.reject_asset_for_trashed_project();
