import { z } from 'zod'

import {
  loadConversationAi,
  loadCappedRecentMessages,
  loadMessagesSinceCount,
} from '@/lib/ai-conversation'
import { completeText, AiCallError, AiTimeoutError } from '@/lib/openai'
import { formatTranscript } from '@/lib/ai-transcript'
import { getWorkspaceOrNull } from '@/lib/auth'
import { checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'

const BodySchema = z.object({ conversationId: z.string().uuid() })

const SUMMARY_SYSTEM = `Summarise this support thread for an agent about to reply. Output 3–6 bullet points only — each line must start with "- ". Cover: what the customer needs, key facts (names, dates, products, errors, IDs), current status. Current state only, not a chronology. No headings, intro sentence, or numbered lists.`

const UPDATE_SYSTEM = `Update the existing support-issue summary with the new messages. Output a complete replacement (not a delta) as 3–6 bullet points only — each line must start with "- ". Cover: what the customer needs, key facts, current status. Current state only. No headings, intro sentence, or numbered lists.`

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function POST(req: Request) {
  const workspace = await getWorkspaceOrNull()
  if (!workspace) return json({ error: 'Unauthorized' }, 401)

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return json({ error: 'Invalid conversation id' }, 422)

  const { conversationId } = parsed.data
  const admin = createAdminClient()
  const conv = await loadConversationAi(admin, workspace.workspace.id, conversationId)
  if (!conv) return json({ error: 'Conversation not found' }, 404)

  if (conv.messageCount === 0) {
    return json({ summary: null, messageCount: 0 })
  }

  // Cached and current — no model call, no rate-limit token.
  if (
    conv.ai_summary &&
    conv.messageCount <= conv.ai_summary_message_count
  ) {
    return json({
      summary: conv.ai_summary,
      messageCount: conv.messageCount,
      cached: true,
    })
  }

  // Dollar-costing path: per workspace, not per IP.
  const allowed = await checkRateLimit(
    workspace.workspace.id,
    'ai:summary',
    60,
    20,
  )
  if (!allowed) return rateLimitedResponse()

  try {
    const summary = conv.ai_summary
      ? await updateSummary(admin, workspace.workspace.id, conv)
      : await firstSummary(admin, workspace.workspace.id, conv)

    const { error: writeError } = await admin
      .from('conversations')
      .update({
        ai_summary: summary,
        ai_summary_updated_at: new Date().toISOString(),
        ai_summary_message_count: conv.messageCount,
      })
      .eq('id', conversationId)
      .eq('workspace_id', workspace.workspace.id)

    if (writeError) {
      console.error('[ai] summary persist failed:', writeError.message)
      // Still return the text so the agent can read it this session.
    }

    return json({ summary, messageCount: conv.messageCount, cached: false })
  } catch (err) {
    if (err instanceof AiTimeoutError || err instanceof AiCallError) {
      console.error(
        `[ai] summary conversation=${conversationId}: ${err.message}`,
      )
      return json({ error: 'Summary unavailable' }, 503)
    }
    console.error('[ai] summary unexpected:', err)
    return json({ error: 'Summary unavailable' }, 503)
  }
}

async function firstSummary(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  conv: { id: string },
): Promise<string> {
  const lines = await loadCappedRecentMessages(admin, workspaceId, conv.id)
  const transcript = formatTranscript(lines)
  if (!transcript) throw new AiCallError('No messages to summarise')

  return completeText({
    system: SUMMARY_SYSTEM,
    user: `Transcript, oldest first. Long threads are truncated to the recent end.\n\n${transcript}`,
    maxTokens: 400,
  })
}

async function updateSummary(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  conv: { id: string; ai_summary: string | null; ai_summary_message_count: number },
): Promise<string> {
  const delta = await loadMessagesSinceCount(
    admin,
    workspaceId,
    conv.id,
    conv.ai_summary_message_count,
  )
  const newMessages = formatTranscript(delta)
  if (!newMessages) {
    // Count went down (deletes) or the new rows were empty. Rebuild from the
    // recent window rather than sending the model an empty delta.
    return firstSummary(admin, workspaceId, conv)
  }

  return completeText({
    system: UPDATE_SYSTEM,
    user: `Existing summary:\n${conv.ai_summary ?? ''}\n\nNew messages (oldest first):\n${newMessages}`,
    maxTokens: 400,
  })
}
