'use strict'
const {test}=require('node:test')
const assert=require('node:assert/strict')
const {createMaterialTools,withMediaNames}=require('../src/context')
const {generateAnswer,readAnswer}=require('../src/model')
const {createServer}=require('../src/server')
const {prepareMaterials}=require('../src/materials')
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path')
const {importMaterials}=require('../src/knowledge')
const config={mode:'api',model:'test',apiKey:'test',apiUrl:'https://model.example/v1',timeout:3000}
const doc=(id,kind='image')=>({id,kind,title:kind==='video'?'新生儿拍嗝演示.mp4':'拍嗝姿势.jpg',version:'version',text:'',chunks:[]})
const output=(mediaDocumentIds,usedIds=[])=>JSON.stringify({answer:'相关演示可在下方查看。',usedIds,mediaDocumentIds})

test('media citation IDs are assigned before generation and stay stable regardless of selection order',()=>{
 const text={...doc('text','text'),text:'文本依据',chunks:[{id:'text-chunk',text:'文本依据',lineStart:1,lineEnd:1}]}
 const prepared=prepareMaterials(withMediaNames({documents:[text,doc('image'),doc('video','video')]}),'给我演示视频')
 const {evidence,materialTools}=prepared
 const video=materialTools.catalog.materials.find(d=>d.documentId==='video')
 assert.equal(video.evidenceId,'3')
 const result=readAnswer(JSON.stringify({answer:'演示视频见下方[3]',usedIds:[],mediaDocumentIds:['video','image']}),evidence,materialTools)
 assert.deepEqual(result.usedIds,['3','2']);assert.equal(evidence.length,3)
 assert.equal(evidence.find(e=>e.id==='3').documentId,'video')
 assert.equal(prepared.stats.passages,1);assert.equal(prepared.stats.omittedPassages,0)
 const only=readAnswer(JSON.stringify({answer:'演示见下方',usedIds:['video'],mediaDocumentIds:[]}),evidence,materialTools)
 assert.deepEqual(only.usedIds,['3'])
 assert.throws(()=>readAnswer(JSON.stringify({answer:'不存在的来源[99]',usedIds:['video'],mediaDocumentIds:['video']}),evidence,materialTools),/引用/)
})

test('metadata-only media is explicitly labelled in the model prompt and accepts valid inline references',async()=>{
 const prepared=prepareMaterials(withMediaNames({documents:[doc('video','video')]}),'给我演示视频')
 let calls=0
 const result=await generateAnswer('给我演示视频',prepared.evidence,config,async(url,options)=>{
  calls++;const prompt=JSON.parse(JSON.parse(options.body).messages.at(-1).content)
  assert.equal(prompt.evidence[0].metadataOnly,true);assert.equal(prompt.evidence[0].kind,'video')
  assert.equal(prompt.evidence[0].text,'新生儿拍嗝演示.mp4')
  assert.equal(prompt.materials.materials[0].evidenceId,prompt.evidence[0].id)
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({answer:'演示视频[1]',usedIds:['video'],mediaDocumentIds:[]})}}]})}
 },{materialTools:prepared.materialTools})
 assert.equal(calls,1);assert.deepEqual(result.usedIds,['1'])
})

test('model can attach relevant images and videos directly from catalog without another request',async()=>{
 const evidence=[],tools=createMaterialTools(withMediaNames({documents:[doc('image'),doc('video','video')]}),evidence)
 let calls=0
 const result=await generateAnswer('如何帮助宝宝排出吞入的空气？',evidence,config,async(url,options)=>{
  calls++;const body=JSON.parse(options.body),system=body.messages[0].content
  assert.match(system,/不复述内部匹配规则/);assert.match(system,/可主动附在下方/)
  const catalog=JSON.parse(body.messages.at(-1).content).materials.materials
  assert.equal(catalog[0].summary,'')
  return {ok:true,json:async()=>({choices:[{message:{content:output(['image','video','image'])}}]})}
 },{materialTools:tools})
 assert.equal(calls,1);assert.equal(result.answer,'相关演示可在下方查看。')
 assert.deepEqual(result.usedIds,['1','2']);assert.deepEqual(evidence.map(e=>e.kind),['image','video'])
 assert.equal(evidence[0].metadataOnly,true)
})

test('media tool output omits internal matching labels and supports attachments without inline markers',()=>{
 const evidence=[],tools=createMaterialTools(withMediaNames({documents:[doc('image')]}),evidence)
 const source=tools.invoke('read_material',{documentId:'image'}).sources[0]
 assert.equal(source.quote,'拍嗝姿势.jpg');assert.equal(source.location,'');assert.equal(source.contentAvailable,false)
 assert.deepEqual(readAnswer(output([],['1']),evidence,tools).usedIds,['1'])
 assert.deepEqual(readAnswer(output(['image']),evidence,tools).usedIds,['1']);assert.equal(evidence.length,1)
})

test('optional attachments skip invalid IDs while the catalog selector stays strict',()=>{
 const documents=Array.from({length:41},(_,i)=>doc(String(i)))
 documents[1]={...doc('text','text'),text:'正文',chunks:[{id:'t',text:'正文',lineStart:1,lineEnd:1}]}
 const evidence=[],tools=createMaterialTools(withMediaNames({documents}),evidence)
 for(const ids of [['missing'],['text'],['40'],[42],'0',null,{documentId:'0'}])assert.deepEqual(readAnswer(output(ids),evidence,tools).usedIds,[])
 for(const ids of [['missing'],['text'],['40'],[42],Array(7).fill('0'),'0'])assert.throws(()=>tools.selectMedia(ids))
 assert.equal(evidence.length,0)
 tools.invoke('list_materials',{offset:40})
 assert.deepEqual(readAnswer(output(['40']),evidence,tools).usedIds,['1'])
 assert.deepEqual(readAnswer(output(['0']),[]).usedIds,[])
})

test('mixed attachments preserve valid sources, remove duplicates and cap at six',()=>{
 const documents=Array.from({length:8},(_,i)=>doc(String(i)))
 const evidence=[],tools=createMaterialTools(withMediaNames({documents}),evidence)
 const result=readAnswer(output(['missing',{},null,42,'','0','0','1','2','3','4','5','6','7']),evidence,tools)
 assert.equal(result.answer,'相关演示可在下方查看。')
 assert.deepEqual(evidence.map(e=>e.documentId),['0','1','2','3','4','5'])
 assert.deepEqual(result.usedIds,['1','2','3','4','5','6'])
})

test('invalid attachments never relax answer citation validation',()=>{
 const evidence=[{id:'1',kind:'text',quote:'原文'}]
 assert.throws(()=>readAnswer(JSON.stringify({answer:'编造引用[9]',usedIds:[],mediaDocumentIds:['missing']}),evidence),/引用/)
 assert.deepEqual(readAnswer(JSON.stringify({answer:'有效引用[1]',usedIds:[],mediaDocumentIds:['missing']}),evidence).usedIds,['1'])
 assert.deepEqual(readAnswer(JSON.stringify({answer:'答案',usedIds:['9'],mediaDocumentIds:null}),evidence).usedIds,[])
})

test('attachment diagnostics identify the request without logging model content or filenames',t=>{
 const logs=[];t.mock.method(console,'warn',(...args)=>logs.push(args.join(' ')))
 const evidence=[],tools=createMaterialTools(withMediaNames({documents:[doc('image')]}),evidence)
 readAnswer(output(['image','private-file-name.jpg']),evidence,tools,'request-test')
 assert.equal(logs.length,1);assert.match(logs[0],/requestId=request-test/)
 assert.match(logs[0],/"accepted":1/);assert.match(logs[0],/not_selectable/)
 assert.doesNotMatch(logs[0],/private-file-name|相关演示|拍嗝/)
})

test('streamed answer survives malformed optional attachments with one model call',async()=>{
 for(const mediaDocumentIds of [null,'image',[{documentId:'image'}],['missing']]){
  let calls=0;const texts=[]
  const content=JSON.stringify({answer:'测试回答',usedIds:[],mediaDocumentIds})
  const result=await generateAnswer('测试问题',[],config,async()=>{
   calls++
   return new Response('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})
  },{requestId:'stream-media-test',onText:text=>texts.push(text)})
  assert.equal(calls,1);assert.equal(result.answer,'测试回答');assert.equal(texts.at(-1),result.answer)
  assert.deepEqual(result.usedIds,[]);assert.equal(result.modelInvoked,true)
 }
})

test('chat API returns directly selected media as complete displayable citations',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'media-attachments-'))
 t.after(()=>fs.rm(root,{recursive:true,force:true}))
 const c={...config,materialsRoot:path.join(root,'materials'),dataRoot:path.join(root,'data')}
 await fs.mkdir(c.materialsRoot)
 await fs.writeFile(path.join(c.materialsRoot,'拍嗝姿势.jpg'),'image')
 await fs.writeFile(path.join(c.materialsRoot,'拍嗝演示.mp4'),'video')
 await importMaterials(c)
 const server=createServer(c,{generateAnswer:(q,e,c,unused,context)=>generateAnswer(q,e,c,async(url,options)=>{
  const catalog=JSON.parse(JSON.parse(options.body).messages.at(-1).content).materials.materials
  const video=catalog.find(d=>d.kind==='video')
  const content=JSON.stringify({answer:'相关演示可在下方查看。['+video.evidenceId+']',usedIds:[video.documentId,'obsolete-id'],mediaDocumentIds:['missing',...catalog.map(d=>d.documentId)]})
  return {ok:true,json:async()=>({choices:[{message:{content}}]})}
 },context)})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}))
 const base='http://127.0.0.1:'+server.address().port
 const post={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'宝宝喝奶后怎么护理？'})}
 const response=await fetch(base+'/chat',post)
 const result=await response.json()
 assert.equal(response.status,200);assert.equal(result.citations.length,2)
 assert.deepEqual(result.citations.map(c=>c.kind).sort(),['image','video'])
 for(const source of result.citations){
  assert.ok(source.chunkId&&source.documentVersion);assert.equal(source.metadataOnly,true)
  const original=await fetch(base+'/documents/'+source.documentId+'/original?version='+source.documentVersion)
  assert.equal(original.status,200)
 }
 const submitted=await fetch(base+'/chat/jobs',post)
 assert.equal(submitted.status,202)
 const job=await submitted.json()
 let snapshot
 for(let i=0;i<100;i++){
  snapshot=await (await fetch(base+'/chat/jobs/'+job.jobId)).json()
  if(snapshot.status!=='running')break
  await new Promise(resolve=>setTimeout(resolve,10))
 }
 assert.equal(snapshot.status,'completed');assert.equal(snapshot.result.answer,result.answer)
 assert.deepEqual(snapshot.result.citations.map(c=>c.documentId),result.citations.map(c=>c.documentId))
})
