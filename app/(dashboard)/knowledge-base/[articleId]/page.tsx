import { notFound } from 'next/navigation'

import { requireWorkspace } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

import { ArticleEditor } from './article-editor'

export const metadata = { title: 'Edit article · SuperDesk' }

export default async function ArticlePage({ params }: { params: { articleId: string } }) {
  const { workspace } = await requireWorkspace()
  const supabase = createClient()

  const [{ data: article }, { data: categories }] = await Promise.all([
    supabase
      .from('kb_articles')
      .select('id, title, body, slug, published, category_id')
      // Redundant next to RLS, but it makes the tenant scope of this read
      // visible at the call site rather than only in a policy file.
      .eq('workspace_id', workspace.id)
      .eq('id', params.articleId)
      .maybeSingle(),
    supabase.from('kb_categories').select('id, name').order('name'),
  ])

  if (!article) notFound()

  return (
    <ArticleEditor
      article={article}
      categories={categories ?? []}
      workspaceSlug={workspace.slug}
    />
  )
}
