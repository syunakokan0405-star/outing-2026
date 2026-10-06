-- Profile photos: legacy JPG + R2 WebP revisions; one 50-point bonus per participant.
-- Run in Supabase SQL Editor before deploying the updated avatar upload API.
begin;

-- Preserve existing allowed reason values while admitting the profile bonus.
-- Only change single-column reason checks; leave all other checks untouched.
do $migration$
declare
  v_reason_attnum smallint;
  v_constraint record;
begin
  select attnum into v_reason_attnum
  from pg_catalog.pg_attribute
  where attrelid = 'public.point_transactions'::regclass
    and attname = 'reason' and not attisdropped;

  for v_constraint in
    select conname, pg_catalog.pg_get_expr(conbin, conrelid) as expression
    from pg_catalog.pg_constraint
    where conrelid = 'public.point_transactions'::regclass
      and contype = 'c' and conkey = array[v_reason_attnum]::smallint[]
  loop
    if position('profile_photo_bonus' in v_constraint.expression) = 0 then
      execute format('alter table public.point_transactions drop constraint %I', v_constraint.conname);
      execute format(
        'alter table public.point_transactions add constraint %I check ((%s) or reason = %L)',
        v_constraint.conname, v_constraint.expression, 'profile_photo_bonus'
      );
    end if;
  end loop;
end;
$migration$;

create or replace function public.set_my_avatar(p_event_id uuid, p_avatar_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_participant_id uuid;
  v_prefix text;
  v_filename text;
begin
  select p.id into v_participant_id
  from public.participants p
  where p.event_id = p_event_id and p.auth_user_id = auth.uid() and p.is_active = true
  limit 1
  for update;

  if v_participant_id is null then
    raise exception 'participant_not_found';
  end if;

  v_prefix := 'avatars/' || v_participant_id::text || '/';
  v_filename := substr(p_avatar_path, length(v_prefix) + 1);
  if p_avatar_path is null
    or left(p_avatar_path, length(v_prefix)) <> v_prefix
    or not (
      v_filename in ('avatar.jpg', 'avatar.webp')
      or v_filename ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
    )
  then
    raise exception 'invalid_avatar_path';
  end if;

  update public.participants set avatar_path = p_avatar_path where id = v_participant_id;
end;
$function$;

create or replace function public.claim_profile_photo_bonus(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_participant_id uuid;
  v_avatar_path text;
begin
  -- Serialize claims for the same participant, including concurrent requests.
  select p.id, p.avatar_path into v_participant_id, v_avatar_path
  from public.participants p
  where p.auth_user_id = auth.uid() and p.event_id = p_event_id and p.is_active = true
  limit 1
  for update;

  if v_participant_id is null then
    raise exception 'Participant not found';
  end if;
  if v_avatar_path is null or btrim(v_avatar_path) = '' then
    raise exception 'Profile photo is not set';
  end if;

  -- An existing historical award also counts. Do not restore revoked points or
  -- modify duplicate historical entries automatically.
  if exists (
    select 1 from public.point_transactions t
    where t.participant_id = v_participant_id and t.reason = 'profile_photo_bonus'
  ) then
    return 0;
  end if;

  insert into public.point_transactions(event_id, participant_id, points, reason, is_active)
  values (p_event_id, v_participant_id, 50, 'profile_photo_bonus', true);
  return 50;
end;
$function$;

revoke execute on function public.set_my_avatar(uuid, text) from public, anon;
revoke execute on function public.claim_profile_photo_bonus(uuid) from public, anon;
grant execute on function public.set_my_avatar(uuid, text) to authenticated;
grant execute on function public.claim_profile_photo_bonus(uuid) to authenticated;

commit;
