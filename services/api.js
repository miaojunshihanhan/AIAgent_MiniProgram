const config = require('../config/api')
function request(path, options) {
  options = options || {}
  return new Promise((resolve, reject) => {
    const args = {
      method: options.method || 'GET', data: options.data, timeout: config.mode === 'container' ? 12000 : (config.timeout || 60000),
      header: { 'content-type': 'application/json' },
      success(res) {
        if (res.data && res.data.uploadCheck === true && path !== '/public-config') {
          wx.reLaunch({ url: '/pages/intro/intro' })
        }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data)
        else {
          const message = path === '/public-config' && res.statusCode === 404
            ? '后端缺少配置接口 /public-config，请部署最新后端代码并将流量切换至新版本，再重试。仅修改 UPLOAD_CHECK 环境变量不会更新接口。'
            : (res.data && res.data.error) || ('请求失败：HTTP ' + res.statusCode)
          const error = new Error(message); error.status = res.statusCode; reject(error)
        }
      },
      fail(error) {
        const detail = error.errMsg || ''
        const message = config.mode === 'container'
          ? (/102002|timeout|超时/i.test(detail) ? '云托管本次请求失败或超时（102002 不一定是权限错误）。请检查云端请求日志。' : '云托管请求失败，请检查网络、服务状态与小程序环境关联。')
          : '无法连接本地后端，请检查地址、同一 Wi-Fi 和防火墙。'
        const failure = new Error(message + detail); failure.transport = true; reject(failure)
      }
    }
    if (config.mode === 'container') {
      if (!wx.cloud || !wx.cloud.callContainer) { reject(new Error('当前微信基础库不支持云托管调用，请更新基础库及微信客户端。')); return }
      args.config = { env: config.env }; args.path = path
      args.header['X-WX-SERVICE'] = config.service
      wx.cloud.callContainer(args)
    } else {
      args.url = config.baseUrl.replace(/\/$/, '') + path
      wx.request(args)
    }
  })
}
function assetPath(id, version, page) {
  return '/documents/' + encodeURIComponent(id) + (page ? '/pages/' + encodeURIComponent(page) + '/image' : '/original') + '?version=' + encodeURIComponent(version)
}
function assetUrl(id, version, page) {
  const path = assetPath(id, version, page)
  if (config.mode === 'container') return request(path + '&download=1').then(result => {
    if (!result.url || !/^https:\/\//.test(result.url)) throw new Error('未获取到文件临时下载链接。')
    return result.url
  })
  return Promise.resolve(config.baseUrl.replace(/\/$/, '') + path)
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function watchStream(jobId,options){
 return new Promise(resolve=>{
  let socket,settled=false,guard,check,idle
  const finish=value=>{if(settled)return;settled=true;clearTimeout(guard);clearTimeout(idle);clearInterval(check);if(socket)try{socket.close({})}catch(_){}resolve(value)}
  const resetIdle=()=>{clearTimeout(idle);idle=setTimeout(()=>finish({fallback:true}),15000)}
  guard=setTimeout(()=>finish({fallback:true}),180000)
  check=setInterval(()=>{if(options.isCancelled&&options.isCancelled())finish({paused:true})},250)
  const attach=task=>{
   if(settled){try{task.close({})}catch(_){}return}
   socket=task
   resetIdle()
   task.onMessage(event=>{
    if(settled)return
    resetIdle()
    let value;try{value=JSON.parse(event.data)}catch(_){finish({fallback:true});return}
    if(options.onProgress)options.onProgress(value)
    if(typeof value.partialAnswer==='string'&&value.partialAnswer&&options.onText)options.onText(value.partialAnswer)
    if(value.status==='completed')finish({result:value.result})
    else if(value.status==='failed')finish({error:(value.error||{}).message||'模型回答失败。'})
   })
   task.onError(()=>finish({fallback:true}));task.onClose(()=>finish({fallback:true}))
  }
  if(config.mode==='container'){
   wx.cloud.connectContainer({config:{env:config.env},service:config.service,path:'/chat/jobs/'+encodeURIComponent(jobId)+'/stream',timeout:10000,
    success:res=>attach(res.socketTask),fail:()=>finish({fallback:true})})
  }else attach(wx.connectSocket({url:config.baseUrl.replace(/^http/,'ws').replace(/\/$/,'')+'/chat/jobs/'+encodeURIComponent(jobId)+'/stream',timeout:10000,fail:()=>finish({fallback:true})}))
 })
}
async function chat(question, history, options) {
  options = options || {}
  const data = { question, history: history || [] }
  const streamAvailable=!!options.onText&&(config.mode==='container'?!!(wx.cloud&&wx.cloud.connectContainer):typeof wx.connectSocket==='function')
  if (config.mode !== 'container'&&!streamAvailable&&!options.jobId) return request('/chat', { method: 'POST', data })
  const started = options.jobId ? {jobId:options.jobId,status:'running'} : await request('/chat/jobs', { method: 'POST', data }).catch(error => {
    if (/HTTP 404|接口不存在/.test(error.message)) throw new Error('云端后端尚未支持异步问答，请部署 2026-10-20-chat-v3 或更新版本，再重新编译小程序。')
    throw error
  })
  if (started.status === 'completed') return started.result
  if (!started.jobId || started.status !== 'running') throw new Error('云端未返回有效回答任务，请检查部署版本。')
  if (options.onJob) options.onJob(started.jobId)
  if (options.onProgress) options.onProgress(started)
  if(streamAvailable){
    const live=await watchStream(started.jobId,options)
    if(live.result)return live.result
    if(live.error){const error=new Error(live.error+'（任务号：'+started.jobId+'）');error.terminal=true;throw error}
    if(live.paused){const error=new Error('已暂停等待，可继续获取原回答。');error.jobId=started.jobId;throw error}
    if(options.onProgress)options.onProgress({progress:{label:'实时连接已断开，正在获取原回答'}})
  }
  const deadline = Date.now() + 180000
  let failures = 0
  while (Date.now() < deadline) {
    if (options.isCancelled && options.isCancelled()) { const error = new Error('已暂停等待，可继续获取原回答。'); error.jobId = started.jobId; throw error }
    await delay(failures ? Math.min(6000, failures * 1500) : 600)
    let result
    try { result = await request('/chat/jobs/' + encodeURIComponent(started.jobId)) }
    catch (error) {
      // Retry only fetching the same job, never submit the model request twice.
      if ((error.transport || error.status === 429 || error.status >= 500) && ++failures <= 8) {
        if (options.onProgress) options.onProgress({progress:{label:'网络暂时不稳定，正在恢复连接'},jobId:started.jobId})
        continue
      }
      const failure = new Error(error.message + '（任务号：' + started.jobId + '）'); failure.jobId = started.jobId; failure.terminal = error.status === 404 || error.status === 410; throw failure
    }
    failures = 0
    if (options.onProgress) options.onProgress(result)
    if (typeof result.partialAnswer==='string'&&result.partialAnswer&&options.onText) options.onText(result.partialAnswer)
    if (result.status === 'completed') return result.result
    if (result.status === 'failed') { const error = new Error(((result.error || {}).message || '模型回答失败。') + '（任务号：' + started.jobId + '）'); error.terminal = true; throw error }
    if (result.status !== 'running') throw new Error('回答任务状态异常。')
  }
  const error = new Error('暂时未收到最终结果，可点击继续获取，无需重新提问。任务号：' + started.jobId); error.jobId = started.jobId; throw error
}
module.exports = {
  publicConfig: () => request('/public-config'),
  originalUrl: (id, version) => config.mode === 'container' ? '' : config.baseUrl.replace(/\/$/, '') + assetPath(id, version),
  pageImageUrl: (id, version, n) => config.mode === 'container' ? '' : config.baseUrl.replace(/\/$/, '') + assetPath(id, version, n),
  assetUrl,
  health: () => request('/health'),
  chat,
  documents: () => request('/documents'),
  page: (id, version, n) => request('/documents/' + encodeURIComponent(id) + '/pages/' + encodeURIComponent(n) + '?version=' + encodeURIComponent(version)),
  document: (id, version, offset) => request('/documents/' + encodeURIComponent(id) + '?version=' + encodeURIComponent(version || '') + '&offset=' + (offset || 0)),
  chunk: (id, version, chunkId) => request('/documents/' + encodeURIComponent(id) + '/chunks/' + encodeURIComponent(chunkId) + '?version=' + encodeURIComponent(version))
}
