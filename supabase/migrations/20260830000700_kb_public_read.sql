-- Public knowledge base: anonymous read access to published articles.
--
-- Every policy up to this point keys off private.current_workspace_id(), which
-- resolves through auth.uid(). An anonymous visitor has no uid, so none of them
-- can ever grant it a row — which is why this is a new policy per table rather
-- than a change to an existing one. The authenticated policies are untouched.
--
-- Two independent gates, because RLS alone is a single point of failure:
--
--   1. Column privileges. `anon` is granted SELECT on named columns only, so a
--      leak in the row filter still cannot expose workspaces.inbound_token or
--      workspaces.allowed_widget_domains. There is no INSERT/UPDATE/DELETE
--      grant at all, so the policies below cannot be abused to write.
--   2. Row policies. Published articles, the categories that contain at least
--      one, and the workspaces that own at least one.
--
-- Scoping by workspace inside the policy is not possible and would not help: an
-- anonymous request carries no workspace identity for the policy to compare
-- against, and a published article is world-readable by definition, so reading
-- it "through the wrong workspace's page" discloses nothing that its own page
-- would not. The workspace scoping lives where the workspace is actually known
-- — the route resolves the slug and filters on workspace_id — and the policies
-- guarantee the part that matters: published rows only, and nothing else.

-- ---------------------------------------------------------------------------
-- Column privileges
-- ---------------------------------------------------------------------------

-- Enough to render the help centre header and resolve /kb/[workspaceSlug].
grant select (id, name, slug) on public.workspaces to anon;

grant select (id, workspace_id, name) on public.kb_categories to anon;

-- search_vector is included because Postgres requires SELECT on every column a
-- query references, including in WHERE — the full-text filter reads it.
grant select (
  id, workspace_id, category_id, title, slug, body, published,
  search_vector, created_at, updated_at
) on public.kb_articles to anon;

-- ---------------------------------------------------------------------------
-- Row policies
-- ---------------------------------------------------------------------------

create policy kb_articles_public_read on public.kb_articles
  for select to anon
  using (published);

-- A category is public only once something published lives in it, so draft-only
-- and internal categories never appear in the public navigation. The subquery is
-- itself subject to kb_articles_public_read, so it can only ever see published
-- rows.
create policy kb_categories_public_read on public.kb_categories
  for select to anon
  using (
    exists (
      select 1
      from public.kb_articles a
      where a.category_id = kb_categories.id
        and a.workspace_id = kb_categories.workspace_id
    )
  );

-- Same rule one level up: a workspace with no published articles has no public
-- help centre and is not discoverable by slug enumeration.
create policy workspaces_public_read on public.workspaces
  for select to anon
  using (
    exists (
      select 1
      from public.kb_articles a
      where a.workspace_id = workspaces.id
    )
  );

-- Supports the exists() checks above.
create index kb_articles_category_published_idx
  on public.kb_articles (category_id, published)
  where published;
