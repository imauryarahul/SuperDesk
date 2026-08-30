-- Ranked knowledge base search.
--
-- This is an RPC rather than a PostgREST filter because PostgREST cannot order
-- by an expression it did not select, and unranked full-text results are close
-- to useless: the widget shows three suggestions, so which three matters more
-- than that some matched. Both callers (public help centre, widget suggest)
-- share this one implementation.
--
-- SECURITY INVOKER — the default — is the whole point. Called by `anon` it runs
-- under kb_articles_public_read and can only see published rows; called by a
-- team member it runs under the workspace policy. The explicit `published`
-- filter below is redundant for anon and load-bearing for authenticated
-- callers, who otherwise would get their own drafts back.

create or replace function public.search_kb_articles(
  p_workspace_id uuid,
  p_query text,
  p_limit int default 10
)
returns table (
  id uuid,
  slug text,
  title text,
  body text,
  category_id uuid
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_terms text;
  v_query tsquery;
begin
  -- Strip everything that is not a letter, digit or space before building the
  -- tsquery. to_tsquery has its own operator syntax (& | ! <-> parentheses) and
  -- raises a syntax error on malformed input, so a raw user string would be
  -- both a 500 and an injection surface. Tokens are AND-ed with a prefix match
  -- on each, which is what makes the widget useful while someone is still
  -- typing ("passw" matches "password").
  select string_agg(t || ':*', ' & ')
  into v_terms
  from unnest(
    regexp_split_to_array(
      btrim(regexp_replace(lower(coalesce(p_query, '')), '[^a-z0-9]+', ' ', 'g')),
      '\s+'
    )
  ) as t
  where t <> '';

  if v_terms is null then
    return;
  end if;

  v_query := to_tsquery('english', v_terms);

  return query
  select a.id, a.slug, a.title, a.body, a.category_id
  from public.kb_articles a
  where a.workspace_id = p_workspace_id
    and a.published
    and a.search_vector @@ v_query
  order by ts_rank(a.search_vector, v_query) desc, a.updated_at desc
  limit least(greatest(p_limit, 1), 50);
end;
$$;

grant execute on function public.search_kb_articles(uuid, text, int) to anon, authenticated;
