-- Tenant isolation test. Seeds two workspaces, probes every policy as each
-- member, then removes everything it created. Raises if any check fails.
--
--   psql "$DATABASE_URL" -f supabase/tests/rls_isolation.sql
--
-- It only touches rows whose email ends in @test.local and workspaces named
-- 'RLS Test A' / 'RLS Test B', and the whole run is one transaction.

\set ON_ERROR_STOP on

begin;

-- Fixtures -------------------------------------------------------------------
-- Alice: admin of A. Carol: agent of A, joined through the invite flow.
-- Bob: admin of B.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'alice@test.local', 'x',
   now(), now(), now(), '{"provider":"email"}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'carol@test.local', 'x',
   now(), now(), now(), '{"provider":"email"}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'bob@test.local', 'x',
   now(), now(), now(), '{"provider":"email"}', '{}');

select public.create_workspace_with_admin(
  'aaaaaaaa-0000-4000-8000-000000000001', 'alice@test.local', 'RLS Test A', 'Alice');
select public.create_workspace_with_admin(
  'bbbbbbbb-0000-4000-8000-000000000001', 'bob@test.local', 'RLS Test B', 'Bob');

insert into public.workspace_invites (workspace_id, email, role, token, invited_by)
select p.workspace_id, 'carol@test.local', 'agent', 'rls-test-token-carol', p.id
from public.profiles p where p.email = 'alice@test.local';

select public.accept_workspace_invite(
  'cccccccc-0000-4000-8000-000000000001', 'carol@test.local', 'rls-test-token-carol', 'Carol');

-- Every seed below is scoped through this table. An earlier version of this
-- file read `from public.workspaces` unqualified, which meant running it
-- against a database that already had real workspaces seeded a contact, a
-- conversation, a message and two KB categories into each of them. The
-- teardown only removes the test workspaces, so the strays survived. Fixtures
-- get an explicit allowlist of workspaces, never "all of them".
create temp table rls_test_ws on commit drop as
select id from public.workspaces where name in ('RLS Test A', 'RLS Test B');

insert into public.contacts (workspace_id, email)
select w.id, 'visitor-' || replace(lower(w.name), ' ', '-') || '@test.local'
from public.workspaces w
join rls_test_ws t on t.id = w.id;

insert into public.conversations (workspace_id, contact_id, channel)
select c.workspace_id, c.id, 'chat'
from public.contacts c
join rls_test_ws t on t.id = c.workspace_id;

insert into public.messages (workspace_id, conversation_id, sender_type, sender_id, body)
select c.workspace_id, c.id, 'contact', c.contact_id, 'hello there'
from public.conversations c
join rls_test_ws t on t.id = c.workspace_id;

insert into public.kb_categories (workspace_id, name)
select t.id, 'General' from rls_test_ws t;

insert into public.kb_articles (workspace_id, category_id, title, body, published)
select c.workspace_id, c.id, 'Getting started',
       '<p>Reset your <strong>password</strong> here.</p>', true
from public.kb_categories c
join rls_test_ws t on t.id = c.workspace_id
where c.name = 'General';

-- A draft in a category of its own. The anon probes assert that neither the
-- draft nor the category holding it is visible to a public visitor: a category
-- name can be as sensitive as the article inside it.
insert into public.kb_categories (workspace_id, name)
select t.id, 'Internal' from rls_test_ws t;

insert into public.kb_articles (workspace_id, category_id, title, body, published)
select c.workspace_id, c.id, 'Internal runbook', '<p>Secret escalation steps.</p>', false
from public.kb_categories c
join rls_test_ws t on t.id = c.workspace_id
where c.name = 'Internal';

-- Probe ----------------------------------------------------------------------
-- The migration owner bypasses RLS, so the only way to exercise the policies is
-- to run as `authenticated` with a JWT claim. That is a function-level SET
-- rather than a SET LOCAL in the body, so Postgres restores the previous role
-- on exit instead of leaking it into the rest of the transaction.
--
-- Row ids are resolved by the caller, which still has full visibility. Doing it
-- inside the function would silently return null once RLS is in effect.

create function pg_temp.rls_probe(
  p_user uuid,
  p_own uuid,
  p_other uuid,
  p_other_contact uuid,
  p_other_conversation uuid,
  p_expected_invites int
)
returns table (scenario text, passed boolean, detail text)
language plpgsql
set role = 'authenticated'
as $$
declare
  n int;
begin
  perform set_config(
    'request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);

  select count(*) into n from public.workspaces;
  return query select 'sees exactly 1 workspace', n = 1, n::text;

  select count(*) into n from public.workspaces where id = p_other;
  return query select 'cannot read other workspace row', n = 0, n::text;

  select count(*) into n from public.profiles where workspace_id = p_other;
  return query select 'cannot read other workspace profiles', n = 0, n::text;

  select count(*) into n from public.contacts where workspace_id = p_other;
  return query select 'cannot read other workspace contacts', n = 0, n::text;

  select count(*) into n from public.conversations where workspace_id = p_other;
  return query select 'cannot read other workspace conversations', n = 0, n::text;

  select count(*) into n from public.messages where workspace_id = p_other;
  return query select 'cannot read other workspace messages', n = 0, n::text;

  select count(*) into n from public.kb_categories where workspace_id = p_other;
  return query select 'cannot read other workspace kb_categories', n = 0, n::text;

  select count(*) into n from public.kb_articles where workspace_id = p_other;
  return query select 'cannot read other workspace kb_articles', n = 0, n::text;

  -- A team member sees drafts as well as published articles; that is the whole
  -- point of the authenticated policy, and what the anon policy must not do.
  select count(*) into n from public.kb_articles where workspace_id = p_own;
  return query select 'can read own drafts and published articles', n = 2, n::text;

  update public.kb_articles set published = true where workspace_id = p_other;
  get diagnostics n = row_count;
  return query select 'cannot publish another workspace article', n = 0, n::text;

  begin
    insert into public.kb_articles (workspace_id, title, body, published)
    values (p_own, 'Agent-authored article', '<p>ok</p>', true);
    delete from public.kb_articles where title = 'Agent-authored article';
    return query select 'any team member can author and publish', true, 'ok';
  exception when others then
    return query select 'any team member can author and publish', false, left(sqlerrm, 60);
  end;

  begin
    insert into public.kb_categories (workspace_id, name) values (p_other, 'Injected');
    return query select 'cannot create category in other workspace', false, 'insert succeeded';
  exception when others then
    return query select 'cannot create category in other workspace', true, left(sqlerrm, 60);
  end;

  select count(*) into n from public.contacts where workspace_id = p_own;
  return query select 'can read own workspace contacts', n = 1, n::text;

  select count(*) into n from public.workspace_invites;
  return query select 'invites visible only to admins', n = p_expected_invites, n::text;

  begin
    insert into public.contacts (workspace_id, email) values (p_other, 'evil@test.local');
    return query select 'insert into other workspace blocked', false, 'insert succeeded';
  exception when others then
    return query select 'insert into other workspace blocked', true, left(sqlerrm, 60);
  end;

  update public.contacts set email = 'hacked@test.local' where id = p_other_contact;
  get diagnostics n = row_count;
  return query select 'update other workspace contact affects 0 rows', n = 0, n::text;

  delete from public.conversations where id = p_other_conversation;
  get diagnostics n = row_count;
  return query select 'delete other workspace conversation affects 0 rows', n = 0, n::text;

  begin
    insert into public.contacts (workspace_id, email) values (p_own, 'ok@test.local');
    delete from public.contacts where email = 'ok@test.local';
    return query select 'insert into own workspace allowed', true, 'ok';
  exception when others then
    return query select 'insert into own workspace allowed', false, left(sqlerrm, 60);
  end;

  begin
    update public.profiles set role = 'admin' where auth_user_id = p_user;
    return query select 'self role escalation blocked', false, 'update succeeded';
  exception when others then
    return query select 'self role escalation blocked', true, left(sqlerrm, 60);
  end;

  begin
    update public.profiles set full_name = 'Renamed' where auth_user_id = p_user;
    return query select 'can rename self', true, 'ok';
  exception when others then
    return query select 'can rename self', false, left(sqlerrm, 60);
  end;

  begin
    perform public.create_workspace_with_admin(p_user, 'x@test.local', 'Hijacked');
    return query select 'create_workspace_with_admin denied', false, 'call succeeded';
  exception when others then
    return query select 'create_workspace_with_admin denied', true, left(sqlerrm, 60);
  end;

  begin
    perform public.accept_workspace_invite(p_user, 'carol@test.local', 'rls-test-token-carol');
    return query select 'accept_workspace_invite denied', false, 'call succeeded';
  exception when others then
    return query select 'accept_workspace_invite denied', true, left(sqlerrm, 60);
  end;
end;
$$;

-- Public help centre probe ---------------------------------------------------
-- The one access pattern in the schema that is not keyed off auth.uid(). An
-- anonymous visitor has no uid, so this cannot be folded into the probe above:
-- it runs as `anon` with no JWT claims at all.
--
-- Both gates are checked. The row policies decide which rows come back; the
-- column grants decide whether a column is readable at all, and the two failure
-- modes look different (empty result vs. insufficient_privilege), so each needs
-- its own assertion.

create function pg_temp.anon_kb_probe(p_workspace uuid)
returns table (scenario text, passed boolean, detail text)
language plpgsql
set role = 'anon'
as $$
declare
  n int;
begin
  -- The probe above set request.jwt.claims transaction-locally, so it is still
  -- set here. Clearing it is what makes this a genuine anonymous request.
  perform set_config('request.jwt.claims', '', true);

  select count(*) into n from public.kb_articles where workspace_id = p_workspace;
  return query select 'anon sees only the published article', n = 1, n::text;

  select count(*) into n from public.kb_articles where not published;
  return query select 'anon sees no drafts in any workspace', n = 0, n::text;

  select count(*) into n from public.kb_categories where workspace_id = p_workspace;
  return query select 'anon sees only categories holding published work', n = 1, n::text;

  select count(*) into n
  from public.kb_categories where workspace_id = p_workspace and name = 'Internal';
  return query select 'anon cannot see the draft-only category', n = 0, n::text;

  select count(*) into n from public.workspaces where id = p_workspace;
  return query select 'anon can resolve a workspace with published articles', n = 1, n::text;

  select count(*) into n from public.search_kb_articles(p_workspace, 'runbook', 5);
  return query select 'anon search cannot surface a draft', n = 0, n::text;

  select count(*) into n from public.search_kb_articles(p_workspace, 'passw', 5);
  return query select 'anon search matches a published article by prefix', n = 1, n::text;

  select count(*) into n from public.search_kb_articles(p_workspace, '& | ! <-> ((', 5);
  return query select 'anon search survives tsquery metacharacters', n = 0, n::text;

  begin
    execute 'select inbound_token from public.workspaces limit 1';
    return query select 'anon cannot read workspaces.inbound_token', false, 'select succeeded';
  exception when insufficient_privilege then
    return query select 'anon cannot read workspaces.inbound_token', true, 'denied';
  end;

  begin
    execute 'select allowed_widget_domains from public.workspaces limit 1';
    return query select 'anon cannot read allowed_widget_domains', false, 'select succeeded';
  exception when insufficient_privilege then
    return query select 'anon cannot read allowed_widget_domains', true, 'denied';
  end;

  begin
    execute 'update public.kb_articles set published = true where not published';
    return query select 'anon cannot publish an article', false, 'update succeeded';
  exception when insufficient_privilege then
    return query select 'anon cannot publish an article', true, 'denied';
  end;

  begin
    execute 'select count(*) from public.conversations';
    return query select 'anon cannot read conversations', false, 'select succeeded';
  exception when insufficient_privilege then
    return query select 'anon cannot read conversations', true, 'denied';
  end;

  begin
    execute 'select count(*) from public.profiles';
    return query select 'anon cannot read profiles', false, 'select succeeded';
  exception when insufficient_privilege then
    return query select 'anon cannot read profiles', true, 'denied';
  end;
end;
$$;

create temp table rls_results (who text, scenario text, passed boolean, detail text)
  on commit drop;

create temp table rls_actors on commit drop as
select
  p.auth_user_id,
  p.email || ' (' || p.role || ' of ' || w.name || ')' as who,
  p.workspace_id as own_id,
  o.id as other_id,
  (select c.id from public.contacts c where c.workspace_id = o.id limit 1) as other_contact,
  (select c.id from public.conversations c where c.workspace_id = o.id limit 1) as other_conversation,
  case when p.role = 'admin'
    then (select count(*)::int from public.workspace_invites i where i.workspace_id = p.workspace_id)
    else 0
  end as expected_invites
from public.profiles p
join public.workspaces w on w.id = p.workspace_id
join public.workspaces o on o.id <> p.workspace_id and o.name in ('RLS Test A', 'RLS Test B')
where p.email like '%@test.local';

do $$
declare
  actor record;
begin
  for actor in select * from rls_actors loop
    insert into rls_results
    select actor.who, *
    from pg_temp.rls_probe(
      actor.auth_user_id, actor.own_id, actor.other_id,
      actor.other_contact, actor.other_conversation, actor.expected_invites);
  end loop;
end;
$$;

do $$
declare
  ws record;
begin
  for ws in
    select id, name from public.workspaces where name in ('RLS Test A', 'RLS Test B')
  loop
    insert into rls_results
    select 'anonymous visitor of ' || ws.name, *
    from pg_temp.anon_kb_probe(ws.id);
  end loop;
end;
$$;

select who, scenario, passed, detail from rls_results order by who, scenario;

do $$
declare
  v_failed int;
  v_total int;
begin
  select count(*) filter (where not passed), count(*) into v_failed, v_total from rls_results;
  if v_total = 0 then
    raise exception 'RLS isolation test: probe produced no results';
  end if;
  if v_failed > 0 then
    raise exception 'RLS isolation test: % of % checks failed', v_failed, v_total;
  end if;
  raise notice 'RLS isolation test: all % checks passed', v_total;
end;
$$;

-- Teardown -------------------------------------------------------------------

delete from public.workspaces where name in ('RLS Test A', 'RLS Test B');
delete from auth.users where email like '%@test.local';

commit;
