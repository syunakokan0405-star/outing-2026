const {test}=require('node:test')
const assert=require('node:assert/strict')
const vm=require('node:vm')
const {readFileSync}=require('node:fs')
function setup(){
  const handlers={}, stores=new Map();let downloads=0, fail=false
  const context={self:{location:{origin:'https://outing.test'},clients:{async claim(){}},async skipWaiting(){},addEventListener(n,f){handlers[n]=f}},URL,Request,Response,Map,Promise,
    caches:{async open(name){if(!stores.has(name))stores.set(name,new Map());const map=stores.get(name);return {async match(k){return map.get(typeof k==='string'?k:k.url)?.clone()},async put(k,r){map.set(typeof k==='string'?k:k.url,r)}}}},
    async fetch(){downloads++;await Promise.resolve();return new Response(fail?'error':'photo',{status:fail?503:200,headers:{'Content-Type':fail?'text/html':'image/jpeg'}})}
  }
  vm.runInNewContext(readFileSync('public/image-cache-worker.js','utf8'),context)
  return {stores,get downloads(){return downloads},fail(v){fail=v},async load(url){let response;handlers.fetch({request:new Request(url),respondWith(p){response=p}});return response?await response:null}}
}
test('images use durable cache and concurrent requests share one transfer',async()=>{
  const app=setup();await Promise.all([app.load('https://outing.test/outing-bg.jpg'),app.load('https://outing.test/outing-bg.jpg')]);assert.equal(app.downloads,1)
  await app.load('https://outing.test/outing-bg.jpg');assert.equal(app.downloads,1)
})
test('signature refresh reuses object cache while changed paths and revisions fetch new images',async()=>{
  const app=setup();await app.load('https://bucket.account.r2.cloudflarestorage.com/photo.jpg?X-Amz-Signature=old');await app.load('https://bucket.account.r2.cloudflarestorage.com/photo.jpg?X-Amz-Signature=new');assert.equal(app.downloads,1)
  await app.load('https://bucket.account.r2.cloudflarestorage.com/new-photo.jpg?X-Amz-Signature=new');await app.load('https://bucket.account.r2.cloudflarestorage.com/photo.jpg?v=2');assert.equal(app.downloads,3)
})
test('failures remain retryable and API metadata is never cached',async()=>{
  const app=setup();app.fail(true);assert.equal((await app.load('https://outing.test/mission-default.jpg')).status,503)
  app.fail(false);assert.equal((await app.load('https://outing.test/mission-default.jpg')).status,200);assert.equal(app.downloads,2)
  assert.equal(await app.load('https://outing.test/api/r2/read-urls'),null);assert.equal(await app.load('https://outing.test/me'),null)
  assert.equal(await app.load('https://other.example/photo.jpg'),null)
})
test('background path revisions are separate and existing image caches stay intact',async()=>{
  const app=setup();app.stores.set('outing-post-images-v3',new Map([['old','preserved']]))
  await app.load('https://outing.test/api/r2/assets?path=r2%3Aassets%2Fevent%2Fold.jpg');await app.load('https://outing.test/api/r2/assets?path=r2%3Aassets%2Fevent%2Fnew.jpg');assert.equal(app.downloads,2)
  assert.equal(app.stores.get('outing-post-images-v3').get('old'),'preserved')
})
