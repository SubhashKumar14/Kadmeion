-- B1/B2/B3 destructive tests use ephemeral synthetic users and rollback.
-- These checks exercise real RLS with authenticated role + request.jwt.claim.sub.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;
select plan(5);

insert into auth.users (id,instance_id,aud,role,email,created_at,updated_at) values
('00000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','test-owner-a@invalid.example',now(),now()),
('00000000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','test-owner-b@invalid.example',now(),now());
select is((select count(*)::int from public.profiles where user_id in
 ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b2')),
 2,'Auth insert trigger creates private profiles for both users');

insert into public.projects (id,owner_user_id,slug,title) values
('10000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a1','first-project','First Project'),
('10000000-0000-4000-8000-0000000000b2','00000000-0000-4000-8000-0000000000b2','second-project','Second Project');
insert into public.portfolios (id,owner_user_id,slug,title,template_id) values
('20000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a1','first-portfolio','First Portfolio','editor-default');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a1',true);
do $$
declare
  n integer;
  result jsonb;
  content jsonb:='{"formatVersion":1,"files":{"kadmeion.json":"{}"},"slots":{},"stashes":{}}';
begin
  if (select count(*) from public.profiles)<>1
     or (select count(*) from public.projects)<>1
     or (select count(*) from public.portfolios)<>1 then
    raise exception 'Owner A could enumerate another account';
  end if;
  update public.profiles set headline='intrusion'
  where user_id='00000000-0000-4000-8000-0000000000b2';
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Owner A changed Owner B profile'; end if;
  begin
    insert into public.portfolios(owner_user_id,slug,title,template_id,head_revision)
    values('00000000-0000-4000-8000-0000000000a1','forged-head','Evil','editor-default',100);
    raise exception 'Client inserted forged portfolio head';
  exception when insufficient_privilege then null; end;
  result:=public.commit_portfolio_revision(
    '20000000-0000-4000-8000-0000000000a1',
    '30000000-0000-4000-8000-0000000000a1',0,content);
  if result->>'revision'<>'1' or result->>'alreadyCommitted'<>'false'
    then raise exception 'Initial portfolio commit was not durable'; end if;
  result:=public.commit_portfolio_revision(
    '20000000-0000-4000-8000-0000000000a1',
    '30000000-0000-4000-8000-0000000000a1',0,content);
  if result->>'revision'<>'1' or result->>'alreadyCommitted'<>'true'
    then raise exception 'Idempotent replay created a second revision'; end if;
  if (select count(*) from public.portfolio_revisions)<>1
    then raise exception 'Expected one immutable portfolio revision'; end if;
  begin
    perform public.commit_portfolio_revision(
      '20000000-0000-4000-8000-0000000000a1',
      '30000000-0000-4000-8000-0000000000a2',0,content);
    raise exception 'Stale cloud edit overwrote the active head';
  exception when serialization_failure then null; end;
  begin
    perform public.commit_portfolio_revision(
      '20000000-0000-4000-8000-0000000000a1',
      '30000000-0000-4000-8000-0000000000a3',1,
      '{"formatVersion":1,"files":{"components/library/internal.tsx":"hacked"},"slots":{},"stashes":{}}');
    raise exception 'Protected source path accepted';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;
select pass('Owner A: RLS, forged-head prevention, immutable commit, replay and stale-write denial');
select pass('Owner A: protected code source path refused by backend RPC');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000b2',true);
do $$
begin
  if (select count(*) from public.portfolios)<>0
     or (select count(*) from public.portfolio_revisions)<>0
     or (select count(*) from public.projects)<>1 then
    raise exception 'Owner B could read Owner A portfolio';
  end if;
  begin
    perform public.commit_portfolio_revision(
      '20000000-0000-4000-8000-0000000000a1',
      '30000000-0000-4000-8000-0000000000b2',1,
      '{"formatVersion":1,"files":{"kadmeion.json":"{}"},"slots":{},"stashes":{}}');
    raise exception 'Owner B committed to Owner A portfolio';
  exception when insufficient_privilege then null; end;
  begin
    perform public.update_private_project(
      '10000000-0000-4000-8000-0000000000a1',0,'Attack','','',null,null);
    raise exception 'Owner B modified Owner A project';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pass('Owner B: private records invisible and both project/editor RPCs deny cross-owner writes');
select ok((select count(*) from public.portfolio_revisions)=1,
  'Exactly one immutable revision remains from the owner commit');

select * from finish();
rollback;
