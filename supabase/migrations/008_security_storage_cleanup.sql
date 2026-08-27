-- =========================================================
-- OUTING 2026 V1
-- 008 security + storage cleanup hardening
-- Run after 007_reliability_consent_ranking.sql
-- =========================================================

-- Allow owners to delete their own files and photo admins to delete event files.
drop policy if exists "participants delete own outing photos" on storage.objects;
create policy "participants delete own outing photos"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'outing-photos'
  and private.current_participant_id(private.safe_uuid(split_part(name,'/',1))) = private.safe_uuid(split_part(name,'/',2))
);

drop policy if exists "photo admins delete outing photos" on storage.objects;
create policy "photo admins delete outing photos"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'outing-photos'
  and private.is_event_admin(private.safe_uuid(split_part(name,'/',1)),'photos')
);

-- Top 5 is visible only to members/admins of the requested event.
create or replace function public.get_point_top5(p_event_id uuid)
returns table(rank bigint,participant_id uuid,participant_name text,score bigint)
language sql
stable
security definer
set search_path=''
as $$
  with allowed as (
    select (
      private.current_participant_id(p_event_id) is not null
      or private.is_event_admin(p_event_id)
    ) as ok
  ), scores as (
    select p.id,p.name,
      coalesce(sum(t.points) filter(where t.is_active),0)::bigint as score,
      coalesce(max(t.created_at) filter(where t.is_active),p.created_at) as reached_at
    from public.participants p
    left join public.point_transactions t on t.participant_id=p.id and t.event_id=p_event_id
    cross join allowed a
    where a.ok and p.event_id=p_event_id and p.is_active
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

-- Heart Top 10 is also restricted to members/admins of the event.
create or replace function public.get_heart_top10(p_event_id uuid)
returns table(rank bigint,post_id uuid,participant_id uuid,participant_name text,heart_count bigint)
language sql
stable
security definer
set search_path=''
as $$
  with allowed as (
    select (
      private.current_participant_id(p_event_id) is not null
      or private.is_event_admin(p_event_id)
    ) as ok
  ), counts as (
    select po.id as post_id,po.participant_id,p.name as participant_name,po.created_at,
      count(r.participant_id)::bigint as heart_count
    from public.posts po
    join public.participants p on p.id=po.participant_id
    left join public.reactions r on r.post_id=po.id
    cross join allowed a
    where a.ok and po.event_id=p_event_id and po.deleted_at is null
    group by po.id,po.participant_id,p.name,po.created_at
  ), ranked as (
    select dense_rank() over(order by heart_count desc) as rank,* from counts
  )
  select rank,post_id,participant_id,participant_name,heart_count
  from ranked
  order by heart_count desc,created_at asc,post_id
  limit 10;
$$;

revoke execute on function public.get_point_top5(uuid) from public,anon;
revoke execute on function public.get_heart_top10(uuid) from public,anon;
grant execute on function public.get_point_top5(uuid) to authenticated;
grant execute on function public.get_heart_top10(uuid) to authenticated;
