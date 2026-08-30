'use client'

import type { RealtimeChannel } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'

import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'

import { sendAgentMessageAction, setConversationStatusAction } from './actions'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConvStatus = Database['public']['Enums']['conversation_status']
type ConvChannel = Database['public']['Enums']['conversation_channel']

export interface ConvRow {
  id: string
  status: ConvStatus
  last_message_at: string
  channel: ConvChannel
  /** Email threads carry the subject that opened them; chat has none. */
  subject: string | null
  contacts: { id: string; email: string | null; anonymous_token: string | null } | null
}

export interface MsgRow {
  id: string
  body: string
  sender_type: Database['public']['Enums']['message_sender_type']
  sender_id: string | null
  created_at: string
  optimistic?: boolean
  failed?: boolean
}

interface Props {
  workspaceId: string
  profileId: string
  profileName: string
  initialConversations: ConvRow[]
}

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected'
type StatusFilter = 'open' | 'resolved'

export const CONV_SELECT =
  'id, status, last_message_at, channel, subject, contacts(id, email, anonymous_token)'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function contactLabel(c: ConvRow['contacts']): string {
  if (!c) return 'Unknown'
  if (c.email) return c.email
  if (c.anonymous_token) return `Visitor ${c.anonymous_token.slice(0, 8)}`
  return 'Anonymous visitor'
}

function relativeTime(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** Newest last. Sorting on every merge is what guarantees thread order. */
function byCreatedAt(a: MsgRow, b: MsgRow): number {
  return a.created_at.localeCompare(b.created_at)
}

function sortConvs(list: ConvRow[]): ConvRow[] {
  return [...list].sort((a, b) => b.last_message_at.localeCompare(a.last_message_at))
}

/**
 * Email and live chat share every component in this view, so the channel has to
 * be legible at a glance — an agent replying in an email thread is writing
 * something the customer reads in their mail client minutes later, not a chat
 * message they are waiting on right now.
 */
function ChannelBadge({ channel }: { channel: ConvChannel }) {
  const isEmail = channel === 'email'
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium ${
        isEmail ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-500'
      }`}
    >
      <ChannelIcon channel={channel} />
      {isEmail ? 'Email' : 'Live chat'}
    </span>
  )
}

function ChannelIcon({ channel }: { channel: ConvChannel }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3 w-3 shrink-0 fill-current">
      {channel === 'email' ? (
        <path d="M1.5 4.4A1.9 1.9 0 0 1 3.4 2.5h9.2a1.9 1.9 0 0 1 1.9 1.9v7.2a1.9 1.9 0 0 1-1.9 1.9H3.4a1.9 1.9 0 0 1-1.9-1.9V4.4Zm1.9-.4a.4.4 0 0 0-.36.58l4.6 3.45a.6.6 0 0 0 .72 0l4.6-3.45A.4.4 0 0 0 12.6 4H3.4Z" />
      ) : (
        <path d="M8 2C4.4 2 1.5 4.4 1.5 7.4c0 1.7.9 3.2 2.4 4.2l-.6 2.1a.4.4 0 0 0 .57.46l2.5-1.24c.5.1 1.04.16 1.6.16 3.6 0 6.5-2.4 6.5-5.4S11.6 2 8 2Z" />
      )}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InboxClient({ workspaceId, profileId, profileName, initialConversations }: Props) {
  const [filter, setFilter] = useState<StatusFilter>('open')
  const [conversations, setConversations] = useState<ConvRow[]>(initialConversations)
  const [selectedId, setSelectedId] = useState<string | null>(initialConversations[0]?.id ?? null)
  const [messages, setMessages] = useState<MsgRow[]>([])
  const [visitorTyping, setVisitorTyping] = useState(false)
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('connecting')
  const [onlineVisitors, setOnlineVisitors] = useState<Set<string>>(new Set())
  const [unread, setUnread] = useState<Set<string>>(new Set())
  // Email sends fail for reasons the agent can act on (unverified sender, no
  // address on the contact), so the reason is shown rather than just a red bubble.
  const [sendError, setSendError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const latestCreatedAtRef = useRef('')
  // The subscribed thread channel. Typing sends must reuse this instance —
  // calling supabase.channel() again returns an unsubscribed channel that
  // silently drops everything passed to send().
  const threadChannelRef = useRef<RealtimeChannel | null>(null)
  const selectedIdRef = useRef<string | null>(selectedId)

  const supabase = createClient()

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, visitorTyping])

  // ---- Load conversation list for the active filter ----
  useEffect(() => {
    let cancelled = false
    supabase
      .from('conversations')
      .select(CONV_SELECT)
      .eq('workspace_id', workspaceId)
      .eq('status', filter)
      .order('last_message_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (cancelled) return
        const rows = (data ?? []) as unknown as ConvRow[]
        setConversations(rows)
        setSelectedId((current) =>
          current && rows.some((r) => r.id === current) ? current : (rows[0]?.id ?? null),
        )
      })
    return () => {
      cancelled = true
    }
  }, [filter, workspaceId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Load the selected thread ----
  useEffect(() => {
    setSendError(null)
    if (!selectedId) {
      setMessages([])
      latestCreatedAtRef.current = ''
      return
    }
    let cancelled = false
    supabase
      .from('messages')
      .select('id, body, sender_type, sender_id, created_at')
      .eq('conversation_id', selectedId)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
      .limit(200)
      .then(({ data }) => {
        if (cancelled) return
        const rows: MsgRow[] = (data ?? []).map((m) => ({ ...m, optimistic: false }))
        setMessages(rows)
        latestCreatedAtRef.current = rows.at(-1)?.created_at ?? ''
      })
    setUnread((prev) => {
      if (!prev.has(selectedId)) return prev
      const next = new Set(prev)
      next.delete(selectedId)
      return next
    })
    return () => {
      cancelled = true
    }
  }, [selectedId, workspaceId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Merge a message into the open thread, deduped by id and re-sorted ----
  const mergeMessage = useCallback((incoming: MsgRow) => {
    setMessages((prev) => {
      const existing = prev.find((m) => m.id === incoming.id)
      if (existing) {
        // Confirms an optimistic send: same id, now server-authoritative.
        return prev
          .map((m) => (m.id === incoming.id ? { ...incoming, optimistic: false } : m))
          .sort(byCreatedAt)
      }
      return [...prev, { ...incoming, optimistic: false }].sort(byCreatedAt)
    })
    if (incoming.created_at > latestCreatedAtRef.current) {
      latestCreatedAtRef.current = incoming.created_at
    }
  }, [])

  // ---- Workspace-level: conversation list + presence ----
  useEffect(() => {
    const client = supabase

    const upsertConv = (row: ConvRow) => {
      setConversations((prev) => {
        // A conversation that no longer matches the active filter drops out.
        if (row.status !== filter) return prev.filter((c) => c.id !== row.id)
        const exists = prev.some((c) => c.id === row.id)
        if (exists) return sortConvs(prev.map((c) => (c.id === row.id ? { ...c, ...row } : c)))
        return sortConvs([row, ...prev])
      })
    }

    const inboxChannel = client
      .channel(`inbox:${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as { id?: string }
            if (old.id) setConversations((prev) => prev.filter((c) => c.id !== old.id))
            return
          }
          const row = payload.new as { id: string; status: ConvStatus }
          // postgres_changes carries no joined contact, so re-read the row.
          client
            .from('conversations')
            .select(CONV_SELECT)
            .eq('id', row.id)
            .maybeSingle()
            .then(({ data }) => {
              if (data) upsertConv(data as unknown as ConvRow)
            })
        },
      )
      // A brand new chat, pushed by the widget conversation route.
      .on(
        'broadcast',
        { event: 'conversation_started' },
        ({ payload }: { payload: { conversation: ConvRow } }) => {
          if (payload.conversation) upsertConv(payload.conversation)
        },
      )
      // A message landed in some conversation: bump it and flag unread.
      .on(
        'broadcast',
        { event: 'conversation_touch' },
        ({
          payload,
        }: {
          payload: { conversationId: string; last_message_at: string; sender_type: string }
        }) => {
          setConversations((prev) =>
            sortConvs(
              prev.map((c) =>
                c.id === payload.conversationId
                  ? { ...c, last_message_at: payload.last_message_at }
                  : c,
              ),
            ),
          )
          if (
            payload.sender_type === 'contact' &&
            payload.conversationId !== selectedIdRef.current
          ) {
            setUnread((prev) => new Set(prev).add(payload.conversationId))
          }
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setConnStatus('connected')
        if (status === 'CLOSED' || status === 'CHANNEL_ERROR') setConnStatus('disconnected')
      })

    const presenceChannel = client
      .channel(`presence:${workspaceId}`, { config: { presence: { key: profileId } } })
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState<{ type?: string; session?: string }>()
        const visitors = new Set<string>()
        for (const presences of Object.values(state)) {
          for (const p of presences) {
            if (p.type === 'visitor' && p.session) visitors.add(p.session)
          }
        }
        setOnlineVisitors(visitors)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({ type: 'agent', agentId: profileId, name: profileName })
        }
      })

    return () => {
      client.removeChannel(inboxChannel)
      client.removeChannel(presenceChannel)
    }
  }, [workspaceId, profileId, profileName, filter]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Per-conversation: messages + typing ----
  // Topic must match what the widget and the server broadcast to.
  useEffect(() => {
    if (!selectedId) return
    const client = supabase
    let everSubscribed = false

    const ch = client
      .channel(`conversation:${selectedId}`)
      .on('broadcast', { event: 'new_message' }, ({ payload }: { payload: MsgRow }) => {
        mergeMessage(payload)
      })
      // Authoritative delivery. Broadcast usually wins the race; dedupe by id
      // means whichever arrives second is a no-op.
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${selectedId}`,
        },
        (payload) => mergeMessage(payload.new as MsgRow),
      )
      .on(
        'broadcast',
        { event: 'typing' },
        ({ payload }: { payload: { sender: string; active: boolean } }) => {
          if (payload.sender === 'contact') setVisitorTyping(payload.active)
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnStatus('connected')
          // Realtime can drop messages while the socket is down, so re-read
          // anything created after the newest message we hold.
          if (everSubscribed && latestCreatedAtRef.current) {
            client
              .from('messages')
              .select('id, body, sender_type, sender_id, created_at')
              .eq('conversation_id', selectedId)
              .eq('workspace_id', workspaceId)
              .gt('created_at', latestCreatedAtRef.current)
              .order('created_at', { ascending: true })
              .then(({ data }) => {
                for (const m of data ?? []) mergeMessage({ ...m, optimistic: false })
              })
          }
          everSubscribed = true
        }
        if (status === 'CLOSED' || status === 'CHANNEL_ERROR') setConnStatus('disconnected')
      })

    threadChannelRef.current = ch

    return () => {
      setVisitorTyping(false)
      threadChannelRef.current = null
      client.removeChannel(ch)
    }
  }, [selectedId, workspaceId, mergeMessage]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Agent typing signal ----
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typingActiveRef = useRef(false)

  const signalTyping = useCallback(() => {
    const ch = threadChannelRef.current
    if (!ch) return
    const send = (active: boolean) =>
      ch
        .send({ type: 'broadcast', event: 'typing', payload: { sender: 'agent', active } })
        .catch(() => undefined)

    if (!typingActiveRef.current) {
      typingActiveRef.current = true
      send(true)
    }
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => {
      typingActiveRef.current = false
      send(false)
    }, 1500)
  }, [])

  const stopTyping = useCallback(() => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    if (typingActiveRef.current && threadChannelRef.current) {
      typingActiveRef.current = false
      threadChannelRef.current
        .send({ type: 'broadcast', event: 'typing', payload: { sender: 'agent', active: false } })
        .catch(() => undefined)
    }
  }, [])

  // ---- Send ----
  const handleSend = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      const convId = selectedId
      if (!convId) return
      const input = e.currentTarget.elements.namedItem('message') as
        | HTMLInputElement
        | HTMLTextAreaElement
      const body = input.value.trim()
      if (!body) return

      const clientId = crypto.randomUUID()
      input.value = ''
      setSendError(null)
      stopTyping()

      setMessages((prev) =>
        [
          ...prev,
          {
            id: clientId,
            body,
            sender_type: 'agent' as const,
            sender_id: profileId,
            created_at: new Date().toISOString(),
            optimistic: true,
          },
        ].sort(byCreatedAt),
      )

      startTransition(async () => {
        const result = await sendAgentMessageAction(convId, body, clientId)
        if (result.message) {
          mergeMessage(result.message as MsgRow)
          setConversations((prev) =>
            sortConvs(
              prev.map((c) =>
                c.id === convId ? { ...c, last_message_at: result.message!.created_at } : c,
              ),
            ),
          )
        } else {
          setMessages((prev) =>
            prev.map((m) => (m.id === clientId ? { ...m, optimistic: false, failed: true } : m)),
          )
          setSendError(result.error)
        }
      })
    },
    [selectedId, profileId, mergeMessage, stopTyping],
  )

  const changeStatus = useCallback(
    (next: 'open' | 'resolved') => {
      const convId = selectedId
      if (!convId) return
      startTransition(async () => {
        await setConversationStatusAction(convId, next)
        setConversations((prev) => {
          const remaining = prev.filter((c) => c.id !== convId)
          setSelectedId(remaining[0]?.id ?? null)
          return remaining
        })
      })
    },
    [selectedId],
  )

  const selected = conversations.find((c) => c.id === selectedId) ?? null
  const isEmail = selected?.channel === 'email'

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="flex items-center justify-between">
            <h1 className="text-sm font-semibold text-slate-900">Inbox</h1>
            <span
              className="flex items-center gap-1.5 text-xs"
              title={`Realtime: ${connStatus}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  connStatus === 'connected'
                    ? 'bg-emerald-500'
                    : 'bg-amber-500 motion-safe:animate-pulse'
                }`}
              />
              <span className={connStatus === 'connected' ? 'text-slate-400' : 'text-amber-600'}>
                {connStatus === 'connected'
                  ? 'Live'
                  : connStatus === 'connecting'
                    ? 'Connecting'
                    : 'Reconnecting'}
              </span>
            </span>
          </div>

          <div className="mt-3 flex gap-1 rounded-lg bg-slate-100 p-0.5">
            {(['open', 'resolved'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 rounded-md px-2 py-1 text-xs font-medium capitalize transition ${
                  filter === f
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {conversations.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-400">
            No {filter} conversations
          </div>
        ) : (
          <ul className="flex-1 overflow-y-auto">
            {conversations.map((conv) => {
              const isActive = conv.id === selectedId
              const visitorOnline =
                !!conv.contacts?.anonymous_token &&
                onlineVisitors.has(conv.contacts.anonymous_token)
              return (
                <li key={conv.id}>
                  <button
                    onClick={() => setSelectedId(conv.id)}
                    className={`w-full border-l-2 px-4 py-3 text-left transition ${
                      isActive
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-transparent hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {unread.has(conv.id) && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                        )}
                        <span
                          className={`truncate text-sm ${
                            unread.has(conv.id)
                              ? 'font-semibold text-slate-900'
                              : 'font-medium text-slate-800'
                          }`}
                        >
                          {contactLabel(conv.contacts)}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-slate-400">
                        {relativeTime(conv.last_message_at)}
                      </span>
                    </div>
                    {conv.subject && (
                      <p className="mt-0.5 truncate text-xs text-slate-500">{conv.subject}</p>
                    )}
                    <div className="mt-1 flex items-center gap-1.5">
                      <ChannelBadge channel={conv.channel} />
                      {visitorOnline && (
                        <span className="flex items-center gap-1 text-xs text-emerald-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          online
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </aside>

      {/* Thread */}
      {selected ? (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate font-medium text-slate-900">
                  {contactLabel(selected.contacts)}
                </p>
                <ChannelBadge channel={selected.channel} />
              </div>
              <p className="truncate text-xs text-slate-500">
                {selected.subject ? `${selected.subject} · ` : ''}
                <span className="capitalize">{selected.status}</span>
              </p>
            </div>
            <button
              onClick={() => changeStatus(selected.status === 'resolved' ? 'open' : 'resolved')}
              disabled={pending}
              className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {selected.status === 'resolved' ? 'Reopen' : 'Resolve'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="mx-auto max-w-2xl space-y-2">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${
                    msg.sender_type === 'agent'
                      ? 'justify-end'
                      : msg.sender_type === 'system'
                        ? 'justify-center'
                        : 'justify-start'
                  }`}
                >
                  <div
                    className={`max-w-sm whitespace-pre-wrap break-words rounded-2xl px-4 py-2 text-sm ${
                      msg.sender_type === 'agent'
                        ? `rounded-br-sm bg-slate-900 text-white ${msg.optimistic ? 'opacity-60' : ''} ${
                            msg.failed ? 'bg-red-600' : ''
                          }`
                        : msg.sender_type === 'system'
                          ? 'text-xs text-slate-400'
                          : 'rounded-bl-sm bg-slate-100 text-slate-900'
                    }`}
                    title={msg.failed ? 'Failed to send' : new Date(msg.created_at).toLocaleString()}
                  >
                    {msg.body}
                  </div>
                </div>
              ))}

              {visitorTyping && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-3">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="h-1.5 w-1.5 rounded-full bg-slate-400 motion-safe:animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          <form onSubmit={handleSend} className="border-t border-slate-200 bg-white px-4 py-3">
            <div className="mx-auto max-w-2xl">
              {sendError && (
                <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  {sendError}
                </p>
              )}
              <div className="flex gap-2">
                {isEmail ? (
                  // A textarea rather than a single line: an email reply is a
                  // paragraph, and there is no realtime typing signal to send.
                  <textarea
                    name="message"
                    rows={3}
                    placeholder={`Reply by email to ${selected.contacts?.email ?? 'this contact'}…`}
                    maxLength={2000}
                    className="flex-1 resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                  />
                ) : (
                  <input
                    name="message"
                    type="text"
                    placeholder="Reply…"
                    maxLength={2000}
                    autoComplete="off"
                    onChange={signalTyping}
                    onBlur={stopTyping}
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                  />
                )}
                <button
                  type="submit"
                  // Email delivery does not depend on the Realtime socket, so a
                  // dropped socket must not block an email reply.
                  disabled={pending || (!isEmail && connStatus === 'disconnected')}
                  className="h-fit shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {pending && isEmail ? 'Sending…' : isEmail ? 'Send email' : 'Send'}
                </button>
              </div>
              {isEmail && (
                <p className="mt-1.5 text-xs text-slate-400">
                  Sent as a real email. Replies come back into this thread.
                </p>
              )}
            </div>
          </form>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
          Select a conversation to reply
        </div>
      )}
    </div>
  )
}
