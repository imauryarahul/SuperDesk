import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'

import { publicSupabaseConfig } from '@/lib/env'
import type { Database } from '@/types/database'

/**
 * A deliberately session-less client for the public knowledge base and the
 * widget suggest route.
 *
 * The cookie-aware server client would run these queries as `authenticated`
 * whenever a signed-in team member happens to be the visitor, and the
 * authenticated RLS policy grants them their own drafts. The public help centre
 * would then render unpublished articles for exactly one class of user — the
 * hardest kind of leak to notice, because it only shows up when you are logged
 * in as the person who wrote them.
 *
 * Reading as `anon` instead means RLS is a real backstop: even a query that
 * forgets `published = true` cannot return a draft, and every visitor sees
 * byte-identical output.
 */
export function createAnonClient() {
  const { url, anonKey } = publicSupabaseConfig()
  return createSupabaseClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      /*
       * Next.js defaults every server-side fetch to force-cache, and these
       * requests carry no session, so each one is byte-identical for every
       * visitor forever — a perfect cache key that never varies and, with no
       * revalidate set, never expires.
       *
       * That is not merely stale, it is self-locking. `workspaces_public_read`
       * only exposes a workspace to `anon` while it owns a published article,
       * so a single request served while the knowledge base was empty caches a
       * null workspace, and publishing an article cannot evict it: the help
       * centre 404s permanently with correct data sitting in the database.
       *
       * no-store rather than a revalidate window because the cost is one
       * PostgREST round trip on a page an admin expects to reflect what they
       * just published, and a TTL only shortens how long that lie lasts.
       */
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
    },
  })
}
