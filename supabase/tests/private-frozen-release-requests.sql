-- B4: owner-private immutable release intent. No public route is created.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select plan(14);
select has_table('public','private_release_requests','private frozen release records exist');
select ok((select relrowsecurity from pg_class where oid='public.private_release_requests'::regclass),
  'RLS protects frozen release metadata');
select ok(not has_table_privilege('anon','public.private_release_requests','SELECT'),'anonymous cannot read frozen releases');
select ok(not has_table_privilege('authenticated','public.private_release_requests','INSERT'),'client cannot fabricate release');
select ok(not has_table_privilege('authenticated','public.private_release_requests','UPDATE'),'client cannot mutate frozen release');
select ok(not has_table_privilege('authenticated','public.private_release_requests','DELETE'),'client cannot purge frozen history');
select ok(has_table_privilege('authenticated','public.private_release_requests','SELECT'),'owner can list frozen metadata');
select ok(has_function_privilege('authenticated','public.freeze_private_release_request(uuid,uuid,bigint,text)','EXECUTE'),'owner can invoke freeze');
select ok(not has_function_privilege('anon','public.freeze_private_release_request(uuid,uuid,bigint,text)','EXECUTE'),'anon cannot invoke freeze');

insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-0000000000f1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','release-a@invalid.example',now(),now()),
 ('00000000-0000-4000-8000-0000000000f2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','release-b@invalid.example',now(),now());
insert into public.portfolios(id,owner_user_id,slug,title,template_id,head_revision) values
 ('10000000-0000-4000-8000-0000000000f1','00000000-0000-4000-8000-0000000000f1','frozen-fixture','Frozen Fixture','starter',1);
insert into public.portfolio_revisions(
  portfolio_id,owner_user_id,revision,base_revision,operation_id,snapshot,snapshot_sha256
) values (
  '10000000-0000-4000-8000-0000000000f1','00000000-0000-4000-8000-0000000000f1',1,0,
  '20000000-0000-4000-8000-0000000000f1',
  '{"formatVersion":1,"files":{},"slots":{},"stashes":{}}'::jsonb,
  repeat('a',64)
);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000f1',true);
select is(public.freeze_private_release_request(
 '10000000-0000-4000-8000-0000000000f1','30000000-0000-4000-8000-0000000000f1',1,'PUBLIC'
)->>'status','FROZEN','owner can pin an immutable revision');
select ok((select count(*)=1 from public.private_release_requests),
  'frozen request is stored only in private journal');
select is(public.freeze_private_release_request(
 '10000000-0000-4000-8000-0000000000f1','30000000-0000-4000-8000-0000000000f1',1,'PUBLIC'
)->>'alreadyFrozen','true','same operation ID is idempotent');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000f2',true);
select is((select count(*) from public.private_release_requests),0::bigint,
  'other owner cannot read frozen release');
do $$
declare v_denied boolean:=false;
begin
  begin
    perform public.freeze_private_release_request(
      '10000000-0000-4000-8000-0000000000f1','30000000-0000-4000-8000-0000000000f2',1,'PUBLIC');
  exception when insufficient_privilege then v_denied:=true;
  end;
  if not v_denied then raise exception 'Cross-account release freeze accepted'; end if;
end $$;
select pass('Cross-account release freeze rejected');
select * from finish();
rollback;
