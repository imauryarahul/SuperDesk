-- One admin per workspace: the person who created it.
--
-- create_workspace_with_admin already mints exactly one admin at signup, and
-- every later member arrives through an invite, so constraining the invite role
-- and the profile role together is enough to pin the invariant.
--
-- Both halves live here rather than in the settings action because
-- workspace_invites_admin_all is `for all to authenticated`, which lets an
-- admin INSERT an invite row straight over PostgREST. The server action is the
-- error message; these are the gate.

-- The invariant. Partial, so agents stay unconstrained and only the admin slot
-- is unique. A second admin in the same workspace is rejected by the database
-- no matter which code path attempts it.
create unique index profiles_one_admin_per_workspace
  on public.profiles (workspace_id)
  where role = 'admin';

-- Stops an admin invite existing in the first place. Without it the index above
-- would still hold, but the failure would surface at accept time, to the
-- invitee — the one person who can do nothing about it.
alter table public.workspace_invites
  add constraint workspace_invites_role_agent_only
  check (role = 'agent');
