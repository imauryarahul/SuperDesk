'use server'

import { z } from 'zod'

import { requireWorkspace } from '@/lib/auth'
import { inboundAddressFor, newMessageId, replySubject, sendEmail } from '@/lib/postmark'
import { broadcastNewMessage } from '@/lib/realtime-broadcast'
import { createAdminClient } from '@/lib/supabase/admin'

const MAX_BODY = 2000
/** Enough of the chain for a mail client to thread on; References is unbounded. */
const MAX_REFERENCES = 20

const MESSAGE_COLUMNS = 'id, body, sender_type, sender_id, created_at'

type Admin = ReturnType<typeof createAdminClient>

interface SentMessage {
  id: string
  body: string
  sender_type: string
  sender_id: string | null
  created_at: string
}

type SendResult = { message: SentMessage; error: null } | { message: null; error: string }

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
    .select('id, channel, subject, contacts(email)')
    .eq('id', conversationId)
    .eq('workspace_id', workspace.id)
    .maybeSingle()

  if (!conv) return { message: null, error: 'Conversation not found' }

  // On the email channel the send has to succeed before the message is
  // persisted: the Message-ID we thread on is part of the row, and a row the
  // customer never received would be a lie to the agent. The composer already
  // renders a failed send, so returning an error is the honest outcome.
  let emailFields: { email_message_id: string; email_in_reply_to: string | null } | null = null

  if (conv.channel === 'email') {
    const sent = await sendEmailReply(admin, {
      workspaceId: workspace.id,
      conversationId,
      recipient: conv.contacts?.email ?? null,
      subject: conv.subject,
      textBody: bodyParsed.data,
    })
    if (!sent.ok) return { message: null, error: sent.error }
    emailFields = {
      email_message_id: sent.messageId,
      email_in_reply_to: sent.inReplyTo,
    }
  }

  const { data: message, error } = await admin
    .from('messages')
    .insert({
      id: clientId,
      workspace_id: workspace.id,
      conversation_id: conversationId,
      sender_type: 'agent',
      sender_id: profile.id,
      body: bodyParsed.data,
      ...emailFields,
    })
    .select(MESSAGE_COLUMNS)
    .single()

  if (error) {
    // Idempotent retry on unique constraint
    if (error.code === '23505') {
      const { data: existing } = await admin
        .from('messages')
        .select(MESSAGE_COLUMNS)
        .eq('id', clientId)
        .single()
      if (existing) return { message: existing, error: null }
    }
    if (emailFields) {
      // The customer has the email but we have no record of it. Log loudly:
      // their reply will arrive as a new thread instead of joining this one.
      console.error(
        `[email] sent but not persisted conversation=${conversationId} ` +
          `message_id=${emailFields.email_message_id} error=${error.message}`,
      )
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

// ---------------------------------------------------------------------------
// Email channel
// ---------------------------------------------------------------------------

type EmailSendResult =
  | { ok: true; messageId: string; inReplyTo: string | null }
  | { ok: false; error: string }

async function sendEmailReply(
  admin: Admin,
  input: {
    workspaceId: string
    conversationId: string
    recipient: string | null
    subject: string | null
    textBody: string
  },
): Promise<EmailSendResult> {
  if (!input.recipient) {
    return { ok: false, error: 'This contact has no email address to reply to.' }
  }

  const { data: workspace } = await admin
    .from('workspaces')
    .select('inbound_token')
    .eq('id', input.workspaceId)
    .maybeSingle()

  if (!workspace) return { ok: false, error: 'Workspace not found' }

  // The most recent Message-IDs in the thread. Ordered descending so the limit
  // keeps the recent end — ascending would cap at the twenty oldest and pick a
  // long-dead message as the parent — then reversed, because References must be
  // oldest-first and In-Reply-To is the newest.
  const { data: chain } = await admin
    .from('messages')
    .select('email_message_id')
    .eq('conversation_id', input.conversationId)
    .eq('workspace_id', input.workspaceId)
    .not('email_message_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(MAX_REFERENCES)

  const references = (chain ?? [])
    .map((row) => row.email_message_id)
    .filter((id): id is string => id !== null)
    .reverse()
  const inReplyTo = references.at(-1) ?? null
  const messageId = newMessageId()

  const result = await sendEmail({
    to: input.recipient,
    subject: replySubject(input.subject),
    textBody: input.textBody,
    // Routes the customer's reply back to this workspace's inbound address.
    replyTo: inboundAddressFor(workspace.inbound_token),
    messageId,
    inReplyTo,
    references,
  })

  if (!result.ok) {
    return { ok: false, error: `Email could not be sent: ${result.error}` }
  }

  console.info(
    `[email] sent conversation=${input.conversationId} message_id=${messageId} ` +
      `postmark_id=${result.postmarkMessageId} in_reply_to=${inReplyTo ?? 'none'}`,
  )

  return { ok: true, messageId, inReplyTo }
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
