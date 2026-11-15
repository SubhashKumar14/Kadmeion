-- B08 privacy: editing consented source text must not leave an obsolete
-- independently readable profile or case-study publication in circulation.
-- Withdraw the projection in the SAME transaction as the source mutation.
-- A deliberate new publication action is required to restore public access.
-- This migration extends existing private trigger functions and grants no
-- public table reads or new privileged RPCs.

create or replace function kadmeion_private.invalidate_profile_publication()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if tg_op='DELETE' then
    delete from kadmeion_private.profile_publications where user_id=old.user_id;
  elsif tg_table_name='profiles' then
    if old.handle is distinct from new.handle
      or old.display_name is distinct from new.display_name
      or old.headline is distinct from new.headline
      or old.bio is distinct from new.bio then
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

create trigger kd_invalidate_profile_publication_content
  after update of display_name,headline,bio on public.profiles
  for each row execute function kadmeion_private.invalidate_profile_publication();

create or replace function kadmeion_private.withdraw_case_study_projection()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if tg_table_name='projects' then
    if old.slug is distinct from new.slug
      or old.trashed_at is distinct from new.trashed_at
      or old.title is distinct from new.title
      or old.summary is distinct from new.summary
      or old.description is distinct from new.description
      or old.repository_url is distinct from new.repository_url
      or old.live_url is distinct from new.live_url
      or old.case_study is distinct from new.case_study then
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

create trigger kd_invalidate_case_study_publication_content
  after update of title,summary,description,repository_url,live_url,case_study on public.projects
  for each row execute function kadmeion_private.withdraw_case_study_projection();

comment on function kadmeion_private.invalidate_profile_publication() is
  'Withdraws previously consented public profile projection after identity or privacy changes.';
comment on function kadmeion_private.withdraw_case_study_projection() is
  'Withdraws previously consented public case-study projection after source or sharing changes.';
