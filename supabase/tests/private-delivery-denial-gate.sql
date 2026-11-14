-- B4 server-only route/asset denial and revocation fence tests, ephemeral DB.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select * from no_plan();
select has_function('kadmeion_private','private_delivery_denial_gate',
  array['uuid','text','text','text','text'],'private denial RPC exists');
select ok(not has_function_privilege('anon',
  'kadmeion_private.private_delivery_denial_gate(uuid,text,text,text,text)','EXECUTE'),
  'anon cannot execute privileged denial RPC');
select ok(not has_function_privilege('authenticated',
  'kadmeion_private.private_delivery_denial_gate(uuid,text,text,text,text)','EXECUTE'),
  'authenticated owner cannot execute privileged denial RPC');
select ok(has_function_privilege('service_role',
  'kadmeion_private.private_delivery_denial_gate(uuid,text,text,text,text)','EXECUTE'),
  'server service role may request denial only');
select ok((select not public from storage.buckets
    where id='kadmeion-private-assets'),'private owner asset bucket remains non-public');
insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values(
  '00000000-0000-4000-8000-0000000000b1',
  '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'delivery-deny@invalid.example',now(),now());
insert into public.portfolios(id,owner_user_id,slug,title,template_id,head_revision)
  values('10000000-0000-4000-8000-0000000000b1',
    '00000000-0000-4000-8000-0000000000b1','denial-test','Denial Test','starter',1);
insert into public.portfolio_revisions(
  portfolio_id,owner_user_id,revision,base_revision,operation_id,snapshot,snapshot_sha256
) values('10000000-0000-4000-8000-0000000000b1',
  '00000000-0000-4000-8000-0000000000b1',1,0,
  '20000000-0000-4000-8000-0000000000b1',
  '{"formatVersion":1,"files":{},"slots":{},"stashes":{}}'::jsonb,
  encode(sha256(convert_to('{"formatVersion":1,"files":{},"slots":{},"stashes":{}}'::jsonb::text,'UTF8')),'hex'));
insert into public.private_release_requests(
  id,portfolio_id,owner_user_id,operation_id,revision,snapshot_sha256,visibility_intent)
  select '30000000-0000-4000-8000-0000000000b1',
    portfolio_id,owner_user_id,'40000000-0000-4000-8000-0000000000b1',
    1,snapshot_sha256,'PUBLIC'
  from public.portfolio_revisions
  where portfolio_id='10000000-0000-4000-8000-0000000000b1';
insert into public.private_release_visibility_pointers(
  portfolio_id,owner_user_id,status,candidate_request_id,
  candidate_manifest_sha256,generation,revocation_generation
) values('10000000-0000-4000-8000-0000000000b1',
  '00000000-0000-4000-8000-0000000000b1','PREPARED_PRIVATE',
  '30000000-0000-4000-8000-0000000000b1',repeat('a',64),1,0);

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000b1',true);
do $tag$
declare denied boolean:=false;
begin
  begin
    perform kadmeion_private.private_delivery_denial_gate(
      '10000000-0000-4000-8000-0000000000b1','CANONICAL_HTML');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Owner invoked restricted gate';end if;
end $tag$;
select pass('owner cannot read server-only gate');
reset role;
set local role service_role;
select is(kadmeion_private.private_delivery_denial_gate(
  '10000000-0000-4000-8000-0000000000b1','CANONICAL_HTML'
  )->>'status','DENY','prepared private canonical page denied');
select is(kadmeion_private.private_delivery_denial_gate(
  '10000000-0000-4000-8000-0000000000b1','CANONICAL_HTML'
  )->>'reason','NO_VERIFIED_PUBLIC_RELEASE','owner candidate does not authorize release');
select is((kadmeion_private.private_delivery_denial_gate(
  '10000000-0000-4000-8000-0000000000b1','CANONICAL_HTML'
  )->>'generation')::bigint,1::bigint,'server reads current generation');
select is(kadmeion_private.private_delivery_denial_gate(
  '10000000-0000-4000-8000-0000000000b1','DIRECT_ASSET',
  repeat('a',64),'assets/'||repeat('b',64)||'.png',repeat('b',64)
  )->>'status','DENY','direct private immutable asset denied');
select is(kadmeion_private.private_delivery_denial_gate(
  '10000000-0000-4000-8000-0000000000b1','DIRECT_ASSET',
  repeat('a',64),'assets/'||repeat('b',64)||'.svg',repeat('b',64)
  )->>'reason','INVALID_REQUEST','SVG active asset rejected');
select is(kadmeion_private.private_delivery_denial_gate(
  '10000000-0000-4000-8000-0000000000b1','DIRECT_ASSET',
  repeat('a',64),'assets/'||repeat('b',64)||'.png',repeat('a',64)
  )->>'reason','INVALID_REQUEST','mismatched direct asset checksum rejected');
select is(kadmeion_private.private_delivery_denial_gate(
  '90000000-0000-4000-8000-0000000000b1','CANONICAL_HTML'
  )->>'status','DENY','unknown portfolio does not resolve');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000b1',true);
select is(public.owner_block_private_release_pointer(
  '10000000-0000-4000-8000-0000000000b1',
  '50000000-0000-4000-8000-0000000000b1')->>'status',
  'BLOCKED','owner can block candidate atomically');
reset role;
set local role service_role;
select is(kadmeion_private.private_delivery_denial_gate(
  '10000000-0000-4000-8000-0000000000b1','CANONICAL_HTML'
  )->>'reason','PRIVATE_POINTER_BLOCKED','canonical next read sees revocation');
select is((kadmeion_private.private_delivery_denial_gate(
  '10000000-0000-4000-8000-0000000000b1','CANONICAL_HTML'
  )->>'revocationGeneration')::bigint,2::bigint,'revocation generation advances');
select is(kadmeion_private.private_delivery_denial_gate(
  '10000000-0000-4000-8000-0000000000b1','DIRECT_ASSET',
  repeat('a',64),'assets/'||repeat('b',64)||'.png',repeat('b',64)
  )->>'reason','PRIVATE_POINTER_BLOCKED','direct asset next read sees revocation');
select is(kadmeion_private.private_delivery_denial_gate(
  '10000000-0000-4000-8000-0000000000b1','CANONICAL_HTML'
  )->>'servingAllowed','false','server gate cannot return HTTP allow');
select is(kadmeion_private.private_delivery_denial_gate(
  '10000000-0000-4000-8000-0000000000b1','CANONICAL_HTML'
  )->>'hostRevocationVerified','false','DB intent is not host revocation proof');
select * from finish();
rollback;
