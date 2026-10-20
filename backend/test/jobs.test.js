'use strict'
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm')
const {createServer}=require('../src/server')
const {createJobStore}=require('../src/jobs')
async function setup(t,generateAnswer){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'chat-jobs-'));t.after(()=>fs.rm(root,{recursive:true,force:true}))
 const config={deployment:'cloud',storage:'local',mode:'api',model:'test',dataRoot:root,timeout:45000}
 const servers=[]
 const serve=async()=>{
  const server=createServer(config,{generateAnswer});servers.push(server)
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  return (route,body,owner='alice')=>fetch('http://127.0.0.1:'+server.address().port+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-wx-source':'miniprogram','x-wx-openid':owner},...(body?{body:JSON.stringify(body)}:{})})
 }
 t.after(()=>Promise.all(servers.map(server=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}))))
 return {config,serve}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
test('submit returns before model finishes; another replica polls result and preserves ownership',async t=>{
 let finish,called=0
 const pending=new Promise(resolve=>{finish=resolve})
 const {serve}=await setup(t,async()=>{called++;return pending})
 const first=await serve(),second=await serve()
 const health=await (await first('/health')).json();assert.equal(health.capabilities.asyncChat,true)
 const started=await first('/chat/jobs',{question:'请解释这个概念'})
 assert.equal(started.status,202);const job=await started.json()
 assert.equal(job.status,'running')
 const route='/chat/jobs/'+job.jobId
 assert.equal((await (await second(route)).json()).status,'running')
 assert.equal((await second(route,undefined,'bob')).status,404)
 finish({answer:'模型生成结果',usedIds:[],mode:'api',modelInvoked:true})
 let result
 for(let i=0;i<30;i++){result=await (await second(route)).json();if(result.status==='completed')break;await tick()}
 assert.equal(result.status,'completed');assert.equal(result.result.answer,'模型生成结果');assert.equal(called,1)
 assert.equal(result.result.runtimeVersion,'2026-10-20-chat-v4')
})
test('preset completes immediately and worker failures reach client without generic connection error',async t=>{
 const {serve}=await setup(t,async()=>{throw Object.assign(new Error('模型服务返回错误（HTTP 401）'),{status:502})})
 const request=await serve()
 const preset=await (await request('/chat/jobs',{question:'你是什么模型'})).json()
 assert.equal(preset.status,'completed');assert.equal(preset.result.answer,'test')
 const job=await (await request('/chat/jobs',{question:'请回答'})).json()
 let result
 for(let i=0;i<30;i++){result=await (await request('/chat/jobs/'+job.jobId)).json();if(result.status==='failed')break;await tick()}
 assert.equal(result.status,'failed');assert.match(result.error.message,/401/)
})
test('job store surfaces write failure, bounds lifetime, and persists no questions or history',async()=>{
 const stored=new Map(),config={storage:'cos',timeout:1}
 const store=createJobStore(config,{saveChatJob:async job=>stored.set(job.id,JSON.parse(JSON.stringify(job))),loadChatJob:async id=>stored.get(id)})
 const job=await store.create('owner');assert.equal(stored.get(job.id).status,'running');assert.equal(stored.get(job.id).question,undefined)
 await store.progress(job,{stage:'reading',label:'正在读取相关材料'})
 const replica=createJobStore(config,{saveChatJob:async()=>{},loadChatJob:async id=>stored.get(id)})
 assert.equal((await replica.get(job.id,'owner')).progress.stage,'reading')
 stored.get(job.id).deadline=Date.now()-1;assert.equal((await replica.get(job.id,'owner')).status,'failed')
 stored.get(job.id).expiresAt=Date.now()-1;await assert.rejects(replica.get(job.id,'owner'),/过期/)
 const broken=createJobStore(config,{saveChatJob:async()=>{throw new Error('denied')}})
 await assert.rejects(broken.create('owner'),/PutObject/)
})
test('polling a saved task never re-submits model input and reports transient recovery',async()=>{
 let polls=0;const progress=[]
 const {api,calls}=client(args=>{
  polls++
  if(polls<=5)return args.fail({errMsg:'102002 system error'})
  args.success({statusCode:200,data:{status:'completed',result:{answer:'原回答'}}})
 })
 const output=await api.chat('原问题',[],{jobId:'retained',onProgress:value=>progress.push(value)})
 assert.equal(output.answer,'原回答');assert.equal(calls.length,6)
 assert.ok(calls.every(call=>call.method==='GET'));assert.match(progress[1].progress.label,/恢复连接/)
})
test('exhausted transient retries retain job ID so user can resume',async()=>{
 const {api,calls}=client(args=>args.fail({errMsg:'102002'}))
 await assert.rejects(api.chat('test',[],{jobId:'kept'}),error=>error.jobId==='kept'&&!error.terminal)
 assert.equal(calls.length,9)
})
function client(handler){
 const module={exports:{}},calls=[]
 vm.runInNewContext(require('node:fs').readFileSync(path.join(__dirname,'../../services/api.js'),'utf8'),{module,require:()=>({mode:'container',env:'env',service:'svc'}),wx:{cloud:{callContainer(args){calls.push(args);handler(args,calls)}}},setTimeout:fn=>{fn()},Date,encodeURIComponent,Promise,Error})
 return {api:module.exports,calls}
}
test('client polls the same job, retries only polling, and returns citations and answer',async()=>{
 let polls=0
 const {api,calls}=client(args=>{
  if(args.method==='POST')return args.success({statusCode:202,data:{jobId:'job-1',status:'running'}})
  polls++
  if(polls===1)return args.fail({errMsg:'cloud.callContainer:fail 102002 system error'})
  args.success({statusCode:200,data:polls===2?{status:'running'}:{status:'completed',result:{answer:'完整回答',citations:[{id:'1'}]}}})
 })
 const result=await api.chat('问题',[{role:'user',content:'历史'}])
 assert.equal(result.answer,'完整回答');assert.equal(result.citations.length,1)
 assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(calls[0].data.history[0].content,'历史')
 assert.ok(calls.slice(1).every(c=>c.path==='/chat/jobs/job-1'&&c.timeout===12000))
})
test('client rejects old backend and displays actual worker errors',async()=>{
 const old=client(args=>args.success({statusCode:404,data:{error:'接口不存在。'}}))
 await assert.rejects(old.api.chat('test'),/chat-v3/)
 const failed=client(args=>args.success({statusCode:200,data:args.method==='POST'?{jobId:'job-2',status:'running'}:{status:'failed',error:{message:'模型请求失败或超时'}}}))
 await assert.rejects(failed.api.chat('test'),/模型请求失败或超时.*job-2/)
})
test('answer taking over fifteen seconds is delivered via short polls',async t=>{
 const {serve}=await setup(t,async()=>{
  await new Promise(resolve=>setTimeout(resolve,16000))
  return {answer:'超过十五秒仍能收到的回答',usedIds:[],mode:'api',modelInvoked:true}
 })
 const request=await serve(),startedAt=Date.now()
 const response=await request('/chat/jobs',{question:'慢速模型测试'})
 const job=await response.json()
 assert.equal(response.status,202);assert.ok(Date.now()-startedAt<3000)
 let result
 while(Date.now()-startedAt<20000){
  const pollStarted=Date.now()
  result=await (await request('/chat/jobs/'+job.jobId)).json()
  assert.ok(Date.now()-pollStarted<3000)
  if(result.status==='completed')break
  await new Promise(resolve=>setTimeout(resolve,1000))
 }
 assert.ok(Date.now()-startedAt>=16000)
 assert.equal(result.status,'completed');assert.equal(result.result.answer,'超过十五秒仍能收到的回答')
})
