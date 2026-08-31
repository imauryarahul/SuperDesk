import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

export type CorsCheckResult =
  | { ok: true; origin: string }
  | { ok: false; response: Response }

const METHODS = 'GET, POST, PATCH, OPTIONS'
const ALLOW_HEADERS = 'Content-Type'

export function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': METHODS,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

/**
 * Validates the request Origin against the workspace's allowed_widget_domains.
 * Uses the admin client (bypasses RLS) — the workspace lookup itself is the
 * auth check. A misconfigured workspace can only block itself, not others.
 */
export async function checkWidgetOrigin(
  request: Request,
  workspaceId: string,
): Promise<CorsCheckResult> {
  const origin = request.headers.get('origin') ?? ''

  if (!origin) {
    return { ok: false, response: errResponse('Missing Origin header', 400) }
  }

  if (!workspaceId) {
    return { ok: false, response: errResponse('Missing workspaceId', 400) }
  }

  const admin = createAdminClient()
  const { data: ws, error } = await admin
    .from('workspaces')
    .select('allowed_widget_domains')
    .eq('id', workspaceId)
    .maybeSingle()

  if (error || !ws) {
    return { ok: false, response: errResponse('Workspace not found', 404) }
  }

  if (!ws.allowed_widget_domains.includes(origin)) {
    return { ok: false, response: errResponse('Origin not allowed', 403) }
  }

  return { ok: true, origin }
}

/**
 * Short-circuits OPTIONS preflight. Returns null for non-OPTIONS requests so
 * callers can proceed to their own handler.
 */
export async function handlePreflight(
  request: Request,
  workspaceId: string,
): Promise<Response | null> {
  if (request.method !== 'OPTIONS') return null
  const check = await checkWidgetOrigin(request, workspaceId)
  if (!check.ok) return check.response
  return new Response(null, { status: 204, headers: corsHeaders(check.origin) })
}

function errResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
