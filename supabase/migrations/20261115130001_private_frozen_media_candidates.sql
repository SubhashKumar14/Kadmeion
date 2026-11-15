-- Private immutable media candidates. The public release and reviewer readers
-- cannot use these rows until a separate host activation contract is verified.
create table kadmeion_private.frozen_media_candidates (
  portfolio_id uuid not null,
  owner_user_id uuid not null,
  request_id uuid not null,
  generation bigint not null check (generation > 0),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  manifest_json text not null check (octet_length(manifest_json) between 2 and 16384),
  files bytea[] not null check (cardinality(files) between 2 and 9),
  created_at timestamptz not null default transaction_timestamp(),
  primary key (portfolio_id, generation),
  foreign key (request_id, portfolio_id, owner_user_id)
    references public.private_release_requests(id, portfolio_id, owner_user_id) on delete cascade
);
create index frozen_media_candidates_request_idx
  on kadmeion_private.frozen_media_candidates(request_id);
alter table kadmeion_private.frozen_media_candidates enable row level security;
revoke all on kadmeion_private.frozen_media_candidates from public, anon, authenticated, service_role;

create function kadmeion_private.store_frozen_media_candidate(
  p_request_id uuid, p_generation bigint, p_manifest text, p_files bytea[]
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  source record;
  pointer public.private_release_visibility_pointers%rowtype;
  stored kadmeion_private.frozen_media_candidates%rowtype;
  manifest jsonb;
  file_manifest jsonb := '[]';
  file_sha text;
  manifest_sha text;
  file_bytes integer;
  image_total integer := 0;
  paths text[] := array[]::text[];
  i integer;
begin
  if p_request_id is null or p_generation is null or p_generation < 1
    or p_manifest is null or octet_length(p_manifest) not between 2 and 16384
    or p_files is null or coalesce(array_ndims(p_files),0) <> 1
    or array_lower(p_files,1) <> 1 or cardinality(p_files) not between 2 and 9 then
    raise exception using errcode='22023', message='FROZEN_MEDIA_INPUT_INVALID';
  end if;
  manifest := p_manifest::jsonb;
  manifest_sha := encode(sha256(convert_to(p_manifest,'UTF8')),'hex');

  select r.portfolio_id, r.owner_user_id, r.revision, r.snapshot_sha256,
         r.visibility_intent, r.status, p.trashed_at, rev.snapshot, rev.snapshot_sha256 as revision_sha
    into source
    from public.private_release_requests r
    join public.portfolios p on p.id=r.portfolio_id and p.owner_user_id=r.owner_user_id
    join public.portfolio_revisions rev on rev.portfolio_id=r.portfolio_id
      and rev.owner_user_id=r.owner_user_id and rev.revision=r.revision
    where r.id=p_request_id
    for update of p;
  if not found or source.trashed_at is not null or source.status <> 'FROZEN'
    or exists (select 1 from kadmeion_private.moderation_portfolio_holds
      where portfolio_id=source.portfolio_id) then
    raise exception using errcode='42501', message='FROZEN_MEDIA_SOURCE_UNAVAILABLE';
  end if;
  if source.revision_sha is distinct from source.snapshot_sha256
    or encode(sha256(convert_to(source.snapshot::text,'UTF8')),'hex') is distinct from source.snapshot_sha256 then
    raise exception using errcode='22000', message='FROZEN_MEDIA_SNAPSHOT_INVALID';
  end if;
  select * into pointer from public.private_release_visibility_pointers
    where portfolio_id=source.portfolio_id and owner_user_id=source.owner_user_id
    for update;
  if not found or pointer.status <> 'PREPARED_PRIVATE'
    or pointer.candidate_request_id is distinct from p_request_id
    or pointer.candidate_manifest_sha256 is distinct from manifest_sha
    or pointer.generation <> p_generation or pointer.revocation_generation >= p_generation then
    raise exception using errcode='40001', message='FROZEN_MEDIA_POINTER_CONFLICT';
  end if;

  for i in 1..cardinality(p_files) loop
    file_bytes := octet_length(p_files[i]);
    if file_bytes is null or file_bytes < 1 or
      (i=1 and file_bytes > 750000) or
      (i>1 and (file_bytes > 5242880
        or substring(p_files[i] from 1 for 8) <> decode('89504e470d0a1a0a','hex'))) then
      raise exception using errcode='22023', message='FROZEN_MEDIA_FILE_INVALID';
    end if;
    file_sha := encode(sha256(p_files[i]),'hex');
    paths := array_append(paths,case when i=1 then 'index.html' else 'assets/'||file_sha||'.png' end);
    if i>1 and paths[i] = any(paths[1:i-1]) then
      raise exception using errcode='22023', message='FROZEN_MEDIA_DUPLICATE_FILE';
    end if;
    file_manifest := file_manifest || jsonb_build_array(
      jsonb_build_object('path',paths[i],'byteLength',file_bytes,'sha256',file_sha));
    if i>1 then image_total := image_total + file_bytes; end if;
  end loop;
  if image_total > 8388608 or jsonb_typeof(manifest->'media') is distinct from 'array'
    or manifest is distinct from jsonb_build_object(
      'kind','kadmeion-private-media-artifact-candidate','formatVersion',1,
      'source',jsonb_build_object('portfolioId',source.portfolio_id,'revision',source.revision,
        'snapshotSha256',source.snapshot_sha256,'visibilityIntent',source.visibility_intent),
      'files',file_manifest,'media',manifest->'media','deployable',false,'publicUrl',null) then
    raise exception using errcode='22023', message='FROZEN_MEDIA_MANIFEST_INVALID';
  end if;
  if jsonb_array_length(manifest->'media') not between 1 and 8
    or exists (select 1 from jsonb_array_elements(manifest->'media') as item(value)
      where not coalesce(item.value->>'path' = any(paths[2:cardinality(paths)]),false))
    or exists (select 1 from unnest(paths[2:cardinality(paths)]) as asset(path)
      where not exists (select 1 from jsonb_array_elements(manifest->'media') as item(value)
        where item.value->>'path'=asset.path)) then
    raise exception using errcode='22023', message='FROZEN_MEDIA_MANIFEST_INVALID';
  end if;
  select * into stored from kadmeion_private.frozen_media_candidates
    where portfolio_id=source.portfolio_id and generation=p_generation;
  if found then
    if stored.request_id is distinct from p_request_id
      or stored.manifest_json is distinct from p_manifest or stored.files is distinct from p_files then
      raise exception using errcode='23505', message='FROZEN_MEDIA_GENERATION_REUSED';
    end if;
    return jsonb_build_object('status','STORED_PRIVATE','manifestSha256',manifest_sha,
      'generation',p_generation,'alreadyStored',true,'publicServingEnabled',false);
  end if;
  if (select count(*) from kadmeion_private.frozen_media_candidates
      where portfolio_id=source.portfolio_id) >= 5 then
    raise exception using errcode='54000', message='FROZEN_MEDIA_CANDIDATE_LIMIT';
  end if;
  insert into kadmeion_private.frozen_media_candidates
    (portfolio_id,owner_user_id,request_id,generation,manifest_sha256,manifest_json,files)
  values (source.portfolio_id,source.owner_user_id,p_request_id,p_generation,manifest_sha,p_manifest,p_files);
  return jsonb_build_object('status','STORED_PRIVATE','manifestSha256',manifest_sha,
    'generation',p_generation,'alreadyStored',false,'publicServingEnabled',false);
end;
$function$;

revoke all on function kadmeion_private.store_frozen_media_candidate(uuid,bigint,text,bytea[])
  from public, anon, authenticated;
grant execute on function kadmeion_private.store_frozen_media_candidate(uuid,bigint,text,bytea[])
  to service_role;
