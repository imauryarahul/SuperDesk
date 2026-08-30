import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { articleExcerpt } from '@/lib/kb-html'
import {
  getPublicCategories,
  getPublicWorkspace,
  listPublishedArticles,
  searchPublishedArticles,
  type PublicArticleSummary,
} from '@/lib/kb-public'

import { KbHeader, KbShell } from '../kb-shell'

const SEARCH_LIMIT = 20

type Props = {
  params: { workspaceSlug: string }
  searchParams: { q?: string }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const workspace = await getPublicWorkspace(params.workspaceSlug)
  return workspace ? { title: `${workspace.name} Help Centre` } : { title: 'Not found' }
}

export default async function PublicKbPage({ params, searchParams }: Props) {
  const workspace = await getPublicWorkspace(params.workspaceSlug)
  if (!workspace) notFound()

  const query = searchParams.q?.trim() ?? ''

  const [categories, articles] = await Promise.all([
    getPublicCategories(workspace.id),
    query
      ? searchPublishedArticles(workspace.id, query, SEARCH_LIMIT)
      : listPublishedArticles(workspace.id),
  ])

  return (
    <KbShell>
      <KbHeader workspace={workspace} />

      <form method="get" className="mt-8">
        <label htmlFor="kb-search" className="sr-only">
          Search help articles
        </label>
        <input
          id="kb-search"
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search help articles…"
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
        />
      </form>

      {query ? (
        <SearchResults workspaceSlug={workspace.slug} query={query} articles={articles} />
      ) : (
        <CategoryList
          workspaceSlug={workspace.slug}
          categories={categories}
          articles={articles}
        />
      )}
    </KbShell>
  )
}

function SearchResults({
  workspaceSlug,
  query,
  articles,
}: {
  workspaceSlug: string
  query: string
  articles: PublicArticleSummary[]
}) {
  return (
    <section className="mt-8">
      <p className="text-sm text-slate-500">
        {articles.length === 0
          ? `No articles match “${query}”.`
          : `${articles.length} ${articles.length === 1 ? 'result' : 'results'} for “${query}”`}
      </p>
      <ul className="mt-4 space-y-3">
        {articles.map((article) => (
          <li key={article.id}>
            <ArticleCard workspaceSlug={workspaceSlug} article={article} />
          </li>
        ))}
      </ul>
      {articles.length === 0 ? (
        <Link
          href={`/kb/${workspaceSlug}`}
          className="mt-4 inline-block text-sm font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900"
        >
          Browse all articles
        </Link>
      ) : null}
    </section>
  )
}

function CategoryList({
  workspaceSlug,
  categories,
  articles,
}: {
  workspaceSlug: string
  categories: { id: string; name: string }[]
  articles: PublicArticleSummary[]
}) {
  const uncategorised = articles.filter((a) => a.categoryId === null)

  // Only categories that actually hold a published article are worth a heading.
  // The anon policy already hides empty ones, but an article whose category was
  // deleted still has to land somewhere.
  const groups = categories
    .map((category) => ({
      ...category,
      articles: articles.filter((a) => a.categoryId === category.id),
    }))
    .filter((group) => group.articles.length > 0)

  if (articles.length === 0) {
    return (
      <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
        This help centre has no published articles yet.
      </div>
    )
  }

  return (
    <div className="mt-8 space-y-10">
      {groups.map((group) => (
        <section key={group.id}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {group.name}
          </h2>
          <ul className="mt-3 space-y-3">
            {group.articles.map((article) => (
              <li key={article.id}>
                <ArticleCard workspaceSlug={workspaceSlug} article={article} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {uncategorised.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Other articles
          </h2>
          <ul className="mt-3 space-y-3">
            {uncategorised.map((article) => (
              <li key={article.id}>
                <ArticleCard workspaceSlug={workspaceSlug} article={article} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function ArticleCard({
  workspaceSlug,
  article,
}: {
  workspaceSlug: string
  article: PublicArticleSummary
}) {
  return (
    <Link
      href={`/kb/${workspaceSlug}/${article.slug}`}
      className="block rounded-xl border border-slate-200 bg-white px-5 py-4 transition hover:border-slate-300 hover:shadow-sm"
    >
      <h3 className="text-sm font-medium text-slate-900">{article.title}</h3>
      <p className="mt-1 text-sm text-slate-500">{articleExcerpt(article.body)}</p>
    </Link>
  )
}
