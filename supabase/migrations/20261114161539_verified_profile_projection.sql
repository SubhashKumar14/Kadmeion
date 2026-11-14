-- Owner consent and a narrow server-side public identity read.
create table kadmeion_private.profile_publications (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  handle text not null,
  display_name text,
  headline text,
  bio text,
  published_at timestamptz not null default transaction_timestamp(),
  check (display_name is not null or headline is not null or bio is not null)
);
alter table kadmeion_private.profile_publications enable row level security;
revoke all on kadmeion_private.profile_publications from public,anon,authenticated,service_role;

-- A later re-enable of sharing preferences cannot revive a withdrawn snapshot.
create function kadmeion_private.invalidate_profile_publication()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if tg_op='DELETE' then
    delete from kadmeion_private.profile_publications where user_id=old.user_id;
  elsif tg_table_name='profiles' then
    if old.handle is distinct from new.handle then
      delete from kadmeion_private.profile_publications where user_id=old.user_id;
    end if;
  elsif old.publication_requested is distinct from new.publication_requested
    or old.share_display_name is distinct from new.share_display_name
    or old.share_headline is distinct from new.share_headline
    or old.share_bio is distinct from new.share_bio then
    delete from kadmeion_private.profile_publications where user_id=old.user_id;
  end if;
  return null;
end;
$function$;
revoke all on function kadmeion_private.invalidate_profile_publication()
  from public,anon,authenticated,service_role;

create trigger kd_invalidate_profile_publication_handle
  after update of handle on public.profiles
  for each row execute function kadmeion_private.invalidate_profile_publication();

create trigger kd_invalidate_profile_publication_preferences
  after update or delete on public.profile_sharing_preferences
  for each row execute function kadmeion_private.invalidate_profile_publication();

create function public.owner_publish_profile_projection(p_confirmation text)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_owner uuid := (select auth.uid());
  v_profile public.profiles%rowtype;
  v_preferences public.profile_sharing_preferences%rowtype;
begin
  perform kadmeion_private.require_live_exit_auth_session();
  if p_confirmation is distinct from 'PUBLISH PROFILE' then
    raise exception using errcode='22023',message='PROFILE_PUBLICATION_CONFIRMATION_REQUIRED';
  end if;
  select * into v_profile from public.profiles where user_id=v_owner for update;
  if not found or v_profile.handle is null then
    raise exception using errcode='42501',message='PROFILE_HANDLE_REQUIRED';
  end if;
  select * into v_preferences from public.profile_sharing_preferences where user_id=v_owner for update;
  if not found or not v_preferences.publication_requested then
    raise exception using errcode='42501',message='PROFILE_SHARING_REQUIRED';
  end if;
  insert into kadmeion_private.profile_publications(user_id,handle,display_name,headline,bio)
  values(v_owner,v_profile.handle,
    case when v_preferences.share_display_name then v_profile.display_name end,
    case when v_preferences.share_headline then v_profile.headline end,
    case when v_preferences.share_bio then v_profile.bio end)
  on conflict(user_id) do update set handle=excluded.handle,display_name=excluded.display_name,
    headline=excluded.headline,bio=excluded.bio,published_at=excluded.published_at;
  return jsonb_build_object('status','PROJECTION_READY','handle',v_profile.handle);
end;
$function$;
revoke all on function public.owner_publish_profile_projection(text) from public,anon,service_role;
grant execute on function public.owner_publish_profile_projection(text) to authenticated;

create function public.service_read_published_profile_projection(p_handle text)
returns jsonb language sql stable security definer set search_path=''
as $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'handle',publication.handle,'displayName',publication.display_name,
    'headline',publication.headline,'bio',publication.bio))
  from kadmeion_private.profile_publications publication
  join public.profiles profile on profile.user_id=publication.user_id
    and profile.handle=publication.handle
  where publication.handle=p_handle and p_handle ~ '^[a-z][a-z0-9_]{2,29}$'
$function$;
revoke all on function public.service_read_published_profile_projection(text) from public,anon,authenticated;
grant execute on function public.service_read_published_profile_projection(text) to service_role;
