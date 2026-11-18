-- B16 C11: authoritative public-delivery receipts.
-- Install forward only with paired public worker and independent lifecycle/ACL tests.
-- No host/CDN proof or automatic republication is implied.
create table kadmeion_private.public_delivery_epochs(
  portfolio_id uuid primary key references public.portfolios(id) on delete cascade,
  delivery_epoch bigint not null default 1 check(delivery_epoch between 1 and 9007199254740991)
);
alter table kadmeion_private.public_delivery_epochs enable row level security;
revoke all on table kadmeion_private.public_delivery_epochs from public,anon,authenticated,service_role;
insert into kadmeion_private.public_delivery_epochs(portfolio_id)
  select id from public.portfolios on conflict do nothing;

create function kadmeion_private.bump_public_delivery_epoch(p_portfolio_id uuid)
returns bigint language sql security definer set search_path='' as $$
  insert into kadmeion_private.public_delivery_epochs as old(portfolio_id,delivery_epoch)
    select p.id,2 from public.portfolios p where p.id=p_portfolio_id
  on conflict(portfolio_id) do update
    set delivery_epoch=least(old.delivery_epoch+1,9007199254740991)
  returning delivery_epoch
$$;
revoke all on function kadmeion_private.bump_public_delivery_epoch(uuid)
  from public,anon,authenticated,service_role;

create function public.service_read_current_public_delivery_receipt(p_portfolio_id uuid,p_intent_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with current_route as (
    select route.portfolio_id,route.intent_id,route.request_id,intent.operation_id,
      route.release_generation,route.stage_generation,pointer.generation as pointer_generation,
      pointer.revocation_generation,epoch.delivery_epoch,profile.handle,portfolio.slug,
      stage.html_sha256,route.verified_at,
      kadmeion_private.release_media_metadata(stage.portfolio_id,stage.pointer_generation,stage.html_sha256) media,
      exists(select 1 from kadmeion_private.frozen_media_candidates m
        where m.portfolio_id=stage.portfolio_id and m.generation=stage.pointer_generation) has_media
    from kadmeion_private.unlisted_release_routes route
    join public.portfolios portfolio on portfolio.id=route.portfolio_id
      and portfolio.owner_user_id=route.owner_user_id
    join public.profiles profile on profile.user_id=route.owner_user_id
    join public.private_unlisted_publication_intents intent on intent.id=route.intent_id
      and intent.portfolio_id=route.portfolio_id and intent.owner_user_id=route.owner_user_id
      and intent.request_id=route.request_id
      and intent.public_handle=profile.handle and intent.public_slug=portfolio.slug
    join public.private_release_requests request on request.id=route.request_id
      and request.portfolio_id=route.portfolio_id and request.owner_user_id=route.owner_user_id
    join public.private_release_visibility_pointers pointer on pointer.portfolio_id=route.portfolio_id
      and pointer.owner_user_id=route.owner_user_id
    join kadmeion_private.private_reviewer_stage_artifacts stage on stage.portfolio_id=route.portfolio_id
      and stage.owner_user_id=route.owner_user_id and stage.pointer_generation=route.stage_generation
      and stage.request_id=route.request_id and stage.html_sha256=route.html_sha256
    join kadmeion_private.public_delivery_epochs epoch on epoch.portfolio_id=route.portfolio_id
    where route.portfolio_id=p_portfolio_id and route.intent_id=p_intent_id
      and portfolio.trashed_at is null and route.status='LIVE'
      and intent.status='USED' and request.visibility_intent='PUBLIC' and request.status='FROZEN'
      and pointer.status='PREPARED_PRIVATE' and route.stage_generation>pointer.revocation_generation
      and pointer.generation>=route.release_generation and route.release_generation>=route.stage_generation
      and route.stage_generation between 1 and 9007199254740991
      and pointer.revocation_generation between 0 and 9007199254740991
      and pointer.generation between 1 and 9007199254740991
      and route.release_generation between 1 and 9007199254740991
      and epoch.delivery_epoch<9007199254740991
      and not exists(select 1 from kadmeion_private.moderation_portfolio_holds hold
        where hold.portfolio_id=route.portfolio_id)
      and stage.html_sha256=encode(sha256(convert_to(stage.html,'UTF8')),'hex')
  )
  select jsonb_build_object('portfolioId',portfolio_id,'intentId',intent_id,'requestId',request_id,
    'operationId',operation_id,'releaseGeneration',release_generation,'stageGeneration',stage_generation,
    'pointerGeneration',pointer_generation,'revocationGeneration',revocation_generation,
    'deliveryEpoch',delivery_epoch,'visibility','PUBLIC','handle',handle,'slug',slug,
    'storedHtmlSha256',html_sha256,'mediaManifest',media->'mediaManifest',
    'assetHashes',case when has_media then media->'assetHashes' else '[]'::jsonb end,
    'verifiedAt',verified_at)
  from current_route
  where case when not has_media then media='{}'::jsonb
    when jsonb_typeof(media->'assetHashes')='array' then
      (media->>'mediaManifest')~'^[0-9a-f]{64}$'
      and jsonb_array_length(media->'assetHashes') between 1 and 8
      and not exists(select 1 from jsonb_array_elements(media->'assetHashes') e(value)
        where jsonb_typeof(e.value)<>'string' or e.value#>>'{}' !~ '^[0-9a-f]{64}$')
      and (select count(distinct value) from jsonb_array_elements(media->'assetHashes') e(value))
         =jsonb_array_length(media->'assetHashes')
    else false end
$$;
revoke all on function public.service_read_current_public_delivery_receipt(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.service_read_current_public_delivery_receipt(uuid,uuid) to service_role;

-- Advance authority on every route-relevant mutation.
-- Existing rows are seeded 1; every effective lifecycle mutation bumps epoch.
create function kadmeion_private.note_public_delivery_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare a uuid; b uuid;
begin
  if tg_op<>'INSERT' then a:=(to_jsonb(old)->>tg_argv[0])::uuid; end if;
  if tg_op<>'DELETE' then b:=(to_jsonb(new)->>tg_argv[0])::uuid; end if;
  if a is not null then perform kadmeion_private.bump_public_delivery_epoch(a); end if;
  if b is not null and b is distinct from a then perform kadmeion_private.bump_public_delivery_epoch(b); end if;
  return null;
end;
$$;
revoke all on function kadmeion_private.note_public_delivery_change() from public,anon,authenticated,service_role;
create trigger kd_public_epoch_portfolio_insert after insert on public.portfolios
  for each row execute function kadmeion_private.note_public_delivery_change('id');
create trigger kd_public_epoch_portfolio_identity after update of slug,trashed_at on public.portfolios
  for each row when(old.slug is distinct from new.slug or old.trashed_at is distinct from new.trashed_at)
  execute function kadmeion_private.note_public_delivery_change('id');

create function kadmeion_private.note_public_delivery_handle()
returns trigger language plpgsql security definer set search_path='' as $$
declare p uuid;
begin
  for p in select id from public.portfolios where owner_user_id=new.user_id order by id
  loop perform kadmeion_private.bump_public_delivery_epoch(p); end loop;
  return null;
end;
$$;
revoke all on function kadmeion_private.note_public_delivery_handle() from public,anon,authenticated,service_role;
create trigger kd_public_epoch_profile_handle after update of handle on public.profiles
  for each row when(old.handle is distinct from new.handle)
  execute function kadmeion_private.note_public_delivery_handle();
create trigger kd_public_epoch_route after insert or update or delete on kadmeion_private.unlisted_release_routes
  for each row execute function kadmeion_private.note_public_delivery_change('portfolio_id');
create trigger kd_public_epoch_intent after insert or update or delete on public.private_unlisted_publication_intents
  for each row execute function kadmeion_private.note_public_delivery_change('portfolio_id');
create trigger kd_public_epoch_pointer after insert or update or delete on public.private_release_visibility_pointers
  for each row execute function kadmeion_private.note_public_delivery_change('portfolio_id');
create trigger kd_public_epoch_request after insert or update or delete on public.private_release_requests
  for each row execute function kadmeion_private.note_public_delivery_change('portfolio_id');
create trigger kd_public_epoch_stage after insert or update or delete on kadmeion_private.private_reviewer_stage_artifacts
  for each row execute function kadmeion_private.note_public_delivery_change('portfolio_id');
create trigger kd_public_epoch_media after insert or update or delete on kadmeion_private.frozen_media_candidates
  for each row execute function kadmeion_private.note_public_delivery_change('portfolio_id');
create trigger kd_public_epoch_hold after insert or update or delete on kadmeion_private.moderation_portfolio_holds
  for each row execute function kadmeion_private.note_public_delivery_change('portfolio_id');

-- Compare the complete server-issued JSON receipt, not client-supplied subsets.
-- Every locked writer uses portfolio -> intent -> pointer -> route -> epoch;
-- NOWAIT rejects contention rather than trusting a stale snapshot.
create function kadmeion_private.lock_expected_public_delivery(p_expected jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p uuid; i uuid; current_receipt jsonb;
begin
  if jsonb_typeof(p_expected) is distinct from 'object'
    or coalesce(p_expected->>'portfolioId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_expected->>'intentId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode='22023',message='INVALID_PUBLIC_DELIVERY_RECEIPT';
  end if;
  p:=(p_expected->>'portfolioId')::uuid; i:=(p_expected->>'intentId')::uuid;
  perform 1 from public.portfolios where id=p and trashed_at is null for update nowait;
  if not found then raise exception using errcode='40001',message='PUBLIC_DELIVERY_CONFLICT'; end if;
  perform 1 from public.private_unlisted_publication_intents where id=i and portfolio_id=p for update nowait;
  if not found then raise exception using errcode='40001',message='PUBLIC_DELIVERY_CONFLICT'; end if;
  perform 1 from public.private_release_visibility_pointers where portfolio_id=p for update nowait;
  if not found then raise exception using errcode='40001',message='PUBLIC_DELIVERY_CONFLICT'; end if;
  perform 1 from kadmeion_private.unlisted_release_routes where portfolio_id=p and intent_id=i for update nowait;
  if not found then raise exception using errcode='40001',message='PUBLIC_DELIVERY_CONFLICT'; end if;
  perform 1 from kadmeion_private.public_delivery_epochs where portfolio_id=p for update nowait;
  if not found then raise exception using errcode='40001',message='PUBLIC_DELIVERY_CONFLICT'; end if;
  current_receipt:=public.service_read_current_public_delivery_receipt(p,i);
  if current_receipt is null or current_receipt is distinct from p_expected then
    raise exception using errcode='40001',message='PUBLIC_DELIVERY_CONFLICT';
  end if;
  return current_receipt;
end;
$$;
revoke all on function kadmeion_private.lock_expected_public_delivery(jsonb) from public,anon,authenticated,service_role;
create function public.service_acknowledge_public_delivery(p_expected_receipt jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare before_receipt jsonb; after_receipt jsonb; p uuid; i uuid; e bigint;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception using errcode='42501',message='TRUSTED_WORKER_REQUIRED';
  end if;
  before_receipt:=kadmeion_private.lock_expected_public_delivery(p_expected_receipt);
  p:=(before_receipt->>'portfolioId')::uuid; i:=(before_receipt->>'intentId')::uuid;
  e:=(before_receipt->>'deliveryEpoch')::bigint;
  if before_receipt->'verifiedAt' is distinct from 'null'::jsonb or e>=9007199254740990 then
    raise exception using errcode='40001',message='PUBLIC_DELIVERY_ACK_CONFLICT';
  end if;
  update kadmeion_private.unlisted_release_routes set verified_at=clock_timestamp()
    where portfolio_id=p and intent_id=i and status='LIVE' and verified_at is null;
  if not found then raise exception using errcode='40001',message='PUBLIC_DELIVERY_ACK_CONFLICT'; end if;
  -- Exact receipt comparison also detects unexpected double bump or changes.
  after_receipt:=public.service_read_current_public_delivery_receipt(p,i);
  if after_receipt is null or after_receipt->'verifiedAt'='null'::jsonb
    or (after_receipt->>'deliveryEpoch')::bigint<>e+1
    or (after_receipt-'deliveryEpoch'-'verifiedAt') is distinct from (before_receipt-'deliveryEpoch'-'verifiedAt') then
    raise exception using errcode='40001',message='PUBLIC_DELIVERY_ACK_CONFLICT';
  end if;
  insert into public.verified_unlisted_releases(intent_id,portfolio_id,owner_user_id,request_id,stage_generation,html_sha256,verified_at)
    select intent_id,portfolio_id,owner_user_id,request_id,stage_generation,html_sha256,verified_at
    from kadmeion_private.unlisted_release_routes where portfolio_id=p and intent_id=i;
  delete from kadmeion_private.unlisted_release_fallbacks where portfolio_id=p;
  return after_receipt;
end;
$$;
revoke all on function public.service_acknowledge_public_delivery(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_acknowledge_public_delivery(jsonb) to service_role;

-- Compensate only the exact failed activation. Restore the previous verified
-- PUBLIC route only if its historical acknowledgement, current address, stage
-- and authority all still agree; otherwise revoke. No moderation restoration.
create function public.service_recover_failed_public_delivery(p_expected_receipt jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare before_receipt jsonb; restored_receipt jsonb; p uuid; i uuid; e bigint;
  next_epoch bigint; restored_intent uuid; restored_generation bigint;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception using errcode='42501',message='TRUSTED_WORKER_REQUIRED';
  end if;
  before_receipt:=kadmeion_private.lock_expected_public_delivery(p_expected_receipt);
  p:=(before_receipt->>'portfolioId')::uuid; i:=(before_receipt->>'intentId')::uuid;
  e:=(before_receipt->>'deliveryEpoch')::bigint;
  if before_receipt->'verifiedAt' is distinct from 'null'::jsonb then
    raise exception using errcode='40001',message='PUBLIC_DELIVERY_RECOVERY_CONFLICT';
  end if;
  -- Do not restore a prior unverified, withdrawn, renamed or cross-scope route.
  -- Reserve the last epoch for terminal denial rather than restoration.
  if e<9007199254740990 then
    update kadmeion_private.unlisted_release_routes live
      set intent_id=prior.id,request_id=prior.request_id,
        release_generation=f.previous_generation,stage_generation=f.previous_stage_generation,
        verified_at=f.previous_verified_at,html_sha256=f.previous_html_sha256,
        updated_at=clock_timestamp()
    from kadmeion_private.unlisted_release_fallbacks f
    join public.private_unlisted_publication_intents prior on prior.id=f.previous_intent_id
      and prior.portfolio_id=f.portfolio_id
    join public.verified_unlisted_releases history on history.intent_id=prior.id
      and history.portfolio_id=prior.portfolio_id and history.owner_user_id=prior.owner_user_id
      and history.request_id=prior.request_id and history.stage_generation=f.previous_stage_generation
      and history.html_sha256=f.previous_html_sha256 and history.verified_at=f.previous_verified_at
    join public.private_release_requests req on req.id=prior.request_id
      and req.portfolio_id=prior.portfolio_id and req.owner_user_id=prior.owner_user_id
    join kadmeion_private.private_reviewer_stage_artifacts stage on stage.portfolio_id=f.portfolio_id
      and stage.owner_user_id=prior.owner_user_id and stage.request_id=prior.request_id
      and stage.pointer_generation=f.previous_stage_generation and stage.html_sha256=f.previous_html_sha256
    join public.private_release_visibility_pointers pointer on pointer.portfolio_id=f.portfolio_id
      and pointer.owner_user_id=prior.owner_user_id
    where live.portfolio_id=p and live.intent_id=i and live.status='LIVE' and live.verified_at is null
      and f.portfolio_id=p and f.replacement_intent_id=i and prior.owner_user_id=live.owner_user_id
      and prior.id<>i and prior.status='USED' and req.status='FROZEN' and req.visibility_intent='PUBLIC'
      and prior.public_handle=before_receipt->>'handle' and prior.public_slug=before_receipt->>'slug'
      and f.previous_verified_at is not null
      and f.previous_stage_generation>pointer.revocation_generation
      and f.previous_stage_generation between 1 and f.previous_generation
      and f.previous_generation<=pointer.generation
      and pointer.status='PREPARED_PRIVATE'
      and stage.html_sha256=encode(sha256(convert_to(stage.html,'UTF8')),'hex')
    returning live.intent_id,live.release_generation into restored_intent,restored_generation;
    if restored_intent is not null then
      restored_receipt:=public.service_read_current_public_delivery_receipt(p,restored_intent);
      if restored_receipt is null or restored_receipt->'verifiedAt'='null'::jsonb then
        restored_generation:=null;
      end if;
    end if;
  end if;
  if restored_generation is null then
    update kadmeion_private.unlisted_release_routes set status='REVOKED',updated_at=clock_timestamp()
      where portfolio_id=p and intent_id=coalesce(restored_intent,i) and status='LIVE';
    if not found then raise exception using errcode='40001',message='PUBLIC_DELIVERY_RECOVERY_CONFLICT'; end if;
  end if;
  delete from kadmeion_private.unlisted_release_pending where portfolio_id=p;
  delete from kadmeion_private.unlisted_release_fallbacks where portfolio_id=p;
  select delivery_epoch into next_epoch from kadmeion_private.public_delivery_epochs where portfolio_id=p;
  if next_epoch is null or next_epoch<=e or public.service_read_current_public_delivery_receipt(p,i) is not null then
    raise exception using errcode='40001',message='PUBLIC_DELIVERY_RECOVERY_CONFLICT';
  end if;
  return jsonb_build_object('portfolioId',p,
    'status',case when restored_generation is null then 'REVOKED' else 'RESTORED_NEEDS_EXTERNAL_HTTP_VERIFICATION' end,
    'releaseGeneration',restored_generation,'deliveryEpoch',next_epoch,
    'hostRevocationVerified',false,'publicUrl',null);
end;
$$;
revoke all on function public.service_recover_failed_public_delivery(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_recover_failed_public_delivery(jsonb) to service_role;

-- The authenticated Edge preflight needs this single owner-filtered scalar.
-- Existing RLS remains unchanged; no owner identity or private artifact grant.
grant select (operation_id) on public.private_unlisted_publication_intents to authenticated;

-- Close old unfenced PUBLIC acknowledgement/recovery; keep UNLISTED.
create or replace function public.service_acknowledge_unlisted_release(
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
      and public.service_read_unlisted_release(p_portfolio_id) is not null;
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

create or replace function public.service_recover_failed_unlisted_release(
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
      and verified_at is null
      and public.service_read_unlisted_release(p_portfolio_id) is not null for update;
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
    and request.status='FROZEN' and request.visibility_intent='UNLISTED'
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


-- Gate canonical PUBLIC resolver and its existing media caller.
create or replace function public.service_read_public_portfolio(p_handle text,p_slug text)
returns jsonb language sql stable security definer set search_path=''
as $function$
  select jsonb_build_object(
    'html',stage.html,
    'htmlSha256',stage.html_sha256,
    'indexable',route.verified_at is not null
  ) || kadmeion_private.release_media_metadata(stage.portfolio_id,stage.pointer_generation,stage.html_sha256)
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
    and public.service_read_current_public_delivery_receipt(route.portfolio_id,route.intent_id) is not null
$function$;


revoke all on function public.service_read_public_portfolio(text,text) from public,anon,authenticated,service_role;
grant execute on function public.service_read_public_portfolio(text,text) to service_role;

-- Bind direct public PNG lookup to its exact authorized stage in one statement.
create or replace function public.service_read_frozen_release_png(
  p_manifest text, p_sha text, p_handle text default null, p_slug text default null,
  p_portfolio_id uuid default null, p_grant_id uuid default null, p_raw_token text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_page jsonb;
  v_bytes bytea;
begin
  if p_manifest is null or p_manifest !~ '^[a-f0-9]{64}$'
    or p_sha is null or p_sha !~ '^[a-f0-9]{64}$' then return null; end if;

  if p_handle is not null and p_slug is not null and p_portfolio_id is null
    and p_grant_id is null and p_raw_token is null then
    -- One MVCC read binds canonical address, authority, exact stage and PNG.
    select m.files[f.ord::int] into v_bytes
    from kadmeion_private.unlisted_release_routes r
    join public.portfolios p on p.id=r.portfolio_id and p.owner_user_id=r.owner_user_id
    join public.profiles pr on pr.user_id=r.owner_user_id
    cross join lateral (select public.service_read_current_public_delivery_receipt(r.portfolio_id,r.intent_id) as receipt) v
    join kadmeion_private.frozen_media_candidates m on m.portfolio_id=r.portfolio_id
      and m.generation=r.stage_generation and m.manifest_sha256=p_manifest
    cross join lateral jsonb_array_elements(m.manifest_json::jsonb->'files') with ordinality as f(value,ord)
    where pr.handle=p_handle and p.slug=p_slug
      and v.receipt is not null and v.receipt->>'mediaManifest'=p_manifest
      and coalesce(v.receipt->'assetHashes' ? p_sha,false)
      and m.manifest_json::jsonb->'files'->0->>'sha256'=v.receipt->>'storedHtmlSha256'
      and f.ord>1 and f.value->>'sha256'=p_sha
    limit 1;
    if v_bytes is null or octet_length(v_bytes)>4000000 or
      encode(sha256(v_bytes),'hex')<>p_sha then return null; end if;
    return jsonb_build_object('png',translate(encode(v_bytes,'base64'),E'\n',''));
  elsif p_portfolio_id is not null and p_handle is null and p_slug is null
    and p_grant_id is null and p_raw_token is null then
    v_page := public.service_read_unlisted_release(p_portfolio_id);
  elsif p_grant_id is not null and p_raw_token is not null and p_handle is null
    and p_slug is null and p_portfolio_id is null then
    v_page := public.read_private_reviewer_stage_artifact(p_grant_id,p_raw_token);
  end if;
  if v_page is null or v_page->>'mediaManifest' is distinct from p_manifest
    or not coalesce(v_page->'assetHashes' ? p_sha,false) then return null; end if;

  select m.files[f.ord::int] into v_bytes
  from kadmeion_private.frozen_media_candidates m
  cross join lateral jsonb_array_elements(m.manifest_json::jsonb->'files')
    with ordinality as f(value,ord)
  where m.manifest_sha256=p_manifest and f.ord>1 and f.value->>'sha256'=p_sha
    and m.manifest_json::jsonb->'files'->0->>'sha256'=v_page->>'htmlSha256'
  limit 1;
  if v_bytes is null or octet_length(v_bytes)>4000000 or
    encode(sha256(v_bytes),'hex')<>p_sha then return null; end if;
  return jsonb_build_object('png',translate(encode(v_bytes,'base64'),E'\n',''));
end;
$$;

revoke all on function public.service_read_frozen_release_png(text,text,text,text,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.service_read_frozen_release_png(text,text,text,text,uuid,uuid,text) to service_role;
