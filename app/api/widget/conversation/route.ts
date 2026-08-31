import { z } from 'zod'

import { CONV_SELECT } from '@/app/(dashboard)/inbox/queries'
import { checkRateLimit, getRequestIp, rateLimitedResponse } from '@/lib/rate-limit'
import { broadcast } from '@/lib/realtime-broadcast'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkWidgetOrigin, corsHeaders, handlePreflight } from '@/lib/widget-cors'

const BodySchema = z.object({
  contactId: z.string().uuid(),
})

export async function OPTIONS(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? ''
  return (await handlePreflight(req, workspaceId)) ?? new Response(null, { status: 405 })
}

export async function POST(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? ''

  const check = await checkWidgetOrigin(req, workspaceId)
  if (!check.ok) return check.response

  // 10 conversation resume/creates per IP per workspace per minute.
  const ip = getRequestIp(req)
  const allowed = await checkRateLimit(ip, `ws:${workspaceId}:conv`, 60, 10)
  if (!allowed) return rateLimitedResponse(check.origin)

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return reply({ error: 'Invalid JSON' }, 400, check.origin)
  }

  const parsed = BodySchema.safeParse(rawBody)
  if (!parsed.success) return reply({ error: parsed.error.message }, 422, check.origin)

  const admin = createAdminClient()
  const { contactId } = parsed.data

  // Resume the most recent open conversation for this contact
  const { data: existing } = await admin
    .from('conversations')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) return reply({ conversation: existing }, 200, check.origin)

  const { data, error } = await admin
    .from('conversations')
    .insert({
      workspace_id: workspaceId,
      contact_id: contactId,
      channel: 'chat',
      status: 'open',
    })
    .select(CONV_SELECT)
    .single()

  if (error) return reply({ error: 'Failed to create conversation' }, 500, check.origin)

  // Push the new thread into every agent's conversation list immediately.
  // Postgres Changes also covers this; broadcast makes it independent of the
  // Realtime publication being configured.
  await broadcast({
    topic: `inbox:${workspaceId}`,
    event: 'conversation_started',
    payload: { conversation: data as unknown as Record<string, unknown> },
  })

  return reply({ conversation: { id: data.id } }, 201, check.origin)
}

function reply(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}
