-- Use the same immutable stage for text and media. This does not publish it.
create function kadmeion_private.stage_frozen_media_candidate()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_html text := convert_from(new.files[1], 'UTF8');
  v_sha text := encode(sha256(new.files[1]),'hex');
begin
  -- Keep each binary response below the Node delivery host's payload cap.
  if exists(select 1 from unnest(new.files) as f(bytes) where octet_length(bytes)>4000000) then
    raise exception using errcode='54000',message='MEDIA_DELIVERY_SIZE_LIMIT';
  end if;
  insert into kadmeion_private.private_artifact_bindings(
    portfolio_id,owner_user_id,request_id,pointer_generation,manifest_sha256,html_sha256,html_byte_length)
    values(new.portfolio_id,new.owner_user_id,new.request_id,new.generation,
      new.manifest_sha256,v_sha,octet_length(new.files[1]));
  perform public.store_private_reviewer_stage_artifact(new.request_id,new.generation,v_html);
  return new;
end;
$$;
revoke all on function kadmeion_private.stage_frozen_media_candidate() from public,anon,authenticated,service_role;
create trigger stage_frozen_media_candidate after insert on kadmeion_private.frozen_media_candidates
  for each row execute function kadmeion_private.stage_frozen_media_candidate();

create function kadmeion_private.release_media_metadata(p_portfolio uuid,p_generation bigint,p_html_sha text)
returns jsonb language sql stable set search_path=''
as $$
  select coalesce((
    select jsonb_build_object('mediaManifest', m.manifest_sha256, 'assetHashes',
      (select jsonb_agg(f.value->>'sha256' order by f.ord)
       from jsonb_array_elements(m.manifest_json::jsonb->'files') with ordinality as f(value,ord)
       where f.ord>1))
    from kadmeion_private.frozen_media_candidates m
    where m.portfolio_id=p_portfolio and m.generation=p_generation
      and m.manifest_json::jsonb->'files'->0->>'sha256'=p_html_sha
  ),'{}'::jsonb)
$$;
revoke all on function kadmeion_private.release_media_metadata(uuid,bigint,text) from public,anon,authenticated,service_role;

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
$function$;

create or replace function public.service_read_unlisted_release(p_portfolio_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_html record;
begin
  if p_portfolio_id is null then return null;end if;
  select s.html,s.html_sha256,s.pointer_generation
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
      and r.stage_generation>v.revocation_generation
      and not exists(select 1 from kadmeion_private.moderation_portfolio_holds h
        where h.portfolio_id=r.portfolio_id);
  if not found or octet_length(v_html.html)>750000 or
    encode(sha256(convert_to(v_html.html,'UTF8')),'hex')<>v_html.html_sha256
  then return null;end if;
  return jsonb_build_object('status','UNLISTED_SCRIPTLESS_HTML','html',v_html.html,
    'htmlSha256',v_html.html_sha256,'indexable',false,
    'publicPublishingProven',false) || kadmeion_private.release_media_metadata(p_portfolio_id,v_html.pointer_generation,v_html.html_sha256);
end;
$function$;

create or replace function public.read_private_reviewer_stage_artifact(
  p_grant_id uuid,p_raw_token text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_content record;
begin
  if p_grant_id is null or p_raw_token is null or
     p_raw_token !~ '^[0-9a-f]{64}$' then return null;end if;
  select s.html,s.html_sha256,s.pointer_generation,s.portfolio_id,
      b.html_byte_length as verified_length
    into v_content
    from public.private_reviewer_grants g
    join public.private_release_requests r
      on r.id=g.request_id and r.portfolio_id=g.portfolio_id
        and r.owner_user_id=g.owner_user_id
    join public.portfolios p on p.id=g.portfolio_id and p.owner_user_id=g.owner_user_id
    join public.private_release_visibility_pointers v
      on v.portfolio_id=p.id and v.owner_user_id=p.owner_user_id
    join kadmeion_private.private_reviewer_stage_artifacts s
      on s.portfolio_id=v.portfolio_id and s.pointer_generation=v.generation
        and s.request_id=r.id
    join kadmeion_private.private_artifact_bindings b
      on b.portfolio_id=s.portfolio_id
        and b.pointer_generation=s.pointer_generation
        and b.request_id=s.request_id
    where g.id=p_grant_id and g.revoked_at is null
      and g.expires_at>transaction_timestamp()
      and g.token_sha256=encode(extensions.digest(decode(p_raw_token,'hex'),'sha256'),'hex')
      and r.status='FROZEN' and p.trashed_at is null
      and v.status='PREPARED_PRIVATE' and v.candidate_request_id=r.id
      and not exists(
        select 1 from kadmeion_private.moderation_portfolio_holds h
          where h.portfolio_id=p.id)
    for share of g,p,v;
  if not found then return null;end if;
  if octet_length(v_content.html)<>v_content.verified_length or
    encode(sha256(convert_to(v_content.html,'UTF8')),'hex')<>v_content.html_sha256
  then return null;end if;
  return jsonb_build_object('status','REVIEWER_PRIVATE_HTML',
    'html',v_content.html,'htmlSha256',v_content.html_sha256,
    'publicServingEnabled',false,'publicUrl',null) || kadmeion_private.release_media_metadata(
      v_content.portfolio_id,v_content.pointer_generation,v_content.html_sha256);
end;
$$;

-- Re-evaluate the page's exact visibility or reviewer token on every direct
-- asset request. Candidate rows alone never grant asset access.
create function public.service_read_frozen_release_png(
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
    v_page := public.service_read_public_portfolio(p_handle,p_slug);
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
create index frozen_media_candidates_manifest_idx
  on kadmeion_private.frozen_media_candidates (manifest_sha256);
revoke all on function public.service_read_frozen_release_png(text,text,text,text,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.service_read_frozen_release_png(text,text,text,text,uuid,uuid,text)
  to service_role;
