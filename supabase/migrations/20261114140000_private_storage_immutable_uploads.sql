-- B5 integrity hardening: registered private assets use write-once object paths.
-- Owner replacements must upload a NEW path, verify its metadata, then update
-- application references via an authorized workflow. Supabase Storage does not
-- provide immutable version-addressable downloads for these private objects.
-- Removing our own UPDATE policy prevents owner upserts/replacements in place;
-- the Storage schema itself is unchanged. No DELETE policy is granted.
drop policy if exists kd_storage_private_update on storage.objects;

comment on policy kd_storage_private_insert on storage.objects is
  'Owner may create private objects under own prefix; no in-place owner overwrite or DELETE. Use a fresh path for replacement.';
