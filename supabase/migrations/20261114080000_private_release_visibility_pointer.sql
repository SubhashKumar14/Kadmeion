-- B4 private transactional release-candidate pointer. This is NOT a public release.
-- No anonymous read, trusted host reader, LIVE state, CDN purge, or public URL.
-- The manifest digest is owner-submitted and UNVERIFIED by the database.
-- Every future host must independently verify artifacts and revocation.
alter table public.private_release_requests
  add constraint kd_private_release_request_scope
  unique (id,portfolio_id,owner_user_id);

create table public.private_release_visibility_pointers (
  portfolio_id uuid primary key,
  owner_user_id uuid not null,
  status text not null check (status in ('BLOCKED','PREPARED_PRIVATE')),
  candidate_request_id uuid,
  candidate_manifest_sha256 text check (candidate_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  generation bigint not null check (generation between 1 and 9223372036854775806),
  revocation_generation bigint not null default 0
    check (revocation_generation >= 0 and revocation_generation <= generation),
  updated_at timestamptz not null default now(),
  foreign key (portfolio_id,owner_user_id)
    references public.portfolios(id,owner_user_id) on delete cascade,
  foreign key (candidate_request_id,portfolio_id,owner_user_id)
    references public.private_release_requests(id,portfolio_id,owner_user_id),
  check ((status='BLOCKED' and candidate_request_id is null and candidate_manifest_sha256 is null)
    or (status='PREPARED_PRIVATE' and candidate_request_id is not null
      and candidate_manifest_sha256 is not null))
);
create index kd_private_pointer_owner on
  public.private_release_visibility_pointers(owner_user_id,updated_at desc);
alter table public.private_release_visibility_pointers enable row level security;
revoke all on public.private_release_visibility_pointers from public,anon,authenticated;
grant select on public.private_release_visibility_pointers to authenticated;
create policy kd_private_pointer_owner_read on public.private_release_visibility_pointers
  for select to authenticated using ((select auth.uid())=owner_user_id);
comment on table public.private_release_visibility_pointers is
  'Owner-only candidate/denial pointer. PREPARED_PRIVATE never means live, uploaded, verified or host-authorized. Revocation generation is database intent, not CDN proof.';

create table public.private_release_visibility_events (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  owner_user_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  operation_id uuid not null,
  event_type text not null check (event_type in ('PREPARE','OWNER_BLOCK','TRASH_BLOCK')),
  expected_generation bigint,
  resulting_generation bigint not null check (resulting_generation >= 1),
  candidate_request_id uuid,
  candidate_manifest_sha256 text,
  created_at timestamptz not null default now(),
  foreign key (portfolio_id,owner_user_id)
    references public.portfolios(id,owner_user_id) on delete cascade,
  unique (portfolio_id,operation_id)
);
create index kd_private_pointer_events_owner on
  public.private_release_visibility_events(owner_user_id,portfolio_id,created_at desc);
alter table public.private_release_visibility_events enable row level security;
revoke all on public.private_release_visibility_events from public,anon,authenticated;
grant select on public.private_release_visibility_events to authenticated;
create policy kd_private_pointer_events_owner_read on public.private_release_visibility_events
  for select to authenticated using ((select auth.uid())=owner_user_id);

create function public.owner_prepare_private_release_pointer(
  p_portfolio_id uuid,p_request_id uuid,p_manifest_sha256 text,
  p_expected_generation bigint,p_operation_id uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_portfolio public.portfolios%rowtype;
  v_event public.private_release_visibility_events%rowtype;
  v_pointer public.private_release_visibility_pointers%rowtype;
  v_request record;
  v_generation bigint;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if p_portfolio_id is null or p_request_id is null or p_operation_id is null or
     p_manifest_sha256 is null or p_manifest_sha256 !~ '^[0-9a-f]{64}$' or
     p_expected_generation is null or p_expected_generation<0 then
    raise exception using errcode='22023',message='INVALID_PRIVATE_POINTER_PREPARE';
  end if;
  -- Portfolio lock serializes prepare, block, and Trash. No public authority.
  select * into v_portfolio from public.portfolios
    where id=p_portfolio_id and owner_user_id=v_owner for update;
  if not found then raise exception using errcode='42501',message='PRIVATE_PORTFOLIO_NOT_FOUND'; end if;
  if v_portfolio.trashed_at is not null then
    raise exception using errcode='55000',message='PRIVATE_ITEM_TRASHED'; end if;

  select * into v_event from public.private_release_visibility_events
    where portfolio_id=p_portfolio_id and operation_id=p_operation_id;
  if found then
    if v_event.actor_user_id is distinct from v_owner or v_event.event_type<>'PREPARE'
      or v_event.expected_generation is distinct from p_expected_generation
      or v_event.candidate_request_id is distinct from p_request_id
      or v_event.candidate_manifest_sha256 is distinct from p_manifest_sha256 then
      raise exception using errcode='23505',message='PRIVATE_POINTER_OPERATION_REUSED'; end if;
    -- A historical idempotency receipt must not falsely claim that a later
    -- block, Trash or different prepare left this candidate current.
    perform 1 from public.private_release_visibility_pointers
      where portfolio_id=p_portfolio_id and generation=v_event.resulting_generation
        and status='PREPARED_PRIVATE' and candidate_request_id=p_request_id
        and candidate_manifest_sha256=p_manifest_sha256;
    if not found then
      raise exception using errcode='40001',message='PRIVATE_POINTER_CONFLICT'; end if;
    return jsonb_build_object('portfolioId',p_portfolio_id,'generation',
      v_event.resulting_generation,'status','PREPARED_PRIVATE',
      'alreadyRecorded',true,'publicServingEnabled',false,'publicUrl',null,
      'hostRevocationVerified',false);
  end if;

  -- A frozen request must be owned by this exact portfolio; recompute its
  -- canonical DB revision hash rather than trusting a client-supplied pin.
  select r.snapshot_sha256 as frozen_sha,rev.snapshot_sha256 as revision_sha,
         rev.snapshot as snapshot
    into v_request from public.private_release_requests r
    join public.portfolio_revisions rev
      on rev.portfolio_id=r.portfolio_id and rev.owner_user_id=r.owner_user_id
      and rev.revision=r.revision
    where r.id=p_request_id and r.portfolio_id=p_portfolio_id
      and r.owner_user_id=v_owner and r.status='FROZEN';
  if not found or v_request.frozen_sha is distinct from v_request.revision_sha
     or v_request.frozen_sha is distinct from
       encode(sha256(convert_to(v_request.snapshot::text,'UTF8')),'hex') then
    raise exception using errcode='42501',message='PRIVATE_FROZEN_REQUEST_UNAVAILABLE'; end if;

  select * into v_pointer from public.private_release_visibility_pointers
    where portfolio_id=p_portfolio_id for update;
  v_generation:=case when found then v_pointer.generation else 0 end;
  if v_generation<>p_expected_generation then
    raise exception using errcode='40001',message='PRIVATE_POINTER_CONFLICT'; end if;
  if v_generation>=9223372036854775806 then
    raise exception using errcode='54000',message='PRIVATE_POINTER_GENERATION_LIMIT'; end if;
  if v_generation=0 then
    insert into public.private_release_visibility_pointers(
      portfolio_id,owner_user_id,status,candidate_request_id,
      candidate_manifest_sha256,generation
    ) values (p_portfolio_id,v_owner,'PREPARED_PRIVATE',p_request_id,
      p_manifest_sha256,1);
  else
    update public.private_release_visibility_pointers set
      status='PREPARED_PRIVATE',candidate_request_id=p_request_id,
      candidate_manifest_sha256=p_manifest_sha256,generation=v_generation+1,
      updated_at=transaction_timestamp() where portfolio_id=p_portfolio_id;
  end if;
  insert into public.private_release_visibility_events(
    portfolio_id,owner_user_id,actor_user_id,operation_id,event_type,
    expected_generation,resulting_generation,candidate_request_id,candidate_manifest_sha256
  ) values (p_portfolio_id,v_owner,v_owner,p_operation_id,'PREPARE',
    p_expected_generation,v_generation+1,p_request_id,p_manifest_sha256);
  return jsonb_build_object('portfolioId',p_portfolio_id,'generation',v_generation+1,
    'status','PREPARED_PRIVATE','alreadyRecorded',false,
    'publicServingEnabled',false,'publicUrl',null,'hostRevocationVerified',false);
end;
$$;
revoke all on function public.owner_prepare_private_release_pointer(uuid,uuid,text,bigint,uuid)
  from public,anon;
grant execute on function public.owner_prepare_private_release_pointer(uuid,uuid,text,bigint,uuid)
  to authenticated;

create function public.owner_block_private_release_pointer(
  p_portfolio_id uuid,p_operation_id uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_event public.private_release_visibility_events%rowtype;
  v_pointer public.private_release_visibility_pointers%rowtype;
  v_generation bigint;
  v_current_status text;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if p_portfolio_id is null or p_operation_id is null then
    raise exception using errcode='22023',message='INVALID_PRIVATE_POINTER_BLOCK'; end if;
  perform 1 from public.portfolios
    where id=p_portfolio_id and owner_user_id=v_owner for update;
  if not found then raise exception using errcode='42501',message='PRIVATE_PORTFOLIO_NOT_FOUND'; end if;
  select * into v_event from public.private_release_visibility_events
    where portfolio_id=p_portfolio_id and operation_id=p_operation_id;
  if found then
    if v_event.actor_user_id is distinct from v_owner or v_event.event_type<>'OWNER_BLOCK'
      then raise exception using errcode='23505',message='PRIVATE_POINTER_OPERATION_REUSED'; end if;
    select status into v_current_status from public.private_release_visibility_pointers
      where portfolio_id=p_portfolio_id;
    return jsonb_build_object('portfolioId',p_portfolio_id,
      'generation',v_event.resulting_generation,'status',v_current_status,
      'stillBlocked',v_current_status='BLOCKED','alreadyRecorded',true,
      'publicServingEnabled',false,'publicUrl',null,'hostRevocationVerified',false);
  end if;
  select * into v_pointer from public.private_release_visibility_pointers
    where portfolio_id=p_portfolio_id for update;
  v_generation:=case when found then v_pointer.generation else 0 end;
  if v_generation>=9223372036854775806 then
    raise exception using errcode='54000',message='PRIVATE_POINTER_GENERATION_LIMIT'; end if;
  if v_generation=0 then
    insert into public.private_release_visibility_pointers(
      portfolio_id,owner_user_id,status,generation,revocation_generation
    ) values (p_portfolio_id,v_owner,'BLOCKED',1,1);
  else
    update public.private_release_visibility_pointers set status='BLOCKED',
      candidate_request_id=null,candidate_manifest_sha256=null,
      generation=v_generation+1,revocation_generation=v_generation+1,
      updated_at=transaction_timestamp() where portfolio_id=p_portfolio_id;
  end if;
  insert into public.private_release_visibility_events(
    portfolio_id,owner_user_id,actor_user_id,operation_id,event_type,
    expected_generation,resulting_generation
  ) values (p_portfolio_id,v_owner,v_owner,p_operation_id,'OWNER_BLOCK',
    v_generation,v_generation+1);
  return jsonb_build_object('portfolioId',p_portfolio_id,
    'generation',v_generation+1,'status','BLOCKED','stillBlocked',true,
    'alreadyRecorded',false,'publicServingEnabled',false,'publicUrl',null,
    'hostRevocationVerified',false);
end;
$$;
revoke all on function public.owner_block_private_release_pointer(uuid,uuid)
  from public,anon;
grant execute on function public.owner_block_private_release_pointer(uuid,uuid)
  to authenticated;

create function public.owner_read_private_release_pointer(p_portfolio_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_owner uuid := (select auth.uid());
  v_pointer public.private_release_visibility_pointers%rowtype;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if p_portfolio_id is null then
    raise exception using errcode='22023',message='INVALID_PRIVATE_POINTER_READ'; end if;
  perform 1 from public.portfolios
    where id=p_portfolio_id and owner_user_id=v_owner;
  if not found then raise exception using errcode='42501',message='PRIVATE_PORTFOLIO_NOT_FOUND'; end if;
  select * into v_pointer from public.private_release_visibility_pointers
    where portfolio_id=p_portfolio_id and owner_user_id=v_owner;
  return jsonb_build_object('portfolioId',p_portfolio_id,
    'status',case when found then v_pointer.status else 'BLOCKED' end,
    'generation',case when found then v_pointer.generation else 0 end,
    'revocationGeneration',case when found then v_pointer.revocation_generation else 0 end,
    'candidateRequestId',v_pointer.candidate_request_id,
    'candidateManifestSha256',v_pointer.candidate_manifest_sha256,
    'publicServingEnabled',false,'publicUrl',null,'hostRevocationVerified',false);
end;
$$;
revoke all on function public.owner_read_private_release_pointer(uuid) from public,anon;
grant execute on function public.owner_read_private_release_pointer(uuid) to authenticated;

-- Trash always clears a previously prepared candidate in the same transaction.
-- Restore never silently prepares or publishes it again.
create function kadmeion_private.block_private_pointer_on_trash()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_next bigint;
begin
  if old.trashed_at is null and new.trashed_at is not null then
    update public.private_release_visibility_pointers
      set status='BLOCKED',candidate_request_id=null,candidate_manifest_sha256=null,
        generation=generation+1,revocation_generation=generation+1,
        updated_at=transaction_timestamp()
      where portfolio_id=new.id and generation<9223372036854775806
      returning generation into v_next;
    if found then
      insert into public.private_release_visibility_events(
        portfolio_id,owner_user_id,actor_user_id,operation_id,event_type,
        resulting_generation
      ) values (new.id,new.owner_user_id,(select auth.uid()),gen_random_uuid(),
        'TRASH_BLOCK',v_next);
    elsif exists(select 1 from public.private_release_visibility_pointers
      where portfolio_id=new.id) then
      raise exception using errcode='54000',message='PRIVATE_POINTER_GENERATION_LIMIT';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function kadmeion_private.block_private_pointer_on_trash()
  from public,anon,authenticated;
create trigger kd_block_private_pointer_on_trash
  after update of trashed_at on public.portfolios
  for each row execute function kadmeion_private.block_private_pointer_on_trash();
