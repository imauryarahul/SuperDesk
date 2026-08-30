# Project Context: SuperDesk (SuperProfile Hiring Assignment)

Reference this file at the start of every Cursor session on this project. It should not go stale as the build progresses. Update it if a decision changes.

## What this is
A 36-hour hiring assignment for SuperProfile (Cosmofeed). Build a production-ready customer communication platform (live chat, email, unified inbox, knowledge base, AI summarization, custom domains). Built solo. Evaluated on the same rubric as engineering candidates, so code quality and architecture reasoning both matter, not just feature completeness.

## Tech stack
- **Framework:** Next.js 14, App Router, TypeScript
- **Hosting:** Vercel
- **Database, Auth, Realtime:** Supabase (Postgres + Supabase Auth + Supabase Realtime)
- **Email:** Postmark (inbound parsing via webhook, outbound sending, Message-ID / In-Reply-To threading)
- **AI:** Anthropic API (issue summarization, AI auto-reply drafts)
- **Custom domains:** Vercel Domains API (add domain to project programmatically, Vercel auto-provisions SSL)

## Non-negotiable requirements (all 7 required, partial submissions not reviewed)
1. Auth + team management: signup/login, invite teammates, roles (Admin, Agent), agent assignment to conversations
2. Chat bubble: embeddable single-script-tag widget, real-time messaging, typing indicators, online/offline status, read receipts, persisted history
3. Email channel: inbound parsing into conversations, reply from dashboard sends real email, proper threading
4. Unified inbox: chat + email in one view, filter by channel/assignee/status, assign/reassign/snooze/resolve
5. Knowledge base: rich text editor, categories, public searchable page, auto-suggest inside widget
6. AI issue summarization: summary on open, updates as conversation progresses
7. Custom domains: workspace connects own domain for KB, SSL provisioning, documented approach even if DNS verification is stubbed

## Stretch features (chosen, build only after all 7 above are solid)
- AI auto-reply drafts (reuses the same LLM call pattern + KB data as summarization)
- Analytics dashboard (response times, resolution rates, agent performance)

Not building untill the above completes: canned responses, contact timeline, SLA tracking, webhooks/API. Documented as deferred, not attempted.

## Architecture decisions

**Realtime:** Supabase Realtime, not raw WebSockets or Socket.io. Three channel types in use:
- Postgres Changes on the `messages` table → broadcasts new messages to subscribers of `conversation:{id}`
- Broadcast (ephemeral, not persisted) for typing indicators
- Presence, one channel per workspace, for agent/visitor online status

**Widget embed:** JS SDK injected directly into the host page's DOM (not an iframe). UI wrapped in Shadow DOM (`element.attachShadow`) so host page CSS can't collide with widget styles and vice versa.

**CORS:** Widget writes go through Next.js API routes (not direct-to-Supabase from the browser), so we get input validation and rate limiting. Routes validate the request's origin against that workspace's `allowed_widget_domains`. This is also the tenant isolation story: a workspace's widget only works from domains that workspace registered.

**Visitor identity:**
- Default: anonymous token generated on first widget load, stored in the host page's localStorage (first-party, since the widget is DOM-injected not iframed). Contact row created with `anonymous_token` set, `email` null.
- If the host page calls `boot({ email })`, look up contact by `(workspace_id, email)` first. Found → use that contact. Not found → create it, and attach the current localStorage token to that same row if one exists.
- Known limitation (documented, not solved): the same person on two different browsers with no email will appear as two separate contacts. Real Intercom solves this with a merge flow; out of scope for 48 hours.

## Database schema
Built in `supabase/migrations`. All tables have UUID PKs and `created_at` / `updated_at`.
- `workspaces` (id, name, custom_domain, allowed_widget_domains[], inbound_token)
- `profiles` (id, auth_user_id, workspace_id, role: admin | agent, email, full_name)
- `workspace_invites` (id, workspace_id, email, role, token, invited_by, expires_at, accepted_at)
- `contacts` (id, workspace_id, anonymous_token, email nullable, last_seen_at)
- `conversations` (id, workspace_id, contact_id, channel: chat | email, status: open | snoozed | resolved, assigned_agent_id, last_message_at, subject)
- `messages` (id, workspace_id, conversation_id, sender_type: contact | agent | system, sender_id, body, created_at, email_message_id nullable, email_in_reply_to nullable)
- `kb_categories` (id, workspace_id, name), `kb_articles` (id, workspace_id, category_id, title, body, published)

All tables scoped by `workspace_id` with Row Level Security policies, not just app-level checks. This is one of the eval criteria (tenant isolation). Proven by `supabase/tests/rls_isolation.sql`, which probes every policy as a real `authenticated` user across two workspaces.

Additions to the original sketch, all deliberate:
- `workspace_invites` — required by the invite flow, which the sketch did not cover.
- `profiles.email` / `full_name` — clients cannot read `auth.users`, so the team list needs a local copy. Written only by the two bootstrap functions.
- `messages.workspace_id` — denormalised from `conversations` so the RLS policy is a column comparison instead of a join, and so Realtime can filter by workspace in phase 2.
- Composite FKs, e.g. `conversations (contact_id, workspace_id) → contacts (id, workspace_id)`. A cross-tenant id is rejected by the database itself, not only by RLS.
- `profiles.auth_user_id` is unique, so one account belongs to exactly one workspace. Simplifies every policy; revisit if multi-workspace membership is ever needed.
- `workspaces.inbound_token` — Postmark delivers all inbound email for the account to one webhook, so the payload's `MailboxHash` is the only tenant signal. The token is the plus-suffix of the workspace's inbound address. Generated by a column `DEFAULT` (9 random bytes, lowercase hex) rather than in application code, so no insert path can create a workspace without one.
- `conversations.subject` — email threads need a subject to reply with; chat leaves it null.
- The pre-existing unique index on `messages (workspace_id, email_message_id)` is what makes the inbound webhook idempotent.

**RLS mechanics:** policies compare `workspace_id` to `private.current_workspace_id()`, a `SECURITY DEFINER` helper. It sits in `private` rather than `public` because Supabase grants EXECUTE on all public functions to `anon`/`authenticated`, which would expose it over REST. Signup and invite acceptance run through `public.create_workspace_with_admin` / `public.accept_workspace_invite`, `SECURITY DEFINER` and granted to `service_role` only, so each multi-table write is atomic and unreachable from the browser. Role escalation is blocked by column-level grants: `authenticated` may only ever UPDATE `profiles.full_name`.

## Build sequence (one prompt per phase, roughly)
1. **Done.** Scaffold, DB schema + RLS, auth, team roles, workspace creation, invite flow, empty dashboard shell. Invites are delivered as a shared link, not email — outbound email lands in phase 3.
2. **Done.** Embeddable chat widget (Shadow DOM, esbuild bundle ~21 KB gzipped), CORS-validated API routes, Supabase Realtime (broadcast messages, typing, presence), dashboard live chat view with Postgres Changes, reconnect re-fetch. Rate limiting deferred to phase 3 alongside the email channel.
3. **Done.** Email channel. Inbound webhook at `/api/webhooks/postmark-inbound`, protected by Basic Auth (credentials embedded in the Postmark webhook URL) plus a source-IP allowlist. Tenant routing on `MailboxHash` → `workspaces.inbound_token`; thread resolution on `In-Reply-To`/`References` → `messages.email_message_id`, never on the sender address. We mint our own RFC `Message-ID` and send it with `X-PM-KeepID: true`, because Postmark's returned `MessageID` is a delivery id that never appears in anyone's headers. Idempotent by unique index; 200 on anything a retry could not fix. Rate limiting still deferred.
4. Unified inbox: merge chat + email views, filters, assign/snooze/resolve
5. Knowledge base: editor, categories, public page + search, widget auto-suggest
6. AI summarization, then AI auto-reply drafts if time allows
7. Custom domain flow (Vercel Domains API) + analytics dashboard if time allows
8. End-to-end testing as a stranger would use it, deploy, README, submission

## Environment variables needed
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `POSTMARK_SERVER_TOKEN`, `POSTMARK_FROM_EMAIL`, `POSTMARK_INBOUND_ADDRESS`, `POSTMARK_INBOUND_WEBHOOK_USER`, `POSTMARK_INBOUND_WEBHOOK_PASS`, `ANTHROPIC_API_KEY`

All accessed through `lib/env.ts`, which throws a message naming the variable and where to find it rather than failing with `undefined` downstream.

## Evaluation criteria to keep in view
System design, production readiness (error handling, logging, validation, rate limiting), AI integration (prompt design, cost awareness, fallback handling), real-time architecture (reconnection, message ordering), email engineering (threading, deliverability), frontend quality, security (auth, XSS/CSRF, tenant isolation), and trade-off decisions (documented, not just made).