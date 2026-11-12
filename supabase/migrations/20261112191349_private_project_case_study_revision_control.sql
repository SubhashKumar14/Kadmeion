-- B2: revision-safe structured project case studies; nothing becomes public on save.
alter table public.projects
  add column case_study jsonb not null default '{"sections":[]}'::jsonb,
  add constraint projects_case_study_shape check (
    jsonb_typeof(case_study)='object' and
    jsonb_typeof(case_study->'sections')='array' and
    jsonb_array_length(case_study->'sections')<=24 and
    octet_length(case_study::text)<=100000
  );

create function public.update_private_project_case_study(
  p_project_id uuid,p_base_revision bigint,p_case_study jsonb
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_owner uuid:=(select auth.uid());
  v_project public.projects%rowtype;
  v_section jsonb;
  v_count int;
  v_distinct_count int;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED';end if;
  if p_base_revision is null or p_base_revision<0 or
     p_case_study is null or jsonb_typeof(p_case_study) is distinct from 'object' or
     jsonb_typeof(p_case_study->'sections') is distinct from 'array' or
     octet_length(p_case_study::text)>100000 or
     jsonb_array_length(p_case_study->'sections')>24
  then raise exception using errcode='22023',message='INVALID_CASE_STUDY'; end if;
  select count(*),count(distinct value->>'id')
    into v_count,v_distinct_count
  from jsonb_array_elements(p_case_study->'sections');
  if v_count<>v_distinct_count then
    raise exception using errcode='22023',message='DUPLICATE_CASE_SECTION';end if;
  for v_section in select value from jsonb_array_elements(p_case_study->'sections') loop
    if jsonb_typeof(v_section) is distinct from 'object'
       or coalesce(v_section->>'id','') !~ '^[a-z0-9_-]{1,64}$'
       or coalesce(v_section->>'kind','') not in ('challenge','approach','implementation','results','media','custom')
       or jsonb_typeof(v_section->'title') is distinct from 'string'
       or char_length(v_section->>'title')>120
       or jsonb_typeof(v_section->'body') is distinct from 'string'
       or char_length(v_section->>'body')>12000
       or jsonb_typeof(v_section->'visible') is distinct from 'boolean'
    then raise exception using errcode='22023',message='INVALID_CASE_SECTION';end if;
  end loop;
  select * into v_project from public.projects
    where id=p_project_id and owner_user_id=v_owner for update;
  if not found then raise exception using errcode='42501',message='PROJECT_NOT_FOUND_OR_FORBIDDEN';end if;
  if v_project.revision<>p_base_revision then
    raise exception using errcode='40001',message='REVISION_CONFLICT';end if;
  update public.projects set case_study=p_case_study,revision=revision+1,updated_at=now()
    where id=p_project_id returning * into v_project;
  return jsonb_build_object('id',v_project.id,'revision',v_project.revision);
end;
$$;
revoke all on function public.update_private_project_case_study(uuid,bigint,jsonb) from public,anon;
grant execute on function public.update_private_project_case_study(uuid,bigint,jsonb) to authenticated;
comment on function public.update_private_project_case_study(uuid,bigint,jsonb) is
'Owner-authenticated CAS update for private, ordered, hidden-or-visible case-study modules.';

