-- B16 guarded project autosave: a single atomic owner/revision/projection decision.
-- The existing manual RPC is retained for explicit legacy actions, not autosave fallback.
create function public.owner_save_private_project_draft(
  p_project_id uuid,p_base_revision bigint,p_title text,p_summary text,
  p_description text,p_repository_url text,p_live_url text,
  p_confirm_projection_withdrawal boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid := auth.uid();
  v_session uuid;
  v_project public.projects%rowtype;
begin
  v_session:=kadmeion_private.require_live_exit_auth_session();
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if p_project_id is null or p_base_revision is null or p_base_revision<0
     or p_base_revision>9007199254740991 or p_confirm_projection_withdrawal is null
     or p_title is null or char_length(btrim(p_title)) not between 1 and 120
     or p_summary is null or char_length(p_summary)>360
     or p_description is null or char_length(p_description)>12000 then
    raise exception using errcode='22023',message='INVALID_PROJECT_INPUT';
  end if;
  if (p_repository_url is not null and (char_length(p_repository_url)>2048
      or p_repository_url !~ '^https://[^[:space:]]+$'))
     or (p_live_url is not null and (char_length(p_live_url)>2048
      or p_live_url !~ '^https://[^[:space:]]+$')) then
    raise exception using errcode='22023',message='INVALID_PROJECT_URL';
  end if;
  perform 1 from auth.users where id=v_owner for key share;
  if not found then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  -- The existing case-study publication writer locks this same project row.
  -- CAS, no-op check, projection existence and mutation are serialized.
  select * into v_project from public.projects
    where id=p_project_id and owner_user_id=v_owner and trashed_at is null for update;
  if v_owner is distinct from (select auth.uid())
     or v_session is distinct from kadmeion_private.require_live_exit_auth_session()
     or not exists(select 1 from auth.sessions where user_id=v_owner and id=v_session
     and (not_after is null or not_after>clock_timestamp())) then
    raise exception using errcode='42501',message='AUTH_REQUIRED';
  end if;
  if v_project.id is null then
    raise exception using errcode='42501',message='PROJECT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  if v_project.revision<>p_base_revision then
    raise exception using errcode='40001',message='REVISION_CONFLICT';
  end if;
  if row(v_project.title,v_project.summary,v_project.description,v_project.repository_url,v_project.live_url)
     is not distinct from row(btrim(p_title),p_summary,p_description,p_repository_url,p_live_url) then
    return jsonb_build_object('id',v_project.id,'revision',v_project.revision,'updated_at',v_project.updated_at);
  end if;
  if not p_confirm_projection_withdrawal and exists(
    select 1 from kadmeion_private.case_study_publications where project_id=v_project.id and owner_user_id=v_owner
  ) then raise exception using errcode='P0001',message='PROJECT_WITHDRAWAL_CONFIRMATION_REQUIRED'; end if;
  if v_project.revision>=9007199254740991 then
    raise exception using errcode='55000',message='PROJECT_REVISION_EXHAUSTED';
  end if;
  update public.projects set title=btrim(p_title),summary=p_summary,
    description=p_description,repository_url=p_repository_url,live_url=p_live_url,
    revision=revision+1,updated_at=now()
    where id=v_project.id and owner_user_id=v_owner returning * into v_project;
  -- Existing content-privacy trigger removes any prior projection atomically.
  if exists(select 1 from kadmeion_private.case_study_publications
      where project_id=v_project.id and owner_user_id=v_owner) then
    raise exception using errcode='40001',message='PROJECT_PROJECTION_WITHDRAWAL_CONFLICT';
  end if;
  if v_session is distinct from kadmeion_private.require_live_exit_auth_session()
     or not exists(select 1 from auth.sessions where id=v_session and user_id=v_owner
       and (not_after is null or not_after>clock_timestamp())) then
    raise exception using errcode='42501',message='AUTH_REQUIRED';
  end if;
  return jsonb_build_object('id',v_project.id,'revision',v_project.revision,'updated_at',v_project.updated_at);
end;
$$;
revoke all on function public.owner_save_private_project_draft(uuid,bigint,text,text,text,text,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.owner_save_private_project_draft(uuid,bigint,text,text,text,text,text,boolean)
  to authenticated;
comment on function public.owner_save_private_project_draft(uuid,bigint,text,text,text,text,text,boolean) is
  'Live owner session + atomic revision CAS and explicit case-study withdrawal consent. No mutation on unchanged draft.';
