-- OUTING 2026 V1: hardening
-- Run after 005_auth_and_participant_lock.sql

-- 1) Configurable mention cap. Default: 12 people per post.
alter table public.events
  add column if not exists max_mentions_per_post integer not null default 12
  check (max_mentions_per_post between 0 and 50);

-- 2) Remember auth identities that were explicitly revoked by an admin.
-- This prevents an old browser session from immediately reclaiming the same name.
create table if not exists public.revoked_participant_auths (
  event_id uuid not null references public.events(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  revoked_at timestamptz not null default now(),
  revoked_by_admin_id uuid references public.admin_users(id) on delete set null,
  primary key (event_id, auth_user_id)
);

alter table public.revoked_participant_auths enable row level security;
-- No participant-facing policies: this table is accessed only by SECURITY DEFINER functions/admin logic.

-- Harden name claim.
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
    from public.revoked_participant_auths r
    where r.event_id = p_event_id
      and r.auth_user_id = v_uid
  ) then
    raise exception 'This previous device session was revoked by an admin';
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
  set auth_user_id = v_uid,
      claimed_at = coalesce(claimed_at, now())
  where id = p_participant_id
  returning * into v_participant;

  return v_participant;
end;
$$;

revoke execute on function public.claim_participant(uuid,uuid) from public, anon;
grant execute on function public.claim_participant(uuid,uuid) to authenticated;

-- Replace admin unlock with true old-session revocation.
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
  v_old_auth uuid;
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

  v_old_auth := v_participant.auth_user_id;

  if v_old_auth is not null then
    insert into public.revoked_participant_auths(
      event_id, auth_user_id, participant_id, revoked_by_admin_id
    ) values (
      v_participant.event_id, v_old_auth, p_participant_id, v_admin_id
    )
    on conflict (event_id, auth_user_id)
    do update set
      participant_id = excluded.participant_id,
      revoked_at = now(),
      revoked_by_admin_id = excluded.revoked_by_admin_id;
  end if;

  update public.participants
  set auth_user_id = null,
      claimed_at = null
  where id = p_participant_id;

  insert into public.admin_logs(
    event_id, admin_user_id, action, target_type, target_id, metadata
  ) values (
    v_participant.event_id,
    v_admin_id,
    'participant_unlocked_and_old_session_revoked',
    'participant',
    p_participant_id,
    jsonb_build_object(
      'participant_name', v_participant.name,
      'revoked_auth_user_id', v_old_auth
    )
  );
end;
$$;

revoke execute on function public.admin_unlock_participant(uuid) from public, anon;
grant execute on function public.admin_unlock_participant(uuid) to authenticated;

-- 3) Recreate submit_mission_post with an event-level mention cap.
create or replace function public.submit_mission_post(
  p_event_id uuid,
  p_mission_id uuid,
  p_image_path text,
  p_comment text default null,
  p_visibility text default 'gallery',
  p_mention_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant_id uuid;
  v_assignment public.mission_assignments;
  v_mission public.missions;
  v_post_id uuid;
  v_mentions uuid[];
  v_people uuid[];
  v_person uuid;
  v_max_mentions integer;
begin
  select p.id into v_participant_id
  from public.participants p
  where p.event_id = p_event_id
    and p.auth_user_id = (select auth.uid())
    and p.is_active = true;

  if v_participant_id is null then
    raise exception 'Participant not claimed';
  end if;

  select e.max_mentions_per_post into v_max_mentions
  from public.events e
  where e.id = p_event_id
    and e.status = 'live';

  if v_max_mentions is null then
    raise exception 'Event is not live';
  end if;

  select m.* into v_mission
  from public.missions m
  join public.mission_drops d on d.id = m.drop_id
  where m.id = p_mission_id
    and d.event_id = p_event_id
    and d.status = 'published';

  if not found then
    raise exception 'Mission not found';
  end if;

  select ma.* into v_assignment
  from public.mission_assignments ma
  where ma.mission_id = p_mission_id
    and ma.participant_id = v_participant_id
  for update;

  if not found then
    raise exception 'Mission is not assigned to this participant';
  end if;

  if p_comment is not null and char_length(p_comment) > 30 then
    raise exception 'Comment must be 30 characters or fewer';
  end if;

  if p_visibility not in ('stream','gallery') then
    raise exception 'Invalid visibility';
  end if;

  if nullif(trim(p_image_path),'') is null then
    raise exception 'Image required';
  end if;

  select coalesce(array_agg(distinct x),'{}'::uuid[])
  into v_mentions
  from unnest(coalesce(p_mention_ids,'{}'::uuid[])) x
  where x <> v_participant_id;

  if cardinality(v_mentions) > v_max_mentions then
    raise exception 'Too many mentions. Maximum is %', v_max_mentions;
  end if;

  if (
    select count(*)
    from public.participants p
    where p.event_id = p_event_id
      and p.is_active = true
      and p.id = any(v_mentions)
  ) <> cardinality(v_mentions) then
    raise exception 'Invalid mentioned participant';
  end if;

  if cardinality(v_mentions) < v_mission.required_mentions then
    raise exception 'This mission requires at least % mentions', v_mission.required_mentions;
  end if;

  insert into public.posts(event_id,participant_id,mission_id,image_path,comment,visibility)
  values(
    p_event_id,
    v_participant_id,
    p_mission_id,
    p_image_path,
    nullif(trim(p_comment),''),
    p_visibility
  ) returning id into v_post_id;

  insert into public.post_mentions(post_id,participant_id)
  select v_post_id,x from unnest(v_mentions)x
  on conflict do nothing;

  v_people := array_prepend(v_participant_id,v_mentions);

  insert into public.connections(event_id,participant_a_id,participant_b_id,first_post_id)
  select
    p_event_id,
    least(a.person_id,b.person_id),
    greatest(a.person_id,b.person_id),
    v_post_id
  from unnest(v_people) with ordinality a(person_id,pa)
  cross join unnest(v_people) with ordinality b(person_id,pb)
  where a.pa < b.pb
  on conflict(event_id,participant_a_id,participant_b_id) do nothing;

  if v_assignment.first_cleared_at is null then
    update public.mission_assignments
    set first_cleared_at = now(),
        first_clear_post_id = v_post_id
    where id = v_assignment.id;

    insert into public.point_transactions(
      event_id,participant_id,post_id,mission_id,points,reason
    ) values(
      p_event_id,v_participant_id,v_post_id,p_mission_id,v_mission.points,'mission_clear'
    );

    foreach v_person in array v_mentions loop
      insert into public.point_transactions(
        event_id,participant_id,post_id,mission_id,points,reason
      ) values(
        p_event_id,v_person,v_post_id,p_mission_id,v_mission.points,'mention_reward'
      );
    end loop;
  end if;

  return v_post_id;
end;
$$;

revoke execute on function public.submit_mission_post(uuid,uuid,text,text,text,uuid[]) from public, anon;
grant execute on function public.submit_mission_post(uuid,uuid,text,text,text,uuid[]) to authenticated;

-- 4) First-clear deletion behavior is intentionally NOT promoted.
-- Existing delete_post() already resets first_cleared_at and first_clear_post_id to NULL
-- only when the deleted post was the first-clear post. Older second/third posts remain ordinary
-- posts; points can be earned again only on a NEW later submission.

-- 5) 90-day retention timestamp per photo.
alter table public.posts
  add column if not exists retention_expires_at timestamptz;

update public.posts p
set retention_expires_at = p.created_at + make_interval(days => e.photo_retention_days)
from public.events e
where e.id = p.event_id
  and p.retention_expires_at is null;

create or replace function public.set_post_retention_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
begin
  select e.photo_retention_days into v_days
  from public.events e
  where e.id = new.event_id;

  new.retention_expires_at :=
    new.created_at + make_interval(days => coalesce(v_days,90));

  return new;
end;
$$;

drop trigger if exists trg_set_post_retention_expiry on public.posts;
create trigger trg_set_post_retention_expiry
before insert on public.posts
for each row execute function public.set_post_retention_expiry();

create index if not exists posts_retention_expiry_idx
  on public.posts(retention_expires_at)
  where retention_expires_at is not null;

-- Trusted cleanup helper. No browser/user execution granted.
create or replace function public.retention_cleanup_candidates(
  p_limit integer default 500
)
returns table(post_id uuid, image_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,p.image_path
  from public.posts p
  where p.retention_expires_at <= now()
    and p.image_path is not null
  order by p.retention_expires_at asc
  limit greatest(1,least(p_limit,1000));
$$;

revoke execute on function public.retention_cleanup_candidates(integer)
  from public, anon, authenticated;

create or replace function public.mark_retention_cleanup_done(
  p_post_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.posts p where p.id = p_post_id;
$$;

revoke execute on function public.mark_retention_cleanup_done(uuid)
  from public, anon, authenticated;
