-- WF-050: public complaints enter a private queue; only a live operator can
-- open an owner-visible case. Complaint intake never changes release visibility.
create table kadmeion_private.portfolio_abuse_reports (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  intent_id uuid not null references public.private_unlisted_publication_intents(id) on delete cascade,
  operation_id uuid not null,
  target_path text not null,
  reason_code text not null check (reason_code in ('ABUSE','SECURITY','LEGAL','SPAM')),
  evidence text not null check (char_length(evidence) between 20 and 500),
  evidence_sha256 text not null,
  created_at timestamptz not null default statement_timestamp(),
  disposition text not null default 'PENDING' check (disposition in ('PENDING','CASE_OPENED','DISMISSED')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_reason text,
  case_id uuid references public.private_moderation_cases(id) on delete set null,
  unique(portfolio_id,operation_id),
  unique(intent_id,reason_code,evidence_sha256)
);
create index kd_abuse_report_received on kadmeion_private.portfolio_abuse_reports(created_at);
create index kd_abuse_report_route on kadmeion_private.portfolio_abuse_reports(portfolio_id,created_at);
create index kd_abuse_report_queue on kadmeion_private.portfolio_abuse_reports(id) where disposition='PENDING';
alter table kadmeion_private.portfolio_abuse_reports enable row level security;
revoke all on kadmeion_private.portfolio_abuse_reports from public,anon,authenticated,service_role;

create function public.service_submit_portfolio_abuse_report(
  p_handle text,p_slug text,p_operation_id uuid,p_reason_code text,p_evidence text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_now timestamptz := statement_timestamp();
  v_evidence text := btrim(p_evidence);
  v_path text := '/'||p_handle||'/'||p_slug;
  v_portfolio uuid;
  v_intent uuid;
  v_digest text;
  v_report kadmeion_private.portfolio_abuse_reports;
begin
  if p_handle is null or p_handle !~ '^[a-z][a-z0-9_]{2,29}$' or
     p_slug is null or char_length(p_slug) not between 3 and 64 or
     p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or
     p_operation_id is null or p_reason_code is null or
     p_reason_code not in ('ABUSE','SECURITY','LEGAL','SPAM') or
     v_evidence is null or char_length(v_evidence) not between 20 and 500 or
     octet_length(p_evidence)>2000 or v_evidence ~ '[[:cntrl:]]' then
    raise exception using errcode='22023',message='INVALID_ABUSE_REPORT';
  end if;

  -- Serialize the global and per-portfolio limits. No reporter IP or contact
  -- data is collected. A report can only target the current verified route.
  perform pg_advisory_xact_lock(99247,50);
  select route.portfolio_id,route.intent_id into v_portfolio,v_intent
  from kadmeion_private.unlisted_release_routes route
  join public.private_unlisted_publication_intents intent on intent.id=route.intent_id
  where route.status='LIVE' and route.verified_at is not null
    and intent.public_handle=p_handle and intent.public_slug=p_slug
    and public.service_read_public_portfolio(p_handle,p_slug) is not null;
  if not found then
    raise exception using errcode='P0002',message='PUBLIC_PORTFOLIO_NOT_FOUND';
  end if;
  v_digest:=encode(sha256(convert_to(v_evidence,'UTF8')),'hex');
  select * into v_report from kadmeion_private.portfolio_abuse_reports
    where portfolio_id=v_portfolio and operation_id=p_operation_id;
  if found then
    if v_report.intent_id<>v_intent or v_report.reason_code<>p_reason_code or
       v_report.evidence_sha256<>v_digest then
      raise exception using errcode='23505',message='ABUSE_REPORT_OPERATION_CONFLICT';
    end if;
    return jsonb_build_object('status','RECEIVED_FOR_REVIEW');
  end if;
  if exists(select 1 from kadmeion_private.portfolio_abuse_reports
    where intent_id=v_intent and reason_code=p_reason_code and evidence_sha256=v_digest) then
    return jsonb_build_object('status','RECEIVED_FOR_REVIEW');
  end if;
  if (select count(*) from (select 1 from kadmeion_private.portfolio_abuse_reports
       where created_at>=v_now-interval '1 day' limit 300) recent)>=300 or
     (select count(*) from (select 1 from kadmeion_private.portfolio_abuse_reports
       where portfolio_id=v_portfolio and created_at>=v_now-interval '1 hour' limit 12) recent)>=12 then
    raise exception using errcode='54000',message='ABUSE_REPORT_RATE_LIMIT';
  end if;
  insert into kadmeion_private.portfolio_abuse_reports (
    portfolio_id,intent_id,operation_id,target_path,reason_code,evidence,evidence_sha256
  ) values (v_portfolio,v_intent,p_operation_id,v_path,p_reason_code,v_evidence,v_digest);
  return jsonb_build_object('status','RECEIVED_FOR_REVIEW');
end;
$function$;
revoke all on function public.service_submit_portfolio_abuse_report(text,text,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.service_submit_portfolio_abuse_report(text,text,uuid,text,text) to service_role;

create function public.operator_list_portfolio_abuse_reports(p_after uuid default null,p_limit integer default 25)
returns table (id uuid,target_path text,reason_code text,evidence text,created_at timestamptz)
language plpgsql security definer set search_path=''
as $function$
begin
  perform kadmeion_private.require_live_exit_auth_session();
  if not exists (select 1 from kadmeion_private.operator_roles r
    where r.user_id=(select auth.uid()) and r.role in ('moderator','administrator')) then
    raise exception using errcode='42501',message='OPERATOR_REQUIRED';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception using errcode='22023',message='INVALID_ABUSE_REPORT_LIMIT';
  end if;
  return query select r.id,r.target_path,r.reason_code,r.evidence,r.created_at
    from kadmeion_private.portfolio_abuse_reports r
    where r.disposition='PENDING' and (p_after is null or r.id>p_after)
    order by r.id limit p_limit;
end;
$function$;

create function public.operator_review_portfolio_abuse_report(
  p_report_id uuid,p_decision text,p_rationale text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_reason text := btrim(p_rationale);
  v_report kadmeion_private.portfolio_abuse_reports;
  v_owner uuid;
  v_case uuid;
begin
  perform kadmeion_private.require_live_exit_auth_session();
  if not exists (select 1 from kadmeion_private.operator_roles r
    where r.user_id=v_actor and r.role in ('moderator','administrator')) then
    raise exception using errcode='42501',message='OPERATOR_REQUIRED';
  end if;
  if p_report_id is null or p_decision is null or p_decision not in ('CASE_OPENED','DISMISSED') or
     v_reason is null or char_length(v_reason) not between 20 and 500 or octet_length(p_rationale)>2000 then
    raise exception using errcode='22023',message='INVALID_ABUSE_REVIEW';
  end if;
  select * into v_report from kadmeion_private.portfolio_abuse_reports where id=p_report_id for update;
  if not found then raise exception using errcode='P0002',message='ABUSE_REPORT_NOT_FOUND'; end if;
  if v_report.disposition<>'PENDING' then
    if v_report.disposition<>p_decision or v_report.reviewed_by is distinct from v_actor or
       v_report.review_reason is distinct from v_reason then
      raise exception using errcode='23505',message='ABUSE_REPORT_ALREADY_REVIEWED';
    end if;
    return jsonb_build_object('reportId',v_report.id,'status',v_report.disposition,'caseId',v_report.case_id);
  end if;
  if p_decision='CASE_OPENED' then
    select p.owner_user_id into v_owner from public.portfolios p where p.id=v_report.portfolio_id;
    -- The operator supplies an owner-safe rationale. Raw reports remain in the private queue.
    v_case:=(public.operator_open_moderation_case(
      v_owner,v_report.id,v_report.reason_code,v_reason)->>'caseId')::uuid;
  end if;
  update kadmeion_private.portfolio_abuse_reports
    set disposition=p_decision,reviewed_by=v_actor,reviewed_at=statement_timestamp(),
        review_reason=v_reason,case_id=v_case
    where id=v_report.id;
  return jsonb_build_object('reportId',v_report.id,'status',p_decision,'caseId',v_case);
end;
$function$;
revoke all on function public.operator_list_portfolio_abuse_reports(uuid,integer),
  public.operator_review_portfolio_abuse_report(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.operator_list_portfolio_abuse_reports(uuid,integer),
  public.operator_review_portfolio_abuse_report(uuid,text,text) to authenticated;
