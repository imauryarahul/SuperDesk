import { z } from 'zod'

import { checkRateLimit, getRequestIp, rateLimitedResponse } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkWidgetOrigin, corsHeaders, handlePreflight } from '@/lib/widget-cors'

const BodySchema = z.object({
  anonymousToken: z.string().uuid().optional(),
  email: z.string().email().max(320).optional(),
})

export async function OPTIONS(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? ''
  return (await handlePreflight(req, workspaceId)) ?? new Response(null, { status: 405 })
}

export async function POST(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? ''

  const preflight = await handlePreflight(req, workspaceId)
  if (preflight) return preflight

  const check = await checkWidgetOrigin(req, workspaceId)
  if (!check.ok) return check.response

  // 10 contact lookups/creates per IP per workspace per minute.
  const ip = getRequestIp(req)
  const allowed = await checkRateLimit(ip, `ws:${workspaceId}:contact`, 60, 10)
  if (!allowed) return rateLimitedResponse(check.origin)

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return reply({ error: 'Invalid JSON' }, 400, check.origin)
  }

  const parsed = BodySchema.safeParse(rawBody)
  if (!parsed.success) return reply({ error: parsed.error.message }, 422, check.origin)

  const { anonymousToken, email } = parsed.data
  if (!anonymousToken && !email) {
    return reply({ error: 'Provide anonymousToken or email' }, 400, check.origin)
  }

  const admin = createAdminClient()

  // Workspace name for the widget header (already fetched by CORS check; a
  // second round-trip is acceptable given it's a PKI lookup on an indexed column).
  const { data: ws } = await admin
    .from('workspaces')
    .select('name')
    .eq('id', workspaceId)
    .single()

  let contact: { id: string; email: string | null; anonymous_token: string | null } | null = null

  // 1. Email lookup — merges anonymous sessions onto a known contact
  if (email) {
    const { data } = await admin
      .from('contacts')
      .select('id, email, anonymous_token')
      .eq('workspace_id', workspaceId)
      .ilike('email', email)
      .maybeSingle()

    if (data) {
      contact = data
      await admin
        .from('contacts')
        .update({
          last_seen_at: new Date().toISOString(),
          ...(!data.anonymous_token && anonymousToken ? { anonymous_token: anonymousToken } : {}),
        })
        .eq('id', data.id)
    }
  }

  // 2. Anonymous token lookup
  if (!contact && anonymousToken) {
    const { data } = await admin
      .from('contacts')
      .select('id, email, anonymous_token')
      .eq('workspace_id', workspaceId)
      .eq('anonymous_token', anonymousToken)
      .maybeSingle()

    if (data) {
      contact = data
      await admin
        .from('contacts')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', data.id)
    }
  }

  // 3. Create if not found
  if (!contact) {
    const { data, error } = await admin
      .from('contacts')
      .insert({
        workspace_id: workspaceId,
        anonymous_token: anonymousToken ?? null,
        email: email ?? null,
      })
      .select('id, email, anonymous_token')
      .single()

    if (error) return reply({ error: 'Failed to create contact' }, 500, check.origin)
    contact = data
  }

  return reply({ contact, workspace: { name: ws?.name ?? '' } }, 200, check.origin)
}

function reply(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}
