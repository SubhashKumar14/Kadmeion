-- Return evidence only for the selected pending case after a live role check.
-- The ordinary owner-facing RLS policies and operator case list stay separate.
create function public.operator_read_appeal_evidence(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_evidence jsonb;
begin
  perform kadmeion_private.require_live_exit_auth_session();
  if not exists(select 1 from kadmeion_private.operator_roles
    where user_id=v_actor and role in ('moderator','administrator')) then
    raise exception using errcode='42501',message='OPERATOR_REQUIRED';
  end if;
  select jsonb_build_object(
    'caseId',c.id,'reasonCode',c.reason_code,'summary',c.summary,
    'statement',appeal.detail,'submittedAt',appeal.created_at
  ) into v_evidence
  from public.private_moderation_cases c
  cross join lateral (
    select e.detail,e.created_at
    from public.private_moderation_events e
    where e.case_id=c.id and e.owner_user_id=c.owner_user_id
      and e.event_type='OWNER_APPEAL' and e.actor_user_id=c.owner_user_id
    order by e.created_at desc,e.id desc limit 1
  ) appeal
  where c.id=p_case_id and c.status='APPEAL_PENDING';
  if v_evidence is null then
    raise exception using errcode='42501',message='APPEAL_EVIDENCE_UNAVAILABLE';
  end if;
  return v_evidence;
end;
$$;

revoke all on function public.operator_read_appeal_evidence(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.operator_read_appeal_evidence(uuid) to authenticated;
