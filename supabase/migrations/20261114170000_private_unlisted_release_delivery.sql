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
  status text not null check(status in ('PROBE_PENDING','LIVE','REVOKED')),
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
begin
  v_session:=kadmeion_private.require_live_exit_auth_session();
  if p_request_id is null or p_operation_id is null or
     p_expected_generation is null or p_expected_generation<1 or
     p_confirmation is distinct from 'PUBLISH UNLISTED' then
    raise exception using errcode='22023',message='INVALID_UNLISTED_CONSENT';end if;
  select r.portfolio_id,r.owner_user_id,r.visibility_intent,r.status,p.trashed_at
    into v_source from public.private_release_requests r
    join public.portfolios p on p.id=r.portfolio_id and p.owner_user_id=r.owner_user_id
    where r.id=p_request_id and r.owner_user_id=v_owner for update of p;
  if not found or v_source.status<>'FROZEN' or
     v_source.visibility_intent<>'UNLISTED' or v_source.trashed_at is not null
  then raise exception using errcode='42501',message='UNLISTED_SOURCE_UNAVAILABLE';end if;
  if exists(select 1 from kadmeion_private.moderation_portfolio_holds
     where portfolio_id=v_source.portfolio_id) then
    raise exception using errcode='42501',message='MODERATION_HOLD_ACTIVE';end if;
  select * into v_intent from public.private_unlisted_publication_intents
    where owner_user_id=v_owner and operation_id=p_operation_id for update;
  if found then
    if v_intent.request_id<>p_request_id or
       v_intent.expected_pointer_generation<>p_expected_generation then
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
  insert into public.private_unlisted_publication_intents(
    portfolio_id,owner_user_id,request_id,operation_id,expected_pointer_generation
  ) values(v_source.portfolio_id,v_owner,p_request_id,p_operation_id,
    p_expected_generation) returning id into v_id;
  return jsonb_build_object('intentId',v_id,'status','AWAITING_HOST',
    'alreadyRecorded',false,'publicServingEnabled',false,'publicUrl',null);
end;
$function$;
revoke all on function public.owner_request_unlisted_publication(uuid,bigint,uuid,text)
  from public,anon;
grant execute on function public.owner_request_unlisted_publication(uuid,bigint,uuid,text)
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
  if v_intent.expires_at<=clock_timestamp() or v_intent.status<>'AWAITING_HOST'
    or not found or v_pointer.status<>'PREPARED_PRIVATE'
    or v_pointer.generation<>v_intent.expected_pointer_generation
    or v_pointer.candidate_request_id<>v_intent.request_id then
    raise exception using errcode='40001',message='UNLISTED_PREPARE_CONFLICT';end if;
  select * into v_stage from kadmeion_private.private_reviewer_stage_artifacts
    where portfolio_id=v_intent.portfolio_id
      and pointer_generation=v_intent.expected_pointer_generation
      and request_id=v_intent.request_id;
  if not found or
    encode(sha256(convert_to(v_stage.html,'UTF8')),'hex')<>v_stage.html_sha256 then
    raise exception using errcode='22023',message='UNLISTED_ARTIFACT_INVALID';end if;
  -- The pointer generation advances for every candidate, including one that
  -- never goes live. A replacement with identical HTML must invalidate a
  -- delayed activation from the previous probe.
  insert into kadmeion_private.unlisted_release_pending(
    portfolio_id,owner_user_id,request_id,intent_id,stage_generation,
    release_generation,html_sha256,expires_at
  ) values(v_intent.portfolio_id,v_intent.owner_user_id,v_intent.request_id,
    v_intent.id,v_intent.expected_pointer_generation,
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
  return jsonb_build_object('portfolioId',v_intent.portfolio_id,
    'releaseGeneration',v_intent.expected_pointer_generation,'status','PROBE_PENDING',
    'htmlSha256',v_stage.html_sha256,'publicServingEnabled',false,
    'publicUrl',null);
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
    join public.private_release_visibility_pointers v on v.portfolio_id=r.portfolio_id
    join kadmeion_private.private_reviewer_stage_artifacts s
      on s.portfolio_id=r.portfolio_id and s.pointer_generation=r.stage_generation
      and s.request_id=r.request_id and s.owner_user_id=r.owner_user_id
      and s.html_sha256=r.html_sha256
    where r.portfolio_id=p_portfolio_id and r.expires_at>clock_timestamp()
      and p.trashed_at is null and v.status='PREPARED_PRIVATE'
      and v.generation=r.stage_generation
      and v.candidate_request_id=r.request_id
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
  select * into v_pointer from public.private_release_visibility_pointers
    where portfolio_id=p_portfolio_id for update;
  if not found or v_pending.expires_at<=clock_timestamp() or
    v_pending.intent_id<>p_intent_id or
    v_pending.release_generation<>p_expected_generation or
    v_pending.html_sha256<>p_html_sha256 or
    v_pointer.status<>'PREPARED_PRIVATE' or
    v_pointer.generation<>v_pending.stage_generation or
    v_pointer.candidate_request_id<>v_pending.request_id then
    raise exception using errcode='40001',message='UNLISTED_ACTIVATION_CONFLICT';end if;
  select * into v_stage from kadmeion_private.private_reviewer_stage_artifacts
    where portfolio_id=p_portfolio_id
      and pointer_generation=v_pending.stage_generation
      and request_id=v_pending.request_id;
  if not found or v_stage.html_sha256<>p_html_sha256 or
     encode(sha256(convert_to(v_stage.html,'UTF8')),'hex')<>p_html_sha256 then
    raise exception using errcode='22023',message='UNLISTED_ACTIVATION_DIGEST_MISMATCH';end if;
  insert into kadmeion_private.unlisted_release_routes(
    portfolio_id,owner_user_id,request_id,intent_id,stage_generation,
    release_generation,status,html_sha256
  ) values(v_pending.portfolio_id,v_pending.owner_user_id,
    v_pending.request_id,v_pending.intent_id,v_pending.stage_generation,
    v_pending.release_generation,'LIVE',p_html_sha256)
  on conflict(portfolio_id) do update set
    owner_user_id=excluded.owner_user_id,request_id=excluded.request_id,
    intent_id=excluded.intent_id,stage_generation=excluded.stage_generation,
    release_generation=excluded.release_generation,status='LIVE',
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
