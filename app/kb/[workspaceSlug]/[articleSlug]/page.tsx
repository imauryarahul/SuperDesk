import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { articleExcerpt } from '@/lib/kb-html'
import { getPublicWorkspace, getPublishedArticle } from '@/lib/kb-public'

import { KbHeader, KbShell } from '../../kb-shell'

type Props = { params: { workspaceSlug: string; articleSlug: string } }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const workspace = await getPublicWorkspace(params.workspaceSlug)
  if (!workspace) return { title: 'Not found' }

  const article = await getPublishedArticle(workspace.id, params.articleSlug)
  if (!article) return { title: 'Not found' }

  return {
    title: `${article.title} · ${workspace.name}`,
    description: articleExcerpt(article.body),
  }
}

export default async function PublicArticlePage({ params }: Props) {
  const workspace = await getPublicWorkspace(params.workspaceSlug)
  if (!workspace) notFound()

  const article = await getPublishedArticle(workspace.id, params.articleSlug)
  // A draft and a typo are the same 404 here. Distinguishing them would tell an
  // anonymous visitor that an unpublished article exists at this slug.
  if (!article) notFound()

  return (
    <KbShell>
      <KbHeader workspace={workspace} breadcrumb="Help article" />

      <article className="mt-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{article.title}</h1>
        <p className="mt-1 text-xs text-slate-400">
          Updated {new Date(article.updatedAt).toLocaleDateString()}
        </p>
        {/*
          The body was sanitised against a nine-tag allowlist when it was saved
          (lib/kb-html.ts), so what is stored is already safe to inject. Doing it
          on write rather than here means every consumer inherits the guarantee.
        */}
        <div
          className="kb-article mt-8"
          dangerouslySetInnerHTML={{ __html: article.body }}
        />
      </article>

      <Link
        href={`/kb/${workspace.slug}`}
        className="mt-12 inline-block text-sm font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900"
      >
        ← Back to all articles
      </Link>
    </KbShell>
  )
}
