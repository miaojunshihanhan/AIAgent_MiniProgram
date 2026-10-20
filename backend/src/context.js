'use strict'
const {compactEvidence}=require('./search')
function normalizeHistory(history){
 if(history===undefined)return []
 if(!Array.isArray(history))throw Object.assign(new Error('history 必须为消息数组。'),{status:400})
 if(history.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'))throw Object.assign(new Error('历史消息仅允许 user / assistant 和文本 content。'),{status:400})
 let left=12000;const out=[]
 for(const message of history.slice(-20).reverse()){
  if(!left)break
  const content=message.content.slice(-Math.min(left,4000));left-=content.length
  if(content.trim())out.unshift({role:message.role,content})
 }
 return out
}
// Legacy indexes also expose media names immediately, without requiring a re-import.
function withMediaNames(index){
 let changed=false
 const documents=index.documents.map(doc=>{
  if(!['image','video'].includes(doc.kind)||doc.chunks.length)return doc
  const text='文件名：'+doc.title+'\n仅依据名称匹配，尚未识别图片画面或视频内容。'
  changed=true
  return {...doc,text,status:'name_only',warning:'可按名称匹配并展示原文件；尚未识别画面、音频或视频内容',chunks:[{id:doc.id+'-'+doc.version.slice(0,12)+'-0',text,lineStart:1,lineEnd:2,location:'文件名称（未识别媒体内容）',metadataOnly:true}]}
 })
 return changed?{...index,search:undefined,documents}:index
}
function createMaterialTools(index,evidence){
 const documents=index.documents
 const catalog=(offset=0)=>({materials:documents.slice(offset,offset+40).map(d=>({documentId:d.id,title:d.title,path:d.relativePath,kind:d.kind,chunkCount:d.chunks.length,summary:d.text.slice(0,160)})),nextOffset:offset+40<documents.length?offset+40:null,total:documents.length})
 return {catalog:catalog(),definitions:[
  {type:'function',function:{name:'list_materials',description:'浏览全部材料名称和摘要，按语义选择相关材料；nextOffset 不为空时可继续翻页。',parameters:{type:'object',properties:{offset:{type:'integer',minimum:0}},additionalProperties:false}}},
  {type:'function',function:{name:'read_material',description:'按材料 ID 读取原文分块或媒体名称；可重复读取不同分块来支持追问和比较。',parameters:{type:'object',properties:{documentId:{type:'string'},offset:{type:'integer',minimum:0}},required:['documentId'],additionalProperties:false}}}
 ],invoke(name,args){
  if(!args||typeof args!=='object'||Array.isArray(args))return {error:'参数必须为对象'}
  const offset=args.offset===undefined?0:args.offset
  if(!Number.isSafeInteger(offset)||offset<0)return {error:'offset 必须为非负整数'}
  if(name==='list_materials')return catalog(offset)
  if(name!=='read_material')return {error:'未知工具'}
  const doc=documents.find(d=>d.id===args.documentId)
  if(!doc)return {error:'材料不存在，请从目录选择有效 documentId'}
  const sources=[]
  for(const chunk of doc.chunks.slice(offset,offset+3)){
   let source=evidence.find(e=>e.documentId===doc.id&&e.chunkId===chunk.id)
   if(!source){
    if(evidence.length>=18)return {sources,error:'已达到本轮材料读取上限'}
    source=compactEvidence([{doc,chunk}],1100)[0]
    source.id=String(evidence.length+1);source.quote=chunk.text;evidence.push(source)
   }
   sources.push(source)
  }
  return {sources,nextOffset:offset+3<doc.chunks.length?offset+3:null}
 }}
}
module.exports={normalizeHistory,withMediaNames,createMaterialTools}
