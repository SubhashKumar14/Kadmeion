-- Public delivery consent/privacy matrix against isolated Supabase test database.
-- Fixtures deliberately seed internal trusted-stage rows to exercise the actual
-- service_role-only read boundary; this is NOT a hosted publish verification.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select * from no_plan();

select has_function('public','service_read_public_portfolio',array['text','text'],
  'public HTML projection is behind a trusted RPC');
select has_function('public','service_read_unlisted_release',array['uuid'],
  'unlisted HTML uses its own separately scoped RPC');
select ok(not has_function_privilege('anon',
  'public.service_read_public_portfolio(text,text)','EXECUTE'),
  'anonymous cannot call a service-key-only public resolver');
select ok(not has_function_privilege('authenticated',
  'public.service_read_public_portfolio(text,text)','EXECUTE'),
  'authenticated accounts cannot invoke privileged public renderer');
select ok(has_function_privilege('service_role',
  'public.service_read_public_portfolio(text,text)','EXECUTE'),
  'trusted service may resolve owner-consented public HTML');
select ok(not has_function_privilege('anon',
  'public.service_read_unlisted_release(uuid)','EXECUTE'),
  'anonymous cannot invoke unlisted source byte RPC');
select ok(not has_function_privilege('authenticated',
  'public.service_read_unlisted_release(uuid)','EXECUTE'),
  'signed-in browser cannot read unlisted source bytes by portfolio ID');
select ok(not has_table_privilege('authenticated',
  'kadmeion_private.unlisted_release_routes','SELECT'),
  'owners cannot query trusted live route rows');
select ok(not has_table_privilege('anon',
  'public.private_unlisted_publication_intents','SELECT'),
  'anonymous cannot enumerate publication intents');

insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at)
values('00000000-0000-4000-8000-0000000000d1',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','public-boundary@testing.invalid',now(),now());

insert into public.profiles(user_id,handle,display_name)
values('00000000-0000-4000-8000-0000000000d1','release_owner','Release Owner');
insert into public.portfolios(id,owner_user_id,slug,title,template_id,head_revision)
values('10000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000d1',
  'release-fixture','Release Fixture','starter',1);

insert into public.portfolio_revisions(
  portfolio_id,owner_user_id,revision,base_revision,operation_id,snapshot,snapshot_sha256)
values('10000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000d1',1,0,
  '20000000-0000-4000-8000-0000000000d1',
  '{"formatVersion":1,"files":{},"slots":{},"stashes":{}}'::jsonb,
  encode(sha256(convert_to('{"formatVersion":1,"files":{},"slots":{},"stashes":{}}'::jsonb::text,'UTF8')),'hex'));
insert into public.private_release_requests(
  id,portfolio_id,owner_user_id,operation_id,revision,snapshot_sha256,visibility_intent)
select '30000000-0000-4000-8000-0000000000d1',portfolio_id,owner_user_id,
  '40000000-0000-4000-8000-0000000000d1',1,snapshot_sha256,'PUBLIC'
from public.portfolio_revisions
where portfolio_id='10000000-0000-4000-8000-0000000000d1';

select set_config('kd.public_fixture.html',
  '<!doctype html><html><head><meta name="robots" content="noindex,nofollow,noarchive"></head><body><h1>Published test bytes</h1></body></html>',true);
select set_config('kd.public_fixture.sha',
  encode(sha256(convert_to(current_setting('kd.public_fixture.html'),'UTF8')),'hex'),true);

insert into public.private_release_visibility_pointers(
  portfolio_id,owner_user_id,status,candidate_request_id,
  candidate_manifest_sha256,generation,revocation_generation)
values('10000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000d1',
  'PREPARED_PRIVATE','30000000-0000-4000-8000-0000000000d1',
  repeat('a',64),1,0);
insert into kadmeion_private.private_artifact_bindings(
  portfolio_id,owner_user_id,request_id,pointer_generation,
  manifest_sha256,html_sha256,html_byte_length)
values('10000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000d1',
  '30000000-0000-4000-8000-0000000000d1',
  1,repeat('a',64),current_setting('kd.public_fixture.sha'),
  octet_length(current_setting('kd.public_fixture.html')));
insert into kadmeion_private.private_reviewer_stage_artifacts(
  portfolio_id,owner_user_id,request_id,pointer_generation,html,html_sha256)
values('10000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000d1',
  '30000000-0000-4000-8000-0000000000d1',1,
  current_setting('kd.public_fixture.html'),current_setting('kd.public_fixture.sha'));

insert into public.private_unlisted_publication_intents(
  id,portfolio_id,owner_user_id,request_id,operation_id,expected_pointer_generation,
  public_handle,public_slug,status)
values('50000000-0000-4000-8000-0000000000d1',
  '10000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000d1',
  '30000000-0000-4000-8000-0000000000d1',
  '60000000-0000-4000-8000-0000000000d1',1,
  'release_owner','release-fixture','USED');

insert into kadmeion_private.unlisted_release_routes(
  portfolio_id,owner_user_id,request_id,intent_id,
  stage_generation,release_generation,status,verified_at,html_sha256)
values('10000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000d1',
  '30000000-0000-4000-8000-0000000000d1',
  '50000000-0000-4000-8000-0000000000d1',
  1,1,'LIVE',transaction_timestamp(),current_setting('kd.public_fixture.sha'));

set local role service_role;
select is(
  public.service_read_public_portfolio('release_owner','release-fixture')->>'htmlSha256',
  current_setting('kd.public_fixture.sha'),
  'explicit-consent public route returns the exact trusted stage digest');
select is(
  public.service_read_public_portfolio('release_owner','release-fixture')->>'html',
  current_setting('kd.public_fixture.html'),
  'public route does not switch to another snapshot');
select is(public.service_read_public_portfolio('foreign_owner','release-fixture'),
  null::jsonb,'wrong public owner handle does not return a release');
select is(public.service_read_public_portfolio('release_owner','other-fixture'),
  null::jsonb,'wrong public portfolio slug does not return a release');
select is(public.service_read_unlisted_release(
  '10000000-0000-4000-8000-0000000000d1'),null::jsonb,
  'UNLISTED resolver cannot expose an expressly PUBLIC release');

reset role;
update public.profiles set handle='renamed_owner'
where user_id='00000000-0000-4000-8000-0000000000d1';

select is((select public_handle from public.private_unlisted_publication_intents
  where id='50000000-0000-4000-8000-0000000000d1'),
  null::text,'changing the identity handle irrevocably clears old route consent');

set local role service_role;
select is(public.service_read_public_portfolio('release_owner','release-fixture'),
  null::jsonb,'retired public handle cannot serve stale release');
select is(public.service_read_public_portfolio('renamed_owner','release-fixture'),
  null::jsonb,'new handle needs fresh explicit publication consent');

reset role;
update public.private_release_visibility_pointers
  set status='BLOCKED',candidate_request_id=null,candidate_manifest_sha256=null,
      generation=2,revocation_generation=2
where portfolio_id='10000000-0000-4000-8000-0000000000d1';
select is((select status from kadmeion_private.unlisted_release_routes
  where portfolio_id='10000000-0000-4000-8000-0000000000d1'),
  'REVOKED','blocking private pointer transactionally revokes the active route');

set local role service_role;
select is(public.service_read_public_portfolio('renamed_owner','release-fixture'),
  null::jsonb,'blocked route remains unavailable at trusted read boundary');
select * from finish();
rollback;
