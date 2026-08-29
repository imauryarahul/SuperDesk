import 'server-only'

import { publicSupabaseConfig, serviceRoleKey } from '@/lib/env'

interface BroadcastMsg {
  /** Channel name WITHOUT the 'realtime:' prefix, e.g. 'conversation:123'. */
  topic: string
  /** Event name clients listen for. */
  event: string
  payload: Record<string, unknown>
}

export interface MessagePayload {
  id: string
  body: string
  sender_type: string
  sender_id: string | null
  created_at: string
}

/**
 * Fan-out for a newly persisted message. Two channels, two audiences:
 *
 * - `conversation:{id}` — the open thread. Both the widget and the agent
 *   viewing that thread are subscribed here.
 * - `inbox:{workspaceId}` — the agent conversation list, so a thread bumps to
 *   the top and shows unread without the agent having that thread open.
 *
 * Postgres Changes also covers the dashboard, but broadcast arrives sooner and
 * keeps working if the Realtime publication is ever misconfigured. Clients
 * dedupe by message id, so receiving both is harmless.
 */
export async function broadcastNewMessage(
  workspaceId: string,
  conversationId: string,
  message: MessagePayload,
): Promise<void> {
  await Promise.all([
    broadcast({
      topic: `conversation:${conversationId}`,
      event: 'new_message',
      payload: message as unknown as Record<string, unknown>,
    }),
    broadcast({
      topic: `inbox:${workspaceId}`,
      event: 'conversation_touch',
      payload: {
        conversationId,
        last_message_at: message.created_at,
        sender_type: message.sender_type,
      },
    }),
  ])
}

/**
 * Server-side Realtime broadcast via the Supabase HTTP broadcast API.
 * Doesn't open a WebSocket — safe for serverless / edge API routes.
 *
 * Failure is non-fatal: clients re-sync on reconnect, so we log and continue.
 */
export async function broadcast(msg: BroadcastMsg): Promise<void> {
  const { url } = publicSupabaseConfig()
  const key = serviceRoleKey()

  try {
    const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ topic: msg.topic, event: msg.event, payload: msg.payload }],
      }),
    })
    if (!res.ok) {
      console.error(`[realtime] broadcast failed ${res.status}: ${await res.text()}`)
    }
  } catch (err) {
    console.error('[realtime] broadcast network error:', err)
  }
}
