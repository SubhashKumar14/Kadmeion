-- B5: owner-only account-erasure REQUEST / withdrawal journal.
-- No access termination, account deletion, purge, host revocation, or backup erasure.
-- UI-112: this is distinct from the 15-day per-item Trash.
-- A verified reauthentication + route/direct-asset revocation + retention policy
-- are mandatory prerequisites to a future separately reviewed destructive worker.
create table public.private_account_erasure_requests (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  status text not null default 'REQUESTED_BLOCKED'
    check (status in ('REQUESTED_BLOCKED','WITHDRAWN')),
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdraw_operation_id uuid,
  public_revocation_verified boolean not null default false check (not public_revocation_verified),
  reauth_verified boolean not null default false check (not reauth_verified),
  access_terminated boolean not null default false check (not access_terminated),
  erasure_executed boolean not null default false check (not erasure_executed),
  retention_verified boolean not null default false check (not retention_verified),
  unique (owner_user_id,operation_id),
  check ((status='REQUESTED_BLOCKED' and withdrawn_at is null and withdraw_operation_id is null)
      or (status='WITHDRAWN' and withdrawn_at is not null and withdraw_operation_id is not null))
);
create unique index kd_erasure_one_active_owner
  on public.private_account_erasure_requests(owner_user_id)
  where status='REQUESTED_BLOCKED';
create index kd_erasure_owner_created
  on public.private_account_erasure_requests(owner_user_id,created_at desc);
alter table public.private_account_erasure_requests enable row level security;
revoke all on public.private_account_erasure_requests from public,anon,authenticated;
grant select (id,status,created_at,withdrawn_at,public_revocation_verified,
  reauth_verified,access_terminated,erasure_executed,retention_verified)
  on public.private_account_erasure_requests to authenticated;
create policy kd_erasure_owner_read on public.private_account_erasure_requests
  for select to authenticated using ((select auth.uid())=owner_user_id);
comment on table public.private_account_erasure_requests is
  'Private owner-only request and withdrawal journal. No purge worker, no verified reauth, no public-route/direct-asset revocation, no retention SLA. All proof flags permanently false in this migration.';

create function public.request_private_account_erasure(
  p_operation_id uuid,p_confirmation text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_previous public.private_account_erasure_requests%rowtype;
  v_active uuid;
  v_id uuid;
begin
  if v_owner is null then
    raise exception using errcode='42501',message='AUTH_REQUIRED';
  end if;
  if p_operation_id is null or p_confirmation is distinct from 'DELETE MY ACCOUNT' then
    raise exception using errcode='22023',message='INVALID_ERASURE_REQUEST';
  end if;
  -- Serialize same-owner requests and withdrawals; avoid concurrent active requests.
  perform 1 from public.profiles where user_id=v_owner for update;
  if not found then
    raise exception using errcode='42501',message='OWNER_PROFILE_NOT_FOUND';
  end if;
  select * into v_previous from public.private_account_erasure_requests
    where owner_user_id=v_owner and operation_id=p_operation_id for update;
  if found then
    return jsonb_build_object('requestId',v_previous.id,'status',v_previous.status,
      'alreadyRequested',true,'publicRevocationVerified',false,
      'reauthVerified',false,'accessTerminated',false,
      'erasureExecuted',false,'retentionVerified',false);
  end if;
  select id into v_active from public.private_account_erasure_requests
    where owner_user_id=v_owner and status='REQUESTED_BLOCKED' for update;
  if found then
    raise exception using errcode='23505',message='ACCOUNT_ERASURE_ALREADY_REQUESTED';
  end if;
  if (select count(*) from public.private_account_erasure_requests
      where owner_user_id=v_owner)>=5 then
    raise exception using errcode='54000',message='ACCOUNT_ERASURE_REQUEST_QUOTA_REACHED';
  end if;
  insert into public.private_account_erasure_requests(owner_user_id,operation_id)
    values (v_owner,p_operation_id) returning id into v_id;
  return jsonb_build_object('requestId',v_id,'status','REQUESTED_BLOCKED',
    'alreadyRequested',false,'publicRevocationVerified',false,
    'reauthVerified',false,'accessTerminated',false,
    'erasureExecuted',false,'retentionVerified',false);
end;
$$;
revoke all on function public.request_private_account_erasure(uuid,text)
  from public,anon,authenticated;
grant execute on function public.request_private_account_erasure(uuid,text)
  to authenticated;
comment on function public.request_private_account_erasure(uuid,text) is
  'Records a signed-in owner request only. Typed confirmation is NOT verified reauthentication; never delete, terminate access or claim public-route revocation.';

create function public.withdraw_private_account_erasure(
  p_request_id uuid,p_operation_id uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_request public.private_account_erasure_requests%rowtype;
  v_already boolean := false;
begin
  if v_owner is null then
    raise exception using errcode='42501',message='AUTH_REQUIRED';
  end if;
  if p_request_id is null or p_operation_id is null then
    raise exception using errcode='22023',message='INVALID_ERASURE_WITHDRAWAL';
  end if;
  perform 1 from public.profiles where user_id=v_owner for update;
  if not found then
    raise exception using errcode='42501',message='OWNER_PROFILE_NOT_FOUND';
  end if;
  select * into v_request from public.private_account_erasure_requests
    where id=p_request_id and owner_user_id=v_owner for update;
  if not found then
    raise exception using errcode='42501',message='PRIVATE_ERASURE_REQUEST_NOT_FOUND';
  end if;
  if v_request.status='WITHDRAWN' then
    if v_request.withdraw_operation_id is distinct from p_operation_id then
      raise exception using errcode='23505',message='ERASURE_WITHDRAWAL_OPERATION_REUSED';
    end if;
    v_already:=true;
  else
    update public.private_account_erasure_requests
      set status='WITHDRAWN',withdrawn_at=transaction_timestamp(),
        withdraw_operation_id=p_operation_id
      where id=p_request_id and owner_user_id=v_owner;
  end if;
  return jsonb_build_object('requestId',p_request_id,'status','WITHDRAWN',
    'alreadyWithdrawn',v_already,'publicRevocationVerified',false,
    'reauthVerified',false,'accessTerminated',false,
    'erasureExecuted',false,'retentionVerified',false);
end;
$$;
revoke all on function public.withdraw_private_account_erasure(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.withdraw_private_account_erasure(uuid,uuid)
  to authenticated;
comment on function public.withdraw_private_account_erasure(uuid,uuid) is
  'Owner-only withdrawal of an unprocessed request; never restores or publishes anything.';
