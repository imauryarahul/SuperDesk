-- Slug column defaults and trigger fixes.
--
-- The initial slug migration left triggers that skipped derivation when slug was
-- already set, which blocked the NOT NULL + DEFAULT pattern PostgREST needs for
-- generated Insert types. Defaults are placeholders the triggers overwrite;
-- derivation stays in one place.

alter table public.workspaces alter column slug set default 'workspace';
alter table public.kb_articles alter column slug set default 'article';

create or replace function private.set_workspace_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_candidate text;
  v_suffix int := 1;
begin
  -- Derived on insert and never regenerated on rename: the slug is the public
  -- KB URL, and silently breaking every inbound link on a rename is worse than
  -- a slug that no longer matches the display name.
  v_base := left(coalesce(private.slugify(new.name), 'workspace'), 80);
  v_candidate := v_base;

  while exists (
    select 1 from public.workspaces
    where slug = v_candidate and id is distinct from new.id
  ) loop
    v_suffix := v_suffix + 1;
    v_candidate := v_base || '-' || v_suffix;
  end loop;

  new.slug := v_candidate;
  return new;
end;
$$;

create or replace function private.set_kb_article_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_candidate text;
  v_suffix int := 1;
begin
  -- Derived on insert, regenerated while the article is still a draft, frozen
  -- once it has been published: a published slug is a live URL, and retitling
  -- should not 404 every link to it.
  if tg_op = 'UPDATE' and (new.title = old.title or old.published) then
    new.slug := old.slug;
    return new;
  end if;

  v_base := left(coalesce(private.slugify(new.title), 'article'), 80);
  v_candidate := v_base;

  while exists (
    select 1 from public.kb_articles
    where workspace_id = new.workspace_id
      and slug = v_candidate
      and id is distinct from new.id
  ) loop
    v_suffix := v_suffix + 1;
    v_candidate := v_base || '-' || v_suffix;
  end loop;

  new.slug := v_candidate;
  return new;
end;
$$;
