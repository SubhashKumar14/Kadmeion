-- Harden editor transaction file path allowlist and snapshot structure.
CREATE OR REPLACE FUNCTION public.commit_portfolio_revision(p_portfolio_id uuid, p_operation_id uuid, p_base_revision bigint, p_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid := (select auth.uid());
  v_head bigint;
  v_existing public.portfolio_revisions%rowtype;
  v_hash text;
  v_entry record;
  v_next bigint;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if p_operation_id is null or p_portfolio_id is null or p_base_revision is null or p_base_revision<0
    or p_snapshot is null or jsonb_typeof(p_snapshot)<>'object'
    or p_snapshot->>'formatVersion'<>'1'
    or jsonb_typeof(p_snapshot->'files')<>'object'
    or jsonb_typeof(p_snapshot->'slots')<>'object'
    or jsonb_typeof(p_snapshot->'stashes')<>'object'
    or octet_length(p_snapshot::text)>1048576
    or (select count(*) from jsonb_object_keys(p_snapshot->'files'))>100
  then raise exception using errcode='22023',message='INVALID_EDITOR_SNAPSHOT'; end if;
  for v_entry in select key,value from jsonb_each(p_snapshot->'files') loop
    if v_entry.key !~ '^[a-zA-Z0-9_./-]+$'
       or position('..' in v_entry.key)>0
       or left(v_entry.key,1)='/'
       or not (
         v_entry.key in ('kadmeion.json','kadmeion.lock.json','theme/tokens.json')
         or v_entry.key ~ '^pages/[a-z0-9_-]{1,64}[.]page[.]json$'
         or v_entry.key ~ '^content/[a-z0-9_-]{1,64}[.]content[.]json$'
         or v_entry.key ~ '^slots/[a-z0-9_-]{1,64}/index[.](tsx|css)$'
       )
       or jsonb_typeof(v_entry.value)<>'string'
       or octet_length(v_entry.value::text)>262144
    then raise exception using errcode='22023',message='INVALID_EDITOR_FILE'; end if;
  end loop;
  select head_revision into v_head from public.portfolios
  where id=p_portfolio_id and owner_user_id=v_owner for update;
  if not found then raise exception using errcode='42501',message='PORTFOLIO_NOT_FOUND_OR_FORBIDDEN'; end if;
  v_hash:=encode(sha256(convert_to(p_snapshot::text,'UTF8')),'hex');
  select * into v_existing from public.portfolio_revisions
  where portfolio_id=p_portfolio_id and operation_id=p_operation_id;
  if found then
    if v_existing.base_revision<>p_base_revision or v_existing.snapshot_sha256<>v_hash then
      raise exception using errcode='23505',message='OPERATION_ID_REUSED';
    end if;
    return jsonb_build_object('portfolioId',p_portfolio_id,'revision',v_existing.revision,
      'snapshotSha256',v_hash,'alreadyCommitted',true);
  end if;
  if v_head<>p_base_revision then
    raise exception using errcode='40001',message='REVISION_CONFLICT';
  end if;
  v_next:=v_head+1;
  insert into public.portfolio_revisions(portfolio_id,owner_user_id,revision,base_revision,operation_id,snapshot,snapshot_sha256)
  values(p_portfolio_id,v_owner,v_next,p_base_revision,p_operation_id,p_snapshot,v_hash);
  update public.portfolios set head_revision=v_next,updated_at=now() where id=p_portfolio_id;
  return jsonb_build_object('portfolioId',p_portfolio_id,'revision',v_next,
    'snapshotSha256',v_hash,'alreadyCommitted',false);
end;
$function$
;
