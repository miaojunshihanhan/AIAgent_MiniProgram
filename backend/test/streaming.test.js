'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict')
const {once}=require('node:events')
const {WebSocket}=require('ws')
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),vm=require('node:vm')
const {partialAnswer,consumeSSE}=require('../src/stream')
const {generateAnswer}=require('../src/model')
const {prepareMaterials}=require('../src/materials')
const {createServer}=require('../src/server')
const {createJobStore}=require('../src/jobs')
const config={mode:'api',model:'test',apiKey:'test',apiUrl:'https://model.example/v1',timeout:3000}
test('slow checkpoint storage does not block tokens or create a write backlog',async()=>{
 let writes=0,release
 const stored=new Map()
 const store=createJobStore({storage:'cos',timeout:3000},{saveChatJob:async job=>{
  writes++;if(writes===2)await new Promise(resolve=>{release=resolve})
  stored.set(job.id,structuredClone(job))
 },loadChatJob:async id=>stored.get(id)})
 const job=await store.create('owner')
 await store.progress(job,{stage:'thinking'})
 await new Promise(resolve=>setImmediate(resolve))
 for(let i=0;i<100;i++)store.partial(job,'文字'+i)
 assert.equal((await store.get(job.id,'owner')).partialAnswer,'文字99');assert.equal(writes,2)
 release();await store.finish(job,{answer:'完成',citations:[]})
 assert.equal(writes,3);assert.equal((await store.get(job.id,'owner')).result.answer,'完成')
 assert.equal(stored.get(job.id).question,undefined)
})
const frame=content=>'data: '+JSON.stringify({choices:[{delta:{content}}]})+'\r\n\r\n'
const response=parts=>new Response(new ReadableStream({start(controller){for(const part of parts)controller.enqueue(new TextEncoder().encode(part));controller.close()}}),{headers:{'content-type':'text/event-stream'}})

test('SSE decoding handles arbitrary UTF-8 and event boundaries',async()=>{
 const raw=frame('你好😀')+'data: [DONE]\r\n\r\n',bytes=new TextEncoder().encode(raw)
 const r=new Response(new ReadableStream({start(c){for(const byte of bytes)c.enqueue(Uint8Array.of(byte));c.close()}}))
 let out='';await consumeSSE(r,async text=>{out+=text});assert.equal(out,'你好😀')
 assert.equal(partialAnswer('{"answer":"你好\\n世'),'你好\n世')
 assert.equal(partialAnswer('{"answer":"中\\u4'),'中')
 assert.equal(partialAnswer('{"answer":"中\\u4f60'),'中你')
 assert.equal(partialAnswer('{"answer":"好","usedIds":["1"]}'),'好')
})

test('model emits readable answer before stream finishes and calls provider once',async()=>{
 let controller,calls=0,first
 const firstSeen=new Promise(resolve=>{first=resolve}),texts=[]
 const r=new Response(new ReadableStream({start(c){controller=c;c.enqueue(new TextEncoder().encode(frame('{"answer":"先给结论')))}}),{headers:{'content-type':'text/event-stream'}})
 const pending=generateAnswer('问题',[],config,async(u,o)=>{calls++;assert.equal(JSON.parse(o.body).stream,true);assert.equal(JSON.parse(o.body).tools,undefined);return r},{onText:async text=>{texts.push(text);first()}})
 await firstSeen;assert.equal(texts[0],'先给结论');assert.equal(calls,1)
 controller.enqueue(new TextEncoder().encode(frame('，再给要点。","usedIds":[],"mediaDocumentIds":[]}')));controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));controller.close()
 const result=await pending;assert.equal(result.answer,'先给结论，再给要点。');assert.equal(texts.at(-1),result.answer)
 assert.equal(result.timings.modelCalls,1);assert.ok(result.timings.firstAnswerMs!==null)
})

test('truncated streams and invalid citations fail without extra model requests',async()=>{
 for(const parts of [[frame('{"answer":"半句')],[frame('{"answer":"编造[9]","usedIds":["9"]}'),'data: [DONE]\n\n']]){
  let calls=0;await assert.rejects(generateAnswer('问题',[],config,async()=>{calls++;return response(parts)}),/中断|引用/)
  assert.equal(calls,1)
 }
})

test('prepared context covers documents on keyword misses and includes media past first catalog page',()=>{
 const documents=Array.from({length:45},(_,i)=>({id:String(i),version:'v',title:'材料'+i,kind:i===44?'video':'text',text:'完全不同的知识',chunks:[{id:'c'+i,text:'完全不同的知识',lineStart:1,lineEnd:1,metadataOnly:i===44}]}))
 const p=prepareMaterials({documents},'这个问题没有相同关键词',[],1000)
 assert.equal(p.materialTools.catalog.materials.length,45);assert.equal(p.evidence.length,45)
 assert.equal(p.materialTools.selectMedia(['44']).length,1)
 assert.ok(p.stats.textChars<=1000);assert.throws(()=>p.materialTools.selectMedia(['missing']))
})

test('cloud WebSocket pushes partial and final text and rejects another owner',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'chat-stream-'));t.after(()=>fs.rm(root,{recursive:true,force:true}))
 let publish,finish,started
 const running=new Promise(resolve=>{started=resolve})
 const server=createServer({...config,deployment:'cloud',dataRoot:root},{generateAnswer:async(q,e,c,f,context)=>{publish=context.onText;started();return new Promise(resolve=>{finish=resolve})}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}))
 const base='http://127.0.0.1:'+server.address().port,headers={'Content-Type':'application/json','x-wx-source':'miniprogram','x-wx-openid':'alice'}
 const job=await (await fetch(base+'/chat/jobs',{method:'POST',headers,body:JSON.stringify({question:'请解释'})})).json()
 await running
 const url=base.replace('http:','ws:')+'/chat/jobs/'+job.jobId+'/stream'
 const denied=new WebSocket(url,{headers:{...headers,'x-wx-openid':'bob'}})
 const deniedError=new Promise(resolve=>denied.on('error',resolve));assert.match((await deniedError).message,/404/)
 const ws=new WebSocket(url,{headers});t.after(()=>ws.terminate());await once(ws,'open')
 const partial=once(ws,'message');publish('正在生成的内容')
 let value=JSON.parse(String((await partial)[0]))
 if(!value.partialAnswer)value=JSON.parse(String((await once(ws,'message'))[0]))
 assert.equal(value.partialAnswer,'正在生成的内容');assert.equal(value.status,'running')
 const end=new Promise(resolve=>ws.on('message',data=>{const j=JSON.parse(String(data));if(j.status==='completed')resolve(j)}))
 finish({answer:'最终要点',usedIds:[],mode:'api',modelInvoked:true,timings:{modelCalls:1}})
 assert.equal((await end).result.answer,'最终要点')
})

test('frontend cloud stream shows partial text and falls back to original job without reposting',async()=>{
 let calls=0,socketConfig,receive,failed,closed=0
 const texts=[],module={exports:{}}
 vm.runInNewContext(require('node:fs').readFileSync(path.join(__dirname,'../../services/api.js'),'utf8'),{module,require:()=>({mode:'container',env:'e',service:'s'}),wx:{cloud:{
  callContainer(args){calls++;args.success({statusCode:200,data:calls===1?{jobId:'job',status:'running'}:{status:'completed',result:{answer:'完整回答'}}})},
  connectContainer(args){socketConfig=args;args.success({socketTask:{onMessage(fn){receive=fn},onError(fn){failed=fn},onClose(){},close(){closed++}}})}
 }},Date,Promise,Error,encodeURIComponent,setTimeout:fn=>setTimeout(fn,0),clearTimeout,setInterval,clearInterval})
 const result=module.exports.chat('问题',[],{onText:text=>texts.push(text)})
 await new Promise(resolve=>setImmediate(resolve))
 assert.equal(socketConfig.path,'/chat/jobs/job/stream')
 receive({data:JSON.stringify({status:'running',partialAnswer:'部分回答'})});failed()
 assert.equal((await result).answer,'完整回答');assert.deepEqual(texts,['部分回答']);assert.equal(calls,2);assert.equal(closed,1)
})
