/**
 * Authenticated smoke test for the knowledge base dashboard.
 *
 *   npm run dev            # in another terminal
 *   node scripts/kb-dashboard-smoke.mjs
 *
 * Creates a throwaway user and workspace, signs in, forges the @supabase/ssr
 * session cookie, requests every KB route as that user, then deletes everything
 * it created. Purpose is to catch a server component that throws on render —
 * something `tsc` and `next build` cannot see, because both stop at types.
 *
 * Tenant isolation itself is covered by supabase/tests/rls_isolation.sql; this
 * only asks "does the page come back 200 with the right content".
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const BASE = 'http://localhost:3000'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.trimStart().startsWith('#'))
    .map((line) => {
      const i = line.indexOf('=')
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()]
    }),
)

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY
const PROJECT_REF = new URL(URL_).hostname.split('.')[0]

// realtime-js insists on a WebSocket constructor at client construction time,
// which Node 20 does not provide globally. Nothing here subscribes, so a stub
// that is never instantiated is enough.
const clientOptions = {
  auth: { persistSession: false },
  realtime: { transport: class NoopWebSocket {} },
}

const admin = createClient(URL_, SERVICE, clientOptions)
const stamp = Date.now()
const email = `kb-smoke-${stamp}@superdesk-smoke.dev`
const password = `Smoke-${stamp}-pw`

let authUserId = null
let workspaceId = null
let failures = 0

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`ok   ${name}`)
  } else {
    failures += 1
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

try {
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createError) throw createError
  authUserId = created.user.id

  const { data: wsId, error: rpcError } = await admin.rpc('create_workspace_with_admin', {
    p_auth_user_id: authUserId,
    p_email: email,
    p_workspace_name: 'KB Smoke Workspace',
    p_full_name: 'Smoke Tester',
  })
  if (rpcError) throw rpcError
  workspaceId = wsId

  const { data: ws } = await admin
    .from('workspaces')
    .select('slug')
    .eq('id', workspaceId)
    .single()
  check('workspace slug generated from name', ws.slug === 'kb-smoke-workspace', ws.slug)

  // Sign in as the new user and forge the cookie @supabase/ssr expects, so the
  // Next middleware and server components see a real session.
  const anon = createClient(URL_, ANON, clientOptions)
  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({
    email,
    password,
  })
  if (signInError) throw signInError

  const cookieName = `sb-${PROJECT_REF}-auth-token`
  const cookieValue = `base64-${Buffer.from(JSON.stringify(signIn.session)).toString('base64url')}`
  const cookie = `${cookieName}=${cookieValue}`

  const get = async (path) => {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: 'manual' })
    return { status: res.status, body: await res.text() }
  }

  const list = await get('/knowledge-base')
  check('GET /knowledge-base renders', list.status === 200, `status ${list.status}`)
  check(
    'empty state copy shown when there are no articles',
    list.body.includes('No articles yet'),
  )
  check('category manager rendered', list.body.includes('Categories'))

  // Seed content directly; the point here is that the pages render it, and the
  // mutations already have coverage at the RLS layer.
  const { data: category } = await admin
    .from('kb_categories')
    .insert({ workspace_id: workspaceId, name: 'Smoke Category' })
    .select('id')
    .single()

  const { data: published } = await admin
    .from('kb_articles')
    .insert({
      workspace_id: workspaceId,
      category_id: category.id,
      title: 'Smoke published article',
      body: '<p>Visible to everyone.</p>',
      published: true,
    })
    .select('id, slug')
    .single()

  const { data: draft } = await admin
    .from('kb_articles')
    .insert({
      workspace_id: workspaceId,
      title: 'Smoke draft article',
      body: '<p>Should stay private.</p>',
      published: false,
    })
    .select('id, slug')
    .single()

  const listAfter = await get('/knowledge-base')
  check('article list shows the published article', listAfter.body.includes('Smoke published article'))
  check('article list shows the draft to the team', listAfter.body.includes('Smoke draft article'))
  check('article list labels drafts', listAfter.body.includes('Draft'))
  check('article list links to the public help centre', listAfter.body.includes('/kb/kb-smoke-workspace'))
  check('category article count rendered', listAfter.body.includes('1 article'))

  const editorPublished = await get(`/knowledge-base/${published.id}`)
  check('GET editor for published article renders', editorPublished.status === 200, `status ${editorPublished.status}`)
  check('editor shows the title', editorPublished.body.includes('Smoke published article'))
  check('editor offers Unpublish for a published article', editorPublished.body.includes('Unpublish'))
  check('editor shows the live URL', editorPublished.body.includes(`/kb/kb-smoke-workspace/${published.slug}`))
  check('editor lists the workspace categories', editorPublished.body.includes('Smoke Category'))

  const editorDraft = await get(`/knowledge-base/${draft.id}`)
  check('GET editor for draft renders', editorDraft.status === 200, `status ${editorDraft.status}`)
  check('editor offers Publish for a draft', editorDraft.body.includes('Publish'))
  check('editor marks the draft as not public', editorDraft.body.includes('not visible on the public help centre'))

  const missing = await get('/knowledge-base/00000000-0000-4000-8000-000000000000')
  check('editor 404s for an unknown article id', missing.status === 404, `status ${missing.status}`)

  // The interesting negative: an article id belonging to another workspace must
  // 404 rather than render, even though the id is perfectly valid.
  const { data: otherWs } = await admin.from('workspaces').select('id').neq('id', workspaceId).limit(1)
  if (otherWs?.length) {
    const { data: foreign } = await admin
      .from('kb_articles')
      .select('id')
      .eq('workspace_id', otherWs[0].id)
      .limit(1)
    if (foreign?.length) {
      const cross = await get(`/knowledge-base/${foreign[0].id}`)
      check("editor 404s for another workspace's article", cross.status === 404, `status ${cross.status}`)
    } else {
      console.log('skip other-workspace article check (no article to borrow)')
    }
  }

  const publicIndex = await get('/kb/kb-smoke-workspace')
  check('public help centre renders', publicIndex.status === 200, `status ${publicIndex.status}`)
  check('public page shows the published article', publicIndex.body.includes('Smoke published article'))
  check(
    'public page hides the draft even from a signed-in author',
    !publicIndex.body.includes('Smoke draft article'),
  )

  const publicDraft = await get(`/kb/kb-smoke-workspace/${draft.slug}`)
  check(
    'public draft URL 404s for a signed-in author',
    publicDraft.status === 404,
    `status ${publicDraft.status}`,
  )
} catch (error) {
  failures += 1
  console.error('FAIL harness error —', error.message ?? error)
} finally {
  if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId)
  if (authUserId) await admin.auth.admin.deleteUser(authUserId)
  console.log('\ncleaned up throwaway user and workspace')
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
console.log('All KB dashboard smoke checks passed')
