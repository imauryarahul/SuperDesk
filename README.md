# SuperDesk

A customer communication platform built as a production assignment. All features are complete and running on a live Supabase project.

**Stack:** Next.js 14 (App Router) · TypeScript · Tailwind CSS · Supabase (Postgres, Auth, Realtime) · Postmark · OpenAI · Vercel

---

## What's built


| Phase | Feature                                                                                                  |
| ----- | -------------------------------------------------------------------------------------------------------- |
| 1     | Auth, workspace creation, team roles (one Admin per workspace + Agents), invite flow                     |
| 2     | Embeddable chat widget, real-time messaging, typing indicators, presence                                 |
| 3     | Email channel — inbound parsing, reply from dashboard, proper thread linking                             |
| 4     | Unified inbox — filters, assign, snooze, resolve, live updates                                           |
| 5     | Knowledge base — rich-text editor, categories, public help centre, full-text search, widget auto-suggest |
| 6     | AI issue summaries and auto-reply drafts                                                                 |
| 7     | Custom domains for the help centre                                                                       |
| 8     | Analytics dashboard — response times, resolution rate, busiest hours, per-agent stats                    |
| 8b    | SLA tracking with business-hours awareness                                                               |


---



## Getting started

```bash
npm install
cp .env.local.example .env.local   # add your Supabase credentials
npm run widget:build               # build the chat widget once
npm run dev
```



### Environment variables


| Variable                        | Where to find it                       | Required for                                       |
| ------------------------------- | -------------------------------------- | -------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase → Project Settings → API      | Always                                             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API keys | Always                                             |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase → Project Settings → API keys | Always (server-only)                               |
| `NEXT_PUBLIC_APP_URL`           | Your deployment URL                    | Invite links (defaults to `http://localhost:3000`) |
| `POSTMARK_SERVER_TOKEN`         | Postmark → Server → API Tokens         | Email channel                                      |
| `POSTMARK_FROM_EMAIL`           | Your verified sender address           | Email channel                                      |
| `POSTMARK_INBOUND_ADDRESS`      | Postmark → Inbound stream address      | Email channel                                      |
| `POSTMARK_INBOUND_WEBHOOK_USER` | Pick any username                      | Email channel                                      |
| `POSTMARK_INBOUND_WEBHOOK_PASS` | Pick a strong password                 | Email channel                                      |
| `OPENAI_API_KEY`                | platform.openai.com/api-keys           | AI summaries and drafts                            |
| `VERCEL_API_TOKEN`              | vercel.com/account/tokens              | Custom domains                                     |
| `VERCEL_PROJECT_ID`             | Vercel → Project Settings → General    | Custom domains                                     |
| `VERCEL_TEAM_ID`                | Vercel → Team Settings → General       | Custom domains (team accounts only)                |


The email, AI, and Vercel variables are optional — the app works without them; those features just won't be available.

### Local testing note

Supabase's **Confirm email** setting is on by default. Turn it off (Authentication → Sign In → Confirm email) to skip the confirmation step while testing locally. Also avoid `.local` and `.test` TLDs when signing up — Supabase rejects them.

---



## Database

Migrations live in `supabase/migrations/` and run in filename order.

After any schema change, regenerate TypeScript types:

```bash
supabase gen types typescript --project-id <ref> > types/database.ts
```



### How tenant isolation works

Every table has a `workspace_id` column. Row-level security policies ensure users can only read and write rows that belong to their own workspace — this is enforced at the database level, not just in application code. Even if there's a bug in the app, data from one workspace cannot leak to another.

You can verify this by running the isolation test suite:

```bash
psql "$DATABASE_URL" -f supabase/tests/rls_isolation.sql
```

It seeds two workspaces, runs 101 probes across workspace boundaries, and rolls everything back. All currently pass.

---



## Architecture

**Two Supabase clients.** The browser client and server client both run as the signed-in user, so every query goes through row-level security. A third admin client bypasses security — it's used in exactly two places (workspace creation at signup, and reading an invite before the user has a workspace), and both places verify authorization before using it.

**Signup and invite acceptance are atomic.** Each writes to two tables, so they're implemented as database functions. If something fails halfway, you don't end up with an orphaned workspace or a half-joined user.

**Middleware is for redirects, not security.** The middleware refreshes your session cookie and sends signed-out users to `/login`. It validates the token on every request rather than trusting the cookie blindly. But even if a request slips past it, the database won't serve data from the wrong workspace.

---



## Invite flow

Each workspace has exactly one admin: the person who created it. Everyone invited afterwards joins as an agent, so there is no role to choose on the invite form.

This is enforced in the database, not just the UI — a partial unique index allows only one `admin` profile per workspace, and a check constraint stops an admin invite being created at all. Both matter because the row-level security policy lets an admin write invite rows directly through the API, so the form alone would not be a real gate.

Admins invite teammates by email from Settings. The invite link is generated and shown in the UI for the admin to share (email delivery is handled by Postmark once the email channel is set up).

When someone opens an invite link:

- **New user** — they set a password on the invite page and their account is created immediately.
- **Existing user** — they sign in with the invited address and click Accept. If they're already signed in as that address, it's a single button click.

Invites expire after 7 days and can only be used once. Admins can also remove teammates from Settings → Team — this removes their profile and unassigns their conversations, but keeps their login so they can be re-invited later. You can't remove yourself, which prevents leaving a workspace with no admin.

---



## Chat widget



### Adding it to a site

```html
<script
  src="https://[your-app-domain]/widget.js"
  data-workspace-id="YOUR_WORKSPACE_UUID"
></script>
```

That's it — the widget loads and boots automatically. To identify a known user:

```js
window.SuperDesk.boot({
  workspaceId: 'YOUR_WORKSPACE_UUID',
  email: 'user@example.com',
  name: 'Jane Smith',           // optional
})
```

The `name` field is optional and stored on the contact record (max 100 characters). Anonymous visitors work fine without it.

### Allowed domains

The widget only works from domains you've approved. Admins manage this from **Settings → Chat widget → Allowed domains** — no database access needed:

- Type a domain like `https://yoursite.com` or `http://localhost:5500` and click Add
- Include the full scheme — `https://yoursite.com` and `http://yoursite.com` are treated as different origins
- Remove a domain any time; it stops the widget loading there immediately

Requests from unlisted origins are rejected with HTTP 403.

### Testing locally

Serve the test page from a different port so the widget makes a real cross-origin request:

```bash
# Terminal 1 — Next.js app
npm run dev

# Terminal 2 — test page
npx serve -l 5500 .
# Open http://localhost:5500/test.html
```

Add `http://localhost:5500` to `allowed_widget_domains` and replace `PASTE_WORKSPACE_ID_HERE` in `test.html` with your workspace UUID.

### Building the widget

```bash
npm run widget:build   # one-off build → public/widget.js
npm run widget:watch   # rebuild on change during development
```

`next build` runs `widget:build` automatically, so production deploys always get the latest widget. The bundle is ~70 KB raw / ~21 KB gzipped. It uses Shadow DOM so the host page's CSS can't interfere with widget styles.

---



## Email channel

Inbound emails arrive as conversations in the inbox. Agents reply from the same view they use for chat, and the reply is sent as a real email through Postmark.

### How a workspace receives email

Every workspace gets a unique inbound address in this format:

```
yourhash+{postmark_email_id}@inbound.postmarkapp.com
└─── POSTMARK_INBOUND_ADDRESS ───┘ └── workspace token ──┘
```

The address is shown under **Settings → Email address**. When a customer emails it, Postmark sends the message to your webhook and includes the workspace token, so the app knows which workspace the email belongs to.

### Email threading

Replies are linked to existing conversations using standard email headers (`In-Reply-To` and `References`) — the same way mail clients like Gmail thread emails. If a customer replies from a different email address, the thread still links up correctly.

When sending replies, the app generates its own RFC-compliant `Message-ID` and stores it. This is what makes threading reliable — Postmark's internal delivery ID doesn't appear in the headers that mail clients exchange, so it can't be used for this.

### Webhook security

The inbound webhook is protected by two layers:

1. **HTTP Basic Auth** — credentials are embedded in the webhook URL that Postmark calls.
2. **IP allowlist** — in production, only Postmark's known IP addresses are accepted.



### What happens with bad or duplicate emails

Postmark retries failed deliveries for ~10 hours. The app uses HTTP status codes to signal what Postmark should do:


| Situation                                   | Status  | Reason                          |
| ------------------------------------------- | ------- | ------------------------------- |
| Bad credentials or wrong IP                 | 401/403 | Reject; retries aren't useful   |
| Malformed payload or unknown workspace      | 200     | Retrying won't fix it           |
| Email already received (duplicate delivery) | 200     | Already saved                   |
| Saved successfully                          | 200     | Done                            |
| Database error                              | 500     | Retry; the app will deduplicate |




### Configuring Postmark

1. Create a Postmark server. Copy the **Server API Token** → `POSTMARK_SERVER_TOKEN`.
2. Verify a sender address and put it in `POSTMARK_FROM_EMAIL`.
3. Open the **Inbound** stream and copy the inbound address → `POSTMARK_INBOUND_ADDRESS`.
4. Choose a username and password, set `POSTMARK_INBOUND_WEBHOOK_USER` / `_PASS`, and set the **Inbound Webhook URL** to:
  ```
   https://USER:PASS@your-app.com/api/webhooks/postmark-inbound
  ```

To test locally, use `ngrok http 3000` to get a public URL and use that as the webhook host. The IP check is skipped outside production.

---



## AI features

The app uses `gpt-5.4-mini` for two things: summarising conversations and drafting replies. Both use the Responses API with reasoning disabled (these are straightforward tasks, not complex reasoning) and an 8-second hard timeout.

### Conversation summaries

A summary panel appears below the conversation thread. It loads asynchronously so it never slows down opening a conversation.

A new summary is generated when:

- There's no summary yet, **or**
- The customer has sent 2 or more new messages since the last summary

Agent replies alone don't trigger a new summary — only customer messages do. This keeps API costs low. Once a summary is generated, newer messages show a Refresh button if you want an updated version.

When two agents open the same conversation at the same time, only one summary request goes to the API — the second agent gets the result from the first.

If the summary fails, "Summary unavailable" is shown with a manual retry button. It never blocks the conversation view.

**What gets sent to the model:**

- First summary: the most recent ~40 messages (capped at ~10,000 characters)
- Updates: the stored summary + only the new messages since it was last generated



### Auto-reply drafts

Click **Draft reply** in the composer to generate a suggested reply. The draft is never sent automatically — it lands in the composer as editable text.

The model gets: the current summary, recent messages, and the top 2–3 knowledge base articles relevant to the customer's latest message (so drafts can reference real docs rather than guessing).

### Rate limits

To control costs, summaries are limited to 20 per workspace per minute and drafts to 15 per workspace per minute.

---



## Custom domains

Each workspace can serve its help centre at a custom hostname — e.g. `help.yoursite.com`. This is managed under Settings → Custom domain (admin only).

### Setup

1. Get a Vercel API token at [vercel.com/account/tokens](https://vercel.com/account/tokens) and set `VERCEL_API_TOKEN`.
2. Copy the Vercel project ID from Project Settings → General into `VERCEL_PROJECT_ID`.
3. If the project is under a Vercel team (not a personal account), also set `VERCEL_TEAM_ID`.



### How it works

1. **Connect** — enter your hostname. The app registers it with Vercel and shows the DNS records you need to add (A record, CNAME, or TXT challenge, depending on your domain type).
2. **Add DNS records** — update your DNS at your registrar.
3. **Check verification** — click the button once DNS has propagated. The domain is marked verified only when Vercel confirms both ownership and correct DNS configuration. Ownership alone isn't enough — if the DNS doesn't point here, there's no SSL certificate and the domain won't work.

SSL is provisioned automatically by Vercel once verification passes — nothing to configure.

### Security: the hijack guard

Anyone can type any hostname into a form. An unverified claim is never served. Until the domain is verified, every request to it gets a `404` — not a placeholder page, not the claimant's content, nothing. This prevents a user from claiming a hostname they don't control and squatting on it.

Once verified, the custom domain serves only the public help centre. The dashboard, settings, login, and API routes all return 404 on a custom domain — a customer-controlled hostname can't become a backdoor into the app.

---



## Analytics dashboard

Available at `/analytics` for any signed-in workspace member.


| Card                | What it shows                                        |
| ------------------- | ---------------------------------------------------- |
| SLA breaches        | Open conversations currently past their SLA deadline |
| Avg first response  | Mean, median, and P95 response times                 |
| Resolution rate     | Percentage of conversations resolved                 |
| Total conversations | All-time total, split by status                      |


**Busiest hours** — a bar chart of message volume by hour of day (UTC), across both chat and email. Built with CSS only, no charting library.

**Per-agent breakdown** — resolved conversations and average first-response time per team member.

All queries run in parallel. Every section has an explicit empty state so a fresh workspace always looks clean.

---



## SLA tracking

Each workspace has configurable SLA targets for first response and resolution, measured in business hours.

### Schedule settings

Configure under **Settings → SLA & Business Hours**:

- First-response target (default: 30 minutes)
- Resolution target (default: 24 hours)
- Business hours — start and end time (default: 09:00–18:00)
- Working days (default: Monday–Friday)
- Timezone (default: Asia/Kolkata)

These defaults apply to every workspace without any configuration. Admins can change them; agents can view them.

### How SLA is calculated

**First response** — time from the customer's first message to the first agent reply. If no reply yet, the clock is still running. Snoozing doesn't pause this clock — snoozing an unanswered customer doesn't buy more time to respond.

**Resolution** — time from the customer's first message to when the conversation was resolved, minus time spent snoozed (only business-hours time counts in both directions).

Business hours are calculated correctly across timezones and daylight saving transitions. A conversation resolved at 3am still only counts the business-hours portion of that span.

### Status indicators

Each conversation shows a coloured dot in the inbox list and a labelled pill in the thread header:

- **Green** — on track
- **Yellow** — approaching the deadline (within the final 20% of the target)
- **Red** — breached

Hover over the dot for the exact time remaining or elapsed. The inbox refreshes SLA status every 60 seconds since the clock moves even when there's no new message.

A conversation with no customer message (e.g. agent-initiated) has no SLA clock.

---



## What's not built



### Custom domains

- No background polling — if you never click "Check verification", the domain stays pending
- No in-place domain swapping — disconnect the old one before connecting a new one
- One hostname per workspace (no automatic apex + www pair)



### Email channel

- **Attachments** — emails with attachments still arrive, but the files are ignored (only the text body is stored)
- **HTML emails** — stored and displayed as plain text
- **Bounce and spam-complaint handling** — Postmark reports these but the app doesn't act on them
- **Spam filtering** — spam emails become conversations



### General

- **Teammate role changes** — everyone except the workspace creator is an agent, and there is no way to promote, demote, or transfer the admin role
- **Multi-workspace accounts** — one account belongs to one workspace
- **Invite rate limiting** — the invite action itself isn't rate-limited (Supabase Auth limits apply)

