-- SLA status, computed on read.
--
-- Nothing here is stored. A persisted breach flag is wrong the moment time
-- passes without a write: a conversation that is 29 minutes old against a
-- 30-minute target becomes a breach with no row change to trigger on, so any
-- stored value would need a background job to stay honest and would be stale
-- between runs. Computing it in the read path costs one function call and is
-- always correct as of the moment it is rendered.
--
-- SECURITY INVOKER, no workspace_id parameter: the policies on conversations,
-- messages, and workspaces are the only gate, exactly like the analytics
-- functions. Passing conversation ids that belong to another tenant returns
-- zero rows rather than an error.

-- Per-conversation SLA -------------------------------------------------------
--
-- p_conversation_ids: null means "every conversation the caller can see", which
-- is what the breach summary needs. p_unresolved_only skips resolved rows, both
-- as a filter and as a cost control — the business-seconds function walks
-- calendar days, so scanning years of closed conversations is the expensive
-- shape to avoid.
--
-- Clock definitions:
--
--   First response — first contact message → first agent reply that came after
--   it. No reply yet means the clock is still running against now(), so an
--   unanswered conversation past target reads as breached without anyone
--   touching the row. No snooze adjustment: snoozing an unanswered customer
--   should not buy the team more time to answer them.
--
--   Resolution — first contact message → resolved_at, or now() while the
--   conversation is still open, minus banked snoozed seconds and minus any
--   snooze currently in progress. Because a resolved conversation's endpoint is
--   resolved_at and its snooze total is frozen, its elapsed value can never
--   change again: it cannot drift into breach after the fact.
--
-- A conversation with no contact message has no clock at all (both states null).
-- That is the normal state of an agent-initiated thread, not an error.

create or replace function public.get_conversations_sla(
  p_conversation_ids uuid[],
  p_unresolved_only  boolean
)
returns table (
  conversation_id               uuid,
  first_response_state          text,
  first_response_seconds        bigint,
  first_response_target_seconds bigint,
  first_response_at             timestamptz,
  resolution_state              text,
  resolution_seconds            bigint,
  resolution_target_seconds     bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with convs as (
    select c.id, c.workspace_id, c.status, c.resolved_at, c.snoozed_at,
           c.total_snoozed_seconds
    from   public.conversations c
    where  (p_conversation_ids is null or c.id = any (p_conversation_ids))
      and  (not coalesce(p_unresolved_only, false) or c.status <> 'resolved')
  ),
  first_contact as (
    select m.conversation_id, min(m.created_at) as ts
    from   public.messages m
    join   convs c on c.id = m.conversation_id
    where  m.sender_type = 'contact'
    group  by m.conversation_id
  ),
  first_agent as (
    select m.conversation_id, min(m.created_at) as ts
    from   public.messages m
    join   convs c on c.id = m.conversation_id
    where  m.sender_type = 'agent'
    group  by m.conversation_id
  ),
  base as (
    select
      c.id,
      c.status,
      c.resolved_at,
      c.snoozed_at,
      c.total_snoozed_seconds,
      fc.ts as contact_ts,
      -- An agent message that predates the first contact message (the agent
      -- opened the thread) is not a response to anything.
      case when fa.ts > fc.ts then fa.ts end as agent_ts,
      (w.first_response_target_minutes * 60)::bigint as fr_target,
      (w.resolution_target_minutes     * 60)::bigint as res_target,
      w.business_hours_start as h_start,
      w.business_hours_end   as h_end,
      w.business_days        as days,
      w.business_timezone    as tz
    from      convs c
    join      public.workspaces w on w.id = c.workspace_id
    left join first_contact fc on fc.conversation_id = c.id
    left join first_agent   fa on fa.conversation_id = c.id
  ),
  measured as (
    select
      b.*,
      case
        when b.contact_ts is null then null
        else private.business_seconds_between(
               b.contact_ts, coalesce(b.agent_ts, now()),
               b.h_start, b.h_end, b.days, b.tz)
      end as fr_seconds,
      case
        when b.contact_ts is null then null
        else greatest(
               private.business_seconds_between(
                 b.contact_ts, coalesce(b.resolved_at, now()),
                 b.h_start, b.h_end, b.days, b.tz)
               - b.total_snoozed_seconds
               -- A snooze in progress has not been banked yet, so it is
               -- credited live. Resolved rows always have snoozed_at null.
               - case
                   when b.snoozed_at is null then 0
                   else private.business_seconds_between(
                          b.snoozed_at, now(),
                          b.h_start, b.h_end, b.days, b.tz)
                 end,
               0)
      end as res_seconds
    from base b
  )
  select
    m.id                                        as conversation_id,
    private.sla_state(m.fr_seconds, m.fr_target) as first_response_state,
    m.fr_seconds                                as first_response_seconds,
    m.fr_target                                 as first_response_target_seconds,
    m.agent_ts                                  as first_response_at,
    private.sla_state(m.res_seconds, m.res_target) as resolution_state,
    m.res_seconds                               as resolution_seconds,
    m.res_target                                as resolution_target_seconds
  from measured m
$$;

-- Workspace-wide breach summary ----------------------------------------------
--
-- "Currently in breach" means unresolved: a conversation that was closed late
-- is a historical fact, not an outstanding problem, and mixing the two would
-- make the number only ever grow. The two component counts overlap (a
-- conversation can breach both clocks), which is why breached_count is counted
-- separately rather than summed.

create or replace function public.get_sla_breach_summary()
returns table (
  breached_count          bigint,
  first_response_breached bigint,
  resolution_breached     bigint,
  unresolved_count        bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*) filter (
      where s.first_response_state = 'breached' or s.resolution_state = 'breached'
    ) as breached_count,
    count(*) filter (where s.first_response_state = 'breached') as first_response_breached,
    count(*) filter (where s.resolution_state     = 'breached') as resolution_breached,
    count(*) as unresolved_count
  from public.get_conversations_sla(null, true) s
$$;

-- Supabase grants EXECUTE on every public function to anon by default, which
-- would publish both of these at /rest/v1/rpc/. Same revoke pattern as the
-- analytics functions.
revoke all on function public.get_conversations_sla(uuid[], boolean) from public, anon;
revoke all on function public.get_sla_breach_summary()               from public, anon;

grant execute on function public.get_conversations_sla(uuid[], boolean) to authenticated;
grant execute on function public.get_sla_breach_summary()               to authenticated;
