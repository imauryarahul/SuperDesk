# SuperDesk

Customer communication platform. This repository currently contains **phase 1 only**:
database schema, tenant isolation, authentication, team roles, the invite flow, and
an empty dashboard shell. Chat, email, knowledge base, AI and custom domains are not
built yet — see [Deferred](#deferred).

Stack: Next.js 14 (App Router) · TypeScript (strict) · Tailwind · Supabase (Postgres,
Auth, RLS).

## Getting started

```bash
npm install
cp .env.local.example .env.local   # fill in the three Supabase values
npm run dev
```

| Variable | Where to find it | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API keys | Publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API keys | **Server only.** Signup and the invite page fail loudly without it. |
| `NEXT_PUBLIC_APP_URL` | — | Base URL for invite links. Defaults to `http://localhost:3000`. |

Two Supabase dashboard settings matter for local testing:

- **Authentication → Sign In / Providers → Confirm email.** On by default. With it on,
  signup creates the workspace but returns no session, and the app tells the user to
  confirm first. Turn it off to click through the whole flow without a mailbox.
- Supabase Auth rejects reserved TLDs (`.local`, `.test`), so use real-looking domains
  when creating accounts by hand.

## Database

Migrations are plain SQL under `supabase/migrations`, applied in filename order:

```
20260830000100_initial_schema.sql   tables, enums, indexes, updated_at triggers
20260830000200_rls_policies.sql     helper functions, privileged routines, RLS
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

**The RLS helpers live in a `private` schema.** Supabase's default privileges grant
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

## Deferred

Not attempted in this phase, in build order: chat widget and realtime, Postmark email
channel, unified inbox with filters and assignment, knowledge base editor and public
pages, AI summarisation, custom domains.

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
