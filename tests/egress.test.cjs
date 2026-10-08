const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
function moduleAt(file, globals) {
  const exports = {}
  const js = ts.transpileModule(readFileSync(file,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  vm.runInNewContext(js,{ exports, console: { error() {} }, ...globals })
  return exports
}
function storageSetup(store = new Map()) {
  const counts = { signatures: 0, downloads: 0 }
  const exports = moduleAt('lib/storage-image-urls.ts', {
    window: { location: { origin: 'https://outing.test' }, caches: {} }, Request, Response, Blob,
    caches: { async open() { return {
      async match(req) { return store.get(req.url)?.clone() },
      async put(req,res) { store.set(req.url,res.clone()) },
    } } },
    URL: { createObjectURL() { return 'blob:cached' } },
    async fetch() { counts.downloads++; return new Response(new Blob(['image'])) },
  })
  const supabase = { storage: { from() { return { async createSignedUrls(paths) {
    counts.signatures++
    return { data: paths.map(path => ({path,signedUrl:`https://storage.test/${path}`})),error:null }
  } } } } }
  return { exports, supabase, counts, store }
}
test('Home/list/detail overlapping images share signatures/downloads and survive reload', async () => {
  const b = storageSetup()
  const [a,c] = await Promise.all([
    b.exports.storageImageUrlMap(b.supabase,['event/mission.webp']),
    b.exports.storageImageUrlMap(b.supabase,['event/mission.webp']),
  ])
  assert.equal(a.get('event/mission.webp'),c.get('event/mission.webp'))
  assert.deepEqual(b.counts,{signatures:1,downloads:1})
  await b.exports.storageImageUrlMap(b.supabase,['event/mission.webp'])
  assert.deepEqual(b.counts,{signatures:1,downloads:1})
  const restarted = storageSetup(b.store)
  await restarted.exports.storageImageUrlMap(restarted.supabase,['event/mission.webp'])
  assert.deepEqual(restarted.counts,{signatures:0,downloads:0})
})
test('different image path fetches a new image; failures clear reservations for retry', async () => {
  const b = storageSetup()
  await b.exports.storageImageUrlMap(b.supabase,['first.webp'])
  await b.exports.storageImageUrlMap(b.supabase,['second.webp'])
  assert.deepEqual(b.counts,{signatures:2,downloads:2})
  const bad = {storage:{from(){return {async createSignedUrls(){throw new Error('offline')}}}}}
  await b.exports.storageImageUrlMap(bad,['third.webp'])
  assert.equal((await b.exports.storageImageUrlMap(b.supabase,['third.webp'])).size,1)
})
function participantSetup() {
  let user = 'first'
  let now = 0
  let calls = 0
  let authListener
  let profileListener
  const exports = moduleAt('lib/browser-participant.ts', {
    process: {env:{NEXT_PUBLIC_EVENT_ID:'event'}},
    Date: {now:() => now},
    window:{addEventListener(_, fn){profileListener = fn}},
  })
  const supabase = {
    auth:{onAuthStateChange(fn){authListener=fn},async getSession(){return {data:{session:user?{user:{id:user}}:null},error:null}}},
    from(){const id=user;calls++;const query={select(){return query},eq(){return query},async maybeSingle(){return {data:{id,event_id:'event',name:id,avatar_path:null},error:null}}};return query},
  }
  return {exports,supabase,get calls(){return calls},time(value){now=value},user(value){user=value},auth(event){authListener(event)},profile(){profileListener()}}
}
test('membership is shared, expires after 30 seconds and invalidates on profile changes', async () => {
  const b = participantSetup()
  await Promise.all([b.exports.getBrowserParticipant(b.supabase),b.exports.getBrowserParticipant(b.supabase)])
  assert.equal(b.calls,1)
  await b.exports.getBrowserParticipant(b.supabase)
  assert.equal(b.calls,1)
  b.time(30_001)
  await b.exports.getBrowserParticipant(b.supabase)
  assert.equal(b.calls,2)
  b.profile()
  await b.exports.getBrowserParticipant(b.supabase)
  assert.equal(b.calls,3)
})
test('membership never carries over to another account or signed-out UI', async () => {
  const b = participantSetup()
  await b.exports.getBrowserParticipant(b.supabase)
  b.user('second')
  assert.equal((await b.exports.getBrowserParticipant(b.supabase)).id,'second')
  b.user(null); b.auth('SIGNED_OUT')
  assert.equal(await b.exports.getBrowserParticipant(b.supabase),null)
  b.user('first'); b.auth('SIGNED_IN')
  assert.equal((await b.exports.getBrowserParticipant(b.supabase)).id,'first')
  assert.equal(b.calls,3)
})
test('duplicate heart INSERT/DELETE notifications cannot inflate or reduce counts twice', () => {
  const {applyReactionChange} = moduleAt('lib/feed-reactions.ts',{})
  let rows=[]
  rows=applyReactionChange(rows,'person','INSERT')
  rows=applyReactionChange(rows,'person','INSERT')
  assert.equal(rows.length,1)
  rows=applyReactionChange(rows,'person','DELETE')
  rows=applyReactionChange(rows,'person','DELETE')
  assert.equal(rows.length,0)
  assert.equal(applyReactionChange(rows,'person','UPDATE'),undefined)
})

test('a participant claimed after an empty lookup is visible immediately', async () => {
  const exports = moduleAt('lib/browser-participant.ts', { process:{env:{}},Date,window:{addEventListener(){}} })
  let claimed = false
  let calls = 0
  const supabase = {
    auth:{onAuthStateChange(){},async getSession(){return {data:{session:{user:{id:'u'}}},error:null}}},
    from(){calls++;const q={select(){return q},eq(){return q},async maybeSingle(){return {data:claimed?{id:'p',event_id:'e'}:null,error:null}}};return q},
  }
  assert.equal(await exports.getBrowserParticipant(supabase),null)
  claimed=true
  assert.equal((await exports.getBrowserParticipant(supabase)).id,'p')
  assert.equal(calls,2)
})
test('sign-out during a membership lookup cannot restore the old UI identity', async () => {
  let listener, complete
  const exports = moduleAt('lib/browser-participant.ts', {process:{env:{}},Date,window:{addEventListener(){}}})
  const supabase = {
    auth:{onAuthStateChange(fn){listener=fn},async getSession(){return {data:{session:{user:{id:'old'}}},error:null}}},
    from(){const q={select(){return q},eq(){return q},maybeSingle(){return new Promise(resolve => complete=resolve)}};return q},
  }
  const result=exports.getBrowserParticipant(supabase)
  await new Promise(resolve=>setImmediate(resolve))
  listener('SIGNED_OUT')
  complete({data:{id:'old-participant'},error:null})
  assert.equal(await result,null)
})
