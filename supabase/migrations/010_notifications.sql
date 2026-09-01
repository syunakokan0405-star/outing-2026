-- =========================================================
-- OUTING 2026
-- 010_notifications.sql
-- In-app notification foundation.
-- =========================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),

  event_id uuid not null
    references public.events(id)
    on delete cascade,

  participant_id uuid not null
    references public.participants(id)
    on delete cascade,

  type text not null
    check (
      type in (
        'mission_drop',
        'mention',
        'heart',
        'stream',
        'award',
        'admin'
      )
    ),

  title text not null,
  body text,
  href text,

  is_read boolean not null default false,

  created_at timestamptz not null default now()
);

create index if not exists notifications_participant_created_idx
  on public.notifications(participant_id, created_at desc);

create index if not exists notifications_participant_unread_idx
  on public.notifications(participant_id, is_read)
  where is_read = false;


-- =========================================================
-- RLS
-- Participants can only read their own notifications.
-- =========================================================

alter table public.notifications enable row level security;

drop policy if exists "participants read own notifications"
on public.notifications;

create policy "participants read own notifications"
on public.notifications
for select
to authenticated
using (
  exists (
    select 1
    from public.participants p
    where p.id = notifications.participant_id
      and p.event_id = notifications.event_id
      and p.auth_user_id = (select auth.uid())
      and p.is_active = true
  )
);


-- =========================================================
-- RPC: mark one notification as read
-- =========================================================

create or replace function public.mark_notification_read(
  p_notification_id uuid
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_participant_id uuid;
begin
  select n.participant_id
  into v_participant_id
  from public.notifications n
  where n.id = p_notification_id;

  if v_participant_id is null then
    raise exception 'Notification not found';
  end if;

  if not exists (
    select 1
    from public.participants p
    where p.id = v_participant_id
      and p.auth_user_id = (select auth.uid())
      and p.is_active = true
  ) then
    raise exception 'Notification permission required';
  end if;

  update public.notifications
  set is_read = true
  where id = p_notification_id;
end;
$$;

revoke execute
on function public.mark_notification_read(uuid)
from public, anon;

grant execute
on function public.mark_notification_read(uuid)
to authenticated;


-- =========================================================
-- RPC: mark all current participant notifications as read
-- =========================================================

create or replace function public.mark_all_notifications_read(
  p_event_id uuid
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_participant_id uuid;
begin
  select p.id
  into v_participant_id
  from public.participants p
  where p.event_id = p_event_id
    and p.auth_user_id = (select auth.uid())
    and p.is_active = true
  limit 1;

  if v_participant_id is null then
    raise exception 'Participant not claimed';
  end if;

  update public.notifications
  set is_read = true
  where event_id = p_event_id
    and participant_id = v_participant_id
    and is_read = false;
end;
$$;

revoke execute
on function public.mark_all_notifications_read(uuid)
from public, anon;

grant execute
on function public.mark_all_notifications_read(uuid)
to authenticated;


select '010 OK' as status;