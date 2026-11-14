-- B3 editor cloud journal: private, immutable revision snapshots and CAS RPC.
create table public.portfolios (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null,
  title text not null,
  template_id text not null,
  head_revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_user_id),
  unique (owner_user_id, slug),
  constraint portfolios_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 64),
  constraint portfolios_title_check check (char_length(btrim(title)) between 1 and 120),
  constraint portfolios_template_check check (template_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint portfolios_revision_check check (head_revision >= 0)
);
create index portfolios_owner_created_idx on public.portfolios(owner_user_id, created_at desc);
alter table public.portfolios enable row level security;
revoke all on table public.portfolios from public,anon;
grant select,insert on table public.portfolios to authenticated;
create policy portfolios_owner_select on public.portfolios
for select to authenticated using ((select auth.uid())=owner_user_id);
create policy portfolios_owner_insert on public.portfolios
for insert to authenticated with check ((select auth.uid())=owner_user_id);

create table public.portfolio_revisions (
  portfolio_id uuid not null,
  owner_user_id uuid not null,
  revision bigint not null check (revision>0),
  base_revision bigint not null check (base_revision>=0),
  operation_id uuid not null,
  snapshot jsonb not null,
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (portfolio_id,revision),
  unique (portfolio_id,operation_id),
  foreign key (portfolio_id,owner_user_id) references public.portfolios(id,owner_user_id) on delete cascade,
  constraint portfolio_snapshot_object check (
    jsonb_typeof(snapshot)='object' and snapshot->>'formatVersion'='1' and jsonb_typeof(snapshot->'files')='object'
  )
);
create index portfolio_revisions_owner_idx on public.portfolio_revisions(owner_user_id,portfolio_id,revision desc);
alter table public.portfolio_revisions enable row level security;
revoke all on table public.portfolio_revisions from public,anon;
grant select on table public.portfolio_revisions to authenticated;
create policy portfolio_revisions_owner_select on public.portfolio_revisions
for select to authenticated using ((select auth.uid())=owner_user_id);

-- No user has direct permission to update a portfolio head or insert revisions.
-- The single narrowly granted RPC validates owner, pinned base, payload and operation ID.
create function public.commit_portfolio_revision(
  p_portfolio_id uuid, p_operation_id uuid, p_base_revision bigint, p_snapshot jsonb
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_head bigint;
  v_existing public.portfolio_revisions%rowtype;
  v_hash text;
  v_entry record;
  v_next bigint;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if p_operation_id is null or p_portfolio_id is null or p_base_revision is null or p_base_revision<0
    or p_snapshot is null or jsonb_typeof(p_snapshot)<>'object'
    or p_snapshot->>'formatVersion'<>'1'
    or jsonb_typeof(p_snapshot->'files')<>'object'
    or octet_length(p_snapshot::text)>1048576
    or jsonb_object_length(p_snapshot->'files')>100
  then raise exception using errcode='22023',message='INVALID_EDITOR_SNAPSHOT'; end if;
  for v_entry in select key,value from jsonb_each(p_snapshot->'files') loop
    if v_entry.key !~ '^[a-zA-Z0-9_./-]+$'
       or position('..' in v_entry.key)>0
       or left(v_entry.key,1)='/'
       or jsonb_typeof(v_entry.value)<>'string'
       or octet_length(v_entry.value::text)>262144
    then raise exception using errcode='22023',message='INVALID_EDITOR_FILE'; end if;
  end loop;
  select head_revision into v_head from public.portfolios
  where id=p_portfolio_id and owner_user_id=v_owner for update;
  if not found then raise exception using errcode='42501',message='PORTFOLIO_NOT_FOUND_OR_FORBIDDEN'; end if;
  v_hash:=encode(sha256(convert_to(p_snapshot::text,'UTF8')),'hex');
  select * into v_existing from public.portfolio_revisions
  where portfolio_id=p_portfolio_id and operation_id=p_operation_id;
  if found then
    if v_existing.base_revision<>p_base_revision or v_existing.snapshot_sha256<>v_hash then
      raise exception using errcode='23505',message='OPERATION_ID_REUSED';
    end if;
    return jsonb_build_object('portfolioId',p_portfolio_id,'revision',v_existing.revision,
      'snapshotSha256',v_hash,'alreadyCommitted',true);
  end if;
  if v_head<>p_base_revision then
    raise exception using errcode='40001',message='REVISION_CONFLICT';
  end if;
  v_next:=v_head+1;
  insert into public.portfolio_revisions(portfolio_id,owner_user_id,revision,base_revision,operation_id,snapshot,snapshot_sha256)
  values(p_portfolio_id,v_owner,v_next,p_base_revision,p_operation_id,p_snapshot,v_hash);
  update public.portfolios set head_revision=v_next,updated_at=now() where id=p_portfolio_id;
  return jsonb_build_object('portfolioId',p_portfolio_id,'revision',v_next,
    'snapshotSha256',v_hash,'alreadyCommitted',false);
end;
$$;
revoke all on function public.commit_portfolio_revision(uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.commit_portfolio_revision(uuid,uuid,bigint,jsonb) to authenticated;
comment on function public.commit_portfolio_revision(uuid,uuid,bigint,jsonb) is
  'Deliberate signed-in SECURITY DEFINER: explicit UID authorization, row lock, idempotency, fail-closed file validation; no direct revision INSERT grant.';

