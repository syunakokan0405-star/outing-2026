-- Outing 2026: the three organizing chairs can still be tagged but earn no mention reward.
-- Keep this in private so a participant cannot opt out/in through the client.
create table if not exists private.mention_reward_exclusions (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.mention_reward_exclusions enable row level security;
revoke all on private.mention_reward_exclusions from public, anon, authenticated;

-- Use the official roster spelling, not a typed nickname. IDs remain stable if names change.
insert into private.mention_reward_exclusions(participant_id)
select p.id
from public.participants p
join public.events e on e.id = p.event_id
where e.name = 'Outing 2026'
  and p.name in ('青木 遥信', '脇田 凜々奈', '長谷川 幌')
on conflict (participant_id) do nothing;

-- Exclusion is enforced on the transaction ledger, not merely in ranking displays.
-- This also prevents a canceled post restoration from reactivating excluded rewards.
create or replace function private.enforce_mention_reward_exclusion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reason = 'mention_reward'
     and exists (
       select 1 from private.mention_reward_exclusions e
       where e.participant_id = new.participant_id
     )
  then
    if tg_op = 'INSERT' then
      return null; -- mention, connection, and mission clear remain valid
    end if;
    new.is_active := false;
    new.revoked_at := coalesce(new.revoked_at, now());
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_mention_reward_exclusion() from public, anon, authenticated;

drop trigger if exists trg_enforce_mention_reward_exclusion on public.point_transactions;
create trigger trg_enforce_mention_reward_exclusion
before insert or update of participant_id, reason, is_active
on public.point_transactions
for each row
execute function private.enforce_mention_reward_exclusion();

-- Remove previously accrued mention-only points, while retaining all other points.
update public.point_transactions t
set is_active = false,
    revoked_at = coalesce(t.revoked_at, now())
where t.reason = 'mention_reward'
  and t.is_active = true
  and exists (
    select 1 from private.mention_reward_exclusions e
    where e.participant_id = t.participant_id
  );
