/**
 * Sanitiser checks for lib/kb-html.ts. Run with:
 *   node scripts/kb-html.test.mjs
 *
 * esbuild bundles the module first because it imports `server-only`, which is
 * only resolvable under the react-server condition.
 */
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Inside the project tree so the bundle's own imports resolve normally, and as
// CJS because sanitize-html's dependency tree still uses require().
const dir = 'node_modules/.cache/kb-html-test'
const outfile = `${dir}/kb-html.cjs`
mkdirSync(dir, { recursive: true })

await build({
  entryPoints: ['lib/kb-html.ts'],
  outfile,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  // `server-only` resolves to an empty module under this condition instead of
  // the stub that throws outside a server component.
  conditions: ['react-server'],
  logLevel: 'error',
})

const { sanitizeArticleHtml, articleExcerpt } = createRequire(import.meta.url)(`../${outfile}`)

const cases = [
  ['strips script tags', '<p>Hi</p><script>alert(1)</script>', '<p>Hi</p>'],
  ['strips inline handlers', '<p onclick="steal()">Hi</p>', '<p>Hi</p>'],
  ['strips javascript: hrefs', '<a href="javascript:alert(1)">x</a>', '<a rel="nofollow noopener noreferrer">x</a>'],
  ['strips data: hrefs', '<a href="data:text/html,<script>alert(1)</script>">x</a>', '<a rel="nofollow noopener noreferrer">x</a>'],
  ['strips iframes', '<iframe src="https://evil.com"></iframe>', ''],
  ['strips style attributes', '<p style="position:fixed">Hi</p>', '<p>Hi</p>'],
  ['strips svg payloads', '<svg><animate onbegin="alert(1)" /></svg>', ''],
  ['strips img onerror', '<img src=x onerror="alert(1)">', ''],
  ['keeps allowed formatting', '<p><strong>a</strong> <em>b</em> <u>c</u> <s>d</s> <code>e</code></p>', '<p><strong>a</strong> <em>b</em> <u>c</u> <s>d</s> <code>e</code></p>'],
  ['keeps lists and headings', '<h2>T</h2><ul><li>a</li></ul><ol><li>b</li></ol>', '<h2>T</h2><ul><li>a</li></ul><ol><li>b</li></ol>'],
  ['keeps https links and adds rel', '<a href="https://example.com">x</a>', '<a href="https://example.com" rel="nofollow noopener noreferrer">x</a>'],
  ['keeps mailto links', '<a href="mailto:a@b.com">x</a>', '<a href="mailto:a@b.com" rel="nofollow noopener noreferrer">x</a>'],
]

let failures = 0
for (const [name, input, expected] of cases) {
  const actual = sanitizeArticleHtml(input)
  if (actual !== expected) {
    failures += 1
    console.error(`FAIL ${name}\n  in:       ${input}\n  expected: ${expected}\n  actual:   ${actual}`)
  } else {
    console.log(`ok   ${name}`)
  }
}

// The sanitised output must never contain something a browser would execute.
for (const [name, input] of cases) {
  const out = sanitizeArticleHtml(input)
  if (/<script|javascript:|on\w+\s*=|<iframe|<svg/i.test(out)) {
    failures += 1
    console.error(`FAIL executable content survived: ${name} -> ${out}`)
  }
}

const excerptCases = [
  ['spaces block boundaries', '<p>One.</p><ul><li>Two</li></ul>', 'One. Two'],
  ['does not space inline tags', '<p>a <strong>bold</strong>.</p>', 'a bold.'],
  ['decodes entities', '<p>Tom &amp; Jerry &lt;3</p>', 'Tom & Jerry <3'],
  ['collapses whitespace', '<p>a\n\n   b</p>', 'a b'],
  ['empty body', '', ''],
]

for (const [name, input, expected] of excerptCases) {
  const actual = articleExcerpt(input)
  if (actual !== expected) {
    failures += 1
    console.error(`FAIL excerpt ${name}\n  expected: "${expected}"\n  actual:   "${actual}"`)
  } else {
    console.log(`ok   excerpt ${name}`)
  }
}

const long = articleExcerpt(`<p>${'word '.repeat(80)}</p>`, 50)
assert.ok(long.length <= 51, `truncated excerpt too long: ${long.length}`)
assert.ok(long.endsWith('…'), 'truncated excerpt should end with an ellipsis')
assert.ok(!long.endsWith(' …'), 'truncated excerpt should not end with a dangling space')
console.log('ok   excerpt truncates on a word boundary')

rmSync(dir, { recursive: true, force: true })

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nAll kb-html checks passed')
