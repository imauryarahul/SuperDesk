import { z } from 'zod'

import {
  loadConversationAi,
  loadCappedRecentMessages,
  loadMessagesSinceCount,
  loadLastCustomerMessage,
} from '@/lib/ai-conversation'
import { completeText, AiCallError, AiTimeoutError } from '@/lib/openai'
import {
  formatTranscript,
  latestCustomerBody,
  type TranscriptLine,
} from '@/lib/ai-transcript'
import { getWorkspaceOrNull } from '@/lib/auth'
import { articleExcerpt } from '@/lib/kb-html'
import { checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'

const BodySchema = z.object({ conversationId: z.string().uuid() })

const DRAFT_SYSTEM = `Draft a reply a human agent will edit and send. Team voice. Chat: 2–6 short sentences. Email: short paragraph with greeting. Do not invent facts, policies, or promises. Use KB excerpts only if they answer the question; otherwise say you will look into it. Reply body only — no subject, quotes, or commentary.`

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
    return json({ error: 'Nothing to reply to' }, 422)
  }

  const allowed = await checkRateLimit(workspace.workspace.id, 'ai:draft', 60, 15)
  if (!allowed) return rateLimitedResponse()

  try {
    const { summaryBlock, recentBlock, customerMessage } = await buildDraftContext(
      admin,
      workspace.workspace.id,
      conv,
    )
    const kbBlock = await kbExcerpts(admin, workspace.workspace.id, customerMessage)

    const channel = conv.channel === 'email' ? 'email' : 'live chat'
    const user = [
      `Channel: ${channel}`,
      summaryBlock,
      recentBlock,
      kbBlock,
      'Write a reply to the customer\'s latest message.',
    ]
      .filter((section) => section.length > 0)
      .join('\n\n')

    const draft = await completeText({
      system: DRAFT_SYSTEM,
      user,
      maxTokens: 700,
    })

    return json({ draft })
  } catch (err) {
    if (err instanceof AiTimeoutError || err instanceof AiCallError) {
      console.error(`[ai] draft conversation=${conversationId}: ${err.message}`)
      return json({ error: 'Draft unavailable' }, 503)
    }
    console.error('[ai] draft unexpected:', err)
    return json({ error: 'Draft unavailable' }, 503)
  }
}

async function buildDraftContext(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  conv: {
    id: string
    ai_summary: string | null
    ai_summary_message_count: number
  },
): Promise<{ summaryBlock: string; recentBlock: string; customerMessage: string | null }> {
  if (!conv.ai_summary) {
    const recent = await loadCappedRecentMessages(admin, workspaceId, conv.id)
    return {
      summaryBlock: '',
      recentBlock: `Recent messages (oldest first):\n${formatTranscript(recent)}`,
      customerMessage: latestCustomerBody(recent),
    }
  }

  const delta = await loadMessagesSinceCount(
    admin,
    workspaceId,
    conv.id,
    conv.ai_summary_message_count,
  )

  // If the summary already covers the whole thread, the delta is empty and a
  // draft would only see a paraphrase of the latest customer turn. Always
  // include that turn verbatim so the reply can address what they actually
  // said. The common case (delta has a customer message) costs one query
  // total; only an all-agent delta or an empty one pays for the single-row
  // targeted lookup below, instead of the old full-thread scan.
  let recent: TranscriptLine[] = delta
  let customerMessage = latestCustomerBody(delta)

  if (recent.length === 0 || customerMessage === null) {
    const lastCustomer = await loadLastCustomerMessage(admin, workspaceId, conv.id)
    if (recent.length === 0) {
      // No customer message since the summary, and none exists at all
      // (agent-initiated thread): fall back to the capped recent window so
      // the draft still has something to respond to.
      recent = lastCustomer
        ? [lastCustomer]
        : await loadCappedRecentMessages(admin, workspaceId, conv.id)
    }
    customerMessage = lastCustomer?.body ?? customerMessage
  }

  return {
    summaryBlock: `Issue summary (covers earlier messages):\n${conv.ai_summary}`,
    recentBlock: `Messages since the summary, verbatim (oldest first):\n${formatTranscript(recent)}`,
    customerMessage,
  }
}

async function kbExcerpts(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  customerMessage: string | null,
): Promise<string> {
  const query = (customerMessage ?? '').trim()
  if (query.length < 3) return ''

  const { data, error } = await admin.rpc('search_kb_articles', {
    p_workspace_id: workspaceId,
    p_query: query.slice(0, 200),
    p_limit: 3,
  })

  if (error) {
    console.error('[ai] kb search for draft failed:', error.message)
    return ''
  }
  if (!data || data.length === 0) return ''

  const items = data.map((article, i) => {
    const excerpt = articleExcerpt(article.body, 400)
    return `${i + 1}. ${article.title}\n${excerpt}`
  })
  return `Knowledge base excerpts (use only if they answer the question):\n${items.join('\n\n')}`
}
