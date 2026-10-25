-- Admin-controlled presentation correction; original stored photos are never rewritten.
create table if not exists public.slideshow_rotation_overrides (
  event_id uuid not null references public.events(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  rotation_degrees smallint not null check (rotation_degrees in (90, 180, 270)),
  updated_by uuid references public.admin_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (event_id, post_id)
);
alter table public.slideshow_rotation_overrides enable row level security;
revoke all on public.slideshow_rotation_overrides from public, anon, authenticated;
grant select, insert, update, delete on public.slideshow_rotation_overrides to service_role;
