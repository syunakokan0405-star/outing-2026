-- =========================================================
-- OUTING 2026 V1
-- 007 reliability, consent, deletion audit, tied rankings
-- Run after 006_hardening.sql
-- =========================================================

-- ---------------------------------------------------------
-- Consent
-- ---------------------------------------------------------
alter table public.participants
  add column if not exists consented_at timestamptz,
  add column if not exists consent_version text;

-- Replace old claim RPC so consent cannot be bypassed by the current app API.
drop function if exists public.claim_participant(uuid, uuid);

create or replace function public.claim_participant(
  p_event_id uuid,
  p_participant_id uuid,
  p_consent_version text
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
  if v_uid is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_consent_version),'') is null then raise exception 'Consent is required'; end if;

  if exists (
    select 1 from public.participant_claims pc
    join public.participants p on p.id=pc.participant_id
    where pc.auth_user_id=v_uid and p.event_id=p_event_id and p.id<>p_participant_id
  ) then
    raise exception 'This auth user already claimed another participant';
  end if;

  select * into v_participant
  from public.participants
  where id=p_participant_id and event_id=p_event_id and is_active=true
  for update;
  if not found then raise exception 'Participant not found'; end if;

  if exists (
    select 1 from public.participant_claims pc
    where pc.participant_id=p_participant_id
      and pc.auth_user_id<>v_uid
      and pc.generation=v_participant.claim_generation
  ) then
    raise exception 'This participant is already claimed';
  end if;

  insert into public.participant_claims(participant_id,auth_user_id,generation,claimed_at)
  values(p_participant_id,v_uid,v_participant.claim_generation,now())
  on conflict(participant_id) do update set
    auth_user_id=excluded.auth_user_id,
    generation=excluded.generation,
    claimed_at=now();

  update public.participants
  set auth_user_id=v_uid,
      claimed_at=now(),
      consented_at=now(),
      consent_version=p_consent_version
  where id=p_participant_id
  returning * into v_participant;

  return v_participant;
end;
$$;

revoke execute on function public.claim_participant(uuid,uuid,text) from public,anon;
grant execute on function public.claim_participant(uuid,uuid,text) to authenticated;

-- ---------------------------------------------------------
-- Idempotent posting / duplicate prevention
-- ---------------------------------------------------------
alter table public.posts
  add column if not exists client_request_id uuid;

create unique index if not exists posts_client_request_unique
on public.posts(event_id, participant_id, client_request_id);

-- Replace previous submit RPC with a request-id aware version.
drop function if exists public.submit_mission_post(uuid,uuid,text,text,text,uuid[]);
drop function if exists public.submit_mission_post(uuid,uuid,text,text,text,uuid[],uuid);

create or replace function public.submit_mission_post(
  p_event_id uuid,
  p_mission_id uuid,
  p_image_path text,
  p_comment text default null,
  p_visibility text default 'gallery',
  p_mention_ids uuid[] default '{}'::uuid[],
  p_client_request_id uuid default null
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
begin
  select p.id into v_participant_id
  from public.participants p
  where p.event_id=p_event_id
    and p.auth_user_id=(select auth.uid())
    and p.is_active=true
    and p.consented_at is not null;
  if v_participant_id is null then raise exception 'Participant not claimed or consent missing'; end if;

  if p_client_request_id is null then raise exception 'client_request_id is required'; end if;

  -- Fast idempotent retry path.
  select p.id into v_post_id
  from public.posts p
  where p.event_id=p_event_id
    and p.participant_id=v_participant_id
    and p.client_request_id=p_client_request_id
  limit 1;
  if v_post_id is not null then return v_post_id; end if;

  if not exists(select 1 from public.events e where e.id=p_event_id and e.status='live') then
    raise exception 'Event is not live';
  end if;

  select m.* into v_mission
  from public.missions m
  join public.mission_drops d on d.id=m.drop_id
  where m.id=p_mission_id and d.event_id=p_event_id and d.status='published';
  if not found then raise exception 'Mission not found'; end if;

  select ma.* into v_assignment
  from public.mission_assignments ma
  where ma.mission_id=p_mission_id and ma.participant_id=v_participant_id
  for update;
  if not found then raise exception 'Mission is not assigned to this participant'; end if;

  if p_comment is not null and char_length(p_comment)>30 then raise exception 'Comment must be 30 characters or fewer'; end if;
  if p_visibility not in ('stream','gallery') then raise exception 'Invalid visibility'; end if;
  if nullif(trim(p_image_path),'') is null then raise exception 'Image required'; end if;

  v_mentions := public.validate_post_mentions(p_event_id,v_participant_id,p_mention_ids);
  if cardinality(v_mentions)<v_mission.required_mentions then
    raise exception 'This mission requires at least % mentions',v_mission.required_mentions;
  end if;

  insert into public.posts(event_id,participant_id,mission_id,image_path,comment,visibility,client_request_id)
  values(p_event_id,v_participant_id,p_mission_id,p_image_path,nullif(trim(p_comment),''),p_visibility,p_client_request_id)
  on conflict(event_id,participant_id,client_request_id) do nothing
  returning id into v_post_id;

  -- Handles the rare race where two retries reached INSERT together.
  if v_post_id is null then
    select p.id into v_post_id
    from public.posts p
    where p.event_id=p_event_id and p.participant_id=v_participant_id and p.client_request_id=p_client_request_id;
    return v_post_id;
  end if;

  insert into public.post_mentions(post_id,participant_id)
  select v_post_id,x from unnest(v_mentions)x on conflict do nothing;

  v_people:=array_prepend(v_participant_id,v_mentions);
  insert into public.connections(event_id,participant_a_id,participant_b_id,first_post_id)
  select p_event_id,least(a.person_id,b.person_id),greatest(a.person_id,b.person_id),v_post_id
  from unnest(v_people) with ordinality a(person_id,pa)
  cross join unnest(v_people) with ordinality b(person_id,pb)
  where a.pa<b.pb
  on conflict(event_id,participant_a_id,participant_b_id) do nothing;

  if v_assignment.first_cleared_at is null then
    update public.mission_assignments
    set first_cleared_at=now(),first_clear_post_id=v_post_id
    where id=v_assignment.id;

    insert into public.point_transactions(event_id,participant_id,post_id,mission_id,points,reason)
    values(p_event_id,v_participant_id,v_post_id,p_mission_id,v_mission.points,'mission_clear');

    foreach v_person in array v_mentions loop
      insert into public.point_transactions(event_id,participant_id,post_id,mission_id,points,reason)
      values(p_event_id,v_person,v_post_id,p_mission_id,v_mission.points,'mention_reward');
    end loop;
  end if;

  return v_post_id;
end;
$$;

revoke execute on function public.submit_mission_post(uuid,uuid,text,text,text,uuid[],uuid) from public,anon;
grant execute on function public.submit_mission_post(uuid,uuid,text,text,text,uuid[],uuid) to authenticated;

-- ---------------------------------------------------------
-- Immutable deletion audit log
-- ---------------------------------------------------------
create table if not exists public.post_deletion_logs(
  id bigserial primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  post_id uuid not null,
  actor_type text not null check(actor_type in ('participant','admin','retention')),
  participant_id uuid references public.participants(id) on delete set null,
  admin_user_id uuid references public.admin_users(id) on delete set null,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.post_deletion_logs enable row level security;

drop policy if exists "admins view deletion logs" on public.post_deletion_logs;
create policy "admins view deletion logs"
on public.post_deletion_logs for select to authenticated
using(private.is_event_admin(event_id,'photos'));

alter table public.posts
  add column if not exists deleted_reason text;

-- Participant/admin deletion. No historical post is auto-promoted to first clear.
drop function if exists public.delete_post(uuid);
drop function if exists public.delete_post(uuid,text);

create or replace function public.delete_post(
  p_post_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_post public.posts;
  v_participant_id uuid;
  v_admin_id uuid;
  v_actor text;
  v_reason text;
begin
  select * into v_post from public.posts where id=p_post_id for update;
  if not found then raise exception 'Post not found'; end if;
  if v_post.deleted_at is not null then return; end if;

  select p.id into v_participant_id
  from public.participants p
  where p.event_id=v_post.event_id and p.auth_user_id=(select auth.uid()) and p.is_active=true;

  select a.id into v_admin_id
  from public.admin_users a
  where a.event_id=v_post.event_id and a.auth_user_id=(select auth.uid())
    and (a.role in('owner','admin') or a.can_manage_photos=true)
  limit 1;

  if v_participant_id is distinct from v_post.participant_id and v_admin_id is null then
    raise exception 'Not allowed';
  end if;

  if v_admin_id is not null and v_participant_id is distinct from v_post.participant_id then
    v_actor:='admin';
    v_reason:=coalesce(nullif(trim(p_reason),''),'admin_removed');
  else
    v_actor:='participant';
    v_reason:=coalesce(nullif(trim(p_reason),''),'participant_deleted');
  end if;

  update public.posts
  set deleted_at=now(),
      deleted_by_participant=(v_actor='participant'),
      deleted_by_admin_id=case when v_actor='admin' then v_admin_id else null end,
      deleted_reason=v_reason
  where id=p_post_id;

  update public.point_transactions
  set is_active=false,revoked_at=now(),revoked_by_admin_id=case when v_actor='admin' then v_admin_id else null end
  where post_id=p_post_id and is_active=true;

  -- Explicitly clear only this first-clear marker. Older posts are NOT promoted.
  update public.mission_assignments
  set first_cleared_at=null,first_clear_post_id=null
  where first_clear_post_id=p_post_id;

  insert into public.post_deletion_logs(event_id,post_id,actor_type,participant_id,admin_user_id,reason)
  values(v_post.event_id,p_post_id,v_actor,case when v_actor='participant' then v_participant_id else null end,case when v_actor='admin' then v_admin_id else null end,v_reason);

  if v_admin_id is not null then
    insert into public.admin_logs(event_id,admin_user_id,action,target_type,target_id,metadata)
    values(v_post.event_id,v_admin_id,'post_deleted','post',p_post_id,jsonb_build_object('reason',v_reason));
  end if;
end;
$$;

revoke execute on function public.delete_post(uuid,text) from public,anon;
grant execute on function public.delete_post(uuid,text) to authenticated;

-- ---------------------------------------------------------
-- Retention deletion audit helper
-- ---------------------------------------------------------
drop function if exists public.mark_retention_deleted(uuid);
create or replace function public.mark_retention_deleted(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_event_id uuid;
begin
  select event_id into v_event_id from public.posts where id=p_post_id for update;
  if v_event_id is null then return; end if;

  update public.posts
  set deleted_at=coalesce(deleted_at,now()),deleted_reason=coalesce(deleted_reason,'retention_90_days')
  where id=p_post_id;

  if not exists(select 1 from public.post_deletion_logs l where l.post_id=p_post_id and l.actor_type='retention') then
    insert into public.post_deletion_logs(event_id,post_id,actor_type,reason)
    values(v_event_id,p_post_id,'retention','retention_90_days');
  end if;
end;
$$;
revoke execute on function public.mark_retention_deleted(uuid) from public,anon,authenticated;

-- ---------------------------------------------------------
-- Tied point ranking: same score = same rank.
-- Display order inside a tie uses earliest latest-active-score-change time.
-- ---------------------------------------------------------
create or replace function public.get_point_top5(p_event_id uuid)
returns table(rank bigint,participant_id uuid,participant_name text,score bigint)
language sql
stable
security definer
set search_path=''
as $$
  with scores as (
    select p.id,p.name,
      coalesce(sum(t.points) filter(where t.is_active),0)::bigint as score,
      coalesce(max(t.created_at) filter(where t.is_active),p.created_at) as reached_at
    from public.participants p
    left join public.point_transactions t on t.participant_id=p.id and t.event_id=p_event_id
    where p.event_id=p_event_id and p.is_active
    group by p.id,p.name,p.created_at
  ), ranked as (
    select dense_rank() over(order by score desc) as rank,id,name,score,reached_at
    from scores
  )
  select rank,id,name,score
  from ranked
  order by score desc,reached_at asc,name asc
  limit 5;
$$;

create or replace function public.get_my_point_rank(p_event_id uuid)
returns table(rank bigint,score bigint)
language sql
stable
security definer
set search_path=''
as $$
  with me as (
    select p.id from public.participants p
    where p.event_id=p_event_id and p.auth_user_id=(select auth.uid()) and p.is_active limit 1
  ), scores as (
    select p.id,coalesce(sum(t.points) filter(where t.is_active),0)::bigint as score
    from public.participants p
    left join public.point_transactions t on t.participant_id=p.id and t.event_id=p_event_id
    where p.event_id=p_event_id and p.is_active
    group by p.id
  ), ranked as (
    select id,score,dense_rank() over(order by score desc) as rank from scores
  )
  select ranked.rank,ranked.score from ranked join me on me.id=ranked.id;
$$;

revoke execute on function public.get_point_top5(uuid) from public,anon;
revoke execute on function public.get_my_point_rank(uuid) from public,anon;
grant execute on function public.get_point_top5(uuid) to authenticated;
grant execute on function public.get_my_point_rank(uuid) to authenticated;

-- Heart Top10 for Awards. Same heart count = same rank; older post wins display order only.
create or replace function public.get_heart_top10(p_event_id uuid)
returns table(rank bigint,post_id uuid,participant_id uuid,participant_name text,heart_count bigint)
language sql
stable
security definer
set search_path=''
as $$
  with counts as (
    select po.id as post_id,po.participant_id,p.name as participant_name,po.created_at,
      count(r.participant_id)::bigint as heart_count
    from public.posts po
    join public.participants p on p.id=po.participant_id
    left join public.reactions r on r.post_id=po.id
    where po.event_id=p_event_id and po.deleted_at is null
    group by po.id,po.participant_id,p.name,po.created_at
  ), ranked as (
    select dense_rank() over(order by heart_count desc) as rank,* from counts
  )
  select rank,post_id,participant_id,participant_name,heart_count
  from ranked
  order by heart_count desc,created_at asc,post_id
  limit 10;
$$;
revoke execute on function public.get_heart_top10(uuid) from public,anon;
grant execute on function public.get_heart_top10(uuid) to authenticated;
