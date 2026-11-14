-- Backend-wide security regression invariants for isolated Supabase CI.
-- Future migrations must not silently expose trusted service RPCs or create
-- public owner tables without row-level security.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select plan(6);

select ok((select count(*) from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'service\_%' escape '\')>=5,
  'Service-role-only public RPC inventory is present');
select ok(not exists(
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'service\_%' escape '\'
    and (has_function_privilege('anon',p.oid,'EXECUTE')
      or has_function_privilege('authenticated',p.oid,'EXECUTE'))
), 'Service RPCs never grant execute to anonymous or authenticated browsers');
select ok(not exists(
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef
    and has_function_privilege('anon',p.oid,'EXECUTE')
), 'Anonymous role cannot execute public SECURITY DEFINER functions');
select diag('PRIVATE EXECUTABLES: '||coalesce((
  select string_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',', ')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='kadmeion_private'
    and has_function_privilege('anon',p.oid,'EXECUTE')
),'none'));
select ok(not exists(
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='kadmeion_private'
    and has_function_privilege('anon',p.oid,'EXECUTE')
), 'Private schema RPCs are not anonymous entry points');
select ok(not exists(
  select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p')
    and not c.relrowsecurity
    and not exists(
      select 1 from pg_depend d where d.classid='pg_class'::regclass
        and d.objid=c.oid and d.deptype='e'
    )
), 'All app-owned public tables enforce RLS');
select ok(not exists(
  select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='kadmeion_private' and c.relkind in ('r','p')
    and (has_table_privilege('anon',c.oid,'SELECT')
      or has_table_privilege('authenticated',c.oid,'SELECT'))
), 'Internal private tables remain inaccessible to browser SQL roles');

select * from finish();
rollback;
