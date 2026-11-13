-- B4 private staging token registry: NOT a public reviewer URL or delivery service.
-- Only the database generates random 256-bit secrets; only SHA-256 is stored.
create table public.private_reviewer_grants (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.private_release_requests(id) on delete cascade,
  portfolio_id uuid not null,
  owner_user_id uuid not null,
  operation_id uuid not null,
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (portfolio_id,owner_user_id) references public.portfolios(id,owner_user_id) on delete cascade,
  unique (request_id,operation_id),
  constraint kd_reviewer_expiry_after_creation check (expires_at>created_at)
);
create index kd_review_owner_idx on public.private_reviewer_grants(owner_user_id,created_at desc);
alter table public.private_reviewer_grants enable row level security;
revoke all on public.private_reviewer_grants from public,anon,authenticated;
grant select (id,request_id,portfolio_id,expires_at,revoked_at,created_at)
  on public.private_reviewer_grants to authenticated;
grant select on public.private_reviewer_grants to service_role;
create policy kd_review_owner_read on public.private_reviewer_grants
  for select to authenticated using ((select auth.uid())=owner_user_id);
comment on table public.private_reviewer_grants is
 'Private metadata only. A staging route/asset resolver does not exist; raw tokens are never stored.';

create function public.issue_private_reviewer_grant(
  p_request_id uuid,p_operation_id uuid,p_valid_minutes integer
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_req public.private_release_requests%rowtype;
  v_previous public.private_reviewer_grants%rowtype;
  v_trashed timestamptz;
  v_token text;
  v_id uuid;
  v_expiry timestamptz;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if p_request_id is null or p_operation_id is null or p_valid_minutes is null or
     p_valid_minutes < 15 or p_valid_minutes > 10080 then
    raise exception using errcode='22023',message='INVALID_REVIEW_GRANT';
  end if;
  -- Lock the owned portfolio first to serialize against private Trash.
  select p.trashed_at into v_trashed from public.portfolios p
    join public.private_release_requests r
      on r.portfolio_id=p.id and r.owner_user_id=p.owner_user_id
    where r.id=p_request_id and r.owner_user_id=v_owner for share of p;
  if not found then raise exception using errcode='42501',message='PRIVATE_REQUEST_NOT_FOUND'; end if;
  if v_trashed is not null then raise exception using errcode='55000',message='PRIVATE_ITEM_TRASHED'; end if;

  select * into v_req from public.private_release_requests
    where id=p_request_id and owner_user_id=v_owner for update;
  if not found or v_req.status<>'FROZEN' then
    raise exception using errcode='42501',message='PRIVATE_REQUEST_NOT_FROZEN';
  end if;
  select * into v_previous from public.private_reviewer_grants
    where request_id=p_request_id and operation_id=p_operation_id and owner_user_id=v_owner;
  if found then
    return jsonb_build_object('grantId',v_previous.id,'requestId',p_request_id,
      'rawToken',null,'expiresAt',v_previous.expires_at,
      'status','REGISTERED_UNSERVABLE','alreadyRegistered',true);
  end if;
  if (select count(*) from public.private_reviewer_grants
      where request_id=p_request_id and revoked_at is null
        and expires_at>transaction_timestamp())>=5 then
    raise exception using errcode='54000',message='REVIEWER_GRANT_QUOTA_REACHED';
  end if;

  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  v_expiry:=transaction_timestamp() + make_interval(mins=>p_valid_minutes);
  insert into public.private_reviewer_grants(
    request_id,portfolio_id,owner_user_id,operation_id,token_sha256,expires_at
  ) values (
    p_request_id,v_req.portfolio_id,v_owner,p_operation_id,
    encode(extensions.digest(decode(v_token,'hex'),'sha256'),'hex'),v_expiry
  ) returning id into v_id;
  return jsonb_build_object('grantId',v_id,'requestId',p_request_id,
    'rawToken',v_token,'expiresAt',v_expiry,
    'status','REGISTERED_UNSERVABLE','alreadyRegistered',false);
end;
$$;
revoke all on function public.issue_private_reviewer_grant(uuid,uuid,integer) from public,anon;
grant execute on function public.issue_private_reviewer_grant(uuid,uuid,integer) to authenticated;

create function public.revoke_private_reviewer_grant(p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_grant public.private_reviewer_grants%rowtype;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if p_grant_id is null then raise exception using errcode='22023',message='INVALID_REVIEW_GRANT'; end if;
  select * into v_grant from public.private_reviewer_grants
    where id=p_grant_id and owner_user_id=v_owner for update;
  if not found then raise exception using errcode='42501',message='PRIVATE_REVIEW_GRANT_NOT_FOUND'; end if;
  if v_grant.revoked_at is null then
    update public.private_reviewer_grants set revoked_at=transaction_timestamp()
      where id=p_grant_id;
  end if;
  return jsonb_build_object('grantId',p_grant_id,'status','REVOKED',
    'publicRevocationVerified',false);
end;
$$;
revoke all on function public.revoke_private_reviewer_grant(uuid) from public,anon;
grant execute on function public.revoke_private_reviewer_grant(uuid) to authenticated;

-- Used only by a future trusted staging delivery worker.
-- Never returns owner source, rendered bytes, personal info or a release pointer.
create function kadmeion_private.reviewer_grant_active(
  p_grant_id uuid,p_raw_token text
) returns boolean language plpgsql security invoker set search_path=''
as $$
begin
  if p_grant_id is null or p_raw_token is null or p_raw_token !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  return exists (
    select 1 from public.private_reviewer_grants g
    join public.private_release_requests r on r.id=g.request_id
      and r.portfolio_id=g.portfolio_id and r.owner_user_id=g.owner_user_id
    join public.portfolios p on p.id=g.portfolio_id and p.owner_user_id=g.owner_user_id
    where g.id=p_grant_id and g.revoked_at is null
      and g.expires_at>transaction_timestamp()
      and r.status='FROZEN' and p.trashed_at is null
      and g.token_sha256=encode(extensions.digest(decode(p_raw_token,'hex'),'sha256'),'hex')
  );
end;
$$;
revoke all on function kadmeion_private.reviewer_grant_active(uuid,text)
  from public,anon,authenticated;
grant execute on function kadmeion_private.reviewer_grant_active(uuid,text) to service_role;
comment on function kadmeion_private.reviewer_grant_active(uuid,text) is
  'Service-role-only boolean token check, subject to expiry/revoke/Trash. No public staging delivery exists.';
