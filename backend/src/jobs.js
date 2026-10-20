'use strict'
const {randomUUID,createHash}=require('node:crypto')
const fs=require('node:fs/promises'),path=require('node:path')
const fault=(status,message)=>Object.assign(new Error(message),{status})
const ownerId=req=>createHash('sha256').update(String(req.headers['x-wx-openid']||'local')).digest('hex')
// Persist status/results in COS so polls can reach any service replica. Never persist prompts/history.
function createJobStore(config,dependencies={}){
 const cache=new Map()
 const storage=require('./storage')
 const save=dependencies.saveChatJob||(config.storage==='cos'?job=>storage.saveChatJob(config,job):async job=>{
  const dir=path.join(config.dataRoot,'chat-jobs');await fs.mkdir(dir,{recursive:true})
  const filename=path.join(dir,job.id+'.json'),temp=filename+'.tmp'
  await fs.writeFile(temp,JSON.stringify(job),'utf8');await fs.rename(temp,filename)
 })
 const load=dependencies.loadChatJob||(config.storage==='cos'?id=>storage.loadChatJob(config,id):async id=>{
  try{return JSON.parse(await fs.readFile(path.join(config.dataRoot,'chat-jobs',id+'.json'),'utf8'))}catch(error){if(error.code==='ENOENT')return null;throw error}
 })
 async function put(job){
  try{await save(job)}catch{throw fault(503,'保存回答任务失败，请检查 COS chat-jobs/ 目录的 PutObject 权限和网络。')}
  // Only the worker's own running jobs are cached; other replicas always read persisted status.
  cache.set(job.id,job)
 }
 return {async create(owner){
  for(const [id,job]of cache)if(job.expiresAt<Date.now())cache.delete(id)
  const job={id:randomUUID(),owner,status:'running',progress:{stage:'queued',label:'任务已接收'},createdAt:Date.now(),expiresAt:Date.now()+15*60*1000,deadline:Date.now()+(config.timeout||90000)+30000}
  await put(job);return job
 },async progress(job,progress){
  const current=cache.get(job.id)||job
  if(current.status!=='running')return
  await put({...current,progress,updatedAt:Date.now()})
 },async finish(job,result,error){
  const completed={...(cache.get(job.id)||job),status:error?'failed':'completed',finishedAt:Date.now()}
  if(error)completed.error={message:error.status?error.message:'回答生成失败，请检查后端日志。',status:error.status||500}
  else completed.result=result
  try{await put(completed)}catch(writeError){cache.set(job.id,{...job,status:'failed',error:{message:writeError.message,status:503}});throw writeError}
 },async get(id,owner){
  let job=cache.get(id)
  if(!job){try{job=await load(id)}catch{throw fault(503,'读取回答任务失败，请检查 COS chat-jobs/ 目录读取权限和网络。')}}
  if(!job||job.owner!==owner)throw fault(404,'回答任务不存在。')
  if(job.expiresAt<Date.now()){cache.delete(id);throw fault(410,'回答任务已过期，请重新提问。')}
  if(job.status==='running'&&Date.now()>job.deadline)return {jobId:id,status:'failed',error:{message:'回答任务超时或容器已重启，请重新提问。',status:504}}
  return {jobId:id,status:job.status,createdAt:job.createdAt,deadline:job.deadline,progress:job.progress,...(job.result?{result:job.result}:{}),...(job.error?{error:job.error}:{})}
 }}
}
module.exports={createJobStore,ownerId}
