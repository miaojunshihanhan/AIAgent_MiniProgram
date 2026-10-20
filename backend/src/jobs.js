'use strict'
const {randomUUID,createHash}=require('node:crypto')
const fs=require('node:fs/promises'),path=require('node:path')
const fault=(status,message)=>Object.assign(new Error(message),{status})
const ownerId=req=>createHash('sha256').update(String(req.headers['x-wx-openid']||'local')).digest('hex')
// Only generated text/results are checkpointed; never persist prompts or history.
function createJobStore(config,dependencies={}){
 const cache=new Map(),queues=new Map(),listeners=new Map(),checkpoints=new Map(),writes=new Map()
 const storage=require('./storage')
 const save=dependencies.saveChatJob||(config.storage==='cos'?job=>storage.saveChatJob(config,job):async job=>{
  const dir=path.join(config.dataRoot,'chat-jobs');await fs.mkdir(dir,{recursive:true})
  const filename=path.join(dir,job.id+'.json'),temp=filename+'.tmp'
  await fs.writeFile(temp,JSON.stringify(job),'utf8');await fs.rename(temp,filename)
 })
 const load=dependencies.loadChatJob||(config.storage==='cos'?id=>storage.loadChatJob(config,id):async id=>{
  try{return JSON.parse(await fs.readFile(path.join(config.dataRoot,'chat-jobs',id+'.json'),'utf8'))}catch(error){if(error.code==='ENOENT')return null;throw error}
 })
 function view(job){return {jobId:job.id,status:job.status,createdAt:job.createdAt,deadline:job.deadline,progress:job.progress,partialAnswer:job.partialAnswer||'',...(job.result?{result:job.result}:{}),...(job.error?{error:job.error}:{})}}
 function publish(job){cache.set(job.id,job);for(const listener of listeners.get(job.id)||[]){try{listener(view(job))}catch{}}}
 function persist(job){
  const pending=(queues.get(job.id)||Promise.resolve()).catch(()=>{}).then(async()=>{
   const started=Date.now()
   try{await save(job)}catch{throw fault(503,'保存回答任务失败，请检查 COS chat-jobs/ 目录的 PutObject 权限和网络。')}
   const stats=writes.get(job.id)||{count:0,ms:0};stats.count++;stats.ms+=Date.now()-started;writes.set(job.id,stats)
  })
  queues.set(job.id,pending)
  pending.finally(()=>{if(queues.get(job.id)===pending)queues.delete(job.id)}).catch(()=>{})
  return pending
 }
 function checkpoint(job,force=false){
  // At most one checkpoint per second; partial tokens never wait for COS.
  if(queues.has(job.id)||(!force&&Date.now()-(checkpoints.get(job.id)||0)<1000))return
  checkpoints.set(job.id,Date.now())
  persist(job).catch(error=>console.error('[chat] checkpoint failed','requestId='+job.id,error.message))
 }
 return {async create(owner){
  for(const [id,job]of cache)if(job.expiresAt<Date.now()){cache.delete(id);checkpoints.delete(id);writes.delete(id)}
  const now=Date.now(),job={id:randomUUID(),owner,status:'running',progress:{stage:'queued',label:'任务已接收'},createdAt:now,expiresAt:now+15*60*1000,deadline:now+(config.timeout||90000)+30000}
  const started=Date.now();await persist(job);publish(job);checkpoints.set(job.id,now)
  console.log('[timing]','requestId='+job.id,'stage=job_create','ms='+(Date.now()-started))
  return job
 },async progress(job,progress){
  const current=cache.get(job.id)||job;if(current.status!=='running')return
  const next={...current,progress,updatedAt:Date.now()};publish(next);checkpoint(next,true)
 },partial(job,text){
  const current=cache.get(job.id)||job;if(current.status!=='running')return
  const next={...current,partialAnswer:text,progress:{stage:'streaming',label:'正在输出回答'},updatedAt:Date.now()};publish(next);checkpoint(next)
 },subscribe(id,listener){
  if(!listeners.has(id))listeners.set(id,new Set())
  listeners.get(id).add(listener)
  return ()=>{const set=listeners.get(id);if(set){set.delete(listener);if(!set.size)listeners.delete(id)}}
 },async finish(job,result,error){
  const completed={...(cache.get(job.id)||job),status:error?'failed':'completed',finishedAt:Date.now()}
  if(error)completed.error={message:error.status?error.message:'回答生成失败，请检查后端日志。',status:error.status||500}
  else {completed.result=result;completed.partialAnswer=result.answer}
  const started=Date.now()
  try{await persist(completed);publish(completed)}catch(writeError){publish({...completed,status:'failed',result:undefined,error:{message:writeError.message,status:503}});throw writeError}
  console.log('[timing]','requestId='+job.id,'stage=job_finish','ms='+(Date.now()-started),'totalMs='+(Date.now()-job.createdAt),'storage='+JSON.stringify(writes.get(job.id)))
 },async get(id,owner){
  let job=cache.get(id)
  if(!job){try{job=await load(id)}catch{throw fault(503,'读取回答任务失败，请检查 COS chat-jobs/ 目录读取权限和网络。')}}
  if(!job||job.owner!==owner)throw fault(404,'回答任务不存在。')
  if(job.expiresAt<Date.now()){cache.delete(id);throw fault(410,'回答任务已过期，请重新提问。')}
  if(job.status==='running'&&Date.now()>job.deadline)return {jobId:id,status:'failed',error:{message:'回答任务超时或容器已重启，请重新提问。',status:504}}
  return view(job)
 }}
}
module.exports={createJobStore,ownerId}
