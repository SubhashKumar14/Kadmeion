-- B1 welcome persistence, request isolation and idempotent signed-in RPC.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;
select plan(9);

select has_table('public','private_onboarding_steps','private welcome steps exist');
select ok((select relrowsecurity from pg_class where oid='public.private_onboarding_steps'::regclass),'welcome rows use RLS');
select ok(has_table_privilege('authenticated','public.private_onboarding_steps','SELECT'),'owner can read welcome statuses');
select ok(not has_table_privilege('anon','public.private_onboarding_steps','SELECT'),'anonymous cannot read welcome statuses');
select ok(not has_table_privilege('authenticated','public.private_onboarding_steps','INSERT'),'client cannot forge owner status rows');
select ok(not has_table_privilege('authenticated','public.private_onboarding_steps','UPDATE'),'client cannot bypass the step RPC');
select ok(has_function_privilege('authenticated','public.set_private_onboarding_step(text,text)','EXECUTE'),'authenticated may call narrow step RPC');
select ok(not has_function_privilege('anon','public.set_private_onboarding_step(text,text)','EXECUTE'),'anonymous cannot call step RPC');

insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-0000000000e1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','onboarding-owner-one@invalid.example',now(),now()),
 ('00000000-0000-4000-8000-0000000000e2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','onboarding-owner-two@invalid.example',now(),now());

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000e1',true);
do $$
declare a jsonb; b jsonb; c jsonb; failed boolean:=false;
begin
  a:=public.set_private_onboarding_step('profile','completed');
  if a->>'step'<>'profile' or a->>'status'<>'completed' or (a->>'revision')::int<>0 then
    raise exception 'First owner status failed'; end if;
  b:=public.set_private_onboarding_step('profile','completed');
  if (b->>'revision')::int<>0 then raise exception 'Identical replay incremented revision'; end if;
  c:=public.set_private_onboarding_step('profile','skipped');
  if (c->>'revision')::int<>1 then raise exception 'State transition revision not incremented'; end if;
  if (select count(*) from public.private_onboarding_steps)<>1 then
    raise exception 'Another user onboarding record was visible'; end if;
  begin
    perform public.set_private_onboarding_step('operator','completed');
  exception when invalid_parameter_value then failed:=true; end;
  if not failed then raise exception 'Unknown step accepted'; end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000e2',true);
do $$
declare r jsonb;
begin
  if (select count(*) from public.private_onboarding_steps)<>0 then
    raise exception 'Owner B can see owner A onboarding'; end if;
  r:=public.set_private_onboarding_step('connections','skipped');
  if r->>'step'<>'connections' or (select count(*) from public.private_onboarding_steps)<>1 then
    raise exception 'Owner B could not create own status'; end if;
end $$;
reset role;
select pass('Authenticated owners can set own independent steps with idempotent revisions and RLS isolation');
select * from finish();
rollback;
