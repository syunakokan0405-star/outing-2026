-- Apply after 012. All mutations and their audit records commit atomically.
begin;

-- Some live projects retain delete_post(uuid) and lack the later reason column.
alter table public.posts add column if not exists deleted_reason text;

alter table public.point_transactions
  add column if not exists adjustment_note text,
  add column if not exists adjusted_by_admin_id uuid references public.admin_users(id) on delete set null,
  add column if not exists adjustment_request_id uuid;
create unique index if not exists point_adjustment_request_unique
  on public.point_transactions(event_id, adjustment_request_id)
  where adjustment_request_id is not null;

-- Preserve notes from the existing adjustment RPC.
update public.point_transactions t
set adjustment_note = l.metadata->>'note', adjusted_by_admin_id = l.admin_user_id
from public.admin_logs l
where l.target_id = t.id and l.action = 'points_adjusted'
  and t.reason = 'manual_adjustment' and t.adjustment_note is null;

-- Only new administrative cancellations are recoverable. Old deletions may
-- already have lost their image bytes and must never be advertised as restorable.
create table if not exists public.admin_post_recovery (
  post_id uuid primary key references public.posts(id) on delete cascade,
  point_ids uuid[] not null,
  first_cleared_at timestamptz,
  cancelled_at timestamptz not null default now()
);
alter table public.admin_post_recovery enable row level security;
revoke all on public.admin_post_recovery from public, anon, authenticated;
grant select on public.admin_post_recovery to service_role;

-- Keep the original four-argument RPC usable; new callers supply a retry key.
drop function if exists public.admin_adjust_points(uuid, uuid, integer, text);
create or replace function public.admin_adjust_points(
  p_event_id uuid, p_participant_id uuid, p_points integer, p_note text,
  p_request_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid;
  v_id uuid;
  v_existing public.point_transactions;
begin
  select id into v_admin from public.admin_users
  where event_id = p_event_id and auth_user_id = auth.uid() and role in ('owner', 'admin');
  if v_admin is null then raise exception 'ポイント調整は管理者のみ操作できます。'; end if;
  if p_points is null or p_points = 0 or p_points not between -10000 and 10000 then
    raise exception '調整値は±10000以内の0以外の整数で入力してください。';
  end if;
  if nullif(btrim(p_note), '') is null or char_length(btrim(p_note)) > 500 then
    raise exception '調整理由を500文字以内で入力してください。';
  end if;
  perform 1 from public.participants where id = p_participant_id and event_id = p_event_id for update;
  if not found then raise exception '参加者が見つかりません。'; end if;
  if p_request_id is not null then
    select * into v_existing from public.point_transactions
      where event_id = p_event_id and adjustment_request_id = p_request_id;
    if found then
      if v_existing.participant_id <> p_participant_id or v_existing.points <> p_points
         or v_existing.adjustment_note <> btrim(p_note) or v_existing.adjusted_by_admin_id <> v_admin then
        raise exception '調整リクエストが一致しません。';
      end if;
      return v_existing.id;
    end if;
  end if;
  insert into public.point_transactions(event_id, participant_id, points, reason,
    adjustment_note, adjusted_by_admin_id, adjustment_request_id)
  values(p_event_id, p_participant_id, p_points, 'manual_adjustment', btrim(p_note), v_admin, p_request_id)
  returning id into v_id;
  insert into public.admin_logs(event_id, admin_user_id, action, target_type, target_id, metadata)
  values(p_event_id, v_admin, 'points_adjusted', 'point_transaction', v_id,
    jsonb_build_object('participant_id', p_participant_id, 'points', p_points, 'note', btrim(p_note)));
  return v_id;
end $$;

create or replace function public.admin_revoke_point_adjustment(p_transaction_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_t public.point_transactions; v_admin uuid;
begin
  select * into v_t from public.point_transactions where id = p_transaction_id for update;
  if not found or v_t.reason <> 'manual_adjustment' then raise exception '手動調整が見つかりません。'; end if;
  select id into v_admin from public.admin_users
  where event_id = v_t.event_id and auth_user_id = auth.uid() and role in ('owner', 'admin');
  if v_admin is null then raise exception '管理者権限が必要です。'; end if;
  if not v_t.is_active then return; end if;
  update public.point_transactions set is_active = false, revoked_at = now(), revoked_by_admin_id = v_admin
  where id = v_t.id;
  insert into public.admin_logs(event_id, admin_user_id, action, target_type, target_id)
  values(v_t.event_id, v_admin, 'point_adjustment_revoked', 'point_transaction', v_t.id);
end $$;

-- Lock the assignment before the post, matching submit_mission_post's locking
-- order. This serializes cancellation/restoration against a new mission clear.
create or replace function public.admin_cancel_post(p_post_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_post public.posts; v_clear timestamptz; v_ids uuid[]; v_admin uuid;
begin
  select * into v_post from public.posts where id = p_post_id;
  if not found then raise exception '投稿が見つかりません。'; end if;
  if not private.is_event_admin(v_post.event_id, 'photos') then raise exception '写真管理権限が必要です。'; end if;
  if nullif(btrim(p_reason), '') is null or char_length(btrim(p_reason)) > 500 then
    raise exception '取り消し理由を500文字以内で入力してください。';
  end if;
  select first_cleared_at into v_clear from public.mission_assignments
    where participant_id = v_post.participant_id and mission_id = v_post.mission_id for update;
  if not exists(select 1 from public.mission_assignments where first_clear_post_id = p_post_id) then
    v_clear := null;
  end if;
  select * into v_post from public.posts where id = p_post_id for update;
  if v_post.deleted_at is not null then return; end if;
  select coalesce(array_agg(id), '{}'::uuid[]) into v_ids
    from public.point_transactions where post_id = p_post_id and is_active;
  insert into public.admin_post_recovery(post_id, point_ids, first_cleared_at)
  values(p_post_id, v_ids, v_clear)
  on conflict(post_id) do update set point_ids = excluded.point_ids,
    first_cleared_at = excluded.first_cleared_at, cancelled_at = now();
  -- Keep administrative cancellation independent of historical delete_post overloads.
  select id into v_admin from public.admin_users
    where event_id = v_post.event_id and auth_user_id = auth.uid()
      and (role in ('owner', 'admin') or can_manage_photos);
  update public.posts set deleted_at = now(), deleted_reason = btrim(p_reason),
    deleted_by_participant = false, deleted_by_admin_id = v_admin where id = p_post_id;
  update public.point_transactions set is_active = false, revoked_at = now(),
    revoked_by_admin_id = v_admin where post_id = p_post_id and is_active;
  update public.mission_assignments set first_cleared_at = null, first_clear_post_id = null
    where first_clear_post_id = p_post_id;
  insert into public.admin_logs(event_id, admin_user_id, action, target_type, target_id, metadata)
  values(v_post.event_id, v_admin, 'post_cancelled', 'post', p_post_id,
    jsonb_build_object('reason', btrim(p_reason)));

end $$;

create or replace function public.admin_restore_post(p_post_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_post public.posts; v_recovery public.admin_post_recovery;
  v_assignment public.mission_assignments; v_admin uuid; v_restore_points boolean;
begin
  select * into v_post from public.posts where id = p_post_id;
  if not found then raise exception '投稿が見つかりません。'; end if;
  select id into v_admin from public.admin_users where event_id = v_post.event_id and auth_user_id = auth.uid()
    and (role in ('owner', 'admin') or can_manage_photos);
  if v_admin is null then raise exception '写真管理権限が必要です。'; end if;
  select * into v_assignment from public.mission_assignments
    where participant_id = v_post.participant_id and mission_id = v_post.mission_id for update;
  select * into v_post from public.posts where id = p_post_id for update;
  if v_post.deleted_at is null then return jsonb_build_object('already_restored', true); end if;
  select * into v_recovery from public.admin_post_recovery where post_id = p_post_id;
  if not found then raise exception 'この投稿は復元できません。'; end if;
  if v_post.deleted_by_participant or v_post.deleted_reason like 'retention%' then
    raise exception '本人が削除した投稿や保存期間を過ぎた投稿は復元できません。';
  end if;
  if not exists(select 1 from public.events e where e.id = v_post.event_id
    and v_post.created_at > now() - make_interval(days => e.photo_retention_days)) then
    raise exception '写真の保存期間を過ぎています。';
  end if;
  -- Do not reclaim a mission already cleared by a newer post, including its
  -- mention rewards. Only exact transaction IDs active at cancellation qualify.
  v_restore_points := v_recovery.first_cleared_at is not null and v_assignment.id is not null
    and v_assignment.first_cleared_at is null;
  if v_restore_points then
    update public.mission_assignments set first_cleared_at = v_recovery.first_cleared_at,
      first_clear_post_id = p_post_id where id = v_assignment.id;
    update public.point_transactions set is_active = true, revoked_at = null, revoked_by_admin_id = null
      where id = any(v_recovery.point_ids) and post_id = p_post_id
        and reason in ('mission_clear', 'mention_reward');
  end if;
  update public.posts set deleted_at = null, deleted_reason = null,
    deleted_by_participant = false, deleted_by_admin_id = null where id = p_post_id;
  delete from public.admin_post_recovery where post_id = p_post_id;
  insert into public.admin_logs(event_id, admin_user_id, action, target_type, target_id, metadata)
    values(v_post.event_id, v_admin, 'post_restored', 'post', p_post_id,
      jsonb_build_object('points_restored', v_restore_points));
  return jsonb_build_object('points_restored', v_restore_points);
end $$;

create or replace function public.admin_list_photos(
  p_event_id uuid, p_participant_id uuid default null,
  p_cancelled boolean default false, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_event_admin(p_event_id, 'photos') then raise exception '写真管理権限が必要です。'; end if;
  if p_offset is null or p_offset < 0 then raise exception 'Invalid offset'; end if;
  return (
    select coalesce(jsonb_agg(row_data order by created_at desc, id desc), '[]'::jsonb)
    from (
      select p.id, p.created_at, jsonb_build_object(
        'id', p.id, 'participant_id', p.participant_id, 'participant_name', u.name,
        'mission_title', m.title, 'comment', p.comment, 'visibility', p.visibility,
        'created_at', p.created_at, 'deleted_at', p.deleted_at, 'deleted_reason', p.deleted_reason,
        'can_restore', r.post_id is not null and not p.deleted_by_participant
          and p.created_at > now() - make_interval(days => e.photo_retention_days)
          and coalesce(p.deleted_reason, '') not like 'retention%',
        'earned_points', coalesce((select sum(t.points) from public.point_transactions t
          where t.post_id = p.id and t.participant_id = p.participant_id and t.is_active), 0)
      ) as row_data
      from public.posts p join public.participants u on u.id = p.participant_id
      join public.events e on e.id = p.event_id
      left join public.missions m on m.id = p.mission_id
      left join public.admin_post_recovery r on r.post_id = p.id
      where p.event_id = p_event_id and (p_participant_id is null or p.participant_id = p_participant_id)
        and ((p_cancelled and p.deleted_at is not null) or (not p_cancelled and p.deleted_at is null))
      order by p.created_at desc, p.id desc limit 60 offset p_offset
    ) page
  );
end $$;

create or replace function public.admin_update_mission_title(
  p_mission_id uuid, p_title text, p_expected_title text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_mission public.missions; v_event uuid; v_admin uuid;
begin
  select * into v_mission from public.missions where id = p_mission_id for update;
  if not found then raise exception 'Missionが見つかりません。'; end if;
  select event_id into v_event from public.mission_drops where id = v_mission.drop_id;
  select id into v_admin from public.admin_users where event_id = v_event and auth_user_id = auth.uid()
    and (role in ('owner', 'admin') or can_manage_missions);
  if v_admin is null then raise exception 'Mission管理権限が必要です。'; end if;
  if nullif(btrim(p_title), '') is null or char_length(btrim(p_title)) > 500 then
    raise exception 'お題を500文字以内で入力してください。';
  end if;
  if v_mission.title is distinct from p_expected_title then
    raise exception '別の管理者がお題を変更しました。再読み込みして確認してください。';
  end if;
  if v_mission.title = btrim(p_title) then return; end if;
  update public.missions set title = btrim(p_title) where id = p_mission_id;
  insert into public.admin_logs(event_id, admin_user_id, action, target_type, target_id, metadata)
  values(v_event, v_admin, 'mission_title_updated', 'mission', p_mission_id,
    jsonb_build_object('before', v_mission.title, 'after', btrim(p_title)));
end $$;

create or replace function public.admin_get_point_management(p_event_id uuid, p_participant_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.admin_users where event_id = p_event_id
    and auth_user_id = auth.uid() and role in ('owner', 'admin')) then
    raise exception '管理者権限が必要です。';
  end if;
  return jsonb_build_object(
    'participants', (select coalesce(jsonb_agg(row_to_json(scores) order by name), '[]'::jsonb)
      from (select p.id, p.name, coalesce(sum(t.points) filter(where t.is_active), 0) as score
        from public.participants p left join public.point_transactions t on t.participant_id = p.id
        where p.event_id = p_event_id group by p.id) scores),
    'history', (select coalesce(jsonb_agg(row_to_json(history) order by created_at desc, id desc), '[]'::jsonb)
      from (select t.id, t.points, t.adjustment_note, t.is_active, t.created_at, t.revoked_at,
          a.display_name as admin_name
        from public.point_transactions t left join public.admin_users a on a.id = t.adjusted_by_admin_id
        where t.event_id = p_event_id and t.participant_id = p_participant_id and t.reason = 'manual_adjustment'
        order by t.created_at desc, t.id desc limit 100) history)
  );
end $$;
revoke execute on function public.admin_get_point_management(uuid, uuid) from public, anon;
grant execute on function public.admin_get_point_management(uuid, uuid) to authenticated;

revoke execute on function public.admin_adjust_points(uuid, uuid, integer, text, uuid) from public, anon;
revoke execute on function public.admin_revoke_point_adjustment(uuid) from public, anon;
revoke execute on function public.admin_cancel_post(uuid, text) from public, anon;
revoke execute on function public.admin_restore_post(uuid) from public, anon;
revoke execute on function public.admin_list_photos(uuid, uuid, boolean, integer) from public, anon;
revoke execute on function public.admin_update_mission_title(uuid, text, text) from public, anon;
grant execute on function public.admin_adjust_points(uuid, uuid, integer, text, uuid) to authenticated;
grant execute on function public.admin_revoke_point_adjustment(uuid) to authenticated;
grant execute on function public.admin_cancel_post(uuid, text) to authenticated;
grant execute on function public.admin_restore_post(uuid) to authenticated;
grant execute on function public.admin_list_photos(uuid, uuid, boolean, integer) to authenticated;
grant execute on function public.admin_update_mission_title(uuid, text, text) to authenticated;
commit;
