import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { DomainRoute } from '@/lib/custom-domain'
import { publicSupabaseConfig, serviceRoleKey } from '@/lib/env'
import type { Database } from '@/types/database'

/**
 * Host header -> workspace resolution for the Edge middleware.
 *
 * Two things about this module are deliberate and not obvious:
 *
 * It builds its own service-role client instead of using lib/supabase/admin.ts,
 * because that module imports `server-only`, which resolves to a no-op module
 * only under the react-server condition. The middleware bundle is not compiled
 * with that condition, so importing it there would throw at runtime.
 *
 * It uses the service role rather than the anon client because custom_domain and
 * custom_domain_status are intentionally not in `anon`'s column grants — which
 * workspace owns which hostname is not public information. Widening that grant
 * to serve one internal lookup would publish every workspace's domain over the
 * REST API.
 */

/**
 * Long enough that a burst of requests to one help centre costs one query,
 * short enough that disconnecting a domain takes effect while the admin is
 * still looking at the settings page. The cost of the window is that a
 * just-revoked domain can serve for up to this long from a warm isolate.
 */
const CACHE_TTL_MS = 30_000

/** Junk Host headers must not be able to grow this without bound. */
const CACHE_MAX_ENTRIES = 500

const cache = new Map<string, { route: DomainRoute; expiresAt: number }>()

let client: SupabaseClient<Database> | null = null

function lookupClient(): SupabaseClient<Database> {
  if (!client) {
    client = createClient<Database>(publicSupabaseConfig().url, serviceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return client
}

export async function resolveDomainRoute(host: string): Promise<DomainRoute> {
  const cached = cache.get(host)
  if (cached && cached.expiresAt > Date.now()) return cached.route

  const route = await queryDomainRoute(host)
  if (route) {
    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear()
    cache.set(host, { route, expiresAt: Date.now() + CACHE_TTL_MS })
    return route
  }

  // Lookup failed. Report unclaimed so the request falls through to the normal
  // app: nobody's help centre is served off an unresolved hostname, which is
  // the direction this has to fail. Not cached, so recovery is immediate.
  return { status: 'unclaimed' }
}

async function queryDomainRoute(host: string): Promise<DomainRoute | null> {
  const { data, error } = await lookupClient()
    .from('workspaces')
    .select('slug, custom_domain_status')
    .eq('custom_domain', host)
    .maybeSingle()

  if (error) {
    // Logged rather than swallowed: a silent failure here looks exactly like a
    // hostname nobody has claimed, and those are indistinguishable in a graph.
    console.error(`[custom-domain] lookup failed for host=${host}:`, error.message)
    return null
  }

  if (!data) return { status: 'unclaimed' }

  return data.custom_domain_status === 'verified'
    ? { status: 'verified', workspaceSlug: data.slug }
    : { status: 'unverified' }
}
