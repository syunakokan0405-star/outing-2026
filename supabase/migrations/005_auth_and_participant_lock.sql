-- OUTING 2026 V1: auth hardening + participant lock management
-- Run after 004_social_stream_profiles.sql

-- Prevent an admin auth account from claiming a participant identity.
create or replace function public.claim_participant(
  p_event_id uuid,
  p_participant_id uuid
)
returns public.participants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_participant public.participants;
begin
  v_uid := (select auth.uid());

  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if exists (
    select 1
    from public.admin_users a
    where a.event_id = p_event_id
      and a.auth_user_id = v_uid
  ) then
    raise exception 'Admin accounts cannot claim participant identities';
  end if;

  if exists (
    select 1
    from public.participants p
    where p.event_id = p_event_id
      and p.auth_user_id = v_uid
      and p.id <> p_participant_id
  ) then
    raise exception 'This device already claimed another participant';
  end if;

  select *
  into v_participant
  from public.participants
  where id = p_participant_id
    and event_id = p_event_id
    and is_active = true
  for update;

  if not found then
    raise exception 'Participant not found';
  end if;

  if v_participant.auth_user_id is not null
     and v_participant.auth_user_id <> v_uid then
    raise exception 'This participant is already claimed';
  end if;

  update public.participants
  set
    auth_user_id = v_uid,
    claimed_at = coalesce(claimed_at, now())
  where id = p_participant_id
  returning * into v_participant;

  return v_participant;
end;
$$;

revoke execute on function public.claim_participant(uuid,uuid) from public, anon;
grant execute on function public.claim_participant(uuid,uuid) to authenticated;

-- Admin-only unlock used from /admin/participants.
create or replace function public.admin_unlock_participant(
  p_participant_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant public.participants;
  v_admin_id uuid;
begin
  select *
  into v_participant
  from public.participants p
  where p.id = p_participant_id
  for update;

  if not found then
    raise exception 'Participant not found';
  end if;

  select a.id
  into v_admin_id
  from public.admin_users a
  where a.event_id = v_participant.event_id
    and a.auth_user_id = (select auth.uid())
    and (
      a.role in ('owner','admin')
      or a.can_manage_participants = true
    )
  limit 1;

  if v_admin_id is null then
    raise exception 'Participant management permission required';
  end if;

  update public.participants
  set auth_user_id = null,
      claimed_at = null
  where id = p_participant_id;

  insert into public.admin_logs (
    event_id,
    admin_user_id,
    action,
    target_type,
    target_id,
    metadata
  ) values (
    v_participant.event_id,
    v_admin_id,
    'participant_unlocked',
    'participant',
    p_participant_id,
    jsonb_build_object('participant_name', v_participant.name)
  );
end;
$$;

revoke execute on function public.admin_unlock_participant(uuid) from public, anon;
grant execute on function public.admin_unlock_participant(uuid) to authenticated;

-- Participant managers need to list the roster in the admin UI.
drop policy if exists "participant managers view roster" on public.participants;
create policy "participant managers view roster"
on public.participants
for select
to authenticated
using (
  private.is_event_admin(event_id, 'participants')
);
