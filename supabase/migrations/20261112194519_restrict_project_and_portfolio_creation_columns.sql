-- B1/B2/B3: constrain client INSERT to fields that callers actually supply.
-- Prevent forged initial portfolio heads, project revisions and creation timestamps.
revoke insert on public.portfolios from authenticated;
grant insert (owner_user_id, slug, title, template_id) on public.portfolios to authenticated;
revoke insert on public.projects from authenticated;
grant insert (owner_user_id, slug, title, summary, description, repository_url, live_url) on public.projects to authenticated;
revoke insert on public.project_assets from authenticated;
grant insert (project_id, owner_user_id, object_path, mime_type, byte_size, alt_text) on public.project_assets to authenticated;

