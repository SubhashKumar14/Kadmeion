-- B2: private link-based projects and their image assets. Public delivery is B4.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null,
  title text not null,
  summary text not null default '',
  description text not null default '',
  repository_url text,
  live_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 0,
  unique (owner_user_id, slug),
  unique (id, owner_user_id),
  constraint project_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 64),
  constraint project_title_length check (char_length(btrim(title)) between 1 and 120),
  constraint project_summary_length check (char_length(summary) <= 360),
  constraint project_description_length check (char_length(description) <= 12000),
  constraint project_revision_nonnegative check (revision >= 0),
  constraint project_repository_https check (repository_url is null or (char_length(repository_url) <= 2048 and repository_url ~ '^https://[^[:space:]]+$')),
  constraint project_live_https check (live_url is null or (char_length(live_url) <= 2048 and live_url ~ '^https://[^[:space:]]+$'))
);
create index projects_owner_created_idx on public.projects(owner_user_id, created_at desc);
alter table public.projects enable row level security;
revoke all on table public.projects from public, anon;
grant select, insert, update on table public.projects to authenticated;
create policy projects_owner_select on public.projects for select to authenticated using ((select auth.uid())=owner_user_id);
create policy projects_owner_insert on public.projects for insert to authenticated with check ((select auth.uid())=owner_user_id);
create policy projects_owner_update on public.projects for update to authenticated using ((select auth.uid())=owner_user_id) with check ((select auth.uid())=owner_user_id);
comment on table public.projects is 'Private owner projects; DELETE unavailable until B5 Trash flow.';

-- Owner intent does NOT activate public routes or access to private source.
create table public.project_exposure_intents (
  project_id uuid primary key,
  owner_user_id uuid not null,
  show_on_profile boolean not null default false,
  show_case_study boolean not null default false,
  requested_at timestamptz,
  foreign key (project_id, owner_user_id) references public.projects(id, owner_user_id) on delete cascade
);
create index project_exposure_owner_idx on public.project_exposure_intents(owner_user_id);
alter table public.project_exposure_intents enable row level security;
revoke all on table public.project_exposure_intents from public, anon;
grant select, insert, update on table public.project_exposure_intents to authenticated;
create policy exposure_owner_select on public.project_exposure_intents for select to authenticated using ((select auth.uid())=owner_user_id);
create policy exposure_owner_insert on public.project_exposure_intents for insert to authenticated with check ((select auth.uid())=owner_user_id);
create policy exposure_owner_update on public.project_exposure_intents for update to authenticated using ((select auth.uid())=owner_user_id) with check ((select auth.uid())=owner_user_id);
comment on table public.project_exposure_intents is 'Private owner sharing requests only. No public delivery routes are activated here.';

-- No executable SVG; uploaded files remain private even if project intent changes.
create table public.project_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  owner_user_id uuid not null,
  object_path text not null unique,
  mime_type text not null check (mime_type in ('image/png','image/jpeg','image/webp','image/avif')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 5242880),
  alt_text text not null default '' check (char_length(alt_text) <= 500),
  created_at timestamptz not null default now(),
  foreign key (project_id, owner_user_id) references public.projects(id, owner_user_id) on delete cascade,
  constraint project_asset_path check (object_path ~ ('^' || owner_user_id::text || '/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+$'))
);
create index project_assets_project_idx on public.project_assets(owner_user_id, project_id);
alter table public.project_assets enable row level security;
revoke all on table public.project_assets from public, anon;
grant select, insert, update on table public.project_assets to authenticated;
create policy assets_owner_select on public.project_assets for select to authenticated using ((select auth.uid())=owner_user_id);
create policy assets_owner_insert on public.project_assets for insert to authenticated with check ((select auth.uid())=owner_user_id);
create policy assets_owner_update on public.project_assets for update to authenticated using ((select auth.uid())=owner_user_id) with check ((select auth.uid())=owner_user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kadmeion-private-assets','kadmeion-private-assets',false,5242880,array['image/png','image/jpeg','image/webp','image/avif'])
on conflict (id) do nothing;

create policy kd_storage_private_read on storage.objects for select to authenticated
using (bucket_id='kadmeion-private-assets' and owner_id=(select auth.uid()::text) and (storage.foldername(name))[1]=(select auth.uid()::text));
create policy kd_storage_private_insert on storage.objects for insert to authenticated
with check (bucket_id='kadmeion-private-assets' and owner_id=(select auth.uid()::text) and (storage.foldername(name))[1]=(select auth.uid()::text));
create policy kd_storage_private_update on storage.objects for update to authenticated
using (bucket_id='kadmeion-private-assets' and owner_id=(select auth.uid()::text) and (storage.foldername(name))[1]=(select auth.uid()::text))
with check (bucket_id='kadmeion-private-assets' and owner_id=(select auth.uid()::text) and (storage.foldername(name))[1]=(select auth.uid()::text));
-- No client DELETE: B5 will coordinate revocation, item Trash and retention.
