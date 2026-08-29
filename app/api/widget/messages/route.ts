import { z } from 'zod'

import { broadcastNewMessage } from '@/lib/realtime-broadcast'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkWidgetOrigin, corsHeaders, handlePreflight } from '@/lib/widget-cors'

const MAX_BODY = 2000

const SendSchema = z.object({
  // Client-generated UUID for idempotent sends + optimistic deduplication
  id: z.string().uuid().optional(),
  conversationId: z.string().uuid(),
  contactId: z.string().uuid(),
  body: z.string().min(1).max(MAX_BODY),
})

export async function OPTIONS(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? ''
  return (await handlePreflight(req, workspaceId)) ?? new Response(null, { status: 405 })
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const workspaceId = searchParams.get('workspaceId') ?? ''
  const conversationId = searchParams.get('conversationId') ?? ''
  const since = searchParams.get('since') // ISO timestamp — for reconnect re-sync

  const check = await checkWidgetOrigin(req, workspaceId)
  if (!check.ok) return check.response

  if (!conversationId) return reply({ error: 'Missing conversationId' }, 400, check.origin)

  const admin = createAdminClient()
  let query = admin
    .from('messages')
    .select('id, body, sender_type, sender_id, created_at')
    .eq('workspace_id', workspaceId)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(200)

  if (since) query = query.gt('created_at', since)

  const { data, error } = await query
  if (error) return reply({ error: 'Failed to fetch messages' }, 500, check.origin)

  return reply({ messages: data ?? [] }, 200, check.origin)
}

export async function POST(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? ''

  const check = await checkWidgetOrigin(req, workspaceId)
  if (!check.ok) return check.response

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return reply({ error: 'Invalid JSON' }, 400, check.origin)
  }

  const parsed = SendSchema.safeParse(rawBody)
  if (!parsed.success) return reply({ error: parsed.error.message }, 422, check.origin)

  const { id: clientId, conversationId, contactId, body: text } = parsed.data
  const admin = createAdminClient()

  // Verify the conversation belongs to this workspace + contact (prevents spoofing)
  const { data: conv } = await admin
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .maybeSingle()

  if (!conv) return reply({ error: 'Conversation not found' }, 404, check.origin)

  const { data: message, error } = await admin
    .from('messages')
    .insert({
      ...(clientId ? { id: clientId } : {}),
      workspace_id: workspaceId,
      conversation_id: conversationId,
      sender_type: 'contact',
      sender_id: contactId,
      body: text,
    })
    .select('id, body, sender_type, sender_id, created_at')
    .single()

  if (error) {
    // Unique violation on client-provided id = already inserted (idempotent retry)
    if (error.code === '23505' && clientId) {
      const { data: existing } = await admin
        .from('messages')
        .select('id, body, sender_type, sender_id, created_at')
        .eq('id', clientId)
        .single()
      if (existing) return reply({ message: existing }, 200, check.origin)
    }
    return reply({ error: 'Failed to send message' }, 500, check.origin)
  }

  await Promise.all([
    admin
      .from('conversations')
      .update({ last_message_at: message.created_at })
      .eq('id', conversationId),
    broadcastNewMessage(workspaceId, conversationId, message),
  ])

  return reply({ message }, 201, check.origin)
}

function reply(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}
