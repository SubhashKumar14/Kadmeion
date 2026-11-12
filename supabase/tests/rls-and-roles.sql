-- Structural checks only. B1 must add actual owner-A/owner-B request tests.
begin;
select plan(6);
select has_table('public', 'profiles', 'private owner profiles exist');
select has_column('public', 'profiles', 'user_id', 'profiles are keyed by owner');
select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'RLS is enabled');
select is((select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'profiles'), 3, 'three explicit owner policies exist');
select ok(not has_table_privilege('anon', 'public.profiles', 'SELECT'), 'anonymous cannot read private profiles');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'DELETE'), 'account deletion is not a profile table DELETE');
select * from finish();
rollback;
