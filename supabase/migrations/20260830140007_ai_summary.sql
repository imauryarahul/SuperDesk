-- AI issue summarization: cache the latest summary on the conversation so
-- opening a thread can skip the model when nothing new has been said.
--
-- ai_summary_message_count is the number of messages the stored summary
-- reflects. The inbox compares it to count(*) on messages; if the live count
-- is higher, the summarization endpoint sends only the delta (or a capped
-- recent window when there is no summary yet).

alter table public.conversations
  add column ai_summary text,
  add column ai_summary_updated_at timestamptz,
  add column ai_summary_message_count int not null default 0
    check (ai_summary_message_count >= 0);

comment on column public.conversations.ai_summary is
  'Cached issue summary. Null until summarization has succeeded at least once.';
comment on column public.conversations.ai_summary_updated_at is
  'When ai_summary was last written. Null iff ai_summary is null.';
comment on column public.conversations.ai_summary_message_count is
  'How many messages ai_summary currently reflects. Cheap staleness check.';
