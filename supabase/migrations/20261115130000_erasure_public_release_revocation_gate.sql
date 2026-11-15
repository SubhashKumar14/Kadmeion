-- B09 forward-only hardening: prevent active-account deletion before
-- public projection, staging/reviewer and direct release revocation is proven.
-- This does not claim CDN/third-party archive erasure. Owners with no such
-- records retain the existing reauth + empty-Storage deletion path.
-- IMPORTANT: hosted rollout requires explicit owner authorization.
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
  -- Deleting the owner cascades PostgreSQL rows, but CANNOT prove external
  -- host/CDN/direct-asset withdrawal. A previously prepared or published
  -- release, share, reviewer grant or public projection must fail closed
  -- until a separately reviewed host-attested revocation mechanism exists.
  -- This gate is read under the owner-row transaction lock above.
  if exists(select 1 from public.private_release_requests r
      where r.owner_user_id=v_owner)
     or exists(select 1 from public.private_release_visibility_pointers p
      where p.owner_user_id=v_owner)
     or exists(select 1 from public.private_release_visibility_events e
      where e.owner_user_id=v_owner)
     or exists(select 1 from public.private_reviewer_grants g
      where g.owner_user_id=v_owner)
     or exists(select 1 from public.private_unlisted_publication_intents i
      where i.owner_user_id=v_owner)
     or exists(select 1 from public.verified_unlisted_releases v
      where v.owner_user_id=v_owner)
     or exists(select 1 from kadmeion_private.unlisted_release_routes u
      where u.owner_user_id=v_owner)
     or exists(select 1 from kadmeion_private.profile_publications pp
      where pp.user_id=v_owner)
     or exists(select 1 from kadmeion_private.case_study_publications cs
      where cs.owner_user_id=v_owner)
     or exists(select 1 from public.profile_sharing_preferences sp
      where sp.user_id=v_owner and sp.publication_requested)
     or exists(select 1 from public.project_exposure_intents pe
      where pe.owner_user_id=v_owner and pe.show_case_study)
  then
    raise exception using errcode='55000',
      message='ERASURE_PUBLIC_REVOCATION_UNVERIFIED';
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

comment on function public.owner_execute_account_erasure(uuid,uuid,text) is
'Deletes an owner only after live reauth, no remaining Storage and no recorded public/reviewer-release exposure. Historical caches and external copies remain unverified.';

