'use client'

import type { RealtimeChannel } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'

import { SlaBadge, SlaDot } from '@/components/sla-badge'
import { fetchConversationsSla, type ConversationSla } from '@/lib/sla'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'

import { assignConversationAction, sendAgentMessageAction, setConversationStatusAction } from './actions'
import {
  type AgentProfile,
  type InboxFilter,
  CONV_SELECT,
  DEFAULT_FILTER,
  filterToParams,
} from './queries'
import { SummaryPanel } from './summary-panel'

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
  subject: string | null
  assigned_agent_id: string | null
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
  /** Keyed by conversation id. A plain object rather than a Map so it crosses
   * the server-component boundary without relying on Map serialization. */
  initialSla: Record<string, ConversationSla>
  initialFilter: InboxFilter
  agents: AgentProfile[]
}

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected'

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

function byCreatedAt(a: MsgRow, b: MsgRow): number {
  return a.created_at.localeCompare(b.created_at)
}

function sortConvs(list: ConvRow[]): ConvRow[] {
  return [...list].sort((a, b) => b.last_message_at.localeCompare(a.last_message_at))
}

/**
 * Returns true when a conversation row satisfies all active filter dimensions.
 * Used by upsertConv to decide whether an incoming realtime update belongs in
 * the current view or should be removed.
 */
function matchesFilter(conv: ConvRow, f: InboxFilter, profileId: string): boolean {
  if (f.status !== 'all' && conv.status !== f.status) return false
  if (f.channel !== 'all' && conv.channel !== f.channel) return false
  if (f.assignee === 'me' && conv.assigned_agent_id !== profileId) return false
  if (f.assignee === 'unassigned' && conv.assigned_agent_id !== null) return false
  if (
    f.assignee !== 'all' &&
    f.assignee !== 'me' &&
    f.assignee !== 'unassigned' &&
    conv.assigned_agent_id !== f.assignee
  )
    return false
  return true
}

function agentDisplayName(a: AgentProfile): string {
  return a.full_name ?? a.email
}

function agentShortName(a: AgentProfile): string {
  const name = a.full_name ?? a.email
  return name.split(' ')[0] ?? name
}

// ---------------------------------------------------------------------------
// Small UI components
// ---------------------------------------------------------------------------

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

function StatusPill({ status }: { status: ConvStatus }) {
  if (status === 'open') return null
  const map: Record<string, string> = {
    snoozed: 'bg-amber-50 text-amber-700',
    resolved: 'bg-emerald-50 text-emerald-700',
  }
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium capitalize ${map[status]}`}>
      {status}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InboxClient({
  workspaceId,
  profileId,
  profileName,
  initialConversations,
  initialSla,
  initialFilter,
  agents: initialAgents,
}: Props) {
  const [filter, setFilter] = useState<InboxFilter>(initialFilter)
  const [conversations, setConversations] = useState<ConvRow[]>(initialConversations)
  const [agents, setAgents] = useState<AgentProfile[]>(initialAgents)
  const [sla, setSla] = useState<Record<string, ConversationSla>>(initialSla)
  /** Bumped by anything that stops or restarts an SLA clock, to force a refetch. */
  const [slaNonce, setSlaNonce] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(initialConversations[0]?.id ?? null)
  const [messages, setMessages] = useState<MsgRow[]>([])
  const [visitorTyping, setVisitorTyping] = useState(false)
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('connecting')
  const [onlineVisitors, setOnlineVisitors] = useState<Set<string>>(new Set())
  const [unread, setUnread] = useState<Set<string>>(new Set())
  const [sendError, setSendError] = useState<string | null>(null)
  const [composerText, setComposerText] = useState('')
  const [draftActive, setDraftActive] = useState(false)
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const messagesScrollRef = useRef<HTMLDivElement>(null)
  const latestCreatedAtRef = useRef('')
  const threadChannelRef = useRef<RealtimeChannel | null>(null)
  const selectedIdRef = useRef<string | null>(selectedId)
  // Stable ref so subscription closures always read the latest filter value
  // without needing to re-subscribe on every filter change.
  const filterRef = useRef<InboxFilter>(filter)

  const supabase = createClient()

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    filterRef.current = filter
  }, [filter])

  // Scrolls the message pane itself rather than calling scrollIntoView on a
  // trailing anchor: scrollIntoView walks up and scrolls every scrollable
  // ancestor, so when the pane is not yet the scroll container it drags <main>
  // to the bottom and exposes empty space under the layout.
  useEffect(() => {
    const pane = messagesScrollRef.current
    if (!pane) return
    pane.scrollTo({ top: pane.scrollHeight, behavior: 'smooth' })
  }, [messages, visitorTyping])

  // ---- Update URL when filter changes (no RSC re-render) ----
  useEffect(() => {
    const search = filterToParams(filter)
    const url = search ? `/inbox?${search}` : '/inbox'
    window.history.replaceState({}, '', url)
  }, [filter])

  // ---- Load conversation list for the active filter ----
  useEffect(() => {
    let cancelled = false
    let query = supabase
      .from('conversations')
      .select(CONV_SELECT)
      .eq('workspace_id', workspaceId)
      .order('last_message_at', { ascending: false })
      .limit(50)

    if (filter.status !== 'all') query = query.eq('status', filter.status)
    if (filter.channel !== 'all') query = query.eq('channel', filter.channel)
    if (filter.assignee === 'me') query = query.eq('assigned_agent_id', profileId)
    else if (filter.assignee === 'unassigned') query = query.is('assigned_agent_id', null)
    else if (filter.assignee !== 'all') query = query.eq('assigned_agent_id', filter.assignee)

    query.then(({ data }) => {
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
  }, [filter, workspaceId, profileId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- SLA for the visible rows ----
  // One RPC for the whole list, re-run when the set of visible conversations or
  // their statuses change, and on a 60s timer.
  //
  // The timer is not laziness: SLA state is computed from now(), so a
  // conversation crosses from approaching into breached with no row change and
  // therefore no realtime event to react to. Without it a badge would sit on the
  // wrong colour until the agent navigated away.
  const convSignature = conversations.map((c) => `${c.id}:${c.status}`).join(',')

  useEffect(() => {
    const ids = convSignature ? convSignature.split(',').map((entry) => entry.split(':')[0]!) : []
    if (ids.length === 0) {
      setSla({})
      return
    }

    let cancelled = false
    const load = () => {
      void fetchConversationsSla(supabase, ids).then((map) => {
        if (!cancelled) setSla(Object.fromEntries(map))
      })
    }

    load()
    const timer = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [convSignature, slaNonce]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Load the selected thread ----
  useEffect(() => {
    setSendError(null)
    setComposerText('')
    setDraftActive(false)
    setDraftLoading(false)
    setDraftError(null)
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
  // filterRef is used inside callbacks so this effect does NOT need filter in
  // its deps — it stays alive across filter changes, avoiding a reconnect on
  // every click.
  useEffect(() => {
    const client = supabase

    const upsertConv = (row: ConvRow) => {
      setConversations((prev) => {
        if (!matchesFilter(row, filterRef.current, profileId)) {
          return prev.filter((c) => c.id !== row.id)
        }
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
          // postgres_changes carries no joined contact; re-read the full row.
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
      // New chat conversation created by the widget.
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
      // Status or assignee changed by any agent — provides immediate feedback
      // to all open inboxes without waiting for the postgres_changes path.
      .on(
        'broadcast',
        { event: 'conversation_updated' },
        ({ payload }: { payload: { conversation: ConvRow } }) => {
          if (payload.conversation) upsertConv(payload.conversation)
        },
      )
      // A teammate was removed. Drop them from the assignee picker; the FK
      // already nulls assigned_agent_id, which postgres_changes will also
      // carry, but the agents list is local state and would otherwise linger.
      .on(
        'broadcast',
        { event: 'agent_removed' },
        ({ payload }: { payload: { profileId?: string } }) => {
          const removedId = payload.profileId
          if (!removedId) return
          if (removedId === profileId) {
            window.location.reload()
            return
          }
          setAgents((prev) => prev.filter((a) => a.id !== removedId))
          setConversations((prev) =>
            prev
              .map((c) =>
                c.assigned_agent_id === removedId ? { ...c, assigned_agent_id: null } : c,
              )
              .filter((c) => matchesFilter(c, filterRef.current, profileId)),
          )
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
  }, [workspaceId, profileId, profileName]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Per-conversation: messages + typing ----
  useEffect(() => {
    if (!selectedId) return
    const client = supabase
    let everSubscribed = false

    const ch = client
      .channel(`conversation:${selectedId}`)
      .on('broadcast', { event: 'new_message' }, ({ payload }: { payload: MsgRow }) => {
        mergeMessage(payload)
      })
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

  // ---- Mutations ----

  const handleSend = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      const convId = selectedId
      if (!convId) return
      const body = composerText.trim()
      if (!body) return

      const clientId = crypto.randomUUID()
      setComposerText('')
      setDraftActive(false)
      setDraftError(null)
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
          // A first reply stops the first-response clock, and the row's status
          // has not changed, so nothing else would trigger a refetch.
          setSlaNonce((n) => n + 1)
        } else {
          setMessages((prev) =>
            prev.map((m) => (m.id === clientId ? { ...m, optimistic: false, failed: true } : m)),
          )
          setSendError(result.error)
        }
      })
    },
    [selectedId, profileId, composerText, mergeMessage, stopTyping],
  )

  const handleDraftReply = useCallback(async () => {
    const convId = selectedId
    if (!convId || draftLoading) return
    setDraftLoading(true)
    setDraftError(null)
    try {
      const res = await fetch('/api/inbox/draft-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: convId }),
      })
      const data: unknown = await res.json().catch(() => null)
      if (
        !res.ok ||
        typeof data !== 'object' ||
        data === null ||
        !('draft' in data) ||
        typeof (data as { draft: unknown }).draft !== 'string'
      ) {
        setDraftError("Couldn't draft a reply")
        return
      }
      setComposerText((data as { draft: string }).draft.slice(0, 2000))
      setDraftActive(true)
    } catch {
      setDraftError("Couldn't draft a reply")
    } finally {
      setDraftLoading(false)
    }
  }, [selectedId, draftLoading])

  const discardDraft = useCallback(() => {
    setComposerText('')
    setDraftActive(false)
    setDraftError(null)
  }, [])

  const changeStatus = useCallback(
    (next: 'open' | 'snoozed' | 'resolved') => {
      const convId = selectedId
      if (!convId) return
      startTransition(async () => {
        await setConversationStatusAction(convId, next)
        // The conversation_updated broadcast will handle the remote update.
        // Locally, drop it from the list if it no longer matches the filter.
        setConversations((prev) => {
          const conv = prev.find((c) => c.id === convId)
          // The conversation_updated broadcast may have already removed this row
          // from the list before this optimistic update runs.
          if (!conv) {
            if (selectedIdRef.current === convId) {
              setSelectedId(prev[0]?.id ?? null)
            }
            return prev
          }
          const updated = prev.map((c) => (c.id === convId ? { ...c, status: next } : c))
          if (!matchesFilter({ ...conv, status: next }, filterRef.current, profileId)) {
            const remaining = updated.filter((c) => c.id !== convId)
            setSelectedId(remaining[0]?.id ?? null)
            return remaining
          }
          return updated
        })
      })
    },
    [selectedId, profileId],
  )

  const handleAssign = useCallback(
    (convId: string, agentId: string | null) => {
      startTransition(async () => {
        const result = await assignConversationAction(convId, agentId)
        if (result.error) {
          console.error('[assign]', result.error)
          return
        }
        // Optimistically update local state; broadcast covers remote viewers.
        setConversations((prev) => {
          const updated = prev.map((c) =>
            c.id === convId ? { ...c, assigned_agent_id: agentId } : c,
          )
          const conv = updated.find((c) => c.id === convId)
          if (conv && !matchesFilter(conv, filterRef.current, profileId)) {
            const remaining = updated.filter((c) => c.id !== convId)
            if (selectedId === convId) setSelectedId(remaining[0]?.id ?? null)
            return remaining
          }
          return updated
        })
      })
    },
    [selectedId, profileId],
  )

  const handleFilterChange = useCallback((next: InboxFilter) => {
    setFilter(next)
  }, [])

  const selected = conversations.find((c) => c.id === selectedId) ?? null
  const isEmail = selected?.channel === 'email'

  const assignedAgent = selected?.assigned_agent_id
    ? agents.find((a) => a.id === selected.assigned_agent_id) ?? null
    : null

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Conversation list */}
      <aside className="flex min-h-0 w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
        {/* Header */}
        <div className="border-b border-slate-200 px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-sm font-semibold text-slate-900">Inbox</h1>
            <div className="flex items-center gap-2">
              {/* "Assigned to me" quick chip */}
              <button
                type="button"
                onClick={() =>
                  handleFilterChange({
                    ...filter,
                    assignee: filter.assignee === 'me' ? DEFAULT_FILTER.assignee : 'me',
                  })
                }
                aria-pressed={filter.assignee === 'me'}
                title={filter.assignee === 'me' ? 'Clear assignee filter' : 'Show assigned to me'}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition ${
                  filter.assignee === 'me'
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-700'
                }`}
              >
                Me
                {filter.assignee === 'me' && (
                  <svg viewBox="0 0 12 12" aria-hidden="true" className="h-2.5 w-2.5 shrink-0 fill-current">
                    <path d="M2.2 2.2a.75.75 0 0 1 1.06 0L6 4.94l2.74-2.74a.75.75 0 1 1 1.06 1.06L7.06 6l2.74 2.74a.75.75 0 0 1-1.06 1.06L6 7.06l-2.74 2.74a.75.75 0 0 1-1.06-1.06L4.94 6 2.2 3.26a.75.75 0 0 1 0-1.06Z" />
                  </svg>
                )}
              </button>
              {/* Live indicator */}
              <span
                className="flex items-center gap-1 text-xs"
                title={`Realtime: ${connStatus}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    connStatus === 'connected'
                      ? 'bg-emerald-500'
                      : 'bg-amber-500 motion-safe:animate-pulse'
                  }`}
                />
                <span
                  className={connStatus === 'connected' ? 'text-slate-400' : 'text-amber-600'}
                >
                  {connStatus === 'connected'
                    ? 'Live'
                    : connStatus === 'connecting'
                      ? 'Connecting'
                      : 'Reconnecting'}
                </span>
              </span>
            </div>
          </div>

          {/* Status filter */}
          <div className="mt-2.5 flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
            {(['open', 'snoozed', 'resolved', 'all'] as const).map((s) => (
              <button
                key={s}
                onClick={() => handleFilterChange({ ...filter, status: s })}
                className={`flex-1 rounded-md px-1 py-1 text-xs font-medium capitalize transition ${
                  filter.status === s
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {s === 'all' ? 'All' : s}
              </button>
            ))}
          </div>

          {/* Channel + Assignee filters */}
          <div className="mt-1.5 flex gap-1.5">
            <select
              value={filter.channel}
              onChange={(e) =>
                handleFilterChange({ ...filter, channel: e.target.value as InboxFilter['channel'] })
              }
              className="flex-1 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600 outline-none focus:border-slate-400"
            >
              <option value="all">All channels</option>
              <option value="chat">Live chat</option>
              <option value="email">Email</option>
            </select>

            <select
              value={filter.assignee}
              onChange={(e) => handleFilterChange({ ...filter, assignee: e.target.value })}
              className="flex-1 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600 outline-none focus:border-slate-400"
            >
              <option value="all">All agents</option>
              <option value="me">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {agentDisplayName(a)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Conversation list */}
        {conversations.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-400">
            No conversations
          </div>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {conversations.map((conv) => {
              const isActive = conv.id === selectedId
              const visitorOnline =
                !!conv.contacts?.anonymous_token &&
                onlineVisitors.has(conv.contacts.anonymous_token)
              const assignedTo = conv.assigned_agent_id
                ? agents.find((a) => a.id === conv.assigned_agent_id)
                : null

              return (
                <li key={conv.id} className="border-b border-slate-100 last:border-0">
                  {/*
                   * The row is a div+role rather than a button so the <select>
                   * inside is a valid interactive element (no nested buttons).
                   */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(conv.id)}
                    onKeyDown={(e) => e.key === 'Enter' && setSelectedId(conv.id)}
                    className={`w-full cursor-pointer border-l-2 px-3 py-3 text-left transition ${
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

                    <div className="mt-1 flex items-center justify-between gap-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <SlaDot sla={sla[conv.id]} />
                        <ChannelBadge channel={conv.channel} />
                        {filter.status === 'all' && conv.status !== 'open' && (
                          <StatusPill status={conv.status} />
                        )}
                        {visitorOnline && (
                          <span className="flex items-center gap-1 text-xs text-emerald-600">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            online
                          </span>
                        )}
                      </div>

                      {/* Quick assign — stopPropagation prevents row selection */}
                      <div
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <select
                          value={conv.assigned_agent_id ?? ''}
                          onChange={(e) => {
                            handleAssign(conv.id, e.target.value || null)
                          }}
                          className="max-w-[72px] truncate rounded border border-slate-200 bg-white px-1 py-0.5 text-xs text-slate-500 outline-none focus:border-slate-400"
                          title={assignedTo ? agentDisplayName(assignedTo) : 'Unassigned'}
                        >
                          <option value="">–</option>
                          {agents.map((a) => (
                            <option key={a.id} value={a.id}>
                              {agentShortName(a)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </aside>

      {/* Thread */}
      {selected ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Thread header */}
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate font-medium text-slate-900">
                  {contactLabel(selected.contacts)}
                </p>
                <ChannelBadge channel={selected.channel} />
                <SlaBadge sla={sla[selected.id]} />
              </div>
              <p className="truncate text-xs text-slate-500">
                {selected.subject ? `${selected.subject} · ` : ''}
                <span className="capitalize">{selected.status}</span>
                {assignedAgent && (
                  <span className="text-slate-400"> · {agentDisplayName(assignedAgent)}</span>
                )}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {/* Assignee picker */}
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-slate-400">Assign</label>
                <select
                  value={selected.assigned_agent_id ?? ''}
                  onChange={(e) => handleAssign(selected.id, e.target.value || null)}
                  disabled={pending}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-700 outline-none transition focus:border-slate-400 disabled:opacity-50"
                >
                  <option value="">Unassigned</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {agentDisplayName(a)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Snooze / Unsnooze */}
              {selected.status !== 'resolved' && (
                <button
                  onClick={() =>
                    changeStatus(selected.status === 'snoozed' ? 'open' : 'snoozed')
                  }
                  disabled={pending}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  {selected.status === 'snoozed' ? 'Unsnooze' : 'Snooze'}
                </button>
              )}

              {/* Resolve / Reopen */}
              <button
                onClick={() =>
                  changeStatus(selected.status === 'resolved' ? 'open' : 'resolved')
                }
                disabled={pending}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                  selected.status === 'resolved'
                    ? 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    : 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
                }`}
              >
                {selected.status === 'resolved' ? 'Reopen' : 'Resolve'}
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={messagesScrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mx-auto max-w-2xl space-y-2">
              <SummaryPanel conversationId={selected.id} messageCount={messages.length} />

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
                    title={
                      msg.failed ? 'Failed to send' : new Date(msg.created_at).toLocaleString()
                    }
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
            </div>
          </div>

          {/* Composer */}
          <form onSubmit={handleSend} className="border-t border-slate-200 bg-white px-4 py-3">
            <div className="mx-auto max-w-2xl">
              {sendError && (
                <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  {sendError}
                </p>
              )}
              {(draftActive || draftError) && (
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className={`text-xs ${draftError ? 'text-red-700' : 'text-slate-400'}`}>
                    {draftError ?? 'AI draft — edit before sending'}
                  </p>
                  {draftActive && (
                    <button
                      type="button"
                      onClick={discardDraft}
                      className="text-xs font-medium text-slate-600 underline-offset-2 hover:underline"
                    >
                      Discard draft
                    </button>
                  )}
                </div>
              )}
              <textarea
                name="message"
                rows={isEmail ? 3 : 2}
                value={composerText}
                onChange={(e) => {
                  setComposerText(e.target.value)
                  if (!isEmail) signalTyping()
                }}
                onBlur={isEmail ? undefined : stopTyping}
                placeholder={
                  isEmail
                    ? `Reply by email to ${selected.contacts?.email ?? 'this contact'}…`
                    : 'Reply…'
                }
                maxLength={2000}
                className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => void handleDraftReply()}
                  disabled={draftLoading || pending}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {draftLoading ? 'Drafting…' : 'Draft reply'}
                </button>
                <button
                  type="submit"
                  disabled={pending || (!isEmail && connStatus === 'disconnected')}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
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
