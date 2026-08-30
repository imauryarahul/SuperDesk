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
  })
}
