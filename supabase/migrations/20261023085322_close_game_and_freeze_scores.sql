alter table public.events add column if not exists game_closed_at timestamptz;
create table if not exists private.final_rankings (
event_id uuid not null references public.events(id), participant_id uuid not null,
participant_name text not null, rank bigint not null, score bigint not null, reached_at timestamptz not null,
primary key(event_id,participant_id));
alter table private.final_rankings enable row level security;
revoke all on private.final_rankings from public,anon,authenticated;
create or replace function public.set_ranking_secret(p_event_id uuid,p_secret boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare closed timestamptz;
begin
 if auth.uid() is null or not private.is_event_admin(p_event_id,'awards') then
 raise exception '表彰管理の権限が必要です' using errcode='42501'; end if;
 select game_closed_at into closed from public.events where id=p_event_id for update;
 if not found then raise exception 'Event not found'; end if;
 update public.events set ranking_secret=p_secret,
 game_closed_at=case when p_secret then coalesce(game_closed_at,clock_timestamp()) else game_closed_at end where id=p_event_id;
 if p_secret and closed is null then
 insert into private.final_rankings(event_id,participant_id,participant_name,rank,score,reached_at)
 select p_event_id,id,name,dense_rank() over(order by score desc),score,reached_at from (
 select p.id,p.name,coalesce(sum(pt.points) filter(where pt.is_active),0)::bigint score,
 coalesce(max(pt.created_at) filter(where pt.is_active),p.created_at) reached_at
 from public.participants p left join public.point_transactions pt on pt.participant_id=p.id
 where p.event_id=p_event_id and p.is_active group by p.id,p.name,p.created_at) s;
 end if;
 return p_secret;
end $$;
create or replace function private.enforce_game_deadline()
returns trigger language plpgsql security definer set search_path='' as $$
declare closed timestamptz; eid uuid;
begin
 eid := case when TG_OP='DELETE' then OLD.event_id else NEW.event_id end;
 select game_closed_at into closed from public.events where id=eid for share;
 if TG_TABLE_NAME='point_transactions' and TG_OP='UPDATE' and OLD.event_id<>NEW.event_id then
 raise exception 'Point event cannot be changed'; end if;
 if closed is not null then
 if TG_TABLE_NAME='point_transactions' and TG_OP='INSERT' then return null; end if;
 raise exception '投稿受付は終了しました。得点は確定しています。' using errcode='P0001';
 end if;
 if TG_OP='DELETE' then return OLD; end if;
 return NEW;
end $$;
revoke all on function private.enforce_game_deadline() from public,anon,authenticated;
create trigger enforce_game_deadline before insert on public.posts for each row execute function private.enforce_game_deadline();
create trigger enforce_game_deadline before insert on public.stream_posts for each row execute function private.enforce_game_deadline();
create trigger enforce_game_deadline before insert or update or delete on public.point_transactions for each row execute function private.enforce_game_deadline();
do $$
declare def text;
begin
select pg_get_functiondef('public.get_event_top5(uuid)'::regprocedure) into def;
-- Preserve the existing live ranking implementation for open events.
def := replace(def,'with access_check as (','with live_ranking as (with access_check as (');
def := replace(def,'limit 5;',E'limit 5)\n select * from live_ranking where not exists(select 1 from public.events e where e.id=p_event_id and e.game_closed_at is not null)\n union all\n select f.rank,f.participant_id,f.participant_name,f.score from (select * from private.final_rankings where event_id=p_event_id order by rank,reached_at,participant_name limit 5) f\n where private.is_event_admin(p_event_id) or (private.current_participant_id(p_event_id) is not null and not (select e.ranking_secret from public.events e where e.id=p_event_id));');
execute def;
select pg_get_functiondef('public.get_my_rank(uuid)'::regprocedure) into def;
def := replace(def,'with me as (','with live_ranking as (with me as (');
def := replace(def,'r.participant_id;',E'r.participant_id)\n select * from live_ranking where not exists(select 1 from public.events e where e.id=p_event_id and e.game_closed_at is not null)\n union all\n select case when e.ranking_secret then null::bigint else f.rank end,f.score from private.final_rankings f join public.events e on e.id=f.event_id\n where f.event_id=p_event_id and f.participant_id=private.current_participant_id(p_event_id);');
execute def;
select pg_get_functiondef('private.claim_hidden_bonus(uuid,text)'::regprocedure) into def;
def := replace(def,'begin',E'begin\n if exists(select 1 from public.events where id=p_event_id and game_closed_at is not null) then return 0; end if;');
execute def;
end $$;
