'use strict'
const replies={greeting:['你好！我是材料助手，有什么想了解的？','你好呀！可以直接告诉我你的问题。','你好，很高兴见到你！需要查资料时告诉我就好。'],thanks:['不客气，有需要随时问我。','不用谢！还有其他问题也可以继续问。'],identity:['我是材料助手，可以帮你查找已导入资料，并展示回答依据。'],goodbye:['再见！需要查资料时随时回来。','好的，下次见！']}
function localReply(question,random=Math.random){
 const q=question.trim().toLowerCase().replace(/[\s，。！？、,.!?~～！]/g,'')
 let intent
 if(/^(你好|您好|你好呀|你好啊|嗨|哈喽|hello|hi|早上好|下午好|晚上好|早安|晚安|在吗|有人吗)$/.test(q))intent='greeting'
 else if(/^(谢谢|谢谢你|感谢|多谢|thanks|thankyou)$/.test(q))intent='thanks'
 else if(/^(你是谁|你是什么|你能做什么|介绍一下你自己)$/.test(q))intent='identity'
 else if(/^(再见|拜拜|bye|下次见)$/.test(q))intent='goodbye'
 if(!intent)return null
 const pool=replies[intent]
 return {answer:pool[Math.min(pool.length-1,Math.floor(random()*pool.length))],intent,mode:'local',modelInvoked:false,citations:[],retrievedCount:0,contextChars:0}
}
module.exports={localReply}
