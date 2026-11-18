-- B16 C13: consented public-portfolio aggregate analytics (forward only).
-- Requires actual C11/C14; no hosted collector or scheduler activation.
do $$ begin
 if to_regprocedure('public.service_read_current_public_delivery_receipt(uuid,uuid)') is null
 or to_regprocedure('kadmeion_private.lock_expected_public_delivery(jsonb)') is null
 or to_regprocedure('kadmeion_private.account_public_sharing_allowed(uuid)') is null
 or to_regprocedure('kadmeion_private.require_live_exit_auth_session()') is null
 then raise exception 'ANALYTICS_PREREQUISITES_MISSING'; end if;
end $$;
create table kadmeion_private.analytics_opt_in(
 portfolio_id uuid primary key references public.portfolios(id) on delete cascade,
 enabled boolean not null,
 version bigint not null check(version between 1 and 9007199254740991),
 enabled_at timestamptz, coverage_started_at timestamptz, updated_at timestamptz not null,
 last_operation_id uuid, last_action text, last_expected_version bigint,
 check((enabled and version<9007199254740991 and enabled_at is not null and coverage_started_at is not null
   and enabled_at<=coverage_started_at and coverage_started_at<=updated_at)
   or (not enabled and enabled_at is null and coverage_started_at is null)),
 check((last_operation_id is null and last_action is null and last_expected_version is null)
   or (last_operation_id is not null and last_action is not null and last_expected_version is not null
       and last_expected_version=version-1 and ((enabled and last_action in ('ENABLE','CLEAR')) or (not enabled and last_action='DISABLE'))))
);
create table kadmeion_private.aggregate_daily(
 portfolio_id uuid not null references public.portfolios(id) on delete cascade,
 utc_day date not null, referrer_bucket text not null
 check(referrer_bucket in ('DIRECT_OR_UNKNOWN','SEARCH','SOCIAL','OTHER_EXTERNAL','INTERNAL')),
 views integer not null check(views between 1 and 250),
 primary key(portfolio_id,utc_day,referrer_bucket)
);
create index kd_analytics_daily_retention on kadmeion_private.aggregate_daily(utc_day,portfolio_id,referrer_bucket);
create table kadmeion_private.analytics_rate_window(
 scope_key text primary key,portfolio_id uuid unique references public.portfolios(id) on delete cascade,
 minute_start timestamptz not null,minute_used integer not null,utc_day date not null,day_used integer not null,
 check(minute_start=date_trunc('minute',minute_start,'UTC') and utc_day=(minute_start at time zone 'UTC')::date and minute_used<=day_used),
 check((scope_key='GLOBAL' and portfolio_id is null and minute_used between 0 and 120 and day_used between 0 and 1000)
 or (portfolio_id is not null and scope_key=portfolio_id::text and minute_used between 0 and 30 and day_used between 0 and 250))
);
create index kd_analytics_quota_retention on kadmeion_private.analytics_rate_window(utc_day,scope_key);
alter table kadmeion_private.analytics_opt_in enable row level security;
alter table kadmeion_private.aggregate_daily enable row level security;
alter table kadmeion_private.analytics_rate_window enable row level security;
revoke all on kadmeion_private.analytics_opt_in,kadmeion_private.aggregate_daily,kadmeion_private.analytics_rate_window from public,anon,authenticated,service_role;
insert into kadmeion_private.analytics_rate_window
 select 'GLOBAL',null,date_trunc('minute',t,'UTC'),0,(t at time zone 'UTC')::date,0 from (select clock_timestamp() t) stamp;

create function kadmeion_private.analytics_live_owner() returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); s uuid;
begin
 s:=kadmeion_private.require_live_exit_auth_session();
 if u is null or not exists(select 1 from auth.sessions a join auth.users b on b.id=a.user_id
 where a.id=s and a.user_id=u and (a.not_after is null or a.not_after>clock_timestamp()))
 then raise exception using errcode='42501',message='ANALYTICS_OWNER_DENIED'; end if;
 return u;
end $$;
revoke all on function kadmeion_private.analytics_live_owner() from public,anon,authenticated,service_role;

-- Exact current verified C11 receipt, including C14 eligibility. No legacy fallback.
create function kadmeion_private.analytics_authority(p uuid,u uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select q.receipt from public.portfolios b
 join kadmeion_private.unlisted_release_routes r on r.portfolio_id=b.id and r.owner_user_id=b.owner_user_id
 cross join lateral (select public.service_read_current_public_delivery_receipt(b.id,r.intent_id) receipt) q
 where b.id=p and b.owner_user_id=u and b.trashed_at is null
 and kadmeion_private.account_public_sharing_allowed(u)
 and q.receipt is not null and q.receipt->>'visibility'='PUBLIC' and q.receipt->>'verifiedAt' is not null
$$;
revoke all on function kadmeion_private.analytics_authority(uuid,uuid) from public,anon,authenticated,service_role;

create function public.read_owner_analytics_state(p_portfolio_id uuid) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare u uuid:=kadmeion_private.analytics_live_owner(); result jsonb;
begin
 select jsonb_build_object('portfolioId',p.id,'enabled',coalesce(a.enabled,false),
 'eligible',kadmeion_private.analytics_authority(p.id,u) is not null,'version',coalesce(a.version,0),
 'policyVersion',1,'enabledAt',a.enabled_at,'coverageStartedAt',a.coverage_started_at,'updatedAt',a.updated_at,'retentionDays',30)
 into result from public.portfolios p left join kadmeion_private.analytics_opt_in a on a.portfolio_id=p.id
 where p.id=p_portfolio_id and p.owner_user_id=u;
 if result is null or kadmeion_private.analytics_live_owner() is distinct from u
 then raise exception using errcode='42501',message='ANALYTICS_OWNER_DENIED'; end if;
 return result;
end $$;
revoke all on function public.read_owner_analytics_state(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_owner_analytics_state(uuid) to authenticated;

create function public.change_owner_analytics(p_portfolio_id uuid,p_action text,p_expected_version bigint,p_operation_id uuid,p_policy_version smallint)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='50ms' as $$
declare u uuid:=kadmeion_private.analytics_live_owner(); a kadmeion_private.analytics_opt_in%rowtype;
 receipt jsonb; v bigint; status text; t timestamptz;
begin
 if p_portfolio_id is null or p_action is null or p_action not in ('ENABLE','CLEAR','DISABLE')
 or p_expected_version is null or p_expected_version not between 0 and 9007199254740991
 or p_operation_id is null or p_policy_version is distinct from 1
 then raise exception using errcode='22023',message='ANALYTICS_INVALID'; end if;
 perform 1 from public.portfolios where id=p_portfolio_id and owner_user_id=u for update nowait;
 if not found then raise exception using errcode='42501',message='ANALYTICS_OWNER_DENIED'; end if;
 -- Acquire C11 locks in its exact order before consent, only for opt-in.
 if p_action='ENABLE' then
   receipt:=kadmeion_private.analytics_authority(p_portfolio_id,u);
   if receipt is null then raise exception using errcode='55000',message='ANALYTICS_INELIGIBLE'; end if;
   perform kadmeion_private.lock_expected_public_delivery(receipt);
 end if;
 select * into a from kadmeion_private.analytics_opt_in where portfolio_id=p_portfolio_id for update nowait;
 v:=coalesce(a.version,0);
 if kadmeion_private.analytics_live_owner() is distinct from u then raise exception using errcode='42501',message='ANALYTICS_OWNER_DENIED'; end if;
 if a.last_operation_id=p_operation_id then
   if a.last_action is distinct from p_action or a.last_expected_version is distinct from p_expected_version
   then raise exception using errcode='40001',message='ANALYTICS_CONFLICT'; end if;
   status:='REPLAYED';
 elsif v<>p_expected_version then raise exception using errcode='40001',message='ANALYTICS_CONFLICT';
 elsif p_action='DISABLE' and not coalesce(a.enabled,false) then status:='NO_CHANGE';
 else
   if p_action<>'DISABLE' and v>=9007199254740990 then raise exception using errcode='55000',message='ANALYTICS_TERMINAL'; end if;
   if (p_action='ENABLE' and (coalesce(a.enabled,false) or kadmeion_private.analytics_authority(p_portfolio_id,u) is null))
      or (p_action='CLEAR' and not coalesce(a.enabled,false))
   then raise exception using errcode='55000',message='ANALYTICS_INELIGIBLE'; end if;
   t:=clock_timestamp();
   if a.updated_at is not null and t<a.updated_at then
     if p_action='DISABLE' then t:=a.updated_at; else raise exception using errcode='40001',message='ANALYTICS_CONFLICT'; end if;
   end if;
   delete from kadmeion_private.aggregate_daily where portfolio_id=p_portfolio_id;
   insert into kadmeion_private.analytics_opt_in(portfolio_id,enabled,version,enabled_at,coverage_started_at,updated_at,last_operation_id,last_action,last_expected_version)
   values(p_portfolio_id,p_action<>'DISABLE',v+1,case p_action when 'ENABLE' then t when 'CLEAR' then a.enabled_at else null end,
     case when p_action<>'DISABLE' then t end,t,p_operation_id,p_action,v)
   on conflict(portfolio_id) do update set enabled=excluded.enabled,version=excluded.version,enabled_at=excluded.enabled_at,
   coverage_started_at=excluded.coverage_started_at,updated_at=excluded.updated_at,last_operation_id=excluded.last_operation_id,
   last_action=excluded.last_action,last_expected_version=excluded.last_expected_version returning * into a;
   status:='APPLIED';
 end if;
 return jsonb_build_object('status',status,'portfolioId',p_portfolio_id,'enabled',coalesce(a.enabled,false),
 'version',coalesce(a.version,0),'policyVersion',1,'enabledAt',a.enabled_at,'coverageStartedAt',a.coverage_started_at,'updatedAt',a.updated_at);
end $$;
revoke all on function public.change_owner_analytics(uuid,text,bigint,uuid,smallint) from public,anon,authenticated,service_role;
grant execute on function public.change_owner_analytics(uuid,text,bigint,uuid,smallint) to authenticated;

create function public.read_owner_analytics(p_portfolio_ids uuid[],p_window_days integer) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare u uuid:=kadmeion_private.analytics_live_owner(); t timestamptz:=clock_timestamp();
 hi date:=(t at time zone 'UTC')::date; lo date; n integer; result jsonb;
begin
 if array_ndims(p_portfolio_ids) is distinct from 1 or cardinality(p_portfolio_ids) not between 1 and 5
 or p_window_days is null or p_window_days not in (7,30)
 or (select count(distinct x) from unnest(p_portfolio_ids) x)<>cardinality(p_portfolio_ids)
 then raise exception using errcode='22023',message='ANALYTICS_INVALID'; end if;
 lo:=hi-p_window_days+1;
 with selected as (
 select p.id,k.ord,a.version,a.coverage_started_at,kadmeion_private.analytics_authority(p.id,u) is not null eligible
 from unnest(p_portfolio_ids) with ordinality k(id,ord)
 join public.portfolios p on p.id=k.id and p.owner_user_id=u
 join kadmeion_private.analytics_opt_in a on a.portfolio_id=p.id and a.enabled
 ), days as (
 select s.id,s.ord,s.version,s.coverage_started_at,s.eligible,lo+g.n AS bucket_day,sum(x.views)::integer AS views,
 jsonb_build_object('DIRECT_OR_UNKNOWN',coalesce(sum(x.views) filter(where x.referrer_bucket='DIRECT_OR_UNKNOWN'),0),
 'SEARCH',coalesce(sum(x.views) filter(where x.referrer_bucket='SEARCH'),0),'SOCIAL',coalesce(sum(x.views) filter(where x.referrer_bucket='SOCIAL'),0),
 'OTHER_EXTERNAL',coalesce(sum(x.views) filter(where x.referrer_bucket='OTHER_EXTERNAL'),0),'INTERNAL',coalesce(sum(x.views) filter(where x.referrer_bucket='INTERNAL'),0)) buckets
 from selected s cross join generate_series(0,p_window_days-1) g(n)
 left join kadmeion_private.aggregate_daily x on x.portfolio_id=s.id and x.utc_day=lo+g.n
 and x.utc_day>=(s.coverage_started_at at time zone 'UTC')::date
 group by s.id,s.ord,s.version,s.coverage_started_at,s.eligible,g.n
 ), grouped as (
 select ord,jsonb_build_object('portfolioId',id,'version',version,'coverageStartedAt',coverage_started_at,'eligible',eligible,
 'quality',case when bool_or(views>0) then 'PARTIAL' else 'UNAVAILABLE' end,
 'days',jsonb_agg(jsonb_build_object('day',bucket_day,'views',views,'buckets',case when views>0 then buckets end,
 'quality',case when views>0 then 'PARTIAL' else 'UNAVAILABLE' end) order by bucket_day)) item,
 coalesce(bool_or(views>250 or coverage_started_at>t),false) bad
 from days group by id,ord,version,coverage_started_at,eligible
 ) select count(*)::integer,jsonb_build_object('asOfUtc',t,'fromDay',lo,'toDay',hi,'retentionDays',30,'portfolios',jsonb_agg(item order by ord))
 into n,result from grouped having not coalesce(bool_or(bad),false);
 if n is distinct from cardinality(p_portfolio_ids) or result is null or kadmeion_private.analytics_live_owner() is distinct from u
 then raise exception using errcode='42501',message='ANALYTICS_OWNER_DENIED'; end if;
 if octet_length(result::text)>131072 then raise exception using errcode='54000',message='ANALYTICS_LIMIT'; end if;
 return result;
end $$;
revoke all on function public.read_owner_analytics(uuid[],integer) from public,anon,authenticated,service_role;
grant execute on function public.read_owner_analytics(uuid[],integer) to authenticated;

-- Consent revocation never retains counts; quota remains minimally until UTC rollover.
create function kadmeion_private.analytics_reset(p uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 update kadmeion_private.analytics_opt_in set enabled=false,version=version+1,enabled_at=null,coverage_started_at=null,
 updated_at=greatest(updated_at,clock_timestamp()),last_operation_id=null,last_action=null,last_expected_version=null
 where portfolio_id=p and enabled;
 delete from kadmeion_private.aggregate_daily where portfolio_id=p;
end $$;
revoke all on function kadmeion_private.analytics_reset(uuid) from public,anon,authenticated,service_role;
create function kadmeion_private.analytics_lifecycle() returns trigger
language plpgsql security definer set search_path='' as $$
declare p uuid;
begin
 if tg_table_name='portfolios' then
   if old.slug is distinct from new.slug or (old.trashed_at is null and new.trashed_at is not null) then perform kadmeion_private.analytics_reset(new.id); end if;
 elsif tg_table_name='profiles' then
   if old.handle is distinct from new.handle then
     for p in select id from public.portfolios where owner_user_id=new.user_id order by id loop perform kadmeion_private.analytics_reset(p); end loop;
   end if;
 elsif tg_table_name='private_release_visibility_pointers' then
   if tg_op='DELETE' then perform kadmeion_private.analytics_reset(old.portfolio_id);
   elsif new.status='BLOCKED' then perform kadmeion_private.analytics_reset(new.portfolio_id);
   elsif tg_op='UPDATE' and new.revocation_generation>old.revocation_generation then perform kadmeion_private.analytics_reset(new.portfolio_id); end if;
 elsif tg_table_name='moderation_portfolio_holds' then perform kadmeion_private.analytics_reset(new.portfolio_id);
 elsif tg_table_name='account_sharing_restrictions' then
   if new.status='ACTIVE' then for p in select id from public.portfolios where owner_user_id=new.owner_user_id order by id loop perform kadmeion_private.analytics_reset(p); end loop; end if;
 elsif tg_table_name='unlisted_release_routes' then
   if tg_op='DELETE' then perform kadmeion_private.analytics_reset(old.portfolio_id);
   elsif old.status='LIVE' and (new.status<>'LIVE' or new.release_generation<old.release_generation or not exists(
     select 1 from public.private_unlisted_publication_intents i join public.private_release_requests q on q.id=i.request_id
     where i.id=new.intent_id and i.portfolio_id=new.portfolio_id and i.owner_user_id=new.owner_user_id
       and q.visibility_intent='PUBLIC' and (new.intent_id=old.intent_id or i.rollback_from_id is null)
   )) then perform kadmeion_private.analytics_reset(new.portfolio_id); end if;
 elsif tg_table_name='private_unlisted_publication_intents' then
   if(old.public_handle is distinct from new.public_handle or old.public_slug is distinct from new.public_slug)
     and exists(select 1 from kadmeion_private.unlisted_release_routes where intent_id=new.id and status='LIVE')
   then perform kadmeion_private.analytics_reset(new.portfolio_id); end if;
 end if;
 return null;
end $$;
revoke all on function kadmeion_private.analytics_lifecycle() from public,anon,authenticated,service_role;
create trigger zz_analytics_portfolio after update of slug,trashed_at on public.portfolios for each row execute function kadmeion_private.analytics_lifecycle();
create trigger zz_analytics_handle after update of handle on public.profiles for each row execute function kadmeion_private.analytics_lifecycle();
create trigger zz_analytics_pointer after insert or update or delete on public.private_release_visibility_pointers for each row execute function kadmeion_private.analytics_lifecycle();
create trigger zz_analytics_hold after insert on kadmeion_private.moderation_portfolio_holds for each row execute function kadmeion_private.analytics_lifecycle();
create trigger zz_analytics_restriction after insert or update of status on kadmeion_private.account_sharing_restrictions for each row execute function kadmeion_private.analytics_lifecycle();
create trigger zz_analytics_route after update or delete on kadmeion_private.unlisted_release_routes for each row execute function kadmeion_private.analytics_lifecycle();
create trigger zz_analytics_intent after update of public_handle,public_slug on public.private_unlisted_publication_intents for each row execute function kadmeion_private.analytics_lifecycle();

create function public.service_purge_expired_portfolio_analytics(p_limit integer default 1000) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='50ms' as $$
declare t timestamptz:=clock_timestamp(); d date:=(t at time zone 'UTC')::date; a integer; q integer;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception using errcode='42501',message='TRUSTED_WORKER_REQUIRED'; end if;
 if p_limit is null or p_limit not between 1 and 1000 then raise exception using errcode='22023',message='ANALYTICS_INVALID'; end if;
 with batch as (select portfolio_id,utc_day,referrer_bucket from kadmeion_private.aggregate_daily where utc_day<d-29
 order by utc_day,portfolio_id,referrer_bucket limit p_limit for update skip locked)
 delete from kadmeion_private.aggregate_daily x using batch b where (x.portfolio_id,x.utc_day,x.referrer_bucket)=(b.portfolio_id,b.utc_day,b.referrer_bucket);
 get diagnostics a=row_count;
 with batch as (select scope_key from kadmeion_private.analytics_rate_window where portfolio_id is not null and utc_day<d
 order by utc_day,scope_key limit p_limit for update skip locked)
 delete from kadmeion_private.analytics_rate_window x using batch b where x.scope_key=b.scope_key;
 get diagnostics q=row_count;
 -- The singleton global quota contains no visitor identifiers, but must
 -- still expire at UTC rollover even when no subsequent event arrives.
 -- This touches at most one row, after the bounded portfolio cleanup.
 update kadmeion_private.analytics_rate_window
   set minute_start=date_trunc('minute',t,'UTC'),minute_used=0,utc_day=d,day_used=0
   where scope_key='GLOBAL' and utc_day<d;
 return jsonb_build_object('aggregateRowsDeleted',a,'quotaRowsDeleted',q,'more',
 exists(select 1 from kadmeion_private.aggregate_daily where utc_day<d-29)
 or exists(select 1 from kadmeion_private.analytics_rate_window where portfolio_id is not null and utc_day<d));
end $$;
revoke all on function public.service_purge_expired_portfolio_analytics(integer) from public,anon,authenticated,service_role;
grant execute on function public.service_purge_expired_portfolio_analytics(integer) to service_role;

-- Independent bounded owner annex, not an inventory-bound account archive.
create function public.owner_export_portfolio_analytics_annex() returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare u uuid:=kadmeion_private.analytics_live_owner(); t timestamptz:=clock_timestamp(); hi date:=(t at time zone 'UTC')::date;
 nc bigint; nr bigint; invalid boolean; result jsonb;
begin
 with owned as materialized (
 select p.id,coalesce(a.enabled,false) enabled,coalesce(a.version,0) version,a.enabled_at,a.coverage_started_at,a.updated_at
 from public.portfolios p left join kadmeion_private.analytics_opt_in a on a.portfolio_id=p.id where p.owner_user_id=u order by p.id limit 101
 ), retained as materialized (
 select x.*,case x.referrer_bucket when 'DIRECT_OR_UNKNOWN' then 1 when 'SEARCH' then 2 when 'SOCIAL' then 3 when 'OTHER_EXTERNAL' then 4 else 5 end bucket_order
 from owned o join kadmeion_private.aggregate_daily x on x.portfolio_id=o.id
 where o.enabled and x.utc_day between hi-29 and hi and x.utc_day>=(o.coverage_started_at at time zone 'UTC')::date
 order by x.portfolio_id,x.utc_day,bucket_order limit 15001
 ), c as (select count(*) n,coalesce(jsonb_agg(jsonb_build_object('portfolioId',id,'enabled',enabled,'version',version,
 'policyVersion',1,'enabledAt',enabled_at,'coverageStartedAt',coverage_started_at,'updatedAt',updated_at) order by id),'[]'::jsonb) items from owned),
 d as (select count(*) n,coalesce(jsonb_agg(jsonb_build_object('portfolioId',portfolio_id,'utcDay',utc_day,'referrerBucket',referrer_bucket,'views',views)
 order by portfolio_id,utc_day,bucket_order),'[]'::jsonb) items from retained)
 select c.n,d.n,exists(select 1 from retained group by portfolio_id,utc_day having sum(views)>250),
 jsonb_build_object('kind','KADMEION_PORTFOLIO_ANALYTICS_ANNEX','schemaVersion',1,'scope','OWNER_PORTFOLIO_ANALYTICS',
 'ownerUserId',u,'asOfUtc',t,'fromDay',hi-29,'toDay',hi,'retentionDays',30,'consents',c.items,'aggregates',d.items,
 'quality',case when d.n>0 then 'PARTIAL' else 'UNAVAILABLE' end,
 'limitations',jsonb_build_object('completeVisitorCoverage',false,'operationalQuotaValuesIncluded',false,'sameDayOperationalCounterRetained',true,'backupErasureVerified',false))
 into nc,nr,invalid,result from c cross join d;
 if kadmeion_private.analytics_live_owner() is distinct from u then raise exception using errcode='42501',message='ANALYTICS_OWNER_DENIED'; end if;
 if nc>100 or nr>15000 or invalid or octet_length(result::text)>12582912 then raise exception using errcode='54000',message='ANALYTICS_ANNEX_LIMIT_EXCEEDED'; end if;
 return result;
end $$;
revoke all on function public.owner_export_portfolio_analytics_annex() from public,anon,authenticated,service_role;
grant execute on function public.owner_export_portfolio_analytics_annex() to authenticated;

-- Service-only canonical delivery envelope. No analytics receipt before opt-in.
create function public.service_read_public_portfolio_with_analytics(p_handle text,p_slug text) returns jsonb
language sql stable security definer set search_path='' as $$
 with rendered as materialized(select public.service_read_public_portfolio(p_handle,p_slug) value),
 eligible as materialized(
 select jsonb_build_object('portfolioId',p.id,'intentId',r.receipt->'intentId',
 'releaseGeneration',r.receipt->'releaseGeneration','stageGeneration',r.receipt->'stageGeneration',
 'deliveryEpoch',r.receipt->'deliveryEpoch','htmlSha256',r.receipt->'storedHtmlSha256','consentVersion',a.version) receipt
 from rendered x join public.profiles pr on pr.handle=p_handle
 join public.portfolios p on p.owner_user_id=pr.user_id and p.slug=p_slug
 join kadmeion_private.analytics_opt_in a on a.portfolio_id=p.id and a.enabled
 cross join lateral(select kadmeion_private.analytics_authority(p.id,p.owner_user_id) receipt) r
 where x.value->'indexable'='true'::jsonb and r.receipt is not null
 and x.value->>'htmlSha256'=r.receipt->>'storedHtmlSha256'
 ) select case when value is null then null else jsonb_build_object('release',value,'analytics',
 case when (select count(*) from eligible)=1 then (select receipt from eligible limit 1) end) end
 from rendered
$$;
revoke all on function public.service_read_public_portfolio_with_analytics(text,text) from public,anon,authenticated,service_role;
grant execute on function public.service_read_public_portfolio_with_analytics(text,text) to service_role;

-- One bounded service event. The C11 epoch is essential to reject delivery ABA.
-- Lock portfolio -> intent -> pointer -> route -> epoch -> consent -> quota ->
-- aggregate -> GLOBAL. Roll back all tentative writes when any gate rejects.
create function public.collect_portfolio_analytics_view(p_portfolio_id uuid,p_intent_id uuid,p_release_generation bigint,
 p_stage_generation bigint,p_delivery_epoch bigint,p_html_sha256 text,p_consent_version bigint,p_bucket text)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='50ms' as $$
declare u uuid; r jsonb; a kadmeion_private.analytics_opt_in%rowtype; q kadmeion_private.analytics_rate_window%rowtype;
 g kadmeion_private.analytics_rate_window%rowtype; t timestamptz; m timestamptz; d date; qm integer; qd integer; gm integer; gd integer; total integer;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception using errcode='42501',message='TRUSTED_WORKER_REQUIRED'; end if;
 if p_portfolio_id is null or p_intent_id is null or p_release_generation is null or p_stage_generation is null or p_delivery_epoch is null
 or p_release_generation not between 1 and 9007199254740991 or p_stage_generation not between 1 and 9007199254740991
 or p_delivery_epoch not between 1 and 9007199254740990 or p_html_sha256 is null or p_html_sha256 !~ '^[0-9a-f]{64}$'
 or p_consent_version is null or p_consent_version not between 1 and 9007199254740990
 or p_bucket is null or p_bucket not in ('DIRECT_OR_UNKNOWN','SEARCH','SOCIAL','OTHER_EXTERNAL','INTERNAL')
 then raise exception using errcode='22023',message='ANALYTICS_INVALID'; end if;
 begin
   select owner_user_id into u from public.portfolios where id=p_portfolio_id and trashed_at is null for update nowait;
   if not found then raise exception using errcode='PAA01'; end if;
   r:=kadmeion_private.analytics_authority(p_portfolio_id,u);
   if r is null or r->>'intentId' is distinct from p_intent_id::text
   or r->'releaseGeneration' is distinct from to_jsonb(p_release_generation) or r->'stageGeneration' is distinct from to_jsonb(p_stage_generation)
   or r->'deliveryEpoch' is distinct from to_jsonb(p_delivery_epoch) or r->>'storedHtmlSha256' is distinct from p_html_sha256
   then raise exception using errcode='PAA01'; end if;
   perform kadmeion_private.lock_expected_public_delivery(r);
   select * into a from kadmeion_private.analytics_opt_in where portfolio_id=p_portfolio_id for update nowait;
   if not found or not a.enabled or a.version<>p_consent_version then raise exception using errcode='PAA01'; end if;
   t:=clock_timestamp(); m:=date_trunc('minute',t,'UTC'); d:=(t at time zone 'UTC')::date;
   if a.coverage_started_at>t then raise exception using errcode='PAA01'; end if;
   -- Stop accepting new events if retention maintenance has fallen behind.
   if exists(select 1 from kadmeion_private.aggregate_daily where utc_day<d-29)
   or exists(select 1 from kadmeion_private.analytics_rate_window where portfolio_id is not null and utc_day<d and portfolio_id<>p_portfolio_id)
   then raise exception using errcode='PAA01'; end if;
   insert into kadmeion_private.analytics_rate_window values(p_portfolio_id::text,p_portfolio_id,m,0,d,0) on conflict(scope_key) do nothing;
   select * into q from kadmeion_private.analytics_rate_window where scope_key=p_portfolio_id::text for update nowait;
   if not found or q.utc_day>d or q.minute_start>m then raise exception using errcode='PAA01'; end if;
   qm:=case when q.minute_start=m then q.minute_used else 0 end; qd:=case when q.utc_day=d then q.day_used else 0 end;
   if qm>=30 or qd>=250 then raise exception using errcode='PAA02'; end if;
   select coalesce(sum(views),0)::integer into total from kadmeion_private.aggregate_daily where portfolio_id=p_portfolio_id and utc_day=d;
   if total>qd then raise exception using errcode='PAA01'; end if;
   if total>=250 then raise exception using errcode='PAA02'; end if;
   insert into kadmeion_private.aggregate_daily as x values(p_portfolio_id,d,p_bucket,1)
   on conflict(portfolio_id,utc_day,referrer_bucket) do update set views=x.views+1;
   update kadmeion_private.analytics_rate_window set minute_start=m,minute_used=qm+1,utc_day=d,day_used=qd+1 where scope_key=p_portfolio_id::text;
   select * into g from kadmeion_private.analytics_rate_window where scope_key='GLOBAL' for update nowait;
   if not found or g.utc_day>d or g.minute_start>m then raise exception using errcode='PAA01'; end if;
   gm:=case when g.minute_start=m then g.minute_used else 0 end; gd:=case when g.utc_day=d then g.day_used else 0 end;
   if gm>=120 or gd>=1000 then raise exception using errcode='PAA02'; end if;
   if clock_timestamp()>=m+interval '1 minute' then raise exception using errcode='PAA01'; end if;
   update kadmeion_private.analytics_rate_window set minute_start=m,minute_used=gm+1,utc_day=d,day_used=gd+1 where scope_key='GLOBAL';
   return jsonb_build_object('status','COUNTED');
 exception when sqlstate 'PAA02' then return jsonb_build_object('status','LIMITED');
 when sqlstate 'PAA01' or lock_not_available or serialization_failure then return jsonb_build_object('status','IGNORED');
 end;
end $$;
revoke all on function public.collect_portfolio_analytics_view(uuid,uuid,bigint,bigint,bigint,text,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.collect_portfolio_analytics_view(uuid,uuid,bigint,bigint,bigint,text,bigint,text) to service_role;
