import 'server-only'

import { createAdminClient } from './supabase/admin'
import type { Database } from '@/types/database'

import {
  capTranscript,
  MAX_RECENT_MESSAGES,
  type TranscriptLine,
} from './ai-transcript'

type Admin = ReturnType<typeof createAdminClient>
type Sender = Database['public']['Enums']['message_sender_type']

export type ConversationAiRow = {
  id: string
  channel: Database['public']['Enums']['conversation_channel']
  ai_summary: string | null
  ai_summary_message_count: number
  messageCount: number
}

const MESSAGE_SELECT = 'sender_type, body' as const

export async function loadConversationAi(
  admin: Admin,
  workspaceId: string,
  conversationId: string,
): Promise<ConversationAiRow | null> {
  const { data: conv } = await admin
    .from('conversations')
    .select('id, channel, ai_summary, ai_summary_message_count')
    .eq('id', conversationId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (!conv) return null

  const { count, error } = await admin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('workspace_id', workspaceId)

  if (error) {
    console.error('[ai] message count failed:', error.message)
    return { ...conv, messageCount: 0 }
  }

  return { ...conv, messageCount: count ?? 0 }
}

function toLines(
  rows: { sender_type: Sender; body: string }[] | null,
): TranscriptLine[] {
  return (rows ?? []).map((row) => ({
    sender_type: row.sender_type,
    body: row.body,
  }))
}

/** Most recent window, then character-budgeted from the recent end. */
export async function loadCappedRecentMessages(
  admin: Admin,
  workspaceId: string,
  conversationId: string,
): Promise<TranscriptLine[]> {
  const { data } = await admin
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('conversation_id', conversationId)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(MAX_RECENT_MESSAGES)

  return capTranscript(toLines(data).reverse())
}

/** Messages after the stored summary's count, then the same cap. */
export async function loadMessagesSinceCount(
  admin: Admin,
  workspaceId: string,
  conversationId: string,
  sinceCount: number,
): Promise<TranscriptLine[]> {
  if (sinceCount < 0) return loadCappedRecentMessages(admin, workspaceId, conversationId)

  const { data } = await admin
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('conversation_id', conversationId)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })
    .range(sinceCount, sinceCount + 499)

  return capTranscript(toLines(data))
}

/**
 * The customer's single most recent message, regardless of how much has been
 * said since. A targeted one-row lookup — cheaper than scanning the thread
 * for it, and the only query the draft endpoint needs when the delta since
 * the summary turns out to be agent/system-only.
 */
export async function loadLastCustomerMessage(
  admin: Admin,
  workspaceId: string,
  conversationId: string,
): Promise<TranscriptLine | null> {
  const { data } = await admin
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('conversation_id', conversationId)
    .eq('workspace_id', workspaceId)
    .eq('sender_type', 'contact')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data ? toLines([data])[0]! : null
}
