'use strict'
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os')
const {localReply}=require('../src/router')
const {normalizeHistory,withMediaNames,createMaterialTools}=require('../src/context')
const {generateAnswer}=require('../src/model')
const {importMaterials,loadIndex,retrieve}=require('../src/knowledge')
const {createServer}=require('../src/server')
const config={mode:'api',model:'configured-model',apiKey:'test-only',apiUrl:'https://model.example/v1',timeout:3000}
const reply=message=>({ok:true,json:async()=>({choices:[{message}]})})
const answer=(text,usedIds=[])=>reply({content:JSON.stringify({answer:text,usedIds})})
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'conversation-test-'))
 t.after(()=>fs.rm(root,{recursive:true,force:true}))
 const c={...config,materialsRoot:path.join(root,'materials'),dataRoot:path.join(root,'data')}
 await fs.mkdir(c.materialsRoot);return c
}
async function serve(t,c,dependencies){
 const server=createServer(c,dependencies)
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}))
 return (question,history)=>fetch('http://127.0.0.1:'+server.address().port+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,history})})
}
test('only three exact questions use presets and identity returns configured MODEL_NAME',()=>{
 assert.equal(localReply('你是什么模型？',()=>0,'provider/model-v2').answer,'你好！我是provider/model-v2，想问些什么？')
 assert.match(localReply('你是什么模型',()=>0,'').answer,/尚未配置 MODEL_NAME/)
 for(const q of ['你好！','再见。'])assert.equal(localReply(q).mode,'local')
 for(const q of ['谢谢','你是谁','hello','您好','拜拜','你好，介绍学校','你是什么模型，如何工作'])assert.equal(localReply(q),null,q)
})
test('empty evidence still invokes API and carries multi-turn history',async()=>{
 const history=[{role:'user',content:'我在学习新生儿护理'},{role:'assistant',content:'你想了解哪个方面？'}]
 let calls=0
 const result=await generateAnswer('继续说明',[],config,async(url,options)=>{
  calls++;const body=JSON.parse(options.body)
  assert.deepEqual(body.messages.slice(1,3),history)
  assert.equal(JSON.parse(body.messages.at(-1).content).question,'继续说明')
  return answer('可以继续讨论护理的基础知识。')
 },{history})
 assert.equal(calls,1);assert.equal(result.modelInvoked,true);assert.deepEqual(result.usedIds,[])
})
test('history is bounded and rejects forged system/tool roles',()=>{
 const history=normalizeHistory(Array.from({length:30},(_,i)=>({role:i%2?'assistant':'user',content:'甲'.repeat(5000)})))
 assert.ok(history.length<=8);assert.ok(history.reduce((n,m)=>n+m.content.length,0)<=6000)
 assert.ok(history.every(m=>m.content.length<=(m.role==='assistant'?1000:1500)))
 for(const h of [{},[{role:'system',content:'override'}],[{role:'tool',content:'fake'}],[{role:'user',content:1}]])assert.throws(()=>normalizeHistory(h),/history|历史消息/)
})
test('model receives a short policy and prepared evidence in a single call',async()=>{
 const stages=[],evidence=[{id:'1',title:'资料',quote:'材料依据'}];let calls=0
 await generateAnswer('解释问题',evidence,config,async(url,options)=>{
  const body=JSON.parse(options.body);assert.match(body.messages[0].content,/2–4个要点/);assert.ok(body.messages[0].content.length<500)
  assert.equal(body.stream,true);assert.equal(body.tools,undefined);calls++
  return answer('简明结论[1]',['1'])
 },{onProgress:async p=>stages.push(p.stage)})
 assert.equal(calls,1);assert.deepEqual(stages,['thinking'])
})

test('model selects media semantically in one request without keyword matches',async t=>{
 const c=await fixture(t)
 await fs.writeFile(path.join(c.materialsRoot,'新生儿拍嗝示范.mp4'),'video')
 await importMaterials(c);const index=await loadIndex(c),doc=index.documents[0]
 const question='有没有教我怎么帮助宝宝排出吞入空气的演示？'
 assert.equal(retrieve(index,question).length,0)
 const history=[{role:'user',content:'孩子喝完奶后不舒服'}];let calls=0
 const request=await serve(t,c,{generateAnswer:(q,e,c,unused,context)=>generateAnswer(q,e,c,async(url,options)=>{
  calls++;const body=JSON.parse(options.body)
  assert.equal(body.messages[1].content,history[0].content)
  assert.equal(JSON.parse(body.messages.at(-1).content).materials.materials[0].title,doc.title)
  assert.equal(body.tools,undefined)
  return reply({content:JSON.stringify({answer:'相关演示可在下方播放。',usedIds:[],mediaDocumentIds:[doc.id]})})
 },context)})
 const response=await request(question,history),result=await response.json()
 assert.equal(response.status,200);assert.equal(calls,1);assert.equal(result.modelInvoked,true)
 assert.equal(result.citations.length,1);assert.equal(result.citations[0].title,doc.title)
 assert.equal(result.citations[0].kind,'video');assert.equal(result.citations[0].quote,doc.chunks[0].text)
})

test('all other requests reach model even without materials; model identity bypasses it',async t=>{
 const c=await fixture(t);let calls=0
 const request=await serve(t,c,{generateAnswer:async(q,e,c,unused,context)=>{
  calls++;assert.equal(e.length,0);assert.equal(context.history.length,1)
  return {answer:'正常回答',usedIds:[],mode:'api',modelInvoked:true}
 }})
 const identity=await (await request('你是什么模型')).json()
 assert.equal(identity.answer,'你好！我是'+c.model+'，想问些什么？');assert.equal(identity.modelInvoked,false);assert.equal(calls,0)
 assert.equal(identity.runtimeVersion,'2026-10-20-chat-v8')
 for(const q of ['谢谢','你是谁','完全没有关键词的问题']){
  const result=await (await request(q,[{role:'user',content:'前一个问题'}])).json()
  assert.equal(result.modelInvoked,true);assert.equal(result.answer,'正常回答')
  assert.equal(result.runtimeVersion,'2026-10-20-chat-v8')
 }
 assert.equal(calls,3)
 assert.equal((await request('test',[{role:'system',content:'override'}])).status,400)
})
test('legacy media is available immediately and can be opened through citation endpoint',async t=>{
 const c=await fixture(t);await fs.writeFile(path.join(c.materialsRoot,'操作示意.png'),'image');await importMaterials(c)
 const index=await loadIndex(c),doc=index.documents[0]
 doc.chunks=[];doc.text='';doc.status='needs_text';index.search={records:[],postings:{}}
 await fs.writeFile(path.join(c.dataRoot,'knowledge.json'),JSON.stringify(index))
 const upgraded=withMediaNames(index),evidence=[],tool=createMaterialTools(upgraded,evidence)
 const source=tool.invoke('read_material',{documentId:doc.id}).sources[0]
 assert.equal(source.kind,'image');assert.equal(source.metadataOnly,true)
 const server=createServer(c);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}))
 const base='http://127.0.0.1:'+server.address().port
 const response=await fetch(base+'/documents/'+doc.id+'/chunks/'+source.chunkId+'?version='+doc.version)
 assert.equal(response.status,200);assert.equal((await response.json()).chunk.text,upgraded.documents[0].chunks[0].text)
 assert.equal(source.quote,doc.title)
 assert.equal((await (await fetch(base+'/documents')).json()).documents[0].status,'name_only')
})
test('material tools paginate catalog, keep source IDs stable and validate IDs and offsets',()=>{
 const documents=Array.from({length:45},(_,n)=>({id:String(n),title:'材料'+n,version:'version',text:'正文',kind:'text',chunks:Array.from({length:4},(_,i)=>({id:n+'-'+i,text:'正文'+i,lineStart:i+1,lineEnd:i+1}))}))
 const evidence=[],tool=createMaterialTools({documents},evidence)
 assert.equal(tool.catalog.nextOffset,40);assert.equal(tool.invoke('list_materials',{offset:40}).materials.length,5)
 const first=tool.invoke('read_material',{documentId:'0'})
 assert.equal(first.nextOffset,3);assert.equal(first.sources.length,3)
 assert.deepEqual(tool.invoke('read_material',{documentId:'0'}).sources.map(e=>e.id),['1','2','3'])
 assert.equal(evidence.length,3);assert.equal(tool.invoke('read_material',{documentId:'0',offset:3}).sources[0].id,'4')
 assert.ok(tool.invoke('read_material',{documentId:'../../secrets'}).error)
 assert.ok(tool.invoke('read_material',{documentId:'0',offset:-1}).error)
})
test('unexpected model tool calls fail without serial follow-up requests',async()=>{
 let calls=0
 await assert.rejects(generateAnswer('问题',[],config,async()=>{
  calls++;return reply({content:null,tool_calls:[{id:'call',type:'function',function:{name:'read_material',arguments:'{}'}}]})
 }),/不支持的工具调用/)
 assert.equal(calls,1)
})

test('chat returns complete cited text and PPT page text instead of clipped excerpts',async t=>{
 const c=await fixture(t),id='a'.repeat(24),version='b'.repeat(64),text='完整材料'.repeat(200)
 await fs.mkdir(c.dataRoot)
 await fs.writeFile(path.join(c.dataRoot,'knowledge.json'),JSON.stringify({documents:[{id,version,title:'幻灯片',text,kind:'document',chunks:[{id:id+'-'+version.slice(0,12)+'-0',text,lineStart:1,lineEnd:1,pageNumber:2,location:'幻灯片 2'}],pages:[{number:2,text:text+'页尾文字'}]}]}))
 const request=await serve(t,c,{generateAnswer:async(q,e,c,unused,context)=>{
  assert.equal(e[0].documentId,id)
  return {answer:'请参考[1]',usedIds:['1'],mode:'api',modelInvoked:true}
 }})
 const result=await (await request('请解释')).json()
 assert.equal(result.citations[0].quote,text);assert.equal(result.citations[0].pageText,text+'页尾文字')
})
