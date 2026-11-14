-- Server-only B4 denial guard: never an HTTP public resolver, release, or CDN proof.
-- Canonical AND direct immutable asset requests must use the same denial boundary.
create function kadmeion_private.private_delivery_denial_gate(
  p_portfolio_id uuid,p_resource text,p_release_sha256 text default null,
  p_asset_path text default null,p_asset_sha256 text default null
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_status text; v_generation bigint := 0; v_revocation bigint := 0;
  v_trashed timestamptz; v_valid boolean := false;
  v_reason text := 'NO_VERIFIED_PUBLIC_RELEASE';
begin
  -- Validate the two disjoint resource types BEFORE consulting private data.
  if p_portfolio_id is not null and p_resource='CANONICAL_HTML' then
    v_valid := p_release_sha256 is null and p_asset_path is null and p_asset_sha256 is null;
  elsif p_portfolio_id is not null and p_resource='DIRECT_ASSET' then
    v_valid := p_release_sha256 is not null
      and p_release_sha256 ~ '^[0-9a-f]{64}$'
      and p_asset_sha256 is not null and p_asset_sha256 ~ '^[0-9a-f]{64}$'
      and p_asset_path is not null and char_length(p_asset_path)<=80
      and p_asset_path ~ '^assets/[0-9a-f]{64}[.](css|png|jpg|jpeg|webp|woff2)$'
      and substring(p_asset_path from 8 for 64)=p_asset_sha256;
  end if;
  if not coalesce(v_valid,false) then
    return jsonb_build_object('portfolioId',p_portfolio_id,'resource',p_resource,
      'status','DENY','reason','INVALID_REQUEST','generation',0,
      'revocationGeneration',0,'servingAllowed',false,'publicUrl',null,
      'hostRevocationVerified',false);
  end if;
  -- One fresh DB read. Owner-submitted manifest hashes never activate public access.
  select pointer.status,pointer.generation,pointer.revocation_generation,
      portfolio.trashed_at into v_status,v_generation,v_revocation,v_trashed
    from public.portfolios portfolio
    left join public.private_release_visibility_pointers pointer
      on pointer.portfolio_id=portfolio.id and pointer.owner_user_id=portfolio.owner_user_id
    where portfolio.id=p_portfolio_id;
  if not found then
    v_generation:=0;v_revocation:=0;
  else
    v_generation:=coalesce(v_generation,0);
    v_revocation:=coalesce(v_revocation,0);
    if v_status='BLOCKED' or v_trashed is not null then
      v_reason:='PRIVATE_POINTER_BLOCKED';
    end if;
  end if;
  -- There is intentionally NO public-allow path, including for a future
  -- accidentally added LIVE enum value. A real host must independently prove
  -- canonical route, direct asset and CDN interception before any activation.
  return jsonb_build_object('portfolioId',p_portfolio_id,'resource',p_resource,
    'status','DENY','reason',v_reason,'generation',v_generation,
    'revocationGeneration',v_revocation,'servingAllowed',false,
    'publicUrl',null,'hostRevocationVerified',false);
end;
$$;
revoke all on function kadmeion_private.private_delivery_denial_gate(
  uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function kadmeion_private.private_delivery_denial_gate(
  uuid,text,text,text,text) to service_role;
comment on function kadmeion_private.private_delivery_denial_gate(
  uuid,text,text,text,text) is
  'Unexposed trusted DB-only denial read. Always DENY; revocation generation is DB intent, not host or CDN revocation proof.';
