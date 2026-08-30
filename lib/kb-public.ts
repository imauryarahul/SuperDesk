import 'server-only'

import { createAnonClient } from '@/lib/supabase/anon'

/**
 * Every public read of the knowledge base goes through this module, so
 * "published only" is enforced in one place instead of being re-derived by each
 * caller. Three layers have to agree before an unpublished article could ever
 * escape:
 *
 *   1. these queries filter on published = true,
 *   2. they run as `anon`, whose only policy on kb_articles is `using (published)`,
 *   3. `anon` has no grant at all on the columns that are not needed here.
 */

export type PublicWorkspace = { id: string; name: string; slug: string }

export type PublicArticleSummary = {
  id: string
  slug: string
  title: string
  body: string
  categoryId: string | null
}

export type PublicArticle = PublicArticleSummary & { updatedAt: string }

export type PublicCategory = { id: string; name: string }

export async function getPublicWorkspace(slug: string): Promise<PublicWorkspace | null> {
  const { data } = await createAnonClient()
    .from('workspaces')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle()

  return data
}

/** By id, for the widget, which knows its workspace id but not its slug. */
export async function getPublicWorkspaceById(id: string): Promise<PublicWorkspace | null> {
  const { data } = await createAnonClient()
    .from('workspaces')
    .select('id, name, slug')
    .eq('id', id)
    .maybeSingle()

  return data
}

export async function getPublicCategories(workspaceId: string): Promise<PublicCategory[]> {
  const { data } = await createAnonClient()
    .from('kb_categories')
    .select('id, name')
    .eq('workspace_id', workspaceId)
    .order('name')

  return data ?? []
}

export async function listPublishedArticles(
  workspaceId: string,
): Promise<PublicArticleSummary[]> {
  const { data } = await createAnonClient()
    .from('kb_articles')
    .select('id, slug, title, body, category_id')
    .eq('workspace_id', workspaceId)
    .eq('published', true)
    .order('title')

  return (data ?? []).map(toSummary)
}

/**
 * Ranked full-text search. The RPC runs SECURITY INVOKER as `anon`, so the same
 * policy that guards the listing guards the search results.
 */
export async function searchPublishedArticles(
  workspaceId: string,
  query: string,
  limit: number,
): Promise<PublicArticleSummary[]> {
  const { data, error } = await createAnonClient().rpc('search_kb_articles', {
    p_workspace_id: workspaceId,
    p_query: query,
    p_limit: limit,
  })

  if (error) {
    console.error('[kb] search failed:', error.message)
    return []
  }

  return (data ?? []).map(toSummary)
}

export async function getPublishedArticle(
  workspaceId: string,
  slug: string,
): Promise<PublicArticle | null> {
  const { data } = await createAnonClient()
    .from('kb_articles')
    .select('id, slug, title, body, category_id, updated_at')
    .eq('workspace_id', workspaceId)
    .eq('slug', slug)
    .eq('published', true)
    .maybeSingle()

  return data ? { ...toSummary(data), updatedAt: data.updated_at } : null
}

function toSummary(row: {
  id: string
  slug: string
  title: string
  body: string
  category_id: string | null
}): PublicArticleSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    categoryId: row.category_id,
  }
}
