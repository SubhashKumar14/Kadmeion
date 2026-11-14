-- B5 owner-only, short-lived proof of a new Supabase Auth sign-in.
-- No destructive account worker, route revocation, or public publication.
create table public.private_account_exit_reauth_challenges (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  initial_session_id uuid not null,
  created_at timestamptz not null default transaction_timestamp(),
  expires_at timestamptz not null default (transaction_timestamp() + interval '5 minutes'),
  verified_session_id uuid,
  verified_at timestamptz,
  unique(owner_user_id,operation_id),
  check(expires_at>created_at),
  check((verified_session_id is null and verified_at is null) or
        (verified_session_id is not null and verified_at is not null))
);
create index kd_exit_reauth_owner_idx on
  public.private_account_exit_reauth_challenges(owner_user_id,expires_at desc);
alter table public.private_account_exit_reauth_challenges enable row level security;
revoke all on public.private_account_exit_reauth_challenges from public,anon,authenticated;
comment on table public.private_account_exit_reauth_challenges is
 'Owner-private five-minute challenge; a new live GoTrue session must be created after it. No automatic retention/purge claim, no account deletion or production activation.';

create function kadmeion_private.require_live_exit_auth_session()
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_claims jsonb := (select auth.jwt());
  v_raw text;
begin
  v_raw:=v_claims->>'session_id';
  if v_owner is null or coalesce(v_claims->>'role','')<>'authenticated'
    or coalesce(v_claims->>'is_anonymous','false')<>'false'
    or v_raw is null or v_raw !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    raise exception using errcode='42501',message='LIVE_SESSION_REQUIRED';
  end if;
  if not exists(select 1 from auth.sessions
      where id=v_raw::uuid and user_id=v_owner) then
    raise exception using errcode='42501',message='LIVE_SESSION_REQUIRED';
  end if;
  return v_raw::uuid;
end;
$$;
revoke all on function kadmeion_private.require_live_exit_auth_session()
  from public,anon,authenticated;

create function public.begin_private_account_exit_reauth(p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_session uuid;
  v_existing public.private_account_exit_reauth_challenges%rowtype;
  v_id uuid;
  v_expires timestamptz;
begin
  v_session:=kadmeion_private.require_live_exit_auth_session();
  if p_operation_id is null then
    raise exception using errcode='22023',message='INVALID_REAUTH_OPERATION';
  end if;
  perform 1 from public.profiles where user_id=v_owner for update;
  if not found then raise exception using errcode='42501',message='OWNER_PROFILE_NOT_FOUND'; end if;
  select * into v_existing from public.private_account_exit_reauth_challenges
    where owner_user_id=v_owner and operation_id=p_operation_id for update;
  if found then
    if v_existing.initial_session_id<>v_session or
        v_existing.expires_at<=clock_timestamp() then
      raise exception using errcode='23505',message='REAUTH_OPERATION_REUSED';
    end if;
    return jsonb_build_object('challengeId',v_existing.id,
      'status','AWAITING_NEW_SIGN_IN','expiresAt',v_existing.expires_at,
      'alreadyIssued',true,'deletionAllowed',false);
  end if;
  if (select count(*) from public.private_account_exit_reauth_challenges
    where owner_user_id=v_owner and expires_at>clock_timestamp()
      and verified_session_id is null)>=3 then
    raise exception using errcode='54000',message='REAUTH_CHALLENGE_QUOTA_REACHED';
  end if;
  insert into public.private_account_exit_reauth_challenges(
    owner_user_id,operation_id,initial_session_id
  ) values(v_owner,p_operation_id,v_session)
  returning id,expires_at into v_id,v_expires;
  return jsonb_build_object('challengeId',v_id,'status','AWAITING_NEW_SIGN_IN',
    'expiresAt',v_expires,'alreadyIssued',false,'deletionAllowed',false);
end;
$$;
revoke all on function public.begin_private_account_exit_reauth(uuid)
  from public,anon,authenticated;
grant execute on function public.begin_private_account_exit_reauth(uuid)
  to authenticated;

create function public.complete_private_account_exit_reauth(p_challenge_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_session uuid;
  v_session_created timestamptz;
  v_challenge public.private_account_exit_reauth_challenges%rowtype;
begin
  v_session:=kadmeion_private.require_live_exit_auth_session();
  if p_challenge_id is null then
    raise exception using errcode='22023',message='INVALID_REAUTH_CHALLENGE';
  end if;
  select * into v_challenge from public.private_account_exit_reauth_challenges
    where id=p_challenge_id and owner_user_id=v_owner for update;
  if not found then
    raise exception using errcode='42501',message='REAUTH_CHALLENGE_NOT_FOUND';
  end if;
  if v_challenge.expires_at<=clock_timestamp() then
    raise exception using errcode='55000',message='REAUTH_CHALLENGE_EXPIRED';
  end if;
  if v_challenge.initial_session_id=v_session then
    raise exception using errcode='42501',message='NEW_SIGN_IN_REQUIRED';
  end if;
  select created_at into v_session_created from auth.sessions
    where id=v_session and user_id=v_owner;
  if not found or v_session_created is null or
    v_session_created<v_challenge.created_at or
    v_session_created>clock_timestamp() or
    v_session_created<clock_timestamp()-interval '5 minutes' then
    raise exception using errcode='42501',message='NEW_SIGN_IN_REQUIRED';
  end if;
  if v_challenge.verified_session_id is not null and
     v_challenge.verified_session_id<>v_session then
    raise exception using errcode='23505',message='REAUTH_PROOF_ALREADY_BOUND';
  end if;
  if v_challenge.verified_session_id is null then
    update public.private_account_exit_reauth_challenges
      set verified_session_id=v_session,verified_at=clock_timestamp()
      where id=p_challenge_id and owner_user_id=v_owner;
  end if;
  return jsonb_build_object('challengeId',p_challenge_id,
    'status','NEW_SIGN_IN_VERIFIED','expiresAt',v_challenge.expires_at,
    'alreadyVerified',v_challenge.verified_session_id is not null,
    'deletionAllowed',false);
end;
$$;
revoke all on function public.complete_private_account_exit_reauth(uuid)
  from public,anon,authenticated;
grant execute on function public.complete_private_account_exit_reauth(uuid)
  to authenticated;
comment on function public.complete_private_account_exit_reauth(uuid) is
 'A distinct server-verified login session after an explicit short-lived owner challenge. Not MFA. Does not remove DB request-only erasure blocks, authorize deletion, or verify public revocation.';
