-- B0/B1 bootstrap. Private identities only; publication requires a separately verified host.
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  handle text unique,
  display_name text not null default '',
  headline text not null default '',
  bio text not null default '',
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_handle_format check (
    handle is null or (
      handle ~ '^[a-z][a-z0-9_]{2,29}$' and
      handle not in ('admin','api','auth','dashboard','edit','explore','help',
                     'login','logout','new','profile','projects','settings',
                     'signup','support','templates','u')
    )
  ),
  constraint profiles_name_length check (char_length(display_name) <= 80),
  constraint profiles_headline_length check (char_length(headline) <= 160),
  constraint profiles_bio_length check (char_length(bio) <= 2000)
);

alter table public.profiles enable row level security;
revoke all on table public.profiles from public, anon;
grant select, insert, update on table public.profiles to authenticated;

create policy profiles_owner_select on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy profiles_owner_insert on public.profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy profiles_owner_update on public.profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

comment on table public.profiles is 'Private-by-default owner identity; no anonymous publication granted.';
