-- C12 owner-private provider facts. EVENT-B16-S15-R7-001 registered this
-- forward-only migration after C05/C08/C11/C14/guarded-draft reservations.
-- No external egress, scheduler, hosted apply, or publication is enabled.
do $$
begin
 if to_regnamespace('kadmeion_private') is null
    or to_regclass('public.private_platform_links') is null
    or to_regclass('public.private_account_erasure_requests') is null
    or to_regclass('public.profiles') is null
    or to_regprocedure('kadmeion_private.require_live_exit_auth_session()') is null then
   raise exception 'C12 prerequisite schema is unavailable';
 end if;
end;$$;
-- Public data is normalized to typed columns (not retained raw responses).
create type kadmeion_private.github_fact_snapshot as (
  login text, provider_id bigint, html_url text, public_repos bigint,
  public_gists bigint, fetched_at timestamptz
);
create table kadmeion_private.github_provider_state (
  link_id uuid primary key references public.private_platform_links(id) on delete cascade,
  version bigint not null default 0 check (version between 0 and 9007199254740991),
  consent boolean not null default false,
  status text not null default 'OFF' check(status in ('OFF','READY','PENDING','AWAITING_CONFIRMATION','SYNCED','UNAVAILABLE')),
  candidate kadmeion_private.github_fact_snapshot, candidate_expires_at timestamptz,
  facts kadmeion_private.github_fact_snapshot,
  last_attempt_at timestamptz, last_error text check(last_error in ('NOT_FOUND','RATE_LIMITED','PROVIDER_UNAVAILABLE','INVALID_SOURCE','IDENTITY_CHANGED')),
  last_op uuid, last_expected bigint, last_action text, last_session uuid,
  attempt_id uuid, lease_until timestamptz,
  check (consent=(status<>'OFF')),
  check (version<>9007199254740991 or not consent),
  check (consent or (candidate is null and facts is null and attempt_id is null)),
  check (((candidate).provider_id is null)=(candidate_expires_at is null)),
  check ((candidate).provider_id is null or (facts).provider_id is null),
  check ((attempt_id is null)=(lease_until is null)),
  check ((status='PENDING')=(attempt_id is not null))
);
create index kd_github_candidate_expiry on kadmeion_private.github_provider_state(candidate_expires_at) where candidate_expires_at is not null;
create index kd_github_lease_expiry on kadmeion_private.github_provider_state(lease_until) where lease_until is not null;
create table kadmeion_private.github_owner_quota (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  next_allowed_at timestamptz not null
);
create index kd_github_owner_quota_expiry on kadmeion_private.github_owner_quota(next_allowed_at);
create table kadmeion_private.github_global_quota (
  singleton boolean primary key default true check(singleton),
  hour_start timestamptz not null, hour_count integer not null check(hour_count between 0 and 20),
  day_start timestamptz not null, day_count integer not null check(day_count between 0 and 80),
  next_allowed_at timestamptz not null, blocked_until timestamptz,
  attempt_id uuid, lease_until timestamptz, check((attempt_id is null)=(lease_until is null))
);
insert into kadmeion_private.github_global_quota(singleton,hour_start,hour_count,day_start,day_count,next_allowed_at)
values(true,clock_timestamp(),0,clock_timestamp(),0,clock_timestamp());
alter table kadmeion_private.github_provider_state enable row level security;
alter table kadmeion_private.github_owner_quota enable row level security;
alter table kadmeion_private.github_global_quota enable row level security;
revoke all on kadmeion_private.github_provider_state,kadmeion_private.github_owner_quota,kadmeion_private.github_global_quota from public,anon,authenticated,service_role;

-- Existing exit procedure serializes auth.users then owner profile. Hold those
-- plus the exact live session before link/state/quota. No upstream lock after global.
create function kadmeion_private.github_lock_owner(p_owner uuid,p_session uuid,p_processing boolean)
returns void language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
begin
  perform 1 from auth.users where id=p_owner and is_anonymous is false for key share;
  if not found then raise exception using errcode='42501',message='OWNER_DENIED';end if;
  perform 1 from auth.sessions where id=p_session and user_id=p_owner and (not_after is null or not_after>clock_timestamp()) for share;
  if not found then raise exception using errcode='42501',message='OWNER_DENIED';end if;
  perform 1 from public.profiles where user_id=p_owner for update;
  if not found then raise exception using errcode='42501',message='OWNER_DENIED';end if;
  if not exists(select 1 from auth.sessions where id=p_session and user_id=p_owner and (not_after is null or not_after>clock_timestamp())) then raise exception using errcode='42501',message='OWNER_DENIED';end if;
  -- Existing request-only journal: conservative no new processing during active exit.
  -- C14 exact restriction predicate still needs S11 approval; do not infer its scope.
  if p_processing and exists(select 1 from public.private_account_erasure_requests where owner_user_id=p_owner and status='REQUESTED_BLOCKED') then
    raise exception using errcode='42501',message='OWNER_DENIED';
  end if;
end;$$;
revoke all on function kadmeion_private.github_lock_owner(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create function kadmeion_private.github_lock_link(p_owner uuid,p_link uuid)
returns public.private_platform_links language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare l public.private_platform_links%rowtype;
begin
  select * into l from public.private_platform_links where id=p_link and owner_user_id=p_owner and provider='GITHUB' for update;
  if not found then raise exception using errcode='42501',message='OWNER_DENIED';end if;
  return l;
end;$$;
revoke all on function kadmeion_private.github_lock_link(uuid,uuid) from public,anon,authenticated,service_role;

create function kadmeion_private.github_snapshot_json(s kadmeion_private.github_fact_snapshot,p_handle text)
returns jsonb language sql immutable set search_path='' as $$
select case when (s).provider_id is null then null else jsonb_build_object(
 'login',(s).login,'id',(s).provider_id,'htmlUrl',(s).html_url,'publicRepos',(s).public_repos,'publicGists',(s).public_gists,
 'sourceUrl','https://api.github.com/users/'||p_handle,'fetchedAt',(s).fetched_at,'observedAt',null) end
$$;
revoke all on function kadmeion_private.github_snapshot_json(kadmeion_private.github_fact_snapshot,text) from public,anon,authenticated,service_role;
create function kadmeion_private.github_state_json(l public.private_platform_links,s kadmeion_private.github_provider_state,t timestamptz)
returns jsonb language sql stable set search_path='' as $$
select jsonb_build_object('schemaVersion',1,'ownerId',(l).owner_user_id,'linkId',(l).id,'provider','GITHUB','handle',(l).handle,
 'version',coalesce((s).version,0),'consent',coalesce((s).consent,false),
 'status',case when (s).status='PENDING' and (s).lease_until<=t then 'UNAVAILABLE' when (s).status='AWAITING_CONFIRMATION' and (s).candidate_expires_at<=t then 'READY' else coalesce((s).status,'OFF') end,
 'facts',kadmeion_private.github_snapshot_json((s).facts,(l).handle),
 'candidate',case when (s).candidate_expires_at>t then kadmeion_private.github_snapshot_json((s).candidate,(l).handle) else null end,
 'candidateExpiresAt',case when (s).candidate_expires_at>t then (s).candidate_expires_at else null end,
 'lastAttemptAt',(s).last_attempt_at,'cooldownUntil',(select q.next_allowed_at from kadmeion_private.github_owner_quota q where q.owner_id=(l).owner_user_id and q.next_allowed_at>t),
 'lastError',case when (s).status='PENDING' and (s).lease_until<=t then 'PROVIDER_UNAVAILABLE' else (s).last_error end,
 'freshness',case when ((s).facts).provider_id is null then 'NONE' when (s).status='UNAVAILABLE' or ((s).facts).fetched_at<=t-interval '24 hours' or ((s).lease_until is not null and (s).lease_until<=t) then 'STALE' else 'FRESH' end,
 'ownershipVerified',false)
$$;
revoke all on function kadmeion_private.github_state_json(public.private_platform_links,kadmeion_private.github_provider_state,timestamptz) from public,anon,authenticated,service_role;

-- Atomic link-handle invalidation and hard-delete cascade; quota survives relink.
create function kadmeion_private.github_invalidate_link() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.handle is distinct from new.handle and old.provider='GITHUB' then
   insert into kadmeion_private.github_provider_state(link_id,version) values(old.id,1) on conflict(link_id) do update set version=least(github_provider_state.version+1,9007199254740991),consent=false,status='OFF',
     candidate=null,candidate_expires_at=null,facts=null,last_attempt_at=null,last_error=null,last_op=null,last_expected=null,last_action=null,last_session=null,attempt_id=null,lease_until=null;
 end if;return new;
end;$$;
revoke all on function kadmeion_private.github_invalidate_link() from public,anon,authenticated,service_role;
create trigger kd_github_link_invalidate after update of handle on public.private_platform_links for each row execute function kadmeion_private.github_invalidate_link();
-- Existing request creation already locks the owner profile. Invalidation never locks global quota.
create function kadmeion_private.github_exit_invalidate() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='REQUESTED_BLOCKED' then
 update kadmeion_private.github_provider_state s set version=least(s.version+1,9007199254740991),consent=false,status='OFF',candidate=null,candidate_expires_at=null,facts=null,last_attempt_at=null,last_error=null,last_op=null,last_expected=null,last_action=null,last_session=null,attempt_id=null,lease_until=null
 where s.link_id in(select id from public.private_platform_links where owner_user_id=new.owner_user_id and provider='GITHUB') and s.consent;
 end if;return new;
end;$$;
revoke all on function kadmeion_private.github_exit_invalidate() from public,anon,authenticated,service_role;
create trigger kd_github_exit_invalidate after insert or update of status on public.private_account_erasure_requests for each row execute function kadmeion_private.github_exit_invalidate();

-- Read-only schema/live-session capability gate. No state row, consent,
-- quota or provider request is created. Edge readiness is verified separately.
create function public.read_owner_github_provider_capability() returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $
declare o uuid:=auth.uid();sess uuid:=kadmeion_private.require_live_exit_auth_session();
begin
 perform kadmeion_private.github_lock_owner(o,sess,false);
 return jsonb_build_object('schemaVersion',1,'ownerId',o);
end;$;
revoke all on function public.read_owner_github_provider_capability() from public,anon,authenticated,service_role;
grant execute on function public.read_owner_github_provider_capability() to authenticated;

create function public.read_owner_github_provider_state(p_link_id uuid) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare o uuid:=auth.uid(); sess uuid:=kadmeion_private.require_live_exit_auth_session();l public.private_platform_links;s kadmeion_private.github_provider_state;
begin
 perform kadmeion_private.github_lock_owner(o,sess,false);l:=kadmeion_private.github_lock_link(o,p_link_id);
 select * into s from kadmeion_private.github_provider_state where link_id=l.id;
 return kadmeion_private.github_state_json(l,s,clock_timestamp());
end;$$;
revoke all on function public.read_owner_github_provider_state(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_owner_github_provider_state(uuid) to authenticated;

create function kadmeion_private.github_change(p_link_id uuid,p_action text,p_expected_version bigint,p_operation_id uuid,p_policy_version smallint) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare o uuid:=auth.uid();sess uuid:=kadmeion_private.require_live_exit_auth_session();l public.private_platform_links;s kadmeion_private.github_provider_state;t timestamptz;
begin
 if p_action is null or p_action not in('ENABLE','DISABLE','CONFIRM') or p_operation_id is null or p_policy_version is distinct from 1 or p_expected_version is null or p_expected_version not between 0 and 9007199254740991 then raise exception using errcode='22023',message='INVALID';end if;
 perform kadmeion_private.github_lock_owner(o,sess,p_action<>'DISABLE');l:=kadmeion_private.github_lock_link(o,p_link_id);
 select * into s from kadmeion_private.github_provider_state where link_id=l.id for update;
 if not found then
  if p_action='DISABLE' and p_expected_version=0 then return jsonb_build_object('status','NO_CHANGE','state',kadmeion_private.github_state_json(l,s,clock_timestamp()));end if;
  if p_action<>'ENABLE' or p_expected_version<>0 then raise exception using errcode='PT409',message='CONFLICT';end if;
  insert into kadmeion_private.github_provider_state(link_id) values(l.id) returning * into s;
 end if;
 t:=clock_timestamp();
 if s.last_op=p_operation_id then
  if s.last_expected=p_expected_version and s.last_action=p_action and s.last_session=sess then return jsonb_build_object('status','REPLAYED','state',kadmeion_private.github_state_json(l,s,t));end if;
  raise exception using errcode='PT409',message='CONFLICT';
 end if;
 if s.version<>p_expected_version then raise exception using errcode='PT409',message='CONFLICT';end if;
 if p_action='DISABLE' and not s.consent then return jsonb_build_object('status','NO_CHANGE','state',kadmeion_private.github_state_json(l,s,t));end if;
 if p_action<>'DISABLE' and s.version>=9007199254740990 then raise exception using errcode='PT409',message='CONFLICT';end if;
 if p_action='ENABLE' and not s.consent then s.consent:=true;s.status:='READY';
 elsif p_action='DISABLE' then s.consent:=false;s.status:='OFF';s.facts:=null;s.candidate:=null;s.candidate_expires_at:=null;s.attempt_id:=null;s.lease_until:=null;s.last_error:=null;s.last_attempt_at:=null;
 elsif p_action='CONFIRM' and s.consent and s.status='AWAITING_CONFIRMATION' and s.candidate_expires_at>t then s.facts:=s.candidate;s.candidate:=null;s.candidate_expires_at:=null;s.status:='SYNCED';s.last_error:=null;
 else raise exception using errcode='PT409',message='CONFLICT';end if;
 s.version:=s.version+1;s.last_op:=p_operation_id;s.last_expected:=p_expected_version;s.last_action:=p_action;s.last_session:=sess;
 update kadmeion_private.github_provider_state set version=s.version,consent=s.consent,status=s.status,facts=s.facts,candidate=s.candidate,candidate_expires_at=s.candidate_expires_at,attempt_id=s.attempt_id,lease_until=s.lease_until,last_error=s.last_error,last_attempt_at=s.last_attempt_at,last_op=s.last_op,last_expected=s.last_expected,last_action=s.last_action,last_session=s.last_session where link_id=l.id;
 return jsonb_build_object('status','APPLIED','state',kadmeion_private.github_state_json(l,s,t));
end;$$;
revoke all on function kadmeion_private.github_change(uuid,text,bigint,uuid,smallint) from public,anon,authenticated,service_role;
create function public.change_owner_github_provider_consent(p_link_id uuid,p_action text,p_expected_version bigint,p_operation_id uuid,p_policy_version smallint) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_action is null or p_action not in('ENABLE','DISABLE') then raise exception using errcode='22023',message='INVALID';end if;
 return kadmeion_private.github_change(p_link_id,p_action,p_expected_version,p_operation_id,p_policy_version);
end;$$;
create function public.confirm_owner_github_provider_candidate(p_link_id uuid,p_expected_version bigint,p_operation_id uuid,p_policy_version smallint) returns jsonb language sql security definer set search_path='' as $$
 select kadmeion_private.github_change(p_link_id,'CONFIRM',p_expected_version,p_operation_id,p_policy_version)
$$;
revoke all on function public.change_owner_github_provider_consent(uuid,text,bigint,uuid,smallint),public.confirm_owner_github_provider_candidate(uuid,bigint,uuid,smallint) from public,anon,authenticated,service_role;
grant execute on function public.change_owner_github_provider_consent(uuid,text,bigint,uuid,smallint),public.confirm_owner_github_provider_candidate(uuid,bigint,uuid,smallint) to authenticated;

-- Domain revision conflicts are PT409, not PostgreSQL serialization failures.
-- PostgREST must not automatically retry an intentionally rejected intent.
-- Service-only claim consumes a single committed attempt and reserves the
-- completion revision before any outbound I/O. Limited/replay never fetch.
create function public.service_claim_github_provider_sync(p_owner_id uuid,p_session_id uuid,p_link_id uuid,p_action text,p_expected_version bigint,p_operation_id uuid,p_policy_version smallint) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare l public.private_platform_links;s kadmeion_private.github_provider_state;q kadmeion_private.github_owner_quota;g kadmeion_private.github_global_quota;t timestamptz;h timestamptz;d timestamptz;attempt uuid;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='OWNER_DENIED';end if;
 if p_action is null or p_action not in('LOOKUP','SYNC') or p_policy_version is distinct from 1 or p_operation_id is null or p_expected_version is null or p_expected_version not between 0 and 9007199254740988 then raise exception using errcode='22023',message='INVALID';end if;
 perform kadmeion_private.github_lock_owner(p_owner_id,p_session_id,true);l:=kadmeion_private.github_lock_link(p_owner_id,p_link_id);
 select * into s from kadmeion_private.github_provider_state where link_id=l.id for update;
 if not found or not s.consent then raise exception using errcode='PT409',message='CONFLICT';end if;
 t:=clock_timestamp();
 if s.last_op=p_operation_id then
   if s.last_expected is distinct from p_expected_version or s.last_action is distinct from p_action or s.last_session is distinct from p_session_id then raise exception using errcode='PT409',message='CONFLICT';end if;
   -- An expired claim needs an authoritative read and a new explicit operation;
   -- never mint a replacement attempt or claim success at the old revision.
   if s.status='PENDING' and s.lease_until<=t then raise exception using errcode='PT409',message='CONFLICT';end if;
   return jsonb_build_object('status',case when s.status='PENDING' then 'PENDING' else 'REPLAYED' end,'state',kadmeion_private.github_state_json(l,s,t),'attemptId',null,'handle',null);
 end if;
 if s.version<>p_expected_version or (p_action='LOOKUP' and (s.facts).provider_id is not null) or (p_action='SYNC' and (s.facts).provider_id is null) then raise exception using errcode='PT409',message='CONFLICT';end if;
 if (s.status='PENDING' and s.lease_until>t) or
    (p_action='LOOKUP' and s.status='AWAITING_CONFIRMATION' and s.candidate_expires_at>t) then
   raise exception using errcode='PT409',message='CONFLICT';end if;
 begin
   insert into kadmeion_private.github_owner_quota(owner_id,next_allowed_at) values(p_owner_id,'-infinity') on conflict(owner_id) do nothing;
   select * into q from kadmeion_private.github_owner_quota where owner_id=p_owner_id for update;
   if q.next_allowed_at>clock_timestamp() then raise exception using errcode='P0001',message='GITHUB_LIMIT';end if;
   select * into g from kadmeion_private.github_global_quota where singleton for update;
   t:=clock_timestamp();h:=date_trunc('hour',t,'UTC');d:=date_trunc('day',t,'UTC');
   if not exists(select 1 from auth.sessions where id=p_session_id and user_id=p_owner_id and (not_after is null or not_after>t)) then raise exception using errcode='42501',message='OWNER_DENIED';end if;
   if g.next_allowed_at>t or g.blocked_until>t or g.lease_until>t or (g.hour_start=h and g.hour_count>=20) or (g.day_start=d and g.day_count>=80) then raise exception using errcode='P0001',message='GITHUB_LIMIT';end if;
   attempt:=gen_random_uuid();
   update kadmeion_private.github_global_quota set hour_count=case when g.hour_start=h then g.hour_count+1 else 1 end,hour_start=h,day_count=case when g.day_start=d then g.day_count+1 else 1 end,day_start=d,next_allowed_at=t+interval '2 seconds',attempt_id=attempt,lease_until=t+interval '20 seconds' where singleton;
   update kadmeion_private.github_owner_quota set next_allowed_at=t+interval '15 minutes' where owner_id=p_owner_id;
   update kadmeion_private.github_provider_state set version=version+1,status='PENDING',candidate=null,candidate_expires_at=null,last_attempt_at=t,last_error=null,last_op=p_operation_id,last_expected=p_expected_version,last_action=p_action,last_session=p_session_id,attempt_id=attempt,lease_until=t+interval '20 seconds' where link_id=l.id returning * into s;
 exception when raise_exception then
   if sqlerrm<>'GITHUB_LIMIT' then raise;end if;
   return jsonb_build_object('status','LIMITED','state',kadmeion_private.github_state_json(l,s,clock_timestamp()),'attemptId',null,'handle',null);
 end;
 return jsonb_build_object('status','CLAIMED','state',kadmeion_private.github_state_json(l,s,t),'attemptId',attempt,'handle',l.handle);
end;$$;
revoke all on function public.service_claim_github_provider_sync(uuid,uuid,uuid,text,bigint,uuid,smallint) from public,anon,authenticated,service_role;
grant execute on function public.service_claim_github_provider_sync(uuid,uuid,uuid,text,bigint,uuid,smallint) to service_role;

-- A matching old request may have consumed the provider allowance even when its
-- owner revoked consent/deleted/relinked during I/O. Honor that 429/403 backoff
-- without recreating owner facts, releasing a lease or touching an unrelated attempt.
-- Global quota is always the final lock. This helper never acquires upstream locks.
create function kadmeion_private.github_note_late_rate_limit(p_attempt uuid,p_retry_after timestamptz)
returns void language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare t timestamptz:=clock_timestamp();
begin
 if p_attempt is null then return;end if;
 update kadmeion_private.github_global_quota
 set blocked_until=greatest(blocked_until,t+interval '1 hour',
   least(coalesce(p_retry_after,t+interval '1 hour'),'9999-12-31 23:59:59+00'::timestamptz))
 where singleton and attempt_id=p_attempt;
end;$$;
revoke all on function kadmeion_private.github_note_late_rate_limit(uuid,timestamptz) from public,anon,authenticated,service_role;

create function public.service_finish_github_provider_sync(p_owner_id uuid,p_session_id uuid,p_link_id uuid,p_claim_version bigint,p_attempt_id uuid,p_outcome text,p_login text default null,p_provider_id bigint default null,p_html_url text default null,p_public_repos bigint default null,p_public_gists bigint default null,p_retry_after timestamptz default null) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare l public.private_platform_links;s kadmeion_private.github_provider_state;g kadmeion_private.github_global_quota;t timestamptz;new_facts kadmeion_private.github_fact_snapshot;ignored jsonb:=jsonb_build_object('status','IGNORED','state',null);
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='OWNER_DENIED';end if;
 if p_claim_version is null or p_claim_version not between 1 and 9007199254740989 or p_attempt_id is null or p_outcome is null or p_outcome not in('SUCCESS','NOT_FOUND','RATE_LIMITED','PROVIDER_UNAVAILABLE','INVALID_SOURCE','IDENTITY_CHANGED') then raise exception using errcode='22023',message='INVALID';end if;
 begin
  perform kadmeion_private.github_lock_owner(p_owner_id,p_session_id,true);l:=kadmeion_private.github_lock_link(p_owner_id,p_link_id);
 exception when insufficient_privilege then
  if p_outcome='RATE_LIMITED' then perform kadmeion_private.github_note_late_rate_limit(p_attempt_id,p_retry_after);end if;
  return ignored;end;
 select * into s from kadmeion_private.github_provider_state where link_id=l.id for update;
 if not found or not s.consent or s.status<>'PENDING' or s.version<>p_claim_version or s.attempt_id is distinct from p_attempt_id or s.last_session is distinct from p_session_id or s.lease_until<=clock_timestamp() then
  if p_outcome='RATE_LIMITED' then perform kadmeion_private.github_note_late_rate_limit(p_attempt_id,p_retry_after);end if;
  return ignored;end if;
 if p_outcome='SUCCESS' then
  if p_login is null or char_length(p_login) not between 2 and 39 or p_login !~ '^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$' or lower(p_login)<>lower(l.handle) or p_provider_id is null or p_provider_id not between 1 and 9007199254740991 or p_html_url is distinct from 'https://github.com/'||p_login or p_public_repos is null or p_public_repos not between 0 and 9007199254740991 or p_public_gists is null or p_public_gists not between 0 and 9007199254740991 or p_retry_after is not null then raise exception using errcode='22023',message='INVALID';end if;
 elsif p_login is not null or p_provider_id is not null or p_html_url is not null or p_public_repos is not null or p_public_gists is not null or (p_outcome<>'RATE_LIMITED' and p_retry_after is not null) then raise exception using errcode='22023',message='INVALID';end if;
 if p_outcome='SUCCESS' and s.last_action='SYNC' and (s.facts).provider_id is distinct from p_provider_id then p_outcome:='IDENTITY_CHANGED';end if;
 select * into g from kadmeion_private.github_global_quota where singleton for update;
 t:=clock_timestamp();
 if g.attempt_id is distinct from p_attempt_id or g.lease_until<=t or s.lease_until<=t or not exists(select 1 from auth.sessions where id=p_session_id and user_id=p_owner_id and (not_after is null or not_after>t)) then
  if p_outcome='RATE_LIMITED' then perform kadmeion_private.github_note_late_rate_limit(p_attempt_id,p_retry_after);end if;
  return ignored;end if;
 if p_outcome='SUCCESS' then
  new_facts:=row(p_login,p_provider_id,p_html_url,p_public_repos,p_public_gists,t)::kadmeion_private.github_fact_snapshot;
  if s.last_action='LOOKUP' then s.candidate:=new_facts;s.candidate_expires_at:=t+interval '10 minutes';s.status:='AWAITING_CONFIRMATION';
  elsif s.last_action='SYNC' then s.facts:=new_facts;s.status:='SYNCED';
  else return ignored;end if;
  s.last_error:=null;
 else s.status:='UNAVAILABLE';s.last_error:=p_outcome;end if;
 update kadmeion_private.github_provider_state set version=version+1,status=s.status,facts=s.facts,candidate=s.candidate,candidate_expires_at=s.candidate_expires_at,last_error=s.last_error,attempt_id=null,lease_until=null where link_id=l.id returning * into s;
 update kadmeion_private.github_global_quota set attempt_id=null,lease_until=null,blocked_until=case when p_outcome='RATE_LIMITED' then greatest(blocked_until,least(coalesce(p_retry_after,t+interval '1 hour'),'9999-12-31 23:59:59+00'::timestamptz),t+interval '1 hour') else blocked_until end where singleton and attempt_id=p_attempt_id;
 return jsonb_build_object('status','APPLIED','state',kadmeion_private.github_state_json(l,s,t));
end;$$;
revoke all on function public.service_finish_github_provider_sync(uuid,uuid,uuid,bigint,uuid,text,text,bigint,text,bigint,bigint,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.service_finish_github_provider_sync(uuid,uuid,uuid,bigint,uuid,text,text,bigint,text,bigint,bigint,timestamptz) to service_role;

-- Explicit bounded retention only. No scheduled or hosted purge authorized.
create function public.service_purge_expired_github_provider_state(p_limit integer default 100) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare t timestamptz:=clock_timestamp();c integer:=0;p integer:=0;q integer:=0;more boolean;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='OWNER_DENIED';end if;
 if p_limit is null or p_limit not between 1 and 1000 then raise exception using errcode='22023',message='INVALID';end if;
 with due as (select link_id from kadmeion_private.github_provider_state where candidate_expires_at<=t order by candidate_expires_at,link_id limit p_limit for update skip locked)
 update kadmeion_private.github_provider_state s set version=least(s.version+1,9007199254740991),consent=s.consent and s.version<9007199254740990,status=case when s.version>=9007199254740990 then 'OFF' else 'READY' end,candidate=null,candidate_expires_at=null,facts=null,last_op=null,last_expected=null,last_action=null,last_session=null,last_error=null,attempt_id=null,lease_until=null from due where s.link_id=due.link_id;
 get diagnostics c=row_count;
 with due as (select link_id from kadmeion_private.github_provider_state where lease_until<=t order by lease_until,link_id limit greatest(0,p_limit-c) for update skip locked)
 update kadmeion_private.github_provider_state s set version=least(s.version+1,9007199254740991),consent=s.consent and s.version<9007199254740990,status=case when s.version>=9007199254740990 then 'OFF' else 'UNAVAILABLE' end,facts=case when s.version>=9007199254740990 then null else s.facts end,last_error=case when s.version>=9007199254740990 then null else 'PROVIDER_UNAVAILABLE' end,last_op=null,last_expected=null,last_action=null,last_session=null,attempt_id=null,lease_until=null from due where s.link_id=due.link_id;
 get diagnostics p=row_count;
 with due as (select owner_id from kadmeion_private.github_owner_quota where next_allowed_at<=t order by next_allowed_at,owner_id limit greatest(0,p_limit-c-p) for update skip locked)
 delete from kadmeion_private.github_owner_quota q0 using due where q0.owner_id=due.owner_id;
 get diagnostics q=row_count;
 select exists(select 1 from kadmeion_private.github_provider_state where candidate_expires_at<=t or lease_until<=t) or exists(select 1 from kadmeion_private.github_owner_quota where next_allowed_at<=t) into more;
 return jsonb_build_object('candidateRowsCleared',c,'pendingRowsCleared',p,'ownerQuotaRowsDeleted',q,'more',more);
end;$$;
revoke all on function public.service_purge_expired_github_provider_state(integer) from public,anon,authenticated,service_role;
grant execute on function public.service_purge_expired_github_provider_state(integer) to service_role;
-- Global-only exact lease cleanup; never takes upstream locks.
create function public.service_release_expired_github_lease(p_attempt_id uuid,p_lease_until timestamptz) returns boolean language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='OWNER_DENIED';end if;
 update kadmeion_private.github_global_quota set attempt_id=null,lease_until=null where singleton and attempt_id=p_attempt_id and lease_until=p_lease_until and lease_until<=clock_timestamp();
 return found;
end;$$;
revoke all on function public.service_release_expired_github_lease(uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.service_release_expired_github_lease(uuid,timestamptz) to service_role;
