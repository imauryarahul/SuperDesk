-- When a conversation is marked resolved, record when. When it is reopened
-- (status leaves 'resolved'), clear it so the next resolution gets a fresh
-- timestamp. A trigger keeps every code path honest — dashboard resolve/reopen,
-- snooze/unsnooze, and inbound email reopening a resolved thread.
--
-- resolved_at is nullable and only set while status = 'resolved'. The check
-- constraint enforces that invariant; the trigger maintains it on writes.

alter table public.conversations
  add column resolved_at timestamptz;

-- Best-effort backfill for rows already resolved before this column existed.
update public.conversations
set resolved_at = updated_at
where status = 'resolved'
  and resolved_at is null;

create or replace function public.sync_conversation_resolved_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'resolved' and new.resolved_at is null then
      new.resolved_at = now();
    end if;
    return new;
  end if;

  -- UPDATE: only touch resolved_at when status actually crosses the resolved boundary.
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    new.resolved_at = now();
  elsif new.status is distinct from 'resolved' and old.status = 'resolved' then
    new.resolved_at = null;
  end if;

  return new;
end;
$$;

create trigger conversations_sync_resolved_at
  before insert or update of status on public.conversations
  for each row execute function public.sync_conversation_resolved_at();

alter table public.conversations
  add constraint conversations_resolved_at_consistency check (
    (status = 'resolved') = (resolved_at is not null)
  );

-- Supports future date-range analytics filtered by when a conversation was resolved.
create index conversations_workspace_resolved_at_idx
  on public.conversations (workspace_id, resolved_at desc)
  where resolved_at is not null;
