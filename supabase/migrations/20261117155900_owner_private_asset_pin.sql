-- C04 / WF-021: read-only trusted PROJECT pin; PROFILE deliberately denied.
-- No digest supplied by the browser, no public delivery or new writer.
create function public.read_owner_private_asset_pin(
  p_scope text,p_asset_id uuid,p_project_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid := (select auth.uid());
  v_session uuid;
  r record;
begin
  begin
    v_session:=kadmeion_private.require_live_exit_auth_session();
  exception when insufficient_privilege then
    raise exception using errcode='42501',message='PRIVATE_ASSET_NOT_FOUND';
  end;
  if p_scope is null or p_scope not in ('PROJECT','PROFILE') or p_asset_id is null
    or (p_scope='PROJECT' and p_project_id is null)
    or (p_scope='PROFILE' and p_project_id is not null) then
    raise exception using errcode='22023',message='INVALID_PRIVATE_ASSET_PIN_REQUEST';
  end if;
  -- Single joined statement: current registry, owner/session, object and pin.
  select a.mime_type,a.byte_size,o.id as object_id,o.version::text as object_version,
    o.owner_id,o.metadata,t.asset_id as pin_id,t.owner_user_id as pin_owner,
    t.storage_object_id as pin_object,t.storage_version as pin_version,t.expected_sha256
  into r
  from public.project_assets a
  join public.projects p on p.id=a.project_id and p.owner_user_id=a.owner_user_id
  join auth.users u on u.id=a.owner_user_id
  join auth.sessions s on s.user_id=u.id and s.id=v_session
  left join storage.objects o on o.bucket_id='kadmeion-private-assets' and o.name=a.object_path
  left join kadmeion_private.private_asset_content_attestations t on t.asset_id=a.id
  where p_scope='PROJECT' and a.id=p_asset_id and a.project_id=p_project_id
    and a.owner_user_id=v_owner and p.trashed_at is null
    and (s.not_after is null or s.not_after>clock_timestamp())
    and a.object_path ~ ('^'||v_owner::text||'/'||p_project_id::text||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]'||
      '(img|'||(case a.mime_type when 'image/png' then 'png' when 'image/jpeg' then 'jpg'
        when 'image/webp' then 'webp' else 'img' end)||')$');
  if not found then
    raise exception using errcode='42501',message='PRIVATE_ASSET_NOT_FOUND';
  end if;
  if r.mime_type not in ('image/png','image/jpeg','image/webp')
    or r.byte_size not between 12 and 5242880
    or r.object_id is null or r.object_version is null
    or length(r.object_version) not between 1 and 128
    or r.owner_id is distinct from v_owner::text
    or lower(r.metadata->>'mimetype') is distinct from r.mime_type
    or (case when coalesce(r.metadata->>'size','') ~ '^[0-9]{1,10}$'
         then (r.metadata->>'size')::bigint else null end) is distinct from r.byte_size
    or (r.pin_id is not null and (r.pin_owner is distinct from v_owner
      or r.pin_object is distinct from r.object_id or r.pin_version is distinct from r.object_version
      or r.expected_sha256 is null or r.expected_sha256 !~ '^[0-9a-f]{64}$')) then
    raise exception using errcode='22023',message='PRIVATE_ASSET_PIN_INTEGRITY';
  end if;
  return jsonb_build_object('scope','PROJECT','assetId',p_asset_id,'ownerUserId',v_owner,
    'projectId',p_project_id,'objectId',r.object_id,'version',r.object_version,
    'mimeType',r.mime_type,'byteSize',r.byte_size,
    'status',case when r.pin_id is null then 'UNPINNED' else 'SERVER_HASH_PINNED' end,
    'expectedSha256',r.expected_sha256,'publicDeliveryAllowed',false);
end;
$$;
revoke all on function public.read_owner_private_asset_pin(text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.read_owner_private_asset_pin(text,uuid,uuid) to authenticated;
comment on function public.read_owner_private_asset_pin(text,uuid,uuid) is
  'Owner-session-bound PROJECT attestation lookup; no public delivery, write or PROFILE fallback.';
