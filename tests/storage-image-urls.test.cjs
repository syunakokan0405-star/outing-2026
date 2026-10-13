const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function setup() {
  let failures = 1, downloads = 0, saved = 0
  const exports = {}
  const source = ts.transpileModule(readFileSync('lib/storage-image-urls.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const cache = { async match() {}, async put() { saved++ } }
  vm.runInNewContext(source, {
    exports, require: () => ({ isBackgroundPath: () => true, backgroundAssetUrl: path => '/assets/' + path }),
    process: { env: {} }, window: { location: { origin: 'https://outing.test' }, caches: {} },
    caches: { async open() { return cache } }, Request, Response,
    URL: { createObjectURL: () => 'blob:mission' }, console: { error() {} },
    fetch: async () => { downloads++; return failures-- > 0 ? new Response('', { status: 503 }) : new Response('image') },
  })
  return { load: paths => exports.storageImageUrlMap({}, paths), get downloads() { return downloads }, get saved() { return saved } }
}

test('failed mission image fetch stays retryable and successful retry is shared', async () => {
  const app = setup()
  assert.equal((await app.load(['mission.jpg'])).size, 0)
  assert.equal(app.saved, 0)
  const [a, b] = await Promise.all([app.load(['mission.jpg']), app.load(['mission.jpg'])])
  assert.equal(a.get('mission.jpg'), 'blob:mission')
  assert.equal(b.get('mission.jpg'), 'blob:mission')
  assert.equal(app.downloads, 2)
  assert.equal(app.saved, 1)
  assert.equal((await app.load(['mission.jpg'])).get('mission.jpg'), 'blob:mission')
  assert.equal(app.downloads, 2)
})

test('replacement path downloads a new image rather than reusing the old mission image', async () => {
  const app = setup()
  await app.load(['old.jpg'])
  await app.load(['old.jpg'])
  await app.load(['new.jpg'])
  assert.equal(app.downloads, 3)
  assert.equal(app.saved, 2)
})
