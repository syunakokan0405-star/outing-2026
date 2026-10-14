-- Rank all visible participant stream posts, not just the loaded Latest page.
create or replace function public.get_liked_stream(p_event_id uuid)
returns table(post_id uuid, heart_count bigint)
language sql stable security invoker set search_path = ''
as $$
  select p.id, count(r.participant_id)::bigint
  from public.posts p
  left join public.reactions r on r.post_id = p.id
  where p.event_id = p_event_id and p.deleted_at is null and p.visibility = 'stream'
  group by p.id, p.created_at
  order by count(r.participant_id) desc, p.created_at desc, p.id
  limit 15;
$$;
revoke execute on function public.get_liked_stream(uuid) from public, anon;
grant execute on function public.get_liked_stream(uuid) to authenticated;
