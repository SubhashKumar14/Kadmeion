-- B5 audit-only moderation/appeal registry. DOES NOT restrict Auth access,
-- modify user content or unpublish any public route.
-- Operator identifiers are nulled after actor erasure, while owner cases cascade
-- on target account deletion. Audit actions and rationale remain until owner erasure. Separate verified public
-- delivery/revocation enforcement is required before such claims are permitted.
create table public.private_moderation_cases (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  opened_by uuid references auth.users(id) on delete set null,
  operation_id uuid not null,
  reason_code text not null check (reason_code in ('ABUSE','SECURITY','LEGAL','SPAM')),
  summary text not null check (char_length(btrim(summary)) between 20 and 500),
  status text not null default 'OPEN' check (status in ('OPEN','APPEAL_PENDING','CLOSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,owner_user_id),
  unique (opened_by,operation_id)
);
create index kd_mod_owner_case on public.private_moderation_cases(owner_user_id,created_at desc);
alter table public.private_moderation_cases enable row level security;
revoke all on public.private_moderation_cases from public,anon,authenticated;
grant select (id,reason_code,summary,status,created_at,updated_at)
  on public.private_moderation_cases to authenticated;
create policy kd_mod_case_owner_select on public.private_moderation_cases
  for select to authenticated using ((select auth.uid())=owner_user_id);

create table public.private_moderation_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null,
  owner_user_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  operation_id uuid not null,
  event_type text not null check (event_type in ('OPENED','OWNER_APPEAL','OPERATOR_DECISION')),
  detail text not null check (char_length(btrim(detail)) between 12 and 2000),
  created_at timestamptz not null default now(),
  foreign key (case_id,owner_user_id) references public.private_moderation_cases(id,owner_user_id) on delete cascade,
  unique (case_id,operation_id)
);
create index kd_mod_case_events on public.private_moderation_events(case_id,created_at);
alter table public.private_moderation_events enable row level security;
revoke all on public.private_moderation_events from public,anon,authenticated;
grant select (id,case_id,actor_user_id,event_type,detail,created_at)
  on public.private_moderation_events to authenticated;
create policy kd_mod_events_owner_select on public.private_moderation_events
  for select to authenticated using ((select auth.uid())=owner_user_id);
comment on table public.private_moderation_cases is
  'Private owner-visible moderation notices. No active restrictions, host suspension or operator editing.';
comment on table public.private_moderation_events is
  'Immutable moderation event journal. Not a public URL revocation or email-delivery acknowledgement.';

create function public.operator_open_moderation_case(
  p_target_user_id uuid,p_operation_id uuid,p_reason_code text,p_summary text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
  v_existing public.private_moderation_cases%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if not exists(select 1 from kadmeion_private.operator_roles
    where user_id=v_actor and role in ('moderator','administrator')) then
    raise exception using errcode='42501',message='OPERATOR_REQUIRED'; end if;
  if p_target_user_id is null or p_target_user_id=v_actor or p_operation_id is null or
     p_reason_code is null or p_reason_code not in ('ABUSE','SECURITY','LEGAL','SPAM') or
     p_summary is null or char_length(btrim(p_summary))<20 or char_length(p_summary)>500 then
    raise exception using errcode='22023',message='INVALID_MODERATION_CASE'; end if;
  select * into v_existing from public.private_moderation_cases
    where opened_by=v_actor and operation_id=p_operation_id for update;
  if found then
    if v_existing.owner_user_id<>p_target_user_id or v_existing.reason_code<>p_reason_code
      or v_existing.summary<>btrim(p_summary) then
      raise exception using errcode='23505',message='MODERATION_OPERATION_ID_REUSED'; end if;
    return jsonb_build_object('caseId',v_existing.id,'status',v_existing.status,
      'alreadyRecorded',true,'restrictionEnforced',false,'publicRevocationVerified',false);
  end if;
  perform 1 from public.profiles where user_id=p_target_user_id for share;
  if not found then raise exception using errcode='42501',message='TARGET_NOT_FOUND'; end if;
  if (select count(*) from public.private_moderation_cases
    where opened_by=v_actor and created_at>=transaction_timestamp()-interval '24 hours')>=50 then
    raise exception using errcode='54000',message='MODERATION_CASE_QUOTA_REACHED'; end if;
  insert into public.private_moderation_cases(
    owner_user_id,opened_by,operation_id,reason_code,summary
  ) values (p_target_user_id,v_actor,p_operation_id,p_reason_code,btrim(p_summary))
  returning id into v_id;
  insert into public.private_moderation_events(
    case_id,owner_user_id,actor_user_id,operation_id,event_type,detail
  ) values (v_id,p_target_user_id,v_actor,p_operation_id,'OPENED',btrim(p_summary));
  return jsonb_build_object('caseId',v_id,'status','OPEN','alreadyRecorded',false,
    'restrictionEnforced',false,'publicRevocationVerified',false);
end;
$$;
revoke all on function public.operator_open_moderation_case(uuid,uuid,text,text) from public,anon;
grant execute on function public.operator_open_moderation_case(uuid,uuid,text,text) to authenticated;

create function public.owner_appeal_moderation_case(
  p_case_id uuid,p_operation_id uuid,p_statement text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_case public.private_moderation_cases%rowtype;
  v_existing public.private_moderation_events%rowtype;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
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
  insert into public.private_moderation_events(
    case_id,owner_user_id,actor_user_id,operation_id,event_type,detail
  ) values (p_case_id,v_owner,v_owner,p_operation_id,'OWNER_APPEAL',btrim(p_statement));
  update public.private_moderation_cases set status='APPEAL_PENDING',updated_at=transaction_timestamp()
    where id=p_case_id;
  return jsonb_build_object('caseId',p_case_id,'status','APPEAL_RECORDED',
    'alreadyRecorded',false,'publicRevocationVerified',false);
end;
$$;
revoke all on function public.owner_appeal_moderation_case(uuid,uuid,text) from public,anon;
grant execute on function public.owner_appeal_moderation_case(uuid,uuid,text) to authenticated;

create function public.operator_close_moderation_case(
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
revoke all on function public.operator_close_moderation_case(uuid,uuid,text) from public,anon;
grant execute on function public.operator_close_moderation_case(uuid,uuid,text) to authenticated;

create function public.operator_list_moderation_cases(p_max integer default 25)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_actor uuid := (select auth.uid());v_items jsonb;
begin
  if v_actor is null or not exists(select 1 from kadmeion_private.operator_roles
    where user_id=v_actor and role in ('moderator','administrator')) then
    raise exception using errcode='42501',message='OPERATOR_REQUIRED'; end if;
  if p_max is null or p_max<1 or p_max>50 then
    raise exception using errcode='22023',message='INVALID_MODERATION_LIMIT'; end if;
  select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into v_items from (
    select id as "caseId",owner_user_id as "targetUserId",
      reason_code as "reasonCode",status,created_at as "createdAt"
    from public.private_moderation_cases order by created_at desc,id desc limit p_max
  ) t;
  return v_items;
end;
$$;
revoke all on function public.operator_list_moderation_cases(integer) from public,anon;
grant execute on function public.operator_list_moderation_cases(integer) to authenticated;
