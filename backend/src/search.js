'use strict'
const stop=new Set(['你好','您好','请问','一下','什么','怎么','如何','是否','可以','应该','哪些','多少','请帮','帮我','告诉','我想','谢谢','进行','一个','这个','那个','有关','相关','问题','的','了','吗','呢'])
function terms(value){
 const out=value.toLowerCase().match(/[a-z0-9_]+/g)||[]
 for(const group of value.match(/[\u3400-\u9fff]+/g)||[]){if(group.length===1)out.push(group);else for(let i=0;i<group.length-1;i++)out.push(group.slice(i,i+2))}
 return [...new Set(out.filter(t=>!stop.has(t)))]
}
function buildSearch(documents){
 const postings={},records=[]
 for(const doc of documents)for(const chunk of doc.chunks){
  const n=records.length,body=terms(chunk.text),title=terms(doc.title+' '+(chunk.location||''))
  records.push({documentId:doc.id,chunkId:chunk.id,length:chunk.text.length})
  for(const t of new Set([...body,...title])){if(!postings[t])postings[t]=[];postings[t].push([n,body.includes(t)?1:0,title.includes(t)?1:0])}
 }
 return {records,postings}
}
const cached=new WeakMap()
function retrieve(index,question,limit=3){
 const tokens=terms(question);if(!tokens.length)return []
 let search=index.search
 if(!search){search=cached.get(index);if(!search){search=buildSearch(index.documents);cached.set(index,search)}}
 const scores=new Map(),N=search.records.length
 for(const token of tokens){const hits=search.postings[token]||[],idf=Math.log(1+(N-hits.length+0.5)/(hits.length+0.5))
  for(const[n,body,title]of hits){const s=scores.get(n)||{score:0,matches:0,bodyMatches:0};s.score+=idf*(body+title*0.25);s.matches++;s.bodyMatches+=body;scores.set(n,s)}
 }
 const docs=new Map(index.documents.map(d=>[d.id,d])),out=[]
 const min=tokens.length<3?1:Math.max(2,Math.ceil(tokens.length*0.25))
 for(const[n,s]of scores){if(s.bodyMatches<min)continue;const r=search.records[n],doc=docs.get(r.documentId),chunk=doc?.chunks.find(c=>c.id===r.chunkId);if(!chunk)continue;out.push({doc,chunk,score:s.score/Math.sqrt(Math.max(chunk.text.length,100)/100)})}
 return out.sort((a,b)=>b.score-a.score||a.chunk.id.localeCompare(b.chunk.id)).slice(0,limit)
}
function compactEvidence(hits,maxChars=1800){
 let left=maxChars;const evidence=[]
 for(const {doc,chunk}of hits){if(left<80)break
  const quote=chunk.text.slice(0,Math.min(left,650));left-=quote.length
  evidence.push({id:String(evidence.length+1),documentId:doc.id,documentVersion:doc.version,chunkId:chunk.id,title:doc.title,quote,pageNumber:chunk.pageNumber||null,lineStart:chunk.lineStart,lineEnd:chunk.lineEnd,
   location:chunk.location||('第 '+chunk.lineStart+'–'+chunk.lineEnd+' 行')})
 }
 return evidence
}
module.exports={terms,buildSearch,retrieve,compactEvidence}
