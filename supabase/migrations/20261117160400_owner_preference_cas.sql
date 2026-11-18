-- C08: owner preference compare-and-set. Coherent consumer/ACL cutover.
-- Never apply independently of the matching owner clients and repository QA.
create table kadmeion_private.owner_preference_cas_state (
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  domain text not null check (domain in ('NOTIFICATION','PROFILE_SHARING')),
  version bigint not null check (version between 0 and 9007199254740991),
  last_operation_id uuid,
  last_expected_version bigint,
  last_expected jsonb,
  last_desired jsonb,
  primary key(owner_user_id,domain),
  check (
    (last_operation_id is null and last_expected_version is null
      and last_expected is null and last_desired is null)
    or (last_operation_id is not null and last_expected_version is not null
      and last_expected is not null and last_desired is not null
      and last_expected_version>=0 and last_expected_version+1=version
      and version<9007199254740991)
  )
);
alter table kadmeion_private.owner_preference_cas_state enable row level security;
revoke all on kadmeion_private.owner_preference_cas_state
  from public,anon,authenticated,service_role;
comment on table kadmeion_private.owner_preference_cas_state is
  'Private preference version and latest exact replay only; no preference export shape changes.';

create function kadmeion_private.preference_tuple(p_domain text,p_row jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select case when p_row is null then 'null'::jsonb
    when p_domain='NOTIFICATION' then jsonb_build_object(
      'reviewerEnabled',p_row->'reviewer_enabled',
      'publishEnabled',p_row->'publish_enabled',
      'syncEnabled',p_row->'sync_enabled')
    when p_domain='PROFILE_SHARING' then jsonb_build_object(
      'shareDisplayName',p_row->'share_display_name',
      'shareHeadline',p_row->'share_headline','shareBio',p_row->'share_bio',
      'publicationRequested',p_row->'publication_requested')
    else null end
$$;

create function kadmeion_private.valid_preference_tuple(p_domain text,p_tuple jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare
  v_keys text[];
  v_key text;
begin
  if jsonb_typeof(p_tuple) is distinct from 'object' then return false; end if;
  case p_domain
    when 'NOTIFICATION' then v_keys:=array['reviewerEnabled','publishEnabled','syncEnabled'];
    when 'PROFILE_SHARING' then v_keys:=array[
      'shareDisplayName','shareHeadline','shareBio','publicationRequested'];
    else return false;
  end case;
  if not (p_tuple ?& v_keys) or (p_tuple-v_keys)<>'{}'::jsonb then return false; end if;
  foreach v_key in array v_keys loop
    if jsonb_typeof(p_tuple->v_key) is distinct from 'boolean' then return false; end if;
  end loop;
  if p_domain='PROFILE_SHARING' and (p_tuple->>'publicationRequested')::boolean
    and not ((p_tuple->>'shareDisplayName')::boolean or
      (p_tuple->>'shareHeadline')::boolean or (p_tuple->>'shareBio')::boolean)
    then return false; end if;
  return true;
end;
$$;

create function kadmeion_private.preference_has_increase(p_previous jsonb,p_next jsonb)
returns boolean language sql immutable set search_path='' as $$
  select exists(select 1 from jsonb_each(p_next) n
    where n.value='true'::jsonb and coalesce(p_previous->n.key,'false'::jsonb)
      is distinct from 'true'::jsonb)
$$;

-- BEFORE existing invalidation: prohibit terminal revival and ensure internal
-- mandatory withdrawal can saturate without overflow or caller-controlled GUC.
create function kadmeion_private.guard_owner_preference_terminal()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_domain text:=tg_argv[0];
  v_new jsonb:=to_jsonb(new);
  v_old jsonb;
  v_owner uuid;
  v_key text;
  v_version bigint;
  v_previous jsonb:='null'::jsonb;
  v_desired jsonb;
begin
  if v_domain not in ('NOTIFICATION','PROFILE_SHARING') then
    raise exception 'Invalid preference trigger domain';
  end if;
  v_key:=case when v_domain='NOTIFICATION' then 'owner_user_id' else 'user_id' end;
  v_owner:=(v_new->>v_key)::uuid;
  if tg_op='UPDATE' then
    v_old:=to_jsonb(old);
    if (v_old->>v_key)::uuid is distinct from v_owner then
      raise exception using errcode='22023',message='PREFERENCE_OWNER_IMMUTABLE';
    end if;
    v_previous:=kadmeion_private.preference_tuple(v_domain,v_old);
  end if;
  v_desired:=kadmeion_private.preference_tuple(v_domain,v_new);
  if tg_op='UPDATE' and v_previous=v_desired then return new; end if;
  select version into v_version from kadmeion_private.owner_preference_cas_state
    where owner_user_id=v_owner and domain=v_domain;
  if coalesce(v_version,0)<9007199254740990 then return new; end if;
  if v_version=9007199254740991 and tg_op='INSERT' then
    raise exception using errcode='40001',message='PREFERENCE_TERMINAL';
  end if;
  if v_domain='NOTIFICATION' then
    if v_version=9007199254740991 and kadmeion_private.preference_has_increase(v_previous,v_desired)
      then raise exception using errcode='40001',message='PREFERENCE_TERMINAL'; end if;
    new.reviewer_enabled:=false;
    new.publish_enabled:=false;
    new.sync_enabled:=false;
  else
    new.publication_requested:=false;
    new.requested_at:=null;
    v_desired:=kadmeion_private.preference_tuple(v_domain,to_jsonb(new));
    if kadmeion_private.preference_has_increase(v_previous,v_desired) then
      raise exception using errcode='40001',message='PREFERENCE_TERMINAL';
    end if;
  end if;
  return new;
end;
$$;

-- AFTER the existing projection invalidation: every real INSERT/DELETE/tuple
-- change advances the domain independently. A cascade must not recreate state.
create function kadmeion_private.bump_owner_preference_version()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_domain text:=tg_argv[0];
  v_row jsonb;
  v_key text;
  v_owner uuid;
begin
  if v_domain not in ('NOTIFICATION','PROFILE_SHARING') then
    raise exception 'Invalid preference trigger domain';
  end if;
  if tg_op='UPDATE' and
    kadmeion_private.preference_tuple(v_domain,to_jsonb(old))=
    kadmeion_private.preference_tuple(v_domain,to_jsonb(new)) then return null; end if;
  if tg_op='DELETE' then v_row:=to_jsonb(old); else v_row:=to_jsonb(new); end if;
  v_key:=case when v_domain='NOTIFICATION' then 'owner_user_id' else 'user_id' end;
  v_owner:=(v_row->>v_key)::uuid;
  if not exists(select 1 from auth.users where id=v_owner) then return null; end if;
  insert into kadmeion_private.owner_preference_cas_state as state(owner_user_id,domain,version)
    values(v_owner,v_domain,1)
  on conflict(owner_user_id,domain) do update set
    version=least(state.version+1,9007199254740991::bigint),
    last_operation_id=null,last_expected_version=null,last_expected=null,last_desired=null;
  return null;
end;
$$;

create trigger kd_guard_preference_terminal before insert or update on public.private_notification_preferences
  for each row execute function kadmeion_private.guard_owner_preference_terminal('NOTIFICATION');
create trigger kd_guard_preference_terminal before insert or update on public.profile_sharing_preferences
  for each row execute function kadmeion_private.guard_owner_preference_terminal('PROFILE_SHARING');
create trigger zz_kd_owner_preference_version after insert or update or delete on public.private_notification_preferences
  for each row execute function kadmeion_private.bump_owner_preference_version('NOTIFICATION');
create trigger zz_kd_owner_preference_version after insert or update or delete on public.profile_sharing_preferences
  for each row execute function kadmeion_private.bump_owner_preference_version('PROFILE_SHARING');

create function kadmeion_private.check_owner_preference_session(p_owner uuid,p_session uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_owner is distinct from (select auth.uid())
    or p_session is distinct from kadmeion_private.require_live_exit_auth_session()
    or not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
      where s.id=p_session and s.user_id=p_owner
        and (s.not_after is null or s.not_after>clock_timestamp())) then
    raise exception using errcode='42501',message='LIVE_SESSION_REQUIRED';
  end if;
end;
$$;

-- Lock order is owner -> profile -> actual domain row -> private state row.
-- Missing domain rows are serialized by the profile lock.
create function kadmeion_private.lock_owner_preference(p_domain text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid:=(select auth.uid());
  v_session uuid;
begin
  v_session:=kadmeion_private.require_live_exit_auth_session();
  if p_domain is null or p_domain not in ('NOTIFICATION','PROFILE_SHARING') then
    raise exception using errcode='22023',message='INVALID_PREFERENCE_DOMAIN';
  end if;
  perform 1 from auth.users where id=v_owner for key share;
  if not found then raise exception using errcode='42501',message='LIVE_SESSION_REQUIRED'; end if;
  perform 1 from public.profiles where user_id=v_owner for update;
  if not found then raise exception using errcode='42501',message='OWNER_PROFILE_NOT_FOUND'; end if;
  if p_domain='NOTIFICATION' then
    perform 1 from public.private_notification_preferences where owner_user_id=v_owner for update;
  else
    perform 1 from public.profile_sharing_preferences where user_id=v_owner for update;
  end if;
  perform 1 from kadmeion_private.owner_preference_cas_state
    where owner_user_id=v_owner and domain=p_domain for update;
  perform kadmeion_private.check_owner_preference_session(v_owner,v_session);
  return v_owner;
end;
$$;

create function kadmeion_private.current_owner_preference_tuple(p_owner uuid,p_domain text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row jsonb;
begin
  if p_domain='NOTIFICATION' then
    select to_jsonb(p) into v_row from public.private_notification_preferences p
      where p.owner_user_id=p_owner;
  elsif p_domain='PROFILE_SHARING' then
    select to_jsonb(p) into v_row from public.profile_sharing_preferences p
      where p.user_id=p_owner;
  else
    raise exception using errcode='22023',message='INVALID_PREFERENCE_DOMAIN';
  end if;
  return kadmeion_private.preference_tuple(p_domain,v_row);
end;
$$;

create function kadmeion_private.read_owner_preference(p_domain text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid:=kadmeion_private.lock_owner_preference(p_domain);
  v_session uuid:=kadmeion_private.require_live_exit_auth_session();
  v_version bigint;
  v_tuple jsonb;
begin
  select version into v_version from kadmeion_private.owner_preference_cas_state
    where owner_user_id=v_owner and domain=p_domain;
  v_tuple:=kadmeion_private.current_owner_preference_tuple(v_owner,p_domain);
  perform kadmeion_private.check_owner_preference_session(v_owner,v_session);
  return jsonb_build_object('ownerUserId',v_owner,'version',coalesce(v_version,0),'preferences',v_tuple);
end;
$$;

create function kadmeion_private.change_owner_preference(p_domain text,p_expected_version bigint,
  p_expected jsonb,p_desired jsonb,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid:=kadmeion_private.lock_owner_preference(p_domain);
  v_session uuid:=kadmeion_private.require_live_exit_auth_session();
  v_expected jsonb:=coalesce(p_expected,'null'::jsonb);
  v_current jsonb;
  v_result jsonb;
  v_state kadmeion_private.owner_preference_cas_state%rowtype;
  v_version bigint;
  v_next bigint;
  v_status text;
begin
  if p_expected_version is null or p_expected_version<0 or p_expected_version>9007199254740991
    or p_operation_id is null
    or (v_expected<>'null'::jsonb and not kadmeion_private.valid_preference_tuple(p_domain,v_expected))
    or not kadmeion_private.valid_preference_tuple(p_domain,p_desired) then
    raise exception using errcode='22023',message='INVALID_PREFERENCE_CHANGE';
  end if;
  select * into v_state from kadmeion_private.owner_preference_cas_state
    where owner_user_id=v_owner and domain=p_domain;
  v_version:=coalesce(v_state.version,0);
  v_current:=kadmeion_private.current_owner_preference_tuple(v_owner,p_domain);
  if v_state.last_operation_id=p_operation_id then
    if v_state.last_expected_version=p_expected_version and v_state.last_expected=v_expected
      and v_state.last_desired=p_desired and v_current=p_desired and v_version<9007199254740991 then
      v_status:='REPLAYED';
    else raise exception using errcode='40001',message='PREFERENCE_CONFLICT'; end if;
  elsif v_version<>p_expected_version or v_current is distinct from v_expected then
    raise exception using errcode='40001',message='PREFERENCE_CONFLICT';
  elsif v_current=p_desired then
    v_status:='NO_CHANGE';
  else
    v_next:=least(v_version+1,9007199254740991::bigint);
    if v_next=9007199254740991 then
      if (v_version=v_next and v_current='null'::jsonb)
        or kadmeion_private.preference_has_increase(v_current,p_desired)
        or (p_domain='NOTIFICATION' and exists(select 1 from jsonb_each(p_desired) e where e.value='true'::jsonb))
        or (p_domain='PROFILE_SHARING' and p_desired->'publicationRequested'='true'::jsonb) then
        raise exception using errcode='40001',message='PREFERENCE_TERMINAL';
      end if;
    end if;
    if p_domain='NOTIFICATION' then
      if v_current='null'::jsonb then
        insert into public.private_notification_preferences(owner_user_id,reviewer_enabled,publish_enabled,sync_enabled)
          values(v_owner,(p_desired->>'reviewerEnabled')::boolean,
            (p_desired->>'publishEnabled')::boolean,(p_desired->>'syncEnabled')::boolean);
      else
        update public.private_notification_preferences set
          reviewer_enabled=(p_desired->>'reviewerEnabled')::boolean,
          publish_enabled=(p_desired->>'publishEnabled')::boolean,
          sync_enabled=(p_desired->>'syncEnabled')::boolean where owner_user_id=v_owner;
      end if;
    else
      if v_current='null'::jsonb then
        insert into public.profile_sharing_preferences(user_id,share_display_name,share_headline,share_bio,
          publication_requested,requested_at)
          values(v_owner,(p_desired->>'shareDisplayName')::boolean,(p_desired->>'shareHeadline')::boolean,
            (p_desired->>'shareBio')::boolean,(p_desired->>'publicationRequested')::boolean,
            case when (p_desired->>'publicationRequested')::boolean then statement_timestamp() else null end);
      else
        update public.profile_sharing_preferences set
          share_display_name=(p_desired->>'shareDisplayName')::boolean,
          share_headline=(p_desired->>'shareHeadline')::boolean,share_bio=(p_desired->>'shareBio')::boolean,
          publication_requested=(p_desired->>'publicationRequested')::boolean,
          requested_at=case when (p_desired->>'publicationRequested')::boolean then statement_timestamp() else null end
          where user_id=v_owner;
      end if;
    end if;
    select version into v_version from kadmeion_private.owner_preference_cas_state
      where owner_user_id=v_owner and domain=p_domain;
    v_current:=kadmeion_private.current_owner_preference_tuple(v_owner,p_domain);
    if v_version is distinct from v_next or v_current is distinct from p_desired then
      raise exception using errcode='40001',message='PREFERENCE_CONFLICT';
    end if;
    if v_version<9007199254740991 then
      update kadmeion_private.owner_preference_cas_state set last_operation_id=p_operation_id,
        last_expected_version=p_expected_version,last_expected=v_expected,last_desired=p_desired
        where owner_user_id=v_owner and domain=p_domain and version=v_version;
      if not found then raise exception using errcode='40001',message='PREFERENCE_CONFLICT'; end if;
    end if;
    v_status:='APPLIED';
  end if;
  perform kadmeion_private.check_owner_preference_session(v_owner,v_session);
  v_result:=jsonb_build_object('status',v_status,'ownerUserId',v_owner,'version',v_version,'preferences',v_current);
  return v_result;
end;
$$;

create function public.read_owner_notification_preferences_state()
returns jsonb language sql security definer set search_path='' as $$
  select kadmeion_private.read_owner_preference('NOTIFICATION')
$$;
create function public.read_owner_profile_sharing_state()
returns jsonb language sql security definer set search_path='' as $$
  select kadmeion_private.read_owner_preference('PROFILE_SHARING')
$$;
create function public.change_owner_notification_preferences(p_expected_version bigint,
  p_expected jsonb,p_desired jsonb,p_operation_id uuid)
returns jsonb language sql security definer set search_path='' as $$
  select kadmeion_private.change_owner_preference('NOTIFICATION',p_expected_version,p_expected,p_desired,p_operation_id)
$$;
create function public.change_owner_profile_sharing(p_expected_version bigint,
  p_expected jsonb,p_desired jsonb,p_operation_id uuid)
returns jsonb language sql security definer set search_path='' as $$
  select kadmeion_private.change_owner_preference('PROFILE_SHARING',p_expected_version,p_expected,p_desired,p_operation_id)
$$;

revoke all on function kadmeion_private.preference_tuple(text,jsonb),
  kadmeion_private.valid_preference_tuple(text,jsonb),
  kadmeion_private.preference_has_increase(jsonb,jsonb),
  kadmeion_private.guard_owner_preference_terminal(),
  kadmeion_private.bump_owner_preference_version(),
  kadmeion_private.check_owner_preference_session(uuid,uuid),
  kadmeion_private.lock_owner_preference(text),
  kadmeion_private.current_owner_preference_tuple(uuid,text),
  kadmeion_private.read_owner_preference(text),
  kadmeion_private.change_owner_preference(text,bigint,jsonb,jsonb,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.read_owner_notification_preferences_state(),
  public.read_owner_profile_sharing_state(),
  public.change_owner_notification_preferences(bigint,jsonb,jsonb,uuid),
  public.change_owner_profile_sharing(bigint,jsonb,jsonb,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.read_owner_notification_preferences_state(),
  public.read_owner_profile_sharing_state(),
  public.change_owner_notification_preferences(bigint,jsonb,jsonb,uuid),
  public.change_owner_profile_sharing(bigint,jsonb,jsonb,uuid) to authenticated;
revoke insert,update,delete,truncate,references,trigger on public.profile_sharing_preferences,
  public.private_notification_preferences from public,anon,authenticated,service_role;
revoke all on function public.owner_set_notification_preferences(boolean,boolean,boolean)
  from public,anon,authenticated,service_role;
drop policy sharing_owner_insert on public.profile_sharing_preferences;
drop policy sharing_owner_update on public.profile_sharing_preferences;

-- Retain original mandatory event handling and suppress optional defaults at M.
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
revoke all on function kadmeion_private.record_owner_notification()
  from public,anon,authenticated,service_role;

create or replace function kadmeion_private.record_cloud_revision_notification()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if not exists(select 1 from kadmeion_private.owner_preference_cas_state s
      where s.owner_user_id=new.owner_user_id and s.domain='NOTIFICATION'
        and s.version=9007199254740991)
    and exists(select 1 from public.private_notification_preferences p
    where p.owner_user_id=new.owner_user_id and p.sync_enabled) then
    insert into public.private_notifications (
      owner_user_id,event_type,category,priority,target_id,source_key
    ) values (
      new.owner_user_id,'CLOUD_REVISION_SAVED','SYNC','NORMAL',new.portfolio_id,
      new.portfolio_id::text||':'||new.revision::text
    ) on conflict (owner_user_id,event_type,source_key) do nothing;
  end if;
  return null;
end;
$function$;
revoke all on function kadmeion_private.record_cloud_revision_notification()
  from public,anon,authenticated,service_role;
