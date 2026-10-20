'use strict'
const {retrieve}=require('./search')
const {createMaterialTools}=require('./context')
// All titles remain visible for semantic selection. Local scoring only supplements
// balanced text coverage; a keyword miss never blocks generation.
function prepareMaterials(index,question,history=[],maxChars=24000){
 const evidence=[],tools=createMaterialTools(index,evidence),materials=[]
 let catalogChars=0,truncated=false
 for(let offset=0;offset<index.documents.length;offset+=40){
  const page=offset?tools.invoke('list_materials',{offset}):tools.catalog
  for(const d of page.materials){
   const item={documentId:d.documentId,title:d.title,kind:d.kind}
   if(catalogChars+JSON.stringify(item).length>18000){truncated=true;break}
   materials.push(item);catalogChars+=JSON.stringify(item).length
  }
  if(truncated)break
 }
 const visible=new Set(materials.map(d=>d.documentId))
 const documents=index.documents.filter(d=>visible.has(d.id)&&d.chunks.some(c=>!c.metadataOnly))
 const candidates=[],seen=new Set()
 function add(doc,chunk){if(chunk&&!chunk.metadataOnly&&!seen.has(chunk.id)){candidates.push({doc,chunk});seen.add(chunk.id)}}
 // Give every document at least one passage before any extra scored passages.
 const query=history.filter(m=>m.role==='user').slice(-2).map(m=>m.content).join('\n')+'\n'+question
 const ranked=retrieve(index,query,24).filter(h=>!h.chunk.metadataOnly)
 for(const doc of documents)add(doc,ranked.find(h=>h.doc.id===doc.id)?.chunk||doc.chunks.find(c=>!c.metadataOnly))
 for(const hit of ranked)add(hit.doc,hit.chunk)
 for(let n=0;n<Math.max(0,...documents.map(d=>d.chunks.length));n++)for(const doc of documents)add(doc,doc.chunks[n])
 let left=maxChars
 for(const {doc,chunk}of candidates){
  if(left<100)break
  // Preserve whole source passages; do not fabricate a quote from omitted text.
  if(chunk.text.length>left)continue
  evidence.push({id:String(evidence.length+1),documentId:doc.id,documentVersion:doc.version,chunkId:chunk.id,title:doc.title,kind:doc.kind||'text',metadataOnly:false,quote:chunk.text,pageNumber:chunk.pageNumber||null,lineStart:chunk.lineStart,lineEnd:chunk.lineEnd,location:chunk.location||('第 '+chunk.lineStart+'–'+chunk.lineEnd+' 行')})
  left-=chunk.text.length
 }
 return {evidence,materialTools:{catalog:{materials,total:index.documents.length,truncated},selectMedia:ids=>{if(ids.some(id=>!visible.has(id)))throw new Error('媒体不在目录');return tools.selectMedia(ids)}},stats:{catalogChars,textChars:maxChars-left,passages:evidence.length,omittedPassages:candidates.length-evidence.length,catalogTruncated:truncated}}
}
module.exports={prepareMaterials}
