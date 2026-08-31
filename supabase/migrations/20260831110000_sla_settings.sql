-- SLA targets and business hours, per workspace, plus the snooze bookkeeping
-- columns on conversations that the resolution clock needs.
--
-- Everything here has a default, so SLA tracking is live for every existing
-- workspace the moment this migration lands — the settings UI only changes
-- numbers that already work.
--
-- Business days are ISO day-of-week (1 = Monday … 7 = Sunday), matching
-- `extract(isodow from …)` so the business-hours function can compare without
-- translating. Stored as an array rather than seven booleans because the only
-- question ever asked of it is "is this day a working day", and `= any(...)` is
-- exactly that question.

alter table public.workspaces
  add column first_response_target_minutes integer not null default 30,
  add column resolution_target_minutes     integer not null default 1440,
  add column business_hours_start          time    not null default '09:00',
  add column business_hours_end            time    not null default '18:00',
  add column business_days                 smallint[] not null default '{1,2,3,4,5}',
  add column business_timezone             text    not null default 'Asia/Kolkata';

-- Upper bounds are not arbitrary politeness: the business-hours function walks
-- calendar days, and a target of "10 years" would make every SLA read a
-- multi-thousand-iteration loop. 60 days of first response / 2 years of
-- resolution is well past anything a support team would set.
alter table public.workspaces
  add constraint workspaces_first_response_target_range
    check (first_response_target_minutes between 1 and 86400),
  add constraint workspaces_resolution_target_range
    check (resolution_target_minutes between 1 and 1051200),
  -- Overnight windows (close before open) are deliberately unsupported: they
  -- would make a "business day" span two calendar days and double the number of
  -- cases the elapsed-seconds function has to get right. Support desks that run
  -- overnight are a different feature, not a wider constraint.
  add constraint workspaces_business_hours_order
    check (business_hours_end > business_hours_start),
  add constraint workspaces_business_days_valid
    check (
      array_length(business_days, 1) between 1 and 7
      and business_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
    );

-- A CHECK constraint cannot query pg_timezone_names (it is a view, and CHECK
-- expressions must be immutable), so the timezone is validated by a trigger
-- instead. It still belongs in the database rather than in a zod schema: an
-- unknown zone name would make every SLA read for that workspace throw, and
-- the settings form is not the only thing that can write this column.
create or replace function public.validate_workspace_business_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.business_timezone
  ) then
    raise exception 'invalid_business_timezone: %', new.business_timezone
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger workspaces_validate_business_timezone
  before insert or update of business_timezone on public.workspaces
  for each row execute function public.validate_workspace_business_timezone();

-- Snooze bookkeeping --------------------------------------------------------
--
-- total_snoozed_seconds is what the resolution clock subtracts. It is maintained
-- entirely by a trigger (next migration) rather than by the dashboard action,
-- because an inbound email can also reopen a snoozed thread and that path never
-- goes near the action.

alter table public.conversations
  add column snoozed_at            timestamptz,
  add column total_snoozed_seconds integer not null default 0;

-- Rows already sitting in 'snoozed' predate the column. updated_at is the best
-- available approximation of when they entered that state, and it is what the
-- resolved_at migration used for the same situation.
update public.conversations
set snoozed_at = updated_at
where status = 'snoozed'
  and snoozed_at is null;

alter table public.conversations
  add constraint conversations_snoozed_at_consistency check (
    (status = 'snoozed') = (snoozed_at is not null)
  ),
  add constraint conversations_total_snoozed_seconds_non_negative check (
    total_snoozed_seconds >= 0
  );
