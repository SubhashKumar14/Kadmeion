-- Public rollback preserves the already-consented canonical address and uses the normal host check.
create or replace function public.owner_request_unlisted_rollback(
  p_target_intent_id uuid,p_current_intent_id uuid,p_expected_generation bigint,
  p_operation_id uuid,p_confirmation text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_owner uuid := (select auth.uid());
  v_target public.verified_unlisted_releases%rowtype;
  v_intent public.private_unlisted_publication_intents%rowtype;
  v_target_intent public.private_unlisted_publication_intents%rowtype;
  v_visibility text;
begin
  perform kadmeion_private.require_live_exit_auth_session();
  if p_target_intent_id is null or p_current_intent_id is null or p_operation_id is null
    or p_target_intent_id=p_current_intent_id or p_expected_generation is null
    or p_expected_generation<1 or coalesce(p_confirmation,'') not in ('ROLL BACK UNLISTED','ROLL BACK PUBLIC') then
    raise exception using errcode='22023',message='INVALID_UNLISTED_ROLLBACK';
  end if;
  v_visibility:=case when p_confirmation='ROLL BACK PUBLIC' then 'PUBLIC' else 'UNLISTED' end;
  select * into v_target from public.verified_unlisted_releases
    where intent_id=p_target_intent_id and owner_user_id=v_owner
      and exists(select 1 from public.private_release_requests request
        where request.id=verified_unlisted_releases.request_id and request.visibility_intent=v_visibility);
  if not found then
    raise exception using errcode='42501',message='UNLISTED_SOURCE_UNAVAILABLE';
  end if;
  select * into strict v_target_intent from public.private_unlisted_publication_intents
    where id=p_target_intent_id and owner_user_id=v_owner;
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
    join public.private_unlisted_publication_intents active on active.id=route.intent_id
    join public.portfolios portfolio on portfolio.id=route.portfolio_id
    join public.profiles profile on profile.user_id=portfolio.owner_user_id
    where pointer.portfolio_id=v_target.portfolio_id and pointer.status='PREPARED_PRIVATE'
      and pointer.generation=p_expected_generation
      and v_target.stage_generation>pointer.revocation_generation
      and route.intent_id=p_current_intent_id and route.status='LIVE'
      and route.verified_at is not null
      and (v_visibility='UNLISTED' or (
        active.public_handle=profile.handle and active.public_slug=portfolio.slug
        and v_target_intent.public_handle=active.public_handle
        and v_target_intent.public_slug=active.public_slug));
  if not found then
    raise exception using errcode='40001',message='UNLISTED_POINTER_CONFLICT';
  end if;
  if (select count(*) from public.private_unlisted_publication_intents
    where owner_user_id=v_owner and created_at>transaction_timestamp()-interval '24 hours')>=20 then
    raise exception using errcode='54000',message='UNLISTED_INTENT_QUOTA_REACHED';
  end if;
  insert into public.private_unlisted_publication_intents(
    portfolio_id,owner_user_id,request_id,operation_id,expected_pointer_generation,
    rollback_target_id,rollback_from_id,public_handle,public_slug
  ) values(v_target.portfolio_id,v_owner,v_target.request_id,p_operation_id,
    p_expected_generation,p_target_intent_id,p_current_intent_id,
    v_target_intent.public_handle,v_target_intent.public_slug) returning * into v_intent;
  return jsonb_build_object('intentId',v_intent.id,'status',v_intent.status,
    'alreadyRecorded',false,'publicServingEnabled',false,'publicUrl',null);
end;
$function$;

create or replace function public.service_prepare_unlisted_release(p_intent_id uuid)
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
          where request.id=verified_unlisted_releases.request_id and request.visibility_intent=case when v_intent.public_handle is null then 'UNLISTED' else 'PUBLIC' end);
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
