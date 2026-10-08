const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const source = ts.transpileModule(readFileSync('lib/avatar-urls.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
function setup(fetch) {
  const exports = {}
  vm.runInNewContext(source, { exports, fetch, console: { error() {} } })
  const signedPaths = []
  const supabase = { storage: { from(bucket) {
    assert.equal(bucket, 'outing-photos')
    return { async createSignedUrls(paths) {
      signedPaths.push(...paths)
      return { data: paths.map(path => ({ path, signedUrl: `legacy:${path}` })), error: null }
    } }
  } } }
  return { exports, signedPaths, supabase }
}
test('mixed R2 and legacy avatars use the correct provider and deduplicate IDs', async () => {
  const calls = []
  const { exports, signedPaths, supabase } = setup(async (url, options) => {
    assert.equal(url, '/api/r2/avatar-read-urls')
    calls.push(JSON.parse(options.body).participantIds)
    return { ok: true, json: async () => ({ urls: { p1: 'r2:new' } }) }
  })
  const result = await exports.avatarUrlMap(supabase, [
    { id: 'p1', avatar_path: 'avatars/p1/new.webp' },
    { id: 'p1', avatar_path: 'avatars/p1/new.webp' },
    { id: 'p2', avatar_path: 'avatars/p2/avatar.jpg' },
    { id: 'p3', avatar_path: null },
  ])
  assert.deepEqual(signedPaths, ['avatars/p2/avatar.jpg'])
  assert.deepEqual(calls, [['p1']])
  assert.equal(result.get('avatars/p1/new.webp'), 'r2:new')
  assert.equal(result.get('avatars/p2/avatar.jpg'), 'legacy:avatars/p2/avatar.jpg')
})
test('R2 outage preserves legacy avatar results', async () => {
  const { exports, supabase } = setup(async () => ({ ok: false }))
  const result = await exports.avatarUrlMap(supabase, [
    { id: 'p1', avatar_path: 'avatars/p1/avatar.webp' },
    { id: 'p2', avatar_path: 'avatars/p2/avatar.jpg' },
  ])
  assert.equal(result.get('avatars/p2/avatar.jpg'), 'legacy:avatars/p2/avatar.jpg')
  assert.equal(result.has('avatars/p1/avatar.webp'), false)
})
test('large lists obey the avatar API batch limit', async () => {
  const lengths = []
  const { exports, supabase } = setup(async (_, options) => {
    lengths.push(JSON.parse(options.body).participantIds.length)
    return { ok: true, json: async () => ({ urls: {} }) }
  })
  await exports.avatarUrlMap(supabase, Array.from({ length: 151 }, (_, i) => ({ id: String(i), avatar_path: `avatars/${i}/new.webp` })))
  assert.deepEqual(lengths, [150, 1])
})

function browserSetup(store = new Map(), { cacheFailure = false, downloadFailure = false } = {}) {
  const exports = {}
  const calls = { signatures: 0, images: 0, blobs: 0 }
  const cache = {
    async match(request) { return store.get(request.url)?.clone() },
    async put(request, response) { store.set(request.url, response.clone()) },
  }
  const context = {
    exports, Request, Response, Blob,
    URL: { createObjectURL() { return `blob:test-${++calls.blobs}` } },
    window: { location: { origin: 'https://outing.test' }, caches: {} },
    caches: { async open(name) {
      assert.equal(name, 'outing-avatar-images-v1')
      if (cacheFailure) throw new Error('storage unavailable')
      return cache
    } },
    console: { error() {} },
    async fetch(url, options) {
      if (url === '/api/r2/avatar-read-urls') {
        calls.signatures++
        const { participantIds } = JSON.parse(options.body)
        return { ok: true, json: async () => ({ urls: Object.fromEntries(participantIds.map(id => [id, `https://r2.test/${id}`])) }) }
      }
      calls.images++
      if (downloadFailure) throw new Error('network down')
      return new Response(new Blob(['avatar'], { type: 'image/webp' }))
    },
  }
  vm.runInNewContext(source, context)
  return { exports, calls, store, supabase: {} }
}
const photo = { id: 'p1', avatar_path: 'avatars/p1/first.webp' }
test('overlapping screen loads share signature and download; revisits need neither', async () => {
  const b = browserSetup()
  const results = await Promise.all([
    b.exports.avatarUrlMap(b.supabase, [photo]),
    b.exports.avatarUrlMap(b.supabase, [photo]),
    b.exports.avatarUrlMap(b.supabase, [photo]),
  ])
  for (const result of results) assert.equal(result.get(photo.avatar_path), 'blob:test-1')
  assert.equal(b.calls.signatures,1)
  assert.equal(b.calls.images,1)
  assert.equal(b.calls.blobs,1)
  await b.exports.avatarUrlMap(b.supabase, [photo])
  assert.equal(b.calls.signatures,1)
  assert.equal(b.calls.images,1)
})
test('device cache survives a module/page restart without signature or download', async () => {
  const first = browserSetup()
  await first.exports.avatarUrlMap(first.supabase, [photo])
  const restarted = browserSetup(first.store)
  const result = await restarted.exports.avatarUrlMap(restarted.supabase, [photo])
  assert.ok(result.get(photo.avatar_path).startsWith('blob:'))
  assert.equal(restarted.calls.signatures,0)
  assert.equal(restarted.calls.images,0)
})
test('upload seeds the cache for all screens; a changed key downloads a new revision', async () => {
  const b = browserSetup()
  const seeded = await b.exports.writeCachedAvatar(photo.id, photo.avatar_path, new Blob(['uploaded']))
  assert.equal((await b.exports.avatarUrlMap(b.supabase,[photo])).get(photo.avatar_path), seeded)
  assert.equal(b.calls.signatures,0)
  assert.equal(b.calls.images,0)
  const next = { ...photo, avatar_path: 'avatars/p1/second.webp' }
  const result = await b.exports.avatarUrlMap(b.supabase,[next])
  assert.notEqual(result.get(next.avatar_path),seeded)
  assert.equal(b.calls.images,1)
})
test('storage failure still shares the image in memory', async () => {
  const b = browserSetup(new Map(), { cacheFailure: true })
  await b.exports.avatarUrlMap(b.supabase,[photo])
  await b.exports.avatarUrlMap(b.supabase,[photo])
  assert.equal(b.calls.images,1)
})
test('download failure falls back to signed URL and clears the reservation for retry', async () => {
  const b = browserSetup(new Map(), { downloadFailure: true })
  const result = await b.exports.avatarUrlMap(b.supabase,[photo])
  assert.equal(result.get(photo.avatar_path),'https://r2.test/p1')
  await b.exports.avatarUrlMap(b.supabase,[photo])
  assert.equal(b.calls.signatures,2)
})
