import Link from 'next/link'

import { requireWorkspace } from '@/lib/auth'
import { articleExcerpt } from '@/lib/kb-html'
import { createClient } from '@/lib/supabase/server'

import { createArticleAction } from './actions'
import { CategoryManager, type CategoryRow } from './category-manager'

export const metadata = { title: 'Knowledge Base · SuperDesk' }

export default async function KnowledgeBasePage() {
  const { workspace } = await requireWorkspace()
  // Read through the user's session so RLS, not this query, is what confines
  // the result to one workspace.
  const supabase = createClient()

  const [{ data: categories }, { data: articles }] = await Promise.all([
    supabase.from('kb_categories').select('id, name').order('name'),
    supabase
      .from('kb_articles')
      .select('id, title, slug, body, published, category_id, updated_at')
      .order('updated_at', { ascending: false })
      .limit(500),
  ])

  const categoryNames = new Map((categories ?? []).map((c) => [c.id, c.name]))

  // Counted from the list we already have rather than a second aggregate query.
  const articleCounts = new Map<string, number>()
  for (const article of articles ?? []) {
    if (!article.category_id) continue
    articleCounts.set(article.category_id, (articleCounts.get(article.category_id) ?? 0) + 1)
  }

  const categoryRows: CategoryRow[] = (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    articleCount: articleCounts.get(c.id) ?? 0,
  }))

  const publishedCount = (articles ?? []).filter((a) => a.published).length

  return (
    <div className="flex-1 overflow-y-auto px-10 py-10">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Knowledge Base</h1>
            <p className="mt-1 text-sm text-slate-500">
              Help articles, organised into categories.{' '}
              {publishedCount > 0 ? (
                <>
                  {publishedCount} published and live at{' '}
                  <Link
                    href={`/kb/${workspace.slug}`}
                    target="_blank"
                    className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900"
                  >
                    /kb/{workspace.slug}
                  </Link>
                  .
                </>
              ) : (
                'Nothing is published yet, so the public help centre is empty.'
              )}
            </p>
          </div>
          <form action={createArticleAction}>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              New article
            </button>
          </form>
        </header>

        <CategoryManager categories={categoryRows} />

        <section>
          <h2 className="text-sm font-semibold text-slate-900">Articles</h2>

          {articles && articles.length > 0 ? (
            <ul className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {articles.map((article) => (
                <li key={article.id}>
                  <Link
                    href={`/knowledge-base/${article.id}`}
                    className="block px-5 py-4 transition hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-900">
                        {article.title}
                      </span>
                      <StatusBadge published={article.published} />
                    </div>
                    <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                      {articleExcerpt(article.body, 120) || 'No content yet.'}
                    </p>
                    <p className="mt-1.5 text-xs text-slate-400">
                      {article.category_id
                        ? categoryNames.get(article.category_id)
                        : 'Uncategorised'}
                      {' · edited '}
                      {new Date(article.updated_at).toLocaleDateString()}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
              No articles yet. Create one to start your help centre.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function StatusBadge({ published }: { published: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
        published ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
      }`}
    >
      {published ? 'Published' : 'Draft'}
    </span>
  )
}
