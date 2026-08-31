-- Unit tests for private.business_seconds_between.
--
-- This function is the foundation of every SLA number the UI shows, so it is
-- tested directly with known inputs rather than inferred from the feature
-- working. Run it against any database that has migration 20260831110100:
--
--   psql "$DATABASE_URL" -f supabase/tests/business_hours.sql
--
-- It prints one row per case and raises at the end if any case failed, so it is
-- safe to wire into CI.
--
-- Reference calendar (all cases use real dates so isodow is not assumed):
--   Mon 2026-08-31  Tue 09-01  Wed 09-02  Thu 09-03  Fri 09-04
--   Sat 2026-09-05  Sun 09-06  Mon 09-07
-- Default profile: 09:00–18:00 (9h = 32400s), Mon–Fri, Asia/Kolkata (UTC+5:30,
-- no DST).

\set ON_ERROR_STOP on

-- Guard against the reference calendar being wrong, which would invalidate
-- every expectation below.
do $$
begin
  if extract(isodow from date '2026-08-31') <> 1
     or extract(isodow from date '2026-09-04') <> 5
     or extract(isodow from date '2026-09-05') <> 6
     or extract(isodow from date '2026-09-06') <> 7
     or extract(isodow from date '2026-09-07') <> 1 then
    raise exception 'reference calendar in this test file is wrong';
  end if;
end;
$$;

create temporary table business_hours_results as
with cases (id, name, start_ts, end_ts, h_start, h_end, days, tz, expected) as (
  values
    -- ── Single day, default profile ────────────────────────────────────────
    (1, 'wholly inside one business day',
     '2026-08-31 10:00+05:30'::timestamptz, '2026-08-31 11:30+05:30'::timestamptz,
     '09:00'::time, '18:00'::time, '{1,2,3,4,5}'::smallint[], 'Asia/Kolkata'::text, 5400::bigint),

    (2, 'starts before opening',
     '2026-08-31 07:00+05:30', '2026-08-31 10:00+05:30',
     '09:00', '18:00', '{1,2,3,4,5}', 'Asia/Kolkata', 3600),

    (3, 'ends after closing',
     '2026-08-31 17:00+05:30', '2026-08-31 22:00+05:30',
     '09:00', '18:00', '{1,2,3,4,5}', 'Asia/Kolkata', 3600),

    (4, 'wholly before opening',
     '2026-08-31 06:00+05:30', '2026-08-31 08:00+05:30',
     '09:00', '18:00', '{1,2,3,4,5}', 'Asia/Kolkata', 0),

    (5, 'wholly after closing',
     '2026-08-31 19:00+05:30', '2026-08-31 23:00+05:30',
     '09:00', '18:00', '{1,2,3,4,5}', 'Asia/Kolkata', 0),

    (6, 'covers a whole business day',
     '2026-08-31 00:00+05:30', '2026-08-31 23:59:59+05:30',
     '09:00', '18:00', '{1,2,3,4,5}', 'Asia/Kolkata', 32400),

    (7, 'exactly opening to closing',
     '2026-08-31 09:00+05:30', '2026-08-31 18:00+05:30',
     '09:00', '18:00', '{1,2,3,4,5}', 'Asia/Kolkata', 32400),

    (8, 'sub-minute span inside hours',
     '2026-08-31 10:00:00+05:30', '2026-08-31 10:00:30+05:30',
     '09:00', '18:00', '{1,2,3,4,5}', 'Asia/Kolkata', 30),

    -- ── Overnight and multi-day ────────────────────────────────────────────
    (9, 'overnight into the next business day',
     '2026-08-31 17:00+05:30', '2026-09-01 10:00+05:30',
     '09:00', '18:00', '{1,2,3,4,5}', 'Asia/Kolkata', 7200),

    (10, 'closing time to next opening time is zero',
     '2026-08-31 18:00+05:30', '2026-09-01 09:00+05:30',
     '09:00', '18:00', '{1,2,3,4,5}', 'Asia/Kolkata', 0),

    (11, 'five consecutive business days',
     '2026-08-31 09:00+05:30', '2026-09-04 18:00+05:30',
     '09:00', '18:00', '{1,2,3,4,5}', 'Asia/Kolkata', 162000),

    -- ── Weekends ──────────────────────────────────────────────────────────
    (12, 'spans a weekend, partial on both ends',
     '2026-09-04 17:00+05:30', '2026-09-07 10:00+05:30',
     '09:00', '18:00', '{1,2,3,4,5}', 'Asia/Kolkata', 7200),

    (13, 'wholly inside a weekend',
     '2026-09-05 09:00+05:30', '2026-09-06 18:00+05:30',
     '09:00', '18:00', '{1,2,3,4,5}', 'Asia/Kolkata', 0),

    (14, 'starts on a weekend, ends mid business day',
     '2026-09-05 12:00+05:30', '2026-09-07 12:00+05:30',
     '09:00', '18:00', '{1,2,3,4,5}', 'Asia/Kolkata', 10800),

    (15, 'full week plus the following Monday',
     '2026-08-31 09:00+05:30', '2026-09-07 18:00+05:30',
     '09:00', '18:00', '{1,2,3,4,5}', 'Asia/Kolkata', 194400),

    -- ── Degenerate spans ──────────────────────────────────────────────────
    (16, 'zero-length span',
     '2026-08-31 10:00+05:30', '2026-08-31 10:00+05:30',
     '09:00', '18:00', '{1,2,3,4,5}', 'Asia/Kolkata', 0),

    (17, 'end before start',
     '2026-08-31 12:00+05:30', '2026-08-31 10:00+05:30',
     '09:00', '18:00', '{1,2,3,4,5}', 'Asia/Kolkata', 0),

    (18, 'null start',
     null, '2026-08-31 10:00+05:30',
     '09:00', '18:00', '{1,2,3,4,5}', 'Asia/Kolkata', 0),

    (19, 'null end',
     '2026-08-31 10:00+05:30', null,
     '09:00', '18:00', '{1,2,3,4,5}', 'Asia/Kolkata', 0),

    -- ── Non-default configurations ────────────────────────────────────────
    (20, 'Saturday counts when it is a business day',
     '2026-09-05 09:00+05:30', '2026-09-05 18:00+05:30',
     '09:00', '18:00', '{1,2,3,4,5,6}', 'Asia/Kolkata', 32400),

    (21, 'narrower window clips both ends',
     '2026-08-31 09:00+05:30', '2026-08-31 18:00+05:30',
     '10:00', '16:00', '{1,2,3,4,5}', 'Asia/Kolkata', 21600),

    (22, 'seven-day week has no gaps',
     '2026-08-31 09:00+05:30', '2026-09-06 18:00+05:30',
     '09:00', '18:00', '{1,2,3,4,5,6,7}', 'Asia/Kolkata', 226800),

    (23, 'single business day per week',
     '2026-08-31 00:00+05:30', '2026-09-07 00:00+05:30',
     '09:00', '18:00', '{3}', 'Asia/Kolkata', 32400),

    (24, 'empty business days means no clock',
     '2026-08-31 09:00+05:30', '2026-09-04 18:00+05:30',
     '09:00', '18:00', '{}', 'Asia/Kolkata', 0),

    (25, 'closing not after opening means no clock',
     '2026-08-31 09:00+05:30', '2026-09-04 18:00+05:30',
     '18:00', '18:00', '{1,2,3,4,5}', 'Asia/Kolkata', 0),

    -- ── Timezone handling ─────────────────────────────────────────────────
    -- The window is local wall-clock, so the same UTC instants produce
    -- different results in different zones. 2026-08-31 09:00 UTC is 14:30 IST
    -- (inside hours) and 05:00 in New York (before hours).
    (26, 'UTC instants are interpreted in the workspace zone (Kolkata)',
     '2026-08-31 09:00+00:00', '2026-08-31 11:00+00:00',
     '09:00', '18:00', '{1,2,3,4,5}', 'Asia/Kolkata', 7200),

    (27, 'same UTC instants fall outside New York hours',
     '2026-08-31 09:00+00:00', '2026-08-31 11:00+00:00',
     '09:00', '18:00', '{1,2,3,4,5}', 'America/New_York', 0),

    -- US DST ends 2026-11-01 (a Sunday). A span from Friday through the
    -- following Monday crosses the transition. Each local business day is still
    -- 9 hours, so the answer must be exactly two of them — this is the case
    -- that fails if the implementation does its arithmetic in naive local time
    -- and lets the offset drift.
    (28, 'span crossing a DST transition does not drift',
     '2026-10-30 09:00-04:00', '2026-11-02 18:00-05:00',
     '09:00', '18:00', '{1,2,3,4,5}', 'America/New_York', 64800),

    -- The same span measured in absolute seconds is 25 hours longer than the
    -- naive local difference would suggest; this asserts the fixture itself.
    (29, 'DST fixture spans the expected wall-clock length',
     '2026-11-01 00:00-04:00', '2026-11-01 23:59:59-05:00',
     '00:00', '23:59:59', '{1,2,3,4,5,6,7}', 'America/New_York', 89999),

    -- ── A realistic first-response scenario ──────────────────────────────
    -- Customer emails Friday 17:45, agent replies Monday 09:30. Wall clock is
    -- ~64 hours; the business clock is 15 minutes on Friday plus 30 on Monday.
    (30, 'Friday evening question answered Monday morning',
     '2026-09-04 17:45+05:30', '2026-09-07 09:30+05:30',
     '09:00', '18:00', '{1,2,3,4,5}', 'Asia/Kolkata', 2700)
)
select
  c.id,
  c.name,
  c.expected,
  private.business_seconds_between(
    c.start_ts, c.end_ts, c.h_start, c.h_end, c.days, c.tz
  ) as actual
from cases c;

select
  id,
  case when expected = actual then 'PASS' else 'FAIL' end as result,
  name,
  expected,
  actual
from business_hours_results
order by id;

do $$
declare
  v_failed integer;
  v_total  integer;
begin
  select count(*) filter (where expected <> actual), count(*)
  into   v_failed, v_total
  from   business_hours_results;

  if v_failed > 0 then
    raise exception 'business_seconds_between: % of % cases failed', v_failed, v_total;
  end if;

  raise notice 'business_seconds_between: all % cases passed', v_total;
end;
$$;

drop table business_hours_results;

-- ---------------------------------------------------------------------------
-- Settings constraints
-- ---------------------------------------------------------------------------
--
-- The business-hours function trusts its inputs, so the CHECK constraints on
-- workspaces are part of its correctness story rather than separate hygiene. In
-- particular an empty business_days array would make every span measure 0 and
-- silently pin every conversation to "on track" — which is exactly what the
-- first version of the constraint allowed, because array_length returns NULL
-- (not 0) for an empty array and a NULL CHECK passes.
--
-- This probes the constraint *as deployed*, by re-applying its own definition
-- to a temporary table, so it cannot pass because the expression was retyped
-- correctly here. No row in public.workspaces is touched.

do $$
declare
  v_def    text;
  r        record;
  v_failed integer := 0;
begin
  select pg_get_constraintdef(c.oid) into v_def
  from   pg_catalog.pg_constraint c
  where  c.conname = 'workspaces_business_days_valid';

  if v_def is null then
    raise exception 'workspaces_business_days_valid does not exist on this database';
  end if;

  execute 'create temporary table bd_probe (business_days smallint[], '
       || 'constraint bd_probe_check ' || v_def || ')';

  for r in
    select *
    from (values
      ('empty week',       '{}',                false),
      ('null element',     '{1,NULL}',          false),
      ('day 0',            '{0,1,2}',           false),
      ('day 8',            '{1,8}',             false),
      ('more than seven',  '{1,1,2,2,3,3,4,4}', false),
      ('Mon-Fri',          '{1,2,3,4,5}',       true),
      ('single day',       '{3}',               true),
      ('all seven',        '{1,2,3,4,5,6,7}',   true)
    ) as t(label, days, should_pass)
  loop
    declare
      v_accepted boolean;
    begin
      begin
        execute 'insert into bd_probe values ($1)' using r.days::smallint[];
        v_accepted := true;
      exception when check_violation then
        v_accepted := false;
      end;

      if v_accepted <> r.should_pass then
        v_failed := v_failed + 1;
        raise warning 'business_days constraint: % was % but should have been %',
          r.label,
          case when v_accepted then 'accepted' else 'rejected' end,
          case when r.should_pass then 'accepted' else 'rejected' end;
      end if;
    end;
  end loop;

  drop table bd_probe;

  if v_failed > 0 then
    raise exception 'business_days constraint: % cases failed', v_failed;
  end if;

  raise notice 'business_days constraint: all cases passed';
end;
$$;
