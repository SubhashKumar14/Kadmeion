-- B09: deleting Auth rows does not synchronously revoke signed access JWTs.
-- This is a read-only regression guard: never delete a real or fixture account.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select plan(5);
select ok(to_regprocedure('public.owner_execute_account_erasure(uuid,uuid,text)') is not null,
  'owner account erasure procedure exists');
select ok(not has_function_privilege('anon',
  'public.owner_execute_account_erasure(uuid,uuid,text)','EXECUTE'),
  'anonymous cannot execute deletion');
select ok(has_function_privilege('authenticated',
  'public.owner_execute_account_erasure(uuid,uuid,text)','EXECUTE'),
  'signed-in owner can request guarded deletion');
select ok(position('''accessTerminated'',false' in
  pg_get_functiondef('public.owner_execute_account_erasure(uuid,uuid,text)'::regprocedure))>0,
  'database deletion receipt acknowledges possible surviving JWTs');
select ok(position('''accessTerminated'',true' in
  pg_get_functiondef('public.owner_execute_account_erasure(uuid,uuid,text)'::regprocedure))=0,
  'database no longer fabricates immediate signed JWT invalidation');
select * from finish();
rollback;
