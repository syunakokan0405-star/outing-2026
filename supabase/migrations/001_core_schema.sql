-- OUTING 2026 V1: core schema
create extension if not exists pgcrypto;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(), name text not null,
  starts_at timestamptz not null, ends_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft','live','archive')),
  photo_retention_days integer not null default 90 check (photo_retention_days > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id) on delete cascade,
  name text not null, auth_user_id uuid unique references auth.users(id) on delete set null,
  claimed_at timestamptz, is_active boolean not null default true, created_at timestamptz not null default now(),
  unique(event_id,name)
);
create index if not exists participants_event_idx on public.participants(event_id);
create index if not exists participants_auth_idx on public.participants(auth_user_id);

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade, display_name text not null,
  role text not null default 'staff' check(role in ('owner','admin','staff')),
  can_manage_missions boolean not null default false, can_manage_stream boolean not null default false,
  can_manage_photos boolean not null default false, can_manage_awards boolean not null default false,
  can_manage_guide boolean not null default false, can_manage_participants boolean not null default false,
  created_at timestamptz not null default now(), unique(event_id,auth_user_id)
);

create table if not exists public.mission_drops (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id) on delete cascade,
  drop_number integer not null, title text, status text not null default 'draft' check(status in ('draft','published')),
  published_at timestamptz, created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(), unique(event_id,drop_number)
);

create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(), drop_id uuid not null references public.mission_drops(id) on delete cascade,
  slot text not null check(slot in ('A','B','C')), title text not null,
  difficulty text not null check(difficulty in ('easy','normal','hard')), points integer not null check(points>=0),
  required_mentions integer not null default 0 check(required_mentions>=0), created_at timestamptz not null default now(),
  unique(drop_id,slot)
);

create table if not exists public.mission_assignments (
  id uuid primary key default gen_random_uuid(), mission_id uuid not null references public.missions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  first_cleared_at timestamptz, created_at timestamptz not null default now(), unique(mission_id,participant_id)
);
create index if not exists mission_assignments_participant_idx on public.mission_assignments(participant_id);
create index if not exists mission_assignments_mission_idx on public.mission_assignments(mission_id);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  mission_id uuid references public.missions(id) on delete set null, image_path text not null,
  comment text check(comment is null or char_length(comment)<=30), visibility text not null default 'gallery' check(visibility in ('stream','gallery')),
  created_at timestamptz not null default now(), deleted_at timestamptz, deleted_by_participant boolean not null default false,
  deleted_by_admin_id uuid references public.admin_users(id) on delete set null
);
create index if not exists posts_event_idx on public.posts(event_id);
create index if not exists posts_participant_idx on public.posts(participant_id);
create index if not exists posts_created_at_idx on public.posts(created_at desc);
create index if not exists posts_active_idx on public.posts(event_id,created_at desc) where deleted_at is null;

create table if not exists public.post_mentions (
  post_id uuid not null references public.posts(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(post_id,participant_id)
);
create index if not exists post_mentions_participant_idx on public.post_mentions(participant_id);

create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id) on delete cascade,
  participant_a_id uuid not null references public.participants(id) on delete cascade,
  participant_b_id uuid not null references public.participants(id) on delete cascade,
  first_post_id uuid references public.posts(id) on delete set null, created_at timestamptz not null default now(),
  check(participant_a_id<>participant_b_id), check(participant_a_id<participant_b_id), unique(event_id,participant_a_id,participant_b_id)
);
create index if not exists connections_a_idx on public.connections(participant_a_id);
create index if not exists connections_b_idx on public.connections(participant_b_id);

create table if not exists public.point_transactions (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  post_id uuid references public.posts(id) on delete set null, mission_id uuid references public.missions(id) on delete set null,
  points integer not null, reason text not null check(reason in ('mission_clear','mention_reward','manual_adjustment')),
  is_active boolean not null default true, created_at timestamptz not null default now(), revoked_at timestamptz,
  revoked_by_admin_id uuid references public.admin_users(id) on delete set null
);
create index if not exists point_transactions_participant_idx on public.point_transactions(participant_id);
create index if not exists point_transactions_post_idx on public.point_transactions(post_id);
create index if not exists point_transactions_active_idx on public.point_transactions(participant_id) where is_active=true;

create table if not exists public.reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(post_id,participant_id)
);
create index if not exists reactions_participant_idx on public.reactions(participant_id);

create table if not exists public.awards (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id) on delete cascade,
  name text not null, description text, award_type text not null default 'admin' check(award_type in ('admin','most_liked')),
  created_at timestamptz not null default now()
);
create table if not exists public.award_winners (
  award_id uuid not null references public.awards(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  selected_by uuid references public.admin_users(id) on delete set null, created_at timestamptz not null default now(),
  primary key(award_id,post_id)
);

create table if not exists public.stream_posts (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id) on delete cascade,
  created_by uuid references public.admin_users(id) on delete set null, title text not null, body text, image_path text,
  created_at timestamptz not null default now(), deleted_at timestamptz
);

create table if not exists public.schedule_items (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id) on delete cascade,
  title text not null, description text, location text, starts_at timestamptz not null, ends_at timestamptz,
  sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists schedule_items_event_time_idx on public.schedule_items(event_id,starts_at);

create table if not exists public.guide_sections (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id) on delete cascade,
  section_type text not null check(section_type in ('packing','rules','place','groups','other')),
  title text not null, body text, sort_order integer not null default 0, updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete cascade,
  type text not null check(type in ('mission_drop','schedule_change','announcement','system')),
  title text not null, body text, created_at timestamptz not null default now()
);
create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  read_at timestamptz not null default now(), primary key(notification_id,participant_id)
);

create table if not exists public.admin_logs (
  id bigserial primary key, event_id uuid not null references public.events(id) on delete cascade,
  admin_user_id uuid references public.admin_users(id) on delete set null, action text not null,
  target_type text, target_id uuid, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

-- Initial event. Replace/adjust times in the admin UI once the exact schedule is set.
insert into public.events(name,starts_at,ends_at,status,photo_retention_days)
select 'Outing 2026','2026-10-25 00:00:00+09','2026-10-26 23:59:59+09','draft',90
where not exists (select 1 from public.events where name='Outing 2026');
