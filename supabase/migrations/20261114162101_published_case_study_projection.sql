create table kadmeion_private.case_study_publications (
  project_id uuid primary key,
  owner_user_id uuid not null,
  slug text not null,
  handle text not null,
  payload jsonb not null,
  foreign key(project_id,owner_user_id) references public.projects(id,owner_user_id) on delete cascade
);
alter table kadmeion_private.case_study_publications enable row level security;
revoke all on kadmeion_private.case_study_publications from public,anon,authenticated,service_role;

create function kadmeion_private.withdraw_case_study_projection()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if tg_table_name='projects' then
    if old.slug is distinct from new.slug or old.trashed_at is distinct from new.trashed_at then
      delete from kadmeion_private.case_study_publications where project_id=old.id;
    end if;
  elsif tg_table_name='profiles' then
    if old.handle is distinct from new.handle then
      delete from kadmeion_private.case_study_publications where owner_user_id=old.user_id;
    end if;
  elsif tg_op='DELETE' then
    delete from kadmeion_private.case_study_publications where project_id=old.project_id;
  elsif old.show_case_study is distinct from new.show_case_study then
    delete from kadmeion_private.case_study_publications where project_id=old.project_id;
  end if;
  return null;
end;
$function$;
revoke all on function kadmeion_private.withdraw_case_study_projection()
  from public,anon,authenticated,service_role;
create trigger kd_case_study_project_withdrawal after update of slug,trashed_at on public.projects
  for each row execute function kadmeion_private.withdraw_case_study_projection();
create trigger kd_case_study_handle_withdrawal after update of handle on public.profiles
  for each row execute function kadmeion_private.withdraw_case_study_projection();
create trigger kd_case_study_exposure_withdrawal after update or delete on public.project_exposure_intents
  for each row execute function kadmeion_private.withdraw_case_study_projection();

create function public.owner_publish_case_study_projection(
  p_project_id uuid,p_expected_revision bigint,p_confirmation text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_owner uuid := (select auth.uid());
  v_project public.projects%rowtype;
  v_sections jsonb;
  v_handle text;
begin
  perform kadmeion_private.require_live_exit_auth_session();
  if p_confirmation is distinct from 'PUBLISH CASE STUDY'
    or p_project_id is null or p_expected_revision is null or p_expected_revision<0 then
    raise exception using errcode='22023',message='CASE_STUDY_PUBLICATION_CONFIRMATION_REQUIRED';
  end if;
  select * into v_project from public.projects
    where id=p_project_id and owner_user_id=v_owner and trashed_at is null for update;
  if not found then
    raise exception using errcode='42501',message='PROJECT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  if v_project.revision<>p_expected_revision then
    raise exception using errcode='40001',message='REVISION_CONFLICT';
  end if;
  perform 1 from public.project_exposure_intents where project_id=p_project_id
    and owner_user_id=v_owner and show_case_study for update;
  if not found then
    raise exception using errcode='42501',message='CASE_STUDY_SHARING_REQUIRED';
  end if;
  select handle into v_handle from public.profiles where user_id=v_owner for update;
  if v_handle is null then
    raise exception using errcode='42501',message='PROFILE_HANDLE_REQUIRED';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('title',section->>'title',
    'body',section->>'body') order by position),'[]'::jsonb)
    into v_sections
    from jsonb_array_elements(v_project.case_study->'sections') with ordinality as sections(section,position)
    where section->'visible'='true'::jsonb;
  insert into kadmeion_private.case_study_publications(project_id,owner_user_id,slug,handle,payload)
  values(p_project_id,v_owner,v_project.slug,v_handle,jsonb_strip_nulls(jsonb_build_object(
    'slug',v_project.slug,'title',v_project.title,'summary',v_project.summary,
    'description',v_project.description,'repositoryUrl',v_project.repository_url,
    'liveUrl',v_project.live_url,'sections',v_sections)))
  on conflict(project_id) do update set slug=excluded.slug,handle=excluded.handle,payload=excluded.payload;
  return jsonb_build_object('status','PROJECTION_READY','slug',v_project.slug);
end;
$function$;
revoke all on function public.owner_publish_case_study_projection(uuid,bigint,text)
  from public,anon,service_role;
grant execute on function public.owner_publish_case_study_projection(uuid,bigint,text)
  to authenticated;

create function public.service_read_published_case_study_projection(p_handle text,p_slug text)
returns jsonb language sql stable security definer set search_path=''
as $function$
  select publication.payload || jsonb_build_object('handle',profile.handle)
    from kadmeion_private.case_study_publications publication
    join public.projects project on project.id=publication.project_id
      and project.owner_user_id=publication.owner_user_id and project.slug=publication.slug
    join public.profiles profile on profile.user_id=publication.owner_user_id
    join public.project_exposure_intents exposure on exposure.project_id=project.id
      and exposure.owner_user_id=publication.owner_user_id
    where profile.handle=p_handle and publication.handle=p_handle and publication.slug=p_slug
      and project.trashed_at is null and exposure.show_case_study
$function$;
revoke all on function public.service_read_published_case_study_projection(text,text)
  from public,anon,authenticated;
grant execute on function public.service_read_published_case_study_projection(text,text)
  to service_role;
