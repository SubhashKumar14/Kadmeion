-- Principle of least privilege for all exposed Kadmeion tables.
-- Supabase may supply broad default grants even when app migrations later GRANT narrowly.
revoke all on table public.profiles from authenticated;
grant select,insert on table public.profiles to authenticated;
grant update(handle,display_name,headline,bio,onboarding_complete) on table public.profiles to authenticated;

revoke all on table public.profile_sharing_preferences from authenticated;
grant select,insert,update on table public.profile_sharing_preferences to authenticated;

revoke all on table public.projects from authenticated;
grant select,insert on table public.projects to authenticated;

revoke all on table public.project_exposure_intents from authenticated;
grant select,insert,update on table public.project_exposure_intents to authenticated;

revoke all on table public.project_assets from authenticated;
grant select,insert on table public.project_assets to authenticated;
grant update(alt_text) on table public.project_assets to authenticated;

revoke all on table public.portfolios from authenticated;
grant select,insert on table public.portfolios to authenticated;

revoke all on table public.portfolio_revisions from authenticated;
grant select on table public.portfolio_revisions to authenticated;

