-- =========================================================
-- OUTING 2026
-- 009_app_alignment_and_runtime_fixes.sql
-- Run AFTER the successfully-applied 001-008 from setup.
-- =========================================================

-- Consent persistence used by the first-run UI.
alter table public.participants
  add column if not exists consented_at timestamptz,
  add column if not exists consent_version text;

create or replace function public.record_participant_consent(
  p_event_id uuid,
  p_consent_version text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if nullif(trim(p_consent_version),'') is null then
    raise exception 'Consent version required';
  end if;

  update public.participants
  set consented_at=now(),
      consent_version=trim(p_consent_version)
  where event_id=p_event_id
    and auth_user_id=(select auth.uid())
    and is_active=true;

  if not found then
    raise exception 'Participant not claimed';
  end if;
end;
$$;

revoke execute on function public.record_participant_consent(uuid,text) from public,anon;
grant execute on function public.record_participant_consent(uuid,text) to authenticated;


-- Admin Stream images also use the private outing-photos bucket.
drop policy if exists "admins upload outing photos" on storage.objects;
create policy "admins upload outing photos"
on storage.objects for insert
to authenticated
with check (
  bucket_id='outing-photos'
  and exists (
    select 1 from public.admin_users a
    where a.auth_user_id=(select auth.uid())
      and (storage.foldername(name))[1]=a.event_id::text
      and (a.role in('owner','admin') or a.can_manage_stream=true or a.can_manage_photos=true)
  )
);

-- 008 guide helper omitted required section_type in the schema.
create or replace function public.admin_save_guide_section(
  p_event_id uuid,
  p_section_id uuid,
  p_title text,
  p_body text,
  p_sort_order integer default 0,
  p_section_type text default 'other'
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_admin public.admin_users;
  v_id uuid;
begin
  select * into v_admin
  from public.admin_users a
  where a.event_id=p_event_id
    and a.auth_user_id=(select auth.uid())
    and (a.role in('owner','admin') or a.can_manage_guide=true)
  limit 1;
  if not found then raise exception 'Guide permission required'; end if;

  if nullif(trim(p_title),'') is null then raise exception 'Title required'; end if;
  if p_section_type not in ('packing','rules','place','groups','other') then
    raise exception 'Invalid section type';
  end if;

  if p_section_id is null then
    insert into public.guide_sections(event_id,section_type,title,body,sort_order)
    values(p_event_id,p_section_type,trim(p_title),nullif(trim(p_body),''),p_sort_order)
    returning id into v_id;
  else
    update public.guide_sections
    set section_type=p_section_type,
        title=trim(p_title),
        body=nullif(trim(p_body),''),
        sort_order=p_sort_order,
        updated_at=now()
    where id=p_section_id and event_id=p_event_id
    returning id into v_id;
    if v_id is null then raise exception 'Guide section not found'; end if;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.admin_save_guide_section(uuid,uuid,text,text,integer,text) from public,anon;
grant execute on function public.admin_save_guide_section(uuid,uuid,text,text,integer,text) to authenticated;

-- 001 allows 'manual_adjustment'; use that exact enum/check value.
create or replace function public.admin_adjust_points(
  p_event_id uuid,
  p_participant_id uuid,
  p_points integer,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_admin public.admin_users;
  v_transaction_id uuid;
begin
  select * into v_admin
  from public.admin_users a
  where a.event_id=p_event_id
    and a.auth_user_id=(select auth.uid())
    and a.role in('owner','admin')
  limit 1;
  if not found then raise exception 'Admin permission required'; end if;
  if p_points=0 then raise exception 'Points cannot be zero'; end if;
  if abs(p_points)>10000 then raise exception 'Point adjustment too large'; end if;
  if nullif(trim(p_note),'') is null then raise exception 'Adjustment note required'; end if;
  if not exists(select 1 from public.participants p where p.id=p_participant_id and p.event_id=p_event_id) then
    raise exception 'Participant not found';
  end if;

  insert into public.point_transactions(event_id,participant_id,points,reason,is_active)
  values(p_event_id,p_participant_id,p_points,'manual_adjustment',true)
  returning id into v_transaction_id;

  insert into public.admin_logs(event_id,admin_user_id,action,target_type,target_id,metadata)
  values(p_event_id,v_admin.id,'points_adjusted','point_transaction',v_transaction_id,
         jsonb_build_object('participant_id',p_participant_id,'points',p_points,'note',trim(p_note)));

  return v_transaction_id;
end;
$$;

-- Awards schema from 001 is post-based; replace the 008 winner helper accordingly.
drop function if exists public.admin_set_award_winner(uuid,uuid,uuid);

create or replace function public.admin_set_award_winner(
  p_award_id uuid,
  p_post_id uuid
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_award public.awards;
  v_admin public.admin_users;
begin
  select * into v_award from public.awards where id=p_award_id;
  if not found then raise exception 'Award not found'; end if;

  select * into v_admin
  from public.admin_users a
  where a.event_id=v_award.event_id
    and a.auth_user_id=(select auth.uid())
    and (a.role in('owner','admin') or a.can_manage_awards=true)
  limit 1;
  if not found then raise exception 'Award permission required'; end if;

  if not exists(
    select 1 from public.posts p
    where p.id=p_post_id and p.event_id=v_award.event_id and p.deleted_at is null
  ) then raise exception 'Invalid post'; end if;

  insert into public.award_winners(award_id,post_id,selected_by)
  values(p_award_id,p_post_id,v_admin.id)
  on conflict(award_id,post_id) do update set selected_by=excluded.selected_by;
end;
$$;

revoke execute on function public.admin_set_award_winner(uuid,uuid) from public,anon;
grant execute on function public.admin_set_award_winner(uuid,uuid) to authenticated;

select '009 OK' as status;
