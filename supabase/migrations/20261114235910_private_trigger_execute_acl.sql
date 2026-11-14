-- The trigger function was created by the private asset attestation
-- migration with PostgreSQL's default EXECUTE grant to PUBLIC. A later
-- CREATE OR REPLACE preserved that grant. It must be inaccessible to any
-- browser or service-role RPC caller; triggers continue to execute as owner.
revoke all on function kadmeion_private.reject_private_asset_attestation_mutation()
  from PUBLIC,anon,authenticated,service_role;

-- Explicitly prevent newly created private functions from inheriting the
-- default PUBLIC EXECUTE grant when future migrations run as postgres.
alter default privileges for role postgres in schema kadmeion_private
  revoke execute on functions from PUBLIC;
