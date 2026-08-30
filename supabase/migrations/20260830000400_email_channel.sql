-- Email channel: per-workspace inbound routing token, and a subject line to
-- carry on email conversations.

-- Inbound routing token -----------------------------------------------------
--
-- Postmark delivers every inbound email for the whole account to one webhook,
-- so the payload's MailboxHash is the only thing that says which tenant an
-- email belongs to. Each workspace gets a token that becomes the plus-address
-- suffix of its inbound address: yourhash+{token}@inbound.postmarkapp.com.
--
-- Lowercase hex, because a MailboxHash round-trips through arbitrary mail
-- servers on the way back to Postmark and case is not reliably preserved in a
-- local part. 9 bytes is 72 bits, enough that the address cannot be guessed to
-- inject email into someone else's workspace.

-- gen_random_bytes lives in pgcrypto, which Supabase installs into `extensions`.
create extension if not exists pgcrypto with schema extensions;

-- Must stay VOLATILE. ALTER TABLE ADD COLUMN evaluates a non-volatile default
-- once and stores that single value against every existing row, which would
-- give every workspace the same token and fail the unique constraint. A
-- volatile default forces a table rewrite and a fresh token per row.
create or replace function private.generate_inbound_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select encode(extensions.gen_random_bytes(9), 'hex')
$$;

revoke all on function private.generate_inbound_token() from public;
grant execute on function private.generate_inbound_token() to service_role;

alter table public.workspaces
  add column inbound_token text not null unique
    default private.generate_inbound_token()
    check (inbound_token ~ '^[0-9a-f]{18}$');

-- The default is what makes generation automatic: create_workspace_with_admin
-- inserts only `name`, so every workspace gets a token whether it is created by
-- signup, a future admin tool, or by hand in the SQL editor. There is no insert
-- path that can produce a workspace without one.

-- Conversation subject ------------------------------------------------------
--
-- Chat has no subject, but email does, and a reply needs one to thread visibly
-- in the customer's mail client. Held on the conversation rather than per
-- message: the thread's subject is set by the email that opened it.

alter table public.conversations add column subject text;

-- Threading lookups ---------------------------------------------------------
--
-- Inbound resolution matches In-Reply-To / References against every
-- email_message_id in the workspace. The existing unique index on
-- (workspace_id, email_message_id) already serves that lookup and enforces
-- idempotency, so no new index is needed here.
