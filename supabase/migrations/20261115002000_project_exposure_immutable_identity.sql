-- Preserve identity of a project visibility record. UPDATE grants were
-- originally whole-table, permitting a signed-in owner to repoint a record to
-- a different owned project. That could leave old published projections
-- reusable without a fresh explicit case-study publication.
-- Future owner changes to project ID or owner require a separately audited
-- flow; ordinary preference toggles remain supported.
revoke update on public.project_exposure_intents from authenticated;
grant update(show_on_profile,show_case_study,requested_at)
  on public.project_exposure_intents to authenticated;

create function kadmeion_private.reject_project_exposure_identity_change()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if old.project_id is distinct from new.project_id
     or old.owner_user_id is distinct from new.owner_user_id then
    raise exception using errcode='42501',message='PROJECT_EXPOSURE_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$function$;
revoke all on function kadmeion_private.reject_project_exposure_identity_change()
  from PUBLIC,anon,authenticated,service_role;
create trigger kd_project_exposure_identity_immutable
  before update of project_id,owner_user_id on public.project_exposure_intents
  for each row execute function
    kadmeion_private.reject_project_exposure_identity_change();
