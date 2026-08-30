'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { requireWorkspace } from '@/lib/auth'
import { ActionError, toFormError, type FormState } from '@/lib/forms'
import { sanitizeArticleHtml } from '@/lib/kb-html'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Authoring is open to admins and agents alike, matching the existing KB RLS
 * policy and the phase 1 decision that role gates workspace administration
 * rather than data. An agent answering the same question for the tenth time is
 * the person best placed to write the article, and gating publish behind an
 * admin would just route every article through a bottleneck with no reviewer
 * workflow to make the gate mean anything. Category management is treated the
 * same way: it is content structure, not configuration.
 *
 * Mutations go through the admin client with an explicit workspace_id filter on
 * every statement, the same pattern as the inbox actions. RLS remains the
 * backstop for anything that reads with a user session.
 */

const MAX_BODY = 100_000

const titleSchema = z
  .string()
  .trim()
  .min(1, 'Give the article a title.')
  .max(200, 'Titles are limited to 200 characters.')

const categoryNameSchema = z
  .string()
  .trim()
  .min(1, 'Give the category a name.')
  .max(100, 'Category names are limited to 100 characters.')

const uuid = z.string().uuid()

const saveArticleSchema = z.object({
  articleId: uuid,
  title: titleSchema,
  body: z.string().max(MAX_BODY, 'This article is too long to save.'),
  // An empty select value means "uncategorised", which is a null FK.
  categoryId: z.union([uuid, z.literal('')]).transform((v) => (v === '' ? null : v)),
  published: z.coerce.boolean(),
})

export type SaveArticleResult = { error: string | null; savedAt?: string }

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

/**
 * Creates an empty draft and redirects into the editor, rather than showing a
 * blank "new article" form that has to POST before it has an id. The editor
 * then only ever deals with an article that exists, so autosave, the published
 * toggle and the slug all work from the first keystroke.
 */
export async function createArticleAction(): Promise<void> {
  const { workspace } = await requireWorkspace()

  const { data, error } = await createAdminClient()
    .from('kb_articles')
    .insert({ workspace_id: workspace.id, title: 'Untitled article', body: '' })
    .select('id')
    .single()

  if (error) throw error

  revalidatePath('/knowledge-base')
  redirect(`/knowledge-base/${data.id}`)
}

export async function saveArticleAction(input: {
  articleId: string
  title: string
  body: string
  categoryId: string
  published: boolean
}): Promise<SaveArticleResult> {
  try {
    const { workspace } = await requireWorkspace()
    const parsed = saveArticleSchema.safeParse(input)
    if (!parsed.success) {
      throw new ActionError(parsed.error.issues[0]?.message ?? 'Check the article and try again.')
    }
    const { articleId, title, body, categoryId, published } = parsed.data

    const admin = createAdminClient()

    // The composite FK would reject a foreign category anyway, but the error it
    // raises is a constraint name. Checking here produces a sentence.
    if (categoryId) {
      const { data: category } = await admin
        .from('kb_categories')
        .select('id')
        .eq('id', categoryId)
        .eq('workspace_id', workspace.id)
        .maybeSingle()

      if (!category) throw new ActionError('That category does not belong to this workspace.')
    }

    const { data, error } = await admin
      .from('kb_articles')
      .update({
        title,
        body: sanitizeArticleHtml(body),
        category_id: categoryId,
        published,
      })
      .eq('id', articleId)
      .eq('workspace_id', workspace.id)
      .select('updated_at')
      .maybeSingle()

    if (error) throw error
    if (!data) throw new ActionError('That article no longer exists.')

    revalidatePath('/knowledge-base')
    return { error: null, savedAt: data.updated_at }
  } catch (error) {
    return toFormError(error, 'saveArticleAction')
  }
}

export async function deleteArticleAction(formData: FormData): Promise<void> {
  const { workspace } = await requireWorkspace()

  const articleId = uuid.safeParse(formData.get('articleId'))
  if (!articleId.success) throw new ActionError('Invalid article.')

  const { error } = await createAdminClient()
    .from('kb_articles')
    .delete()
    .eq('id', articleId.data)
    .eq('workspace_id', workspace.id)

  if (error) throw error

  revalidatePath('/knowledge-base')
  redirect('/knowledge-base')
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function createCategoryAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { workspace } = await requireWorkspace()

    const parsed = categoryNameSchema.safeParse(formData.get('name'))
    if (!parsed.success) throw new ActionError(parsed.error.issues[0]?.message ?? 'Invalid name.')

    const { error } = await createAdminClient()
      .from('kb_categories')
      .insert({ workspace_id: workspace.id, name: parsed.data })

    if (error) throw error

    revalidatePath('/knowledge-base')
    return { error: null }
  } catch (error) {
    return toFormError(error, 'createCategoryAction')
  }
}

export async function renameCategoryAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { workspace } = await requireWorkspace()

    const categoryId = uuid.safeParse(formData.get('categoryId'))
    if (!categoryId.success) throw new ActionError('Invalid category.')

    const parsed = categoryNameSchema.safeParse(formData.get('name'))
    if (!parsed.success) throw new ActionError(parsed.error.issues[0]?.message ?? 'Invalid name.')

    const { data, error } = await createAdminClient()
      .from('kb_categories')
      .update({ name: parsed.data })
      .eq('id', categoryId.data)
      .eq('workspace_id', workspace.id)
      .select('id')
      .maybeSingle()

    if (error) throw error
    if (!data) throw new ActionError('That category no longer exists.')

    revalidatePath('/knowledge-base')
    return { error: null }
  } catch (error) {
    return toFormError(error, 'renameCategoryAction')
  }
}

/**
 * Deleting a category never deletes articles. The FK is
 * `on delete set null (category_id)`, so the rows survive as uncategorised and
 * a published article stays published and reachable at its own URL.
 *
 * Chosen over blocking the delete because the destructive-sounding action is
 * the reversible one: reassigning a handful of articles to a new category takes
 * seconds, whereas forcing an empty-the-category-first dance to remove a
 * mistyped name is friction with no payoff. The confirmation prompt names the
 * article count so the outcome is not a surprise.
 */
export async function deleteCategoryAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { workspace } = await requireWorkspace()

    const categoryId = uuid.safeParse(formData.get('categoryId'))
    if (!categoryId.success) throw new ActionError('Invalid category.')

    const { data, error } = await createAdminClient()
      .from('kb_categories')
      .delete()
      .eq('id', categoryId.data)
      .eq('workspace_id', workspace.id)
      .select('id')
      .maybeSingle()

    if (error) throw error
    if (!data) throw new ActionError('That category no longer exists.')

    revalidatePath('/knowledge-base')
    return { error: null }
  } catch (error) {
    return toFormError(error, 'deleteCategoryAction')
  }
}
