-- Custom domains for the public knowledge base.
--
-- workspaces.custom_domain has existed since the initial schema. What was
-- missing is the only thing that makes it safe to route on. A domain a
-- workspace has merely *claimed* must never resolve to that workspace's help
-- centre: otherwise anyone could type a hostname they do not own into settings
-- and have our edge serve their content the moment that hostname happens to
-- point at us. custom_domain_status is that gate, and the routing layer in
-- lib/custom-domain-routing.ts treats 'verified' as the sole serving condition.
--
--   none     — no domain claimed
--   pending  — added to the Vercel project, DNS not yet detected
--   verified — Vercel confirmed ownership; safe to serve, SSL is provisioned
--   error    — Vercel reported the domain as unusable (taken, misconfigured)

create type public.custom_domain_status as enum ('none', 'pending', 'verified', 'error');

alter table public.workspaces
  add column custom_domain_status public.custom_domain_status not null default 'none',
  add column custom_domain_verified_at timestamptz;

-- The hosted database had a workspace sitting at custom_domain = ''. An empty
-- host is not a domain, it would collide on the unique index the moment a
-- second workspace did the same, and `Host: ` never matches it anyway — so it
-- is noise that must not survive into a column the router reads.
update public.workspaces
  set custom_domain = null
  where btrim(coalesce(custom_domain, '')) = '';

-- No UI ever wrote custom_domain before this migration, but a hand-set value
-- would otherwise be left at 'none' and silently unroutable.
update public.workspaces
  set custom_domain_status = 'pending'
  where custom_domain is not null;

-- Hostnames only: lowercase, no scheme, no port, no path, at least one dot.
-- Normalisation happens in the server action, but a malformed value must not be
-- storable even if some future code path skips it, because the routing layer
-- compares this column against the raw Host header.
alter table public.workspaces
  add constraint workspaces_custom_domain_format
  check (
    custom_domain is null
    or custom_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  );

-- A status without a domain, or a verification timestamp without a domain, is
-- an inconsistent state the routing layer should never have to reason about.
alter table public.workspaces
  add constraint workspaces_custom_domain_status_consistent
  check (
    case
      when custom_domain is null
        then custom_domain_status = 'none' and custom_domain_verified_at is null
      else custom_domain_status <> 'none'
    end
  );

comment on column public.workspaces.custom_domain is
  'Bare hostname serving this workspace''s help centre. Unique across workspaces, so a domain can only be claimed once.';
comment on column public.workspaces.custom_domain_status is
  'Serving gate. Only ''verified'' may be routed to; see lib/custom-domain-routing.ts.';
comment on column public.workspaces.custom_domain_verified_at is
  'When the domain first verified. Kept if the status later regresses, so we can tell "never worked" from "broke".';
