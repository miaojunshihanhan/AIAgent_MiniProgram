'use strict'
const {config}=require('../src/config')
const {loadIndex}=require('../src/knowledge')
const {withMediaNames}=require('../src/context')
const {prepareMaterials}=require('../src/materials')
const {generateAnswer}=require('../src/model')
async function main(){
 const question=process.argv.slice(2).join(' ')||'新生儿喝奶后如何帮助排出吞入的空气？请给出要点和相关演示。'
 const started=Date.now(),index=withMediaNames(await loadIndex(config)),indexMs=Date.now()-started
 const prepareStarted=Date.now(),prepared=prepareMaterials(index,question)
 const prepareMs=Date.now()-prepareStarted
 let firstVisibleMs=null
 const result=await generateAnswer(question,prepared.evidence,config,fetch,{requestId:'profile',materialTools:prepared.materialTools,onText:async()=>{if(firstVisibleMs===null)firstVisibleMs=Date.now()-started}})
 console.log('[profile]',JSON.stringify({indexMs,prepareMs,firstVisibleMs,totalMs:Date.now()-started,answerChars:result.answer.length,citations:result.usedIds.length,...result.timings,materials:prepared.stats},null,2))
}
if(require.main===module)main().catch(error=>{console.error('[profile]',error.status?error.message:'诊断失败，请检查本地模型和材料配置。');process.exitCode=1})
