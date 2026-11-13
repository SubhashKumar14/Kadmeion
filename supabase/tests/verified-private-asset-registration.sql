-- Real ownership checks for metadata <-> private Storage object association.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;
select plan(5);
select ok(not has_table_privilege('authenticated','public.project_assets','INSERT'),
  'clients cannot register unverified asset metadata directly');
select ok(has_function_privilege('authenticated','public.register_private_project_image(uuid,text,text,bigint,text)','EXECUTE'),
  'owners may register assets via verified RPC');
select ok(not has_function_privilege('anon','public.register_private_project_image(uuid,text,text,bigint,text)','EXECUTE'),
  'anonymous registration is prohibited');
select ok((select relrowsecurity from pg_class where oid='public.project_assets'::regclass),
  'RLS remains enabled on asset records');

insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-0000000000f1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','asset-one@invalid.example',now(),now()),
 ('00000000-0000-4000-8000-0000000000f2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','asset-two@invalid.example',now(),now());
insert into public.projects(id,owner_user_id,slug,title) values
 ('10000000-0000-4000-8000-0000000000f1','00000000-0000-4000-8000-0000000000f1','private-one','Private One'),
 ('10000000-0000-4000-8000-0000000000f2','00000000-0000-4000-8000-0000000000f2','private-two','Private Two');

insert into storage.objects(bucket_id,name,owner_id,metadata) values
 ('kadmeion-private-assets','00000000-0000-4000-8000-0000000000f1/asset1/cover.png',
  '00000000-0000-4000-8000-0000000000f1','{"size":512,"mimetype":"image/png"}'::jsonb);

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000f1',true);
do $$
declare v jsonb; v2 jsonb; refused boolean:=false;
begin
  begin
    perform public.register_private_project_image(
      '10000000-0000-4000-8000-0000000000f1',
      '00000000-0000-4000-8000-0000000000f1/asset2/missing.png',
      'image/png',512,'Missing');
  exception when invalid_parameter_value then refused:=true; end;
  if not refused then raise exception 'Missing storage object was registered'; end if;

  v:=public.register_private_project_image(
    '10000000-0000-4000-8000-0000000000f1',
    '00000000-0000-4000-8000-0000000000f1/asset1/cover.png',
    'image/png',512,'Cover');
  if v->>'verified'<>'true' then raise exception 'Valid upload not verified'; end if;
  v2:=public.register_private_project_image(
    '10000000-0000-4000-8000-0000000000f1',
    '00000000-0000-4000-8000-0000000000f1/asset1/cover.png',
    'image/png',512,'Cover');
  if v->>'id'<>v2->>'id' then raise exception 'Repeat association created duplicate'; end if;
  refused:=false;
  begin
    perform public.register_private_project_image(
      '10000000-0000-4000-8000-0000000000f1',
      '00000000-0000-4000-8000-0000000000f1/asset1/cover.png',
      'image/jpeg',512,'Spoofed MIME');
  exception when invalid_parameter_value then refused:=true; end;
  if not refused then raise exception 'Wrong MIME accepted'; end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000f2',true);
do $$
declare refused boolean:=false;
begin
  if (select count(*) from public.project_assets)<>0 then
    raise exception 'Other user can read private asset metadata'; end if;
  begin
    perform public.register_private_project_image(
      '10000000-0000-4000-8000-0000000000f2',
      '00000000-0000-4000-8000-0000000000f1/asset1/cover.png',
      'image/png',512,'Stolen');
  exception when invalid_parameter_value then refused:=true; end;
  if not refused then raise exception 'Cross-owner asset reuse accepted'; end if;
end $$;
reset role;
select pass('Verified object registration works once, rejects missing/MIME-spoofed/foreign objects and preserves owner isolation');
select * from finish();
rollback;
