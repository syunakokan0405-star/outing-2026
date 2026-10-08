const {test}=require('node:test')
const assert=require('node:assert/strict')
const {readFileSync}=require('node:fs')
const vm=require('node:vm')
const ts=require('typescript')
const exportsForTest={}
vm.runInNewContext(ts.transpileModule(readFileSync('lib/realtime-post-queue.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:exportsForTest,setTimeout,clearTimeout})
const {createPostQueue}=exportsForTest
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
test('burst deduplicates IDs into one request',async()=>{
  const batches=[]
  const q=createPostQueue(async ids=>batches.push(Array.from(ids)),()=>true)
  q.enqueue('a');q.enqueue('a');q.enqueue('b')
  await sleep(180)
  assert.deepEqual(batches,[['a','b']]);q.dispose()
})
test('hidden screen defers all reads; resume retrieves every ID in bounded batches',async()=>{
  let visible=false;const batches=[]
  const q=createPostQueue(async ids=>batches.push(Array.from(ids)),()=>visible)
  for(let i=0;i<201;i++)q.enqueue(String(i))
  await sleep(180)
  assert.equal(batches.length,0)
  visible=true;await q.flush()
  assert.deepEqual(batches.map(b=>b.length),[150,51]);q.dispose()
})
test('new events during an in-flight fetch are retained',async()=>{
  const batches=[];let release
  const gate=new Promise(resolve=>release=resolve)
  const q=createPostQueue(async ids=>{batches.push(Array.from(ids));if(batches.length===1)await gate},()=>true)
  q.enqueue('a');const draining=q.flush();q.enqueue('b');release();await draining
  assert.deepEqual(batches,[['a'],['b']]);q.dispose()
})
test('failed request stays queued for recovery; disposed queue makes no requests',async()=>{
  let fails=true;const batches=[]
  const q=createPostQueue(async ids=>{if(fails)throw Error('offline');batches.push(Array.from(ids))},()=>true)
  q.enqueue('a');await q.flush();assert.equal(batches.length,0)
  fails=false;await q.flush();assert.deepEqual(batches,[['a']])
  q.enqueue('b');q.dispose();await q.flush();assert.equal(batches.length,1)
})
