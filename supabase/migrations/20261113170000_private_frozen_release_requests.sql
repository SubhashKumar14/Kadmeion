-- B4 stage-0: immutable owner-private release requests.
-- No public renderer, reviewer token, host pointer, public route or Storage artifact is granted here.
create table public.private_release_requests (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  owner_user_id uuid not null,
  operation_id uuid not null,
  revision bigint not null check (revision > 0),
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  visibility_intent text not null check (visibility_intent in ('PUBLIC','UNLISTED')),
  status text not null default 'FROZEN' check (status = 'FROZEN'),
  created_at timestamptz not null default now(),
  foreign key (portfolio_id,owner_user_id)
    references public.portfolios(id,owner_user_id) on delete cascade,
  unique (portfolio_id,operation_id)
);
create index private_release_requests_owner_idx on
  public.private_release_requests(owner_user_id,portfolio_id,created_at desc);
alter table public.private_release_requests enable row level security;
revoke all on public.private_release_requests from public,anon,authenticated;
grant select on public.private_release_requests to authenticated;
create policy private_release_owner_read on public.private_release_requests
  for select to authenticated using ((select auth.uid())=owner_user_id);
comment on table public.private_release_requests is
  'Owner-only immutable intent pinned to an existing revision. FROZEN does not mean built, staged, verified, uploaded or published.';

create function public.freeze_private_release_request(
  p_portfolio_id uuid,p_operation_id uuid,p_revision bigint,p_visibility_intent text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_portfolio public.portfolios%rowtype;
  v_previous public.private_release_requests%rowtype;
  v_sha text;
  v_id uuid;
begin
  if v_owner is null then
    raise exception using errcode='42501',message='AUTH_REQUIRED';
  end if;
  if p_portfolio_id is null or p_operation_id is null or p_revision is null or p_revision<1
      or p_visibility_intent is null or p_visibility_intent not in ('PUBLIC','UNLISTED') then
    raise exception using errcode='22023',message='INVALID_FREEZE_REQUEST';
  end if;
  -- Serialize against Trash and duplicate operation IDs for this portfolio.
  select * into v_portfolio from public.portfolios
    where id=p_portfolio_id and owner_user_id=v_owner for update;
  if not found then
    raise exception using errcode='42501',message='PRIVATE_PORTFOLIO_NOT_FOUND';
  end if;
  if v_portfolio.trashed_at is not null then
    raise exception using errcode='55000',message='PRIVATE_ITEM_TRASHED';
  end if;

  select * into v_previous from public.private_release_requests
    where portfolio_id=p_portfolio_id and owner_user_id=v_owner and operation_id=p_operation_id;
  if found then
    if v_previous.revision<>p_revision or v_previous.visibility_intent<>p_visibility_intent then
      raise exception using errcode='23505',message='RELEASE_OPERATION_ID_REUSED';
    end if;
    return jsonb_build_object('requestId',v_previous.id,'portfolioId',p_portfolio_id,
      'revision',v_previous.revision,'snapshotSha256',v_previous.snapshot_sha256,
      'visibilityIntent',v_previous.visibility_intent,'status','FROZEN','publicUrl',null,
      'alreadyFrozen',true);
  end if;

  select snapshot_sha256 into v_sha from public.portfolio_revisions
    where portfolio_id=p_portfolio_id and owner_user_id=v_owner and revision=p_revision;
  if not found or v_sha is null then
    raise exception using errcode='22023',message='PRIVATE_REVISION_UNAVAILABLE';
  end if;
  -- Hard cap bounds untrusted actor storage; no paid background job or auto-expiry claimed.
  if (select count(*) from public.private_release_requests
      where portfolio_id=p_portfolio_id and owner_user_id=v_owner)>=100 then
    raise exception using errcode='54000',message='PRIVATE_FREEZE_QUOTA_REACHED';
  end if;
  insert into public.private_release_requests (
    portfolio_id,owner_user_id,operation_id,revision,snapshot_sha256,visibility_intent
  ) values (
    p_portfolio_id,v_owner,p_operation_id,p_revision,v_sha,p_visibility_intent
  ) returning id into v_id;

  return jsonb_build_object('requestId',v_id,'portfolioId',p_portfolio_id,
    'revision',p_revision,'snapshotSha256',v_sha,
    'visibilityIntent',p_visibility_intent,'status','FROZEN',
    'publicUrl',null,'alreadyFrozen',false);
end;
$$;
revoke all on function public.freeze_private_release_request(uuid,uuid,bigint,text) from public,anon;
grant execute on function public.freeze_private_release_request(uuid,uuid,bigint,text) to authenticated;
comment on function public.freeze_private_release_request(uuid,uuid,bigint,text) is
  'Signed-in owner only. Lock and pin an existing immutable revision. Explicitly DOES NOT publish or create a public route.';
