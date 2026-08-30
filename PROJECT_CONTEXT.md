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
- `workspaces` (id, name, slug, custom_domain, allowed_widget_domains[], inbound_token)
- `profiles` (id, auth_user_id, workspace_id, role: admin | agent, email, full_name)
- `workspace_invites` (id, workspace_id, email, role, token, invited_by, expires_at, accepted_at)
- `contacts` (id, workspace_id, anonymous_token, email nullable, last_seen_at)
- `conversations` (id, workspace_id, contact_id, channel: chat | email, status: open | snoozed | resolved, assigned_agent_id, last_message_at, subject)
- `messages` (id, workspace_id, conversation_id, sender_type: contact | agent | system, sender_id, body, created_at, email_message_id nullable, email_in_reply_to nullable)
- `kb_categories` (id, workspace_id, name), `kb_articles` (id, workspace_id, category_id, title, slug, body, published, search_vector)

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
- `workspaces.slug` (globally unique) and `kb_articles.slug` (unique per workspace) — the public KB URLs. Both are written by `BEFORE INSERT` triggers, never by application code, so no insert path can produce a row that is unreachable by URL. A placeholder column DEFAULT exists purely so the generated `Insert` type does not demand a slug the caller has no business choosing. Workspace slugs are never regenerated on rename; article slugs regenerate while the article is a draft and freeze on first publish, so a live URL does not break on a retitle.
- `kb_articles.search_vector` — a stored generated `tsvector`, title weighted A and body B. Tags are stripped with an immutable regexp before indexing, which is what allows a generated column instead of a trigger that could drift from the rows.

**Public KB access (the one non-`auth.uid()` pattern):** an anonymous visitor has no uid, so no existing policy can ever grant it a row. Phase 5 adds separate additive `to anon` SELECT policies — published articles, the categories holding at least one, and the workspaces owning at least one — with the authenticated policies untouched. Two independent gates: those row policies, plus column-level `GRANT SELECT (…)` so a row-filter mistake still cannot expose `inbound_token` or `allowed_widget_domains`, and no write grant exists at all. Public reads go through `lib/supabase/anon.ts`, a session-less client, so a signed-in agent visiting the help centre gets `anon` rather than their own drafts.

**RLS mechanics:** policies compare `workspace_id` to `private.current_workspace_id()`, a `SECURITY DEFINER` helper. It sits in `private` rather than `public` because Supabase grants EXECUTE on all public functions to `anon`/`authenticated`, which would expose it over REST. Signup and invite acceptance run through `public.create_workspace_with_admin` / `public.accept_workspace_invite`, `SECURITY DEFINER` and granted to `service_role` only, so each multi-table write is atomic and unreachable from the browser. Role escalation is blocked by column-level grants: `authenticated` may only ever UPDATE `profiles.full_name`.

## Build sequence (one prompt per phase, roughly)
1. **Done.** Scaffold, DB schema + RLS, auth, team roles, workspace creation, invite flow, empty dashboard shell. Invites are delivered as a shared link, not email — outbound email lands in phase 3.
2. **Done.** Embeddable chat widget (Shadow DOM, esbuild bundle ~21 KB gzipped), CORS-validated API routes, Supabase Realtime (broadcast messages, typing, presence), dashboard live chat view with Postgres Changes, reconnect re-fetch. Rate limiting deferred to phase 3 alongside the email channel.
3. **Done.** Email channel. Inbound webhook at `/api/webhooks/postmark-inbound`, protected by Basic Auth (credentials embedded in the Postmark webhook URL) plus a source-IP allowlist. Tenant routing on `MailboxHash` → `workspaces.inbound_token`; thread resolution on `In-Reply-To`/`References` → `messages.email_message_id`, never on the sender address. We mint our own RFC `Message-ID` and send it with `X-PM-KeepID: true`, because Postmark's returned `MessageID` is a delivery id that never appears in anyone's headers. Idempotent by unique index; 200 on anything a retry could not fix. Rate limiting still deferred.
4. **Done.** Unified inbox filters + conversation actions. Filter bar (status/channel/assignee) with URL-encoded state (`window.history.replaceState` keeps filters shareable and refresh-safe without triggering RSC re-renders). Default view: Open / all channels / all agents, with a one-click "Me" chip. Assign/reassign from both list row and thread header; server validates target agent belongs to same workspace before updating. Snooze/resolve/reopen via status changes (no scheduled resurface — documented simplification). All mutations broadcast `conversation_updated` on `inbox:{workspaceId}` so every open inbox reacts live without polling. Rate limiting added (fixed-window, Postgres-backed): widget create/contact/message routes (10/10/30 req per min per IP) and auth signup/signin (5/300s and 20/60s). `rate_limit_windows` table + `increment_rate_limit` SECURITY DEFINER function in migration 005; fails open so a broken table never blocks traffic. Caveat found in phase 5: migration 005 had never actually been applied to the hosted project, and because the limiter fails open, every limit was silently a no-op with nothing in the logs to say so. Applied now. The lesson is that fail-open needs a startup assertion or a log line, otherwise "no errors" and "not running" look identical — worth doing before submission.
5. **Done.** Knowledge base. TipTap editor (StarterKit, which bundles Link and Underline in v3) at `/knowledge-base/[articleId]`; a new article is created as a draft server-side and the editor redirects into it, so there is no id-less form state. Bodies are sanitised on write against a nine-tag allowlist (`lib/kb-html.ts`), not on read, so the database only ever holds safe markup and every consumer inherits it. Category CRUD; deleting a category reassigns its articles to uncategorised (`on delete set null (category_id)`) and never deletes content. Public help centre at `/kb/[workspaceSlug]` and `/kb/[workspaceSlug]/[articleSlug]`, outside the `(dashboard)` group, no auth, no session. Search is Postgres full-text through `public.search_kb_articles`, a SECURITY INVOKER RPC so the caller's own policy applies — needed because PostgREST cannot order by `ts_rank`. Query strings are reduced to alphanumeric tokens with a prefix match per token, which is both injection-safe for `to_tsquery` and what makes suggestions useful mid-word. Widget auto-suggest via `/api/widget/kb-search` (same Origin allowlist as phase 2, 60 req/min/IP/workspace), debounced 300 ms, minimum 3 characters, up to 3 results, each keystroke aborting the previous request so out-of-order responses cannot win. Clicking a suggestion opens the public article in a new tab rather than an in-widget reader — documented trade-off, see the comment on `renderSuggestions`. Coverage: `supabase/tests/rls_isolation.sql` (92 checks, now including an `anon` probe), `npm run test:kb-html`, `npm run test:kb-smoke`.
6. AI summarization, then AI auto-reply drafts if time allows
7. Custom domain flow (Vercel Domains API) + analytics dashboard if time allows
8. End-to-end testing as a stranger would use it, deploy, README, submission

## Environment variables needed
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `POSTMARK_SERVER_TOKEN`, `POSTMARK_FROM_EMAIL`, `POSTMARK_INBOUND_ADDRESS`, `POSTMARK_INBOUND_WEBHOOK_USER`, `POSTMARK_INBOUND_WEBHOOK_PASS`, `ANTHROPIC_API_KEY`

All accessed through `lib/env.ts`, which throws a message naming the variable and where to find it rather than failing with `undefined` downstream.

## Evaluation criteria to keep in view
System design, production readiness (error handling, logging, validation, rate limiting), AI integration (prompt design, cost awareness, fallback handling), real-time architecture (reconnection, message ordering), email engineering (threading, deliverability), frontend quality, security (auth, XSS/CSRF, tenant isolation), and trade-off decisions (documented, not just made).