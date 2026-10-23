alter table public.events add column if not exists ranking_secret boolean not null default false;
create or replace function public.set_ranking_secret(p_event_id uuid, p_secret boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or not private.is_event_admin(p_event_id, 'awards') then
   raise exception '表彰管理の権限が必要です' using errcode = '42501';
 end if;
 update public.events set ranking_secret = p_secret where id = p_event_id;
 if not found then raise exception 'Event not found'; end if;
 return p_secret;
end; $$;
revoke all on function public.set_ranking_secret(uuid,boolean) from public, anon;
grant execute on function public.set_ranking_secret(uuid,boolean) to authenticated;
do $$
declare def text;
begin
 select pg_get_functiondef('public.get_event_top5(uuid)'::regprocedure) into def;
 def := replace(def, 'where ac.allowed = true', 'where ac.allowed = true and (private.is_event_admin(p_event_id) or not (select e.ranking_secret from public.events e where e.id = p_event_id))');
 execute def;
 select pg_get_functiondef('public.get_my_rank(uuid)'::regprocedure) into def;
 def := replace(def, E'    r.rank,', E'    case when (select e.ranking_secret from public.events e where e.id = p_event_id) then null::bigint else r.rank end,');
 execute def;
 if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='events') then
 alter publication supabase_realtime add table public.events;
 end if;
end $$;
