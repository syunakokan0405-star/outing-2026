-- =========================================================
-- OUTING 2026
-- 011_announcements.sql
-- Home announcements
-- =========================================================

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),

  event_id uuid not null
    references public.events(id)
    on delete cascade,

  title text not null,
  body text not null,

  is_published boolean not null default false,

  created_by uuid
    references public.admin_users(id)
    on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create index if not exists announcements_event_published_idx
  on public.announcements (
    event_id,
    is_published,
    published_at desc
  );


-- =========================================================
-- RLS
-- =========================================================

alter table public.announcements
enable row level security;


-- Participants can read published announcements
-- for their own event.

drop policy if exists
  "participants read published announcements"
on public.announcements;

create policy
  "participants read published announcements"
on public.announcements
for select
to authenticated
using (
  is_published = true
  and exists (
    select 1
    from public.participants p
    where p.event_id = announcements.event_id
      and p.auth_user_id = (select auth.uid())
      and p.is_active = true
  )
);


-- Admins can read announcements for their event.

drop policy if exists
  "admins read announcements"
on public.announcements;

create policy
  "admins read announcements"
on public.announcements
for select
to authenticated
using (
  exists (
    select 1
    from public.admin_users a
    where a.event_id = announcements.event_id
      and a.auth_user_id = (select auth.uid())
      and a.role in ('owner', 'admin')
  )
);


-- =========================================================
-- ADMIN RPC
-- Create or edit announcement
-- =========================================================

create or replace function public.admin_save_announcement(
  p_event_id uuid,
  p_announcement_id uuid,
  p_title text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_admin public.admin_users;
  v_id uuid;
begin

  select *
  into v_admin
  from public.admin_users a
  where a.event_id = p_event_id
    and a.auth_user_id = (select auth.uid())
    and a.role in ('owner', 'admin')
  limit 1;

  if not found then
    raise exception 'Admin permission required';
  end if;

  if nullif(trim(p_title), '') is null then
    raise exception 'Title required';
  end if;

  if nullif(trim(p_body), '') is null then
    raise exception 'Body required';
  end if;

  if p_announcement_id is null then

    insert into public.announcements (
      event_id,
      title,
      body,
      created_by
    )
    values (
      p_event_id,
      trim(p_title),
      trim(p_body),
      v_admin.id
    )
    returning id into v_id;

  else

    update public.announcements
    set
      title = trim(p_title),
      body = trim(p_body),
      updated_at = now()
    where id = p_announcement_id
      and event_id = p_event_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Announcement not found';
    end if;

  end if;

  return v_id;
end;
$$;

revoke execute
on function public.admin_save_announcement(
  uuid,
  uuid,
  text,
  text
)
from public, anon;

grant execute
on function public.admin_save_announcement(
  uuid,
  uuid,
  text,
  text
)
to authenticated;


-- =========================================================
-- ADMIN RPC
-- Publish / unpublish
-- =========================================================

create or replace function public.admin_set_announcement_published(
  p_announcement_id uuid,
  p_published boolean
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_announcement public.announcements;
  v_admin public.admin_users;
begin

  select *
  into v_announcement
  from public.announcements
  where id = p_announcement_id
  for update;

  if not found then
    raise exception 'Announcement not found';
  end if;

  select *
  into v_admin
  from public.admin_users a
  where a.event_id = v_announcement.event_id
    and a.auth_user_id = (select auth.uid())
    and a.role in ('owner', 'admin')
  limit 1;

  if not found then
    raise exception 'Admin permission required';
  end if;

  update public.announcements
  set
    is_published = p_published,
    published_at =
      case
        when p_published = true
          then coalesce(published_at, now())
        else published_at
      end,
    updated_at = now()
  where id = p_announcement_id;

end;
$$;

revoke execute
on function public.admin_set_announcement_published(
  uuid,
  boolean
)
from public, anon;

grant execute
on function public.admin_set_announcement_published(
  uuid,
  boolean
)
to authenticated;


select '011 OK' as status;