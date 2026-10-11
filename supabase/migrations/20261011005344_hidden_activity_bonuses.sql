begin;
-- Preserve all pre-existing point reasons, including profile photo bonuses.
do $migration$
declare item record; att smallint;
begin
 select attnum into att from pg_attribute where attrelid='public.point_transactions'::regclass and attname='reason';
 for item in select conname, pg_get_expr(conbin,conrelid) expression from pg_constraint
 where conrelid='public.point_transactions'::regclass and contype='c' and conkey=array[att]::smallint[] loop
  if position('hidden_home_icon' in item.expression)=0 then
   execute format('alter table public.point_transactions drop constraint %I',item.conname);
   execute format('alter table public.point_transactions add constraint %I check ((%s) or reason in (''hidden_connections_20'',''hidden_hearts_15'',''hidden_home_icon'',''hidden_schedule_read'',''hidden_rules_read''))',item.conname,item.expression);
  end if;
 end loop;
end;
$migration$;

-- Only this authenticated helper may write points. Row lock serializes retries.
create or replace function private.claim_hidden_bonus(p_event_id uuid,p_kind text)
returns integer language plpgsql security definer set search_path='' as $function$
declare person uuid; amount integer; reason_value text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select id into person from public.participants
 where event_id=p_event_id and auth_user_id=auth.uid() and is_active=true limit 1 for update;
 if person is null then raise exception 'Participant not found'; end if;
 amount := case p_kind when 'connections_20' then 50 when 'hearts_15' then 30
 when 'home_icon' then 1 when 'schedule_read' then 5 when 'rules_read' then 5 else null end;
 if amount is null then raise exception 'Invalid bonus'; end if;
 reason_value := 'hidden_' || p_kind;
 -- Revoked awards remain claimed; users cannot restore them themselves.
 if exists(select 1 from public.point_transactions where participant_id=person and reason=reason_value) then return 0; end if;
 if p_kind='connections_20' and (select count(distinct case when participant_a_id=person then participant_b_id else participant_a_id end)
 from public.connections where event_id=p_event_id and (participant_a_id=person or participant_b_id=person))<=20 then return 0; end if;
 if p_kind='hearts_15' and (select count(distinct r.post_id) from public.reactions r join public.posts p on p.id=r.post_id
 where r.participant_id=person and p.event_id=p_event_id and p.participant_id<>person and p.deleted_at is null)<15 then return 0; end if;
 if p_kind in ('schedule_read','rules_read') and not exists(select 1 from public.guide_sections
 where event_id=p_event_id and section_type=case p_kind when 'schedule_read' then 'schedule' else 'rules' end) then return 0; end if;
 insert into public.point_transactions(event_id,participant_id,points,reason,is_active) values(p_event_id,person,amount,reason_value,true);
 return amount;
end;
$function$;
create or replace function public.claim_hidden_bonus(p_event_id uuid,p_kind text)
returns integer language sql security invoker set search_path='' as $function$
 select private.claim_hidden_bonus(p_event_id,p_kind);
$function$;
revoke all on function private.claim_hidden_bonus(uuid,text) from public,anon;
revoke all on function public.claim_hidden_bonus(uuid,text) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.claim_hidden_bonus(uuid,text) to authenticated;
grant execute on function public.claim_hidden_bonus(uuid,text) to authenticated;
commit;
