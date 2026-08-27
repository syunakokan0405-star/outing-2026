-- OUTING 2026 V1: private photo storage + ranking RPCs

insert into storage.buckets (id, name, public)
values ('outing-photos', 'outing-photos', false)
on conflict (id) do update set public = false;

create or replace function private.safe_uuid(p_text text)
returns uuid
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;

-- Files use: event_id/participant_id/random.webp
create policy "outing members read event photos"
on storage.objects for select
to authenticated
using (
  bucket_id = 'outing-photos'
  and (
    private.current_participant_id(private.safe_uuid(split_part(name,'/',1))) is not null
    or private.is_event_admin(private.safe_uuid(split_part(name,'/',1)))
  )
);

create policy "participants upload own outing photos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'outing-photos'
  and private.current_participant_id(private.safe_uuid(split_part(name,'/',1))) = private.safe_uuid(split_part(name,'/',2))
);

create or replace function public.get_point_top5(p_event_id uuid)
returns table(rank bigint, participant_id uuid, participant_name text, score bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with scores as (
    select p.id, p.name, coalesce(sum(t.points) filter (where t.is_active),0)::bigint as score
    from public.participants p
    left join public.point_transactions t on t.participant_id=p.id and t.event_id=p_event_id
    where p.event_id=p_event_id and p.is_active
    group by p.id,p.name
  )
  select row_number() over(order by score desc, name asc), id, name, score
  from scores
  order by score desc, name asc
  limit 5;
$$;

create or replace function public.get_my_point_rank(p_event_id uuid)
returns table(rank bigint, score bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select public.participants.id
    from public.participants
    where event_id=p_event_id and auth_user_id=(select auth.uid()) and is_active
    limit 1
  ), scores as (
    select p.id, coalesce(sum(t.points) filter(where t.is_active),0)::bigint as score
    from public.participants p
    left join public.point_transactions t on t.participant_id=p.id and t.event_id=p_event_id
    where p.event_id=p_event_id and p.is_active
    group by p.id
  ), ranked as (
    select id,score,dense_rank() over(order by score desc) as rank from scores
  )
  select ranked.rank,ranked.score from ranked join me on me.id=ranked.id;
$$;

revoke execute on function public.get_point_top5(uuid) from public, anon;
revoke execute on function public.get_my_point_rank(uuid) from public, anon;
grant execute on function public.get_point_top5(uuid) to authenticated;
grant execute on function public.get_my_point_rank(uuid) to authenticated;
