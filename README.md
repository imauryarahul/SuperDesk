# SuperDesk

Customer communication platform. Phases 1–3 are built and verified.

**Phase 1:** database schema, tenant isolation, authentication, team roles, invite flow,
dashboard shell.

**Phase 2:** embeddable chat widget, Supabase Realtime (messages, typing, presence),
API routes with Origin-header CORS validation, and the dashboard live chat view.

**Phase 3:** the [email channel](#email-channel) — Postmark inbound webhook, RFC 5322
threading, and replying from the dashboard as a real email.

Knowledge base, AI and custom domains are not built yet — see [Deferred](#deferred).

Stack: Next.js 14 (App Router) · TypeScript (strict) · Tailwind · Supabase (Postgres,
Auth, RLS).

## Getting started

```bash
npm install
cp .env.local.example .env.local   # fill in the three Supabase values
npm run widget:build               # compile public/widget.js once
npm run dev
```


| Variable                        | Where to find it            | Notes                                                               |
| ------------------------------- | --------------------------- | ------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Project Settings → API      |                                                                     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API keys | Publishable key                                                     |
| `SUPABASE_SERVICE_ROLE_KEY`     | Project Settings → API keys | **Server only.** Signup and the invite page fail loudly without it. |
| `NEXT_PUBLIC_APP_URL`           | —                           | Base URL for invite links. Defaults to `http://localhost:3000`.     |

The five `POSTMARK_*` variables are only needed for the email channel; see
[Configuring Postmark](#configuring-postmark). Chat works without them.


Two Supabase dashboard settings matter for local testing:

- **Authentication → Sign In / Providers → Confirm email.** On by default. With it on,
signup creates the workspace but returns no session, and the app tells the user to
confirm first. Turn it off to click through the whole flow without a mailbox.
- Supabase Auth rejects reserved TLDs (`.local`, `.test`), so use real-looking domains
when creating accounts by hand.



## Database

Migrations are plain SQL under `supabase/migrations`, applied in filename order:

```
20260830000100_initial_schema.sql       tables, enums, indexes, updated_at triggers
20260830000200_rls_policies.sql         helper functions, privileged routines, RLS
20260830000300_realtime_publication.sql conversations + messages on the wire
20260830000400_email_channel.sql        workspaces.inbound_token, conversations.subject
```

Regenerate types after any schema change:

```bash
supabase gen types typescript --project-id <ref> > types/database.ts
```



### Tenant isolation

Every tenant-owned table has a `workspace_id` column and an RLS policy comparing it
to `private.current_workspace_id()`, which resolves the caller's workspace from
`auth.uid()`. No table is reachable across workspaces even if application code has a
bug, and `anon` has no grant on any of them.

`supabase/tests/rls_isolation.sql` proves it. It seeds two workspaces (an admin and an
agent in one, an admin in the other), runs 18 probes per member as the `authenticated`
role with a real JWT claim, and rolls the fixtures back:

```bash
psql "$DATABASE_URL" -f supabase/tests/rls_isolation.sql
```

Each member is checked for: reading, inserting, updating and deleting across the
workspace boundary; admin-only visibility of invite tokens; self role escalation; and
direct RPC access to the privileged bootstrap functions. All 54 currently pass.

## Architecture notes

**Two Supabase clients, plus one privileged escape hatch.** `lib/supabase/client.ts`
(browser) and `lib/supabase/server.ts` (request-scoped, cookie-backed) both run as the
signed-in user, so RLS applies to every query. `lib/supabase/admin.ts` bypasses RLS and
is used in exactly two places: creating a workspace at signup, and reading an invite by
token before the invitee belongs to any workspace. Both call sites authorise first.

**Signup and invite acceptance are single SQL statements.** Each writes to two tables,
so they live in `SECURITY DEFINER` functions (`create_workspace_with_admin`,
`accept_workspace_invite`) rather than in application code, which means a partial
failure cannot leave an orphaned workspace behind. `EXECUTE` is granted to
`service_role` only, so neither is callable from a browser.

**The RLS helpers live in a** `private` **schema.** Supabase's default privileges grant
`EXECUTE` on every `public` function to `anon` and `authenticated`, which would publish
`current_workspace_id()` as a REST endpoint. PostgREST only exposes `public`, so moving
them keeps them reachable from a policy but not from the network.

**Composite foreign keys pin relations to one workspace.** `conversations` references
`contacts (id, workspace_id)` rather than `contacts (id)`, and likewise for messages,
assigned agents and KB articles. A cross-tenant id is rejected by the database itself,
independent of RLS.

**Middleware is UX, not security.** `middleware.ts` refreshes the session cookie and
redirects signed-out visitors to `/login`. It uses `getUser()` rather than
`getSession()` so the token is revalidated instead of trusted from the cookie. A
request that gets past it still cannot read another workspace's rows.

## Invite flow

An admin invites by email and role from Settings. The server generates a 32-byte token
and inserts a row into `workspace_invites` **through the admin's own client**, so the
admin-only RLS policy is what authorises the write. The resulting link is shown for the
admin to share.

Both cases in the requirement are handled at `/invite/[token]`:

- **No account yet** — the invitee sets a password on the invite page; the account and
the profile are created together.
- **Already has an account** — they switch to "I already have an account", sign in with
the invited address, and join. If they are already signed in as that address, it is a
single Accept button; signed in as someone else, they are told to sign out.

Invites expire after 7 days, are single-use, and only an admin can read or revoke one.
Because a profile is pinned to one workspace, inviting an address that already belongs
to another workspace is rejected at invite time rather than at accept time.

Delivery is by shared link, not email — outbound email arrives with Postmark in phase 3.

## Chat widget



### Embedding on a site

```html
<script
  src="https://[your-app-domain]/widget.js"
  data-workspace-id="YOUR_WORKSPACE_UUID"
></script>
```

The script reads `data-workspace-id` and boots automatically. For sites that identify
users, call the global before or after the tag:

```js
window.SuperDesk.boot({ workspaceId: 'YOUR_WORKSPACE_UUID', email: 'user@example.com' })
```



### Origin validation

Every widget API route validates the request's `Origin` header against the workspace's
`allowed_widget_domains` array. **A request from an unlisted origin is rejected with
HTTP 403.** Add each domain that hosts the embedded widget to that array:

- In the Supabase Table Editor: open the `workspaces` row, edit `allowed_widget_domains`.
- Include the scheme and port exactly: `http://localhost:5500`, `https://yoursite.com`.



### Local cross-origin testing

The test page at `test.html` must be served from a separate port so it is a genuine
cross-origin request (Origin-header checking is bypassed for `file://` pages and
same-origin requests):

```bash
# In one terminal — Next.js app (default port 3000)
npm run dev

# In another terminal — static server for the test page
npx serve -l 5500 .
# Then open http://localhost:5500/test.html
```

Add `http://localhost:5500` to `allowed_widget_domains` before opening the test page.
Replace `PASTE_WORKSPACE_ID_HERE` in `test.html` with your workspace UUID from the
`workspaces` table.

### Widget bundle

Built separately from the Next.js app using esbuild:

```bash
npm run widget:build   # one-off, outputs public/widget.js
npm run widget:watch   # dev mode, rebuilds on change
```

The `build` script (`next build`) also runs `widget:build` automatically.

Bundle: ~70 KB raw / ~21 KB gzipped (includes `@supabase/realtime-js` for
WebSocket + Presence). The widget uses Shadow DOM (`mode: 'closed'`) so host page
styles cannot reach it.

## Email channel

Inbound email arrives at `POST /api/webhooks/postmark-inbound` and becomes a message in
a conversation with `channel = 'email'`. Agents reply from the same inbox view they use
for chat, and the reply goes out through Postmark's send API as a real email.

### Routing an email to a workspace

Postmark delivers every inbound email for the whole account to one webhook, so the
payload has to say which tenant it belongs to. Each workspace gets an `inbound_token`,
and its address is the account inbound address with that token as a plus-suffix:

```
yourhash+3f9a1c7e2b8d04f6a1@inbound.postmarkapp.com
└─ POSTMARK_INBOUND_ADDRESS ─┘ └─ workspaces.inbound_token ─┘
```

Postmark reports the suffix back as `MailboxHash`, which is matched against
`workspaces.inbound_token`. The address is shown under **Settings → Email address**.

The token is 9 random bytes as lowercase hex, generated by a `DEFAULT` on the column
rather than in application code, so no insert path can create a workspace without one.
Lowercase because a local part round-trips through arbitrary mail servers on the way
back and case is not reliably preserved; 72 bits because the address is public-ish but
must not be guessable to inject email into another workspace.

### Threading

`MailboxHash` identifies the **tenant**. It never identifies the **thread**, because a
customer may reply from a different alias than the one that opened the conversation.
Threading is done entirely on RFC 5322 headers:

- **Inbound** — `In-Reply-To` and `References` are matched against
  `messages.email_message_id` within the workspace. A hit on `In-Reply-To` (the direct
  parent) wins; a `References`-only hit is the fallback for clients that send a chain
  without `In-Reply-To`. A hit appends to that conversation. No hit starts a new one:
  find-or-create a contact by sender address, then insert a conversation.
- **Outbound** — the reply carries `In-Reply-To` set to the previous message's
  `email_message_id` and `References` set to the known chain, so mail clients collapse
  it into the existing thread. `Reply-To` is the workspace's inbound plus-address, which
  is what brings the customer's next reply back to the right place.

**We mint our own `Message-ID`.** Postmark's send API returns a `MessageID`, but that is
its internal delivery id — not the `Message-ID` header the recipient's mail client sees
and quotes back in `In-Reply-To`. Storing it would mean nothing ever matched on inbound.
So `lib/postmark.ts` generates `<uuid@from-domain>`, sends it in the `Headers` array
alongside `X-PM-KeepID: true` (without which Postmark replaces it), and stores that.
Postmark's own id is logged for cross-referencing its activity feed.

`StrippedTextReply` is used as the message body, not `TextBody`, so a reply does not
drag the whole quoted thread into the conversation. It is empty on a first email and on
some HTML-only mail, so the fallback is `TextBody`, then a de-tagged `HtmlBody`.

### Webhook authentication

Two layers, both in `lib/postmark-inbound.ts`:

1. **HTTP Basic Auth.** Postmark supports credentials embedded in the webhook URL, so
   the configured URL is `https://USER:PASS@your-app.com/api/webhooks/postmark-inbound`.
   Compared against `POSTMARK_INBOUND_WEBHOOK_USER` / `_PASS` in constant time.
2. **Source IP allowlist.** Checked against Postmark's four published webhook IPs. Only
   enforced when `NODE_ENV === 'production'`, because local testing goes through ngrok or
   curl and would never present a Postmark IP. Basic Auth still applies there.

Both failures return 401/403. That is deliberate — Postmark's retry policy only matters
for deliveries we accept, and an unauthenticated caller should never be told its payload
was stored.

### Failure modes

Postmark retries any non-200 up to 10 times over ~10.5 hours, so the status code is the
contract:

| Situation                                                              | Status | Why                                    |
| ---------------------------------------------------------------------- | ------ | -------------------------------------- |
| Bad credentials or non-Postmark IP                                     | 401/403| Not Postmark; retries are not our problem |
| Malformed JSON, no `MailboxHash`, unknown workspace, unparseable sender | 200    | Retrying cannot make it routable       |
| Duplicate delivery of a `Message-ID` already stored                     | 200    | Already durable                        |
| Stored successfully                                                    | 200    | Done                                   |
| Database lookup or insert failed                                        | 500    | Should be retried, and will dedupe     |

**Idempotency** is enforced by the unique index on
`messages (workspace_id, email_message_id)`. The route checks for an existing row first
and treats a `23505` unique violation on insert as a duplicate too, so two concurrent
deliveries of the same email cannot both create a row.

**Everything after the insert is best-effort.** Bumping `last_message_at`, reopening a
resolved thread and the Realtime broadcast run inside a `try/catch` that logs and
swallows, because the payload is already durable at that point — a 500 there would only
earn a redelivery that gets deduplicated and dropped. Later work such as an AI summary
hangs off the same place and gets the same treatment.

On the outbound side the ordering is reversed: the email is sent **before** the message
row is written, because the `Message-ID` to store is only known once it has been sent,
and a row for an email the customer never received would be a lie to the agent. A send
failure surfaces the reason in the composer. The narrow window where the email is
accepted but the insert then fails is logged explicitly as `sent but not persisted`.

Unroutable and malformed payloads log one structured line with the Postmark `MessageID`,
`MailboxHash`, sender, subject and original recipient — enough to find the email in
Postmark's activity feed without reproducing it. Message bodies are never logged, only
their length.

### Configuring Postmark

1. Create a server. Copy its **Server API Token** into `POSTMARK_SERVER_TOKEN`.
2. Verify a Sender Signature or domain, and put that address in `POSTMARK_FROM_EMAIL`.
3. Open the server's **Inbound** stream and copy the inbound address into
   `POSTMARK_INBOUND_ADDRESS`.
4. Pick a user and a long random password, set `POSTMARK_INBOUND_WEBHOOK_USER` and
   `POSTMARK_INBOUND_WEBHOOK_PASS`, and set the **Inbound Webhook** URL to
   `https://USER:PASS@your-app.com/api/webhooks/postmark-inbound`.

To test locally, expose port 3000 (`ngrok http 3000`) and use the forwarding host in the
webhook URL. The IP check is skipped outside production, so this works as-is.

## Deferred

Not attempted yet, in build order: unified inbox with filters and assignment, knowledge
base editor and public pages, AI summarisation, custom domains.

Left out of the email channel on purpose:

- **Attachments.** Postmark base64-encodes them into the payload; storing them needs
  Supabase Storage and a size policy. Ignored, not rejected — an email with attachments
  still lands as a message with its text body.
- **HTML bodies.** Messages are stored and rendered as plain text, and replies are sent
  as `TextBody` only. Rendering customer HTML in the dashboard is an XSS surface that
  needs a sanitiser, and the `messages.body` column is plain text.
- **Rate limiting**, still, on both the widget routes and this webhook. The webhook is
  authenticated and idempotent, which blunts the risk.
- **Bounce and spam-complaint webhooks.** Postmark reports them; nothing consumes them,
  so a hard bounce is invisible in the dashboard.
- **Inbound spam filtering.** Postmark's `X-Spam-Status` header is in the payload and is
  currently ignored, so a spam email becomes a conversation.

Also deliberately left out of the foundation:

- **Rate limiting.** The invite and auth actions are unthrottled beyond Supabase Auth's
own limits. It belongs with the public widget API routes in phase 2.
- **Changing a teammate's role, and removing a member.** The RLS policies exist
(`profiles_delete_admin`, column-level `UPDATE` grants) but there is no UI. Role is
fixed at invite time.
- **Renaming a workspace.** `workspaces_update_admin` allows it; Settings is read-only.
- **One workspace per user.** `profiles.auth_user_id` is unique, so an account cannot
belong to two workspaces. Multi-workspace membership would mean dropping that
constraint and moving `workspace_id` into a claim or a workspace switcher.

