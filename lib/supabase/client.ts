import { createBrowserClient } from '@supabase/ssr'

import { publicSupabaseConfig } from '@/lib/env'
import type { Database } from '@/types/database'

export function createClient() {
  const { url, anonKey } = publicSupabaseConfig()
  return createBrowserClient<Database>(url, anonKey)
}
