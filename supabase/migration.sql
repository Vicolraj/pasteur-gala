-- Pasteur Foundation gala platform — kv storage layer
-- Run in the Supabase SQL editor, or via `supabase db push`.

create table if not exists kv (
  key text primary key,
  value jsonb not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);

-- RLS is enabled with zero policies attached on purpose: this means no
-- anon/authenticated key can read or write this table at all, from any
-- context (browser, direct REST call, etc). The only way in is the
-- service-role key, which is only ever used server-side inside the
-- Vercel functions in /api. That's the entire security model — there is
-- nothing to misconfigure by adding a policy later by accident.
alter table kv enable row level security;

-- Storage bucket for uploaded files (logos, PDFs, floor-plan images).
-- Public read (so the admin dashboard and sponsor portal can just use
-- the returned public URL directly), writes only via signed upload URLs
-- issued by /api/upload.js using the service-role key.
insert into storage.buckets (id, name, public)
values ('gala-uploads', 'gala-uploads', true)
on conflict (id) do nothing;

-- No storage.objects policies are added for INSERT/UPDATE/DELETE — signed
-- upload URLs bypass RLS by design, same reasoning as the kv table above.
-- A SELECT policy isn't needed either since the bucket itself is public.
