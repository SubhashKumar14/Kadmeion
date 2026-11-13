-- B5 (staged, not yet applied): private 15-day item Trash.
-- This is not account erasure or verified public-route revocation.
-- Public publishing is still disabled; future host activation MUST consult trashed_at.
alter table public.projects add column if not exists trashed_at timestamptz;
alter table public.portfolios add column if not exists trashed_at timestamptz;

create table public.private_trash_items (
  id uuid primary key default gen_random_uuid(),
  item_type text not null check (item_type in ('project','portfolio')),
  item_id uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  trashed_at timestamptz not null,
  restore_until timestamptz not null,
  restored_at timestamptz,
  constraint private_trash_duration check (restore_until > trashed_at),
  constraint private_trash_restore_order check (restored_at is null or restored_at >= trashed_at)
);
create unique index private_trash_one_active_item on public.private_trash_items(item_type,item_id)
  where restored_at is null;
create index private_trash_owner_idx on public.private_trash_items(owner_user_id,trashed_at desc);
alter table public.private_trash_items enable row level security;
revoke all on public.private_trash_items from public, anon, authenticated;
grant select on public.private_trash_items to authenticated;
create policy private_trash_owner_read on public.private_trash_items
  for select to authenticated using ((select auth.uid()) = owner_user_id);
comment on table public.private_trash_items is
  'Owner-visible private 15-day restore journal. Physical purge, Storage cleanup and public-host revocation require separately verified trusted jobs.';

-- Existing revision RPCs use SECURITY DEFINER and would otherwise be able to edit trashed rows.
create function kadmeion_private.prevent_trashed_item_mutation()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if old.trashed_at is not null and
     (to_jsonb(new) - 'trashed_at') is distinct from (to_jsonb(old) - 'trashed_at') then
    raise exception using errcode='55000',message='PRIVATE_ITEM_TRASHED';
  end if;
  return new;
end;
$$;
revoke all on function kadmeion_private.prevent_trashed_item_mutation()
  from public,anon,authenticated;
create trigger kd_trashed_project_immutable before update on public.projects
  for each row execute function kadmeion_private.prevent_trashed_item_mutation();
create trigger kd_trashed_portfolio_immutable before update on public.portfolios
  for each row execute function kadmeion_private.prevent_trashed_item_mutation();

-- Only authenticated owners can initiate reversible Trash. No DELETE is granted.
create function public.trash_private_item(p_item_type text,p_item_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_trashed_at timestamptz;
  v_deadline timestamptz;
  v_now timestamptz := transaction_timestamp();
begin
  if v_owner is null then
    raise exception using errcode='42501',message='AUTH_REQUIRED';
  end if;
  if p_item_id is null or p_item_type not in ('project','portfolio') or p_item_type is null then
    raise exception using errcode='22023',message='INVALID_TRASH_TARGET';
  end if;
  if p_item_type='project' then
    select trashed_at into v_trashed_at from public.projects
    where id=p_item_id and owner_user_id=v_owner for update;
    if not found then raise exception using errcode='42501',message='PRIVATE_ITEM_NOT_FOUND'; end if;
  else
    select trashed_at into v_trashed_at from public.portfolios
    where id=p_item_id and owner_user_id=v_owner for update;
    if not found then raise exception using errcode='42501',message='PRIVATE_ITEM_NOT_FOUND'; end if;
  end if;
  if v_trashed_at is not null then
    select restore_until into v_deadline from public.private_trash_items
    where item_type=p_item_type and item_id=p_item_id and owner_user_id=v_owner
      and restored_at is null;
    if not found then raise exception using errcode='55000',message='PRIVATE_TRASH_JOURNAL_MISSING'; end if;
    return jsonb_build_object('item_type',p_item_type,'item_id',p_item_id,
      'status','already_trashed','restore_until',v_deadline);
  end if;

  if p_item_type='project' then
    update public.projects set trashed_at=v_now
      where id=p_item_id and owner_user_id=v_owner;
    -- Existing exposure fields are intent, not publication. Restoration never re-enables them.
    update public.project_exposure_intents
      set show_on_profile=false,show_case_study=false,requested_at=null
      where project_id=p_item_id and owner_user_id=v_owner;
  else
    update public.portfolios set trashed_at=v_now
      where id=p_item_id and owner_user_id=v_owner;
  end if;

  v_deadline:=v_now+interval '15 days';
  insert into public.private_trash_items(item_type,item_id,owner_user_id,trashed_at,restore_until)
    values (p_item_type,p_item_id,v_owner,v_now,v_deadline);
  return jsonb_build_object('item_type',p_item_type,'item_id',p_item_id,
    'status','trashed','restore_until',v_deadline);
end;
$$;
revoke all on function public.trash_private_item(text,uuid) from public,anon;
grant execute on function public.trash_private_item(text,uuid) to authenticated;

create function public.restore_private_item(p_item_type text,p_item_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_trash public.private_trash_items%rowtype;
  v_actual timestamptz;
begin
  if v_owner is null then
    raise exception using errcode='42501',message='AUTH_REQUIRED';
  end if;
  if p_item_id is null or p_item_type not in ('project','portfolio') or p_item_type is null then
    raise exception using errcode='22023',message='INVALID_TRASH_TARGET';
  end if;
  select * into v_trash from public.private_trash_items
    where item_type=p_item_type and item_id=p_item_id and owner_user_id=v_owner
      and restored_at is null for update;
  if not found then raise exception using errcode='42501',message='PRIVATE_TRASH_NOT_FOUND'; end if;
  if transaction_timestamp() >= v_trash.restore_until then
    raise exception using errcode='55000',message='PRIVATE_TRASH_EXPIRED';
  end if;

  if p_item_type='project' then
    select trashed_at into v_actual from public.projects
      where id=p_item_id and owner_user_id=v_owner for update;
  else
    select trashed_at into v_actual from public.portfolios
      where id=p_item_id and owner_user_id=v_owner for update;
  end if;
  if not found or v_actual is distinct from v_trash.trashed_at then
    raise exception using errcode='55000',message='PRIVATE_TRASH_STATE_CONFLICT';
  end if;
  if p_item_type='project' then
    update public.projects set trashed_at=null
      where id=p_item_id and owner_user_id=v_owner;
  else
    update public.portfolios set trashed_at=null
      where id=p_item_id and owner_user_id=v_owner;
  end if;
  update public.private_trash_items set restored_at=transaction_timestamp()
    where id=v_trash.id;
  return jsonb_build_object('item_type',p_item_type,'item_id',p_item_id,
    'status','restored','public_visibility','private');
end;
$$;
revoke all on function public.restore_private_item(text,uuid) from public,anon;
grant execute on function public.restore_private_item(text,uuid) to authenticated;


-- Disallow new exposure intent on trashed projects, including concurrent inserts.
-- FOR SHARE serializes against project Trash's UPDATE row lock.
create function kadmeion_private.prevent_trashed_project_exposure()
returns trigger language plpgsql set search_path=''
as $$
begin
  if new.show_on_profile or new.show_case_study then
    perform 1 from public.projects p
    where p.id=new.project_id and p.owner_user_id=new.owner_user_id
      and p.trashed_at is null
    for share;
    if not found then
      raise exception using errcode='55000',message='PRIVATE_ITEM_TRASHED';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function kadmeion_private.prevent_trashed_project_exposure()
  from public,anon,authenticated;
create trigger kd_exposure_reject_trashed
  before insert or update on public.project_exposure_intents
  for each row execute function kadmeion_private.prevent_trashed_project_exposure();

-- Do not grant direct UPDATE of trashed_at, INSERT/UPDATE of Trash or any DELETE.
-- Restricted admin and publisher operations must not reuse these owner RPCs.
