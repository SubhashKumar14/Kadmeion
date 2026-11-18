-- C05: private profile avatar, segregated immutable Storage identity and v2
-- owner exit/export inventory. Paired client/QA acceptance required.
create table public.profile_assets (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null references auth.users(id) on delete cascade,
 operation_id uuid not null,
 object_path text not null unique,
 mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp')),
 byte_size bigint not null check(byte_size between 12 and 5242880),
 alt_text text not null check(alt_text=btrim(alt_text) and length(alt_text) between 1 and 500),
 state text not null default 'PENDING_UPLOAD' check(state in ('PENDING_UPLOAD','REGISTERED')),
 storage_object_id uuid,
 storage_version text,
 created_at timestamptz not null default clock_timestamp(),
 registered_at timestamptz,
 unique(owner_user_id,operation_id), unique(id,owner_user_id),
 check(object_path=owner_user_id::text||'/profile/'||operation_id::text||'.img'),
 check((state='PENDING_UPLOAD' and storage_object_id is null and storage_version is null and registered_at is null)
    or (state='REGISTERED' and storage_object_id is not null and storage_version is not null
      and length(storage_version) between 1 and 128 and registered_at is not null))
);
alter table public.profile_assets enable row level security;
revoke all on public.profile_assets from public,anon,authenticated,service_role;
grant select on public.profile_assets to authenticated;
create policy profile_assets_owner_read on public.profile_assets for select to authenticated
 using (owner_user_id=(select auth.uid()));

alter table public.profiles
 add column avatar_asset_id uuid,
 add column avatar_revision bigint not null default 0 check(avatar_revision between 0 and 9007199254740991),
 add column avatar_last_operation_id uuid,
 add column avatar_last_base_revision bigint,
 add constraint profile_avatar_owner_fk foreign key(avatar_asset_id,user_id)
   references public.profile_assets(id,owner_user_id) on delete set null (avatar_asset_id),
 add constraint profile_avatar_replay_check check(
   (avatar_last_operation_id is null and avatar_last_base_revision is null)
   or (avatar_last_operation_id is not null and avatar_last_base_revision is not null
       and avatar_last_base_revision between 0 and 9007199254740990
       and avatar_revision=avatar_last_base_revision+1)
 );
revoke insert(avatar_asset_id,avatar_revision,avatar_last_operation_id,avatar_last_base_revision),
 update(avatar_asset_id,avatar_revision,avatar_last_operation_id,avatar_last_base_revision)
 on public.profiles from public,anon,authenticated,service_role;

-- Preserve original PROJECT rules and existing live-owner trigger. Only the
-- reserved profile namespace needs a matching pending row and exact metadata.
alter policy kd_storage_private_insert on storage.objects with check (
 bucket_id='kadmeion-private-assets' and owner_id=(select auth.uid()::text)
 and (storage.foldername(name))[1]=(select auth.uid()::text)
 and (split_part(name,'/',2)<>'profile' or exists (
   select 1 from public.profile_assets a where a.owner_user_id=(select auth.uid())
    and a.object_path=name and a.state='PENDING_UPLOAD'
    and lower(coalesce(metadata->>'mimetype',''))=a.mime_type
    and (case when coalesce(metadata->>'size','')~'^[0-9]{1,10}$'
       then (metadata->>'size')::bigint else null end)=a.byte_size
 ))
);
create function kadmeion_private.reject_project_profile_namespace()
 returns trigger language plpgsql set search_path='' as $$
begin
 if split_part(new.object_path,'/',2)='profile' then
   raise exception using errcode='22023',message='PROFILE_ASSET_NAMESPACE_RESERVED';
 end if;
 return new;
end;
$$;
revoke all on function kadmeion_private.reject_project_profile_namespace() from public,anon,authenticated,service_role;
create trigger kd_project_asset_namespace before insert or update of object_path,owner_user_id
 on public.project_assets for each row execute function kadmeion_private.reject_project_profile_namespace();

-- Owner session proof, compatible lock order (auth.users then profiles).
create function kadmeion_private.lock_profile_asset_owner()
 returns uuid language plpgsql security definer set search_path='' as $$
declare o uuid:=(select auth.uid()); s uuid;
begin
 s:=kadmeion_private.require_live_exit_auth_session();
 perform 1 from auth.users where id=o for key share;
 if not found then raise exception using errcode='42501',message='PRIVATE_ASSET_NOT_FOUND'; end if;
 perform 1 from public.profiles where user_id=o for update;
 if not found then raise exception using errcode='42501',message='PRIVATE_ASSET_NOT_FOUND'; end if;
 if not exists(select 1 from auth.sessions where id=s and user_id=o and
   (not_after is null or not_after>clock_timestamp())) then
   raise exception using errcode='42501',message='LIVE_SESSION_REQUIRED';
 end if;
 return o;
end;
$$;
revoke all on function kadmeion_private.lock_profile_asset_owner() from public,anon,authenticated,service_role;

create function public.reserve_private_profile_asset(p_operation_id uuid,p_mime_type text,p_byte_size bigint,p_alt_text text)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid; a public.profile_assets%rowtype; p text;
begin
 o:=kadmeion_private.lock_profile_asset_owner();
 if p_operation_id is null or p_mime_type is null or p_mime_type not in ('image/png','image/jpeg','image/webp')
   or p_byte_size is null or p_byte_size not between 12 and 5242880
   or p_alt_text is null or length(btrim(p_alt_text)) not between 1 and 500 then
   raise exception using errcode='22023',message='INVALID_PRIVATE_PROFILE_ASSET';
 end if;
 p:=o::text||'/profile/'||p_operation_id::text||'.img';
 select * into a from public.profile_assets where owner_user_id=o and operation_id=p_operation_id for update;
 if found then
   if a.mime_type is distinct from p_mime_type or a.byte_size is distinct from p_byte_size
     or a.alt_text is distinct from btrim(p_alt_text) then
     raise exception using errcode='23505',message='PROFILE_ASSET_OPERATION_CONFLICT';
   end if;
 else
   if (select count(*) from public.profile_assets where owner_user_id=o)>=20 then
     raise exception using errcode='54000',message='PROFILE_ASSET_LIMIT_EXCEEDED';
   end if;
   if exists(select 1 from public.project_assets where object_path=p)
     or exists(select 1 from storage.objects where bucket_id='kadmeion-private-assets' and name=p) then
     raise exception using errcode='23505',message='PROFILE_ASSET_PATH_OCCUPIED';
   end if;
   insert into public.profile_assets(owner_user_id,operation_id,object_path,mime_type,byte_size,alt_text)
    values(o,p_operation_id,p,p_mime_type,p_byte_size,btrim(p_alt_text)) returning * into a;
 end if;
 return jsonb_build_object('assetId',a.id,'ownerUserId',o,'scope','PROFILE','state',a.state,
   'objectPath',a.object_path,'mime',a.mime_type,'size',a.byte_size,'altText',a.alt_text);
end;
$$;
revoke all on function public.reserve_private_profile_asset(uuid,text,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.reserve_private_profile_asset(uuid,text,bigint,text) to authenticated;

-- Verify the exact current Storage row, optionally binding registered identity.
create function kadmeion_private.profile_asset_storage_matches(a public.profile_assets,b storage.objects)
 returns boolean language sql stable set search_path='' as $$
 select coalesce(b.id is not null and b.bucket_id='kadmeion-private-assets' and b.name=a.object_path
   and b.owner_id=a.owner_user_id::text and b.version is not null and length(b.version::text) between 1 and 128
   and lower(b.metadata->>'mimetype')=a.mime_type
   and (case when coalesce(b.metadata->>'size','')~'^[0-9]{1,10}$' then (b.metadata->>'size')::bigint else null end)=a.byte_size
   and (a.state='PENDING_UPLOAD' or
      (a.storage_object_id=b.id and a.storage_version=b.version::text)),false)
$$;
revoke all on function kadmeion_private.profile_asset_storage_matches(public.profile_assets,storage.objects)
 from public,anon,authenticated,service_role;

create function public.register_private_profile_asset(p_asset_id uuid)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid; a public.profile_assets%rowtype; b storage.objects%rowtype;
begin
 o:=kadmeion_private.lock_profile_asset_owner();
 select * into a from public.profile_assets where id=p_asset_id and owner_user_id=o for update;
 if not found then raise exception using errcode='42501',message='PRIVATE_ASSET_NOT_FOUND'; end if;
 select * into b from storage.objects where bucket_id='kadmeion-private-assets' and name=a.object_path for share;
 if not found or not kadmeion_private.profile_asset_storage_matches(a,b) then
   raise exception using errcode='22023',message='PRIVATE_STORAGE_OBJECT_NOT_VERIFIED';
 end if;
 if a.state='PENDING_UPLOAD' then
   update public.profile_assets set state='REGISTERED',storage_object_id=b.id,
     storage_version=b.version::text,registered_at=clock_timestamp() where id=a.id returning * into a;
 end if;
 return jsonb_build_object('assetId',a.id,'ownerUserId',o,'scope','PROFILE','state','REGISTERED',
   'objectPath',a.object_path,'mime',a.mime_type,'size',a.byte_size,'altText',a.alt_text,
   'createdAt',a.created_at,'registeredAt',a.registered_at,'publicDeliveryAllowed',false);
end;
$$;
revoke all on function public.register_private_profile_asset(uuid) from public,anon,authenticated,service_role;
grant execute on function public.register_private_profile_asset(uuid) to authenticated;

create function kadmeion_private.read_profile_avatar_receipt(p_owner uuid)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles%rowtype; a public.profile_assets%rowtype; b storage.objects%rowtype; j jsonb:=null;
begin
 select * into p from public.profiles where user_id=p_owner;
 if not found then raise exception using errcode='42501',message='PRIVATE_ASSET_NOT_FOUND'; end if;
 if p.avatar_asset_id is not null then
   select * into a from public.profile_assets where id=p.avatar_asset_id and owner_user_id=p_owner and state='REGISTERED';
   if not found then raise exception using errcode='22023',message='PRIVATE_ASSET_PIN_INTEGRITY'; end if;
   select * into b from storage.objects where bucket_id='kadmeion-private-assets' and name=a.object_path;
   if not found or not kadmeion_private.profile_asset_storage_matches(a,b) then
     raise exception using errcode='22023',message='PRIVATE_ASSET_PIN_INTEGRITY';
   end if;
   j:=jsonb_build_object('id',a.id,'scope','PROFILE','mime',a.mime_type,'size',a.byte_size,
     'altText',a.alt_text,'createdAt',a.created_at,'objectPath',a.object_path);
 end if;
 return jsonb_build_object('ownerUserId',p_owner,'revision',p.avatar_revision,'asset',j,'publicDeliveryAllowed',false);
end;
$$;
revoke all on function kadmeion_private.read_profile_avatar_receipt(uuid) from public,anon,authenticated,service_role;
create function public.read_private_profile_avatar()
 returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid;
begin
 o:=kadmeion_private.lock_profile_asset_owner();
 return kadmeion_private.read_profile_avatar_receipt(o);
end;
$$;
revoke all on function public.read_private_profile_avatar() from public,anon,authenticated,service_role;
grant execute on function public.read_private_profile_avatar() to authenticated;

create function public.set_private_profile_avatar(p_base_revision bigint,p_asset_id uuid,p_operation_id uuid)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid; p public.profiles%rowtype; a public.profile_assets%rowtype; b storage.objects%rowtype;
begin
 o:=kadmeion_private.lock_profile_asset_owner();
 if p_base_revision is null or p_base_revision not between 0 and 9007199254740991 or p_operation_id is null then
   raise exception using errcode='22023',message='INVALID_AVATAR_OPERATION';
 end if;
 select * into p from public.profiles where user_id=o for update;
 if p.avatar_last_operation_id=p_operation_id then
   if p.avatar_last_base_revision=p_base_revision and p.avatar_asset_id is not distinct from p_asset_id
      and p.avatar_revision=p_base_revision+1 then
     return kadmeion_private.read_profile_avatar_receipt(o);
   end if;
   raise exception using errcode='40001',message='AVATAR_REVISION_CONFLICT';
 end if;
 if p.avatar_revision<>p_base_revision then
   raise exception using errcode='40001',message='AVATAR_REVISION_CONFLICT';
 end if;
 if p.avatar_asset_id is not distinct from p_asset_id then
   return kadmeion_private.read_profile_avatar_receipt(o);
 end if;
 if p.avatar_revision=9007199254740991 then
   if p_asset_id is not null then raise exception using errcode='54000',message='AVATAR_REVISION_EXHAUSTED'; end if;
   update public.profiles set avatar_asset_id=null,avatar_last_operation_id=null,avatar_last_base_revision=null
    where user_id=o;
   return kadmeion_private.read_profile_avatar_receipt(o);
 end if;
 if p_asset_id is not null then
   if p.avatar_revision>=9007199254740990 then
     raise exception using errcode='54000',message='AVATAR_REVISION_EXHAUSTED';
   end if;
   select * into a from public.profile_assets where id=p_asset_id and owner_user_id=o and state='REGISTERED' for share;
   if not found then raise exception using errcode='42501',message='PRIVATE_ASSET_NOT_FOUND'; end if;
   select * into b from storage.objects where bucket_id='kadmeion-private-assets' and name=a.object_path for share;
   if not found or not kadmeion_private.profile_asset_storage_matches(a,b) then
     raise exception using errcode='22023',message='PRIVATE_ASSET_PIN_INTEGRITY';
   end if;
 end if;
 update public.profiles set avatar_asset_id=p_asset_id,avatar_revision=avatar_revision+1,
   avatar_last_operation_id=p_operation_id,avatar_last_base_revision=p_base_revision where user_id=o;
 return kadmeion_private.read_profile_avatar_receipt(o);
end;
$$;
revoke all on function public.set_private_profile_avatar(bigint,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.set_private_profile_avatar(bigint,uuid,uuid) to authenticated;

create table kadmeion_private.private_profile_asset_content_attestations (
 asset_id uuid primary key,
 owner_user_id uuid not null,
 storage_object_id uuid not null,
 storage_version text not null check(length(storage_version) between 1 and 128),
 expected_sha256 text not null check(expected_sha256~'^[0-9a-f]{64}$'),
 attested_at timestamptz not null default clock_timestamp(),
 foreign key(asset_id,owner_user_id) references public.profile_assets(id,owner_user_id) on delete cascade
);
alter table kadmeion_private.private_profile_asset_content_attestations enable row level security;
revoke all on kadmeion_private.private_profile_asset_content_attestations from public,anon,authenticated,service_role;
create function kadmeion_private.reject_profile_asset_pin_mutation()
 returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' and pg_trigger_depth()>1 and not exists(select 1 from public.profile_assets where id=old.asset_id) then return old; end if;
 raise exception using errcode='42501',message='PRIVATE_ASSET_ATTESTATION_IMMUTABLE';
end;
$$;
revoke all on function kadmeion_private.reject_profile_asset_pin_mutation() from public,anon,authenticated,service_role;
create trigger private_profile_pin_write_once before update or delete on kadmeion_private.private_profile_asset_content_attestations
 for each row execute function kadmeion_private.reject_profile_asset_pin_mutation();

create function public.record_private_profile_asset_content_attestation(
 p_asset_id uuid,p_owner_user_id uuid,p_storage_object_id uuid,p_storage_version text,p_expected_sha256 text)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.profile_assets%rowtype; b storage.objects%rowtype; t kadmeion_private.private_profile_asset_content_attestations%rowtype;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception using errcode='42501',message='TRUSTED_WORKER_REQUIRED'; end if;
 if p_asset_id is null or p_owner_user_id is null or p_storage_object_id is null or p_storage_version is null
  or length(p_storage_version) not between 1 and 128 or p_expected_sha256 is null or p_expected_sha256!~'^[0-9a-f]{64}$' then
   raise exception using errcode='22023',message='INVALID_ASSET_ATTESTATION';
 end if;
 perform 1 from auth.users where id=p_owner_user_id for key share;
 if not found then raise exception using errcode='42501',message='PRIVATE_ASSET_NOT_FOUND'; end if;
 select * into a from public.profile_assets where id=p_asset_id and owner_user_id=p_owner_user_id and state='REGISTERED' for update;
 if not found then raise exception using errcode='42501',message='PRIVATE_ASSET_NOT_FOUND'; end if;
 select * into b from storage.objects where bucket_id='kadmeion-private-assets' and name=a.object_path for share;
 if not found or not kadmeion_private.profile_asset_storage_matches(a,b) or b.id is distinct from p_storage_object_id
   or b.version::text is distinct from p_storage_version then
   raise exception using errcode='22023',message='STORAGE_IDENTITY_CHANGED';
 end if;
 insert into kadmeion_private.private_profile_asset_content_attestations(asset_id,owner_user_id,storage_object_id,storage_version,expected_sha256)
 values(a.id,a.owner_user_id,b.id,b.version::text,p_expected_sha256) on conflict(asset_id) do nothing;
 select * into t from kadmeion_private.private_profile_asset_content_attestations where asset_id=a.id;
 if t.owner_user_id is distinct from p_owner_user_id or t.storage_object_id is distinct from p_storage_object_id
  or t.storage_version is distinct from p_storage_version or t.expected_sha256 is distinct from p_expected_sha256 then
   raise exception using errcode='23505',message='ASSET_ATTESTATION_ALREADY_PINNED';
 end if;
 return jsonb_build_object('assetId',a.id,'scope','PROFILE','status','WRITE_ONCE_ATTESTED','providerSigned',false,'deletionAllowed',false);
end;
$$;
revoke all on function public.record_private_profile_asset_content_attestation(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.record_private_profile_asset_content_attestation(uuid,uuid,uuid,text,text) to service_role;

create function kadmeion_private.read_profile_asset_pin(p_owner uuid,p_session uuid,p_asset_id uuid)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare r record;
begin
 select a.mime_type,a.byte_size,a.storage_object_id,a.storage_version,
   o.id object_id,o.version::text object_version,o.owner_id,o.metadata,
   t.asset_id pin_id,t.owner_user_id pin_owner,t.storage_object_id pin_object,t.storage_version pin_version,t.expected_sha256
 into r from public.profile_assets a
 join auth.users u on u.id=a.owner_user_id
 join auth.sessions s on s.user_id=u.id and s.id=p_session
 left join storage.objects o on o.bucket_id='kadmeion-private-assets' and o.name=a.object_path
 left join kadmeion_private.private_profile_asset_content_attestations t on t.asset_id=a.id
 where a.id=p_asset_id and a.owner_user_id=p_owner and a.state='REGISTERED'
   and (s.not_after is null or s.not_after>clock_timestamp());
 if not found then raise exception using errcode='42501',message='PRIVATE_ASSET_NOT_FOUND'; end if;
 if r.object_id is distinct from r.storage_object_id or r.object_version is distinct from r.storage_version
  or r.owner_id is distinct from p_owner::text or lower(r.metadata->>'mimetype') is distinct from r.mime_type
  or (case when coalesce(r.metadata->>'size','')~'^[0-9]{1,10}$' then (r.metadata->>'size')::bigint else null end) is distinct from r.byte_size
  or (r.pin_id is not null and (r.pin_owner is distinct from p_owner or r.pin_object is distinct from r.object_id
    or r.pin_version is distinct from r.object_version or r.expected_sha256 is null or r.expected_sha256!~'^[0-9a-f]{64}$')) then
   raise exception using errcode='22023',message='PRIVATE_ASSET_PIN_INTEGRITY';
 end if;
 return jsonb_build_object('scope','PROFILE','assetId',p_asset_id,'ownerUserId',p_owner,'projectId',null,
   'objectId',r.object_id,'version',r.object_version,'mimeType',r.mime_type,'byteSize',r.byte_size,
   'status',case when r.pin_id is null then 'UNPINNED' else 'SERVER_HASH_PINNED' end,
   'expectedSha256',r.expected_sha256,'publicDeliveryAllowed',false);
end;
$$;
revoke all on function kadmeion_private.read_profile_asset_pin(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- C04 PROJECT logic below is retained verbatim; only PROFILE dispatch added.
-- C04 / WF-021: trusted scoped pin; PROJECT implementation preserved.
-- No digest supplied by the browser, no public delivery or new writer.
create or replace function public.read_owner_private_asset_pin(
  p_scope text,p_asset_id uuid,p_project_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid := (select auth.uid());
  v_session uuid;
  r record;
begin
  begin
    v_session:=kadmeion_private.require_live_exit_auth_session();
  exception when insufficient_privilege then
    raise exception using errcode='42501',message='PRIVATE_ASSET_NOT_FOUND';
  end;
  if p_scope is null or p_scope not in ('PROJECT','PROFILE') or p_asset_id is null
    or (p_scope='PROJECT' and p_project_id is null)
    or (p_scope='PROFILE' and p_project_id is not null) then
    raise exception using errcode='22023',message='INVALID_PRIVATE_ASSET_PIN_REQUEST';
  end if;
  if p_scope='PROFILE' then
    return kadmeion_private.read_profile_asset_pin(v_owner,v_session,p_asset_id);
  end if;
  -- Single joined statement: current registry, owner/session, object and pin.
  select a.mime_type,a.byte_size,o.id as object_id,o.version::text as object_version,
    o.owner_id,o.metadata,t.asset_id as pin_id,t.owner_user_id as pin_owner,
    t.storage_object_id as pin_object,t.storage_version as pin_version,t.expected_sha256
  into r
  from public.project_assets a
  join public.projects p on p.id=a.project_id and p.owner_user_id=a.owner_user_id
  join auth.users u on u.id=a.owner_user_id
  join auth.sessions s on s.user_id=u.id and s.id=v_session
  left join storage.objects o on o.bucket_id='kadmeion-private-assets' and o.name=a.object_path
  left join kadmeion_private.private_asset_content_attestations t on t.asset_id=a.id
  where p_scope='PROJECT' and a.id=p_asset_id and a.project_id=p_project_id
    and a.owner_user_id=v_owner and p.trashed_at is null
    and (s.not_after is null or s.not_after>clock_timestamp())
    and a.object_path ~ ('^'||v_owner::text||'/'||p_project_id::text||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]'||
      '(img|'||(case a.mime_type when 'image/png' then 'png' when 'image/jpeg' then 'jpg'
        when 'image/webp' then 'webp' else 'img' end)||')$');
  if not found then
    raise exception using errcode='42501',message='PRIVATE_ASSET_NOT_FOUND';
  end if;
  if r.mime_type not in ('image/png','image/jpeg','image/webp')
    or r.byte_size not between 12 and 5242880
    or r.object_id is null or r.object_version is null
    or length(r.object_version) not between 1 and 128
    or r.owner_id is distinct from v_owner::text
    or lower(r.metadata->>'mimetype') is distinct from r.mime_type
    or (case when coalesce(r.metadata->>'size','') ~ '^[0-9]{1,10}$'
         then (r.metadata->>'size')::bigint else null end) is distinct from r.byte_size
    or (r.pin_id is not null and (r.pin_owner is distinct from v_owner
      or r.pin_object is distinct from r.object_id or r.pin_version is distinct from r.object_version
      or r.expected_sha256 is null or r.expected_sha256 !~ '^[0-9a-f]{64}$')) then
    raise exception using errcode='22023',message='PRIVATE_ASSET_PIN_INTEGRITY';
  end if;
  return jsonb_build_object('scope','PROJECT','assetId',p_asset_id,'ownerUserId',v_owner,
    'projectId',p_project_id,'objectId',r.object_id,'version',r.object_version,
    'mimeType',r.mime_type,'byteSize',r.byte_size,
    'status',case when r.pin_id is null then 'UNPINNED' else 'SERVER_HASH_PINNED' end,
    'expectedSha256',r.expected_sha256,'publicDeliveryAllowed',false);
end;
$$;
revoke all on function public.read_owner_private_asset_pin(text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.read_owner_private_asset_pin(text,uuid,uuid) to authenticated;
comment on function public.read_owner_private_asset_pin(text,uuid,uuid) is
  'Owner-session-bound PROJECT or PROFILE attestation lookup; no public delivery or cross-scope fallback.';


-- Shared quota and immutable stored v1 snapshots; v2 adds explicit profile coverage.
alter table public.private_account_exit_inventory_snapshots
  drop constraint private_account_exit_inventory_snapshots_schema_version_check,
  add constraint private_account_exit_inventory_snapshots_schema_version_check
    check(schema_version in (1,2));

create function kadmeion_private.require_live_asset_export_owner()
returns uuid language plpgsql stable security definer set search_path='' as $$
declare o uuid:=(select auth.uid()); s uuid;
begin
 s:=kadmeion_private.require_live_exit_auth_session();
 if not exists(select 1 from auth.users u join auth.sessions a on a.user_id=u.id
   where u.id=o and a.id=s and (a.not_after is null or a.not_after>clock_timestamp())) then
   raise exception using errcode='42501',message='LIVE_SESSION_REQUIRED';
 end if;
 return o;
end;
$$;
revoke all on function kadmeion_private.require_live_asset_export_owner() from public,anon,authenticated,service_role;
create function kadmeion_private.require_v1_asset_scope(p_owner uuid)
returns void language plpgsql stable security definer set search_path='' as $$
begin
 if p_owner is distinct from kadmeion_private.require_live_asset_export_owner() then
   raise exception using errcode='42501',message='LIVE_SESSION_REQUIRED';
 end if;
 if exists(select 1 from public.profile_assets where owner_user_id=p_owner)
   or exists(select 1 from storage.objects where bucket_id='kadmeion-private-assets'
      and split_part(name,'/',1)=p_owner::text and split_part(name,'/',2)='profile') then
   raise exception using errcode='55000',message='PROFILE_ASSET_EXPORT_VERSION_REQUIRED';
 end if;
end;
$$;
revoke all on function kadmeion_private.require_v1_asset_scope(uuid) from public,anon,authenticated,service_role;

create function kadmeion_private.require_inventory_v2(p_snapshot_id uuid,p_expected_request_id uuid)
returns public.private_account_exit_inventory_snapshots language plpgsql stable security definer set search_path='' as $$
declare o uuid; v_row public.private_account_exit_inventory_snapshots%rowtype;
begin
 o:=kadmeion_private.require_live_asset_export_owner();
 select * into v_row from public.private_account_exit_inventory_snapshots
  where id=p_snapshot_id and owner_user_id=o and schema_version=2
    and request_id is not distinct from p_expected_request_id;
 if not found then raise exception using errcode='42501',message='PRIVATE_INVENTORY_NOT_FOUND'; end if;
 return v_row;
end;
$$;
revoke all on function kadmeion_private.require_inventory_v2(uuid,uuid) from public,anon,authenticated,service_role;


create or replace function public.create_private_account_exit_inventory(
  p_operation_id uuid,p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_session uuid;
  v_existing public.private_account_exit_inventory_snapshots%rowtype;
  v_counts jsonb;
  v_capped boolean;
  v_inventory jsonb;
  v_id uuid;
  v_captured timestamptz;
begin
  v_session:=kadmeion_private.require_live_exit_auth_session();
  if p_operation_id is null then
    raise exception using errcode='22023',message='INVALID_INVENTORY_OPERATION';
  end if;
  -- Serialize owner idempotency/quota against concurrent calls.
  perform 1 from auth.users where id=v_owner for key share;
  if not found then raise exception using errcode='42501',message='LIVE_SESSION_REQUIRED'; end if;
  perform 1 from public.profiles where user_id=v_owner for update;
  if not found then
    raise exception using errcode='42501',message='OWNER_PROFILE_NOT_FOUND';
  end if;
  perform kadmeion_private.require_live_asset_export_owner();
  select * into v_existing from public.private_account_exit_inventory_snapshots
    where owner_user_id=v_owner and operation_id=p_operation_id for update;
  if found then
    if v_existing.schema_version<>1 or v_existing.request_id is distinct from p_request_id then
      raise exception using errcode='23505',message='INVENTORY_OPERATION_REUSED';
    end if;
    return jsonb_build_object('snapshotId',v_existing.id,'schemaVersion',1,
      'capturedAt',v_existing.captured_at,'alreadyCaptured',true,
      'inventory',v_existing.inventory,'deletionAllowed',false);
  end if;
  perform kadmeion_private.require_v1_asset_scope(v_owner);
  if p_request_id is not null and not exists(
    select 1 from public.private_account_erasure_requests
    where id=p_request_id and owner_user_id=v_owner and status='REQUESTED_BLOCKED'
  ) then
    raise exception using errcode='42501',message='ACTIVE_OWNER_REQUEST_REQUIRED';
  end if;
  if (select count(*) from public.private_account_exit_inventory_snapshots
      where owner_user_id=v_owner)>=10 then
    raise exception using errcode='54000',message='INVENTORY_SNAPSHOT_QUOTA_REACHED';
  end if;

  -- All nine bounded counts are evaluated in ONE statement, not nine
  -- separate READ COMMITTED statements that could observe different commits.
  select jsonb_build_object(
    'projects', (select count(*) from (select 1 from public.projects
      where owner_user_id=v_owner limit 1001) as bounded_projects),
    'portfolios', (select count(*) from (select 1 from public.portfolios
      where owner_user_id=v_owner limit 1001) as bounded_portfolios),
    'portfolioRevisions', (select count(*) from (select 1 from public.portfolio_revisions
      where owner_user_id=v_owner limit 1001) as bounded_portfolio_revisions),
    'projectExposureIntents', (select count(*) from (select 1 from public.project_exposure_intents
      where owner_user_id=v_owner limit 1001) as bounded_project_exposure_intents),
    'projectAssetMetadata', (select count(*) from (select 1 from public.project_assets
      where owner_user_id=v_owner limit 1001) as bounded_project_assets),
    'frozenReleaseRequests', (select count(*) from (select 1 from public.private_release_requests
      where owner_user_id=v_owner limit 1001) as bounded_private_release_requests),
    'reviewerGrants', (select count(*) from (select 1 from public.private_reviewer_grants
      where owner_user_id=v_owner limit 1001) as bounded_private_reviewer_grants),
    'trashRecords', (select count(*) from (select 1 from public.private_trash_items
      where owner_user_id=v_owner limit 1001) as bounded_private_trash_items),
    'accountExitRequests', (select count(*) from (select 1 from public.private_account_erasure_requests
      where owner_user_id=v_owner limit 1001) as bounded_private_account_erasure_requests)
  ) into v_counts;
  select exists(
    select 1 from jsonb_each_text(v_counts) as entry(k,v)
    where entry.v::integer>1000
  ) into v_capped;
  select jsonb_object_agg(k,least(v::integer,1000))
    into v_counts from jsonb_each_text(v_counts) as entry(k,v);

  v_inventory:=jsonb_build_object(
    'status','METADATA_SNAPSHOT_ONLY','maxCountPerCategory',1000,
    'countsCapped',v_capped,'counts',v_counts,
    'consistency','SINGLE_STATEMENT_MVCC',
    'publicRoutes','UNVERIFIED','objectStorage','METADATA_ONLY',
    'exports','NOT_READY','integrations','NOT_TRACKED',
    'backupRetention','UNVERIFIED','recentReauthVerified',false,
    'publicRevocationVerified',false,'deletionAllowed',false
  );
  insert into public.private_account_exit_inventory_snapshots(
    owner_user_id,operation_id,request_id,inventory
  ) values(v_owner,p_operation_id,p_request_id,v_inventory)
    returning id,captured_at into v_id,v_captured;
  return jsonb_build_object('snapshotId',v_id,'schemaVersion',1,
    'capturedAt',v_captured,'alreadyCaptured',false,
    'inventory',v_inventory,'deletionAllowed',false);
end;
$$;
revoke all on function public.create_private_account_exit_inventory(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.create_private_account_exit_inventory(uuid,uuid)
  to authenticated;
comment on function public.create_private_account_exit_inventory(uuid,uuid) is
  'Creates bounded metadata-only owner snapshot with live GoTrue session. Never exports bytes, authorizes erasure or verifies external storage/host/cache retention.';

create or replace function public.get_private_account_exit_inventory(p_snapshot_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_session uuid;
  v_record public.private_account_exit_inventory_snapshots%rowtype;
begin
  v_session:=kadmeion_private.require_live_exit_auth_session();
  perform kadmeion_private.require_live_asset_export_owner();
  if p_snapshot_id is null then
    raise exception using errcode='22023',message='INVALID_INVENTORY_SNAPSHOT';
  end if;
  select * into v_record from public.private_account_exit_inventory_snapshots
    where id=p_snapshot_id and owner_user_id=v_owner and schema_version=1;
  if not found then
    raise exception using errcode='42501',message='PRIVATE_INVENTORY_NOT_FOUND';
  end if;
  return jsonb_build_object('snapshotId',v_record.id,'schemaVersion',1,
    'capturedAt',v_record.captured_at,'alreadyCaptured',true,
    'inventory',v_record.inventory,'deletionAllowed',false);
end;
$$;
revoke all on function public.get_private_account_exit_inventory(uuid)
  from public,anon,authenticated;
grant execute on function public.get_private_account_exit_inventory(uuid)
  to authenticated;
comment on function public.get_private_account_exit_inventory(uuid) is
  'Read immutable owner-only metadata snapshot; never a complete export or deletion authorization.';

create or replace function public.reconcile_private_account_exit_storage(p_snapshot_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_session uuid;
  v_inventory jsonb;
  v_captured timestamptz;
  v_registered bigint;
  v_objects bigint;
  v_missing bigint;
  v_orphans bigint;
  v_mismatch bigint;
  v_limited boolean;
  v_drift boolean;
  v_state text;
begin
  v_session:=kadmeion_private.require_live_exit_auth_session();
  perform kadmeion_private.require_v1_asset_scope(v_owner);
  if p_snapshot_id is null then
    raise exception using errcode='22023',message='INVALID_INVENTORY_SNAPSHOT';
  end if;
  select inventory,captured_at into v_inventory,v_captured
  from public.private_account_exit_inventory_snapshots
  where id=p_snapshot_id and owner_user_id=v_owner and schema_version=1;
  if not found then
    raise exception using errcode='42501',message='PRIVATE_INVENTORY_NOT_FOUND';
  end if;

  -- The prefix and bucket constrain Storage reads to the caller's namespace.
  -- Compare both sides, including unregistered/orphan Storage objects. Return
  -- counts only: no foreign paths, provider credentials or object bytes.
  -- 101 entries per side allow safe detection of a 100-item result cap.
  with registered as materialized (
    select id,object_path,mime_type,byte_size
    from public.project_assets
    where owner_user_id=v_owner
    order by object_path limit 101
  ), objects as materialized (
    select name,owner_id,metadata
    from storage.objects
    where bucket_id='kadmeion-private-assets'
      and name like (v_owner::text || '/%')
    order by name limit 101
  ), paired as (
    select a.id as asset_id,o.name as object_name,
      case when a.id is not null and o.name is not null then
        o.owner_id is distinct from v_owner::text or
        lower(coalesce(o.metadata->>'mimetype',''))<>a.mime_type or
        (case when coalesce(o.metadata->>'size','') ~ '^[0-9]{1,10}$'
          then (o.metadata->>'size')::bigint else -1 end)<>a.byte_size
      else false end as metadata_mismatch
    from registered a full outer join objects o on a.object_path=o.name
  )
  select
    (select count(*) from registered),
    (select count(*) from objects),
    (select count(*) from paired where asset_id is not null and object_name is null),
    (select count(*) from paired where asset_id is null and object_name is not null),
    (select count(*) from paired where metadata_mismatch)
  into v_registered,v_objects,v_missing,v_orphans,v_mismatch;

  v_limited:=v_registered>100 or v_objects>100;
  v_drift:=v_limited or
    coalesce((v_inventory->'counts'->>'projectAssetMetadata')::integer,-1)
      <>v_registered;
  v_state:=case
    when v_limited then 'LIMIT_EXCEEDED'
    when v_missing>0 or v_orphans>0 or v_mismatch>0 then 'DISCREPANCY'
    else 'METADATA_MATCH_ONLY' end;

  return jsonb_build_object(
    'snapshotId',p_snapshot_id,'inventoryCapturedAt',v_captured,
    'status',v_state,'maxObjectsPerSide',100,'limitExceeded',v_limited,
    'registeredAssets',least(v_registered,100),
    'storageObjects',least(v_objects,100),
    'missingObjects',least(v_missing,100),
    'orphanObjects',least(v_orphans,100),
    'metadataMismatches',least(v_mismatch,100),
    'inventoryDrift',v_drift,
    'consistency','LIVE_METADATA_NOT_ATOMIC_WITH_INVENTORY',
    'storageBytesVerified',false,'downloadableExportReady',false,
    'externalProviders','UNVERIFIED','backupRetention','UNVERIFIED',
    'publicRevocationVerified',false,'deletionAllowed',false
  );
end;
$$;
revoke all on function public.reconcile_private_account_exit_storage(uuid)
  from public,anon,authenticated;
grant execute on function public.reconcile_private_account_exit_storage(uuid)
  to authenticated;
comment on function public.reconcile_private_account_exit_storage(uuid) is
  'Live bounded owner-only Storage metadata comparison. Matching rows do not verify bytes, backup retention, complete export, public route revocation or erasure.';

create or replace function public.read_private_asset_content_attestations(p_snapshot_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_owner uuid := (select auth.uid());
  v_registered integer;
  v_pinned integer;
  v_changed integer;
  v_rows jsonb;
begin
  perform kadmeion_private.require_live_exit_auth_session();
  perform kadmeion_private.require_v1_asset_scope(v_owner);
  if p_snapshot_id is null or not exists(
    select 1 from public.private_account_exit_inventory_snapshots
    where id=p_snapshot_id and owner_user_id=v_owner and schema_version=1
  ) then
    raise exception using errcode='42501',message='PRIVATE_INVENTORY_NOT_FOUND';
  end if;
  with assets as materialized (
    select id,object_path,mime_type,byte_size from public.project_assets
    where owner_user_id=v_owner order by object_path limit 101
  ), pins as (
    select a.id,a.object_path,t.storage_object_id,t.storage_version,
      t.expected_sha256,
      (o.id is distinct from t.storage_object_id or
       o.version::text is distinct from t.storage_version or
       o.owner_id is distinct from v_owner::text or
       lower(coalesce(o.metadata->>'mimetype',''))<>a.mime_type or
       coalesce(o.metadata->>'size','') !~ '^[0-9]{1,10}$' or
       (o.metadata->>'size')::bigint<>a.byte_size) as changed
    from assets a
    left join kadmeion_private.private_asset_content_attestations t on t.asset_id=a.id
    left join storage.objects o on o.bucket_id='kadmeion-private-assets'
      and o.name=a.object_path
  )
  select count(*)::integer,
    count(expected_sha256)::integer,
    count(*) filter(where changed or expected_sha256 is null)::integer,
    coalesce(jsonb_agg(jsonb_build_object('assetId',id,'path',object_path,
      'objectId',storage_object_id,'version',storage_version,
      'expectedSha256',expected_sha256) order by object_path)
      filter(where expected_sha256 is not null),'[]'::jsonb)
  into v_registered,v_pinned,v_changed,v_rows from pins;
  return jsonb_build_object('snapshotId',p_snapshot_id,
    'status',case when v_registered<=100 and v_registered=v_pinned
      and v_changed=0 then 'SERVER_HASH_PINNED' else 'UNVERIFIED' end,
    'registeredAssets',least(v_registered,100),'attestedAssets',least(v_pinned,100),
    'attestations',v_rows,'providerSigned',false,'deletionAllowed',false);
end;
$$;
revoke all on function public.read_private_asset_content_attestations(uuid)
  from public,anon,authenticated;
grant execute on function public.read_private_asset_content_attestations(uuid)
  to authenticated;
comment on function public.read_private_asset_content_attestations(uuid) is
  'Owner-only read of server-worker byte digests, bound to a live session. Not provider-signed or an atomic export snapshot.';

create or replace function public.read_private_account_audit_export(p_snapshot_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare
  v_owner uuid := (select auth.uid());
  v_live_session uuid;
  v_items jsonb;
  v_result jsonb;
  v_category record;
begin
  v_live_session:=kadmeion_private.require_live_exit_auth_session();
  perform kadmeion_private.require_v1_asset_scope(v_owner);
  if p_snapshot_id is null or not exists(
    select 1 from public.private_account_exit_inventory_snapshots
    where id=p_snapshot_id and owner_user_id=v_owner and schema_version=1
  ) then
    raise exception using errcode='42501',message='PRIVATE_INVENTORY_NOT_FOUND';
  end if;
  select jsonb_build_object(
    'reviewerGrants',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id,request_id,portfolio_id,expires_at,revoked_at,created_at
        from public.private_reviewer_grants
        where owner_user_id=v_owner order by created_at,id limit 101
      ) t),'[]'::jsonb),
    'moderationCases',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id,reason_code,summary,status,created_at,updated_at
        from public.private_moderation_cases
        where owner_user_id=v_owner order by created_at,id limit 101
      ) t),'[]'::jsonb),
    'moderationEvents',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select e.id,e.case_id,e.actor_user_id,e.event_type,e.detail,e.created_at
        from public.private_moderation_events e
        where e.owner_user_id=v_owner order by e.created_at,e.id limit 101
      ) t),'[]'::jsonb),
    'accountExitRequests',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id,status,created_at,withdrawn_at,
          public_revocation_verified,reauth_verified,access_terminated,
          erasure_executed,retention_verified
        from public.private_account_erasure_requests
        where owner_user_id=v_owner order by created_at,id limit 101
      ) t),'[]'::jsonb),
    'reauthChallenges',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id,created_at,expires_at,verified_at
        from public.private_account_exit_reauth_challenges
        where owner_user_id=v_owner order by created_at,id limit 101
      ) t),'[]'::jsonb),
    'inventorySnapshots',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id,schema_version,captured_at,inventory
        from public.private_account_exit_inventory_snapshots
        where owner_user_id=v_owner order by captured_at,id limit 101
      ) t),'[]'::jsonb),
    'releasePointers',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select portfolio_id,status,generation,revocation_generation,
          candidate_request_id,candidate_manifest_sha256,updated_at
        from public.private_release_visibility_pointers
        where owner_user_id=v_owner order by updated_at,portfolio_id limit 101
      ) t),'[]'::jsonb),
    'releaseEvents',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id,portfolio_id,event_type,expected_generation,
          resulting_generation,created_at
        from public.private_release_visibility_events
        where owner_user_id=v_owner order by created_at,id limit 101
      ) t),'[]'::jsonb)
  ) into v_items;
  for v_category in select key,value from jsonb_each(v_items) loop
    if jsonb_array_length(v_category.value)>100 then
      raise exception using errcode='54000',message='ACCOUNT_AUDIT_EXPORT_LIMIT_EXCEEDED';
    end if;
  end loop;
  if octet_length(v_items::text)>1048576 then
    raise exception using errcode='54000',message='ACCOUNT_AUDIT_EXPORT_LIMIT_EXCEEDED';
  end if;
  v_result:=jsonb_build_object(
    'snapshotId',p_snapshot_id,'ownerUserId',v_owner,
    'status','BOUNDED_OWNER_AUDIT','maxRowsPerCategory',100,
    'categories',v_items,'tokenDigestsIncluded',false,
    'sessionsIncluded',false,'completeAccountExport',false,
    'deletionAllowed',false);
  return v_result;
end;
$function$;
revoke all on function public.read_private_account_audit_export(uuid)
  from public,anon;
grant execute on function public.read_private_account_audit_export(uuid)
  to authenticated;
comment on function public.read_private_account_audit_export(uuid) is
  'Owner-live-session restricted audit export; bounded to 100 per category, omits reviewer secret digests/session IDs, never a full export or deletion authorization.';

create or replace function public.owner_export_account_metadata(p_snapshot_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_table text;
  v_key text;
  v_rows jsonb;
  v_records jsonb := '{}'::jsonb;
  v_releases jsonb;
  v_audit jsonb;
  v_result jsonb;
begin
  perform kadmeion_private.require_v1_asset_scope(v_owner);
  if p_snapshot_id is null or not exists(select 1 from public.private_account_exit_inventory_snapshots
      where id=p_snapshot_id and owner_user_id=v_owner and schema_version=1) then
    raise exception using errcode='42501',message='PRIVATE_INVENTORY_NOT_FOUND';
  end if;
  for v_table,v_key in select * from (values
    ('profiles','user_id'),('profile_sharing_preferences','user_id'),
    ('private_onboarding_steps','user_id'),('projects','owner_user_id'),
    ('project_exposure_intents','owner_user_id'),('portfolios','owner_user_id'),
    ('portfolio_revisions','owner_user_id'),('project_assets','owner_user_id'),
    ('private_release_requests','owner_user_id'),('private_trash_items','owner_user_id'),
    ('private_platform_links','owner_user_id'),('private_goals','owner_user_id'),
    ('private_goal_progress_events','owner_user_id'),('private_goal_milestones','owner_user_id'),
    ('private_notification_preferences','owner_user_id'),
    ('private_my_component_versions','owner_user_id')
  ) as allowed(table_name,owner_column)
  loop
    -- Neither the table nor identifiers come from request parameters.
    if v_table='private_my_component_versions' then
      select coalesce(jsonb_agg(to_jsonb(cv)),'[]'::jsonb) into v_rows from (
        select id,owner_user_id,component_key,version,display_name,base_component_pin,
          pristine_source,source_code,compatible_slot_kinds,source_sha256,created_at
        from public.private_my_component_versions where owner_user_id=v_owner
        order by component_key,version,id limit 41
      ) cv;
      if jsonb_array_length(v_rows)>40 then
        raise exception using errcode='54000',message='ACCOUNT_METADATA_EXPORT_LIMIT_EXCEEDED';
      end if;
    else
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(item)), ''[]''::jsonb) from
         (select * from public.%I where %I=$1 limit 101) item',v_table,v_key)
      into v_rows using v_owner;
    end if;
    if v_table='profiles' then
      select coalesce(jsonb_agg(item-array['avatar_asset_id','avatar_revision',
        'avatar_last_operation_id','avatar_last_base_revision']),'[]'::jsonb)
        into v_rows from jsonb_array_elements(v_rows) entry(item);
    end if;
    if jsonb_array_length(v_rows)>100 or octet_length(v_rows::text)>8388608 then
      raise exception using errcode='54000',message='ACCOUNT_METADATA_EXPORT_LIMIT_EXCEEDED';
    end if;
    v_records:=v_records||jsonb_build_object(v_table,v_rows);
    if octet_length(v_records::text)>10485760 then
      raise exception using errcode='54000',message='ACCOUNT_METADATA_EXPORT_LIMIT_EXCEEDED';
    end if;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb) into v_rows from (
    select id,owner_user_id,event_type,category,priority,target_id,created_at,read_at,dismissed_at
    from public.private_notifications where owner_user_id=v_owner limit 101
  ) n;
  if jsonb_array_length(v_rows)>100 then
    raise exception using errcode='54000',message='ACCOUNT_METADATA_EXPORT_LIMIT_EXCEEDED';
  end if;
  v_records:=v_records||jsonb_build_object('private_notifications',v_rows);
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_releases from (
    select verified.intent_id,verified.portfolio_id,verified.request_id,verified.stage_generation,
      verified.html_sha256,verified.verified_at,consent.public_handle,consent.public_slug,
      consent.rollback_target_id
    from public.verified_unlisted_releases verified
    join public.private_unlisted_publication_intents consent on consent.id=verified.intent_id
      and consent.owner_user_id=verified.owner_user_id
    where verified.owner_user_id=v_owner order by verified.verified_at,verified.intent_id limit 101
  ) r;
  if jsonb_array_length(v_releases)>100 then
    raise exception using errcode='54000',message='ACCOUNT_METADATA_EXPORT_LIMIT_EXCEEDED';
  end if;
  v_audit:=public.read_private_account_audit_export(p_snapshot_id);
  v_result:=jsonb_build_object('status','APPLICATION_METADATA_SNAPSHOT','schemaVersion',1,
    'snapshotId',p_snapshot_id,'ownerUserId',v_owner,'capturedAt',statement_timestamp(),
    'records',v_records,'restrictedAudit',v_audit->'categories','verifiedReleaseHistory',v_releases,
    'storageBytesIncluded',false,'providerDataIncluded',false,'deletionAllowed',false);
  if octet_length(v_result::text)>12582912 then
    raise exception using errcode='54000',message='ACCOUNT_METADATA_EXPORT_LIMIT_EXCEEDED';
  end if;
  return v_result;
end;
$$;

create function public.create_private_account_exit_inventory_v2(
  p_operation_id uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_session uuid;
  v_existing public.private_account_exit_inventory_snapshots%rowtype;
  v_counts jsonb;
  v_capped boolean;
  v_inventory jsonb;
  v_id uuid;
  v_captured timestamptz;
begin
  v_session:=kadmeion_private.require_live_exit_auth_session();
  if p_operation_id is null then
    raise exception using errcode='22023',message='INVALID_INVENTORY_OPERATION';
  end if;
  -- Serialize owner idempotency/quota against concurrent calls.
  perform 1 from auth.users where id=v_owner for key share;
  if not found then raise exception using errcode='42501',message='LIVE_SESSION_REQUIRED'; end if;
  perform 1 from public.profiles where user_id=v_owner for update;
  if not found then
    raise exception using errcode='42501',message='OWNER_PROFILE_NOT_FOUND';
  end if;
  perform kadmeion_private.require_live_asset_export_owner();
  select * into v_existing from public.private_account_exit_inventory_snapshots
    where owner_user_id=v_owner and operation_id=p_operation_id for update;
  if found then
    if v_existing.schema_version<>2 or v_existing.request_id is distinct from p_request_id then
      raise exception using errcode='23505',message='INVENTORY_OPERATION_REUSED';
    end if;
    return jsonb_build_object('snapshotId',v_existing.id,'schemaVersion',2,'requestId',p_request_id,
      'capturedAt',v_existing.captured_at,'alreadyCaptured',true,
      'inventory',v_existing.inventory,'deletionAllowed',false);
  end if;
  if p_request_id is not null and not exists(
    select 1 from public.private_account_erasure_requests
    where id=p_request_id and owner_user_id=v_owner and status='REQUESTED_BLOCKED'
  ) then
    raise exception using errcode='42501',message='ACTIVE_OWNER_REQUEST_REQUIRED';
  end if;
  if (select count(*) from public.private_account_exit_inventory_snapshots
      where owner_user_id=v_owner)>=10 then
    raise exception using errcode='54000',message='INVENTORY_SNAPSHOT_QUOTA_REACHED';
  end if;

  -- All nine bounded counts are evaluated in ONE statement, not nine
  -- separate READ COMMITTED statements that could observe different commits.
  select jsonb_build_object(
    'projects', (select count(*) from (select 1 from public.projects
      where owner_user_id=v_owner limit 1001) as bounded_projects),
    'portfolios', (select count(*) from (select 1 from public.portfolios
      where owner_user_id=v_owner limit 1001) as bounded_portfolios),
    'portfolioRevisions', (select count(*) from (select 1 from public.portfolio_revisions
      where owner_user_id=v_owner limit 1001) as bounded_portfolio_revisions),
    'projectExposureIntents', (select count(*) from (select 1 from public.project_exposure_intents
      where owner_user_id=v_owner limit 1001) as bounded_project_exposure_intents),
    'projectAssetMetadata', (select count(*) from (select 1 from public.project_assets
      where owner_user_id=v_owner limit 1001) as bounded_project_assets),
    'profileAssetMetadata', (select count(*) from (select 1 from public.profile_assets
      where owner_user_id=v_owner limit 1001) as bounded_profile_assets),
    'frozenReleaseRequests', (select count(*) from (select 1 from public.private_release_requests
      where owner_user_id=v_owner limit 1001) as bounded_private_release_requests),
    'reviewerGrants', (select count(*) from (select 1 from public.private_reviewer_grants
      where owner_user_id=v_owner limit 1001) as bounded_private_reviewer_grants),
    'trashRecords', (select count(*) from (select 1 from public.private_trash_items
      where owner_user_id=v_owner limit 1001) as bounded_private_trash_items),
    'accountExitRequests', (select count(*) from (select 1 from public.private_account_erasure_requests
      where owner_user_id=v_owner limit 1001) as bounded_private_account_erasure_requests)
  ) into v_counts;
  select exists(
    select 1 from jsonb_each_text(v_counts) as entry(k,v)
    where entry.v::integer>1000
  ) into v_capped;
  select jsonb_object_agg(k,least(v::integer,1000))
    into v_counts from jsonb_each_text(v_counts) as entry(k,v);

  v_inventory:=jsonb_build_object(
    'status','METADATA_SNAPSHOT_ONLY','maxCountPerCategory',1000,
    'countsCapped',v_capped,'counts',v_counts,
    'consistency','SINGLE_STATEMENT_MVCC',
    'publicRoutes','UNVERIFIED','objectStorage','METADATA_ONLY',
    'exports','NOT_READY','integrations','NOT_TRACKED',
    'backupRetention','UNVERIFIED','recentReauthVerified',false,
    'publicRevocationVerified',false,'deletionAllowed',false
  );
  insert into public.private_account_exit_inventory_snapshots(
    owner_user_id,operation_id,request_id,schema_version,inventory
  ) values(v_owner,p_operation_id,p_request_id,2,v_inventory)
    returning id,captured_at into v_id,v_captured;
  return jsonb_build_object('snapshotId',v_id,'schemaVersion',2,'requestId',p_request_id,
    'capturedAt',v_captured,'alreadyCaptured',false,
    'inventory',v_inventory,'deletionAllowed',false);
end;
$$;
revoke all on function public.create_private_account_exit_inventory_v2(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.create_private_account_exit_inventory_v2(uuid,uuid)
  to authenticated;
comment on function public.create_private_account_exit_inventory_v2(uuid,uuid) is
  'Creates bounded metadata-only owner snapshot with live GoTrue session. Never exports bytes, authorizes erasure or verifies external storage/host/cache retention.';


create function public.get_private_account_exit_inventory_v2(p_snapshot_id uuid,p_expected_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.private_account_exit_inventory_snapshots%rowtype;
begin
 r:=kadmeion_private.require_inventory_v2(p_snapshot_id,p_expected_request_id);
 return jsonb_build_object('snapshotId',r.id,'schemaVersion',2,'requestId',r.request_id,
   'capturedAt',r.captured_at,'alreadyCaptured',true,'inventory',r.inventory,'deletionAllowed',false);
end;
$$;
revoke all on function public.get_private_account_exit_inventory_v2(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_private_account_exit_inventory_v2(uuid,uuid) to authenticated;


create function public.reconcile_private_account_exit_storage_v2(p_snapshot_id uuid,p_expected_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 r public.private_account_exit_inventory_snapshots%rowtype;
 o uuid; n bigint; p bigint; pr bigint; pp bigint; pb bigint; objects bigint;
 missing bigint; orphans bigint; mismatch bigint; limited boolean; drift boolean; v_result_state text;
begin
 r:=kadmeion_private.require_inventory_v2(p_snapshot_id,p_expected_request_id);
 o:=r.owner_user_id;
 with project_rows as materialized (
   select 'PROJECT'::text scope,id,project_id,object_path,mime_type,byte_size,
     'REGISTERED'::text state,null::uuid storage_id,null::text storage_version
     from public.project_assets where owner_user_id=o order by object_path limit 101
 ), profile_rows as materialized (
   select 'PROFILE'::text scope,id,null::uuid project_id,object_path,mime_type,byte_size,
     state,storage_object_id storage_id,storage_version
     from public.profile_assets where owner_user_id=o order by object_path limit 101
 ), assets as materialized (
   select * from (select * from project_rows union all select * from profile_rows) u
     order by object_path,scope limit 101
 ), stored as materialized (
   select id,name,owner_id,metadata,version::text storage_version
   from storage.objects where bucket_id='kadmeion-private-assets'
     and (split_part(name,'/',1)=o::text or owner_id=o::text or owner=o)
     order by name limit 101
 ), paired as (
   select a.id asset_id,a.scope,a.state,s.name object_name,
     case when a.id is not null and s.name is not null then
       s.owner_id is distinct from o::text or split_part(s.name,'/',1)<>o::text
       or s.storage_version is null or length(s.storage_version) not between 1 and 128
       or lower(s.metadata->>'mimetype') is distinct from a.mime_type
       or (case when coalesce(s.metadata->>'size','')~'^[0-9]{1,10}$'
          then (s.metadata->>'size')::bigint else null end) is distinct from a.byte_size
       or (a.scope='PROJECT' and (split_part(a.object_path,'/',2)<>a.project_id::text
          or a.mime_type not in ('image/png','image/jpeg','image/webp')
          or a.byte_size not between 12 and 5242880
          or a.object_path !~ ('^'||o::text||'/'||a.project_id::text||
            '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]'||
            '(img|'||(case a.mime_type when 'image/png' then 'png' when 'image/jpeg' then 'jpg' else 'webp' end)||')$')))
       or (a.scope='PROFILE' and a.state='REGISTERED'
          and (s.id is distinct from a.storage_id or s.storage_version is distinct from a.storage_version))
     else false end as invalid
   from assets a full outer join stored s on s.name=a.object_path
 )
 select (select count(*) from assets),
   (select count(*) from assets where scope='PROJECT'),
   (select count(*) from assets where scope='PROFILE' and state='REGISTERED'),
   (select count(*) from assets where scope='PROFILE' and state='PENDING_UPLOAD'),
   (select count(*) from paired where scope='PROFILE' and state='PENDING_UPLOAD' and object_name is not null),
   (select count(*) from stored),
   (select count(*) from paired where state='REGISTERED' and object_name is null),
   (select count(*) from paired where asset_id is null and object_name is not null),
   (select count(*) from paired where invalid)
     +(select count(*) from (select object_path from assets group by object_path having count(*)>1) d)
     +(select count(*) from (select id from assets group by id having count(*)>1) d)
 into n,p,pr,pp,pb,objects,missing,orphans,mismatch;
 limited:=n>100 or objects>100;
 drift:=limited or (r.inventory->'counts'->>'projectAssetMetadata')::bigint is distinct from p
   or (r.inventory->'counts'->>'profileAssetMetadata')::bigint is distinct from (pr+pp);
 v_result_state:=case when limited then 'LIMIT_EXCEEDED'
   when drift or pp>0 or missing>0 or orphans>0 or mismatch>0 then 'DISCREPANCY'
   else 'METADATA_MATCH_ONLY' end;
 return jsonb_build_object('snapshotId',r.id,'schemaVersion',2,'requestId',r.request_id,
  'inventoryCapturedAt',r.captured_at,'status',v_result_state,'maxObjectsPerSide',100,'limitExceeded',limited,
  'registeredAssets',least(p+pr,100),'projectRegistered',least(p,100),'profileRegistered',least(pr,100),
  'profilePending',least(pp,100),'profilePendingWithBytes',least(pb,100),'storageObjects',least(objects,100),
  'missingObjects',least(missing,100),'orphanObjects',least(orphans,100),'metadataMismatches',least(mismatch,100),
  'inventoryDrift',drift,'consistency','LIVE_METADATA_NOT_ATOMIC_WITH_INVENTORY',
  'storageBytesVerified',false,'downloadableExportReady',false,'externalProviders','UNVERIFIED',
  'backupRetention','UNVERIFIED','publicRevocationVerified',false,'deletionAllowed',false);
end;
$$;
revoke all on function public.reconcile_private_account_exit_storage_v2(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.reconcile_private_account_exit_storage_v2(uuid,uuid) to authenticated;

create function public.read_private_asset_content_attestations_v2(p_snapshot_id uuid,p_expected_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 r public.private_account_exit_inventory_snapshots%rowtype;
 o uuid; reconciliation jsonb; n integer; matches integer; pins jsonb:='[]'::jsonb; ok boolean:=false;
begin
 r:=kadmeion_private.require_inventory_v2(p_snapshot_id,p_expected_request_id);
 o:=r.owner_user_id;
 reconciliation:=public.reconcile_private_account_exit_storage_v2(p_snapshot_id,p_expected_request_id);
 n:=(reconciliation->>'registeredAssets')::integer;
 if reconciliation->>'status'='METADATA_MATCH_ONLY' then
   with scoped as (
     select 'PROJECT'::text scope,a.id,a.project_id,a.object_path,a.mime_type,a.byte_size,
       t.owner_user_id pin_owner,t.storage_object_id pin_id,t.storage_version pin_version,t.expected_sha256
     from public.project_assets a left join kadmeion_private.private_asset_content_attestations t
       on t.asset_id=a.id where a.owner_user_id=o
     union all
     select 'PROFILE'::text scope,a.id,null::uuid project_id,a.object_path,a.mime_type,a.byte_size,
       t.owner_user_id pin_owner,t.storage_object_id pin_id,t.storage_version pin_version,t.expected_sha256
     from public.profile_assets a left join kadmeion_private.private_profile_asset_content_attestations t
       on t.asset_id=a.id where a.owner_user_id=o and a.state='REGISTERED'
   ), checked as (
     select a.*,s.id is not null and s.id=a.pin_id and s.version::text=a.pin_version
       and a.pin_owner=o and a.expected_sha256~'^[0-9a-f]{64}$' as valid
     from scoped a left join storage.objects s on s.bucket_id='kadmeion-private-assets' and s.name=a.object_path
   )
   select count(*) filter(where valid)::integer,
     coalesce(jsonb_agg(jsonb_build_object('scope',scope,'assetId',id,'projectId',project_id,
       'path',object_path,'objectId',pin_id,'version',pin_version,'mimeType',mime_type,'byteSize',byte_size,
       'expectedSha256',expected_sha256) order by object_path) filter(where valid),'[]'::jsonb)
   into matches,pins from checked;
   ok:=matches=n and jsonb_array_length(pins)=n;
 end if;
 if not ok then pins:='[]'::jsonb; matches:=0; end if;
 return jsonb_build_object('snapshotId',r.id,'schemaVersion',2,'requestId',r.request_id,'ownerUserId',o,
   'status',case when ok then 'SERVER_HASH_PINNED' else 'UNVERIFIED' end,
   'registeredAssets',n,'attestedAssets',coalesce(matches,0),'attestations',pins,
   'providerSigned',false,'deletionAllowed',false);
end;
$$;
revoke all on function public.read_private_asset_content_attestations_v2(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.read_private_asset_content_attestations_v2(uuid,uuid) to authenticated;

create function kadmeion_private.read_private_account_audit_export_v2(p_snapshot_id uuid,p_expected_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare
  v_owner uuid := (select auth.uid());
  v_live_session uuid;
  v_items jsonb;
  v_result jsonb;
  v_category record;
begin
  perform kadmeion_private.require_inventory_v2(p_snapshot_id,p_expected_request_id);
  select jsonb_build_object(
    'reviewerGrants',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id,request_id,portfolio_id,expires_at,revoked_at,created_at
        from public.private_reviewer_grants
        where owner_user_id=v_owner order by created_at,id limit 101
      ) t),'[]'::jsonb),
    'moderationCases',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id,reason_code,summary,status,created_at,updated_at
        from public.private_moderation_cases
        where owner_user_id=v_owner order by created_at,id limit 101
      ) t),'[]'::jsonb),
    'moderationEvents',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select e.id,e.case_id,e.actor_user_id,e.event_type,e.detail,e.created_at
        from public.private_moderation_events e
        where e.owner_user_id=v_owner order by e.created_at,e.id limit 101
      ) t),'[]'::jsonb),
    'accountExitRequests',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id,status,created_at,withdrawn_at,
          public_revocation_verified,reauth_verified,access_terminated,
          erasure_executed,retention_verified
        from public.private_account_erasure_requests
        where owner_user_id=v_owner order by created_at,id limit 101
      ) t),'[]'::jsonb),
    'reauthChallenges',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id,created_at,expires_at,verified_at
        from public.private_account_exit_reauth_challenges
        where owner_user_id=v_owner order by created_at,id limit 101
      ) t),'[]'::jsonb),
    'inventorySnapshots',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id,schema_version,captured_at,inventory
        from public.private_account_exit_inventory_snapshots
        where owner_user_id=v_owner order by captured_at,id limit 101
      ) t),'[]'::jsonb),
    'releasePointers',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select portfolio_id,status,generation,revocation_generation,
          candidate_request_id,candidate_manifest_sha256,updated_at
        from public.private_release_visibility_pointers
        where owner_user_id=v_owner order by updated_at,portfolio_id limit 101
      ) t),'[]'::jsonb),
    'releaseEvents',coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id,portfolio_id,event_type,expected_generation,
          resulting_generation,created_at
        from public.private_release_visibility_events
        where owner_user_id=v_owner order by created_at,id limit 101
      ) t),'[]'::jsonb)
  ) into v_items;
  for v_category in select key,value from jsonb_each(v_items) loop
    if jsonb_array_length(v_category.value)>100 then
      raise exception using errcode='54000',message='ACCOUNT_AUDIT_EXPORT_LIMIT_EXCEEDED';
    end if;
  end loop;
  if octet_length(v_items::text)>1048576 then
    raise exception using errcode='54000',message='ACCOUNT_AUDIT_EXPORT_LIMIT_EXCEEDED';
  end if;
  v_result:=jsonb_build_object(
    'snapshotId',p_snapshot_id,'ownerUserId',v_owner,
    'status','BOUNDED_OWNER_AUDIT','maxRowsPerCategory',100,
    'categories',v_items,'tokenDigestsIncluded',false,
    'sessionsIncluded',false,'completeAccountExport',false,
    'deletionAllowed',false);
  return v_result;
end;
$function$;
revoke all on function kadmeion_private.read_private_account_audit_export_v2(uuid,uuid) from public,anon,authenticated,service_role;

create function public.owner_export_account_metadata_v2(p_snapshot_id uuid,p_expected_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_table text;
  v_key text;
  v_rows jsonb;
  v_records jsonb := '{}'::jsonb;
  v_releases jsonb;
  v_audit jsonb;
  v_result jsonb;
begin
  perform kadmeion_private.require_inventory_v2(p_snapshot_id,p_expected_request_id);
  for v_table,v_key in select * from (values
    ('profiles','user_id'),('profile_assets','owner_user_id'),('profile_sharing_preferences','user_id'),
    ('private_onboarding_steps','user_id'),('projects','owner_user_id'),
    ('project_exposure_intents','owner_user_id'),('portfolios','owner_user_id'),
    ('portfolio_revisions','owner_user_id'),('project_assets','owner_user_id'),
    ('private_release_requests','owner_user_id'),('private_trash_items','owner_user_id'),
    ('private_platform_links','owner_user_id'),('private_goals','owner_user_id'),
    ('private_goal_progress_events','owner_user_id'),('private_goal_milestones','owner_user_id'),
    ('private_notification_preferences','owner_user_id'),
    ('private_my_component_versions','owner_user_id')
  ) as allowed(table_name,owner_column)
  loop
    -- Neither the table nor identifiers come from request parameters.
    if v_table='private_my_component_versions' then
      select coalesce(jsonb_agg(to_jsonb(cv)),'[]'::jsonb) into v_rows from (
        select id,owner_user_id,component_key,version,display_name,base_component_pin,
          pristine_source,source_code,compatible_slot_kinds,source_sha256,created_at
        from public.private_my_component_versions where owner_user_id=v_owner
        order by component_key,version,id limit 41
      ) cv;
      if jsonb_array_length(v_rows)>40 then
        raise exception using errcode='54000',message='ACCOUNT_METADATA_EXPORT_LIMIT_EXCEEDED';
      end if;
    else
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(item)), ''[]''::jsonb) from
         (select * from public.%I where %I=$1 limit 101) item',v_table,v_key)
      into v_rows using v_owner;
    end if;
    if v_table='profiles' then
      select coalesce(jsonb_agg(item-array['avatar_last_operation_id','avatar_last_base_revision']),'[]'::jsonb)
        into v_rows from jsonb_array_elements(v_rows) entry(item);
    end if;
    if jsonb_array_length(v_rows)>100 or octet_length(v_rows::text)>8388608 then
      raise exception using errcode='54000',message='ACCOUNT_METADATA_EXPORT_LIMIT_EXCEEDED';
    end if;
    v_records:=v_records||jsonb_build_object(v_table,v_rows);
    if octet_length(v_records::text)>10485760 then
      raise exception using errcode='54000',message='ACCOUNT_METADATA_EXPORT_LIMIT_EXCEEDED';
    end if;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb) into v_rows from (
    select id,owner_user_id,event_type,category,priority,target_id,created_at,read_at,dismissed_at
    from public.private_notifications where owner_user_id=v_owner limit 101
  ) n;
  if jsonb_array_length(v_rows)>100 then
    raise exception using errcode='54000',message='ACCOUNT_METADATA_EXPORT_LIMIT_EXCEEDED';
  end if;
  v_records:=v_records||jsonb_build_object('private_notifications',v_rows);
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_releases from (
    select verified.intent_id,verified.portfolio_id,verified.request_id,verified.stage_generation,
      verified.html_sha256,verified.verified_at,consent.public_handle,consent.public_slug,
      consent.rollback_target_id
    from public.verified_unlisted_releases verified
    join public.private_unlisted_publication_intents consent on consent.id=verified.intent_id
      and consent.owner_user_id=verified.owner_user_id
    where verified.owner_user_id=v_owner order by verified.verified_at,verified.intent_id limit 101
  ) r;
  if jsonb_array_length(v_releases)>100 then
    raise exception using errcode='54000',message='ACCOUNT_METADATA_EXPORT_LIMIT_EXCEEDED';
  end if;
  v_audit:=kadmeion_private.read_private_account_audit_export_v2(p_snapshot_id,p_expected_request_id);
  v_result:=jsonb_build_object('status','APPLICATION_METADATA_SNAPSHOT','schemaVersion',2,'requestId',p_expected_request_id,
    'snapshotId',p_snapshot_id,'ownerUserId',v_owner,'capturedAt',statement_timestamp(),
    'records',v_records,'restrictedAudit',v_audit->'categories','verifiedReleaseHistory',v_releases,
    'storageBytesIncluded',false,'providerDataIncluded',false,'deletionAllowed',false);
  if octet_length(v_result::text)>12582912 then
    raise exception using errcode='54000',message='ACCOUNT_METADATA_EXPORT_LIMIT_EXCEEDED';
  end if;
  return v_result;
end;
$$;

revoke all on function public.owner_export_account_metadata_v2(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.owner_export_account_metadata_v2(uuid,uuid) to authenticated;
