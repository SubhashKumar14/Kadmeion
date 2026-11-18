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
select ok(pg_get_functiondef('public.service_read_unlisted_release(uuid)'::regprocedure)
    like '%r.stage_generation>v.revocation_generation%',
  'UNLISTED delivery must also reject stale immutable stage after pointer revocation');
select ok(not has_table_privilege('anon',
  'public.private_unlisted_publication_intents','SELECT'),
  'anonymous cannot enumerate publication intents');

insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at)
values('00000000-0000-4000-8000-0000000000d1',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','public-boundary@testing.invalid',now(),now());

-- The Auth signup trigger has already created the private owner profile.
update public.profiles set handle='release_owner',display_name='Release Owner'
where user_id='00000000-0000-4000-8000-0000000000d1';
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

-- Existing public release may contain any author-typed project reference.
insert into public.projects(id,owner_user_id,slug,title)
values('70000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000d1',
  'project-privacy','Privacy Fixture');
set local role authenticated;
select set_config('request.jwt.claim.sub',
  '00000000-0000-4000-8000-0000000000d1',true);
insert into public.project_exposure_intents(
  project_id,owner_user_id,show_on_profile,show_case_study)
values('70000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000d1',true,true);
reset role;

set local role service_role;
select is(
  public.service_read_public_portfolio('release_owner','release-fixture')->>'htmlSha256',
  current_setting('kd.public_fixture.sha'),
  'explicit-consent public route returns the exact trusted stage digest');
select is(
  public.service_read_public_portfolio('release_owner','release-fixture')->>'html',
  current_setting('kd.public_fixture.html'),
  'public route does not switch to another snapshot');
select is(
  (public.service_read_public_portfolio('release_owner','release-fixture')->>'indexable')::boolean,
  true,'HTTP-acknowledged public release is eligible for indexing');
-- C11 is mandatory on the composed forward migration, never conditionally skipped.
reset role;
select has_table('kadmeion_private','public_delivery_epochs','C11 authoritative epoch table exists');
select ok((select relrowsecurity from pg_class where oid='kadmeion_private.public_delivery_epochs'::regclass),
  'C11 epoch ledger is RLS protected');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) r
  where has_any_column_privilege(r,'kadmeion_private.public_delivery_epochs','SELECT,INSERT,UPDATE,REFERENCES')
    or has_table_privilege(r,'kadmeion_private.public_delivery_epochs','DELETE,TRUNCATE,TRIGGER')),
  'C11 API roles cannot read or mutate authoritative epoch rows directly');
select ok(not exists(select 1 from unnest(array['service_read_current_public_delivery_receipt(uuid,uuid)',
    'service_acknowledge_public_delivery(jsonb)','service_recover_failed_public_delivery(jsonb)']) p
  where has_function_privilege('anon','public.'||p,'EXECUTE')
    or has_function_privilege('authenticated','public.'||p,'EXECUTE')
    or not has_function_privilege('service_role','public.'||p,'EXECUTE')),
  'C11 only protected service role may read, acknowledge and recover delivery receipt');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) r
  cross join unnest(array['bump_public_delivery_epoch(uuid)','lock_expected_public_delivery(jsonb)',
    'note_public_delivery_change()','note_public_delivery_handle()']) p
  where has_function_privilege(r,'kadmeion_private.'||p,'EXECUTE')),
  'C11 private epoch and lock helpers are inaccessible to all API roles');
set local role service_role;
-- Simulate a fresh activation that has not completed the independent host canary.
reset role;
update kadmeion_private.unlisted_release_routes set verified_at=null
  where portfolio_id='10000000-0000-4000-8000-0000000000d1';
set local role service_role;
select is(
  (public.service_read_public_portfolio('release_owner','release-fixture')->>'indexable')::boolean,
  false,'unacknowledged public canary is explicitly non-indexable');
select is(
  public.service_read_public_portfolio('release_owner','release-fixture')->>'htmlSha256',
  current_setting('kd.public_fixture.sha'),
  'non-indexable canary retains the exact trusted immutable release bytes');
-- Exercise actual service-only receipt acknowledgement instead of bypassing it.
select set_config('request.jwt.claim.role','service_role',true);
select set_config('kd.public_fixture.receipt',
  public.service_read_current_public_delivery_receipt('10000000-0000-4000-8000-0000000000d1',
    '50000000-0000-4000-8000-0000000000d1')::text,true);
select is(current_setting('kd.public_fixture.receipt')::jsonb->>'storedHtmlSha256',
  current_setting('kd.public_fixture.sha'),'C11 receipt binds exact stored HTML digest');
select is(current_setting('kd.public_fixture.receipt')::jsonb->>'operationId',
  '60000000-0000-4000-8000-0000000000d1','C11 receipt binds original operation identity');
select is(current_setting('kd.public_fixture.receipt')::jsonb->'verifiedAt','null'::jsonb,
  'C11 candidate receipt does not claim successful acknowledgement');
select throws_ok($q$select public.service_acknowledge_unlisted_release(
  '10000000-0000-4000-8000-0000000000d1','50000000-0000-4000-8000-0000000000d1',
  current_setting('kd.public_fixture.sha'))$q$,'40001','UNLISTED_ACKNOWLEDGMENT_CONFLICT',
  'C11 unfenced legacy acknowledgement cannot activate PUBLIC');
-- Real SQL mutation advances the epoch without changing the immutable HTML.
reset role;
update kadmeion_private.unlisted_release_routes set updated_at=clock_timestamp()
  where portfolio_id='10000000-0000-4000-8000-0000000000d1';
set local role service_role;
select throws_ok($q$select public.service_acknowledge_public_delivery(
  current_setting('kd.public_fixture.receipt')::jsonb)$q$,'40001','PUBLIC_DELIVERY_CONFLICT',
  'C11 stale full receipt cannot acknowledge after epoch advance');
select throws_ok($q$select public.service_recover_failed_public_delivery(
  current_setting('kd.public_fixture.receipt')::jsonb)$q$,'40001','PUBLIC_DELIVERY_CONFLICT',
  'C11 stale full receipt cannot recover after epoch advance');
select set_config('kd.public_fixture.current_receipt',
  public.service_read_current_public_delivery_receipt('10000000-0000-4000-8000-0000000000d1',
    '50000000-0000-4000-8000-0000000000d1')::text,true);
select ok((current_setting('kd.public_fixture.current_receipt')::jsonb->>'deliveryEpoch')::bigint
  >(current_setting('kd.public_fixture.receipt')::jsonb->>'deliveryEpoch')::bigint,
  'C11 actual route mutation advances authoritative epoch');
select throws_ok($q$select public.service_acknowledge_public_delivery(
  current_setting('kd.public_fixture.current_receipt')::jsonb-'operationId')$q$,
  '40001','PUBLIC_DELIVERY_CONFLICT','C11 incomplete receipt cannot acknowledge');
select set_config('kd.public_fixture.ack_receipt',
  public.service_acknowledge_public_delivery(current_setting('kd.public_fixture.current_receipt')::jsonb)::text,true);
select ok((current_setting('kd.public_fixture.ack_receipt')::jsonb->>'deliveryEpoch')::bigint
  =(current_setting('kd.public_fixture.current_receipt')::jsonb->>'deliveryEpoch')::bigint+1
  and current_setting('kd.public_fixture.ack_receipt')::jsonb->>'verifiedAt' is not null,
  'C11 actual acknowledgement advances epoch exactly once and records verification time');
select is(public.service_read_current_public_delivery_receipt('10000000-0000-4000-8000-0000000000d1',
  '50000000-0000-4000-8000-0000000000d1'),current_setting('kd.public_fixture.ack_receipt')::jsonb,
  'C11 authoritative readback equals acknowledged receipt');
select throws_ok($q$select public.service_acknowledge_public_delivery(
  current_setting('kd.public_fixture.current_receipt')::jsonb)$q$,'40001','PUBLIC_DELIVERY_CONFLICT',
  'C11 prior unacknowledged receipt cannot replay as success');
select is((public.service_read_public_portfolio('release_owner','release-fixture')->>'indexable')::boolean,true,
  'C11 exact acknowledgement enables indexability');
select is(public.service_read_public_portfolio('foreign_owner','release-fixture'),
  null::jsonb,'wrong public owner handle does not return a release');
select is(public.service_read_public_portfolio('release_owner','other-fixture'),
  null::jsonb,'wrong public portfolio slug does not return a release');
select is(public.service_read_unlisted_release(
  '10000000-0000-4000-8000-0000000000d1'),null::jsonb,
  'UNLISTED resolver cannot expose an expressly PUBLIC release');


-- C13 diagnostic extension: real PostgreSQL RPCs and persisted counters on the
-- same verified C11 fixture. Transaction-local only; no hosted traffic.
reset role;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)
values('a0000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000d1',
 now(),now(),clock_timestamp()+interval '10 minutes');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) r
 cross join unnest(array['kadmeion_private.analytics_opt_in','kadmeion_private.aggregate_daily','kadmeion_private.analytics_rate_window']) t
 where has_any_column_privilege(r,t,'SELECT,INSERT,UPDATE,REFERENCES')
 or has_table_privilege(r,t,'DELETE,TRUNCATE,TRIGGER')),
 'C13 private tables deny direct access to all API roles');
select ok(not has_function_privilege('anon','public.collect_portfolio_analytics_view(uuid,uuid,bigint,bigint,bigint,text,bigint,text)','EXECUTE')
 and not has_function_privilege('authenticated','public.collect_portfolio_analytics_view(uuid,uuid,bigint,bigint,bigint,text,bigint,text)','EXECUTE')
 and has_function_privilege('service_role','public.collect_portfolio_analytics_view(uuid,uuid,bigint,bigint,bigint,text,bigint,text)','EXECUTE'),
 'C13 only trusted worker can collect');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select is(public.service_read_public_portfolio_with_analytics('release_owner','release-fixture')->'analytics','null'::jsonb,
 'C13 verified public release receives no collection receipt before opt-in');
select is(public.collect_portfolio_analytics_view(
 '10000000-0000-4000-8000-0000000000d1','50000000-0000-4000-8000-0000000000d1',1,1,
 (current_setting('kd.public_fixture.ack_receipt')::jsonb->>'deliveryEpoch')::bigint,current_setting('kd.public_fixture.sha'),1,'SEARCH')->>'status',
 'IGNORED','C13 real collector rejects pre-consent event');
reset role;
select is((select count(*) from kadmeion_private.aggregate_daily),0::bigint,'C13 no stored pre-consent aggregate');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000d1',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-0000000000d1','role','authenticated','session_id','a0000000-0000-4000-8000-0000000000d1','is_anonymous',false)::text,true);
select is(public.read_owner_analytics_state('10000000-0000-4000-8000-0000000000d1')->>'enabled','false','C13 default OFF');
select is(public.change_owner_analytics('10000000-0000-4000-8000-0000000000d1','ENABLE',0,'c1300000-0000-4000-8000-000000000001',1::smallint)->>'status','APPLIED','C13 owner opt-in persisted');
reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('kd.c13.receipt',(public.service_read_public_portfolio_with_analytics('release_owner','release-fixture')->'analytics')::text,true);
select is(current_setting('kd.c13.receipt')::jsonb->>'consentVersion','1','C13 envelope bound to current consent version');
select is(public.collect_portfolio_analytics_view(
 '10000000-0000-4000-8000-0000000000d1','50000000-0000-4000-8000-0000000000d1',1,1,
 (current_setting('kd.c13.receipt')::jsonb->>'deliveryEpoch')::bigint,current_setting('kd.public_fixture.sha'),1,'SEARCH')->>'status',
 'COUNTED','C13 exactly one real eligible RPC event');
reset role;
select is((select sum(views)::bigint from kadmeion_private.aggregate_daily),1::bigint,'C13 physical aggregate equals one');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select is((select sum((d->>'views')::integer)::bigint from jsonb_array_elements(public.read_owner_analytics(array['10000000-0000-4000-8000-0000000000d1']::uuid[],7)->'portfolios'->0->'days') d),1::bigint,'C13 seven-day real count');
select is(jsonb_array_length(public.read_owner_analytics(array['10000000-0000-4000-8000-0000000000d1']::uuid[],30)->'portfolios'->0->'days'),30,'C13 thirty-day real query');
select is(public.owner_export_portfolio_analytics_annex()->'aggregates'->0->>'views','1','C13 independent owner export includes real aggregate');
select is(public.change_owner_analytics('10000000-0000-4000-8000-0000000000d1','CLEAR',1,'c1300000-0000-4000-8000-000000000002',1::smallint)->>'version','2','C13 clear advances consent version');
reset role;
select is((select count(*) from kadmeion_private.aggregate_daily),0::bigint,'C13 clear physically deletes counts');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select is(public.collect_portfolio_analytics_view(
 '10000000-0000-4000-8000-0000000000d1','50000000-0000-4000-8000-0000000000d1',1,1,
 (current_setting('kd.c13.receipt')::jsonb->>'deliveryEpoch')::bigint,current_setting('kd.public_fixture.sha'),1,'SEARCH')->>'status',
 'IGNORED','C13 stale pre-clear consent receipt rejected');
select is(public.collect_portfolio_analytics_view(
 '10000000-0000-4000-8000-0000000000d1','50000000-0000-4000-8000-0000000000d1',1,1,
 (current_setting('kd.c13.receipt')::jsonb->>'deliveryEpoch')::bigint,current_setting('kd.public_fixture.sha'),2,'DIRECT_OR_UNKNOWN')->>'status',
 'COUNTED','C13 post-clear valid new consent collects');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select is(public.change_owner_analytics('10000000-0000-4000-8000-0000000000d1','DISABLE',2,'c1300000-0000-4000-8000-000000000003',1::smallint)->>'version','3','C13 disable advances version');
reset role;
select is((select count(*) from kadmeion_private.aggregate_daily),0::bigint,'C13 disable physically deletes counts');
-- Rollover seed tests retention maintenance, not simulated visitor metrics.
update kadmeion_private.analytics_rate_window set
 minute_start=date_trunc('day',clock_timestamp(),'UTC')-interval '1 day',
 utc_day=(clock_timestamp() at time zone 'UTC')::date-1,minute_used=1,day_used=1
 where scope_key='GLOBAL';
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select ok(public.service_purge_expired_portfolio_analytics(1000) is not null,'C13 service-only real retention purge executes');
reset role;
select ok((select day_used=0 and minute_used=0 and utc_day=(clock_timestamp() at time zone 'UTC')::date
 from kadmeion_private.analytics_rate_window where scope_key='GLOBAL'),'C13 idle GLOBAL counter physically reset at UTC rollover');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select is(public.service_read_public_portfolio_with_analytics('release_owner','release-fixture')->'analytics','null'::jsonb,
 'C13 no collection receipt after disable');
select is(public.collect_portfolio_analytics_view(
 '10000000-0000-4000-8000-0000000000d1','50000000-0000-4000-8000-0000000000d1',1,1,
 (current_setting('kd.c13.receipt')::jsonb->>'deliveryEpoch')::bigint,current_setting('kd.public_fixture.sha'),2,'SEARCH')->>'status',
 'IGNORED','C13 late disabled receipt cannot recreate aggregate');
reset role;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.role','authenticated',true);
-- End C13 extension; original C11 withdrawal tests continue unchanged.

-- Withdraw just one surface; all old immutable owner portfolio routes must
-- be disabled rather than relying on an unproven content-reference index.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',
  '00000000-0000-4000-8000-0000000000d1',true);
update public.project_exposure_intents set show_case_study=false
  where project_id='70000000-0000-4000-8000-0000000000d1';
reset role;
select is((select status from public.private_release_visibility_pointers
  where portfolio_id='10000000-0000-4000-8000-0000000000d1'),
  'BLOCKED','project privacy withdrawal blocks owner portfolio pointer');
select is((select status from kadmeion_private.unlisted_release_routes
  where portfolio_id='10000000-0000-4000-8000-0000000000d1'),
  'REVOKED','project privacy withdrawal transactionally revokes active route');
select is((select event_type from public.private_release_visibility_events
  where portfolio_id='10000000-0000-4000-8000-0000000000d1' order by created_at desc limit 1),
  'PROJECT_PRIVACY_BLOCK','privacy invalidation is audited');
select is((select revocation_generation from public.private_release_visibility_pointers
  where portfolio_id='10000000-0000-4000-8000-0000000000d1'),
  2::bigint,'privacy invalidation advances revocation generation');
set local role service_role;
select is(public.service_read_public_portfolio('release_owner','release-fixture'),
  null::jsonb,'old public HTML cannot survive changed project privacy');
select is(public.service_read_current_public_delivery_receipt('10000000-0000-4000-8000-0000000000d1',
  '50000000-0000-4000-8000-0000000000d1'),null::jsonb,
  'C11 privacy withdrawal invalidates authoritative receipt');
select throws_ok($q$select public.service_acknowledge_public_delivery(
  current_setting('kd.public_fixture.ack_receipt')::jsonb)$q$,'40001','PUBLIC_DELIVERY_CONFLICT',
  'C11 withdrawn receipt cannot acknowledge after privacy reduction');
select throws_ok($q$select public.service_recover_failed_public_delivery(
  current_setting('kd.public_fixture.ack_receipt')::jsonb)$q$,'40001','PUBLIC_DELIVERY_CONFLICT',
  'C11 withdrawn receipt cannot recover old public route');

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
-- The database must reject newly reserved application route handles even if
-- an old account happened to own one before the forward-only constraint.
do $body$
declare denied boolean:=false;
begin
  begin
    update public.profiles set handle='app'
      where user_id='00000000-0000-4000-8000-0000000000d1';
  exception when check_violation then denied:=true;
  end;
  if not denied then raise exception 'Reserved portfolio route accepted'; end if;
end $body$;
select pass('app route is reserved by the database identity constraint');
-- Source edits must revoke previously published data even if the owner does
-- not separately flip a visibility toggle. Never serve an obsolete snapshot.
reset role;
insert into kadmeion_private.profile_publications
  (user_id,handle,display_name,headline,bio)
values('00000000-0000-4000-8000-0000000000d1',
  'renamed_owner','Release Owner','Published headline','Previously public bio');
set local role service_role;
select is(public.service_read_published_profile_projection('renamed_owner')->>'bio',
  'Previously public bio','public profile projection exists only with explicit publication');
reset role;
update public.profiles set bio='Revised private biography'
  where user_id='00000000-0000-4000-8000-0000000000d1';
set local role service_role;
select is(public.service_read_published_profile_projection('renamed_owner'),
  null::jsonb,'editing a previously shared bio revokes its old public projection');
reset role;

insert into kadmeion_private.profile_publications
  (user_id,handle,display_name,headline,bio)
values('00000000-0000-4000-8000-0000000000d1',
  'renamed_owner','Release Owner','Published headline','Revised private biography');
update public.profiles set headline='New private headline'
  where user_id='00000000-0000-4000-8000-0000000000d1';
select is((select count(*)::integer from kadmeion_private.profile_publications
  where user_id='00000000-0000-4000-8000-0000000000d1'),0,
  'editing a shared headline removes the old publication');

insert into kadmeion_private.profile_publications
  (user_id,handle,display_name,headline,bio)
values('00000000-0000-4000-8000-0000000000d1',
  'renamed_owner','Release Owner','New private headline','Revised private biography');
update public.profiles set display_name='Different private name'
  where user_id='00000000-0000-4000-8000-0000000000d1';
select is((select count(*)::integer from kadmeion_private.profile_publications
  where user_id='00000000-0000-4000-8000-0000000000d1'),0,
  'editing a previously shared display name removes the old publication');

-- Case-study exposure is separate from the identity profile. Prove a
-- currently readable case study becomes unreadable immediately on source edit.
update public.project_exposure_intents set show_case_study=true
  where project_id='70000000-0000-4000-8000-0000000000d1';
insert into kadmeion_private.case_study_publications
  (project_id,owner_user_id,slug,handle,payload)
values('70000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000d1',
  'project-privacy','renamed_owner',
  '{"slug":"project-privacy","title":"Privacy Fixture","summary":"Old public summary","sections":[]}'::jsonb);
set local role service_role;
select is(public.service_read_published_case_study_projection(
  'renamed_owner','project-privacy')->>'summary','Old public summary',
  'consented case-study publication is readable before private edit');
reset role;
update public.projects set summary='Revised private project summary'
  where id='70000000-0000-4000-8000-0000000000d1';
set local role service_role;
select is(public.service_read_published_case_study_projection(
  'renamed_owner','project-privacy'),null::jsonb,
  'editing public project summary transactionally revokes old case-study bytes');
reset role;

insert into kadmeion_private.case_study_publications
  (project_id,owner_user_id,slug,handle,payload)
values('70000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000d1',
  'project-privacy','renamed_owner',
  '{"slug":"project-privacy","title":"Privacy Fixture","summary":"Revised private project summary","sections":[]}'::jsonb);
update public.projects set case_study=
  '{"sections":[{"id":"scope","kind":"challenge","title":"Changed","body":"Private content","visible":true}]}'::jsonb
  where id='70000000-0000-4000-8000-0000000000d1';
select is((select count(*)::integer from kadmeion_private.case_study_publications
  where project_id='70000000-0000-4000-8000-0000000000d1'),0,
  'editing case-study sections invalidates previously rendered public sections');

insert into kadmeion_private.case_study_publications
  (project_id,owner_user_id,slug,handle,payload)
values('70000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000d1',
  'project-privacy','renamed_owner',
  '{"slug":"project-privacy","title":"Privacy Fixture","sections":[]}'::jsonb);
update public.projects set live_url='https://example.org/updated-project'
  where id='70000000-0000-4000-8000-0000000000d1';
select is((select count(*)::integer from kadmeion_private.case_study_publications
  where project_id='70000000-0000-4000-8000-0000000000d1'),0,
  'editing a linked published project URL revokes previously published link');
select * from finish();
rollback;
