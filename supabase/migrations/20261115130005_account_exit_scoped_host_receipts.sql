-- Evidence for application-owned addresses only. No third-party/archive or
-- backup promise is inferred from these fresh HTTP denial observations.
create table kadmeion_private.account_exit_host_receipts (
  request_id uuid primary key references public.private_account_erasure_requests(id) on delete cascade,
  plan_sha256 text not null check (plan_sha256 ~ '^[a-f0-9]{64}$'),
  checked_at timestamptz not null default statement_timestamp()
);
alter table kadmeion_private.account_exit_host_receipts enable row level security;
revoke all on kadmeion_private.account_exit_host_receipts from public,anon,authenticated,service_role;

create function kadmeion_private.account_exit_withdrawal_plan(p_owner uuid)
returns jsonb language sql stable set search_path=''
as $$
  with portfolio_addresses as (
    select distinct i.portfolio_id,i.public_handle as handle,i.public_slug as slug
    from public.private_unlisted_publication_intents i
    where i.owner_user_id=p_owner and i.public_handle is not null and i.public_slug is not null
  ), unlisted_addresses as (
    select distinct i.portfolio_id
    from public.private_unlisted_publication_intents i
    where i.owner_user_id=p_owner and i.public_handle is null
  ), media as (
    select m.portfolio_id,m.manifest_sha256,f.value->>'sha256' as asset
    from kadmeion_private.frozen_media_candidates m
    cross join lateral jsonb_array_elements(m.manifest_json::jsonb->'files')
      with ordinality as f(value,ord)
    where m.owner_user_id=p_owner and f.ord>1
  ), identity as (
    select p.handle from public.profiles p where p.user_id=p_owner and p.handle is not null
  ), addresses(path) as (
    select '/'||a.handle||'/'||a.slug from portfolio_addresses a
    union select '/api/public-portfolio?handle='||a.handle||'&slug='||a.slug from portfolio_addresses a
    union select '/api/public-portfolio?handle='||a.handle||'&slug='||a.slug||
      '&manifest='||m.manifest_sha256||'&asset='||m.asset
      from portfolio_addresses a join media m using(portfolio_id)
    union select '/api/unlisted?portfolioId='||a.portfolio_id from unlisted_addresses a
    union select '/api/unlisted?portfolioId='||a.portfolio_id||
      '&manifest='||m.manifest_sha256||'&asset='||m.asset
      from unlisted_addresses a join media m using(portfolio_id)
    union select '/u/'||i.handle from identity i
    union select '/api/published-identity?handle='||i.handle from identity i
    union select '/u/'||i.handle||'/projects/'||p.slug
      from identity i cross join public.projects p where p.owner_user_id=p_owner
    union select '/api/published-identity?handle='||i.handle||'&slug='||p.slug
      from identity i cross join public.projects p where p.owner_user_id=p_owner
  )
  select jsonb_build_object(
    'paths', (select coalesce(jsonb_agg(a.path order by a.path),'[]'::jsonb) from
      (select path from addresses order by path limit 257) a),
    'pointers', (select coalesce(jsonb_agg(jsonb_build_array(p.portfolio_id,p.generation)
      order by p.portfolio_id),'[]'::jsonb) from public.private_release_visibility_pointers p
      where p.owner_user_id=p_owner),
    'reviewers', (select coalesce(jsonb_agg(jsonb_build_array(g.id,g.revoked_at)
      order by g.id),'[]'::jsonb) from public.private_reviewer_grants g where g.owner_user_id=p_owner))
  where not exists(select 1 from public.private_release_visibility_pointers
        where owner_user_id=p_owner and status<>'BLOCKED')
    and not exists(select 1 from kadmeion_private.unlisted_release_routes
        where owner_user_id=p_owner and status='LIVE')
    and not exists(select 1 from public.private_reviewer_grants
        where owner_user_id=p_owner and revoked_at is null)
    and not exists(select 1 from kadmeion_private.profile_publications where user_id=p_owner)
    and not exists(select 1 from kadmeion_private.case_study_publications where owner_user_id=p_owner)
    and not exists(select 1 from public.profile_sharing_preferences
        where user_id=p_owner and publication_requested)
    and not exists(select 1 from public.project_exposure_intents
        where owner_user_id=p_owner and show_case_study)
$$;
revoke all on function kadmeion_private.account_exit_withdrawal_plan(uuid) from public,anon,authenticated,service_role;

create function public.service_account_exit_withdrawal_plan(p_request_id uuid)
returns jsonb language sql stable security definer set search_path=''
as $$
  select jsonb_build_object('paths',plan.value->'paths',
    'planSha256',encode(sha256(convert_to(plan.value::text,'UTF8')),'hex'))
  from public.private_account_erasure_requests r
  cross join lateral (select kadmeion_private.account_exit_withdrawal_plan(r.owner_user_id) as value) plan
  where r.id=p_request_id and r.status='REQUESTED_BLOCKED'
    and jsonb_array_length(plan.value->'paths')<=256
$$;

create function public.service_record_account_exit_host_denial(
  p_request_id uuid, p_plan_sha256 text, p_checks integer)
returns boolean language plpgsql security definer set search_path=''
as $$
declare
  v_plan jsonb;
begin
  v_plan:=public.service_account_exit_withdrawal_plan(p_request_id);
  if v_plan is null or p_plan_sha256 is distinct from v_plan->>'planSha256'
    or p_checks is distinct from 2*jsonb_array_length(v_plan->'paths') then return false; end if;
  insert into kadmeion_private.account_exit_host_receipts(request_id,plan_sha256,checked_at)
    values(p_request_id,p_plan_sha256,statement_timestamp())
    on conflict(request_id) do update set plan_sha256=excluded.plan_sha256,checked_at=excluded.checked_at;
  return true;
end;
$$;
revoke all on function public.service_account_exit_withdrawal_plan(uuid),
  public.service_record_account_exit_host_denial(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.service_account_exit_withdrawal_plan(uuid),
  public.service_record_account_exit_host_denial(uuid,text,integer) to service_role;

create or replace function kadmeion_private.account_exit_revocation_unverified(p_owner uuid)
returns boolean language sql stable security definer set search_path=''
as $function$
  select (exists(select 1 from public.private_release_requests r
      where r.owner_user_id=p_owner)
     or exists(select 1 from public.private_release_visibility_pointers p
      where p.owner_user_id=p_owner)
     or exists(select 1 from public.private_release_visibility_events e
      where e.owner_user_id=p_owner)
     or exists(select 1 from public.private_reviewer_grants g
      where g.owner_user_id=p_owner)
     or exists(select 1 from public.private_unlisted_publication_intents i
      where i.owner_user_id=p_owner)
     or exists(select 1 from public.verified_unlisted_releases v
      where v.owner_user_id=p_owner)
     or exists(select 1 from kadmeion_private.unlisted_release_routes u
      where u.owner_user_id=p_owner)
     or exists(select 1 from kadmeion_private.profile_publications pp
      where pp.user_id=p_owner)
     or exists(select 1 from kadmeion_private.case_study_publications cs
      where cs.owner_user_id=p_owner)
     or exists(select 1 from public.profile_sharing_preferences sp
      where sp.user_id=p_owner and sp.publication_requested)
     or exists(select 1 from public.project_exposure_intents pe
      where pe.owner_user_id=p_owner and pe.show_case_study))
    and not exists(
      select 1 from public.private_account_erasure_requests request
      join kadmeion_private.account_exit_host_receipts receipt on receipt.request_id=request.id
      where request.owner_user_id=p_owner and request.status='REQUESTED_BLOCKED'
        and receipt.checked_at>statement_timestamp()-interval '30 minutes'
        and receipt.plan_sha256=encode(sha256(convert_to(
          kadmeion_private.account_exit_withdrawal_plan(p_owner)::text,'UTF8')),'hex')
    )
$function$;
revoke all on function kadmeion_private.account_exit_revocation_unverified(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.owner_execute_account_erasure(
  p_request_id uuid,p_challenge_id uuid,p_confirmation text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_owner uuid := (select auth.uid());
  v_session uuid;
  v_receipt uuid;
begin
  v_session:=kadmeion_private.require_live_exit_auth_session();
  if not exists(select 1 from auth.sessions where id=v_session and user_id=v_owner
      and (not_after is null or not_after>clock_timestamp())) then
    raise exception using errcode='42501',message='LIVE_SESSION_REQUIRED';
  end if;
  if p_request_id is null or p_challenge_id is null
    or p_confirmation is distinct from 'DELETE MY ACCOUNT' then
    raise exception using errcode='22023',message='INVALID_ERASURE_EXECUTION';
  end if;
  perform 1 from auth.users where id=v_owner for update;
  if not found then
    raise exception using errcode='42501',message='ACCOUNT_NOT_FOUND';
  end if;
  perform 1 from public.profiles where user_id=v_owner for update;
  perform 1 from public.private_account_erasure_requests
    where id=p_request_id and owner_user_id=v_owner and status='REQUESTED_BLOCKED' for update;
  if not found then
    raise exception using errcode='42501',message='PRIVATE_ERASURE_REQUEST_NOT_FOUND';
  end if;
  perform 1 from public.private_account_exit_reauth_challenges
    where id=p_challenge_id and owner_user_id=v_owner and verified_session_id=v_session
      and verified_at is not null and expires_at>clock_timestamp() for update;
  if not found then
    raise exception using errcode='42501',message='ERASURE_REAUTH_REQUIRED';
  end if;
  perform 1 from public.projects where owner_user_id=v_owner order by id for update;
  perform 1 from public.portfolios where owner_user_id=v_owner order by id for update;
  if kadmeion_private.account_exit_revocation_unverified(v_owner) then
    raise exception using errcode='55000',message='ERASURE_PUBLIC_REVOCATION_UNVERIFIED';
  end if;
  if exists(select 1 from storage.objects
      where owner_id=v_owner::text or owner=v_owner
        or (bucket_id='kadmeion-private-assets' and split_part(name,'/',1)=v_owner::text)) then
    raise exception using errcode='55000',message='ERASURE_STORAGE_CLEANUP_REQUIRED';
  end if;
  delete from auth.users where id=v_owner;
  if not found then
    raise exception using errcode='42501',message='ACCOUNT_NOT_FOUND';
  end if;
  v_receipt:=gen_random_uuid();
  insert into kadmeion_private.account_erasure_receipts(receipt_id) values(v_receipt);
  return jsonb_build_object('status','ACTIVE_ACCOUNT_ERASED','receiptId',v_receipt,
    'accessTerminated',true,'backupErasureVerified',false,'externalCopiesErased',false);
end;
$function$;
revoke all on function public.owner_execute_account_erasure(uuid,uuid,text)
  from public,anon,service_role;
grant execute on function public.owner_execute_account_erasure(uuid,uuid,text)
  to authenticated;

comment on function public.owner_execute_account_erasure(uuid,uuid,text) is
'Deletes an owner only after live reauth, no remaining Storage and no recorded public/reviewer-release exposure. Historical caches and external copies remain unverified.';
