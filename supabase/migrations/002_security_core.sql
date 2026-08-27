-- OUTING 2026 V1: core security, RPCs and RLS
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

alter table public.mission_assignments add column if not exists first_clear_post_id uuid references public.posts(id) on delete set null;
create index if not exists mission_assignments_clear_post_idx on public.mission_assignments(first_clear_post_id);
alter table public.posts add column if not exists comment_updated_at timestamptz;

create or replace function private.current_participant_id(p_event_id uuid)
returns uuid language sql stable security definer set search_path=''
as $$ select p.id from public.participants p where p.event_id=p_event_id and p.auth_user_id=(select auth.uid()) and p.is_active=true limit 1 $$;

create or replace function private.is_event_admin(p_event_id uuid,p_permission text default null)
returns boolean language sql stable security definer set search_path=''
as $$
select exists(
  select 1 from public.admin_users a
  where a.event_id=p_event_id and a.auth_user_id=(select auth.uid()) and (
    a.role in ('owner','admin') or p_permission is null
    or (p_permission='missions' and a.can_manage_missions)
    or (p_permission='stream' and a.can_manage_stream)
    or (p_permission='photos' and a.can_manage_photos)
    or (p_permission='awards' and a.can_manage_awards)
    or (p_permission='guide' and a.can_manage_guide)
    or (p_permission='participants' and a.can_manage_participants)
  )
) $$;

revoke execute on function private.current_participant_id(uuid) from public;
revoke execute on function private.is_event_admin(uuid,text) from public;
grant execute on function private.current_participant_id(uuid) to authenticated;
grant execute on function private.is_event_admin(uuid,text) to authenticated;

create or replace function public.list_available_participants(p_event_id uuid)
returns table(participant_id uuid,participant_name text,is_claimed boolean)
language sql stable security definer set search_path=''
as $$
  select p.id,p.name,(p.auth_user_id is not null)
  from public.participants p where p.event_id=p_event_id and p.is_active=true order by p.name
$$;
revoke execute on function public.list_available_participants(uuid) from public,anon;
grant execute on function public.list_available_participants(uuid) to authenticated;

create or replace function public.claim_participant(p_event_id uuid,p_participant_id uuid)
returns public.participants language plpgsql security definer set search_path=''
as $$
declare v_uid uuid; v_participant public.participants;
begin
  v_uid:=(select auth.uid()); if v_uid is null then raise exception 'Authentication required'; end if;
  if exists(select 1 from public.participants p where p.event_id=p_event_id and p.auth_user_id=v_uid and p.id<>p_participant_id) then
    raise exception 'This device already claimed another participant';
  end if;
  select * into v_participant from public.participants where id=p_participant_id and event_id=p_event_id and is_active=true for update;
  if not found then raise exception 'Participant not found'; end if;
  if v_participant.auth_user_id is not null and v_participant.auth_user_id<>v_uid then raise exception 'This participant is already claimed'; end if;
  update public.participants set auth_user_id=v_uid,claimed_at=coalesce(claimed_at,now()) where id=p_participant_id returning * into v_participant;
  return v_participant;
end $$;
revoke execute on function public.claim_participant(uuid,uuid) from public,anon;
grant execute on function public.claim_participant(uuid,uuid) to authenticated;

create or replace function public.submit_mission_post(
  p_event_id uuid,p_mission_id uuid,p_image_path text,p_comment text default null,
  p_visibility text default 'gallery',p_mention_ids uuid[] default '{}'::uuid[]
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  v_participant_id uuid; v_assignment public.mission_assignments; v_mission public.missions;
  v_post_id uuid; v_mentions uuid[]; v_people uuid[]; v_person uuid;
begin
  select p.id into v_participant_id from public.participants p where p.event_id=p_event_id and p.auth_user_id=(select auth.uid()) and p.is_active=true;
  if v_participant_id is null then raise exception 'Participant not claimed'; end if;
  if not exists(select 1 from public.events e where e.id=p_event_id and e.status='live') then raise exception 'Event is not live'; end if;
  select m.* into v_mission from public.missions m join public.mission_drops d on d.id=m.drop_id where m.id=p_mission_id and d.event_id=p_event_id and d.status='published';
  if not found then raise exception 'Mission not found'; end if;
  select ma.* into v_assignment from public.mission_assignments ma where ma.mission_id=p_mission_id and ma.participant_id=v_participant_id for update;
  if not found then raise exception 'Mission is not assigned to this participant'; end if;
  if p_comment is not null and char_length(p_comment)>30 then raise exception 'Comment must be 30 characters or fewer'; end if;
  if p_visibility not in ('stream','gallery') then raise exception 'Invalid visibility'; end if;
  if nullif(trim(p_image_path),'') is null then raise exception 'Image required'; end if;
  select coalesce(array_agg(distinct x),'{}'::uuid[]) into v_mentions from unnest(coalesce(p_mention_ids,'{}'::uuid[])) x where x<>v_participant_id;
  if (select count(*) from public.participants p where p.event_id=p_event_id and p.is_active=true and p.id=any(v_mentions))<>cardinality(v_mentions) then
    raise exception 'Invalid mentioned participant';
  end if;
  if cardinality(v_mentions)<v_mission.required_mentions then raise exception 'This mission requires at least % mentions',v_mission.required_mentions; end if;
  insert into public.posts(event_id,participant_id,mission_id,image_path,comment,visibility)
  values(p_event_id,v_participant_id,p_mission_id,p_image_path,nullif(trim(p_comment),''),p_visibility) returning id into v_post_id;
  insert into public.post_mentions(post_id,participant_id) select v_post_id,x from unnest(v_mentions)x on conflict do nothing;
  v_people:=array_prepend(v_participant_id,v_mentions);
  insert into public.connections(event_id,participant_a_id,participant_b_id,first_post_id)
  select p_event_id,least(a.person_id,b.person_id),greatest(a.person_id,b.person_id),v_post_id
  from unnest(v_people) with ordinality a(person_id,pa)
  cross join unnest(v_people) with ordinality b(person_id,pb)
  where a.pa<b.pb
  on conflict(event_id,participant_a_id,participant_b_id) do nothing;
  if v_assignment.first_cleared_at is null then
    update public.mission_assignments set first_cleared_at=now(),first_clear_post_id=v_post_id where id=v_assignment.id;
    insert into public.point_transactions(event_id,participant_id,post_id,mission_id,points,reason)
    values(p_event_id,v_participant_id,v_post_id,p_mission_id,v_mission.points,'mission_clear');
    foreach v_person in array v_mentions loop
      insert into public.point_transactions(event_id,participant_id,post_id,mission_id,points,reason)
      values(p_event_id,v_person,v_post_id,p_mission_id,v_mission.points,'mention_reward');
    end loop;
  end if;
  return v_post_id;
end $$;
revoke execute on function public.submit_mission_post(uuid,uuid,text,text,text,uuid[]) from public,anon;
grant execute on function public.submit_mission_post(uuid,uuid,text,text,text,uuid[]) to authenticated;

create or replace function public.delete_post(p_post_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_post public.posts; v_participant_id uuid; v_admin_id uuid;
begin
  select * into v_post from public.posts where id=p_post_id for update;
  if not found then raise exception 'Post not found'; end if; if v_post.deleted_at is not null then return; end if;
  select p.id into v_participant_id from public.participants p where p.event_id=v_post.event_id and p.auth_user_id=(select auth.uid()) and p.is_active=true;
  select a.id into v_admin_id from public.admin_users a where a.event_id=v_post.event_id and a.auth_user_id=(select auth.uid()) and (a.role in ('owner','admin') or a.can_manage_photos=true) limit 1;
  if v_participant_id is distinct from v_post.participant_id and v_admin_id is null then raise exception 'Not allowed'; end if;
  update public.posts set deleted_at=now(),deleted_by_participant=(v_participant_id=v_post.participant_id),deleted_by_admin_id=v_admin_id where id=p_post_id;
  update public.point_transactions set is_active=false,revoked_at=now(),revoked_by_admin_id=v_admin_id where post_id=p_post_id and is_active=true;
  update public.mission_assignments set first_cleared_at=null,first_clear_post_id=null where first_clear_post_id=p_post_id;
end $$;
revoke execute on function public.delete_post(uuid) from public,anon;
grant execute on function public.delete_post(uuid) to authenticated;

create or replace function public.edit_post_comment(p_post_id uuid,p_comment text)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if p_comment is not null and char_length(p_comment)>30 then raise exception 'Comment must be 30 characters or fewer'; end if;
  update public.posts p set comment=nullif(trim(p_comment),''),comment_updated_at=now()
  where p.id=p_post_id and p.deleted_at is null and exists(select 1 from public.participants x where x.id=p.participant_id and x.auth_user_id=(select auth.uid()));
  if not found then raise exception 'Post not found or not allowed'; end if;
end $$;
revoke execute on function public.edit_post_comment(uuid,text) from public,anon;
grant execute on function public.edit_post_comment(uuid,text) to authenticated;

create or replace function public.toggle_heart(p_post_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_post public.posts; v_participant_id uuid;
begin
  select * into v_post from public.posts where id=p_post_id and deleted_at is null; if not found then raise exception 'Post not found'; end if;
  if not exists(select 1 from public.events e where e.id=v_post.event_id and e.status='live') then raise exception 'Event is not live'; end if;
  select p.id into v_participant_id from public.participants p where p.event_id=v_post.event_id and p.auth_user_id=(select auth.uid()) and p.is_active=true;
  if v_participant_id is null then raise exception 'Participant not claimed'; end if;
  if v_participant_id=v_post.participant_id then raise exception 'You cannot heart your own post'; end if;
  if exists(select 1 from public.reactions r where r.post_id=p_post_id and r.participant_id=v_participant_id) then
    delete from public.reactions where post_id=p_post_id and participant_id=v_participant_id; return false;
  end if;
  insert into public.reactions(post_id,participant_id) values(p_post_id,v_participant_id); return true;
end $$;
revoke execute on function public.toggle_heart(uuid) from public,anon;
grant execute on function public.toggle_heart(uuid) to authenticated;

create or replace function public.create_mission_drop(p_event_id uuid,p_missions jsonb)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  v_admin public.admin_users;
  v_drop_id uuid; v_drop_number integer;
  v_mission_a uuid; v_mission_b uuid; v_mission_c uuid;
  v_count integer; v_base integer; v_remainder integer;
  v_cap_a integer; v_cap_b integer; v_cap_c integer;
  v_chosen_slot text; r record;
begin
  select * into v_admin from public.admin_users a
  where a.event_id=p_event_id and a.auth_user_id=(select auth.uid())
    and (a.role in('owner','admin') or a.can_manage_missions=true) limit 1;
  if not found then raise exception 'Mission permission required'; end if;

  perform 1 from public.events e where e.id=p_event_id for update;
  if not found then raise exception 'Event not found'; end if;
  if jsonb_array_length(p_missions)<>3 then raise exception 'Exactly 3 missions are required'; end if;

  select coalesce(max(d.drop_number),0)+1 into v_drop_number from public.mission_drops d where d.event_id=p_event_id;
  insert into public.mission_drops(event_id,drop_number,title,status,published_at,created_by)
  values(p_event_id,v_drop_number,'Drop #'||v_drop_number,'published',now(),v_admin.id) returning id into v_drop_id;

  insert into public.missions(drop_id,slot,title,difficulty,points,required_mentions)
  values(v_drop_id,'A',p_missions->0->>'title',lower(p_missions->0->>'difficulty'),(p_missions->0->>'points')::integer,(p_missions->0->>'required_mentions')::integer)
  returning id into v_mission_a;
  insert into public.missions(drop_id,slot,title,difficulty,points,required_mentions)
  values(v_drop_id,'B',p_missions->1->>'title',lower(p_missions->1->>'difficulty'),(p_missions->1->>'points')::integer,(p_missions->1->>'required_mentions')::integer)
  returning id into v_mission_b;
  insert into public.missions(drop_id,slot,title,difficulty,points,required_mentions)
  values(v_drop_id,'C',p_missions->2->>'title',lower(p_missions->2->>'difficulty'),(p_missions->2->>'points')::integer,(p_missions->2->>'required_mentions')::integer)
  returning id into v_mission_c;

  select count(*) into v_count from public.participants where event_id=p_event_id and is_active=true;
  if v_count=0 then raise exception 'No participants'; end if;
  v_base:=v_count/3; v_remainder:=v_count%3;
  v_cap_a:=v_base+case when v_remainder>=1 then 1 else 0 end;
  v_cap_b:=v_base+case when v_remainder>=2 then 1 else 0 end;
  v_cap_c:=v_base;

  for r in
    select p.id,
      (select m.slot from public.mission_assignments ma
       join public.missions m on m.id=ma.mission_id
       join public.mission_drops d on d.id=m.drop_id
       where ma.participant_id=p.id and d.event_id=p_event_id
       order by d.drop_number desc limit 1) as last_slot
    from public.participants p
    where p.event_id=p_event_id and p.is_active=true
    order by random()
  loop
    select option.slot into v_chosen_slot
    from (values ('A'::text,v_cap_a),('B'::text,v_cap_b),('C'::text,v_cap_c)) option(slot,capacity)
    where option.capacity>0
    order by
      (case when option.slot=r.last_slot then 1000 else 0 end)
      + (select count(*)*100 from public.mission_assignments pa
         join public.missions pm on pm.id=pa.mission_id
         join public.mission_drops pd on pd.id=pm.drop_id
         where pa.participant_id=r.id and pd.event_id=p_event_id and pm.slot=option.slot)
      + random()
    limit 1;

    if v_chosen_slot='A' then
      insert into public.mission_assignments(mission_id,participant_id) values(v_mission_a,r.id); v_cap_a:=v_cap_a-1;
    elsif v_chosen_slot='B' then
      insert into public.mission_assignments(mission_id,participant_id) values(v_mission_b,r.id); v_cap_b:=v_cap_b-1;
    else
      insert into public.mission_assignments(mission_id,participant_id) values(v_mission_c,r.id); v_cap_c:=v_cap_c-1;
    end if;
  end loop;

  insert into public.notifications(event_id,participant_id,type,title,body)
  values(p_event_id,null,'mission_drop','🔥 NEW DROP #'||v_drop_number,'新しいMissionが追加されました！');
  insert into public.admin_logs(event_id,admin_user_id,action,target_type,target_id,metadata)
  values(p_event_id,v_admin.id,'mission_drop_created','mission_drop',v_drop_id,jsonb_build_object('drop_number',v_drop_number,'participants',v_count));
  return v_drop_id;
end $$;
revoke execute on function public.create_mission_drop(uuid,jsonb) from public,anon;
grant execute on function public.create_mission_drop(uuid,jsonb) to authenticated;

-- RLS
alter table public.events enable row level security;
alter table public.participants enable row level security;
alter table public.admin_users enable row level security;
alter table public.mission_drops enable row level security;
alter table public.missions enable row level security;
alter table public.mission_assignments enable row level security;
alter table public.posts enable row level security;
alter table public.post_mentions enable row level security;
alter table public.connections enable row level security;
alter table public.point_transactions enable row level security;
alter table public.reactions enable row level security;
alter table public.awards enable row level security;
alter table public.award_winners enable row level security;
alter table public.stream_posts enable row level security;
alter table public.schedule_items enable row level security;
alter table public.guide_sections enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;
alter table public.admin_logs enable row level security;

drop policy if exists "authenticated can view events" on public.events;
create policy "authenticated can view events" on public.events for select to authenticated using(true);

drop policy if exists "event participants can view participant names" on public.participants;
create policy "event participants can view participant names" on public.participants for select to authenticated
using(private.current_participant_id(event_id) is not null or private.is_event_admin(event_id));

drop policy if exists "event members view admins" on public.admin_users;
create policy "event members view admins" on public.admin_users for select to authenticated
using(private.current_participant_id(event_id) is not null or private.is_event_admin(event_id));

drop policy if exists "participants view own assignments" on public.mission_assignments;
create policy "participants view own assignments" on public.mission_assignments for select to authenticated
using(participant_id in(select p.id from public.participants p where p.auth_user_id=(select auth.uid())));
drop policy if exists "admins view assignments" on public.mission_assignments;
create policy "admins view assignments" on public.mission_assignments for select to authenticated
using(exists(select 1 from public.missions m join public.mission_drops d on d.id=m.drop_id where m.id=mission_assignments.mission_id and private.is_event_admin(d.event_id)));

drop policy if exists "participants view assigned missions" on public.missions;
create policy "participants view assigned missions" on public.missions for select to authenticated
using(
  exists(select 1 from public.mission_assignments ma join public.participants p on p.id=ma.participant_id where ma.mission_id=missions.id and p.auth_user_id=(select auth.uid()))
  or exists(select 1 from public.mission_drops d where d.id=missions.drop_id and private.is_event_admin(d.event_id))
);

drop policy if exists "members view mission drops" on public.mission_drops;
create policy "members view mission drops" on public.mission_drops for select to authenticated
using(private.current_participant_id(event_id) is not null or private.is_event_admin(event_id));

drop policy if exists "event participants view active posts" on public.posts;
create policy "event participants view active posts" on public.posts for select to authenticated
using(deleted_at is null and (private.current_participant_id(event_id) is not null or private.is_event_admin(event_id)));

drop policy if exists "event participants view mentions" on public.post_mentions;
create policy "event participants view mentions" on public.post_mentions for select to authenticated
using(exists(select 1 from public.posts p where p.id=post_mentions.post_id and p.deleted_at is null and (private.current_participant_id(p.event_id) is not null or private.is_event_admin(p.event_id))));

drop policy if exists "participants view own connections" on public.connections;
create policy "participants view own connections" on public.connections for select to authenticated
using(participant_a_id in(select p.id from public.participants p where p.auth_user_id=(select auth.uid())) or participant_b_id in(select p.id from public.participants p where p.auth_user_id=(select auth.uid())) or private.is_event_admin(event_id));

drop policy if exists "participants view own points" on public.point_transactions;
create policy "participants view own points" on public.point_transactions for select to authenticated
using(participant_id in(select p.id from public.participants p where p.auth_user_id=(select auth.uid())) or private.is_event_admin(event_id));

drop policy if exists "event participants view hearts" on public.reactions;
create policy "event participants view hearts" on public.reactions for select to authenticated
using(exists(select 1 from public.posts p where p.id=reactions.post_id and p.deleted_at is null and (private.current_participant_id(p.event_id) is not null or private.is_event_admin(p.event_id))));

drop policy if exists "event participants view schedule" on public.schedule_items;
create policy "event participants view schedule" on public.schedule_items for select to authenticated
using(private.current_participant_id(event_id) is not null or private.is_event_admin(event_id));
drop policy if exists "event participants view guide" on public.guide_sections;
create policy "event participants view guide" on public.guide_sections for select to authenticated
using(private.current_participant_id(event_id) is not null or private.is_event_admin(event_id));
drop policy if exists "event participants view stream" on public.stream_posts;
create policy "event participants view stream" on public.stream_posts for select to authenticated
using(deleted_at is null and (private.current_participant_id(event_id) is not null or private.is_event_admin(event_id)));
drop policy if exists "event participants view awards" on public.awards;
create policy "event participants view awards" on public.awards for select to authenticated
using(private.current_participant_id(event_id) is not null or private.is_event_admin(event_id));
drop policy if exists "event participants view winners" on public.award_winners;
create policy "event participants view winners" on public.award_winners for select to authenticated
using(exists(select 1 from public.awards a where a.id=award_winners.award_id and (private.current_participant_id(a.event_id) is not null or private.is_event_admin(a.event_id))));
drop policy if exists "participants view notifications" on public.notifications;
create policy "participants view notifications" on public.notifications for select to authenticated
using(((participant_id is null or participant_id=private.current_participant_id(event_id)) and private.current_participant_id(event_id) is not null) or private.is_event_admin(event_id));
