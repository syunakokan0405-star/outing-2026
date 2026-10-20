-- Admin-only slideshow exclusions; ordinary posts/points are untouched.
create table if not exists public.slideshow_hidden_posts (
  event_id uuid not null references public.events(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  hidden_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (event_id, post_id)
);
create index if not exists slideshow_hidden_posts_post_idx
  on public.slideshow_hidden_posts(post_id);
alter table public.slideshow_hidden_posts enable row level security;
revoke all on public.slideshow_hidden_posts from anon, authenticated;
grant select, insert, delete on public.slideshow_hidden_posts to service_role;
