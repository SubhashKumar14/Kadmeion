-- Assert browser clients may create owned records but cannot forge server-managed columns.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;
select plan(10);
select ok(has_column_privilege('authenticated','public.portfolios','owner_user_id','INSERT'),'can create owned portfolio');
select ok(has_column_privilege('authenticated','public.portfolios','title','INSERT'),'can set portfolio title');
select ok(not has_column_privilege('authenticated','public.portfolios','head_revision','INSERT'),'cannot forge portfolio head');
select ok(not has_column_privilege('authenticated','public.portfolios','created_at','INSERT'),'cannot forge portfolio creation');
select ok(has_column_privilege('authenticated','public.projects','title','INSERT'),'can create private project');
select ok(not has_column_privilege('authenticated','public.projects','revision','INSERT'),'cannot forge project revision');
select ok(not has_column_privilege('authenticated','public.projects','updated_at','INSERT'),'cannot forge update timestamp');
select ok(has_column_privilege('authenticated','public.project_assets','object_path','INSERT'),'can add owned image reference');
select ok(not has_column_privilege('authenticated','public.project_assets','created_at','INSERT'),'cannot forge asset creation timestamp');
select ok(not has_column_privilege('authenticated','public.portfolio_revisions','snapshot','INSERT'),'no direct revision creation');
select * from finish();
rollback;
