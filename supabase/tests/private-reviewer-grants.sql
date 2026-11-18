-- B4 reviewer grants: only owner can manage; only service role can check raw token.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public,extensions;
select plan(20);
select has_table('public','private_reviewer_grants','review grant registry exists');
select ok((select relrowsecurity from pg_class where oid='public.private_reviewer_grants'::regclass),
  'review grant registry has RLS');
select ok(not has_table_privilege('anon','public.private_reviewer_grants','SELECT'),'anonymous cannot read metadata');
select ok(not has_table_privilege('authenticated','public.private_reviewer_grants','INSERT'),'owners cannot forge hashes');
select ok(not has_table_privilege('authenticated','public.private_reviewer_grants','UPDATE'),'owners cannot alter expiry directly');
select ok(not has_column_privilege('authenticated','public.private_reviewer_grants','token_sha256','SELECT'),
  'token digest hidden from browser');
select ok(has_function_privilege('authenticated','public.issue_private_reviewer_grant(uuid,uuid,integer)','EXECUTE'),
  'owner can register a private grant');
select ok(not has_function_privilege('anon','public.issue_private_reviewer_grant(uuid,uuid,integer)','EXECUTE'),
  'anonymous cannot issue private grants');
select ok(not has_function_privilege('authenticated','kadmeion_private.reviewer_grant_active(uuid,text)','EXECUTE'),
  'review-token checker is not callable by user JWT');
select ok(has_function_privilege('service_role','kadmeion_private.reviewer_grant_active(uuid,text)','EXECUTE'),
  'service role alone can check token');

insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','review-owner-a@invalid.example',now(),now()),
 ('00000000-0000-4000-8000-0000000000a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','review-owner-b@invalid.example',now(),now());
-- Transaction-local session records model PostgREST authenticated claims.
-- The separate local HTTP test exercises actual signed GoTrue password JWTs.
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values
 ('a0000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a1',now(),now(),clock_timestamp()+interval '10 minutes'),
 ('a0000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-0000000000a2',now(),now(),clock_timestamp()+interval '10 minutes');
insert into public.portfolios(id,owner_user_id,slug,title,template_id) values
 ('10000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a1','private-review','Private review','starter');
insert into public.private_release_requests(
  id,portfolio_id,owner_user_id,operation_id,revision,snapshot_sha256,visibility_intent
) values (
 '20000000-0000-4000-8000-0000000000a1',
 '10000000-0000-4000-8000-0000000000a1',
 '00000000-0000-4000-8000-0000000000a1',
 '30000000-0000-4000-8000-0000000000a1',
 1,repeat('a',64),'PUBLIC'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a1',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-0000000000a1','role','authenticated','session_id','a0000000-0000-4000-8000-0000000000a1','is_anonymous',false)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-0000000000a1','role','authenticated','is_anonymous',false)::text,true);
select throws_ok('select public.owner_read_account_sharing_restriction()','42501','LIVE_SESSION_REQUIRED','C14 missing session denied');
select set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-0000000000a1','role','authenticated','session_id','a0000000-0000-4000-8000-0000000000a1','is_anonymous',false)::text,true);
do $$
declare r jsonb; again jsonb;
begin
  r:=public.issue_private_reviewer_grant(
    '20000000-0000-4000-8000-0000000000a1','40000000-0000-4000-8000-0000000000a1',60);
  if r->>'status'<>'REGISTERED_UNSERVABLE' or length(r->>'rawToken')<>64 then
    raise exception 'Private review registration failed'; end if;
  perform set_config('kadmeion.review_token',r->>'rawToken',true);
  perform set_config('kadmeion.review_grant_id',r->>'grantId',true);
  again:=public.issue_private_reviewer_grant(
    '20000000-0000-4000-8000-0000000000a1','40000000-0000-4000-8000-0000000000a1',60);
  if again->>'grantId' <> r->>'grantId' or
     again->'rawToken'<>'null'::jsonb or again->>'alreadyRegistered'<>'true' then
    raise exception 'Token leaked on idempotent retry'; end if;
end $$;
select pass('Cryptographic token issued only once, duplicate operation hides raw token');
select is((select count(*) from public.private_reviewer_grants),1::bigint,
  'owner sees own private grant metadata');

set local role service_role;
select ok(kadmeion_private.reviewer_grant_active(
  current_setting('kadmeion.review_grant_id')::uuid,current_setting('kadmeion.review_token')),
  'valid private token accepted by trusted service role');
select ok(not kadmeion_private.reviewer_grant_active(
  current_setting('kadmeion.review_grant_id')::uuid,repeat('b',64)),
  'invalid token is rejected');
select ok((select token_sha256<>current_setting('kadmeion.review_token')
  from public.private_reviewer_grants where id=current_setting('kadmeion.review_grant_id')::uuid),
  'raw reviewer token is never stored');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a2',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-0000000000a2','role','authenticated','session_id','a0000000-0000-4000-8000-0000000000a2','is_anonymous',false)::text,true);
select is((select count(*) from public.private_reviewer_grants),0::bigint,
  'other signed-in user cannot read grant metadata');
do $$
declare rejected boolean:=false;
begin
  begin
    perform public.revoke_private_reviewer_grant(current_setting('kadmeion.review_grant_id')::uuid);
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Cross-owner token revocation succeeded'; end if;
end $$;
select pass('Other user cannot revoke owner grant');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a1',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-0000000000a1','role','authenticated','session_id','a0000000-0000-4000-8000-0000000000a1','is_anonymous',false)::text,true);
select is(public.revoke_private_reviewer_grant(current_setting('kadmeion.review_grant_id')::uuid)->>'status',
  'REVOKED','owner can revoke grant without claiming public host revocation');
set local role service_role;
select ok(not kadmeion_private.reviewer_grant_active(
  current_setting('kadmeion.review_grant_id')::uuid,current_setting('kadmeion.review_token')),
  'revoked token immediately fails database check');
select * from finish();
rollback;
