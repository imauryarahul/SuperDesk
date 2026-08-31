-- Staleness is measured in customer messages, not total messages.
--
-- ai_summary_message_count stays as-is: it is the offset the delta-update path
-- reads from. But it is the wrong signal for deciding *whether* to regenerate,
-- because an agent's own reply bumps it and triggered a model call that told
-- the agent what they had just written. Counting inbound messages instead means
-- only the customer saying something new can make a summary stale.
--
-- ai_summary_generating_at is a claim marker so two agents opening the same
-- stale thread do not both pay for a generation.

alter table public.conversations
  add column ai_summary_inbound_count int not null default 0
    check (ai_summary_inbound_count >= 0),
  add column ai_summary_generating_at timestamptz;

comment on column public.conversations.ai_summary_inbound_count is
  'How many customer messages ai_summary reflects. Drives the staleness threshold.';
comment on column public.conversations.ai_summary_generating_at is
  'Set while a summary generation is in flight; expires so a crash cannot wedge it.';

-- Existing summaries: seed from the window the stored summary actually covers
-- (its first ai_summary_message_count messages), so backfilled rows are neither
-- treated as maximally stale nor wrongly marked fresh.
update public.conversations c
set ai_summary_inbound_count = coalesce((
  select count(*)
  from (
    select m.sender_type
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at
    limit c.ai_summary_message_count
  ) covered
  where covered.sender_type = 'contact'
), 0)
where c.ai_summary is not null;
