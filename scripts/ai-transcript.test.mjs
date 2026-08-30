/**
 * Transcript-cap checks for lib/ai-transcript.ts. Run with:
 *   node scripts/ai-transcript.test.mjs
 */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const dir = 'node_modules/.cache/ai-transcript-test'
const outfile = `${dir}/ai-transcript.cjs`
mkdirSync(dir, { recursive: true })

await build({
  entryPoints: ['lib/ai-transcript.ts'],
  outfile,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  logLevel: 'error',
})

const { capTranscript, formatTranscript, MAX_RECENT_MESSAGES, MAX_CHARS_PER_MESSAGE } =
  createRequire(import.meta.url)(`../${outfile}`)

const line = (n) => ({ sender_type: 'contact', body: `msg-${n}` })

{
  const input = Array.from({ length: 80 }, (_, i) => line(i))
  const capped = capTranscript(input)
  assert.equal(capped.length, MAX_RECENT_MESSAGES)
  assert.equal(capped[0].body, 'msg-40')
  assert.equal(capped.at(-1).body, 'msg-79')
}

{
  const long = 'x'.repeat(MAX_CHARS_PER_MESSAGE + 200)
  const capped = capTranscript([{ sender_type: 'agent', body: long }])
  assert.equal(capped.length, 1)
  assert.ok(capped[0].body.endsWith('…'))
  assert.ok(capped[0].body.length <= MAX_CHARS_PER_MESSAGE + 1)
}

{
  const text = formatTranscript([
    { sender_type: 'contact', body: 'help' },
    { sender_type: 'agent', body: 'on it' },
  ])
  assert.equal(text, 'customer: help\nagent: on it')
}

console.log('ai-transcript: all checks passed')
