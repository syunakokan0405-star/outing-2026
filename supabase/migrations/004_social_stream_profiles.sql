-- OUTING 2026 V1: social feed hardening + admin Stream writes + realtime
-- Run after 003_storage_and_rankings.sql

-- Participants may read the display name of admins in their own event so
-- admin Stream cards can show who posted them.
drop policy if exists "event members view admin display names" on public.admin_users;
create policy "event members view admin display names"
on public.admin_users
for select
to authenticated
using (
  private.current_participant_id(event_id) is not null
  or private.is_event_admin(event_id)
);

-- Harden public Top 5 RPC: an authenticated user may only request an event
-- they belong to as participant or admin.
create or replace function public.get_point_top5(p_event_id uuid)
returns table(rank bigint, participant_id uuid, participant_name text, score bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.current_participant_id(p_event_id) is null
     and not private.is_event_admin(p_event_id) then
    raise exception 'Not allowed';
  end if;

  return query
  with scores as (
    select
      p.id,
      p.name,
      coalesce(sum(t.points) filter (where t.is_active), 0)::bigint as score
    from public.participants p
    left join public.point_transactions t
      on t.participant_id = p.id
     and t.event_id = p_event_id
    where p.event_id = p_event_id
      and p.is_active = true
    group by p.id, p.name
  )
  select
    row_number() over(order by scores.score desc, scores.name asc)::bigint,
    scores.id,
    scores.name,
    scores.score
  from scores
  order by scores.score desc, scores.name asc
  limit 5;
end;
$$;

revoke execute on function public.get_point_top5(uuid) from public, anon;
grant execute on function public.get_point_top5(uuid) to authenticated;

-- Admin Stream write permissions.
drop policy if exists "stream managers insert admin stream posts" on public.stream_posts;
create policy "stream managers insert admin stream posts"
on public.stream_posts
for insert
to authenticated
with check (
  private.is_event_admin(event_id, 'stream')
  and created_by in (
    select a.id
    from public.admin_users a
    where a.event_id = stream_posts.event_id
      and a.auth_user_id = (select auth.uid())
  )
);

drop policy if exists "stream managers update admin stream posts" on public.stream_posts;
create policy "stream managers update admin stream posts"
on public.stream_posts
for update
to authenticated
using (private.is_event_admin(event_id, 'stream'))
with check (private.is_event_admin(event_id, 'stream'));

drop policy if exists "stream managers delete admin stream posts" on public.stream_posts;
create policy "stream managers delete admin stream posts"
on public.stream_posts
for delete
to authenticated
using (private.is_event_admin(event_id, 'stream'));

-- Admin images are stored under event_id/admin/random.ext in the same private bucket.
drop policy if exists "stream admins upload outing photos" on storage.objects;
create policy "stream admins upload outing photos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'outing-photos'
  and split_part(name, '/', 2) = 'admin'
  and private.is_event_admin(private.safe_uuid(split_part(name, '/', 1)), 'stream')
);

drop policy if exists "stream admins delete outing photos" on storage.objects;
create policy "stream admins delete outing photos"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'outing-photos'
  and split_part(name, '/', 2) = 'admin'
  and private.is_event_admin(private.safe_uuid(split_part(name, '/', 1)), 'stream')
);

-- Make sure the simple V1 Postgres Changes subscriptions can receive these tables.
-- Supabase currently recommends Broadcast for larger-scale apps; Postgres Changes
-- keeps the V1 setup straightforward for this ~120 participant event.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'posts'
  ) then
    alter publication supabase_realtime add table public.posts;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reactions'
  ) then
    alter publication supabase_realtime add table public.reactions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stream_posts'
  ) then
    alter publication supabase_realtime add table public.stream_posts;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'point_transactions'
  ) then
    alter publication supabase_realtime add table public.point_transactions;
  end if;
end $$;
