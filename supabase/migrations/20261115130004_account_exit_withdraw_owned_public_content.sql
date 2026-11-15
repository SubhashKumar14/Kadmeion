-- Explicit owner-controlled withdrawal, separate from the destructive step.
-- Authoritative rows are closed in one transaction. Independent HTTP
-- withdrawal and provider retention evidence still gate final erasure.
create function public.owner_withdraw_account_exit_content(
  p_request_id uuid, p_challenge_id uuid, p_operation_id uuid, p_confirmation text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_session uuid;
  v_portfolio uuid;
  v_blocked integer := 0;
  v_reviewer integer;
  v_profile integer;
  v_projects integer;
  v_receipt jsonb;
begin
  v_session:=kadmeion_private.require_live_exit_auth_session();
  if p_request_id is null or p_challenge_id is null or p_operation_id is null
    or p_confirmation is distinct from 'WITHDRAW PUBLIC CONTENT' then
    raise exception using errcode='22023',message='INVALID_EXIT_WITHDRAWAL';
  end if;
  -- Account erasure takes the owner row and then the profile row in this order.
  perform 1 from auth.users where id=v_owner for update;
  if not found then raise exception using errcode='42501',message='ACCOUNT_NOT_FOUND'; end if;
  perform 1 from public.profiles where user_id=v_owner for update;
  perform 1 from public.private_account_erasure_requests
    where id=p_request_id and owner_user_id=v_owner and status='REQUESTED_BLOCKED' for update;
  if not found then
    raise exception using errcode='42501',message='PRIVATE_ERASURE_REQUEST_NOT_FOUND';
  end if;
  perform 1 from public.private_account_exit_reauth_challenges c
    join auth.sessions s on s.id=c.verified_session_id and s.user_id=c.owner_user_id
    where c.id=p_challenge_id and c.owner_user_id=v_owner and c.verified_session_id=v_session
      and c.verified_at is not null and c.expires_at>clock_timestamp()
      and (s.not_after is null or s.not_after>clock_timestamp())
    for update of c;
  if not found then raise exception using errcode='42501',message='ERASURE_REAUTH_REQUIRED'; end if;

  -- Project privacy writers may acquire portfolio locks through triggers.
  -- Match that ordering and reuse the existing generation/block transition.
  perform 1 from public.projects where owner_user_id=v_owner order by id for update;
  perform 1 from public.portfolios where owner_user_id=v_owner order by id for update;
  for v_portfolio in
    select p.portfolio_id from public.private_release_visibility_pointers p
      where p.owner_user_id=v_owner and p.status='PREPARED_PRIVATE'
    order by p.portfolio_id
  loop
    v_receipt:=public.owner_block_private_release_pointer(v_portfolio,p_operation_id);
    if v_receipt->>'status' is distinct from 'BLOCKED' then
      raise exception using errcode='40001',message='EXIT_WITHDRAWAL_OPERATION_STALE';
    end if;
    v_blocked:=v_blocked+1;
  end loop;

  update public.private_reviewer_grants set revoked_at=statement_timestamp()
    where owner_user_id=v_owner and revoked_at is null;
  get diagnostics v_reviewer=row_count;
  delete from kadmeion_private.profile_publications where user_id=v_owner;
  get diagnostics v_profile=row_count;
  delete from kadmeion_private.case_study_publications where owner_user_id=v_owner;
  get diagnostics v_projects=row_count;
  update public.profile_sharing_preferences set publication_requested=false
    where user_id=v_owner and publication_requested;
  update public.project_exposure_intents set show_case_study=false
    where owner_user_id=v_owner and show_case_study;

  return jsonb_build_object('status','APPLICATION_CONTENT_WITHDRAWN',
    'blockedPortfolios',v_blocked,'revokedReviewerGrants',v_reviewer,
    'withdrawnProfiles',v_profile,'withdrawnCaseStudies',v_projects,
    'hostRevocationVerified',false,'erasureExecuted',false);
end;
$$;
revoke all on function public.owner_withdraw_account_exit_content(uuid,uuid,uuid,text)
  from public,anon,service_role;
grant execute on function public.owner_withdraw_account_exit_content(uuid,uuid,uuid,text)
  to authenticated;
