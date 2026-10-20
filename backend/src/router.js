'use strict'
const replies={greeting:['你好！我是材料助手，有什么想了解的？','你好呀！可以直接告诉我你的问题。','你好，很高兴见到你！需要查资料时告诉我就好。'],identity:[],goodbye:['再见！需要查资料时随时回来。','好的，下次见！']}
function localReply(question,random=Math.random,modelName=''){
 const q=question.trim().toLowerCase().replace(/[\s，。！？、,.!?~～！]/g,'')
 let intent
 if(q==='你好')intent='greeting'
 else if(q==='你是什么模型')intent='identity'
 else if(q==='再见')intent='goodbye'
 if(!intent)return null
 const pool=replies[intent]
 return {answer:intent==='identity'?(modelName?'你好！我是'+modelName+'，想问些什么？':'尚未配置 MODEL_NAME。'):pool[Math.min(pool.length-1,Math.floor(random()*pool.length))],intent,mode:'local',modelInvoked:false,citations:[],retrievedCount:0,contextChars:0}
}
module.exports={localReply}
