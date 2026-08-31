-- Elapsed BUSINESS seconds between two instants.
--
-- This is the load-bearing piece of SLA tracking: every state the UI shows is
-- derived from it, so it is written to be obviously correct rather than clever.
--
-- The algorithm walks calendar days in the workspace's own timezone. For each
-- working day it materialises that day's window as two absolute instants and
-- adds the overlap with [p_start, p_end]. Every case the spec calls out falls
-- out of the overlap arithmetic without a special branch:
--
--   • start outside hours  → the first day's overlap begins at v_open
--   • end outside hours    → the last day's overlap ends at v_close
--   • spans a weekend      → non-working days contribute nothing
--   • spans many days      → each day contributes its own window
--   • entirely outside     → every overlap is empty, result 0
--
-- Anchoring each window to local wall-clock time and converting it back to
-- timestamptz per day (rather than doing the arithmetic in naive local time) is
-- what makes it DST-correct: a day that gains or loses an hour produces a
-- window of the real length, and no later day is shifted. Asia/Kolkata, the
-- default, has no DST — this matters for the workspaces that change it.
--
-- Lives in `private` because Supabase grants EXECUTE on every public function to
-- anon and authenticated, which would publish it at /rest/v1/rpc/. Nothing
-- outside the SLA functions has any business calling it.
--
-- Cost: O(calendar days in the span). Fine for conversation-sized spans; the
-- reason the target columns have upper bounds and the breach summary only scans
-- unresolved conversations.

create or replace function private.business_seconds_between(
  p_start       timestamptz,
  p_end         timestamptz,
  p_hours_start time,
  p_hours_end   time,
  p_days        smallint[],
  p_timezone    text
)
returns bigint
language plpgsql
stable
set search_path = ''
as $$
declare
  v_day      date;
  v_last_day date;
  v_open     timestamptz;
  v_close    timestamptz;
  v_from     timestamptz;
  v_to       timestamptz;
  v_total    numeric := 0;
begin
  -- A backwards or zero-length span is 0, not an error: callers pass
  -- (first_contact_message, now()) and clock skew must not make the inbox throw.
  if p_start is null or p_end is null or p_end <= p_start then
    return 0;
  end if;

  -- Degenerate configurations produce 0 rather than an exception. The CHECK
  -- constraints on workspaces already make these unreachable through any write
  -- path; this is the belt to that braces.
  if p_days is null or array_length(p_days, 1) is null then
    return 0;
  end if;
  if p_hours_start is null or p_hours_end is null or p_hours_end <= p_hours_start then
    return 0;
  end if;
  if p_timezone is null then
    return 0;
  end if;

  v_day      := (p_start at time zone p_timezone)::date;
  v_last_day := (p_end   at time zone p_timezone)::date;

  -- The loop can start at the local date of p_start because a window can never
  -- cross midnight (business_hours_end > business_hours_start is enforced), so
  -- no earlier day's window can reach into the span.
  while v_day <= v_last_day loop
    if extract(isodow from v_day)::smallint = any (p_days) then
      v_open  := (v_day + p_hours_start) at time zone p_timezone;
      v_close := (v_day + p_hours_end)   at time zone p_timezone;

      v_from := greatest(v_open,  p_start);
      v_to   := least   (v_close, p_end);

      if v_to > v_from then
        v_total := v_total + extract(epoch from (v_to - v_from));
      end if;
    end if;

    v_day := v_day + 1;
  end loop;

  return floor(v_total)::bigint;
end;
$$;

-- Convenience wrapper for callers that have a workspace id but not its settings
-- (the snooze trigger). SECURITY DEFINER so a policy change can never turn
-- "settings not visible" into a silent 0 — a wrong SLA number is worse than an
-- error. Safe because it is unreachable over REST and returns a duration, not
-- the settings themselves.
create or replace function private.workspace_business_seconds(
  p_workspace_id uuid,
  p_start        timestamptz,
  p_end          timestamptz
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select private.business_seconds_between(
    p_start,
    p_end,
    w.business_hours_start,
    w.business_hours_end,
    w.business_days,
    w.business_timezone
  )
  from public.workspaces w
  where w.id = p_workspace_id
$$;

-- Classifies an elapsed/target pair. 'approaching' is the final 20% of the
-- window, inclusive of the boundary; anything strictly over target is breached.
-- Immutable and pure so the planner can inline it.
create or replace function private.sla_state(
  p_elapsed_seconds bigint,
  p_target_seconds  bigint
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_elapsed_seconds is null or p_target_seconds is null or p_target_seconds <= 0
      then null
    when p_elapsed_seconds > p_target_seconds                 then 'breached'
    when p_elapsed_seconds >= (p_target_seconds::numeric * 0.8) then 'approaching'
    else 'on_track'
  end
$$;

revoke all on function private.business_seconds_between(timestamptz, timestamptz, time, time, smallint[], text) from public;
revoke all on function private.workspace_business_seconds(uuid, timestamptz, timestamptz) from public;
revoke all on function private.sla_state(bigint, bigint) from public;

grant execute on function private.business_seconds_between(timestamptz, timestamptz, time, time, smallint[], text) to authenticated, service_role;
grant execute on function private.workspace_business_seconds(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function private.sla_state(bigint, bigint) to authenticated, service_role;
