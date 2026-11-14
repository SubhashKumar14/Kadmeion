-- B5: case-bound operator BLOCK for one PRIVATE portfolio candidate.
-- This is an internal database hold, not public-host or CDN revocation.
-- No operator may edit owner content, activate a release or restore a hold.
create table kadmeion_private.moderation_portfolio_holds (
  portfolio_id uuid primary key,
  owner_user_id uuid not null,
  case_id uuid not null,
  operation_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  held_at timestamptz not null default transaction_timestamp(),
  foreign key (portfolio_id,owner_user_id)
    references public.portfolios(id,owner_user_id) on delete cascade,
  foreign key (case_id,owner_user_id)
    references public.private_moderation_cases(id,owner_user_id) on delete cascade
);
alter table kadmeion_private.moderation_portfolio_holds enable row level security;
revoke all on table kadmeion_private.moderation_portfolio_holds
  from public,anon,authenticated;
comment on table kadmeion_private.moderation_portfolio_holds is
  'Case-bound persistent internal block. No public CDN or direct-asset revocation proof. No automatic release on case closure.';

-- Preserve existing owner and Trash audit events while adding an operator
-- event. A hold links its event operation to the exact moderation case.
alter table public.private_release_visibility_events
  drop constraint private_release_visibility_events_event_type_check;
alter table public.private_release_visibility_events
  add constraint private_release_visibility_events_event_type_check
  check (event_type in ('PREPARE','OWNER_BLOCK','TRASH_BLOCK','OPERATOR_BLOCK'));

-- Defense in depth: a signed-in owner cannot reprepare a candidate while a
-- moderator hold is active, even if another trusted RPC is added later.
create function kadmeion_private.reject_prepared_pointer_under_moderation_hold()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if exists(select 1 from kadmeion_private.moderation_portfolio_holds
    where portfolio_id=new.portfolio_id) then
    raise exception using errcode='42501',message='MODERATION_HOLD_ACTIVE';
  end if;
  return new;
end;
$$;
revoke all on function kadmeion_private.reject_prepared_pointer_under_moderation_hold()
  from public,anon,authenticated;
create trigger kd_moderation_hold_blocks_prepare
  before insert or update of status on public.private_release_visibility_pointers
  for each row when (new.status='PREPARED_PRIVATE')
  execute function kadmeion_private.reject_prepared_pointer_under_moderation_hold();

create function public.operator_block_private_portfolio(
  p_case_id uuid,p_portfolio_id uuid,p_operation_id uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner uuid;
  v_case public.private_moderation_cases%rowtype;
  v_hold kadmeion_private.moderation_portfolio_holds%rowtype;
  v_event public.private_release_visibility_events%rowtype;
  v_pointer public.private_release_visibility_pointers%rowtype;
  v_generation bigint;
begin
  if v_actor is null or not exists(
    select 1 from kadmeion_private.operator_roles
      where user_id=v_actor and role in ('moderator','administrator')) then
    raise exception using errcode='42501',message='OPERATOR_REQUIRED';
  end if;
  if p_case_id is null or p_portfolio_id is null or p_operation_id is null then
    raise exception using errcode='22023',message='INVALID_OPERATOR_BLOCK';
  end if;
  -- Match owner prepare/Trash/binding lock order: portfolio, then pointer.
  select owner_user_id into v_owner from public.portfolios
    where id=p_portfolio_id for update;
  if not found or v_owner=v_actor then
    raise exception using errcode='42501',message='MODERATION_PORTFOLIO_UNAVAILABLE';
  end if;
  select * into v_case from public.private_moderation_cases
    where id=p_case_id and owner_user_id=v_owner for share;
  if not found then
    raise exception using errcode='42501',message='MODERATION_CASE_SCOPE_MISMATCH';
  end if;
  select * into v_event from public.private_release_visibility_events
    where portfolio_id=p_portfolio_id and operation_id=p_operation_id;
  if found then
    select * into v_hold from kadmeion_private.moderation_portfolio_holds
      where portfolio_id=p_portfolio_id;
    if v_event.event_type<>'OPERATOR_BLOCK'
      or v_event.actor_user_id is distinct from v_actor
      or not found or v_hold.case_id<>p_case_id
      or v_hold.operation_id<>p_operation_id
      or v_hold.actor_user_id is distinct from v_actor then
      raise exception using errcode='23505',message='MODERATION_BLOCK_OPERATION_REUSED';
    end if;
    select * into v_pointer from public.private_release_visibility_pointers
      where portfolio_id=p_portfolio_id;
    if not found or v_pointer.status<>'BLOCKED'
      or v_pointer.generation<v_event.resulting_generation then
      raise exception using errcode='40001',message='MODERATION_HOLD_STATE_CONFLICT';
    end if;
    return jsonb_build_object('caseId',p_case_id,'portfolioId',p_portfolio_id,
      'generation',v_event.resulting_generation,'status','BLOCKED',
      'stillBlocked',true,'alreadyRecorded',true,
      'publicServingEnabled',false,'publicUrl',null,
      'hostRevocationVerified',false);
  end if;
  if v_case.status not in ('OPEN','APPEAL_PENDING') then
    raise exception using errcode='55000',message='MODERATION_CASE_NOT_OPEN';
  end if;
  if exists(select 1 from kadmeion_private.moderation_portfolio_holds
    where portfolio_id=p_portfolio_id) then
    raise exception using errcode='23505',message='MODERATION_HOLD_ALREADY_ACTIVE';
  end if;
  select * into v_pointer from public.private_release_visibility_pointers
    where portfolio_id=p_portfolio_id for update;
  v_generation:=case when found then v_pointer.generation else 0 end;
  if v_generation>=9223372036854775806 then
    raise exception using errcode='54000',message='PRIVATE_POINTER_GENERATION_LIMIT';
  end if;
  insert into kadmeion_private.moderation_portfolio_holds(
    portfolio_id,owner_user_id,case_id,operation_id,actor_user_id
  ) values(p_portfolio_id,v_owner,p_case_id,p_operation_id,v_actor);
  if v_generation=0 then
    insert into public.private_release_visibility_pointers(
      portfolio_id,owner_user_id,status,generation,revocation_generation
    ) values(p_portfolio_id,v_owner,'BLOCKED',1,1);
  else
    update public.private_release_visibility_pointers
      set status='BLOCKED',candidate_request_id=null,
        candidate_manifest_sha256=null,generation=v_generation+1,
        revocation_generation=v_generation+1,updated_at=transaction_timestamp()
      where portfolio_id=p_portfolio_id;
  end if;
  insert into public.private_release_visibility_events(
    portfolio_id,owner_user_id,actor_user_id,operation_id,event_type,
    expected_generation,resulting_generation
  ) values(p_portfolio_id,v_owner,v_actor,p_operation_id,'OPERATOR_BLOCK',
    v_generation,v_generation+1);
  return jsonb_build_object('caseId',p_case_id,'portfolioId',p_portfolio_id,
    'generation',v_generation+1,'status','BLOCKED',
    'stillBlocked',true,'alreadyRecorded',false,
    'publicServingEnabled',false,'publicUrl',null,
    'hostRevocationVerified',false);
end;
$$;
revoke all on function public.operator_block_private_portfolio(uuid,uuid,uuid)
  from public,anon;
grant execute on function public.operator_block_private_portfolio(uuid,uuid,uuid)
  to authenticated;
comment on function public.operator_block_private_portfolio(uuid,uuid,uuid) is
  'Role- and case-scoped permanent private candidate hold. Does NOT prove public host, CDN, or immutable asset revocation.';


-- B5 reasoned, administrator-only release of an INTERNAL moderation hold.
-- A closed case and an immutable decision entry are mandatory. This never
-- publishes/reprepares a portfolio or claims external host/CDN revocation.
alter table public.private_release_visibility_events
  drop constraint private_release_visibility_events_event_type_check;
alter table public.private_release_visibility_events
  add constraint private_release_visibility_events_event_type_check
  check (event_type in ('PREPARE','OWNER_BLOCK','TRASH_BLOCK','OPERATOR_BLOCK',
    'OPERATOR_HOLD_LIFT'));
alter table public.private_moderation_events
  drop constraint private_moderation_events_event_type_check;
alter table public.private_moderation_events
  add constraint private_moderation_events_event_type_check
  check (event_type in ('OPENED','OWNER_APPEAL','OPERATOR_DECISION',
    'OPERATOR_HOLD_LIFT'));

create function public.operator_lift_private_moderation_hold(
  p_case_id uuid,p_portfolio_id uuid,p_operation_id uuid,p_rationale text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner uuid;
  v_case public.private_moderation_cases%rowtype;
  v_hold kadmeion_private.moderation_portfolio_holds%rowtype;
  v_pointer public.private_release_visibility_pointers%rowtype;
  v_event public.private_moderation_events%rowtype;
  v_generation bigint;
begin
  if v_actor is null or not exists(select 1
    from kadmeion_private.operator_roles
    where user_id=v_actor and role='administrator') then
    raise exception using errcode='42501',message='ADMINISTRATOR_REQUIRED';
  end if;
  if p_case_id is null or p_portfolio_id is null or p_operation_id is null
     or p_rationale is null or char_length(btrim(p_rationale))<20
     or char_length(p_rationale)>2000 then
    raise exception using errcode='22023',message='INVALID_HOLD_LIFT';
  end if;
  select owner_user_id into v_owner from public.portfolios
    where id=p_portfolio_id for update;
  if not found or v_owner=v_actor then
    raise exception using errcode='42501',message='PRIVATE_PORTFOLIO_NOT_FOUND'; end if;
  select * into v_case from public.private_moderation_cases
    where id=p_case_id and owner_user_id=v_owner for share;
  if not found or v_case.status<>'CLOSED' then
    raise exception using errcode='42501',message='MODERATION_CASE_NOT_RESOLVED'; end if;

  select * into v_event from public.private_moderation_events
    where case_id=p_case_id and operation_id=p_operation_id;
  if found then
    if v_event.actor_user_id is distinct from v_actor or
       v_event.event_type<>'OPERATOR_HOLD_LIFT' or
       v_event.detail<>btrim(p_rationale) then
      raise exception using errcode='23505',message='HOLD_LIFT_OPERATION_REUSED'; end if;
    select * into v_pointer from public.private_release_visibility_pointers
      where portfolio_id=p_portfolio_id;
    if not found or v_pointer.status<>'BLOCKED' then
      raise exception using errcode='40001',message='HOLD_LIFT_STATE_CHANGED';end if;
    return jsonb_build_object('caseId',p_case_id,'portfolioId',p_portfolio_id,
      'generation',v_pointer.generation,'status','RELEASED_PRIVATE',
      'alreadyRecorded',true,'publicServingEnabled',false,
      'publicUrl',null,'hostRevocationVerified',false);
  end if;
  select * into v_hold from kadmeion_private.moderation_portfolio_holds
    where portfolio_id=p_portfolio_id for update;
  if not found or v_hold.case_id<>p_case_id or v_hold.owner_user_id<>v_owner then
    raise exception using errcode='42501',message='HOLD_CASE_SCOPE_MISMATCH';end if;
  select * into v_pointer from public.private_release_visibility_pointers
    where portfolio_id=p_portfolio_id for update;
  if not found or v_pointer.status<>'BLOCKED'
    or v_pointer.generation>=9223372036854775806 then
    raise exception using errcode='40001',message='HOLD_LIFT_POINTER_CONFLICT';end if;
  v_generation:=v_pointer.generation+1;
  delete from kadmeion_private.moderation_portfolio_holds
    where portfolio_id=p_portfolio_id and case_id=p_case_id;
  -- Extra revocation generation prevents reuse of any pre-hold artifact.
  update public.private_release_visibility_pointers
    set status='BLOCKED',candidate_request_id=null,
        candidate_manifest_sha256=null,generation=v_generation,
        revocation_generation=v_generation,updated_at=transaction_timestamp()
    where portfolio_id=p_portfolio_id;
  insert into public.private_release_visibility_events(
    portfolio_id,owner_user_id,actor_user_id,operation_id,event_type,
    expected_generation,resulting_generation
  ) values(p_portfolio_id,v_owner,v_actor,p_operation_id,
    'OPERATOR_HOLD_LIFT',v_pointer.generation,v_generation);
  insert into public.private_moderation_events(
    case_id,owner_user_id,actor_user_id,operation_id,event_type,detail
  ) values(p_case_id,v_owner,v_actor,p_operation_id,
    'OPERATOR_HOLD_LIFT',btrim(p_rationale));
  return jsonb_build_object('caseId',p_case_id,'portfolioId',p_portfolio_id,
    'generation',v_generation,'status','RELEASED_PRIVATE',
    'alreadyRecorded',false,'publicServingEnabled',false,
    'publicUrl',null,'hostRevocationVerified',false);
end;
$$;
revoke all on function public.operator_lift_private_moderation_hold(uuid,uuid,uuid,text)
  from public,anon;
grant execute on function public.operator_lift_private_moderation_hold(uuid,uuid,uuid,text)
  to authenticated;
comment on function public.operator_lift_private_moderation_hold(uuid,uuid,uuid,text) is
  'Administrator-only case-resolved internal hold lift. Leaves pointer BLOCKED and requires explicit new owner preparation; no public-host restoration.';
