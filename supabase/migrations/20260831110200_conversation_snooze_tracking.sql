-- Snooze accounting, owned by the database.
--
-- Same shape as conversations_sync_resolved_at: entering 'snoozed' stamps
-- snoozed_at, leaving it banks the elapsed time into total_snoozed_seconds and
-- clears the stamp. The check constraint from the previous migration keeps the
-- invariant (snoozed_at non-null iff status = 'snoozed'); this trigger is what
-- maintains it.
--
-- It has to be a trigger rather than app code because the dashboard action is
-- not the only writer: the Postmark inbound webhook reopens a snoozed thread
-- when the customer replies, and a future auto-resurface job would be a third
-- path. Any of them forgetting to bank the snooze would silently inflate the
-- resolution clock.
--
-- Deliberate deviation from a literal reading of "add the elapsed seconds":
-- the banked value is elapsed *business* seconds, not wall-clock. The
-- resolution SLA measures a business-hours span and then subtracts this column,
-- so the two have to be the same unit. Wall-clock would over-credit badly — a
-- thread snoozed Friday 17:00 and reopened Monday 09:00 accrues ~64 wall-clock
-- hours but only ~1 business hour, and subtracting 64 hours would wipe out the
-- entire clock and hide a real breach. It also means a snooze is credited using
-- the business hours in force when it ended, which is the right answer when an
-- admin changes the schedule.

create or replace function public.sync_conversation_snooze()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'snoozed' then
      if new.snoozed_at is null then
        new.snoozed_at := now();
      end if;
    else
      -- A row inserted as open/resolved must not carry a stamp, or the check
      -- constraint rejects it. Nothing creates conversations snoozed today; this
      -- keeps the invariant true if something ever does.
      new.snoozed_at := null;
    end if;
    return new;
  end if;

  if new.status = 'snoozed' and old.status is distinct from 'snoozed' then
    new.snoozed_at := now();

  elsif new.status is distinct from 'snoozed' and old.status = 'snoozed' then
    -- coalesce on the function result because a workspace row that has somehow
    -- gone missing must not turn the whole column null and fail the constraint.
    new.total_snoozed_seconds := coalesce(old.total_snoozed_seconds, 0)
      + coalesce(
          private.workspace_business_seconds(new.workspace_id, old.snoozed_at, now()),
          0
        );
    new.snoozed_at := null;
  end if;

  return new;
end;
$$;

-- Fires after conversations_sync_resolved_at (alphabetical order within the
-- same timing). The two touch disjoint columns, so the order does not matter,
-- but it is stable and worth knowing.
create trigger conversations_sync_snooze
  before insert or update of status on public.conversations
  for each row execute function public.sync_conversation_snooze();
