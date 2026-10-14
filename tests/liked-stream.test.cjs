const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { PGlite } = require('@electric-sql/pglite')

test('Liked selects 15 globally, excludes deleted/gallery/other events, orders ties newest first and honors RLS', async () => {
  const db = new PGlite()
  const event = '00000000-0000-0000-0000-000000000001'
  const other = '00000000-0000-0000-0000-000000000002'
  const id = n => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`
  try {
    await db.exec(`create role anon; create role authenticated;
      create table posts(id uuid primary key,event_id uuid,created_at timestamptz,deleted_at timestamptz,visibility text);
      create table reactions(post_id uuid,participant_id uuid);
      alter table posts enable row level security;
      alter table reactions enable row level security;
      create policy member_posts on posts for select to authenticated using(event_id = nullif(current_setting('test.event',true),'')::uuid);
      create policy member_reactions on reactions for select to authenticated using(exists(select 1 from posts where posts.id=reactions.post_id));
      grant select on posts,reactions to authenticated;`)
    for (let n = 1; n <= 20; n++) {
      await db.query('insert into posts values($1,$2,$3,null,$4)', [id(n), event, `2026-10-${String(n).padStart(2, '0')}T00:00:00Z`, 'stream'])
    }
    await db.query('insert into posts values($1,$4,now(),now(),$5),($2,$4,now(),null,$6),($3,$7,now(),null,$5)', [id(21),id(22),id(23),event,'stream','gallery',other])
    for (const post of [id(1), id(21), id(22), id(23)]) {
      for(let n=1;n<=30;n++) await db.query('insert into reactions values($1,$2)', [post,id(100+n)])
    }
    await db.exec(readFileSync('supabase/migrations/20261014134000_liked_stream.sql','utf8'))
    await db.exec(`set role authenticated; set test.event='${event}';`)
    const { rows } = await db.query('select * from get_liked_stream($1)',[event])
    assert.equal(rows.length,15)
    assert.equal(rows[0].post_id,id(1)) // Old popular photo must beat latest photos.
    assert.equal(rows[1].post_id,id(20))
    assert.equal(rows[14].post_id,id(7))
    assert.equal((await db.query('select * from get_liked_stream($1)',[other])).rows.length,0)
    await db.exec('set role anon;')
    await assert.rejects(db.query('select * from get_liked_stream($1)',[event]), /permission denied/)
  } finally { await db.close() }
})

test('ranking cache expires exactly at 60s and cannot cross participant/event boundaries', () => {
  const vm = require('node:vm')
  const ts = require('typescript')
  const api = {}
  vm.runInNewContext(ts.transpileModule(readFileSync('lib/liked-stream-cache.ts','utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, {exports:api})
  const cached = { savedAt:1000,currentParticipantId:'p',currentEventId:'e' }
  const participant = { id:'p',event_id:'e' }
  assert.equal(api.canReuseLikedStream(cached,participant,60999),true)
  assert.equal(api.canReuseLikedStream(cached,participant,61000),false)
  assert.equal(api.canReuseLikedStream(cached,{id:'other',event_id:'e'},1001),false)
  assert.equal(api.canReuseLikedStream(cached,{id:'p',event_id:'other'},1001),false)
  assert.equal(api.canReuseLikedStream(undefined,participant,1001),false)
  assert.equal(api.canReuseLikedStream(cached,participant,999),false)
})
