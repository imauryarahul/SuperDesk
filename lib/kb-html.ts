import 'server-only'

import sanitizeHtml from 'sanitize-html'

/**
 * Article bodies are HTML produced by TipTap in the dashboard and rendered on
 * the public help centre with dangerouslySetInnerHTML. That makes the body a
 * stored-XSS vector aimed at anonymous visitors, not at the author: a
 * compromised or malicious team member could publish a `<script>` and run it in
 * every reader's browser.
 *
 * So the body is sanitised on write, not on read. Sanitising on write means the
 * database only ever holds safe markup, every consumer (public page, widget
 * suggest, a future email digest) inherits the guarantee, and the cost is paid
 * once per save instead of once per page view.
 *
 * The allowlist covers exactly what the editor can produce — TipTap StarterKit,
 * which bundles Link and Underline in v3 — and nothing else, so unknown tags
 * are dropped rather than negotiated.
 */
export function sanitizeArticleHtml(dirty: string): string {
  return sanitizeHtml(dirty, {
    allowedTags: [
      'p', 'br', 'hr',
      'h1', 'h2', 'h3',
      'strong', 'em', 'u', 's', 'code',
      'pre', 'blockquote',
      'ul', 'ol', 'li',
      'a',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
    },
    // javascript: and data: URLs are the obvious way to smuggle script through
    // an href that survives tag filtering.
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesAppliedToAttributes: ['href'],
    // Every outbound link is untrusted content pointing off our origin.
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow noopener noreferrer' }),
    },
  })
}

/**
 * Plain-text preview for list rows and widget suggestions.
 *
 * Block tags collapse to a space so `</p><ul><li>` does not weld the end of one
 * block onto the start of the next; inline tags collapse to nothing, so
 * `<strong>password</strong>.` does not gain a space before the full stop. The
 * search_vector column spaces out every tag instead, which is right for
 * tokenising and wrong for reading.
 *
 * The result is only ever rendered as text (JSX children, or textContent in the
 * widget), never as HTML, and the stored body was already sanitised on save.
 */
export function articleExcerpt(body: string, maxLength = 160): string {
  const text = body
    .replace(/<\/?(?:p|br|li|ul|ol|h[1-6]|blockquote|pre|hr|div)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Ampersand last, so a double-escaped `&amp;lt;` does not decode into a tag.
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

  if (text.length <= maxLength) return text

  // Cut on a word boundary so the ellipsis does not land mid-word, unless the
  // first `maxLength` characters contain no space at all.
  const boundary = text.lastIndexOf(' ', maxLength)
  return `${text.slice(0, boundary > 0 ? boundary : maxLength)}…`
}
