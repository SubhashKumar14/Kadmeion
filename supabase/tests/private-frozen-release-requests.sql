-- B4: owner-private immutable release intent. No public route is created.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select plan(26);
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
  encode(sha256(convert_to('{"formatVersion":1,"files":{},"slots":{},"stashes":{}}'::jsonb::text,'UTF8')),'hex')
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


select ok(has_function_privilege('authenticated','public.load_private_frozen_revision(uuid)','EXECUTE'),
  'owner JWT may request one atomic private frozen revision read');
select ok(not has_function_privilege('anon','public.load_private_frozen_revision(uuid)','EXECUTE'),
  'anonymous cannot execute the private frozen revision loader');
select is(public.load_private_frozen_revision(
  (select id from public.private_release_requests limit 1))->>'requestId',
  (select id::text from public.private_release_requests limit 1),
  'atomic read identifies exactly the owner frozen request');
select is(public.load_private_frozen_revision(
  (select id from public.private_release_requests limit 1))->>'status','FROZEN',
  'atomic read never claims a published release');
select is(public.load_private_frozen_revision(
  (select id from public.private_release_requests limit 1))->>'snapshotSha256',
  (select snapshot_sha256 from public.portfolio_revisions limit 1),
  'atomic read recomputes the canonical immutable revision digest');
select ok(public.load_private_frozen_revision(
  (select id from public.private_release_requests limit 1))->'snapshot'->>'formatVersion'='1',
  'atomic read returns the owner immutable snapshot');
select ok(public.load_private_frozen_revision(
  (select id from public.private_release_requests limit 1))->'publicUrl'='null'::jsonb,
  'atomic read never grants a public URL');

select set_config('kd.test.frozen_id',
  (select id::text from public.private_release_requests limit 1),true);
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

do $$
declare v_denied boolean:=false;
begin
  begin
    perform public.load_private_frozen_revision(
      current_setting('kd.test.frozen_id')::uuid);
  exception when insufficient_privilege then v_denied:=true;
  end;
  if not v_denied then raise exception 'Cross-owner frozen snapshot leaked'; end if;
end $$;
select pass('Cross-owner atomic frozen read is denied without disclosing source');

reset role;
update public.portfolios set trashed_at=now()
  where id='10000000-0000-4000-8000-0000000000f1';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000f1',true);
do $$
declare v_denied boolean:=false;
begin
  begin
    perform public.load_private_frozen_revision(
      (select id from public.private_release_requests limit 1));
  exception when insufficient_privilege then v_denied:=true;
  end;
  if not v_denied then raise exception 'Trashed frozen snapshot was loaded'; end if;
end $$;
select pass('Trashed portfolio cannot be loaded even with an old frozen request');

reset role;
update public.portfolios set trashed_at=null
  where id='10000000-0000-4000-8000-0000000000f1';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000f1',true);
select is(public.load_private_frozen_revision(
  (select id from public.private_release_requests limit 1))->>'status','FROZEN',
  'Restored owner-private snapshot remains readable without becoming public');

reset role;
update public.portfolio_revisions set snapshot_sha256=repeat('f',64)
  where portfolio_id='10000000-0000-4000-8000-0000000000f1';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000f1',true);
do $$
declare v_denied boolean:=false;
begin
  begin
    perform public.load_private_frozen_revision(
      (select id from public.private_release_requests limit 1));
  exception when sqlstate '22000' then v_denied:=true;
  end;
  if not v_denied then raise exception 'Mismatched immutable digest accepted'; end if;
end $$;
select pass('Tampered stored revision SHA is rejected before returning bytes');

do $$
declare v_denied boolean:=false;
begin
  begin
    perform public.load_private_frozen_revision(null);
  exception when invalid_parameter_value then v_denied:=true;
  end;
  if not v_denied then raise exception 'Null frozen request accepted'; end if;
end $$;
select pass('Null request identifier rejected');

select * from finish();
rollback;
