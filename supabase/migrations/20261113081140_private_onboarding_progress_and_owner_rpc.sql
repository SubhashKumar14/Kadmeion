-- B1: private, independently resumable welcome choices.
-- No public delivery, no operator access and no direct client write privileges.
create table public.private_onboarding_steps (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  step text not null check (step in ('profile','portfolio','connections')),
  status text not null default 'pending' check (status in ('pending','completed','skipped')),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  primary key(user_id,step)
);

alter table public.private_onboarding_steps enable row level security;
revoke all on table public.private_onboarding_steps from public, anon, authenticated;
grant select on table public.private_onboarding_steps to authenticated;
create policy onboarding_owner_select on public.private_onboarding_steps
  for select to authenticated
  using ((select auth.uid())=user_id);
comment on table public.private_onboarding_steps is
  'One private owner state per welcome choice. Missing row means pending. Does not publish anything.';
comment on column public.profiles.onboarding_complete is
  'Legacy coarse placeholder; not authoritative. Read private_onboarding_steps for individual welcome statuses.';

-- Intentional signed-in RPC. Explicit auth.uid check, fixed step/status values and
-- one owner scope. Never accepts a user_id, public visibility or admin role.
create function public.set_private_onboarding_step(p_step text,p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_record public.private_onboarding_steps%rowtype;
begin
  if v_owner is null then
    raise exception using errcode='42501',message='AUTH_REQUIRED';
  end if;
  if p_step is null or p_step not in ('profile','portfolio','connections') or
     p_status is null or p_status not in ('pending','completed','skipped') then
    raise exception using errcode='22023',message='INVALID_ONBOARDING_STATE';
  end if;
  if not exists(select 1 from public.profiles where user_id=v_owner) then
    raise exception using errcode='42501',message='PRIVATE_IDENTITY_MISSING';
  end if;
  insert into public.private_onboarding_steps(user_id,step,status)
    values(v_owner,p_step,p_status)
  on conflict(user_id,step) do update
    set status=excluded.status,
        revision=public.private_onboarding_steps.revision +
          case when public.private_onboarding_steps.status is distinct from excluded.status then 1 else 0 end,
        updated_at=case when public.private_onboarding_steps.status is distinct from excluded.status
                        then now() else public.private_onboarding_steps.updated_at end
  returning * into v_record;
  return jsonb_build_object(
    'step',v_record.step,'status',v_record.status,
    'revision',v_record.revision,'updated_at',v_record.updated_at
  );
end;
$$;
revoke all on function public.set_private_onboarding_step(text,text) from public, anon;
grant execute on function public.set_private_onboarding_step(text,text) to authenticated;
comment on function public.set_private_onboarding_step(text,text) is
  'Authenticated owner-only onboarding state transition. No anonymous or cross-owner writes; repeated same state is idempotent.';
