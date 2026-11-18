-- B16 C14: case-bound outward account sharing restriction.
-- Private owner access, private preparation, recovery, appeal and erasure remain.
-- Never assert provider ban, session termination, CDN purge or auto-republish.
create table kadmeion_private.account_sharing_restrictions(
 owner_user_id uuid primary key references auth.users(id) on delete cascade,
 version bigint not null check(version between 1 and 9007199254740991),
 status text not null check(status in ('ACTIVE','CLEAR')),
 current_case_id uuid,
 updated_at timestamptz not null default clock_timestamp(),
 foreign key(current_case_id,owner_user_id) references public.private_moderation_cases(id,owner_user_id) on delete cascade,
 check((status='ACTIVE')=(current_case_id is not null)),
 check(status='CLEAR' or version<9007199254740991)
);
alter table kadmeion_private.account_sharing_restrictions enable row level security;
revoke all on kadmeion_private.account_sharing_restrictions from public,anon,authenticated,service_role;

create table kadmeion_private.account_sharing_restriction_events(
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null references auth.users(id) on delete cascade,
 case_id uuid not null,
 operation_id uuid not null,
 actor_user_id uuid references auth.users(id) on delete set null,
 action text not null check(action in ('RESTRICT','UPHOLD','RESTORE')),
 expected_version bigint not null check(expected_version between 0 and 9007199254740990),
 resulting_version bigint not null check(resulting_version=expected_version+1),
 result_status text not null check(result_status in ('ACTIVE','CLEAR')),
 rationale text not null check(rationale=btrim(rationale) and char_length(rationale) between 20 and 500 and octet_length(rationale)<=2000),
 created_at timestamptz not null default clock_timestamp(),
 unique(owner_user_id,operation_id),
 foreign key(case_id,owner_user_id) references public.private_moderation_cases(id,owner_user_id) on delete cascade
);
alter table kadmeion_private.account_sharing_restriction_events enable row level security;
revoke all on kadmeion_private.account_sharing_restriction_events from public,anon,authenticated,service_role;

create function kadmeion_private.account_public_sharing_allowed(p_owner uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select p_owner is not null and exists(select 1 from auth.users where id=p_owner)
   and not exists(select 1 from kadmeion_private.account_sharing_restrictions
     where owner_user_id=p_owner and status='ACTIVE')
$$;
revoke all on function kadmeion_private.account_public_sharing_allowed(uuid) from public,anon,authenticated,service_role;

-- Every outward writer takes a nonblocking shared owner gate. The restriction
-- transaction takes the same key exclusively before row locks. A competing
-- writer that already holds another lock fails fast rather than deadlocking.
create function kadmeion_private.require_account_public_sharing_write(p_owner uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_owner is null then raise exception using errcode='42501',message='ACCOUNT_SHARING_UNAVAILABLE'; end if;
 if not pg_try_advisory_xact_lock_shared(hashtextextended(p_owner::text,714600)) then
   raise exception using errcode='55P03',message='ACCOUNT_SHARING_BUSY';
 end if;
 if not kadmeion_private.account_public_sharing_allowed(p_owner) then
   raise exception using errcode='42501',message='ACCOUNT_PUBLIC_SHARING_RESTRICTED';
 end if;
end;
$$;
revoke all on function kadmeion_private.require_account_public_sharing_write(uuid) from public,anon,authenticated,service_role;

-- Guard actual row writes even through legacy direct endpoints. Reductions,
-- owner privacy withdrawal and revocations remain available while restricted.
create function kadmeion_private.guard_account_outward_row()
returns trigger language plpgsql security definer set search_path='' as $$
declare n jsonb:=to_jsonb(new); o jsonb:='{}'::jsonb; u uuid; outward boolean:=false;
begin
 if tg_op='UPDATE' then o:=to_jsonb(old); end if;
 u:=coalesce(n->>'owner_user_id',n->>'user_id')::uuid;
 case tg_table_name
 when 'profile_sharing_preferences' then
   outward:=exists(select 1 from unnest(array['publication_requested','share_display_name','share_headline','share_bio']) k
     where n->k='true'::jsonb and o->k is distinct from 'true'::jsonb);
 when 'project_exposure_intents' then
   outward:=exists(select 1 from unnest(array['show_on_profile','show_case_study']) k
     where n->k='true'::jsonb and o->k is distinct from 'true'::jsonb);
 when 'private_reviewer_grants' then outward:=n->'revoked_at'='null'::jsonb;
 when 'unlisted_release_routes' then outward:=n->>'status'='LIVE';
 when 'private_unlisted_publication_intents' then
   outward:=tg_op='INSERT' or n->>'status' is distinct from o->>'status'
     or (n->>'public_handle' is not null and (n->>'public_handle' is distinct from o->>'public_handle' or n->>'public_slug' is distinct from o->>'public_slug'));
 when 'unlisted_release_pending' then outward:=true;
 when 'profile_publications' then outward:=true;
 when 'case_study_publications' then outward:=true;
 else raise exception 'Unexpected account sharing trigger';
 end case;
 if outward then perform kadmeion_private.require_account_public_sharing_write(u); end if;
 return new;
end;
$$;
revoke all on function kadmeion_private.guard_account_outward_row() from public,anon,authenticated,service_role;
create trigger kd_account_sharing_profile_pref before insert or update on public.profile_sharing_preferences
 for each row execute function kadmeion_private.guard_account_outward_row();
create trigger kd_account_sharing_project_exposure before insert or update on public.project_exposure_intents
 for each row execute function kadmeion_private.guard_account_outward_row();
create trigger kd_account_sharing_reviewer before insert or update on public.private_reviewer_grants
 for each row execute function kadmeion_private.guard_account_outward_row();
create trigger kd_account_sharing_route before insert or update on kadmeion_private.unlisted_release_routes
 for each row execute function kadmeion_private.guard_account_outward_row();
create trigger kd_account_sharing_intent before insert or update on public.private_unlisted_publication_intents
 for each row execute function kadmeion_private.guard_account_outward_row();
create trigger kd_account_sharing_pending before insert or update on kadmeion_private.unlisted_release_pending
 for each row execute function kadmeion_private.guard_account_outward_row();
create trigger kd_account_sharing_profile_projection before insert or update on kadmeion_private.profile_publications
 for each row execute function kadmeion_private.guard_account_outward_row();
create trigger kd_account_sharing_case_projection before insert or update on kadmeion_private.case_study_publications
 for each row execute function kadmeion_private.guard_account_outward_row();

-- Extend only approved event/notice enums, preserving the entire earlier set.
alter table public.private_moderation_events drop constraint private_moderation_events_event_type_check;
alter table public.private_moderation_events add constraint private_moderation_events_event_type_check
 check(event_type in ('OPENED','OWNER_APPEAL','OPERATOR_DECISION','OPERATOR_HOLD_LIFT',
 'ACCOUNT_SHARING_RESTRICTED','ACCOUNT_SHARING_UPHELD','ACCOUNT_SHARING_RESTORED'));
alter table public.private_notifications drop constraint private_notifications_event_type_check;
alter table public.private_notifications add constraint private_notifications_event_type_check
 check(event_type in ('ACCOUNT_EXIT_REQUESTED','MODERATION_OPENED','MODERATION_DECIDED','MODERATION_HOLD_LIFTED',
 'PORTFOLIO_MODERATION_BLOCKED','REVIEWER_GRANT_ISSUED','REVIEWER_GRANT_REVOKED','RELEASE_VERIFIED','CLOUD_REVISION_SAVED',
 'MODERATION_ACCOUNT_RESTRICTED','MODERATION_ACCOUNT_UPHELD','MODERATION_ACCOUNT_RESTORED'));
alter table public.private_release_visibility_events drop constraint kd_private_release_event_kind;
alter table public.private_release_visibility_events add constraint kd_private_release_event_kind
 check(event_type in ('PREPARE','OWNER_BLOCK','TRASH_BLOCK','OPERATOR_BLOCK','OPERATOR_HOLD_LIFT','PROJECT_PRIVACY_BLOCK','ACCOUNT_SHARING_BLOCK'));

create function kadmeion_private.account_restriction_live_actor()
returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=(select auth.uid()); s uuid;
begin
 s:=kadmeion_private.require_live_exit_auth_session();
 if not exists(select 1 from auth.users u join auth.sessions v on v.user_id=u.id
   where u.id=a and v.id=s and (v.not_after is null or v.not_after>clock_timestamp())) then
   raise exception using errcode='42501',message='LIVE_SESSION_REQUIRED';
 end if;
 return a;
end;
$$;
revoke all on function kadmeion_private.account_restriction_live_actor() from public,anon,authenticated,service_role;

create function public.owner_read_account_sharing_restriction()
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=kadmeion_private.account_restriction_live_actor(); r kadmeion_private.account_sharing_restrictions%rowtype;
begin
 select * into r from kadmeion_private.account_sharing_restrictions where owner_user_id=a;
 return jsonb_build_object('status',coalesce(r.status,'CLEAR'),'version',coalesce(r.version,0),
   'currentCaseId',r.current_case_id,'scope','ACCOUNT_PUBLIC_SHARING','updatedAt',r.updated_at);
end;
$$;
revoke all on function public.owner_read_account_sharing_restriction() from public,anon,authenticated,service_role;
grant execute on function public.owner_read_account_sharing_restriction() to authenticated;

create function public.operator_read_account_sharing_restriction(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=kadmeion_private.account_restriction_live_actor(); actor_role text;
 c public.private_moderation_cases%rowtype; r kadmeion_private.account_sharing_restrictions%rowtype;
 actions jsonb:='[]'::jsonb;
begin
 select role into actor_role from kadmeion_private.operator_roles where user_id=a and role in ('moderator','administrator');
 if not found then raise exception using errcode='42501',message='CASE_NOT_FOUND'; end if;
 select * into c from public.private_moderation_cases where id=p_case_id;
 if not found then raise exception using errcode='42501',message='CASE_NOT_FOUND'; end if;
 select * into r from kadmeion_private.account_sharing_restrictions where owner_user_id=c.owner_user_id;
 if actor_role='administrator' and a<>c.owner_user_id
   and not exists(select 1 from kadmeion_private.operator_roles where user_id=c.owner_user_id) then
   if coalesce(r.status,'CLEAR')='CLEAR' and coalesce(r.version,0)<9007199254740990
     and c.status in ('OPEN','APPEAL_PENDING') then
     actions:=jsonb_build_array('RESTRICT');
   elsif r.status='ACTIVE' and r.current_case_id=c.id then
     if c.status='APPEAL_PENDING' and r.version<9007199254740990
       and exists(select 1 from public.private_moderation_events where case_id=c.id and owner_user_id=c.owner_user_id
         and actor_user_id=c.owner_user_id and event_type='OWNER_APPEAL') then actions:=actions||jsonb_build_array('UPHOLD'); end if;
     if c.status<>'APPEAL_PENDING' or exists(select 1 from public.private_moderation_events where case_id=c.id
       and owner_user_id=c.owner_user_id and actor_user_id=c.owner_user_id and event_type='OWNER_APPEAL') then
       actions:=actions||jsonb_build_array('RESTORE');
     end if;
   end if;
 end if;
 return jsonb_build_object('caseId',c.id,'ownerUserId',c.owner_user_id,'status',coalesce(r.status,'CLEAR'),
   'version',coalesce(r.version,0),'currentCaseId',r.current_case_id,'scope','ACCOUNT_PUBLIC_SHARING',
   'updatedAt',r.updated_at,'allowedActions',actions);
end;
$$;
revoke all on function public.operator_read_account_sharing_restriction(uuid) from public,anon,authenticated,service_role;
grant execute on function public.operator_read_account_sharing_restriction(uuid) to authenticated;

-- Check the complete current outward state before claiming restriction/restoration.
create function kadmeion_private.account_sharing_is_withdrawn(p_owner uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from kadmeion_private.unlisted_release_routes where owner_user_id=p_owner and status='LIVE')
  and not exists(select 1 from kadmeion_private.unlisted_release_pending where owner_user_id=p_owner)
  and not exists(select 1 from kadmeion_private.unlisted_release_fallbacks f join public.portfolios p on p.id=f.portfolio_id
    where p.owner_user_id=p_owner)
  and not exists(select 1 from public.private_reviewer_grants where owner_user_id=p_owner and revoked_at is null)
  and not exists(select 1 from kadmeion_private.profile_publications where user_id=p_owner)
  and not exists(select 1 from kadmeion_private.case_study_publications where owner_user_id=p_owner)
  and not exists(select 1 from public.profile_sharing_preferences where user_id=p_owner and publication_requested)
  and not exists(select 1 from public.project_exposure_intents where owner_user_id=p_owner and (show_on_profile or show_case_study))
  and not exists(select 1 from public.private_unlisted_publication_intents i
    join public.private_release_visibility_pointers p on p.portfolio_id=i.portfolio_id and p.owner_user_id=i.owner_user_id
    where i.owner_user_id=p_owner and i.status='AWAITING_HOST' and i.expires_at>clock_timestamp()
      and p.status='PREPARED_PRIVATE' and i.expected_pointer_generation=p.generation
      and i.expected_pointer_generation>p.revocation_generation)
$$;
revoke all on function kadmeion_private.account_sharing_is_withdrawn(uuid) from public,anon,authenticated,service_role;

create function public.operator_change_account_sharing_restriction(p_case_id uuid,p_action text,p_expected_version bigint,
 p_operation_id uuid,p_rationale text,p_confirmation text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare a uuid:=kadmeion_private.account_restriction_live_actor(); u uuid; reason text:=btrim(p_rationale);
 c public.private_moderation_cases%rowtype; r kadmeion_private.account_sharing_restrictions%rowtype;
 ev kadmeion_private.account_sharing_restriction_events%rowtype; v bigint; nextv bigint; nextstatus text;
 nextcase uuid; replay boolean:=false; pointer record; g bigint; kind text;
begin
 if p_case_id is null or p_operation_id is null or p_expected_version is null
   or p_expected_version not between 0 and 9007199254740991 or p_action is null
   or p_action not in ('RESTRICT','UPHOLD','RESTORE') or reason is null
   or char_length(reason) not between 20 and 500 or octet_length(reason)>2000
   or p_confirmation is distinct from (case p_action when 'RESTRICT' then 'RESTRICT PUBLIC SHARING'
       when 'UPHOLD' then 'UPHOLD PUBLIC SHARING RESTRICTION' else 'RESTORE PUBLIC SHARING' end) then
   raise exception using errcode='22023',message='INVALID_ACCOUNT_SHARING_DECISION';
 end if;
 perform 1 from kadmeion_private.operator_roles where user_id=a and role='administrator' for share nowait;
 if not found then raise exception using errcode='42501',message='ADMINISTRATOR_REQUIRED'; end if;
 select owner_user_id into u from public.private_moderation_cases where id=p_case_id;
 if not found or u=a then raise exception using errcode='42501',message='CASE_NOT_FOUND'; end if;
 if not pg_try_advisory_xact_lock(hashtextextended(u::text,714600)) then
   raise exception using errcode='55P03',message='ACCOUNT_SHARING_BUSY'; end if;
 perform 1 from auth.users where id=u for update nowait;
 if not found or exists(select 1 from kadmeion_private.operator_roles where user_id=u) then
   raise exception using errcode='42501',message='CASE_NOT_FOUND'; end if;
 select * into c from public.private_moderation_cases where id=p_case_id and owner_user_id=u for update nowait;
 if not found or kadmeion_private.account_restriction_live_actor() is distinct from a then
   raise exception using errcode='42501',message='CASE_NOT_FOUND'; end if;
 select * into r from kadmeion_private.account_sharing_restrictions where owner_user_id=u for update nowait;
 v:=coalesce(r.version,0);
 select * into ev from kadmeion_private.account_sharing_restriction_events where owner_user_id=u and operation_id=p_operation_id;
 if found then
   if ev.actor_user_id is distinct from a or ev.case_id<>p_case_id or ev.action<>p_action
     or ev.expected_version<>p_expected_version or ev.rationale<>reason then
     raise exception using errcode='23505',message='ACCOUNT_SHARING_OPERATION_REUSED';
   end if;
   if r.version is distinct from ev.resulting_version or r.status is distinct from ev.result_status
     or (r.status='ACTIVE' and r.current_case_id is distinct from p_case_id) then
     raise exception using errcode='40001',message='ACCOUNT_SHARING_CONFLICT';
   end if;
   replay:=true; nextv:=r.version; nextstatus:=r.status; nextcase:=r.current_case_id;
 else
   if v<>p_expected_version then raise exception using errcode='40001',message='ACCOUNT_SHARING_CONFLICT'; end if;
   if v>=9007199254740991 or (p_action<>'RESTORE' and v>=9007199254740990) then
     raise exception using errcode='54000',message='ACCOUNT_SHARING_VERSION_EXHAUSTED'; end if;
   if p_action='RESTRICT' then
     if coalesce(r.status,'CLEAR')<>'CLEAR' or c.status not in ('OPEN','APPEAL_PENDING') then
       raise exception using errcode='40001',message='ACCOUNT_SHARING_CONFLICT'; end if;
     nextstatus:='ACTIVE'; nextcase:=p_case_id; kind:='ACCOUNT_SHARING_RESTRICTED';
   elsif r.status is distinct from 'ACTIVE' or r.current_case_id is distinct from p_case_id then
     raise exception using errcode='40001',message='ACCOUNT_SHARING_CONFLICT';
   elsif p_action='UPHOLD' then
     if c.status<>'APPEAL_PENDING' then raise exception using errcode='40001',message='ACCOUNT_SHARING_APPEAL_REQUIRED'; end if;
     nextstatus:='ACTIVE'; nextcase:=p_case_id; kind:='ACCOUNT_SHARING_UPHELD';
   else
     nextstatus:='CLEAR'; nextcase:=null; kind:='ACCOUNT_SHARING_RESTORED';
   end if;
   if p_action in ('UPHOLD','RESTORE') and c.status='APPEAL_PENDING' and not exists(
     select 1 from public.private_moderation_events where case_id=c.id and owner_user_id=u
       and actor_user_id=u and event_type='OWNER_APPEAL') then
     raise exception using errcode='40001',message='ACCOUNT_SHARING_APPEAL_REQUIRED';
   end if;
   nextv:=v+1;
   -- Lock target rows in account-exit order. Nonblocking owner gate means
   -- existing outreach writers either finish first or the restriction retries.
   perform 1 from public.profiles where user_id=u for update nowait;
   perform 1 from public.projects where owner_user_id=u order by id for update nowait;
   perform 1 from public.portfolios where owner_user_id=u order by id for update nowait;
   if p_action='RESTORE' and not kadmeion_private.account_sharing_is_withdrawn(u) then
     raise exception using errcode='40001',message='ACCOUNT_SHARING_WITHDRAWAL_UNCONFIRMED'; end if;
   insert into kadmeion_private.account_sharing_restrictions(owner_user_id,version,status,current_case_id)
     values(u,nextv,nextstatus,nextcase)
   on conflict(owner_user_id) do update set version=excluded.version,status=excluded.status,
     current_case_id=excluded.current_case_id,updated_at=clock_timestamp();
   if p_action='RESTRICT' then
     -- Advance every prepared generation and revoke its exact old routes in the
     -- same transaction. Preserve source, frozen requests, and separate holds.
     for pointer in select portfolio_id,generation from public.private_release_visibility_pointers
       where owner_user_id=u and status='PREPARED_PRIVATE' order by portfolio_id for update nowait
     loop
       g:=least(pointer.generation+1,9223372036854775806::bigint);
       update public.private_release_visibility_pointers set status='BLOCKED',candidate_request_id=null,
         candidate_manifest_sha256=null,generation=g,revocation_generation=g,updated_at=clock_timestamp()
         where portfolio_id=pointer.portfolio_id and owner_user_id=u;
       insert into public.private_release_visibility_events(portfolio_id,owner_user_id,actor_user_id,operation_id,event_type,expected_generation,resulting_generation)
         values(pointer.portfolio_id,u,a,p_operation_id,'ACCOUNT_SHARING_BLOCK',pointer.generation,g);
     end loop;
     update kadmeion_private.unlisted_release_routes set status='REVOKED',updated_at=clock_timestamp()
       where owner_user_id=u and status='LIVE';
     delete from kadmeion_private.unlisted_release_pending where owner_user_id=u;
     delete from kadmeion_private.unlisted_release_fallbacks f using public.portfolios p
       where p.id=f.portfolio_id and p.owner_user_id=u;
     update public.private_unlisted_publication_intents set public_handle=null,public_slug=null
       where owner_user_id=u and public_handle is not null;
     update public.private_reviewer_grants set revoked_at=clock_timestamp() where owner_user_id=u and revoked_at is null;
     delete from kadmeion_private.profile_publications where user_id=u;
     delete from kadmeion_private.case_study_publications where owner_user_id=u;
     update public.profile_sharing_preferences set publication_requested=false,requested_at=null
       where user_id=u and publication_requested;
     update public.project_exposure_intents set show_on_profile=false,show_case_study=false,requested_at=null
       where owner_user_id=u and (show_on_profile or show_case_study);
   end if;
   if not kadmeion_private.account_sharing_is_withdrawn(u) then
     raise exception using errcode='40001',message='ACCOUNT_SHARING_WITHDRAWAL_UNCONFIRMED'; end if;
   if kadmeion_private.account_restriction_live_actor() is distinct from a then
     raise exception using errcode='42501',message='LIVE_SESSION_REQUIRED'; end if;
   insert into kadmeion_private.account_sharing_restriction_events(owner_user_id,case_id,operation_id,actor_user_id,action,
     expected_version,resulting_version,result_status,rationale)
     values(u,p_case_id,p_operation_id,a,p_action,v,nextv,nextstatus,reason);
   insert into public.private_moderation_events(case_id,owner_user_id,actor_user_id,operation_id,event_type,detail)
     values(p_case_id,u,a,p_operation_id,kind,reason);
   if p_action in ('UPHOLD','RESTORE') then
     update public.private_moderation_cases set status='CLOSED',updated_at=clock_timestamp() where id=p_case_id;
   end if;
 end if;
 return jsonb_build_object('caseId',p_case_id,'ownerUserId',u,'action',p_action,'status',nextstatus,'version',nextv,
   'currentCaseId',nextcase,'scope','ACCOUNT_PUBLIC_SHARING','alreadyRecorded',replay,
   'applicationSharingRestricted',nextstatus='ACTIVE','providerBanApplied',false,'authAccessTerminated',false,
   'hostRevocationVerified',false,'publicRepublished',false);
end;
$$;
revoke all on function public.operator_change_account_sharing_restriction(uuid,text,bigint,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.operator_change_account_sharing_restriction(uuid,text,bigint,uuid,text,text) to authenticated;

-- Current public/read paths require the same database restriction predicate.

create or replace function public.service_read_current_public_delivery_receipt(p_portfolio_id uuid,p_intent_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with current_route as (
    select route.portfolio_id,route.intent_id,route.request_id,intent.operation_id,
      route.release_generation,route.stage_generation,pointer.generation as pointer_generation,
      pointer.revocation_generation,epoch.delivery_epoch,profile.handle,portfolio.slug,
      stage.html_sha256,route.verified_at,
      kadmeion_private.release_media_metadata(stage.portfolio_id,stage.pointer_generation,stage.html_sha256) media,
      exists(select 1 from kadmeion_private.frozen_media_candidates m
        where m.portfolio_id=stage.portfolio_id and m.generation=stage.pointer_generation) has_media
    from kadmeion_private.unlisted_release_routes route
    join public.portfolios portfolio on portfolio.id=route.portfolio_id
      and portfolio.owner_user_id=route.owner_user_id
    join public.profiles profile on profile.user_id=route.owner_user_id
    join public.private_unlisted_publication_intents intent on intent.id=route.intent_id
      and intent.portfolio_id=route.portfolio_id and intent.owner_user_id=route.owner_user_id
      and intent.request_id=route.request_id
      and intent.public_handle=profile.handle and intent.public_slug=portfolio.slug
    join public.private_release_requests request on request.id=route.request_id
      and request.portfolio_id=route.portfolio_id and request.owner_user_id=route.owner_user_id
    join public.private_release_visibility_pointers pointer on pointer.portfolio_id=route.portfolio_id
      and pointer.owner_user_id=route.owner_user_id
    join kadmeion_private.private_reviewer_stage_artifacts stage on stage.portfolio_id=route.portfolio_id
      and stage.owner_user_id=route.owner_user_id and stage.pointer_generation=route.stage_generation
      and stage.request_id=route.request_id and stage.html_sha256=route.html_sha256
    join kadmeion_private.public_delivery_epochs epoch on epoch.portfolio_id=route.portfolio_id
    where route.portfolio_id=p_portfolio_id and route.intent_id=p_intent_id
      and portfolio.trashed_at is null and route.status='LIVE'
      and kadmeion_private.account_public_sharing_allowed(route.owner_user_id)
      and intent.status='USED' and request.visibility_intent='PUBLIC' and request.status='FROZEN'
      and pointer.status='PREPARED_PRIVATE' and route.stage_generation>pointer.revocation_generation
      and pointer.generation>=route.release_generation and route.release_generation>=route.stage_generation
      and route.stage_generation between 1 and 9007199254740991
      and pointer.revocation_generation between 0 and 9007199254740991
      and pointer.generation between 1 and 9007199254740991
      and route.release_generation between 1 and 9007199254740991
      and epoch.delivery_epoch<9007199254740991
      and not exists(select 1 from kadmeion_private.moderation_portfolio_holds hold
        where hold.portfolio_id=route.portfolio_id)
      and stage.html_sha256=encode(sha256(convert_to(stage.html,'UTF8')),'hex')
  )
  select jsonb_build_object('portfolioId',portfolio_id,'intentId',intent_id,'requestId',request_id,
    'operationId',operation_id,'releaseGeneration',release_generation,'stageGeneration',stage_generation,
    'pointerGeneration',pointer_generation,'revocationGeneration',revocation_generation,
    'deliveryEpoch',delivery_epoch,'visibility','PUBLIC','handle',handle,'slug',slug,
    'storedHtmlSha256',html_sha256,'mediaManifest',media->'mediaManifest',
    'assetHashes',case when has_media then media->'assetHashes' else '[]'::jsonb end,
    'verifiedAt',verified_at)
  from current_route
  where case when not has_media then media='{}'::jsonb
    when jsonb_typeof(media->'assetHashes')='array' then
      (media->>'mediaManifest')~'^[0-9a-f]{64}$'
      and jsonb_array_length(media->'assetHashes') between 1 and 8
      and not exists(select 1 from jsonb_array_elements(media->'assetHashes') e(value)
        where jsonb_typeof(e.value)<>'string' or e.value#>>'{}' !~ '^[0-9a-f]{64}$')
      and (select count(distinct value) from jsonb_array_elements(media->'assetHashes') e(value))
         =jsonb_array_length(media->'assetHashes')
    else false end
$$;

create or replace function public.service_read_unlisted_release(p_portfolio_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_html record;
begin
  if p_portfolio_id is null then return null;end if;
  select s.html,s.html_sha256,s.pointer_generation
    into v_html from kadmeion_private.unlisted_release_routes r
    join public.portfolios p on p.id=r.portfolio_id
    join public.private_release_requests fr on fr.id=r.request_id
      and fr.portfolio_id=r.portfolio_id and fr.owner_user_id=r.owner_user_id
    join public.private_release_visibility_pointers v on v.portfolio_id=r.portfolio_id
    join kadmeion_private.private_reviewer_stage_artifacts s
      on s.portfolio_id=r.portfolio_id and s.pointer_generation=r.stage_generation
      and s.request_id=r.request_id and s.owner_user_id=r.owner_user_id
      and s.html_sha256=r.html_sha256
    where r.portfolio_id=p_portfolio_id and r.status='LIVE'
      and kadmeion_private.account_public_sharing_allowed(r.owner_user_id)
      and fr.visibility_intent='UNLISTED' and fr.status='FROZEN'
      and p.trashed_at is null and v.status='PREPARED_PRIVATE'
      and r.stage_generation>v.revocation_generation
      and not exists(select 1 from kadmeion_private.moderation_portfolio_holds h
        where h.portfolio_id=r.portfolio_id);
  if not found or octet_length(v_html.html)>750000 or
    encode(sha256(convert_to(v_html.html,'UTF8')),'hex')<>v_html.html_sha256
  then return null;end if;
  return jsonb_build_object('status','UNLISTED_SCRIPTLESS_HTML','html',v_html.html,
    'htmlSha256',v_html.html_sha256,'indexable',false,
    'publicPublishingProven',false) || kadmeion_private.release_media_metadata(p_portfolio_id,v_html.pointer_generation,v_html.html_sha256);
end;
$function$;

create or replace function public.read_private_reviewer_stage_artifact(
  p_grant_id uuid,p_raw_token text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_content record;
begin
  if p_grant_id is null or p_raw_token is null or
     p_raw_token !~ '^[0-9a-f]{64}$' then return null;end if;
  select s.html,s.html_sha256,s.pointer_generation,s.portfolio_id,
      b.html_byte_length as verified_length
    into v_content
    from public.private_reviewer_grants g
    join public.private_release_requests r
      on r.id=g.request_id and r.portfolio_id=g.portfolio_id
        and r.owner_user_id=g.owner_user_id
    join public.portfolios p on p.id=g.portfolio_id and p.owner_user_id=g.owner_user_id
    join public.private_release_visibility_pointers v
      on v.portfolio_id=p.id and v.owner_user_id=p.owner_user_id
    join kadmeion_private.private_reviewer_stage_artifacts s
      on s.portfolio_id=v.portfolio_id and s.pointer_generation=v.generation
        and s.request_id=r.id
    join kadmeion_private.private_artifact_bindings b
      on b.portfolio_id=s.portfolio_id
        and b.pointer_generation=s.pointer_generation
        and b.request_id=s.request_id
    where g.id=p_grant_id and g.revoked_at is null
      and kadmeion_private.account_public_sharing_allowed(g.owner_user_id)
      and g.expires_at>transaction_timestamp()
      and g.token_sha256=encode(extensions.digest(decode(p_raw_token,'hex'),'sha256'),'hex')
      and r.status='FROZEN' and p.trashed_at is null
      and v.status='PREPARED_PRIVATE' and v.candidate_request_id=r.id
      and not exists(
        select 1 from kadmeion_private.moderation_portfolio_holds h
          where h.portfolio_id=p.id)
    for share of g,p,v;
  if not found then return null;end if;
  if octet_length(v_content.html)<>v_content.verified_length or
    encode(sha256(convert_to(v_content.html,'UTF8')),'hex')<>v_content.html_sha256
  then return null;end if;
  return jsonb_build_object('status','REVIEWER_PRIVATE_HTML',
    'html',v_content.html,'htmlSha256',v_content.html_sha256,
    'publicServingEnabled',false,'publicUrl',null) || kadmeion_private.release_media_metadata(
      v_content.portfolio_id,v_content.pointer_generation,v_content.html_sha256);
end;
$$;

create or replace function public.service_read_published_profile_projection(p_handle text)
returns jsonb language sql stable security definer set search_path=''
as $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'handle',publication.handle,'displayName',publication.display_name,
    'headline',publication.headline,'bio',publication.bio))
  from kadmeion_private.profile_publications publication
  join public.profiles profile on profile.user_id=publication.user_id
    and profile.handle=publication.handle
  where kadmeion_private.account_public_sharing_allowed(publication.user_id)
    and publication.handle=p_handle and p_handle ~ '^[a-z][a-z0-9_]{2,29}$'
$function$;

create or replace function public.service_read_published_case_study_projection(p_handle text,p_slug text)
returns jsonb language sql stable security definer set search_path=''
as $function$
  select publication.payload || jsonb_build_object('handle',profile.handle)
    from kadmeion_private.case_study_publications publication
    join public.projects project on project.id=publication.project_id
      and project.owner_user_id=publication.owner_user_id and project.slug=publication.slug
    join public.profiles profile on profile.user_id=publication.owner_user_id
    join public.project_exposure_intents exposure on exposure.project_id=project.id
      and exposure.owner_user_id=publication.owner_user_id
    where kadmeion_private.account_public_sharing_allowed(publication.owner_user_id)
      and profile.handle=p_handle and publication.handle=p_handle and publication.slug=p_slug
      and project.trashed_at is null and exposure.show_case_study
$function$;

create or replace function public.service_probe_unlisted_release(p_portfolio_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_found record;
begin
  if p_portfolio_id is null then return null;end if;
  select s.html,s.html_sha256,r.release_generation,r.intent_id
    into v_found from kadmeion_private.unlisted_release_pending r
    join public.portfolios p on p.id=r.portfolio_id
    join public.private_unlisted_publication_intents intent on intent.id=r.intent_id
    join public.private_release_visibility_pointers v on v.portfolio_id=r.portfolio_id
    join kadmeion_private.private_reviewer_stage_artifacts s
      on s.portfolio_id=r.portfolio_id and s.pointer_generation=r.stage_generation
      and s.request_id=r.request_id and s.owner_user_id=r.owner_user_id
      and s.html_sha256=r.html_sha256
    where r.portfolio_id=p_portfolio_id and r.expires_at>clock_timestamp()
      and kadmeion_private.account_public_sharing_allowed(r.owner_user_id)
      and p.trashed_at is null and v.status='PREPARED_PRIVATE'
      and v.generation=r.release_generation
      and r.stage_generation>v.revocation_generation
      and (case when intent.rollback_target_id is null then v.candidate_request_id=r.request_id
        else exists(select 1 from kadmeion_private.unlisted_release_routes
          where portfolio_id=r.portfolio_id and intent_id=intent.rollback_from_id
            and status='LIVE' and verified_at is not null) end)
      and not exists(select 1 from kadmeion_private.moderation_portfolio_holds h
        where h.portfolio_id=r.portfolio_id);
  if not found or
    encode(sha256(convert_to(v_found.html,'UTF8')),'hex')<>v_found.html_sha256
    then return null;end if;
  return jsonb_build_object('status','PROBE_PENDING',
    'releaseGeneration',v_found.release_generation,'intentId',v_found.intent_id,
    'html',v_found.html,
    'htmlSha256',v_found.html_sha256,'publicServingEnabled',false);
end;
$function$;

create or replace function public.owner_request_unlisted_publication(
  p_request_id uuid,p_expected_generation bigint,p_operation_id uuid,p_confirmation text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_owner uuid := (select auth.uid());
  v_session uuid;
  v_source record;
  v_pointer public.private_release_visibility_pointers%rowtype;
  v_intent public.private_unlisted_publication_intents%rowtype;
  v_id uuid;
  v_public_handle text;
  v_public_slug text;
begin
  v_session:=kadmeion_private.require_live_exit_auth_session();
  perform kadmeion_private.require_account_public_sharing_write(v_owner);
  if p_request_id is null or p_operation_id is null or
     p_expected_generation is null or p_expected_generation<1 or
     p_confirmation is null or p_confirmation not in ('PUBLISH UNLISTED','PUBLISH PUBLIC') then
    raise exception using errcode='22023',message='INVALID_UNLISTED_CONSENT';end if;
  select r.portfolio_id,r.owner_user_id,r.visibility_intent,r.status,p.trashed_at
    into v_source from public.private_release_requests r
    join public.portfolios p on p.id=r.portfolio_id and p.owner_user_id=r.owner_user_id
    where r.id=p_request_id and r.owner_user_id=v_owner for update of p;
  if not found or v_source.status<>'FROZEN' or
     p_confirmation is distinct from ('PUBLISH ' || v_source.visibility_intent) or v_source.trashed_at is not null
  then raise exception using errcode='42501',message='UNLISTED_SOURCE_UNAVAILABLE';end if;
  if exists(select 1 from kadmeion_private.moderation_portfolio_holds
     where portfolio_id=v_source.portfolio_id) then
    raise exception using errcode='42501',message='MODERATION_HOLD_ACTIVE';end if;
  select * into v_intent from public.private_unlisted_publication_intents
    where owner_user_id=v_owner and operation_id=p_operation_id for update;
  if found then
    if v_intent.request_id<>p_request_id or
       v_intent.expected_pointer_generation<>p_expected_generation or v_intent.rollback_target_id is not null then
      raise exception using errcode='23505',message='UNLISTED_OPERATION_REUSED';end if;
    return jsonb_build_object('intentId',v_intent.id,'status',v_intent.status,
      'alreadyRecorded',true,'publicServingEnabled',false,'publicUrl',null);
  end if;
  select * into v_pointer from public.private_release_visibility_pointers
    where portfolio_id=v_source.portfolio_id and owner_user_id=v_owner for update;
  if not found or v_pointer.status<>'PREPARED_PRIVATE' or
     v_pointer.generation<>p_expected_generation or
     v_pointer.candidate_request_id<>p_request_id then
    raise exception using errcode='40001',message='UNLISTED_POINTER_CONFLICT';end if;
  perform 1 from kadmeion_private.private_reviewer_stage_artifacts
    where portfolio_id=v_source.portfolio_id
      and request_id=p_request_id and pointer_generation=p_expected_generation;
  if not found then
    raise exception using errcode='42501',message='STAGED_ARTIFACT_REQUIRED';end if;
  if (select count(*) from public.private_unlisted_publication_intents
      where owner_user_id=v_owner and created_at>transaction_timestamp()-interval '24 hours')>=20 then
    raise exception using errcode='54000',message='UNLISTED_INTENT_QUOTA_REACHED';end if;
  if v_source.visibility_intent='PUBLIC' then
    select profile.handle,portfolio.slug into v_public_handle,v_public_slug
      from public.profiles profile join public.portfolios portfolio
        on portfolio.owner_user_id=profile.user_id
      where profile.user_id=v_owner and portfolio.id=v_source.portfolio_id for share of profile;
    if v_public_handle is null or v_public_handle in (
      'admin','api','app','auth','dashboard','edit','explore','help','login','logout',
      'new','profile','projects','settings','signin','signup','status','support','templates','workspace'
    ) then
      raise exception using errcode='42501',message='PROFILE_HANDLE_REQUIRED';
    end if;
  end if;
  insert into public.private_unlisted_publication_intents(
    portfolio_id,owner_user_id,request_id,operation_id,expected_pointer_generation,public_handle,public_slug
  ) values(v_source.portfolio_id,v_owner,p_request_id,p_operation_id,
    p_expected_generation,v_public_handle,v_public_slug) returning id into v_id;
  return jsonb_build_object('intentId',v_id,'status','AWAITING_HOST',
    'alreadyRecorded',false,'publicServingEnabled',false,'publicUrl',null);
end;
$function$;

create or replace function public.owner_request_unlisted_rollback(
  p_target_intent_id uuid,p_current_intent_id uuid,p_expected_generation bigint,
  p_operation_id uuid,p_confirmation text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_owner uuid := (select auth.uid());
  v_target public.verified_unlisted_releases%rowtype;
  v_intent public.private_unlisted_publication_intents%rowtype;
  v_target_intent public.private_unlisted_publication_intents%rowtype;
  v_visibility text;
begin
  perform kadmeion_private.require_live_exit_auth_session();
  perform kadmeion_private.require_account_public_sharing_write(v_owner);
  if p_target_intent_id is null or p_current_intent_id is null or p_operation_id is null
    or p_target_intent_id=p_current_intent_id or p_expected_generation is null
    or p_expected_generation<1 or coalesce(p_confirmation,'') not in ('ROLL BACK UNLISTED','ROLL BACK PUBLIC') then
    raise exception using errcode='22023',message='INVALID_UNLISTED_ROLLBACK';
  end if;
  v_visibility:=case when p_confirmation='ROLL BACK PUBLIC' then 'PUBLIC' else 'UNLISTED' end;
  select * into v_target from public.verified_unlisted_releases
    where intent_id=p_target_intent_id and owner_user_id=v_owner
      and exists(select 1 from public.private_release_requests request
        where request.id=verified_unlisted_releases.request_id and request.visibility_intent=v_visibility);
  if not found then
    raise exception using errcode='42501',message='UNLISTED_SOURCE_UNAVAILABLE';
  end if;
  select * into strict v_target_intent from public.private_unlisted_publication_intents
    where id=p_target_intent_id and owner_user_id=v_owner;
  perform 1 from public.portfolios where id=v_target.portfolio_id and owner_user_id=v_owner
    and trashed_at is null for update;
  if not found or exists(select 1 from kadmeion_private.moderation_portfolio_holds
    where portfolio_id=v_target.portfolio_id) then
    raise exception using errcode='42501',message='UNLISTED_PORTFOLIO_BLOCKED';
  end if;
  select * into v_intent from public.private_unlisted_publication_intents
    where owner_user_id=v_owner and operation_id=p_operation_id;
  if found then
    if v_intent.rollback_target_id is distinct from p_target_intent_id
      or v_intent.rollback_from_id is distinct from p_current_intent_id
      or v_intent.expected_pointer_generation<>p_expected_generation then
      raise exception using errcode='23505',message='UNLISTED_OPERATION_REUSED';
    end if;
    return jsonb_build_object('intentId',v_intent.id,'status',v_intent.status,
      'alreadyRecorded',true,'publicServingEnabled',false,'publicUrl',null);
  end if;
  perform 1 from public.private_release_visibility_pointers pointer
    join kadmeion_private.unlisted_release_routes route using(portfolio_id)
    join public.private_unlisted_publication_intents active on active.id=route.intent_id
    join public.portfolios portfolio on portfolio.id=route.portfolio_id
    join public.profiles profile on profile.user_id=portfolio.owner_user_id
    where pointer.portfolio_id=v_target.portfolio_id and pointer.status='PREPARED_PRIVATE'
      and pointer.generation=p_expected_generation
      and v_target.stage_generation>pointer.revocation_generation
      and route.intent_id=p_current_intent_id and route.status='LIVE'
      and route.verified_at is not null
      and (v_visibility='UNLISTED' or (
        active.public_handle=profile.handle and active.public_slug=portfolio.slug
        and v_target_intent.public_handle=active.public_handle
        and v_target_intent.public_slug=active.public_slug));
  if not found then
    raise exception using errcode='40001',message='UNLISTED_POINTER_CONFLICT';
  end if;
  if (select count(*) from public.private_unlisted_publication_intents
    where owner_user_id=v_owner and created_at>transaction_timestamp()-interval '24 hours')>=20 then
    raise exception using errcode='54000',message='UNLISTED_INTENT_QUOTA_REACHED';
  end if;
  insert into public.private_unlisted_publication_intents(
    portfolio_id,owner_user_id,request_id,operation_id,expected_pointer_generation,
    rollback_target_id,rollback_from_id,public_handle,public_slug
  ) values(v_target.portfolio_id,v_owner,v_target.request_id,p_operation_id,
    p_expected_generation,p_target_intent_id,p_current_intent_id,
    v_target_intent.public_handle,v_target_intent.public_slug) returning * into v_intent;
  return jsonb_build_object('intentId',v_intent.id,'status',v_intent.status,
    'alreadyRecorded',false,'publicServingEnabled',false,'publicUrl',null);
end;
$function$;

create or replace function public.service_prepare_unlisted_release(p_intent_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_intent public.private_unlisted_publication_intents%rowtype;
  v_pointer public.private_release_visibility_pointers%rowtype;
  v_stage kadmeion_private.private_reviewer_stage_artifacts%rowtype;
  v_target public.verified_unlisted_releases%rowtype;
begin
  if p_intent_id is null then
    raise exception using errcode='22023',message='INVALID_UNLISTED_INTENT';end if;
  select * into v_intent from public.private_unlisted_publication_intents
    where id=p_intent_id;
  if not found then raise exception using errcode='42501',message='UNLISTED_INTENT_NOT_FOUND';end if;
  perform kadmeion_private.require_account_public_sharing_write(v_intent.owner_user_id);
  perform 1 from public.portfolios where id=v_intent.portfolio_id
    and owner_user_id=v_intent.owner_user_id and trashed_at is null for update;
  if not found or exists(select 1 from kadmeion_private.moderation_portfolio_holds
    where portfolio_id=v_intent.portfolio_id) then
    raise exception using errcode='42501',message='UNLISTED_PORTFOLIO_BLOCKED';end if;
  select * into v_intent from public.private_unlisted_publication_intents
    where id=p_intent_id for update;
  select * into v_pointer from public.private_release_visibility_pointers
    where portfolio_id=v_intent.portfolio_id for update;
  if exists(select 1 from kadmeion_private.unlisted_release_routes
    where portfolio_id=v_intent.portfolio_id and intent_id=p_intent_id and status='LIVE') then
    return (select jsonb_build_object('portfolioId',route.portfolio_id,
      'releaseGeneration',route.release_generation,
      'status',case when route.verified_at is null then 'AWAITING_VERIFICATION' else 'ACKNOWLEDGED' end,
      'htmlSha256',route.html_sha256,'publicServingEnabled',false,'publicUrl',null,
      'publicHandle',v_intent.public_handle,'publicSlug',v_intent.public_slug)
      from kadmeion_private.unlisted_release_routes route
      where route.portfolio_id=v_intent.portfolio_id and route.intent_id=p_intent_id);
  end if;
  if v_intent.expires_at<=clock_timestamp()
    or not found or v_pointer.status<>'PREPARED_PRIVATE'
    or v_pointer.generation<>v_intent.expected_pointer_generation
    or (v_intent.rollback_target_id is null and v_pointer.candidate_request_id<>v_intent.request_id) then
    raise exception using errcode='40001',message='UNLISTED_PREPARE_CONFLICT';end if;
  if v_intent.rollback_target_id is not null then
    select * into v_target from public.verified_unlisted_releases
      where intent_id=v_intent.rollback_target_id and portfolio_id=v_intent.portfolio_id
        and stage_generation>v_pointer.revocation_generation
        and exists(select 1 from public.private_release_requests request
          where request.id=verified_unlisted_releases.request_id and request.visibility_intent=case when v_intent.public_handle is null then 'UNLISTED' else 'PUBLIC' end);
    if not found or not exists(select 1 from kadmeion_private.unlisted_release_routes
      where portfolio_id=v_intent.portfolio_id and intent_id=v_intent.rollback_from_id
        and status='LIVE' and verified_at is not null) then
      raise exception using errcode='40001',message='UNLISTED_PREPARE_CONFLICT';
    end if;
  end if;
  select * into v_stage from kadmeion_private.private_reviewer_stage_artifacts
    where portfolio_id=v_intent.portfolio_id
      and pointer_generation=coalesce(v_target.stage_generation,v_intent.expected_pointer_generation)
      and request_id=v_intent.request_id;
  if not found or (v_target.intent_id is not null and v_target.html_sha256<>v_stage.html_sha256) or
    encode(sha256(convert_to(v_stage.html,'UTF8')),'hex')<>v_stage.html_sha256 then
    raise exception using errcode='22023',message='UNLISTED_ARTIFACT_INVALID';end if;
  -- The pointer generation advances for every candidate, including one that
  -- never goes live. A replacement with identical HTML must invalidate a
  -- delayed activation from the previous probe.
  if v_intent.status='USED' then
    perform 1 from kadmeion_private.unlisted_release_pending
      where portfolio_id=v_intent.portfolio_id and intent_id=p_intent_id
        and html_sha256=v_stage.html_sha256;
    if not found then
      raise exception using errcode='40001',message='UNLISTED_PREPARE_CONFLICT';
    end if;
  else
    insert into kadmeion_private.unlisted_release_pending(
      portfolio_id,owner_user_id,request_id,intent_id,stage_generation,
      release_generation,html_sha256,expires_at
    ) values(v_intent.portfolio_id,v_intent.owner_user_id,v_intent.request_id,
      v_intent.id,v_stage.pointer_generation,
      v_intent.expected_pointer_generation,
      v_stage.html_sha256,v_intent.expires_at)
    on conflict(portfolio_id) do update set
      owner_user_id=excluded.owner_user_id,request_id=excluded.request_id,
      intent_id=excluded.intent_id,stage_generation=excluded.stage_generation,
      release_generation=excluded.release_generation,
      html_sha256=excluded.html_sha256,expires_at=excluded.expires_at,
      created_at=transaction_timestamp();
    update public.private_unlisted_publication_intents set status='USED'
      where id=p_intent_id;
  end if;
  return jsonb_build_object('portfolioId',v_intent.portfolio_id,
    'releaseGeneration',v_intent.expected_pointer_generation,'status','PROBE_PENDING',
    'htmlSha256',v_stage.html_sha256,'publicServingEnabled',false,
    'publicUrl',null,'publicHandle',v_intent.public_handle,'publicSlug',v_intent.public_slug);
end;
$function$;

create or replace function public.service_activate_unlisted_release(
  p_portfolio_id uuid,p_expected_generation bigint,p_intent_id uuid,p_html_sha256 text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_pending kadmeion_private.unlisted_release_pending%rowtype;
  v_pointer public.private_release_visibility_pointers%rowtype;
  v_stage kadmeion_private.private_reviewer_stage_artifacts%rowtype;
  v_rollback_from uuid;
begin
  if p_portfolio_id is null or p_expected_generation is null or
    p_intent_id is null or p_html_sha256 is null or p_html_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='INVALID_UNLISTED_ACTIVATION';end if;
  perform kadmeion_private.require_account_public_sharing_write((select owner_user_id from public.portfolios where id=p_portfolio_id));
  perform 1 from public.portfolios
    where id=p_portfolio_id and trashed_at is null for update;
  if not found or exists(select 1 from kadmeion_private.moderation_portfolio_holds
      where portfolio_id=p_portfolio_id) then
    raise exception using errcode='42501',message='UNLISTED_PORTFOLIO_BLOCKED';end if;
  select * into v_pending from kadmeion_private.unlisted_release_pending
    where portfolio_id=p_portfolio_id for update;
  if not found then
    raise exception using errcode='40001',message='UNLISTED_ACTIVATION_CONFLICT';end if;
  select rollback_from_id into v_rollback_from from public.private_unlisted_publication_intents
    where id=v_pending.intent_id;
  select * into v_pointer from public.private_release_visibility_pointers
    where portfolio_id=p_portfolio_id for update;
  if not found or v_pending.expires_at<=clock_timestamp() or
    v_pending.intent_id<>p_intent_id or
    v_pending.release_generation<>p_expected_generation or
    v_pending.html_sha256<>p_html_sha256 or
    v_pointer.status<>'PREPARED_PRIVATE' or
    v_pointer.generation<>v_pending.release_generation or
    v_pending.stage_generation<=v_pointer.revocation_generation or
    (case when v_rollback_from is null then v_pointer.candidate_request_id<>v_pending.request_id
      else not exists(select 1 from kadmeion_private.unlisted_release_routes
        where portfolio_id=p_portfolio_id and intent_id=v_rollback_from
          and status='LIVE' and verified_at is not null) end) then
    raise exception using errcode='40001',message='UNLISTED_ACTIVATION_CONFLICT';end if;
  select * into v_stage from kadmeion_private.private_reviewer_stage_artifacts
    where portfolio_id=p_portfolio_id
      and pointer_generation=v_pending.stage_generation
      and request_id=v_pending.request_id;
  if not found or v_stage.html_sha256<>p_html_sha256 or
     encode(sha256(convert_to(v_stage.html,'UTF8')),'hex')<>p_html_sha256 then
    raise exception using errcode='22023',message='UNLISTED_ACTIVATION_DIGEST_MISMATCH';end if;
  if exists(select 1 from kadmeion_private.unlisted_release_routes
    where portfolio_id=p_portfolio_id and status='LIVE' and verified_at is null) then
    raise exception using errcode='40001',message='UNLISTED_VERIFICATION_PENDING';
  end if;
  delete from kadmeion_private.unlisted_release_fallbacks where portfolio_id=p_portfolio_id;
  insert into kadmeion_private.unlisted_release_fallbacks(
    portfolio_id,replacement_intent_id,previous_intent_id,previous_generation,
    previous_stage_generation,previous_verified_at,previous_html_sha256
  )
  select portfolio_id,v_pending.intent_id,intent_id,release_generation,stage_generation,verified_at,html_sha256
    from kadmeion_private.unlisted_release_routes
    where portfolio_id=p_portfolio_id and status='LIVE';

  insert into kadmeion_private.unlisted_release_routes(
    portfolio_id,owner_user_id,request_id,intent_id,stage_generation,
    release_generation,status,html_sha256
  ) values(v_pending.portfolio_id,v_pending.owner_user_id,
    v_pending.request_id,v_pending.intent_id,v_pending.stage_generation,
    v_pending.release_generation,'LIVE',p_html_sha256)
  on conflict(portfolio_id) do update set
    owner_user_id=excluded.owner_user_id,request_id=excluded.request_id,
    intent_id=excluded.intent_id,stage_generation=excluded.stage_generation,
    release_generation=excluded.release_generation,status='LIVE',verified_at=null,
    html_sha256=excluded.html_sha256,updated_at=transaction_timestamp();
  delete from kadmeion_private.unlisted_release_pending
    where portfolio_id=p_portfolio_id;
  return jsonb_build_object('status','ACTIVATED_NEEDS_EXTERNAL_HTTP_VERIFICATION',
    'portfolioId',p_portfolio_id,'releaseGeneration',p_expected_generation,
    'htmlSha256',p_html_sha256,'hostRevocationVerified',false,
    'publicUrl',null);
end;
$function$;

create or replace function public.owner_publish_profile_projection(p_confirmation text)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_owner uuid := (select auth.uid());
  v_profile public.profiles%rowtype;
  v_preferences public.profile_sharing_preferences%rowtype;
begin
  perform kadmeion_private.require_live_exit_auth_session();
  perform kadmeion_private.require_account_public_sharing_write(v_owner);
  if p_confirmation is distinct from 'PUBLISH PROFILE' then
    raise exception using errcode='22023',message='PROFILE_PUBLICATION_CONFIRMATION_REQUIRED';
  end if;
  select * into v_profile from public.profiles where user_id=v_owner for update;
  if not found or v_profile.handle is null then
    raise exception using errcode='42501',message='PROFILE_HANDLE_REQUIRED';
  end if;
  select * into v_preferences from public.profile_sharing_preferences where user_id=v_owner for update;
  if not found or not v_preferences.publication_requested then
    raise exception using errcode='42501',message='PROFILE_SHARING_REQUIRED';
  end if;
  insert into kadmeion_private.profile_publications(user_id,handle,display_name,headline,bio)
  values(v_owner,v_profile.handle,
    case when v_preferences.share_display_name then v_profile.display_name end,
    case when v_preferences.share_headline then v_profile.headline end,
    case when v_preferences.share_bio then v_profile.bio end)
  on conflict(user_id) do update set handle=excluded.handle,display_name=excluded.display_name,
    headline=excluded.headline,bio=excluded.bio,published_at=excluded.published_at;
  return jsonb_build_object('status','PROJECTION_READY','handle',v_profile.handle);
end;
$function$;

create or replace function public.owner_publish_case_study_projection(
  p_project_id uuid,p_expected_revision bigint,p_confirmation text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_owner uuid := (select auth.uid());
  v_project public.projects%rowtype;
  v_sections jsonb;
  v_handle text;
begin
  perform kadmeion_private.require_live_exit_auth_session();
  perform kadmeion_private.require_account_public_sharing_write(v_owner);
  if p_confirmation is distinct from 'PUBLISH CASE STUDY'
    or p_project_id is null or p_expected_revision is null or p_expected_revision<0 then
    raise exception using errcode='22023',message='CASE_STUDY_PUBLICATION_CONFIRMATION_REQUIRED';
  end if;
  select * into v_project from public.projects
    where id=p_project_id and owner_user_id=v_owner and trashed_at is null for update;
  if not found then
    raise exception using errcode='42501',message='PROJECT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  if v_project.revision<>p_expected_revision then
    raise exception using errcode='40001',message='REVISION_CONFLICT';
  end if;
  perform 1 from public.project_exposure_intents where project_id=p_project_id
    and owner_user_id=v_owner and show_case_study for update;
  if not found then
    raise exception using errcode='42501',message='CASE_STUDY_SHARING_REQUIRED';
  end if;
  select handle into v_handle from public.profiles where user_id=v_owner for update;
  if v_handle is null then
    raise exception using errcode='42501',message='PROFILE_HANDLE_REQUIRED';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('title',section->>'title',
    'body',section->>'body') order by position),'[]'::jsonb)
    into v_sections
    from jsonb_array_elements(v_project.case_study->'sections') with ordinality as sections(section,position)
    where section->'visible'='true'::jsonb;
  insert into kadmeion_private.case_study_publications(project_id,owner_user_id,slug,handle,payload)
  values(p_project_id,v_owner,v_project.slug,v_handle,jsonb_strip_nulls(jsonb_build_object(
    'slug',v_project.slug,'title',v_project.title,'summary',v_project.summary,
    'description',v_project.description,'repositoryUrl',v_project.repository_url,
    'liveUrl',v_project.live_url,'sections',v_sections)))
  on conflict(project_id) do update set slug=excluded.slug,handle=excluded.handle,payload=excluded.payload;
  return jsonb_build_object('status','PROJECTION_READY','slug',v_project.slug);
end;
$function$;

create or replace function public.issue_private_reviewer_grant(
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
  perform kadmeion_private.account_restriction_live_actor();
  perform kadmeion_private.require_account_public_sharing_write(v_owner);
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

create or replace function kadmeion_private.lock_expected_public_delivery(p_expected jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p uuid; i uuid; current_receipt jsonb;
begin
  if jsonb_typeof(p_expected) is distinct from 'object'
    or coalesce(p_expected->>'portfolioId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_expected->>'intentId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode='22023',message='INVALID_PUBLIC_DELIVERY_RECEIPT';
  end if;
  p:=(p_expected->>'portfolioId')::uuid; i:=(p_expected->>'intentId')::uuid;
  perform kadmeion_private.require_account_public_sharing_write((select owner_user_id from public.portfolios where id=p));
  perform 1 from public.portfolios where id=p and trashed_at is null for update nowait;
  if not found then raise exception using errcode='40001',message='PUBLIC_DELIVERY_CONFLICT'; end if;
  perform 1 from public.private_unlisted_publication_intents where id=i and portfolio_id=p for update nowait;
  if not found then raise exception using errcode='40001',message='PUBLIC_DELIVERY_CONFLICT'; end if;
  perform 1 from public.private_release_visibility_pointers where portfolio_id=p for update nowait;
  if not found then raise exception using errcode='40001',message='PUBLIC_DELIVERY_CONFLICT'; end if;
  perform 1 from kadmeion_private.unlisted_release_routes where portfolio_id=p and intent_id=i for update nowait;
  if not found then raise exception using errcode='40001',message='PUBLIC_DELIVERY_CONFLICT'; end if;
  perform 1 from kadmeion_private.public_delivery_epochs where portfolio_id=p for update nowait;
  if not found then raise exception using errcode='40001',message='PUBLIC_DELIVERY_CONFLICT'; end if;
  current_receipt:=public.service_read_current_public_delivery_receipt(p,i);
  if current_receipt is null or current_receipt is distinct from p_expected then
    raise exception using errcode='40001',message='PUBLIC_DELIVERY_CONFLICT';
  end if;
  return current_receipt;
end;
$$;

create or replace function kadmeion_private.reviewer_grant_active(
  p_grant_id uuid,p_raw_token text
) returns boolean language plpgsql security definer set search_path=''
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
      and kadmeion_private.account_public_sharing_allowed(g.owner_user_id)
      and g.expires_at>transaction_timestamp()
      and r.status='FROZEN' and p.trashed_at is null
      and g.token_sha256=encode(extensions.digest(decode(p_raw_token,'hex'),'sha256'),'hex')
  );
end;
$$;

revoke all on function kadmeion_private.reviewer_grant_active(uuid,text) from public,anon,authenticated,service_role;
grant execute on function kadmeion_private.reviewer_grant_active(uuid,text) to service_role;

create or replace function public.owner_appeal_moderation_case(
  p_case_id uuid,p_operation_id uuid,p_statement text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_case public.private_moderation_cases%rowtype;
  v_existing public.private_moderation_events%rowtype;
begin
  perform kadmeion_private.account_restriction_live_actor();
  if p_case_id is null or p_operation_id is null or p_statement is null or
    char_length(btrim(p_statement))<20 or char_length(p_statement)>2000 then
    raise exception using errcode='22023',message='INVALID_APPEAL'; end if;
  select * into v_case from public.private_moderation_cases
    where id=p_case_id and owner_user_id=v_owner for update;
  if not found then raise exception using errcode='42501',message='CASE_NOT_FOUND'; end if;
  select * into v_existing from public.private_moderation_events
    where case_id=p_case_id and operation_id=p_operation_id;
  if found then
    if v_existing.actor_user_id<>v_owner or v_existing.event_type<>'OWNER_APPEAL'
       or v_existing.detail<>btrim(p_statement) then
      raise exception using errcode='23505',message='APPEAL_OPERATION_ID_REUSED'; end if;
    return jsonb_build_object('caseId',p_case_id,'status','APPEAL_RECORDED',
      'alreadyRecorded',true,'publicRevocationVerified',false);
  end if;
  if v_case.status<>'OPEN' then raise exception using errcode='40001',message='APPEAL_CASE_NOT_OPEN'; end if;
  perform kadmeion_private.account_restriction_live_actor();
  insert into public.private_moderation_events(
    case_id,owner_user_id,actor_user_id,operation_id,event_type,detail
  ) values (p_case_id,v_owner,v_owner,p_operation_id,'OWNER_APPEAL',btrim(p_statement));
  update public.private_moderation_cases set status='APPEAL_PENDING',updated_at=transaction_timestamp()
    where id=p_case_id;
  return jsonb_build_object('caseId',p_case_id,'status','APPEAL_RECORDED',
    'alreadyRecorded',false,'publicRevocationVerified',false);
end;
$$;

create or replace function public.operator_close_moderation_case(
  p_case_id uuid,p_operation_id uuid,p_rationale text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_case public.private_moderation_cases%rowtype;
  v_existing public.private_moderation_events%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if not exists(select 1 from kadmeion_private.operator_roles
    where user_id=v_actor and role in ('moderator','administrator')) then
    raise exception using errcode='42501',message='OPERATOR_REQUIRED'; end if;
  if p_case_id is null or p_operation_id is null or p_rationale is null or
     char_length(btrim(p_rationale))<20 or char_length(p_rationale)>2000 then
    raise exception using errcode='22023',message='INVALID_MODERATION_DECISION'; end if;
  select * into v_case from public.private_moderation_cases where id=p_case_id for update;
  if not found then raise exception using errcode='42501',message='CASE_NOT_FOUND'; end if;
  select * into v_existing from public.private_moderation_events
    where case_id=p_case_id and operation_id=p_operation_id;
  if found then
    if v_existing.actor_user_id<>v_actor or v_existing.event_type<>'OPERATOR_DECISION'
      or v_existing.detail<>btrim(p_rationale) then
      raise exception using errcode='23505',message='DECISION_OPERATION_ID_REUSED'; end if;
    return jsonb_build_object('caseId',p_case_id,'status','CLOSED',
      'alreadyRecorded',true,'restrictionEnforced',false,'publicRevocationVerified',false);
  end if;
  if exists(select 1 from kadmeion_private.account_sharing_restrictions where owner_user_id=v_case.owner_user_id
      and current_case_id=p_case_id and status='ACTIVE') then
    raise exception using errcode='40001',message='ACCOUNT_SHARING_DECISION_REQUIRED';
  end if;
  if v_case.status='CLOSED' then
    raise exception using errcode='55000',message='CASE_ALREADY_CLOSED'; end if;
  insert into public.private_moderation_events(
    case_id,owner_user_id,actor_user_id,operation_id,event_type,detail
  ) values (p_case_id,v_case.owner_user_id,v_actor,p_operation_id,
    'OPERATOR_DECISION',btrim(p_rationale));
  update public.private_moderation_cases set status='CLOSED',updated_at=transaction_timestamp()
    where id=p_case_id;
  return jsonb_build_object('caseId',p_case_id,'status','CLOSED',
    'alreadyRecorded',false,'restrictionEnforced',false,'publicRevocationVerified',false);
end;
$$;

create or replace function kadmeion_private.record_owner_notification()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare
  v_row jsonb := to_jsonb(new);
  v_owner uuid := (v_row->>'owner_user_id')::uuid;
  v_event text;
  v_category text;
  v_target uuid;
  v_source text;
  v_enabled boolean;
begin
  case tg_table_name
    when 'private_account_erasure_requests' then
      v_event:='ACCOUNT_EXIT_REQUESTED';
      v_category:='SECURITY';
      v_target:=(v_row->>'id')::uuid;
      v_source:=(v_row->>'id');
    when 'private_moderation_events' then
      v_event:=case v_row->>'event_type'
        when 'OPENED' then 'MODERATION_OPENED'
        when 'OPERATOR_DECISION' then 'MODERATION_DECIDED'
        when 'OPERATOR_HOLD_LIFT' then 'MODERATION_HOLD_LIFTED'
        when 'ACCOUNT_SHARING_RESTRICTED' then 'MODERATION_ACCOUNT_RESTRICTED'
        when 'ACCOUNT_SHARING_UPHELD' then 'MODERATION_ACCOUNT_UPHELD'
        when 'ACCOUNT_SHARING_RESTORED' then 'MODERATION_ACCOUNT_RESTORED'
      end;
      if v_event is null then return null; end if;
      v_category:='MODERATION';
      v_target:=(v_row->>'case_id')::uuid;
      v_source:=(v_row->>'id');
    when 'private_reviewer_grants' then
      v_event:=case when tg_op='INSERT' then 'REVIEWER_GRANT_ISSUED' else 'REVIEWER_GRANT_REVOKED' end;
      v_category:='REVIEWER';
      v_target:=(v_row->>'portfolio_id')::uuid;
      v_source:=(v_row->>'id');
    when 'private_release_visibility_events' then
      v_event:='PORTFOLIO_MODERATION_BLOCKED';
      v_category:='MODERATION';
      v_target:=(v_row->>'portfolio_id')::uuid;
      v_source:=(v_row->>'id');
    when 'verified_unlisted_releases' then
      v_event:='RELEASE_VERIFIED';
      v_category:='PUBLISH';
      v_target:=(v_row->>'portfolio_id')::uuid;
      v_source:=(v_row->>'intent_id');
    else
      raise exception 'Unexpected notification event source';
  end case;
  if v_category in ('REVIEWER','PUBLISH') then
    select case when v_category='REVIEWER' then p.reviewer_enabled else p.publish_enabled end
      into v_enabled
      from public.private_notification_preferences p where p.owner_user_id=v_owner;
    if exists(select 1 from kadmeion_private.owner_preference_cas_state s
      where s.owner_user_id=v_owner and s.domain='NOTIFICATION'
        and s.version=9007199254740991) or not coalesce(v_enabled,true) then
      return null;
    end if;
  end if;
  insert into public.private_notifications (
    owner_user_id,event_type,category,priority,target_id,source_key
  ) values (
    v_owner,v_event,v_category,
    case when v_category in ('SECURITY','MODERATION') then 'HIGH' else 'NORMAL' end,
    v_target,v_source
  ) on conflict (owner_user_id,event_type,source_key) do nothing;
  return null;
end;
$function$;

-- All replaced functions retain their established exact grants; new private helper ACLs are explicit above.
