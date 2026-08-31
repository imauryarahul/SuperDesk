-- Add name to contacts for optional identity capture via the chat widget.
-- Nullable: existing contacts and anonymous visitors who never provide a name
-- continue to work unchanged. The column is intentionally plain text (not
-- constrained to e.g. a length limit) because the limit is enforced at the
-- application layer (/api/widget/identity validates max 100 chars), keeping
-- the constraint in one place.
alter table public.contacts add column name text;
