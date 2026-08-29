import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

import { publicSupabaseConfig } from '@/lib/env'
import type { Database } from '@/types/database'

/**
 * Request-scoped client that carries the signed-in user's session, so every
 * query it makes is subject to Row Level Security.
 */
export function createClient() {
  const cookieStore = cookies()
  const { url, anonKey } = publicSupabaseConfig()

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server Components cannot write cookies. The middleware refreshes
          // the session on every request, so dropping the write here is safe.
        }
      },
    },
  })
}
