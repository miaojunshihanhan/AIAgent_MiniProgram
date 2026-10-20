'use strict'
const {test}=require('node:test')
const assert=require('node:assert/strict')
const {createMaterialTools,withMediaNames}=require('../src/context')
const {generateAnswer,readAnswer}=require('../src/model')
const {createServer}=require('../src/server')
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path')
const {importMaterials}=require('../src/knowledge')
const config={mode:'api',model:'test',apiKey:'test',apiUrl:'https://model.example/v1',timeout:3000}
const doc=(id,kind='image')=>({id,kind,title:kind==='video'?'新生儿拍嗝演示.mp4':'拍嗝姿势.jpg',version:'version',text:'',chunks:[]})
const output=(mediaDocumentIds,usedIds=[])=>JSON.stringify({answer:'相关演示可在下方查看。',usedIds,mediaDocumentIds})

test('model can attach relevant images and videos directly from catalog without another request',async()=>{
 const evidence=[],tools=createMaterialTools(withMediaNames({documents:[doc('image'),doc('video','video')]}),evidence)
 let calls=0
 const result=await generateAnswer('如何帮助宝宝排出吞入的空气？',evidence,config,async(url,options)=>{
  calls++;const body=JSON.parse(options.body),system=body.messages[0].content
  assert.match(system,/不得复述到答案/);assert.match(system,/即使用户未明确索要也可主动附上/)
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

test('attachments reject unknown, non-media, unseen or excessive IDs and allow catalog pagination',()=>{
 const documents=Array.from({length:41},(_,i)=>doc(String(i)))
 documents[1]={...doc('text','text'),text:'正文',chunks:[{id:'t',text:'正文',lineStart:1,lineEnd:1}]}
 const evidence=[],tools=createMaterialTools(withMediaNames({documents}),evidence)
 for(const ids of [['missing'],['text'],['40'],[42],Array(7).fill('0'),'0'])assert.throws(()=>readAnswer(output(ids),evidence,tools),/媒体附件/)
 assert.equal(evidence.length,0)
 tools.invoke('list_materials',{offset:40})
 assert.deepEqual(readAnswer(output(['40']),evidence,tools).usedIds,['1'])
 assert.throws(()=>readAnswer(output(['0']),[]),/媒体附件/)
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
  return {ok:true,json:async()=>({choices:[{message:{content:output(catalog.map(d=>d.documentId))}}]})}
 },context)})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}))
 const base='http://127.0.0.1:'+server.address().port
 const response=await fetch(base+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'宝宝喝奶后怎么护理？'})})
 const result=await response.json()
 assert.equal(response.status,200);assert.equal(result.citations.length,2)
 assert.deepEqual(result.citations.map(c=>c.kind).sort(),['image','video'])
 for(const source of result.citations){
  assert.ok(source.chunkId&&source.documentVersion);assert.equal(source.metadataOnly,true)
  const original=await fetch(base+'/documents/'+source.documentId+'/original?version='+source.documentVersion)
  assert.equal(original.status,200)
 }
})
