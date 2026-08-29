-- Enable Postgres Changes for the inbox.
--
-- Supabase creates the `supabase_realtime` publication empty: a table emits no
-- Realtime events until it is explicitly added. Without this, the dashboard's
-- postgres_changes subscriptions silently never fire and new conversations only
-- appear on a page refresh.
--
-- RLS still applies per subscriber: Realtime evaluates the subscriber's JWT
-- against the table's policies before delivering a row, so this does not widen
-- tenant access.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end
$$;

-- UPDATE/DELETE events default to shipping only the primary key in the old
-- record, which means a `workspace_id=eq.…` subscription filter cannot match
-- them. Full replica identity ships every column so status changes and
-- deletions reach the right workspace.
alter table public.conversations replica identity full;
