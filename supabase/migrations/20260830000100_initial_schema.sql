-- SuperDesk initial schema.
-- Every tenant-owned table carries workspace_id directly so RLS never has to join.

create type public.user_role as enum ('admin', 'agent');
create type public.conversation_channel as enum ('chat', 'email');
create type public.conversation_status as enum ('open', 'snoozed', 'resolved');
create type public.message_sender_type as enum ('contact', 'agent', 'system');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- workspaces ----------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  custom_domain text unique,
  allowed_widget_domains text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

-- profiles ------------------------------------------------------------------

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  role public.user_role not null default 'agent',
  -- Denormalised from auth.users: clients cannot read the auth schema, and the
  -- team list needs to render without a service-role round trip.
  email text not null,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create index profiles_workspace_id_idx on public.profiles (workspace_id);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- workspace_invites ---------------------------------------------------------

create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  role public.user_role not null,
  token text not null unique,
  invited_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspace_invites_workspace_id_idx on public.workspace_invites (workspace_id);

-- At most one outstanding invite per email per workspace.
create unique index workspace_invites_pending_email_idx
  on public.workspace_invites (workspace_id, lower(email))
  where accepted_at is null;

create trigger workspace_invites_set_updated_at
  before update on public.workspace_invites
  for each row execute function public.set_updated_at();

-- contacts ------------------------------------------------------------------

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  anonymous_token text,
  email text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (anonymous_token is not null or email is not null),
  unique (id, workspace_id)
);

create index contacts_workspace_id_idx on public.contacts (workspace_id);
create unique index contacts_workspace_anonymous_token_idx
  on public.contacts (workspace_id, anonymous_token) where anonymous_token is not null;
create unique index contacts_workspace_email_idx
  on public.contacts (workspace_id, lower(email)) where email is not null;

create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();

-- conversations -------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  contact_id uuid not null,
  channel public.conversation_channel not null,
  status public.conversation_status not null default 'open',
  assigned_agent_id uuid,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  -- Composite FKs pin every relation to a single workspace, so a cross-tenant
  -- id can never be referenced even if application code slips.
  foreign key (contact_id, workspace_id)
    references public.contacts (id, workspace_id) on delete cascade,
  foreign key (assigned_agent_id, workspace_id)
    references public.profiles (id, workspace_id) on delete set null (assigned_agent_id)
);

create index conversations_workspace_id_idx on public.conversations (workspace_id);
create index conversations_contact_id_idx on public.conversations (contact_id);
create index conversations_assigned_agent_id_idx on public.conversations (assigned_agent_id);
create index conversations_inbox_idx
  on public.conversations (workspace_id, status, last_message_at desc);

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- messages ------------------------------------------------------------------

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  -- Denormalised from conversations so RLS is a column comparison, not a join,
  -- and so Realtime can filter by workspace on the wire.
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  conversation_id uuid not null,
  sender_type public.message_sender_type not null,
  -- Polymorphic: contacts.id, profiles.id, or null for system messages.
  -- Not a FK; the composite FKs above already confine both tables to workspace_id.
  sender_id uuid,
  body text not null,
  email_message_id text,
  email_in_reply_to text,
  created_at timestamptz not null default now(),
  check ((sender_type = 'system') = (sender_id is null)),
  foreign key (conversation_id, workspace_id)
    references public.conversations (id, workspace_id) on delete cascade
);

create index messages_conversation_id_created_at_idx
  on public.messages (conversation_id, created_at);
create index messages_workspace_id_idx on public.messages (workspace_id);
-- Makes inbound email delivery idempotent.
create unique index messages_workspace_email_message_id_idx
  on public.messages (workspace_id, email_message_id) where email_message_id is not null;

-- knowledge base ------------------------------------------------------------

create table public.kb_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create index kb_categories_workspace_id_idx on public.kb_categories (workspace_id);

create trigger kb_categories_set_updated_at
  before update on public.kb_categories
  for each row execute function public.set_updated_at();

create table public.kb_articles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  category_id uuid,
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null default '',
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (category_id, workspace_id)
    references public.kb_categories (id, workspace_id) on delete set null (category_id)
);

create index kb_articles_workspace_id_idx on public.kb_articles (workspace_id);
create index kb_articles_category_id_idx on public.kb_articles (category_id);

create trigger kb_articles_set_updated_at
  before update on public.kb_articles
  for each row execute function public.set_updated_at();
