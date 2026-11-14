-- B4: owner-private pointer and block state; NOT a public delivery or CDN test.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select * from no_plan();

select has_table('public','private_release_visibility_pointers','private pointer table exists');
select has_table('public','private_release_visibility_events','private pointer audit exists');
select ok((select relrowsecurity from pg_class where oid='public.private_release_visibility_pointers'::regclass),
  'pointer uses RLS');
select ok((select relrowsecurity from pg_class where oid='public.private_release_visibility_events'::regclass),
  'audit uses RLS');
select ok(not has_table_privilege('anon','public.private_release_visibility_pointers','SELECT'),
  'anonymous cannot read private pointer');
select ok(not has_table_privilege('authenticated','public.private_release_visibility_pointers','INSERT'),
  'client cannot forge pointer');
select ok(not has_table_privilege('authenticated','public.private_release_visibility_pointers','UPDATE'),
  'client cannot activate pointer');
select ok(not has_table_privilege('authenticated','public.private_release_visibility_pointers','DELETE'),
  'client cannot erase pointer');
select ok(has_table_privilege('authenticated','public.private_release_visibility_pointers','SELECT'),
  'owner may read own pointer under RLS');
select ok(not has_table_privilege('authenticated','public.private_release_visibility_events','INSERT'),
  'client cannot forge audit');
select ok(not has_table_privilege('authenticated','public.private_release_visibility_events','UPDATE'),
  'client cannot rewrite audit');
select ok(not has_function_privilege('anon',
  'public.owner_prepare_private_release_pointer(uuid,uuid,text,bigint,uuid)','EXECUTE'),
  'anonymous cannot prepare');
select ok(not has_function_privilege('anon',
  'public.owner_block_private_release_pointer(uuid,uuid)','EXECUTE'),
  'anonymous cannot block');
select ok(not has_function_privilege('anon',
  'public.owner_read_private_release_pointer(uuid)','EXECUTE'),
  'anonymous cannot read RPC');
select ok(has_function_privilege('authenticated',
  'public.owner_prepare_private_release_pointer(uuid,uuid,text,bigint,uuid)','EXECUTE'),
  'authenticated owner can prepare');
select ok(has_function_privilege('authenticated',
  'public.owner_block_private_release_pointer(uuid,uuid)','EXECUTE'),
  'authenticated owner can block');

insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','pointer-a@invalid.example',now(),now()),
 ('00000000-0000-4000-8000-0000000000a2','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','pointer-b@invalid.example',now(),now());
insert into public.portfolios(id,owner_user_id,slug,title,template_id,head_revision) values
 ('10000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a1',
  'pointer-fixture','Pointer Fixture','starter',1);
insert into public.portfolio_revisions(
  portfolio_id,owner_user_id,revision,base_revision,operation_id,snapshot,snapshot_sha256
) values (
  '10000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a1',1,0,
  '20000000-0000-4000-8000-0000000000a1',
  '{"formatVersion":1,"files":{},"slots":{},"stashes":{}}'::jsonb,
  encode(sha256(convert_to('{"formatVersion":1,"files":{},"slots":{},"stashes":{}}'::jsonb::text,'UTF8')),'hex')
);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a1',true);

select is(public.owner_read_private_release_pointer(
  '10000000-0000-4000-8000-0000000000a1')->>'status','BLOCKED',
  'absent pointer is blocked');
select is((public.owner_read_private_release_pointer(
  '10000000-0000-4000-8000-0000000000a1')->>'generation')::bigint,0::bigint,
  'absent pointer starts at generation zero');

select is(public.freeze_private_release_request(
  '10000000-0000-4000-8000-0000000000a1',
  '30000000-0000-4000-8000-0000000000a1',1,'PUBLIC')->>'status','FROZEN',
  'owner frozen revision is private');
select set_config('kd.pointer.request',
  (select id::text from public.private_release_requests
   where portfolio_id='10000000-0000-4000-8000-0000000000a1'),true);

select is(public.owner_prepare_private_release_pointer(
  '10000000-0000-4000-8000-0000000000a1',current_setting('kd.pointer.request')::uuid,
  repeat('a',64),0,'40000000-0000-4000-8000-0000000000a1')->>'status',
  'PREPARED_PRIVATE','owner can prepare private candidate');
select is(public.owner_read_private_release_pointer(
  '10000000-0000-4000-8000-0000000000a1')->>'publicServingEnabled',
  'false','prepared candidate is never public');
select is((public.owner_read_private_release_pointer(
  '10000000-0000-4000-8000-0000000000a1')->>'generation')::bigint,1::bigint,
  'first prepare advances generation');
select is(public.owner_prepare_private_release_pointer(
  '10000000-0000-4000-8000-0000000000a1',current_setting('kd.pointer.request')::uuid,
  repeat('a',64),0,'40000000-0000-4000-8000-0000000000a1')->>'alreadyRecorded',
  'true','same operation is idempotent');
do $$
declare v_rejected boolean:=false;
begin
  begin
    perform public.owner_prepare_private_release_pointer(
      '10000000-0000-4000-8000-0000000000a1',current_setting('kd.pointer.request')::uuid,
      repeat('b',64),0,'40000000-0000-4000-8000-0000000000a1');
  exception when unique_violation then v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Operation ID reuse was accepted'; end if;
end $$;
select pass('operation ID cannot be reused with a different manifest');
do $$
declare v_rejected boolean:=false;
begin
  begin
    perform public.owner_prepare_private_release_pointer(
      '10000000-0000-4000-8000-0000000000a1',current_setting('kd.pointer.request')::uuid,
      repeat('a',64),0,'40000000-0000-4000-8000-0000000000a2');
  exception when serialization_failure then v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Stale generation was accepted'; end if;
end $$;
select pass('stale expected generation cannot replace candidate');
do $$
declare v_rejected boolean:=false;
begin
  begin
    perform public.owner_prepare_private_release_pointer(
      '10000000-0000-4000-8000-0000000000a1',current_setting('kd.pointer.request')::uuid,
      'not-a-digest',1,'40000000-0000-4000-8000-0000000000a3');
  exception when invalid_parameter_value then v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Invalid digest was accepted'; end if;
end $$;
select pass('malformed candidate manifest digest rejected');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a2',true);
select is((select count(*) from public.private_release_visibility_pointers),0::bigint,
  'cross-owner direct read sees no pointer');
select is((select count(*) from public.private_release_visibility_events),0::bigint,
  'cross-owner direct read sees no audit');
do $$
declare v_rejected boolean:=false;
begin
  begin
    perform public.owner_read_private_release_pointer('10000000-0000-4000-8000-0000000000a1');
  exception when insufficient_privilege then v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Cross-owner read accepted'; end if;
end $$;
select pass('cross-owner RPC read rejected');
do $$
declare v_rejected boolean:=false;
begin
  begin
    perform public.owner_prepare_private_release_pointer(
      '10000000-0000-4000-8000-0000000000a1',current_setting('kd.pointer.request')::uuid,
      repeat('a',64),1,'40000000-0000-4000-8000-0000000000a4');
  exception when insufficient_privilege then v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Cross-owner prepare accepted'; end if;
end $$;
select pass('cross-owner prepare rejected');
do $$
declare v_rejected boolean:=false;
begin
  begin
    perform public.owner_block_private_release_pointer(
      '10000000-0000-4000-8000-0000000000a1',
      '50000000-0000-4000-8000-0000000000a1');
  exception when insufficient_privilege then v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Cross-owner block accepted'; end if;
end $$;
select pass('cross-owner block rejected');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a1',true);
select is(public.owner_block_private_release_pointer(
  '10000000-0000-4000-8000-0000000000a1',
  '50000000-0000-4000-8000-0000000000a1')->>'status',
  'BLOCKED','owner can block candidate');
select is((public.owner_read_private_release_pointer(
  '10000000-0000-4000-8000-0000000000a1')->>'revocationGeneration')::bigint,2::bigint,
  'block advances revocation generation');
select ok(public.owner_read_private_release_pointer(
  '10000000-0000-4000-8000-0000000000a1')->'candidateRequestId'='null'::jsonb,
  'block clears candidate request');
select is(public.owner_block_private_release_pointer(
  '10000000-0000-4000-8000-0000000000a1',
  '50000000-0000-4000-8000-0000000000a1')->>'stillBlocked',
  'true','idempotent block confirms current state');

do $body$
declare v_rejected boolean:=false;
begin
  begin
    perform public.owner_prepare_private_release_pointer(
      '10000000-0000-4000-8000-0000000000a1',current_setting('kd.pointer.request')::uuid,
      repeat('a',64),0,'40000000-0000-4000-8000-0000000000a1');
  exception when serialization_failure then v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Stale prepare replay claimed an active candidate'; end if;
end $body$;
select pass('old prepare receipt cannot claim success after a block');

select is((public.owner_prepare_private_release_pointer(
  '10000000-0000-4000-8000-0000000000a1',current_setting('kd.pointer.request')::uuid,
  repeat('a',64),2,'40000000-0000-4000-8000-0000000000a5')->>'generation')::bigint,
  3::bigint,'new private prepare requires latest generation');
select is(public.owner_block_private_release_pointer(
  '10000000-0000-4000-8000-0000000000a1',
  '50000000-0000-4000-8000-0000000000a1')->>'stillBlocked',
  'false','replayed old block does not falsely acknowledge new candidate');

reset role;
update public.portfolios set trashed_at=transaction_timestamp()
  where id='10000000-0000-4000-8000-0000000000a1';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a1',true);
select is(public.owner_read_private_release_pointer(
  '10000000-0000-4000-8000-0000000000a1')->>'status','BLOCKED',
  'Trash atomically blocks prepared candidate');
select is((public.owner_read_private_release_pointer(
  '10000000-0000-4000-8000-0000000000a1')->>'revocationGeneration')::bigint,
  4::bigint,'Trash increments revocation generation');
select is((select count(*) from public.private_release_visibility_events
  where event_type='TRASH_BLOCK'),1::bigint,'Trash records an audit event');
reset role;
update public.portfolios set trashed_at=null
  where id='10000000-0000-4000-8000-0000000000a1';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a1',true);
select is(public.owner_read_private_release_pointer(
  '10000000-0000-4000-8000-0000000000a1')->>'status','BLOCKED',
  'restore does not reactivate candidate');

select * from finish();
rollback;
