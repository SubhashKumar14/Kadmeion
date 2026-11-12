-- B1: identity ownership, explicit sharing intent and non-escalatable operator roles.
-- No public profile delivery endpoint exists until the B4 hosting verification gate.

-- This pre-existing DDL event-trigger helper must not be an exposed RPC surface.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

create schema if not exists kadmeion_private;
revoke all on schema kadmeion_private from public, anon, authenticated;
grant usage on schema kadmeion_private to service_role;

create table kadmeion_private.operator_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('moderator', 'administrator')),
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null
);
alter table kadmeion_private.operator_roles enable row level security;
revoke all on table kadmeion_private.operator_roles from public, anon, authenticated;
grant select on table kadmeion_private.operator_roles to service_role;
comment on table kadmeion_private.operator_roles is 'Privileged authorization, never sourced from user_metadata or exposed to clients.';

create table public.profile_sharing_preferences (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  share_display_name boolean not null default false,
  share_headline boolean not null default false,
  share_bio boolean not null default false,
  publication_requested boolean not null default false,
  requested_at timestamptz,
  constraint sharing_has_selected_field check (
    not publication_requested or (share_display_name or share_headline or share_bio)
  )
);
alter table public.profile_sharing_preferences enable row level security;
revoke all on table public.profile_sharing_preferences from public, anon;
grant select, insert, update on table public.profile_sharing_preferences to authenticated;
create policy sharing_owner_select on public.profile_sharing_preferences
  for select to authenticated using ((select auth.uid()) = user_id);
create policy sharing_owner_insert on public.profile_sharing_preferences
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy sharing_owner_update on public.profile_sharing_preferences
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
comment on table public.profile_sharing_preferences is 'Owner-only sharing intent, NOT an active public publication flag.';

-- A deliberately narrow Auth hook. Handle remains NULL until the signed-in
-- owner passes authoritative uniqueness checks. Untrusted metadata provides
-- display text only; it NEVER grants roles, verification, or public exposure.
create function kadmeion_private.initialize_private_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80))
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function kadmeion_private.initialize_private_identity() from public, anon, authenticated;
create trigger kadmeion_on_auth_user_created
  after insert on auth.users
  for each row execute function kadmeion_private.initialize_private_identity();
