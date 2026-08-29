'use server'

import { z } from 'zod'

import { broadcastNewMessage } from '@/lib/realtime-broadcast'
import { requireWorkspace } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

const MAX_BODY = 2000

type SendResult =
  | { message: { id: string; body: string; sender_type: string; sender_id: string | null; created_at: string }; error: null }
  | { message: null; error: string }

export async function sendAgentMessageAction(
  conversationId: string,
  body: string,
  clientId: string,
): Promise<SendResult> {
  const bodyParsed = z.string().min(1).max(MAX_BODY).safeParse(body)
  if (!bodyParsed.success) return { message: null, error: 'Invalid message body' }

  const { profile, workspace } = await requireWorkspace()
  const admin = createAdminClient()

  const { data: conv } = await admin
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('workspace_id', workspace.id)
    .maybeSingle()

  if (!conv) return { message: null, error: 'Conversation not found' }

  const { data: message, error } = await admin
    .from('messages')
    .insert({
      id: clientId,
      workspace_id: workspace.id,
      conversation_id: conversationId,
      sender_type: 'agent',
      sender_id: profile.id,
      body: bodyParsed.data,
    })
    .select('id, body, sender_type, sender_id, created_at')
    .single()

  if (error) {
    // Idempotent retry on unique constraint
    if (error.code === '23505') {
      const { data: existing } = await admin
        .from('messages')
        .select('id, body, sender_type, sender_id, created_at')
        .eq('id', clientId)
        .single()
      if (existing) return { message: existing, error: null }
    }
    return { message: null, error: 'Failed to send message' }
  }

  await Promise.all([
    admin
      .from('conversations')
      .update({ last_message_at: message.created_at })
      .eq('id', conversationId),
    broadcastNewMessage(workspace.id, conversationId, message),
  ])

  return { message, error: null }
}

export async function setConversationStatusAction(
  conversationId: string,
  status: 'open' | 'resolved',
): Promise<void> {
  const { workspace } = await requireWorkspace()
  const admin = createAdminClient()
  await admin
    .from('conversations')
    .update({ status })
    .eq('id', conversationId)
    .eq('workspace_id', workspace.id)
}

export async function assignConversationAction(
  conversationId: string,
  agentId: string | null,
): Promise<void> {
  const { workspace } = await requireWorkspace()
  const admin = createAdminClient()
  await admin
    .from('conversations')
    .update({ assigned_agent_id: agentId })
    .eq('id', conversationId)
    .eq('workspace_id', workspace.id)
}
