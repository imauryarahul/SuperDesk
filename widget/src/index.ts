/**
 * SuperDesk chat widget
 *
 * Embed: <script src="https://app.example.com/widget.js" data-workspace-id="…"></script>
 * Manual: window.SuperDesk.boot({ workspaceId: '…', email: '…' })
 *
 * Bundle size: depends on @supabase/realtime-js for WebSocket / Presence.
 * Tree-shaking via esbuild keeps the output around 40 KB minified.
 */

import { RealtimeClient, type RealtimeChannel } from '@supabase/realtime-js'

// Injected at build time by esbuild `define`
declare const process: {
  env: { NEXT_PUBLIC_SUPABASE_URL: string; NEXT_PUBLIC_SUPABASE_ANON_KEY: string }
}
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BootOptions {
  workspaceId: string
  email?: string
}

interface RemoteMessage {
  id: string
  body: string
  sender_type: 'contact' | 'agent' | 'system'
  sender_id: string | null
  created_at: string
}

interface LocalMessage extends RemoteMessage {
  optimistic: boolean
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

interface SuggestedArticle {
  title: string
  excerpt: string
  url: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_PREFIX = 'sdesk_token_'
const MAX_BODY_LEN = 2000

/**
 * Two characters match too much to be useful, and firing on every keystroke
 * would put one request per character on the route. The route enforces the same
 * minimum, so a modified client gains nothing by lowering it.
 */
const SUGGEST_MIN_CHARS = 3
const SUGGEST_DEBOUNCE_MS = 300

// ---------------------------------------------------------------------------
// Derive API base URL from this script's own src.
// Falls back to the current page's origin only as a last resort.
// ---------------------------------------------------------------------------

const scriptEl = document.currentScript as HTMLScriptElement | null
const API_BASE = scriptEl?.src ? new URL(scriptEl.src).origin : window.location.origin

// ---------------------------------------------------------------------------
// Anonymous token
// ---------------------------------------------------------------------------

function getOrCreateToken(workspaceId: string): string {
  const key = `${TOKEN_PREFIX}${workspaceId}`
  const existing = localStorage.getItem(key)
  if (existing) return existing
  const token = crypto.randomUUID()
  localStorage.setItem(key, token)
  return token
}

// ---------------------------------------------------------------------------
// API helpers (all requests go through Next.js routes, never direct-to-Supabase)
// ---------------------------------------------------------------------------

async function apiPost<T>(path: string, workspaceId: string, data: unknown): Promise<T> {
  const url = `${API_BASE}${path}?workspaceId=${encodeURIComponent(workspaceId)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(err?.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

async function getMessages(
  workspaceId: string,
  conversationId: string,
  since?: string,
): Promise<RemoteMessage[]> {
  let url =
    `${API_BASE}/api/widget/messages` +
    `?workspaceId=${encodeURIComponent(workspaceId)}` +
    `&conversationId=${encodeURIComponent(conversationId)}`
  if (since) url += `&since=${encodeURIComponent(since)}`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = (await res.json()) as { messages: RemoteMessage[] }
  return data.messages
}

// ---------------------------------------------------------------------------
// CSS (injected into shadow root — host page styles cannot reach inside)
// ---------------------------------------------------------------------------

const WIDGET_CSS = `
:host {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #1e293b;
}
*, *::before, *::after { box-sizing: border-box; }

.bubble {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: #1e293b;
  cursor: pointer;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 14px rgba(0,0,0,0.28);
  transition: transform .15s, box-shadow .15s;
  z-index: 2147483647;
  padding: 0;
}
.bubble:hover { transform: scale(1.06); box-shadow: 0 6px 18px rgba(0,0,0,0.32); }
.bubble svg { width: 24px; height: 24px; fill: #fff; pointer-events: none; }

.panel {
  position: fixed;
  bottom: 84px;
  right: 20px;
  width: min(360px, calc(100vw - 32px));
  height: min(520px, calc(100vh - 104px));
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 2147483646;
  opacity: 0;
  transform: translateY(10px) scale(0.97);
  pointer-events: none;
  transition: opacity .2s ease, transform .2s ease;
}
.panel.open {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  background: #1e293b;
  color: #fff;
  flex-shrink: 0;
  border-radius: 16px 16px 0 0;
}
.header-left { display: flex; align-items: center; gap: 8px; }
.status-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #64748b; flex-shrink: 0;
  transition: background .4s;
}
.status-dot.online { background: #22c55e; }
.workspace-name { font-weight: 600; font-size: 14px; }
.close-btn {
  background: none; border: none; color: #94a3b8;
  cursor: pointer; font-size: 22px; line-height: 1;
  padding: 2px 4px; border-radius: 4px; margin: 0;
  display: flex; align-items: center; justify-content: center;
}
.close-btn:hover { color: #fff; }

.conn-banner {
  padding: 5px 12px;
  background: #fef3c7;
  color: #92400e;
  font-size: 11px;
  text-align: center;
  flex-shrink: 0;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.messages::-webkit-scrollbar { width: 4px; }
.messages::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 2px; }

.msg {
  max-width: 78%;
  padding: 8px 12px;
  border-radius: 14px;
  font-size: 13px;
  word-break: break-word;
  white-space: pre-wrap;
}
.msg.contact {
  align-self: flex-end;
  background: #1e293b;
  color: #fff;
  border-bottom-right-radius: 4px;
}
.msg.agent {
  align-self: flex-start;
  background: #f1f5f9;
  color: #1e293b;
  border-bottom-left-radius: 4px;
}
.msg.system {
  align-self: center;
  color: #94a3b8;
  font-size: 11px;
  padding: 2px 8px;
  background: transparent;
}
.msg.optimistic { opacity: 0.55; }

.typing-row {
  display: flex;
  align-items: center;
  padding: 0 12px 8px;
  flex-shrink: 0;
}
.typing-bubble {
  padding: 8px 12px;
  background: #f1f5f9;
  border-radius: 14px;
  border-bottom-left-radius: 4px;
  display: flex;
  gap: 4px;
  align-items: center;
}
.typing-bubble span {
  width: 6px; height: 6px; border-radius: 50%;
  background: #94a3b8;
  animation: td-bounce 1.2s infinite ease-in-out;
}
.typing-bubble span:nth-child(2) { animation-delay: .2s; }
.typing-bubble span:nth-child(3) { animation-delay: .4s; }
@keyframes td-bounce {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-4px); }
}

.suggestions {
  flex-shrink: 0;
  border-top: 1px solid #e2e8f0;
  padding: 8px 12px 0;
  max-height: 190px;
  overflow-y: auto;
}
.suggestions-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: #94a3b8;
  margin-bottom: 6px;
}
.suggestion {
  display: block;
  width: 100%;
  text-align: left;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 7px 10px;
  margin-bottom: 6px;
  cursor: pointer;
  font-family: inherit;
  transition: background .15s, border-color .15s;
}
.suggestion:hover { background: #f1f5f9; border-color: #cbd5e1; }
.suggestion-title {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 2px;
}
.suggestion-excerpt {
  display: block;
  font-size: 11px;
  color: #64748b;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid #e2e8f0;
  flex-shrink: 0;
  align-items: flex-end;
}
.composer input {
  flex: 1;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  outline: none;
  color: #1e293b;
  background: #fff;
  min-width: 0;
  font-family: inherit;
}
.composer input:focus { border-color: #1e293b; }
.composer input::placeholder { color: #94a3b8; }
.send-btn {
  background: #1e293b;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  flex-shrink: 0;
  font-family: inherit;
  transition: background .15s;
}
.send-btn:hover { background: #334155; }
.send-btn:disabled { background: #94a3b8; cursor: not-allowed; }
`

// ---------------------------------------------------------------------------
// UI builder — creates elements inside the shadow root
// ---------------------------------------------------------------------------

interface UIRefs {
  bubble: HTMLButtonElement
  panel: HTMLDivElement
  closeBtn: HTMLButtonElement
  statusDot: HTMLSpanElement
  workspaceNameEl: HTMLSpanElement
  connBanner: HTMLDivElement
  messagesEl: HTMLDivElement
  typingRow: HTMLDivElement
  suggestions: HTMLDivElement
  input: HTMLInputElement
  sendBtn: HTMLButtonElement
  form: HTMLFormElement
}

function buildUI(shadow: ShadowRoot): UIRefs {
  const style = document.createElement('style')
  style.textContent = WIDGET_CSS

  const bubble = document.createElement('button')
  bubble.className = 'bubble'
  bubble.setAttribute('aria-label', 'Open chat')
  bubble.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
  </svg>`

  const panel = document.createElement('div')
  panel.className = 'panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', 'Chat')
  panel.innerHTML = `
    <div class="header">
      <div class="header-left">
        <span class="status-dot" aria-hidden="true"></span>
        <span class="workspace-name">Chat</span>
      </div>
      <button class="close-btn" aria-label="Close chat" type="button">×</button>
    </div>
    <div class="conn-banner" style="display:none" role="status">Reconnecting…</div>
    <div class="messages" aria-live="polite"></div>
    <div class="typing-row" style="display:none" aria-label="Agent is typing">
      <div class="typing-bubble">
        <span></span><span></span><span></span>
      </div>
    </div>
    <div class="suggestions" style="display:none" role="region" aria-label="Suggested help articles"></div>
    <form class="composer">
      <input
        type="text"
        placeholder="Type a message…"
        maxlength="${MAX_BODY_LEN}"
        autocomplete="off"
        aria-label="Message"
      />
      <button type="submit" class="send-btn">Send</button>
    </form>
  `

  shadow.appendChild(style)
  shadow.appendChild(bubble)
  shadow.appendChild(panel)

  return {
    bubble,
    panel,
    closeBtn: panel.querySelector<HTMLButtonElement>('.close-btn')!,
    statusDot: panel.querySelector<HTMLSpanElement>('.status-dot')!,
    workspaceNameEl: panel.querySelector<HTMLSpanElement>('.workspace-name')!,
    connBanner: panel.querySelector<HTMLDivElement>('.conn-banner')!,
    messagesEl: panel.querySelector<HTMLDivElement>('.messages')!,
    typingRow: panel.querySelector<HTMLDivElement>('.typing-row')!,
    suggestions: panel.querySelector<HTMLDivElement>('.suggestions')!,
    input: panel.querySelector<HTMLInputElement>('input')!,
    sendBtn: panel.querySelector<HTMLButtonElement>('.send-btn')!,
    form: panel.querySelector<HTMLFormElement>('.composer')!,
  }
}

// ---------------------------------------------------------------------------
// Message rendering
// ---------------------------------------------------------------------------

function renderAllMessages(el: HTMLDivElement, messages: LocalMessage[]): void {
  el.innerHTML = ''
  for (const m of messages) appendMsgEl(el, m)
  el.scrollTop = el.scrollHeight
}

function appendMsgEl(el: HTMLDivElement, msg: LocalMessage): void {
  const div = document.createElement('div')
  div.className = `msg ${msg.sender_type}${msg.optimistic ? ' optimistic' : ''}`
  div.dataset.id = msg.id
  div.textContent = msg.body
  el.appendChild(div)
  el.scrollTop = el.scrollHeight
}

/**
 * Merges an incoming message from realtime or re-fetch into the DOM.
 * - If a matching id already exists, confirm it (drop the optimistic class).
 * - Otherwise append it.
 * Returns true if a new element was added (for scroll-to-bottom logic).
 */
function mergeMsg(el: HTMLDivElement, msg: RemoteMessage): boolean {
  const existing = el.querySelector<HTMLDivElement>(`[data-id="${CSS.escape(msg.id)}"]`)
  if (existing) {
    existing.classList.remove('optimistic')
    return false
  }
  appendMsgEl(el, { ...msg, optimistic: false })
  return true
}

// ---------------------------------------------------------------------------
// Knowledge base auto-suggest
// ---------------------------------------------------------------------------

/**
 * Renders suggestions above the composer.
 *
 * Clicking one opens the public help centre article in a new tab rather than in
 * an in-widget reader. Two reasons, in order of weight: the panel is 360px wide
 * inside a closed shadow root, so an in-widget reader would need its own scroll
 * container, its own typography for the article HTML, and a back button — a
 * second rendering path for content the public KB page already renders well;
 * and a new tab leaves the half-typed message sitting in the composer, so
 * reading the article costs the visitor nothing if it turns out not to answer
 * their question. The trade-off is that the visitor leaves the widget's visual
 * context, which an in-widget reader would avoid; that is the better version of
 * this feature and the honest reason it is not here is time.
 */
function renderSuggestions(
  el: HTMLDivElement,
  articles: SuggestedArticle[],
): void {
  el.textContent = ''

  if (articles.length === 0) {
    el.style.display = 'none'
    return
  }

  const label = document.createElement('div')
  label.className = 'suggestions-label'
  label.textContent = 'Might help'
  el.appendChild(label)

  for (const article of articles) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'suggestion'

    const title = document.createElement('span')
    title.className = 'suggestion-title'
    // textContent, not innerHTML: article titles are workspace-authored content
    // arriving over the network, and this is a host page's DOM.
    title.textContent = article.title

    const excerpt = document.createElement('span')
    excerpt.className = 'suggestion-excerpt'
    excerpt.textContent = article.excerpt

    button.append(title, excerpt)
    button.addEventListener('click', () => {
      window.open(article.url, '_blank', 'noopener,noreferrer')
    })
    el.appendChild(button)
  }

  el.style.display = ''
}

/**
 * Debounced, single-flight article lookup.
 *
 * Each new search aborts the previous request, so a slow response for "pass"
 * can never overwrite the results for "password". Existing suggestions stay
 * on screen until a newer search returns — including after the visitor sends
 * the message, which is when they are most useful.
 */
function makeSuggester(
  workspaceId: string,
  el: HTMLDivElement,
): { onInput: (value: string) => void; flush: (value: string) => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: AbortController | null = null
  let requestedQuery = ''

  function search(query: string): void {
    if (requestedQuery === query && inFlight) return
    requestedQuery = query
    inFlight?.abort()

    const controller = new AbortController()
    inFlight = controller
    void (async () => {
      try {
        const url =
          `${API_BASE}/api/widget/kb-search` +
          `?workspaceId=${encodeURIComponent(workspaceId)}&q=${encodeURIComponent(query)}`
        const res = await fetch(url, { signal: controller.signal })
        if (!res.ok) return
        const data = (await res.json()) as { articles: SuggestedArticle[] }
        renderSuggestions(el, data.articles.slice(0, 3))
      } catch {
        // Aborted or offline. Suggestions are an enhancement — failing here
        // must never interfere with sending the message.
      } finally {
        if (inFlight === controller) inFlight = null
      }
    })()
  }

  function schedule(query: string): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => search(query), SUGGEST_DEBOUNCE_MS)
  }

  return {
    onInput(value: string) {
      const query = value.trim()

      if (query.length < SUGGEST_MIN_CHARS) {
        if (timer) clearTimeout(timer)
        inFlight?.abort()
        inFlight = null
        requestedQuery = ''
        renderSuggestions(el, [])
        return
      }

      schedule(query)
    },
    /**
     * Fire immediately for the message just sent. Skips the debounce so a
     * visitor who hits Enter before the timer would have run still sees
     * articles, and does not hide suggestions already on screen.
     */
    flush(value: string) {
      if (timer) clearTimeout(timer)
      const query = value.trim()
      if (query.length < SUGGEST_MIN_CHARS) return
      search(query)
    },
  }
}

// ---------------------------------------------------------------------------
// Typing debounce
// ---------------------------------------------------------------------------

function makeTypingSignaller(ch: RealtimeChannel): () => void {
  let active = false
  let timer: ReturnType<typeof setTimeout> | null = null

  return () => {
    if (!active) {
      active = true
      ch.send({ type: 'broadcast', event: 'typing', payload: { sender: 'contact', active: true } }).catch(
        () => undefined,
      )
    }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      active = false
      ch.send({ type: 'broadcast', event: 'typing', payload: { sender: 'contact', active: false } }).catch(
        () => undefined,
      )
    }, 1500)
  }
}

// ---------------------------------------------------------------------------
// Main boot function
// ---------------------------------------------------------------------------

let booted = false

async function boot(opts: BootOptions): Promise<void> {
  if (booted) return
  booted = true

  // Create host element + shadow root
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;bottom:0;right:0;z-index:2147483647;pointer-events:none;'
  document.body.appendChild(host)

  // `closed` shadow prevents host page from accessing shadow internals
  const shadow = host.attachShadow({ mode: 'closed' })
  const ui = buildUI(shadow)

  // Make only interactive elements pointer-events-aware
  ui.bubble.style.pointerEvents = 'auto'
  ui.panel.style.pointerEvents = 'none' // re-enabled when open via CSS class

  // ---- State ----
  const messages: LocalMessage[] = []
  let isOpen = false
  let contactId = ''
  let conversationId = ''
  const anonToken = getOrCreateToken(opts.workspaceId)
  let latestCreatedAt = ''

  function setConnectionStatus(s: ConnectionStatus): void {
    ui.connBanner.style.display = s === 'disconnected' ? '' : 'none'
    ui.sendBtn.disabled = s === 'disconnected'
  }

  function setAgentOnline(online: boolean): void {
    ui.statusDot.classList.toggle('online', online)
  }

  function setOpen(open: boolean): void {
    isOpen = open
    ui.panel.classList.toggle('open', open)
    ui.panel.style.pointerEvents = open ? 'auto' : 'none'
    if (open) ui.input.focus()
  }

  // ---- Open / close ----
  ui.bubble.addEventListener('click', () => setOpen(!isOpen))
  ui.closeBtn.addEventListener('click', () => setOpen(false))

  // ---- Boot sequence ----
  try {
    // 1. Find-or-create contact
    const { contact, workspace } = await apiPost<{
      contact: { id: string; email: string | null; anonymous_token: string | null }
      workspace: { name: string }
    }>('/api/widget/contact', opts.workspaceId, {
      anonymousToken: anonToken,
      ...(opts.email ? { email: opts.email } : {}),
    })
    contactId = contact.id
    ui.workspaceNameEl.textContent = workspace.name || 'Chat'

    // 2. Find-or-create conversation
    const { conversation } = await apiPost<{ conversation: { id: string } }>(
      '/api/widget/conversation',
      opts.workspaceId,
      { contactId },
    )
    conversationId = conversation.id

    // 3. Fetch message history
    const history = await getMessages(opts.workspaceId, conversationId)
    for (const m of history) {
      messages.push({ ...m, optimistic: false })
      latestCreatedAt = m.created_at
    }
    renderAllMessages(ui.messagesEl, messages)
  } catch (err) {
    console.error('[SuperDesk] boot failed:', err)
    // Still show the UI; the user can try sending later
  }

  // ---- Knowledge base auto-suggest ----
  // Wired before the realtime block below, which bails out when Supabase config
  // was not injected at build time. Suggestions are plain HTTP and should keep
  // working in that case.
  const suggester = makeSuggester(opts.workspaceId, ui.suggestions)
  ui.input.addEventListener('input', () => suggester.onInput(ui.input.value))

  // ---- Realtime ----
  if (!SUPABASE_URL || !ANON_KEY) {
    console.warn('[SuperDesk] Supabase config not injected — realtime disabled')
    return
  }

  const rtClient = new RealtimeClient(`${SUPABASE_URL}/realtime/v1`, {
    params: { apikey: ANON_KEY },
  })

  setConnectionStatus('connecting')

  // Message + typing channel.
  // The subscribe callback drives connection status and re-sync on reconnect.
  const msgChannel = rtClient.channel(`conversation:${conversationId}`)
  let everSubscribed = false
  msgChannel
    .on('broadcast', { event: 'new_message' }, ({ payload }: { payload: RemoteMessage }) => {
      const added = mergeMsg(ui.messagesEl, payload)
      if (added) latestCreatedAt = payload.created_at
    })
    .on(
      'broadcast',
      { event: 'typing' },
      ({ payload }: { payload: { sender: string; active: boolean } }) => {
        if (payload.sender === 'agent') {
          ui.typingRow.style.display = payload.active ? '' : 'none'
        }
      },
    )
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        setConnectionStatus('connected')
        // On reconnect, re-fetch any messages missed while disconnected
        if (everSubscribed && conversationId && latestCreatedAt) {
          const missed = await getMessages(opts.workspaceId, conversationId, latestCreatedAt)
          for (const m of missed) {
            mergeMsg(ui.messagesEl, m)
            latestCreatedAt = m.created_at
          }
        }
        everSubscribed = true
      }
      if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        setConnectionStatus('disconnected')
      }
    })

  // Presence channel — online dot
  const presenceChannel = rtClient.channel(`presence:${opts.workspaceId}`, {
    config: { presence: { key: anonToken } },
  })
  presenceChannel
    .on('presence', { event: 'sync' }, () => {
      const state = presenceChannel.presenceState<{ type: string }>()
      const agentOnline = Object.values(state).some((presences) =>
        presences.some((p) => p.type === 'agent'),
      )
      setAgentOnline(agentOnline)
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // `session` is what the dashboard matches against a conversation's
        // contact to show its visitor-online dot.
        await presenceChannel.track({ type: 'visitor', session: anonToken })
      }
    })

  rtClient.connect()

  // ---- Typing signal ----
  const signalTyping = makeTypingSignaller(msgChannel)
  ui.input.addEventListener('input', signalTyping)

  // ---- Send message ----
  ui.form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const body = ui.input.value.trim()
    if (!body || !conversationId || !contactId) return

    const clientId = crypto.randomUUID()
    ui.input.value = ''
    ui.sendBtn.disabled = true
    // Keep (or fetch) articles for the message just sent. Most visitors hit
    // Enter as soon as they finish typing, so waiting on the debounce — then
    // clearing on submit — meant the nudge almost never appeared.
    suggester.flush(body)

    // Optimistic update
    const optimistic: LocalMessage = {
      id: clientId,
      body,
      sender_type: 'contact',
      sender_id: contactId,
      created_at: new Date().toISOString(),
      optimistic: true,
    }
    messages.push(optimistic)
    appendMsgEl(ui.messagesEl, optimistic)

    try {
      const { message } = await apiPost<{ message: RemoteMessage }>(
        '/api/widget/messages',
        opts.workspaceId,
        { id: clientId, conversationId, contactId, body },
      )
      // Confirm the optimistic entry by id match
      mergeMsg(ui.messagesEl, message)
      latestCreatedAt = message.created_at
    } catch (err) {
      // Mark as failed
      const el = ui.messagesEl.querySelector<HTMLDivElement>(`[data-id="${CSS.escape(clientId)}"]`)
      if (el) {
        el.style.opacity = '0.4'
        el.title = 'Failed to send — click to retry'
      }
      console.error('[SuperDesk] send failed:', err)
    } finally {
      ui.sendBtn.disabled = false
      ui.input.focus()
    }
  })
}

// ---------------------------------------------------------------------------
// Global API
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    SuperDesk: { boot: (opts: BootOptions) => void }
  }
}

window.SuperDesk = { boot }

// ---------------------------------------------------------------------------
// Auto-boot from data-workspace-id attribute
// ---------------------------------------------------------------------------

const autoWorkspaceId = scriptEl?.dataset.workspaceId ?? ''
if (autoWorkspaceId) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot({ workspaceId: autoWorkspaceId }))
  } else {
    boot({ workspaceId: autoWorkspaceId })
  }
}
