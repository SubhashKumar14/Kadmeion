-- B1/B2 hardening. Only approved editable profile columns; project writes use CAS RPC.
revoke update on table public.profiles from authenticated;
grant update (handle,display_name,headline,bio,onboarding_complete) on public.profiles to authenticated;
revoke update on table public.projects from authenticated;

create or replace function public.update_private_project(
  p_project_id uuid, p_base_revision bigint, p_title text,
  p_summary text, p_description text, p_repository_url text, p_live_url text
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_record public.projects%rowtype;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if p_base_revision is null or p_base_revision < 0 or
     p_title is null or char_length(btrim(p_title)) not between 1 and 120 or
     p_summary is null or char_length(p_summary)>360 or
     p_description is null or char_length(p_description)>12000 then
    raise exception using errcode='22023',message='INVALID_PROJECT_INPUT';
  end if;
  if (p_repository_url is not null and (
       char_length(p_repository_url)>2048 or p_repository_url !~ '^https://[^[:space:]]+$'
     )) or (p_live_url is not null and (
       char_length(p_live_url)>2048 or p_live_url !~ '^https://[^[:space:]]+$'
     )) then
    raise exception using errcode='22023',message='INVALID_PROJECT_URL';
  end if;
  select * into v_record from public.projects
  where id=p_project_id and owner_user_id=v_owner for update;
  if not found then raise exception using errcode='42501',message='PROJECT_NOT_FOUND_OR_FORBIDDEN'; end if;
  if v_record.revision <> p_base_revision then
    raise exception using errcode='40001',message='REVISION_CONFLICT';
  end if;
  update public.projects set
    title=btrim(p_title),summary=p_summary,description=p_description,
    repository_url=p_repository_url,live_url=p_live_url,
    revision=revision+1,updated_at=now()
  where id=p_project_id returning * into v_record;
  return jsonb_build_object('id',v_record.id,'revision',v_record.revision,'updated_at',v_record.updated_at);
end;
$$;
revoke all on function public.update_private_project(uuid,bigint,text,text,text,text,text) from public,anon;
grant execute on function public.update_private_project(uuid,bigint,text,text,text,text,text) to authenticated;
comment on function public.update_private_project(uuid,bigint,text,text,text,text,text) is
  'Intentional signed-in RPC: checks auth.uid ownership and locks row for optimistic revision update.';

