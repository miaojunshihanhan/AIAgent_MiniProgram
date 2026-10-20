'use strict'
const http = require('node:http')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { config: defaults } = require('./config')
const { loadIndex: loadStoredIndex, retrieve } = require('./knowledge')
const { generateAnswer } = require('./model')
const {localReply}=require('./router')
const {compactEvidence}=require('./search')
const {normalizeHistory,withMediaNames,createMaterialTools}=require('./context')
const {createJobStore,ownerId}=require('./jobs')
const loadIndex=async config=>withMediaNames(await loadStoredIndex(config))
const runtimeVersion='2026-10-20-chat-v4'
function fail(status, message) { return Object.assign(new Error(message), { status }) }
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(body))
}
async function readJson(req) {
  let size = 0; const parts = []
  for await (const part of req) {
    size += part.length
    if (size > 100000) throw fail(413, '请求内容过大。')
    parts.push(part)
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')) }
  catch { throw fail(400, '请求必须为合法 JSON。') }
}
function publicDocument(doc) {
  return { id: doc.id, version: doc.version, title: doc.title, relativePath: doc.relativePath,
    kind: doc.kind || 'text', status: doc.status || 'ready', warning: doc.warning || '', format: doc.format, size: doc.size, chunkCount: doc.chunks.length, lineCount: doc.text.replace(/\r\n?/g, '\n').split('\n').length }
}
function createServer(config = defaults, dependencies = {}) {
  const model = dependencies.generateAnswer || generateAnswer
  const jobs=createJobStore(config,dependencies)
  async function answer(question,history,requestId,onProgress=async()=>{}){
    const started=Date.now()
    console.log('[chat] started','requestId='+requestId)
    const local=localReply(question,Math.random,config.model)
    if(local)return {requestId,runtimeVersion,...local}
    await onProgress({stage:'materials',label:'正在加载材料目录'})
    const index=await loadIndex(config)
    const evidence=config.mode==='mock'?compactEvidence(retrieve(index,question,3),1800):[]
    const materialTools=index.documents.length?createMaterialTools(index,evidence):undefined
    const output=await model(question,evidence,config,undefined,{history,materialTools,requestId,onProgress})
    console.log('[chat] completed','requestId='+requestId,'elapsedMs='+(Date.now()-started))
    return {requestId,runtimeVersion,answer:output.answer,mode:output.mode,modelInvoked:output.modelInvoked===true,
      citations:evidence.filter(e=>output.usedIds.includes(e.id)).map(e=>{
        const doc=index.documents.find(d=>d.id===e.documentId),chunk=doc.chunks.find(c=>c.id===e.chunkId)
        return {...e,quote:chunk.text,pageText:(doc.pages||[]).find(p=>p.number===e.pageNumber)?.text||''}
      }),retrievedCount:evidence.length,contextChars:evidence.reduce((n,e)=>n+e.quote.length,0)}
  }
  let active = 0
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (req.method === 'GET' && url.pathname === '/ready') return send(res, 200, { ok: true })
      if (config.deployment === 'cloud') {
        if (!req.headers['x-wx-source'] || !req.headers['x-wx-openid']) throw fail(401, '请通过已关联的小程序调用此服务。')
        if (req.method === 'GET' && url.pathname === '/whoami') return send(res, 200, { openid: req.headers['x-wx-openid'] })
        // All mini program users can access the shared library; no per-user allowlist.
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        const index = await loadIndex(config)
        return send(res, 200, { ok: true, runtimeVersion, capabilities:{conversation:true,materialTools:true,mediaNames:true,asyncChat:true,chatProgress:true}, modelMode: config.mode, modelConfigured: !!(config.apiKey && config.model && config.apiUrl && !config.apiUrl.includes('YOUR-PROVIDER')),
          documentCount: index.documents.length, searchableCount: index.documents.filter(d => d.chunks.length).length, pendingTextCount: index.documents.filter(d => !d.chunks.length).length, importedAt: index.importedAt, developmentOnly: config.deployment !== 'cloud', storage: config.storage || 'local' })
      }
      const asset = url.pathname.match(/^\/documents\/([a-f0-9]{24})\/(?:original|pages\/(\d+)\/image)$/)
      if (req.method === 'GET' && config.storage === 'cos' && asset) {
        const index = await loadIndex(config), doc = index.documents.find(d => d.id === asset[1])
        if (!doc) throw fail(404, '材料不存在或已移除。')
        if (url.searchParams.get('version') !== doc.version) throw fail(409, '材料版本已更新，请刷新资料库。')
        if (asset[2] && !(doc.pages || []).some(p => p.number === Number(asset[2]))) throw fail(404, '页面不存在。')
        const relative = asset[2] ? 'previews/' + doc.id + '/' + doc.version + '/' + Number(asset[2]) + '.png' : 'originals/' + doc.original
        return send(res, 200, await require('./storage').signedAsset(config, relative))
      }
      if (req.method === 'GET' && url.pathname === '/documents') {
        const index = await loadIndex(config)
        return send(res, 200, { documents: index.documents.map(publicDocument), importedAt: index.importedAt })
      }
      const pm=url.pathname.match(/^\/documents\/([a-f0-9]{24})\/pages\/(\d+)(\/image)?$/)
      if(req.method==='GET'&&pm){
        const index=await loadIndex(config),doc=index.documents.find(d=>d.id===pm[1]);if(!doc)throw fail(404,'材料不存在');if(url.searchParams.get('version')!==doc.version)throw fail(409,'材料版本已更新');const page=(doc.pages||[]).find(p=>p.number===Number(pm[2]));if(!page)throw fail(404,'页面不存在');const filename=path.join(config.dataRoot,'previews',doc.id,doc.version,page.number+'.png');let hasImage=false;if(config.storage==='cos'){hasImage=page.hasImage===true}else{try{await fs.access(filename);hasImage=true}catch(_){}};if(pm[3]){if(!hasImage)throw fail(404,'页图尚未生成');res.writeHead(200,{'Content-Type':'image/png'});return res.end(await fs.readFile(filename))};return send(res,200,{page:{...page,hasImage},pageCount:doc.pages.length})
      }
      const match = url.pathname.match(/^\/documents\/([a-f0-9]{24})(?:\/(chunks|original)(?:\/([a-f0-9-]+))?)?$/)
      if (req.method === 'GET' && match) {
        const index = await loadIndex(config), doc = index.documents.find(d => d.id === match[1])
        if (!doc) throw fail(404, '材料不存在或已移除，请刷新资料库。')
        const requestedVersion = url.searchParams.get('version')
        if (requestedVersion && requestedVersion !== doc.version) throw fail(409, '材料版本已更新，当前引用已失效，请重新提问。')
        if (match[2] === 'chunks') {
          const chunk = doc.chunks.find(c => c.id === match[3])
          if (!chunk) throw fail(404, '原文片段不存在，请重新提问。')
          return send(res, 200, { document: publicDocument(doc), chunk, page: (doc.pages || []).find(p=>p.number===chunk.pageNumber) || null })
        }
        if (match[2] === 'original') {
          const filename=path.join(config.dataRoot,'originals',doc.original), stat=await fs.stat(filename)
          const types={txt:'text/plain; charset=utf-8',md:'text/plain; charset=utf-8',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',mp4:'video/mp4',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
          const headers={'Content-Type':types[doc.format]||'application/octet-stream','Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(doc.title),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'}
          let start=0,end=stat.size-1,status=200
          if(req.headers.range){
            const range=req.headers.range.match(/^bytes=(\d*)-(\d*)$/)
            if(!range||(!range[1]&&!range[2])){res.writeHead(416,{'Content-Range':'bytes */'+stat.size});return res.end()}
            if(range[1]){start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end}
            else start=Math.max(0,stat.size-Number(range[2]))
            if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=stat.size){res.writeHead(416,{'Content-Range':'bytes */'+stat.size});return res.end()}
            status=206;headers['Content-Range']='bytes '+start+'-'+end+'/'+stat.size
          }
          headers['Content-Length']=stat.size===0?0:end-start+1
          res.writeHead(status,headers)
          if(!stat.size)return res.end()
          const stream=require('node:fs').createReadStream(filename,{start,end})
          stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res)
          return
        }
        const offset = Number(url.searchParams.get('offset') || 0)
        if (!Number.isInteger(offset) || offset < 0) throw fail(400, '原文位置不正确。')
        const lines = doc.text.replace(/\r\n?/g, '\n').split('\n'), end = Math.min(offset + 80, lines.length)
        return send(res, 200, { document: publicDocument(doc), lines: lines.slice(offset, end).map((text, i) => ({ number: offset + i + 1, text })),
          offset, nextOffset: end < lines.length ? end : null, totalLines: lines.length })
      }
      const jobMatch=url.pathname.match(/^\/chat\/jobs\/([a-f0-9-]{36})$/)
      if(req.method==='GET'&&jobMatch)return send(res,200,{runtimeVersion,...await jobs.get(jobMatch[1],ownerId(req))})
      if (req.method === 'POST' && ['/chat','/chat/jobs'].includes(url.pathname)) {
        if (!(req.headers['content-type'] || '').includes('application/json')) throw fail(415, '请使用 application/json。')
        if (active >= 4) throw fail(429, '当前请求较多，请稍后重试。')
        active++
        try {
        const body = await readJson(req)
        if (!body || typeof body.question !== 'string' || !body.question.trim() || body.question.length > 2000) throw fail(400, '问题不能为空，且不超过 2000 个字符。')
        const question = body.question.trim(),history=normalizeHistory(body.history)
        if(url.pathname==='/chat/jobs'){
          const local=localReply(question,Math.random,config.model)
          if(local)return send(res,200,{status:'completed',result:{requestId:randomUUID(),runtimeVersion,...local}})
          const job=await jobs.create(ownerId(req))
          active++
          setImmediate(async()=>{
            try{
              let result,error
              try{result=await answer(question,history,job.id,progress=>jobs.progress(job,progress))}catch(cause){error=cause;console.error('[chat] failed','requestId='+job.id,'elapsedMs='+(Date.now()-job.createdAt),cause.status||500)}
              await jobs.finish(job,result,error)
            }catch(error){console.error('[chat] persist failed','requestId='+job.id,error.message)}finally{active--}
          })
          return send(res,202,{jobId:job.id,status:'running',runtimeVersion,createdAt:job.createdAt,deadline:job.deadline,progress:job.progress})
        }
        return send(res,200,await answer(question,history,randomUUID()))
        } finally { active-- }
      }
      throw fail(404, '接口不存在。')
    } catch (error) {
      if (!res.headersSent && !res.destroyed) send(res, error.status || 500, { error: error.status ? error.message : '服务处理失败，请检查后端日志。' })
      if (!error.status) console.error('[server]', error.message)
    }
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  return server
}
if (require.main === module) {
  if (!['mock', 'api'].includes(defaults.mode) || !Number.isInteger(defaults.port) || defaults.port < 1 || defaults.port > 65535 || !Number.isFinite(defaults.timeout) || defaults.timeout < 1000 || defaults.timeout > 120000) {
    console.error('请检查 MODEL_MODE、PORT 与 MODEL_TIMEOUT_MS（1000–120000）。'); process.exit(1)
  }
  const server = createServer()
  server.on('error', error => { console.error('启动失败：', error.message); process.exitCode = 1 })
  server.listen(defaults.port, defaults.host, () => console.log('Knowledge API: http://' + defaults.host + ':' + defaults.port + ' | mode=' + defaults.mode + ' | deployment=' + defaults.deployment))
}
module.exports = { createServer }
