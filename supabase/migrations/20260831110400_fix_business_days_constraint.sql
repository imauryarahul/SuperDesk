-- Fixes a hole in workspaces_business_days_valid.
--
-- The original constraint used `array_length(business_days, 1) between 1 and 7`.
-- array_length returns NULL rather than 0 for an empty array, NULL BETWEEN is
-- NULL, and a CHECK constraint treats NULL as satisfied — so `business_days =
-- '{}'` was accepted. That is not a cosmetic problem: an empty week makes
-- business_seconds_between return 0 for every span, which silently pins every
-- conversation in the workspace to "on track" forever.
--
-- Caught by probing the constraint directly rather than by trusting that the
-- expression read correctly. cardinality() returns 0 for an empty array, which
-- is the behaviour the expression assumed all along.

alter table public.workspaces
  drop constraint workspaces_business_days_valid;

alter table public.workspaces
  add constraint workspaces_business_days_valid
    check (
      cardinality(business_days) between 1 and 7
      and business_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
      -- A NULL element would be rejected by <@ anyway (array containment is
      -- equality-based and NULL never equals anything), but saying so is
      -- cheaper than making the next reader work it out.
      and array_position(business_days, null) is null
    );
