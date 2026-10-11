const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { PGlite } = require('@electric-sql/pglite')
test('hidden bonuses validate eligibility, event scope, authentication, thresholds and single awards', async () => {
 const db = new PGlite()
 try {
 await db.exec(`create role anon; create role authenticated; create schema auth; create schema private;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.participants(id uuid primary key,event_id uuid,auth_user_id uuid,is_active boolean);
 create table public.point_transactions(event_id uuid,participant_id uuid,points integer,reason text check(reason in ('mission_clear','profile_photo_bonus')),is_active boolean);
 create table public.connections(event_id uuid,participant_a_id uuid,participant_b_id uuid);
 create table public.posts(id uuid,event_id uuid,participant_id uuid,deleted_at timestamptz);
 create table public.reactions(post_id uuid,participant_id uuid);
 create table public.guide_sections(event_id uuid,section_type text);`)
 const sql=readFileSync('supabase/migrations/20261011005344_hidden_activity_bonuses.sql','utf8')
 await db.exec(sql); await db.exec(sql)
 const event='10000000-0000-0000-0000-000000000001', person='20000000-0000-0000-0000-000000000001', user='30000000-0000-0000-0000-000000000001'
 await db.query('insert into participants values($1,$2,$3,true)',[person,event,user])
 const claim=async kind => (await db.query('select public.claim_hidden_bonus($1,$2) points',[event,kind])).rows[0].points
 await assert.rejects(claim('home_icon'),/Authentication required/)
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user])
 assert.equal(await claim('home_icon'),1); assert.equal(await claim('home_icon'),0)
 await db.exec("update point_transactions set is_active=false")
 assert.equal(await claim('home_icon'),0)
 await assert.rejects(claim('bogus'),/Invalid bonus/)
 assert.equal(await claim('schedule_read'),0)
 await db.query("insert into guide_sections values($1,'schedule'),($1,'rules')",[event])
 assert.equal(await claim('schedule_read'),5); assert.equal(await claim('rules_read'),5)
 for(let i=1;i<=21;i++) {
  const other=`40000000-0000-0000-0000-${String(i).padStart(12,'0')}`
  await db.query('insert into connections values($1,$2,$3)',[event,person,other])
  if(i===20) assert.equal(await claim('connections_20'),0)
 }
 assert.equal(await claim('connections_20'),50); assert.equal(await claim('connections_20'),0)
 for(let i=1;i<=15;i++) {
  const post=`50000000-0000-0000-0000-${String(i).padStart(12,'0')}`
  await db.query('insert into posts values($1,$2,$3,null)',[post,event,i===15?person:user])
  await db.query('insert into reactions values($1,$2)',[post,person])
 }
 assert.equal(await claim('hearts_15'),0) // self-heart excluded
 await db.query('update posts set participant_id=$1 where participant_id=$2',[user,person])
 await db.exec('update posts set deleted_at=now()')
 assert.equal(await claim('hearts_15'),0)
 await db.exec('update posts set deleted_at=null')
 assert.equal(await claim('hearts_15'),30); assert.equal(await claim('hearts_15'),0)
 await db.query('update participants set is_active=false where id=$1',[person])
 await assert.rejects(claim('rules_read'),/Participant not found/)
 const perms=await db.query("select has_function_privilege('anon','public.claim_hidden_bonus(uuid,text)','execute') allowed")
 assert.equal(perms.rows[0].allowed,false)
 } finally { await db.close() }
})
