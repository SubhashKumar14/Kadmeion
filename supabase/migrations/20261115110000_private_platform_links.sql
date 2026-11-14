-- P2 platform presence: six owner-supplied profile links, strictly LINK_ONLY.
-- No provider OAuth, scraping, automatic metrics, verified ownership or public
-- projection is claimed. Every link is private until another explicit consent.
create table public.private_platform_links (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  provider text not null check (provider in
    ('GITHUB','LEETCODE','CODEFORCES','HACKERRANK','KAGGLE','HUGGING_FACE')),
  handle text not null check (
    char_length(handle) between 1 and 64
    and handle ~ '^[A-Za-z0-9_][A-Za-z0-9_.-]*[A-Za-z0-9_]$'
    and (provider<>'GITHUB' or (
      char_length(handle)<=39 and handle ~ '^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$'))
    and (provider<>'HUGGING_FACE' or
      handle ~ '^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$')
  ),
  profile_url text generated always as (
    case provider
      when 'GITHUB' then 'https://github.com/'||handle
      when 'LEETCODE' then 'https://leetcode.com/u/'||handle
      when 'CODEFORCES' then 'https://codeforces.com/profile/'||handle
      when 'HACKERRANK' then 'https://www.hackerrank.com/profile/'||handle
      when 'KAGGLE' then 'https://www.kaggle.com/'||handle
      when 'HUGGING_FACE' then 'https://huggingface.co/'||handle
    end
  ) stored,
  provenance text generated always as ('USER_SUPPLIED'::text) stored,
  connection_mode text generated always as ('LINK_ONLY'::text) stored,
  sync_status text generated always as ('NOT_SYNCED'::text) stored,
  ownership_verified boolean generated always as (false) stored,
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  unique(owner_user_id,provider)
);
comment on table public.private_platform_links is
  'Only private manually supplied handles. Generated HTTPS link, LINK_ONLY, NOT_SYNCED and ownership false are immutable and not provider authorization.';
alter table public.private_platform_links enable row level security;
revoke all on public.private_platform_links from public,anon,authenticated;
grant select (id,owner_user_id,provider,handle,profile_url,provenance,
  connection_mode,sync_status,ownership_verified,created_at,updated_at)
  on public.private_platform_links to authenticated;
grant insert(provider,handle) on public.private_platform_links to authenticated;
grant update(handle) on public.private_platform_links to authenticated;
grant delete on public.private_platform_links to authenticated;
create policy kd_owner_platform_link_select on public.private_platform_links
  for select to authenticated using ((select auth.uid())=owner_user_id);
create policy kd_owner_platform_link_insert on public.private_platform_links
  for insert to authenticated with check ((select auth.uid())=owner_user_id);
create policy kd_owner_platform_link_update on public.private_platform_links
  for update to authenticated using ((select auth.uid())=owner_user_id)
    with check ((select auth.uid())=owner_user_id);
create policy kd_owner_platform_link_delete on public.private_platform_links
  for delete to authenticated using ((select auth.uid())=owner_user_id);
create index kd_private_platform_link_owner_idx on public.private_platform_links
  (owner_user_id,created_at desc);

-- Every source URL is derived from fixed hosts and identifier bytes; there
-- is no arbitrary user-submitted URL stored or fetched by this feature.
create function kadmeion_private.touch_owner_platform_link()
returns trigger language plpgsql set search_path=''
as $function$
begin
  new.updated_at=transaction_timestamp();
  return new;
end;
$function$;
revoke all on function kadmeion_private.touch_owner_platform_link()
  from public,anon,authenticated,service_role;
create trigger kd_platform_link_updated_at before update on public.private_platform_links
  for each row execute function kadmeion_private.touch_owner_platform_link();
