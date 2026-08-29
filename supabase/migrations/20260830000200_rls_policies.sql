-- Tenant isolation.
--
-- Every policy resolves the caller's workspace through private.current_workspace_id().
-- That helper is SECURITY DEFINER for two reasons: it must read public.profiles
-- without triggering the profiles policy that calls it (infinite recursion), and
-- it keeps the lookup off the JWT, so a role change takes effect on the next
-- request instead of the next token refresh.
--
-- It lives in `private` rather than `public` because Supabase's default
-- privileges grant EXECUTE on every public function to anon and authenticated,
-- which would publish it at /rest/v1/rpc/. PostgREST only exposes `public`, so a
-- private function is reachable from RLS but not from the network.
--
-- Policies call it as `(select private.current_workspace_id())` so the planner
-- hoists it into an InitPlan and evaluates it once per statement, not per row.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select workspace_id from public.profiles where auth_user_id = (select auth.uid())
$$;

create or replace function private.current_profile_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where auth_user_id = (select auth.uid())
$$;

revoke all on function private.current_workspace_id() from public;
revoke all on function private.current_profile_role() from public;
grant execute on function private.current_workspace_id() to authenticated, service_role;
grant execute on function private.current_profile_role() to authenticated, service_role;

-- Privileged bootstrap routines ---------------------------------------------
--
-- These two operations write rows the caller has no policy for (you cannot be
-- inside a workspace before you join it), so they run SECURITY DEFINER. They
-- must stay in `public` to be callable over RPC, so EXECUTE is revoked from
-- anon and authenticated and granted to service_role alone: only a server
-- action holding SUPABASE_SERVICE_ROLE_KEY can invoke them.
--
-- Each does its multi-table write in a single statement, so signup and invite
-- acceptance are atomic rather than leaving an orphaned workspace behind on
-- partial failure.

create or replace function public.create_workspace_with_admin(
  p_auth_user_id uuid,
  p_email text,
  p_workspace_name text,
  p_full_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  if exists (select 1 from public.profiles where auth_user_id = p_auth_user_id) then
    raise exception 'profile_already_exists';
  end if;

  insert into public.workspaces (name)
  values (btrim(p_workspace_name))
  returning id into v_workspace_id;

  insert into public.profiles (auth_user_id, workspace_id, role, email, full_name)
  values (
    p_auth_user_id,
    v_workspace_id,
    'admin',
    lower(btrim(p_email)),
    nullif(btrim(coalesce(p_full_name, '')), '')
  );

  return v_workspace_id;
end;
$$;

create or replace function public.accept_workspace_invite(
  p_auth_user_id uuid,
  p_email text,
  p_token text,
  p_full_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.workspace_invites;
  v_existing_workspace_id uuid;
begin
  select * into v_invite
  from public.workspace_invites
  where token = p_token
  for update;

  if not found then
    raise exception 'invite_not_found';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'invite_already_accepted';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'invite_expired';
  end if;
  if lower(v_invite.email) is distinct from lower(btrim(p_email)) then
    raise exception 'invite_email_mismatch';
  end if;

  select workspace_id into v_existing_workspace_id
  from public.profiles
  where auth_user_id = p_auth_user_id;

  if found then
    -- Re-clicking a link from inside the workspace is a no-op, but a member of
    -- a different workspace must not be silently moved.
    if v_existing_workspace_id is distinct from v_invite.workspace_id then
      raise exception 'already_in_another_workspace';
    end if;
  else
    insert into public.profiles (auth_user_id, workspace_id, role, email, full_name)
    values (
      p_auth_user_id,
      v_invite.workspace_id,
      v_invite.role,
      lower(btrim(p_email)),
      nullif(btrim(coalesce(p_full_name, '')), '')
    );
  end if;

  update public.workspace_invites set accepted_at = now() where id = v_invite.id;
  return v_invite.workspace_id;
end;
$$;

revoke all on function public.create_workspace_with_admin(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.accept_workspace_invite(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_workspace_with_admin(uuid, text, text, text) to service_role;
grant execute on function public.accept_workspace_invite(uuid, text, text, text) to service_role;

-- Enable RLS ----------------------------------------------------------------

alter table public.workspaces        enable row level security;
alter table public.profiles          enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.contacts          enable row level security;
alter table public.conversations     enable row level security;
alter table public.messages          enable row level security;
alter table public.kb_categories     enable row level security;
alter table public.kb_articles       enable row level security;

-- Nothing here is reachable by unauthenticated callers. The widget and the
-- public KB will read through server routes in later phases, so `anon` never
-- needs a direct grant. Belt and braces on top of RLS default-deny.
revoke all on public.workspaces, public.profiles, public.workspace_invites,
  public.contacts, public.conversations, public.messages,
  public.kb_categories, public.kb_articles
from anon;

-- workspaces ----------------------------------------------------------------
-- Rows are created only by create_workspace_with_admin, so there is no INSERT
-- or DELETE policy; RLS denies both by default.

create policy workspaces_select on public.workspaces
  for select to authenticated
  using (id = (select private.current_workspace_id()));

create policy workspaces_update_admin on public.workspaces
  for update to authenticated
  using (id = (select private.current_workspace_id())
         and (select private.current_profile_role()) = 'admin')
  with check (id = (select private.current_workspace_id())
              and (select private.current_profile_role()) = 'admin');

-- profiles ------------------------------------------------------------------
-- RLS cannot see the OLD row in a WITH CHECK, so a self-update policy alone
-- would let an agent promote itself to admin. Column privileges close that:
-- authenticated may only ever write full_name. Role assignment happens at
-- invite time, through the service-role functions above.

revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

create policy profiles_select on public.profiles
  for select to authenticated
  using (workspace_id = (select private.current_workspace_id()));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

create policy profiles_delete_admin on public.profiles
  for delete to authenticated
  using (workspace_id = (select private.current_workspace_id())
         and (select private.current_profile_role()) = 'admin'
         -- An admin removing itself could orphan the workspace.
         and auth_user_id <> (select auth.uid()));

-- workspace_invites ---------------------------------------------------------
-- Admin-only, including SELECT: the token is a bearer credential and must not
-- be readable by agents. The invitee reads their own invite through a
-- service-role query on the public accept page, before they have a profile.

create policy workspace_invites_admin_all on public.workspace_invites
  for all to authenticated
  using (workspace_id = (select private.current_workspace_id())
         and (select private.current_profile_role()) = 'admin')
  with check (workspace_id = (select private.current_workspace_id())
              and (select private.current_profile_role()) = 'admin');

-- Tenant data ---------------------------------------------------------------
-- Admins and agents have the same data access; the role only gates workspace
-- and team administration. Each policy is a plain column comparison because
-- workspace_id is denormalised onto every table.

create policy contacts_workspace_all on public.contacts
  for all to authenticated
  using (workspace_id = (select private.current_workspace_id()))
  with check (workspace_id = (select private.current_workspace_id()));

create policy conversations_workspace_all on public.conversations
  for all to authenticated
  using (workspace_id = (select private.current_workspace_id()))
  with check (workspace_id = (select private.current_workspace_id()));

create policy messages_workspace_all on public.messages
  for all to authenticated
  using (workspace_id = (select private.current_workspace_id()))
  with check (workspace_id = (select private.current_workspace_id()));

create policy kb_categories_workspace_all on public.kb_categories
  for all to authenticated
  using (workspace_id = (select private.current_workspace_id()))
  with check (workspace_id = (select private.current_workspace_id()));

create policy kb_articles_workspace_all on public.kb_articles
  for all to authenticated
  using (workspace_id = (select private.current_workspace_id()))
  with check (workspace_id = (select private.current_workspace_id()));
