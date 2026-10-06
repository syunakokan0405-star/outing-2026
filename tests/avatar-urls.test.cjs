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
