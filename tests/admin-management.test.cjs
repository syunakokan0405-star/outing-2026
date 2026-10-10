const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { PGlite } = require('@electric-sql/pglite')

const event = '10000000-0000-0000-0000-000000000001'
const otherEvent = '10000000-0000-0000-0000-000000000002'
const owner = '20000000-0000-0000-0000-000000000001'
const photoStaff = '20000000-0000-0000-0000-000000000002'
const participantUser = '20000000-0000-0000-0000-000000000003'
const missionStaff = '20000000-0000-0000-0000-000000000004'
const person = '30000000-0000-0000-0000-000000000001'
const mention = '30000000-0000-0000-0000-000000000002'
const foreignPerson = '30000000-0000-0000-0000-000000000003'
const drop = '40000000-0000-0000-0000-000000000001'
const mission = '50000000-0000-0000-0000-000000000001'
const post = '60000000-0000-0000-0000-000000000001'
const nextPost = '60000000-0000-0000-0000-000000000002'

async function setup() {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    insert into auth.users values ('${owner}'), ('${photoStaff}'), ('${participantUser}'), ('${missionStaff}');`)
  await db.exec(readFileSync('supabase/migrations/001_core_schema.sql', 'utf8').replace('create extension if not exists pgcrypto;', ''))
  const security = readFileSync('supabase/migrations/002_security_core.sql', 'utf8')
  await db.exec(security.slice(0, security.indexOf('create or replace function public.list_available_participants')))
  const reliability = readFileSync('supabase/migrations/007_reliability_consent_ranking.sql', 'utf8')
  await db.exec(reliability.slice(reliability.indexOf('create table if not exists public.post_deletion_logs'), reliability.indexOf('-- ---------------------------------------------------------\n-- Retention deletion audit helper')))
  await db.exec(readFileSync('supabase/migrations/013_admin_management.sql', 'utf8'))
  // Run twice to verify safe migration replay.
  await db.exec(readFileSync('supabase/migrations/013_admin_management.sql', 'utf8'))
  await db.exec(`insert into public.events(id,name,starts_at,ends_at,status) values
    ('${event}', 'Test', now(), now(), 'live'), ('${otherEvent}', 'Other', now(), now(), 'live');
    insert into public.admin_users(event_id,auth_user_id,display_name,role,can_manage_photos,can_manage_missions) values
    ('${event}', '${owner}', 'Owner', 'owner', false, false),
    ('${event}', '${photoStaff}', 'Photos', 'staff', true, false),
    ('${event}', '${missionStaff}', 'Missions', 'staff', false, true);
    insert into public.participants(id,event_id,name,auth_user_id) values
    ('${person}', '${event}', 'Alice', '${participantUser}'), ('${mention}', '${event}', 'Bob', null),
    ('${foreignPerson}', '${otherEvent}', 'Foreign', null);
    insert into public.mission_drops(id,event_id,drop_number,status) values ('${drop}', '${event}', 1, 'published');
    insert into public.missions(id,drop_id,slot,title,difficulty,points) values ('${mission}', '${drop}', 'A', 'Old title', 'easy', 50);
    insert into public.posts(id,event_id,participant_id,mission_id,image_path) values ('${post}', '${event}', '${person}', '${mission}', 'photo.webp');
    insert into public.mission_assignments(mission_id,participant_id,first_cleared_at,first_clear_post_id)
    values ('${mission}', '${person}', now(), '${post}');
    insert into public.point_transactions(event_id,participant_id,post_id,mission_id,points,reason) values
    ('${event}', '${person}', '${post}', '${mission}', 50, 'mission_clear'),
    ('${event}', '${mention}', '${post}', '${mission}', 50, 'mention_reward');`)
  await login(db, owner)
  return db
}
async function login(db, user) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ''])
}
async function call(db, expression, params = []) {
  return Object.values((await db.query(`select ${expression}`, params)).rows[0])[0]
}
async function score(db, who = person) {
  return Number(await call(db, 'coalesce(sum(points) filter(where is_active), 0) from public.point_transactions where participant_id = $1', [who]))
}

test('admin management database behavior', async t => {
  const db = await setup()
  try {
    await t.test('manual adjustments validate input, retry once, show history, and revoke once', async () => {
      const requestId = '70000000-0000-0000-0000-000000000001'
      const args = [event, person, -20, 'Correction', requestId]
      const id = await call(db, 'public.admin_adjust_points($1,$2,$3,$4,$5)', args)
      assert.equal(await call(db, 'public.admin_adjust_points($1,$2,$3,$4,$5)', args), id)
      assert.equal(await score(db), 30)
      await assert.rejects(call(db, 'public.admin_adjust_points($1,$2,$3,$4,$5)', [event, person, 20, 'Correction', requestId]), /一致/)
      for (const invalid of [0, 10001, -10001, -2147483648, null]) {
        await assert.rejects(call(db, 'public.admin_adjust_points($1,$2,$3,$4)', [event, person, invalid, 'Reason']), /調整値/)
      }
      await assert.rejects(call(db, 'public.admin_adjust_points($1,$2,$3,$4)', [event, person, 10, '  ']), /理由/)
      await assert.rejects(call(db, 'public.admin_adjust_points($1,$2,$3,$4)', [event, foreignPerson, 10, 'Reason']), /参加者/)
      const result = await call(db, 'public.admin_get_point_management($1,$2)', [event, person])
      assert.equal(result.participants.length, 2)
      assert.equal(result.history[0].adjustment_note, 'Correction')
      assert.equal(result.history[0].admin_name, 'Owner')
      await call(db, 'public.admin_revoke_point_adjustment($1)', [id])
      await call(db, 'public.admin_revoke_point_adjustment($1)', [id])
      assert.equal(await score(db), 50)
      assert.equal(Number(await call(db, "count(*) from public.admin_logs where action = 'point_adjustment_revoked'")), 1)
    })
    await t.test('participants and unrelated staff cannot mutate or list privileged data', async () => {
      for (const user of [participantUser, missionStaff, null]) {
        await login(db, user)
        await assert.rejects(call(db, 'public.admin_list_photos($1)', [event]), /権限/)
        await assert.rejects(call(db, 'public.admin_cancel_post($1,$2)', [post, 'Reason']), /権限/)
        await assert.rejects(call(db, 'public.admin_restore_post($1)', [post]), /権限/)
        await assert.rejects(call(db, 'public.admin_adjust_points($1,$2,$3,$4)', [event, person, 10, 'Reason']), /管理者/)
      }
      await login(db, photoStaff)
      await assert.rejects(call(db, 'public.admin_get_point_management($1)', [event]), /権限/)
      await assert.rejects(call(db, 'public.admin_list_photos($1)', [otherEvent]), /権限/)
    })
    await t.test('cancellation revokes both rewards, clears the mission, preserves photo, and restores idempotently', async () => {
      await login(db, photoStaff)
      await call(db, 'public.admin_cancel_post($1,$2)', [post, 'Wrong photo'])
      await call(db, 'public.admin_cancel_post($1,$2)', [post, 'Wrong photo'])
      assert.equal(await score(db), 0)
      assert.equal(await score(db, mention), 0)
      assert.equal(await call(db, 'first_clear_post_id from public.mission_assignments where participant_id = $1', [person]), null)
      const rows = await call(db, 'public.admin_list_photos($1,$2,$3)', [event, person, true])
      assert.equal(rows.length, 1)
      assert.equal(rows[0].can_restore, true)
      assert.equal(rows[0].earned_points, 0)
      assert.equal(await call(db, 'image_path from public.posts where id=$1', [post]), 'photo.webp')
      assert.deepEqual(await call(db, 'public.admin_restore_post($1)', [post]), { points_restored: true })
      assert.deepEqual(await call(db, 'public.admin_restore_post($1)', [post]), { already_restored: true })
      assert.equal(await score(db), 50)
      assert.equal(await score(db, mention), 50)
      assert.equal(await call(db, 'first_clear_post_id from public.mission_assignments where participant_id = $1', [person]), post)
      assert.equal(Number(await call(db, "count(*) from public.admin_logs where action = 'post_cancelled'")), 1)
    })
    await t.test('re-clear after cancellation restores only photo, without duplicate rewards', async () => {
      await call(db, 'public.admin_cancel_post($1,$2)', [post, 'Wrong photo'])
      await db.exec(`insert into public.posts(id,event_id,participant_id,mission_id,image_path)
        values ('${nextPost}', '${event}', '${person}', '${mission}', 'new.webp');
        update public.mission_assignments set first_clear_post_id = '${nextPost}', first_cleared_at = now();
        insert into public.point_transactions(event_id,participant_id,post_id,mission_id,points,reason)
        values ('${event}', '${person}', '${nextPost}', '${mission}', 50, 'mission_clear');`)
      assert.deepEqual(await call(db, 'public.admin_restore_post($1)', [post]), { points_restored: false })
      assert.equal(await score(db), 50)
      assert.equal(await score(db, mention), 0)
      assert.equal(await call(db, 'first_clear_post_id from public.mission_assignments where participant_id = $1', [person]), nextPost)
    })
    await t.test('title editing enforces scope, permission, nonempty title, and concurrent edit check', async () => {
      await assert.rejects(call(db, 'public.admin_update_mission_title($1,$2,$3)', [mission, 'New title', 'Old title']), /権限/)
      await login(db, missionStaff)
      await assert.rejects(call(db, 'public.admin_update_mission_title($1,$2,$3)', [mission, ' ', 'Old title']), /お題/)
      await call(db, 'public.admin_update_mission_title($1,$2,$3)', [mission, 'New title', 'Old title'])
      await assert.rejects(call(db, 'public.admin_update_mission_title($1,$2,$3)', [mission, 'Stale edit', 'Old title']), /別の管理者/)
      assert.equal(await call(db, 'title from public.missions where id = $1', [mission]), 'New title')
      assert.equal(await call(db, 'points from public.missions where id = $1', [mission]), 50)
      assert.equal(await call(db, 'mission_id from public.posts where id = $1', [post]), mission)
    })
    await t.test('historical permanent deletes are not recoverable; expired cancellations cannot restore', async () => {
      await login(db, photoStaff)
      await call(db, 'public.delete_post($1,$2)', [post, 'Old deletion'])
      await assert.rejects(call(db, 'public.admin_restore_post($1)', [post]), /復元できません/)
      await call(db, 'public.admin_cancel_post($1,$2)', [nextPost, 'Reason'])
      await db.query("update public.posts set created_at=now()-interval '91 days' where id=$1", [nextPost])
      await assert.rejects(call(db, 'public.admin_restore_post($1)', [nextPost]), /保存期間/)
      const rows = await call(db, 'public.admin_list_photos($1,$2,$3)', [event, person, true])
      assert.equal(rows.every(r => r.can_restore === false), true)
    })
  } finally { await db.close() }
})
