-- B4 conditional, scriptless UNLISTED publication backend.
-- This migration is BRANCH-ONLY. No hosted DB changes; no public serving is
-- enabled until explicitly approved host code and verification are connected.
-- This text-only initial release is not the approved multi-template renderer.
create table public.private_unlisted_publication_intents (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  owner_user_id uuid not null,
  request_id uuid not null,
  operation_id uuid not null,
  rollback_target_id uuid references public.private_unlisted_publication_intents(id) on delete cascade,
  public_handle text,
  public_slug text,
  check ((public_handle is null) = (public_slug is null)),
  rollback_from_id uuid references public.private_unlisted_publication_intents(id) on delete cascade,
  check ((rollback_target_id is null) = (rollback_from_id is null)),
  expected_pointer_generation bigint not null check(expected_pointer_generation>=1),
  status text not null default 'AWAITING_HOST' check(status in ('AWAITING_HOST','USED')),
  created_at timestamptz not null default transaction_timestamp(),
  expires_at timestamptz not null default (transaction_timestamp()+interval '10 minutes'),
  unique(owner_user_id,operation_id),
  foreign key (request_id,portfolio_id,owner_user_id)
    references public.private_release_requests(id,portfolio_id,owner_user_id)
    on delete cascade,
  check(expires_at>created_at)
);
alter table public.private_unlisted_publication_intents enable row level security;
revoke all on public.private_unlisted_publication_intents from public,anon,authenticated;
grant select (id,portfolio_id,request_id,status,created_at,expires_at)
  on public.private_unlisted_publication_intents to authenticated;
create policy kd_owner_unlisted_intents on public.private_unlisted_publication_intents
  for select to authenticated using ((select auth.uid())=owner_user_id);

create table kadmeion_private.unlisted_release_routes (
  portfolio_id uuid primary key,
  owner_user_id uuid not null,
  request_id uuid not null,
  intent_id uuid not null,
  stage_generation bigint not null,
  release_generation bigint not null check(release_generation>=1),
  status text not null check(status in ('LIVE','REVOKED')),
  verified_at timestamptz,
  html_sha256 text not null check(html_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default transaction_timestamp(),
  foreign key (portfolio_id,owner_user_id)
    references public.portfolios(id,owner_user_id) on delete cascade,
  foreign key (request_id,portfolio_id,owner_user_id)
    references public.private_release_requests(id,portfolio_id,owner_user_id)
    on delete cascade,
  foreign key (intent_id) references public.private_unlisted_publication_intents(id)
    on delete cascade
);
alter table kadmeion_private.unlisted_release_routes enable row level security;
revoke all on kadmeion_private.unlisted_release_routes from public,anon,authenticated;
comment on table kadmeion_private.unlisted_release_routes is
  'Service-only noindex UNLISTED text-only releases. Public URLs are not currently hosted or proved. Direct immutable asset serving is forbidden.';

-- Verified releases form an owner-readable timeline. HTML remains private.
create table public.verified_unlisted_releases (
  intent_id uuid primary key references public.private_unlisted_publication_intents(id) on delete cascade,
  portfolio_id uuid not null,
  owner_user_id uuid not null,
  request_id uuid not null,
  stage_generation bigint not null,
  html_sha256 text not null check(html_sha256 ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz not null,
  foreign key (request_id,portfolio_id,owner_user_id)
    references public.private_release_requests(id,portfolio_id,owner_user_id) on delete cascade
);
create index kd_verified_unlisted_timeline on public.verified_unlisted_releases
  (portfolio_id,verified_at desc,intent_id);
alter table public.verified_unlisted_releases enable row level security;
revoke all on public.verified_unlisted_releases from public,anon,authenticated,service_role;
grant select (intent_id,portfolio_id,request_id,verified_at) on public.verified_unlisted_releases to authenticated;
create policy kd_owner_verified_unlisted_releases on public.verified_unlisted_releases
  for select to authenticated using ((select auth.uid())=owner_user_id);

-- One prior live target for compensating a failed host check. Keep the
-- release bytes in their original immutable staging row.
create table kadmeion_private.unlisted_release_fallbacks (
  portfolio_id uuid primary key references public.portfolios(id) on delete cascade,
  replacement_intent_id uuid not null references public.private_unlisted_publication_intents(id)
    on delete cascade,
  previous_intent_id uuid not null references public.private_unlisted_publication_intents(id)
    on delete cascade,
  previous_generation bigint not null check(previous_generation>=1),
  previous_stage_generation bigint not null,
  previous_verified_at timestamptz not null,
  previous_html_sha256 text not null check(previous_html_sha256 ~ '^[0-9a-f]{64}$'),
  foreign key(portfolio_id,previous_stage_generation)
    references kadmeion_private.private_reviewer_stage_artifacts(portfolio_id,pointer_generation)
    on delete cascade
);
alter table kadmeion_private.unlisted_release_fallbacks enable row level security;
revoke all on kadmeion_private.unlisted_release_fallbacks
  from public,anon,authenticated,service_role;

-- Preparing a replacement must NOT interrupt the previous working LIVE
-- release. A separate pending slot is atomically promoted after host proof.
create table kadmeion_private.unlisted_release_pending (
  portfolio_id uuid primary key,
  owner_user_id uuid not null,
  request_id uuid not null,
  intent_id uuid not null,
  stage_generation bigint not null check(stage_generation>=1),
  release_generation bigint not null check(release_generation>=1),
  html_sha256 text not null check(html_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default transaction_timestamp(),
  foreign key (portfolio_id,owner_user_id)
    references public.portfolios(id,owner_user_id) on delete cascade,
  foreign key (request_id,portfolio_id,owner_user_id)
    references public.private_release_requests(id,portfolio_id,owner_user_id)
    on delete cascade,
  foreign key (intent_id) references public.private_unlisted_publication_intents(id)
    on delete cascade
);
alter table kadmeion_private.unlisted_release_pending enable row level security;
revoke all on kadmeion_private.unlisted_release_pending
  from public,anon,authenticated;

create function public.owner_request_unlisted_publication(
  p_request_id uuid,p_expected_generation bigint,p_operation_id uuid,p_confirmation text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_owner uuid := (select auth.uid());
  v_session uuid;
  v_source record;
  v_pointer public.private_release_visibility_pointers%rowtype;
  v_intent public.private_unlisted_publication_intents%rowtype;
  v_id uuid;
  v_public_handle text;
  v_public_slug text;
begin
  v_session:=kadmeion_private.require_live_exit_auth_session();
  if p_request_id is null or p_operation_id is null or
     p_expected_generation is null or p_expected_generation<1 or
     p_confirmation is null or p_confirmation not in ('PUBLISH UNLISTED','PUBLISH PUBLIC') then
    raise exception using errcode='22023',message='INVALID_UNLISTED_CONSENT';end if;
  select r.portfolio_id,r.owner_user_id,r.visibility_intent,r.status,p.trashed_at
    into v_source from public.private_release_requests r
    join public.portfolios p on p.id=r.portfolio_id and p.owner_user_id=r.owner_user_id
    where r.id=p_request_id and r.owner_user_id=v_owner for update of p;
  if not found or v_source.status<>'FROZEN' or
     p_confirmation is distinct from ('PUBLISH ' || v_source.visibility_intent) or v_source.trashed_at is not null
  then raise exception using errcode='42501',message='UNLISTED_SOURCE_UNAVAILABLE';end if;
  if exists(select 1 from kadmeion_private.moderation_portfolio_holds
     where portfolio_id=v_source.portfolio_id) then
    raise exception using errcode='42501',message='MODERATION_HOLD_ACTIVE';end if;
  select * into v_intent from public.private_unlisted_publication_intents
    where owner_user_id=v_owner and operation_id=p_operation_id for update;
  if found then
    if v_intent.request_id<>p_request_id or
       v_intent.expected_pointer_generation<>p_expected_generation or v_intent.rollback_target_id is not null then
      raise exception using errcode='23505',message='UNLISTED_OPERATION_REUSED';end if;
    return jsonb_build_object('intentId',v_intent.id,'status',v_intent.status,
      'alreadyRecorded',true,'publicServingEnabled',false,'publicUrl',null);
  end if;
  select * into v_pointer from public.private_release_visibility_pointers
    where portfolio_id=v_source.portfolio_id and owner_user_id=v_owner for update;
  if not found or v_pointer.status<>'PREPARED_PRIVATE' or
     v_pointer.generation<>p_expected_generation or
     v_pointer.candidate_request_id<>p_request_id then
    raise exception using errcode='40001',message='UNLISTED_POINTER_CONFLICT';end if;
  perform 1 from kadmeion_private.private_reviewer_stage_artifacts
    where portfolio_id=v_source.portfolio_id
      and request_id=p_request_id and pointer_generation=p_expected_generation;
  if not found then
    raise exception using errcode='42501',message='STAGED_ARTIFACT_REQUIRED';end if;
  if (select count(*) from public.private_unlisted_publication_intents
      where owner_user_id=v_owner and created_at>transaction_timestamp()-interval '24 hours')>=20 then
    raise exception using errcode='54000',message='UNLISTED_INTENT_QUOTA_REACHED';end if;
  if v_source.visibility_intent='PUBLIC' then
    select profile.handle,portfolio.slug into v_public_handle,v_public_slug
      from public.profiles profile join public.portfolios portfolio
        on portfolio.owner_user_id=profile.user_id
      where profile.user_id=v_owner and portfolio.id=v_source.portfolio_id for share of profile;
    if v_public_handle is null or v_public_handle in (
      'admin','api','app','auth','dashboard','edit','explore','help','login','logout',
      'new','profile','projects','settings','signin','signup','status','support','templates','workspace'
    ) then
      raise exception using errcode='42501',message='PROFILE_HANDLE_REQUIRED';
    end if;
  end if;
  insert into public.private_unlisted_publication_intents(
    portfolio_id,owner_user_id,request_id,operation_id,expected_pointer_generation,public_handle,public_slug
  ) values(v_source.portfolio_id,v_owner,p_request_id,p_operation_id,
    p_expected_generation,v_public_handle,v_public_slug) returning id into v_id;
  return jsonb_build_object('intentId',v_id,'status','AWAITING_HOST',
    'alreadyRecorded',false,'publicServingEnabled',false,'publicUrl',null);
end;
$function$;
revoke all on function public.owner_request_unlisted_publication(uuid,bigint,uuid,text)
  from public,anon;
grant execute on function public.owner_request_unlisted_publication(uuid,bigint,uuid,text)
  to authenticated;

create function public.owner_request_unlisted_rollback(
  p_target_intent_id uuid,p_current_intent_id uuid,p_expected_generation bigint,
  p_operation_id uuid,p_confirmation text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_owner uuid := (select auth.uid());
  v_target public.verified_unlisted_releases%rowtype;
  v_intent public.private_unlisted_publication_intents%rowtype;
begin
  perform kadmeion_private.require_live_exit_auth_session();
  if p_target_intent_id is null or p_current_intent_id is null or p_operation_id is null
    or p_target_intent_id=p_current_intent_id or p_expected_generation is null
    or p_expected_generation<1 or p_confirmation is distinct from 'ROLL BACK UNLISTED' then
    raise exception using errcode='22023',message='INVALID_UNLISTED_ROLLBACK';
  end if;
  select * into v_target from public.verified_unlisted_releases
    where intent_id=p_target_intent_id and owner_user_id=v_owner
      and exists(select 1 from public.private_release_requests request
        where request.id=verified_unlisted_releases.request_id and request.visibility_intent='UNLISTED');
  if not found then
    raise exception using errcode='42501',message='UNLISTED_SOURCE_UNAVAILABLE';
  end if;
  perform 1 from public.portfolios where id=v_target.portfolio_id and owner_user_id=v_owner
    and trashed_at is null for update;
  if not found or exists(select 1 from kadmeion_private.moderation_portfolio_holds
    where portfolio_id=v_target.portfolio_id) then
    raise exception using errcode='42501',message='UNLISTED_PORTFOLIO_BLOCKED';
  end if;
  select * into v_intent from public.private_unlisted_publication_intents
    where owner_user_id=v_owner and operation_id=p_operation_id;
  if found then
    if v_intent.rollback_target_id is distinct from p_target_intent_id
      or v_intent.rollback_from_id is distinct from p_current_intent_id
      or v_intent.expected_pointer_generation<>p_expected_generation then
      raise exception using errcode='23505',message='UNLISTED_OPERATION_REUSED';
    end if;
    return jsonb_build_object('intentId',v_intent.id,'status',v_intent.status,
      'alreadyRecorded',true,'publicServingEnabled',false,'publicUrl',null);
  end if;
  perform 1 from public.private_release_visibility_pointers pointer
    join kadmeion_private.unlisted_release_routes route using(portfolio_id)
    where pointer.portfolio_id=v_target.portfolio_id and pointer.status='PREPARED_PRIVATE'
      and pointer.generation=p_expected_generation
      and v_target.stage_generation>pointer.revocation_generation
      and route.intent_id=p_current_intent_id and route.status='LIVE'
      and route.verified_at is not null;
  if not found then
    raise exception using errcode='40001',message='UNLISTED_POINTER_CONFLICT';
  end if;
  if (select count(*) from public.private_unlisted_publication_intents
    where owner_user_id=v_owner and created_at>transaction_timestamp()-interval '24 hours')>=20 then
    raise exception using errcode='54000',message='UNLISTED_INTENT_QUOTA_REACHED';
  end if;
  insert into public.private_unlisted_publication_intents(
    portfolio_id,owner_user_id,request_id,operation_id,expected_pointer_generation,
    rollback_target_id,rollback_from_id
  ) values(v_target.portfolio_id,v_owner,v_target.request_id,p_operation_id,
    p_expected_generation,p_target_intent_id,p_current_intent_id) returning * into v_intent;
  return jsonb_build_object('intentId',v_intent.id,'status',v_intent.status,
    'alreadyRecorded',false,'publicServingEnabled',false,'publicUrl',null);
end;
$function$;
revoke all on function public.owner_request_unlisted_rollback(uuid,uuid,bigint,uuid,text)
  from public,anon,service_role;
grant execute on function public.owner_request_unlisted_rollback(uuid,uuid,bigint,uuid,text)
  to authenticated;

-- The trusted host must independently verify the release route and privacy
-- behavior. This function only makes the PRIVATE candidate probeable via a
-- privileged read, never directly public.
create function public.service_prepare_unlisted_release(p_intent_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_intent public.private_unlisted_publication_intents%rowtype;
  v_pointer public.private_release_visibility_pointers%rowtype;
  v_stage kadmeion_private.private_reviewer_stage_artifacts%rowtype;
  v_target public.verified_unlisted_releases%rowtype;
begin
  if p_intent_id is null then
    raise exception using errcode='22023',message='INVALID_UNLISTED_INTENT';end if;
  select * into v_intent from public.private_unlisted_publication_intents
    where id=p_intent_id;
  if not found then raise exception using errcode='42501',message='UNLISTED_INTENT_NOT_FOUND';end if;
  perform 1 from public.portfolios where id=v_intent.portfolio_id
    and owner_user_id=v_intent.owner_user_id and trashed_at is null for update;
  if not found or exists(select 1 from kadmeion_private.moderation_portfolio_holds
    where portfolio_id=v_intent.portfolio_id) then
    raise exception using errcode='42501',message='UNLISTED_PORTFOLIO_BLOCKED';end if;
  select * into v_intent from public.private_unlisted_publication_intents
    where id=p_intent_id for update;
  select * into v_pointer from public.private_release_visibility_pointers
    where portfolio_id=v_intent.portfolio_id for update;
  if exists(select 1 from kadmeion_private.unlisted_release_routes
    where portfolio_id=v_intent.portfolio_id and intent_id=p_intent_id and status='LIVE') then
    return (select jsonb_build_object('portfolioId',route.portfolio_id,
      'releaseGeneration',route.release_generation,
      'status',case when route.verified_at is null then 'AWAITING_VERIFICATION' else 'ACKNOWLEDGED' end,
      'htmlSha256',route.html_sha256,'publicServingEnabled',false,'publicUrl',null,
      'publicHandle',v_intent.public_handle,'publicSlug',v_intent.public_slug)
      from kadmeion_private.unlisted_release_routes route
      where route.portfolio_id=v_intent.portfolio_id and route.intent_id=p_intent_id);
  end if;
  if v_intent.expires_at<=clock_timestamp()
    or not found or v_pointer.status<>'PREPARED_PRIVATE'
    or v_pointer.generation<>v_intent.expected_pointer_generation
    or (v_intent.rollback_target_id is null and v_pointer.candidate_request_id<>v_intent.request_id) then
    raise exception using errcode='40001',message='UNLISTED_PREPARE_CONFLICT';end if;
  if v_intent.rollback_target_id is not null then
    select * into v_target from public.verified_unlisted_releases
      where intent_id=v_intent.rollback_target_id and portfolio_id=v_intent.portfolio_id
        and stage_generation>v_pointer.revocation_generation
        and exists(select 1 from public.private_release_requests request
          where request.id=verified_unlisted_releases.request_id and request.visibility_intent='UNLISTED');
    if not found or not exists(select 1 from kadmeion_private.unlisted_release_routes
      where portfolio_id=v_intent.portfolio_id and intent_id=v_intent.rollback_from_id
        and status='LIVE' and verified_at is not null) then
      raise exception using errcode='40001',message='UNLISTED_PREPARE_CONFLICT';
    end if;
  end if;
  select * into v_stage from kadmeion_private.private_reviewer_stage_artifacts
    where portfolio_id=v_intent.portfolio_id
      and pointer_generation=coalesce(v_target.stage_generation,v_intent.expected_pointer_generation)
      and request_id=v_intent.request_id;
  if not found or (v_target.intent_id is not null and v_target.html_sha256<>v_stage.html_sha256) or
    encode(sha256(convert_to(v_stage.html,'UTF8')),'hex')<>v_stage.html_sha256 then
    raise exception using errcode='22023',message='UNLISTED_ARTIFACT_INVALID';end if;
  -- The pointer generation advances for every candidate, including one that
  -- never goes live. A replacement with identical HTML must invalidate a
  -- delayed activation from the previous probe.
  if v_intent.status='USED' then
    perform 1 from kadmeion_private.unlisted_release_pending
      where portfolio_id=v_intent.portfolio_id and intent_id=p_intent_id
        and html_sha256=v_stage.html_sha256;
    if not found then
      raise exception using errcode='40001',message='UNLISTED_PREPARE_CONFLICT';
    end if;
  else
    insert into kadmeion_private.unlisted_release_pending(
      portfolio_id,owner_user_id,request_id,intent_id,stage_generation,
      release_generation,html_sha256,expires_at
    ) values(v_intent.portfolio_id,v_intent.owner_user_id,v_intent.request_id,
      v_intent.id,v_stage.pointer_generation,
      v_intent.expected_pointer_generation,
      v_stage.html_sha256,v_intent.expires_at)
    on conflict(portfolio_id) do update set
      owner_user_id=excluded.owner_user_id,request_id=excluded.request_id,
      intent_id=excluded.intent_id,stage_generation=excluded.stage_generation,
      release_generation=excluded.release_generation,
      html_sha256=excluded.html_sha256,expires_at=excluded.expires_at,
      created_at=transaction_timestamp();
    update public.private_unlisted_publication_intents set status='USED'
      where id=p_intent_id;
  end if;
  return jsonb_build_object('portfolioId',v_intent.portfolio_id,
    'releaseGeneration',v_intent.expected_pointer_generation,'status','PROBE_PENDING',
    'htmlSha256',v_stage.html_sha256,'publicServingEnabled',false,
    'publicUrl',null,'publicHandle',v_intent.public_handle,'publicSlug',v_intent.public_slug);
end;
$function$;
revoke all on function public.service_prepare_unlisted_release(uuid)
  from public,anon,authenticated;
grant execute on function public.service_prepare_unlisted_release(uuid) to service_role;

create function public.service_probe_unlisted_release(p_portfolio_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_found record;
begin
  if p_portfolio_id is null then return null;end if;
  select s.html,s.html_sha256,r.release_generation,r.intent_id
    into v_found from kadmeion_private.unlisted_release_pending r
    join public.portfolios p on p.id=r.portfolio_id
    join public.private_unlisted_publication_intents intent on intent.id=r.intent_id
    join public.private_release_visibility_pointers v on v.portfolio_id=r.portfolio_id
    join kadmeion_private.private_reviewer_stage_artifacts s
      on s.portfolio_id=r.portfolio_id and s.pointer_generation=r.stage_generation
      and s.request_id=r.request_id and s.owner_user_id=r.owner_user_id
      and s.html_sha256=r.html_sha256
    where r.portfolio_id=p_portfolio_id and r.expires_at>clock_timestamp()
      and p.trashed_at is null and v.status='PREPARED_PRIVATE'
      and v.generation=r.release_generation
      and r.stage_generation>v.revocation_generation
      and (case when intent.rollback_target_id is null then v.candidate_request_id=r.request_id
        else exists(select 1 from kadmeion_private.unlisted_release_routes
          where portfolio_id=r.portfolio_id and intent_id=intent.rollback_from_id
            and status='LIVE' and verified_at is not null) end)
      and not exists(select 1 from kadmeion_private.moderation_portfolio_holds h
        where h.portfolio_id=r.portfolio_id);
  if not found or
    encode(sha256(convert_to(v_found.html,'UTF8')),'hex')<>v_found.html_sha256
    then return null;end if;
  return jsonb_build_object('status','PROBE_PENDING',
    'releaseGeneration',v_found.release_generation,'intentId',v_found.intent_id,
    'html',v_found.html,
    'htmlSha256',v_found.html_sha256,'publicServingEnabled',false);
end;
$function$;
revoke all on function public.service_probe_unlisted_release(uuid)
  from public,anon,authenticated;
grant execute on function public.service_probe_unlisted_release(uuid) to service_role;

-- Service-only transition after trusted host checks. The RPC cannot prove
-- that a remote CDN/route accepted those bytes; the host must additionally
-- probe canonical HTML and direct-asset denial and acknowledge the result.
create function public.service_activate_unlisted_release(
  p_portfolio_id uuid,p_expected_generation bigint,p_intent_id uuid,p_html_sha256 text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_pending kadmeion_private.unlisted_release_pending%rowtype;
  v_pointer public.private_release_visibility_pointers%rowtype;
  v_stage kadmeion_private.private_reviewer_stage_artifacts%rowtype;
  v_rollback_from uuid;
begin
  if p_portfolio_id is null or p_expected_generation is null or
    p_intent_id is null or p_html_sha256 is null or p_html_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='INVALID_UNLISTED_ACTIVATION';end if;
  perform 1 from public.portfolios
    where id=p_portfolio_id and trashed_at is null for update;
  if not found or exists(select 1 from kadmeion_private.moderation_portfolio_holds
      where portfolio_id=p_portfolio_id) then
    raise exception using errcode='42501',message='UNLISTED_PORTFOLIO_BLOCKED';end if;
  select * into v_pending from kadmeion_private.unlisted_release_pending
    where portfolio_id=p_portfolio_id for update;
  if not found then
    raise exception using errcode='40001',message='UNLISTED_ACTIVATION_CONFLICT';end if;
  select rollback_from_id into v_rollback_from from public.private_unlisted_publication_intents
    where id=v_pending.intent_id;
  select * into v_pointer from public.private_release_visibility_pointers
    where portfolio_id=p_portfolio_id for update;
  if not found or v_pending.expires_at<=clock_timestamp() or
    v_pending.intent_id<>p_intent_id or
    v_pending.release_generation<>p_expected_generation or
    v_pending.html_sha256<>p_html_sha256 or
    v_pointer.status<>'PREPARED_PRIVATE' or
    v_pointer.generation<>v_pending.release_generation or
    v_pending.stage_generation<=v_pointer.revocation_generation or
    (case when v_rollback_from is null then v_pointer.candidate_request_id<>v_pending.request_id
      else not exists(select 1 from kadmeion_private.unlisted_release_routes
        where portfolio_id=p_portfolio_id and intent_id=v_rollback_from
          and status='LIVE' and verified_at is not null) end) then
    raise exception using errcode='40001',message='UNLISTED_ACTIVATION_CONFLICT';end if;
  select * into v_stage from kadmeion_private.private_reviewer_stage_artifacts
    where portfolio_id=p_portfolio_id
      and pointer_generation=v_pending.stage_generation
      and request_id=v_pending.request_id;
  if not found or v_stage.html_sha256<>p_html_sha256 or
     encode(sha256(convert_to(v_stage.html,'UTF8')),'hex')<>p_html_sha256 then
    raise exception using errcode='22023',message='UNLISTED_ACTIVATION_DIGEST_MISMATCH';end if;
  if exists(select 1 from kadmeion_private.unlisted_release_routes
    where portfolio_id=p_portfolio_id and status='LIVE' and verified_at is null) then
    raise exception using errcode='40001',message='UNLISTED_VERIFICATION_PENDING';
  end if;
  delete from kadmeion_private.unlisted_release_fallbacks where portfolio_id=p_portfolio_id;
  insert into kadmeion_private.unlisted_release_fallbacks(
    portfolio_id,replacement_intent_id,previous_intent_id,previous_generation,
    previous_stage_generation,previous_verified_at,previous_html_sha256
  )
  select portfolio_id,v_pending.intent_id,intent_id,release_generation,stage_generation,verified_at,html_sha256
    from kadmeion_private.unlisted_release_routes
    where portfolio_id=p_portfolio_id and status='LIVE';

  insert into kadmeion_private.unlisted_release_routes(
    portfolio_id,owner_user_id,request_id,intent_id,stage_generation,
    release_generation,status,html_sha256
  ) values(v_pending.portfolio_id,v_pending.owner_user_id,
    v_pending.request_id,v_pending.intent_id,v_pending.stage_generation,
    v_pending.release_generation,'LIVE',p_html_sha256)
  on conflict(portfolio_id) do update set
    owner_user_id=excluded.owner_user_id,request_id=excluded.request_id,
    intent_id=excluded.intent_id,stage_generation=excluded.stage_generation,
    release_generation=excluded.release_generation,status='LIVE',verified_at=null,
    html_sha256=excluded.html_sha256,updated_at=transaction_timestamp();
  delete from kadmeion_private.unlisted_release_pending
    where portfolio_id=p_portfolio_id;
  return jsonb_build_object('status','ACTIVATED_NEEDS_EXTERNAL_HTTP_VERIFICATION',
    'portfolioId',p_portfolio_id,'releaseGeneration',p_expected_generation,
    'htmlSha256',p_html_sha256,'hostRevocationVerified',false,
    'publicUrl',null);
end;
$function$;
revoke all on function public.service_activate_unlisted_release(uuid,bigint,uuid,text)
  from public,anon,authenticated;
grant execute on function public.service_activate_unlisted_release(uuid,bigint,uuid,text)
  to service_role;

create function public.service_read_unlisted_release(p_portfolio_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_html record;
begin
  if p_portfolio_id is null then return null;end if;
  select s.html,s.html_sha256
    into v_html from kadmeion_private.unlisted_release_routes r
    join public.portfolios p on p.id=r.portfolio_id
    join public.private_release_requests fr on fr.id=r.request_id
      and fr.portfolio_id=r.portfolio_id and fr.owner_user_id=r.owner_user_id
    join public.private_release_visibility_pointers v on v.portfolio_id=r.portfolio_id
    join kadmeion_private.private_reviewer_stage_artifacts s
      on s.portfolio_id=r.portfolio_id and s.pointer_generation=r.stage_generation
      and s.request_id=r.request_id and s.owner_user_id=r.owner_user_id
      and s.html_sha256=r.html_sha256
    where r.portfolio_id=p_portfolio_id and r.status='LIVE'
      and fr.visibility_intent='UNLISTED' and fr.status='FROZEN'
      and p.trashed_at is null and v.status='PREPARED_PRIVATE'
      and not exists(select 1 from kadmeion_private.moderation_portfolio_holds h
        where h.portfolio_id=r.portfolio_id);
  if not found or octet_length(v_html.html)>750000 or
    encode(sha256(convert_to(v_html.html,'UTF8')),'hex')<>v_html.html_sha256
  then return null;end if;
  return jsonb_build_object('status','UNLISTED_SCRIPTLESS_HTML','html',v_html.html,
    'htmlSha256',v_html.html_sha256,'indexable',false,
    'publicPublishingProven',false);
end;
$function$;
revoke all on function public.service_read_unlisted_release(uuid)
  from public,anon,authenticated;
grant execute on function public.service_read_unlisted_release(uuid) to service_role;

create function public.service_read_public_portfolio(p_handle text,p_slug text)
returns jsonb language sql stable security definer set search_path=''
as $function$
  select jsonb_build_object('html',stage.html,'htmlSha256',stage.html_sha256)
  from kadmeion_private.unlisted_release_routes route
  join public.portfolios portfolio on portfolio.id=route.portfolio_id
    and portfolio.owner_user_id=route.owner_user_id
  join public.profiles profile on profile.user_id=route.owner_user_id
  join public.private_unlisted_publication_intents intent on intent.id=route.intent_id
    and intent.public_handle=profile.handle and intent.public_slug=portfolio.slug
  join public.private_release_requests request on request.id=route.request_id
    and request.portfolio_id=route.portfolio_id and request.owner_user_id=route.owner_user_id
  join public.private_release_visibility_pointers pointer on pointer.portfolio_id=route.portfolio_id
  join kadmeion_private.private_reviewer_stage_artifacts stage on stage.portfolio_id=route.portfolio_id
    and stage.pointer_generation=route.stage_generation and stage.request_id=route.request_id
    and stage.html_sha256=route.html_sha256
  where profile.handle=p_handle and portfolio.slug=p_slug and portfolio.trashed_at is null
    and route.status='LIVE' and request.visibility_intent='PUBLIC' and request.status='FROZEN'
    and pointer.status='PREPARED_PRIVATE' and route.stage_generation>pointer.revocation_generation
    and not exists(select 1 from kadmeion_private.moderation_portfolio_holds hold
      where hold.portfolio_id=route.portfolio_id)
    and stage.html_sha256=encode(sha256(convert_to(stage.html,'UTF8')),'hex')
$function$;
revoke all on function public.service_read_public_portfolio(text,text) from public,anon,authenticated;
grant execute on function public.service_read_public_portfolio(text,text) to service_role;

-- A rename invalidates consent even if the owner later reuses the old route.
create function kadmeion_private.invalidate_public_portfolio_address()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if tg_table_name='profiles' then
    if old.handle is distinct from new.handle then
      update public.private_unlisted_publication_intents set public_handle=null,public_slug=null
        where owner_user_id=old.user_id and public_handle is not null;
    end if;
  elsif old.slug is distinct from new.slug then
    update public.private_unlisted_publication_intents set public_handle=null,public_slug=null
      where portfolio_id=old.id and public_slug is not null;
  end if;
  return null;
end;
$function$;
revoke all on function kadmeion_private.invalidate_public_portfolio_address()
  from public,anon,authenticated,service_role;
create trigger kd_invalidate_public_portfolio_handle after update of handle on public.profiles
  for each row execute function kadmeion_private.invalidate_public_portfolio_address();
create trigger kd_invalidate_public_portfolio_slug after update of slug on public.portfolios
  for each row execute function kadmeion_private.invalidate_public_portfolio_address();

-- Called only after the host has fetched the active route and checked the
-- delivered bytes. This records the worker's acknowledgment, not CDN proof.
create function public.service_acknowledge_unlisted_release(
  p_portfolio_id uuid,p_intent_id uuid,p_html_sha256 text
) returns boolean language plpgsql security definer set search_path=''
as $function$
begin
  if p_portfolio_id is null or p_intent_id is null or p_html_sha256 is null
    or p_html_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='INVALID_UNLISTED_ACKNOWLEDGMENT';
  end if;
  perform 1 from public.portfolios where id=p_portfolio_id and trashed_at is null for update;
  if not found or exists(select 1 from kadmeion_private.moderation_portfolio_holds
    where portfolio_id=p_portfolio_id) then
    raise exception using errcode='42501',message='UNLISTED_PORTFOLIO_BLOCKED';
  end if;
  update kadmeion_private.unlisted_release_routes
    set verified_at=coalesce(verified_at,clock_timestamp())
    where portfolio_id=p_portfolio_id and intent_id=p_intent_id
      and html_sha256=p_html_sha256 and status='LIVE'
      and (public.service_read_unlisted_release(p_portfolio_id) is not null
        or exists(select 1 from public.private_unlisted_publication_intents intent
          where intent.id=p_intent_id
            and public.service_read_public_portfolio(intent.public_handle,intent.public_slug) is not null));
  if not found then
    raise exception using errcode='40001',message='UNLISTED_ACKNOWLEDGMENT_CONFLICT';
  end if;
  insert into public.verified_unlisted_releases(
    intent_id,portfolio_id,owner_user_id,request_id,stage_generation,html_sha256,verified_at
  )
  select intent_id,portfolio_id,owner_user_id,request_id,stage_generation,html_sha256,verified_at
    from kadmeion_private.unlisted_release_routes where portfolio_id=p_portfolio_id
  on conflict(intent_id) do nothing;
  delete from kadmeion_private.unlisted_release_fallbacks where portfolio_id=p_portfolio_id;
  return true;
end;
$function$;
revoke all on function public.service_acknowledge_unlisted_release(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.service_acknowledge_unlisted_release(uuid,uuid,text)
  to service_role;

-- A trusted host can report failure only for the activation it attempted.
-- Restore the immediate prior route if its scope and pinned bytes still match.
create function public.service_recover_failed_unlisted_release(
  p_portfolio_id uuid,p_failed_intent_id uuid
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_restored_generation bigint;
begin
  if p_portfolio_id is null or p_failed_intent_id is null then
    raise exception using errcode='22023',message='INVALID_UNLISTED_RECOVERY';
  end if;
  perform 1 from public.portfolios where id=p_portfolio_id and trashed_at is null for update;
  if not found or exists(select 1 from kadmeion_private.moderation_portfolio_holds
      where portfolio_id=p_portfolio_id) then
    raise exception using errcode='42501',message='UNLISTED_PORTFOLIO_BLOCKED';
  end if;
  perform 1 from public.private_release_visibility_pointers
    where portfolio_id=p_portfolio_id and status='PREPARED_PRIVATE' for update;
  if not found then
    raise exception using errcode='40001',message='UNLISTED_RECOVERY_CONFLICT';
  end if;
  perform 1 from kadmeion_private.unlisted_release_routes
    where portfolio_id=p_portfolio_id and intent_id=p_failed_intent_id and status='LIVE'
      and verified_at is null for update;
  if not found then
    raise exception using errcode='40001',message='UNLISTED_RECOVERY_CONFLICT';
  end if;

  update kadmeion_private.unlisted_release_routes live
  set intent_id=previous.id,request_id=previous.request_id,
    release_generation=fallback.previous_generation,
    stage_generation=fallback.previous_stage_generation,verified_at=fallback.previous_verified_at,
    html_sha256=fallback.previous_html_sha256,updated_at=transaction_timestamp()
  from kadmeion_private.unlisted_release_fallbacks fallback
  join public.private_unlisted_publication_intents previous
    on previous.id=fallback.previous_intent_id and previous.portfolio_id=fallback.portfolio_id
  join public.private_release_requests request
    on request.id=previous.request_id and request.portfolio_id=previous.portfolio_id
    and request.owner_user_id=previous.owner_user_id
  join kadmeion_private.private_reviewer_stage_artifacts staged
    on staged.portfolio_id=fallback.portfolio_id and staged.owner_user_id=previous.owner_user_id
    and staged.request_id=request.id and staged.pointer_generation=fallback.previous_stage_generation
  where live.portfolio_id=p_portfolio_id and fallback.portfolio_id=live.portfolio_id
    and fallback.replacement_intent_id=p_failed_intent_id
    and previous.owner_user_id=live.owner_user_id
    and request.status='FROZEN'
    and staged.html_sha256=fallback.previous_html_sha256
    and encode(sha256(convert_to(staged.html,'UTF8')),'hex')=staged.html_sha256
  returning live.release_generation into v_restored_generation;

  if not found then
    update kadmeion_private.unlisted_release_routes
      set status='REVOKED',updated_at=transaction_timestamp()
      where portfolio_id=p_portfolio_id;
  end if;
  delete from kadmeion_private.unlisted_release_fallbacks where portfolio_id=p_portfolio_id;
  return jsonb_build_object(
    'status',case when v_restored_generation is null then 'REVOKED'
                  else 'RESTORED_NEEDS_EXTERNAL_HTTP_VERIFICATION' end,
    'portfolioId',p_portfolio_id,'releaseGeneration',v_restored_generation,
    'hostRevocationVerified',false,'publicUrl',null
  );
end;
$function$;
revoke all on function public.service_recover_failed_unlisted_release(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.service_recover_failed_unlisted_release(uuid,uuid)
  to service_role;

-- Every owner unpublish, Trash and operator block calls the existing private
-- pointer BLOCKED transition. The same transaction revokes this route.
create function kadmeion_private.revoke_unlisted_when_pointer_blocked()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if new.status='BLOCKED' then
    update kadmeion_private.unlisted_release_routes
      set status='REVOKED',updated_at=transaction_timestamp()
      where portfolio_id=new.portfolio_id and status<>'REVOKED';
    delete from kadmeion_private.unlisted_release_pending
      where portfolio_id=new.portfolio_id;
    delete from kadmeion_private.unlisted_release_fallbacks
      where portfolio_id=new.portfolio_id;
  end if;
  return new;
end;
$function$;
revoke all on function kadmeion_private.revoke_unlisted_when_pointer_blocked()
  from public,anon,authenticated;
create trigger kd_unlisted_revoke_on_private_block
  after insert or update of status on public.private_release_visibility_pointers
  for each row when (new.status='BLOCKED')
  execute function kadmeion_private.revoke_unlisted_when_pointer_blocked();
