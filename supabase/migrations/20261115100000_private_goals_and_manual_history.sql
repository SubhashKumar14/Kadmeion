-- P2 Growth: owner-only, manual-first goals. No public provider metric claims.
-- This forward-only migration touches no existing account rows.
create table public.private_goals (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  operation_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '' check (char_length(description)<=2000),
  target_value numeric(12,2) check (target_value>0),
  unit text check (unit is null or char_length(unit) between 1 and 32),
  due_on date,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','PAUSED','COMPLETED','ARCHIVED')),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  unique(owner_user_id,operation_id),
  unique(id,owner_user_id)
);
comment on table public.private_goals is
  'Owner-private manual goals; target/progress is self-reported. Never public provider evidence.';
alter table public.private_goals enable row level security;
revoke all on public.private_goals from public,anon,authenticated;
grant select (id,owner_user_id,operation_id,title,description,target_value,unit,due_on,
  status,created_at,updated_at) on public.private_goals to authenticated;
grant insert (operation_id,title,description,target_value,unit,due_on)
  on public.private_goals to authenticated;
grant update (title,description,target_value,unit,due_on,status)
  on public.private_goals to authenticated;
grant delete on public.private_goals to authenticated;
create policy kd_goal_read on public.private_goals for select to authenticated
  using ((select auth.uid())=owner_user_id);
create policy kd_goal_create on public.private_goals for insert to authenticated
  with check ((select auth.uid())=owner_user_id);
create policy kd_goal_edit on public.private_goals for update to authenticated
  using ((select auth.uid())=owner_user_id)
  with check ((select auth.uid())=owner_user_id);
create policy kd_goal_delete on public.private_goals for delete to authenticated
  using ((select auth.uid())=owner_user_id);
create index kd_goal_owner_recent_idx on public.private_goals(owner_user_id,created_at desc);

create function kadmeion_private.touch_owner_goal_timestamp()
returns trigger language plpgsql set search_path=''
as $function$
begin
  new.updated_at=transaction_timestamp();
  return new;
end;
$function$;
revoke all on function kadmeion_private.touch_owner_goal_timestamp()
  from public,anon,authenticated,service_role;
create trigger kd_goal_updated_at before update on public.private_goals
  for each row execute function kadmeion_private.touch_owner_goal_timestamp();

-- Append-only absolute progress values permit explicit corrections without
-- rewriting the history. No imported or provider-verified provenance exists.
create table public.private_goal_progress_events (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null,
  owner_user_id uuid not null default auth.uid(),
  operation_id uuid not null,
  value numeric(12,2) not null check (value>=0),
  note text not null default '' check(char_length(note)<=500),
  source text generated always as ('MANUAL'::text) stored,
  created_at timestamptz not null default transaction_timestamp(),
  foreign key(goal_id,owner_user_id) references public.private_goals(id,owner_user_id)
    on delete cascade,
  unique(owner_user_id,operation_id)
);
alter table public.private_goal_progress_events enable row level security;
revoke all on public.private_goal_progress_events from public,anon,authenticated;
grant select (id,goal_id,owner_user_id,operation_id,value,note,source,created_at)
  on public.private_goal_progress_events to authenticated;
grant insert (goal_id,operation_id,value,note)
  on public.private_goal_progress_events to authenticated;
create policy kd_goal_progress_read on public.private_goal_progress_events
  for select to authenticated using ((select auth.uid())=owner_user_id);
create policy kd_goal_progress_append on public.private_goal_progress_events
  for insert to authenticated with check (
    (select auth.uid())=owner_user_id and
    exists (select 1 from public.private_goals goal
      where goal.id=goal_id and goal.owner_user_id=owner_user_id
        and goal.status<>'ARCHIVED')
  );
create index kd_goal_progress_latest_idx on public.private_goal_progress_events
  (goal_id,owner_user_id,created_at desc,id desc);
comment on table public.private_goal_progress_events is
  'Append-only manual progress/correction events, never an external verified metric.';

-- Stable milestone identities, owner-editable titles and due dates.
create table public.private_goal_milestones (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null,
  owner_user_id uuid not null default auth.uid(),
  operation_id uuid not null,
  title text not null check(char_length(btrim(title)) between 1 and 160),
  due_on date,
  completed_at timestamptz,
  created_at timestamptz not null default transaction_timestamp(),
  foreign key(goal_id,owner_user_id) references public.private_goals(id,owner_user_id)
    on delete cascade,
  unique(owner_user_id,operation_id)
);
alter table public.private_goal_milestones enable row level security;
revoke all on public.private_goal_milestones from public,anon,authenticated;
grant select (id,goal_id,owner_user_id,operation_id,title,due_on,completed_at,created_at)
  on public.private_goal_milestones to authenticated;
grant insert (goal_id,operation_id,title,due_on)
  on public.private_goal_milestones to authenticated;
grant update (title,due_on,completed_at) on public.private_goal_milestones to authenticated;
grant delete on public.private_goal_milestones to authenticated;
create policy kd_goal_milestone_read on public.private_goal_milestones
  for select to authenticated using ((select auth.uid())=owner_user_id);
create policy kd_goal_milestone_add on public.private_goal_milestones
  for insert to authenticated with check (
    (select auth.uid())=owner_user_id and
    exists (select 1 from public.private_goals goal
      where goal.id=goal_id and goal.owner_user_id=owner_user_id
        and goal.status<>'ARCHIVED')
  );
create policy kd_goal_milestone_edit on public.private_goal_milestones
  for update to authenticated
  using ((select auth.uid())=owner_user_id)
  with check ((select auth.uid())=owner_user_id and
    exists (select 1 from public.private_goals goal
      where goal.id=goal_id and goal.owner_user_id=owner_user_id
        and goal.status<>'ARCHIVED'));
create policy kd_goal_milestone_delete on public.private_goal_milestones
  for delete to authenticated using ((select auth.uid())=owner_user_id);
create index kd_goal_milestone_owner_idx on public.private_goal_milestones
  (goal_id,owner_user_id,created_at);
comment on table public.private_goal_milestones is
  'Owner-only checkable milestones. Completion is manual, not provider-verified.';
