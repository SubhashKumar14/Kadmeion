-- B4: DB-only, private integrity binding. NOT a public release or trusted host.
-- Callers must FIRST rebuild and verify HTML against the attested frozen owner
-- snapshot and pinned server render plan. SQL independently hashes the supplied
-- bytes, verifies source pins and pointer generation, but CANNOT prove who rendered.
-- Only the unexposed trusted service role may call. No LIVE state or URL results.

create table kadmeion_private.private_artifact_bindings (
  portfolio_id uuid not null,
  owner_user_id uuid not null,
  request_id uuid not null,
  pointer_generation bigint not null check(pointer_generation > 0),
  manifest_sha256 text not null check(manifest_sha256 ~ '^[0-9a-f]{64}$'),
  html_sha256 text not null check(html_sha256 ~ '^[0-9a-f]{64}$'),
  html_byte_length integer not null check(html_byte_length between 1 and 750000),
  bound_at timestamptz not null default transaction_timestamp(),
  primary key (portfolio_id,pointer_generation),
  foreign key (request_id,portfolio_id,owner_user_id)
    references public.private_release_requests(id,portfolio_id,owner_user_id)
    on delete cascade
);
create index kd_private_artifact_binding_request_idx on
  kadmeion_private.private_artifact_bindings(request_id,pointer_generation desc);
alter table kadmeion_private.private_artifact_bindings enable row level security;
revoke all on table kadmeion_private.private_artifact_bindings
  from public,anon,authenticated;
comment on table kadmeion_private.private_artifact_bindings is
  'History of service-role-verified private artifact byte and pointer matches. NOT host delivery permission or evidence of immutable CDN content.';

create function kadmeion_private.bind_private_artifact_candidate(
  p_request_id uuid,
  p_expected_generation bigint,
  p_manifest_json text,
  p_html text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_source record;
  v_pointer public.private_release_visibility_pointers%rowtype;
  v_manifest jsonb;
  v_expected jsonb;
  v_manifest_sha text;
  v_html_sha text;
  v_html_size integer;
  v_inserted integer;
  v_existing kadmeion_private.private_artifact_bindings%rowtype;
begin
  if p_request_id is null or p_expected_generation is null or
     p_expected_generation<1 or p_expected_generation>9223372036854775806
     or p_manifest_json is null or
     octet_length(p_manifest_json)<2 or octet_length(p_manifest_json)>8192
     or p_html is null or octet_length(p_html)<1 or octet_length(p_html)>750000 then
    raise exception using errcode='22023',message='PRIVATE_ARTIFACT_INPUT_INVALID';
  end if;
  -- Match lock ordering of owner prepare/block and Trash: portfolio before
  -- pointer. Race with a revocation can never create a binding to the new generation.
  select r.portfolio_id,r.owner_user_id,r.revision,r.snapshot_sha256,
         r.visibility_intent,r.status,p.trashed_at,
         rev.snapshot as stored_snapshot,rev.snapshot_sha256 as revision_sha
    into v_source
    from public.private_release_requests r
    join public.portfolios p on p.id=r.portfolio_id and p.owner_user_id=r.owner_user_id
    join public.portfolio_revisions rev on
      rev.portfolio_id=r.portfolio_id and rev.owner_user_id=r.owner_user_id
      and rev.revision=r.revision
    where r.id=p_request_id for update of p;
  if not found or v_source.trashed_at is not null or v_source.status<>'FROZEN' then
    raise exception using errcode='42501',message='PRIVATE_FROZEN_REQUEST_UNAVAILABLE';
  end if;
  if v_source.revision_sha is distinct from v_source.snapshot_sha256
     or encode(sha256(convert_to(v_source.stored_snapshot::text,'UTF8')),'hex')
       is distinct from v_source.snapshot_sha256 then
    raise exception using errcode='22000',message='PRIVATE_FROZEN_SNAPSHOT_INTEGRITY';
  end if;
  select * into v_pointer from public.private_release_visibility_pointers
    where portfolio_id=v_source.portfolio_id and owner_user_id=v_source.owner_user_id
    for update;
  if not found or v_pointer.status<>'PREPARED_PRIVATE'
     or v_pointer.candidate_request_id is distinct from p_request_id
     or v_pointer.generation<>p_expected_generation then
    raise exception using errcode='40001',message='PRIVATE_ARTIFACT_POINTER_CONFLICT';
  end if;

  v_html_size:=octet_length(p_html);
  v_html_sha:=encode(sha256(convert_to(p_html,'UTF8')),'hex');
  v_manifest_sha:=encode(sha256(convert_to(p_manifest_json,'UTF8')),'hex');
  -- Parse + compare the EXACT expected schema. JSONB equality rejects extra
  -- keys while exact-text SHA-256 binds the JS-produced manifest bytes.
  begin
    v_manifest:=p_manifest_json::jsonb;
  exception when others then
    raise exception using errcode='22023',message='PRIVATE_ARTIFACT_MANIFEST_INVALID';
  end;
  v_expected:=jsonb_build_object(
    'kind','kadmeion-private-immutable-artifact-candidate','formatVersion',1,
    'source',jsonb_build_object(
      'portfolioId',v_source.portfolio_id,'revision',v_source.revision,
      'snapshotSha256',v_source.snapshot_sha256,
      'visibilityIntent',v_source.visibility_intent),
    'files',jsonb_build_array(jsonb_build_object(
      'path','index.html','byteLength',v_html_size,'sha256',v_html_sha)),
    'deployable',false,'publicUrl',null
  );
  if v_manifest is distinct from v_expected
     or v_pointer.candidate_manifest_sha256 is distinct from v_manifest_sha then
    raise exception using errcode='22023',message='PRIVATE_ARTIFACT_MANIFEST_MISMATCH';
  end if;

  insert into kadmeion_private.private_artifact_bindings(
    portfolio_id,owner_user_id,request_id,pointer_generation,
    manifest_sha256,html_sha256,html_byte_length
  ) values(
    v_source.portfolio_id,v_source.owner_user_id,p_request_id,
    p_expected_generation,v_manifest_sha,v_html_sha,v_html_size
  ) on conflict(portfolio_id,pointer_generation) do nothing;
  get diagnostics v_inserted=ROW_COUNT;
  if v_inserted=0 then
    select * into v_existing from kadmeion_private.private_artifact_bindings
      where portfolio_id=v_source.portfolio_id
        and pointer_generation=p_expected_generation;
    if not found or v_existing.request_id is distinct from p_request_id
       or v_existing.manifest_sha256 is distinct from v_manifest_sha
       or v_existing.html_sha256 is distinct from v_html_sha
       or v_existing.html_byte_length<>v_html_size then
      raise exception using errcode='23505',message='PRIVATE_ARTIFACT_BINDING_REUSED';
    end if;
  end if;
  return jsonb_build_object(
    'portfolioId',v_source.portfolio_id,'requestId',p_request_id,
    'generation',p_expected_generation,
    'manifestSha256',v_manifest_sha,'htmlSha256',v_html_sha,
    'status','BOUND_PRIVATE','alreadyBound',(v_inserted=0),
    'integrityChecked',true,'publicServingEnabled',false,
    'publicUrl',null,'hostRevocationVerified',false
  );
end;
$$;
revoke all on function kadmeion_private.bind_private_artifact_candidate(
  uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function kadmeion_private.bind_private_artifact_candidate(
  uuid,bigint,text,text) to service_role;
comment on function kadmeion_private.bind_private_artifact_candidate(
  uuid,bigint,text,text) is
  'Requires a trusted worker to verify renderer provenance BEFORE calling. DB independently checks exact manifest/HTML SHA, frozen source and current private pointer. Never allows serving or claims host revocation.';
