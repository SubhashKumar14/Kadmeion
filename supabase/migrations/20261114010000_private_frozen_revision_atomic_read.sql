-- B4 owner-only atomic frozen revision read. This RPC is NOT a public
-- renderer, staging token validator, publishing gate or revocation proof.
-- One database statement/transaction pins the same owner, portfolio and
-- immutable snapshot; the portfolio row lock serializes with private Trash.
create function public.load_private_frozen_revision(p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_row record;
  v_calculated_sha text;
begin
  if v_owner is null then
    raise exception using errcode='42501',message='AUTH_REQUIRED';
  end if;
  if p_request_id is null then
    raise exception using errcode='22023',message='INVALID_FROZEN_REQUEST';
  end if;
  select r.id,r.portfolio_id,r.revision,r.snapshot_sha256,
         r.visibility_intent,r.status,p.trashed_at,
         rev.snapshot,rev.snapshot_sha256 as revision_sha256
    into v_row
    from public.private_release_requests r
    join public.portfolios p
      on p.id=r.portfolio_id and p.owner_user_id=r.owner_user_id
    join public.portfolio_revisions rev
      on rev.portfolio_id=r.portfolio_id
      and rev.owner_user_id=r.owner_user_id and rev.revision=r.revision
    where r.id=p_request_id and r.owner_user_id=v_owner
    for share of p;
  if not found then
    raise exception using errcode='42501',message='PRIVATE_FROZEN_REVISION_NOT_FOUND';
  end if;
  if v_row.trashed_at is not null then
    raise exception using errcode='42501',message='PRIVATE_FROZEN_REVISION_NOT_FOUND';
  end if;
  -- Recompute the digest using the exact canonical jsonb::text encoding used
  -- by commit_portfolio_revision. A matching pair of stored SHA columns alone
  -- does not prove that snapshot bytes are intact.
  v_calculated_sha := encode(sha256(convert_to(v_row.snapshot::text,'UTF8')),'hex');
  if v_row.revision_sha256 is distinct from v_row.snapshot_sha256
     or v_calculated_sha is distinct from v_row.snapshot_sha256
     or v_row.status <> 'FROZEN' then
    raise exception using errcode='22000',message='PRIVATE_FROZEN_REVISION_INTEGRITY';
  end if;
  return jsonb_build_object(
    'requestId',v_row.id,'portfolioId',v_row.portfolio_id,
    'revision',v_row.revision,'snapshotSha256',v_row.snapshot_sha256,
    'visibilityIntent',v_row.visibility_intent,'status','FROZEN',
    'publicUrl',null,'snapshot',v_row.snapshot
  );
end;
$$;
revoke all on function public.load_private_frozen_revision(uuid) from public,anon;
grant execute on function public.load_private_frozen_revision(uuid) to authenticated;
comment on function public.load_private_frozen_revision(uuid) is
  'Authenticated owner-only, single-transaction immutable snapshot read with SHA recomputation. Never public-serving authority.';
