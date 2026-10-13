const {test} = require('node:test')
const assert = require('node:assert/strict')
const {readFileSync} = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
function setup({loggedIn=true,role='owner',putFails=false,canStream=false}={}) {
  let downloads=0, puts=0, updates=0
  const stored=new Set()
  const db={auth:{async getUser(){return {data:{user:loggedIn?{id:'u'}:null}}}},storage:{from(){return {async download(){downloads++;return {data:new Blob(['image'],{type:'image/jpeg'})}}}}},from(table){
    const q={select(){return q},eq(){return q},not(){return q},update(){updates++;return q},async maybeSingle(){return {data: table==='admin_users'?{id:'a',role,can_manage_guide:false,can_manage_missions:false,can_manage_stream:canStream}:{id:'p'}}},async single(){return {data:{ranking_background_path:'event-backgrounds/event/ranking.jpg'}}},then(resolve){return Promise.resolve({data:table==='missions'?[]:null}).then(resolve)}}
    return q
  }}
  class Head {constructor(x){Object.assign(this,x);this.op='head'}}
  class Get {constructor(x){Object.assign(this,x);this.op='get'}}
  class Put {constructor(x){Object.assign(this,x);this.op='put'}}
  const modules={
    'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}},
    '@aws-sdk/client-s3':{HeadObjectCommand:Head,GetObjectCommand:Get,PutObjectCommand:Put},
    '@aws-sdk/s3-request-presigner':{getSignedUrl:async()=> 'https://r2.test/upload'},
    '@/lib/supabase/server':{createClient:async()=>db},
    '@/lib/supabase/admin':{createAdminClient:()=>db},
    '@/lib/r2':{R2_BUCKET_NAME:'bucket',r2:{async send(command){
      if(command.op==='head'&&!stored.has(command.Key))throw {$metadata:{httpStatusCode:404}}
      if(command.op==='put'){puts++;if(putFails)throw Error('R2 down');stored.add(command.Key)}
      if(command.op==='get')return {ContentType:'image/jpeg',Body:{transformToWebStream:()=>new Blob(['image']).stream()}}
      return {}
    }}},
  }
  const compile=file=>ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
  const helpers={};vm.runInNewContext(compile('lib/background-assets.ts'),{exports:helpers})
  modules['@/lib/background-assets']=helpers
  const exports={}
  vm.runInNewContext(compile('app/api/r2/assets/route.ts'),{exports,require:n=>modules[n],process:{env:{NEXT_PUBLIC_EVENT_ID:'event'}},Response,URL,Uint8Array,crypto:require('node:crypto').webcrypto,console:{error(){}}})
  return {exports,get downloads(){return downloads},get puts(){return puts},get updates(){return updates}}
}
test('legacy background reads copy once; subsequent reads come from R2',async()=>{
  const b=setup()
  const request=new Request('https://outing.test/api/r2/assets?path=event-backgrounds/event/ranking.jpg')
  assert.equal((await b.exports.GET(request)).status,200)
  assert.equal((await b.exports.GET(request)).status,200)
  assert.equal(b.downloads,1);assert.equal(b.puts,1)
})
test('asset endpoints reject unauthenticated users and cross-event paths',async()=>{
  const request=new Request('https://outing.test/api/r2/assets?path=event-backgrounds/other/ranking.jpg')
  assert.equal((await setup({loggedIn:false}).exports.GET(request)).status,401)
  const b=setup();assert.equal((await b.exports.GET(request)).status,400);assert.equal(b.downloads,0)
})
const migrate=()=>new Request('https://outing.test/api/r2/assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'home',action:'migrate'})})
test('migration commits paths only after a successful R2 copy and can retry',async()=>{
  const b=setup({putFails:true})
  assert.equal((await b.exports.POST(migrate())).status,500)
  assert.equal(b.updates,0)
  const success=setup();assert.equal((await success.exports.POST(migrate())).status,200);assert.equal(success.updates,1)
})
test('staff cannot migrate or request an upload without the matching permission',async()=>{
  const b=setup({role:'staff'})
  assert.equal((await b.exports.POST(migrate())).status,403)
  assert.equal(b.downloads,0);assert.equal(b.updates,0)
})

test('stream uploads require stream permission and use R2 paths',async()=>{
  const request=()=>new Request('https://outing.test/api/r2/assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'stream',contentType:'image/jpeg'})})
  assert.equal((await setup({role:'staff'}).exports.POST(request())).status,403)
  const allowed=await setup({role:'staff',canStream:true}).exports.POST(request())
  assert.equal(allowed.status,200);assert.match((await allowed.json()).path,/^r2:assets\/event\/stream\//)
})
