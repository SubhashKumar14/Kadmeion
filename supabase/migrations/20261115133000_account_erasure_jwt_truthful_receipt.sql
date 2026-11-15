-- B09 forward-only correction: removing the Auth user/session rows does NOT
-- guarantee that previously minted access JWTs have expired. Never tell the
-- frontend that all signed access has been terminated at commit time.
-- This changes only the response evidence, preserving all reauth, deletion,
-- public-route denial and private-Storage guards from the existing procedure.
create or replace function public.owner_execute_account_erasure(
  p_request_id uuid,p_challenge_id uuid,p_confirmation text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_owner uuid := (select auth.uid());
  v_session uuid;
  v_receipt uuid;
begin
  v_session:=kadmeion_private.require_live_exit_auth_session();
  if not exists(select 1 from auth.sessions where id=v_session and user_id=v_owner
      and (not_after is null or not_after>clock_timestamp())) then
    raise exception using errcode='42501',message='LIVE_SESSION_REQUIRED';
  end if;
  if p_request_id is null or p_challenge_id is null
    or p_confirmation is distinct from 'DELETE MY ACCOUNT' then
    raise exception using errcode='22023',message='INVALID_ERASURE_EXECUTION';
  end if;
  perform 1 from auth.users where id=v_owner for update;
  if not found then
    raise exception using errcode='42501',message='ACCOUNT_NOT_FOUND';
  end if;
  perform 1 from public.profiles where user_id=v_owner for update;
  perform 1 from public.private_account_erasure_requests
    where id=p_request_id and owner_user_id=v_owner and status='REQUESTED_BLOCKED' for update;
  if not found then
    raise exception using errcode='42501',message='PRIVATE_ERASURE_REQUEST_NOT_FOUND';
  end if;
  perform 1 from public.private_account_exit_reauth_challenges
    where id=p_challenge_id and owner_user_id=v_owner and verified_session_id=v_session
      and verified_at is not null and expires_at>clock_timestamp() for update;
  if not found then
    raise exception using errcode='42501',message='ERASURE_REAUTH_REQUIRED';
  end if;
  perform 1 from public.projects where owner_user_id=v_owner order by id for update;
  perform 1 from public.portfolios where owner_user_id=v_owner order by id for update;
  if kadmeion_private.account_exit_revocation_unverified(v_owner) then
    raise exception using errcode='55000',message='ERASURE_PUBLIC_REVOCATION_UNVERIFIED';
  end if;
  if exists(select 1 from storage.objects
      where owner_id=v_owner::text or owner=v_owner
        or (bucket_id='kadmeion-private-assets' and split_part(name,'/',1)=v_owner::text)) then
    raise exception using errcode='55000',message='ERASURE_STORAGE_CLEANUP_REQUIRED';
  end if;
  delete from auth.users where id=v_owner;
  if not found then
    raise exception using errcode='42501',message='ACCOUNT_NOT_FOUND';
  end if;
  v_receipt:=gen_random_uuid();
  insert into kadmeion_private.account_erasure_receipts(receipt_id) values(v_receipt);
  return jsonb_build_object('status','ACTIVE_ACCOUNT_ERASED','receiptId',v_receipt,
    'accessTerminated',false,'backupErasureVerified',false,'externalCopiesErased',false);
end;
$function$;

comment on function public.owner_execute_account_erasure(uuid,uuid,text) is
'Irreversibly deletes an active owner after recent reauth, verified scoped host withdrawal and empty Storage. Auth row/session deletion is immediate; previously issued JWTs may remain cryptographically valid until expiry. accessTerminated=false does not deny application-owned record deletion. Provider backups and external copies are not verified erased.';

revoke all on function public.owner_execute_account_erasure(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.owner_execute_account_erasure(uuid,uuid,text) to authenticated;
