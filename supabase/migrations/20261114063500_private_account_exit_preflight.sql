-- B5: owner-only advisory account-exit preflight; no public release or deletion.
-- Project's local-only migration. Do not apply to hosted/production Supabase.
-- The count cap is per category; counts are advisory, not a purge proof or atomic export manifest.
create function public.private_account_exit_preflight()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_claims jsonb := (select auth.jwt());
  v_session_raw text;
  v_signed_in_at timestamptz;
  v_projects bigint;
  v_portfolios bigint;
  v_revisions bigint;
  v_exposures bigint;
  v_assets bigint;
  v_frozen bigint;
  v_reviewers bigint;
  v_trash bigint;
  v_requests bigint;
  v_capped boolean;
  v_fresh_candidate boolean;
begin
  if v_owner is null or coalesce(v_claims->>'role','')<>'authenticated'
     or coalesce(v_claims->>'is_anonymous','false') <> 'false' then
    raise exception using errcode='42501',message='AUTH_REQUIRED';
  end if;
  -- A JWT can remain valid after sign-out. Require the exact session to still
  -- exist in GoTrue's server-side registry and belong to the JWT subject.
  v_session_raw := v_claims->>'session_id';
  if v_session_raw is null or v_session_raw !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    raise exception using errcode='42501',message='LIVE_SESSION_REQUIRED';
  end if;
  select s.created_at into v_signed_in_at from auth.sessions s
    where s.id=v_session_raw::uuid and s.user_id=v_owner;
  if not found or v_signed_in_at is null then
    raise exception using errcode='42501',message='LIVE_SESSION_REQUIRED';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id=v_owner) then
    raise exception using errcode='42501',message='OWNER_PROFILE_NOT_FOUND';
  end if;

  -- Explicit owner predicates even inside SECURITY DEFINER. Bounded scans
  -- prevent an unlimited result or expensive unbounded per-user inventory.
  select count(*) into v_projects from
    (select 1 from public.projects where owner_user_id=v_owner limit 1001) t;
  select count(*) into v_portfolios from
    (select 1 from public.portfolios where owner_user_id=v_owner limit 1001) t;
  select count(*) into v_revisions from
    (select 1 from public.portfolio_revisions where owner_user_id=v_owner limit 1001) t;
  select count(*) into v_exposures from
    (select 1 from public.project_exposure_intents where owner_user_id=v_owner limit 1001) t;
  select count(*) into v_assets from
    (select 1 from public.project_assets where owner_user_id=v_owner limit 1001) t;
  select count(*) into v_frozen from
    (select 1 from public.private_release_requests where owner_user_id=v_owner limit 1001) t;
  select count(*) into v_reviewers from
    (select 1 from public.private_reviewer_grants where owner_user_id=v_owner limit 1001) t;
  select count(*) into v_trash from
    (select 1 from public.private_trash_items where owner_user_id=v_owner limit 1001) t;
  select count(*) into v_requests from
    (select 1 from public.private_account_erasure_requests where owner_user_id=v_owner limit 1001) t;

  v_capped := v_projects>1000 or v_portfolios>1000 or v_revisions>1000 or
    v_exposures>1000 or v_assets>1000 or v_frozen>1000 or
    v_reviewers>1000 or v_trash>1000 or v_requests>1000;
  -- Fresh session creation is only a candidate for a subsequent reauth step.
  -- Refreshing an older JWT does not create a fresh server-side login session.
  -- A separate explicit auth challenge must be verified before erasure.
  v_fresh_candidate := v_signed_in_at <= clock_timestamp() and
    v_signed_in_at >= clock_timestamp() - interval '5 minutes';
  return jsonb_build_object(
    'status','INVENTORY_ONLY',
    'maxCountPerCategory',1000,
    'countsCapped',v_capped,
    'counts',jsonb_build_object(
      'projects',least(v_projects,1000),
      'portfolios',least(v_portfolios,1000),
      'portfolioRevisions',least(v_revisions,1000),
      'projectExposureIntents',least(v_exposures,1000),
      'projectAssetMetadata',least(v_assets,1000),
      'frozenReleaseRequests',least(v_frozen,1000),
      'reviewerGrants',least(v_reviewers,1000),
      'trashRecords',least(v_trash,1000),
      'accountExitRequests',least(v_requests,1000)
    ),
    'liveSessionChecked',true,
    'freshSignInCandidate',v_fresh_candidate,
    'recentReauthVerified',false,
    'publicRoutes','UNVERIFIED',
    'objectStorage','METADATA_ONLY',
    'exports','NOT_TRACKED',
    'integrations','NOT_TRACKED',
    'deletionAllowed',false
  );
end;
$$;
revoke all on function public.private_account_exit_preflight()
  from public,anon,authenticated;
grant execute on function public.private_account_exit_preflight()
  to authenticated;
comment on function public.private_account_exit_preflight() is
  'Advisory owner-scoped bounded counts with live GoTrue session check. A fresh sign-in candidate is not verified reauth. No public route/asset/export certainty; no destructive authorization.';
