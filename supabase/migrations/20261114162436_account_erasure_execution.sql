-- Execute account deletion atomically when no Storage objects require provider cleanup.
-- Keep only a random receipt; it contains no user identity or personal content.
create table kadmeion_private.account_erasure_receipts (
  receipt_id uuid primary key,
  completed_at timestamptz not null default transaction_timestamp()
);
alter table kadmeion_private.account_erasure_receipts enable row level security;
revoke all on kadmeion_private.account_erasure_receipts from public,anon,authenticated,service_role;

-- Serialize owner uploads with account removal, including requests carrying an
-- otherwise unexpired JWT. Physical objects are removed through the Storage API.
create function kadmeion_private.require_private_upload_owner()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if new.bucket_id='kadmeion-private-assets' and new.owner_id is not null then
    perform 1 from auth.users where id::text=new.owner_id for key share;
    if not found then
      raise exception using errcode='42501',message='PRIVATE_UPLOAD_OWNER_GONE';
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function kadmeion_private.require_private_upload_owner() from public,anon,authenticated,service_role;
create trigger kd_private_upload_live_owner before insert on storage.objects
  for each row execute function kadmeion_private.require_private_upload_owner();

-- The application cannot write attestations directly. A cascade from a
-- removed asset may delete its pin; ordinary updates and deletes stay blocked.
create or replace function kadmeion_private.reject_private_asset_attestation_mutation()
returns trigger language plpgsql set search_path=''
as $function$
begin
  if tg_op='DELETE' and pg_trigger_depth()>1 and not exists(
    select 1 from public.project_assets where id=old.asset_id
  ) then
    return old;
  end if;
  raise exception using errcode='42501',message='PRIVATE_ASSET_ATTESTATION_IMMUTABLE';
end;
$function$;

-- Use the Storage DELETE API to remove bytes. The database policy allows
-- cleanup only while the owner has an active erasure request and fresh proof.
create function kadmeion_private.can_remove_account_exit_uploads()
returns boolean language sql stable security definer set search_path=''
as $function$
  select exists(
    select 1 from public.private_account_erasure_requests request
    join public.private_account_exit_reauth_challenges challenge
      on challenge.owner_user_id=request.owner_user_id
    join auth.sessions session on session.id=challenge.verified_session_id
      and session.user_id=challenge.owner_user_id
    where request.owner_user_id=(select auth.uid()) and request.status='REQUESTED_BLOCKED'
      and challenge.verified_at is not null and challenge.expires_at>statement_timestamp()
      and session.id::text=(select auth.jwt()->>'session_id')
  )
$function$;
revoke all on function kadmeion_private.can_remove_account_exit_uploads() from public,anon,service_role;
grant execute on function kadmeion_private.can_remove_account_exit_uploads() to authenticated;
create policy kd_storage_erase_owned_uploads on storage.objects for delete to authenticated
using (
  bucket_id='kadmeion-private-assets' and owner_id=(select auth.uid()::text)
  and (storage.foldername(name))[1]=(select auth.uid()::text)
  and (select kadmeion_private.can_remove_account_exit_uploads())
);

create function public.owner_list_account_exit_uploads()
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare
  v_owner uuid := (select auth.uid());
begin
  if not kadmeion_private.can_remove_account_exit_uploads() then
    raise exception using errcode='42501',message='ERASURE_REAUTH_REQUIRED';
  end if;
  return coalesce((select jsonb_agg(upload.name order by upload.name) from (
    select name from storage.objects
    where bucket_id='kadmeion-private-assets' and owner_id=v_owner::text
      and split_part(name,'/',1)=v_owner::text
    order by name limit 100
  ) upload),'[]'::jsonb);
end;
$function$;
revoke all on function public.owner_list_account_exit_uploads() from public,anon,service_role;
grant execute on function public.owner_list_account_exit_uploads() to authenticated;

create function public.owner_execute_account_erasure(
  p_request_id uuid,p_challenge_id uuid,p_confirmation text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_owner uuid := (select auth.uid());
  v_session uuid;
  v_receipt uuid;
begin
  v_session:=kadmeion_private.require_live_exit_auth_session();
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
    'accessTerminated',true,'backupErasureVerified',false,'externalCopiesErased',false);
end;
$function$;
revoke all on function public.owner_execute_account_erasure(uuid,uuid,text)
  from public,anon,service_role;
grant execute on function public.owner_execute_account_erasure(uuid,uuid,text)
  to authenticated;
