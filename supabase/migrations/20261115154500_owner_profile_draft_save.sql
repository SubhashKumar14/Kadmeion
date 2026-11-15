alter table public.profiles
  add column private_skills text[] not null default '{}',
  add constraint profile_private_skills_limit check (cardinality(private_skills) <= 20);

create function public.owner_save_profile_draft(
  p_expected jsonb,
  p_draft jsonb,
  p_confirm_projection_withdrawal boolean default false
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_profile public.profiles%rowtype;
  v_current jsonb;
  v_display_name text;
  v_headline text;
  v_bio text;
  v_skills text[];
  v_public_change boolean;
begin
  if v_owner is null then
    raise exception using errcode = '42501', message = 'OWNER_REQUIRED';
  end if;
  if pg_catalog.jsonb_typeof(p_draft) is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_draft->'displayName') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_draft->'headline') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_draft->'bio') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_draft->'skills') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'INVALID_PROFILE_DRAFT';
  end if;
  if pg_catalog.jsonb_array_length(p_draft->'skills') > 20
     or exists (select 1 from pg_catalog.jsonb_array_elements(p_draft->'skills') as s(value)
       where pg_catalog.jsonb_typeof(s.value) <> 'string'
          or pg_catalog.char_length(pg_catalog.btrim(s.value #>> '{}')) not between 1 and 40) then
    raise exception using errcode = '22023', message = 'INVALID_PROFILE_SKILLS';
  end if;
  v_display_name := pg_catalog.btrim(p_draft->>'displayName');
  v_headline := pg_catalog.btrim(p_draft->>'headline');
  v_bio := pg_catalog.btrim(p_draft->>'bio');
  if pg_catalog.char_length(v_display_name) not between 1 and 80
     or pg_catalog.char_length(v_headline) > 160
     or pg_catalog.char_length(v_bio) > 2000 then
    raise exception using errcode = '22023', message = 'INVALID_PROFILE_FIELDS';
  end if;
  select coalesce(pg_catalog.array_agg(pg_catalog.btrim(s.value) order by s.ordinality), '{}')
  into v_skills
  from pg_catalog.jsonb_array_elements_text(p_draft->'skills') with ordinality as s(value, ordinality);

  select * into v_profile from public.profiles where user_id = v_owner for update;
  if not found then
    raise exception using errcode = '42501', message = 'OWNER_REQUIRED';
  end if;
  v_current := pg_catalog.jsonb_build_object(
    'displayName', v_profile.display_name, 'headline', v_profile.headline,
    'bio', v_profile.bio, 'skills', v_profile.private_skills);
  if p_expected is distinct from v_current then
    raise exception using errcode = '40001', message = 'PROFILE_DRAFT_CONFLICT';
  end if;

  v_public_change := row(v_display_name, v_headline, v_bio)
    is distinct from row(v_profile.display_name, v_profile.headline, v_profile.bio);
  if v_public_change then
    if p_confirm_projection_withdrawal is distinct from true
       and exists (select 1 from kadmeion_private.profile_publications where user_id = v_owner) then
      raise exception using errcode = 'P0001', message = 'PROFILE_WITHDRAWAL_CONFIRMATION_REQUIRED';
    end if;
    update public.profiles set display_name = v_display_name, headline = v_headline,
      bio = v_bio, private_skills = v_skills, updated_at = pg_catalog.now()
      where user_id = v_owner;
  elsif v_skills is distinct from v_profile.private_skills then
    update public.profiles set private_skills = v_skills, updated_at = pg_catalog.now()
      where user_id = v_owner;
  end if;
  return pg_catalog.jsonb_build_object(
    'user_id', v_owner, 'handle', v_profile.handle, 'display_name', v_display_name,
    'headline', v_headline, 'bio', v_bio, 'private_skills', v_skills);
end;
$$;

revoke all on function public.owner_save_profile_draft(jsonb,jsonb,boolean) from public, anon, service_role;
grant execute on function public.owner_save_profile_draft(jsonb,jsonb,boolean) to authenticated;
