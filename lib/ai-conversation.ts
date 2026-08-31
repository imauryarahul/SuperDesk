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
  ai_summary_inbound_count: number
  ai_summary_generating_at: string | null
  messageCount: number
  /** Customer messages only — the staleness signal for summaries. */
  inboundCount: number
}

const MESSAGE_SELECT = 'sender_type, body' as const

export async function loadConversationAi(
  admin: Admin,
  workspaceId: string,
  conversationId: string,
): Promise<ConversationAiRow | null> {
  const { data: conv } = await admin
    .from('conversations')
    .select(
      'id, channel, ai_summary, ai_summary_message_count, ai_summary_inbound_count, ai_summary_generating_at',
    )
    .eq('id', conversationId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (!conv) return null

  const countMessages = (inboundOnly: boolean) => {
    const query = admin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('workspace_id', workspaceId)
    return inboundOnly ? query.eq('sender_type', 'contact') : query
  }

  const [total, inbound] = await Promise.all([countMessages(false), countMessages(true)])

  if (total.error || inbound.error) {
    console.error(
      '[ai] message count failed:',
      total.error?.message ?? inbound.error?.message,
    )
    return { ...conv, messageCount: 0, inboundCount: 0 }
  }

  return {
    ...conv,
    messageCount: total.count ?? 0,
    inboundCount: inbound.count ?? 0,
  }
}

/**
 * Marks the conversation as generating, but only if nobody else holds a live
 * claim. Returns false when another request got there first, so a stale thread
 * opened by two agents at once costs one generation rather than two.
 */
export async function claimSummaryGeneration(
  admin: Admin,
  workspaceId: string,
  conversationId: string,
  lockMs: number,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - lockMs).toISOString()
  const { data } = await admin
    .from('conversations')
    .update({ ai_summary_generating_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('workspace_id', workspaceId)
    .or(`ai_summary_generating_at.is.null,ai_summary_generating_at.lt.${cutoff}`)
    .select('id')

  return (data?.length ?? 0) > 0
}

export async function releaseSummaryGeneration(
  admin: Admin,
  workspaceId: string,
  conversationId: string,
): Promise<void> {
  await admin
    .from('conversations')
    .update({ ai_summary_generating_at: null })
    .eq('id', conversationId)
    .eq('workspace_id', workspaceId)
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
