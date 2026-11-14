-- P0 route isolation: match the already-approved reserved public path prefixes.
-- Keep historic identities unchanged. NOT VALID permits detection/remediation
-- of any existing collisions rather than silently renaming the owner's handle;
-- every future INSERT/UPDATE is checked. Public HTTP also denies these routes.
alter table public.profiles
  add constraint kd_reserved_portfolio_route_handles
  check (
    handle is null or
    handle not in ('app','signin','register','workspace','status','r')
  ) not valid;
comment on constraint kd_reserved_portfolio_route_handles on public.profiles is
  'Owner route names remain reserved for application navigation. Existing collisions must be reviewed before a separately authorized validation.';
