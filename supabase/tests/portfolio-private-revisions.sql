-- pgTAP checks for deterministic immutable revision storage and RPC privileges.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;
select plan(11);
select has_table('public','portfolios','private portfolios exist');
select has_table('public','portfolio_revisions','immutable revisions exist');
select ok((select relrowsecurity from pg_class where oid='public.portfolios'::regclass),'portfolio RLS is enabled');
select ok((select relrowsecurity from pg_class where oid='public.portfolio_revisions'::regclass),'revision RLS is enabled');
select ok(not has_table_privilege('anon','public.portfolios','SELECT'),'no anonymous portfolio access');
select ok(not has_table_privilege('anon','public.portfolio_revisions','SELECT'),'no anonymous revision access');
select ok(not has_table_privilege('authenticated','public.portfolios','UPDATE'),'owners cannot bypass head CAS');
select ok(not has_table_privilege('authenticated','public.portfolio_revisions','INSERT'),'owners cannot fabricate revisions');
select ok(to_regprocedure('public.commit_portfolio_revision(uuid,uuid,bigint,jsonb)') is not null,'commit RPC exists');
select ok(has_function_privilege('authenticated','public.commit_portfolio_revision(uuid,uuid,bigint,jsonb)','EXECUTE'),'owner can execute guarded commit RPC');
select ok(not has_function_privilege('anon','public.commit_portfolio_revision(uuid,uuid,bigint,jsonb)','EXECUTE'),'anonymous cannot call commit RPC');
select * from finish();
rollback;
