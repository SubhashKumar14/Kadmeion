-- B2/C01 mandatory candidate pgTAP: permissions and rollback-only thumbnail transactions.
-- Storage rows here are synthetic metadata; real bytes are tested separately over local HTTP.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;
select plan(45);
select has_table('public','projects','private projects table');
select has_table('public','project_exposure_intents','exposure intent table');
select has_table('public','project_assets','project assets table');
select ok((select relrowsecurity from pg_class where oid='public.projects'::regclass),'projects RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.project_exposure_intents'::regclass),'exposure intents RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.project_assets'::regclass),'assets metadata RLS enabled');
select ok(not has_table_privilege('anon','public.projects','SELECT'),'anonymous cannot list private projects');
select ok((select not public from storage.buckets where id='kadmeion-private-assets'),'asset bucket is private');
select is((select count(*)::integer from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'kd_storage_private_%'),2,'private bucket has owner read/create policies without overwrite');
-- The B16 combined candidate MUST include the migration; absent RPC/columns fail.
select has_function('public','read_private_project_thumbnail',array['uuid'],'mandatory thumbnail read exists');
select has_function('public','set_private_project_thumbnail',array['uuid','bigint','uuid','uuid'],'mandatory thumbnail CAS exists');
select has_column('public','projects','thumbnail_asset_id','mandatory thumbnail pointer exists');
select has_column('public','projects','thumbnail_operation_id','mandatory thumbnail operation exists');
select has_column('public','projects','thumbnail_operation_base_revision','mandatory thumbnail base revision exists');
select ok(coalesce(has_function_privilege('authenticated',to_regprocedure('public.read_private_project_thumbnail(uuid)'),'EXECUTE'),false),'owner thumbnail read RPC granted');
select ok(coalesce(not has_function_privilege('anon',to_regprocedure('public.read_private_project_thumbnail(uuid)'),'EXECUTE'),false),'anonymous thumbnail read denied');
select ok(coalesce(has_function_privilege('authenticated',to_regprocedure('public.set_private_project_thumbnail(uuid,bigint,uuid,uuid)'),'EXECUTE'),false),'owner CAS RPC granted');
select ok(coalesce(not has_function_privilege('anon',to_regprocedure('public.set_private_project_thumbnail(uuid,bigint,uuid,uuid)'),'EXECUTE'),false),'anonymous CAS denied');
select ok(coalesce(not has_function_privilege('service_role',to_regprocedure('public.set_private_project_thumbnail(uuid,bigint,uuid,uuid)'),'EXECUTE'),false),'service role cannot masquerade as owner CAS caller');
select ok(not has_column_privilege('authenticated','public.projects','thumbnail_asset_id','UPDATE'),'owner cannot bypass thumbnail CAS with direct update');
select ok(not has_column_privilege('authenticated','public.projects','thumbnail_operation_id','INSERT'),'owner cannot forge thumbnail operation at insert');
select ok(not has_column_privilege('authenticated','public.projects','thumbnail_operation_base_revision','UPDATE'),'owner cannot forge thumbnail base revision');

-- Each fixture is disposable and the entire file rolls back. No real bytes
-- are fabricated here. A separate local HTTP test uploads/reads actual PNG.
insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000000c01','00000000-0000-0000-0000-000000000000','authenticated','authenticated','thumb-owner@invalid.example',now(),now()),
 ('00000000-0000-4000-8000-000000000c02','00000000-0000-0000-0000-000000000000','authenticated','authenticated','thumb-other@invalid.example',now(),now());
insert into public.projects(id,owner_user_id,slug,title) values
 ('10000000-0000-4000-8000-000000000c01','00000000-0000-4000-8000-000000000c01','thumb-primary','Thumbnail primary'),
 ('10000000-0000-4000-8000-000000000c02','00000000-0000-4000-8000-000000000c01','thumb-sibling','Thumbnail sibling'),
 ('10000000-0000-4000-8000-000000000c03','00000000-0000-4000-8000-000000000c02','thumb-foreign','Thumbnail foreign');
insert into storage.objects(bucket_id,name,owner_id,metadata) values
 ('kadmeion-private-assets','00000000-0000-4000-8000-000000000c01/10000000-0000-4000-8000-000000000c01/20000000-0000-4000-8000-000000000c01.png','00000000-0000-4000-8000-000000000c01','{"size":512,"mimetype":"image/png"}'),
 ('kadmeion-private-assets','00000000-0000-4000-8000-000000000c01/10000000-0000-4000-8000-000000000c01/20000000-0000-4000-8000-000000000c02.png','00000000-0000-4000-8000-000000000c01','{"size":512,"mimetype":"image/png"}'),
 ('kadmeion-private-assets','00000000-0000-4000-8000-000000000c01/10000000-0000-4000-8000-000000000c02/20000000-0000-4000-8000-000000000c03.png','00000000-0000-4000-8000-000000000c01','{"size":512,"mimetype":"image/png"}'),
 ('kadmeion-private-assets','00000000-0000-4000-8000-000000000c02/10000000-0000-4000-8000-000000000c03/20000000-0000-4000-8000-000000000c04.png','00000000-0000-4000-8000-000000000c02','{"size":512,"mimetype":"image/png"}');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000c01',true);
select set_config('test.c01_asset',(public.register_private_project_image(
 '10000000-0000-4000-8000-000000000c01','00000000-0000-4000-8000-000000000c01/10000000-0000-4000-8000-000000000c01/20000000-0000-4000-8000-000000000c01.png','image/png',512,'First cover')->>'id'),true);
select set_config('test.c01_replacement',(public.register_private_project_image(
 '10000000-0000-4000-8000-000000000c01','00000000-0000-4000-8000-000000000c01/10000000-0000-4000-8000-000000000c01/20000000-0000-4000-8000-000000000c02.png','image/png',512,'Replacement cover')->>'id'),true);
select set_config('test.c01_sibling',(public.register_private_project_image(
 '10000000-0000-4000-8000-000000000c02','00000000-0000-4000-8000-000000000c01/10000000-0000-4000-8000-000000000c02/20000000-0000-4000-8000-000000000c03.png','image/png',512,'Sibling cover')->>'id'),true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000c02',true);
select set_config('test.c01_foreign',(public.register_private_project_image(
 '10000000-0000-4000-8000-000000000c03','00000000-0000-4000-8000-000000000c02/10000000-0000-4000-8000-000000000c03/20000000-0000-4000-8000-000000000c04.png','image/png',512,'Foreign cover')->>'id'),true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000c01',true);
select is(public.read_private_project_thumbnail('10000000-0000-4000-8000-000000000c01')->'asset','null'::jsonb,'owner initially has no thumbnail');
select set_config('test.c01_first_receipt',public.set_private_project_thumbnail(
 '10000000-0000-4000-8000-000000000c01',0,current_setting('test.c01_asset')::uuid,'30000000-0000-4000-8000-000000000c01')::text,true);
select is(current_setting('test.c01_first_receipt')::jsonb->>'revision','1','attachment advances revision once');
select is(current_setting('test.c01_first_receipt')::jsonb->'asset'->>'id',current_setting('test.c01_asset'),'attachment returns exact registered asset');
select is(current_setting('test.c01_first_receipt')::jsonb->>'publicDeliveryAllowed','false','thumbnail cannot enable public delivery');
select is(public.set_private_project_thumbnail('10000000-0000-4000-8000-000000000c01',0,current_setting('test.c01_asset')::uuid,'30000000-0000-4000-8000-000000000c01'),
 current_setting('test.c01_first_receipt')::jsonb,'exact operation replay returns unchanged receipt');
select throws_ok($sql$select public.set_private_project_thumbnail('10000000-0000-4000-8000-000000000c01',0,current_setting('test.c01_replacement')::uuid,'30000000-0000-4000-8000-000000000c01')$sql$,'40001','THUMBNAIL_OPERATION_CONFLICT','same operation with changed input conflicts');
select throws_ok($sql$select public.set_private_project_thumbnail('10000000-0000-4000-8000-000000000c01',0,current_setting('test.c01_replacement')::uuid,'30000000-0000-4000-8000-000000000c02')$sql$,'40001','REVISION_CONFLICT','stale revision cannot replace saved thumbnail');
select throws_ok($sql$select public.set_private_project_thumbnail('10000000-0000-4000-8000-000000000c01',1,current_setting('test.c01_sibling')::uuid,'30000000-0000-4000-8000-000000000c02')$sql$,'42501','PRIVATE_ASSET_NOT_FOUND','same owner other project asset cannot attach');
select throws_ok($sql$select public.set_private_project_thumbnail('10000000-0000-4000-8000-000000000c01',1,current_setting('test.c01_foreign')::uuid,'30000000-0000-4000-8000-000000000c02')$sql$,'42501','PRIVATE_ASSET_NOT_FOUND','foreign owner asset cannot attach');
select is(public.read_private_project_thumbnail('10000000-0000-4000-8000-000000000c01'),current_setting('test.c01_first_receipt')::jsonb,'failed CAS and scope checks preserve old cover and revision');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000c02',true);
select throws_ok($sql$select public.read_private_project_thumbnail('10000000-0000-4000-8000-000000000c01')$sql$,'42501','PRIVATE_PROJECT_NOT_FOUND','foreign cannot read owner thumbnail');
select throws_ok($sql$select public.set_private_project_thumbnail('10000000-0000-4000-8000-000000000c01',1,null,'30000000-0000-4000-8000-000000000c02')$sql$,'42501','PRIVATE_PROJECT_NOT_FOUND','foreign cannot detach owner thumbnail');
reset role;
-- Simulate damaged storage metadata on the replacement only.
update storage.objects set metadata='{"size":513,"mimetype":"image/png"}'
 where bucket_id='kadmeion-private-assets' and name='00000000-0000-4000-8000-000000000c01/10000000-0000-4000-8000-000000000c01/20000000-0000-4000-8000-000000000c02.png';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000c01',true);
select throws_ok($sql$select public.set_private_project_thumbnail('10000000-0000-4000-8000-000000000c01',1,current_setting('test.c01_replacement')::uuid,'30000000-0000-4000-8000-000000000c03')$sql$,'22023','PRIVATE_THUMBNAIL_UNAVAILABLE','size mismatch rejects attachment and rolls back');
select is(public.read_private_project_thumbnail('10000000-0000-4000-8000-000000000c01'),current_setting('test.c01_first_receipt')::jsonb,'size failure leaves previous cover intact');
reset role;
update storage.objects set metadata='{"size":512,"mimetype":"image/jpeg"}'
 where bucket_id='kadmeion-private-assets' and name='00000000-0000-4000-8000-000000000c01/10000000-0000-4000-8000-000000000c01/20000000-0000-4000-8000-000000000c02.png';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000c01',true);
select throws_ok($sql$select public.set_private_project_thumbnail('10000000-0000-4000-8000-000000000c01',1,current_setting('test.c01_replacement')::uuid,'30000000-0000-4000-8000-000000000c03')$sql$,'22023','PRIVATE_THUMBNAIL_UNAVAILABLE','MIME mismatch rejects attachment and rolls back');
select is(public.read_private_project_thumbnail('10000000-0000-4000-8000-000000000c01'),current_setting('test.c01_first_receipt')::jsonb,'MIME failure leaves previous cover intact');
reset role;
update storage.objects set metadata='{"size":512,"mimetype":"image/png"}'
 where bucket_id='kadmeion-private-assets' and name='00000000-0000-4000-8000-000000000c01/10000000-0000-4000-8000-000000000c01/20000000-0000-4000-8000-000000000c02.png';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000c01',true);
select set_config('test.c01_replaced',public.set_private_project_thumbnail('10000000-0000-4000-8000-000000000c01',1,current_setting('test.c01_replacement')::uuid,'30000000-0000-4000-8000-000000000c03')::text,true);
select is(current_setting('test.c01_replaced')::jsonb->>'revision','2','valid replacement advances once after failed attempts');
select is(current_setting('test.c01_replaced')::jsonb->'asset'->>'id',current_setting('test.c01_replacement'),'valid replacement selects new asset');
select throws_ok($sql$select public.set_private_project_thumbnail('10000000-0000-4000-8000-000000000c01',0,current_setting('test.c01_asset')::uuid,'30000000-0000-4000-8000-000000000c01')$sql$,'40001','REVISION_CONFLICT','superseded operation cannot resurrect old cover');
select set_config('test.c01_detached',public.set_private_project_thumbnail('10000000-0000-4000-8000-000000000c01',2,null,'30000000-0000-4000-8000-000000000c04')::text,true);
select is(current_setting('test.c01_detached')::jsonb->>'revision','3','detach advances exactly once');
select is(current_setting('test.c01_detached')::jsonb->'asset','null'::jsonb,'detach clears thumbnail');
select is(public.set_private_project_thumbnail('10000000-0000-4000-8000-000000000c01',2,null,'30000000-0000-4000-8000-000000000c04'),current_setting('test.c01_detached')::jsonb,'detach replay is idempotent');
select is((select count(*) from public.project_assets where project_id='10000000-0000-4000-8000-000000000c01'),2::bigint,'detach never deletes registered assets');
reset role;
select * from finish();
rollback;
