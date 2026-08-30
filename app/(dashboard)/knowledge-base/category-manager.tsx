'use client'

import { useState } from 'react'
import { useFormState } from 'react-dom'

import { Alert, SubmitButton } from '@/components/ui'
import { idleFormState } from '@/lib/forms'

import { createCategoryAction, deleteCategoryAction, renameCategoryAction } from './actions'

export type CategoryRow = {
  id: string
  name: string
  articleCount: number
}

export function CategoryManager({ categories }: { categories: CategoryRow[] }) {
  const [createState, create] = useFormState(createCategoryAction, idleFormState)
  // One state pair for rename and one for delete, shared across rows: the row
  // identity travels in the form body, so per-row hooks would only duplicate
  // the wiring.
  const [renameState, rename] = useFormState(renameCategoryAction, idleFormState)
  const [deleteState, remove] = useFormState(deleteCategoryAction, idleFormState)
  const [editingId, setEditingId] = useState<string | null>(null)

  const error = createState.error ?? renameState.error ?? deleteState.error

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-900">Categories</h2>
      <p className="mt-1 text-xs text-slate-500">
        Deleting a category keeps its articles — they become uncategorised.
      </p>

      <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        {error ? <Alert tone="error">{error}</Alert> : null}

        {categories.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {categories.map((category) =>
              editingId === category.id ? (
                <li key={category.id} className="py-2.5">
                  <form
                    action={(formData) => {
                      rename(formData)
                      setEditingId(null)
                    }}
                    className="flex items-center gap-2"
                  >
                    <input type="hidden" name="categoryId" value={category.id} />
                    <input
                      name="name"
                      defaultValue={category.name}
                      maxLength={100}
                      required
                      autoFocus
                      aria-label={`Rename ${category.name}`}
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                    />
                    <SubmitButton variant="primary" pendingLabel="Saving…">
                      Save
                    </SubmitButton>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </form>
                </li>
              ) : (
                <li key={category.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-900">
                    {category.name}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {category.articleCount === 1 ? '1 article' : `${category.articleCount} articles`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingId(category.id)}
                    className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                  >
                    Rename
                  </button>
                  <form action={remove} className="shrink-0">
                    <input type="hidden" name="categoryId" value={category.id} />
                    <button
                      type="submit"
                      onClick={(event) => {
                        if (!confirm(deleteWarning(category))) event.preventDefault()
                      }}
                      className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </form>
                </li>
              ),
            )}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">
            No categories yet. Articles without one show as uncategorised.
          </p>
        )}

        <form action={create} className="flex items-center gap-2 border-t border-slate-100 pt-3">
          <input
            name="name"
            placeholder="New category name"
            maxLength={100}
            required
            aria-label="New category name"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
          <SubmitButton variant="secondary" pendingLabel="Adding…">
            Add
          </SubmitButton>
        </form>
      </div>
    </section>
  )
}

function deleteWarning(category: CategoryRow): string {
  if (category.articleCount === 0) return `Delete "${category.name}"?`
  const count =
    category.articleCount === 1 ? '1 article' : `${category.articleCount} articles`
  return `Delete "${category.name}"? ${count} will become uncategorised. The articles themselves are kept, and published ones stay live.`
}
