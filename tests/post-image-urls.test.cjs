const {test} = require('node:test')
const assert = require('node:assert/strict')
const {readFileSync} = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
function setup({cached=false,broken=false}={}) {
  const calls=[]
  let now=0
  let fails=0
  const exports={}
  const js=ts.transpileModule(readFileSync('lib/post-image-urls.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
  vm.runInNewContext(js,{exports,Request,Date:{now:()=>now},window:{location:{origin:'https://test.local'},caches:{}},
    caches:{async open(){if(broken)throw Error('cache unavailable');return {async match(req){return cached && req.url.includes('stream-original')?{}:undefined}}}},
    async fetch(_url, options){const body=JSON.parse(options.body);calls.push(body);if(fails){fails--;throw Error('offline')};await Promise.resolve();return {ok:true,async json(){return {urls:Object.fromEntries(body.postIds.map(id=>[id,`https://images/${body.variant}/${id}`]))}}}},
  })
  return {exports,calls,time(n){now=n},fail(){fails++}}
}
const post=id=>({id,storage_provider:'r2',r2_object_key:`${id}.webp`,r2_thumbnail_key:`${id}-thumb.webp`})
test('stream and gallery mount the image loader for cached R2 posts without a signed URL',()=>{
  const source=ts.createSourceFile('LivePosts.tsx',readFileSync('components/LivePosts.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  const conditions=[]
  function visit(node){
    if(ts.isConditionalExpression(node) && node.whenTrue.getText(source).includes('<PersistentPostImage') && node.condition.getText(source).includes('post.signedUrl')) conditions.push(node.condition.getText(source))
    ts.forEachChild(node,visit)
  }
  visit(source)
  assert.equal(conditions.length,2)
  for(const condition of conditions){
    assert.equal(Boolean(vm.runInNewContext(condition,{post:{signedUrl:'',storage_provider:'r2'}})),true)
    assert.equal(Boolean(vm.runInNewContext(condition,{post:{signedUrl:'',storage_provider:'supabase'}})),false)
    assert.equal(Boolean(vm.runInNewContext(condition,{post:{signedUrl:'https://images/photo',storage_provider:'supabase'}})),true)
  }
})
test('cached original needs no signature; thumbnail remains separate',async()=>{
  const b=setup({cached:true})
  assert.equal((await b.exports.r2PostUrlMap([post('a')],'original')).size,0)
  assert.equal(b.calls.length,0)
  assert.equal((await b.exports.r2PostUrlMap([post('a')],'thumbnail')).size,1)
  assert.equal(b.calls.length,1)
})
test('cache eviction fallback obtains signature even after prior cache hit',async()=>{
  const b=setup({cached:true})
  await b.exports.r2PostUrlMap([post('a')],'original')
  assert.equal((await b.exports.r2PostUrlMap([post('a')],'original',false)).size,1)
  assert.equal(b.calls.length,1)
})
test('concurrent requests share signing and expire before server signature',async()=>{
  const b=setup()
  const values=await Promise.all([b.exports.r2PostUrlMap([post('a')],'original'),b.exports.r2PostUrlMap([post('a')],'original')])
  assert.equal(values[0].get('a'),values[1].get('a'))
  assert.equal(b.calls.length,1)
  await b.exports.r2PostUrlMap([post('a')],'original')
  assert.equal(b.calls.length,1)
  b.time(55*60000+1)
  await b.exports.r2PostUrlMap([post('a')],'original')
  assert.equal(b.calls.length,2)
})
test('changed object path and thumbnail variant request distinct signatures',async()=>{
  const b=setup()
  await b.exports.r2PostUrlMap([post('a')],'original')
  await b.exports.r2PostUrlMap([{...post('a'),r2_object_key:'replacement.webp'}],'original')
  await b.exports.r2PostUrlMap([post('a')],'thumbnail')
  assert.equal(b.calls.length,3)
})
test('cache failure falls back; signing failure can retry',async()=>{
  const b=setup({broken:true})
  b.fail()
  assert.equal((await b.exports.r2PostUrlMap([post('a')],'original')).size,0)
  assert.equal((await b.exports.r2PostUrlMap([post('a')],'original')).size,1)
})
test('large gallery stays within 150 ID API limit and deduplicates IDs',async()=>{
  const b=setup()
  const posts=Array.from({length:200},(_,i)=>post(String(i)))
  assert.equal((await b.exports.r2PostUrlMap([...posts,posts[0]],'thumbnail')).size,200)
  assert.deepEqual(b.calls.map(c=>c.postIds.length),[150,50])
})
