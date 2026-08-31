-- Supabase's default privileges grant EXECUTE on every public function to anon,
-- which would publish all four analytics RPCs at /rest/v1/rpc/. Analytics is
-- dashboard-only, so anon is revoked explicitly. Same pattern as the bootstrap
-- functions in migration 000200.

revoke all on function public.get_analytics_first_response()  from public, anon;
revoke all on function public.get_analytics_resolution_rate() from public, anon;
revoke all on function public.get_analytics_busiest_hours()   from public, anon;
revoke all on function public.get_analytics_agent_stats()     from public, anon;

grant execute on function public.get_analytics_first_response()  to authenticated;
grant execute on function public.get_analytics_resolution_rate() to authenticated;
grant execute on function public.get_analytics_busiest_hours()   to authenticated;
grant execute on function public.get_analytics_agent_stats()     to authenticated;
