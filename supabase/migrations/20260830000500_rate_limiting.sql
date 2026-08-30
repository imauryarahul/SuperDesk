-- Fixed-window rate limiter backed by a Postgres table.
--
-- Each (ip, scope, window_start) triple counts requests within that time slice.
-- The function is SECURITY DEFINER and granted only to service_role so it
-- cannot be reached over the PostgREST /rpc/ endpoint.
--
-- Simplification documented: this is a fixed-window counter, not a true
-- sliding window. A fixed window allows up to 2× the limit in a burst that
-- straddles a window boundary. For a per-IP abuse backstop at this scale that
-- tradeoff is acceptable; a Redis-backed sliding window would be the right
-- tool for stricter guarantees.

create table public.rate_limit_windows (
  ip           text        not null,
  scope        text        not null,
  window_start timestamptz not null,
  count        int         not null default 0,
  primary key  (ip, scope, window_start)
);

-- The table is only written by the rate-limit function (service_role).
-- Direct row access from authenticated/anon is not needed.
revoke all on public.rate_limit_windows from public, anon, authenticated;
grant  all on public.rate_limit_windows to service_role;

-- Returns TRUE if the request is within the limit, FALSE if it is exceeded.
-- Atomically inserts or increments the counter, then probabilistically prunes
-- stale rows so the table does not grow without bound.
create or replace function public.increment_rate_limit(
  p_ip         text,
  p_scope      text,
  p_window_sec int,
  p_max        int
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_count  int;
begin
  -- Align to the start of the current fixed window.
  v_window := to_timestamp(
    floor(extract(epoch from now()) / p_window_sec) * p_window_sec
  );

  insert into public.rate_limit_windows (ip, scope, window_start, count)
  values (p_ip, p_scope, v_window, 1)
  on conflict (ip, scope, window_start) do update
    set count = rate_limit_windows.count + 1
  returning count into v_count;

  -- Prune rows older than 20 windows for this (ip, scope) with 1% probability.
  if random() < 0.01 then
    delete from public.rate_limit_windows
    where ip = p_ip
      and scope = p_scope
      and window_start < now() - ((p_window_sec * 20) || ' seconds')::interval;
  end if;

  return v_count <= p_max;
end;
$$;

revoke all on function public.increment_rate_limit(text, text, int, int)
  from public, anon, authenticated;
grant execute on function public.increment_rate_limit(text, text, int, int) to service_role;
