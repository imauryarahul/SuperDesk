import 'server-only'

import { createAdminClient } from './supabase/admin'

/**
 * Fixed-window rate limiter backed by the `rate_limit_windows` Postgres table.
 *
 * Returns true when the request is allowed, false when it is rate-limited.
 * Fails open on DB errors so a broken rate-limit table never blocks all traffic.
 *
 * Limits are intentionally loose — enough to stop naive scripted abuse, not to
 * meter legitimate power users. A Redis-backed sliding window would be more
 * precise at scale; that is a documented scope simplification for this phase.
 *
 * @param ip        Caller's IP (use x-forwarded-for on Vercel).
 * @param scope     Identifies the bucket, e.g. 'ws:abc:contact'.
 * @param windowSec Window size in seconds.
 * @param max       Maximum requests allowed in one window.
 */
export async function checkRateLimit(
  ip: string,
  scope: string,
  windowSec: number,
  max: number,
): Promise<boolean> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('increment_rate_limit', {
    p_ip: ip,
    p_scope: scope,
    p_window_sec: windowSec,
    p_max: max,
  })

  if (error) {
    console.error('[rate-limit] check failed, failing open:', error.message)
    return true
  }
  return data as boolean
}

/** Extracts the caller's IP from standard reverse-proxy headers. */
export function getRequestIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

/** Rate-limited 429 response for API routes. */
export function rateLimitedResponse(origin?: string): Response {
  return new Response(JSON.stringify({ error: 'Too many requests. Please slow down.' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': '60',
      ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    },
  })
}
