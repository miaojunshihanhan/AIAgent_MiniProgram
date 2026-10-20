'use strict'
// Decode only the JSON answer field; unfinished escapes stay buffered.
function partialAnswer(raw){
 const start=/^\s*(?:```(?:json)?\s*)?\{\s*"answer"\s*:\s*"/i.exec(raw)
 if(!start)return ''
 let out=''
 for(let i=start[0].length;i<raw.length;i++){
  const c=raw[i]
  if(c==='"')break
  if(c!=='\\'){out+=c;continue}
  if(++i>=raw.length)break
  const escaped=raw[i],simple={'"':'"','\\':'\\','/':'/',n:'\n',r:'\r',t:'\t',b:'\b',f:'\f'}
  if(escaped==='u'){
   const hex=raw.slice(i+1,i+5);if(!/^[0-9a-f]{4}$/i.test(hex))break
   out+=String.fromCharCode(parseInt(hex,16));i+=4
  }else if(Object.hasOwn(simple,escaped))out+=simple[escaped]
  else break
 }
 // Never publish half a UTF-16 surrogate pair.
 return /[\uD800-\uDBFF]$/.test(out)?out.slice(0,-1):out
}
async function consumeSSE(response,onDelta){
 if(!response.body)throw new Error('模型未返回流式响应体')
 const reader=response.body.getReader(),decoder=new TextDecoder()
 let pending='',finished=false,doneMarker=false
 async function event(block){
  const data=block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n').trim()
  if(!data)return
  if(data==='[DONE]'){finished=true;doneMarker=true;return}
  let value;try{value=JSON.parse(data)}catch{throw new Error('模型流式数据格式错误')}
  if(value.error)throw new Error('模型流式返回错误')
  const choice=value.choices?.[0]
  if(choice?.delta?.tool_calls?.length)throw new Error('单次回答不允许模型再调用工具')
  if(choice?.finish_reason==='length')throw new Error('模型回答达到输出上限，请缩小问题范围')
  const content=choice?.delta?.content
  if(typeof content==='string'&&content)await onDelta(content)
  if(choice?.finish_reason==='stop')finished=true
 }
 try{
  while(true){
   const {value,done}=await reader.read()
   pending+=done?decoder.decode():decoder.decode(value,{stream:true})
   let boundary
   while((boundary=/\r?\n\r?\n/.exec(pending))){const block=pending.slice(0,boundary.index);pending=pending.slice(boundary.index+boundary[0].length);await event(block)}
   if(pending.length>262144)throw new Error('模型流式数据过长')
   if(done||doneMarker)break
  }
  if(pending.trim())await event(pending)
  if(!finished)throw new Error('模型流式连接提前结束，请重试')
 }finally{try{await reader.cancel()}catch{}reader.releaseLock()}
}
module.exports={partialAnswer,consumeSSE}
