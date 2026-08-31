import { z } from 'zod'

import { checkRateLimit, getRequestIp, rateLimitedResponse } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkWidgetOrigin, corsHeaders, handlePreflight } from '@/lib/widget-cors'

const BodySchema = z
  .object({
    contactId: z.string().uuid(),
    conversationId: z.string().uuid(),
    email: z.string().email().max(320).optional(),
    name: z.string().min(1).max(100).trim().optional(),
  })
  .refine((d) => d.email !== undefined || d.name !== undefined, {
    message: 'Provide email or name',
  })

export async function OPTIONS(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? ''
  return (await handlePreflight(req, workspaceId)) ?? new Response(null, { status: 405 })
}

export async function PATCH(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? ''

  const preflight = await handlePreflight(req, workspaceId)
  if (preflight) return preflight

  const check = await checkWidgetOrigin(req, workspaceId)
  if (!check.ok) return check.response

  // 10 identity updates per IP per minute — this is a rare, deliberate action.
  const ip = getRequestIp(req)
  const allowed = await checkRateLimit(ip, `ws:${workspaceId}:identity`, 60, 10)
  if (!allowed) return rateLimitedResponse(check.origin)

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return reply({ error: 'Invalid JSON' }, 400, check.origin)
  }

  const parsed = BodySchema.safeParse(rawBody)
  if (!parsed.success) return reply({ error: parsed.error.message }, 422, check.origin)

  const { contactId, conversationId, email, name } = parsed.data
  const admin = createAdminClient()

  // Scope: verify the conversation belongs to this workspace AND this contact.
  // A visitor must not be able to set email/name on an arbitrary contactId — the
  // conversation acts as the ownership proof because only the contact who owns
  // the conversation could have sent messages into it.
  const { data: conv } = await admin
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .maybeSingle()

  if (!conv) return reply({ error: 'Conversation not found' }, 404, check.origin)

  const updates: { email?: string; name?: string } = {}
  if (email !== undefined) updates.email = email
  if (name !== undefined) updates.name = name

  const { data: contact, error } = await admin
    .from('contacts')
    .update(updates)
    .eq('id', contactId)
    .select('id, email, name')
    .single()

  if (error) return reply({ error: 'Failed to update contact' }, 500, check.origin)

  return reply({ contact }, 200, check.origin)
}

function reply(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}
