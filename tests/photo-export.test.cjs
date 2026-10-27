const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
function setup(admin, rows = []) {
  const calls = [], exports = {}
  const db = { from(table) {
    const state = { table }; calls.push(state)
    const q = { select(value) { state.select = value; return q }, eq(k,v) { state[k] = v; return q },
      is(k,v) { state[k] = v; return q }, order() { return q },
      async range(a,b) { return { data: table === 'posts' ? rows.slice(a,b+1) : [], error: null } },
      async single() { return { data: { storage_provider: 'r2', r2_object_key: 'original.webp', r2_thumbnail_key: 'thumb.webp' }, error: null } } }
    return q
  } }
  const js = ts.transpileModule(readFileSync('app/api/admin/photos/export/route.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  vm.runInNewContext(js, { exports, URL, Response, console, require(name) {
    if(name === 'next/server') return { NextResponse: Response }
    if(name === '@/lib/auth') return { getCurrentAdmin: async () => admin, getEventId: () => 'event-a' }
    if(name === '@/lib/supabase/admin') return { createAdminClient: () => db }
    if(name === '@aws-sdk/client-s3') return { GetObjectCommand: class { constructor(input) { this.input=input } } }
    if(name === '@/lib/r2') return { R2_BUCKET_NAME: 'photos', r2: { async send(cmd) { calls.push(cmd.input); return { ContentType:'image/webp', Body: { async transformToByteArray() { return new Uint8Array([1,2,255]) } } } } } }
    throw Error(name)
  } })
  return { get: url => exports.GET(new Request(url)), calls }
}
test('export rejects participants and staff without photo permission before reading data', async () => {
  for(const admin of [null, {role:'staff',can_manage_photos:false}]) {
    const s=setup(admin); assert.equal((await s.get('https://test/export')).status,403); assert.equal(s.calls.length,0)
  }
})
test('export includes all pages and gallery/test posts, scoped to event and excluding deleted rows', async () => {
  const rows=Array.from({length:1001},(_,id)=>({id:String(id),visibility:'gallery',mission_id:'test'}))
  const s=setup({role:'owner'},rows), res=await s.get('https://test/export')
  const body=await res.json(); assert.equal(body.posts.length,1001)
  for(const call of s.calls) { assert.equal(call.event_id,'event-a'); assert.equal(call.deleted_at,null); assert.equal(call.visibility,undefined) }
  assert.equal(res.headers.get('cache-control'),'private, no-store')
})
test('image export returns original bytes instead of thumbnail under photo authorization',async()=>{
  const s=setup({role:'staff',can_manage_photos:true})
  const res=await s.get('https://test/export?id=12345678-1234-1234-1234-123456789abc')
  assert.equal(res.status,200); assert.deepEqual([...new Uint8Array(await res.arrayBuffer())],[1,2,255])
  assert.equal(s.calls.at(-1).Key,'original.webp')
})
