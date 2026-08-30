/**
 * Checks for lib/custom-domain.ts. Run with:
 *   node scripts/custom-domain.test.mjs
 *
 * The interesting assertions are the ones under "hijack guard": a hostname a
 * workspace has claimed but not verified must never resolve to a help centre,
 * and a custom domain must never expose the dashboard, auth, or API surface.
 * Those are security properties, so they get tests rather than a comment.
 *
 * esbuild bundles the module first so this stays a plain node script, matching
 * scripts/kb-html.test.mjs.
 */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const dir = 'node_modules/.cache/custom-domain-test'
const outfile = `${dir}/custom-domain.cjs`
mkdirSync(dir, { recursive: true })

await build({
  entryPoints: ['lib/custom-domain.ts'],
  outfile,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  logLevel: 'error',
})

const {
  customDomainAction,
  isAppHost,
  isPassThroughPath,
  normalizeDomain,
  unclaimableDomainReason,
} = createRequire(import.meta.url)(`../${outfile}`)

const VERIFIED = { status: 'verified', workspaceSlug: 'acme' }
const UNVERIFIED = { status: 'unverified' }
const UNCLAIMED = { status: 'unclaimed' }

let failures = 0
function check(name, fn) {
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL  ${name}\n      ${error.message}`)
  }
}

console.log('\nnormalizeDomain')

check('accepts a bare hostname', () => {
  assert.equal(normalizeDomain('help.acme.com'), 'help.acme.com')
})

check('strips scheme, path, port, trailing dot, and case', () => {
  assert.equal(normalizeDomain('  HTTPS://Help.Acme.com:443/docs?x=1  '), 'help.acme.com')
})

check('rejects anything that is not a hostname', () => {
  for (const input of ['', 'localhost', 'acme', 'acme..com', '-acme.com', 'acme.com-', 'a b.com']) {
    assert.equal(normalizeDomain(input), null, `expected null for ${JSON.stringify(input)}`)
  }
})

console.log('\nunclaimableDomainReason')

check('refuses the app\u2019s own host and Vercel deployment domains', () => {
  assert.ok(unclaimableDomainReason('app.superdesk.com', 'app.superdesk.com'))
  assert.ok(unclaimableDomainReason('superdesk.vercel.app', 'app.superdesk.com'))
  assert.ok(unclaimableDomainReason('anything.local', 'app.superdesk.com'))
})

check('allows an unrelated customer domain', () => {
  assert.equal(unclaimableDomainReason('help.acme.com', 'app.superdesk.com'), null)
})

console.log('\nisAppHost')

check('recognises the app, localhost, and preview hosts', () => {
  assert.ok(isAppHost('app.superdesk.com', 'app.superdesk.com'))
  assert.ok(isAppHost('localhost', 'app.superdesk.com'))
  assert.ok(isAppHost('superdesk-abc123.vercel.app', 'app.superdesk.com'))
  assert.ok(!isAppHost('help.acme.com', 'app.superdesk.com'))
})

console.log('\nisPassThroughPath')

check('lets build assets and the ACME challenge through', () => {
  assert.ok(isPassThroughPath('/_next/static/chunks/main.js'))
  assert.ok(isPassThroughPath('/.well-known/acme-challenge/token'))
  assert.ok(!isPassThroughPath('/'))
  assert.ok(!isPassThroughPath('/getting-started'))
})

console.log('\nverified domain routing')

check('serves the help centre index at the root', () => {
  assert.deepEqual(customDomainAction('/', VERIFIED), { kind: 'rewrite', pathname: '/kb/acme' })
})

check('serves an article at a single top-level segment', () => {
  assert.deepEqual(customDomainAction('/getting-started', VERIFIED), {
    kind: 'rewrite',
    pathname: '/kb/acme/getting-started',
  })
})

check('canonicalises the /kb/<slug> links the pages emit', () => {
  assert.deepEqual(customDomainAction('/kb/acme', VERIFIED), { kind: 'redirect', pathname: '/' })
  assert.deepEqual(customDomainAction('/kb/acme/getting-started', VERIFIED), {
    kind: 'redirect',
    pathname: '/getting-started',
  })
})

check('refuses paths deeper than the help centre', () => {
  assert.deepEqual(customDomainAction('/a/b', VERIFIED), { kind: 'block' })
  assert.deepEqual(customDomainAction('/a/b/c', VERIFIED), { kind: 'block' })
})

console.log('\nhijack guard')

check('a claimed but unverified domain serves nothing', () => {
  for (const path of ['/', '/getting-started', '/kb/acme', '/kb/acme/getting-started']) {
    assert.deepEqual(
      customDomainAction(path, UNVERIFIED),
      { kind: 'block' },
      `expected block for ${path}`,
    )
  }
})

check('an unclaimed host is left to the normal app', () => {
  assert.deepEqual(customDomainAction('/', UNCLAIMED), { kind: 'passthrough' })
  assert.deepEqual(customDomainAction('/login', UNCLAIMED), { kind: 'passthrough' })
})

check('a verified domain exposes no dashboard, auth, or API surface', () => {
  for (const path of [
    '/api/inbox/summary',
    '/api/widget/message',
    '/inbox',
    '/knowledge-base',
    '/settings',
    '/login',
    '/signup',
    '/invite',
    '/auth/callback',
    '/kb',
  ]) {
    assert.deepEqual(
      customDomainAction(path, VERIFIED),
      { kind: 'block' },
      `expected block for ${path}`,
    )
  }
})

check('a verified domain cannot serve another workspace\u2019s help centre', () => {
  assert.deepEqual(customDomainAction('/kb/other-workspace', VERIFIED), { kind: 'block' })
  assert.deepEqual(customDomainAction('/kb/other-workspace/secret', VERIFIED), { kind: 'block' })
})

console.log(failures === 0 ? '\nAll custom-domain checks passed.\n' : `\n${failures} failed.\n`)
process.exit(failures === 0 ? 0 : 1)
