import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'

import { publicSupabaseConfig, serviceRoleKey } from '@/lib/env'
import type { Database } from '@/types/database'

/**
 * Bypasses RLS. Only for the two things a user cannot do for themselves:
 * bootstrapping a workspace at signup, and reading an invite by token before
 * the invitee belongs to any workspace. Every call site must do its own
 * authorisation check first.
 */
export function createAdminClient() {
  const { url } = publicSupabaseConfig()
  return createSupabaseClient<Database>(url, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
