import { appUrl } from '@/lib/env'
import { articleExcerpt } from '@/lib/kb-html'
import { getPublicWorkspaceById, searchPublishedArticles } from '@/lib/kb-public'
import { checkRateLimit, getRequestIp, rateLimitedResponse } from '@/lib/rate-limit'
import { checkWidgetOrigin, corsHeaders, handlePreflight } from '@/lib/widget-cors'

/** The composer shows at most three suggestions; no caller needs more. */
const MAX_RESULTS = 3
const MIN_QUERY_LENGTH = 3
const MAX_QUERY_LENGTH = 200

export async function OPTIONS(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? ''
  return (await handlePreflight(req, workspaceId)) ?? new Response(null, { status: 405 })
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const workspaceId = searchParams.get('workspaceId') ?? ''

  // Same Origin allowlist as every other widget route: a workspace's widget
  // only answers from the domains that workspace registered.
  const check = await checkWidgetOrigin(req, workspaceId)
  if (!check.ok) return check.response

  // A visitor typing at speed produces roughly two requests a second even with
  // the 300 ms debounce, so this is set high enough not to trip a fast typist
  // and low enough to stop the route being used as a free search API.
  const ip = getRequestIp(req)
  const allowed = await checkRateLimit(ip, `ws:${workspaceId}:kb`, 60, 60)
  if (!allowed) return rateLimitedResponse(check.origin)

  const query = (searchParams.get('q') ?? '').trim()

  // Below the minimum the widget should not have called at all; answering with
  // an empty list rather than a 400 keeps the client's error path for real
  // failures.
  if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) {
    return reply({ articles: [] }, 200, check.origin)
  }

  const workspace = await getPublicWorkspaceById(workspaceId)
  // Reachable when the workspace has nothing published: the anon policy hides
  // it, and there is nothing to suggest anyway.
  if (!workspace) return reply({ articles: [] }, 200, check.origin)

  // Reads as `anon` through the shared published-only helper, so this route
  // cannot return a draft even if the query were wrong.
  const articles = await searchPublishedArticles(workspaceId, query, MAX_RESULTS)

  return reply(
    {
      articles: articles.map((article) => ({
        title: article.title,
        excerpt: articleExcerpt(article.body, 100),
        url: `${appUrl()}/kb/${workspace.slug}/${article.slug}`,
      })),
    },
    200,
    check.origin,
  )
}

function reply(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}
