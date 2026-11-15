-- B4: public canary delivery must not advertise an unacknowledged release
-- to crawlers. The host-visible route exists before the trusted HTTP canary
-- acknowledges it, so a successful lookup alone is NOT an indexing grant.
-- Previous PUBLIC vs UNLISTED and project/owner privacy predicates are retained.
create or replace function public.service_read_public_portfolio(p_handle text,p_slug text)
returns jsonb language sql stable security definer set search_path=''
as $function$
  select jsonb_build_object(
    'html',stage.html,
    'htmlSha256',stage.html_sha256,
    'indexable',route.verified_at is not null
  )
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
-- An ordinary browser remains forbidden from calling this service-key-only RPC.
revoke all on function public.service_read_public_portfolio(text,text)
  from public,anon,authenticated;
grant execute on function public.service_read_public_portfolio(text,text)
  to service_role;
comment on function public.service_read_public_portfolio(text,text) is
  'Returns only PUBLIC owner-consented scriptless HTML. indexable becomes true only after exact-route trusted HTTP verification acknowledgement; host must use noindex otherwise.';
