-- Analytics aggregate functions.
--
-- All four are SECURITY INVOKER so the caller's RLS context applies: each
-- authenticated user only sees rows from their own workspace.  No explicit
-- workspace_id parameter is needed because the policies on messages,
-- conversations, and profiles already scope every scan to the calling user's
-- workspace.
--
-- All functions are pure SQL (language sql) and STABLE — they cannot modify
-- data and their result depends only on the current row state.  search_path
-- is locked to '' and all table references are fully qualified.
--
-- Performance caveat (documented in the UI): these are on-the-fly queries
-- with no pre-aggregate layer.  For workspaces in the thousands-of-conversations
-- range the first-response and agent-stats queries in particular will benefit
-- from a materialized summary table or a scheduled refresh job.  Out of scope
-- for this build.

-- First-response time ---------------------------------------------------------
--
-- For each conversation that has at least one contact message AND at least one
-- agent reply that arrived AFTER the first contact message, this measures
-- how long the agent took.  Simplification (shown in the UI): no adjustment
-- for snoozed time; no per-reopen recalculation.  This is the first-ever
-- agent reply vs the first-ever contact message, across all time.

create or replace function public.get_analytics_first_response()
returns table (
  avg_seconds    numeric,
  median_seconds numeric,
  p95_seconds    numeric,
  measured_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with first_contacts as (
    select conversation_id, min(created_at) as ts
    from   public.messages
    where  sender_type = 'contact'
    group  by conversation_id
  ),
  first_agents as (
    select conversation_id, min(created_at) as ts
    from   public.messages
    where  sender_type = 'agent'
    group  by conversation_id
  ),
  gaps as (
    select extract(epoch from (a.ts - c.ts)) as secs
    from   first_contacts c
    join   first_agents   a using (conversation_id)
    where  a.ts > c.ts
  )
  select
    round(avg(secs)::numeric, 0)                                              as avg_seconds,
    round(percentile_cont(0.5)  within group (order by secs)::numeric, 0)    as median_seconds,
    round(percentile_cont(0.95) within group (order by secs)::numeric, 0)    as p95_seconds,
    count(*)                                                                  as measured_count
  from gaps
$$;

-- Resolution rate -------------------------------------------------------------
--
-- Resolved conversations / total conversations, all-time.
-- No date range filter — deferred per spec.

create or replace function public.get_analytics_resolution_rate()
returns table (
  resolved_count bigint,
  total_count    bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*) filter (where status = 'resolved') as resolved_count,
    count(*)                                    as total_count
  from public.conversations
$$;

-- Busiest hours ---------------------------------------------------------------
--
-- Message volume grouped by hour-of-day (UTC 0–23), both channels combined.
-- Only hours that have at least one message are returned; the caller fills in
-- zeroes for the rest so the bar chart always spans the full 24-hour range.
-- Hours are in UTC; a timezone offset is documented in the UI.

create or replace function public.get_analytics_busiest_hours()
returns table (
  hour          integer,
  message_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    extract(hour from created_at at time zone 'UTC')::integer as hour,
    count(*)                                                   as message_count
  from   public.messages
  group  by 1
  order  by 1
$$;

-- Per-agent breakdown ---------------------------------------------------------
--
-- For every profile in the workspace:
--   • conversations_resolved — distinct resolved conversations assigned to them
--   • avg_first_response_secs — average seconds from first contact message to
--     first agent reply, for conversations assigned to them (null when none)
--
-- Two sub-aggregates (agent_resolved, agent_response) are pre-computed before
-- the final join so that the profile LEFT JOINs are always 1:1 — no cartesian
-- product when an agent has multiple conversations.

create or replace function public.get_analytics_agent_stats()
returns table (
  agent_id                uuid,
  full_name               text,
  agent_email             text,
  conversations_resolved  bigint,
  avg_first_response_secs numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with first_contacts as (
    select conversation_id, min(created_at) as ts
    from   public.messages
    where  sender_type = 'contact'
    group  by conversation_id
  ),
  first_agents as (
    select conversation_id, min(created_at) as ts
    from   public.messages
    where  sender_type = 'agent'
    group  by conversation_id
  ),
  response_gaps as (
    select
      c.assigned_agent_id,
      extract(epoch from (fa.ts - fc.ts)) as secs
    from   public.conversations c
    join   first_contacts fc on fc.conversation_id = c.id
    join   first_agents   fa on fa.conversation_id = c.id
    where  fa.ts > fc.ts
      and  c.assigned_agent_id is not null
  ),
  -- Pre-aggregate resolved counts per agent (one row per agent)
  agent_resolved as (
    select assigned_agent_id, count(distinct id) as cnt
    from   public.conversations
    where  status             = 'resolved'
      and  assigned_agent_id is not null
    group  by assigned_agent_id
  ),
  -- Pre-aggregate avg response time per agent (one row per agent)
  agent_response as (
    select
      assigned_agent_id,
      round(avg(secs)::numeric, 0) as avg_secs
    from   response_gaps
    group  by assigned_agent_id
  )
  select
    p.id                                     as agent_id,
    p.full_name,
    p.email                                  as agent_email,
    coalesce(ar.cnt, 0)::bigint              as conversations_resolved,
    resp.avg_secs                            as avg_first_response_secs
  from        public.profiles p
  left join   agent_resolved  ar   on ar.assigned_agent_id   = p.id
  left join   agent_response  resp on resp.assigned_agent_id = p.id
  order by conversations_resolved desc nulls last,
           p.full_name              asc  nulls last
$$;

-- Supabase's default privileges grant EXECUTE on every public function to anon,
-- which would publish all four at /rest/v1/rpc/. Analytics is dashboard-only, so
-- anon is revoked explicitly rather than being left to fail on the missing table
-- grants underneath. Same pattern as the bootstrap functions in 000200.
revoke all on function public.get_analytics_first_response()  from public, anon;
revoke all on function public.get_analytics_resolution_rate() from public, anon;
revoke all on function public.get_analytics_busiest_hours()   from public, anon;
revoke all on function public.get_analytics_agent_stats()     from public, anon;

grant execute on function public.get_analytics_first_response()  to authenticated;
grant execute on function public.get_analytics_resolution_rate() to authenticated;
grant execute on function public.get_analytics_busiest_hours()   to authenticated;
grant execute on function public.get_analytics_agent_stats()     to authenticated;
