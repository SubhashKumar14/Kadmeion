-- B5 staged pgTAP: structural privileges and owner isolation. Run only on a local/test database.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;
select plan(13);
select has_table('public','private_trash_items','private Trash journal exists');
select has_column('public','projects','trashed_at','projects support soft-deletion');
select has_column('public','portfolios','trashed_at','portfolios support soft-deletion');
select ok((select relrowsecurity from pg_class where oid='public.private_trash_items'::regclass),
  'Trash journal has RLS');
select ok(not has_table_privilege('anon','public.private_trash_items','SELECT'),'anonymous cannot read Trash');
select ok(has_table_privilege('authenticated','public.private_trash_items','SELECT'),'authenticated owner can read own Trash');
select ok(not has_table_privilege('authenticated','public.private_trash_items','INSERT'),'client cannot forge Trash');
select ok(not has_table_privilege('authenticated','public.private_trash_items','UPDATE'),'client cannot restore without RPC');
select ok(not has_table_privilege('authenticated','public.private_trash_items','DELETE'),'client cannot purge Trash');
select ok(has_function_privilege('authenticated','public.trash_private_item(text,uuid)','EXECUTE'),'owner can invoke Trash');
select ok(has_function_privilege('authenticated','public.restore_private_item(text,uuid)','EXECUTE'),'owner can invoke restore');
select ok(not has_function_privilege('anon','public.trash_private_item(text,uuid)','EXECUTE'),'anon cannot invoke Trash');
select ok(not has_function_privilege('anon','public.restore_private_item(text,uuid)','EXECUTE'),'anon cannot invoke restore');
select * from finish();
rollback;
