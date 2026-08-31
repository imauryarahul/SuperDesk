'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useState, useTransition } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

import { Alert } from '@/components/ui'

import { deleteArticleAction, saveArticleAction } from '../actions'

type ArticleProps = {
  id: string
  title: string
  body: string
  slug: string
  published: boolean
  category_id: string | null
}

export function ArticleEditor({
  article,
  categories,
  workspaceSlug,
}: {
  article: ArticleProps
  categories: { id: string; name: string }[]
  workspaceSlug: string
}) {
  const router = useRouter()
  const [title, setTitle] = useState(article.title)
  const [categoryId, setCategoryId] = useState(article.category_id ?? '')
  const [published, setPublished] = useState(article.published)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [isSaving, startSaving] = useTransition()

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Clicking a link inside the editor should place the cursor, not
        // navigate away from unsaved work.
        link: { openOnClick: false },
      }),
    ],
    content: article.body,
    // The editor is a client-only DOM surface; rendering it during SSR just
    // produces a hydration mismatch against the version ProseMirror builds.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'prose-editor min-h-[420px] px-5 py-4 text-sm leading-relaxed text-slate-800 outline-none',
      },
    },
    onUpdate: () => setDirty(true),
  })

  const save = useCallback(
    (overrides?: { published?: boolean }) => {
      if (!editor) return
      const nextPublished = overrides?.published ?? published

      startSaving(async () => {
        const result = await saveArticleAction({
          articleId: article.id,
          title,
          body: editor.getHTML(),
          categoryId,
          published: nextPublished,
        })

        setError(result.error)
        if (result.error) return

        setPublished(nextPublished)
        setSavedAt(result.savedAt ?? new Date().toISOString())
        setDirty(false)
        // The slug is derived server-side and can change on a draft retitle, so
        // the rendered "live at …" link has to come from the server.
        router.refresh()
      })
    },
    [article.id, categoryId, editor, published, router, title],
  )

  return (
    <div className="flex-1 overflow-y-auto px-10 py-10">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/knowledge-base"
            className="text-sm text-slate-500 transition hover:text-slate-900"
          >
            ← All articles
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">
              {isSaving
                ? 'Saving…'
                : dirty
                  ? 'Unsaved changes'
                  : savedAt
                    ? `Saved ${new Date(savedAt).toLocaleTimeString()}`
                    : ''}
            </span>
            <button
              type="button"
              onClick={() => save()}
              disabled={isSaving}
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => save({ published: !published })}
              disabled={isSaving}
              className={`inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                published
                  ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  : 'bg-slate-900 text-white hover:bg-slate-800'
              }`}
            >
              {published ? 'Unpublish' : 'Publish'}
            </button>
          </div>
        </div>

        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="rounded-xl border border-slate-200 bg-white">
          <input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
              setDirty(true)
            }}
            maxLength={200}
            placeholder="Article title"
            aria-label="Article title"
            className="w-full rounded-t-xl border-b border-slate-200 px-5 py-4 text-lg font-semibold tracking-tight text-slate-900 outline-none placeholder:text-slate-300"
          />

          <Toolbar editor={editor} />
          <EditorContent editor={editor} />
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5">
          <label className="block min-w-[220px]">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Category</span>
            <select
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value)
                setDirty(true)
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
            >
              <option value="">Uncategorised</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-1 flex-col items-end gap-2">
            {published ? (
              <Link
                href={`/kb/${workspaceSlug}/${article.slug}`}
                target="_blank"
                className="text-xs text-slate-500 underline decoration-slate-300 underline-offset-2 transition hover:text-slate-900"
              >
                Live at /kb/{workspaceSlug}/{article.slug}
              </Link>
            ) : (
              <span className="text-xs text-slate-400">
                Draft — not visible on the public help centre or in the widget.
              </span>
            )}
            <form action={deleteArticleAction}>
              <input type="hidden" name="articleId" value={article.id} />
              <button
                type="submit"
                onClick={(event) => {
                  if (!confirm(`Delete "${title}"? This cannot be undone.`)) event.preventDefault()
                }}
                className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
              >
                Delete article
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

const TOOLS = [
  { label: 'B', title: 'Bold', mark: 'bold', run: (e: Editor) => e.chain().focus().toggleBold().run() },
  { label: 'I', title: 'Italic', mark: 'italic', run: (e: Editor) => e.chain().focus().toggleItalic().run() },
  { label: 'S', title: 'Strikethrough', mark: 'strike', run: (e: Editor) => e.chain().focus().toggleStrike().run() },
  { label: 'H2', title: 'Heading', mark: 'heading', run: (e: Editor) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: 'H3', title: 'Subheading', mark: 'heading', run: (e: Editor) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { label: '• List', title: 'Bullet list', mark: 'bulletList', run: (e: Editor) => e.chain().focus().toggleBulletList().run() },
  { label: '1. List', title: 'Numbered list', mark: 'orderedList', run: (e: Editor) => e.chain().focus().toggleOrderedList().run() },
  { label: 'Quote', title: 'Blockquote', mark: 'blockquote', run: (e: Editor) => e.chain().focus().toggleBlockquote().run() },
  { label: 'Code', title: 'Code block', mark: 'codeBlock', run: (e: Editor) => e.chain().focus().toggleCodeBlock().run() },
] as const

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) {
    // Reserve the toolbar's height so the editor does not jump on mount.
    return <div className="h-[45px] border-b border-slate-200" />
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-3 py-2">
      {TOOLS.map((tool) => (
        <button
          key={tool.label}
          type="button"
          title={tool.title}
          onClick={() => tool.run(editor)}
          className={`rounded px-2 py-1 text-xs font-medium transition ${
            editor.isActive(tool.mark)
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {tool.label}
        </button>
      ))}
      <span className="mx-1 h-4 w-px bg-slate-200" />
      <button
        type="button"
        title="Link"
        onClick={() => toggleLink(editor)}
        className={`rounded px-2 py-1 text-xs font-medium transition ${
          editor.isActive('link') ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
        }`}
      >
        Link
      </button>
    </div>
  )
}

function toggleLink(editor: Editor): void {
  if (editor.isActive('link')) {
    editor.chain().focus().unsetLink().run()
    return
  }

  const href = window.prompt('Link URL (https://…)')?.trim()
  if (!href) return

  // TipTap will happily store a javascript: URL. The server sanitiser strips it
  // on save, but rejecting it here means the author finds out immediately
  // instead of watching their link silently disappear.
  if (!/^https?:\/\//i.test(href) && !/^mailto:/i.test(href)) {
    window.alert('Links must start with http://, https:// or mailto:.')
    return
  }

  editor.chain().focus().setLink({ href }).run()
}
